import "../test/prod-fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pluginDown, pluginUp } from "../canvas/canvas-plugins";
import { activePage } from "../engine/page";
import { editor, prepareDocument } from "../engine/store";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { expectConsistentTree } from "../test/prod-fixtures";
import { elbowCoords, facingSide, nearestSide, pointAlong, rerouteCommands, routeOf, sidePoint, storedEnds } from "./connectors";
import { createBoardDocument, jamOf, makeConnector, makeSticky, makeTable } from "./model";
import { setSectionLockBg, toggleSectionHidden } from "./sections";
import { board } from "./state";
import "./sticky";
import { anchorOf, clearCells, covered, deleteTracks, duplicateTracks, expand, fillCells, hasMerge, insertTracks, mergeCells, mergeAt, moveTracks, patchJamCell, stepCell, styleCells, unmergeCells } from "./table";
import { amVoting, clearVoting, endVoting, imDone, joinVoting, myVotes, results, startVoting, turnout, voting, votingOpen } from "./voting";

function load(doc: NagmaDocument) {
    editor.loadDocument(doc, null);
    activePage.id = doc.roots[0] as string;
    editor.set({ tool: "move", readOnly: false });
}

const doc = () => editor.get().doc;
const page = () => doc().roots[0] as string;
const add = (node: SceneNode) => {
    editor.execute({ type: "node.create", node });
    return node.id;
};
// Board fixes (connector routes, sticky growth) run in a microtask after each edit.
const settle = () => new Promise<void>((r) => queueMicrotask(() => queueMicrotask(r)));

// ---- Tables ----

