import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The effects library comes from the WebAssembly engine, which tests don't load.
vi.mock("../../engines/motion-engine", async (orig) => ({ ...(await orig<typeof import("../../engines/motion-engine")>()), effectCatalog: async () => [] }));

// The Inspector and the monitor for the engine-parity features: shape items, path masks edited
// on the monitor, the anchor handle, parenting, mattes and the Comment tool.

await import("../../app");
const { editor } = await import("../../engine/store");
const { collab } = await import("../../engine/collab");
const { addComment, videoCommentPage } = await import("../../engine/comments");
const { blankDoc, openInEditor } = await import("../../test/sys-fixtures");
const { addShape, addShapeItemToSelection } = await import("../../engine/video/actions");
const { setParent } = await import("../../engine/video/edit");
const { activeComp, commitComp, toggleCommenting, vui } = await import("../../engine/video/state");
const { newClip, shapeItems } = await import("../../engine/video/model");
const { Inspector } = await import("./inspector");
const { Monitor } = await import("./monitor");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom lays nothing out: no ResizeObserver, no scrollIntoView.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
};
Element.prototype.scrollIntoView = () => undefined;

function openVideo(fileId: string) {
    openInEditor({ ...blankDoc(), sequence: { width: 1920, height: 1080, fps: 30, clips: [] } });
    editor.set({ fileId });
    vui.set({ selection: [], commenting: false, maskEdit: null, time: 0, playing: false });
}

describe("video: the Inspector's shape, mask, parent and matte controls", () => {
    let root: Root;
    let host: HTMLDivElement;
    beforeAll(async () => {
        openVideo("v-parity");
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
        await act(async () => root.render(createElement(Inspector)));
    });
    afterAll(() => act(() => root.unmount()));

    const byLabel = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`);
    const texts = () => host.textContent ?? "";

    it("a shape layer lists its items with fill, stroke and Trim Paths, and another item can be added", async () => {
        await act(async () => addShape("star", 0));
        expect(texts()).toContain("Star");
        expect(texts()).toContain("Trim paths");
        expect(byLabel("Points")).not.toBeNull();
        expect(byLabel("Add a shape item")).not.toBeNull();
        await act(async () => addShapeItemToSelection("path"));
        const clip = activeComp().clips[0];
        expect(clip && shapeItems(clip).map((s) => s.kind)).toEqual(["star", "path"]);
        expect(texts()).toContain("2 items");
    });

    it("Add path mask makes a path mask and starts editing its points on the monitor", async () => {
        await act(async () => byLabel("Add path mask")?.click());
        const clip = activeComp().clips[0];
        expect(clip?.masks[0]).toMatchObject({ shape: "path", mode: "add" });
        expect(clip?.masks[0]?.points).toHaveLength(4);
        expect(vui.get().maskEdit).toEqual({ clip: clip?.id, mask: clip?.masks[0]?.id });
        // The Masks section was closed while there were none: open it.
        const header = [...host.querySelectorAll("button")].find((b) => b.textContent === "Masks");
        await act(async () => header?.click());
        expect(texts()).toContain("Done editing points");
        expect(texts()).toContain("Expansion");
        expect(byLabel("Mask mode")).not.toBeNull();
    });

    it("the Parent menu offers other picture clips, and a track matte can be picked", async () => {
        const comp = activeComp();
        const other = newClip("solid", comp.tracks[0]?.id ?? "", 0, 5, "Backdrop");
        await act(async () => commitComp({ ...comp, clips: [...comp.clips, other] }));
        expect(byLabel("Parent")?.textContent).toContain("None");
        const clipId = activeComp().clips[0]?.id ?? "";
        await act(async () => {
            const c = activeComp();
            commitComp({ ...c, clips: c.clips.map((cl) => (cl.id === clipId ? setParent(cl, other.id) : cl)) });
        });
        expect(byLabel("Parent")?.textContent).toContain("Backdrop");
        expect(byLabel("Track matte")?.textContent).toContain("None");
        await act(async () => {
            const c = activeComp();
            commitComp({ ...c, clips: c.clips.map((cl) => (cl.id === clipId ? { ...cl, matte: "luma-inverted" as const } : cl)) });
        });
        expect(byLabel("Track matte")?.textContent).toContain("Luma inverted matte");
        expect(texts()).toContain("The clip on the track above cuts this one out");
        expect(byLabel("Motion blur") ?? [...host.querySelectorAll("label")].find((l) => l.textContent?.includes("Motion blur"))).toBeTruthy();
    });

    it("the Comment tool swaps the Inspector for the Comments list", async () => {
        await act(async () => toggleCommenting(true));
        expect(byLabel("Search comments")).not.toBeNull();
        expect(byLabel("Parent")).toBeNull();
        await act(async () => toggleCommenting(false));
        expect(byLabel("Parent")).not.toBeNull();
    });
});

describe("video: the monitor's handles and comment pins", () => {
    let root: Root;
    let host: HTMLDivElement;
    beforeAll(async () => {
        openVideo("v-monitor");
        const comp = activeComp();
        const clip = newClip("solid", comp.tracks[1]?.id ?? "", 0, 5, "Box", { masks: [{ id: "m1", shape: "path", mode: "add", points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.8 }] }] });
        commitComp({ ...comp, clips: [clip] });
        vui.set({ selection: [clip.id], maskEdit: { clip: clip.id, mask: "m1" } });
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
        await act(async () => root.render(createElement(Monitor, { onDropFiles: () => undefined })));
    });
    afterAll(() => act(() => root.unmount()));

    it("shows the anchor handle and the mask's vertices for the selected clip", () => {
        expect(host.querySelector('[aria-label="Anchor point"]')).not.toBeNull();
        expect(host.querySelectorAll('[aria-label^="Mask vertex"]')).toHaveLength(3);
    });

    it("a comment left on the monitor lives on the composition's own page, attached to no layer", async () => {
        const comp = activeComp();
        await act(async () => {
            collab.set({ draft: { pageId: videoCommentPage(comp.id), x: 300, y: 200 } });
            addComment("Tighten this cut");
        });
        const c = collab.get().comments.find((x) => x.text === "Tighten this cut");
        expect(c).toMatchObject({ pageId: videoCommentPage(comp.id), x: 300, y: 200, nodeId: null });
        await act(async () => undefined);
        expect(host.querySelector('[aria-label^="Comment by"]')).not.toBeNull();
    });
});
