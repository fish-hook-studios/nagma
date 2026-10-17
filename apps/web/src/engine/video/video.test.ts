import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VMedia } from "./model";

// The media reader is stubbed: these tests are about what the editor does with the results.
const results = new Map<string, VMedia | null | Error>();
let gate: Promise<void> = Promise.resolve();
vi.mock("./import", async (orig) => ({
    ...(await orig<typeof import("./import")>()),
    importMediaFile: async (file: File) => {
        await gate;
        const r = results.get(file.name);
        if (r instanceof Error) throw r;
        return r ? { media: r, commands: [] } : null;
    },
}));

await import("../../app");
const { editor } = await import("../store");
const { blankDoc, openInEditor } = await import("../../test/sys-fixtures");
const { importFiles } = await import("./actions");
const { currentProject } = await import("./state");

const media = (name: string): VMedia => ({ id: name, kind: "video", name, store: name, seconds: 2, width: 320, height: 180, fps: 30, hasAudio: false });

function openVideo(fileId: string) {
    openInEditor({ ...blankDoc(), sequence: { width: 1920, height: 1080, fps: 30, clips: [] } });
    editor.set({ fileId });
}

beforeEach(() => results.clear());

describe("video: importing media", () => {
    it("says which files couldn't be added along with what was", async () => {
        openVideo("v1");
        results.set("a.webm", media("a.webm"));
        results.set("b.webm", media("b.webm"));
        results.set("bad.mov", new Error("That file couldn't be read."));
        results.set("doc.txt", null);
        await importFiles(["a.webm", "bad.mov", "b.webm", "doc.txt"].map((n) => new File(["x"], n)));
        expect(currentProject().media.map((m) => m.name)).toEqual(["a.webm", "b.webm"]);
        // Before, "Added 2 files." replaced the messages about the other two.
        expect(editor.get().toast).toBe("Added 2 files. Couldn't add bad.mov: That file couldn't be read. doc.txt isn't a video, sound or image file.");
    });

    it("media read while another file was opened doesn't land in that file", async () => {
        openVideo("v1");
        let release = () => undefined as void;
        gate = new Promise<void>((r) => (release = r));
        results.set("slow.webm", media("slow.webm"));
        const pending = importFiles([new File(["x"], "slow.webm")]);
        // Another video file opens while the file is still being read.
        openVideo("v2");
        release();
        await pending;
        gate = Promise.resolve();
        expect(currentProject().media).toEqual([]);
        expect(editor.get().toast).toBe("The import stopped: another file was opened.");
    });
});

const actions = await import("./actions");
const { commitComp, activeComp, vui } = await import("./state");
const { newClip } = await import("./model");

describe("video: locked tracks", () => {
    function setup() {
        openVideo("v-lock");
        const comp = activeComp();
        const [v2, v1] = comp.tracks;
        if (!v1 || !v2) throw new Error("tracks");
        const free = newClip("solid", v2.id, 1, 2, "Free");
        const held = newClip("solid", v1.id, 1, 2, "Held");
        commitComp({ ...comp, tracks: comp.tracks.map((t) => (t.id === v1.id ? { ...t, locked: true } : t)), clips: [free, held] });
        return { free, held };
    }
    const clip = (id: string) => activeComp().clips.find((c) => c.id === id);

    it("Select all leaves out clips on locked tracks, so nudging can't move them", () => {
        const { free, held } = setup();
        actions.selectAll();
        expect(vui.get().selection).toEqual([free.id]);
        actions.nudgeSelection(3);
        expect(clip(free.id)?.start).toBeCloseTo(1.1);
        expect(clip(held.id)?.start).toBe(1);
    });

    it("nudge, cut, duplicate, disable and nest skip a locked clip that is still selected", () => {
        const { held } = setup();
        vui.set({ selection: [held.id] });
        actions.nudgeSelection(3);
        actions.toggleEnabled();
        actions.duplicateSelection();
        actions.copySelection(true);
        actions.precomposeSelection();
        expect(activeComp().clips.map((c) => c.id)).toContain(held.id);
        expect(clip(held.id)).toMatchObject({ start: 1, duration: 2 });
        expect(clip(held.id)?.disabled).toBeFalsy();
        expect(activeComp().clips).toHaveLength(2);
    });

    it("a transition on a locked clip isn't removed by ⌫", () => {
        const { held } = setup();
        const comp = activeComp();
        commitComp({ ...comp, clips: comp.clips.map((c) => (c.id === held.id ? { ...c, tin: { kind: "dissolve", duration: 0.5 } } : c)) });
        vui.set({ selection: [], transition: { clip: held.id, side: "in" } });
        actions.deleteSelection(false);
        expect(clip(held.id)?.tin).toEqual({ kind: "dissolve", duration: 0.5 });
    });

    it("locking a track lets go of its selected clips", () => {
        const { free } = setup();
        vui.set({ selection: [free.id] });
        actions.setTrack(clip(free.id)?.track ?? "", { locked: true });
        expect(vui.get().selection).toEqual([]);
    });
});

