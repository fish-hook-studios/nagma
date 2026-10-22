import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { call, signUp, sleep, startServer, waitUntil } from "./helpers.mjs";

// Page captures sent by Nagma Capture: POST /captures with a personal access token (or a session),
// read back and deleted by their owner only, swept after their time, limited per account, counted
// in the usage stats.
const capture = (extra = {}) => ({ format: "nagma-capture", version: 1, title: "Example", url: "https://example.com/", capturedAt: new Date().toISOString(), viewport: { w: 1280, h: 800 }, scroll: { w: 1280, h: 2000 }, dpr: 2, background: "#fff", root: { box: { x: 0, y: 0, w: 1280, h: 2000 }, children: [] }, assets: {}, fonts: [], ...extra });

async function patFor(server, account, name = "Capture") {
    const r = await call(server, "POST", "/account/tokens", { token: account.token, body: { name } });
    assert.equal(r.status, 200);
    return r.body.token;
}

describe("captures", () => {
    let server, alice, bob, alicePat, bobPat;
    before(async () => {
        server = await startServer({ NAGMA_ADMINS: "boss@example.com", NAGMA_CAPTURES_PER_HOUR: "5", NAGMA_PUBLIC_URL: "https://nagma.example" });
        const r = await call(server, "POST", "/auth/signup", { body: { name: "Boss", email: "boss@example.com", password: "correct horse battery" } });
        alice = { token: r.body.token, user: r.body.user };
        bob = await signUp(server, "Bob");
        alicePat = await patFor(server, alice);
        bobPat = await patFor(server, bob);
    });
    after(async () => server?.stop());

    test("a token posts a capture: 201 with an id and the app link; stored under captures/", async () => {
        const r = await call(server, "POST", "/captures", { token: alicePat, body: capture() });
        assert.equal(r.status, 201);
        assert.match(r.body.id, /^[A-Za-z0-9_-]{16,32}$/);
        assert.equal(r.body.url, `https://nagma.example/?capture=${r.body.id}`);
        const stored = JSON.parse(await readFile(join(server.dataDir, "captures", `${r.body.id}.json`), "utf8"));
        assert.equal(stored.title, "Example");
    });

    test("a signed-in session may post too", async () => {
        const r = await call(server, "POST", "/captures", { token: bob.token, body: capture({ title: "From session" }) });
        assert.equal(r.status, 201);
        const back = await call(server, "GET", `/captures/${r.body.id}`, { token: bobPat });
        assert.equal(back.status, 200);
        assert.equal(back.body.title, "From session");
    });

    test("401 without a token or with a bad one", async () => {
        assert.equal((await call(server, "POST", "/captures", { body: capture() })).status, 401);
        assert.equal((await call(server, "POST", "/captures", { token: "nagma_pat_nope", body: capture() })).status, 401);
        assert.equal((await call(server, "GET", "/captures/AAAAAAAAAAAAAAAAAAAAAA")).status, 401);
    });

    test("400 for what isn't a capture", async () => {
        for (const body of [{ format: "something-else", version: 1, root: {} }, { format: "nagma-capture", root: {} }, { format: "nagma-capture", version: 1 }, { format: "nagma-capture", version: 1, root: [] }]) {
            assert.equal((await call(server, "POST", "/captures", { token: alicePat, body })).status, 400, JSON.stringify(body));
        }
        assert.equal((await call(server, "POST", "/captures", { token: alicePat, raw: "{not json", headers: { "content-type": "application/json" } })).status, 400);
        assert.equal((await call(server, "POST", "/captures", { token: alicePat, raw: "[1,2]", headers: { "content-type": "application/json" } })).status, 400);
    });

    test("only its owner reads or deletes it: 403 for anyone else, 404 once deleted", async () => {
        const { body } = await call(server, "POST", "/captures", { token: alicePat, body: capture() });
        assert.equal((await call(server, "GET", `/captures/${body.id}`, { token: bobPat })).status, 403);
        assert.equal((await call(server, "GET", `/captures/${body.id}`, { token: bob.token })).status, 403);
        assert.equal((await call(server, "DELETE", `/captures/${body.id}`, { token: bob.token })).status, 403);
        const got = await call(server, "GET", `/captures/${body.id}`, { token: alice.token });
        assert.equal(got.status, 200);
        assert.equal(got.body.format, "nagma-capture");
        assert.equal(got.headers.get("cache-control"), "no-store");
        assert.equal((await call(server, "DELETE", `/captures/${body.id}`, { token: alice.token })).status, 200);
        assert.equal((await call(server, "GET", `/captures/${body.id}`, { token: alice.token })).status, 404);
        await assert.rejects(readFile(join(server.dataDir, "captures", `${body.id}.json`)));
        // Odd ids are simply not found.
        assert.equal((await call(server, "GET", "/captures/..%2F..%2Fsecret", { token: alice.token })).status, 404);
    });

    test("CORS: a chrome-extension origin may send the Authorization header", async () => {
        const res = await fetch(`${server.url}/captures`, { method: "OPTIONS", headers: { origin: "chrome-extension://abcdefghijklmnop", "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type" } });
        assert.equal(res.status, 204);
        assert.equal(res.headers.get("access-control-allow-origin"), "*");
        assert.match(res.headers.get("access-control-allow-methods"), /POST/);
        assert.match(res.headers.get("access-control-allow-methods"), /DELETE/);
        assert.match(res.headers.get("access-control-allow-headers"), /authorization/);
        const r = await call(server, "POST", "/captures", { token: alicePat, body: capture(), headers: { origin: "chrome-extension://abcdefghijklmnop" } });
        assert.equal(r.headers.get("access-control-allow-origin"), "*");
    });

    test("counts captures per day in the usage stats", async () => {
        const r = await call(server, "GET", "/auth/admin/stats", { token: alice.token });
        const today = r.body.days.find((d) => d.day === r.body.today);
        // Two in the first tests, one in the owner test, one in the CORS test (the rest were refused).
        assert.equal(today.captures, 4);
    });

    test("a per-account limit an hour: 429 with Retry-After", async () => {
        // Bob has sent one; four more reach the limit of five.
        for (let i = 0; i < 4; i++) assert.equal((await call(server, "POST", "/captures", { token: bobPat, body: capture() })).status, 201);
        const r = await call(server, "POST", "/captures", { token: bobPat, body: capture() });
        assert.equal(r.status, 429);
        const wait = Number(r.headers.get("retry-after"));
        assert.ok(wait > 3000 && wait <= 3600, String(wait));
        // Another account is unaffected.
        const other = await signUp(server, "Carol");
        assert.equal((await call(server, "POST", "/captures", { token: other.token, body: capture() })).status, 201);
    });
});

