// Regression tests from the Campaign, Sites and Make QA pass (apps/web/qa/QA-campaign-sites-make.md):
// who may publish sites, where redirects may lead, and where single sign-on may send a session.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { safeReturnUrl } from "../saml.mjs";
import { call, createFile, signUp, startServer } from "./helpers.mjs";

const b64 = (s) => Buffer.from(s).toString("base64");

describe("site publishing needs an account", () => {
    let server, owner, outsider, site;
    before(async () => {
        server = await startServer();
        owner = await signUp(server, "Site Owner");
        outsider = await signUp(server, "Outsider");
        site = await createFile(server, owner.token, { doc: { name: "Site", roots: [], nodes: {}, site: { pages: [] } } });
        await call(server, "PUT", `/files/${site.id}/access`, { token: owner.token, body: { link: "edit" } });
    });
    after(async () => server?.stop());

    test("the edit link alone can't publish, unpublish or change the address", async () => {
        const files = [{ path: "index.html", data: b64("<h1>Owner's page</h1>") }];
        assert.equal((await call(server, "POST", `/files/${site.id}/site?key=${site.keys.edit}`, { body: { files: [{ path: "index.html", data: b64("<h1>Phish</h1>") }] } })).status, 401);
        assert.equal((await call(server, "POST", `/files/${site.id}/site`, { token: owner.token, body: { files } })).status, 200);
        assert.equal((await call(server, "DELETE", `/files/${site.id}/site?key=${site.keys.edit}`)).status, 401);
        for (const body of [{ slug: "anon-name" }, { access: "public" }, { domain: "www.example.com" }]) {
            assert.equal((await call(server, "PUT", `/files/${site.id}/site/settings?key=${site.keys.edit}`, { body })).status, 401, JSON.stringify(body));
        }
        assert.equal((await call(server, "POST", `/files/${site.id}/site/verify?key=${site.keys.edit}`)).status, 401);
        // Still published, under the owner's name, and the status stays readable with the link.
        const status = await call(server, "GET", `/files/${site.id}/site?key=${site.keys.edit}`);
        assert.equal(status.status, 200);
        assert.equal(status.body.published, true);
        assert.equal(status.body.by, "Site Owner");
        assert.equal(status.body.slug, null);
        // Someone without access is still refused outright, signed in or not.
        assert.equal((await call(server, "DELETE", `/files/${site.id}/site`, { token: outsider.token })).status, 403);
        assert.equal((await call(server, "PUT", `/files/${site.id}/site/settings`, { token: outsider.token, body: { slug: "taken-over" } })).status, 403);
        // A signed-in editor through the link may.
        assert.equal((await call(server, "PUT", `/files/${site.id}/site/settings?key=${site.keys.edit}`, { token: outsider.token, body: { slug: "linked-editor" } })).status, 200);
    });

    test("folder redirects keep to this server", async () => {
        const files = [
            { path: "index.html", data: b64("<h1>Home</h1>") },
            { path: "about/index.html", data: b64("<h1>About</h1>") },
        ];
        assert.equal((await call(server, "POST", `/files/${site.id}/site`, { token: owner.token, body: { files } })).status, 200);
        const r = await call(server, "GET", `/sites/${site.id}/about`);
        assert.equal(r.status, 301);
        assert.equal(r.headers.get("location"), `/sites/${site.id}/about/`);
        // At its own host name, "//evil.example/x" is read as a path on this site, never sent on.
        assert.equal((await call(server, "PUT", `/files/${site.id}/site/settings`, { token: owner.token, body: { slug: "redirect-check" } })).status, 200);
        const raw = await new Promise((resolve, reject) => {
            const req = request({ host: "127.0.0.1", port: server.port, path: "//evil.example/about", headers: { host: "redirect-check.localhost" } }, (res) => {
                res.resume();
                resolve({ status: res.statusCode, location: res.headers.location });
            });
            req.on("error", reject);
            req.end();
        });
        assert.ok(!raw.location || /^\/(?!\/)/.test(raw.location), String(raw.location));
    });
});

