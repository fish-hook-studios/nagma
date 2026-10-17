import { hasCopiedLayers, pasteCopiedLayers } from "../engine/layer-clipboard";
import { clipboardFiles, desktopClipboardImage, htmlImageSources, isImageUrl, placeImageSources } from "../engine/paste-images";
import { useEffect } from "react";
import { keys } from "../canvas/keys";
import { deleteSelectedConnection, toggleConnections } from "../canvas/prototype-connections";
import { suggestAutoLayout } from "../engine/suggest-layout";
import {
    addAutoLayout,
    booleanSelection,
    copySelection,
    createComponent,
    cutSelection,
    deleteSelection,
    detachInstance,
    duplicateSelection,
    enterVectorEdit,
    leaveVectorEdit,
    flattenSelection,
    flipSelection,
    frameSelection,
    groupSelection,
    outlineStroke,
    sectionSelection,
    toggleMask,
    hasClipboard,
    nudge,
    paste,
    pasteFromText,
    pasteOverSelection,
    pasteToReplace,
    removeAutoLayout,
    reorder,
    selectAll,
    selectChildren,
    selectParent,
    selectSibling,
    toggleLock,
    toggleVisibility,
    ungroupSelection,
    viewCenter, resizeToFit, pasteText, clipboardMirrored } from "../engine/actions";
import { importSvg, looksLikeSvg } from "../engine/svg-import";
import { pickFigFile } from "../engine/files";
import { cycleFocusRegion } from "../engine/focus-regions";
import { startPresenting, worldToScreen, zoomAt, zoomBy, zoomTo, zoomToFit, zoomToSelection } from "../engine/camera";
import { selectionBounds } from "../engine/nodes";
import { pickImages, placeImages } from "../engine/images";
import { exportLayers } from "../engine/export";
import { setMode, openActions } from "../engine/modes";
import { runLastPlugin } from "../engine/plugins";
import { togglePixelPreview } from "../engine/pixel-preview";
import { collapseLayers, endKeyBox, keyBoxSelect, moveKeyBox, openFind, startKeyBox, toggleShortcuts, ui } from "../engine/ui-state";
import { layerRoots } from "../engine/page";
import { screenOf, startScreen } from "../engine/prototype";
import { closePreview, openPreview, prototypeView } from "../engine/prototype-view";
import { editor } from "../engine/store";
import { slides } from "../slides/state";
import { toggleCommentsHidden } from "../engine/comments";
import { openSaveVersion } from "../engine/collab";
import { openCursorChat } from "../engine/follow";
import type { BooleanOp, Tool } from "../engine/types";
import type { VectorTool } from "../canvas/vector-edit";
import { createLink, hasTextSelection, setTextAlign, toggleList, stepFontSize, stepFontWeight, stepLetterSpacing, stepLineHeight, toggleBold, toggleDecoration, toggleItalic } from "../engine/text-actions";
import { slotSelection } from "../engine/component-actions";
import { alignSelection, copyAs, copyProperties, distributeSelection, opacityFromDigit, pasteProperties, renameSelection, selectInverse, selectMatching, tidyUp, zoomToFrame, resizeBy, stepPage } from "../engine/arrange";
import { deleteSelectedVertices, joinSelectedVertices, removeFills, removeStrokes, selectAllVertices, setVectorTool, swapFillAndStroke } from "../engine/vector-actions";

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
// Screen pixels the arrows pan by with nothing selected.
const PAN_SMALL = 20;
const PAN_BIG = 200;

const TOOL_KEYS: Record<string, Tool> = { v: "move", f: "frame", a: "frame", r: "rect", l: "line", o: "ellipse", t: "text", h: "hand", k: "scale", s: "slice", p: "pen", b: "brush", c: "comment", y: "annotation", i: "eyedropper" };
// With Shift: Arrow and Pencil.
const SHIFT_TOOL_KEYS: Record<string, Tool> = { l: "arrow", p: "pencil", s: "section", m: "measure", t: "annotation" };

// A pasted image link is fetched and placed like a dropped file; if the site refuses, the link
// becomes a text layer instead.
async function pasteImageUrl(url: string) {
    if (!(await placeImageSources([url], viewCenter()))) pasteText(url);
}

export function presentCurrent() {
    const s = editor.get();
    const start = startScreen(s.doc, s.selection);
    if (start) startPresenting(start);
    else editor.notify("Add a frame to present it.");
}

