import { useSyncExternalStore } from "react";
import { editor } from "./store";
import type { Paint } from "./types";

// Viewer state for the vector, draw, image and export tools that isn't part of the document: the
// image being cropped, the files waiting to be placed, the width point being edited, the export
// modal and so on. Changes redraw the canvas.

export interface PlaceItem {
    file: File;
    // A small preview for the cursor badge.
    thumb: string | null;
}

export interface VectorUiState {
    // Image crop mode: the layer and which of its fills is cropped.
    crop: { nodeId: string; paintIndex: number } | null;
    // Place image/video: files still to place, in order.
    place: PlaceItem[];
    // The width point picked with the Variable width tool (index into the layer's width points).
    widthPoint: number | null;
    // The bulk Export modal (⇧⌘E).
    exportOpen: boolean;
    // Brush menu (Draw mode): which brush the next brush stroke uses.
    brush: string;
    // Points being edited across several vectors (⇧click another vector while editing).
    extraVectors: string[];
    // The Erase tool's weight (brush diameter, canvas units) and its brush shape.
    eraserSize: number;
    eraserShape: "round" | "square";
    // The Paint tool's fill: solid (the draw colour) or a gradient from it to a second colour.
    paintKind: "solid" | "linear" | "radial";
    paintColor2: string;
}

function savedBrush(): string {
    try {
        const saved = localStorage.getItem("nagma.brush");
        return saved && !BASIC_BRUSHES.has(saved) ? saved : "stretch-pencil";
    } catch {
        return "stretch-pencil";
    }
}

// Brushes the menu no longer lists (they are width profiles); a remembered one falls back to the default.
const BASIC_BRUSHES = new Set(["round", "taper", "ink", "wedge", "pulse", "marker", "dotted"]);

let state: VectorUiState = { crop: null, place: [], widthPoint: null, exportOpen: false, brush: savedBrush(), extraVectors: [], eraserSize: 12, eraserShape: "round", paintKind: "solid", paintColor2: "#000000" };
const listeners = new Set<() => void>();

export const vectorUi = {
    get: () => state,
    set(patch: Partial<VectorUiState>) {
        state = { ...state, ...patch };
        if (patch.brush) {
            try {
                localStorage.setItem("nagma.brush", patch.brush);
            } catch {
                // The brush is a convenience; it simply isn't remembered without storage.
            }
        }
        for (const l of listeners) l();
        // The canvas redraws on editor changes.
        editor.set({});
    },
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

export function useVectorUi<T>(pick: (s: VectorUiState) => T): T {
    return useSyncExternalStore(vectorUi.subscribe, () => pick(state), () => pick(state));
}

// The fill the Paint tool puts on a region.
export function paintToolFill(drawColor: string): Paint {
    const { paintKind, paintColor2 } = state;
    if (paintKind === "solid") return { type: "solid", color: drawColor, opacity: 1, visible: true, blend: "normal" };
    const stops = [
        { position: 0, color: drawColor, opacity: 1 },
        { position: 1, color: paintColor2, opacity: 1 },
    ];
    return paintKind === "linear"
        ? { type: "linear", stops, from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, opacity: 1, visible: true, blend: "normal" }
        : { type: "radial", stops, from: { x: 0.5, y: 0.5 }, to: { x: 1, y: 0.5 }, opacity: 1, visible: true, blend: "normal" };
}
