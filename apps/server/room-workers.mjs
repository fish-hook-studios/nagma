// Room workers (NAGMA_WORKERS > 1): live sessions spread over several processes, so one server
// uses more than one core (docs/load-testing.md, "Sharding across processes").
//
// The main process accepts every connection. A WebSocket upgrade to /files/<id> is handed, socket
// and all, to the worker that file's id hashes to (room-worker.mjs), which completes the handshake
// and from then on holds the socket: it reads and parses messages, applies the per-connection
// limits, keeps and fans out presence (cursors, selections: by far most of the traffic), and writes
// everything sent to the socket, compressed where it's big. Everyone in one file meets in the same
// worker, so a room's presence never leaves it.
//
// What a room's state needs stays here, in the main process, unchanged: the document, the order of
// changes and their history, access (hello, roles, link keys, the editor cap), comments, versions,
// votes and saving. A worker passes each non-presence message up (`m`), and this process answers
// with what to send: to one socket (`send`), or to the whole room, encoded once (`bc`), which the
// worker writes to each of its sockets. For the code in server.mjs a remote socket is a stand-in
// with `send`, `close` and `readyState`, so routes that reach rooms (renames, sharing, restores)
// work as they do with one process.
//
// Messages between processes are batched per event-loop turn. A worker that dies is started again;
// its connections close, and clients reconnect (with backoff) and resume from the last version they
// have: the documents are here, so nothing a worker held is lost.
import { fork } from "node:child_process";
import { availableParallelism } from "node:os";

// NAGMA_WORKERS: 1 (the default) keeps everything in one process; N > 1 starts N room workers;
// "auto" is one per core but one (the main process has the rest).
export function workerCount(env = process.env) {
    const raw = String(env.NAGMA_WORKERS ?? "").trim().toLowerCase();
    if (raw === "auto") return Math.max(1, availableParallelism() - 1);
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 ? Math.min(n, 64) : 1;
}

// Which worker a file's room lives in: the same for everyone in the file (FNV-1a of the id).
export function workerFor(id, count) {
    let h = 0x811c9dc5;
    const s = String(id ?? "");
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h % count;
}

const WORKER_FILE = new URL("./room-worker.mjs", import.meta.url);
const ROOM_FIELDS = ["userId", "name", "color", "accountId"];

// A socket a worker holds, as server.mjs sees it.
class RemoteSocket {
    constructor(pool, worker, conn) {
        this.pool = pool;
        this.worker = worker;
        this.conn = conn;
        this.readyState = 1;
    }
    get remote() {
        return true;
    }
    send(data) {
        if (this.readyState !== 1) return;
        this.pool.post(this.worker, { t: "send", c: this.conn, d: typeof data === "string" ? data : String(data) });
    }
    close(code, reason) {
        if (this.readyState > 1) return;
        this.readyState = 2;
        this.pool.post(this.worker, { t: "close", c: this.conn, code, reason });
    }
    terminate() {
        this.close();
    }
}

/**
 * Starts `count` room workers. `onOpen(ws, fileId)` is called for each socket a worker took, with
 * its stand-in; it returns `{ client, run(message), closed() }`.
 */
