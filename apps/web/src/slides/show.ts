import { useSyncExternalStore } from "react";
import { startPresenting } from "../engine/camera";
import { closeTab } from "../engine/files";
import { protoTabId } from "../engine/prototype-view";
import { editor } from "../engine/store";
import type { NagmaDocument } from "../engine/types";
import { slideIds, slideOf } from "./model";
import { DEFAULT_TRANSITION, animationSteps } from "./render";
import { currentSlide, slides } from "./state";
import type { SlideTransition } from "./types";

// The presentation in progress (shared by the show and the presenter view window), and the
// controls that move it along: next and previous play object animations, then change slides.

export interface Show {
    // The slides shown, in order (skipped ones left out).
    order: string[];
    index: number;
    // Click steps played on this slide, the time the last one started, and when the slide came in.
    shown: number;
    stepAt: number;
    entryAt: number;
    transition: { from: string; to: string; at: number; spec: SlideTransition } | null;
    ended: boolean;
    laser: boolean;
    black: boolean;
    startedAt: number;
    presenterWindow: Window | null;
    // Presenter view shown over the show in this window (when pop-up windows are blocked).
    presenterInline: boolean;
    // The slide navigator (G) and the shortcut list (?) shown over the show.
    navigator: boolean;
    help: boolean;
    // Digits typed to jump to a slide (then Enter).
    typed: string;
    // Rehearsal: milliseconds spent on each slide so far, and when the slide on screen came in.
    timings: Record<string, number>;
    slideAt: number;
}

let show: Show = { order: [], index: 0, shown: 0, stepAt: 0, entryAt: 0, transition: null, ended: false, laser: false, black: false, startedAt: 0, presenterWindow: null, presenterInline: false, navigator: false, help: false, typed: "", timings: {}, slideAt: 0 };
const listeners = new Set<() => void>();
export function setShow(patch: Partial<Show>) {
    show = { ...show, ...patch };
    for (const l of listeners) l();
}
export function useShow(): Show {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => show,
    );
}

export function visibleOrder(doc: NagmaDocument): string[] {
    return slideIds(doc).filter((id) => !slideOf(doc.nodes[id])?.skip);
}

let wantPresenterView = false;
// Presenter view asked for before the show mounted (opened once it does).
export function takePresenterViewRequest(): boolean {
    const want = wantPresenterView;
    wantPresenterView = false;
    return want;
}
export function currentShow(): Show {
    return show;
}

// Starts the show on a slide (a skipped one starts at the next shown slide).
export function present(from: "start" | "current", options: { presenterView?: boolean; rehearse?: boolean } = {}) {
    const doc = editor.get().doc;
    const all = slideIds(doc);
    const order = visibleOrder(doc);
    if (!order.length) {
        editor.notify("Every slide is skipped.");
        return;
    }
    let start = order[0] as string;
    if (from === "current") {
        const cur = currentSlide();
        const at = cur ? all.indexOf(cur) : 0;
        start = all.slice(at).find((id) => order.includes(id)) ?? start;
    }
    slides.set({ rehearse: Boolean(options.rehearse) });
    wantPresenterView = Boolean(options.presenterView);
    const now = performance.now();
    setShow({ order, index: order.indexOf(start), shown: 0, stepAt: now, entryAt: now, transition: null, ended: false, laser: false, black: false, startedAt: Date.now(), navigator: false, help: false, typed: "", timings: {}, slideAt: Date.now() });
    if (options.presenterView) openPresenterView();
    startPresenting(start);
}

export function stopPresentation() {
    const fileId = editor.get().fileId;
    show.presenterWindow?.close();
    setShow({ presenterWindow: null, presenterInline: false });
    if (fileId) closeTab(protoTabId(fileId));
    else editor.set({ presentingId: null });
}

export function next() {
    const doc = editor.get().doc;
    const now = performance.now();
    if (show.ended) return stopPresentation();
    const id = show.order[show.index];
    const slide = id ? doc.nodes[id] : undefined;
    const steps = animationSteps(slide);
    if (show.shown < steps.clicks.length) {
        setShow({ shown: show.shown + 1, stepAt: now });
        return;
    }
    const to = show.order[show.index + 1];
    if (!to || !id) {
        setShow({ ...clockOut(), ended: true });
        return;
    }
    const spec = slideOf(doc.nodes[to])?.transition ?? DEFAULT_TRANSITION;
    const transition = spec.type === "none" ? null : { from: id, to, at: now, spec };
    setShow({ ...clockOut(), index: show.index + 1, shown: 0, stepAt: now, entryAt: now + (transition ? spec.duration : 0), transition });
    goTo(to);
}

