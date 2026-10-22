// Page captures sent from Nagma Capture (the browser extension) to a server: the extension posts the
// capture with the person's personal access token (or a signed-in session), the server keeps it for
// a day under data/captures/<id>.json, and answers with a link that opens it in the app
// (/?capture=<id>). The app fetches it with the same account, makes a file of it and deletes the
// server's copy. Only the account that sent a capture can read or delete it.
//
//   POST   /captures        a capture document (format "nagma-capture"), up to 60 MB → 201 { id, url }
//   GET    /captures/<id>   the capture, to its owner only
//   DELETE /captures/<id>   removes it
//
// Limits: NAGMA_CAPTURES_PER_HOUR a sliding hour per account (default 30, then 429 with
// Retry-After), NAGMA_CAPTURE_MAX_MB per capture (default 60), NAGMA_CAPTURE_STORE_MB kept per
// account at once (default 1024), NAGMA_CAPTURE_TTL_MS before a capture is swept (default a day).
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { saveLater, writeAtomic } from "./atomic-write.mjs";

const HOUR = 60 * 60 * 1000;
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

export async function createCaptures({ DATA, CORS, readBody, userFromReq, userFromPat, appUrl, countUsage, env = process.env }) {
    const DIR = join(DATA, "captures");
    await mkdir(DIR, { recursive: true });
    const INDEX = join(DIR, "index.json");
    const MAX_BYTES = num(env.NAGMA_CAPTURE_MAX_MB, 60) * 1024 * 1024;
    const STORE_BYTES = num(env.NAGMA_CAPTURE_STORE_MB, 1024) * 1024 * 1024;
    const PER_HOUR = Math.floor(num(env.NAGMA_CAPTURES_PER_HOUR, 30));
    const TTL = num(env.NAGMA_CAPTURE_TTL_MS, 24 * HOUR);
    const SWEEP = num(env.NAGMA_CAPTURE_SWEEP_MS, Math.min(10 * 60 * 1000, TTL));

    // id → { userId, at, size }
    let index = {};
    try {
        const stored = JSON.parse(await readFile(INDEX, "utf8"));
        if (stored && typeof stored === "object" && !Array.isArray(stored)) index = stored;
    } catch {
        index = {};
    }
    const saveIndex = () => saveLater(INDEX, JSON.stringify(index));
    // Posts per account in the last hour (kept in memory: a restart forgets them).
    const posts = new Map();

    const validId = (id) => /^[A-Za-z0-9_-]{16,32}$/.test(id);
    const pathOf = (id) => join(DIR, `${id}.json`);
    const expired = (rec, now = Date.now()) => now - rec.at > TTL;

    async function remove(id) {
        delete index[id];
        saveIndex();
        await unlink(pathOf(id)).catch(() => undefined);
    }

    // Removes captures past their time, and files the index no longer knows about.
    async function sweep(now = Date.now()) {
        for (const [id, rec] of Object.entries(index)) if (expired(rec, now)) await remove(id);
        for (const name of await readdir(DIR).catch(() => [])) {
            const m = /^([A-Za-z0-9_-]+)\.json$/.exec(name);
            if (!m || name === "index.json" || index[m[1]]) continue;
            const s = await stat(join(DIR, name)).catch(() => null);
            if (s && now - s.mtimeMs > Math.min(TTL, HOUR)) await unlink(join(DIR, name)).catch(() => undefined);
        }
        for (const [key, list] of posts) if (!list.some((t) => now - t < HOUR)) posts.delete(key);
    }
    setTimeout(() => void sweep().catch(() => undefined), Math.min(5000, SWEEP)).unref();
    setInterval(() => void sweep().catch(() => undefined), SWEEP).unref();

    // Who is asking: a personal access token, or a signed-in session.
    async function who(req) {
        return (await userFromPat(req)) ?? userFromReq(req);
    }

    async function serve(req, res) {
        const url = new URL(req.url ?? "/", "http://local");
        const path = url.pathname;
        if (path !== "/captures" && !path.startsWith("/captures/")) return false;
        const json = (status, body, extra = {}) => (res.writeHead(status, { ...CORS, "content-type": "application/json", "cache-control": "no-store", ...extra }).end(JSON.stringify(body)), true);
        if (req.method === "OPTIONS") return (res.writeHead(204, { ...CORS, "access-control-max-age": "600" }).end(), true);

        if (path === "/captures") {
            if (req.method !== "POST") return json(405, { error: "Not allowed." });
            const user = await who(req);
            if (!user) {
                // Drain the body so the answer reaches the caller.
                req.resume();
                return json(401, { error: "A valid personal access token is needed (Account settings › Tokens)." });
            }
            const now = Date.now();
            const recent = (posts.get(user.id) ?? []).filter((t) => now - t < HOUR);
            if (recent.length >= PER_HOUR) {
                req.resume();
                const wait = Math.max(1, Math.ceil((recent[0] + HOUR - now) / 1000));
                return json(429, { error: `Too many captures sent. Try again in ${Math.ceil(wait / 60)} minute${Math.ceil(wait / 60) === 1 ? "" : "s"}.`, retryAfter: wait }, { "retry-after": String(wait) });
            }
            let body;
            try {
                body = await readBody(req, MAX_BYTES);
            } catch (error) {
                if (error?.message === "too large") return json(413, { error: `That capture is over ${Math.round(MAX_BYTES / (1024 * 1024))} MB.` });
                throw error;
            }
            // Light checks only: the app checks the rest when it opens the capture.
            let capture;
            try {
                capture = JSON.parse(body.toString("utf8"));
            } catch {
                capture = null;
            }
            const ok = capture && typeof capture === "object" && !Array.isArray(capture) && capture.format === "nagma-capture" && Number.isInteger(capture.version) && capture.version >= 1 && capture.root && typeof capture.root === "object" && !Array.isArray(capture.root);
            capture = null;
            if (!ok) return json(400, { error: "That isn't a page capture." });
            // What the account keeps at once: older captures expire or are opened first.
            const mine = Object.values(index).filter((r) => r.userId === user.id && !expired(r, now));
            const held = mine.reduce((t, r) => t + r.size, 0);
            if (held + body.length > STORE_BYTES) {
                const oldest = Math.min(...mine.map((r) => r.at));
                const wait = Math.max(1, Math.ceil((oldest + TTL - now) / 1000));
                return json(429, { error: "Too many captures waiting to be opened. Open or delete some first.", retryAfter: wait }, { "retry-after": String(wait) });
            }
            const id = randomBytes(16).toString("base64url");
            await writeAtomic(pathOf(id), body);
            index[id] = { userId: user.id, at: now, size: body.length };
            saveIndex();
            posts.set(user.id, [...recent, now]);
            countUsage("captures");
            return json(201, { id, url: `${appUrl(req)}/?capture=${id}`, expiresAt: now + TTL });
        }

        const one = /^\/captures\/([^/]+)$/.exec(path);
        if (!one) return json(404, { error: "Not found." });
        const id = one[1];
        if (req.method !== "GET" && req.method !== "DELETE") return json(405, { error: "Not allowed." });
        const user = await who(req);
        if (!user) return json(401, { error: "Sign in first." });
        const rec = validId(id) ? index[id] : null;
        if (!rec || expired(rec)) {
            if (rec) await remove(id);
            return json(404, { error: "That capture has expired or was already opened." });
        }
        if (rec.userId !== user.id) return json(403, { error: "That capture belongs to another account." });
        if (req.method === "DELETE") {
            await remove(id);
            return json(200, { ok: true });
        }
        let data;
        try {
            data = await readFile(pathOf(id));
        } catch {
            await remove(id);
            return json(404, { error: "That capture has expired or was already opened." });
        }
        res.writeHead(200, { ...CORS, "content-type": "application/json", "cache-control": "no-store", "content-length": String(data.length) }).end(data);
        return true;
    }

    return { serve, sweep };
}
