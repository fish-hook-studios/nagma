// Carrying many people per server (sync-scale.mjs, docs/load-testing.md): presence gathered and
// throttled per room and filtered by page, never echoed; rooms dropped from memory when idle and
// reloaded safely; reconnecting clients resume from their last version; at most so many editors per
// file, with promotion when a spot frees up; per-connection message limits; per-account connection
// limits; and the server surviving thousands of connections dropping at once.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { call, connect, createFile, signUp, sleep, startServer, waitUntil } from "./helpers.mjs";

const presences = (c, from = 0) => c.messages.slice(from).flatMap((m) => (m.type === "presence" ? [m.presence] : m.type === "presences" ? m.presences : []));

// A file whose link lets anyone with it edit, so guests can join with the edit key.
async function openFile(server, owner) {
    const f = await createFile(server, owner.token);
    await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { link: "edit" } });
    return f;
}

describe("presence", () => {
    let server, owner;
    before(async () => {
        server = await startServer({ NAGMA_BUSY_ROOM: "3" });
        owner = await signUp(server, "Owner");
    });
    after(async () => server?.stop());

    test("is coalesced to at most 20 updates a second per person, ends on the latest, and never echoes", async () => {
        const f = await openFile(server, owner);
        const a = await connect(server, f.id, { key: f.keys.edit, name: "A" });
        const b = await connect(server, f.id, { key: f.keys.edit, name: "B" });
        await sleep(100);
        const fromA = a.messages.length;
        const fromB = b.messages.length;
        // 200 updates in about a second.
        for (let i = 1; i <= 200; i++) {
            a.send({ type: "presence", cursor: { x: i, y: i }, selection: [], pageId: "page1" });
            await sleep(5);
        }
        await waitUntil(() => presences(b, fromB).some((p) => p.cursor?.x === 200), 3000, "the last cursor");
        const got = presences(b, fromB).filter((p) => p.userId === a.first.you);
        assert.ok(got.length <= 30, `${got.length} updates for ~1.1s of movement`);
        assert.ok(got.length >= 5);
        // Never to the sender.
        assert.equal(presences(a, fromA).filter((p) => p.userId === a.first.you).length, 0);
        await Promise.all([a.close(), b.close()]);
    });

    test("cursor moves only reach people on the same page; a page switch reaches everyone", async () => {
        const f = await openFile(server, owner);
        const a = await connect(server, f.id, { key: f.keys.edit, name: "A" });
        const b = await connect(server, f.id, { key: f.keys.edit, name: "B" });
        const c = await connect(server, f.id, { key: f.keys.edit, name: "C" });
        b.send({ type: "presence", cursor: { x: 1, y: 1 }, pageId: "page1" });
        c.send({ type: "presence", cursor: { x: 5, y: 5 }, pageId: "page2" });
        a.send({ type: "presence", cursor: { x: 0, y: 0 }, pageId: "page1" });
        await sleep(200);
        const fromB = b.messages.length;
        const fromC = c.messages.length;
        a.send({ type: "presence", cursor: { x: 42, y: 42 }, pageId: "page1" });
        await waitUntil(() => presences(b, fromB).some((p) => p.cursor?.x === 42), 2000, "B sees A's cursor");
        await sleep(150);
        assert.equal(presences(c, fromC).filter((p) => p.userId === a.first.you).length, 0, "C is on another page");
        // A moves to page 2: everyone hears (the avatar list shows where people are), and A gets
        // the people already on page 2.
        const fromA = a.messages.length;
        a.send({ type: "presence", cursor: { x: 7, y: 7 }, pageId: "page2" });
        await waitUntil(() => presences(c, fromC).some((p) => p.userId === a.first.you && p.pageId === "page2"), 2000, "C sees A arrive");
        await waitUntil(() => presences(b, fromB).some((p) => p.userId === a.first.you && p.pageId === "page2"), 2000, "B sees A leave");
        await waitUntil(() => presences(a, fromA).some((p) => p.userId === c.first.you && p.cursor?.x === 5), 2000, "A gets C's presence");
        // Then A's cursor only goes to page 2.
        await sleep(100);
        const fromB2 = b.messages.length;
        a.send({ type: "presence", cursor: { x: 99, y: 99 }, pageId: "page2" });
        await waitUntil(() => presences(c).some((p) => p.cursor?.x === 99), 2000, "C sees A's cursor");
        await sleep(150);
        assert.equal(presences(b, fromB2).length, 0);
        await Promise.all([a.close(), b.close(), c.close()]);
    });

    test("cursors and selections are passed on as plain points and ids only", async () => {
        const f = await openFile(server, owner);
        const a = await connect(server, f.id, { key: f.keys.edit });
        const b = await connect(server, f.id, { key: f.keys.edit });
        a.send({ type: "presence", cursor: { x: 3, y: 4, huge: "x".repeat(10000) }, selection: ["r1", 5, { evil: true }, "y".repeat(500)], pageId: "page1" });
        await waitUntil(() => presences(b).some((p) => p.userId === a.first.you && p.cursor), 2000, "A's cursor");
        const got = presences(b).find((p) => p.userId === a.first.you && p.cursor);
        assert.deepEqual(got.cursor, { x: 3, y: 4 });
        assert.deepEqual(got.selection, ["r1", "y".repeat(64)]);
        await Promise.all([a.close(), b.close()]);
    });

    test("rooms over the busy size slow presence to 5 a second and say so", async () => {
        const f = await openFile(server, owner);
        const cs = [];
        for (let i = 0; i < 3; i++) cs.push(await connect(server, f.id, { key: f.keys.edit }));
        assert.equal(cs[0].first.presenceHz, 20);
        const fourth = await connect(server, f.id, { key: f.keys.edit });
        assert.equal(fourth.first.presenceHz, 5);
        await cs[0].next((m) => m.type === "presence-rate" && m.hz === 5);
        await sleep(300);
        const from = cs[1].messages.length;
        for (let i = 1; i <= 100; i++) {
            cs[0].send({ type: "presence", cursor: { x: i, y: 0 } });
            await sleep(10);
        }
        await waitUntil(() => presences(cs[1], from).some((p) => p.cursor?.x === 100), 3000, "the last cursor");
        const got = presences(cs[1], from).filter((p) => p.userId === cs[0].first.you);
        assert.ok(got.length <= 9, `${got.length} updates in ~1.2s at 5/s`);
        // Back under the size: 20 again.
        await fourth.close();
        await cs[0].next((m) => m.type === "presence-rate" && m.hz === 20);
        await Promise.all(cs.map((c) => c.close()));
    });

    test("leaving at the same moment is announced in one message", async () => {
        const f = await openFile(server, owner);
        const watcher = await connect(server, f.id, { key: f.keys.edit });
        const others = [];
        for (let i = 0; i < 5; i++) others.push(await connect(server, f.id, { key: f.keys.edit }));
        const from = watcher.messages.length;
        for (const o of others) o.ws.terminate();
        await waitUntil(() => watcher.messages.slice(from).filter((m) => m.type === "leave").flatMap((m) => m.userIds ?? [m.userId]).length === 5, 3000, "five leaves");
        assert.ok(watcher.messages.slice(from).filter((m) => m.type === "leave").length < 5);
        await watcher.close();
    });
});

