// Personal access tokens and the read-only API they open. People create tokens under Account
// settings › Tokens; a token is shown once, and only its SHA-256 hash is kept (data/tokens.json).
// Tokens are scoped read-only: they reach /v1/* (GET only) and nothing else, so tools such as the
// MCP server and the code-editor extension can read files a person has access to but never edit,
// share or delete anything.
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseObject } from "./json-body.mjs";
import { saveLater } from "./atomic-write.mjs";
import { LEGACY } from "./legacy-names.mjs";

const PREFIX = "nagma_pat_";
const MAX_TOKENS = 20;
const hashOf = (token) => createHash("sha256").update(token).digest("hex");

export function createApiTokens({ DATA, rooms, userById, publicUser, userFromReq, loadRoom, roleFor, listFiles, readBody, CORS }) {
    const PATH = join(DATA, "tokens.json");
    let store = { tokens: [] };
    let loaded = false;
    let timer = null;

    async function load() {
        if (loaded) return;
        loaded = true;
        try {
            store = JSON.parse(await readFile(PATH, "utf8"));
            if (!Array.isArray(store.tokens)) store = { tokens: [] };
        } catch {
            store = { tokens: [] };
        }
    }

    function save() {
        clearTimeout(timer);
        timer = setTimeout(() => saveLater(PATH, JSON.stringify(store)), 200);
    }

    const publicToken = (t) => ({ id: t.id, name: t.name, scopes: t.scopes, hint: t.hint, createdAt: t.createdAt, lastUsed: t.lastUsed ?? null, expiresAt: t.expiresAt ?? null });

    // The person a token belongs to, or null (unknown, revoked or expired). Use is recorded at most
    // once a minute.
    function userFromPat(req) {
        const header = String(req.headers.authorization ?? "");
        const raw = header.startsWith("Bearer ") ? header.slice(7).trim() : String(req.headers["x-nagma-token"] ?? req.headers[LEGACY.tokenHeader] ?? "").trim();
        // Tokens made before the product's rename keep their old prefix.
        if (!raw.startsWith(PREFIX) && !raw.startsWith(LEGACY.tokenPrefix)) return null;
        const hash = hashOf(raw);
        const token = store.tokens.find((t) => t.hash === hash);
        if (!token) return null;
        const now = Date.now();
        if (token.expiresAt && token.expiresAt < now) return null;
        if (now - (token.lastUsed ?? 0) > 60_000) {
            token.lastUsed = now;
            save();
        }
        return userById(token.userId);
    }

    // A layer and everything inside it, from a document.
    function subtree(doc, id, depth) {
        const out = {};
        const walk = (nid, d) => {
            const node = doc.nodes?.[nid];
            if (!node) return;
            out[nid] = node;
            if (depth != null && d >= depth) return;
            for (const c of node.children ?? []) walk(c, d + 1);
        };
        walk(id, 0);
        return out;
    }

    async function serve(req, res) {
        const url = new URL(req.url ?? "/", "http://local");
        const path = url.pathname;
        const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
        if (!path.startsWith("/account/tokens") && !path.startsWith("/v1/")) return false;
        await load();

        // ---- Managing tokens: with a signed-in session ----
        if (path.startsWith("/account/tokens")) {
            const user = userFromReq(req);
            if (!user) return json(401, { error: "Sign in first." });
            const mine = () => store.tokens.filter((t) => t.userId === user.id);
            if (path === "/account/tokens" && req.method === "GET") return json(200, { tokens: mine().map(publicToken) });
            if (path === "/account/tokens" && req.method === "POST") {
                let body = {};
                try {
                    body = parseObject(await readBody(req, 16 * 1024));
                } catch {
                    return json(400, { error: "Bad request." });
                }
                const name = String(body.name ?? "").trim().slice(0, 60);
                if (!name) return json(400, { error: "Give the token a name." });
                if (mine().length >= MAX_TOKENS) return json(400, { error: `You can have up to ${MAX_TOKENS} tokens. Revoke one first.` });
                const days = Number(body.expiresInDays);
                const token = `${PREFIX}${randomBytes(24).toString("base64url")}`;
                const record = {
                    id: randomBytes(9).toString("base64url"),
                    userId: user.id,
                    name,
                    hash: hashOf(token),
                    // The last four characters, so people can tell tokens apart.
                    hint: token.slice(-4),
                    scopes: ["files:read"],
                    createdAt: Date.now(),
                    expiresAt: Number.isFinite(days) && days > 0 ? Date.now() + Math.min(days, 366) * 24 * 60 * 60 * 1000 : null,
                };
                store.tokens.push(record);
                save();
                // The only time the token itself is sent.
                return json(200, { token, record: publicToken(record) });
            }
            const one = /^\/account\/tokens\/([A-Za-z0-9_-]{6,32})$/.exec(path);
            if (one && req.method === "DELETE") {
                const before = store.tokens.length;
                store.tokens = store.tokens.filter((t) => !(t.id === one[1] && t.userId === user.id));
                if (store.tokens.length === before) return json(404, { error: "No such token." });
                save();
                return json(200, { ok: true });
            }
            return json(405, { error: "Not allowed." });
        }

        // ---- The read-only API: with a personal access token ----
        if (req.method !== "GET") return json(405, { error: "Tokens are read-only." });
        const user = userFromPat(req);
        if (!user) return json(401, { error: "A valid personal access token is needed (Account settings › Tokens)." });
        if (path === "/v1/me") return json(200, { user: publicUser(user), scopes: ["files:read"] });
        if (path === "/v1/files") {
            const files = (await listFiles(user)).filter((f) => !f.trashed).map(({ keys: _k, claimable: _c, invited: _i, ...f }) => f);
            return json(200, { files });
        }
        const file = /^\/v1\/files\/([A-Za-z0-9_-]{6,64})(\/nodes|\/selection)?$/.exec(path);
        if (file) {
            const room = await loadRoom(file[1]);
            if (!room.file?.doc) return json(404, { error: "No such file." });
            const role = roleFor(room.file, user, url.searchParams.get("key") ?? "");
            if (!role || role === "prototype") return json(403, { error: "You don't have access to this file." });
            const doc = room.file.doc;
            if (file[2] === "/selection") {
                // What the token's owner has selected in the file right now (in any open editor), newest first.
                const live = [...(rooms.get(file[1])?.clients.values() ?? [])].filter((c) => c.user?.id === user.id && c.presence);
                const sel = live.map((c) => ({ pageId: c.presence.pageId ?? null, selection: (c.presence.selection ?? []).filter((id) => doc.nodes?.[id]) })).find((p) => p.selection.length) ?? { pageId: live[0]?.presence.pageId ?? null, selection: [] };
                return json(200, { open: live.length > 0, ...sel, nodes: Object.fromEntries(sel.selection.map((id) => [id, { root: id, nodes: subtree(doc, id, null) }])) });
            }
            if (file[2]) {
                const ids = (url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
                const depth = url.searchParams.has("depth") ? Math.max(0, Number(url.searchParams.get("depth")) || 0) : null;
                const nodes = {};
                for (const id of ids) nodes[id] = doc.nodes?.[id] ? { root: id, nodes: subtree(doc, id, depth) } : null;
                return json(200, { name: doc.name ?? "Untitled", role, nodes, images: pickImages(doc, nodes) });
            }
            return json(200, { id: file[1], name: doc.name ?? "Untitled", role, version: room.version ?? 0, document: doc });
        }
        return json(404, { error: "Not found." });
    }

    // The image data the returned layers use (image fills), so a reader can draw them.
    function pickImages(doc, picked) {
        const out = {};
        for (const entry of Object.values(picked)) {
            for (const node of Object.values(entry?.nodes ?? {})) {
                for (const p of node.fills ?? []) if (p.type === "image" && doc.images?.[p.id]) out[p.id] = doc.images[p.id];
            }
        }
        return out;
    }

    return { serve };
}
