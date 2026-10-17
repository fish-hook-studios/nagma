// Regression tests for bugs found in exploratory QA of Slides (apps/web/qa/QA-board-slides.md).
import "../test/prod-fixtures";
import { describe, expect, it, vi } from "vitest";
import { applyCommand } from "../engine/commands";
import { activePage } from "../engine/page";
import { editor } from "../engine/store";
import type { NagmaDocument } from "../engine/types";
import { addSlide, setNotes } from "./actions";
import { addSlideCommands, createSlidesDocument, slideIds, slideOf, slidesBySection, tidyCommands } from "./model";
import { slides } from "./state";

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

describe("insert slide above", () => {
    it("above the first slide puts the new slide first, in a row of its own (one undo step)", () => {
        const ids = deck(3);
        addSlide("title-body", ids[0] as string, undefined, false, true);
        const order = slideIds(doc());
        expect(order).toHaveLength(4);
        expect(order.slice(1)).toEqual(ids);
        expect(slidesBySection(doc()).filter((r) => r.ids.length).map((r) => r.ids.length)).toEqual([1, 1, 1, 1]);
        editor.undo();
        expect(slideIds(doc())).toEqual(ids);
    });

    it("above a slide in a group joins that group just before it", async () => {
        const ids = deck(4);
        const { groupSlides } = await import("./actions");
        groupSlides([ids[1] as string, ids[2] as string]);
        addSlide("title-body", ids[2] as string, undefined, false, true);
        const order = slideIds(doc());
        expect(order.indexOf(ids[2] as string) - order.indexOf(ids[1] as string)).toBe(2);
        const row = slidesBySection(doc()).find((r) => r.ids.includes(ids[2] as string));
        expect(row?.ids).toHaveLength(3);
    });
});

