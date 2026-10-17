import { resizeChildren } from "./constraints";
import { areaOf, isAdvancedGrid, planGrid } from "./grid-layout";
import { sideWeights } from "./stroke";
import { layoutText } from "./text-layout";
import type { AutoLayout, NagmaDocument, SceneNode } from "./types";

// Auto layout, run after every command: stack the children of auto-layout frames with gaps,
// padding and alignment; hug frames to their content; stretch "fill" children.
//
// Sizes are worked out bottom-up (a hugging frame needs its children's sizes), then positions
// and fill sizes top-down (a filling child needs its parent's size).

type Nodes = Record<string, SceneNode>;

function depth(nodes: Nodes, node: SceneNode): number {
    let d = 0;
    let parent = node.parentId ? nodes[node.parentId] : undefined;
    while (parent) {
        d++;
        parent = parent.parentId ? nodes[parent.parentId] : undefined;
    }
    return d;
}

// Moves a layer and everything inside it (child coordinates are absolute within the frame's space).
function translate(nodes: Nodes, id: string, dx: number, dy: number) {
    if (dx === 0 && dy === 0) return;
    const node = nodes[id];
    if (!node) return;
    nodes[id] = { ...node, x: node.x + dx, y: node.y + dy };
    for (const child of node.children) translate(nodes, child, dx, dy);
}

function flowChildren(nodes: Nodes, frame: SceneNode): SceneNode[] {
    return frame.children.map((id) => nodes[id]).filter((child): child is SceneNode => Boolean(child && child.visible && child.positioning !== "absolute"));
}

// The room a layer takes in a stack: its box turned by its rotation (a divider line turned 90°
// takes its thickness, not its length).
function ew(c: SceneNode): number {
    if (!c.rotation) return c.w;
    const r = (c.rotation * Math.PI) / 180;
    return Math.abs(c.w * Math.cos(r)) + Math.abs(c.h * Math.sin(r));
}

function eh(c: SceneNode): number {
    if (!c.rotation) return c.h;
    const r = (c.rotation * Math.PI) / 180;
    return Math.abs(c.w * Math.sin(r)) + Math.abs(c.h * Math.cos(r));
}

function clampW(node: SceneNode, w: number) {
    return Math.max(1, Math.min(node.maxW ?? Infinity, Math.max(node.minW ?? 0, w)));
}

function clampH(node: SceneNode, h: number) {
    return Math.max(1, Math.min(node.maxH ?? Infinity, Math.max(node.minH ?? 0, h)));
}

// Breaks children into lines for a wrapping stack, given the room along the stacking axis.
function lines(children: SceneNode[], vertical: boolean, gap: number, room: number, wrap: boolean): SceneNode[][] {
    if (!wrap) return children.length ? [children] : [];
    const out: SceneNode[][] = [];
    let line: SceneNode[] = [];
    let used = 0;
    for (const c of children) {
        const size = vertical ? eh(c) : ew(c);
        if (line.length && used + gap + size > room) {
            out.push(line);
            line = [];
            used = 0;
        }
        used += (line.length ? gap : 0) + size;
        line.push(c);
    }
    if (line.length) out.push(line);
    return out;
}

// The padding children are laid out in: the frame's own, plus its stroke when strokes are
// included in layout (all of an inside stroke, half of a centred one, none of an outside one).
function paddingOf(frame: SceneNode, layout: AutoLayout): [number, number, number, number] {
    const [t, r, b, l] = layout.padding;
    if (!layout.strokesIncluded || (frame.strokeWidth <= 0 && !frame.strokeWeights) || !frame.strokes.some((p) => p.visible)) return [t, r, b, l];
    const k = frame.strokeAlign === "inside" ? 1 : frame.strokeAlign === "center" ? 0.5 : 0;
    const w = sideWeights(frame, true) ?? [frame.strokeWidth, frame.strokeWidth, frame.strokeWidth, frame.strokeWidth];
    return [t + w[0] * k, r + w[1] * k, b + w[2] * k, l + w[3] * k];
}

// The reference's "Auto" gaps: the free space alone sets the spacing.
function autoGap(layout: AutoLayout): boolean {
    return layout.primary === "between" || layout.primary === "around" || layout.primary === "evenly";
}

// Where a layer's first text baseline sits below its top, for baseline alignment: a text layer's
// first line, an auto-layout frame's first child that has one, otherwise the layer's bottom.
function baselineOf(nodes: Nodes, node: SceneNode, depthLeft = 4): number {
    if (node.type === "text") return layoutText(node).lines[0]?.baseline ?? node.h;
    if (node.layout && depthLeft > 0) {
        for (const child of flowChildren(nodes, node)) {
            if (child.type === "text" || child.layout) return child.y - node.y + baselineOf(nodes, child, depthLeft - 1);
        }
    }
    return node.h;
}

