// What keeps one sync server fast with thousands of people connected (docs/load-testing.md):
// - each room keeps only its recent operations (a bounded ring), so a client that reconnects gets
//   what it missed instead of the whole file;
// - presence (cursors, selections, cameras) is gathered per room and sent at most 20 times a second
//   (5 in rooms over 50 people), one message per person with everyone else's latest state, only to
//   people on the same page (changes everyone needs, like a page switch or spotlight, go to all);
// - each connection may send so many messages a second (presence excluded); the rest wait in line;
// - messages to a whole room are encoded once.

const envNumber = (env, name, fallback, min = 0) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    const v = Number(raw);
    return Number.isFinite(v) && v >= min ? v : fallback;
};

export function syncSettings(env = process.env) {
    return {
        // Rooms nobody is in are dropped from memory after this long (they reload from disk on the next join).
        roomIdleMs: envNumber(env, "NAGMA_ROOM_IDLE_MS", 10 * 60 * 1000, 50),
        // People who can edit one file at the same time; the rest view until a spot frees up.
        roomEditors: envNumber(env, "NAGMA_ROOM_EDITORS", 100, 1),
        // Messages a second from one connection (patches, comments…; presence is limited separately).
        wsPerSecond: envNumber(env, "NAGMA_WS_PER_SECOND", 60, 1),
        // Open connections per account.
        wsPerAccount: envNumber(env, "NAGMA_WS_PER_ACCOUNT", 10, 1),
        // Recent operations kept per room for reconnecting clients.
        roomOps: envNumber(env, "NAGMA_ROOM_OPS", 1000, 0),
        // A room's file is written at most every this many ms, or sooner after this many changes.
        saveMs: envNumber(env, "NAGMA_SAVE_MS", 2000, 0),
        saveOps: envNumber(env, "NAGMA_SAVE_OPS", 500, 1),
        // Above this many people, a room's presence slows to 5 updates a second per person.
        busyRoom: envNumber(env, "NAGMA_BUSY_ROOM", 50, 1),
        // Presence messages a second per person (at most 20): fewer means fewer messages for everyone,
        // in both directions (clients send at the rate the server gives them).
        presenceHz: Math.min(PRESENCE_HZ, envNumber(env, "NAGMA_PRESENCE_HZ", PRESENCE_HZ, 1)),
    };
}

export const PRESENCE_HZ = 20;
const MAX_PER_MESSAGE = 60;
export const BUSY_PRESENCE_HZ = 5;

// ---- Recent operations ----

// Records one change to the document: the room's version moves on and the change joins the ring.
export function recordOp(room, patch, id, uid, max) {
    room.version += 1;
    if (max > 0) {
        room.ops ??= [];
        room.opIds ??= new Map();
        const op = { version: room.version, id: typeof id === "string" ? id : null, patch, uid: uid ?? null };
        room.ops.push(op);
        if (op.id) room.opIds.set(op.id, op);
        // Trimmed in batches so the ring doesn't shift on every change.
        if (room.ops.length > max + Math.max(8, max >> 3)) {
            for (const old of room.ops.splice(0, room.ops.length - max)) if (old.id && room.opIds.get(old.id) === old) room.opIds.delete(old.id);
        }
    }
    return room.version;
}

// The whole document was replaced (a version restored, a branch merged): the ring no longer leads
// from older versions to this one.
export function resetOps(room) {
    room.version += 1;
    room.ops = [];
    room.opIds = new Map();
    return room.version;
}

// What a client that has everything up to `since` missed, or null when only the whole file will do.
export function opsSince(room, since) {
    if (!Number.isInteger(since) || since < 0 || since > room.version) return null;
    if (since === room.version) return [];
    const ops = room.ops ?? [];
    if (!ops.length || ops[0].version > since + 1) return null;
    const start = ops.findIndex((op) => op.version === since + 1);
    if (start < 0) return null;
    return ops.slice(start).map(({ version, id, patch }) => ({ version, id, patch }));
}

