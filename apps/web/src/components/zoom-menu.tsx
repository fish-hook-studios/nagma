import { setPixelPreview } from "../engine/pixel-preview";
import { ChevronDown } from "@untitledui/icons";
import { useState } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator, SubmenuTrigger as AriaSubmenuTrigger } from "react-aria-components";
import { MAX_ZOOM, MIN_ZOOM, zoomBy, zoomTo, zoomToFit, zoomToSelection } from "../engine/camera";
import { type Prefs, editor, useEditor } from "../engine/store";
import { DenseMenu, MenuRow } from "./left-sidebar";
import { useCollab } from "../engine/collab";
import { toggleCommentsHidden } from "../engine/comments";
import { useProtoUi } from "../engine/prototype-ui";
import { toggleConnections } from "../canvas/prototype-connections";

// 198 wide with 24pt rows inset 8, as the reference's zoom menu.
const MENU = "w-[198px] rounded-[13px] bg-tooltip p-2 text-white shadow-xl outline-none";
const RULE = "-mx-2 my-2 h-px bg-white/10";

// Reads "150", "150%" or "1.5x" as a zoom factor.
function parseZoom(text: string): number | null {
    const t = text.trim().toLowerCase();
    if (!t) return null;
    const value = Number.parseFloat(t);
    if (!Number.isFinite(value) || value <= 0) return null;
    const zoom = t.endsWith("x") ? value : value / 100;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

// The zoom menu at the top of the right panel, laid out like the reference's: a field to type a zoom level,
// the zoom commands and presets, then the view toggles (pixel preview at 1x or 2x, pixel grid,
// snapping, layout guides, rulers, outlines, multiplayer cursors, property labels).
export function ZoomMenu() {
    const zoom = useEditor((s) => s.camera.zoom);
    const prefs = useEditor((s) => s.prefs);
    // People with view access can show the prototype's connections (the Prototype tab is for editors).
    const viewer = useEditor((s) => s.readOnly);
    const connections = useEditor((s) => s.rightTab === "prototype");
    const commentsHidden = useCollab((c) => c.commentsHidden);
    const connectionsShown = useProtoUi((u) => !u.hidden);
    const [draft, setDraft] = useState<string | null>(null);
    const flip = (key: keyof Prefs) => () => editor.setPrefs({ [key]: !prefs[key] } as Partial<Prefs>);
    const items: Record<string, () => void> = {
        in: () => zoomBy(2),
        out: () => zoomBy(0.5),
        fit: zoomToFit,
        selection: zoomToSelection,
        "50": () => zoomTo(0.5),
        "100": () => zoomTo(1),
        "200": () => zoomTo(2),
        previewOff: () => setPixelPreview(0),
        preview1: () => setPixelPreview(1),
        preview2: () => setPixelPreview(2),
        pixelGrid: flip("pixelGrid"),
        snapPixel: flip("snapToPixel"),
        layoutGuides: flip("layoutGuides"),
        rulers: flip("rulers"),
        outlines: flip("outlines"),
        maskOutlines: flip("maskOutlines"),
        frameOutlines: flip("frameOutlines"),
        comments: toggleCommentsHidden,
        cursors: flip("multiplayerCursors"),
        labels: flip("propertyLabels"),
        prototyping: viewer ? () => editor.set({ rightTab: connections ? "design" : "prototype" }) : toggleConnections,
    };
    const percent = `${Math.round(zoom * 100)}%`;
    const apply = () => {
        const next = draft === null ? null : parseZoom(draft);
        if (next) zoomTo(next);
        setDraft(null);
    };
    return (
        <AriaMenuTrigger onOpenChange={(open) => !open && setDraft(null)}>
            <AriaButton aria-label="Zoom and view options" className="flex h-6 items-center gap-0.5 rounded-[5px] px-2 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink data-[pressed]:bg-panel-hover">
                {percent}
                <ChevronDown className="size-3" />
            </AriaButton>
            <AriaPopover placement="bottom end" offset={6} containerPadding={8} className={MENU}>
                <div className="flex justify-center">
                    <input
                        aria-label="Zoom level"
                        autoFocus
                        value={draft ?? percent}
                        onFocus={(e) => {
                            setDraft(percent);
                            requestAnimationFrame(() => e.target.select());
                        }}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={apply}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") apply();
                            if (e.key === "Escape") setDraft(null);
                            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                                e.preventDefault();
                                zoomBy(e.key === "ArrowUp" ? 2 : 0.5);
                                setDraft(null);
                            }
                        }}
                        className="h-[30px] w-[150px] rounded-[5px] border border-white/15 bg-transparent px-2 text-[11px] text-white outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                </div>
                <div className={RULE} />
                <DenseMenu>
                <AriaMenu aria-label="Zoom and view" className="outline-none" onAction={(key) => items[String(key)]?.()}>
                    <MenuRow id="in" label="Zoom in" shortcut="⌘ +" checked={false} />
                    <MenuRow id="out" label="Zoom out" shortcut="⌘ −" checked={false} />
                    <MenuRow id="fit" label="Zoom to fit" shortcut="⇧ 1" checked={false} />
                    {!viewer && <MenuRow id="selection" label="Zoom to selection" shortcut="⇧ 2" checked={false} />}
                    <MenuRow id="50" label="Zoom to 50%" checked={Math.abs(zoom - 0.5) < 1e-6} />
                    <MenuRow id="100" label="Zoom to 100%" shortcut="⌘ 0" checked={Math.abs(zoom - 1) < 1e-6} />
                    <MenuRow id="200" label="Zoom to 200%" checked={Math.abs(zoom - 2) < 1e-6} />
                    <AriaSeparator className={RULE} />
                    <AriaSubmenuTrigger>
                        <MenuRow id="preview" label="Pixel preview" shortcut="›" checked={false} />
                        <AriaPopover offset={4} crossOffset={-8} className={MENU}>
                            <AriaMenu aria-label="Pixel preview" className="outline-none" onAction={(key) => items[String(key)]?.()}>
                                <MenuRow id="previewOff" label="Disabled" checked={!prefs.pixelPreview} />
                                <MenuRow id="preview1" label="1x" checked={prefs.pixelPreview && prefs.pixelPreviewScale !== 2} />
                                <MenuRow id="preview2" label="2x" checked={prefs.pixelPreview && prefs.pixelPreviewScale === 2} />
                            </AriaMenu>
                        </AriaPopover>
                    </AriaSubmenuTrigger>
                    <MenuRow id="pixelGrid" label="Pixel grid" shortcut="⇧ '" checked={prefs.pixelGrid} />
                    <MenuRow id="snapPixel" label="Snap to pixel grid" shortcut="⇧ ⌘ '" checked={prefs.snapToPixel} />
                    <MenuRow id="layoutGuides" label="Layout guides" shortcut="⇧ G" checked={prefs.layoutGuides} />
                    <MenuRow id="rulers" label="Rulers" shortcut="⇧ R" checked={prefs.rulers} />
                    <AriaSubmenuTrigger>
                        <MenuRow id="outlinesMenu" label="Outlines" shortcut="›" checked={false} />
                        <AriaPopover offset={4} crossOffset={-8} className={MENU}>
                            <AriaMenu aria-label="Outlines" className="outline-none" onAction={(key) => items[String(key)]?.()}>
                                <MenuRow id="outlines" label="Show outlines" shortcut="⇧ ⌘ O" checked={prefs.outlines} />
                                <MenuRow id="maskOutlines" label="Mask outlines" checked={prefs.maskOutlines} />
                                <MenuRow id="frameOutlines" label="Frame outlines" checked={prefs.frameOutlines} />
                            </AriaMenu>
                        </AriaPopover>
                    </AriaSubmenuTrigger>
                    <MenuRow id="cursors" label="Multiplayer cursors" shortcut="⌥ ⌘ \" checked={prefs.multiplayerCursors} />
                    <MenuRow id="labels" label="Additional labels" checked={prefs.propertyLabels} />
                    <AriaSeparator className={RULE} />
                    <MenuRow id="comments" label="Comments" shortcut="⇧ C" checked={!commentsHidden} />
                    <MenuRow id="prototyping" label="Prototyping" shortcut="⇧ E" checked={viewer ? connections : connectionsShown} />
                </AriaMenu>
                </DenseMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}