describe("rooms in memory", () => {
    let server, owner;
    before(async () => {
        server = await startServer({ NAGMA_ROOM_IDLE_MS: "300", NAGMA_HEALTH_STATS: "1", NAGMA_ROOM_OPS: "5" });
        owner = await signUp(server, "Owner");
    });
    after(async () => server?.stop());

    test("an idle room leaves memory after its file is written, and reloads with its version on the next join", async () => {
        const f = await openFile(server, owner);
        const a = await connect(server, f.id, { key: f.keys.edit, clientId: "evictclient1" });
        for (let i = 0; i < 3; i++) a.send({ type: "patch", id: `e${i}`, patch: { nodes: { rect1: { x: 100 + i } } } });
        await a.next((m) => m.type === "patch" && m.id === "e2");
        const version = a.messages.filter((m) => m.type === "patch").at(-1).version;
        await a.close();
        await waitUntil(async () => (await call(server, "GET", "/health")).body.rooms === 0, 5000, "room evicted");
        // Resuming from the version it had: nothing missed, and no document resent.
        const b = await connect(server, f.id, { key: f.keys.edit, hello: false });
        b.send({ type: "hello", user: { name: "B", color: "#0D99FF" }, key: f.keys.edit, since: version });
        const snap = await b.next("snapshot");
        assert.equal(snap.resume, true);
        assert.deepEqual(snap.ops, []);
        assert.equal(snap.doc, undefined);
        assert.equal(snap.version, version);
        // A whole snapshot has the edits.
        const c = await connect(server, f.id, { key: f.keys.edit });
        assert.equal(c.first.doc.nodes.rect1.x, 102);
        assert.equal(c.first.version, version);
        await Promise.all([b.close(), c.close()]);
    });

    test("a reconnecting client gets only what it missed, and its own edits the server already had are acknowledged, not applied twice", async () => {
        const f = await openFile(server, owner);
        const a = await connect(server, f.id, { key: f.keys.edit, clientId: "resumeclientA" });
        const b = await connect(server, f.id, { key: f.keys.edit, clientId: "resumeclientB" });
        b.send({ type: "patch", id: "bmine", patch: { nodes: { rect1: { y: 5 } } } });
        const mine = await b.next((m) => m.type === "patch" && m.id === "bmine");
        const since = mine.version - 1;
        b.ws.terminate();
        for (let i = 0; i < 2; i++) a.send({ type: "patch", id: `a${i}`, patch: { nodes: { rect1: { x: i } } } });
        await a.next((m) => m.type === "patch" && m.id === "a1");
        // B comes back thinking it only has `since`, with "bmine" still unconfirmed.
        const b2 = await connect(server, f.id, { key: f.keys.edit, hello: false });
        b2.send({ type: "hello", user: { name: "B", color: "#0D99FF" }, key: f.keys.edit, clientId: "resumeclientB", since });
        const snap = await b2.next("snapshot");
        assert.equal(snap.resume, true);
        assert.deepEqual(snap.ops.map((o) => o.id), ["bmine", "a0", "a1"]);
        const from = a.messages.length;
        b2.send({ type: "patch", id: "bmine", patch: { nodes: { rect1: { y: 5 } } } });
        const ack = await b2.next("ack");
        assert.equal(ack.id, "bmine");
        assert.equal(ack.version, mine.version);
        await sleep(100);
        assert.equal(a.messages.slice(from).filter((m) => m.type === "patch").length, 0, "not applied again");
        // Further back than the ring keeps (NAGMA_ROOM_OPS=5, trimmed in batches): the whole file.
        for (let i = 0; i < 20; i++) a.send({ type: "patch", id: `more${i}`, patch: { nodes: { rect1: { w: i } } } });
        await a.next((m) => m.type === "patch" && m.id === "more19");
        const c = await connect(server, f.id, { key: f.keys.edit, hello: false });
        c.send({ type: "hello", user: { name: "C", color: "#0D99FF" }, key: f.keys.edit, since });
        const full = await c.next("snapshot");
        assert.equal(full.resume, undefined);
        assert.equal(full.doc.nodes.rect1.w, 19);
        await Promise.all([a.close(), b2.close(), c.close()]);
    });

    test("restoring a version means reconnecting clients need the whole file", async () => {
        const f = await openFile(server, owner);
        const a = await connect(server, f.id, { token: owner.token });
        a.send({ type: "patch", id: "p1", patch: { nodes: { rect1: { x: 1 } } } });
        const p = await a.next((m) => m.type === "patch" && m.id === "p1");
        a.send({ type: "version.save", name: "One" });
        const versions = await a.next((m) => m.type === "versions" && m.versions.some((v) => v.name === "One"));
        a.send({ type: "version.restore", id: versions.versions.find((v) => v.name === "One").id });
        await a.next("reset");
        const b = await connect(server, f.id, { key: f.keys.edit, hello: false });
        b.send({ type: "hello", user: { name: "B", color: "#0D99FF" }, key: f.keys.edit, since: p.version });
        const snap = await b.next("snapshot");
        assert.equal(snap.resume, undefined);
        assert.ok(snap.doc);
        await Promise.all([a.close(), b.close()]);
    });

    test("/health shows process and room statistics only when asked for (NAGMA_HEALTH_STATS) or to an admin", async () => {
        const r = await call(server, "GET", "/health");
        assert.equal(typeof r.body.stats.rss, "number");
        assert.equal(typeof r.body.stats.cpu.user, "number");
        assert.equal(typeof r.body.stats.eventLoop.p99, "number");
        assert.equal(r.body.stats.limits.roomIdleMs, 300);
        const plain = await startServer();
        try {
            assert.equal((await call(plain, "GET", "/health")).body.stats, undefined);
            const admin = await signUp(plain, "First account (admin)");
            const other = await signUp(plain, "Someone");
            assert.equal((await call(plain, "GET", "/health", { token: other.token })).body.stats, undefined);
            assert.equal(typeof (await call(plain, "GET", "/health", { token: admin.token })).body.stats.connections, "number");
        } finally {
            await plain.stop();
        }
    });
});

