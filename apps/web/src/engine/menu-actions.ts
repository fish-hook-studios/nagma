// One table of the editor's commands, shared by the main menu, the canvas context menu and the
// Actions palette (⌘K), so a command reads, behaves and shows its shortcut the same everywhere.
import { zoomBy, zoomTo, zoomToFit, zoomToSelection } from "./camera";
import { collab, openSaveVersion } from "./collab";
import { copyLink } from "./links";
import { copyAsCss } from "./dev-css";
import { duplicateCurrentFile } from "./file-actions";
import {
    addAutoLayout,
    addPage,
    booleanSelection,
    copySelection,
    createComponent,
    cutSelection,
    deleteSelection,
    detachInstance,
    duplicateSelection,
    enterVectorEdit,
    flattenSelection,
    flipSelection,
    frameSelection,
    goToMainComponent,
    groupSelection,
    hasClipboard,
    outlineStroke,
    paste,
    pasteOverSelection,
    pasteToReplace,
    removeAutoLayout,
    reorder,
    resetOverrides,
    resizeToFit,
    sectionSelection,
    selectAll,
    toggleLock,
    toggleMask,
    toggleSection,
    toggleVisibility,
    ungroupSelection,
    viewCenter,
} from "./actions";
import { alignSelection, copyAs, copyAsText, copyProperties, distributeSelection, pasteProperties, renameSelection, rotateSelection, selectAllWith, selectInverse, selectMatching, stepPage, tidyUp, zoomToFrame } from "./arrange";
import { copyAsCode } from "./dev-code";
import { buildPdf, download } from "./export";
import { createFile, openFile, openHome, pickFigFile } from "./files";
import { pickImages } from "./images";
import { vectorUi } from "./vector-ui";
import { openLibraries } from "../components/library-ui";
import { suggestAutoLayout } from "./suggest-layout";
import { openActions, setMode } from "./modes";
import { layerRoots } from "./page";
import { openPathDialog } from "./path-ops";
import { closePluginConsole, openPluginConsole, pickPluginManifest, pluginStore, runLastPlugin } from "./plugins";
import { type EditorState, type Prefs, editor } from "./store";
import type { SceneNode } from "./types";
import { addTransform, applyTransforms } from "./repeat-actions";
import { createBrush } from "./custom-brushes";
import { togglePixelPreview } from "./pixel-preview";
import { openReadyView } from "./dev-view";
import { descendants } from "./commands";
import { createLink, indentParagraphs, setDirection, setTextAlign, setTextAlignV, setTextCase, stepFontSize, stepFontWeight, stepLetterSpacing, stepLineHeight, toggleBold, toggleDecoration, toggleItalic, toggleList } from "./text-actions";
import { convertToFrame, copyAnimatedSvg, deleteContents, distributeEdges, findFrame, findStep, hideOtherLayers, newPlugin, packSelection, roundToPixel, setAspectLock, setDefaultProperties, setSizing, showAiBalance, selectAllWidgets } from "./menu-extras";
import { bindProp, pushOverridesToMain, resetSlot, slotSelection, wrapInSlot } from "./component-actions";
import { collapseLayers, openFind, toggleShortcuts } from "./ui-state";
import { toggleCommentsHidden } from "./comments";
import { openCursorChat } from "./follow";
import { deleteSelectedVertices, joinSelectedVertices, removeFills, removeStrokes, splitVector, swapFillAndStroke } from "./vector-actions";

// What an item needs to do anything; without it the menus show the item disabled. The layer kinds:
// an instance, something ungroup takes apart (a group or a frame with layers), an auto layout frame,
// a frame or group to fit to its contents, a frame or section, a shape whose points can be edited.
export type Need = "selection" | "many" | "three" | "text" | "editing" | "undo" | "redo" | "clipboard" | "instance" | "ungroupable" | "autoLayout" | "fitFrame" | "frameOrSection" | "section" | "points" | "slot" | "parent";

export interface MenuAction {
    id: string;
    label: string;
    // Where it lives in the main menu; the palette shows it as the action's group.
    group: string;
    shortcut?: string;
    // Other words people search for.
    keywords?: string;
    needs?: Need[];
    // Toggles show a tick.
    checked?: (s: EditorState) => boolean;
    // Labels that read the state (Show or Hide).
    labelFor?: (s: EditorState) => string;
    run: () => void;
    // A feature this editor doesn't have: listed under its name, never enabled.
    unavailable?: boolean;
}

const pref = (key: keyof Prefs) => () => editor.setPrefs({ [key]: !editor.get().prefs[key] } as Partial<Prefs>);
const isOn = (key: keyof Prefs) => (s: EditorState) => Boolean(s.prefs[key]);

