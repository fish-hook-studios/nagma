// Loaded first so the collab ⇄ inspect-settings import cycle resolves (as a single bundle does in the app).
import "./inspect-settings";
import { beforeEach, describe, expect, it } from "vitest";
import { copySelection, duplicateSelection, nudge, paste, pasteAt, pasteOverSelection, pasteText, pasteToReplace } from "./actions";
import { viewport } from "./camera";
import { editor } from "./store";
import type { NagmaDocument } from "./types";
import { PAGE, add, box, emptyDoc, node } from "../test/core-fixtures";

// Layer coordinates are in the page's space (a child's x/y are not relative to its frame), so the
// frames here sit away from the origin to catch placement done in the wrong space.
function start(): NagmaDocument {
    let doc = emptyDoc();
    doc = add(doc, "frame", "A", { x: 500, y: 500, w: 300, h: 300 }, PAGE, { name: "A" });
    doc = add(doc, "rect", "BOX", { x: 620, y: 616, w: 40, h: 40 }, "A", { name: "Box" });
    doc = add(doc, "frame", "B", { x: 1000, y: 1000, w: 300, h: 300 }, PAGE, { name: "B" });
    doc = add(doc, "frame", "SMALL", { x: 2000, y: 2000, w: 100, h: 100 }, PAGE, { name: "Small" });
    doc = add(doc, "frame", "C", { x: 3000, y: 3000, w: 300, h: 300 }, PAGE, { name: "C" });
    doc = add(doc, "rect", "LOOSE", { x: 100, y: 100, w: 50, h: 50 }, PAGE, { name: "Rectangle 1" });
    doc = add(doc, "frame", "AL", { x: 4000, y: 0, w: 100, h: 100 }, PAGE, { name: "Stack", layout: { direction: "vertical", gap: 0, padding: [0, 0, 0, 0], primary: "start", counter: "start" } });
    return doc;
}

const doc = () => editor.get().doc;
const sel = () => editor.get().selection;

function copy(ids: string[]) {
    editor.set({ selection: ids });
    copySelection();
}

beforeEach(() => {
    viewport.width = 4000;
    viewport.height = 4000;
    editor.loadDocument(start(), null);
    editor.set({ camera: { x: 0, y: 0, zoom: 1 }, selection: [] });
});

