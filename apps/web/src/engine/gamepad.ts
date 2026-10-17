import type { TriggerDevice } from "./types";

// Game controllers as prototype triggers: the Gamepad API's standard mapping names the buttons by
// index; each kind of controller calls them something else. The player polls the pads every
// frame and fires "key" interactions set to a controller when a button goes down.

export const TRIGGER_DEVICES: [TriggerDevice, string][] = [
    ["keyboard", "Keyboard"],
    ["xbox", "Xbox controller"],
    ["playstation", "PlayStation controller"],
    ["switch", "Switch Pro controller"],
    ["controller", "Other controller"],
];

// Standard mapping indexes 0 to 16.
const STANDARD = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "Left stick", "Right stick", "D-pad up", "D-pad down", "D-pad left", "D-pad right", "Guide"];
const NAMES: Partial<Record<TriggerDevice, string[]>> = {
    xbox: STANDARD,
    playstation: ["Cross", "Circle", "Square", "Triangle", "L1", "R1", "L2", "R2", "Share", "Options", "L3", "R3", "D-pad up", "D-pad down", "D-pad left", "D-pad right", "PS"],
    switch: ["B", "A", "Y", "X", "L", "R", "ZL", "ZR", "Minus", "Plus", "Left stick", "Right stick", "D-pad up", "D-pad down", "D-pad left", "D-pad right", "Home"],
    controller: STANDARD.map((_, i) => `Button ${i}`),
};

export function gamepadButtons(device: TriggerDevice): { index: number; label: string }[] {
    const names = NAMES[device] ?? NAMES.controller ?? [];
    return names.map((label, index) => ({ index, label }));
}

export function gamepadButtonLabel(device: TriggerDevice | undefined, index: number | undefined): string {
    if (index === undefined) return "";
    return gamepadButtons(device ?? "controller")[index]?.label ?? `Button ${index}`;
}

export function deviceLabel(device: TriggerDevice | undefined): string {
    return TRIGGER_DEVICES.find(([id]) => id === (device ?? "keyboard"))?.[1] ?? "Keyboard";
}

export function isController(device: TriggerDevice | undefined): boolean {
    return device !== undefined && device !== "keyboard";
}

// Which kind of controller a pad looks like, from its id.
export function padKind(pad: Gamepad): TriggerDevice {
    const id = pad.id.toLowerCase();
    if (/xbox|xinput|microsoft/.test(id)) return "xbox";
    if (/playstation|dualshock|dualsense|sony|054c/.test(id)) return "playstation";
    if (/switch|nintendo|057e/.test(id)) return "switch";
    return "controller";
}

// Buttons that went down since the last poll, per pad: [kind, index].
export class GamepadWatcher {
    private held = new Map<number, boolean[]>();

    poll(): { kind: TriggerDevice; index: number }[] {
        const out: { kind: TriggerDevice; index: number }[] = [];
        if (typeof navigator === "undefined" || !navigator.getGamepads) return out;
        let pads: (Gamepad | null)[] = [];
        try {
            pads = [...navigator.getGamepads()];
        } catch {
            return out;
        }
        for (const pad of pads) {
            if (!pad) continue;
            const was = this.held.get(pad.index) ?? [];
            const now = pad.buttons.map((b) => b.pressed || b.value > 0.5);
            const kind = padKind(pad);
            now.forEach((down, i) => {
                if (down && !was[i]) out.push({ kind, index: i });
            });
            this.held.set(pad.index, now);
        }
        return out;
    }

    // Whether a pressed button matches an interaction's device: the same kind, or any kind for
    // "other controller".
    static matches(device: TriggerDevice | undefined, kind: TriggerDevice): boolean {
        return device === "controller" || device === kind;
    }
}