export const MENU_ACTIONS: MenuAction[] = [
    { id: "actions", label: "Actions…", group: "Menu", shortcut: "⌘ K", keywords: "quick actions search commands", run: openActions },
    { id: "home", label: "Back to files", group: "Menu", keywords: "home files browser", run: openHome },
    { id: "aiBalance", label: "Check AI balance", group: "Menu", keywords: "credits agent usage", run: () => void showAiBalance() },
    // File
    { id: "new", label: "New design", group: "File", keywords: "create file", run: () => void openFile(createFile("design").id) },
    { id: "fig", label: "Import…", group: "File", shortcut: "⇧ ⌘ I", keywords: "import open fig deck campaign pptx pdf image video", run: pickFigFile },
    { id: "pages", label: "Pages from PDF or InDesign…", group: "File", keywords: "import pdf indd", run: () => pickImages(viewCenter) },
    { id: "page", label: "Page in this file", group: "File", keywords: "add page new page", run: addPage },
    { id: "place", label: "Place image/video…", group: "File", shortcut: "⇧ ⌘ K", keywords: "import picture photo", run: () => pickImages(viewCenter) },
    { id: "duplicateFile", label: "Duplicate", group: "File", keywords: "copy file", run: () => void duplicateCurrentFile() },
    {
        id: "save",
        label: "Save local copy…",
        group: "File",
        keywords: "download backup",
        run: () => {
            const doc = editor.get().doc;
            download(new Blob([JSON.stringify(doc)], { type: "application/json" }), `${doc.name || "Untitled"}.nagma.json`);
        },
    },
    { id: "saveVersion", label: "Save to version history", group: "File", shortcut: "⌥ ⌘ S", keywords: "version checkpoint name", run: openSaveVersion },
    { id: "history", label: "Show version history", group: "File", keywords: "versions restore", run: () => collab.set({ historyOpen: true }) },
    {
        id: "branch",
        label: "Create branch…",
        group: "File",
        keywords: "branching",
        run: () => (collab.get().status === "local" ? editor.notify("Move this file to the server (Share) to create branches.") : collab.get().branch ? editor.notify("Branches are made from the main file.") : collab.set({ branchDialog: "create" })),
    },
    { id: "branches", label: "Show branches", group: "File", keywords: "branching merge", run: () => (collab.get().status === "local" ? editor.notify("This file has no branches yet.") : collab.set({ branchDialog: "list" })) },
    { id: "export", label: "Export…", group: "File", shortcut: "⇧ ⌘ E", keywords: "png download zip", run: () => vectorUi.set({ exportOpen: true }) },
    {
        id: "pdf",
        label: "Export frames to PDF…",
        group: "File",
        run: async () => {
            const s = editor.get();
            const blob = await buildPdf(s.doc, layerRoots(s.doc));
            if (blob) download(blob, `${s.doc.name || "Untitled"}.pdf`);
        },
    },
    {
        id: "copyToSlides",
        label: "Copy frames to slides",
        group: "File",
        needs: ["selection"],
        keywords: "presentation deck present",
        run: () => void import("../slides/from-design").then((m) => m.copyFramesToSlides()),
    },
    // Edit
    { id: "undo", label: "Undo", group: "Edit", shortcut: "⌘ Z", needs: ["undo"], run: () => editor.undo() },
    { id: "redo", label: "Redo", group: "Edit", shortcut: "⇧ ⌘ Z", needs: ["redo"], run: () => editor.redo() },
    { id: "copy", label: "Copy", group: "Edit", shortcut: "⌘ C", needs: ["selection"], run: copySelection },
    { id: "cut", label: "Cut", group: "Edit", shortcut: "⌘ X", needs: ["selection"], run: cutSelection },
    { id: "paste", label: "Paste", group: "Edit", shortcut: "⌘ V", needs: ["clipboard"], run: paste },
    { id: "pasteHere", label: "Paste here", group: "Edit", shortcut: "⌘ V", needs: ["clipboard"], run: paste },
    { id: "pasteOver", label: "Paste over selection", group: "Edit", shortcut: "⇧ ⌘ V", needs: ["clipboard"], run: pasteOverSelection },
    { id: "pasteReplace", label: "Paste to replace", group: "Edit", shortcut: "⇧ ⌘ R", needs: ["selection", "clipboard"], run: pasteToReplace },
    { id: "copyPng", label: "Copy as PNG", group: "Edit", shortcut: "⇧ ⌘ C", needs: ["selection"], run: () => void copyAs("png") },
    { id: "copySvg", label: "Copy as SVG", group: "Edit", needs: ["selection"], run: () => void copyAs("svg") },
    { id: "copyCssAll", label: "Copy as CSS (all layers)", group: "Edit", needs: ["selection"], keywords: "code style dev children", run: () => void copyAsCss(true) },
    { id: "copyAnimSvg", label: "Copy as animated SVG", group: "Edit", needs: ["selection"], keywords: "motion animation keyframes", run: () => void copyAnimatedSvg() },
    { id: "copyCss", label: "Copy as CSS", group: "Edit", needs: ["selection"], keywords: "code style dev", run: () => void copyAsCss() },
    { id: "copySwift", label: "Copy as iOS (SwiftUI)", group: "Edit", needs: ["selection"], keywords: "code swift apple dev", run: () => void copyAsCode("swiftui") },
    { id: "copyCompose", label: "Copy as Android (Compose)", group: "Edit", needs: ["selection"], keywords: "code kotlin jetpack dev", run: () => void copyAsCode("compose") },
    { id: "copyText", label: "Copy as text", group: "Edit", needs: ["selection"], run: () => void copyAsText() },
    { id: "copyLink", label: "Copy link to selection", group: "Edit", needs: ["selection"], keywords: "share url deep link", run: () => void copyLink("selection") },
    { id: "duplicate", label: "Duplicate", group: "Edit", shortcut: "⌘ D", needs: ["selection"], run: duplicateSelection },
    { id: "rename", label: "Rename…", group: "Edit", shortcut: "⌘ R", needs: ["selection"], keywords: "rename layers batch", run: renameSelection },
    { id: "delete", label: "Delete", group: "Edit", shortcut: "⌫", needs: ["selection"], run: deleteSelection },
    { id: "find", label: "Find", group: "Edit", shortcut: "⌘ F", keywords: "search layers text", run: () => openFind(false) },
    { id: "findNext", label: "Find next", group: "Edit", keywords: "search match", run: () => findStep(1) },
    { id: "findPrev", label: "Find previous", group: "Edit", keywords: "search match", run: () => findStep(-1) },
    { id: "setDefaults", label: "Set default properties", group: "Edit", needs: ["selection"], keywords: "new layers style text shape", run: setDefaultProperties },
    { id: "findReplace", label: "Find and replace…", group: "Edit", shortcut: "⇧ ⌘ F", keywords: "search replace text", run: () => openFind(true) },
    { id: "copyProps", label: "Copy properties", group: "Edit", shortcut: "⌥ ⌘ C", needs: ["selection"], run: copyProperties },
    { id: "pasteProps", label: "Paste properties", group: "Edit", shortcut: "⌥ ⌘ V", needs: ["selection"], run: pasteProperties },
    { id: "pickColor", label: "Pick color", group: "Edit", shortcut: "⌃ C", keywords: "eyedropper sample colour", run: () => editor.set({ tool: "eyedropper" }) },
    { id: "selectAll", label: "Select all", group: "Edit", shortcut: "⌘ A", run: selectAll },
    { id: "selectMatching", label: "Select matching layers", group: "Edit", shortcut: "⌥ ⌘ A", needs: ["selection"], keywords: "multi edit same", run: selectMatching },
    { id: "selectNone", label: "Select none", group: "Edit", shortcut: "Esc", needs: ["selection"], run: () => editor.set({ selection: [] }) },
    { id: "selectInverse", label: "Select inverse", group: "Edit", shortcut: "⇧ ⌘ A", run: selectInverse },
    { id: "sameProps", label: "Select all with same properties", group: "Edit", needs: ["selection"], keywords: "look style match", run: () => selectAllWith("properties") },
    { id: "sameFill", label: "Select all with same fill", group: "Edit", needs: ["selection"], run: () => selectAllWith("fill") },
    { id: "sameStroke", label: "Select all with same stroke", group: "Edit", needs: ["selection"], run: () => selectAllWith("stroke") },
    { id: "sameEffect", label: "Select all with same effect", group: "Edit", needs: ["selection"], keywords: "shadow blur", run: () => selectAllWith("effect") },
    { id: "sameText", label: "Select all with same text properties", group: "Edit", needs: ["selection"], run: () => selectAllWith("text") },
    { id: "sameFont", label: "Select all with same font", group: "Edit", needs: ["selection"], run: () => selectAllWith("font") },
    { id: "sameInstance", label: "Select all with same instance", group: "Edit", needs: ["selection"], run: () => selectAllWith("instance") },
    { id: "sameVariant", label: "Select all with same variant", group: "Edit", needs: ["selection", "instance"], run: () => selectAllWith("variant") },
    // View
    { id: "pixelGrid", label: "Pixel grid", group: "View", shortcut: "⇧ '", checked: isOn("pixelGrid"), run: pref("pixelGrid") },
    { id: "layoutGuides", label: "Layout guides", group: "View", shortcut: "⇧ G", checked: isOn("layoutGuides"), run: pref("layoutGuides") },
    { id: "rulers", label: "Rulers", group: "View", shortcut: "⇧ R", checked: isOn("rulers"), run: pref("rulers") },
    { id: "outlines", label: "Outlines", group: "View", shortcut: "⇧ ⌘ O", checked: isOn("outlines"), keywords: "wireframe", run: pref("outlines") },
    { id: "pixelPreview", label: "Pixel preview", group: "View", shortcut: "⌃ P", checked: isOn("pixelPreview"), run: togglePixelPreview },
    { id: "showSlices", label: "Show slices", group: "View", checked: isOn("showSlices"), keywords: "export regions", run: pref("showSlices") },
    { id: "maskOutlines", label: "Mask outlines", group: "View", checked: isOn("maskOutlines"), run: pref("maskOutlines") },
    { id: "frameOutlines", label: "Frame outlines", group: "View", checked: isOn("frameOutlines"), run: pref("frameOutlines") },
    { id: "memoryUsage", label: "Memory usage", group: "View", checked: isOn("memoryUsage"), keywords: "performance ram", run: pref("memoryUsage") },
    { id: "railMinimized", label: "Minimize left navigation bar", group: "View", checked: isOn("railMinimized"), keywords: "rail collapse", run: pref("railMinimized") },
    { id: "switchMode", label: "Switch to Inspect", group: "View", shortcut: "⇧ D", keywords: "inspect handoff design mode", labelFor: (s) => (s.mode === "dev" ? "Switch to Design" : "Switch to Inspect"), run: () => setMode(editor.get().mode === "dev" ? "design" : "dev") },
    { id: "layersPanel", label: "Open layers panel", group: "View", shortcut: "⌥ 1", keywords: "panels", run: () => editor.setPrefs({ leftPanel: "layers", leftPanelOpen: true }) },
    { id: "librariesPanel", label: "Libraries", group: "View", keywords: "panels assets", run: () => openLibraries() },
    { id: "designPanel", label: "Open design panel", group: "View", shortcut: "⌥ 8", keywords: "panels properties", run: () => editor.set({ rightTab: "design" }) },
    { id: "prototypePanel", label: "Open prototype panel", group: "View", shortcut: "⌥ 9", keywords: "panels interactions", run: () => editor.set({ rightTab: "prototype" }) },
    { id: "variablesPanel", label: "Toggle variables", group: "View", keywords: "panels tokens modes", run: () => (editor.get().prefs.leftPanel === "variables" && editor.get().prefs.leftPanelOpen ? editor.setPrefs({ leftPanel: "layers" }) : editor.setPrefs({ leftPanel: "variables", leftPanelOpen: true })) },
    { id: "prevPage", label: "Previous page", group: "View", shortcut: "⇞", run: () => stepPage(-1) },
    { id: "nextPage", label: "Next page", group: "View", shortcut: "⇟", run: () => stepPage(1) },
    { id: "findPrevFrame", label: "Find previous frame", group: "View", run: () => findFrame(-1) },
    { id: "findNextFrame", label: "Find next frame", group: "View", run: () => findFrame(1) },
    { id: "propertyLabels", label: "Additional labels", group: "View", checked: isOn("propertyLabels"), run: pref("propertyLabels") },
    // View › Comments shows or hides the comment pins (the C key picks the Comment tool).
    { id: "comments", label: "Comments", group: "View", shortcut: "⇧ C", keywords: "show hide pins", checked: () => !collab.get().commentsHidden, run: toggleCommentsHidden },
    { id: "commentTool", label: "Add comment", group: "View", shortcut: "C", keywords: "comment tool pin", run: () => editor.set({ tool: "comment" }) },
    { id: "toggleComments", label: "Show/Hide comments", group: "View", shortcut: "⇧ C", run: toggleCommentsHidden },
    { id: "cursorChat", label: "Cursor chat", group: "View", shortcut: "/", keywords: "message collaborators", run: openCursorChat },
    { id: "panels", label: "Show/Hide UI", group: "View", shortcut: "⌘ \\", keywords: "hide interface", run: () => editor.set({ uiHidden: !editor.get().uiHidden }) },
    { id: "minimize", label: "Minimize UI", group: "View", shortcut: "⇧ ⌘ \\", run: () => editor.set({ uiMinimized: !editor.get().uiMinimized }) },
    { id: "annotations", label: "Annotations", group: "View", checked: isOn("showAnnotations"), keywords: "measurements notes inspect show hide", run: pref("showAnnotations") },
    { id: "readyView", label: "Ready for development", group: "View", keywords: "inspect handoff dev status list", run: () => openReadyView() },
    { id: "cursors", label: "Multiplayer cursors", group: "View", shortcut: "⌥ ⌘ \\", checked: isOn("multiplayerCursors"), keywords: "collaborators show hide", run: pref("multiplayerCursors") },
    { id: "collapseLayers", label: "Collapse layers", group: "View", shortcut: "⌥ L", run: collapseLayers },
    { id: "zoomIn", label: "Zoom in", group: "View", shortcut: "⌘ +", run: () => zoomBy(2) },
    { id: "zoomOut", label: "Zoom out", group: "View", shortcut: "⌘ −", run: () => zoomBy(0.5) },
    { id: "zoom100", label: "Zoom to 100%", group: "View", shortcut: "⌘ 0", run: () => zoomTo(1) },
    { id: "fit", label: "Zoom to fit", group: "View", shortcut: "⇧ 1", run: zoomToFit },
    { id: "zoomSelection", label: "Zoom to selection", group: "View", shortcut: "⇧ 2", needs: ["selection"], run: zoomToSelection },
    { id: "nextFrame", label: "Zoom to next frame", group: "View", shortcut: "N", run: () => zoomToFrame(1) },
    { id: "prevFrame", label: "Zoom to previous frame", group: "View", shortcut: "⇧ N", run: () => zoomToFrame(-1) },
    // Object
    { id: "group", label: "Group selection", group: "Object", shortcut: "⌘ G", needs: ["selection"], run: groupSelection },
    { id: "ungroup", label: "Ungroup selection", group: "Object", shortcut: "⇧ ⌘ G", needs: ["selection", "ungroupable"], run: ungroupSelection },
    { id: "frame", label: "Frame selection", group: "Object", shortcut: "⌥ ⌘ G", needs: ["selection"], run: frameSelection },
    { id: "section", label: "Wrap in new section", group: "Object", shortcut: "⌘ S", needs: ["selection"], run: sectionSelection },
    { id: "toSection", label: "Convert to section", group: "Object", needs: ["selection", "frameOrSection"], run: toggleSection },
    { id: "toFrame", label: "Convert to frame", group: "Object", needs: ["selection", "section"], run: convertToFrame },
    { id: "lockAspect", label: "Lock aspect ratio", group: "Object", needs: ["selection"], keywords: "proportions constrain", run: () => setAspectLock(true) },
    { id: "unlockAspect", label: "Unlock aspect ratio", group: "Object", needs: ["selection"], keywords: "proportions constrain", run: () => setAspectLock(false) },
    { id: "hugW", label: "Set width to hug contents", group: "Object", needs: ["selection"], keywords: "auto layout sizing", run: () => setSizing("h", "hug") },
    { id: "hugH", label: "Set height to hug contents", group: "Object", needs: ["selection"], keywords: "auto layout sizing", run: () => setSizing("v", "hug") },
    { id: "fillW", label: "Set width to fill container", group: "Object", needs: ["selection", "parent"], keywords: "auto layout sizing", run: () => setSizing("h", "fill") },
    { id: "fillH", label: "Set height to fill container", group: "Object", needs: ["selection", "parent"], keywords: "auto layout sizing", run: () => setSizing("v", "fill") },
    { id: "toSlot", label: "Convert to slot", group: "Object", shortcut: "⇧ ⌘ S", needs: ["selection"], keywords: "component slots", run: () => slotSelection(editor.get().selection) },
    { id: "slotToFrame", label: "Convert to frame", group: "Object", needs: ["selection", "slot"], keywords: "component slots", run: slotToFrame },
    { id: "wrapSlot", label: "Wrap in new slot", group: "Object", needs: ["selection"], keywords: "component slots", run: () => wrapInSlot(editor.get().selection) },
    { id: "resetSlot", label: "Reset slot", group: "Object", needs: ["selection"], keywords: "component slots", run: () => editor.get().selection.forEach((id) => resetSlot(id)) },
    { id: "pushMain", label: "Push changes to main component", group: "Object", needs: ["selection", "instance"], run: () => editor.get().selection.forEach((id) => editor.get().doc.nodes[id]?.type === "instance" && pushOverridesToMain(id)) },
    { id: "restoreMain", label: "Restore main component", group: "Object", unavailable: true, run: () => undefined },
    { id: "hideOthers", label: "Hide other layers", group: "Object", needs: ["selection"], keywords: "isolate visibility", run: hideOtherLayers },
    { id: "deleteContents", label: "Delete contents", group: "Object", needs: ["selection"], keywords: "empty frame clear slot", run: deleteContents },
    { id: "resizeToFit", label: "Resize to fit", group: "Object", shortcut: "⌥ ⇧ ⌘ R", needs: ["selection", "fitFrame"], run: resizeToFit },
    { id: "mask", label: "Use as mask", group: "Object", shortcut: "⌃ ⌘ M", needs: ["selection"], labelFor: (s) => (s.selection.length === 1 && s.doc.nodes[s.selection[0] ?? ""]?.isMask ? "Remove mask" : "Use as mask"), run: toggleMask },
    { id: "layout", label: "Add auto layout", group: "Object", shortcut: "⇧ A", needs: ["selection"], run: addAutoLayout },
    { id: "suggestLayout", label: "Suggest auto layout", group: "Object", shortcut: "⌃ ⇧ A", needs: ["selection"], keywords: "detect rows columns", run: suggestAutoLayout },
    { id: "noLayout", label: "Remove auto layout", group: "Object", shortcut: "⌥ ⇧ A", needs: ["selection", "autoLayout"], run: removeAutoLayout },
    { id: "component", label: "Create component", group: "Object", shortcut: "⌥ ⌘ K", needs: ["selection"], run: createComponent },
    { id: "detach", label: "Detach instance", group: "Object", shortcut: "⌥ ⌘ B", needs: ["selection", "instance"], run: detachInstance },
    { id: "mainComponent", label: "Go to main component", group: "Object", needs: ["selection", "instance"], run: goToMainComponent },
    { id: "resetInstance", label: "Reset all changes", group: "Object", needs: ["selection", "instance"], run: resetOverrides },
    { id: "front", label: "Bring to front", group: "Object", shortcut: "]", needs: ["selection"], run: () => reorder("front") },
    { id: "forward", label: "Bring forward", group: "Object", shortcut: "⌘ ]", needs: ["selection"], run: () => reorder("forward") },
    { id: "backward", label: "Send backward", group: "Object", shortcut: "⌘ [", needs: ["selection"], run: () => reorder("backward") },
    { id: "back", label: "Send to back", group: "Object", shortcut: "[", needs: ["selection"], run: () => reorder("back") },
    { id: "flipx", label: "Flip horizontal", group: "Object", shortcut: "⇧ H", needs: ["selection"], run: () => flipSelection("x") },
    { id: "flipy", label: "Flip vertical", group: "Object", shortcut: "⇧ V", needs: ["selection"], run: () => flipSelection("y") },
    { id: "rot180", label: "Rotate 180°", group: "Object", needs: ["selection"], run: () => rotateSelection(180) },
    { id: "rotL", label: "Rotate 90° left", group: "Object", needs: ["selection"], run: () => rotateSelection(-90) },
    { id: "rotR", label: "Rotate 90° right", group: "Object", needs: ["selection"], run: () => rotateSelection(90) },
    { id: "flatten", label: "Flatten", group: "Object", shortcut: "⌘ E", needs: ["selection"], run: flattenSelection },
    { id: "outline", label: "Outline stroke", group: "Object", shortcut: "⌥ ⌘ O", needs: ["selection"], run: outlineStroke },
    { id: "splitVector", label: "Split vector", group: "Object", needs: ["selection"], keywords: "separate paths break apart", run: splitVector },
    { id: "brushStretch", label: "Create stretch brush", group: "Object", needs: ["selection"], keywords: "custom brush draw", run: () => createBrush("stretch") },
    { id: "brushScatter", label: "Create scatter brush", group: "Object", needs: ["selection"], keywords: "custom brush draw", run: () => createBrush("scatter") },
    {
        id: "removeInteractions",
        label: "Remove interactions",
        group: "Object",
        keywords: "prototype connections links clear page",
        // The selected layers and the layers inside them, or the whole page with nothing selected.
        run: () => {
            const s = editor.get();
            const roots = s.selection.length ? s.selection : [s.pageId];
            const ids = [...new Set(roots.flatMap((r) => [r, ...descendants(s.doc, r)]))].filter((id) => s.doc.nodes[id]?.interactions?.length);
            if (!ids.length) return editor.notify(s.selection.length ? "The selection has no interactions." : "This page has no interactions.");
            editor.execute({ type: "batch", commands: ids.map((id) => ({ type: "node.update" as const, id, patch: { interactions: [] } })) });
            editor.notify(`Removed the interactions on ${ids.length === 1 ? "1 layer" : `${ids.length} layers`}.`, { label: "Undo", run: () => editor.undo() });
        },
    },
    { id: "radialRepeat", label: "Add radial repeat", group: "Object", needs: ["selection"], keywords: "transform pattern", run: () => addTransform("radial") },
    { id: "linearRepeat", label: "Add linear repeat", group: "Object", needs: ["selection"], keywords: "transform pattern", run: () => addTransform("linear") },
    { id: "applyTransforms", label: "Apply transforms to selection", group: "Object", needs: ["selection"], keywords: "repeat", run: () => applyTransforms(editor.get().selection) },
    {
        id: "editPoints",
        label: "Edit points",
        group: "Object",
        shortcut: "↵",
        needs: ["selection", "points"],
        run: () => {
            const id = editor.get().selection[0];
            if (id) enterVectorEdit(id);
        },
    },
    { id: "union", label: "Union selection", group: "Object", shortcut: "⌥ ⇧ U", needs: ["many"], keywords: "boolean", run: () => booleanSelection("union") },
    { id: "subtract", label: "Subtract selection", group: "Object", shortcut: "⌥ ⇧ S", needs: ["many"], keywords: "boolean", run: () => booleanSelection("subtract") },
    { id: "intersect", label: "Intersect selection", group: "Object", shortcut: "⌥ ⇧ I", needs: ["many"], keywords: "boolean", run: () => booleanSelection("intersect") },
    { id: "exclude", label: "Exclude selection", group: "Object", shortcut: "⌥ ⇧ E", needs: ["many"], keywords: "boolean", run: () => booleanSelection("exclude") },
    { id: "visible", label: "Show/Hide selection", group: "Object", shortcut: "⇧ ⌘ H", needs: ["selection"], keywords: "visibility", labelFor: (s) => (s.selection.some((id) => s.doc.nodes[id]?.visible === false) ? "Show selection" : "Hide selection"), run: toggleVisibility },
    { id: "lock", label: "Lock/Unlock selection", group: "Object", shortcut: "⇧ ⌘ L", needs: ["selection"], labelFor: (s) => (s.selection.some((id) => s.doc.nodes[id]?.locked) ? "Unlock selection" : "Lock selection"), run: toggleLock },
    { id: "removeFill", label: "Remove fill", group: "Object", shortcut: "⌥ /", needs: ["selection"], run: removeFills },
    { id: "removeStroke", label: "Remove stroke", group: "Object", shortcut: "⇧ /", needs: ["selection"], run: removeStrokes },
    { id: "swapPaints", label: "Swap fill and stroke", group: "Object", shortcut: "⇧ X", needs: ["selection"], run: swapFillAndStroke },
    // Text
    { id: "bold", label: "Bold", group: "Text", shortcut: "⌘ B", needs: ["text"], run: toggleBold },
    { id: "italic", label: "Italic", group: "Text", shortcut: "⌘ I", needs: ["text"], run: toggleItalic },
    { id: "underline", label: "Underline", group: "Text", shortcut: "⌘ U", needs: ["text"], run: () => toggleDecoration("underline") },
    { id: "strike", label: "Strikethrough", group: "Text", shortcut: "⇧ ⌘ X", needs: ["text"], run: () => toggleDecoration("strikethrough") },
    { id: "link", label: "Create link", group: "Text", shortcut: "⇧ ⌘ U", needs: ["text"], run: createLink },
    { id: "bullets", label: "Bulleted list", group: "Text", shortcut: "⇧ ⌘ 8", needs: ["text"], run: () => toggleList("bullet") },
    { id: "numbers", label: "Numbered list", group: "Text", shortcut: "⇧ ⌘ 7", needs: ["text"], run: () => toggleList("number") },
    { id: "ltr", label: "Left to right", group: "Text", needs: ["text"], keywords: "direction", run: () => setDirection("ltr") },
    { id: "rtl", label: "Right to left", group: "Text", needs: ["text"], keywords: "direction", run: () => setDirection("rtl") },
    { id: "alignL", label: "Text align left", group: "Text", shortcut: "⌥ ⌘ L", needs: ["text"], run: () => setTextAlign("left") },
    { id: "alignC", label: "Text align center", group: "Text", shortcut: "⌥ ⌘ T", needs: ["text"], run: () => setTextAlign("center") },
    { id: "alignR", label: "Text align right", group: "Text", shortcut: "⌥ ⌘ R", needs: ["text"], run: () => setTextAlign("right") },
    { id: "alignJ", label: "Text align justified", group: "Text", shortcut: "⌥ ⌘ J", needs: ["text"], run: () => setTextAlign("justify") },
    { id: "alignTop", label: "Text align top", group: "Text", needs: ["text"], run: () => setTextAlignV("top") },
    { id: "alignMiddle", label: "Text align middle", group: "Text", needs: ["text"], run: () => setTextAlignV("middle") },
    { id: "alignBottom", label: "Text align bottom", group: "Text", needs: ["text"], run: () => setTextAlignV("bottom") },
    { id: "indentMore", label: "Increase indentation", group: "Text", shortcut: "⌘ ]", needs: ["text"], keywords: "list level", run: () => indentParagraphs(1) },
    { id: "indentLess", label: "Decrease indentation", group: "Text", shortcut: "⌘ [", needs: ["text"], keywords: "list level", run: () => indentParagraphs(-1) },
    { id: "lineUp", label: "Increase line height", group: "Text", shortcut: "⌥ ⇧ >", needs: ["text"], run: () => stepLineHeight(1) },
    { id: "lineDown", label: "Decrease line height", group: "Text", shortcut: "⌥ ⇧ <", needs: ["text"], run: () => stepLineHeight(-1) },
    { id: "spacingUp", label: "Increase letter spacing", group: "Text", shortcut: "⌥ >", needs: ["text"], run: () => stepLetterSpacing(1) },
    { id: "spacingDown", label: "Decrease letter spacing", group: "Text", shortcut: "⌥ <", needs: ["text"], run: () => stepLetterSpacing(-1) },
    { id: "originalCase", label: "Original case", group: "Text", needs: ["text"], keywords: "case reset", run: () => setTextCase("none") },
    { id: "spellCheck", label: "Spell check", group: "Text", checked: isOn("spellCheck"), keywords: "spelling typos", run: pref("spellCheck") },
    { id: "textSuggestions", label: "Show text suggestions", group: "Text", unavailable: true, checked: () => false, run: () => undefined },
    { id: "sizeUp", label: "Increase font size", group: "Text", shortcut: "⇧ ⌘ >", needs: ["text"], run: () => stepFontSize(1) },
    { id: "sizeDown", label: "Decrease font size", group: "Text", shortcut: "⇧ ⌘ <", needs: ["text"], run: () => stepFontSize(-1) },
    { id: "weightUp", label: "Increase font weight", group: "Text", shortcut: "⌥ ⌘ >", needs: ["text"], run: () => stepFontWeight(1) },
    { id: "weightDown", label: "Decrease font weight", group: "Text", shortcut: "⌥ ⌘ <", needs: ["text"], run: () => stepFontWeight(-1) },
    { id: "upper", label: "Uppercase", group: "Text", needs: ["text"], keywords: "case", run: () => setTextCase("upper") },
    { id: "lower", label: "Lowercase", group: "Text", needs: ["text"], keywords: "case", run: () => setTextCase("lower") },
    { id: "title", label: "Title case", group: "Text", needs: ["text"], keywords: "case", run: () => setTextCase("title") },
    // Arrange
    { id: "aLeft", label: "Align left", group: "Arrange", shortcut: "⌥ A", needs: ["selection"], run: () => alignSelection("left") },
    { id: "aH", label: "Align horizontal centers", group: "Arrange", shortcut: "⌥ H", needs: ["selection"], run: () => alignSelection("hcenter") },
    { id: "aRight", label: "Align right", group: "Arrange", shortcut: "⌥ D", needs: ["selection"], run: () => alignSelection("right") },
    { id: "aTop", label: "Align top", group: "Arrange", shortcut: "⌥ W", needs: ["selection"], run: () => alignSelection("top") },
    { id: "aV", label: "Align vertical centers", group: "Arrange", shortcut: "⌥ V", needs: ["selection"], run: () => alignSelection("vcenter") },
    { id: "aBottom", label: "Align bottom", group: "Arrange", shortcut: "⌥ S", needs: ["selection"], run: () => alignSelection("bottom") },
    { id: "tidy", label: "Tidy up", group: "Arrange", shortcut: "⌃ ⌥ T", needs: ["selection"], run: () => tidyUp() },
    { id: "distH", label: "Distribute horizontal spacing", group: "Arrange", shortcut: "⌃ ⌥ H", needs: ["three"], run: () => distributeSelection("h") },
    { id: "distV", label: "Distribute vertical spacing", group: "Arrange", shortcut: "⌃ ⌥ V", needs: ["three"], run: () => distributeSelection("v") },
    { id: "roundPixel", label: "Round to pixel", group: "Arrange", needs: ["selection"], keywords: "whole pixels snap", run: roundToPixel },
    { id: "packH", label: "Pack horizontal", group: "Arrange", needs: ["many"], run: () => packSelection("h") },
    { id: "packV", label: "Pack vertical", group: "Arrange", needs: ["many"], run: () => packSelection("v") },
    { id: "distLeft", label: "Distribute left", group: "Arrange", needs: ["three"], run: () => distributeEdges("left") },
    { id: "distHC", label: "Distribute horizontal centers", group: "Arrange", needs: ["three"], run: () => distributeEdges("hcenter") },
    { id: "distRight", label: "Distribute right", group: "Arrange", needs: ["three"], run: () => distributeEdges("right") },
    { id: "distTop", label: "Distribute top", group: "Arrange", needs: ["three"], run: () => distributeEdges("top") },
    { id: "distVC", label: "Distribute vertical centers", group: "Arrange", needs: ["three"], run: () => distributeEdges("vcenter") },
    { id: "distBottom", label: "Distribute bottom", group: "Arrange", needs: ["three"], run: () => distributeEdges("bottom") },
    // Vector
    { id: "join", label: "Join selection", group: "Vector", shortcut: "⌘ J", needs: ["editing"], run: () => joinSelectedVertices(false) },
    { id: "smoothJoin", label: "Smooth join selection", group: "Vector", shortcut: "⇧ ⌘ J", needs: ["editing"], run: () => joinSelectedVertices(true) },
    { id: "heal", label: "Delete and heal selection", group: "Vector", shortcut: "⇧ ⌫", needs: ["editing"], run: () => deleteSelectedVertices(true) },
    { id: "simplifyPath", label: "Simplify vector", group: "Vector", keywords: "reduce points smooth clean path", needs: ["selection"], run: () => openPathDialog("simplify") },
    { id: "offsetPath", label: "Offset vector", group: "Vector", keywords: "outset inset grow shrink contour", needs: ["selection"], run: () => openPathDialog("offset") },
    // Preferences
    { id: "snapObjects", label: "Snap to objects", group: "Preferences", checked: isOn("snapToObjects"), run: pref("snapToObjects") },
    { id: "snapGeometry", label: "Snap to geometry", group: "Preferences", keywords: "vector points snapping", checked: isOn("snapToGeometry"), run: pref("snapToGeometry") },
    { id: "snapPixel", label: "Snap to pixel grid", group: "Preferences", shortcut: "⇧ ⌘ '", checked: isOn("snapToPixel"), run: pref("snapToPixel") },
    { id: "keepTool", label: "Keep tool selected after use", group: "Preferences", checked: isOn("keepTool"), run: pref("keepTool") },
    { id: "renameDup", label: "Rename duplicated layers", group: "Preferences", checked: isOn("renameDuplicates"), run: pref("renameDuplicates") },
    { id: "hideUi", label: "Hide canvas UI during changes", group: "Preferences", checked: isOn("hideUiDuringChanges"), run: pref("hideUiDuringChanges") },
    { id: "flipResize", label: "Flip objects while resizing", group: "Preferences", checked: isOn("flipWhileResizing"), run: pref("flipWhileResizing") },
    { id: "hover", label: "Highlight layers on hover", group: "Preferences", checked: isOn("highlightHover"), run: pref("highlightHover") },
    { id: "dims", label: "Show dimensions on objects", group: "Preferences", checked: isOn("showDimensions"), run: pref("showDimensions") },
    { id: "invert", label: "Invert zoom direction", group: "Preferences", checked: isOn("invertZoom"), run: pref("invertZoom") },
    { id: "scrollZoom", label: "Use scroll wheel zoom", group: "Preferences", keywords: "mouse wheel zoom navigation", checked: isOn("scrollZoom"), run: pref("scrollZoom") },
    { id: "rightPan", label: "Right-click and drag to pan", group: "Preferences", keywords: "navigation mouse", checked: isOn("rightClickPan"), run: pref("rightClickPan") },
    { id: "colorManaged", label: "Managed (file's profile)", group: "Preferences", keywords: "color profile p3 srgb", checked: isOn("colorManaged"), run: () => editor.setPrefs({ colorManaged: true }) },
    { id: "colorUnmanaged", label: "Unmanaged (sRGB)", group: "Preferences", keywords: "color profile p3 srgb", checked: (s) => !s.prefs.colorManaged, run: () => editor.setPrefs({ colorManaged: false }) },
    { id: "accessibility", label: "Accessibility settings…", group: "Preferences", keywords: "focus motion a11y", run: openAccessibilitySettings },
    { id: "desktopLinks", label: "Open links in desktop app", group: "Preferences", keywords: "desktop app nagma links", checked: isOn("openLinksInDesktop"), run: pref("openLinksInDesktop") },
    { id: "smartSymbols", label: "Use smart quotes/symbols", group: "Preferences", keywords: "arrows copyright ellipsis typography substitutions autocorrect", checked: isOn("smartSymbols"), run: pref("smartSymbols") },
    { id: "keyZoomSel", label: "Keyboard zooms into selection", group: "Preferences", checked: isOn("keyboardZoomSelection"), run: pref("keyboardZoomSelection") },
    { id: "ctrlClick", label: "Ctrl+click opens right click menus", group: "Preferences", checked: isOn("ctrlClickMenus"), keywords: "context menu control", run: pref("ctrlClickMenus") },
    { id: "oldOutlines", label: "Use old shortcuts for outlines", group: "Preferences", checked: isOn("oldOutlineShortcuts"), keywords: "command y", run: pref("oldOutlineShortcuts") },
    { id: "rotateKeys", label: "Use ⌘⌥↑/↓ to rotate layers", group: "Preferences", unavailable: true, checked: () => false, run: () => undefined },
    { id: "aiSound", label: "Play audio notifications in AI chat", group: "Preferences", checked: isOn("aiChatSound"), keywords: "sound agent", run: pref("aiChatSound") },
    { id: "prefTextSuggestions", label: "Show text suggestions", group: "Preferences", unavailable: true, checked: () => false, run: () => undefined },
    { id: "toolSuggestions", label: "Show tool suggestions", group: "Preferences", unavailable: true, checked: () => false, run: () => undefined },
    { id: "agentsOnCanvas", label: "Show Agents on canvas", group: "Preferences", unavailable: true, checked: () => false, run: () => undefined },
    { id: "opacityKeys", label: "Use number keys for opacity", group: "Preferences", checked: isOn("numberKeysOpacity"), run: pref("numberKeysOpacity") },
    { id: "themeLight", label: "Light", group: "Preferences", keywords: "theme appearance", checked: (s) => s.prefs.theme === "light", run: () => editor.setPrefs({ theme: "light" }) },
    { id: "themeDark", label: "Dark", group: "Preferences", keywords: "theme appearance", checked: (s) => s.prefs.theme === "dark", run: () => editor.setPrefs({ theme: "dark" }) },
    { id: "theme", label: "Theme", group: "Preferences", keywords: "dark light appearance", labelFor: (s) => `Theme: ${s.prefs.theme === "dark" ? "Dark" : "Light"}`, run: () => editor.setPrefs({ theme: editor.get().prefs.theme === "dark" ? "light" : "dark" }) },
    { id: "nudge", label: "Nudge amount…", group: "Preferences", run: () => editor.setPrefs({ leftPanel: "settings", leftPanelOpen: true }) },
    { id: "settings", label: "All settings…", group: "Preferences", run: () => editor.setPrefs({ leftPanel: "settings", leftPanelOpen: true }) },
    // Plugins, libraries, help
    { id: "plugins", label: "Manage plugins…", group: "Plugins", keywords: "plugins tools installed", run: () => editor.setPrefs({ leftPanel: "tools", leftPanelOpen: true }) },
    { id: "newPlugin", label: "New plugin…", group: "Plugins", keywords: "plugin development create template", run: () => void newPlugin() },
    { id: "pluginDocs", label: "View API documentation", group: "Plugins", keywords: "plugin development api docs", run: () => window.open("https://github.com/fish-hook-studios/nagma/tree/main/apps/web/public/plugins", "_blank", "noopener") },
    { id: "devVm", label: "Use developer VM", group: "Plugins", unavailable: true, run: () => undefined },
    { id: "hotReload", label: "Hot reload plugin", group: "Plugins", unavailable: true, run: () => undefined },
    { id: "importWidget", label: "Import widget from manifest…", group: "Plugins", keywords: "widget development manifest", run: pickPluginManifest },
    { id: "manageWidgets", label: "Manage widgets…", group: "Plugins", keywords: "widget insert interactive", run: openWidgets },
    { id: "selectWidgets", label: "Select all widgets", group: "Plugins", keywords: "widget", run: selectAllWidgets },
    { id: "importPlugin", label: "Import plugin from manifest…", group: "Plugins", keywords: "plugin development manifest", run: pickPluginManifest },
    { id: "runLastPlugin", label: "Run last plugin", group: "Plugins", shortcut: "⌥ ⌘ P", keywords: "plugin again repeat", run: runLastPlugin },
    { id: "pluginConsole", label: "Show/Hide console", group: "Plugins", keywords: "plugin development console log errors", run: () => (pluginStore.get().consoleOpen ? closePluginConsole() : openPluginConsole()) },
    { id: "widgets", label: "Widgets", group: "Menu", keywords: "widget insert interactive", run: openWidgets },
    { id: "libraries", label: "Libraries", group: "Menu", keywords: "assets components publish enable", run: () => openLibraries() },
    { id: "gettingStarted", label: "Get started", group: "Help", keywords: "welcome onboarding first run server ai key", run: () => void import("./onboarding").then((m) => m.openWelcome()) },
    { id: "shortcuts", label: "Keyboard shortcuts", group: "Help", shortcut: "⌃ ⇧ ?", keywords: "keys hotkeys cheat sheet", run: toggleShortcuts },
    { id: "help", label: "Help page", group: "Help", run: () => window.open("https://github.com/fish-hook-studios/nagma#readme", "_blank", "noopener") },
    { id: "forum", label: "Support forum", group: "Help", keywords: "community questions discussions", run: () => window.open("https://github.com/fish-hook-studios/nagma/discussions", "_blank", "noopener") },
    { id: "tutorials", label: "Video tutorials", group: "Help", unavailable: true, run: () => undefined },
    { id: "releaseNotes", label: "Release notes", group: "Help", keywords: "changes new version", run: () => window.open("https://github.com/fish-hook-studios/nagma/releases", "_blank", "noopener") },
    { id: "reportProblem", label: "Report a problem…", group: "Help", keywords: "bug issue feedback", run: () => window.open("https://github.com/fish-hook-studios/nagma/issues/new", "_blank", "noopener") },
    { id: "resources", label: "Community and resources", group: "Help", keywords: "community templates files", run: openHome },
    { id: "account", label: "Account settings…", group: "Help", keywords: "password notifications profile", run: () => openSettingsAt("account") },
    { id: "accountTokens", label: "Personal access tokens…", group: "Help", keywords: "tokens api mcp extension", run: () => openSettingsAt("tokens") },
    // Open signed out too: a key for this browser or this computer.
    { id: "aiSettings", label: "AI settings…", group: "Help", keywords: "ai key api claude openai model provider local", run: () => void import("./ai-settings").then((m) => m.openAiSettings()) },
    { id: "signOut", label: "Sign out", group: "Help", keywords: "log out account", run: () => void import("./auth").then((m) => m.signOut()).then(() => editor.notify("Signed out.")) },
    // Modes
    { id: "modeDesign", label: "Design mode", group: "Modes", run: () => setMode("design") },
    { id: "modeDraw", label: "Draw mode", group: "Modes", run: () => setMode("draw") },
    { id: "modeMotion", label: "Motion mode", group: "Modes", run: () => setMode("motion") },
    { id: "modeDev", label: "Inspect", group: "Modes", shortcut: "⇧ D", run: () => setMode("dev") },
];

