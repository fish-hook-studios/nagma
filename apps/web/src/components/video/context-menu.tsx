import { useEffect, useRef, useState } from "react";
import { Menu as AriaMenu, Popover as AriaPopover, Separator as AriaSeparator } from "react-aria-components";
import { addShape, addTitle, addTrackOf, applyTransition, markerAtPlayhead, pasteAtPlayhead, setInOut, setTrack } from "../../engine/video/actions";
import { removeTrack } from "../../engine/video/edit";
import { VIDEO_ACTION_BY_ID, runVideoAction } from "../../engine/video/menu";
import { activeComp, clipboard, commitComp, seek, vui } from "../../engine/video/state";
import { MenuRow } from "../left-sidebar";

// The video editor's right-click menus: for a clip (editing, linking, nesting, transitions), a
// track's header (add, show or hide, mute, solo, lock, delete), an empty spot on the timeline
// (paste, add a title or shape there, marker, in and out) and the program monitor.

type Target = { kind: "clip"; id: string } | { kind: "track"; id: string } | { kind: "timeline"; t: number; track: string | null } | { kind: "monitor" };
type Row = string | { id: string; label: string; shortcut?: string; disabled?: boolean; run: () => void };

const MENU_CLASS = "w-60 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";

function rowsFor(target: Target): Row[] {
    const comp = activeComp();
    if (target.kind === "clip") {
        const clip = comp.clips.find((c) => c.id === target.id);
        const video = clip && clip.kind !== "audio";
        return [
            "v:cut",
            "v:copy",
            "v:paste",
            "v:duplicate",
            "-",
            "v:split",
            "v:enable",
            "v:delete",
            "v:ripple",
            "-",
            "v:link",
            "v:unlink",
            "v:nest",
            ...(clip?.kind === "comp" ? ["v:openNested"] : []),
            ...(video
                ? [
                      "-",
                      { id: "tin", label: "Add dissolve at start", run: () => applyTransition("dissolve", target.id, "in") },
                      { id: "tout", label: "Add dissolve at end", run: () => applyTransition("dissolve", target.id, "out") },
                      { id: "effects", label: "Add effect…", run: () => vui.set({ leftOpen: true, leftTab: "library", libraryTab: "effects" }) },
                      { id: "motion", label: "Add motion preset…", run: () => vui.set({ leftOpen: true, leftTab: "library", libraryTab: "motion" }) },
                  ]
                : []),
            "-",
            "v:nudgeLeft",
            "v:nudgeRight",
        ];
    }
    if (target.kind === "track") {
        const track = comp.tracks.find((t) => t.id === target.id);
        if (!track) return [];
        const set = (patch: Parameters<typeof setTrack>[1]) => setTrack(track.id, patch);
        return [
            { id: "addVideo", label: "Add video track", run: () => addTrackOf("video") },
            { id: "addAudio", label: "Add audio track", run: () => addTrackOf("audio") },
            "-",
            ...(track.kind === "video"
                ? [{ id: "hide", label: track.hidden ? "Show track" : "Hide track", run: () => set({ hidden: !track.hidden }) }]
                : [
                      { id: "mute", label: track.muted ? "Unmute track" : "Mute track", run: () => set({ muted: !track.muted }) },
                      { id: "solo", label: track.solo ? "Unsolo track" : "Solo track", run: () => set({ solo: !track.solo }) },
                  ]),
            { id: "lock", label: track.locked ? "Unlock track" : "Lock track", run: () => set({ locked: !track.locked }) },
            { id: "selectTrack", label: "Select clips on this track", disabled: Boolean(track.locked), run: () => vui.set({ selection: activeComp().clips.filter((c) => c.track === track.id).map((c) => c.id) }) },
            "-",
            { id: "deleteTrack", label: "Delete track", disabled: comp.tracks.filter((t) => t.kind === track.kind).length < 2, run: () => commitComp(removeTrack(activeComp(), track.id)) },
        ];
    }
    if (target.kind === "timeline") {
        const here = (fn: () => void) => () => {
            seek(target.t);
            fn();
        };
        return [
            { id: "pasteHere", label: "Paste here", shortcut: "⌘ V", disabled: clipboard.length === 0, run: here(pasteAtPlayhead) },
            "-",
            { id: "titleHere", label: "Add title here", run: () => addTitle("headline", target.t) },
            { id: "rectHere", label: "Add rectangle here", run: () => addShape("rect", target.t) },
            { id: "markerHere", label: "Add marker here", shortcut: "M", run: here(markerAtPlayhead) },
            "-",
            { id: "inHere", label: "Mark in here", shortcut: "I", run: here(() => setInOut("in")) },
            { id: "outHere", label: "Mark out here", shortcut: "O", run: here(() => setInOut("out")) },
            "v:clearInOut",
            "-",
            "v:selectAll",
            "v:fit",
            "v:vtrack",
            "v:atrack",
        ];
    }
    return ["v:play", "-", "v:frame", "v:export", "-", "v:safe", "v:loop", "-", "v:title", "v:rect", "v:solid"];
}