describe("board tables", () => {
    let id: string;
    const jam = () => jamOf(doc().nodes[id], "table") as NonNullable<ReturnType<typeof jamOf<"table">>>;
    beforeEach(() => {
        load(createBoardDocument("B"));
        id = add(
            makeTable(doc(), 0, 0, page(), 3, 3, [
                ["A", "B", "C"],
                ["1", "2", "3"],
                ["x", "y", "z"],
            ]),
        );
    });

    it("cell text edits and undo", () => {
        patchJamCell(id, [1, 2], "three");
        expect(jam().cells[1]).toEqual(["1", "2", "three"]);
        editor.undo();
        expect(jam().cells[1]).toEqual(["1", "2", "3"]);
    });

    it("insert rows and columns (text moves with its tracks, the table grows)", () => {
        insertTracks(id, "row", 1);
        expect(jam().cells.map((r) => r.join(""))).toEqual(["ABC", "", "123", "xyz"]);
        expect(doc().nodes[id]?.h).toBe(48 * 4);
        insertTracks(id, "col", 3, 2);
        expect(jam().cells[0]).toEqual(["A", "B", "C", "", ""]);
        expect(doc().nodes[id]?.w).toBe(160 * 5);
        insertTracks(id, "col", -5);
        expect(jam().cells[0]?.[0]).toBe("");
        insertTracks(id, "row", 99);
        expect(jam().rows).toHaveLength(5);
        expect(jam().cells.every((r) => r.length === jam().cols.length)).toBe(true);
    });

    it("delete, move and duplicate tracks; the last row can't go", () => {
        deleteTracks(id, "row", [0]);
        expect(jam().cells.map((r) => r.join(""))).toEqual(["123", "xyz"]);
        deleteTracks(id, "col", [0, 2]);
        expect(jam().cells).toEqual([["2"], ["y"]]);
        const before = jam();
        deleteTracks(id, "col", [0]);
        expect(jam()).toEqual(before);
        editor.undo();
        editor.undo();
        expect(jam().cells.map((r) => r.join(""))).toEqual(["ABC", "123", "xyz"]);
        moveTracks(id, "row", [2], 0);
        expect(jam().cells.map((r) => r.join(""))).toEqual(["xyz", "ABC", "123"]);
        const steps = editor.get().past.length;
        moveTracks(id, "row", [0], 0);
        expect(editor.get().past.length).toBe(steps);
        duplicateTracks(id, "col", [0, 1]);
        expect(jam().cells[0]).toEqual(["x", "y", "x", "y", "z"]);
    });

    it("merge a block (texts join in the top-left), navigate around it, unmerge", () => {
        mergeCells(id, { top: 0, left: 0, bottom: 1, right: 1 });
        expect(jam().merges).toEqual([{ r: 0, c: 0, rs: 2, cs: 2 }]);
        expect(jam().cells[0]?.[0]).toBe("A\nB\n1\n2");
        expect([covered(jam(), 1, 1), covered(jam(), 0, 0), anchorOf(jam(), 1, 1), mergeAt(jam(), 2, 2)]).toEqual([true, false, [0, 0], null]);
        expect(stepCell(jam(), 1, 1, "right")).toEqual([1, 2]);
        expect(stepCell(jam(), 0, 0, "down")).toEqual([2, 0]);
        expect(stepCell(jam(), 2, 1, "up")).toEqual([0, 0]);
        expect(stepCell(jam(), 0, 0, "next")).toEqual([0, 2]);
        expect(stepCell(jam(), 0, 2, "prev")).toEqual([0, 0]);
        expect(stepCell(jam(), 0, 0, "prev")).toBeNull();
        expect(stepCell(jam(), 2, 2, "next")).toBeNull();
        expect(stepCell(jam(), 0, 2, "up")).toBeNull();
        // A block touching the merge grows to include it.
        expect(expand(jam(), { top: 1, left: 1, bottom: 1, right: 2 })).toEqual({ top: 0, left: 0, bottom: 1, right: 2 });
        expect(hasMerge(jam(), { top: 2, left: 2, bottom: 2, right: 2 })).toBe(false);
        // Inserting a row inside the merge grows it; deleting a merged row shrinks it.
        insertTracks(id, "row", 1);
        expect(jam().merges).toEqual([{ r: 0, c: 0, rs: 3, cs: 2 }]);
        deleteTracks(id, "row", [0]);
        expect(jam().merges).toEqual([{ r: 0, c: 0, rs: 2, cs: 2 }]);
        unmergeCells(id, { top: 1, left: 1, bottom: 1, right: 1 });
        expect(jam().merges).toBeUndefined();
        const steps = editor.get().past.length;
        unmergeCells(id, { top: 0, left: 0, bottom: 2, right: 2 });
        mergeCells(id, { top: 2, left: 2, bottom: 2, right: 2 });
        expect(editor.get().past.length).toBe(steps);
    });

    it("moving a merged row away from its partner drops the merge rather than corrupting it", () => {
        mergeCells(id, { top: 0, left: 0, bottom: 1, right: 0 });
        moveTracks(id, "row", [0], 2);
        expect(jam().merges ?? []).toEqual([]);
        expect(jam().cells.every((r) => r.length === 3)).toBe(true);
    });

    it("cell looks: fill, style and clear a block (or every cell)", () => {
        fillCells(id, { top: 0, left: 0, bottom: 0, right: 2 }, "#FFEEAA");
        expect(jam().fills?.[0]).toEqual(["#FFEEAA", "#FFEEAA", "#FFEEAA"]);
        expect(jam().fills?.[1]).toEqual([null, null, null]);
        styleCells(id, null, { bold: true });
        expect(jam().styles?.every((r) => r.every((s) => s?.bold === true))).toBe(true);
        styleCells(id, { top: 2, left: 2, bottom: 2, right: 2 }, { bold: undefined });
        expect(jam().styles?.[2]?.[2]).toBeNull();
        // Fills and styles travel with their rows.
        moveTracks(id, "row", [0], 2);
        expect(jam().fills?.[2]).toEqual(["#FFEEAA", "#FFEEAA", "#FFEEAA"]);
        clearCells(id, { top: 0, left: 0, bottom: 5, right: 5 });
        expect(jam().cells.flat().every((t) => t === "")).toBe(true);
    });
});

// ---- Connectors ----

