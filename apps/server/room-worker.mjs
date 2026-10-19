// A room worker (NAGMA_WORKERS > 1; started by room-workers.mjs, never on its own): holds the
// sockets of the files whose ids hash to it. It completes each WebSocket handshake the main process
// handed over, reads and limits messages, keeps and sends presence, and writes what the main process
// asks it to: to one socket, or to everyone in a room. The documents, access and saving stay in the
// main process; see room-workers.mjs.
import { WebSocketServer } from "ws";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { presenceFrom, presenceHz, queuePresence, readMessages, socketOptions, syncSettings, updatePresenceRate } from "./sync-scale.mjs";

if (!process.send) {
    console.error("room-worker.mjs is started by the server (NAGMA_WORKERS), not on its own.");
    process.exit(1);
}

const SYNC = syncSettings();
const INDEX = Number(process.env.NAGMA_WORKER_INDEX ?? 0);
const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(id);

const wss = new WebSocketServer({ noServer: true, ...socketOptions });
/** @type {Map<number, {ws: any, client: any, room: any}>} */
const conns = new Map();
/** @type {Map<string, {id: string, clients: Map<any, any>}>} */
const rooms = new Map();
const counters = { messagesIn: 0, presenceIn: 0, presenceMessagesOut: 0, rateLimited: 0, flooded: 0 };
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();

// ---- To the main process: batched per event-loop turn ----

let outbox = [];
function up(op) {
    outbox.push(op);
    if (outbox.length === 1) setImmediate(flushUp);
}
function flushUp() {
    const ops = outbox;
    outbox = [];
    if (ops.length && process.connected) process.send(ops);
}

// ---- Sending ----

function send(ws, message) {
    if (ws.readyState === 1) ws.send(typeof message === "string" ? message : JSON.stringify(message));
}

// As the server's broadcast: everyone in the room with a role, one buffer for every socket.
function broadcastText(room, text, exceptConn) {
    let data = null;
    for (const [ws, client] of room.clients) {
        if (ws.conn === exceptConn || !client.role || ws.readyState !== 1) continue;
        data ??= Buffer.from(text);
        ws.send(data, { binary: false });
    }
}
const broadcast = (room, message) => broadcastText(room, JSON.stringify(message), 0);

const sendPresenceText = (ws, text) => {
    if (ws.readyState !== 1) return;
    ws.send(text, { compress: false });
    counters.presenceMessagesOut++;
};
// Rooms' presence messages go out in slices of a few milliseconds, with the event loop free in
// between: with hundreds of rooms in a worker, a whole round of cursor messages run back to back
// would hold up the edits that arrive meanwhile (from the main process, to be written to sockets).
const PRESENCE_SLICE_MS = 4;
const presenceDue = [];
let presenceDraining = false;
function drainPresence() {
    const until = performance.now() + PRESENCE_SLICE_MS;
    let i = 0;
    while (i < presenceDue.length && performance.now() < until) presenceDue[i++]();
    presenceDue.splice(0, i);
    if (presenceDue.length) setImmediate(drainPresence);
    else presenceDraining = false;
}
const runPresence = (flush) => {
    presenceDue.push(flush);
    if (presenceDraining) return;
    presenceDraining = true;
    setImmediate(drainPresence);
};
const presenceOptions = { busyRoom: SYNC.busyRoom, hz: SYNC.presenceHz, send: sendPresenceText, run: runPresence };
const presenceRateChanged = (room) => updatePresenceRate(room, { busyRoom: SYNC.busyRoom, hz: SYNC.presenceHz, sendAll: (m) => broadcast(room, m) });

function queueLeave(room, userId) {
    (room.leaving ??= []).push(userId);
    if (room.leaveTimer) return;
    room.leaveTimer = setImmediate(() => {
        room.leaveTimer = null;
        const ids = room.leaving;
        room.leaving = [];
        if (ids.length === 1) broadcast(room, { type: "leave", userId: ids[0] });
        else if (ids.length) broadcast(room, { type: "leave", userId: ids[0], userIds: ids });
    });
}

const peers = (room, except) => [...room.clients.entries()].filter(([ws, client]) => ws !== except && client.role).map(([, client]) => client.presence);

// ---- Connections ----

function opened(ws, c, id) {
    ws.conn = c;
    ws.on("error", (error) => console.warn(`socket error: ${error?.code ?? error?.message ?? error}`));
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));
    if (!validId(id)) {
        ws.close(4000, "Unknown file");
        return;
    }
    let room = rooms.get(id);
    if (!room) rooms.set(id, (room = { id, clients: new Map() }));
    const client = { presence: { userId: null, name: "Guest", color: "#7C5CFF", cursor: null, selection: [], pageId: null }, role: null, joined: false };
    room.clients.set(ws, client);
    conns.set(c, { ws, client, room });
    up({ t: "o", c, id });
    const reader = readMessages(ws, client, {
        perSecond: SYNC.wsPerSecond,
        counters,
        send,
        onPresence: (message) => {
            // Before the main process has let this person in, only the latest is kept (for the moment they are).
            if (!client.joined || !client.role) {
                if (client.saidHello) client.early = message;
                return;
            }
            client.presence = presenceFrom(message, client.presence);
            tellName(c, client);
            queuePresence(room, ws, client, presenceOptions);
        },
        onMessage: (message) => {
            if (message.type === "hello") client.saidHello = true;
            up({ t: "m", c, m: message });
        },
    });
    ws.on("close", () => {
        reader.stop();
        conns.delete(c);
        room.clients.delete(ws);
        room.presenceDirty?.delete(ws);
        if (client.joined) queueLeave(room, client.presence.userId);
        presenceRateChanged(room);
        if (!room.clients.size) {
            clearTimeout(room.presenceTimer);
            if (rooms.get(id) === room) rooms.delete(id);
        }
        up({ t: "x", c });
    });
}