describe("editors per file", () => {
    let server, owner;
    before(async () => {
        server = await startServer({ NAGMA_ROOM_EDITORS: "2" });
        owner = await signUp(server, "Owner");
    });
    after(async () => server?.stop());

    test("past the cap people join as viewers, are told why, and are promoted in order when a spot frees up", async () => {
        const f = await openFile(server, owner);
        const a = await connect(server, f.id, { key: f.keys.edit });
        const b = await connect(server, f.id, { key: f.keys.edit });
        const c = await connect(server, f.id, { key: f.keys.edit });
        const d = await connect(server, f.id, { key: f.keys.edit });
        const v = await connect(server, f.id, { key: f.keys.view });
        assert.equal(a.first.role, "edit");
        assert.equal(b.first.role, "edit");
        assert.equal(c.first.role, "view");
        assert.equal(c.first.capped, true);
        assert.match(c.first.cappedText, /2 people are editing/);
        assert.equal(c.first.keys, undefined);
        assert.equal(d.first.role, "view");
        assert.equal(v.first.capped, undefined);
        // Their edits wait (the client keeps them) rather than being dropped as view-only.
        c.send({ type: "patch", id: "c1", patch: { nodes: { rect1: { x: 9 } } } });
        const rejected = await c.next("rejected");
        assert.equal(rejected.reason, "editors-full");
        // An editor leaves: the first one waiting can edit.
        await a.close();
        const role = await c.next("role");
        assert.equal(role.role, "edit");
        assert.ok(role.keys?.edit);
        c.send({ type: "patch", id: "c2", patch: { nodes: { rect1: { x: 10 } } } });
        await b.next((m) => m.type === "patch" && m.id === "c2");
        await sleep(100);
        assert.equal(d.messages.some((m) => m.type === "role"), false);
        // A viewer leaving frees nothing; another editor leaving promotes the next.
        await v.close();
        await b.close();
        assert.equal((await d.next("role")).role, "edit");
        await Promise.all([c.close(), d.close()]);
    });
});