// A patch this person already sent (and the server applied) before their connection dropped.
export function alreadyApplied(room, id, uid) {
    if (typeof id !== "string") return null;
    const op = room.opIds?.get(id);
    return op && op.uid === uid ? op : null;
}

// ---- Presence ----

// Fields everyone in the room needs (the avatar list, follow, spotlight, the call); the rest
// (cursor, selection, camera) only matter to people on the same page.
const ROOM_FIELDS = ["name", "color", "pageId", "spotlight", "chat", "mode", "highFive", "ask", "audio", "muted", "caption", "prototype", "emote"];
const roomPart = (p) => JSON.stringify(ROOM_FIELDS.map((k) => p[k] ?? null));

export const presenceHz = (room, busyRoom, hz = PRESENCE_HZ) => (room.clients.size > busyRoom ? Math.min(BUSY_PRESENCE_HZ, hz) : hz);

// A person's presence changed: it goes out with the room's next presence message. A room sends one
// at most every 50 ms (200 ms when busy), right away after a quiet spell, each with at most one
// update per person: so nobody's presence is relayed more than 20 times a second (5 when busy),
// however fast they send, and a cursor waits 25 ms on average. (Measured at 3,000 connections, a
// 25 ms tick halved that wait but cost a fifth more CPU in socket writes.)
// `run(flush)`, when given, runs the room's flush when its time comes (a room worker spreads them
// out); otherwise it runs straight from the timer.
export function queuePresence(room, ws, client, { busyRoom, hz, send, run, now = Date.now() }) {
    const scope = roomPart(client.presence) !== client.relayedRoomPart ? "room" : "page";
    room.presenceDirty ??= new Map();
    if (room.presenceDirty.get(ws) !== "room") room.presenceDirty.set(ws, scope);
    schedulePresence(room, { busyRoom, hz, send, run, now });
}

function schedulePresence(room, { busyRoom, hz, send, run, now = Date.now() }) {
    if (room.presenceTimer || !room.presenceDirty?.size) return;
    const tick = 1000 / presenceHz(room, busyRoom, hz);
    const wait = Math.max(0, (room.presenceFlushedAt ?? 0) + tick - now);
    const flush = () => flushPresence(room, { busyRoom, send });
    // (The timer stays set until the flush has run, so the room isn't scheduled twice meanwhile.)
    room.presenceTimer = setTimeout(run ? () => run(flush) : flush, wait);
}

// One message per person with what changed for them: everyone else's latest presence that is
// room-wide or on their page; never their own. Someone who just moved to another page also gets
// the presence of everyone already there.
export function flushPresence(room, { busyRoom = 50, send, now = Date.now() }) {
    room.presenceTimer = null;
    room.presenceFlushedAt = now;
    const dirty = room.presenceDirty;
    room.presenceDirty = new Map();
    if (!dirty?.size) return 0;
    const changed = [];
    const movedPage = new Set();
    for (const [ws, scope] of dirty) {
        const c = room.clients.get(ws);
        if (!c?.joined || !c.role) continue;
        const page = c.presence.pageId ?? null;
        if (c.relayedPage !== undefined && c.relayedPage !== page) movedPage.add(ws);
        c.relayedPage = page;
        c.relayedRoomPart = roomPart(c.presence);
        changed.push({ ws, page, scope, json: JSON.stringify(c.presence) });
    }
    if (!changed.length) return 0;
    const fragments = new Map(changed.map((e) => [e.ws, e.json]));
    // In a huge room, each message carries at most MAX_PER_MESSAGE people, a different slice each
    // time, so nobody is sent hundreds of cursors twenty times a second.
    const round = (room.presenceRound = (room.presenceRound ?? 0) + 1);
    let sent = 0;
    for (const [ws, c] of room.clients) {
        if (!c.joined || !c.role || ws.readyState !== 1) continue;
        const mine = c.presence.pageId ?? null;
        let parts = [];
        for (const e of changed) if (e.ws !== ws && (e.scope === "room" || mine === null || e.page === null || e.page === mine)) parts.push(e);
        if (movedPage.has(ws)) {
            // Everyone on the page they arrived at, as they are now.
            const included = new Set(parts.map((e) => e.ws));
            for (const [other, oc] of room.clients) {
                if (other === ws || included.has(other) || !oc.joined || !oc.role || (oc.presence.pageId ?? null) !== mine) continue;
                if (!fragments.has(other)) fragments.set(other, JSON.stringify(oc.presence));
                parts.push({ ws: other, json: fragments.get(other) });
            }
        }
        if (!parts.length) continue;
        if (parts.length > MAX_PER_MESSAGE) {
            const start = (round * MAX_PER_MESSAGE) % parts.length;
            parts = [...parts, ...parts].slice(start, start + MAX_PER_MESSAGE);
        }
        parts = parts.map((e) => e.json);
        send(ws, parts.length === 1 ? `{"type":"presence","presence":${parts[0]}}` : `{"type":"presences","presences":[${parts.join(",")}]}`);
        sent += 1;
    }
    return sent;
}

