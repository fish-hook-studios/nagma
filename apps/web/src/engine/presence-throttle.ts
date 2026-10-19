// How often this browser tells the room where its pointer is. Presence is coalesced: callers say
// "something changed" as often as they like, and at most `hz()` messages a second go out (20, or 5 in
// a busy room, as the server says), each carrying the latest state. Nothing is sent while the tab is
// hidden or when nothing changed since the last message, and the camera (panning, zooming,
// scrolling) only moves forward 5 times a second: in between, messages repeat the last camera sent.

export const PRESENCE_HZ = 20;
export const CAMERA_HZ = 5;

export interface PresenceThrottleOptions<P extends { camera?: unknown }> {
    // The full presence message as of now.
    build: () => P;
    send: (payload: P) => void;
    // Updates a second allowed right now (the server lowers it in busy rooms).
    hz?: () => number;
    hidden?: () => boolean;
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (timer: unknown) => void;
}

export interface PresenceThrottle {
    // Something changed: send soon (at the next free slot).
    changed: () => void;
    // Forget what was sent (a new connection must hear everything again).
    reset: () => void;
    // The tab became visible again: send the current state.
    visible: () => void;
    cancel: () => void;
}

export function createPresenceThrottle<P extends { camera?: unknown }>(options: PresenceThrottleOptions<P>): PresenceThrottle {
    const now = options.now ?? (() => performance.now());
    const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = options.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    const hz = () => Math.max(1, Math.min(PRESENCE_HZ, options.hz?.() ?? PRESENCE_HZ));
    const hidden = () => options.hidden?.() ?? false;
    let lastSentAt = -Infinity;
    let lastCameraAt = -Infinity;
    let lastText = "";
    let lastCamera: unknown;
    let lastCameraText = "";
    let timer: unknown = null;

    const schedule = (ms: number) => {
        if (timer !== null) return;
        timer = setTimer(() => {
            timer = null;
            flush();
        }, Math.max(0, ms));
    };

    function flush() {
        if (hidden()) return;
        const t = now();
        const wait = lastSentAt + 1000 / hz() - t;
        if (wait > 0) return schedule(wait);
        const payload = options.build();
        const cameraText = JSON.stringify(payload.camera ?? null);
        let cameraHeld = false;
        if (cameraText !== lastCameraText) {
            if (t - lastCameraAt < 1000 / CAMERA_HZ) {
                // Too soon for the camera: send the rest with the camera last sent, and the new
                // camera when its slot comes.
                (payload as { camera?: unknown }).camera = lastCamera;
                cameraHeld = true;
            } else {
                lastCamera = payload.camera;
                lastCameraText = cameraText;
                lastCameraAt = t;
            }
        }
        const text = JSON.stringify(payload);
        if (text !== lastText) {
            lastText = text;
            lastSentAt = t;
            options.send(payload);
        }
        if (cameraHeld) schedule(lastCameraAt + 1000 / CAMERA_HZ - t);
    }

    return {
        changed: () => {
            if (timer !== null || hidden()) return;
            flush();
        },
        reset: () => {
            lastText = "";
            lastCameraText = "";
            lastSentAt = -Infinity;
            lastCameraAt = -Infinity;
        },
        visible: () => {
            if (timer !== null) return;
            flush();
        },
        cancel: () => {
            if (timer !== null) clearTimer(timer);
            timer = null;
        },
    };
}
