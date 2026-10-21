// The handwritten "Sonu" for the Sign dialog's Draw box: control points per letter (canvas-local,
// a 400x140 box), smoothed with a Catmull-Rom spline. "S" is its own stroke; "onu" is joined.
const LETTERS = {
    S: [[104, 34], [92, 24], [72, 22], [56, 30], [52, 46], [64, 58], [84, 66], [100, 78], [102, 96], [90, 110], [68, 114], [50, 106], [44, 96]],
    o: [[136, 70], [124, 68], [114, 80], [114, 96], [124, 106], [138, 102], [146, 88], [144, 74], [136, 68], [140, 72], [152, 74]],
    n: [[158, 72], [162, 84], [162, 106], [163, 92], [170, 78], [182, 70], [194, 74], [198, 88], [198, 104]],
    u: [[206, 104], [212, 90], [214, 74], [216, 94], [224, 106], [238, 104], [248, 90], [252, 74], [252, 96], [258, 106], [272, 104], [288, 92]],
};
const STROKES = [["S"], ["o", "n", "u"]];

function spline(pts, perSeg = 6) {
    const out = [];
    const p = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
    for (let i = 0; i < pts.length - 1; i++) {
        const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
        for (let s = 0; s < perSeg; s++) {
            const t = s / perSeg, t2 = t * t, t3 = t2 * t;
            const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
            out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
        }
    }
    out.push(pts[pts.length - 1]);
    return out;
}

// Strokes as [{ letters: [{ pts, ms }] }] in page coordinates for a canvas at (x, y); the word is
// scaled to `scale` and centred horizontally in a box `w` wide.
function sonu(x, y, { w = 400, scale = 1.22, dy = -12, slant = 0.24 } = {}) {
    const minX = 44, maxX = 288;
    const ox = x + (w - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = y + dy - 0 * scale;
    // A forward slant, as handwriting leans: x shifts with height above the baseline (y 106).
    const map = ([a, b]) => [ox + (a + (106 - b) * slant - 14) * scale, oy + b * scale];
    return STROKES.map((letters) => letters.map((l, i) => {
        let pts = LETTERS[l];
        // A joined letter starts where the previous one ended.
        if (i > 0) pts = [LETTERS[letters[i - 1]].at(-1), ...pts];
        const ms = l === "S" ? 480 : 380;
        return { letter: l, pts: spline(pts).map(map).slice(i > 0 ? 1 : 0), ms };
    }));
}

// Writes it with the mouse (the pointer anchored to the canvas by the caller).
async function writeSonu(page, cv) {
    const strokes = sonu(cv.x, cv.y, { w: cv.w });
    for (let s = 0; s < strokes.length; s++) {
        const first = strokes[s][0].pts[0];
        await page.move(first[0], first[1], s ? 180 : 0);
        await page.down();
        for (const { pts, ms } of strokes[s]) {
            const step = ms / pts.length;
            for (const [px, py] of pts) await page.move(px, py, step);
        }
        await page.up();
    }
}

module.exports = { sonu, writeSonu };