describe("paste placement", () => {
    it("a loose layer pastes in place, numbered beside its original", () => {
        copy(["LOOSE"]);
        editor.set({ selection: [] });
        paste();
        const [id] = sel();
        const copyNode = node(doc(), id as string);
        expect(copyNode.parentId).toBe(PAGE);
        expect(box(doc(), copyNode.id)).toEqual({ x: 100, y: 100, w: 50, h: 50 });
        expect(copyNode.name).toBe("Rectangle 2");
    });

    it("a top-level frame pastes to the right of the original (width + 40)", () => {
        copy(["A"]);
        editor.set({ selection: [] });
        paste();
        const copyNode = node(doc(), sel()[0] as string);
        expect(box(doc(), copyNode.id)).toEqual({ x: 840, y: 500, w: 300, h: 300 });
        // Its contents move with it.
        const child = node(doc(), copyNode.children[0] as string);
        expect(box(doc(), child.id)).toEqual({ x: 960, y: 616, w: 40, h: 40 });
    });

    it("a layer copied from a frame goes back into that frame when nothing is selected", () => {
        copy(["BOX"]);
        editor.set({ selection: [] });
        paste();
        const copyNode = node(doc(), sel()[0] as string);
        expect(copyNode.parentId).toBe("A");
        expect(box(doc(), copyNode.id)).toEqual({ x: 620, y: 616, w: 40, h: 40 });
    });

    // Regression: paste into a frame kept the source's page coordinates and compared them with the
    // target's size, so frames away from the origin got copies outside them.
    it("into a selected frame the copy keeps its position relative to the source frame", () => {
        copy(["BOX"]);
        editor.set({ selection: ["B"] });
        paste();
        const copyNode = node(doc(), sel()[0] as string);
        expect(copyNode.parentId).toBe("B");
        expect(box(doc(), copyNode.id)).toEqual({ x: 1120, y: 1116, w: 40, h: 40 });
        expect(copyNode.name).toBe("Box");
    });

    it("into a frame too small for that position, the copy centres on the axes it can't keep", () => {
        copy(["BOX"]);
        editor.set({ selection: ["SMALL"] });
        paste();
        const copyNode = node(doc(), sel()[0] as string);
        expect(copyNode.parentId).toBe("SMALL");
        // 120 + 40 > 100 on x and 116 + 40 > 100 on y: both centred.
        expect(box(doc(), copyNode.id)).toEqual({ x: 2030, y: 2030, w: 40, h: 40 });
    });

    it("a loose layer pasted into a frame keeps its offset from the page origin when it fits, else centres", () => {
        copy(["LOOSE"]);
        editor.set({ selection: ["B"] });
        paste();
        const copyNode = node(doc(), sel()[0] as string);
        expect(copyNode.parentId).toBe("B");
        expect(box(doc(), copyNode.id)).toEqual({ x: 1100, y: 1100, w: 50, h: 50 });
    });

    it("with several frames selected each gets a copy, in one undo step", () => {
        copy(["BOX"]);
        editor.set({ selection: ["B", "C"] });
        const steps = editor.get().past.length;
        paste();
        expect(sel()).toHaveLength(2);
        const parents = sel().map((id) => node(doc(), id).parentId);
        expect(parents.sort()).toEqual(["B", "C"]);
        expect(box(doc(), sel().find((id) => node(doc(), id).parentId === "C") as string)).toEqual({ x: 3120, y: 3116, w: 40, h: 40 });
        expect(editor.get().past.length).toBe(steps + 1);
        editor.undo();
        expect(node(doc(), "B").children).toHaveLength(0);
        expect(node(doc(), "C").children).toHaveLength(0);
    });

    it("pastes into the middle of the view when the copy would land off screen", () => {
        copy(["LOOSE"]);
        viewport.width = 1000;
        viewport.height = 800;
        // The view shows world 5000..6000 x 5000..5800.
        editor.set({ selection: [], camera: { x: -5000, y: -5000, zoom: 1 } });
        paste();
        const copyNode = node(doc(), sel()[0] as string);
        expect(box(doc(), copyNode.id)).toEqual({ x: 5475, y: 5375, w: 50, h: 50 });
        // The move is part of the paste's undo step.
        editor.undo();
        expect(doc().nodes[copyNode.id]).toBeUndefined();
    });

    it("zooms out when the pasted layers are bigger than the view", () => {
        copy(["A"]);
        viewport.width = 200;
        viewport.height = 200;
        editor.set({ selection: [], camera: { x: -700, y: -500, zoom: 1 } });
        paste();
        expect(editor.get().camera.zoom).toBeLessThan(1);
    });

    it("paste here puts the copies' top-left at the pointer, inside the frame under it", () => {
        copy(["LOOSE"]);
        pasteAt({ x: 1050, y: 1060 });
        const copyNode = node(doc(), sel()[0] as string);
        expect(copyNode.parentId).toBe("B");
        expect(box(doc(), copyNode.id)).toEqual({ x: 1050, y: 1060, w: 50, h: 50 });
    });

    // Regression: the move to the pointer was folded into the selection step, so one undo put the
    // copy back where the original is instead of removing it.
    it("paste here is undone in one step", () => {
        copy(["LOOSE"]);
        const steps = editor.get().past.length;
        pasteAt({ x: 1050, y: 1060 });
        const id = sel()[0] as string;
        expect(editor.get().past.length).toBe(steps + 1);
        editor.undo();
        expect(doc().nodes[id]).toBeUndefined();
        editor.redo();
        expect(box(doc(), id)).toEqual({ x: 1050, y: 1060, w: 50, h: 50 });
    });

    it("a plain paste is one undo step that restores the selection", () => {
        copy(["LOOSE"]);
        editor.set({ selection: ["B"] });
        const steps = editor.get().past.length;
        paste();
        const id = sel()[0] as string;
        expect(editor.get().past.length).toBe(steps + 1);
        editor.undo();
        expect(doc().nodes[id]).toBeUndefined();
        expect(sel()).toEqual(["B"]);
    });

    // Regression: pasting or duplicating a frame moved only the frame, leaving its contents behind.
    it("duplicating a frame brings its contents along", () => {
        editor.set({ selection: ["A"] });
        duplicateSelection();
        const frame = node(doc(), sel()[0] as string);
        expect(box(doc(), frame.children[0] as string)).toEqual({ x: 620, y: 616, w: 40, h: 40 });
    });

    it("paste to replace with a frame moves the frame's contents too", () => {
        copy(["A"]);
        editor.set({ selection: ["LOOSE"] });
        pasteToReplace();
        const frame = node(doc(), sel()[0] as string);
        expect(box(doc(), frame.id)).toEqual({ x: 100, y: 100, w: 50, h: 50 });
        const child = node(doc(), frame.children[0] as string);
        // The child keeps its offset (120, 116) from the frame's corner.
        expect(child.x).toBe(220);
        expect(child.y).toBe(216);
    });

    it("paste here over an auto layout frame lands beside it, not inside", () => {
        copy(["LOOSE"]);
        pasteAt({ x: 4010, y: 10 });
        const copyNode = node(doc(), sel()[0] as string);
        expect(copyNode.parentId).toBe(PAGE);
        expect(box(doc(), copyNode.id)).toEqual({ x: 4010, y: 10, w: 50, h: 50 });
    });

    it("paste over selection lands in place in the selected layer's parent", () => {
        copy(["LOOSE"]);
        editor.set({ selection: ["BOX"] });
        pasteOverSelection();
        const copyNode = node(doc(), sel()[0] as string);
        expect(copyNode.parentId).toBe("A");
        expect(box(doc(), copyNode.id)).toEqual({ x: 100, y: 100, w: 50, h: 50 });
    });

    it("paste to replace takes the old layer's place, box and constraints", () => {
        editor.execute({ type: "node.update", id: "BOX", patch: { constraints: { h: "right", v: "bottom" } } });
        copy(["LOOSE"]);
        editor.set({ selection: ["BOX"] });
        pasteToReplace();
        expect(doc().nodes.BOX).toBeUndefined();
        const copyNode = node(doc(), sel()[0] as string);
        expect(copyNode.parentId).toBe("A");
        expect(box(doc(), copyNode.id)).toEqual({ x: 620, y: 616, w: 40, h: 40 });
        expect(copyNode.constraints).toEqual({ h: "right", v: "bottom" });
    });

    it("duplicate: frames and other layers in place, on top", () => {
        editor.set({ selection: ["A"] });
        duplicateSelection();
        expect(box(doc(), sel()[0] as string)).toEqual({ x: 500, y: 500, w: 300, h: 300 });
        editor.set({ selection: ["BOX"] });
        duplicateSelection();
        expect(box(doc(), sel()[0] as string)).toEqual({ x: 620, y: 616, w: 40, h: 40 });
        expect(node(doc(), sel()[0] as string).name).toBe("Box 2");
    });

    it("⌘D after moving the copy repeats the moved offset", () => {
        editor.set({ selection: ["LOOSE"] });
        duplicateSelection();
        expect(box(doc(), sel()[0] as string)).toEqual({ x: 100, y: 100, w: 50, h: 50 });
        // Moved 10 right with the arrow keys (not a canvas drag).
        nudge(10, 0);
        duplicateSelection();
        expect(box(doc(), sel()[0] as string)).toEqual({ x: 120, y: 100, w: 50, h: 50 });
        duplicateSelection();
        expect(box(doc(), sel()[0] as string)).toEqual({ x: 130, y: 100, w: 50, h: 50 });
    });

    // Regression: plain text pasted into a selected frame was centred on the frame's size measured
    // from the page origin, not on the frame.
    it("plain text pastes centred in the selected frame", () => {
        editor.set({ selection: ["B"] });
        pasteText("Hello");
        const t = node(doc(), sel()[0] as string);
        expect(t.parentId).toBe("B");
        expect(t.type).toBe("text");
        // Rounded to whole pixels.
        expect(Math.abs(t.x + t.w / 2 - 1150)).toBeLessThanOrEqual(1);
        expect(Math.abs(t.y + t.h / 2 - 1150)).toBeLessThanOrEqual(1);
    });

    it("plain text pastes at the view centre with nothing selected", () => {
        viewport.width = 1000;
        viewport.height = 800;
        editor.set({ selection: [], camera: { x: 0, y: 0, zoom: 2 } });
        pasteText("  Line one\r\nLine two  ");
        const t = node(doc(), sel()[0] as string);
        expect(t.parentId).toBe(PAGE);
        expect(t.text).toBe("Line one\nLine two");
        expect(t.name).toBe("Line one");
        expect(Math.abs(t.x + t.w / 2 - 250)).toBeLessThanOrEqual(1);
        expect(Math.abs(t.y + t.h / 2 - 200)).toBeLessThanOrEqual(1);
    });

    it("blank text pastes nothing", () => {
        const before = doc();
        pasteText("  \n ");
        expect(doc()).toBe(before);
    });
});
