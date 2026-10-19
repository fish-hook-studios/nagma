import { describe, expect, it } from "vitest";
import { createPresenceThrottle } from "./presence-throttle";

// A fake clock and timers, so the throttle's timing is exact.
function harness(opts: { hz?: number; hidden?: boolean } = {}) {
    let t = 0;
    let timers: { at: number; fn: () => void; id: number }[] = [];
    let nextId = 1;
    const state = { cursor: { x: 0, y: 0 }, camera: { x: 0, y: 0, zoom: 1 }, hz: opts.hz ?? 20, hidden: opts.hidden ?? false };
    const sent: { cursor: { x: number; y: number }; camera: { x: number; y: number; zoom: number }; at: number }[] = [];
    const throttle = createPresenceThrottle({
        build: () => ({ cursor: { ...state.cursor }, camera: { ...state.camera } }),
        send: (p) => sent.push({ ...p, at: t }),
        hz: () => state.hz,
        hidden: () => state.hidden,
        now: () => t,
        setTimer: (fn, ms) => {
            const id = nextId++;
            timers.push({ at: t + ms, fn, id });
            return id;
        },
        clearTimer: (id) => (timers = timers.filter((x) => x.id !== id)),
    });
    // Moves the clock forward, running timers that come due.
    const advance = (ms: number) => {
        const end = t + ms;
        for (;;) {
            timers.sort((a, b) => a.at - b.at);
            const due = timers[0];
            if (!due || due.at > end) break;
            timers = timers.slice(1);
            t = due.at;
            due.fn();
        }
        t = end;
    };
    return { throttle, state, sent, advance, pendingTimers: () => timers.length };
}

describe("presence throttle", () => {
    it("sends at most 20 updates a second, each with the latest state", () => {
        const h = harness();
        // A pointer moving every millisecond for one second.
        for (let i = 1; i <= 1000; i++) {
            h.state.cursor = { x: i, y: i };
            h.throttle.changed();
            h.advance(1);
        }
        h.advance(100);
        expect(h.sent.length).toBeLessThanOrEqual(21);
        expect(h.sent.length).toBeGreaterThanOrEqual(19);
        // Coalesced, not dropped: the last position always gets out.
        expect(h.sent.at(-1)?.cursor).toEqual({ x: 1000, y: 1000 });
        for (let i = 1; i < h.sent.length; i++) expect(h.sent[i]!.at - h.sent[i - 1]!.at).toBeGreaterThanOrEqual(50);
    });

    it("drops to the rate the server asks for in busy rooms", () => {
        const h = harness({ hz: 5 });
        for (let i = 1; i <= 1000; i++) {
            h.state.cursor = { x: i, y: 0 };
            h.throttle.changed();
            h.advance(1);
        }
        h.advance(300);
        expect(h.sent.length).toBeLessThanOrEqual(6);
        expect(h.sent.at(-1)?.cursor.x).toBe(1000);
    });

    it("sends nothing when nothing changed (a still pointer)", () => {
        const h = harness();
        h.throttle.changed();
        expect(h.sent.length).toBe(1);
        for (let i = 0; i < 100; i++) {
            h.throttle.changed();
            h.advance(60);
        }
        expect(h.sent.length).toBe(1);
        // After a reset (a new connection) the same state goes out again.
        h.throttle.reset();
        h.throttle.changed();
        expect(h.sent.length).toBe(2);
    });

    it("sends nothing while the tab is hidden, and the current state when it shows again", () => {
        const h = harness({ hidden: true });
        for (let i = 0; i < 50; i++) {
            h.state.cursor = { x: i, y: 0 };
            h.throttle.changed();
            h.advance(30);
        }
        expect(h.sent.length).toBe(0);
        h.state.hidden = false;
        h.throttle.visible();
        expect(h.sent.length).toBe(1);
        expect(h.sent[0]?.cursor.x).toBe(49);
    });

    it("moves the camera forward only 5 times a second, but always ends on the latest camera", () => {
        const h = harness();
        // Panning for a second while the pointer moves too.
        for (let i = 1; i <= 100; i++) {
            h.state.camera = { x: i * 10, y: 0, zoom: 1 };
            h.state.cursor = { x: i, y: 0 };
            h.throttle.changed();
            h.advance(10);
        }
        h.advance(500);
        const cameras = new Set(h.sent.map((s) => s.camera.x));
        expect(h.sent.length).toBeGreaterThan(10);
        expect(cameras.size).toBeLessThanOrEqual(7);
        expect(h.sent.at(-1)?.camera.x).toBe(1000);
        expect(h.pendingTimers()).toBe(0);
    });

    it("panning alone (no other change) also stays at 5 a second", () => {
        const h = harness();
        for (let i = 1; i <= 100; i++) {
            h.state.camera = { x: i, y: 0, zoom: 1 };
            h.throttle.changed();
            h.advance(10);
        }
        h.advance(500);
        expect(h.sent.length).toBeLessThanOrEqual(7);
        expect(h.sent.at(-1)?.camera.x).toBe(100);
    });
});
