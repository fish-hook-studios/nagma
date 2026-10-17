import { ChevronDown, ChevronRight, Edit05, LayoutGrid01, LinkBroken01, List, Plus, SearchSm } from "@untitledui/icons";
import { useMemo, useState } from "react";
import {
    Button as AriaButton,
    Dialog as AriaDialog,
    DialogTrigger as AriaDialogTrigger,
    Menu as AriaMenu,
    MenuTrigger as AriaMenuTrigger,
    Modal as AriaModal,
    ModalOverlay as AriaModalOverlay,
    Popover as AriaPopover,
} from "react-aria-components";
import { applyTextStyle, createTextStyle, detachTextStyle, stylesOf, textStyleFrom, updateTextStyle } from "../engine/styles";
import { editor, useEditor } from "../engine/store";
import { openTextStyleEditor, setTextStyleRequest as setRequest, useTextStyleRequest as useRequest } from "../engine/text-style-editor";
import { AUTO_LINE_HEIGHT, ensureFont } from "../engine/text";
import type { SceneNode, TextStyle } from "../engine/types";
import { MenuRow } from "./left-sidebar";
import { NumberField } from "./number-field";
import { FontPicker, Segmented, Toggle, WeightSelect } from "./type-controls";
import { FIELD, SIZE_PRESETS, styleLabel } from "./type-shared";
import { Select } from "./select";
import { DescriptionField } from "./rich-description";

// Text styles: a picker with search, slash folders and a list or grid view; a modal to
// create or edit a style (name, description and every type property); detach and edit from the
// Typography section.

function styleMeta(style: TextStyle): string {
    const lh = style.lineHeight === null ? "Auto" : `${Math.round(style.lineHeight * style.fontSize * 10) / 10}`;
    return `${Math.round(style.fontSize * 10) / 10}/${lh}`;
}

function preview(style: Pick<TextStyle, "fontFamily" | "fontWeight" | "italic">): React.CSSProperties {
    return { fontFamily: `"${style.fontFamily}", system-ui, sans-serif`, fontWeight: style.fontWeight, fontStyle: style.italic ? "italic" : "normal" };
}

// Styles grouped by their slash path ("Heading/Large" sits in the Heading folder).
function groupStyles(styles: TextStyle[]): { folder: string; styles: TextStyle[] }[] {
    const groups = new Map<string, TextStyle[]>();
    for (const s of styles) {
        const parts = s.name.split("/").map((p) => p.trim());
        const folder = parts.length > 1 ? parts.slice(0, -1).join(" / ") : "";
        groups.set(folder, [...(groups.get(folder) ?? []), s]);
    }
    return [...groups.entries()].map(([folder, list]) => ({ folder, styles: list }));
}

const leafName = (name: string) => name.split("/").pop()?.trim() || name;