// The room grew past (or shrank below) the busy size: tell its clients the presence rate to use.
export function updatePresenceRate(room, { busyRoom, hz: base, sendAll }) {
    const hz = presenceHz(room, busyRoom, base);
    if (room.presenceHz === hz) return;
    const before = room.presenceHz;
    room.presenceHz = hz;
    if (before !== undefined) sendAll({ type: "presence-rate", hz });
}

// ---- Per-connection limits ----

// A token bucket: `perSecond` messages a second, bursts up to the same number.
export function takeToken(client, perSecond, now = Date.now()) {
    const b = (client.bucket ??= { tokens: perSecond, at: now });
    b.tokens = Math.min(perSecond, b.tokens + ((now - b.at) / 1000) * perSecond);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
}

export const msUntilToken = (client, perSecond) => Math.max(1, Math.ceil(((1 - (client.bucket?.tokens ?? 0)) / perSecond) * 1000));

// Presence beyond a few times the allowed rate is only noise from a broken or hostile client.
export function presenceAllowed(client, now = Date.now()) {
    const w = (client.presenceWindow ??= { at: now, n: 0 });
    if (now - w.at >= 1000) {
        w.at = now;
        w.n = 0;
    }
    w.n += 1;
    return w.n <= PRESENCE_HZ * 4;
}

// ---- One connection's messages ----

const num = (v) => (Number.isFinite(v) ? v : 0);
const plainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// A presence message, cleaned: only these fields, each of its kind and size, are passed on.
export function presenceFrom(message, prev) {
    const name = typeof message.name === "string" ? message.name.slice(0, 60) : prev.name;
    const color = typeof message.color === "string" && /^#[0-9a-fA-F]{6}$/.test(message.color) ? message.color : prev.color;
    const camera = message.camera && typeof message.camera === "object" ? { x: num(message.camera.x), y: num(message.camera.y), zoom: num(message.camera.zoom) || 1, w: num(message.camera.w), h: num(message.camera.h) } : null;
    return {
        ...prev,
        name,
        color,
        // A point on the canvas, and the ids of selected layers: nothing else is passed on.
        cursor: plainObject(message.cursor) ? { x: num(message.cursor.x), y: num(message.cursor.y) } : null,
        selection: Array.isArray(message.selection) ? message.selection.slice(0, 200).filter((s) => typeof s === "string").map((s) => s.slice(0, 64)) : [],
        pageId: typeof message.pageId === "string" ? message.pageId.slice(0, 64) : null,
        // Follow and spotlight need where each person is looking; cursor chat is a short message.
        camera,
        spotlight: Boolean(message.spotlight),
        chat: typeof message.chat === "string" && message.chat ? message.chat.slice(0, 200) : null,
        mode: typeof message.mode === "string" ? message.mode.slice(0, 12) : null,
        // A board emote burst: an emoji at a point, with an id so each burst plays once.
        highFive: Boolean(message.highFive),
        // Asking someone to spotlight.
        ask: message.ask && typeof message.ask.to === "string" ? { to: message.ask.to.slice(0, 64), id: String(message.ask.id ?? "").slice(0, 24) } : null,
        // In the audio call (muted or not), and their live caption.
        audio: Boolean(message.audio),
        muted: Boolean(message.muted),
        caption: typeof message.caption === "string" && message.caption ? message.caption.slice(0, 300) : null,
        // The screen they're on in a prototype, so spotlight and follow work while presenting.
        prototype: message.prototype && typeof message.prototype === "object" && typeof message.prototype.screen === "string" ? { screen: message.prototype.screen.slice(0, 64) } : null,
        emote: message.emote && typeof message.emote === "object" && typeof message.emote.glyph === "string" ? { id: String(message.emote.id).slice(0, 24), glyph: message.emote.glyph.slice(0, 16), x: num(message.emote.x), y: num(message.emote.y) } : null,
    };
}