describe("per-connection limits", () => {
    let server, owner;
    before(async () => {
        server = await startServer({ NAGMA_WS_PER_SECOND: "10", NAGMA_WS_PER_ACCOUNT: "2" });
        owner = await signUp(server, "Owner");
    });
    after(async () => server?.stop());

    test("patches over the per-second limit wait in line with a 429 message, and all land in order", async () => {
        const f = await openFile(server, owner);
        const a = await connect(server, f.id, { key: f.keys.edit });
        const started = Date.now();
        for (let i = 0; i < 30; i++) a.send({ type: "patch", id: `r${i}`, patch: { nodes: { rect1: { x: i } } } });
        const limited = await a.next("rate-limited");
        assert.equal(limited.code, 429);
        assert.equal(limited.limit, 10);
        await a.next((m) => m.type === "patch" && m.id === "r29", { timeout: 5000 });
        // Ten at once, then ten a second.
        assert.ok(Date.now() - started >= 1500, `took ${Date.now() - started} ms`);
        assert.deepEqual(a.messages.filter((m) => m.type === "patch").map((m) => m.id), Array.from({ length: 30 }, (_, i) => `r${i}`));
        await a.close();
    });

    test("presence doesn't count against the limit", async () => {
        const f = await openFile(server, owner);
        const a = await connect(server, f.id, { key: f.keys.edit });
        for (let i = 0; i < 40; i++) a.send({ type: "presence", cursor: { x: i, y: 0 } });
        a.send({ type: "patch", id: "after", patch: { nodes: { rect1: { x: 1 } } } });
        await a.next((m) => m.type === "patch" && m.id === "after", { timeout: 500 });
        assert.equal(a.messages.some((m) => m.type === "rate-limited"), false);
        await a.close();
    });

    test("a flood (more than five seconds' worth waiting) closes the connection", async () => {
        const f = await openFile(server, owner);
        const a = await connect(server, f.id, { key: f.keys.edit });
        for (let i = 0; i < 80; i++) a.send({ type: "patch", id: `f${i}`, patch: { nodes: { rect1: { x: i } } } });
        const closed = await a.waitClosed(3000);
        assert.equal(closed.code, 4013);
        // The server is fine.
        const b = await connect(server, f.id, { key: f.keys.edit });
        assert.equal(b.first.type, "snapshot");
        await b.close();
    });

    test("an account may have NAGMA_WS_PER_ACCOUNT connections open; the next is refused until one closes", async () => {
        const f = await openFile(server, owner);
        const someone = await signUp(server, "Many tabs");
        const one = await connect(server, f.id, { token: someone.token, key: f.keys.edit });
        const two = await connect(server, f.id, { token: someone.token, key: f.keys.edit });
        assert.equal(two.first.type, "snapshot");
        const three = await connect(server, f.id, { token: someone.token, key: f.keys.edit, hello: false });
        three.send({ type: "hello", user: { name: "x", color: "#0D99FF" }, token: someone.token, key: f.keys.edit });
        const closed = await three.waitClosed();
        assert.equal(closed.code, 4029);
        assert.ok(three.messages.some((m) => m.type === "notice" && /2 connections open/.test(m.text)));
        // Guests and other accounts aren't affected.
        const guest = await connect(server, f.id, { key: f.keys.edit });
        assert.equal(guest.first.type, "snapshot");
        await one.close();
        await sleep(50);
        const four = await connect(server, f.id, { token: someone.token, key: f.keys.edit });
        assert.equal(four.first.type, "snapshot");
        await Promise.all([two.close(), four.close(), guest.close()]);
    });
});

