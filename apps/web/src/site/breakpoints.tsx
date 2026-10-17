import { Plus, Trash01 } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { editor, useEditor } from "../engine/store";
import type { Command } from "../engine/types";
import { addBreakpointCommands, arrangeBreakpointsCommands, BREAKPOINT_PRESETS, breakpointOf, breakpointsOf, deleteBreakpointCommand, PRIMARY_BP, rangeLabel, updateBreakpointCommand } from "./model";
import { site, useSite } from "./state";
import type { BreakpointId } from "./types";

// Adding, editing and deleting a page's breakpoints. The "+" in the webpage container's header (and
// "Add breakpoint" in the page settings) opens a menu of preset widths or a custom width; a new
// breakpoint starts as a copy of the next wider one. Every breakpoint other than the smallest is
// used from its own start width up to where the next wider one starts; the smallest covers
// everything narrower, so ranges adjust themselves as breakpoints come and go.

const INPUT = "h-7 w-full min-w-0 rounded-[5px] border border-transparent bg-field px-2 text-[11px] text-ink outline-none hover:border-panel-border focus:border-brand-500";

function arrange(pageId: string) {
    const moves = arrangeBreakpointsCommands(editor.get().doc, pageId);
    if (!moves.length) return;
    editor.execute({ type: "batch", commands: moves });
    editor.mergeLast();
}

function addBreakpoint(pageId: string, spec: { label: string; width: number; min: number }): boolean {
    const result = addBreakpointCommands(editor.get().doc, pageId, spec);
    if ("error" in result) {
        editor.notify(result.error);
        return false;
    }
    editor.execute({ type: "batch", commands: result.commands });
    arrange(pageId);
    const frame = breakpointsOf(editor.get().doc, pageId).find((b) => b.id === result.bp);
    if (frame?.frameId) editor.set({ selection: [frame.frameId] });
    return true;
}

// False when nothing changed (the value was refused, or the same).
function editBreakpoint(pageId: string, bp: BreakpointId, patch: { label?: string; width?: number; min?: number }): boolean {
    const command = updateBreakpointCommand(editor.get().doc, pageId, bp, patch);
    if (!command) return false;
    if ("error" in command) {
        editor.notify(command.error);
        return false;
    }
    editor.execute(command as Command);
    if (patch.width !== undefined) arrange(pageId);
    return true;
}

// A field that edits a breakpoint then shows what the breakpoint has (the refused value of an
// empty name or an out-of-range start is put back; a clamped width shows as clamped).
function commit(input: HTMLInputElement, pageId: string, bp: BreakpointId, field: "label" | "width" | "min", edit: () => boolean) {
    const before = breakpointOf(editor.get().doc, pageId, bp);
    if (input.value.trim() && input.value.trim() !== String(before?.[field])) edit();
    const now = breakpointOf(editor.get().doc, pageId, bp);
    if (now) input.value = String(now[field]);
}

function deleteBreakpoint(pageId: string, bp: BreakpointId) {
    const command = deleteBreakpointCommand(editor.get().doc, pageId, bp);
    if (!command) return;
    if (site.get().view === bp) site.set({ view: "all" });
    editor.execute(command);
    arrange(pageId);
}

// The three standard breakpoints (the ones the page has already are dimmed), then Custom… (a name and
// a width, with more preset widths to pick from).
const STANDARD: { label: string; width: number; min: number; icon: "desktop" | "tablet" | "mobile" }[] = [
    { label: "Desktop", width: 1280, min: 1024, icon: "desktop" },
    { label: "Tablet", width: 800, min: 800, icon: "tablet" },
    { label: "Mobile", width: 375, min: 375, icon: "mobile" },
];

function DeviceIcon({ kind }: { kind: "desktop" | "tablet" | "mobile" | "custom" }) {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            {kind === "desktop" && <path d="M2 3.5h12v8H2zM6 14h4M8 11.5V14" strokeLinejoin="round" />}
            {kind === "tablet" && <><rect x="3.5" y="1.5" width="9" height="13" rx="1.2" /><path d="M8 12.2v.1" strokeLinecap="round" /></>}
            {kind === "mobile" && <><rect x="5" y="1.5" width="6" height="13" rx="1.4" /><path d="M7.4 3.3h1.2" strokeLinecap="round" /></>}
            {kind === "custom" && <path d="M5 1.5v13M11 1.5v13M1.5 5h13M1.5 11h13" strokeLinecap="round" />}
        </svg>
    );
}

