import { viewport } from "./camera";

// Where a thread or the new-comment box goes beside its pin: to the right, or to the left when it
// would run past the canvas's right edge (under the Comments panel), and kept inside the canvas and
// above the floating toolbar along its bottom.
export const TOOLBAR_SPACE = 72;
export function popupLeft(x: number, width: number): number {
    return x + 18 + width > viewport.width - 8 ? Math.max(8, x - 18 - width) : x + 18;
}
export function popupTop(y: number, height: number): number {
    return Math.max(8, Math.min(y, viewport.height - TOOLBAR_SPACE - height));
}