describe("captures: size and expiry", () => {
    let server, account, pat;
    before(async () => {
        server = await startServer({ NAGMA_CAPTURE_TTL_MS: "600", NAGMA_CAPTURE_SWEEP_MS: "100" });
        account = await signUp(server, "Dee");
        pat = await patFor(server, account);
    });
    after(async () => server?.stop());

    test("413 over 60 MB; just under is accepted", async () => {
        const big = (bytes) => {
            const head = JSON.stringify(capture({ assets: { a: { data: "" } } }));
            const fill = "x".repeat(bytes - head.length);
            return head.replace('"data":""', `"data":"${fill}"`);
        };
        const over = await call(server, "POST", "/captures", { token: pat, raw: big(60 * 1024 * 1024 + 1024), headers: { "content-type": "application/json" } });
        assert.equal(over.status, 413);
        const under = await call(server, "POST", "/captures", { token: pat, raw: big(59 * 1024 * 1024), headers: { "content-type": "application/json" } });
        assert.equal(under.status, 201);
    });

    test("captures expire: 404 after their time, and the sweep removes the file", async () => {
        const { body } = await call(server, "POST", "/captures", { token: pat, body: capture() });
        assert.equal((await call(server, "GET", `/captures/${body.id}`, { token: pat })).status, 200);
        await sleep(700);
        assert.equal((await call(server, "GET", `/captures/${body.id}`, { token: pat })).status, 404);
        const { body: second } = await call(server, "POST", "/captures", { token: pat, body: capture() });
        await waitUntil(async () => !(await readdir(join(server.dataDir, "captures"))).includes(`${second.id}.json`), 3000, "the sweep");
        const index = JSON.parse(await readFile(join(server.dataDir, "captures", "index.json"), "utf8").catch(() => "{}"));
        assert.equal(index[second.id], undefined);
    });
});