// The picker opened from Typography's style button.
export function TextStylePicker({ nodes }: { nodes: SceneNode[] }) {
    const styles = useEditor((s) => stylesOf(s.doc).texts);
    const [query, setQuery] = useState("");
    const [view, setView] = useState<"list" | "grid">("list");
    const [closed, setClosed] = useState<Set<string>>(new Set());
    const q = query.trim().toLowerCase();
    const shown = useMemo(() => styles.filter((s) => !q || s.name.toLowerCase().includes(q)), [styles, q]);
    const groups = groupStyles(shown);
    const current = nodes.every((n) => n.textStyleId && n.textStyleId === nodes[0]?.textStyleId) ? nodes[0]?.textStyleId : null;
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label="Text styles" className="flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                <LayoutGrid01 className="size-3.5" />
            </AriaButton>
            <AriaPopover placement="left top" offset={8} className="w-64 rounded-lg border border-panel-border bg-panel-raised text-ink shadow-xl outline-none">
                <AriaDialog className="outline-none" aria-label="Text styles">
                    {({ close }) => (
                        <div onKeyDown={(e) => e.stopPropagation()}>
                            <div className="flex h-9 items-center justify-between border-b border-panel-border pl-3 pr-1.5">
                                <span className="font-semibold">Text styles</span>
                                <div className="flex items-center">
                                    <button type="button" aria-label={view === "list" ? "Show as grid" : "Show as list"} title={view === "list" ? "Show as grid" : "Show as list"} onClick={() => setView(view === "list" ? "grid" : "list")} className="flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                                        {view === "list" ? <LayoutGrid01 className="size-3.5" /> : <List className="size-3.5" />}
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="Create text style"
                                        title="Create text style"
                                        onClick={() => {
                                            close();
                                            openTextStyleEditor({ mode: "create", nodeIds: nodes.map((n) => n.id) });
                                        }}
                                        className="flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink"
                                    >
                                        <Plus className="size-3.5" />
                                    </button>
                                </div>
                            </div>
                            <label className="flex h-8 items-center gap-2 border-b border-panel-border px-3 text-ink-muted">
                                <SearchSm className="size-3.5" />
                                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search text styles" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-subtle" />
                            </label>
                            <div className="max-h-80 overflow-y-auto p-1">
                                {!styles.length && <p className="px-2 py-3 text-ink-muted">No text styles in this file yet. Use + to make one from the selection.</p>}
                                {styles.length > 0 && !shown.length && <p className="px-2 py-3 text-ink-muted">No styles match.</p>}
                                {groups.map(({ folder, styles: list }) => {
                                    const open = !closed.has(folder) || Boolean(q);
                                    return (
                                        <div key={folder || "_"}>
                                            {folder && (
                                                <button
                                                    type="button"
                                                    onClick={() => setClosed((c) => {
                                                        const next = new Set(c);
                                                        if (next.has(folder)) next.delete(folder);
                                                        else next.add(folder);
                                                        return next;
                                                    })}
                                                    className="flex h-6 w-full items-center gap-1 rounded-md px-1 text-left text-ink-muted hover:text-ink"
                                                >
                                                    {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                                                    {folder}
                                                </button>
                                            )}
                                            {open && (
                                                <div className={view === "grid" ? "grid grid-cols-4 gap-1 p-1" : ""}>
                                                    {list.map((s) =>
                                                        view === "grid" ? (
                                                            <button
                                                                key={s.id}
                                                                type="button"
                                                                title={`${s.name}${s.description ? `\n${s.description}` : ""}`}
                                                                onClick={() => {
                                                                    applyTextStyle(nodes.map((n) => n.id), s.id);
                                                                    close();
                                                                }}
                                                                className={`flex aspect-square items-center justify-center rounded-md border text-[16px] hover:border-brand-500 ${current === s.id ? "border-brand-500" : "border-panel-border"}`}
                                                                style={preview(s)}
                                                            >
                                                                Ag
                                                            </button>
                                                        ) : (
                                                            <div key={s.id} className={`group flex h-8 items-center rounded-md hover:bg-panel-hover ${current === s.id ? "bg-panel-hover" : ""}`}>
                                                                <button
                                                                    type="button"
                                                                    title={s.description || s.name}
                                                                    onClick={() => {
                                                                        applyTextStyle(nodes.map((n) => n.id), s.id);
                                                                        close();
                                                                    }}
                                                                    className={`flex h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left ${folder ? "pl-5" : ""}`}
                                                                >
                                                                    <span className="w-6 shrink-0 text-[13px]" style={preview(s)}>
                                                                        Ag
                                                                    </span>
                                                                    <span className="truncate">{leafName(s.name)}</span>
                                                                    <span className="ml-auto shrink-0 text-ink-subtle">{styleMeta(s)}</span>
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    aria-label={`Edit ${s.name}`}
                                                                    title="Edit style"
                                                                    onClick={() => {
                                                                        close();
                                                                        openTextStyleEditor({ mode: "edit", styleId: s.id });
                                                                    }}
                                                                    className="mr-1 hidden size-6 items-center justify-center rounded-md text-ink-muted hover:text-ink group-hover:flex"
                                                                >
                                                                    <Edit05 className="size-3.5" />
                                                                </button>
                                                            </div>
                                                        ),
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

// Typography's style row: the applied style, edit on click, detach on the button.
export function TextStyleRow({ nodes, style }: { nodes: SceneNode[]; style: TextStyle }) {
    return (
        <div className="flex h-6 items-center gap-1">
            <button type="button" title={style.description || "Edit style"} onClick={() => openTextStyleEditor({ mode: "edit", styleId: style.id })} className="flex h-6 min-w-0 flex-1 items-center gap-2 rounded-md bg-field px-2 text-left hover:bg-panel-hover">
                <span className="text-[13px]" style={preview(style)}>
                    Ag
                </span>
                <span className="truncate">{style.name}</span>
                <span className="ml-auto shrink-0 text-ink-subtle">{styleMeta(style)}</span>
            </button>
            <button type="button" aria-label="Detach style" title="Detach style" onClick={() => detachTextStyle(nodes.map((n) => n.id))} className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                <LinkBroken01 className="size-3.5" />
            </button>
        </div>
    );
}

// The create and edit modal. Editing applies as you go (every layer using the style follows);
// creating makes the style when you press Create style.
export function TextStyleEditorHost() {
    const req = useRequest();
    const doc = useEditor((s) => s.doc);
    if (!req) return null;
    if (req.mode === "edit") {
        const style = stylesOf(doc).texts.find((t) => t.id === req.styleId);
        if (!style) return null;
        return <StyleModal key={style.id} title="Edit text style" initial={style} onChange={(patch) => updateTextStyle(style.id, patch)} onClose={() => setRequest(null)} />;
    }
    const from = req.nodeIds.map((id) => doc.nodes[id]).find((n): n is SceneNode => Boolean(n));
    const initial = from ? textStyleFrom(from, "") : textStyleFrom({ fontFamily: "Inter", fontSize: 16, fontWeight: 400 } as SceneNode, "");
    return (
        <StyleModal
            key={req.nodeIds.join(",")}
            title="Create new text style"
            initial={{ ...initial, name: "" }}
            create
            onClose={() => setRequest(null)}
            onCreate={(draft) => {
                if (from) createTextStyle(draft.name, from, req.nodeIds, draft);
                else {
                    const { styles } = editor.get().doc;
                    editor.execute({ type: "styles.set", styles: { colors: styles?.colors ?? [], effects: styles?.effects, texts: [...(styles?.texts ?? []), { ...draft, name: draft.name.trim() || "Text" }] } });
                }
                setRequest(null);
            }}
        />
    );
}

function StyleModal({ title, initial, create, onChange, onCreate, onClose }: { title: string; initial: TextStyle; create?: boolean; onChange?: (patch: Partial<TextStyle>) => void; onCreate?: (draft: TextStyle) => void; onClose: () => void }) {
    const [draft, setDraft] = useState<TextStyle>(initial);
    const set = (patch: Partial<TextStyle>) => {
        setDraft((d) => ({ ...d, ...patch }));
        if (!create) onChange?.(patch);
    };
    const row = (label: string, control: React.ReactNode) => (
        <div className="grid grid-cols-[110px_1fr] items-center gap-2">
            <span className="text-ink-muted">{label}</span>
            {control}
        </div>
    );
    return (
        <AriaModalOverlay isOpen onOpenChange={(o) => !o && onClose()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-20">
            <AriaModal className="w-[400px] rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                <AriaDialog className="outline-none" aria-label={title}>
                    <form
                        onKeyDown={(e) => e.stopPropagation()}
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (create) onCreate?.(draft);
                            else onClose();
                        }}
                    >
                        <div className="flex h-11 items-center justify-between border-b border-panel-border px-4">
                            <h2 className="text-[12px] font-semibold">{title}</h2>
                            <button type="button" onClick={onClose} aria-label="Close" className="flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                                ×
                            </button>
                        </div>
                        <div className="space-y-2 p-4">
                            <div className="rounded-md bg-field px-3 py-4 text-ink" style={{ ...preview(draft), fontSize: Math.min(40, draft.fontSize), lineHeight: draft.lineHeight === null ? "normal" : draft.lineHeight, letterSpacing: `${draft.letterSpacing / 100}em`, textDecoration: draft.decoration === "underline" ? "underline" : draft.decoration === "strikethrough" ? "line-through" : "none", textTransform: draft.textCase === "upper" ? "uppercase" : draft.textCase === "lower" ? "lowercase" : draft.textCase === "title" ? "capitalize" : "none", fontVariant: draft.textCase === "small-caps" ? "small-caps" : "normal" }}>
                                {leafName(draft.name) || "The quick brown fox"}
                            </div>
                            <input
                                autoFocus
                                aria-label="Name"
                                placeholder="Name"
                                value={draft.name}
                                onChange={(e) => set({ name: e.target.value })}
                                className="h-8 w-full rounded-md border border-panel-border bg-field px-2 text-ink outline-none focus:border-brand-500"
                            />
                            <DescriptionField value={draft} onChange={(patch) => set(patch)} />
                            <div className="pt-1 font-semibold">Properties</div>
                            <FontPicker
                                family={draft.fontFamily}
                                onPick={(fontFamily) => {
                                    ensureFont(fontFamily, () => editor.refreshText());
                                    set({ fontFamily });
                                }}
                            />
                            <div className="grid grid-cols-2 gap-1.5">
                                <WeightSelect weight={draft.fontWeight} italic={draft.italic} family={draft.fontFamily} onChange={(fontWeight, italic) => set({ fontWeight, italic })} />
                                <div className="flex items-center gap-0.5">
                                    <NumberField label="" title="Font size" min={1} value={draft.fontSize} onCommit={(fontSize) => set({ fontSize })} />
                                    <AriaMenuTrigger>
                                        <AriaButton aria-label="Font size presets" className="flex h-6 w-4 shrink-0 items-center justify-center rounded text-ink-subtle outline-none hover:text-ink">
                                            <ChevronDown className="size-3" />
                                        </AriaButton>
                                        <AriaPopover placement="bottom end" className="max-h-72 w-24 overflow-y-auto rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                                            <AriaMenu className="outline-none" onAction={(k) => set({ fontSize: Number(k) })}>
                                                {SIZE_PRESETS.map((n) => (
                                                    <MenuRow key={n} id={String(n)} label={String(n)} checked={draft.fontSize === n} />
                                                ))}
                                            </AriaMenu>
                                        </AriaPopover>
                                    </AriaMenuTrigger>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                                {draft.lineHeight === null ? (
                                    <button type="button" onClick={() => set({ lineHeight: AUTO_LINE_HEIGHT })} className="h-6 rounded-md bg-field px-2 text-left text-ink-muted hover:text-ink" title="Line height is automatic. Click to set a value.">
                                        Line height Auto
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-0.5">
                                        <NumberField label="↕" title="Line height (%)" min={1} value={Math.round(draft.lineHeight * 100)} onCommit={(v) => set({ lineHeight: v / 100 })} suffix="%" />
                                        <button type="button" onClick={() => set({ lineHeight: null })} className="h-6 shrink-0 rounded px-1 text-[10px] text-ink-subtle hover:text-ink">
                                            Auto
                                        </button>
                                    </div>
                                )}
                                <NumberField label="|A|" title="Letter spacing (%)" value={draft.letterSpacing} onCommit={(letterSpacing) => set({ letterSpacing })} suffix="%" />
                            </div>
                            {row("Paragraph spacing", <NumberField label="¶" title="Paragraph spacing" min={0} value={draft.paragraphSpacing ?? 0} onCommit={(paragraphSpacing) => set({ paragraphSpacing })} />)}
                            {row("Paragraph indent", <NumberField label="→" title="Paragraph indent" min={0} value={draft.paragraphIndent ?? 0} onCommit={(paragraphIndent) => set({ paragraphIndent })} />)}
                            {row("List spacing", <NumberField label="≡" title="List spacing" min={0} value={draft.listSpacing ?? 0} onCommit={(listSpacing) => set({ listSpacing })} />)}
                            {row("Hanging lists", <Toggle label="Hanging lists" checked={Boolean(draft.hangingList)} onChange={(hangingList) => set({ hangingList })} />)}
                            {row("Hanging punctuation", <Toggle label="Hanging punctuation" checked={Boolean(draft.hangingPunctuation)} onChange={(hangingPunctuation) => set({ hangingPunctuation })} />)}
                            {row(
                                "Vertical trim",
                                <Segmented
                                    value={draft.leadingTrim ?? "none"}
                                    options={[
                                        { id: "none", label: "Standard" },
                                        { id: "cap", label: "Cap height" },
                                    ]}
                                    onChange={(leadingTrim) => set({ leadingTrim })}
                                />,
                            )}
                            {row(
                                "Decoration",
                                <Segmented
                                    value={draft.decoration ?? "none"}
                                    options={[
                                        { id: "none", label: "None" },
                                        { id: "underline", label: "Underline" },
                                        { id: "strikethrough", label: "Strikethrough" },
                                    ]}
                                    onChange={(decoration) => set({ decoration })}
                                />,
                            )}
                            {row(
                                "Letter case",
                                <Select aria-label="Letter case" value={draft.textCase ?? "none"} onChange={(e) => set({ textCase: e.target.value as TextStyle["textCase"] })} className={FIELD}>
                                    <option value="none">As typed</option>
                                    <option value="upper">Uppercase</option>
                                    <option value="lower">Lowercase</option>
                                    <option value="title">Title case</option>
                                    <option value="small-caps">Small caps</option>
                                </Select>,
                            )}
                            <p className="text-ink-subtle">{styleLabel(draft.fontWeight, draft.italic)} · {styleMeta(draft)}</p>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-panel-border px-4 py-3">
                            {create ? (
                                <>
                                    <button type="button" onClick={onClose} className="h-8 rounded-md px-3 text-ink-muted hover:bg-panel-hover hover:text-ink">
                                        Cancel
                                    </button>
                                    <button type="submit" className="h-8 rounded-md bg-brand-500 px-3 font-semibold text-white hover:bg-brand-600">
                                        Create style
                                    </button>
                                </>
                            ) : (
                                <button type="submit" className="h-8 rounded-md bg-brand-500 px-3 font-semibold text-white hover:bg-brand-600">
                                    Done
                                </button>
                            )}
                        </div>
                    </form>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}
