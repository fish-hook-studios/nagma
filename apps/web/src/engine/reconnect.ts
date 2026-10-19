import { type DocPatch, applyPatch, isEmpty } from "./patch";
import type { NagmaDocument } from "./types";

// Reconnecting to the sync server: when to try again, and how to pick up where the connection
// dropped without downloading the whole file again.

// Exponential backoff with jitter: attempt 1 waits 0.25–0.5 s, attempt 2 0.5–1 s, … up to 7.5–15 s.
// The random half spreads out a crowd that lost the server at the same moment (a restart), so they
// don't all come back in the same instant.
export function reconnectDelay(attempt: number, random: () => number = Math.random, base = 500, cap = 15_000): number {
    const ceiling = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
    return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export interface Pending {
    id: string;
    patch: DocPatch;
}

export interface MissedOp {
    version: number;
    id: string | null;
    patch: DocPatch;
}

// The server's answer to "I have everything up to version N": the operations since then, in order.
// They move the confirmed document forward; the ones that are this browser's own edits (sent before
// the connection dropped, applied by the server, but never acknowledged) leave the pending list, so
// they aren't sent twice. What is still pending is sent again.
export function resumeFrom(confirmed: NagmaDocument, version: number, ops: MissedOp[], pending: Pending[]): { doc: NagmaDocument; version: number; pending: Pending[] } | null {
    let doc = confirmed;
    let at = version;
    const seen = new Set<string>();
    for (const op of ops) {
        if (op.version <= at) continue;
        // A gap: the server's history doesn't reach back far enough; the whole file is needed.
        if (op.version !== at + 1) return null;
        doc = applyPatch(doc, op.patch);
        at = op.version;
        if (op.id) seen.add(op.id);
    }
    return { doc, version: at, pending: pending.filter((p) => !seen.has(p.id)) };
}

// Many changes waiting (a long time offline) go up as one patch: the difference between the
// confirmed document and this browser's view, so reconnecting doesn't replay hundreds of messages
// against the server's per-connection limit.
export const COMBINE_PENDING_OVER = 20;
export function combinePending(confirmed: NagmaDocument, pending: Pending[], diff: (a: NagmaDocument, b: NagmaDocument) => DocPatch, newId: () => string): Pending[] {
    if (pending.length <= COMBINE_PENDING_OVER) return pending;
    const local = pending.reduce((doc, p) => applyPatch(doc, p.patch), confirmed);
    const patch = diff(confirmed, local);
    return isEmpty(patch) ? [] : [{ id: newId(), patch }];
}