export function syncLayouts(doc: NagmaDocument): NagmaDocument {
    const frames = Object.values(doc.nodes).filter((node) => (node.type === "frame" || node.type === "component" || node.type === "componentSet" || node.type === "instance") && node.layout);
    if (frames.length === 0) return doc;
    const nodes: Nodes = { ...doc.nodes };
    let changed = false;
    const set = (id: string, patch: Partial<SceneNode>) => {
        const node = nodes[id];
        if (!node) return;
        const keys = Object.keys(patch) as (keyof SceneNode)[];
        if (keys.every((key) => node[key] === patch[key])) return;
        const updated = { ...node, ...patch };
        nodes[id] = updated;
        // A stretched frame or instance (that isn't itself a stack) arranges its children by their constraints.
        if ((updated.w !== node.w || updated.h !== node.h) && !node.layout && node.children.length && (node.type === "frame" || node.type === "component" || node.type === "instance")) {
            resizeChildren(nodes, id, node, updated);
        }
        changed = true;
    };

    // Bottom-up: hug sizes.
    const deepestFirst = [...frames].sort((a, b) => depth(nodes, b) - depth(nodes, a));
    for (const stale of deepestFirst) {
        const frame = nodes[stale.id];
        const layout = frame?.layout;
        if (!frame || !layout) continue;
        const children = flowChildren(nodes, frame);
        const [pt, pr, pb, pl] = paddingOf(frame, layout);
        const vertical = layout.direction === "vertical";
        let contentW: number;
        let contentH: number;
        if (layout.grid && isAdvancedGrid(layout.grid, children)) {
            const plan = planGrid(layout.grid, children, frame.sizing.h === "hug" ? null : frame.w - pl - pr, frame.sizing.v === "hug" ? null : frame.h - pt - pb);
            contentW = plan.width + pl + pr;
            contentH = plan.height + pt + pb;
        } else if (layout.grid) {
            const g = layout.grid;
            const cols = Math.max(1, Math.round(g.columns));
            const rows = g.rows ?? Math.max(1, Math.ceil(children.length / cols));
            const cellW = children.length ? Math.max(...children.map((c) => c.w)) : 0;
            const cellH = children.length ? Math.max(...children.map((c) => c.h)) : 0;
            contentW = cols * cellW + (cols - 1) * g.columnGap + pl + pr;
            contentH = rows * cellH + (rows - 1) * g.rowGap + pt + pb;
        } else {
            const mainKey = vertical ? "v" : "h";
            const room = frame.sizing[mainKey] === "hug" ? Infinity : (vertical ? frame.h - pt - pb : frame.w - pl - pr);
            const rows = lines(children, vertical, layout.gap, room, Boolean(layout.wrap));
            const mainOf = (line: SceneNode[]) => line.reduce((sum, c) => sum + (vertical ? eh(c) : ew(c)), 0) + Math.max(0, line.length - 1) * layout.gap;
            const crossOf = (line: SceneNode[]) => (line.length ? Math.max(...line.map((c) => (vertical ? ew(c) : eh(c)))) : 0);
            const main = rows.length ? Math.max(...rows.map(mainOf)) : 0;
            const cross = rows.reduce((sum, line) => sum + crossOf(line), 0) + Math.max(0, rows.length - 1) * ((Number.isFinite(layout.counterGap) ? (layout.counterGap as number) : layout.gap));
            contentW = (vertical ? cross : main) + pl + pr;
            contentH = (vertical ? main : cross) + pt + pb;
        }
        const patch: Partial<SceneNode> = {};
        if (frame.sizing.h === "hug") patch.w = clampW(frame, contentW);
        if (frame.sizing.v === "hug") patch.h = clampH(frame, contentH);
        set(frame.id, patch);
        // A hugging frame that sits freely in a frame grows from the side its constraints pin, as in
        // The reference: pinned to the bottom it grows upwards, centred it grows both ways.
        const parent = nodes[frame.parentId ?? ""];
        const free = parent && parent.type !== "page" && parent.type !== "group" && (!parent.layout || frame.positioning === "absolute");
        const c = frame.constraints;
        if (free && c) {
            const dw = (patch.w ?? frame.w) - frame.w;
            const dh = (patch.h ?? frame.h) - frame.h;
            const dx = c.h === "right" ? -dw : c.h === "center" ? -dw / 2 : 0;
            const dy = c.v === "bottom" ? -dh : c.v === "center" ? -dh / 2 : 0;
            if (dx || dy) translate(nodes, frame.id, dx, dy);
        }
    }

    // Top-down: fill sizes, then positions.
    const shallowestFirst = [...frames].sort((a, b) => depth(nodes, a) - depth(nodes, b));
    for (const stale of shallowestFirst) {
        const frame = nodes[stale.id];
        const layout = frame?.layout;
        if (!frame || !layout) continue;
        const vertical = layout.direction === "vertical";
        const [pt, pr, pb, pl] = paddingOf(frame, layout);
        const innerMain = (vertical ? frame.h - pt - pb : frame.w - pl - pr);
        const innerCross = (vertical ? frame.w - pl - pr : frame.h - pt - pb);
        let children = flowChildren(nodes, frame);
        if (layout.grid && isAdvancedGrid(layout.grid, children)) {
            // A hugging axis has hug tracks (fill acts as hug there), as when its size was worked out.
            const plan = planGrid(layout.grid, children, frame.sizing.h === "hug" ? null : frame.w - pl - pr, frame.sizing.v === "hug" ? null : frame.h - pt - pb);
            const pick = (a: "auto" | "start" | "center" | "end" | undefined, fallback: AutoLayout["primary"] | AutoLayout["counter"]) => (a && a !== "auto" ? a : fallback === "center" || fallback === "end" ? fallback : "start");
            for (const p of plan.placements) {
                const area = areaOf(plan, p);
                const child = p.node;
                const patch: Partial<SceneNode> = {};
                if (child.sizing.h === "fill") patch.w = clampW(child, area.w);
                if (child.sizing.v === "fill") patch.h = clampH(child, area.h);
                set(child.id, patch);
                const current = nodes[child.id] as SceneNode;
                const h = pick(child.gridAlign?.h, layout.counter);
                const v = pick(child.gridAlign?.v, layout.primary);
                const ax = frame.x + pl + area.x;
                const ay = frame.y + pt + area.y;
                const tx = h === "center" ? ax + (area.w - current.w) / 2 : h === "end" ? ax + area.w - current.w : ax;
                const ty = v === "center" ? ay + (area.h - current.h) / 2 : v === "end" ? ay + area.h - current.h : ay;
                if (current.x !== tx || current.y !== ty) {
                    translate(nodes, child.id, tx - current.x, ty - current.y);
                    changed = true;
                }
            }
            continue;
        }
        if (layout.grid) {
            // Grid: equal cells, children placed row by row; "fill" children stretch to the cell.
            const g = layout.grid;
            const cols = Math.max(1, Math.round(g.columns));
            const rows = g.rows ?? Math.max(1, Math.ceil(children.length / cols));
            const cellW = Math.max(1, (frame.w - pl - pr - (cols - 1) * g.columnGap) / cols);
            const cellH = Math.max(1, (frame.h - pt - pb - (rows - 1) * g.rowGap) / rows);
            children.forEach((child, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const patch: Partial<SceneNode> = {};
                if (child.sizing.h === "fill") patch.w = clampW(child, cellW);
                if (child.sizing.v === "fill") patch.h = clampH(child, cellH);
                set(child.id, patch);
                const current = nodes[child.id] as SceneNode;
                const cx = frame.x + pl + col * (cellW + g.columnGap);
                const cy = frame.y + pt + row * (cellH + g.rowGap);
                const tx = layout.counter === "center" ? cx + (cellW - current.w) / 2 : layout.counter === "end" ? cx + cellW - current.w : cx;
                const ty = layout.primary === "center" ? cy + (cellH - current.h) / 2 : layout.primary === "end" ? cy + cellH - current.h : cy;
                if (current.x !== tx || current.y !== ty) {
                    translate(nodes, child.id, tx - current.x, ty - current.y);
                    changed = true;
                }
            });
            continue;
        }
        const mainKey = vertical ? "v" : "h";
        const crossKey = vertical ? "h" : "v";
        // A hugging frame can't hand out leftover space, so "fill" acts like fixed there.
        const mainFills = frame.sizing[mainKey] !== "hug";
        const crossFills = frame.sizing[crossKey] !== "hug";

        const wrap = Boolean(layout.wrap) && mainFills;
        const fillers = mainFills && !wrap ? children.filter((c) => c.sizing[mainKey] === "fill") : [];
        const fixedMain = children.filter((c) => !fillers.includes(c)).reduce((sum, c) => sum + (vertical ? eh(c) : ew(c)), 0);
        // With space between (the reference's "Auto" gap) the stored gap isn't used, so fill children take it all.
        const gaps = autoGap(layout) ? 0 : Math.max(0, children.length - 1) * layout.gap;
        const share = fillers.length ? Math.max(1, (innerMain - fixedMain - gaps) / fillers.length) : 0;
        for (const child of children) {
            const patch: Partial<SceneNode> = {};
            if (fillers.includes(child)) patch[vertical ? "h" : "w"] = vertical ? clampH(child, share) : clampW(child, share);
            if (crossFills && !wrap && child.sizing[crossKey] === "fill") patch[vertical ? "w" : "h"] = vertical ? clampW(child, innerCross) : clampH(child, innerCross);
            set(child.id, patch);
        }
        children = flowChildren(nodes, frame);

        // One line, or several when wrapping; each line is laid out along the stacking axis.
        const rows = lines(children, vertical, layout.gap, innerMain, wrap);
        const lineGap = (Number.isFinite(layout.counterGap) ? (layout.counterGap as number) : layout.gap);
        let crossCursor = vertical ? frame.x + pl : frame.y + pt;
        const crossOf = (line: SceneNode[]) => (line.length ? Math.max(...line.map((c) => (vertical ? ew(c) : eh(c)))) : 0);
        const totalCross = rows.reduce((sum, line) => sum + crossOf(line), 0) + Math.max(0, rows.length - 1) * lineGap;
        // Space between for wrapped lines: the free room goes between the lines.
        const spreadLines = wrap && rows.length > 1 && layout.alignContent === "between" && innerCross > totalCross;
        const rowGap = spreadLines ? lineGap + (innerCross - totalCross) / (rows.length - 1) : lineGap;
        if (wrap && rows.length > 1 && !spreadLines) {
            if (layout.counter === "center") crossCursor += (innerCross - totalCross) / 2;
            if (layout.counter === "end") crossCursor += innerCross - totalCross;
        }
        // Baseline alignment (horizontal stacks): each line's children share the deepest first baseline.
        const baseline = layout.counter === "baseline" && !vertical;
        for (const line of rows) {
            const lineCross = wrap && rows.length > 1 ? crossOf(line) : innerCross;
            const lineBaseline = baseline ? Math.max(0, ...line.map((c) => baselineOf(nodes, c))) : 0;
            const total = line.reduce((sum, c) => sum + (vertical ? eh(c) : ew(c)), 0);
            const lineGaps = Math.max(0, line.length - 1) * layout.gap;
            const free = innerMain - total - lineGaps;
            let cursor = vertical ? frame.y + pt : frame.x + pl;
            let gap = layout.gap;
            if (layout.primary === "center") cursor += free / 2;
            if (layout.primary === "end") cursor += free;
            // Space between is the reference's "Auto" gap: the free space alone sets the spacing (the stored
            // gap number is ignored).
            if (layout.primary === "between" && line.length > 1) gap = Math.max(0, innerMain - total) / (line.length - 1);
            // A lone child in the reference's older space between (stored as "space evenly") sits in the middle;
            // the current one keeps it at the start.
            if (layout.primary === "between" && layout.loneCenter && line.length === 1) cursor += free / 2;
            // Around: half a share at each end; evenly: a whole share at each end.
            if (layout.primary === "around" || layout.primary === "evenly") {
                const room = Math.max(0, innerMain - total);
                const share = room / (layout.primary === "around" ? line.length : line.length + 1);
                gap = share;
                cursor += layout.primary === "around" ? share / 2 : share;
            }

            for (const child of line) {
                const size = vertical ? eh(child) : ew(child);
                const crossSize = vertical ? ew(child) : eh(child);
                let crossPos = crossCursor;
                if (layout.counter === "center") crossPos = crossCursor + (lineCross - crossSize) / 2;
                if (layout.counter === "end") crossPos = crossCursor + lineCross - crossSize;
                if (baseline) crossPos = crossCursor + lineBaseline - baselineOf(nodes, child);
                // The turned box is placed; the layer's own x/y is its unturned box (rotation is
                // about the centre, so the two share a centre).
                const targetX = (vertical ? crossPos : cursor) + (ew(child) - child.w) / 2;
                const targetY = (vertical ? cursor : crossPos) + (eh(child) - child.h) / 2;
                const current = nodes[child.id];
                if (current && (Math.abs(current.x - targetX) > 1e-6 || Math.abs(current.y - targetY) > 1e-6)) {
                    translate(nodes, child.id, targetX - current.x, targetY - current.y);
                    changed = true;
                }
                cursor += size + gap;
            }
            crossCursor += lineCross + rowGap;
        }
    }

    return changed ? { ...doc, nodes } : doc;
}

// Where a layer dragged inside an auto-layout frame should slot in, from a point along the stack.
export function layoutIndexAt(doc: NagmaDocument, frameId: string, movingId: string, x: number, y: number): number {
    const frame = doc.nodes[frameId];
    if (!frame?.layout) return 0;
    const vertical = frame.layout.direction === "vertical";
    const others = frame.children.filter((id) => id !== movingId);
    let index = 0;
    for (const id of others) {
        const node = doc.nodes[id];
        if (!node || !node.visible) {
            index++;
            continue;
        }
        const center = vertical ? node.y + node.h / 2 : node.x + node.w / 2;
        if ((vertical ? y : x) > center) index++;
        else break;
    }
    return index;
}