describe("single sign-on return addresses", () => {
    const origins = ["http://nagma.example:8787", "https://app.nagma.example"];

    test("paths on this server and the app's own addresses are kept", () => {
        assert.equal(safeReturnUrl("/files?x=1", origins), "/files?x=1");
        assert.equal(safeReturnUrl("https://app.nagma.example/?file=abc", origins), "https://app.nagma.example/?file=abc");
        assert.equal(safeReturnUrl("http://nagma.example:8787/home", origins), "http://nagma.example:8787/home");
        // A dev server on another port, when the sync server itself is on this machine.
        assert.equal(safeReturnUrl("http://localhost:5173/?file=1", origins, true), "http://localhost:5173/?file=1");
    });

    test("another site, or a trick spelling of one, falls back to /", () => {
        for (const bad of [
            "https://evil.example/",
            "https://app.nagma.example.evil.example/",
            "https://app.nagma.example@evil.example/",
            "https://user:pass@app.nagma.example/",
            "//evil.example/",
            "/\\evil.example",
            "javascript:alert(1)",
            "data:text/html,hi",
            "http://localhost:5173/",
            "",
            "evil.example",
        ]) {
            assert.equal(safeReturnUrl(bad, origins), "/", bad);
        }
        // Loopback addresses only count when the server was reached on one.
        assert.equal(safeReturnUrl("http://127.0.0.1:9999/", origins, false), "/");
    });
});

describe("Make's app data store", () => {
    let server, maker, other;
    before(async () => {
        server = await startServer();
        maker = await signUp(server, "Maker");
        other = await signUp(server, "Other");
    });
    after(async () => server?.stop());

    test("registering needs an account and keeps the store its owner's", async () => {
        assert.equal((await call(server, "POST", "/ai/make/backend", { body: { appId: "qaStore001" } })).status, 401);
        assert.equal((await call(server, "POST", "/ai/make/backend", { token: maker.token, body: { appId: "qaStore001" } })).status, 200);
        assert.equal((await call(server, "POST", "/ai/make/backend", { token: other.token, body: { appId: "qaStore001" } })).status, 403);
    });

    test("items: ids are the server's, an oversized item says so, prototype names aren't collections", async () => {
        const add = await call(server, "POST", "/app-data/qaStore001/posts", { body: { title: "<b>hi</b>", id: "forced" } });
        assert.equal(add.status, 200);
        assert.notEqual(add.body.id, "forced");
        const big = await call(server, "POST", "/app-data/qaStore001/posts", { body: { text: "x".repeat(70 * 1024) } });
        assert.equal(big.status, 413);
        assert.match(big.body.error, /64 KB/);
        for (const name of ["__proto__", "constructor", "toString"]) assert.equal((await call(server, "GET", `/app-data/qaStore001/${name}`)).status, 400, name);
        assert.equal((await call(server, "GET", "/app-data/qaStore001/posts")).body.length, 1);
    });
});

describe("saving files", () => {
    test("overlapping writes to one path land in order and never reject for a missing temp file", async () => {
        const { writeAtomic } = await import("../atomic-write.mjs");
        const { mkdtemp, readFile, readdir, rm } = await import("node:fs/promises");
        const { tmpdir } = await import("node:os");
        const { join } = await import("node:path");
        const dir = await mkdtemp(join(tmpdir(), "nagma-atomic-"));
        const path = join(dir, "room.json");
        // Big enough that the writes overlap, as a large file's batched saves did.
        const big = (n) => JSON.stringify({ n, pad: "x".repeat(4 * 1024 * 1024) });
        await Promise.all(Array.from({ length: 6 }, (_, n) => writeAtomic(path, big(n))));
        assert.equal(JSON.parse(await readFile(path, "utf8")).n, 5);
        assert.deepEqual((await readdir(dir)).filter((f) => f.endsWith(".tmp")), []);
        await rm(dir, { recursive: true, force: true });
    });
});
