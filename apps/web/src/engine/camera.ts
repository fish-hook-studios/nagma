import { addTab } from "./files";
import { selectionBounds } from "./nodes";
import { protoTabId, setPrototypeStart } from "./prototype-view";
import { layerRoots } from "./page";
import { editor } from "./store";
import type { Camera, Rect } from "./types";

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 256;

// The canvas reports its size here so zoom commands from panels and shortcuts can centre content.
export const viewport = { width: 1, height: 1 };


export function clampZoom(zoom: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(camera: Camera, sx: number, sy: number) {
    return { x: (sx - camera.x) / camera.zoom, y: (sy - camera.y) / camera.zoom };
}

export function worldToScreen(camera: Camera, wx: number, wy: number) {
    return { x: wx * camera.zoom + camera.x, y: wy * camera.zoom + camera.y };
}

export function zoomAt(camera: Camera, sx: number, sy: number, nextZoom: number): Camera {
    const zoom = clampZoom(nextZoom);
    const world = screenToWorld(camera, sx, sy);
    return { zoom, x: sx - world.x * zoom, y: sy - world.y * zoom };
}

export function zoomBy(factor: number) {
    const { camera } = editor.get();
    editor.set({ camera: zoomAt(camera, viewport.width / 2, viewport.height / 2, camera.zoom * factor) });
}

export function zoomTo(zoom: number) {
    const { camera } = editor.get();
    editor.set({ camera: zoomAt(camera, viewport.width / 2, viewport.height / 2, zoom) });
}

export function fitRect(rect: Rect, maxPadding = 80, maxZoom = 1) {
    // A bad box (NaN from broken geometry) would leave the camera at NaN and the canvas blank.
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return;
    // Before the canvas has reported its size (hidden, or just mounted), measure it directly.
    if (viewport.width < 50 || viewport.height < 50) {
        const box = document.querySelector("canvas")?.parentElement?.getBoundingClientRect();
        if (box && box.width > 50 && box.height > 50) {
            viewport.width = box.width;
            viewport.height = box.height;
        }
    }
    const padding = Math.min(maxPadding, viewport.width * 0.1, viewport.height * 0.1);
    const availableW = Math.max(1, viewport.width - padding * 2);
    const availableH = Math.max(1, viewport.height - padding * 2);
    const zoom = clampZoom(Math.min(availableW / Math.max(rect.w, 1), availableH / Math.max(rect.h, 1), maxZoom));
    editor.set({
        camera: {
            zoom,
            x: viewport.width / 2 - (rect.x + rect.w / 2) * zoom,
            y: viewport.height / 2 - (rect.y + rect.h / 2) * zoom,
        },
    });
}

export function zoomToFit() {
    const { doc } = editor.get();
    const bounds = selectionBounds(doc, layerRoots(doc));
    if (bounds) fitRect(bounds);
}

// The view a page opens with the first time: fitted to its contents, or for an empty page the
// default view at 100% (it kept the zoom and scroll of whatever file was open before, so a new
// board opened at a slide deck's 47%).
export function openPageView() {
    const { doc } = editor.get();
    const bounds = selectionBounds(doc, layerRoots(doc));
    if (bounds) fitRect(bounds);
    else editor.set({ camera: { x: 0, y: 0, zoom: 1 } });
}

export function zoomToSelection() {
    const { doc, selection } = editor.get();
    const bounds = selectionBounds(doc, selection);
    if (bounds) fitRect(bounds, 80, 8);
}

// Presents from a screen: the file's prototype tab (opened beside the file's tab, or started over on
// this screen) comes to the front. The editor stays mounted underneath, so the canvas view is untouched.
export function startPresenting(frameId: string) {
    const s = editor.get();
    if (!s.doc.nodes[frameId]) return;
    setPrototypeStart(s.fileId ?? "", frameId);
    if (s.fileId) addTab(protoTabId(s.fileId), s.fileId);
    editor.set({ presentingId: frameId, homeOpen: false, hoverId: null, contextMenu: null });
}

// Back to the file's tab; the prototype's tab stays open.
export function stopPresenting() {
    editor.set({ presentingId: null });
}
