import { setHiddenFromPublishing } from "../engine/library";
import { ChevronDown, ChevronRight, Plus } from "@untitledui/icons";
import { useState } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover } from "react-aria-components";
import { animationStyles, deleteAnimationStyle, describeTransition, duplicateAnimationStyle, updateAnimationStyle } from "../engine/animation-styles";
import { slashParts } from "../engine/asset-tree";
import { useEditor } from "../engine/store";
import { type AnyStyle, type StyleKind, deleteStyle, duplicateStyle, localStyles, reorderStyles } from "../engine/styles";
import type { TextStyle } from "../engine/types";
import { MenuRow } from "./left-sidebar";
import { Section } from "./panel-section";
import { askText } from "./ask-text";
import { PointMenu, type PointMenuItem } from "./point-menu";
import { StylePreview } from "./style-picker";
import { blankStyle, copyStyleLink, editStyle } from "./style-ui";

// The Page panel's Styles with nothing selected: "+" makes a colour, text or effect
// style; styles are listed by kind and "/" folder; click one to edit it, right-click for more, and
// drag to reorder or move between folders.

const KINDS: [StyleKind, string][] = [
    ["text", "Text styles"],
    ["color", "Colour styles"],
    ["effect", "Effect styles"],
];

type Drag = { kind: StyleKind; id: string } | null;

export function LocalStyles() {
    const doc = useEditor((s) => s.doc);
    const [menu, setMenu] = useState<{ at: { x: number; y: number }; kind: StyleKind; style: AnyStyle } | null>(null);
    const [drag, setDrag] = useState<Drag>(null);
    const lists = KINDS.map(([kind, title]) => ({ kind, title, styles: localStyles(doc, kind) }));
    const items = (kind: StyleKind, style: AnyStyle): PointMenuItem[] => [
        { id: "edit", label: "Edit style", run: () => editStyle({ kind, id: style.id }) },
        { id: "duplicate", label: "Duplicate style", run: () => duplicateStyle(kind, style.id) },
        { id: "delete", label: "Delete style", run: () => deleteStyle(kind, style.id) },
        "separator",
        style.hiddenFromPublishing
            ? { id: "show", label: "Show when publishing", run: () => setHiddenFromPublishing({ kind: "style", id: style.id }, false) }
            : { id: "hide", label: "Hide when publishing", run: () => setHiddenFromPublishing({ kind: "style", id: style.id }, true) },
        { id: "link", label: "Copy link to style", run: () => void copyStyleLink(style.id) },
    ];
    return (
        <Section
            title="Styles"
            muted={false}
            action={
                <AriaMenuTrigger>
                    <AriaButton aria-label="Create style" className="flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                        <Plus className="size-3.5" />
                    </AriaButton>
                    <AriaPopover placement="bottom end" className="w-44 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                        <AriaMenu className="outline-none" aria-label="Create style" onAction={(k) => editStyle({ kind: k as StyleKind, id: null, draft: blankStyle(k as StyleKind) })}>
                            <MenuRow id="text" label="Text style" />
                            <MenuRow id="color" label="Colour style" />
                            <MenuRow id="effect" label="Effect style" />
                        </AriaMenu>
                    </AriaPopover>
                </AriaMenuTrigger>
            }
        >
            {lists.map((l) =>
                l.styles.length ? (
                    <KindGroup
                        key={l.kind}
                        kind={l.kind}
                        title={l.title}
                        styles={l.styles}
                        drag={drag}
                        setDrag={setDrag}
                        onMenu={(e, style) => {
                            e.preventDefault();
                            setMenu({ at: { x: e.clientX, y: e.clientY }, kind: l.kind, style });
                        }}
                    />
                ) : null,
            )}
            <AnimationStyles />
            {menu && <PointMenu at={menu.at} items={items(menu.kind, menu.style)} onClose={() => setMenu(null)} label="Style actions" />}
        </Section>
    );
}

// Animation styles (made from a prototype transition's Style menu): rename, duplicate, delete.
function AnimationStyles() {
    const doc = useEditor((s) => s.doc);
    const styles = animationStyles(doc);
    const [open, setOpen] = useState(true);
    const [menu, setMenu] = useState<{ at: { x: number; y: number }; id: string } | null>(null);
    if (!styles.length) return null;
    const rename = (id: string, name: string) => void askText("Rename animation style", name, { confirm: "Rename" }).then((next) => next?.trim() && updateAnimationStyle(id, { name: next.trim() }));
    return (
        <div>
            <button type="button" onClick={() => setOpen(!open)} className="flex h-6 w-full items-center gap-1 text-left text-ink-muted hover:text-ink">
                {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                Animation styles
            </button>
            {open &&
                styles.map((s) => (
                    <div
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        title={`${s.name}\n${describeTransition(s.transition)}`}
                        onDoubleClick={() => rename(s.id, s.name)}
                        onKeyDown={(e) => e.key === "Enter" && rename(s.id, s.name)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu({ at: { x: e.clientX, y: e.clientY }, id: s.id });
                        }}
                        className="flex h-6 cursor-default items-center gap-2 rounded-md px-1 hover:bg-panel-hover"
                    >
                        <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-ink-muted" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                            <path d="M2.5 13.5C6 13.5 6.5 2.5 13.5 2.5" strokeLinecap="round" />
                        </svg>
                        <span className="min-w-0 flex-1 truncate">{s.name}</span>
                        <span className="truncate text-ink-subtle">{s.transition.type === "instant" ? "Instant" : `${s.transition.duration}ms`}</span>
                    </div>
                ))}
            {menu && (
                <PointMenu
                    at={menu.at}
                    label="Animation style actions"
                    onClose={() => setMenu(null)}
                    items={[
                        { id: "rename", label: "Rename style", run: () => rename(menu.id, styles.find((s) => s.id === menu.id)?.name ?? "") },
                        { id: "duplicate", label: "Duplicate style", run: () => duplicateAnimationStyle(menu.id) },
                        { id: "delete", label: "Delete style", run: () => deleteAnimationStyle(menu.id) },
                    ]}
                />
            )}
        </div>
    );
}

