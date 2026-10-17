// Regression tests for bugs found in exploratory QA of the board (apps/web/qa/QA-board-slides.md).
import "../engine/inspect-settings";
import "../test/prod-fixtures";
import { describe, expect, it, vi } from "vitest";
import { activePage } from "../engine/page";
import { editor } from "../engine/store";
import { makeNode } from "../engine/nodes";
import { solid } from "../engine/paint";
import type { NagmaDocument, SceneNode } from "../engine/types";
import "./connectors";
import { worldBounds } from "../engine/transform";
import { BOARD_TEMPLATES, insertTemplate } from "./templates";
import { createBoardDocument, makeConnector, makeSticky } from "./model";

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
const settle = () => new Promise<void>((r) => queueMicrotask(() => queueMicrotask(r)));

describe("board sections", () => {
    it("a new section goes behind the objects beside it, so its white fill never hides them (one undo step)", async () => {
        load(createBoardDocument("B"));
        const a = add(makeSticky(doc(), 0, 0, "#FFE299", page(), "Me"));
        const b = add(makeSticky(doc(), 600, 0, "#FFE299", page(), "Me"));
        await settle();
        const line = add(makeConnector(doc(), { id: a, side: "right", x: 240, y: 120 }, { id: b, side: "left", x: 600, y: 120 }, "straight", "#000000", page()));
        await settle();
        const old = add(makeNode(doc(), "frame", { x: -400, y: -400, w: 100, h: 100 }, page(), { name: "Old", isSection: true, clip: false, fills: [solid("#FFFFFF", 0.04)] }));
        await settle();
        const before = editor.get().past.length;
        const section = add(makeNode(doc(), "frame", { x: 300, y: -50, w: 200, h: 300 }, page(), { name: "Section", isSection: true, clip: false, fills: [solid("#FFFFFF", 0.04)] }));
        await settle();
        const order = doc().nodes[page()]?.children ?? [];
        expect(order.indexOf(section)).toBeLessThan(order.indexOf(line));
        expect(order.indexOf(section)).toBeLessThan(order.indexOf(a));
        // Above the older section, and given the board look.
        expect(order.indexOf(section)).toBeGreaterThan(order.indexOf(old));
        expect(doc().nodes[section]?.fills[0]).toMatchObject({ color: "#FFFFFF", opacity: 1 });
        expect(editor.get().past.length).toBe(before + 1);
        editor.undo();
        expect(doc().nodes[section]).toBeUndefined();
    });
});

describe("board context bar placement", () => {
    it("keeps a bar of any width inside the canvas", async () => {
        const { barCenter } = await import("./model");
        // A 560px table bar over a table at the left edge: before, a fixed 260px clamp left it 20px off screen.
        expect(barCenter(100, 560, 1440) - 280).toBeGreaterThanOrEqual(8);
        expect(barCenter(1400, 560, 1440) + 280).toBeLessThanOrEqual(1440 - 8);
        expect(barCenter(700, 300, 1440)).toBe(700);
        expect(barCenter(50, 900, 800)).toBe(400);
    });
});

describe("board templates", () => {
    it("every template's section contents land inside their sections, in the view and inside a host section", () => {
        const inside = (childId: string, sectionId: string) => {
            const c = worldBounds(doc(), doc().nodes[childId] as SceneNode);
            const s = worldBounds(doc(), doc().nodes[sectionId] as SceneNode);
            return c.x >= s.x - 0.5 && c.y >= s.y - 0.5 && c.x + c.w <= s.x + s.w + 0.5 && c.y + c.h <= s.y + s.h + 0.5;
        };
        for (const t of BOARD_TEMPLATES) {
            load(createBoardDocument("B"));
            editor.set({ camera: { x: -5000, y: -3000, zoom: 1 } } as never);
            insertTemplate(t);
            for (const n of Object.values(doc().nodes)) {
                const parent = n.parentId ? doc().nodes[n.parentId] : undefined;
                if (parent?.isSection) expect(inside(n.id, parent.id), `${t.name}: ${n.name}`).toBe(true);
            }
        }
        // Into an existing section far from the origin.
        load(createBoardDocument("B"));
        const host = add(makeNode(doc(), "frame", { x: 4000, y: 3000, w: 2400, h: 1600 }, page(), { name: "Host", isSection: true, clip: false, fills: [solid("#FFFFFF")] }));
        const flow = BOARD_TEMPLATES.find((t) => t.id === "flowchart");
        insertTemplate(flow!, host);
        for (const n of Object.values(doc().nodes)) if (n.parentId === host && n.jam?.kind !== "connector") expect(inside(n.id, host), n.name).toBe(true);
    });
});