export function VideoContextMenu({ root }: { root: React.RefObject<HTMLElement | null> }) {
    const [menu, setMenu] = useState<{ x: number; y: number; target: Target } | null>(null);
    const anchor = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = root.current;
        if (!el) return;
        const onContext = (e: MouseEvent) => {
            const node = e.target as HTMLElement | null;
            if (!node || node.closest("input,textarea,select,[contenteditable=true]")) return;
            const clip = node.closest<HTMLElement>("[data-clip-id]");
            const header = node.closest<HTMLElement>("[data-track-head]");
            const lane = node.closest<HTMLElement>("[data-lane]");
            const monitor = node.closest('[aria-label="Program monitor"]');
            let target: Target | null = null;
            // A clip on a locked track can't be picked (as with a click), so it gets the timeline's menu.
            const comp = activeComp();
            const onLocked = (id: string) => comp.tracks.find((t) => t.id === comp.clips.find((c) => c.id === id)?.track)?.locked;
            if (clip?.dataset.clipId && !onLocked(clip.dataset.clipId)) {
                target = { kind: "clip", id: clip.dataset.clipId };
                if (!vui.get().selection.includes(target.id)) vui.set({ selection: [target.id], transition: null, marker: null });
            } else if (header?.dataset.trackHead) target = { kind: "track", id: header.dataset.trackHead };
            else if (lane) {
                const box = lane.getBoundingClientRect();
                const pps = Number(lane.dataset.pps) || vui.get().pxPerSec;
                target = { kind: "timeline", t: Math.max(0, (e.clientX - box.left) / pps), track: lane.dataset.lane ?? null };
            } else if (monitor) target = { kind: "monitor" };
            if (!target) return;
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, target });
        };
        el.addEventListener("contextmenu", onContext);
        return () => el.removeEventListener("contextmenu", onContext);
    }, [root]);
    if (!menu) return null;
    const rows = rowsFor(menu.target);
    const own = new Map(rows.filter((r): r is Exclude<Row, string> => typeof r !== "string").map((r) => [r.id, r]));
    const disabled = rows.flatMap((r) => {
        if (typeof r !== "string") return r.disabled ? [r.id] : [];
        const action = VIDEO_ACTION_BY_ID.get(r);
        return action && action.enabled && !action.enabled() ? [r] : [];
    });
    const close = () => setMenu(null);
    return (
        <>
            <div ref={anchor} className="pointer-events-none fixed size-0" style={{ left: menu.x, top: menu.y }} />
            <AriaPopover triggerRef={anchor} isOpen onOpenChange={(open) => !open && close()} placement="bottom start" offset={2} className={`${MENU_CLASS} max-h-[calc(100vh-16px)] overflow-y-auto`}>
                <AriaMenu
                    aria-label="Video"
                    className="outline-none"
                    autoFocus="first"
                    disabledKeys={disabled}
                    onAction={(key) => {
                        close();
                        const id = String(key);
                        const row = own.get(id);
                        if (row) row.run();
                        else runVideoAction(id);
                    }}
                >
                    {rows.map((r, i) => {
                        if (r === "-") return <AriaSeparator key={`sep-${i}`} className="my-1 h-px bg-white/10" />;
                        if (typeof r !== "string") return <MenuRow key={r.id} id={r.id} label={r.label} shortcut={r.shortcut} />;
                        const action = VIDEO_ACTION_BY_ID.get(r);
                        return action ? <MenuRow key={r} id={r} label={action.label} shortcut={action.shortcut} checked={action.checked?.()} /> : null;
                    })}
                </AriaMenu>
            </AriaPopover>
        </>
    );
}
