// "Snap to pixel grid" (⇧⌘'): with it on, layers drawn, dragged or resized land on whole pixels;
// off, they can sit at sub-pixel positions. The store mirrors the preference here so node
// construction can read it without depending on the store (nudges always move by whole units).
export const pixelGrid = { snap: true };

export function snapPx(value: number): number {
    return pixelGrid.snap ? Math.round(value) : value;
}