describe("presenter notes", () => {
    it("typing on another slide doesn't cancel the pending save on the slide before", () => {
        vi.useFakeTimers();
        try {
            const [a, b] = deck(2) as [string, string];
            setNotes(a, "first slide words");
            vi.advanceTimersByTime(300);
            setNotes(b, "second");
            vi.advanceTimersByTime(700);
            expect(slideOf(doc().nodes[a])?.notes).toBe("first slide words");
            expect(slideOf(doc().nodes[b])?.notes).toBe("second");
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("video links", () => {
    it("a link without its scheme plays instead of throwing; non-web links play nothing", async () => {
        const { videoEmbedUrl } = await import("./widgets");
        expect(videoEmbedUrl("youtube.com/embed/dQw4w9WgXcQ", 5)).toBe("https://youtube.com/embed/dQw4w9WgXcQ?start=5");
        expect(videoEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ", 0, true)).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1");
        expect(videoEmbedUrl("player.vimeo.com/video/1", 0)).toBe("https://player.vimeo.com/video/1");
        expect(videoEmbedUrl("")).toBe("about:blank");
        expect(videoEmbedUrl("javascript:alert(1)")).toBe("about:blank");
        expect(videoEmbedUrl("https://example.com/clip.mp4")).toBe("https://example.com/clip.mp4");
    });
});

describe("moving a picked group (⌘] / ⌘[)", () => {
    it("moves the whole group past the next row and back", async () => {
        const { groupSlides, nudgeSlides } = await import("./actions");
        const ids = deck(4) as [string, string, string, string];
        groupSlides([ids[1], ids[2]]);
        const rows = () => slidesBySection(doc()).filter((r) => r.ids.length).map((r) => r.ids);
        expect(rows()).toEqual([[ids[0]], [ids[1], ids[2]], [ids[3]]]);
        nudgeSlides(1, [ids[1], ids[2]]);
        expect(rows()).toEqual([[ids[0]], [ids[3]], [ids[1], ids[2]]]);
        nudgeSlides(-1, [ids[1], ids[2]]);
        nudgeSlides(-1, [ids[1], ids[2]]);
        expect(rows()).toEqual([[ids[1], ids[2]], [ids[0]], [ids[3]]]);
        // At the top already: nothing changes and no undo step.
        const steps = editor.get().past.length;
        nudgeSlides(-1, [ids[1], ids[2]]);
        expect(editor.get().past.length).toBe(steps);
    });
});

describe("small slide fixes", () => {
    it("Remix colours reads #RGB colours as #RRGGBB (white stays white, not yellow)", async () => {
        const { remixTheme, THEMES } = await import("./model");
        const out = remixTheme({ ...THEMES[0]!, accent: "#FFF", muted: "#000" });
        expect(out.accent.toUpperCase()).toBe("#FFFFFF");
        expect(out.muted.toUpperCase()).toBe("#000000");
    });

    it("a chart value too big for a number draws as 0 instead of NaN bars", async () => {
        const { insertWidget, setChartData } = await import("./widgets");
        const { expectFiniteGeometry } = await import("../test/prod-fixtures");
        const [first] = deck(1);
        slides.set({ current: { [editor.get().pageId]: first as string } } as never);
        insertWidget("chart");
        const chart = Object.values(doc().nodes).find((n) => n.deck?.kind === "chart");
        expect(chart).toBeTruthy();
        setChartData(chart!.id, ["A", "B"], [Number.POSITIVE_INFINITY, 5]);
        expectFiniteGeometry(doc());
        expect(doc().nodes[chart!.id]?.deck).toMatchObject({ values: [0, 5] });
    });
});

describe("pasting big tables", () => {
    it("40 columns or 400 rows keep cells and their text at sensible, positive sizes", async () => {
        const { insertTable } = await import("./widgets");
        for (const data of [[Array.from({ length: 40 }, (_, i) => `C${i}`)], Array.from({ length: 400 }, (_, i) => [`R${i}`])]) {
            const [first] = deck(1);
            slides.set({ current: { [editor.get().pageId]: first as string } } as never);
            insertTable(data);
            const nodes = Object.values(doc().nodes);
            expect(nodes.filter((n) => n.deck?.kind === "cell").every((n) => n.w >= 96 && n.h >= 40)).toBe(true);
            expect(nodes.filter((n) => n.type === "text").every((n) => n.w > 0)).toBe(true);
        }
    });
});

describe("slide moves that change nothing", () => {
    it("dropping a slide where it is, or New group on a slide alone, makes no undo step", async () => {
        const { dropSlides, moveSlidesToSection } = await import("./actions");
        const ids = deck(3) as [string, string, string];
        const steps = editor.get().past.length;
        dropSlides([ids[1]], ids[2], false);
        moveSlidesToSection([ids[1]], null);
        expect(editor.get().past.length).toBe(steps);
        expect(slideIds(doc())).toEqual(ids);
    });
});

describe("rehearsal timings", () => {
    it("time on the end screen isn't added to the last slide", async () => {
        const { setShow, next, previous, currentShow } = await import("./show");
        const [a] = deck(1) as [string];
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
            vi.setSystemTime(1_000_000);
            setShow({ order: [a], index: 0, shown: 0, ended: false, timings: {}, slideAt: Date.now() });
            vi.setSystemTime(1_001_000);
            next();
            expect(currentShow().ended).toBe(true);
            vi.setSystemTime(1_006_000);
            previous();
            vi.setSystemTime(1_007_000);
            next();
            expect(currentShow().timings[a]).toBe(2000);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("a show while slides are deleted", () => {
    it("moves to the slide that took the deleted one's place, or stays on its own", async () => {
        const { setShow, pruneShow, currentShow } = await import("./show");
        const [a, b, c] = deck(3) as [string, string, string];
        setShow({ order: [a, b, c], index: 1, shown: 0, ended: false });
        editor.execute({ type: "node.delete", ids: [b] });
        pruneShow(doc());
        expect(currentShow().order).toEqual([a, c]);
        expect(currentShow().order[currentShow().index]).toBe(c);
        editor.execute({ type: "node.delete", ids: [a] });
        pruneShow(doc());
        expect(currentShow().order[currentShow().index]).toBe(c);
    });
});

describe("code blocks on slides re-colour", () => {
    it("two blocks edited within the wait both get coloured", async () => {
        const { insertWidget } = await import("./widgets");
        const [first] = deck(1);
        slides.set({ current: { [editor.get().pageId]: first as string } } as never);
        insertWidget("code");
        insertWidget("code");
        const codes = Object.values(doc().nodes).filter((n) => n.type === "text" && n.deck?.kind === "code");
        expect(codes).toHaveLength(2);
        vi.useFakeTimers();
        try {
            editor.execute({ type: "node.update", id: codes[0]!.id, patch: { text: "const a = 1;", spans: undefined } });
            vi.advanceTimersByTime(100);
            editor.execute({ type: "node.update", id: codes[1]!.id, patch: { text: "let b = 2;", spans: undefined } });
            vi.advanceTimersByTime(1000);
        } finally {
            vi.useRealTimers();
        }
        for (const c of codes) expect(doc().nodes[c.id]?.spans?.length ?? 0).toBeGreaterThan(1);
    });
});

describe("templates sharing an id", () => {
    it("built-in Light on one slide of a deck on a remixed Light leaves the other slides' template alone", async () => {
        const { templateCommands, remixTheme, THEMES, deckOf, themeOf } = await import("./model");
        const ids = deck(2) as [string, string];
        const light = THEMES.find((t) => t.id === deckOf(doc()).theme.id) ?? THEMES[0]!;
        const remixed = remixTheme(deckOf(doc()).theme);
        editor.execute({ type: "batch", commands: templateCommands(doc(), remixed) });
        expect(deckOf(doc()).theme.accent).toBe(remixed.accent);
        editor.execute({ type: "batch", commands: templateCommands(doc(), light, [ids[0]]) });
        expect(deckOf(doc()).theme.accent).toBe(remixed.accent);
        expect(themeOf(doc(), ids[1]).accent).toBe(remixed.accent);
        expect(themeOf(doc(), ids[0]).accent).toBe(light.accent);
    });
});

describe("editing a poll's options", () => {
    it("redraws a row per option, keeps votes with their option and drops votes for removed ones", async () => {
        const { insertWidget, setPollOptions } = await import("./widgets");
        const [first] = deck(1);
        slides.set({ current: { [editor.get().pageId]: first as string } } as never);
        insertWidget("poll");
        const poll = Object.values(doc().nodes).find((n) => n.deck?.kind === "poll")!;
        editor.execute({ type: "node.update", id: poll.id, patch: { deck: { ...(poll.deck as never as object), votes: { p1: 0, p2: 1, p3: 2 } } as never } });
        setPollOptions(poll.id, ["Option C", "Option A", "Option D", "Option E"]);
        const now = doc().nodes[poll.id]!;
        expect(now.deck).toMatchObject({ options: ["Option C", "Option A", "Option D", "Option E"], votes: { p1: 1, p3: 0 } });
        const rows = now.children.map((id) => doc().nodes[id]!).filter((n) => /^Option \d+ label$/.test(n.name));
        expect(rows.map((r) => r.text)).toEqual(["Option C", "Option A", "Option D", "Option E"]);
        expect(now.h).toBeGreaterThanOrEqual(160 + 4 * 130);
        editor.undo();
        expect(doc().nodes[poll.id]?.deck).toMatchObject({ options: ["Option A", "Option B", "Option C"] });
    });
});

describe("live poll answers given at the same moment", () => {
    it("your answer comes back when a collaborator's write drops it, and theirs stays", async () => {
        const { insertWidget, answer } = await import("./widgets");
        const [first] = deck(1);
        slides.set({ current: { [editor.get().pageId]: first as string } } as never);
        insertWidget("poll");
        const poll = Object.values(doc().nodes).find((n) => n.deck?.kind === "poll")!;
        answer(poll.id, "me", 2);
        const now = doc().nodes[poll.id]!;
        editor.receive({ ...doc(), nodes: { ...doc().nodes, [poll.id]: { ...now, deck: { ...(now.deck as object), votes: { them: 0 } } as never } } });
        await new Promise<void>((r) => queueMicrotask(() => queueMicrotask(r)));
        expect(doc().nodes[poll.id]?.deck).toMatchObject({ votes: { them: 0, me: 2 } });
    });
});

describe("presenter notes drafts", () => {
    it("follow saved notes changed elsewhere, keep your own typing while it saves", async () => {
        const { syncDraft } = await import("./notes-draft");
        const start = { id: "s1", text: "", base: "", sent: "" };
        // Notes typed in the other notes field (or by a collaborator) show here.
        expect(syncDraft(start, "s1", "Talk about Q3")).toMatchObject({ text: "Talk about Q3", base: "Talk about Q3" });
        // Your own typing being saved doesn't reset the field.
        const typing = { id: "s1", text: "abcd", base: "", sent: "abcd" };
        expect(syncDraft(typing, "s1", "abcd")).toMatchObject({ text: "abcd", base: "abcd" });
        // An undo brings the saved notes back.
        expect(syncDraft({ id: "s1", text: "abcd", base: "abcd", sent: "abcd" }, "s1", "")).toMatchObject({ text: "" });
        // Another slide.
        expect(syncDraft(typing, "s2", "Other")).toMatchObject({ id: "s2", text: "Other" });
        expect(syncDraft(start, "s1", "")).toBe(start);
    });
});