interface Folder {
    path: string;
    styles: AnyStyle[];
}

function KindGroup({ kind, title, styles, drag, setDrag, onMenu }: { kind: StyleKind; title: string; styles: AnyStyle[]; drag: Drag; setDrag: (d: Drag) => void; onMenu: (e: React.MouseEvent, s: AnyStyle) => void }) {
    const [open, setOpen] = useState(true);
    const folders: Folder[] = [];
    for (const s of styles) {
        const path = slashParts(s.name).folders.join("/");
        let f = folders.find((x) => x.path === path);
        if (!f) {
            f = { path, styles: [] };
            folders.push(f);
        }
        f.styles.push(s);
    }
    // Drops: before a style (taking its folder), or into a folder (at its end).
    const order = styles.map((s) => s.id);
    const moveTo = (beforeId: string | null, folder: string) => {
        if (!drag || drag.kind !== kind) return;
        const moving = styles.find((s) => s.id === drag.id);
        if (!moving) return;
        const rest = order.filter((id) => id !== drag.id);
        let at = beforeId ? rest.indexOf(beforeId) : -1;
        if (at < 0) {
            // End of the folder.
            const inFolder = rest.filter((id) => slashParts(styles.find((s) => s.id === id)?.name ?? "").folders.join("/") === folder);
            const last = inFolder[inFolder.length - 1];
            at = last ? rest.indexOf(last) + 1 : rest.length;
        }
        rest.splice(at, 0, drag.id);
        const leaf = slashParts(moving.name).leaf;
        const name = folder ? `${folder}/${leaf}` : leaf;
        reorderStyles(kind, rest, name !== moving.name ? { [drag.id]: name } : {});
        setDrag(null);
    };
    return (
        <div>
            <button type="button" onClick={() => setOpen(!open)} className="flex h-6 w-full items-center gap-1 text-left text-ink-muted hover:text-ink">
                {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                {title}
            </button>
            {open &&
                folders.map((f) => (
                    <FolderBlock key={f.path || "_root"} kind={kind} folder={f} setDrag={setDrag} drop={moveTo} onMenu={onMenu} />
                ))}
        </div>
    );
}

function FolderBlock({ kind, folder, setDrag, drop, onMenu }: { kind: StyleKind; folder: Folder; setDrag: (d: Drag) => void; drop: (beforeId: string | null, folder: string) => void; onMenu: (e: React.MouseEvent, s: AnyStyle) => void }) {
    const [open, setOpen] = useState(true);
    const [over, setOver] = useState<string | null>(null);
    const rows = folder.styles.map((s) => (
        <div
            key={s.id}
            role="button"
            tabIndex={0}
            draggable
            title={s.description ? `${s.name}\n${s.description}` : s.name}
            onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", s.name);
                setDrag({ kind, id: s.id });
            }}
            onDragOver={(e) => {
                e.preventDefault();
                setOver(s.id);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                drop(s.id, folder.path);
            }}
            onClick={() => editStyle({ kind, id: s.id })}
            onKeyDown={(e) => {
                if (e.key === "Enter") editStyle({ kind, id: s.id });
            }}
            onContextMenu={(e) => onMenu(e, s)}
            className={`flex h-[30px] cursor-default items-center gap-2 rounded-md px-1 hover:bg-panel-hover ${folder.path ? "pl-4" : ""} ${over === s.id ? "shadow-[inset_0_2px_0_0_var(--color-brand-500)]" : ""}`}
        >
            <StylePreview kind={kind} style={s} />
            <span className="min-w-0 flex-1 truncate">{slashParts(s.name).leaf}</span>
            {kind === "text" && <span className="text-ink-subtle">{(s as TextStyle).fontSize}</span>}
        </div>
    ));
    if (!folder.path) return <>{rows}</>;
    return (
        <div>
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    setOver("__folder");
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => {
                    e.preventDefault();
                    setOver(null);
                    drop(null, folder.path);
                }}
                className={`rounded-md ${over === "__folder" ? "bg-brand-500/15" : ""}`}
            >
                <button type="button" onClick={() => setOpen(!open)} className="flex h-[30px] w-full items-center gap-1 px-1 text-left hover:text-ink">
                    {open ? <ChevronDown className="size-3 text-ink-muted" /> : <ChevronRight className="size-3 text-ink-muted" />}
                    <span className="truncate">{folder.path.split("/").join(" / ")}</span>
                </button>
            </div>
            {open && rows}
        </div>
    );
}