export function createRoomWorkers({ count, onOpen, log = console }) {
    const workers = [];
    const asks = new Map();
    let connSeq = 0;
    let askSeq = 0;
    let stopping = false;

    const pool = {
        count,
        post(w, op) {
            if (!w.child || w.exited) return;
            w.queue.push(op);
            if (w.flushQueued) return;
            w.flushQueued = true;
            setImmediate(() => flush(w));
        },
    };

    function flush(w) {
        w.flushQueued = false;
        if (!w.queue.length) return;
        const ops = w.queue;
        w.queue = [];
        if (!w.child || w.exited || !w.child.connected) return;
        try {
            w.child.send(ops);
        } catch (error) {
            log.warn(`room worker ${w.index}: couldn't send: ${error?.message ?? error}`);
        }
    }

    function start(index) {
        const w = workers[index] ?? { index, crashes: [], conns: new Map(), pending: [] };
        workers[index] = w;
        Object.assign(w, { child: null, ready: false, exited: false, queue: [], flushQueued: false });
        const child = fork(WORKER_FILE, [], { serialization: "advanced", env: { ...process.env, NAGMA_WORKER_INDEX: String(index) } });
        w.child = child;
        child.on("message", (msg) => {
            // (Anything still arriving from a worker that has been replaced is for sockets gone with it.)
            if (w.child !== child || w.exited) return;
            if (Array.isArray(msg)) for (const op of msg) handle(w, op);
            else handle(w, msg);
        });
        child.on("error", (error) => log.warn(`room worker ${index}: ${error?.message ?? error}`));
        child.on("exit", (code, signal) => exited(w, child, code, signal));
        return w;
    }

    function handle(w, op) {
        try {
            switch (op.t) {
                case "ready": {
                    w.ready = true;
                    const pending = w.pending;
                    w.pending = [];
                    for (const [up, socket, timer] of pending) {
                        clearTimeout(timer);
                        handOff(w, up, socket);
                    }
                    break;
                }
                case "o": {
                    const ws = new RemoteSocket(pool, w, op.c);
                    const entry = onOpen(ws, op.id);
                    entry.ws = ws;
                    w.conns.set(op.c, entry);
                    watch(entry.client, ws);
                    break;
                }
                case "m":
                    w.conns.get(op.c)?.run(op.m);
                    break;
                case "pn": {
                    const entry = w.conns.get(op.c);
                    if (entry) entry.client.presence = { ...entry.client.presence, name: op.name, color: op.color };
                    break;
                }
                case "x": {
                    const entry = w.conns.get(op.c);
                    if (!entry) break;
                    w.conns.delete(op.c);
                    entry.ws.readyState = 3;
                    void entry.closed();
                    break;
                }
                case "ans": {
                    const ask = asks.get(op.id);
                    if (!ask) break;
                    asks.delete(op.id);
                    clearTimeout(ask.timer);
                    ask.resolve(op.v);
                    break;
                }
            }
        } catch (error) {
            log.warn(`room worker ${w.index} message (${String(op?.t).slice(0, 10)}) failed: ${error?.stack ?? error}`);
        }
    }

    // The worker this connection is in learns its role and whether it's in the file as soon as they
    // change (its presence and room messages go only to people with a role, as in one process).
    function watch(client, ws) {
        let role = client.role;
        let joined = client.joined;
        Object.defineProperty(client, "role", {
            get: () => role,
            set: (v) => {
                if (v === role) return;
                role = v;
                pool.post(ws.worker, { t: "st", c: ws.conn, role: role ?? null, joined: Boolean(joined) });
            },
            enumerable: true,
            configurable: true,
        });
        Object.defineProperty(client, "joined", {
            get: () => joined,
            set: (v) => {
                if (v === joined) return;
                joined = v;
                pool.post(ws.worker, { t: "st", c: ws.conn, role: role ?? null, joined: Boolean(joined) });
            },
            enumerable: true,
            configurable: true,
        });
    }

    function exited(w, child, code, signal) {
        if (w.child !== child) return;
        w.exited = true;
        w.ready = false;
        w.queue = [];
        // Its sockets are gone: the people in its rooms leave them here too.
        const conns = [...w.conns.values()];
        w.conns.clear();
        for (const entry of conns) {
            entry.ws.readyState = 3;
            void entry.closed();
        }
        for (const [id, ask] of asks) {
            if (ask.worker !== w) continue;
            asks.delete(id);
            clearTimeout(ask.timer);
            ask.resolve(null);
        }
        if (stopping) {
            for (const [, socket, timer] of w.pending.splice(0)) {
                clearTimeout(timer);
                socket.destroy();
            }
            return;
        }
        const now = Date.now();
        w.crashes = [...w.crashes.filter((t) => now - t < 60_000), now];
        // Started again straight away; if it keeps dying, a little later each time (up to 5 s).
        const wait = Math.min(5000, 50 * 2 ** Math.max(0, w.crashes.length - 2));
        log.error(`Room worker ${w.index} (pid ${child.pid}) stopped (${signal ?? `exit ${code}`}); its ${conns.length} connections closed, starting it again${wait > 100 ? ` in ${wait} ms` : ""}.`);
        setTimeout(() => {
            if (!stopping) start(w.index);
        }, wait).unref();
    }

    function handOff(w, up, socket) {
        // Anything already queued for this worker goes first.
        flush(w);
        if (!w.child?.connected) return void socket.destroy();
        try {
            w.child.send(up, socket, (error) => {
                if (error) socket.destroy();
            });
        } catch {
            socket.destroy();
        }
    }

    // An upgrade to /files/<id> goes to that file's worker. (Any other address goes to the first
    // worker, which closes it the way the server always has: 4000, unknown file.)
    pool.upgrade = (req, socket, head) => {
        if (stopping) return void socket.destroy();
        const id = /^\/files\/([^/?]+)/.exec(req.url ?? "")?.[1] ?? "";
        const w = workers[workerFor(id, count)];
        socket.on("error", () => undefined);
        // Nothing is read here any more: the worker reads the socket from now on. (pause() alone
        // leaves this process's copy reading from the shared descriptor: bytes it took between the
        // handshake and closing its copy, a client's first message, would be lost. Stop it reading.)
        socket.pause();
        socket._handle?.readStop?.();
        const up = { t: "up", c: ++connSeq, id, method: req.method, url: req.url, headers: req.headers, head: head?.length ? head : null };
        if (w.ready) return void handOff(w, up, socket);
        // A worker being started again: the connection waits for it (a few seconds at most).
        const timer = setTimeout(() => {
            w.pending = w.pending.filter((p) => p[1] !== socket);
            socket.destroy();
        }, 10_000);
        timer.unref();
        w.pending.push([up, socket, timer]);
    };

    // The snapshot for a hello, encoded here: the worker adds the people already in the file and the
    // presence rate (presence is there), sends it, and counts this person in.
    pool.join = (ws, snapshot, client) => {
        const presence = { cursor: null, selection: [] };
        for (const k of ROOM_FIELDS) if (client.presence[k] !== undefined) presence[k] = client.presence[k];
        pool.post(ws.worker, { t: "join", c: ws.conn, snap: JSON.stringify(snapshot), presence, role: client.role ?? null });
    };

    // A message for everyone in a room (with a role), encoded once here and written by its worker.
    pool.broadcast = (roomId, text, except) => {
        pool.post(workers[workerFor(roomId, count)], { t: "bc", r: roomId, d: text, x: except?.conn ?? 0 });
    };

    function ask(w, q, timeout = 2000) {
        if (!w?.ready) return Promise.resolve(null);
        return new Promise((resolve) => {
            const id = ++askSeq;
            const timer = setTimeout(() => {
                asks.delete(id);
                resolve(null);
            }, timeout);
            asks.set(id, { resolve, timer, worker: w });
            pool.post(w, { t: "ask", id, ...q });
        });
    }

    // Each worker's process and socket statistics (/health).
    pool.stats = () => Promise.all(workers.map((w) => ask(w, { q: "stats" }).then((s) => (s ? { index: w.index, ...s } : { index: w.index, down: true }))));

    // The live presence (page, selection, cursor) of these sockets' people, from their workers, onto
    // their clients here (the API's "what's selected now").
    pool.refreshPresence = async (entries) => {
        const byWorker = new Map();
        for (const [ws, client] of entries) {
            if (!ws?.remote) continue;
            if (!byWorker.has(ws.worker)) byWorker.set(ws.worker, []);
            byWorker.get(ws.worker).push([ws, client]);
        }
        await Promise.all(
            [...byWorker].map(async ([w, list]) => {
                const got = await ask(w, { q: "presence", cs: list.map(([ws]) => ws.conn) });
                if (!got) return;
                for (const [ws, client] of list) if (got[ws.conn]) client.presence = { ...client.presence, ...got[ws.conn], userId: client.presence.userId };
            }),
        );
    };

    pool.pids = () => workers.map((w) => w.child?.pid ?? null);

    // Stopping: every worker tells its clients the server is restarting (1012) and exits.
    pool.stop = (timeout = 4000) => {
        stopping = true;
        return Promise.all(
            workers.map(
                (w) =>
                    new Promise((resolve) => {
                        const child = w.child;
                        if (!child || w.exited || child.exitCode !== null) return resolve();
                        const timer = setTimeout(() => {
                            child.kill("SIGKILL");
                            resolve();
                        }, timeout);
                        child.once("exit", () => {
                            clearTimeout(timer);
                            resolve();
                        });
                        pool.post(w, { t: "bye" });
                        flush(w);
                    }),
            ),
        );
    };

    // Ready once every worker is.
    pool.ready = Promise.all(
        Array.from({ length: count }, (_, i) => {
            const w = start(i);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`room worker ${i} did not start`)), 15_000);
                const onMessage = (msg) => {
                    if (msg?.t !== "ready") return;
                    clearTimeout(timer);
                    w.child.off("message", onMessage);
                    resolve();
                };
                w.child.on("message", onMessage);
            });
        }),
    );

    return pool;
}
