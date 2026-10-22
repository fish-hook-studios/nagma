import { FolderPlus, Keyboard01, PlusCircle, Stars01 } from "@untitledui/icons";
import { useEffect, useRef } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator, SubmenuTrigger as AriaSubmenuTrigger } from "react-aria-components";
import { fileMeta, openHome, setFileThumb } from "../engine/files";
import { editor, useEditor } from "../engine/store";
import { toggleShortcuts } from "../engine/ui-state";
import {
    addTitle,
    copySelection,
    deleteSelection,
    duplicateSelection,
    importFiles,
    jumpEdit,
    jumpKey,
    markerAtPlayhead,
    nudgeSelection,
    openNested,
    pasteAtPlayhead,
    pickMedia,
    precomposeSelection,
    saveFramePng,
    selectAll,
    setInOut,
    setLinked,
    shuttle,
    splitAtPlayhead,
    step,
    toggleEnabled,
    togglePlay,
    zoomTimeline,
} from "../engine/video/actions";
import { stopPlayers } from "../engine/video/audio";
import { VIDEO_ACTION_BY_ID, VIDEO_MENU, type VideoMenuNode, fitTimeline, runVideoAction } from "../engine/video/menu";
import { ROOT, compLength } from "../engine/video/model";
import { renderStill } from "../engine/video/render";
import { releasePlayers } from "../engine/video/sources";
import { activeComp, currentProject, openComp, seek, toggleCommenting, useVideoUi, vui } from "../engine/video/state";
import { onVideoComment } from "../engine/comments";
import { IconButton } from "./icon-button";
import { MenuRow } from "./left-sidebar";
import { NagmaLogo } from "./nagma-logo";
import { ShortcutsPanel } from "./shortcuts-panel";
import { VideoContextMenu } from "./video/context-menu";
import { ExportDialog } from "./video/export-dialog";
import { Inspector } from "./video/inspector";
import { LeftPanel } from "./video/left-panel";
import { Monitor } from "./video/monitor";
import { Timeline } from "./video/timeline";

// A video file: the Project and Library on the left, the program monitor, the multi-track
// timeline, and the Inspector on the right. Edits are commands on the document (undo, autosave,
// collaboration); playback, export and the frame compositor live in engine/video.

export function VideoEditor() {
    const leftOpen = useVideoUi((s) => s.leftOpen);
    const toast = useEditor((s) => s.toast);
    const fileId = useEditor((s) => s.fileId);
    const rootRef = useRef<HTMLDivElement>(null);

    usePlayback();
    useVideoKeys();
    useThumbnail(fileId);

    // A comment opened from the Comments list shows the composition it was left on.
    useEffect(() => onVideoComment((compId) => {
        if (vui.get().compId !== compId) openComp(compId);
        toggleCommenting(true);
    }), []);

    // A different file starts at its main sequence.
    useEffect(() => {
        vui.set({ compId: ROOT, trail: [], selection: [], time: 0, playing: false, transition: null, marker: null, mediaSelection: [], graph: null, commenting: false, maskEdit: null });
        return () => {
            stopPlayers();
            releasePlayers();
        };
    }, [fileId]);

    return (
        <div ref={rootRef} className="relative flex min-h-0 w-full flex-1 bg-canvas text-[11px] text-ink">
            <nav aria-label="Panels" className="flex h-full w-11 shrink-0 flex-col items-center gap-2 border-r border-panel-border bg-panel py-2">
                <VideoMainMenu />
                <div className="h-px w-6 bg-panel-border" />
                <RailButton tab="project" label="Project" icon={PlusCircle} />
                <RailButton tab="library" label="Library" icon={Stars01} />
                <div className="flex-1" />
                <IconButton icon={Keyboard01} label="Keyboard shortcuts" shortcut="⌃ ⇧ ?" onPress={toggleShortcuts} />
            </nav>
            {leftOpen && <LeftPanel />}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <Monitor onDropFiles={(files) => void importFiles(files, { at: vui.get().time })} />
                <Timeline />
            </div>
            <Inspector />
            <ExportDialog />
            <VideoContextMenu root={rootRef} />
            <ShortcutsPanel />
            {toast && (
                <div role="status" className="pointer-events-none absolute inset-x-0 bottom-16 z-50 flex justify-center">
                    <div className="rounded-lg bg-tooltip px-3 py-2 text-[12px] text-white shadow-lg">{toast}</div>
                </div>
            )}
        </div>
    );
}

function RailButton({ tab, label, icon }: { tab: "project" | "library"; label: string; icon: typeof PlusCircle }) {
    const active = useVideoUi((s) => s.leftOpen && s.leftTab === tab);
    return (
        <IconButton
            icon={icon}
            label={label}
            active={active}
            onPress={() => {
                const s = vui.get();
                if (s.leftOpen && s.leftTab === tab) vui.set({ leftOpen: false });
                else vui.set({ leftOpen: true, leftTab: tab });
            }}
        />
    );
}

