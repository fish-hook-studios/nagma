import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contentHash, forgetMediaUrls, loadMedia, mediaReadUrl, onMediaError, retryUploads, sendMedia, setMediaContext, storeMedia } from "./media";

// The media client against a stubbed server and object store: which way an upload goes (straight
// to the bucket, through the server, not at all), the content hash it sends, the read addresses it
// keeps until they're about to expire, and the messages people see when a limit is reached.

const BASE = "http://127.0.0.1:9";
const BUCKET = "https://bucket.example";
type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
let calls: Call[];
let routes: (call: Call) => Response | Promise<Response>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
    calls = [];
    forgetMediaUrls();
    vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
        const call: Call = { method: init.method ?? "GET", url: String(input), headers: (init.headers ?? {}) as Record<string, string>, body: init.body };
        calls.push(call);
        return routes(call);
    });
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", async () => {
        throw new TypeError("fetch is disabled in tests");
    });
    vi.useRealTimers();
});

const picture = () => new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: "image/png" });
const path = (c: Call) => c.url.replace(BASE, "").split("?")[0];

describe("uploads", () => {
    it("goes straight to the bucket when the server hands out a presigned address, then completes", async () => {
        routes = (c) => {
            if (path(c) === "/media/direct00001/upload") return json({ mode: "direct", url: `${BUCKET}/nagma/direct00001?X-Amz-Signature=abc`, headers: { "content-type": "image/png" }, expires: Date.now() + 600_000 });
            if (c.url.startsWith(BUCKET)) return new Response(null, { status: 200 });
            if (path(c) === "/media/direct00001/complete") return json({ ok: true, size: 7 });
            return json({ error: "unexpected" }, 500);
        };
        expect(await sendMedia("direct00001", picture(), "file000001")).toBe("direct");
        expect(calls.map((c) => `${c.method} ${c.url.startsWith(BUCKET) ? "bucket" : path(c)}`)).toEqual(["POST /media/direct00001/upload", "PUT bucket", "POST /media/direct00001/complete"]);
        const asked = JSON.parse(String(calls[0].body));
        expect(asked).toMatchObject({ type: "image/png", size: 7 });
        expect(asked.sha256).toBe(await contentHash(picture()));
        expect(calls[0].url).toContain("file=file000001");
        // The bytes went to the bucket with the signed type and nothing else of ours (no session).
        expect(calls[1].body).toBeInstanceOf(Blob);
        expect(calls[1].headers).toEqual({ "content-type": "image/png" });
        expect(JSON.parse(String(calls[2].body)).sha256).toBe(asked.sha256);
    });

    it("sends the bytes to the server when it keeps media itself", async () => {
        routes = (c) => (path(c) === "/media/server0001/upload" ? json({ mode: "server" }) : c.method === "PUT" ? json({ ok: true, size: 7 }) : json({}, 500));
        expect(await sendMedia("server0001", picture(), "file000001")).toBe("server");
        expect(calls.map((c) => `${c.method} ${path(c)}`)).toEqual(["POST /media/server0001/upload", "PUT /media/server0001"]);
        expect(calls[1].headers["content-type"]).toBe("image/png");
    });

    it("sends nothing when the server has the same bytes already", async () => {
        routes = () => json({ mode: "exists", size: 7, deduped: true });
        expect(await sendMedia("dedupe0001", picture(), "file000001")).toBe("exists");
        expect(calls).toHaveLength(1);
    });

    it("falls back to PUT on a server from before the upload question", async () => {
        routes = (c) => (c.method === "POST" ? new Response("", { status: 405 }) : json({ ok: true, size: 7 }));
        expect(await sendMedia("oldserver1", picture(), "file000001")).toBe("server");
        expect(calls.map((c) => c.method)).toEqual(["POST", "PUT"]);
    });

    it("the same bytes hash the same", async () => {
        const a = await contentHash(picture());
        expect(a).toMatch(/^[0-9a-f]{64}$/);
        expect(await contentHash(picture())).toBe(a);
        expect(await contentHash(new Blob(["other"]))).not.toBe(a);
    });

    it("says why when a limit is reached, and doesn't keep retrying a file that's too large", async () => {
        const heard: string[] = [];
        const off = onMediaError((m) => heard.push(m));
        setMediaContext("file000002", null);
        routes = () => json({ error: "This file has reached its media limit (2048 MB). Put new images and videos in another file." }, 413);
        await storeMedia("toolarge01", picture()).catch(() => undefined);
        await vi.waitFor(() => expect(heard).toHaveLength(1));
        expect(heard[0]).toMatch(/media limit/);
        calls = [];
        await retryUploads();
        expect(calls.filter((c) => path(c) === "/media/toolarge01/upload")).toHaveLength(0);
        // A rate limit is said too, and tried again later.
        routes = () => json({ error: "You've reached this server's upload limit (600 uploads an hour). Try again in 12 minutes." }, 429);
        await storeMedia("ratelimit1", picture()).catch(() => undefined);
        await vi.waitFor(() => expect(heard).toHaveLength(2));
        expect(heard[1]).toMatch(/upload limit/);
        routes = (c) => (c.method === "POST" ? json({ mode: "exists" }) : json({}, 500));
        calls = [];
        await retryUploads();
        expect(calls.map((c) => path(c))).toEqual(["/media/ratelimit1/upload"]);
        // Not being able to upload yet (the file isn't on the server) stays quiet.
        routes = () => json({ error: "Only people who can edit the file can add media to it." }, 403);
        await storeMedia("notyet0001", picture()).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 20));
        expect(heard).toHaveLength(2);
        off();
        setMediaContext(null, null);
    });
});

