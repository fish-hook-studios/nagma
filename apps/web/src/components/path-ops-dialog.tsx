import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { applyCommand } from "../engine/commands";
import { closePathDialog, offsetSelection, type OffsetJoin, pathDialog, pathTargets, pointCount, simplifyCommands } from "../engine/path-ops";
import { editor } from "../engine/store";
import { placedSubpaths, shapeSubpaths } from "../engine/vector";
import type { Command } from "../engine/types";

// Offset path… (distance, join and miter limit; makes an offset copy) and Simplify path… (a
// tolerance slider previewed live on the canvas).

export function PathOpsDialog() {
    const which = useSyncExternalStore(pathDialog.subscribe, pathDialog.get);
    if (which === "offset") return <OffsetDialog />;
    if (which === "simplify") return <SimplifyDialog />;
    return null;
}

const field = "h-7 w-full rounded-md border border-panel-border bg-field px-2 text-[11px] text-ink outline-none focus:border-brand-500";

function Shell({ title, onSubmit, onCancel, children, submit }: { title: string; onSubmit: () => void; onCancel: () => void; children: React.ReactNode; submit: string }) {
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
            <form
                role="dialog"
                aria-label={title}
                className="w-[300px] rounded-xl border border-panel-border bg-panel p-4 text-[11px] text-ink shadow-2xl"
                onSubmit={(e) => {
                    e.preventDefault();
                    onSubmit();
                }}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") onCancel();
                }}
            >
                <h2 className="mb-3 text-[12px] font-semibold">{title}</h2>
                {children}
                <div className="mt-4 flex justify-end gap-2">
                    <button type="button" onClick={onCancel} className="h-7 rounded-md px-3 text-ink-muted hover:bg-panel-hover hover:text-ink">
                        Cancel
                    </button>
                    <button type="submit" className="h-7 rounded-md bg-brand-500 px-3 text-white hover:bg-brand-600">
                        {submit}
                    </button>
                </div>
            </form>
        </div>
    );
}

function OffsetDialog() {
    const [distance, setDistance] = useState("10");
    const [join, setJoin] = useState<OffsetJoin>("miter");
    const [limit, setLimit] = useState("4");
    const first = useRef<HTMLInputElement>(null);
    useEffect(() => first.current?.select(), []);
    const apply = () => {
        const d = Number(distance);
        if (!Number.isFinite(d) || d === 0) {
            editor.notify("Enter an offset other than 0.");
            return;
        }
        const made = offsetSelection(d, join, Math.max(1, Number(limit) || 4));
        closePathDialog();
        if (!made) editor.notify("Nothing left at that offset.");
    };
    return (
        <Shell title="Offset path" onSubmit={apply} onCancel={closePathDialog} submit="Offset">
            <label className="mb-1 block text-ink-muted" htmlFor="offset-distance">
                Offset
            </label>
            <input id="offset-distance" ref={first} value={distance} onChange={(e) => setDistance(e.target.value)} inputMode="decimal" className={field} />
            <p className="mt-1 text-ink-subtle">Positive grows shapes, negative shrinks them.</p>
            <span className="mt-3 mb-1 block text-ink-muted">Join</span>
            <div role="radiogroup" aria-label="Join" className="flex gap-1 rounded-md bg-field p-0.5">
                {(["miter", "round", "bevel"] as const).map((j) => (
                    <button key={j} type="button" role="radio" aria-checked={join === j} onClick={() => setJoin(j)} className={`h-6 flex-1 rounded capitalize ${join === j ? "bg-panel text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}>
                        {j}
                    </button>
                ))}
            </div>
            {join === "miter" && (
                <>
                    <label className="mt-3 mb-1 block text-ink-muted" htmlFor="offset-limit">
                        Miter limit
                    </label>
                    <input id="offset-limit" value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" className={field} />
                </>
            )}
        </Shell>
    );
}

function SimplifyDialog() {
    // The file before the dialog, so the preview and Cancel start from it.
    const [base] = useState(() => editor.get().doc);
    const [tolerance, setTolerance] = useState(1);
    const count = (doc: typeof base) => pathTargets(base).reduce((n, node) => {
        const now = doc.nodes[node.id] ?? node;
        return n + pointCount(now.type === "vector" ? placedSubpaths(now) : shapeSubpaths(now));
    }, 0);
    const preview = useMemo(() => simplifyCommands(tolerance, base).reduce((doc, c) => applyCommand(doc, c), base), [tolerance, base]);
    useEffect(() => editor.preview(preview), [preview]);
    const before = count(base);
    const after = count(preview);
    const cancel = () => {
        editor.preview(base);
        closePathDialog();
    };
    const apply = () => {
        editor.preview(base);
        const commands: Command[] = simplifyCommands(tolerance, base);
        if (commands.length) editor.execute({ type: "batch", commands });
        closePathDialog();
    };
    return (
        <Shell title="Simplify path" onSubmit={apply} onCancel={cancel} submit="Simplify">
            <div className="mb-1 flex items-center justify-between text-ink-muted">
                <label htmlFor="simplify-tolerance">Tolerance</label>
                <span>{tolerance.toFixed(1)} px</span>
            </div>
            <input id="simplify-tolerance" type="range" min={0.1} max={20} step={0.1} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} className="w-full accent-brand-500" />
            <p className="mt-2 text-ink-muted">
                {before} points → {after} points
            </p>
        </Shell>
    );
}