describe("board connectors", () => {
    let a: string;
    let b: string;
    let line: string;
    beforeEach(async () => {
        load(createBoardDocument("B"));
        a = add(makeSticky(doc(), 0, 0, "#FFE299", page(), "me"));
        b = add(makeSticky(doc(), 600, 0, "#FFE299", page(), "me"));
        line = add(makeConnector(doc(), { id: a, side: null, x: 240, y: 120 }, { id: b, side: null, x: 600, y: 120 }, "elbow", "#1E1E1E", page()));
        await settle();
    });
    const conn = () => doc().nodes[line] as SceneNode;
    const ends = () => storedEnds(doc(), conn());

    it("geometry helpers", () => {
        const box = { x: 0, y: 0, w: 100, h: 50 };
        expect([sidePoint(box, "top"), sidePoint(box, "right"), sidePoint(box, "bottom"), sidePoint(box, "left")]).toEqual([
            { x: 50, y: 0 },
            { x: 100, y: 25 },
            { x: 50, y: 50 },
            { x: 0, y: 25 },
        ]);
        expect([facingSide(box, { x: 500, y: 30 }), facingSide(box, { x: 50, y: -400 }), facingSide(box, { x: -1, y: 25 })]).toEqual(["right", "top", "left"]);
        expect(nearestSide(box, { x: 98, y: 20 })).toBe("right");
        expect(elbowCoords([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 100 }])).toEqual({ axis: "h", coords: [50] });
    });

    it("ends attach to the facing sides of the shapes", () => {
        expect(ends()).toEqual([
            { x: 240, y: 120 },
            { x: 600, y: 120 },
        ]);
    });

    it("moving a shape re-routes the connector in the same undo step", async () => {
        editor.execute({ type: "node.move", ids: [b], dx: 0, dy: 400 });
        await settle();
        const [s, e] = ends() as [{ x: number; y: number }, { x: number; y: number }];
        // b is now below-right: its top side or left side faces a.
        const bb = doc().nodes[b] as SceneNode;
        expect(e.x >= bb.x - 0.5 && e.x <= bb.x + bb.w + 0.5 && e.y >= bb.y - 0.5 && e.y <= bb.y + bb.h + 0.5).toBe(true);
        expect(s.x).toBeGreaterThanOrEqual(0);
        // Elbowed: every segment is horizontal or vertical.
        const pts = conn().path?.subpaths[0]?.points ?? [];
        for (let i = 1; i < pts.length; i++) {
            const p = pts[i - 1] as { x: number; y: number };
            const q = pts[i] as { x: number; y: number };
            expect(Math.abs(p.x - q.x) < 0.01 || Math.abs(p.y - q.y) < 0.01).toBe(true);
        }
        expect(rerouteCommands(doc())).toEqual([]);
        editor.undo();
        await settle();
        expect(doc().nodes[b]?.y).toBe(0);
        expect(ends()).toEqual([
            { x: 240, y: 120 },
            { x: 600, y: 120 },
        ]);
    });

    it("deleting an end's shape leaves that end loose where it was", async () => {
        editor.execute({ type: "node.delete", ids: [b] });
        await settle();
        const jam = jamOf(conn(), "connector");
        expect(jam?.end).toMatchObject({ id: null, x: 600, y: 120 });
        expect(jam?.start.id).toBe(a);
        // Moving the remaining shape still drags the start; the loose end stays.
        editor.execute({ type: "node.move", ids: [a], dx: 0, dy: -200 });
        await settle();
        const [s, e] = ends() as [{ x: number; y: number }, { x: number; y: number }];
        expect(e).toEqual({ x: 600, y: 120 });
        expect(s.y).toBeLessThan(120);
        expectConsistentTree(doc());
        // Undo brings the shape back attached.
        editor.undo();
        editor.undo();
        await settle();
        expect(jamOf(conn(), "connector")?.end.id).toBe(b);
    });

    it("straight and curved routes", () => {
        const jam = jamOf(conn(), "connector") as NonNullable<ReturnType<typeof jamOf<"connector">>>;
        const straight = routeOf(doc(), { ...jam, line: "straight" });
        expect(straight.points).toEqual([
            { x: 240, y: 120, dir: { x: 1, y: 0 } },
            { x: 600, y: 120, dir: { x: -1, y: 0 } },
        ]);
        const curved = routeOf(doc(), { ...jam, line: "curved" });
        expect(curved.points).toHaveLength(4);
        expect(pointAlong(curved, 0)).toMatchObject({ x: 240, y: 120 });
        expect(pointAlong(curved, 1)).toMatchObject({ x: 600, y: 120 });
        const mid = pointAlong(curved, 0.5);
        expect(mid.x).toBeCloseTo(420, 0);
    });

    it("a connector to a hidden shape treats that end as loose", () => {
        const jam = jamOf(conn(), "connector") as NonNullable<ReturnType<typeof jamOf<"connector">>>;
        const hidden = { ...doc(), nodes: { ...doc().nodes, [b]: { ...(doc().nodes[b] as SceneNode), visible: false } } };
        expect(routeOf(hidden, jam).end).toMatchObject({ x: 600, y: 120, dir: null });
    });
});

