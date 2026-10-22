// Sending a capture through a Nagma server (src/send.ts), with fetch stubbed:
//   cd apps/browser-extension && npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_UPLOAD, SendError, sendThroughServer } from "../src/send.ts";

const body = JSON.stringify({ format: "nagma-capture", version: 1, title: "Pricing" });

// A fetch that answers once and remembers what it was asked.
function stub(status, json, calls = []) {
    const fn = async (url, init) => {
        calls.push({ url, init });
        return new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
    };
    return Object.assign(fn, { calls });
}

test("posts the capture to <address>/captures with the token, and opens the address it answers with", async () => {
    const fetcher = stub(201, { id: "c_123", url: "https://nagma.example.com/?capture=c_123" });
    const sent = await sendThroughServer(body, "https://nagma.example.com/", " tok_abc ", fetcher);
    assert.deepEqual(sent, { id: "c_123", url: "https://nagma.example.com/?capture=c_123" });
    const [{ url, init }] = fetcher.calls;
    assert.equal(url, "https://nagma.example.com/captures");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer tok_abc");
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.equal(init.body, body);
    assert.equal(init.credentials, "omit");
});

test("makes the address itself when the server gives none, and won't follow one to another origin", async () => {
    assert.equal((await sendThroughServer(body, "http://localhost:5310", "t", stub(201, { id: "c 1" }))).url, "http://localhost:5310/?capture=c%201");
    assert.equal((await sendThroughServer(body, "http://localhost:5310", "t", stub(201, { id: "c2", url: "https://evil.example/?capture=c2" }))).url, "http://localhost:5310/?capture=c2");
    assert.equal((await sendThroughServer(body, "http://localhost:5310", "t", stub(201, { id: "c3", url: "/?capture=c3" }))).url, "http://localhost:5310/?capture=c3");
});

test("says plainly what went wrong: no token, a bad token, too large, unreachable, an old server", async () => {
    const fails = async (promise, status, pattern) => {
        await assert.rejects(promise, (e) => e instanceof SendError && e.status === status && pattern.test(e.message));
    };
    const untouched = stub(201, { id: "x" });
    await fails(sendThroughServer(body, "https://n.example", "  ", untouched), null, /personal access token/);
    assert.equal(untouched.calls.length, 0);
    await fails(sendThroughServer(body, "https://n.example", "bad", stub(401, { error: "unauthorized" })), 401, /didn't accept the token/);
    await fails(sendThroughServer(body, "https://n.example", "t", stub(413)), 413, /too large/);
    await fails(sendThroughServer(body, "https://n.example", "t", stub(404)), 404, /doesn't take captures yet/);
    await fails(sendThroughServer(body, "https://n.example", "t", stub(500)), 500, /answered 500/);
    await fails(sendThroughServer(body, "https://n.example", "t", stub(201, { nope: true })), 201, /no capture/);
    await fails(sendThroughServer(body, "https://n.example", "t", async () => { throw new TypeError("Failed to fetch"); }), null, /Couldn't reach https:\/\/n.example/);
});

test("doesn't send a capture over the server's 60 MB limit", async () => {
    const fetcher = stub(201, { id: "x" });
    await assert.rejects(sendThroughServer("x".repeat(MAX_UPLOAD + 1), "https://n.example", "t", fetcher), (e) => e.status === 413);
    assert.equal(fetcher.calls.length, 0);
});