function AddForm({ pageId, onDone, menu }: { pageId: string; onDone: () => void; menu?: boolean }) {
    const doc = useEditor((s) => s.doc);
    const list = breakpointsOf(doc, pageId);
    const primary = list[0];
    const [custom, setCustom] = useState(false);
    const [label, setLabel] = useState("Custom");
    const [width, setWidth] = useState(600);
    const has = (p: { label: string; min: number }) => list.some((b) => b.label === p.label || (b.id !== PRIMARY_BP && b.start === p.min));
    const fits = (p: { min: number }) => !primary || p.min < primary.min;
    const extra = BREAKPOINT_PRESETS.filter((p) => !STANDARD.some((d) => d.label === p.label) && fits(p) && !has(p));
    const row = "flex h-6 w-full items-center gap-2 rounded-[5px] px-2 text-left outline-none disabled:opacity-40 enabled:hover:bg-brand-500";
    return (
        <div className={menu ? "" : "space-y-1"}>
            {!custom &&
                STANDARD.map((p) => {
                    const taken = has(p) || !fits(p);
                    return (
                        <button key={p.label} type="button" disabled={taken} className={row} onClick={() => addBreakpoint(pageId, p) && onDone()}>
                            <DeviceIcon kind={p.icon} />
                            <span className="flex-1">{p.label}</span>
                            <span className="opacity-60">{p.width}</span>
                        </button>
                    );
                })}
            {!custom && (
                <button type="button" className={row} onClick={() => setCustom(true)}>
                    <DeviceIcon kind="custom" />
                    <span className="flex-1">Custom…</span>
                </button>
            )}
            {custom && (
                <form
                    className="space-y-1.5 p-1"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (addBreakpoint(pageId, { label: label || "Custom", width, min: width })) onDone();
                    }}
                >
                    <label className="flex items-center gap-2">
                        <span className="w-12 opacity-70">Name</span>
                        <input autoFocus aria-label="Breakpoint name" value={label} onChange={(e) => setLabel(e.target.value)} className="h-7 min-w-0 flex-1 rounded-[5px] bg-white/10 px-2 outline-none" />
                    </label>
                    <label className="flex items-center gap-2">
                        <span className="w-12 opacity-70">Width</span>
                        <input type="number" aria-label="Breakpoint width" min={120} max={(primary?.min ?? 4000) - 1} value={width} onChange={(e) => setWidth(Number(e.target.value))} className="h-7 min-w-0 flex-1 rounded-[5px] bg-white/10 px-2 outline-none" />
                    </label>
                    {extra.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {extra.map((p) => (
                                <button key={p.label} type="button" onClick={() => (setLabel(p.label), setWidth(p.width))} className="h-6 rounded-[5px] bg-white/10 px-2 hover:bg-white/15">
                                    {p.label} {p.width}
                                </button>
                            ))}
                        </div>
                    )}
                    <button type="submit" className="h-7 w-full rounded-[5px] bg-brand-500 font-semibold text-white hover:brightness-110">
                        Add breakpoint
                    </button>
                </form>
            )}
        </div>
    );
}

// The menu the page header's "+" opens, under it: 141 wide, Desktop / Tablet / Mobile / Custom….
export function AddBreakpointMenu() {
    const at = useSite((s) => s.bpMenu);
    const pageId = useEditor((s) => s.pageId);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!at) return;
        const close = (e: PointerEvent) => {
            if (!ref.current?.contains(e.target as Node)) site.set({ bpMenu: null });
        };
        const key = (e: KeyboardEvent) => e.key === "Escape" && site.set({ bpMenu: null });
        window.addEventListener("pointerdown", close, true);
        window.addEventListener("keydown", key);
        return () => {
            window.removeEventListener("pointerdown", close, true);
            window.removeEventListener("keydown", key);
        };
    }, [at]);
    if (!at) return null;
    return <MenuBody key={`${at.x},${at.y}`} at={at} pageId={pageId} boxRef={ref} />;
}

