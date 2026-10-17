import type { BezelKind, DeviceColor } from "../engine/devices";

// Device bezels for the prototype player, drawn with plain canvas shapes. Sizes are in device points
// and scale with the device; the screen rectangle is where the prototype shows.

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Pad {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

const PADS: Record<BezelKind, Pad> = {
    island: { top: 14, right: 14, bottom: 14, left: 14 },
    notch: { top: 16, right: 16, bottom: 16, left: 16 },
    "punch-hole": { top: 12, right: 12, bottom: 12, left: 12 },
    "home-button": { top: 104, right: 24, bottom: 104, left: 24 },
    tablet: { top: 26, right: 26, bottom: 26, left: 26 },
    "tablet-home": { top: 84, right: 32, bottom: 84, left: 32 },
    laptop: { top: 26, right: 120, bottom: 54, left: 120 },
    monitor: { top: 30, right: 30, bottom: 300, left: 30 },
    watch: { top: 90, right: 34, bottom: 90, left: 24 },
    none: { top: 0, right: 0, bottom: 0, left: 0 },
};

// Corner radius of the screen itself, in points.
export function screenRadius(kind: BezelKind): number {
    switch (kind) {
        case "island":
            return 55;
        case "notch":
            return 46;
        case "punch-hole":
            return 34;
        case "tablet":
            return 18;
        case "watch":
            return 36;
        case "laptop":
            return 10;
        default:
            return 0;
    }
}

export function bezelPad(kind: BezelKind, landscape: boolean): Pad {
    const p = PADS[kind];
    return landscape ? { top: p.left, right: p.top, bottom: p.right, left: p.bottom } : p;
}

function rounded(ctx: CanvasRenderingContext2D, b: Box, r: number) {
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, Math.max(0, Math.min(r, b.w / 2, b.h / 2)));
}

