import { describe, expect, it } from "vitest";
import { addMask, addMaskPoint, addShapeItem, moveAnchor, moveMaskPoint, removeMask, removeMaskPoint, removeShapeItem, setParent, toggleTimeRemap, updateShapeItem } from "./edit";
import { type VClip, type VComp, LEGACY_SHAPE, anchorWorld, apply, ease, emptyComp, invert, multiply, newClip, parentChoices, parentMatrix, parentsOf, propAt, shapeItems, shapePropAt } from "./model";
import { matteSource, sourceAt, timeRemapped, trackShot } from "./render";
import { itemOutline, lineLength, newShapeItem, shapeOutlines, trimLines, withShapeItems } from "./shapes";

// The pieces of the Video product that match the motion engine's model: shape layers,
// parenting, masks, track mattes, time remapping and easing. All pure data, no canvas.

const comp = (): VComp => emptyComp("c", "Seq", 1920, 1080, 30);
const v1 = (c: VComp) => c.tracks[1]?.id ?? "";
const v2 = (c: VComp) => c.tracks[0]?.id ?? "";

describe("video: shape layers", () => {
    it("a new shape layer holds one item whose size, fill and stroke come from props and keyframes", () => {
        const c = comp();
        const item = newShapeItem("rect", c);
        const clip = addShapeItem(c, newClip("shape", v1(c), 0, 5, "Box"), item);
        expect(shapeItems(clip)).toHaveLength(1);
        expect(shapePropAt(c, clip, item, "w", 0)).toBe(Math.round(1080 * 0.35));
        expect(shapePropAt(c, clip, item, "radius", 0)).toBeGreaterThan(0);
        // Width keyframed through the clip's anim, like every other number.
        const keyed = { ...clip, anim: { [`shape.${item.id}.w`]: [{ t: 0, v: 100, ease: "linear" as const }, { t: 1, v: 300 }] } };
        expect(shapePropAt(c, keyed, item, "w", 0.5)).toBeCloseTo(200);
        const o = itemOutline(c, keyed, item, 0.5);
        expect(o.lines[0]?.closed).toBe(true);
        const xs = o.lines[0]?.points.map((p) => p.x) ?? [];
        expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(200, 0);
    });

    it("rectangle, ellipse, polygon, star and path all become outlines; removing an item drops its props", () => {
        const c = comp();
        let clip = newClip("shape", v1(c), 0, 5, "Shapes");
        for (const kind of ["rect", "ellipse", "polygon", "star", "path"] as const) clip = addShapeItem(c, clip, newShapeItem(kind, c));
        const outlines = shapeOutlines(c, clip, 0);
        expect(outlines.map((o) => o.item.kind)).toEqual(["rect", "ellipse", "polygon", "star", "path"]);
        expect(outlines.every((o) => o.lines.length === 1)).toBe(true);
        // A star has twice as many points as it has sides; a polygon as many.
        const star = outlines[3];
        const poly = outlines[2];
        expect(star?.lines[0]?.points).toHaveLength(10);
        expect(poly?.lines[0]?.points).toHaveLength(5);
        // The free path is open.
        expect(outlines[4]?.lines[0]?.closed).toBe(false);
        const gone = removeShapeItem(clip, shapeItems(clip)[0]?.id ?? "");
        expect(shapeItems(gone)).toHaveLength(4);
        expect(Object.keys(gone.props).some((k) => k.startsWith(`shape.${shapeItems(clip)[0]?.id}.`))).toBe(false);
    });

    it("Trim Paths keeps the part of each path between start and end, wrapping around a closed one", () => {
        const square = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], closed: true };
        expect(lineLength(square)).toBe(400);
        // The first quarter: the top edge.
        const [top] = trimLines([square], 0, 0.25, 0);
        expect(top?.closed).toBe(false);
        expect(top?.points[0]).toEqual({ x: 0, y: 0 });
        expect(top?.points.at(-1)).toEqual({ x: 100, y: 0 });
        // Offset by half a turn: the bottom edge, right to left.
        const [bottom] = trimLines([square], 0, 0.25, 0.5);
        expect(bottom?.points[0]).toEqual({ x: 100, y: 100 });
        expect(bottom?.points.at(-1)).toEqual({ x: 0, y: 100 });
        // A window past the end wraps to the start.
        const [wrapped] = trimLines([square], 0.9, 1.1, 0);
        expect(lineLength(wrapped ?? { points: [], closed: false })).toBeCloseTo(40);
        // Nothing trimmed stays the closed shape; everything trimmed draws nothing.
        expect(trimLines([square], 0, 1, 0.3)[0]?.closed).toBe(true);
        expect(trimLines([square], 0.5, 0.5, 0)).toEqual([]);
        // An open line clamps instead of wrapping.
        const line = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false };
        const [part] = trimLines([line], 0.5, 1, 0.25);
        expect(part?.points[0]?.x).toBeCloseTo(75);
        expect(part?.points.at(-1)?.x).toBeCloseTo(100);
    });

    it("an item's trim settings are keyframeable and change what it draws", () => {
        const c = comp();
        const item = { ...newShapeItem("ellipse", c), trim: true };
        const clip = addShapeItem(c, newClip("shape", v1(c), 0, 5, "Ring"), item);
        const keyed = { ...clip, anim: { [`shape.${item.id}.trimEnd`]: [{ t: 0, v: 0, ease: "linear" as const }, { t: 2, v: 100 }] } };
        const full = lineLength(itemOutline(c, keyed, item, 2).lines[0] ?? { points: [], closed: false });
        const half = lineLength(itemOutline(c, keyed, item, 1).lines[0] ?? { points: [], closed: false });
        expect(itemOutline(c, keyed, item, 0).lines).toEqual([]);
        expect(half / full).toBeCloseTo(0.5, 1);
    });

    it("a file from before shape items still draws its one primitive and migrates on edit", () => {
        const c = comp();
        const legacy: VClip = newClip("shape", v1(c), 0, 5, "Old star", { shape: { kind: "star", fill: "#F00", stroke: "#FFF", strokeWidth: 4, w: 300, h: 300, radius: 0, sides: 6 } });
        const [item] = shapeItems(legacy);
        expect(item?.id).toBe(LEGACY_SHAPE);
        expect(item?.kind).toBe("star");
        expect(shapePropAt(c, legacy, item as never, "w", 0)).toBe(300);
        expect(shapePropAt(c, legacy, item as never, "strokeWidth", 0)).toBe(4);
        expect(itemOutline(c, legacy, item as never, 0).lines[0]?.points).toHaveLength(12);
        // A legacy line is a two-point open path.
        const line: VClip = newClip("shape", v1(c), 0, 5, "Line", { shape: { kind: "line", fill: null, stroke: "#FFF", strokeWidth: 6, w: 500, h: 0, radius: 0, sides: 0 } });
        expect(shapeItems(line)[0]).toMatchObject({ kind: "path", closed: false, points: [{ x: -250, y: 0 }, { x: 250, y: 0 }] });
        // Editing rewrites it as items, keeping its size.
        const migrated = withShapeItems(legacy);
        expect(migrated.shape).toBeUndefined();
        expect(migrated.shapes).toHaveLength(1);
        const id = migrated.shapes?.[0]?.id ?? "";
        expect(migrated.props[`shape.${id}.w`]).toBe(300);
        expect(updateShapeItem(legacy, id, { fill: "#0F0" }).shapes).toHaveLength(1);
    });
});