// Widgets: the Tools panel, at its Widgets list.
function openWidgets() {
    editor.setPrefs({ leftPanel: "tools", leftPanelOpen: true });
    requestAnimationFrame(() => document.getElementById("tools-widgets")?.scrollIntoView({ block: "start" }));
}

// Object › Slots › Convert to frame: the slot goes back to being a plain frame.
function slotToFrame() {
    const s = editor.get();
    const ids = s.selection.filter((id) => s.doc.nodes[id]?.propBindings?.slot);
    for (const id of ids) bindProp(id, "slot", null);
}

function openAccessibilitySettings() {
    editor.setPrefs({ leftPanel: "settings", leftPanelOpen: true });
    requestAnimationFrame(() => document.getElementById("settings-accessibility")?.scrollIntoView({ block: "start" }));
}

export const ACTION_BY_ID = new Map(MENU_ACTIONS.map((a) => [a.id, a]));

// Whether an action can run in the current state.
const KIND_NEEDS: Partial<Record<Need, (n: SceneNode) => boolean>> = {
    instance: (n) => n.type === "instance",
    ungroupable: (n) => (n.type === "group" || n.type === "frame") && n.children.length > 0,
    autoLayout: (n) => Boolean(n.layout),
    fitFrame: (n) => (n.type === "frame" || n.type === "component" || n.type === "group") && n.children.length > 0 && !n.layout,
    frameOrSection: (n) => n.type === "frame" && !n.isSection,
    section: (n) => Boolean(n.isSection),
    points: (n) => (n.type === "vector" || n.type === "rect" || n.type === "ellipse") && !n.sourceId,
};