describe("video: frames read through the browser's player", () => {
    it("a player that stopped showing new frames (suspended while idle) is replaced, so the frame is the right one", async () => {
        const { exactFrame } = await import("./sources");
        const made: { suspended: boolean; seeks: number[] }[] = [];
        // A stand-in <video>: seeks finish, and a frame is presented unless it's suspended.
        class FakeVideo extends EventTarget {
            muted = false;
            preload = "";
            playsInline = false;
            readyState = 4;
            duration = 3;
            videoWidth = 320;
            videoHeight = 180;
            private time = 0;
            private callbacks: (() => void)[] = [];
            log = { suspended: made.length === 0, seeks: [] as number[] };
            constructor() {
                super();
                made.push(this.log);
                setTimeout(() => this.onloadeddata?.(), 0);
            }
            onloadeddata: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_url: string) {}
            removeAttribute() {}
            load() {}
            get currentTime() {
                return this.time;
            }
            set currentTime(t: number) {
                this.time = t;
                this.log.seeks.push(t);
                setTimeout(() => {
                    if (!this.log.suspended) for (const cb of this.callbacks.splice(0)) cb();
                    this.dispatchEvent(new Event("seeked"));
                }, 5);
            }
            requestVideoFrameCallback(cb: () => void) {
                this.callbacks.push(cb);
                return 1;
            }
        }
        const create = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation(((tag: string) => (tag === "video" ? new FakeVideo() : create(tag))) as typeof document.createElement);
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
        const media = await import("../media");
        vi.spyOn(media, "loadMedia").mockResolvedValue(new Blob(["x"]));
        const clip: VMedia = { id: "m", kind: "video", name: "rec.webm", store: "store-suspended", seconds: 3, width: 320, height: 180, fps: 30, hasAudio: false };
        await exactFrame(clip, 1, 1);
        // The first player was suspended: its seek showed nothing new, so a second one did it.
        expect(made).toHaveLength(2);
        expect(made[1]?.seeks).toEqual([1]);
        vi.restoreAllMocks();
    });
});

describe("video: one thing picked at a time", () => {
    it("picking clips lets go of a picked transition, so ⌫ deletes the clips, not the transition", () => {
        openVideo("v-pick");
        const comp = activeComp();
        const v1 = comp.tracks[1];
        if (!v1) throw new Error("tracks");
        const a = newClip("solid", v1.id, 0, 2, "A", { tin: { kind: "dissolve", duration: 0.5 } });
        commitComp({ ...comp, clips: [a] });
        vui.set({ transition: { clip: a.id, side: "in" }, selection: [] });
        actions.addTitle();
        expect(vui.get().transition).toBeNull();
        const title = vui.get().selection[0];
        actions.deleteSelection(false);
        expect(activeComp().clips.map((c) => c.id)).toEqual([a.id]);
        expect(activeComp().clips[0]?.tin).toEqual({ kind: "dissolve", duration: 0.5 });
        expect(title).toBeTruthy();
    });
});

describe("video: motion hand-off code", () => {
    it("the CSS spring follows the editor's spring curve", async () => {
        const { clipCss } = await import("./handoff");
        const { ease } = await import("./model");
        openVideo("v-code");
        const comp = activeComp();
        const clip = newClip("solid", comp.tracks[1]?.id ?? "", 0, 2, "Box", { anim: { x: [{ t: 0, v: 0, ease: "spring" }, { t: 1, v: 100 }] } });
        const css = clipCss(comp, clip);
        const curve = /linear\(([^)]*)\)/.exec(css)?.[1] ?? "";
        // "value pct%" pairs: each matches the editor's curve at that point.
        const points = curve.split(", ").slice(1, -1).map((s) => s.split(" ").map(parseFloat) as [number, number]);
        expect(points.length).toBeGreaterThan(10);
        for (const [v, pct] of points) expect(v).toBeCloseTo(ease("spring", pct / 100), 2);
    });
});
