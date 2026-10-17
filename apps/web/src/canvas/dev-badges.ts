// Dev status badges next to frame and section names on the canvas. A marked design shows its
// status (frames: a small code mark in the status colour; sections: a labelled pill); a selected
// design without a status shows a faint mark that marks it ready for dev when clicked.
import { type DevStatus, DEV_STATUS_COLORS, DEV_STATUS_LABELS, canHaveDevStatus, devStatusOf } from "../engine/dev-status";
import { fontString } from "../engine/text";
import type { Camera, NagmaDocument, Rect } from "../engine/types";
import { frameLabelRect, labelled } from "./hit-test";

export const DEV_COLORS: Record<DevStatus, string> = DEV_STATUS_COLORS;

export interface DevBadge {
    id: string;
    rect: Rect;
    status: DevStatus | null;
    pill: boolean;
}

let measure: CanvasRenderingContext2D | null = null;
function textWidth(text: string): number {
    measure ??= document.createElement("canvas").getContext("2d");
    if (!measure) return text.length * 6;
    measure.font = fontString(10, 600);
    return measure.measureText(text).width;
}

export function devBadges(doc: NagmaDocument, camera: Camera, selection: string[]): DevBadge[] {
    const out: DevBadge[] = [];
    // Campaign assets aren't handed off to developers.
    if (doc.campaign) return out;
    // Boards have no Inspect statuses.
    if (doc.board) return out;
    const selected = new Set(selection);
    for (const id of labelled(doc)) {
        const node = doc.nodes[id];
        if (!node || !node.visible || !canHaveDevStatus(doc, node)) continue;
        const status = devStatusOf(doc, node);
        if (!status && !(selected.has(id) && selection.length === 1)) continue;
        const label = frameLabelRect(doc, node, camera);
        // Very small frames have no room for the badge.
        if (!node.isSection && label.w < 8 && !status) continue;
        const pill = Boolean(node.isSection && status);
        const w = pill && status ? textWidth(DEV_STATUS_LABELS[status]) + 24 : 16;
        out.push({ id, status, pill, rect: { x: label.x + label.w + 6, y: label.y + label.h / 2 - 8, w, h: 16 } });
    }
    return out;
}

export function hitDevBadge(doc: NagmaDocument, camera: Camera, selection: string[], sx: number, sy: number): DevBadge | null {
    const badges = devBadges(doc, camera, selection);
    for (let i = badges.length - 1; i >= 0; i--) {
        const b = badges[i];
        if (b && sx >= b.rect.x && sx <= b.rect.x + b.rect.w && sy >= b.rect.y && sy <= b.rect.y + b.rect.h) return b;
    }
    return null;
}

// "</>" drawn with lines, centred in a 16 px square.
function codeMark(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x + 5.5, y + 5);
    ctx.lineTo(x + 3, y + 8);
    ctx.lineTo(x + 5.5, y + 11);
    ctx.moveTo(x + 10.5, y + 5);
    ctx.lineTo(x + 13, y + 8);
    ctx.lineTo(x + 10.5, y + 11);
    ctx.moveTo(x + 9, y + 4.5);
    ctx.lineTo(x + 7, y + 11.5);
    ctx.stroke();
    ctx.restore();
}

export function drawDevBadges(ctx: CanvasRenderingContext2D, doc: NagmaDocument, camera: Camera, selection: string[], hovered: string | null) {
    for (const badge of devBadges(doc, camera, selection)) {
        const { x, y, w, h } = badge.rect;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 4);
        if (badge.status) {
            ctx.fillStyle = DEV_COLORS[badge.status];
            ctx.fill();
            codeMark(ctx, x, y, "#FFFFFF");
            if (badge.pill) {
                ctx.fillStyle = "#FFFFFF";
                ctx.font = fontString(10, 600);
                ctx.textBaseline = "middle";
                ctx.fillText(DEV_STATUS_LABELS[badge.status], x + 18, y + h / 2 + 0.5);
            }
        } else {
            ctx.fillStyle = hovered === badge.id ? "rgba(20,174,92,0.18)" : "rgba(128,128,128,0.14)";
            ctx.fill();
            codeMark(ctx, x, y, hovered === badge.id ? DEV_COLORS.ready : "#8C8C8C");
        }
        ctx.restore();
    }
}