describe("board table: duplicating tracks keeps merges", () => {
    it("duplicating merged columns keeps the original merge and merges the copy; a track duplicated inside a merge grows it", async () => {
        const { makeTable, jamOf } = await import("./model");
        const { duplicateTracks, mergeCells } = await import("./table");
        load(createBoardDocument("B"));
        const id = add(makeTable(doc(), 0, 0, page(), 3, 3, [["A", "B", "C"], ["1", "2", "3"], ["x", "y", "z"]]));
        const jam = () => jamOf(doc().nodes[id], "table") as NonNullable<ReturnType<typeof jamOf<"table">>>;
        mergeCells(id, { top: 0, left: 0, bottom: 0, right: 1 });
        duplicateTracks(id, "col", [0, 1]);
        expect(jam().merges).toEqual(expect.arrayContaining([expect.objectContaining({ r: 0, c: 0, rs: 1, cs: 2 }), expect.objectContaining({ r: 0, c: 2, rs: 1, cs: 2 })]));
        load(createBoardDocument("B"));
        const t = add(makeTable(doc(), 0, 0, page(), 3, 3, [["A", "B", "C"], ["1", "2", "3"], ["x", "y", "z"]]));
        mergeCells(t, { top: 0, left: 0, bottom: 2, right: 0 });
        duplicateTracks(t, "row", [1]);
        expect(jamOf(doc().nodes[t], "table")?.merges).toEqual([expect.objectContaining({ r: 0, c: 0, rs: 4, cs: 1 })]);
    });
});

describe("board table: merging over an existing merge", () => {
    it("picks the grown merge's anchor, not a covered cell", async () => {
        const { makeTable } = await import("./model");
        const { mergeCells } = await import("./table");
        const { board } = await import("./state");
        load(createBoardDocument("B"));
        const id = add(makeTable(doc(), 0, 0, page(), 3, 3, [["A", "B", "C"], ["1", "2", "3"], ["x", "y", "z"]]));
        editor.set({ selection: [id] });
        mergeCells(id, { top: 1, left: 0, bottom: 2, right: 0 });
        mergeCells(id, { top: 2, left: 0, bottom: 2, right: 1 });
        expect(board.get().tableSel).toMatchObject({ id, r0: 1, c0: 0 });
    });
});

describe("board mind maps and AI ideas", () => {
    it("⌘Return on the central topic grows a map branch (curved, no arrow), and on a sticky topic too", async () => {
        const { addAdjacent } = await import("./actions");
        load(createBoardDocument("B"));
        insertTemplate(BOARD_TEMPLATES.find((t) => t.id === "mindmap")!);
        await settle();
        const root = Object.values(doc().nodes).find((n) => n.text === "Central topic") as SceneNode;
        const made = addAdjacent(root.id, "right") as string;
        const line = Object.values(doc().nodes).find((n) => n.jam?.kind === "connector" && n.jam.end.id === made);
        expect(line?.jam).toMatchObject({ mind: true, line: "curved", endCap: "none" });
        // A sticky topic in a map.
        const sticky = add(makeSticky(doc(), 3000, 0, "#FFE299", page(), "Me"));
        add(makeConnector(doc(), { id: root.id, side: "right", x: 0, y: 0 }, { id: sticky, side: "left", x: 0, y: 0 }, "curved", "#757575", page(), { start: "none", end: "none" }));
        const node = doc().nodes[Object.keys(doc().nodes).at(-1) as string] as SceneNode;
        if (node.jam?.kind === "connector") editor.execute({ type: "node.update", id: node.id, patch: { jam: { ...node.jam, mind: true } } });
        const child = addAdjacent(sticky, "right") as string;
        expect(Object.values(doc().nodes).some((n) => n.jam?.kind === "connector" && n.jam.start.id === sticky && n.jam.end.id === child)).toBe(true);
    });

    it("Generate ideas (offline fallback) adds four branches as one undo step", async () => {
        const { generateIdeas } = await import("./ai");
        load(createBoardDocument("B"));
        const id = add({ ...makeSticky(doc(), 0, 0, "#FFE299", page(), "Me"), text: "Launch plan" });
        await settle();
        editor.set({ selection: [id] });
        const before = Object.keys(doc().nodes).length;
        await generateIdeas();
        await settle();
        expect(Object.keys(doc().nodes).length).toBe(before + 8);
        editor.undo();
        await settle();
        expect(Object.keys(doc().nodes).length).toBe(before);
    });
});

