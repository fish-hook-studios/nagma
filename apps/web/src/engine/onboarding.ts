import { useSyncExternalStore } from "react";
import "./account";
import { openAiSettings } from "./ai-settings";
import { currentServer, localServerLabel, openServerPicker } from "./servers";

// First run and once-only hints: the Get started cards on Home (components/onboarding.tsx), and
// the note in Share for a file that's only on this device while This computer is the server.
//
// What has been seen is a device preference, like the theme (engine/user-storage.ts): one plain
// localStorage key, not scoped to an account or a server, so a person who signs in, switches
// account or connects to another server isn't welcomed again on the same device.

export const ONBOARDING_KEY = "nagma.onboarding.v1";
export type Hint = "welcome" | "shareNeedsServer";

const DOCS = "https://github.com/fish-hook-studios/nagma/blob/main/docs";
export const DOC_LINKS = {
    gettingStarted: `${DOCS}/getting-started.md`,
    connect: `${DOCS}/connect-to-a-server.md`,
    aiKeys: `${DOCS}/ai-keys.md`,
    selfHost: `${DOCS}/self-hosting.md`,
} as const;

function readSeen(): Partial<Record<Hint, number>> {
    try {
        const raw = localStorage.getItem(ONBOARDING_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Partial<Record<Hint, number>>) : {};
    } catch {
        return {};
    }
}

export const hasSeen = (hint: Hint) => typeof readSeen()[hint] === "number";

export function markSeen(hint: Hint, at = Date.now()) {
    const seen = readSeen();
    if (typeof seen[hint] === "number") return;
    try {
        localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ ...seen, [hint]: at }));
    } catch {
        // Storage blocked: the hint may show again next time, which is harmless.
    }
}

// ---- The Get started cards ----

let welcomeOpen = false;
const listeners = new Set<() => void>();
function setWelcome(open: boolean) {
    if (welcomeOpen === open) return;
    welcomeOpen = open;
    for (const l of [...listeners]) l();
}

export function useWelcomeOpen(): boolean {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => welcomeOpen,
    );
}

// Help › Get started: always opens.
export function openWelcome() {
    setWelcome(true);
}

// Home calls this when it shows: opens the cards the first time on this device, and only then.
export function showWelcomeOnce(): boolean {
    if (hasSeen("welcome")) return false;
    markSeen("welcome");
    setWelcome(true);
    return true;
}

export type WelcomeChoice = "local" | "server" | "ai";

// The three cards. Closing the dialog any other way counts as "local".
export function chooseWelcome(choice: WelcomeChoice) {
    markSeen("welcome");
    setWelcome(false);
    if (choice === "server") openServerPicker();
    else if (choice === "ai") openAiSettings();
}

// ---- Share in a file that's only on this device ----

// This computer is the server in use (the desktop app's own, or one on loopback): a file moved
// there can't be opened by anyone on another machine.
export const onThisComputer = () => currentServer() === null && localServerLabel() === "This computer";

// Whether Share should say that collaboration needs a server: once per device, for a file that's
// only here, while This computer is the server.
export const shouldNudgeShare = (fileIsLocal: boolean) => fileIsLocal && onThisComputer() && !hasSeen("shareNeedsServer");

export function openDoc(url: string) {
    window.open(url, "_blank", "noopener");
}
