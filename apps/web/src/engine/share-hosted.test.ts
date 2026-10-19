import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The hosted server (Nagma, free, run by the project) as a built-in choice, Share on a file only
// this computer can open (Share through Nagma instead of a link), the unverified-email case, and the
// guard that keeps links to this computer or its network from being handed out. No test reaches a
// real server: fetch is stubbed (test/setup.ts), sockets are stand-ins, and the flow tests point the
// hosted server at a made-up address with VITE_HOSTED_SERVER_URL.

vi.mock("./doc-store", () => import("../test/memory-doc-store"));

const sockets: string[] = [];
class FakeSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    onopen: (() => void) | null = null;
    onmessage: ((e: unknown) => void) | null = null;
    onclose: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    readyState = 0;
    constructor(url: string) {
        sockets.push(url);
    }
    send() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
}
vi.stubGlobal("WebSocket", FakeSocket);

localStorage.clear();
// inspect-settings first: it and collab.ts import each other (engine/collab-switch.test.ts).
await import("./inspect-settings");
const { editor } = await import("./store");
const { collab } = await import("./collab");
const servers = await import("./servers");
const hosted = await import("./share-hosted");
const { auth, connectToServer, signIn, signUp } = await import("./auth");
const { copyLink, LOCAL_LINK_REFUSED } = await import("./links");
const { listFiles } = await import("./files");
const { loadDoc } = await import("./doc-store");
const { ServerPicker } = await import("../components/server-picker");
const { ShareDialogContent } = await import("../components/share-dialog");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STAND_IN = "https://hosted.nagma.test";
const TEAM = "https://team.example";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const account = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, email: `${id}@example.com`, color: "#0D99FF", emailVerified: true, ...extra });
const clipboard = { writeText: vi.fn(async (_text: string) => undefined) };
Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });

afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockImplementation(async () => {
        throw new TypeError("fetch is disabled in tests");
    });
});

describe("the hosted server", () => {
    it("is Nagma at https://api.nagma.app unless the build says otherwise", () => {
        expect(servers.HOSTED_SERVER).toEqual({ name: "Nagma", url: "https://api.nagma.app" });
        expect(servers.hostedServerFrom(undefined)).toEqual({ name: "Nagma", origin: "https://api.nagma.app" });
        expect(servers.hostedServer()).toEqual({ name: "Nagma", origin: "https://api.nagma.app" });
    });

    it("VITE_HOSTED_SERVER_URL points a fork at its own, and empty leaves it out", () => {
        expect(servers.hostedServerFrom("https://nagma.fork.example/")).toEqual({ name: "Nagma", origin: "https://nagma.fork.example" });
        expect(servers.hostedServerFrom("nagma.fork.example")).toEqual({ name: "Nagma", origin: "https://nagma.fork.example" });
        expect(servers.hostedServerFrom("")).toBeNull();
        expect(servers.hostedServerFrom("   ")).toBeNull();
        expect(servers.hostedServerFrom("not a server")).toBeNull();
        vi.stubEnv("VITE_HOSTED_SERVER_URL", "https://nagma.fork.example");
        expect(servers.hostedServer()?.origin).toBe("https://nagma.fork.example");
        expect(servers.isHostedOrigin("https://nagma.fork.example")).toBe(true);
        vi.stubEnv("VITE_HOSTED_SERVER_URL", "");
        expect(servers.hostedServer()).toBeNull();
        expect(servers.isHostedOrigin("https://api.nagma.app")).toBe(false);
    });
});