// ⇧Space (and Present ⌄ › Preview): the selected frame's prototype in a panel on the canvas, or closes it.
export function previewCurrent() {
    const s = editor.get();
    if (prototypeView().preview) return closePreview();
    const node = s.doc.nodes[s.selection[0] ?? ""];
    const frame = node ? screenOf(s.doc, node) : null;
    if (frame) openPreview(frame.id);
    else editor.notify("Select a frame to preview it.");
}

export function useShortcuts() {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
            const s = editor.get();
            if (s.editingTextId) return;
            // On a Mac ⌘ is the command key and Control a modifier of its own (⌃C picks a colour, ⌃G
            // shows layout guides, ⌃P pixel preview); elsewhere Ctrl is the command key.
            const mod = MAC ? event.metaKey : event.ctrlKey || event.metaKey;
            const ctrlOnly = MAC && event.ctrlKey && !event.metaKey;
            const key = event.key.toLowerCase();
            const code = event.code;
            const has = s.selection.length > 0;

            const run = (action: () => void) => {
                event.preventDefault();
                action();
            };
            // The prototype tab's player answers its own keys.
            if (s.presentingId) return;
            // Shift+Space previews the selected frame's prototype in a panel on the canvas, or closes it.
            if (code === "Space" && event.shiftKey && !mod && !event.altKey) {
                event.preventDefault();
                previewCurrent();
                return;
            }
            // ⌥Space: a keyboard selection box (arrows move it, Return selects what it touches).
            if (code === "Space" && event.altKey && !mod) return run(startKeyBox);
            if (code === "Space") {
                event.preventDefault();
                keys.space = true;
                return;
            }
            // F6 moves keyboard focus between the toolbar, the left panel, the canvas and the right panel.
            if (code === "F6") return run(() => cycleFocusRegion(event.shiftKey ? -1 : 1));
            // The keyboard selection box takes the arrows, Return and Escape while it is up.
            if (ui.get().keyBox) {
                if (key === "escape") return run(endKeyBox);
                if (key === "enter") return run(keyBoxSelect);
                if (key.startsWith("arrow")) {
                    const step = event.shiftKey ? s.prefs.nudgeBig : s.prefs.nudgeSmall;
                    return run(() => moveKeyBox(key === "arrowleft" ? -step : key === "arrowright" ? step : 0, key === "arrowup" ? -step : key === "arrowdown" ? step : 0, mod));
                }
            }
            // Hold Z: click zooms in (⌥ out), a drag zooms to the area.
            if (code === "KeyZ" && !mod && !event.shiftKey && !s.editingVectorId) {
                event.preventDefault();
                if (!keys.z) {
                    keys.z = true;
                    editor.set({});
                }
                return;
            }
            if (event.key === "Alt") {
                event.preventDefault();
                keys.alt = true;
                editor.set({});
                return;
            }

            // ⌃⇧? (Ctrl+Shift+? elsewhere): the keyboard shortcuts panel.
            if (event.ctrlKey && event.shiftKey && !event.altKey && (code === "Slash" || key === "?")) return run(toggleShortcuts);
            // The pen's path in progress: Enter or Escape finishes it.
            if (s.penNodeId && (key === "enter" || key === "escape")) {
                event.preventDefault();
                editor.finishPen();
                editor.set({ tool: "move" });
                return;
            }
            // Point editing: Escape leaves (first clearing the point selection), Delete removes points,
            // ⇧⌫ deletes and heals, ⌘J joins, ⇧⌘J smooth joins, ⌘A selects every point, V/L/B/C/E pick tools.
            if (s.editingVectorId) {
                if (key === "escape" || key === "enter") {
                    event.preventDefault();
                    if (key === "escape" && s.vertices.length && s.vectorTool === "move") editor.set({ vertices: [] });
                    else leaveVectorEdit();
                    return;
                }
                if (key === "backspace" || key === "delete") {
                    if (!s.vertices.length) return;
                    return run(() => deleteSelectedVertices(event.shiftKey));
                }
                if (mod && key === "j") return run(() => joinSelectedVertices(event.shiftKey));
                if (mod && key === "a") return run(selectAllVertices);
                if (mod && key === "z") return run(() => (event.shiftKey ? editor.redo() : editor.undo()));
                if (!mod && !event.altKey) {
                    const tools: Record<string, VectorTool> = { v: "move", l: "lasso", b: event.shiftKey ? "paint" : "bend", c: "cut", e: "erase", p: "move", m: "builder", w: "width" };
                    if (key === "w" && !event.shiftKey) return;
                    const tool = tools[key];
                    if (tool) {
                        if (key === "p") editor.set({ tool: "pen", vectorTool: "move" });
                        else setVectorTool(tool);
                        return;
                    }
                }
            }
            // By code: ⌥/ types "÷" on a Mac and ⇧/ types "?", so the key never reads "/".
            if (event.altKey && !event.shiftKey && !mod && code === "Slash" && has) return run(removeFills);
            if (event.shiftKey && !event.altKey && !mod && code === "Slash" && has) return run(removeStrokes);
            if (event.shiftKey && !mod && !event.altKey && code === "KeyX" && has) return run(swapFillAndStroke);

            // Control on a Mac: ⌃C pick colour, ⌃G layout guides, ⌃P pixel preview, ⌃⇧A suggest auto layout.
            if (ctrlOnly && !event.altKey) {
                if (!event.shiftKey && code === "KeyC") return run(() => editor.set({ tool: "eyedropper" }));
                if (!event.shiftKey && code === "KeyG") return run(() => editor.setPrefs({ layoutGuides: !s.prefs.layoutGuides }));
                if (!event.shiftKey && code === "KeyP") return run(() => togglePixelPreview());
                if (event.shiftKey && code === "KeyA" && has) return run(suggestAutoLayout);
            }
            // Shortcut table: [modifier match, key test, action].
            if (mod) {
                // ⌘F: Find (⇧⌘F with the replace field open).
                if (code === "KeyF" && !event.altKey) return run(() => openFind(event.shiftKey));
                if (key === "z") return run(() => (event.shiftKey ? editor.redo() : editor.undo()));
                if (key === "y") return run(() => editor.redo());
                // Suggest auto layout: ⌃⇧A on a Mac, Ctrl+Alt+Shift+A elsewhere.
                if (code === "KeyA" && event.shiftKey && event.ctrlKey && !event.metaKey && (/Mac/i.test(navigator.platform) ? !event.altKey : event.altKey) && has) return run(suggestAutoLayout);
                // ⌥⌘A (by code: ⌥A types "å" on a Mac).
                if (code === "KeyA" && event.altKey) return run(selectMatching);
                if (code === "KeyA" && event.shiftKey) return run(selectInverse);
                if (key === "a") return run(selectAll);
                if (code === "KeyC" && event.altKey && has) return run(copyProperties);
                if (code === "KeyV" && event.altKey && has) return run(pasteProperties);
                // Text: ⌘B/I/U, ⇧⌘X strikethrough, ⌥⌘L/T/R align, ⇧⌘< > size, ⌥⌘< > weight.
                // These come before Cut and Rename so ⇧⌘X and ⌥⌘R reach the text.
                if (has && hasTextSelection()) {
                    if (code === "KeyB" && !event.altKey && !event.shiftKey) return run(toggleBold);
                    if (code === "KeyI" && !event.altKey && !event.shiftKey) return run(toggleItalic);
                    if (code === "KeyU" && !event.altKey && !event.shiftKey) return run(() => toggleDecoration("underline"));
                    if (code === "KeyU" && event.shiftKey) return run(createLink);
                    if (code === "KeyX" && event.shiftKey) return run(() => toggleDecoration("strikethrough"));
                    if (code === "Digit8" && event.shiftKey) return run(() => toggleList("bullet"));
                    if (code === "Digit7" && event.shiftKey) return run(() => toggleList("number"));
                    if (event.altKey && code === "KeyL") return run(() => setTextAlign("left"));
                    if (event.altKey && code === "KeyT") return run(() => setTextAlign("center"));
                    if (event.altKey && code === "KeyR") return run(() => setTextAlign("right"));
                    if (event.shiftKey && !event.altKey && (code === "Comma" || code === "Period")) return run(() => stepFontSize(code === "Period" ? 1 : -1));
                    if (event.altKey && (code === "Comma" || code === "Period")) return run(() => stepFontWeight(code === "Period" ? 1 : -1));
                }
                if (code === "KeyC" && event.shiftKey && has) return run(() => void copyAs("png"));
                // ⌥⇧⌘R resizes a frame to its contents; ⇧⌘R pastes to replace.
                if (code === "KeyR" && event.altKey && event.shiftKey && has) return run(resizeToFit);
                if (code === "KeyR" && event.shiftKey && !event.altKey && has) return run(pasteToReplace);
                if (code === "KeyV" && event.shiftKey) return run(pasteOverSelection);
                if (code === "KeyR" && !event.altKey && !event.shiftKey && has) return run(renameSelection);
                if (key === "c" && !event.shiftKey && has) return copySelection();
                if (code === "KeyX" && !event.shiftKey && has) return run(cutSelection);
                // ⌘V is handled by the paste event below, which can also see images and other tabs' layers.
                if (key === "v") return;
                if (code === "KeyK" && event.shiftKey) return run(() => pickImages(viewCenter));
                if (code === "KeyK" && !event.altKey) return run(openActions);
                if (code === "KeyE" && event.shiftKey) return run(() => void exportLayers(s.doc, has ? s.selection : layerRoots(s.doc), "png", 2));
                // ⇧⌘I: File › Import.
                if (code === "KeyI" && event.shiftKey && !event.altKey) return run(pickFigFile);
                if (key === "d" && has) return run(duplicateSelection);
                if (code === "KeyG" && event.altKey && has) return run(frameSelection);
                if (code === "KeyG" && event.shiftKey && has) return run(ungroupSelection);
                if (key === "backspace" && has) return run(ungroupSelection);
                if (code === "KeyG" && has) return run(groupSelection);
                if (code === "KeyK" && event.altKey && has) return run(createComponent);
                if (code === "KeyE" && has) return run(flattenSelection);
                if (code === "KeyB" && event.altKey && has) return run(detachInstance);
                if (code === "KeyH" && event.shiftKey && has) return run(toggleVisibility);
                if (code === "KeyL" && event.shiftKey && has) return run(toggleLock);
                if (key === "]" || code === "BracketRight") return run(() => reorder(event.altKey ? "front" : "forward"));
                if (key === "[" || code === "BracketLeft") return run(() => reorder(event.altKey ? "back" : "backward"));
                // ⌘ arrows resize from the top-left: → and ↓ grow, ← and ↑ shrink (⇧ for the big step).
                if (key.startsWith("arrow") && has && !event.altKey && !s.editingVectorId) {
                    const step = event.shiftKey ? s.prefs.nudgeBig : s.prefs.nudgeSmall;
                    const dw = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
                    const dh = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
                    return run(() => resizeBy(dw, dh));
                }
                if (key === "=" || key === "+") return run(() => keyZoom(2));
                if (key === "-") return run(() => keyZoom(0.5));
                if (key === "0") return run(() => zoomTo(1));
                // By code: ⌥ and ⇧ change the character (« and | on a Mac).
                if (code === "Backslash" && event.altKey) return run(() => editor.setPrefs({ multiplayerCursors: !s.prefs.multiplayerCursors }));
                if (code === "Backslash" && event.shiftKey) return run(() => editor.set({ uiMinimized: !s.uiMinimized }));
                if (code === "Backslash" || key === "\\") return run(() => editor.set({ uiHidden: !s.uiHidden }));
                if (code === "KeyO" && event.shiftKey) return run(() => editor.setPrefs({ outlines: !s.prefs.outlines }));
                // Preferences › Use old shortcuts for outlines: ⌘Y as well.
                if (code === "KeyY" && !event.shiftKey && !event.altKey && s.prefs.oldOutlineShortcuts) return run(() => editor.setPrefs({ outlines: !s.prefs.outlines }));
                if (code === "KeyO" && event.altKey && has) return run(outlineStroke);
                // ⌥⌘P: run the last plugin again.
                if (code === "KeyP" && event.altKey && !event.shiftKey) return run(runLastPlugin);
                if (code === "KeyP" && event.shiftKey) return run(() => togglePixelPreview());
                if (code === "KeyS" && !event.shiftKey && !event.altKey && has) return run(sectionSelection);
                // ⌘S with nothing selected: changes save as you go, so offer a named version instead
                // of the browser's Save dialog.
                if (code === "KeyS" && !event.shiftKey && !event.altKey) return run(openSaveVersion);
                if (code === "KeyS" && event.altKey && !event.shiftKey) return run(openSaveVersion);
                // Use as mask: ⌃⌘M on a Mac, Ctrl+Alt+M elsewhere.
                if (code === "KeyM" && (MAC ? event.ctrlKey && event.metaKey : event.ctrlKey && event.altKey) && has) return run(toggleMask);
                // ⇧⌘S: a frame inside a main component becomes a slot (other layers are wrapped in one).
                if (code === "KeyS" && event.shiftKey && !event.altKey && has) return run(() => slotSelection(s.selection));
                if (code === "Quote" && event.shiftKey) return run(() => editor.setPrefs({ snapToPixel: !s.prefs.snapToPixel }));
                // ⌘': the pixel grid (⇧' too).
                if (code === "Quote" && !event.altKey) return run(() => editor.setPrefs({ pixelGrid: !s.prefs.pixelGrid }));
                if (key === "enter" && event.altKey) return run(presentCurrent);
                return;
            }

            if (event.shiftKey && event.altKey && has) {
                const ops: Record<string, BooleanOp> = { KeyU: "union", KeyS: "subtract", KeyI: "intersect", KeyE: "exclude" };
                const op = ops[code];
                if (op) return run(() => booleanSelection(op));
            }
            if (event.shiftKey && event.altKey && code === "KeyA" && has) return run(removeAutoLayout);
            // ⌥L: collapse every layer in the Layers panel.
            if (event.altKey && !event.shiftKey && !event.ctrlKey && code === "KeyL") return run(collapseLayers);
            // ⌥⇧F: flatten (text becomes its glyph outlines).
            if (event.shiftKey && event.altKey && code === "KeyF" && has) return run(flattenSelection);
            // Arrange: ⌥A/D/W/S/H/V align, ⌃⌥H/V distribute, ⌃⌥T tidy up.
            if (event.altKey && !event.shiftKey && has) {
                const aligns: Record<string, Parameters<typeof alignSelection>[0]> = { KeyA: "left", KeyD: "right", KeyW: "top", KeyS: "bottom", KeyH: "hcenter", KeyV: "vcenter" };
                if (event.ctrlKey && code === "KeyH") return run(() => distributeSelection("h"));
                if (event.ctrlKey && code === "KeyV") return run(() => distributeSelection("v"));
                if (event.ctrlKey && code === "KeyT") return run(() => tidyUp());
                const a = aligns[code];
                if (a && !event.ctrlKey) return run(() => alignSelection(a));
            }
            if (!event.shiftKey && !event.altKey && code === "KeyN") return run(() => zoomToFrame(1));
            if (event.shiftKey && !event.altKey && code === "KeyN") return run(() => zoomToFrame(-1));
            if (!event.shiftKey && !event.altKey && /^Digit[0-9]$/.test(code) && has && s.tool === "move" && s.prefs.numberKeysOpacity) return run(() => opacityFromDigit(Number(code.slice(5))));
            if (event.shiftKey && code === "KeyA" && has) return run(addAutoLayout);
            if (event.shiftKey && code === "KeyR") return editor.setPrefs({ rulers: !s.prefs.rulers });
            // "/" opens cursor chat.
            if (key === "/" && !event.shiftKey && !event.altKey) return run(openCursorChat);
            // ⇧C hides or shows comments on the canvas.
            if (event.shiftKey && !event.altKey && code === "KeyC") return run(toggleCommentsHidden);
            // ⇧E shows or hides prototype connections.
            if (event.shiftKey && !event.altKey && code === "KeyE") return run(toggleConnections);
            if (event.shiftKey && code === "Quote") return run(() => editor.setPrefs({ pixelGrid: !s.prefs.pixelGrid }));
            // Layout guides: ⇧G (⌃G still works).
            if ((event.ctrlKey && !event.metaKey && code === "KeyG") || (event.shiftKey && !event.altKey && !mod && code === "KeyG")) return run(() => editor.setPrefs({ layoutGuides: !s.prefs.layoutGuides }));
            if (event.altKey && !event.shiftKey && has && hasTextSelection() && (code === "Comma" || code === "Period")) return run(() => stepLetterSpacing(code === "Period" ? 1 : -1));
            if (event.altKey && event.shiftKey && has && hasTextSelection() && (code === "Comma" || code === "Period")) return run(() => stepLineHeight(code === "Period" ? 1 : -1));
            // ⇧I: component search (the Assets panel with its search box focused).
            if (event.shiftKey && !event.altKey && code === "KeyI") {
                return run(() => {
                    editor.setPrefs({ leftPanel: "assets", leftPanelOpen: true });
                    setTimeout(() => (document.querySelector('input[aria-label="Search assets"]') as HTMLInputElement | null)?.focus(), 50);
                });
            }
            // ⌥1 layers, ⌥2 assets, ⌥8 design, ⌥9 prototype.
            if (event.altKey && !event.shiftKey && code === "Digit1") return run(() => editor.setPrefs({ leftPanel: "layers", leftPanelOpen: true }));
            if (event.altKey && !event.shiftKey && code === "Digit2") return run(() => editor.setPrefs({ leftPanel: "assets", leftPanelOpen: true }));
            if (event.altKey && !event.shiftKey && code === "Digit8") return run(() => editor.set({ rightTab: "design" }));
            if (event.altKey && !event.shiftKey && code === "Digit9") return run(() => editor.set({ rightTab: "prototype" }));
            if (event.shiftKey && code === "KeyH" && has) return flipSelection("x");
            if (event.shiftKey && code === "KeyV" && has) return flipSelection("y");
            if (event.shiftKey && code === "Digit1") return zoomToFit();
            if (event.shiftKey && code === "Digit2") return zoomToSelection();
            if (event.shiftKey && key === "enter") return selectParent();
            if ((key === "backspace" || key === "delete") && deleteSelectedConnection()) return run(() => undefined);
            if ((key === "backspace" || key === "delete") && has) return run(deleteSelection);
            if (key === "escape") {
                // Esc puts the Move tool back and steps the selection up: a nested layer selects its
                // parent; a top-level selection clears. The key is consumed so the desktop app's
                // Edit > Select none (shown as Esc) doesn't run on it as well and clear the parent.
                event.preventDefault();
                if (s.tool !== "move") editor.set({ tool: "move" });
                if (s.selection.length) selectParent();
                return;
            }
            if (key === "enter" && s.selection.length === 1) {
                const only = s.doc.nodes[s.selection[0] ?? ""];
                if (only && (only.type === "vector" || only.type === "rect" || only.type === "ellipse")) return run(() => enterVectorEdit(only.id));
                // run() keeps the Enter from reaching the text editor that opens on a text layer.
                return run(selectChildren);
            }
            if (key === "tab" && has) return run(() => selectSibling(event.shiftKey ? -1 : 1));
            // ] and [ bring to front and send to back; + and - zoom; ⇧0 zooms to 100%; Page Up/Down change page.
            if (!event.altKey && (code === "BracketRight" || code === "BracketLeft") && has) return run(() => reorder(code === "BracketRight" ? "front" : "back"));
            if (!event.altKey && (key === "=" || key === "+")) return run(() => keyZoom(2));
            if (!event.altKey && (key === "-" || key === "_")) return run(() => keyZoom(0.5));
            if (event.shiftKey && !event.altKey && code === "Digit0") return run(() => zoomTo(1));
            if (key === "pageup" || key === "pagedown") return run(() => stepPage(key === "pageup" ? -1 : 1));
            // Inspect: ← and → step through the top-level frames when one is selected.
            if (s.mode === "dev" && (key === "arrowleft" || key === "arrowright") && s.selection.length === 1) {
                const sel = s.doc.nodes[s.selection[0] ?? ""];
                if (sel && s.doc.nodes[sel.parentId ?? ""]?.type === "page" && (sel.type === "frame" || sel.type === "component" || sel.type === "componentSet")) return run(() => zoomToFrame(key === "arrowright" ? 1 : -1));
            }
            if (key.startsWith("arrow") && has) {
                const step = event.shiftKey ? s.prefs.nudgeBig : s.prefs.nudgeSmall;
                const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
                const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
                return run(() => nudge(dx, dy));
            }
            // With nothing selected the arrows pan the canvas (⇧ for a bigger step).
            if (key.startsWith("arrow") && !has && !event.altKey) {
                const step = event.shiftKey ? PAN_BIG : PAN_SMALL;
                const dx = key === "arrowleft" ? step : key === "arrowright" ? -step : 0;
                const dy = key === "arrowup" ? step : key === "arrowdown" ? -step : 0;
                return run(() => editor.set({ camera: { ...s.camera, x: s.camera.x + dx, y: s.camera.y + dy } }));
            }
            // ⇧D flips between Design and Inspect.
            // A slides file in design mode goes back to slides mode instead.
            if (event.shiftKey && !event.altKey && code === "KeyD") return run(() => (s.doc.slides ? slides.set({ mode: "slides" }) : setMode(s.mode === "dev" ? "design" : "dev")));
            const tool = event.shiftKey ? SHIFT_TOOL_KEYS[key] : TOOL_KEYS[key];
            if (tool && !event.altKey) editor.set({ tool });
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") keys.space = false;
            if (event.code === "KeyZ" && keys.z) {
                keys.z = false;
                editor.set({});
            }
            if (event.key === "Alt") {
                keys.alt = false;
                editor.set({});
            }
        };
        const onBlur = () => {
            keys.space = false;
            keys.z = false;
            keys.alt = false;
        };
        const onPaste = (event: ClipboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
            if (editor.get().editingTextId || editor.get().presentingId) return;
            event.preventDefault();
            const data = event.clipboardData;
            const text = data?.getData("text/plain") ?? "";
            const html = data?.getData("text/html") ?? "";
            // What wins when the clipboard holds several kinds: layers copied in another design
            // tool, then layers copied in Nagma, then pictures (image data or files), then the
            // pictures a web page's HTML shows, then SVG markup, an image link or text.
            if (hasCopiedLayers(html)) {
                void pasteCopiedLayers(html);
                return;
            }
            // Layers copied in this or another Nagma tab.
            if (pasteFromText(text)) return;
            const files = clipboardFiles(data);
            if (files.length) {
                void placeImages(files, viewCenter());
                return;
            }
            const sources = htmlImageSources(html);
            if (sources.length) {
                const at = viewCenter();
                void placeImageSources(sources, at).then((ok) => {
                    if (!ok) pasteImageFallback(text, sources);
                });
                return;
            }
            // The system clipboard is newer than the layers copied here unless that copy never
            // reached it; then the in-app clipboard wins.
            if (hasClipboard() && (!text.trim() || !clipboardMirrored())) return paste();
            if (!text.trim()) {
                // The desktop app: a picture on the system clipboard the paste event didn't carry.
                void desktopClipboardImage().then((file) => file && placeImages([file], viewCenter()));
                return;
            }
            // Text from elsewhere: SVG markup becomes layers, an image link an image, words a text layer.
            if (looksLikeSvg(text)) {
                const id = importSvg(text, viewCenter());
                if (id) return;
            }
            if (isImageUrl(text)) {
                void pasteImageUrl(text.trim());
                return;
            }
            pasteText(text);
        };
        // A copied picture that couldn't be fetched: its link (or the copied text) as text instead.
        const pasteImageFallback = (text: string, sources: string[]) => {
            const link = sources.find((s) => s.startsWith("https://"));
            if (text.trim()) pasteText(text);
            else if (link) pasteText(link);
            else editor.notify("That image couldn't be pasted.");
        };
        // Desktop app: the Edit menu's Copy and Cut reach the page as copy/cut events (macOS menu
        // shortcuts take the key press first), so layers are copied from those events there.
        const desktop = Boolean((window as unknown as { nagmaDesktop?: unknown }).nagmaDesktop);
        const textTarget = (t: EventTarget | null) => {
            const el = t as HTMLElement | null;
            return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable));
        };
        const onCopy = (event: ClipboardEvent) => {
            if (!desktop || textTarget(event.target) || editor.get().editingTextId || !editor.get().selection.length) return;
            event.preventDefault();
            copySelection();
        };
        const onCut = (event: ClipboardEvent) => {
            if (!desktop || textTarget(event.target) || editor.get().editingTextId || !editor.get().selection.length) return;
            event.preventDefault();
            cutSelection();
        };
        window.addEventListener("copy", onCopy);
        window.addEventListener("cut", onCut);
        window.addEventListener("paste", onPaste);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("paste", onPaste);
            window.removeEventListener("copy", onCopy);
            window.removeEventListener("cut", onCut);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
        };
    }, []);
}

// + and − (and ⌘+ ⌘−): about the middle of the view, or about the selection with Preferences ›
// Keyboard zooms into selection.
function keyZoom(factor: number) {
    const s = editor.get();
    const box = s.prefs.keyboardZoomSelection && s.selection.length ? selectionBounds(s.doc, s.selection) : null;
    if (!box) return zoomBy(factor);
    const center = worldToScreen(s.camera, box.x + box.w / 2, box.y + box.h / 2);
    editor.set({ camera: zoomAt(s.camera, center.x, center.y, s.camera.zoom * factor) });
}