describe("video: parenting and the anchor point", () => {
    it("a child follows its parent's position, rotation and scale about the parent's position", () => {
        const c = comp();
        const parent = newClip("solid", v1(c), 0, 5, "Parent", { props: { x: 1160, y: 540 } });
        const child = setParent(newClip("solid", v2(c), 0, 5, "Child", { props: { x: 960, y: 540 } }), parent.id);
        const cp = { ...c, clips: [parent, child] };
        // The parent is 200 px right of centre: so is the child's anchor.
        expect(anchorWorld(cp, child, 0)).toEqual({ x: 1160, y: 540 });
        // The parent rotated a quarter turn: a child 100 px to its right ends up 100 px below it.
        const turned: VComp = { ...cp, clips: [{ ...parent, props: { ...parent.props, rotation: 90 } }, { ...child, props: { x: 1060, y: 540 } }] };
        const at = anchorWorld(turned, turned.clips[1] as VClip, 0);
        expect(at.x).toBeCloseTo(1160);
        expect(at.y).toBeCloseTo(640);
        // Scaled to half: half as far.
        const small: VComp = { ...cp, clips: [{ ...parent, props: { ...parent.props, scaleX: 50, scaleY: 50 } }, { ...child, props: { x: 1060, y: 540 } }] };
        expect(anchorWorld(small, small.clips[1] as VClip, 0).x).toBeCloseTo(1210);
        // Without a parent the matrix is the identity.
        expect(parentMatrix(cp, parent, 0)).toEqual([1, 0, 0, 1, 0, 0]);
    });

    it("parent chains read the parent at the composition's time; loops stop; a clip can't parent its own descendant", () => {
        const c = comp();
        const a = newClip("solid", v1(c), 1, 5, "A", { anim: { x: [{ t: 0, v: 0, ease: "linear" }, { t: 4, v: 400 }] } });
        const b = setParent(newClip("solid", v1(c), 2, 5, "B"), a.id);
        const d = setParent(newClip("solid", v1(c), 2, 5, "D"), b.id);
        const cp = { ...c, clips: [a, b, d] };
        expect(parentsOf(cp, d).map((p) => p.id)).toEqual([b.id, a.id]);
        // At 3 s in the sequence, B is 1 s in and A is 2 s in: A has moved to x = 200.
        expect(anchorWorld(cp, b, 1).x).toBeCloseTo(200);
        expect(apply(parentMatrix(cp, b, 1), 960, 540).x).toBeCloseTo(200);
        const loop = { ...cp, clips: [setParent(a, d.id), b, d] };
        expect(parentsOf(loop, d).map((p) => p.id)).toEqual([b.id, a.id]);
        expect(parentChoices(cp, a).map((p) => p.id)).toEqual([]);
        expect(parentChoices(cp, d).map((p) => p.id)).toEqual([a.id, b.id]);
    });

    it("moving the anchor point keeps the picture where it is", () => {
        const c = comp();
        const clip = newClip("solid", v1(c), 0, 5, "Box", { props: { rotation: 30, scaleX: 200, scaleY: 50 } });
        const moved = moveAnchor(c, clip, 40, -20, 0);
        expect(propAt(c, moved, "anchorX", 0)).toBe(40);
        expect(propAt(c, moved, "anchorY", 0)).toBe(-20);
        // The layer's top left: at position minus the anchor, through the clip's scale and rotation.
        const corner = (cl: VClip) => {
            const sx = propAt(c, cl, "scaleX", 0) / 100;
            const sy = propAt(c, cl, "scaleY", 0) / 100;
            const r = (propAt(c, cl, "rotation", 0) * Math.PI) / 180;
            const m = multiply([Math.cos(r) * sx, Math.sin(r) * sx, -Math.sin(r) * sy, Math.cos(r) * sy, propAt(c, cl, "x", 0), propAt(c, cl, "y", 0)], [1, 0, 0, 1, -(960 + propAt(c, cl, "anchorX", 0)), -(540 + propAt(c, cl, "anchorY", 0))]);
            return apply(m, 0, 0);
        };
        expect(corner(moved).x).toBeCloseTo(corner(clip).x);
        expect(corner(moved).y).toBeCloseTo(corner(clip).y);
        expect(apply(invert(parentMatrix(c, clip, 0)), 5, 6)).toEqual({ x: 5, y: 6 });
    });
});

