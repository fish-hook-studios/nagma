import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Welcome on Home (three panels, once per device), Help › Get started, and the once-only note in
// Share for a file that's only on this device. The test server address is on loopback, so the
// server in use is This computer.
localStorage.removeItem("nagma.auth.v1");

const onboarding = await import("./onboarding");
const { isUserKey } = await import("./user-storage");
const { closeServerPicker, rememberServer, setCurrentServer, useServerPickerOpen } = await import("./servers");
const { closeAccountSettings, useSettingsTab } = await import("./account");
const { notifyKeyNeeded } = await import("./ai-settings");
const { editor } = await import("./store");
const { MENU_ACTIONS, menuPaths } = await import("./menu-actions");
const { SPEC } = await import("./desktop");
const { Onboarding, ShareNeedsServer } = await import("../components/onboarding");
const { ShareDialogContent } = await import("../components/share-dialog");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// What the app shows besides the dialog: whether the server picker is open, and the settings tab.
const shown = { picker: false, tab: null as string | null };
const report = (picker: boolean, tab: string | null) => Object.assign(shown, { picker, tab });
function Probe() {
    report(useServerPickerOpen(), useSettingsTab());
    return null;
}

const reset = () => {
    localStorage.removeItem(onboarding.ONBOARDING_KEY);
    act(() => {
        onboarding.chooseWelcome("local");
        closeServerPicker();
        closeAccountSettings();
    });
    localStorage.removeItem(onboarding.ONBOARDING_KEY);
};

describe("seen flags", () => {
    beforeEach(() => localStorage.removeItem(onboarding.ONBOARDING_KEY));

    it("are a device preference: one plain key, not an account's or a server's", () => {
        expect(isUserKey(onboarding.ONBOARDING_KEY)).toBe(false);
        expect(onboarding.hasSeen("welcome")).toBe(false);
        onboarding.markSeen("welcome", 1234);
        expect(JSON.parse(localStorage.getItem(onboarding.ONBOARDING_KEY)!)).toEqual({ welcome: 1234 });
        expect(Object.keys(localStorage).some((k) => k.startsWith("nagma@") && k.includes("onboarding"))).toBe(false);
    });

    it("keep the first time and each hint apart", () => {
        onboarding.markSeen("welcome", 1);
        onboarding.markSeen("welcome", 2);
        onboarding.markSeen("shareNeedsServer", 3);
        expect(JSON.parse(localStorage.getItem(onboarding.ONBOARDING_KEY)!)).toEqual({ welcome: 1, shareNeedsServer: 3 });
        expect(onboarding.hasSeen("shareNeedsServer")).toBe(true);
    });

    it("read anything unexpected as nothing seen", () => {
        localStorage.setItem(onboarding.ONBOARDING_KEY, "not json");
        expect(onboarding.hasSeen("welcome")).toBe(false);
        localStorage.setItem(onboarding.ONBOARDING_KEY, "[1,2]");
        expect(onboarding.hasSeen("welcome")).toBe(false);
        onboarding.markSeen("welcome", 5);
        expect(onboarding.hasSeen("welcome")).toBe(true);
    });
});