// ---- Stickies and sections ----

describe("stickies and sections", () => {
    beforeEach(() => load(createBoardDocument("B")));

    it("a sticky grows with its text and shrinks back to its own size", async () => {
        const s = add(makeSticky(doc(), 0, 0, "#FFE299", page(), "me"));
        editor.execute({ type: "node.update", id: s, patch: { text: "word ".repeat(200) } });
        await settle();
        const grown = doc().nodes[s] as SceneNode;
        expect(grown.h).toBeGreaterThan(240);
        expect(jamOf(grown, "sticky")?.baseH).toBe(240);
        // Grown in the same undo step as the text.
        editor.undo();
        expect(doc().nodes[s]?.h).toBe(240);
        expect(doc().nodes[s]?.text).toBe("");
        editor.redo();
        editor.execute({ type: "node.update", id: s, patch: { text: "short" } });
        await settle();
        expect(doc().nodes[s]?.h).toBe(240);
        expect(jamOf(doc().nodes[s], "sticky")?.baseH).toBeUndefined();
    });

    it("hiding a section hides what was showing, and showing brings back only that", () => {
        const section = { ...makeSticky(doc(), 0, 0, "#FFFFFF", page(), "me"), type: "frame" as const, w: 1000, h: 1000, isSection: true, jam: { kind: "section" as const } };
        add(section);
        const kids = [0, 1, 2].map((i) => add(makeSticky(doc(), 10 + i * 250, 10, "#FFE299", section.id, "me")));
        editor.execute({ type: "node.update", id: kids[2] as string, patch: { visible: false } });
        editor.set({ selection: [kids[0] as string, section.id] });
        toggleSectionHidden(section.id);
        expect(kids.map((k) => doc().nodes[k]?.visible)).toEqual([false, false, false]);
        expect(jamOf(doc().nodes[section.id], "section")).toMatchObject({ hidden: true, shown: [kids[0], kids[1]] });
        expect(editor.get().selection).toEqual([section.id]);
        toggleSectionHidden(section.id);
        expect(kids.map((k) => doc().nodes[k]?.visible)).toEqual([true, true, false]);
        expect(jamOf(doc().nodes[section.id], "section")?.hidden).toBe(false);
        setSectionLockBg(section.id, true);
        expect(jamOf(doc().nodes[section.id], "section")?.lockBg).toBe(true);
        setSectionLockBg(section.id, false);
        expect(jamOf(doc().nodes[section.id], "section")?.lockBg).toBeUndefined();
        // Not a section: nothing happens.
        const steps = editor.get().past.length;
        toggleSectionHidden(kids[0] as string);
        expect(editor.get().past.length).toBe(steps);
    });

    it("a board document survives save and reload", async () => {
        const a = add(makeSticky(doc(), 0, 0, "#FFE299", page(), "me"));
        const b = add(makeSticky(doc(), 400, 0, "#FFE299", page(), "me"));
        add(makeConnector(doc(), { id: a, side: "right", x: 240, y: 120 }, { id: b, side: "left", x: 400, y: 120 }, "straight", "#000000", page()));
        add(makeTable(doc(), 0, 400, page()));
        await settle();
        const saved = JSON.parse(JSON.stringify(doc())) as NagmaDocument;
        expect(prepareDocument(JSON.parse(JSON.stringify(doc())) as NagmaDocument)).toEqual(saved);
    });
});

// ---- Voting ----

