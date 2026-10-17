import { describe, expect, it, vi } from "vitest";

vi.mock("./doc-store", () => import("../test/memory-doc-store"));

localStorage.clear();
const servers = await import("./servers");
const { syncBase, httpBase } = await import("./server-url");
const { auth, connectToServer, signIn, signUp } = await import("./auth");
const { createFile, listFiles, getTabs, addTab } = await import("./files");
const { currentScope } = await import("./user-storage");

const TEAM = "https://team.example";
const health = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const account = (id: string) => ({ id, name: id, email: `${id}@example.com`, color: "#0D99FF", emailVerified: true });

describe("server addresses", () => {
    it("reads what people type as an origin", () => {
        expect(servers.normalizeServerUrl("nagma.example.com")).toBe("https://nagma.example.com");
        expect(servers.normalizeServerUrl("https://nagma.example.com/some/path/")).toBe("https://nagma.example.com");
        expect(servers.normalizeServerUrl("http://nagma.example.com:8080")).toBe("http://nagma.example.com:8080");
        expect(servers.normalizeServerUrl("localhost:48860")).toBe("http://localhost:48860");
        expect(servers.normalizeServerUrl("192.168.1.4:8080")).toBe("http://192.168.1.4:8080");
        expect(servers.normalizeServerUrl("wss://nagma.example.com")).toBe("https://nagma.example.com");
        expect(servers.normalizeServerUrl("")).toBeNull();
        expect(servers.normalizeServerUrl("not a server")).toBeNull();
        expect(servers.normalizeServerUrl("ftp://nagma.example.com")).toBeNull();
        expect(servers.normalizeServerUrl("javascript:alert(1)")).toBeNull();
    });
});

describe("the server registry", () => {
    it("starts on This computer: the server the app came with", () => {
        expect(servers.currentServer()).toBeNull();
        expect(syncBase()).toBe("ws://127.0.0.1:9");
        expect(httpBase()).toBe("http://127.0.0.1:9");
        expect(servers.localServerLabel()).toBe("This computer");
        expect(servers.authStorageKey()).toBe("nagma.auth.v1");
        expect(servers.scopeSuffix()).toBe("");
    });

    it("checks a server by its /health: name and version", async () => {
        vi.mocked(fetch).mockImplementationOnce(async (url) => {
            expect(String(url)).toBe(`${TEAM}/health`);
            return health({ ok: true, name: "Team server", version: "0.1.0", publicUrl: null });
        });
        expect(await servers.checkServer("team.example/")).toEqual({ origin: TEAM, name: "Team server", version: "0.1.0", publicUrl: null });
    });

    it("says why a server can't be used", async () => {
        vi.mocked(fetch).mockImplementationOnce(async () => new Response("<html>hello</html>", { status: 200 }));
        await expect(servers.checkServer("example.org")).rejects.toThrow("doesn't look like a Nagma server");
        vi.mocked(fetch).mockImplementationOnce(async () => {
            throw new TypeError("offline");
        });
        await expect(servers.checkServer("example.org")).rejects.toThrow("Couldn't reach example.org");
        await expect(servers.checkServer("   ")).rejects.toThrow("Enter the server's address");
    });

    it("an older server without a name is called by its address", async () => {
        vi.mocked(fetch).mockImplementationOnce(async () => health({ ok: true, rooms: 0 }));
        expect((await servers.checkServer("old.example")).name).toBe("old.example");
    });

    it("remembers servers for the device, once each, and only switches when asked", () => {
        servers.rememberServer({ origin: TEAM, name: "Team", version: "0.1.0" });
        servers.rememberServer({ origin: TEAM, name: "Team server", version: "0.1.1" });
        expect(servers.knownServers()).toEqual([{ origin: TEAM, name: "Team server", version: "0.1.1", publicUrl: null }]);
        expect(servers.currentServer()).toBeNull();
        const stored = JSON.parse(localStorage.getItem(servers.SERVERS_KEY) ?? "{}") as { servers: unknown[] };
        expect(stored.servers).toHaveLength(1);
    });

    it("throws away what isn't a server, and a current server that isn't on the list", () => {
        const before = localStorage.getItem(servers.SERVERS_KEY);
        localStorage.setItem(servers.SERVERS_KEY, JSON.stringify({ servers: [{ origin: "javascript:alert(1)" }, { origin: TEAM, name: "T" }, { origin: TEAM }, 5], current: "https://elsewhere.example" }));
        servers.reloadServers();
        expect(servers.knownServers().map((s) => s.origin)).toEqual([TEAM]);
        expect(servers.currentServer()).toBeNull();
        localStorage.setItem(servers.SERVERS_KEY, before ?? "");
        servers.reloadServers();
    });
});

