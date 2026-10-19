import { describe, expect, it } from "vitest";
import { COMBINE_PENDING_OVER, combinePending, reconnectDelay, resumeFrom } from "./reconnect";
import { diffDocs } from "./patch";
import type { NagmaDocument } from "./types";

const doc = (x = 0) =>
    ({
        name: "File",
        roots: ["page1"],
        nodes: {
            page1: { id: "page1", type: "page", name: "Page 1", parentId: null, children: ["r1"] },
            r1: { id: "r1", type: "rect", name: "Box", parentId: "page1", children: [], x, y: 0, w: 10, h: 10 },
        },
    }) as unknown as NagmaDocument;
const xOf = (d: NagmaDocument) => (d.nodes.r1 as unknown as { x: number }).x;
const move = (x: number) => ({ nodes: { r1: { x } } }) as never;

describe("reconnect backoff", () => {
    it("grows exponentially, with jitter, up to 15 seconds", () => {
        expect(reconnectDelay(1, () => 0)).toBe(250);
        expect(reconnectDelay(1, () => 1)).toBe(500);
        expect(reconnectDelay(2, () => 0)).toBe(500);
        expect(reconnectDelay(3, () => 1)).toBe(2000);
        expect(reconnectDelay(50, () => 1)).toBe(15_000);
        expect(reconnectDelay(50, () => 0)).toBe(7_500);
    });

    it("spreads a crowd out instead of bringing everyone back at once", () => {
        const delays = Array.from({ length: 1000 }, () => reconnectDelay(4));
        expect(Math.min(...delays)).toBeGreaterThanOrEqual(2000);
        expect(Math.max(...delays)).toBeLessThanOrEqual(4000);
        expect(new Set(delays).size).toBeGreaterThan(200);
    });
});

describe("resuming after a dropped connection", () => {
    it("applies only the missed operations and forgets our own edits the server already has", () => {
        const pending = [
            { id: "mine1", patch: move(5) },
            { id: "mine2", patch: move(6) },
        ];
        // The server applied mine1 (its acknowledgement was lost with the connection), then someone else's edit.
        const ops = [
            { version: 11, id: "mine1", patch: move(5) },
            { version: 12, id: "theirs", patch: move(7) },
        ];
        const r = resumeFrom(doc(1), 10, ops, pending);
        expect(r?.version).toBe(12);
        expect(xOf(r!.doc)).toBe(7);
        expect(r?.pending.map((p) => p.id)).toEqual(["mine2"]);
    });

    it("skips operations it already has and asks for the whole file when there's a gap", () => {
        expect(resumeFrom(doc(1), 10, [{ version: 10, id: "old", patch: move(9) }], [])?.version).toBe(10);
        expect(resumeFrom(doc(1), 10, [{ version: 12, id: "x", patch: move(9) }], [])).toBeNull();
    });

    it("sends a long offline queue as one patch with the same result", () => {
        const confirmed = doc(0);
        const few = Array.from({ length: COMBINE_PENDING_OVER }, (_, i) => ({ id: `p${i}`, patch: move(i) }));
        expect(combinePending(confirmed, few, diffDocs, () => "one")).toBe(few);
        const many = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, patch: move(i + 1) }));
        const combined = combinePending(confirmed, many, diffDocs, () => "one");
        expect(combined).toHaveLength(1);
        expect(combined[0]?.id).toBe("one");
        expect((combined[0]!.patch.nodes!.r1 as { x: number }).x).toBe(200);
        // Edits that cancel out leave nothing to send.
        const back = [...many, { id: "undo", patch: move(0) }];
        expect(combinePending(confirmed, back, diffDocs, () => "one")).toEqual([]);
    });
});
