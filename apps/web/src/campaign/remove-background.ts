import { nanoid } from "nanoid";
import { imageSrc, storeDataUrl } from "../engine/image-store";
import { editor } from "../engine/store";
import type { ImagePaint } from "../engine/types";

// Background removal, on this device, without a model: the background is taken to be whatever
// touches the image's border. Border pixels are clustered into up to four background colours, then
// a flood fill grows from the border through pixels close to one of those colours, stopping at
// strong edges (so a subject with a similar colour but a clear outline is kept). The mask is then
// feathered and the alpha eased by colour distance near the boundary, so edges aren't jagged.
// Works well on product shots, portraits on plain or studio backdrops and logos; busy scenes keep
// more of their background.

type RGB = [number, number, number];

function dist(data: Uint8ClampedArray, i: number, c: RGB): number {
    const dr = (data[i] ?? 0) - c[0];
    const dg = (data[i + 1] ?? 0) - c[1];
    const db = (data[i + 2] ?? 0) - c[2];
    return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11) * 1.7;
}

// A few representative border colours (k-means on the border ring).
function borderColors(data: Uint8ClampedArray, w: number, h: number): RGB[] {
    const samples: RGB[] = [];
    const take = (x: number, y: number) => {
        const i = (y * w + x) * 4;
        if ((data[i + 3] ?? 0) < 16) return;
        samples.push([data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]);
    };
    const step = Math.max(1, Math.floor((w + h) / 400));
    for (let x = 0; x < w; x += step) {
        take(x, 0);
        take(x, h - 1);
    }
    for (let y = 0; y < h; y += step) {
        take(0, y);
        take(w - 1, y);
    }
    if (!samples.length) return [];
    let centers: RGB[] = [samples[0] as RGB];
    // Farthest-point seeding, then a few k-means rounds.
    while (centers.length < 4) {
        let best: RGB | null = null;
        let bestD = 0;
        for (const s of samples) {
            const d = Math.min(...centers.map((c) => Math.hypot(s[0] - c[0], s[1] - c[1], s[2] - c[2])));
            if (d > bestD) {
                bestD = d;
                best = s;
            }
        }
        if (!best || bestD < 40) break;
        centers.push(best);
    }
    for (let round = 0; round < 6; round++) {
        const sums = centers.map(() => [0, 0, 0, 0]);
        for (const s of samples) {
            let k = 0;
            let kd = Infinity;
            centers.forEach((c, i) => {
                const d = Math.hypot(s[0] - c[0], s[1] - c[1], s[2] - c[2]);
                if (d < kd) {
                    kd = d;
                    k = i;
                }
            });
            const sum = sums[k] as number[];
            sum[0] = (sum[0] ?? 0) + s[0];
            sum[1] = (sum[1] ?? 0) + s[1];
            sum[2] = (sum[2] ?? 0) + s[2];
            sum[3] = (sum[3] ?? 0) + 1;
        }
        centers = centers.map((c, i) => {
            const s = sums[i] as number[];
            return s[3] ? [(s[0] ?? 0) / (s[3] ?? 1), (s[1] ?? 0) / (s[3] ?? 1), (s[2] ?? 0) / (s[3] ?? 1)] : c;
        });
        // Clusters that only a sliver of the border belongs to are likely the subject touching the edge.
        const keep = sums.map((s) => (s[3] ?? 0) >= samples.length * 0.06);
        if (keep.some((k) => !k)) centers = centers.filter((_, i) => keep[i]);
    }
    return centers;
}