export function actionEnabled(action: MenuAction, s: EditorState = editor.get()): boolean {
    if (action.unavailable) return false;
    const has = s.selection.length > 0;
    for (const need of action.needs ?? []) {
        if (need === "selection" && !has) return false;
        if (need === "many" && s.selection.length < 2) return false;
        if (need === "three" && s.selection.length < 3) return false;
        if (need === "text" && !s.selection.some((id) => s.doc.nodes[id]?.type === "text")) return false;
        if (need === "editing" && !s.editingVectorId) return false;
        if (need === "undo" && !s.past.length) return false;
        if (need === "redo" && !s.future.length) return false;
        if (need === "clipboard" && !hasClipboard()) return false;
        if (need === "slot" && !s.selection.some((id) => Boolean(s.doc.nodes[id]?.propBindings?.slot))) return false;
        if (need === "parent" && !s.selection.some((id) => Boolean(s.doc.nodes[s.doc.nodes[id]?.parentId ?? ""]?.layout))) return false;
        const kind = KIND_NEEDS[need as keyof typeof KIND_NEEDS];
        if (kind && !s.selection.some((id) => {
            const n = s.doc.nodes[id];
            return Boolean(n && kind(n));
        })) return false;
    }
    return true;
}

export function actionLabel(action: MenuAction, s: EditorState = editor.get()): string {
    return action.labelFor?.(s) ?? action.label;
}