// Draws the body behind the screen. `screen` is in CSS pixels; `s` is CSS pixels per point.
export function drawBezel(ctx: CanvasRenderingContext2D, kind: BezelKind, color: DeviceColor, screen: Box, s: number, landscape: boolean) {
    if (kind === "none") return;
    const pad = bezelPad(kind, landscape);
    const body: Box = { x: screen.x - pad.left * s, y: screen.y - pad.top * s, w: screen.w + (pad.left + pad.right) * s, h: screen.h + (pad.top + pad.bottom) * s };
    ctx.save();
    if (kind === "laptop") {
        // Lid with a black bezel, then the base below it.
        const lid: Box = { x: screen.x - 18 * s, y: screen.y - 26 * s, w: screen.w + 36 * s, h: screen.h + 48 * s };
        rounded(ctx, lid, 22 * s);
        ctx.fillStyle = color.body;
        ctx.fill();
        const inner: Box = { x: lid.x + 3 * s, y: lid.y + 3 * s, w: lid.w - 6 * s, h: lid.h - 6 * s };
        rounded(ctx, inner, 19 * s);
        ctx.fillStyle = "#0B0B0C";
        ctx.fill();
        const baseY = lid.y + lid.h;
        const base: Box = { x: body.x, y: baseY, w: body.w, h: 30 * s };
        ctx.beginPath();
        ctx.moveTo(base.x + 6 * s, base.y);
        ctx.lineTo(base.x + base.w - 6 * s, base.y);
        ctx.quadraticCurveTo(base.x + base.w, base.y, base.x + base.w, base.y + 10 * s);
        ctx.lineTo(base.x + base.w - 20 * s, base.y + base.h);
        ctx.lineTo(base.x + 20 * s, base.y + base.h);
        ctx.lineTo(base.x, base.y + 10 * s);
        ctx.quadraticCurveTo(base.x, base.y, base.x + 6 * s, base.y);
        ctx.closePath();
        ctx.fillStyle = color.edge;
        ctx.fill();
        // The notch for opening the lid.
        ctx.fillStyle = color.body;
        rounded(ctx, { x: base.x + base.w / 2 - 70 * s, y: base.y, w: 140 * s, h: 9 * s }, 6 * s);
        ctx.fill();
        ctx.restore();
        return;
    }
    if (kind === "monitor") {
        const head: Box = { x: body.x, y: body.y, w: body.w, h: screen.h + (pad.top + 110) * s };
        rounded(ctx, head, 26 * s);
        ctx.fillStyle = color.body;
        ctx.fill();
        // A black border inside the coloured chin.
        rounded(ctx, { x: screen.x - 12 * s, y: screen.y - 12 * s, w: screen.w + 24 * s, h: screen.h + 24 * s }, 8 * s);
        ctx.fillStyle = "#0B0B0C";
        ctx.fill();
        // Stand.
        const neckW = Math.min(360, screen.w * 0.25) * s;
        const top = head.y + head.h;
        ctx.beginPath();
        ctx.moveTo(head.x + head.w / 2 - neckW / 2, top);
        ctx.lineTo(head.x + head.w / 2 + neckW / 2, top);
        ctx.lineTo(head.x + head.w / 2 + neckW / 2 + 20 * s, top + 170 * s);
        ctx.lineTo(head.x + head.w / 2 - neckW / 2 - 20 * s, top + 170 * s);
        ctx.closePath();
        ctx.fillStyle = color.edge;
        ctx.fill();
        rounded(ctx, { x: head.x + head.w / 2 - neckW / 2 - 60 * s, y: top + 165 * s, w: neckW + 120 * s, h: 20 * s }, 6 * s);
        ctx.fill();
        ctx.restore();
        return;
    }
    if (kind === "watch") {
        // Bands above and below, then the case and the crown.
        const bandW = screen.w * 0.78;
        ctx.fillStyle = color.edge;
        rounded(ctx, { x: screen.x + (screen.w - bandW) / 2 + 5 * s, y: body.y - 4 * s, w: bandW, h: body.h + 8 * s }, 28 * s);
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        const caseBox: Box = { x: screen.x - 14 * s, y: screen.y - 20 * s, w: screen.w + 28 * s, h: screen.h + 40 * s };
        rounded(ctx, caseBox, 52 * s);
        ctx.fillStyle = color.body;
        ctx.fill();
        rounded(ctx, { x: screen.x - 8 * s, y: screen.y - 8 * s, w: screen.w + 16 * s, h: screen.h + 16 * s }, 44 * s);
        ctx.fillStyle = "#050505";
        ctx.fill();
        rounded(ctx, { x: caseBox.x + caseBox.w - 2 * s, y: caseBox.y + caseBox.h * 0.22, w: 12 * s, h: 40 * s }, 5 * s);
        ctx.fillStyle = color.edge;
        ctx.fill();
        rounded(ctx, { x: caseBox.x + caseBox.w - 1 * s, y: caseBox.y + caseBox.h * 0.5, w: 6 * s, h: 50 * s }, 3 * s);
        ctx.fill();
        ctx.restore();
        return;
    }
    // Phones and tablets: a rounded slab with a coloured rim and a black glass border.
    const outerR = (screenRadius(kind) + Math.max(pad.left, pad.top) * (kind === "home-button" || kind === "tablet-home" ? 0.5 : 1)) * s;
    rounded(ctx, body, kind === "home-button" ? 62 * s : kind === "tablet-home" ? 44 * s : outerR);
    ctx.fillStyle = color.edge;
    ctx.fill();
    const rim = 3 * s;
    rounded(ctx, { x: body.x + rim, y: body.y + rim, w: body.w - rim * 2, h: body.h - rim * 2 }, (kind === "home-button" ? 62 * s : kind === "tablet-home" ? 44 * s : outerR) - rim);
    ctx.fillStyle = kind === "home-button" || kind === "tablet-home" ? color.body : "#0B0B0C";
    ctx.fill();
    // Side buttons on phones.
    if (kind === "island" || kind === "notch" || kind === "punch-hole" || kind === "home-button") {
        ctx.fillStyle = color.edge;
        const side = (y: number, h: number, right: boolean) => {
            const along = landscape ? body.x + y * s : body.y + y * s;
            if (landscape) rounded(ctx, { x: along, y: right ? body.y + body.h - 1 * s : body.y - 3 * s, w: h * s, h: 4 * s }, 2 * s);
            else rounded(ctx, { x: right ? body.x + body.w - 1 * s : body.x - 3 * s, y: along, w: 4 * s, h: h * s }, 2 * s);
            ctx.fill();
        };
        side(130, 30, false);
        side(190, 60, false);
        side(260, 60, false);
        side(210, 95, true);
    }
    if (kind === "home-button" || kind === "tablet-home") {
        // The home button below the screen, the speaker above.
        const r = (kind === "home-button" ? 27 : 22) * s;
        const cx = landscape ? screen.x + screen.w + (pad.right * s) / 2 : screen.x + screen.w / 2;
        const cy = landscape ? screen.y + screen.h / 2 : screen.y + screen.h + (pad.bottom * s) / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = color.edge;
        ctx.lineWidth = 2 * s;
        ctx.stroke();
        const sx = landscape ? screen.x - (pad.left * s) / 2 : screen.x + screen.w / 2;
        const sy = landscape ? screen.y + screen.h / 2 : screen.y - (pad.top * s) / 2;
        ctx.fillStyle = "#111";
        if (landscape) rounded(ctx, { x: sx - 3 * s, y: sy - 24 * s, w: 6 * s, h: 48 * s }, 3 * s);
        else rounded(ctx, { x: sx - 24 * s, y: sy - 3 * s, w: 48 * s, h: 6 * s }, 3 * s);
        ctx.fill();
    }
    ctx.restore();
}

// Draws what sits over the screen: the dynamic island, the notch or the camera hole.
export function drawBezelOverlay(ctx: CanvasRenderingContext2D, kind: BezelKind, screen: Box, s: number, landscape: boolean) {
    ctx.save();
    ctx.fillStyle = "#000";
    const cx = landscape ? screen.x + 18 * s : screen.x + screen.w / 2;
    const cy = landscape ? screen.y + screen.h / 2 : screen.y + 18 * s;
    if (kind === "island") {
        if (landscape) rounded(ctx, { x: cx - 18 * s, y: cy - 62 * s, w: 36 * s, h: 124 * s }, 18 * s);
        else rounded(ctx, { x: cx - 62 * s, y: cy - 18 * s, w: 124 * s, h: 36 * s }, 18 * s);
        ctx.fill();
    } else if (kind === "notch") {
        const w = 162 * s;
        const h = 32 * s;
        ctx.beginPath();
        if (landscape) ctx.roundRect(screen.x - 4 * s, cy - w / 2, h + 4 * s, w, [0, 20 * s, 20 * s, 0]);
        else ctx.roundRect(cx - w / 2, screen.y - 4 * s, w, h + 4 * s, [0, 0, 20 * s, 20 * s]);
        ctx.fill();
    } else if (kind === "punch-hole") {
        ctx.beginPath();
        ctx.arc(cx, landscape ? cy : screen.y + 20 * s, 7 * s, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}
