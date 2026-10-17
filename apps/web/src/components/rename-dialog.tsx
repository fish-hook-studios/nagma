import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RENAME_TOKENS, closeRenameDialog, previewNames, renameDialog } from "../engine/rename-layers";
import { editor } from "../engine/store";
import type { Command } from "../engine/types";

// ⌘R with several layers selected: the "Rename layers" dialog. "Rename to" names every layer,
// with tokens for the current name ($&) and a running number counting up ($nn) or down ($NN);
// "Match" replaces only the matching part of each name, as text or a regular expression. The
// preview lists every change before it is applied.

export function RenameDialog() {
    const isOpen = useSyncExternalStore(renameDialog.subscribe, renameDialog.isOpen);
    return isOpen ? <RenameDialogBody /> : null;
}

function RenameDialogBody() {
    const { doc, selection } = editor.get();
    const ids = selection.filter((id) => doc.nodes[id]);
    const names = ids.map((id) => doc.nodes[id]?.name ?? "");
    const [renameTo, setRenameTo] = useState("");
    const [match, setMatch] = useState("");
    const [regex, setRegex] = useState(false);
    const [start, setStart] = useState(1);
    const field = useRef<HTMLInputElement>(null);
    useEffect(() => {
        requestAnimationFrame(() => field.current?.focus());
    }, []);
    const preview = previewNames(names, renameTo, match, regex, start);
    const changed = preview.filter((p) => p.from !== p.to).length;
    let badRegex = false;
    if (regex && match) {
        try {
            new RegExp(match);
        } catch {
            badRegex = true;
        }
    }

    const insert = (token: string) => {
        const input = field.current;
        const at = input?.selectionStart ?? renameTo.length;
        const next = renameTo.slice(0, at) + token + renameTo.slice(input?.selectionEnd ?? at);
        setRenameTo(next);
        requestAnimationFrame(() => {
            input?.focus();
            input?.setSelectionRange(at + token.length, at + token.length);
        });
    };

    const apply = () => {
        const commands: Command[] = [];
        preview.forEach((p, i) => {
            const id = ids[i];
            if (id && p.to !== p.from && p.to.trim()) commands.push({ type: "node.update", id, patch: { name: p.to } });
        });
        if (commands.length) editor.execute({ type: "batch", commands });
        closeRenameDialog();
    };

    const input = "h-7 w-full rounded-md border border-panel-border bg-field px-2 text-[11px] text-ink outline-none focus:border-brand-500";
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onPointerDown={(e) => e.target === e.currentTarget && closeRenameDialog()}>
            <form
                role="dialog"
                aria-label={`Rename ${ids.length} layers`}
                className="w-[420px] rounded-xl border border-panel-border bg-panel p-4 text-[11px] text-ink shadow-2xl"
                onSubmit={(e) => {
                    e.preventDefault();
                    apply();
                }}
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        e.stopPropagation();
                        closeRenameDialog();
                    }
                }}
            >
                <h2 className="mb-3 text-[12px] font-semibold">Rename {ids.length} layers</h2>
                <label className="mb-1 block text-ink-muted" htmlFor="rename-to">
                    Rename to
                </label>
                <input id="rename-to" ref={field} autoFocus value={renameTo} onChange={(e) => setRenameTo(e.target.value)} placeholder="New name" className={input} autoComplete="off" />
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {RENAME_TOKENS.map((t) => (
                        <button key={t.token} type="button" onClick={() => insert(t.token)} className="h-6 rounded-md bg-field px-2 text-ink-muted hover:bg-panel-hover hover:text-ink">
                            {t.label}
                        </button>
                    ))}
                    <label className="ml-auto flex items-center gap-1 text-ink-muted">
                        Start at
                        <input type="number" min={0} value={start} onChange={(e) => setStart(Math.max(0, Math.floor(Number(e.target.value) || 0)))} aria-label="Start number" className="h-6 w-12 rounded-md border border-panel-border bg-field px-1 text-right text-ink outline-none focus:border-brand-500" />
                    </label>
                </div>
                <label className="mt-3 mb-1 block text-ink-muted" htmlFor="rename-match">
                    Match
                </label>
                <input id="rename-match" value={match} onChange={(e) => setMatch(e.target.value)} placeholder="Text to replace" className={`${input} ${badRegex ? "border-red-500" : ""}`} autoComplete="off" />
                <label className="mt-1.5 flex items-center gap-1.5 text-ink-muted">
                    <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} className="size-3 accent-brand-500" />
                    Regular expression
                </label>
                <h3 className="mt-3 mb-1 font-semibold">Preview</h3>
                <ul className="max-h-40 overflow-y-auto rounded-md border border-panel-border bg-field p-1">
                    {preview.map((p, i) => (
                        <li key={ids[i]} className="flex h-6 items-center gap-2 px-1">
                            <span className="min-w-0 flex-1 truncate text-ink-muted">{p.from}</span>
                            <span className="shrink-0 text-ink-subtle">→</span>
                            <span className={`min-w-0 flex-1 truncate ${p.to !== p.from ? "text-ink" : "text-ink-muted"}`}>{p.to}</span>
                        </li>
                    ))}
                </ul>
                <div className="mt-3 flex items-center justify-end gap-2">
                    <span className="mr-auto text-ink-muted">{badRegex ? "Invalid regular expression" : changed ? `${changed} of ${ids.length} will change` : "No changes yet"}</span>
                    <button type="button" onClick={closeRenameDialog} className="h-7 rounded-md px-3 text-ink-muted hover:bg-panel-hover hover:text-ink">
                        Cancel
                    </button>
                    <button type="submit" disabled={!changed} className="h-7 rounded-md bg-brand-500 px-3 text-white hover:bg-brand-600 disabled:opacity-40">
                        Rename
                    </button>
                </div>
            </form>
        </div>
    );
}