export function runAction(id: string) {
    const action = ACTION_BY_ID.get(id);
    if (action && actionEnabled(action)) action.run();
}

// The main menu's layout: action ids, separators ("-"), submenus, and the Move to page list.
export type MenuNode = string | { sub: string; label: string; items: MenuNode[] };

export const MAIN_MENU: MenuNode[] = [
    "actions",
    "-",
    {
        sub: "file",
        label: "File",
        items: ["new", { sub: "newKinds", label: "New", items: ["fig", "pages", "page"] }, "-", "place", "-", "duplicateFile", "save", "-", "saveVersion", "history", "-", "branch", "branches", "-", "export", "pdf", "copyToSlides"],
    },
    {
        sub: "edit",
        label: "Edit",
        items: [
            "undo",
            "redo",
            "-",
            "copy",
            "cut",
            "paste",
            { sub: "copyAs", label: "Copy as", items: ["copyText", "copyCss", "copyCssAll", "copySwift", "copyCompose", "-", "copySvg", "copyAnimSvg", "copyPng", "-", "copyLink"] },
            "pasteOver",
            "pasteReplace",
            "duplicate",
            "rename",
            "delete",
            "-",
            "find",
            "findNext",
            "findPrev",
            "findReplace",
            "-",
            "setDefaults",
            "copyProps",
            "pasteProps",
            "pickColor",
            "-",
            "selectAll",
            "selectMatching",
            "selectNone",
            "selectInverse",
            { sub: "selectWith", label: "Select all with", items: ["sameProps", "sameFill", "sameStroke", "sameEffect", "sameText", "sameFont", "sameInstance", "sameVariant"] },
        ],
    },
    {
        sub: "view",
        label: "View",
        items: [
            "pixelGrid",
            "layoutGuides",
            "rulers",
            "showSlices",
            "comments",
            "annotations",
            "outlines",
            "pixelPreview",
            "maskOutlines",
            "frameOutlines",
            "propertyLabels",
            "-",
            "memoryUsage",
            "railMinimized",
            "minimize",
            "panels",
            "cursors",
            "collapseLayers",
            "-",
            "switchMode",
            { sub: "panelsMenu", label: "Panels", items: ["layersPanel", "librariesPanel", "designPanel", "prototypePanel", "variablesPanel"] },
            "-",
            "zoomIn",
            "zoomOut",
            "zoom100",
            "fit",
            "zoomSelection",
            "-",
            "prevPage",
            "nextPage",
            "-",
            "prevFrame",
            "nextFrame",
            "findPrevFrame",
            "findNextFrame",
        ],
    },
    {
        sub: "object",
        label: "Object",
        items: [
            "frame",
            "group",
            "ungroup",
            "section",
            "toSection",
            "toFrame",
            "mask",
            "moveToPage",
            "-",
            "layout",
            { sub: "moreLayout", label: "More layout options", items: ["suggestLayout", "noLayout", "-", "lockAspect", "unlockAspect", "resizeToFit", "-", "hugW", "hugH", "fillW", "fillH"] },
            "-",
            "component",
            { sub: "slots", label: "Slots", items: ["toSlot", "slotToFrame", "wrapSlot", "resetSlot"] },
            "resetInstance",
            "detach",
            { sub: "mainComponentMenu", label: "Main component", items: ["mainComponent", "pushMain", "restoreMain"] },
            "-",
            "front",
            "forward",
            "backward",
            "back",
            "-",
            "flipx",
            "flipy",
            "rot180",
            "rotL",
            "rotR",
            "-",
            "flatten",
            "outline",
            "editPoints",
            { sub: "booleans", label: "Boolean groups", items: ["union", "subtract", "intersect", "exclude"] },
            "-",
            "visible",
            "lock",
            "hideOthers",
            "-",
            "removeFill",
            "removeStroke",
            "swapPaints",
            "-",
            "removeInteractions",
            "deleteContents",
        ],
    },
    {
        sub: "text",
        label: "Text",
        items: [
            "bold",
            "italic",
            "underline",
            "strike",
            "link",
            "-",
            "bullets",
            "numbers",
            "-",
            { sub: "textAlign", label: "Alignment", items: ["alignL", "alignC", "alignR", "alignJ", "-", "alignTop", "alignMiddle", "alignBottom"] },
            { sub: "textAdjust", label: "Adjust", items: ["indentMore", "indentLess", "-", "sizeUp", "sizeDown", "weightUp", "weightDown", "-", "lineUp", "lineDown", "spacingUp", "spacingDown"] },
            { sub: "textCase", label: "Case", items: ["originalCase", "upper", "lower", "title"] },
            { sub: "textDirection", label: "Text direction", items: ["ltr", "rtl"] },
            "-",
            "spellCheck",
        ],
    },
    {
        sub: "arrange",
        label: "Arrange",
        items: ["roundPixel", "-", "aLeft", "aH", "aRight", "aTop", "aV", "aBottom", "-", "tidy", "packH", "packV", "-", "distH", "distV", "-", "distLeft", "distHC", "distRight", "distTop", "distVC", "distBottom"],
    },
    { sub: "vector", label: "Vector", items: ["join", "smoothJoin", "heal", "-", "splitVector", "simplifyPath", "offsetPath"] },
    "-",
    { sub: "pluginsMenu", label: "Plugins", items: ["runLastPlugin", { sub: "pluginDev", label: "Development", items: ["newPlugin", "importPlugin", "-", "pluginDocs", "pluginConsole"] }, "-", "plugins"] },
    { sub: "widgetsMenu", label: "Widgets", items: [{ sub: "widgetDev", label: "Development", items: ["importWidget"] }, "-", "manageWidgets", "selectWidgets"] },
    {
        sub: "prefs",
        label: "Preferences",
        items: [
            "snapGeometry",
            "snapObjects",
            "snapPixel",
            "-",
            "keepTool",
            "hover",
            "renameDup",
            "dims",
            "hideUi",
            "smartSymbols",
            "flipResize",
            "keyZoomSel",
            "invert",
            "ctrlClick",
            "opacityKeys",
            "oldOutlines",
            "rotateKeys",
            "aiSound",
            "desktopLinks",
            "prefTextSuggestions",
            "toolSuggestions",
            "agentsOnCanvas",
            "-",
            "scrollZoom",
            "rightPan",
            "-",
            { sub: "themeMenu", label: "Theme", items: ["themeLight", "themeDark"] },
            { sub: "colorProfile", label: "Color profile", items: ["colorManaged", "colorUnmanaged"] },
            "accessibility",
            "nudge",
            "settings",
        ],
    },
    "libraries",
    "-",
    { sub: "aiBalanceMenu", label: "AI balance", items: ["aiBalance"] },
    { sub: "helpMenu", label: "Help and account", items: ["gettingStarted", "help", "shortcuts", "forum", "releaseNotes", "reportProblem", "resources", "-", "account", "accountTokens", "signOut"] },
];

// Every action with the menu path it sits under, for search ("Object › Boolean groups › Union selection").
export function menuPaths(): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (nodes: MenuNode[], path: string[]) => {
        for (const node of nodes) {
            if (typeof node === "string") {
                if (node !== "-") out.set(node, path.join(" › "));
            } else walk(node.items, [...path, node.label]);
        }
    };
    walk(MAIN_MENU, []);
    return out;
}

// The one Account settings dialog (components/account-settings.tsx), at a tab; signed out, sign in first.
function openSettingsAt(tab: "account" | "tokens") {
    void Promise.all([import("./auth"), import("./account")]).then(([a, acc]) => (a.auth.get().user ? acc.openAccountSettings(tab) : a.openSignIn()));
}