// Reads one socket's messages (wherever the socket is: the server, or a room worker): each is
// parsed and counted; presence goes straight to `onPresence` (beyond its own limit it's dropped);
// everything else goes to `onMessage` at `perSecond` messages a second. Beyond that, messages wait in
// line and are handled in order as the allowance comes back, with a "rate-limited" (429) message so
// the client knows; more than five seconds' worth waiting closes the connection (4013), and the
// client reconnects and sends again what the server never confirmed. Returns `stop()` for the close.
export function readMessages(ws, client, { perSecond, counters, onPresence, onMessage, send }) {
    const waiting = [];
    let drainTimer = null;
    let toldLimitedAt = 0;
    const drain = () => {
        drainTimer = null;
        while (waiting.length && takeToken(client, perSecond)) onMessage(waiting.shift());
        if (waiting.length) drainTimer = setTimeout(drain, msUntilToken(client, perSecond));
    };
    ws.on("message", (raw) => {
        let message;
        try {
            message = JSON.parse(String(raw));
        } catch {
            return;
        }
        // Anything but an object ("null", "42") is ignored.
        if (!plainObject(message)) return;
        counters.messagesIn++;
        if (message.type === "presence") {
            counters.presenceIn++;
            if (presenceAllowed(client)) onPresence(message);
            return;
        }
        if (!waiting.length && takeToken(client, perSecond)) return void onMessage(message);
        if (waiting.length >= perSecond * 5) {
            counters.flooded++;
            waiting.length = 0;
            clearTimeout(drainTimer);
            send(ws, { type: "rate-limited", code: 429, limit: perSecond, text: "Too many changes at once: reconnecting to send the rest." });
            ws.close(4013, "Too many messages");
            return;
        }
        waiting.push(message);
        drainTimer ??= setTimeout(drain, msUntilToken(client, perSecond));
        if (Date.now() - toldLimitedAt > 5000) {
            toldLimitedAt = Date.now();
            counters.rateLimited++;
            send(ws, { type: "rate-limited", code: 429, limit: perSecond, retryAfterMs: msUntilToken(client, perSecond), text: `Sending changes more slowly: the server takes ${perSecond} a second from each connection. Nothing is lost.` });
        }
    });
    return {
        stop() {
            clearTimeout(drainTimer);
            waiting.length = 0;
        },
    };
}

// The WebSocket server's options, the same wherever sockets are held (the server, room workers).
// Big messages (snapshots, large patches) are compressed, small ones (cursors, and presence, sent
// uncompressed) aren't. Fast compression with a small window and no context kept between messages,
// so thousands of sockets don't each hold a large compressor (about 25 KB each instead of 200+ KB).
export const socketOptions = {
    maxPayload: 32 * 1024 * 1024,
    perMessageDeflate: { threshold: 1024, serverMaxWindowBits: 11, zlibDeflateOptions: { level: 1, memLevel: 5 }, serverNoContextTakeover: true, clientNoContextTakeover: true, concurrencyLimit: 10 },
};