function MenuBody({ at, pageId, boxRef: ref }: { at: { x: number; y: number }; pageId: string; boxRef: React.RefObject<HTMLDivElement | null> }) {
    const [wide, setWide] = useState(false);
    const width = wide ? 224 : 141;
    return (
        <div ref={ref} role="dialog" aria-label="Add breakpoint" onClickCapture={(e) => (e.target as HTMLElement).closest("button")?.textContent?.startsWith("Custom") && setWide(true)} className="absolute z-30 rounded-[13px] bg-[#1E1E1E] p-[7px] text-[11px] text-white shadow-xl" style={{ width, left: Math.max(8, at.x - width + 16), top: at.y }}>
            <AddForm menu pageId={pageId} onDone={() => site.set({ bpMenu: null })} />
        </div>
    );
}

// The page settings' Breakpoints section: each breakpoint's name, frame width and range.
export function BreakpointsEditor({ pageId }: { pageId: string }) {
    const doc = useEditor((s) => s.doc);
    const readOnly = useEditor((s) => s.readOnly);
    const [adding, setAdding] = useState(false);
    const list = breakpointsOf(doc, pageId);
    return (
        <div className="space-y-2">
            {list.map((b) => (
                <div key={b.id} className="space-y-1 rounded-[6px] border border-panel-border p-1.5">
                    <div className="flex items-center gap-1">
                        <input key={b.label} aria-label="Breakpoint name" defaultValue={b.label} className={INPUT} onBlur={(e) => commit(e.target, pageId, b.id, "label", () => editBreakpoint(pageId, b.id, { label: e.target.value.trim() }))} />
                        {b.id === PRIMARY_BP ? (
                            <span className="shrink-0 rounded-[4px] bg-brand-500 px-1.5 py-px text-[10px] font-semibold text-white">Primary</span>
                        ) : (
                            <button type="button" aria-label={`Delete ${b.label}`} disabled={readOnly} className="flex size-7 shrink-0 items-center justify-center rounded-[5px] text-ink-muted hover:bg-panel-hover hover:text-ink" onClick={() => deleteBreakpoint(pageId, b.id)}>
                                <Trash01 className="size-3.5" />
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        <label className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-[5px] bg-field px-2" title="Frame width">
                            <span className="text-ink-subtle">W</span>
                            <input key={b.width} type="number" aria-label={`${b.label} frame width`} defaultValue={b.width} className="w-full min-w-0 bg-transparent outline-none" onBlur={(e) => commit(e.target, pageId, b.id, "width", () => editBreakpoint(pageId, b.id, { width: Number(e.target.value) }))} />
                        </label>
                        <label className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-[5px] bg-field px-2" title="Used from this window width">
                            <span className="text-ink-subtle">Min</span>
                            <input key={`${b.min}`} type="number" aria-label={`${b.label} minimum width`} defaultValue={b.min} disabled={b.min === 0 && b.id !== PRIMARY_BP && list[list.length - 1]?.id === b.id} className="w-full min-w-0 bg-transparent outline-none disabled:opacity-60" onBlur={(e) => commit(e.target, pageId, b.id, "min", () => editBreakpoint(pageId, b.id, { min: Number(e.target.value) }))} />
                        </label>
                    </div>
                    <div className="px-0.5 text-ink-muted">{b.max === null ? `Used for windows ${b.min} wide and wider` : `Used for windows ${rangeLabel(b)} wide`}</div>
                </div>
            ))}
            {!readOnly && !adding && (
                <button type="button" className="flex h-7 w-full items-center justify-center gap-1 rounded-[5px] border border-panel-border hover:bg-panel-hover" onClick={() => setAdding(true)}>
                    <Plus className="size-3.5" /> Add breakpoint
                </button>
            )}
            {adding && (
                <div className="rounded-[6px] bg-tooltip p-1 text-white">
                    <AddForm pageId={pageId} onDone={() => setAdding(false)} />
                    <button type="button" className="mt-1 h-7 w-full rounded-[5px] hover:bg-white/10" onClick={() => setAdding(false)}>
                        Cancel
                    </button>
                </div>
            )}
            <p className="leading-4 text-ink-muted">Changes on a breakpoint reach the narrower ones unless they change the same thing.</p>
        </div>
    );
}