// Slides deleted while the show runs (a collaborator's edit) leave it: the show stays on the
// slide it was on, or moves to the one that took the deleted slide's place (the screen went blank).
export function pruneShow(doc: NagmaDocument) {
    if (show.order.every((id) => doc.nodes[id])) return;
    const order = show.order.filter((id) => doc.nodes[id]);
    if (!order.length) return stopPresentation();
    const current = show.order[show.index];
    const kept = current && doc.nodes[current];
    const index = kept ? order.indexOf(current) : Math.min(show.order.slice(0, show.index).filter((id) => doc.nodes[id]).length, order.length - 1);
    const now = performance.now();
    setShow({ order, index, ...(kept ? {} : { shown: 0, stepAt: now, entryAt: now, transition: null }) });
    if (!kept) goTo(order[index] as string);
}

export function previous() {
    // Back from the end screen: the last slide's clock starts again now (the time on the end
    // screen was added to its rehearsal timing).
    if (show.ended) return setShow({ ended: false, slideAt: Date.now() });
    if (show.shown > 0) {
        setShow({ shown: show.shown - 1, stepAt: -Infinity });
        return;
    }
    const to = show.order[show.index - 1];
    if (!to) return;
    const slide = editor.get().doc.nodes[to];
    setShow({ ...clockOut(), index: show.index - 1, shown: animationSteps(slide).clicks.length, stepAt: -Infinity, entryAt: -Infinity, transition: null });
    goTo(to);
}

export function jump(index: number) {
    const to = show.order[index];
    if (!to) return;
    setShow({ ...clockOut(), index, shown: 0, stepAt: performance.now(), entryAt: performance.now(), transition: null, ended: false, navigator: false, typed: "" });
    goTo(to);
}

// Adds the time spent on the slide that was showing to its rehearsal timing.
function clockOut(): Partial<Show> {
    const id = show.order[show.index];
    const now = Date.now();
    if (!id || show.ended) return { slideAt: now };
    return { timings: { ...show.timings, [id]: (show.timings[id] ?? 0) + Math.max(0, now - show.slideAt) }, slideAt: now };
}

// The editor follows the show, so leaving it lands on the slide that was showing.
function goTo(id: string) {
    const fileId = editor.get().fileId ?? "";
    slides.set({ current: { ...slides.get().current, [fileId]: id } });
}

export function onKey(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    const key = event.key;
    const take = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    if (event.metaKey || event.ctrlKey) return;
    // Overlays first: Esc closes them, and the navigator takes its own clicks.
    if (show.navigator || show.help) {
        if (key === "Escape" || (show.navigator && key.toLowerCase() === "g") || (show.help && key === "?")) return take(), setShow({ navigator: false, help: false });
        if (show.navigator) return;
    }
    // A slide number, then Enter, jumps there.
    if (/^[0-9]$/.test(key)) return take(), setShow({ typed: (show.typed + key).slice(-3) });
    if (key === "Enter" && show.typed) {
        take();
        const n = Number(show.typed);
        setShow({ typed: "" });
        if (n >= 1 && n <= show.order.length) jump(n - 1);
        return;
    }
    if (show.typed && key !== "Shift") setShow({ typed: "" });
    if (key === "?") return take(), setShow({ help: true });
    if (key.toLowerCase() === "g") return take(), setShow({ navigator: true });
    if (key === "ArrowRight" || key === "ArrowDown" || key === " " || key === "Enter" || key === "PageDown" || key === "n") return take(), next();
    if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp" || key === "Backspace" || (key === "p" && !show.presenterInline)) return take(), previous();
    if (key === "Escape") return take(), stopPresentation();
    if (key === "Home") return take(), jump(0);
    if (key === "End") return take(), jump(show.order.length - 1);
    if (key.toLowerCase() === "l") return take(), setShow({ laser: !show.laser });
    if (key.toLowerCase() === "b" || key === ".") return take(), setShow({ black: !show.black });
    if (key.toLowerCase() === "p" && show.presenterInline) return take(), setShow({ presenterInline: false });
    if (key.toLowerCase() === "f") {
        take();
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
}

// ---- Presenter view (its own window) ----

export function openPresenterView() {
    if (show.presenterWindow && !show.presenterWindow.closed) {
        show.presenterWindow.focus();
        return;
    }
    const win = window.open("", "nagma-presenter-view", "width=1200,height=760");
    if (!win) {
        // Pop-ups are blocked: presenter view takes over this window instead (P toggles it).
        setShow({ presenterInline: true });
        editor.notify("Pop-ups are blocked, so presenter view opened here. Press P to switch back to the slides.");
        return;
    }
    win.document.title = "Presenter view";
    win.document.head.innerHTML = "";
    for (const el of Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))) win.document.head.appendChild(el.cloneNode(true));
    win.document.documentElement.dataset.theme = "dark";
    win.document.body.className = document.body.className;
    win.document.body.style.margin = "0";
    win.document.body.innerHTML = "";
    win.addEventListener("keydown", onKey, true);
    win.addEventListener("beforeunload", () => setShow({ presenterWindow: null }));
    setShow({ presenterWindow: win });
}