describe("video: masks and track mattes", () => {
    it("a path mask starts as a diamond whose vertices move, join and leave; the last three stay", () => {
        const c = comp();
        const { clip, id } = addMask(newClip("solid", v1(c), 0, 5, "Box"), "path", "intersect");
        const mask = clip.masks[0];
        expect(mask).toMatchObject({ id, shape: "path", mode: "intersect" });
        expect(mask?.points).toHaveLength(4);
        const moved = moveMaskPoint(clip, id, 0, 0.1, 0.1);
        expect(moved.masks[0]?.points?.[0]).toEqual({ x: 0.1, y: 0.1 });
        const more = addMaskPoint(moved, id, 0.9, 0.9, 0);
        expect(more.masks[0]?.points?.[1]).toEqual({ x: 0.9, y: 0.9 });
        expect(more.masks[0]?.points).toHaveLength(5);
        let fewer = removeMaskPoint(more, id, 1);
        fewer = removeMaskPoint(fewer, id, 0);
        fewer = removeMaskPoint(fewer, id, 0);
        expect(fewer.masks[0]?.points).toHaveLength(3);
        expect(removeMaskPoint(fewer, id, 0).masks[0]?.points).toHaveLength(3);
        // Removing the mask takes its feather and expansion keys with it.
        const feathered = { ...fewer, props: { ...fewer.props, [`mask.${id}.feather`]: 20, [`mask.${id}.expand`]: 5, opacity: 50 } };
        expect(removeMask(feathered, id).props).toEqual({ opacity: 50 });
        expect(propAt(c, feathered, `mask.${id}.expand`, 0)).toBe(5);
        expect(propAt(c, clip, `mask.${id}.expand`, 0)).toBe(0);
    });

    it("a matted clip takes the picture on the track above as its matte, and that picture isn't drawn", () => {
        const c = comp();
        const below = newClip("solid", v1(c), 0, 5, "Fill", { matte: "luma" });
        const above = newClip("title", v2(c), 1, 2, "Text", { title: { text: "Hi", font: "Inter", weight: 700, size: 100, color: "#FFF", align: "center", tracking: 0, lineHeight: 1, animIn: "none", animOut: "none", animDur: 0.5 } });
        const cp = { ...c, clips: [below, above] };
        const bottom = cp.tracks.find((t) => t.id === v1(c));
        const top = cp.tracks.find((t) => t.id === v2(c));
        if (!bottom || !top) throw new Error("tracks");
        // At 2 s both are on: the title is the matte source.
        expect(matteSource(trackShot(cp, top, 2))?.clip.id).toBe(above.id);
        // At 0.5 s nothing is above: no matte, the clip draws as it is.
        expect(matteSource(trackShot(cp, top, 0.5))).toBeNull();
        // Sound and adjustment layers can't be mattes.
        const audio = { ...cp, clips: [below, newClip("adjustment", v2(c), 0, 5, "Adjust")] };
        expect(matteSource(trackShot(audio, top, 2))).toBeNull();
    });
});

