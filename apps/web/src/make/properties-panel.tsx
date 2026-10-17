import { X } from "@untitledui/icons";
import { useState } from "react";
import { editor, useEditor } from "../engine/store";
import { send } from "./generate";
import { makeData, writeFile } from "./model";
import { canEditStyle, canEditText, replaceText, setStyle, sourceOf, toHex } from "./point-edit";
import { postToPreview } from "./preview-bridge";
import { make, useMake, type StagedEdit } from "./state";
import type { PickedElement } from "./types";

// The edit tool's properties panel: the elements picked in the preview (⇧ click picks several), and
// their text, type, colours, spacing, corners and opacity. Changes show in the preview at once but
// stay staged until Apply writes them into the code: each as an edit to the element's own source
// (its inline style, its text), and whatever can't be written that way is sent to the model.

const INPUT = "h-7 w-full min-w-0 rounded-[5px] bg-field px-2 text-[11px] text-ink outline-none focus:ring-1 focus:ring-brand-500";

// "16px" → 16; "normal" → null.
const num = (v: string | undefined) => {
    const n = parseFloat(v ?? "");
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

function stage(picks: PickedElement[], patch: { style?: Record<string, string>; text?: string }) {
    const staged = { ...make.get().staged };
    for (const p of picks) {
        const current: StagedEdit = staged[p.src] ?? { style: {} };
        const next: StagedEdit = { ...current, style: { ...current.style, ...patch.style } };
        if (patch.text !== undefined) next.text = patch.text;
        staged[p.src] = next;
        postToPreview({ type: "stage", src: p.src, style: patch.style ?? {}, text: patch.text });
    }
    make.set({ staged });
}

// Writes the staged changes into the code. Returns what couldn't be written directly.
function applyStaged(): string[] {
    const { staged, picks } = make.get();
    const files = { ...makeData(editor.get().doc).files };
    const changed = new Set<string>();
    const left: string[] = [];
    for (const [src, edit] of Object.entries(staged)) {
        const picked = picks.find((p) => p.src === src) ?? ({ src, tag: "div", text: "", html: "", color: "", background: "", classes: "" } as PickedElement);
        const { path } = sourceOf(picked);
        let source = files[path];
        if (source === undefined) {
            left.push(`${src}: ${JSON.stringify(edit)}`);
            continue;
        }
        if (edit.text !== undefined && edit.text !== picked.text) {
            const next = canEditText(source, picked) ? replaceText(source, picked, edit.text) : null;
            if (next === null) left.push(`Set the text of <${picked.tag}> at ${src} to ${JSON.stringify(edit.text)}.`);
            else source = next;
        }
        for (const [prop, value] of Object.entries(edit.style)) {
            const next = canEditStyle(source, picked) ? setStyle(source, picked, prop, value) : null;
            if (next === null) left.push(`Set ${prop} of <${picked.tag}> at ${src} to ${value}.`);
            else source = next;
        }
        if (source !== files[path]) {
            files[path] = source;
            changed.add(path);
        }
    }
    for (const path of changed) writeFile(path, files[path] as string);
    make.set({ staged: {} });
    return left;
}

function discard() {
    make.set({ staged: {}, reload: make.get().reload + 1 });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex items-center gap-2">
            <span className="w-[68px] shrink-0 text-ink-muted">{label}</span>
            <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
        </label>
    );
}

function NumberInput({ label, value, unit = "px", onCommit }: { label: string; value: number | null; unit?: string; onCommit: (v: number) => void }) {
    return (
        <span className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-[5px] bg-field px-2">
            <input
                key={String(value)}
                type="number"
                aria-label={label}
                defaultValue={value ?? ""}
                className="w-full min-w-0 bg-transparent text-[11px] text-ink outline-none"
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (e.target.value !== "" && Number.isFinite(v) && v !== value) onCommit(v);
                }}
            />
            {unit && <span className="text-ink-subtle">{unit}</span>}
        </span>
    );
}