export function removeBackgroundPixels(image: ImageData, tolerance = 42): ImageData {
    const { width: w, height: h, data } = image;
    const colors = borderColors(data, w, h);
    const out = new ImageData(new Uint8ClampedArray(data), w, h);
    if (!colors.length) return out;
    const n = w * h;
    // Distance of each pixel to the nearest background colour, and a cheap edge strength.
    const near = new Float32Array(n);
    for (let p = 0; p < n; p++) {
        let d = Infinity;
        for (const c of colors) d = Math.min(d, dist(data, p * 4, c));
        near[p] = d;
    }
    const lum = (p: number) => 0.3 * (data[p * 4] ?? 0) + 0.59 * (data[p * 4 + 1] ?? 0) + 0.11 * (data[p * 4 + 2] ?? 0);
    const edge = (p: number) => {
        const x = p % w;
        const y = (p - x) / w;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return 0;
        const gx = lum(p + 1) - lum(p - 1);
        const gy = lum(p + w) - lum(p - w);
        return Math.hypot(gx, gy);
    };
    // Flood fill from the border.
    const bg = new Uint8Array(n);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    const seed = (p: number) => {
        if (bg[p] || (near[p] ?? Infinity) > tolerance * 1.3 || (data[p * 4 + 3] ?? 0) === 0) {
            if ((data[p * 4 + 3] ?? 0) === 0) bg[p] = 1;
            return;
        }
        bg[p] = 1;
        queue[tail++] = p;
    };
    for (let x = 0; x < w; x++) {
        seed(x);
        seed((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
        seed(y * w);
        seed(y * w + w - 1);
    }
    while (head < tail) {
        const p = queue[head++] as number;
        const x = p % w;
        const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
        for (const q of neighbours) {
            if (q < 0 || q >= n || bg[q]) continue;
            if ((near[q] ?? Infinity) > tolerance) continue;
            // A strong edge stops the fill unless the pixel is very close to the background.
            if (edge(q) > 60 && (near[q] ?? Infinity) > tolerance * 0.5) continue;
            bg[q] = 1;
            queue[tail++] = q;
        }
    }
    // Feather: average the mask over a small window, then ease by colour distance near the edge.
    const radius = Math.max(1, Math.round(Math.min(w, h) / 500));
    const soft = boxBlur(bg, w, h, radius);
    for (let p = 0; p < n; p++) {
        const bgShare = soft[p] ?? 0;
        if (bgShare <= 0) continue;
        const a = data[p * 4 + 3] ?? 255;
        // Inside the background: gone. On the boundary: partly see-through, more so the closer the colour.
        const closeness = Math.max(0, 1 - (near[p] ?? 0) / (tolerance * 1.5));
        const alpha = bg[p] ? 1 - Math.min(1, bgShare) : 1 - bgShare * closeness;
        out.data[p * 4 + 3] = Math.round(a * Math.max(0, Math.min(1, alpha)));
    }
    return out;
}

function boxBlur(mask: Uint8Array, w: number, h: number, r: number): Float32Array {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        let acc = 0;
        for (let x = -r; x <= r; x++) acc += mask[y * w + Math.min(w - 1, Math.max(0, x))] ?? 0;
        for (let x = 0; x < w; x++) {
            tmp[y * w + x] = acc / (2 * r + 1);
            acc += (mask[y * w + Math.min(w - 1, x + r + 1)] ?? 0) - (mask[y * w + Math.max(0, x - r)] ?? 0);
        }
    }
    for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x] ?? 0;
        for (let y = 0; y < h; y++) {
            out[y * w + x] = acc / (2 * r + 1);
            acc += (tmp[Math.min(h - 1, y + r + 1) * w + x] ?? 0) - (tmp[Math.max(0, y - r) * w + x] ?? 0);
        }
    }
    return out;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    await img.decode();
    return img;
}

// Removes the background of an image fill: the cut-out becomes a new image (undo brings the old one back).
export async function removeBackground(nodeId: string, tolerance = 42): Promise<boolean> {
    const s = editor.get();
    const node = s.doc.nodes[nodeId];
    const index = node?.fills.findIndex((p) => p.type === "image") ?? -1;
    const paint = index >= 0 ? (node?.fills[index] as ImagePaint) : null;
    if (!node || !paint) return false;
    const src = imageSrc(s.doc.images, paint.id);
    if (!src) return false;
    const img = await loadImage(src);
    const scale = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    ctx.putImageData(removeBackgroundPixels(ctx.getImageData(0, 0, w, h), tolerance), 0, 0);
    const id = nanoid(12);
    const data = await storeDataUrl(canvas.toDataURL("image/png"));
    const next = editor.get().doc.nodes[nodeId];
    if (!next) return false;
    const fills = next.fills.map((p, i) => (i === index && p.type === "image" ? { ...p, id, original: undefined, adjust: undefined } : p));
    editor.execute({ type: "batch", commands: [{ type: "image.add", id, data }, { type: "node.update", id: nodeId, patch: { fills } }] });
    return true;
}
