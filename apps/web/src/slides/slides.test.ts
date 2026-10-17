import "../test/prod-fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "../engine/commands";
import { activePage } from "../engine/page";
import { editor, prepareDocument } from "../engine/store";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { expectConsistentTree } from "../test/prod-fixtures";
import { addSlide, deleteSlides, dropSlides, duplicateSlides, groupSlides, moveSlide, moveSlidesToSection, nudgeSlides, patchSlide, setFooter, setNotes, setSlideNumbers, toggleSkip, toggleSkipSlides, ungroup } from "./actions";
import { addSlideCommands, createSlidesDocument, deckOf, deckPage, slideIds, slideNumbers, slideOf, slidesBySection, tidyCommands, SLIDE_W } from "./model";
import { goToSlide, slides } from "./state";
import { cellAt, cellsIn, deleteColumns, deleteRows, insertColumn, insertRow, mergeCells, moveColumn, moveRow, resizeTrack, splitCell, tableModel } from "./tables";
import { editTable, insertTable } from "./widgets";

// A deck with `n` blank slides, loaded in the editor.
function deck(n: number): string[] {
    let doc: NagmaDocument = createSlidesDocument("Talk");
    for (let i = 1; i < n; i++) {
        const made = addSlideCommands(doc, "blank", slideIds(doc).at(-1) ?? null);
        doc = applyCommand(doc, { type: "batch", commands: made.commands });
    }
    doc = applyCommand(doc, { type: "batch", commands: tidyCommands(doc) });
    editor.loadDocument(doc, null);
    activePage.id = doc.roots[0] as string;
    slides.set({ current: {}, picked: [] });
    return slideIds(doc);
}

const doc = () => editor.get().doc;
const order = () => slideIds(doc());
const rows = () => slidesBySection(doc()).map((r) => r.ids);
const names = () => order().map((id) => doc().nodes[id]?.name);