describe("the server picker", () => {
    let root: Root;
    let host: HTMLDivElement;
    beforeAll(() => {
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    });
    afterAll(() => act(() => root.unmount()));

    const open = async () => {
        await act(async () => root.render(createElement("div")));
        act(() => servers.openServerPicker());
        await act(async () => root.render(createElement(ServerPicker)));
    };
    const rows = () => [...document.querySelectorAll('[aria-label="Servers"] [role="listitem"]')].map((r) => r.textContent ?? "");
    const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith(text));

    it("lists Nagma (hosted), free under This computer, above Add your own server, each with a line", async () => {
        await open();
        expect(rows()).toEqual(["This computerOnly you. Files stay on this computer.", "Nagma (hosted), freeShare and collaborate with anyone. Needs an account."]);
        const add = button("Add your own server…");
        expect(add).toBeTruthy();
        expect(document.body.textContent).toContain("Your own server: run it yourself, for you or your team.");
        expect(button("Self-hosting guide")).toBeTruthy();
        const opened = vi.spyOn(window, "open").mockImplementation(() => null);
        act(() => button("Self-hosting guide")?.click());
        expect(opened).toHaveBeenLastCalledWith("https://github.com/fish-hook-studios/nagma/blob/main/docs/self-hosting.md", "_blank", "noopener");
        opened.mockRestore();
    });

    it("the address field says where an address comes from", async () => {
        await open();
        await act(async () => button("Add your own server…")?.click());
        const input = document.querySelector<HTMLInputElement>("#server-address");
        expect(input?.placeholder).toBe("https://nagma.example.com");
        const hint = document.getElementById(input?.getAttribute("aria-describedby") ?? "");
        expect(hint?.textContent).toContain("The address of a Nagma server someone runs, like https://nagma.example.com");
        const opened = vi.spyOn(window, "open").mockImplementation(() => null);
        act(() => button("Where do I get one?")?.click());
        expect(opened).toHaveBeenLastCalledWith("https://github.com/fish-hook-studios/nagma/blob/main/docs/connect-to-a-server.md", "_blank", "noopener");
        opened.mockRestore();
    });

    it("isn't listed when the build leaves the hosted server out", async () => {
        vi.stubEnv("VITE_HOSTED_SERVER_URL", "");
        await open();
        expect(rows()).toEqual(["This computerOnly you. Files stay on this computer."]);
    });

    it("one click connects to the hosted server the build names", async () => {
        vi.stubEnv("VITE_HOSTED_SERVER_URL", STAND_IN);
        await open();
        vi.mocked(fetch).mockImplementation(async (url) => {
            expect(String(url)).toBe(`${STAND_IN}/health`);
            return json({ ok: true, name: "Nagma", version: "1.0.0", publicUrl: STAND_IN });
        });
        await act(async () => {
            button("Nagma (hosted), free")?.click();
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(servers.currentServer()?.origin).toBe(STAND_IN);
        expect(servers.shareableUrl().origin).toBe(STAND_IN);
        // The hosted server keeps its own row, not a second one among your servers.
        act(() => servers.openServerPicker());
        await act(async () => root.render(createElement(ServerPicker)));
        expect(rows().filter((r) => r.includes("hosted.nagma.test"))).toEqual([]);
        expect(rows()[1]).toContain("Nagma (hosted), free");
        connectToServer(null);
    });

    it("says why when the hosted server can't be reached", async () => {
        vi.stubEnv("VITE_HOSTED_SERVER_URL", STAND_IN);
        await open();
        await act(async () => {
            button("Nagma (hosted), free")?.click();
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(document.body.textContent).toContain("Couldn't reach hosted.nagma.test");
        expect(servers.currentServer()).toBeNull();
    });
});

describe("what Share offers", () => {
    it("on This computer: Share through Nagma (or your own server without one), never a link", () => {
        expect(hosted.shareStep({ thisComputer: true, fileOnServer: false, hosted: true })).toBe("through-hosted");
        // Moved to This computer's own server earlier: still no link for other people.
        expect(hosted.shareStep({ thisComputer: true, fileOnServer: true, hosted: true })).toBe("through-hosted");
        expect(hosted.shareStep({ thisComputer: true, fileOnServer: false, hosted: false })).toBe("pick-server");
    });

    it("on a server (hosted or your own): as before", () => {
        expect(hosted.shareStep({ thisComputer: false, fileOnServer: false, hosted: true })).toBe("move");
        expect(hosted.shareStep({ thisComputer: false, fileOnServer: true, hosted: true })).toBe("share");
        expect(hosted.shareStep({ thisComputer: false, fileOnServer: true, hosted: false })).toBe("share");
    });

    it("knows when sharing waits for a verified email", () => {
        expect(hosted.awaitingVerification(null)).toBe(false);
        expect(hosted.awaitingVerification({ emailVerified: false, verifyRequired: true })).toBe(true);
        expect(hosted.awaitingVerification({ emailVerified: false, verifyRequired: false })).toBe(false);
        expect(hosted.awaitingVerification({ emailVerified: true, verifyRequired: true })).toBe(false);
        expect(hosted.refusedUnverified(403, { code: "email-unverified" })).toBe(true);
        expect(hosted.refusedUnverified(403, { code: "invitee-unverified" })).toBe(false);
        expect(hosted.refusedUnverified(400, { code: "email-unverified" })).toBe(false);
        expect(hosted.refusedUnverified(403, null)).toBe(false);
    });
});

describe("the local link guard", () => {
    it("knows links that only open on this computer or its network", () => {
        for (const href of ["http://localhost:5173/?file=a", "http://127.0.0.1:47878/?file=a", "http://[::1]:8787/", "http://192.168.1.20:47878/?file=a", "http://10.0.0.4/", "http://172.20.1.1/", "http://169.254.1.1/", "http://100.100.1.1/", "http://my-laptop:8080/", "http://studio.local/", "http://nagma.localhost/", "http://[fd12::1]/", "http://0.0.0.0/", "not a link"]) expect(servers.isLocalOnlyLink(href), href).toBe(true);
        for (const href of ["https://api.nagma.app/?file=a", "https://nagma.example.com/?file=a", "http://8.8.8.8/", "http://172.32.0.1/", "https://[2001:db8::1]/"]) expect(servers.isLocalOnlyLink(href), href).toBe(false);
    });

    it("refuses to copy a local link unless asked for one (same network only)", async () => {
        collab.set({ fileId: "abcdef123456", status: "live", role: "edit", keys: { edit: "ek", view: "vk" } });
        clipboard.writeText.mockClear();
        await copyLink("file");
        expect(clipboard.writeText).not.toHaveBeenCalled();
        expect(editor.get().toast).toBe(LOCAL_LINK_REFUSED);
        await copyLink("file", { allowLocal: true });
        expect(clipboard.writeText).toHaveBeenCalledTimes(1);
        expect(new URL(clipboard.writeText.mock.calls[0]?.[0] ?? "").hostname).toBe("localhost");
        expect(editor.get().toast).toBe("Link copied (same network only).");
    });

    it("copies a link on the server's public https address", async () => {
        servers.rememberServer({ origin: STAND_IN, name: "Nagma", version: "1", publicUrl: "https://share.nagma.test" });
        connectToServer(STAND_IN);
        collab.set({ fileId: "abcdef123456", status: "live", role: "edit", keys: { edit: "ek", view: "vk" } });
        clipboard.writeText.mockClear();
        await copyLink("file");
        const link = new URL(clipboard.writeText.mock.calls[0]?.[0] ?? "");
        expect(link.origin).toBe("https://share.nagma.test");
        expect(link.pathname).toBe("/");
        expect(link.searchParams.get("file")).toBe("abcdef123456");
        expect(link.searchParams.get("server")).toBeNull();
        connectToServer(null);
        collab.set({ fileId: null, status: "local", role: null, keys: null });
    });
});

describe("Share on a file only this computer has", () => {
    let root: Root;
    let host: HTMLDivElement;
    beforeAll(() => {
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    });
    afterAll(() => act(() => root.unmount()));
    const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text));
    const render = async () => {
        await act(async () => root.render(createElement("div")));
        await act(async () => root.render(createElement(ShareDialogContent, { close: () => undefined })));
    };

    it("offers Share through Nagma, your own server and Export a copy, with no link to copy", async () => {
        localStorage.setItem("nagma.onboarding.v1", JSON.stringify({ shareNeedsServer: 1 }));
        await render();
        expect(button("Share through Nagma")).toBeTruthy();
        expect(button("Use your own server…")).toBeTruthy();
        expect(button("Export a copy")).toBeTruthy();
        expect(button("Copy link")).toBeUndefined();
        expect(host.textContent).not.toMatch(/https?:\/\//);
        // Without a hosted server: your own server first.
        vi.stubEnv("VITE_HOSTED_SERVER_URL", "");
        await render();
        expect(button("Share through")).toBeUndefined();
        expect(button("Use your own server…")).toBeTruthy();
    });

    it("a file on This computer's own server: only a local link, from a secondary menu, with its caveat", async () => {
        collab.set({ fileId: "abcdef123456", status: "live", role: "edit", keys: { edit: "ek", view: "vk" } });
        await render();
        expect(button("Share through Nagma")).toBeTruthy();
        expect(button("Copy link")).toBeUndefined();
        const menu = host.querySelector<HTMLButtonElement>('button[aria-label="Local link"]');
        expect(menu).toBeTruthy();
        collab.set({ fileId: null, status: "local", role: null, keys: null });
    });

    it("Share through Nagma switches to the hosted server with the open file kept, then signs in, moves it and opens Share", async () => {
        vi.stubEnv("VITE_HOSTED_SERVER_URL", STAND_IN);
        editor.loadDocument({ ...editor.get().doc, name: "Poster" }, null);
        await render();
        vi.mocked(fetch).mockImplementation(async (url) => {
            expect(String(url)).toBe(`${STAND_IN}/health`);
            return json({ ok: true, name: "Nagma", version: "1.0.0", publicUrl: STAND_IN });
        });
        await act(async () => {
            button("Share through Nagma")?.click();
            await new Promise((r) => setTimeout(r, 10));
        });
        expect(servers.currentServer()?.origin).toBe(STAND_IN);
        const pending = hosted.pendingShare();
        expect(pending).toMatchObject({ to: STAND_IN, name: "Poster", kind: "design" });
        expect((await loadDoc("nagma.file.carry", hosted.CARRY_OWNER))?.name).toBe("Poster");

        // Back at start on the hosted server, signed out: the sign-in dialog asks first.
        expect(await hosted.resumePendingShare()).toBe(false);
        expect(auth.get().open).toBe(true);
        expect(hosted.pendingShareHere()?.name).toBe("Poster");

        // Signed up there (unverified, as the hosted server requires a verified email to share).
        vi.mocked(fetch).mockImplementation(async (url, init) => {
            expect(String(url)).toBe(`${STAND_IN}/auth/signup`);
            // The verification mail opens on the hosted server's address, not this app's (localhost).
            expect(JSON.parse(String(init?.body)).origin).toBe(STAND_IN);
            return json({ token: "hosted-token", user: account("hostedA", { emailVerified: false, verifyRequired: true, mailReady: true }), verification: { sent: false, kept: true, mailConfigured: false } });
        });
        await signUp("Hosted A", "hostedA@example.com", "correct horse battery");
        vi.mocked(fetch).mockImplementation(async () => json({}, 404));
        sockets.length = 0;
        expect(await hosted.resumePendingShare()).toBe(true);
        expect(hosted.pendingShare()).toBeNull();
        expect(listFiles().map((f) => f.name)).toContain("Poster");
        expect(collab.get().status).toBe("connecting");
        expect(sockets[0]).toMatch(/^wss:\/\/hosted\.nagma\.test\/files\//);
        expect(hosted.takeShareRequest()).toBe(true);
        expect(hosted.takeShareRequest()).toBe(false);
    });

    it("on the hosted server, an unverified account sees Verify your email with Resend in Share", async () => {
        collab.set({ status: "live", role: "edit", keys: { edit: "ek", view: "vk" } });
        await render();
        const notice = host.querySelector('[aria-label="Verify your email"]');
        expect(notice?.textContent).toContain("Open the link we sent to hostedA@example.com");
        expect([...notice!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Resend"]);
        expect(button("Share through")).toBeUndefined();
    });

    it("a refusal for an unverified email shows that message, not a plain error", async () => {
        servers.rememberServer({ origin: TEAM, name: "Team", version: "1", publicUrl: null });
        connectToServer(TEAM);
        vi.mocked(fetch).mockImplementation(async (url) => (String(url).endsWith("/auth/signin") ? json({ token: "team-token", user: account("teamA") }) : json({}, 404)));
        await signIn("teamA@example.com", "correct horse battery");
        collab.set({ fileId: "teamfile1234", status: "live", role: "edit", keys: { edit: "ek", view: "vk" } });
        const access = { owner: account("teamA"), members: [], invites: [], link: "none", you: "edit", project: null, team: null, inherited: [] };
        vi.mocked(fetch).mockImplementation(async (url, init) => {
            if (String(url).includes("/files/teamfile1234/access")) return init?.method === "PUT" ? json({ error: "Verify your email first.", code: "email-unverified" }, 403) : json(access);
            return json({}, 404);
        });
        await render();
        expect(host.querySelector('[aria-label="Verify your email"]')).toBeNull();
        const input = host.querySelector<HTMLInputElement>('input[aria-label="Emails or groups to invite"]')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "friend@example.com");
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
            input.form?.requestSubmit();
            await new Promise((r) => setTimeout(r, 10));
        });
        const notice = host.querySelector('[aria-label="Verify your email"]');
        expect(notice?.textContent).toContain("Verify your email");
        expect(notice?.textContent).toContain("Resend");
        expect(host.textContent).not.toContain("Verify your email first.");
        connectToServer(null);
    });
});