describe("Welcome", () => {
    let root: Root;
    let host: HTMLDivElement;
    beforeAll(() => {
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    });
    afterAll(() => act(() => root.unmount()));
    beforeEach(reset);

    const dialog = () => document.querySelector('[aria-label="Welcome to Nagma"]');
    const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Welcome to Nagma"] button')].find((b) => b.textContent === label);
    const mount = async () => {
        act(() => editor.set({ homeOpen: true }));
        await act(async () => root.render(createElement("div")));
        await act(async () => root.render(createElement("div", null, createElement(Onboarding), createElement(Probe))));
    };

    it("opens the first time Home shows on this device, and not again", async () => {
        await mount();
        expect(dialog()).toBeTruthy();
        expect(onboarding.hasSeen("welcome")).toBe(true);
        await act(async () => button("Got it")?.click());
        expect(dialog()).toBeNull();
        expect(onboarding.showWelcomeOnce()).toBe(false);
        await mount();
        expect(dialog()).toBeNull();
    });

    it("says three things, each with a picture and a guide, and asks for no decision", async () => {
        await mount();
        const panels = [...document.querySelectorAll('[aria-label="How Nagma works"] li')];
        expect(panels.map((li) => li.querySelector("h3")?.textContent)).toEqual(["It runs on your computer", "Work together on any server", "AI with your own key"]);
        for (const li of panels) {
            expect(li.querySelector("svg")).toBeTruthy();
            expect([...li.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Learn more"]);
        }
        expect(dialog()?.textContent).not.toContain("Default");
        expect(shown).toEqual({ picker: false, tab: null });
    });

    it("Got it just closes", async () => {
        await mount();
        expect(dialog()).toBeTruthy();
        await act(async () => button("Got it")?.click());
        expect(dialog()).toBeNull();
        expect(shown).toEqual({ picker: false, tab: null });
    });

    it("Choose a server now closes it and opens the server picker", async () => {
        await mount();
        expect(dialog()).toBeTruthy();
        await act(async () => button("Choose a server now")?.click());
        expect(dialog()).toBeNull();
        expect(shown.picker).toBe(true);
        expect(shown.tab).toBeNull();
    });

    it("the no-key notice still opens Account settings › AI", async () => {
        await mount();
        await act(async () => button("Got it")?.click());
        act(() => notifyKeyNeeded());
        expect(editor.get().toastAction?.label).toBe("Open AI settings");
        act(() => editor.get().toastAction?.run());
        expect(shown.tab).toBe("ai");
        act(() => closeAccountSettings());
    });

    it("Help › Get started opens it again, any time", async () => {
        onboarding.markSeen("welcome");
        await mount();
        expect(dialog()).toBeNull();
        const action = MENU_ACTIONS.find((a) => a.id === "gettingStarted");
        expect(action?.group).toBe("Help");
        expect(menuPaths().get("gettingStarted")).toContain("Help and account");
        expect(SPEC.help?.[0]).toBe("gettingStarted");
        await act(async () => {
            action?.run();
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(dialog()).toBeTruthy();
    });

    it("Learn more links go to the guides", () => {
        expect(onboarding.DOC_LINKS).toEqual({
            gettingStarted: "https://github.com/fish-hook-studios/nagma/blob/main/docs/getting-started.md",
            connect: "https://github.com/fish-hook-studios/nagma/blob/main/docs/connect-to-a-server.md",
            aiKeys: "https://github.com/fish-hook-studios/nagma/blob/main/docs/ai-keys.md",
            selfHost: "https://github.com/fish-hook-studios/nagma/blob/main/docs/self-hosting.md",
        });
    });
});

describe("Share in a file that's only on this device", () => {
    let root: Root;
    let host: HTMLDivElement;
    beforeAll(() => {
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    });
    afterAll(() => act(() => root.unmount()));
    beforeEach(reset);

    const note = () => host.querySelector('[aria-label="Collaboration needs a server"]');

    it("is for a local file while This computer is the server, once", () => {
        expect(onboarding.onThisComputer()).toBe(true);
        expect(onboarding.shouldNudgeShare(false)).toBe(false);
        expect(onboarding.shouldNudgeShare(true)).toBe(true);
        onboarding.markSeen("shareNeedsServer");
        expect(onboarding.shouldNudgeShare(true)).toBe(false);
    });

    it("isn't on a team's server", () => {
        rememberServer({ origin: "https://nagma.example.com", name: "Example", version: "1.0.0" });
        setCurrentServer("https://nagma.example.com");
        try {
            expect(onboarding.onThisComputer()).toBe(false);
            expect(onboarding.shouldNudgeShare(true)).toBe(false);
        } finally {
            setCurrentServer(null);
        }
    });

    it("shows in Share the first time, with Connect opening the picker", async () => {
        let closed = 0;
        await act(async () => root.render(createElement("div", null, createElement(ShareDialogContent, { close: () => closed++ }), createElement(Probe))));
        expect(note()?.textContent).toContain("Collaboration needs a server. Use Nagma's free hosted server, connect to your own, or run one in one command.");
        expect(onboarding.hasSeen("shareNeedsServer")).toBe(true);
        const connect = [...note()!.querySelectorAll("button")].find((b) => b.textContent === "Connect");
        await act(async () => connect?.click());
        expect(closed).toBe(1);
        expect(shown.picker).toBe(true);
        await act(async () => root.render(createElement("div")));
        await act(async () => root.render(createElement(ShareDialogContent, { close: () => undefined })));
        expect(note()).toBeNull();
        // No link from This computer: Share through Nagma instead (engine/share-hosted.test.ts).
        expect(host.textContent).toContain("Share through Nagma");
    });

    it("the note on its own marks itself seen", async () => {
        await act(async () => root.render(createElement(ShareNeedsServer, { close: () => undefined })));
        expect(onboarding.hasSeen("shareNeedsServer")).toBe(true);
        expect([...note()!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Connect", "Learn more"]);
    });
});