describe("slide order and groups", () => {
    let ids: string[];
    beforeEach(() => {
        ids = deck(5);
    });

    it("a new deck: slides in their own rows, numbered and laid out in a grid", () => {
        expect(order()).toEqual(ids);
        expect(rows()).toEqual(ids.map((id) => [id]));
        expect(names()).toEqual(["Slide 1", "Slide 2", "Slide 3", "Slide 4", "Slide 5"]);
        const ys = ids.map((id) => doc().nodes[id]?.y);
        expect(new Set(ys).size).toBe(5);
        expect(ids.every((id) => doc().nodes[id]?.x === 0)).toBe(true);
        expectConsistentTree(doc());
    });

    it("group slides into one row (in deck order), ungroup back to rows of one", () => {
        const [a, b, c, d, e] = ids as [string, string, string, string, string];
        groupSlides([d, b]);
        expect(rows()).toEqual([[a], [b, d], [c], [e]]);
        expect(order()).toEqual([a, b, d, c, e]);
        // Renamed by their new places; the grouped row's slides side by side.
        expect(names()).toEqual(["Slide 1", "Slide 2", "Slide 3", "Slide 4", "Slide 5"]);
        expect(doc().nodes[d]?.y).toBe(doc().nodes[b]?.y);
        expect((doc().nodes[d]?.x as number) - (doc().nodes[b]?.x as number)).toBeGreaterThanOrEqual(SLIDE_W);
        const section = slideOf(doc().nodes[b])?.section as string;
        expect(slideOf(doc().nodes[d])?.section).toBe(section);
        ungroup(section);
        expect(rows()).toEqual([[a], [b], [d], [c], [e]]);
        editor.undo();
        expect(rows()).toEqual([[a], [b, d], [c], [e]]);
        editor.undo();
        expect(rows()).toEqual(ids.map((id) => [id]));
        expect(order()).toEqual(ids);
    });

    it("grouping fewer than two slides does nothing", () => {
        const steps = editor.get().past.length;
        groupSlides([ids[0] as string]);
        groupSlides([]);
        expect(editor.get().past.length).toBe(steps);
    });

    it("nudge a slide earlier and later; at the ends it stays", () => {
        const [a, b, c] = ids as [string, string, string];
        nudgeSlides(-1, [c]);
        expect(order().slice(0, 3)).toEqual([a, c, b]);
        nudgeSlides(1, [c]);
        expect(order().slice(0, 3)).toEqual([a, b, c]);
        const steps = editor.get().past.length;
        nudgeSlides(-1, [a]);
        nudgeSlides(1, [ids[4] as string]);
        expect(editor.get().past.length).toBe(steps);
        expect(order()).toEqual(ids);
    });

    it("drop slides before another; indented they join the group above", () => {
        const [a, b, c, d, e] = ids as [string, string, string, string, string];
        dropSlides([e, d], a, false);
        expect(order()).toEqual([e, d, a, b, c]);
        expect(rows()).toEqual([[e], [d], [a], [b], [c]]);
        dropSlides([c], b, true);
        expect(rows()).toEqual([[e], [d], [a, c], [b]]);
        dropSlides([a], null, false);
        expect(order().at(-1)).toBe(a);
        expectConsistentTree(doc());
    });

    it("moveSlide puts a slide at an index in a section; move slides to a new group", () => {
        const [a, b, c, d] = ids as [string, string, string, string];
        groupSlides([b, c]);
        const section = slideOf(doc().nodes[b])?.section as string;
        moveSlide(d, section, 0);
        expect(slidesBySection(doc()).find((r) => r.section.id === section)?.ids).toEqual([d, b, c]);
        // A new group goes where the first of the slides was (QA: it went to the end of the deck).
        moveSlidesToSection([a, d], null);
        expect(rows()[0]).toEqual([a, d]);
        expect(order().slice(0, 2)).toEqual([a, d]);
    });

    it("duplicate slides puts each copy after its original; delete keeps at least one slide", () => {
        const [a, b] = ids as [string, string];
        duplicateSlides([a, b]);
        const now = order();
        expect(now).toHaveLength(7);
        expect(now[0]).toBe(a);
        expect(now[2]).toBe(b);
        expect(doc().nodes[now[1] as string]?.name).toBe("Slide 2");
        deleteSlides(now.slice(0, 6));
        expect(order()).toHaveLength(1);
        const steps = editor.get().past.length;
        deleteSlides(order());
        expect(order()).toHaveLength(1);
        expect(editor.get().past.length).toBe(steps);
        editor.undo();
        expect(order()).toHaveLength(7);
    });

    it("skipped slides don't count in numbers; toggling many skips all, then shows all", () => {
        const [a, b, c] = ids as [string, string, string];
        toggleSkip(b);
        expect(slideOf(doc().nodes[b])?.skip).toBe(true);
        expect([...slideNumbers(doc()).entries()]).toEqual([
            [a, 1],
            [c, 2],
            [ids[3], 3],
            [ids[4], 4],
        ]);
        toggleSkipSlides([a, b]);
        expect([a, b].map((id) => slideOf(doc().nodes[id])?.skip)).toEqual([true, true]);
        toggleSkipSlides([a, b]);
        expect([a, b].map((id) => Boolean(slideOf(doc().nodes[id])?.skip))).toEqual([false, false]);
        // Slide numbers follow skips.
        setSlideNumbers(true);
        toggleSkip(a);
        const label = (id: string) => doc().nodes[id]?.children.map((k) => doc().nodes[k]).find((n) => n?.deck?.kind === "text" && n.deck.role === "slide-number")?.text;
        expect(label(a)).toBeUndefined();
        expect([label(b), label(c)]).toEqual(["1", "2"]);
        setSlideNumbers(false);
        expect(label(b)).toBeUndefined();
    });

    it("footers on every slide unless one opts out", () => {
        setFooter("Acme · Confidential");
        const footer = (id: string) => doc().nodes[id]?.children.map((k) => doc().nodes[k]).find((n) => n?.deck?.kind === "text" && n.deck.role === "footer")?.text;
        expect(ids.map(footer)).toEqual(ids.map(() => "Acme · Confidential"));
        patchSlide(ids[1] as string, { noFooter: true });
        expect(footer(ids[1] as string)).toBeUndefined();
        setFooter("");
        expect(ids.map(footer)).toEqual(ids.map(() => undefined));
    });

    it("speaker notes save as one undo step and survive save/reload", () => {
        setNotes(ids[0] as string, "Remember the demo\nand the joke", true);
        expect(slideOf(doc().nodes[ids[0] as string])?.notes).toBe("Remember the demo\nand the joke");
        const steps = editor.get().past.length;
        setNotes(ids[0] as string, "Remember the demo\nand the joke", true);
        expect(editor.get().past.length).toBe(steps);
        const saved = JSON.parse(JSON.stringify(doc())) as NagmaDocument;
        const loaded = prepareDocument(JSON.parse(JSON.stringify(doc())) as NagmaDocument) as NagmaDocument;
        expect(loaded).toEqual(saved);
        expect(slideOf(loaded.nodes[ids[0] as string])?.notes).toBe("Remember the demo\nand the joke");
        editor.undo();
        expect(slideOf(doc().nodes[ids[0] as string])?.notes ?? "").toBe("");
    });

    it("add slide after the current one", () => {
        goToSlide(ids[1] as string);
        addSlide("blank");
        expect(order()).toHaveLength(6);
        expect(order()[2]).not.toBe(ids[2]);
        expect(deckOf(doc()).sections.length).toBe(6);
        expect(deckPage(doc())?.children.filter((c) => slideOf(doc().nodes[c]))).toHaveLength(6);
    });
});