describe("reads", () => {
    it("loads through a short-lived address, kept until shortly before it expires", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-19T10:00:00Z"));
        let n = 0;
        routes = (c) => {
            if (path(c) === "/media/cached0001/url") return json({ url: `${BUCKET}/nagma/cached0001?X-Amz-Signature=${++n}`, expires: Date.now() + 10 * 60_000 });
            if (c.url.startsWith(BUCKET)) return new Response("pixels", { headers: { "content-type": "image/png" } });
            return json({}, 500);
        };
        const first = await mediaReadUrl("cached0001");
        expect(first).toBe(`${BUCKET}/nagma/cached0001?X-Amz-Signature=1`);
        vi.setSystemTime(new Date("2026-10-19T10:08:00Z"));
        expect(await mediaReadUrl("cached0001")).toBe(first);
        expect(calls.filter((c) => path(c).endsWith("/url"))).toHaveLength(1);
        // Within a minute of expiring: a fresh one.
        vi.setSystemTime(new Date("2026-10-19T10:09:30Z"));
        expect(await mediaReadUrl("cached0001")).toBe(`${BUCKET}/nagma/cached0001?X-Amz-Signature=2`);
        // Asked for together, fetched once.
        forgetMediaUrls();
        calls = [];
        await Promise.all([mediaReadUrl("cached0001"), mediaReadUrl("cached0001"), mediaReadUrl("cached0001")]);
        expect(calls).toHaveLength(1);
        // The bytes come from the bucket, without the session.
        const blob = await loadMedia("cached0001");
        expect(await blob?.text()).toBe("pixels");
        const read = calls.find((c) => c.url.startsWith(BUCKET));
        expect(read?.headers).toEqual({});
    });

    it("a server's own signed address is made absolute", async () => {
        routes = (c) => (path(c).endsWith("/url") ? json({ url: "/media/localread1?exp=1&sig=x", expires: Date.now() + 600_000 }) : new Response("b"));
        expect(await mediaReadUrl("localread1")).toBe(`${BASE}/media/localread1?exp=1&sig=x`);
    });

    it("an address that stopped working is replaced once", async () => {
        let n = 0;
        routes = (c) => {
            if (path(c).endsWith("/url")) return json({ url: `${BUCKET}/x?try=${++n}`, expires: Date.now() + 600_000 });
            return c.url.endsWith("try=1") ? new Response("expired", { status: 403 }) : new Response("ok");
        };
        const blob = await loadMedia("stale00001");
        expect(await blob?.text()).toBe("ok");
        expect(calls.filter((c) => path(c).endsWith("/url"))).toHaveLength(2);
    });

    it("no access: nothing, and no address", async () => {
        routes = () => json({ error: "No access to that media." }, 403);
        expect(await mediaReadUrl("noaccess01")).toBeNull();
        expect(await loadMedia("noaccess01")).toBeNull();
        expect(calls.some((c) => c.url.startsWith(BUCKET))).toBe(false);
    });
});