function Colour({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
    return (
        <span className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[5px] bg-field px-1.5">
            <input type="color" aria-label={label} value={toHex(value)} onChange={(e) => onCommit(e.target.value)} className="size-4 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
            <span className="truncate font-mono text-[10.5px] text-ink-muted">{/^rgba\(.*,\s*0\)$/.test(value) ? "None" : toHex(value)}</span>
        </span>
    );
}

export function PropertiesPanel() {
    const picks = useMake((s) => s.picks);
    const staged = useMake((s) => s.staged);
    const readOnly = useEditor((s) => s.readOnly);
    const ai = useMake((s) => s.ai);
    const [note, setNote] = useState<string | null>(null);
    const first = picks[0];
    if (!first) return null;
    const pending = Object.keys(staged).length;
    // What the panel shows: the first element's computed style with its staged changes on top.
    const style = { ...(first.style ?? {}), ...(staged[first.src]?.style ?? {}) };
    const text = staged[first.src]?.text ?? first.text;
    const set = (prop: string, value: string) => stage(picks, { style: { [prop]: value } });
    const apply = () => {
        const left = applyStaged();
        if (!left.length) return setNote("Applied to the code.");
        if (ai?.available) {
            make.set({ prompt: `Make these changes in the code:\n${left.join("\n")}` });
            void send();
            setNote("Some changes need the model; it's applying them now.");
        } else setNote(`${left.length} ${left.length === 1 ? "change" : "changes"} couldn't be written into the code directly.`);
    };
    return (
        <aside aria-label="Properties" className="flex h-full w-64 shrink-0 flex-col border-l border-panel-border bg-panel text-[11px]">
            <header className="flex h-10 shrink-0 items-center gap-1.5 border-b border-panel-border px-3">
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">{picks.length > 1 ? `${picks.length} elements` : `<${first.tag}>`}</span>
                <button type="button" aria-label="Clear the selection" onClick={() => make.set({ picked: null, picks: [] })} className="flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <X className="size-3.5" />
                </button>
            </header>
            <fieldset disabled={readOnly} className="m-0 min-h-0 flex-1 space-y-4 overflow-y-auto border-0 p-3">
                <div className="truncate font-mono text-[10.5px] text-ink-subtle" title={picks.map((p) => p.src).join(", ")}>
                    {picks.map((p) => p.src).join(", ")}
                </div>
                {picks.length === 1 && first.text && (
                    <section className="space-y-1.5">
                        <h3 className="font-semibold text-ink">Text</h3>
                        <textarea
                            key={`${first.src}${text}`}
                            aria-label="Text"
                            defaultValue={text}
                            rows={2}
                            className={`${INPUT} h-auto py-1.5`}
                            onKeyDown={(e) => e.stopPropagation()}
                            onBlur={(e) => e.target.value !== text && stage(picks, { text: e.target.value })}
                        />
                    </section>
                )}
                <section className="space-y-1.5">
                    <h3 className="font-semibold text-ink">Typography</h3>
                    <Field label="Size">
                        <NumberInput label="Font size" value={num(style.fontSize)} onCommit={(v) => set("fontSize", `${v}px`)} />
                    </Field>
                    <Field label="Weight">
                        <select aria-label="Font weight" value={String(Math.round((num(style.fontWeight) ?? 400) / 100) * 100)} onChange={(e) => set("fontWeight", e.target.value)} className={INPUT}>
                            {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => (
                                <option key={w} value={w}>
                                    {w}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Line height">
                        <NumberInput label="Line height" value={num(style.lineHeight)} onCommit={(v) => set("lineHeight", `${v}px`)} />
                    </Field>
                    <Field label="Align">
                        <select aria-label="Text alignment" value={["left", "center", "right", "justify"].includes(style.textAlign ?? "") ? style.textAlign : "left"} onChange={(e) => set("textAlign", e.target.value)} className={INPUT}>
                            <option value="left">Left</option>
                            <option value="center">Centre</option>
                            <option value="right">Right</option>
                            <option value="justify">Justify</option>
                        </select>
                    </Field>
                </section>
                <section className="space-y-1.5">
                    <h3 className="font-semibold text-ink">Colour</h3>
                    <Field label="Text">
                        <Colour label="Text colour" value={style.color ?? first.color} onCommit={(v) => set("color", v)} />
                    </Field>
                    <Field label="Fill">
                        <Colour label="Fill colour" value={style.backgroundColor ?? first.background} onCommit={(v) => set("backgroundColor", v)} />
                    </Field>
                </section>
                <section className="space-y-1.5">
                    <h3 className="font-semibold text-ink">Spacing</h3>
                    <Field label="Padding">
                        <NumberInput label="Padding top and bottom" value={num(style.paddingTop)} onCommit={(v) => stage(picks, { style: { paddingTop: `${v}px`, paddingBottom: `${v}px` } })} />
                        <NumberInput label="Padding left and right" value={num(style.paddingLeft)} onCommit={(v) => stage(picks, { style: { paddingLeft: `${v}px`, paddingRight: `${v}px` } })} />
                    </Field>
                    <Field label="Margin">
                        <NumberInput label="Margin top and bottom" value={num(style.marginTop)} onCommit={(v) => stage(picks, { style: { marginTop: `${v}px`, marginBottom: `${v}px` } })} />
                        <NumberInput label="Margin left and right" value={num(style.marginLeft)} onCommit={(v) => stage(picks, { style: { marginLeft: `${v}px`, marginRight: `${v}px` } })} />
                    </Field>
                    <Field label="Gap">
                        <NumberInput label="Gap" value={num(style.gap)} onCommit={(v) => set("gap", `${v}px`)} />
                    </Field>
                </section>
                <section className="space-y-1.5">
                    <h3 className="font-semibold text-ink">Appearance</h3>
                    <Field label="Corners">
                        <NumberInput label="Corner radius" value={num(style.borderRadius)} onCommit={(v) => set("borderRadius", `${v}px`)} />
                    </Field>
                    <Field label="Opacity">
                        <NumberInput label="Opacity" value={Math.round((num(style.opacity) ?? 1) * 100)} unit="%" onCommit={(v) => set("opacity", String(Math.max(0, Math.min(100, v)) / 100))} />
                    </Field>
                </section>
                {note && <p className="leading-4 text-ink-muted">{note}</p>}
            </fieldset>
            <footer className="flex shrink-0 items-center gap-2 border-t border-panel-border p-3">
                <span className="flex-1 text-ink-muted">{pending ? `${pending} staged` : "No changes"}</span>
                <button type="button" disabled={!pending || readOnly} onClick={discard} className="h-7 rounded-md border border-panel-border px-2.5 text-ink hover:bg-panel-hover disabled:opacity-40">
                    Discard
                </button>
                <button type="button" disabled={!pending || readOnly} onClick={apply} className="h-7 rounded-md bg-brand-500 px-3 font-semibold text-white disabled:opacity-40">
                    Apply
                </button>
            </footer>
        </aside>
    );
}
