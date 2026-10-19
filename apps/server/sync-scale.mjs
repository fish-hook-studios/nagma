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

export const presenceHz = (room, busyRoom) => (room.clients.size > busyRoom ? BUSY_PRESENCE_HZ : PRESENCE_HZ);

// A person's presence changed: it goes out with the room's next presence message. A room sends one
// at most every 50 ms (200 ms when busy), right away after a quiet spell, each with at most one
// update per person: so nobody's presence is relayed more than 20 times a second (5 when busy),
// however fast they send, and a cursor waits 25 ms on average. (Measured at 3,000 connections, a
// 25 ms tick halved that wait but cost a fifth more CPU in socket writes.)
export function queuePresence(room, ws, client, { busyRoom, send, now = Date.now() }) {
    const scope = roomPart(client.presence) !== client.relayedRoomPart ? "room" : "page";
    room.presenceDirty ??= new Map();
    if (room.presenceDirty.get(ws) !== "room") room.presenceDirty.set(ws, scope);
    schedulePresence(room, { busyRoom, send, now });
}

function schedulePresence(room, { busyRoom, send, now = Date.now() }) {
    if (room.presenceTimer || !room.presenceDirty?.size) return;
    const tick = 1000 / presenceHz(room, busyRoom);
    const wait = Math.max(0, (room.presenceFlushedAt ?? 0) + tick - now);
    room.presenceTimer = setTimeout(() => flushPresence(room, { busyRoom, send }), wait);
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
export function updatePresenceRate(room, { busyRoom, sendAll }) {
    const hz = presenceHz(room, busyRoom);
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