describe("thousands of connections dropping at once", () => {
    let server, owner;
    const COUNT = Number(process.env.NAGMA_TEST_DROP_CONNECTIONS ?? 3000);
    before(async () => {
        server = await startServer({ NAGMA_ROOM_IDLE_MS: "500", NAGMA_HEALTH_STATS: "1" });
        owner = await signUp(server, "Owner");
    });
    after(async () => server?.stop());

    test(`the server survives ${COUNT} sockets vanishing together and keeps working`, { timeout: 120_000 }, async () => {
        const { WebSocket } = await import("ws");
        const files = [];
        for (let i = 0; i < 30; i++) files.push(await openFile(server, owner));
        const sockets = [];
        let joined = 0;
        // Opened in batches, each saying hello and moving its cursor once.
        for (let start = 0; start < COUNT; start += 250) {
            await Promise.all(
                Array.from({ length: Math.min(250, COUNT - start) }, (_, k) => {
                    const i = start + k;
                    const f = files[i % files.length];
                    return new Promise((resolve, reject) => {
                        const ws = new WebSocket(`${server.wsUrl}/files/${f.id}`);
                        sockets.push(ws);
                        ws.on("error", reject);
                        ws.on("open", () => ws.send(JSON.stringify({ type: "hello", user: { name: `p${i}`, color: "#0D99FF" }, key: f.keys.edit })));
                        ws.on("message", (raw) => {
                            if (!String(raw).startsWith('{"type":"snapshot"')) return;
                            joined++;
                            ws.send(JSON.stringify({ type: "presence", cursor: { x: i, y: i }, pageId: "page1" }));
                            resolve();
                        });
                    });
                }),
            );
        }
        assert.equal(joined, COUNT);
        const before = (await call(server, "GET", "/health")).body.stats;
        assert.equal(before.connections, COUNT);
        // Everyone gone in the same instant, without a close handshake.
        for (const ws of sockets) ws.terminate();
        const t0 = Date.now();
        const h = await call(server, "GET", "/health");
        assert.equal(h.status, 200);
        assert.ok(Date.now() - t0 < 5000);
        await waitUntil(async () => (await call(server, "GET", "/health")).body.stats.connections === 0, 20_000, "sockets closed");
        // Rooms empty out of memory, and the files still open and take edits.
        await waitUntil(async () => (await call(server, "GET", "/health")).body.rooms === 0, 20_000, "rooms evicted");
        const c = await connect(server, files[0].id, { key: files[0].keys.edit });
        c.send({ type: "patch", id: "after", patch: { nodes: { rect1: { x: 1 } } } });
        await c.next((m) => m.type === "patch" && m.id === "after");
        await c.close();
        assert.ok(server.alive());
    });
});