describe("slide tables", () => {
    let slide: string;
    let table: string;
    beforeEach(() => {
        [slide] = deck(1) as [string];
        goToSlide(slide);
        insertTable([
            ["Name", "Qty", "Price"],
            ["Tea", "2", "3"],
            ["Cake", "1", "5"],
        ]);
        table = editor.get().selection[0] as string;
    });

    const model = () => tableModel(doc(), doc().nodes[table] as SceneNode);
    const textAt = (r: number, c: number) => {
        const cell = cellAt(model(), r, c);
        const node = cell ? doc().nodes[cell.id] : undefined;
        return node?.children.map((k) => doc().nodes[k]).find((n) => n?.type === "text")?.text;
    };
    const grid = () => model().rows.map((_, r) => model().cols.map((_, c) => textAt(r, c) ?? null));
    // Every cell sits where the model says, and cells exactly tile the table.
    const expectTiled = () => {
        const m = model();
        const t = doc().nodes[table] as SceneNode;
        const covered = new Map<string, number>();
        for (const cell of m.cells) {
            const n = doc().nodes[cell.id] as SceneNode;
            expect(n.parentId).toBe(table);
            expect(n.x).toBe(t.x + m.cols.slice(0, cell.c).reduce((a, b) => a + b, 0));
            expect(n.y).toBe(t.y + m.rows.slice(0, cell.r).reduce((a, b) => a + b, 0));
            for (let r = cell.r; r < cell.r + cell.rs; r++) for (let c = cell.c; c < cell.c + cell.cs; c++) covered.set(`${r},${c}`, (covered.get(`${r},${c}`) ?? 0) + 1);
        }
        expect(covered.size).toBe(m.rows.length * m.cols.length);
        expect([...covered.values()].every((v) => v === 1)).toBe(true);
        expect([t.w, t.h]).toEqual([m.cols.reduce((a, b) => a + b, 0), m.rows.reduce((a, b) => a + b, 0)]);
        expectConsistentTree(doc());
    };

    it("a pasted block becomes a table with the text in its cells", () => {
        expect(grid()).toEqual([
            ["Name", "Qty", "Price"],
            ["Tea", "2", "3"],
            ["Cake", "1", "5"],
        ]);
        expect(doc().nodes[table]?.parentId).toBe(slide);
        expectTiled();
    });

    // Regression: inserting a table and selecting it were two undo steps (undo only deselected).
    it("inserting a table is one undo step", () => {
        editor.undo();
        expect(doc().nodes[table]).toBeUndefined();
    });

    it("add and remove rows and columns, each one undo step", () => {
        insertRow(table, 1);
        expect(grid()).toEqual([
            ["Name", "Qty", "Price"],
            ["", "", ""],
            ["Tea", "2", "3"],
            ["Cake", "1", "5"],
        ]);
        expectTiled();
        insertColumn(table, 3);
        expect(grid().map((r) => r[3])).toEqual(["", "", "", ""]);
        expectTiled();
        deleteRows(table, [1]);
        deleteColumns(table, [0]);
        expect(grid()).toEqual([
            ["Qty", "Price", ""],
            ["2", "3", ""],
            ["1", "5", ""],
        ]);
        expectTiled();
        editor.undo();
        editor.undo();
        expect(grid()[1]).toEqual(["", "", "", ""]);
        editTable(table, "add-row");
        expect(model().rows).toHaveLength(5);
        editTable(table, "remove-column");
        expect(model().cols).toHaveLength(3);
        expectTiled();
    });

    it("a table keeps at least one row and column", () => {
        deleteRows(table, [0, 1, 2]);
        deleteColumns(table, [0, 1, 2, 2]);
        expect([model().rows.length, model().cols.length]).toEqual([3, 3]);
    });

    it("merge a rectangle of cells (texts joined), refuse a non-rectangle, split back", () => {
        const m = model();
        const ids = [cellAt(m, 1, 0)?.id, cellAt(m, 1, 1)?.id, cellAt(m, 2, 0)?.id, cellAt(m, 2, 1)?.id] as string[];
        mergeCells(table, ids);
        const merged = cellAt(model(), 1, 0);
        expect(merged).toMatchObject({ r: 1, c: 0, rs: 2, cs: 2 });
        expect(editor.get().selection).toEqual([merged?.id]);
        expect(cellAt(model(), 2, 1)?.id).toBe(merged?.id);
        expect(textAt(1, 0)).toBe("Tea 2 Cake 1");
        // Regression: one undo takes the merge back (selecting the merged cell was its own step).
        editor.undo();
        expect(model().cells).toHaveLength(9);
        expect(textAt(1, 0)).toBe("Tea");
        editor.redo();
        expect(cellAt(model(), 1, 0)).toMatchObject({ rs: 2, cs: 2 });
        expect(ids.slice(1).map((id) => doc().nodes[id])).toEqual([undefined, undefined, undefined]);
        expectTiled();
        // Merged rows can't move.
        const before = model().rows;
        moveRow(table, 0, 2);
        expect(model().rows).toEqual(before);
        // Deleting a row through the merge shrinks it.
        deleteRows(table, [2]);
        expect(cellAt(model(), 1, 0)).toMatchObject({ rs: 1, cs: 2 });
        expectTiled();
        splitCell(table, cellAt(model(), 1, 0)?.id as string);
        expect(model().cells.every((c) => c.rs === 1 && c.cs === 1)).toBe(true);
        expect(model().cells).toHaveLength(6);
        expectTiled();

        // Cells whose rectangle cuts through a merged cell can't merge.
        const now = model();
        mergeCells(table, [cellAt(now, 0, 0)?.id as string, cellAt(now, 0, 1)?.id as string]);
        const header = cellAt(model(), 0, 0);
        expect(header).toMatchObject({ rs: 1, cs: 2 });
        const cellsBefore = model().cells.length;
        mergeCells(table, [cellAt(model(), 0, 2)?.id as string, cellAt(model(), 1, 1)?.id as string]);
        expect(model().cells).toHaveLength(cellsBefore);
        expect(cellAt(model(), 0, 0)).toEqual(header);
        expectTiled();
    });

    it("move rows and columns, resize tracks (min 24)", () => {
        moveRow(table, 2, 1);
        expect(grid().map((r) => r[0])).toEqual(["Name", "Cake", "Tea"]);
        moveColumn(table, 0, 2);
        expect(grid()[0]).toEqual(["Qty", "Price", "Name"]);
        expectTiled();
        resizeTrack(table, "column", 0, 10);
        expect(model().cols[0]).toBe(24);
        resizeTrack(table, "row", 1, 333.4);
        expect(model().rows[1]).toBe(333);
        resizeTrack(table, "row", 9, 100);
        expectTiled();
        expect(cellsIn(model(), "row", 0)).toHaveLength(3);
        expect(cellsIn(model(), "column", 1)).toHaveLength(3);
    });
});
