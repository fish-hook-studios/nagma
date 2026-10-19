// Room workers (NAGMA_WORKERS > 1, room-workers.mjs): the live-sync suites run again against a
// server with two room workers, plus what only workers have: a worker that dies and comes back,
// rooms spread over workers, and /health adding up every process.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { call, connect, createFile, sampleDoc, signUp, sleep, startServer, waitUntil } from "./helpers.mjs";
import { workerFor } from "../room-workers.mjs";
import { websocketSync } from "./ws-sync.test.mjs";
import { syncScale } from "./sync-scale.test.mjs";

const WORKERS = { NAGMA_WORKERS: "2" };

websocketSync(WORKERS, " (2 room workers)");
syncScale(WORKERS, " (2 room workers)");

describe("room workers", () => {
    let server, owner;
    before(async () => {
        server = await startServer({ ...WORKERS, NAGMA_HEALTH_STATS: "1" });
        owner = await signUp(server, "Owner");
    });
    after(async () => server?.stop());

    const health = async () => (await call(server, "GET", "/health")).body.stats;
    // Files until there is one in each worker.
    async function filesOnEachWorker() {
        const found = new Map();
        for (let i = 0; i < 40 && found.size < 2; i++) {
            const f = await createFile(server, owner.token, { doc: sampleDoc(`Spread ${i}`) });
            await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { link: "edit" } });
            if (!found.has(workerFor(f.id, 2))) found.set(workerFor(f.id, 2), f);
        }
        assert.equal(found.size, 2, "files on both workers");
        return [found.get(0), found.get(1)];
    }

    test("rooms are spread over the workers, and /health adds up every process", async () => {
        const [f0, f1] = await filesOnEachWorker();
        const a = await connect(server, f0.id, { key: f0.keys.edit });
        const b = await connect(server, f0.id, { key: f0.keys.edit });
        const c = await connect(server, f1.id, { key: f1.keys.edit });
        const s = await health();
        assert.equal(s.workers, 2);
        assert.equal(s.processes.length, 3);
        assert.equal(s.processes[0].role, "main");
        const [w0, w1] = s.processes.slice(1);
        assert.equal(w0.connections, 2);
        assert.equal(w1.connections, 1);
        assert.equal(s.connections, 3);
        assert.equal(s.joined, 3);
        assert.equal(s.editors, 3);
        assert.equal(s.busiestRoom, 2);
        assert.ok(s.rss >= s.processes.reduce((n, p) => n + p.rss, 0) * 0.5);
        assert.equal(s.cpu.user >= s.processes[0].cpu.user, true);
        // Counters from the workers (messages in) and from here (snapshots) are both there.
        assert.ok(s.counters.messagesIn >= 3);
        assert.ok(s.counters.fullSnapshots >= 3);
        // A patch in one file reaches its room only.
        c.send({ type: "patch", id: "only-f1", patch: { nodes: { rect1: { x: 7 } } } });
        await c.next((m) => m.type === "patch" && m.id === "only-f1");
        a.send({ type: "patch", id: "only-f0", patch: { nodes: { rect1: { x: 8 } } } });
        await b.next((m) => m.type === "patch" && m.id === "only-f0");
        await sleep(100);
        assert.ok(!a.messages.some((m) => m.id === "only-f1"));
        assert.ok(!c.messages.some((m) => m.id === "only-f0"));
        await Promise.all([a.close(), b.close(), c.close()]);
    });

    test("a worker that dies is started again; its clients reconnect and resume, other workers' rooms carry on", async () => {
        const [f0, f1] = await filesOnEachWorker();
        const a = await connect(server, f0.id, { key: f0.keys.edit, clientId: "crashclientA" });
        const b = await connect(server, f0.id, { key: f0.keys.edit, clientId: "crashclientB" });
        const other = await connect(server, f1.id, { key: f1.keys.edit });
        a.send({ type: "patch", id: "before", patch: { nodes: { rect1: { x: 11 } } } });
        const p = await b.next((m) => m.type === "patch" && m.id === "before");
        const pid = (await health()).processes[1].pid;
        process.kill(pid, "SIGKILL");
        await a.waitClosed(5000);
        await b.waitClosed(5000);
        // The other worker's room is untouched.
        assert.equal(other.closed(), null);
        other.send({ type: "patch", id: "meanwhile", patch: { nodes: { rect1: { y: 3 } } } });
        await other.next((m) => m.type === "patch" && m.id === "meanwhile");
        // Back with a new process; the clients come back and resume from the version they had.
        await waitUntil(async () => {
            const s = await health();
            return s.processes[1].pid && s.processes[1].pid !== pid && !s.processes[1].down;
        }, 10_000, "worker restarted");
        const a2 = await connect(server, f0.id, { key: f0.keys.edit, hello: false });
        a2.send({ type: "hello", user: { name: "A", color: "#0D99FF" }, key: f0.keys.edit, clientId: "crashclientA", since: p.version });
        const snap = await a2.next("snapshot");
        assert.equal(snap.resume, true);
        assert.deepEqual(snap.ops, []);
        assert.equal(snap.version, p.version);
        const b2 = await connect(server, f0.id, { key: f0.keys.edit, clientId: "crashclientB" });
        assert.equal(b2.first.doc.nodes.rect1.x, 11);
        // Edits flow again between them, and nothing was lost.
        a2.send({ type: "patch", id: "after", patch: { nodes: { rect1: { x: 12 } } } });
        const q = await b2.next((m) => m.type === "patch" && m.id === "after");
        assert.equal(q.version, p.version + 1);
        // Presence works in the new worker too.
        a2.send({ type: "presence", cursor: { x: 1, y: 2 }, pageId: "page1" });
        await b2.next((m) => (m.type === "presence" || m.type === "presences") && JSON.stringify(m).includes('"cursor":{"x":1,"y":2}'));
        assert.match(server.logs(), /Room worker 0 \(pid \d+\) stopped/);
        await Promise.all([a2.close(), b2.close(), other.close()]);
    });

    test("the API's live selection comes from the file's worker", async () => {
        const f = await createFile(server, owner.token, { doc: sampleDoc("Selected") });
        const pat = (await call(server, "POST", "/account/tokens", { token: owner.token, body: { name: "CLI" } })).body.token;
        const a = await connect(server, f.id, { token: owner.token });
        a.send({ type: "presence", cursor: { x: 1, y: 1 }, pageId: "page1", selection: ["rect1"] });
        await waitUntil(async () => (await call(server, "GET", `/v1/files/${f.id}/selection`, { token: pat })).body.selection?.[0] === "rect1", 3000, "selection");
        const r = await call(server, "GET", `/v1/files/${f.id}/selection`, { token: pat });
        assert.equal(r.body.open, true);
        assert.equal(r.body.pageId, "page1");
        assert.ok(r.body.nodes.rect1);
        await a.close();
    });

    test("stopping the server tells clients it's restarting (1012), writes their edits and stops the workers", async () => {
        const own = await startServer({ ...WORKERS, NAGMA_HEALTH_STATS: "1", NAGMA_SAVE_MS: "60000" });
        try {
            const me = await signUp(own, "Owner");
            const f = await createFile(own, me.token);
            const a = await connect(own, f.id, { token: me.token });
            a.send({ type: "patch", id: "late", patch: { nodes: { rect1: { x: 99 } } } });
            await a.next((m) => m.type === "patch" && m.id === "late");
            const pids = (await call(own, "GET", "/health")).body.stats.processes.map((p) => p.pid);
            await own.stop({ keep: true });
            assert.equal((await a.waitClosed(5000)).code, 1012);
            const { readFile } = await import("node:fs/promises");
            const { join } = await import("node:path");
            const stored = JSON.parse(await readFile(join(own.dataDir, `${f.id}.json`), "utf8"));
            assert.equal(stored.doc.nodes.rect1.x, 99);
            for (const pid of pids) {
                let alive = true;
                try {
                    process.kill(pid, 0);
                } catch {
                    alive = false;
                }
                assert.equal(alive, false, `process ${pid} stopped`);
            }
        } finally {
            const { rm } = await import("node:fs/promises");
            await rm(own.dataDir, { recursive: true, force: true });
        }
    });
});
