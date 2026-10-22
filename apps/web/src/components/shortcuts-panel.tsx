import { X } from "@untitledui/icons";
import { useEffect, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { fileMeta } from "../engine/files";
import { useEditor } from "../engine/store";
import { ui, useUi } from "../engine/ui-state";

// Help › Keyboard shortcuts (⌃⇧?): a panel docked along the bottom of the editor with a tab per
// area, listing every shortcut the editor answers. Keys are written for a Mac; elsewhere ⌘ reads
// as Ctrl and ⌥ as Alt.

type Row = [label: string, keys: string];
interface Section {
    id: string;
    label: string;
    groups: { title: string; rows: Row[] }[];
}

const VIDEO: Section = {
    id: "video",
    label: "Video",
    groups: [
        { title: "Playback", rows: [["Play or pause", "Space"], ["Play backward, faster", "J"], ["Stop", "K"], ["Play forward, faster", "L"], ["Back or forward a frame", "← or →"], ["Ten frames", "⇧ ← or →"], ["Previous or next edit", "↑ or ↓"], ["Start or end", "Home or End"], ["Previous or next keyframe", "[ or ]"]] },
        { title: "Edit", rows: [["Split at playhead", "S or ⌘ K"], ["Razor tool", "C"], ["Comment", "⇧ C"], ["Selection tool", "V"], ["Delete", "⌫"], ["Ripple delete", "⌥ ⌫"], ["Duplicate", "⌘ D"], ["Copy, cut, paste", "⌘ C, ⌘ X, ⌘ V"], ["Nudge a frame", "⌥ ← or →"], ["Ripple trim", "⌥ drag an edge"], ["Copy while dragging", "⌥ drag"], ["Enable or disable", "⇧ E"], ["Link or unlink", "⌘ L or ⇧ ⌘ L"]] },
        { title: "Sequence", rows: [["Mark in", "I"], ["Mark out", "O"], ["Clear in and out", "⌥ X"], ["Add marker", "M"], ["Snapping", "⇧ S"], ["Add title", "T"], ["Nest selection", "⌘ G"], ["Open nested sequence", "↵"], ["Zoom timeline", "= or −"], ["Fit timeline", "\\"]] },
        { title: "File", rows: [["Import media", "⌘ I"], ["Export", "⌘ E"], ["Export frame as PNG", "⇧ ⌘ E"], ["Undo", "⌘ Z"], ["Redo", "⇧ ⌘ Z"], ["Left panel", "⌘ \\"], ["Keyboard shortcuts", "⌃ ⇧ ?"]] },
    ],
};

const SECTIONS: Section[] = [
    {
        id: "essential",
        label: "Essential",
        groups: [
            { title: "Tools", rows: [["Move", "V"], ["Frame", "F"], ["Rectangle", "R"], ["Ellipse", "O"], ["Line", "L"], ["Pen", "P"], ["Text", "T"], ["Hand", "H or Space"], ["Comment", "C"]] },
            { title: "Edit", rows: [["Undo", "⌘ Z"], ["Redo", "⇧ ⌘ Z"], ["Copy", "⌘ C"], ["Paste", "⌘ V"], ["Duplicate", "⌘ D"], ["Delete", "⌫"], ["Group", "⌘ G"], ["Frame selection", "⌥ ⌘ G"]] },
            { title: "View", rows: [["Actions", "⌘ K"], ["Zoom to fit", "⇧ 1"], ["Zoom to selection", "⇧ 2"], ["Zoom to 100%", "⇧ 0"], ["Show/Hide UI", "⌘ \\"], ["Keyboard shortcuts", "⌃ ⇧ ?"]] },
        ],
    },
    {
        id: "tools",
        label: "Tools",
        groups: [
            { title: "Move and frame", rows: [["Move", "V"], ["Hand", "H"], ["Scale", "K"], ["Frame", "F or A"], ["Frame of the last size", "F, then click"], ["Section", "⇧ S"], ["Slice", "S"]] },
            { title: "Shapes", rows: [["Rectangle", "R"], ["Ellipse", "O"], ["Line", "L"], ["Arrow", "⇧ L"], ["Place image or video", "⇧ ⌘ K"]] },
            { title: "Draw and type", rows: [["Pen", "P"], ["Pencil", "⇧ P"], ["Text", "T"], ["Pick color", "I or ⌃ C"]] },
            { title: "Review", rows: [["Comment", "C"], ["Annotation", "Y"], ["Measurement", "⇧ M"], ["Inspect", "⇧ D"]] },
        ],
    },
    {
        id: "view",
        label: "View",
        groups: [
            { title: "Show", rows: [["Pixel grid", "⇧ '"], ["Snap to pixel grid", "⇧ ⌘ '"], ["Layout guides", "⇧ G"], ["Rulers", "⇧ R"], ["Outlines", "⇧ ⌘ O"], ["Pixel preview", "⌃ P"], ["Multiplayer cursors", "⌥ ⌘ \\"], ["Comments", "⇧ C"], ["Prototype connections", "⇧ E"]] },
            { title: "Interface", rows: [["Show/Hide UI", "⌘ \\"], ["Minimize UI", "⇧ ⌘ \\"], ["Layers", "⌥ 1"], ["Assets", "⌥ 2"], ["Search components", "⇧ I"], ["Design panel", "⌥ 8"], ["Prototype panel", "⌥ 9"], ["Collapse layers", "⌥ L"], ["Find", "⌘ F"]] },
        ],
    },
    {
        id: "zoom",
        label: "Zoom",
        groups: [
            { title: "Zoom", rows: [["Zoom in", "+ or ⌘ +"], ["Zoom out", "- or ⌘ -"], ["Zoom to 100%", "⇧ 0 or ⌘ 0"], ["Zoom to fit", "⇧ 1"], ["Zoom to selection", "⇧ 2"], ["Zoom tool", "Hold Z and click"], ["Zoom out with the tool", "Hold ⌥ Z and click"], ["Zoom to an area", "Hold Z and drag"]] },
            { title: "Navigate", rows: [["Pan", "Space and drag"], ["Pan with nothing selected", "Arrow keys"], ["Pan further", "⇧ arrow keys"], ["Next frame", "N"], ["Previous frame", "⇧ N"], ["Previous page", "Page Up"], ["Next page", "Page Down"]] },
        ],
    },
    {
        id: "text",
        label: "Text",
        groups: [
            { title: "Style", rows: [["Bold", "⌘ B"], ["Italic", "⌘ I"], ["Underline", "⌘ U"], ["Strikethrough", "⇧ ⌘ X"], ["Create link", "⇧ ⌘ U"], ["Bulleted list", "⇧ ⌘ 8"], ["Numbered list", "⇧ ⌘ 7"]] },
            { title: "Align", rows: [["Align left", "⌥ ⌘ L"], ["Align center", "⌥ ⌘ T"], ["Align right", "⌥ ⌘ R"]] },
            { title: "Adjust", rows: [["Font size", "⇧ ⌘ < or >"], ["Font weight", "⌥ ⌘ < or >"], ["Letter spacing", "⌥ < or >"], ["Line height", "⌥ ⇧ < or >"]] },
        ],
    },
    {
        id: "shape",
        label: "Shape",
        groups: [
            { title: "Drawing", rows: [["Keep proportions", "Hold ⇧"], ["Draw from the center", "Hold ⌥"], ["Snap lines to 45°", "Hold ⇧"]] },
            { title: "Vector", rows: [["Edit points", "↵"], ["Leave point editing", "Esc or ↵"], ["Bend", "Hold ⌘ in point editing"], ["Paint bucket", "⇧ B in point editing"], ["Lasso", "L in point editing"], ["Join points", "⌘ J"], ["Smooth join", "⇧ ⌘ J"], ["Delete point and its segments", "⌫"], ["Delete and heal", "⇧ ⌫"]] },
            { title: "Paths", rows: [["Flatten", "⌘ E"], ["Outline stroke", "⌥ ⌘ O"], ["Union", "⌥ ⇧ U"], ["Subtract", "⌥ ⇧ S"], ["Intersect", "⌥ ⇧ I"], ["Exclude", "⌥ ⇧ E"], ["Remove fill", "⌥ /"], ["Remove stroke", "⇧ /"], ["Swap fill and stroke", "⇧ X"]] },
        ],
    },
    {
        id: "selection",
        label: "Selection",
        groups: [
            { title: "Select", rows: [["Select all", "⌘ A"], ["Select inverse", "⇧ ⌘ A"], ["Select matching layers", "⌥ ⌘ A"], ["Select none", "Esc"], ["Add to selection", "⇧ click"], ["Deep select", "⌘ click"], ["Select layer behind", "Right-click › Select layer"]] },
            { title: "Navigate the tree", rows: [["Select children", "↵"], ["Select parent", "⇧ ↵"], ["Next sibling", "Tab"], ["Previous sibling", "⇧ Tab"]] },
            { title: "Keyboard", rows: [["Selection box", "⌥ Space"], ["Move the box", "Arrow keys"], ["Resize the box", "⌘ arrow keys"], ["Select what it touches", "↵"], ["Next region (toolbar, panels, canvas)", "F6"], ["Previous region", "⇧ F6"]] },
        ],
    },
    {
        id: "cursor",
        label: "Cursor",
        groups: [
            { title: "Measure and move", rows: [["Measure distances", "Hold ⌥ over a layer"], ["Duplicate while dragging", "⌥ drag"], ["Lock to an axis", "⇧ drag"]] },
            { title: "Together", rows: [["Cursor chat", "/"], ["Pick color", "⌃ C"]] },
        ],
    },
    {
        id: "edit",
        label: "Edit",
        groups: [
            { title: "Clipboard", rows: [["Copy", "⌘ C"], ["Cut", "⌘ X"], ["Paste", "⌘ V"], ["Paste here", "Right-click › Paste here"], ["Paste over selection", "⇧ ⌘ V"], ["Paste to replace", "⇧ ⌘ R"], ["Copy as PNG", "⇧ ⌘ C"], ["Copy as code", "Right-click › Copy/Paste as"], ["Copy properties", "⌥ ⌘ C"], ["Paste properties", "⌥ ⌘ V"]] },
            { title: "Layers", rows: [["Duplicate", "⌘ D"], ["Duplicate in a line", "⌥ drag, then ⌘ D"], ["Delete", "⌫"], ["Rename", "⌘ R"], ["Rename several layers", "⌘ R with 2 or more selected"], ["Show/Hide", "⇧ ⌘ H"], ["Lock/Unlock", "⇧ ⌘ L"], ["Opacity", "0 to 9"], ["Export", "⇧ ⌘ E"], ["Import", "⇧ ⌘ I"], ["Save to version history", "⌥ ⌘ S or ⌘ S"]] },
        ],
    },
    {
        id: "transform",
        label: "Transform",
        groups: [
            { title: "Move and size", rows: [["Nudge", "Arrow keys"], ["Big nudge", "⇧ arrow keys"], ["Resize", "⌘ arrow keys"], ["Big resize", "⇧ ⌘ arrow keys"], ["Resize from the center", "⌥ drag a handle"], ["Keep proportions", "⇧ drag a handle"], ["Crop an image instead of scaling it", "⌘ drag a handle"], ["Scale contents", "K, then drag a handle"]] },
            { title: "Rotate and flip", rows: [["Rotate in 15° steps", "⇧ rotate"], ["Rotate", "Drag outside a corner"], ["Flip horizontal", "⇧ H"], ["Flip vertical", "⇧ V"]] },
            { title: "Structure", rows: [["Group", "⌘ G"], ["Ungroup", "⇧ ⌘ G"], ["Frame selection", "⌥ ⌘ G"], ["Wrap in section", "⌘ S"], ["Use as mask", "⌃ ⌘ M"], ["Resize to fit", "⌥ ⇧ ⌘ R"], ["Add auto layout", "⇧ A"], ["Remove auto layout", "⌥ ⇧ A"], ["Suggest auto layout", "⌃ ⇧ A"]] },
        ],
    },
    {
        id: "arrange",
        label: "Arrange",
        groups: [
            { title: "Order", rows: [["Bring forward", "⌘ ]"], ["Send backward", "⌘ ["], ["Bring to front", "] or ⌥ ⌘ ]"], ["Send to back", "[ or ⌥ ⌘ ["]] },
            { title: "Align", rows: [["Align left", "⌥ A"], ["Align right", "⌥ D"], ["Align top", "⌥ W"], ["Align bottom", "⌥ S"], ["Align horizontal centers", "⌥ H"], ["Align vertical centers", "⌥ V"]] },
            { title: "Distribute", rows: [["Distribute horizontal spacing", "⌃ ⌥ H"], ["Distribute vertical spacing", "⌃ ⌥ V"], ["Tidy up", "⌃ ⌥ T"]] },
        ],
    },
    {
        id: "components",
        label: "Components",
        groups: [{ title: "Components", rows: [["Create component", "⌥ ⌘ K"], ["Detach instance", "⌥ ⌘ B"], ["Make a slot", "⇧ ⌘ S"], ["Search components", "⇧ I"], ["Present", "⌥ ⌘ ↵"], ["Preview prototype", "⇧ Space"]] }],
    },
];

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const local = (keys: string) => (MAC ? keys : keys.replace(/⌘/g, "Ctrl").replace(/⌥/g, "Alt").replace(/⌃/g, "Ctrl").replace(/⇧/g, "Shift").replace(/↵/g, "Enter").replace(/⌫/g, "Backspace"));

export function ShortcutsPanel() {
    const open = useUi((s) => s.shortcutsOpen);
    // Video files list their own keys first.
    const video = useEditor((s) => s.sequenceView && fileMeta(s.fileId)?.kind === "video");
    const [tab, setTab] = useState(video ? "video" : "essential");
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                ui.set({ shortcutsOpen: false });
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [open]);
    if (!open) return null;
    const sections = video ? [VIDEO, ...SECTIONS] : SECTIONS;
    const section = sections.find((s) => s.id === tab) ?? sections[0]!;
    return (
        <section aria-label="Keyboard shortcuts" className="fixed inset-x-0 bottom-0 z-40 flex max-h-[45vh] flex-col border-t border-panel-border bg-panel text-ink shadow-2xl">
            <div className="flex shrink-0 items-center gap-1 border-b border-panel-border px-3">
                <div role="tablist" aria-label="Shortcut areas" className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-1.5">
                    {sections.map((s) => (
                        <button
                            key={s.id}
                            role="tab"
                            type="button"
                            aria-selected={s.id === section.id}
                            onClick={() => setTab(s.id)}
                            className={`shrink-0 rounded px-2 py-1 text-[11px] font-medium outline-none ${s.id === section.id ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>
                <AriaButton aria-label="Close keyboard shortcuts" onPress={() => ui.set({ shortcutsOpen: false })} className="flex size-6 shrink-0 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                    <X className="size-4" />
                </AriaButton>
            </div>
            <div role="tabpanel" aria-label={section.label} className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-8 gap-y-4 overflow-y-auto px-4 py-3">
                {section.groups.map((group) => (
                    <div key={group.title}>
                        <h3 className="mb-1.5 text-[11px] font-semibold text-ink">{group.title}</h3>
                        <dl className="space-y-1">
                            {group.rows.map(([label, keys]) => (
                                <div key={label} className="flex items-baseline justify-between gap-3 text-[11px]">
                                    <dt className="truncate text-ink-muted">{label}</dt>
                                    <dd className="shrink-0 font-medium tabular-nums text-ink">{local(keys)}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                ))}
            </div>
        </section>
    );
}
