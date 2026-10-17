// Where an anchored popover goes (the Interaction popover beside a prototype connection): on the
// preferred side of the anchor point if it fits, else the next side that does, else the side with
// the most room; then kept inside the bounds, with the caret on the edge facing the anchor and
// slid along that edge to point at it (but never into the rounded corners).

export type PopoverSide = "bottom" | "top" | "right" | "left";

export interface PopoverPlacement {
    // Top left corner of the popover.
    x: number;
    y: number;
    // Which side of the anchor the popover sits on ("bottom": below it, caret on its top edge).
    side: PopoverSide;
    // How far along the caret's edge (from the popover's left or top) the caret's tip is.
    caret: number;
}

export interface PlacementInput {
    anchor: { x: number; y: number };
    size: { w: number; h: number };
    bounds: { left: number; top: number; right: number; bottom: number };
    // Space between the anchor and the popover's edge (room for the caret).
    gap?: number;
    // Space kept free inside the bounds.
    margin?: number;
    // How close the caret's tip may come to a corner.
    caretInset?: number;
    order?: PopoverSide[];
}

const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)));

export function placePopover({ anchor, size, bounds, gap = 12, margin = 8, caretInset = 16, order = ["bottom", "top", "right", "left"] }: PlacementInput): PopoverPlacement {
    // An anchor outside the bounds (the connection scrolled off the canvas) is pinned to the edge,
    // so the popover stays in view and still points toward it.
    const a = { x: clamp(anchor.x, bounds.left, bounds.right), y: clamp(anchor.y, bounds.top, bounds.bottom) };
    const room: Record<PopoverSide, number> = {
        bottom: bounds.bottom - margin - (a.y + gap) - size.h,
        top: a.y - gap - margin - bounds.top - size.h,
        right: bounds.right - margin - (a.x + gap) - size.w,
        left: a.x - gap - margin - bounds.left - size.w,
    };
    const side = order.find((s) => room[s] >= 0) ?? order.reduce((best, s) => (room[s] > room[best] ? s : best), order[0] ?? "bottom");
    const minX = bounds.left + margin;
    const maxX = bounds.right - margin - size.w;
    const minY = bounds.top + margin;
    const maxY = bounds.bottom - margin - size.h;
    let x: number;
    let y: number;
    if (side === "bottom" || side === "top") {
        x = clamp(a.x - size.w / 2, minX, maxX);
        y = clamp(side === "bottom" ? a.y + gap : a.y - gap - size.h, minY, maxY);
    } else {
        y = clamp(a.y - size.h / 2, minY, maxY);
        x = clamp(side === "right" ? a.x + gap : a.x - gap - size.w, minX, maxX);
    }
    const along = side === "bottom" || side === "top" ? a.x - x : a.y - y;
    const length = side === "bottom" || side === "top" ? size.w : size.h;
    const caret = clamp(along, Math.min(caretInset, length / 2), Math.max(length - caretInset, length / 2));
    return { x, y, side, caret };
}