const MENU_CLASS = "w-64 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";

function VideoMainMenu() {
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label="Main menu" className="flex size-8 items-center justify-center rounded-md outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                <NagmaLogo size={20} />
            </AriaButton>
            <AriaPopover placement="right top" offset={6} className={MENU_CLASS}>
                <VideoMenuLevel nodes={["home", "-", ...VIDEO_MENU]} />
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

function VideoMenuLevel({ nodes, label = "Main menu" }: { nodes: VideoMenuNode[]; label?: string }) {
    // Enabled states follow the selection.
    useVideoUi((s) => s.selection);
    const disabled = nodes.flatMap((n) => {
        if (typeof n !== "string") return [];
        const a = VIDEO_ACTION_BY_ID.get(n);
        return a?.enabled && !a.enabled() ? [n] : [];
    });
    return (
        <AriaMenu aria-label={label} className="outline-none" disabledKeys={disabled} onAction={(key) => (String(key) === "home" ? openHome() : runVideoAction(String(key)))}>
            {nodes.map((node, i) => {
                if (node === "-") return <AriaSeparator key={`sep-${i}`} className="my-1 h-px bg-white/10" />;
                if (node === "home") return <MenuRow key="home" id="home" label="Back to files" />;
                if (typeof node !== "string") {
                    return (
                        <AriaSubmenuTrigger key={node.sub}>
                            <MenuRow id={node.sub} label={node.label} shortcut="›" />
                            <AriaPopover offset={-4} className={`${MENU_CLASS} max-h-[80vh] overflow-y-auto`}>
                                <VideoMenuLevel nodes={node.items} label={node.label} />
                            </AriaPopover>
                        </AriaSubmenuTrigger>
                    );
                }
                const a = VIDEO_ACTION_BY_ID.get(node);
                if (!a) return null;
                return <MenuRow key={node} id={node} label={a.label} shortcut={a.shortcut} checked={a.checked?.()} icon={node === "v:import" ? FolderPlus : undefined} />;
            })}
        </AriaMenu>
    );
}

// ---- Playback ----

function usePlayback() {
    const playing = useVideoUi((s) => s.playing);
    useEffect(() => {
        if (!playing) return;
        let frame = 0;
        let timer = 0;
        let last = performance.now();
        // Animation frames, with a timer in case they stop (a hidden window still plays sound).
        const next = () => {
            frame = requestAnimationFrame(tick);
            timer = window.setTimeout(tick, 50);
        };
        const tick = () => {
            const now = performance.now();
            cancelAnimationFrame(frame);
            window.clearTimeout(timer);
            const s = vui.get();
            const comp = activeComp();
            const len = compLength(comp);
            const dt = (Math.max(0, now - last) / 1000) * s.rate;
            last = now;
            let t = s.time + dt;
            const start = s.loop && comp.inPoint != null ? comp.inPoint : 0;
            const end = s.loop && comp.outPoint != null ? comp.outPoint : len;
            if (t >= end || (s.rate < 0 && t <= 0)) {
                if (s.loop && s.rate > 0) t = start;
                else {
                    vui.set({ time: Math.max(0, Math.min(len, t)), playing: false, rate: 1 });
                    return;
                }
            }
            vui.set({ time: t });
            next();
        };
        next();
        return () => {
            cancelAnimationFrame(frame);
            window.clearTimeout(timer);
        };
    }, [playing]);
}

// ---- Keys ----

function typing(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || !el.tagName) return false;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

function inOverlay(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return Boolean(el?.closest?.('[role="menu"],[role="dialog"],[role="listbox"]'));
}


function useVideoKeys() {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (typing(e.target) || inOverlay(e.target)) return;
            if (vui.get().exportOpen) return;
            const mod = e.metaKey || e.ctrlKey;
            const key = e.key.toLowerCase();
            const code = e.code;
            const run = (fn: () => void) => {
                e.preventDefault();
                e.stopPropagation();
                fn();
            };
            // The keyboard shortcuts panel.
            if (e.ctrlKey && e.shiftKey && (code === "Slash" || key === "?")) return run(toggleShortcuts);
            if (mod) {
                if (key === "z") return run(() => (e.shiftKey ? editor.redo() : editor.undo()));
                if (key === "y") return run(() => editor.redo());
                if (key === "c") return run(() => copySelection());
                if (key === "x") return run(() => copySelection(true));
                if (key === "v") return run(pasteAtPlayhead);
                if (key === "d") return run(duplicateSelection);
                if (key === "a") return run(selectAll);
                if (key === "g") return run(precomposeSelection);
                if (key === "i") return run(() => pickMedia());
                if (key === "e") return run(() => (e.shiftKey ? void saveFramePng() : vui.set({ exportOpen: true })));
                if (key === "l") return run(() => setLinked(!e.shiftKey));
                if (key === "k") return run(splitAtPlayhead);
                if (code === "Backslash") return run(() => vui.set({ leftOpen: !vui.get().leftOpen }));
                if (key === "=" || key === "+") return run(() => zoomTimeline(1.5));
                if (key === "-") return run(() => zoomTimeline(1 / 1.5));
                if (code === "KeyS" && e.altKey) return run(() => runVideoAction("v:version"));
                // Leave the browser's own (⌘R, ⌘W…) alone.
                return;
            }
            const s = vui.get();
            if (key === "\\") return run(fitTimeline);
            if (key === "=" || key === "+") return run(() => zoomTimeline(1.5));
            if (key === "-") return run(() => zoomTimeline(1 / 1.5));
            switch (code) {
                case "Space":
                    return run(togglePlay);
                case "ArrowLeft":
                    return run(() => (e.altKey ? nudgeSelection(-1) : step(e.shiftKey ? -10 : -1)));
                case "ArrowRight":
                    return run(() => (e.altKey ? nudgeSelection(1) : step(e.shiftKey ? 10 : 1)));
                case "ArrowUp":
                    return run(() => jumpEdit(-1));
                case "ArrowDown":
                    return run(() => jumpEdit(1));
                case "Home":
                    return run(() => seek(0));
                case "End":
                    return run(() => seek(compLength(activeComp())));
                case "Backspace":
                case "Delete":
                    return run(() => deleteSelection(e.altKey || e.shiftKey));
                case "Escape":
                    return run(() => {
                        if (s.maskEdit) return vui.set({ maskEdit: null });
                        if (s.commenting) return toggleCommenting(false);
                        vui.set({ selection: [], transition: null, marker: null, tool: "select" });
                    });
                case "Enter": {
                    const id = s.selection[0];
                    if (id) return run(() => openNested(id));
                    return;
                }
                case "BracketLeft":
                    return run(() => jumpKey(-1));
                case "BracketRight":
                    return run(() => jumpKey(1));
                case "Equal":
                    return run(() => zoomTimeline(1.5));
                case "Minus":
                    return run(() => zoomTimeline(1 / 1.5));
                case "Backslash":
                    return run(fitTimeline);
                default:
                    break;
            }
            if (e.altKey) {
                if (code === "KeyX") return run(() => setInOut("clear"));
                return;
            }
            switch (key) {
                case "j":
                    return run(() => shuttle(-1));
                case "k":
                    return run(() => shuttle(0));
                case "l":
                    return run(() => shuttle(1));
                case "i":
                    return run(() => setInOut("in"));
                case "o":
                    return run(() => setInOut("out"));
                case "m":
                    return run(markerAtPlayhead);
                case "v":
                    return run(() => vui.set({ tool: "select" }));
                case "c":
                    return run(() => (e.shiftKey ? toggleCommenting() : vui.set({ tool: s.tool === "razor" ? "select" : "razor" })));
                case "s":
                    return run(() => (e.shiftKey ? vui.set({ snapping: !s.snapping }) : splitAtPlayhead()));
                case "t":
                    return run(() => addTitle());
                case "e":
                    if (e.shiftKey) return run(toggleEnabled);
                    break;
                default:
                    break;
            }
            // Other single keys would reach the design canvas's shortcuts, which aren't on screen.
            if (key.length === 1) e.stopPropagation();
        };
        const onClipboard = (e: ClipboardEvent) => {
            if (typing(e.target)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.type === "copy") copySelection();
            else if (e.type === "cut") copySelection(true);
            else pasteAtPlayhead();
        };
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("copy", onClipboard, true);
        window.addEventListener("cut", onClipboard, true);
        window.addEventListener("paste", onClipboard, true);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            window.removeEventListener("copy", onClipboard, true);
            window.removeEventListener("cut", onClipboard, true);
            window.removeEventListener("paste", onClipboard, true);
        };
    }, []);
}

// ---- The file's picture on Home ----

function useThumbnail(fileId: string | null) {
    useEffect(() => {
        if (!fileId) return;
        let timer = 0;
        const update = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(async () => {
                if (editor.get().fileId !== fileId || !fileMeta(fileId)) return;
                const project = currentProject();
                const comp = project.root;
                if (!comp.clips.length) return;
                try {
                    const t = Math.min(1, compLength(comp) / 2);
                    const canvas = await renderStill(project, editor.get().doc, comp, t, 320, 200);
                    setFileThumb(fileId, canvas.toDataURL("image/jpeg", 0.8));
                } catch {
                    // A picture is a nicety.
                }
            }, 2500);
        };
        update();
        const off = editor.onCommit(update);
        return () => {
            window.clearTimeout(timer);
            off();
        };
    }, [fileId]);
}