// The main process names people in versions and notices: it hears when a name or colour changes.
function tellName(c, client) {
    const { name, color } = client.presence;
    if (name === client.saidName && color === client.saidColor) return;
    client.saidName = name;
    client.saidColor = color;
    up({ t: "pn", c, name, color });
}

// ---- From the main process ----

function handle(op, socket) {
    switch (op.t) {
        case "up": {
            if (!socket) return;
            if (stopping) return void socket.destroy();
            const req = { method: op.method, url: op.url, headers: op.headers, socket };
            const head = op.head ? Buffer.from(op.head.buffer, op.head.byteOffset, op.head.byteLength) : Buffer.alloc(0);
            socket.on("error", () => undefined);
            wss.handleUpgrade(req, socket, head, (ws) => opened(ws, op.c, op.id));
            socket.resume();
            return;
        }
        case "send": {
            const conn = conns.get(op.c);
            if (conn) send(conn.ws, op.d);
            return;
        }
        case "bc": {
            const room = rooms.get(op.r);
            if (room) broadcastText(room, op.d, op.x);
            return;
        }
        case "close": {
            conns.get(op.c)?.ws.close(op.code, op.reason);
            return;
        }
        case "st": {
            const conn = conns.get(op.c);
            if (!conn) return;
            conn.client.role = op.role;
            conn.client.joined = op.joined;
            return;
        }
        case "join": {
            const conn = conns.get(op.c);
            if (!conn) return;
            const { ws, client, room } = conn;
            client.presence = { ...client.presence, ...op.presence };
            client.saidName = client.presence.name;
            client.saidColor = client.presence.color;
            client.role = op.role;
            // The snapshot came encoded (an object ending in "}"): the rest goes on the end.
            send(ws, `${op.snap.slice(0, -1)},"presenceHz":${presenceHz(room, SYNC.busyRoom, SYNC.presenceHz)},"peers":${JSON.stringify(peers(room, ws))}}`);
            client.joined = true;
            // A presence sent between the hello and now.
            if (client.early) {
                client.presence = presenceFrom(client.early, client.presence);
                client.early = null;
                tellName(op.c, client);
            }
            queuePresence(room, ws, client, presenceOptions);
            presenceRateChanged(room);
            return;
        }
        case "ask": {
            up({ t: "ans", id: op.id, v: answer(op) });
            return;
        }
        case "bye":
            void stop();
            return;
    }
}

function answer(op) {
    if (op.q === "stats") {
        const mem = process.memoryUsage();
        let joined = 0;
        let busiest = 0;
        for (const room of rooms.values()) {
            busiest = Math.max(busiest, room.clients.size);
            for (const c of room.clients.values()) if (c.joined) joined++;
        }
        const ms = (ns) => Math.round(ns / 1e4) / 100;
        const eventLoop = { p50: ms(loopDelay.percentile(50)), p99: ms(loopDelay.percentile(99)), max: ms(loopDelay.max) };
        loopDelay.reset();
        return { pid: process.pid, cpu: process.cpuUsage(), rss: mem.rss, heapUsed: mem.heapUsed, connections: wss.clients.size, rooms: rooms.size, joined, busiestRoom: busiest, eventLoop, counters: { ...counters } };
    }
    if (op.q === "presence") {
        const out = {};
        for (const c of op.cs ?? []) {
            const conn = conns.get(c);
            if (conn) out[c] = conn.client.presence;
        }
        return out;
    }
    return null;
}

process.on("message", (msg, socket) => {
    try {
        if (Array.isArray(msg)) for (const op of msg) handle(op);
        else handle(msg, socket);
    } catch (error) {
        console.warn(`room worker ${INDEX}: ${String(msg?.t ?? "batch").slice(0, 10)} failed: ${error?.stack ?? error}`);
        if (socket && !socket.destroyed && msg?.t === "up") socket.destroy();
    }
});

// A socket that stops answering pings is closed within a minute (as in one process).
setInterval(() => {
    for (const ws of wss.clients) {
        if (ws.isAlive === false) {
            ws.terminate();
            continue;
        }
        ws.isAlive = false;
        try {
            ws.ping();
        } catch {
            // Closing anyway.
        }
    }
}, 30_000).unref();

// Stopping (the server is, or the main process went away): clients are told the server is
// restarting (1012), so they reconnect with backoff and resume.
let stopping = false;
async function stop() {
    if (stopping) return;
    stopping = true;
    for (const ws of wss.clients) ws.close(1012, "Server restarting");
    const deadline = Date.now() + 2000;
    while (wss.clients.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    flushUp();
    process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
process.on("disconnect", () => {
    for (const ws of wss.clients) ws.terminate();
    process.exit(0);
});

process.send({ t: "ready" });