describe("video: time remapping and easing", () => {
    it("time remapping keyframes say where the source is; off, speed and reverse take over again", () => {
        const c = comp();
        const clip = newClip("video", v1(c), 0, 4, "Shot", { in: 2, speed: 2 });
        expect(sourceAt(clip, 1, 100)).toBe(4);
        const on = toggleTimeRemap(clip);
        expect(timeRemapped(on)).toBe(true);
        // The keys start where the clip plays today: 2 s in at the start, 10 s in at the end.
        expect(on.anim.time).toEqual([{ t: 0, v: 2, ease: "linear" }, { t: 4, v: 10, ease: "linear" }]);
        expect(sourceAt(on, 1, 100)).toBe(4);
        // A freeze: both keys on the same source time.
        const frozen = { ...on, anim: { time: [{ t: 0, v: 3, ease: "linear" as const }, { t: 4, v: 3 }] } };
        expect(sourceAt(frozen, 0, 100)).toBe(3);
        expect(sourceAt(frozen, 3.9, 100)).toBe(3);
        // The default value of the "time" property is the clip's in point.
        expect(propAt(c, clip, "time", 0)).toBe(2);
        const off = toggleTimeRemap(on);
        expect(timeRemapped(off)).toBe(false);
        expect(sourceAt(off, 1, 100)).toBe(4);
        // Reversed clips start their remap at the end of the source.
        expect(toggleTimeRemap({ ...clip, reverse: true }).anim.time?.map((k) => k.v)).toEqual([10, 2]);
    });

    it("the new easings start at 0 and end at 1; back and elastic overshoot, bounce never does", () => {
        for (const kind of ["back-in", "back-out", "bounce", "elastic"] as const) {
            expect(ease(kind, 0)).toBeCloseTo(0);
            expect(ease(kind, 1)).toBeCloseTo(1);
        }
        expect(ease("back-in", 0.2)).toBeLessThan(0);
        expect(ease("back-out", 0.8)).toBeGreaterThan(1);
        expect(ease("elastic", 0.85)).not.toBeCloseTo(0.85, 1);
        const bounces = Array.from({ length: 50 }, (_, i) => ease("bounce", i / 49));
        expect(Math.max(...bounces)).toBeLessThanOrEqual(1 + 1e-9);
        expect(Math.min(...bounces)).toBeGreaterThanOrEqual(0);
    });
});
