// Answers a CDN (Cloudflare) or a browser may keep: the built app's files and the file list carry an
// ETag and a Cache-Control, and come back as an empty 304 when unchanged. The visitor's address
// behind a proxy or Cloudflare (NAGMA_TRUST_PROXY).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call, createFile, signUp, startServer } from "./helpers.mjs";
import { clientAddress } from "../http-cache.mjs";

describe("caching headers", () => {
    let server, staticDir;
    before(async () => {
        staticDir = await mkdtemp(join(tmpdir(), "nagma-static-"));
        await mkdir(join(staticDir, "assets"));
        await writeFile(join(staticDir, "index.html"), "<!doctype html><title>Nagma</title>");
        await writeFile(join(staticDir, "assets", "app-3f2a1b.js"), "console.log('app')");
        await writeFile(join(staticDir, "favicon.svg"), "<svg/>");
        server = await startServer({ STATIC_DIR: staticDir });
    });
    after(async () => {
        await server?.stop();
        await rm(staticDir, { recursive: true, force: true });
    });

    test("built assets (hashed names) are public and immutable, with an ETag that answers 304", async () => {
        const r = await fetch(`${server.url}/assets/app-3f2a1b.js`);
        assert.equal(r.status, 200);
        assert.equal(r.headers.get("cache-control"), "public, max-age=31536000, immutable");
        const etag = r.headers.get("etag");
        assert.match(etag, /^"[A-Za-z0-9_-]+"$/);
        const again = await fetch(`${server.url}/assets/app-3f2a1b.js`, { headers: { "if-none-match": etag } });
        assert.equal(again.status, 304);
        assert.equal(await again.text(), "");
        assert.equal(again.headers.get("etag"), etag);
        // A weak form of the same tag matches too.
        assert.equal((await fetch(`${server.url}/assets/app-3f2a1b.js`, { headers: { "if-none-match": `W/${etag}` } })).status, 304);
    });

    test("the app's page is revalidated every time (a release shows at once); other files for an hour", async () => {
        const page = await fetch(`${server.url}/some/deep/link`);
        assert.equal(page.headers.get("cache-control"), "public, no-cache");
        const etag = page.headers.get("etag");
        assert.equal((await fetch(`${server.url}/`, { headers: { "if-none-match": etag, accept: "text/html" } })).status, 304);
        const icon = await fetch(`${server.url}/favicon.svg`);
        assert.equal(icon.headers.get("cache-control"), "public, max-age=3600");
        // Changed on disk (a new release): a new tag.
        await writeFile(join(staticDir, "index.html"), "<!doctype html><title>Nagma 2</title>");
        const fresh = await fetch(`${server.url}/`, { headers: { "if-none-match": etag, accept: "text/html" } });
        assert.equal(fresh.status, 200);
        assert.notEqual(fresh.headers.get("etag"), etag);
    });

    test("the file list (with every thumbnail) is private, and unchanged lists come back as 304", async () => {
        const me = await signUp(server, "Lister");
        await createFile(server, me.token);
        const r = await call(server, "GET", "/files", { token: me.token });
        assert.equal(r.status, 200);
        assert.equal(r.headers.get("cache-control"), "private, no-cache");
        const etag = r.headers.get("etag");
        const same = await call(server, "GET", "/files", { token: me.token, headers: { "if-none-match": etag } });
        assert.equal(same.status, 304);
        await createFile(server, me.token);
        const changed = await call(server, "GET", "/files", { token: me.token, headers: { "if-none-match": etag } });
        assert.equal(changed.status, 200);
        assert.equal(changed.body.length, 2);
    });
});

describe("the visitor's address behind a proxy", () => {
    const req = (headers, remoteAddress = "10.0.0.1") => ({ headers, socket: { remoteAddress } });
    test("without NAGMA_TRUST_PROXY, forwarded headers are ignored", () => {
        assert.equal(clientAddress(req({ "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "5.6.7.8" }), {}), "10.0.0.1");
    });
    test("behind a proxy, the address it saw (the last X-Forwarded-For entry), not what the client claimed", () => {
        assert.equal(clientAddress(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), { NAGMA_TRUST_PROXY: "1" }), "203.0.113.9");
        assert.equal(clientAddress(req({ "x-forwarded-for": "203.0.113.9" }), { TRUST_PROXY: "1" }), "203.0.113.9");
        assert.equal(clientAddress(req({}), { NAGMA_TRUST_PROXY: "1" }), "10.0.0.1");
        // CF-Connecting-IP is only trusted when the server is set up for Cloudflare.
        assert.equal(clientAddress(req({ "cf-connecting-ip": "5.6.7.8" }), { NAGMA_TRUST_PROXY: "1" }), "10.0.0.1");
    });
    test("behind Cloudflare, CF-Connecting-IP", () => {
        assert.equal(clientAddress(req({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "6.6.6.6, 172.70.1.1" }), { NAGMA_TRUST_PROXY: "cloudflare" }), "198.51.100.7");
        assert.equal(clientAddress(req({}), { NAGMA_TRUST_PROXY: "cloudflare" }), "10.0.0.1");
        assert.equal(clientAddress(req({ "x-forwarded-for": "1.1.1.1" }), { NAGMA_TRUST_PROXY: "0" }), "10.0.0.1");
    });
});