describe("switching servers", () => {
    it("on This computer: signed in, with a draft open in a tab", async () => {
        vi.mocked(fetch).mockImplementationOnce(async (url) => {
            expect(String(url)).toBe("http://127.0.0.1:9/auth/signin");
            return new Response(JSON.stringify({ token: "local-token", user: account("localA") }), { status: 200 });
        });
        await signIn("localA@example.com", "correct horse battery");
        expect(currentScope()).toBe("localA");
        const draft = createFile("design", undefined, "Local draft");
        addTab(draft.id);
        expect(listFiles().map((f) => f.name)).toEqual(["Local draft"]);
    });

    it("another server has its own sessions, drafts and tabs, and everything talks to it", async () => {
        connectToServer(TEAM);
        expect(servers.currentServer()?.origin).toBe(TEAM);
        expect(syncBase()).toBe("wss://team.example");
        expect(httpBase()).toBe(TEAM);
        expect(auth.get().user).toBeNull();
        expect(currentScope()).toBe(`guest~${servers.serverKey(TEAM)}`);
        expect(listFiles()).toEqual([]);
        expect(getTabs()).toEqual([]);

        vi.mocked(fetch).mockImplementationOnce(async (url) => {
            expect(String(url)).toBe(`${TEAM}/auth/signup`);
            return new Response(JSON.stringify({ token: "team-token", user: account("teamA") }), { status: 200 });
        });
        await signUp("Team A", "teamA@example.com", "correct horse battery");
        expect(auth.get().user?.id).toBe("teamA");
        expect(currentScope()).toBe(`teamA~${servers.serverKey(TEAM)}`);
        expect(localStorage.getItem(`nagma.auth.v1@${TEAM}`)).toContain("team-token");
        expect(localStorage.getItem("nagma.auth.v1")).toContain("local-token");
        const shared = createFile("design", undefined, "Team file");
        addTab(shared.id);
        expect(getTabs()).toEqual([shared.id]);
    });

    it("back on This computer: the local session, drafts and tabs, none of the other server's", () => {
        connectToServer(null);
        expect(servers.currentServer()).toBeNull();
        expect(syncBase()).toBe("ws://127.0.0.1:9");
        expect(auth.get().user?.id).toBe("localA");
        expect(currentScope()).toBe("localA");
        expect(listFiles().map((f) => f.name)).toEqual(["Local draft"]);
        expect(getTabs()).toHaveLength(1);
        expect(listFiles().find((f) => f.id === getTabs()[0])?.name).toBe("Local draft");
    });

    it("and switching again brings the other server's session and tabs back", () => {
        connectToServer(TEAM);
        expect(auth.get().user?.id).toBe("teamA");
        expect(listFiles().map((f) => f.name)).toEqual(["Team file"]);
        expect(getTabs()).toHaveLength(1);
    });

    it("the open file's address is the old server's: switching drops it, unless the switch is for that link", () => {
        history.replaceState(null, "", "/?file=abcdef123&key=k&theme=dark");
        connectToServer(null);
        expect(location.search).toBe("?theme=dark");
        history.replaceState(null, "", `/?file=abcdef123&server=${encodeURIComponent(TEAM)}`);
        connectToServer(TEAM, { keepLink: true });
        expect(new URLSearchParams(location.search).get("file")).toBe("abcdef123");
        history.replaceState(null, "", "/");
    });

    it("a server in use can't be forgotten", () => {
        expect(servers.forgetServer(TEAM)).toBe(false);
        expect(servers.knownServers()).toHaveLength(1);
    });

    it("another tab switching servers is followed", () => {
        const next = JSON.stringify({ servers: servers.knownServers(), current: null });
        localStorage.setItem(servers.SERVERS_KEY, next);
        window.dispatchEvent(new StorageEvent("storage", { key: servers.SERVERS_KEY, newValue: next }));
        expect(servers.currentServer()).toBeNull();
        expect(auth.get().user?.id).toBe("localA");
        expect(currentScope()).toBe("localA");
    });
});

describe("links", () => {
    it("on This computer, links name no server", () => {
        const url = servers.withServer(new URL("http://localhost:3000/?file=abcdef&server=x"));
        expect(url.searchParams.get("server")).toBeNull();
        expect(servers.linkedServer("http://localhost:3000/?file=abcdef")).toBeNull();
    });

    it("a link to a file on another server offers it; one to the server in use doesn't", () => {
        expect(servers.linkedServer(`http://localhost:3000/?file=abcdef&server=${encodeURIComponent(TEAM)}`)).toBe(TEAM);
        expect(servers.linkedServer("http://localhost:3000/?file=abcdef&server=http%3A%2F%2F127.0.0.1%3A9")).toBeNull();
        expect(servers.linkedServer("http://localhost:3000/?file=abcdef&server=javascript%3Aalert(1)")).toBeNull();
    });

    it("on another server, links for other people point at that server and links in this app carry it", () => {
        connectToServer(TEAM);
        expect(servers.shareableUrl().origin).toBe(TEAM);
        expect(servers.withServer(new URL(`${TEAM}/?file=abcdef`)).searchParams.get("server")).toBeNull();
        expect(servers.withServer(new URL("http://127.0.0.1:47878/?file=abcdef")).searchParams.get("server")).toBe(TEAM);
        expect(servers.linkedServer(`http://localhost:3000/?file=abcdef&server=${encodeURIComponent(TEAM)}`)).toBeNull();
        // A link to This computer's server offers to switch back.
        expect(servers.linkedServer("http://localhost:3000/?file=abcdef&server=http%3A%2F%2F127.0.0.1%3A9")).toBe("http://127.0.0.1:9");
        servers.rememberServer({ origin: TEAM, name: "Team server", version: "0.1.1", publicUrl: "https://nagma.team.example/" });
        expect(servers.shareableUrl().origin).toBe("https://nagma.team.example");
        connectToServer(null);
    });
});