describe("board widgets", () => {
    it("a double-click on the counter's + counts two (its two presses), not three", async () => {
        const { placeWidget, widgetClick } = await import("./widgets");
        load(createBoardDocument("B"));
        const id = placeWidget({ x: 0, y: 0 }, "counter");
        const node = () => doc().nodes[id] as SceneNode;
        const plus = { x: node().x + node().w - 48, y: node().y + 48 + 48 };
        widgetClick(node(), plus, false);
        widgetClick(node(), plus, false);
        widgetClick(node(), plus, true);
        expect(node().jam).toMatchObject({ count: 2 });
    });

    it("clicks on a rotated checklist tick the row drawn under the pointer", async () => {
        const { placeWidget, widgetClick } = await import("./widgets");
        load(createBoardDocument("B"));
        const id = placeWidget({ x: 0, y: 0 }, "checklist");
        editor.execute({ type: "node.update", id, patch: { rotation: 180 } });
        const n = doc().nodes[id] as SceneNode;
        // Row 0's checkbox (unrotated at x+20, y+48+18) turned half a turn about the centre.
        const cx = n.x + n.w / 2;
        const cy = n.y + n.h / 2;
        const at = { x: 2 * cx - (n.x + 20), y: 2 * cy - (n.y + 48 + 18) };
        expect(widgetClick(n, at, false)).toBe(true);
        const jam = (doc().nodes[id] as SceneNode).jam;
        expect(jam?.kind === "widget" && jam.items.map((i) => Boolean(i.done))).toEqual([true, false]);
    });
});

describe("board voting", () => {
    it("votes on deleted objects don't count against your votes or show in results", async () => {
        const { startVoting, myVotes, results, voting } = await import("./voting");
        const { setBoardJam } = await import("./timer");
        const { voterId } = await import("./voting");
        load(createBoardDocument("B"));
        const a = add(makeSticky(doc(), 0, 0, "#FFE299", page(), "Me"));
        const b = add(makeSticky(doc(), 300, 0, "#FFE299", page(), "Me"));
        startVoting(2);
        const v = voting()!;
        setBoardJam({ voting: { ...v, votes: { [voterId()]: [a, b] } } });
        editor.execute({ type: "node.delete", ids: [b] });
        expect(myVotes()).toEqual([a]);
        expect(results().map((r) => r.id)).toEqual([a]);
    });

    it("anyone can end a session once its host has left; not while the host is here", async () => {
        const { collab } = await import("../engine/collab");
        const { canEndVoting, voting } = await import("./voting");
        const { setBoardJam } = await import("./timer");
        load(createBoardDocument("B"));
        setBoardJam({ voting: { id: "s1", open: true, limit: 3, votes: {}, host: "someone-else", hostPeer: "peer-9", endsAt: null, done: [] } });
        expect(voting()?.host).toBe("someone-else");
        collab.set({ peers: { "peer-9": { userId: "peer-9", name: "Host", color: "#000", cursor: null, selection: [], pageId: null } } });
        expect(canEndVoting()).toBe(false);
        collab.set({ peers: {} });
        expect(canEndVoting()).toBe(true);
    });
});

describe("board ⌘⇧U", () => {
    it("is recognised as the link shortcut", async () => {
        const { linkForKey, formatForKey } = await import("./actions");
        const e = { key: "U", code: "KeyU", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false };
        expect(linkForKey(e)).toBe(true);
        expect(formatForKey(e)).toBeNull();
        expect(linkForKey({ ...e, shiftKey: false })).toBe(false);
    });
});

describe("board link cards from a shared file", () => {
    it("only web addresses open or embed", async () => {
        const { webUrl, openWebUrl } = await import("./links");
        expect(webUrl("javascript:alert(1)")).toBeNull();
        expect(webUrl("data:text/html,hi")).toBeNull();
        expect(webUrl("https://www.youtube.com/embed/abc")).toBe("https://www.youtube.com/embed/abc");
        const open = vi.spyOn(window, "open").mockImplementation(() => null);
        openWebUrl("javascript:alert(1)");
        expect(open).not.toHaveBeenCalled();
        openWebUrl("https://example.com");
        expect(open).toHaveBeenCalledWith("https://example.com/", "_blank", "noopener,noreferrer");
        open.mockRestore();
    });
});