describe("voting sessions", () => {
    let ids: string[];
    const as = (who: string) => localStorage.setItem("nagma.board.voter", who);
    const click = (id: string) => {
        const n = doc().nodes[id] as SceneNode;
        const p = { x: n.x + n.w / 2, y: n.y + n.h / 2 };
        const took = pluginDown({ screen: p, world: p, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, button: 0 });
        pluginUp({ screen: p, world: p, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, button: 0 });
        return took;
    };
    beforeEach(() => {
        load(createBoardDocument("B"));
        ids = [0, 1, 2].map((i) => add(makeSticky(doc(), i * 300, 0, "#FFE299", page(), "me")));
        as("l:host");
        board.set({ voteJoined: null, voteIgnored: null, tool: null });
    });

    it("each person has `limit` votes; clicking a vote again takes it back; the session isn't an undo step", () => {
        const steps = editor.get().past.length;
        startVoting(2, "  Best idea?  ");
        expect(voting()).toMatchObject({ open: true, limit: 2, prompt: "Best idea?", host: "l:host", votes: {} });
        expect(amVoting()).toBe(true);
        expect(click(ids[0] as string)).toBe(true);
        expect(click(ids[1] as string)).toBe(true);
        expect(myVotes()).toEqual([ids[0], ids[1]]);
        // Out of votes: a third click is refused.
        click(ids[2] as string);
        expect(myVotes()).toEqual([ids[0], ids[1]]);
        // Take one back, spend it elsewhere.
        click(ids[0] as string);
        click(ids[2] as string);
        expect(myVotes()).toEqual([ids[1], ids[2]]);
        expect(editor.get().past.length).toBe(steps);
    });

    // Regression: a vote on an object that was then deleted still used up one of your votes, and
    // couldn't be taken back (there was nothing left to click).
    it("votes on deleted objects don't count against your limit", () => {
        startVoting(2);
        click(ids[0] as string);
        click(ids[1] as string);
        editor.execute({ type: "node.delete", ids: [ids[0] as string] });
        expect(click(ids[2] as string)).toBe(true);
        expect(myVotes().filter((id) => doc().nodes[id])).toEqual([ids[1], ids[2]]);
        expect(results().map((r) => r.id)).not.toContain(ids[0]);
    });

    it("tallies across people, most votes first, then ends and clears", () => {
        startVoting(3);
        click(ids[0] as string);
        click(ids[1] as string);
        as("l:guest");
        joinVoting();
        expect(amVoting()).toBe(true);
        click(ids[1] as string);
        imDone();
        expect(amVoting()).toBe(false);
        expect(click(ids[2] as string)).toBe(false);
        expect(turnout()).toEqual({ voted: 2, done: 1 });
        // Joining again undoes "done".
        joinVoting();
        expect(turnout().done).toBe(0);
        expect(results().map((r) => [r.id, r.count])).toEqual([
            [ids[1], 2],
            [ids[0], 1],
        ]);
        endVoting();
        expect(votingOpen()).toBe(false);
        expect(amVoting()).toBe(false);
        // No votes after the end.
        as("l:host");
        expect(click(ids[2] as string)).toBe(false);
        expect(results()[0]).toMatchObject({ id: ids[1], count: 2 });
        clearVoting();
        expect(voting()).toBeNull();
        expect(results()).toEqual([]);
    });

    it("a timed session closes when its time is up", () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
            vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
            startVoting(1, "", 5);
            expect(votingOpen()).toBe(true);
            vi.setSystemTime(new Date("2026-01-01T10:05:01Z"));
            expect(votingOpen()).toBe(false);
            expect(click(ids[0] as string)).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("pages, connectors, sections and empty canvas take no votes", () => {
        startVoting(5);
        const p = { x: 5000, y: 5000 };
        expect(pluginDown({ screen: p, world: p, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, button: 0 })).toBe(false);
        // Right button never votes.
        const n = doc().nodes[ids[0] as string] as SceneNode;
        expect(pluginDown({ screen: { x: n.x + 5, y: n.y + 5 }, world: { x: n.x + 5, y: n.y + 5 }, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, button: 2 })).toBe(false);
        expect(myVotes()).toEqual([]);
    });
});

describe("the stamp wheel", () => {
    it("closes the option bar that was open (and its tool) when it opens", async () => {
        const { openWheel } = await import("./stamps");
        board.set({ tool: "shape", tray: "shape", shapesPanel: true, wheel: null });
        openWheel();
        const b = board.get();
        expect(b.wheel).not.toBeNull();
        expect(b.tray).toBeNull();
        expect(b.shapesPanel).toBe(false);
        expect(b.tool).toBeNull();
        board.set({ wheel: null });
    });
});