describe("board AI sort", () => {
    it("places each sticky once, drops unknown ids and gathers left-out ones under Other", async () => {
        const { cleanGroups } = await import("./ai");
        expect(cleanGroups([{ name: "A", ids: ["1", "2", "zz"] }, { name: "B", ids: ["2", "3"] }, { name: "C", ids: "nope" }], ["1", "2", "3", "4"])).toEqual([
            { name: "A", ids: ["1", "2"] },
            { name: "B", ids: ["3"] },
            { name: "Other", ids: ["4"] },
        ]);
    });
});

describe("board undo near a mind map", () => {
    it("undoing a move that puts a sticky back over a topic doesn't attach it (and keeps the redo)", async () => {
        await import("./mindmap");
        load(createBoardDocument("B"));
        insertTemplate(BOARD_TEMPLATES.find((t) => t.id === "mindmap")!);
        await settle();
        const root = Object.values(doc().nodes).find((n) => n.text === "Central topic") as SceneNode;
        const s = add(makeSticky(doc(), root.x + root.w / 2 - 120, root.y + root.h / 2 - 120, "#FFE299", page(), "Me"));
        await settle();
        editor.execute({ type: "node.move", ids: [s], dx: 3000, dy: 0 });
        await settle();
        const lines = () => Object.values(doc().nodes).filter((n) => n.jam?.kind === "connector" && (n.jam.start.id === s || n.jam.end.id === s));
        expect(lines()).toHaveLength(0);
        editor.undo();
        await settle();
        expect(lines()).toHaveLength(0);
        expect(editor.get().future).toHaveLength(1);
    });
});

describe("board voting with someone voting at the same moment", () => {
    it("your vote comes back when a collaborator's write drops it, and theirs stays", async () => {
        const { startVoting, toggleVote, voting, voterId } = await import("./voting");
        load(createBoardDocument("B"));
        const a = add(makeSticky(doc(), 0, 0, "#FFE299", page(), "Me"));
        startVoting(3);
        toggleVote(a);
        expect(voting()?.votes[voterId()]).toEqual([a]);
        // A collaborator's patch written from the state before your vote, with their own vote.
        const pageNode = doc().nodes[page()]!;
        const jam = pageNode.jam?.kind === "board" ? pageNode.jam : null;
        const theirs = { ...jam!, voting: { ...jam!.voting!, votes: { other: [a] } } };
        editor.receive({ ...doc(), nodes: { ...doc().nodes, [page()]: { ...pageNode, jam: theirs } } });
        expect(voting()?.votes[voterId()]).toBeUndefined();
        await settle();
        expect(voting()?.votes).toEqual({ other: [a], [voterId()]: [a] });
    });
});

describe("board poll widget with someone voting at the same moment", () => {
    it("your vote comes back when a collaborator's write drops it", async () => {
        const { placeWidget, widgetClick } = await import("./widgets");
        const { voterId } = await import("./voting");
        load(createBoardDocument("B"));
        const id = placeWidget({ x: 0, y: 0 }, "poll");
        const n = () => doc().nodes[id] as SceneNode;
        widgetClick(n(), { x: n().x + 100, y: n().y + 48 + 18 }, false);
        const jamNow = n().jam;
        if (jamNow?.kind !== "widget") throw new Error("no poll");
        expect(jamNow.items[0]?.votes).toEqual([voterId()]);
        const theirs = { ...jamNow, items: jamNow.items.map((it, i) => ({ ...it, votes: i === 1 ? ["other"] : [] })) };
        editor.receive({ ...doc(), nodes: { ...doc().nodes, [id]: { ...n(), jam: theirs } } });
        await settle();
        const after = n().jam;
        expect(after?.kind === "widget" && after.items.map((it) => it.votes)).toEqual([[voterId()], ["other"], []]);
    });
});

describe("a new empty board's first view", () => {
    it("is the default 100% view, not the previous file's zoom", async () => {
        const { openPageView } = await import("../engine/camera");
        editor.set({ camera: { x: 16, y: 38, zoom: 0.47 } });
        load(createBoardDocument("B"));
        openPageView();
        expect(editor.get().camera).toEqual({ x: 0, y: 0, zoom: 1 });
    });
});

describe("board AI summary without the AI service", () => {
    it("the offline summary's bullets cover the notes' different topics", async () => {
        const { localSummary } = await import("./ai");
        const out = localSummary(["Ship the launch plan", "Launch email draft", "Fix login bug", "Bug triage weekly"]);
        expect(out).toMatch(/launch/i);
        expect(out.split("\n").slice(1).some((l) => /bug/i.test(l))).toBe(true);
    });
});
