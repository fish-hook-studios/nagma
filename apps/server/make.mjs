import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { parseObject } from "./json-body.mjs";
import { LEGACY } from "./legacy-names.mjs";
import { AiError, stream } from "./ai-providers.mjs";

// Make: the AI app builder's two server routes.
//
// POST /ai/make asks the model for a small React + TypeScript project (only signed-in people, and
// only when the server has a model key) and streams progress back as server-sent events. GET
// /ai/make says whether a model is available. The model sees the chat so far, the project's files,
// pictures and design frames the person attached, and the design system they chose; it answers
// with the files to write as JSON.
//
// /apps/<id>/ serves apps people published from Make: static files built in the browser and
// uploaded by an editor of the Make file. They're served sandboxed (their own opaque origin), so a
// published app can't read anything of the editor's on the same address.

const MAX_REQUEST = 12 * 1024 * 1024;
const MAX_APP = 8 * 1024 * 1024;
const MAX_FILES = 80;
const MAX_FILE = 256 * 1024;
const MAX_IMAGES = 8;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const validAppId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(id);
const validPath = (p) => typeof p === "string" && p.length > 0 && p.length <= 200 && /^[A-Za-z0-9._@\-/]+$/.test(p) && !p.split("/").some((s) => s === "" || s === "." || s === "..");

const SYSTEM = [
    "You build small web apps inside Nagma Make, a design tool's prompt-to-app builder. Each answer changes a React 19 + TypeScript project.",
    "",
    "How the project runs:",
    "- It runs in the browser with no build server: every .ts/.tsx file is transformed in the browser and loaded as an ES module.",
    "- index.html loads /src/main.tsx, which renders <App /> from src/App.tsx into #root with react-dom/client.",
    "- Bare imports (npm packages) load from a CDN that serves npm packages as ES modules. Use packages that work in the browser without a bundler plugin; prefer few dependencies. List any you use in package.json dependencies.",
    "- CSS files can be imported from modules (import \"./App.css\"). Tailwind CSS v4 utility classes also work without setup.",
    "- There's no backend. Keep data in memory or localStorage; fake any remote data.",
    "- Relative imports may leave out the extension. The alias \"@/\" means \"src/\".",
    "",
    "How to answer:",
    "- Reply with JSON only: {\"message\": string, \"files\": [{\"path\": string, \"content\": string}], \"deleted\": [string]}.",
    "- message: one to three short sentences telling the person what you changed. No markdown headings.",
    "- files: only the files you add or change, each with its full new content. Paths are relative to the project root, like src/App.tsx.",
    "- deleted: paths of files to remove (usually empty).",
    "- Keep the project small and readable: a few components in src/components when it helps, typed props, no unused code.",
    "- Build what was asked with care for the visual design: spacing, type scale, colour, states (hover, focus, empty, loading) and accessibility (labels, roles, keyboard use). Make it responsive.",
    "- When design frames are attached, match their layout, colours, type and content closely; the structured description gives exact sizes, colours and text.",
    "- When a design system is given, use its CSS variables (from src/design-system.css, already loaded) and follow its component descriptions.",
    "- When the person selected an element in the preview, change that element (its source file and line are given) unless they ask for more.",
].join("\n");

// Plan mode: the model proposes the steps it would take, without changing files, for the person to
// approve before it builds.
const PLAN_SYSTEM = [
    "Plan mode: don't change any files this time.",
    "Reply with JSON only: {\"message\": string, \"plan\": [string]}.",
    "- message: one or two sentences on the approach.",
    "- plan: 3 to 10 short, concrete steps you'd take to build the request (screens, components, data, states), in order.",
].join("\n");

// The built-in backend the person can turn on: a small key-value store on this server.
const BACKEND_SYSTEM = [
    "The project has a backend for storing data: src/lib/backend.ts (already written; don't change it).",
    "It exports collection(name) with async list(), add(item), update(id, patch) and remove(id); items are plain JSON objects with an id.",
    "Use it for data the app should keep between visits and share between people (lists, posts, sign-ups), instead of localStorage.",
].join("\n");

const PLAN_SCHEMA = {
    type: "object",
    properties: { message: { type: "string" }, plan: { type: "array", items: { type: "string" } } },
    required: ["message", "plan"],
    additionalProperties: false,
};

// Models people may pick (ANTHROPIC_MAKE_MODELS, comma separated, overrides the list).
const MODEL_CHOICES = [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
];
const MCP_URL = /^https:\/\/[^\s/$.?#][^\s]{3,500}$/;

const SCHEMA = {
    type: "object",
    properties: {
        message: { type: "string" },
        files: { type: "array", items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false } },
        deleted: { type: "array", items: { type: "string" } },
    },
    required: ["message", "files", "deleted"],
    additionalProperties: false,
};

const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".map": "application/json",
};

// Models with server-side refusal fallback ("default" picks the fallback by refusal category).
const FALLBACK_MODELS = /^claude-(opus-5|opus-5-5|sonnet-5-5|fable-5-1)$/;

export function createMake({ ai, readBody, CORS, DATA, userFromReq, needsVerification = () => false, loadRoom, roleFor, saveAccounts, gate, appToken, appTokenOk }) {
    const APPS = join(DATA, "apps");
    const model = () => process.env.ANTHROPIC_MAKE_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
    const models = () => {
        const custom = (process.env.ANTHROPIC_MAKE_MODELS ?? "").split(",").map((m) => m.trim()).filter((m) => /^[a-z0-9.-]{3,80}$/.test(m));
        const list = custom.length ? custom.map((id) => MODEL_CHOICES.find((m) => m.id === id) ?? { id, label: id }) : MODEL_CHOICES;
        return list.some((m) => m.id === model()) ? list : [{ id: model(), label: model() }, ...list];
    };
    const text = (res, status, body) => (res.writeHead(status, { ...CORS, "content-type": "text/plain; charset=utf-8" }).end(body), true);
    const json = (res, status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);

    // The conversation for the model: earlier turns as text, the newest with the files, pictures,
    // frames, design system and selected element.
    function buildMessages(body) {
        const turns = Array.isArray(body.history) ? body.history.slice(-30) : [];
        const messages = [];
        for (const t of turns) {
            const role = t?.role === "assistant" ? "assistant" : "user";
            const content = String(t?.text ?? "").slice(0, 8000);
            if (!content.trim()) continue;
            const last = messages[messages.length - 1];
            if (last && last.role === role) last.content[0].text += `\n\n${content}`;
            else messages.push({ role, content: [{ type: "text", text: content }] });
        }
        while (messages[0]?.role === "assistant") messages.shift();
        const files = Array.isArray(body.files) ? body.files.filter((f) => validPath(f?.path) && typeof f.content === "string").slice(0, MAX_FILES) : [];
        const blocks = [];
        const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
        for (const image of images) {
            const match = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(image?.data ?? ""));
            if (!match || !IMAGE_TYPES.has(match[1])) continue;
            blocks.push({ type: "text", text: image.label ? `Attached: ${String(image.label).slice(0, 200)}` : "Attached picture" });
            blocks.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
        }
        const parts = [];
        // The project's guidelines.md: the person's standing instructions, read before everything else.
        const guidelines = files.find((f) => f.path === "guidelines.md" || f.path === "guidelines/Guidelines.md");
        if (guidelines?.content.trim()) parts.push(`Project guidelines (guidelines.md). Always follow these:\n${guidelines.content.slice(0, MAX_FILE)}`);
        parts.push(files.length ? `The project's files now:\n${files.map((f) => `--- ${f.path}\n${f.content.slice(0, MAX_FILE)}`).join("\n\n")}` : "The project is empty: create it from scratch (index.html, src/main.tsx, src/App.tsx, src/App.css and package.json).");
        for (const frame of Array.isArray(body.frames) ? body.frames.slice(0, MAX_IMAGES) : []) parts.push(`Design frame "${String(frame?.name ?? "Frame").slice(0, 200)}" as structured data:\n${String(frame?.description ?? "").slice(0, 40000)}`);
        if (typeof body.designSystem === "string" && body.designSystem.trim()) parts.push(`Design system:\n${body.designSystem.slice(0, 60000)}`);
        if (typeof body.element === "string" && body.element.trim()) parts.push(`The person selected this element in the preview:\n${body.element.slice(0, 4000)}`);
        parts.push(`Request: ${String(body.prompt ?? "").slice(0, 20000)}`);
        const newest = { role: "user", content: [...blocks, { type: "text", text: parts.join("\n\n") }] };
        const last = messages[messages.length - 1];
        if (last?.role === "user") last.content.push(...newest.content);
        else messages.push(newest);
        return messages;
    }

    function cleanResult(raw) {
        const out = { message: String(raw?.message ?? "").slice(0, 4000), files: [], deleted: [] };
        for (const f of Array.isArray(raw?.files) ? raw.files : []) {
            if (!validPath(f?.path) || typeof f.content !== "string" || f.content.length > MAX_FILE) continue;
            if (out.files.length >= MAX_FILES) break;
            out.files.push({ path: f.path, content: f.content });
        }
        for (const p of Array.isArray(raw?.deleted) ? raw.deleted : []) if (validPath(p)) out.deleted.push(p);
        return out;
    }

    // A picked model for this request: the person's choice among the models their key can use
    // (their own key), or among the server's list (the shared key).
    function pickModel(r, wanted) {
        if (r.source === "shared") return typeof wanted === "string" && models().some((m) => m.id === wanted) ? wanted : model();
        const mine = ai.storedModels(r.w);
        return typeof wanted === "string" && mine.some((m) => m.id === wanted) ? wanted : r.cfg.model;
    }

    async function generate(req, res) {
        // The key first: signed-out callers without a key of their own learn nothing about the server.
        const r = ai.resolve(req);
        if (r.none) return json(res, r.none.status, r.none.body);
        let body;
        try {
            ai.allow(r.w);
            body = parseObject(await readBody(req, MAX_REQUEST));
        } catch (error) {
            if (error instanceof AiError) return json(res, error.status, { error: error.message, code: error.code });
            return json(res, 413, { error: error?.message === "too large" ? "That request is too large. Attach fewer or smaller pictures." : "That request couldn't be read." });
        }
        if (!String(body.prompt ?? "").trim()) return json(res, 400, { error: "Say what to build." });
        const cfg = { ...r.cfg, model: pickModel(r, body.model) };
        const claude = cfg.provider === "anthropic";
        const fallback = claude && FALLBACK_MODELS.test(cfg.model);
        const plan = body.mode === "plan";
        // Web search and fetch (Claude's server tools) and the person's MCP connectors: Claude only.
        const tools = [];
        const betas = fallback ? ["server-side-fallback-2026-07-01"] : [];
        const wantsWeb = body.web === true;
        const mcp = (Array.isArray(body.mcp) ? body.mcp : [])
            .filter((c) => typeof c?.url === "string" && MCP_URL.test(c.url) && typeof c?.name === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(c.name))
            .slice(0, 5)
            .map((c) => ({ type: "url", url: c.url, name: c.name, ...(typeof c.token === "string" && c.token ? { authorization_token: c.token.slice(0, 4000) } : {}) }));
        if (claude && wantsWeb) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 5 }, { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5 });
        if (claude && mcp.length) {
            betas.push("mcp-client-2025-11-20");
            for (const c of mcp) tools.push({ type: "mcp_toolset", mcp_server_name: c.name });
        }
        const system = [{ type: "text", text: SYSTEM, ...(claude ? { cache_control: { type: "ephemeral" } } : {}) }];
        if (body.backend === true) system.push({ type: "text", text: BACKEND_SYSTEM });
        if (plan) system.push({ type: "text", text: PLAN_SYSTEM });
        if (tools.length) system.push({ type: "text", text: "You can search the web, fetch pages and use the connected tools when it helps. Your final reply is still the JSON object only, with nothing before or after it." });
        // Other providers: the answer's JSON comes from the instructions when they can't hold to a schema.
        if (!claude) system.push({ type: "text", text: "Reply with the JSON object only, with nothing before or after it." });
        const request = {
            model: cfg.model,
            maxTokens: plan ? 16000 : claude ? 64000 : 32000,
            system,
            messages: buildMessages(body),
            // Tool results can carry citations, which structured output doesn't allow: with tools on,
            // the JSON comes from the instructions and is read from the last text block.
            json: tools.length ? null : plan ? PLAN_SCHEMA : SCHEMA,
            anthropic: claude ? { betas, tools, thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: process.env.ANTHROPIC_MAKE_EFFORT ?? "medium" }, mcp_servers: mcp, ...(fallback ? { fallbacks: "default" } : {}) } : undefined,
        };
        const abort = new AbortController();
        res.on("close", () => abort.abort());
        let events;
        let first;
        try {
            events = stream(await ai.ensureSafe(cfg), { ...request, signal: abort.signal });
            // The first event: the model answered (or the request failed) before the stream starts.
            first = await events.next();
        } catch (error) {
            if (error instanceof AiError) {
                if (error.code !== "ai-aborted") console.warn(`Make: model error ${error.status} (${error.code})`);
                return json(res, error.status === 499 ? 400 : error.status, { error: error.message, code: error.code });
            }
            return json(res, 502, { error: "Couldn't reach the model." });
        }
        res.writeHead(200, { ...CORS, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
        const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        send("status", { text: "Thinking" });
        if (!claude && (wantsWeb || mcp.length)) send("status", { text: "Web search and connectors need a Claude key, so they're off for this answer" });
        let out = "";
        let stop = null;
        let used = {};
        let thought = "";
        const seen = new Set();
        let lastProgress = 0;
        try {
            for (let step = first; !step.done; step = await events.next()) {
                const event = step.value;
                if (event.type === "thinking") {
                    thought += event.text;
                    // Summaries arrive in pieces; pass on the latest sentence as a status.
                    const sentence = thought.trim().split(/(?<=[.!?])\s+/).filter(Boolean).at(-1);
                    if (sentence && sentence.length > 12) send("thinking", { text: sentence.slice(0, 200) });
                }
                if (event.type === "block" && tools.length) out = "";
                if (event.type === "tool") send("status", { text: event.name === "web_search" ? "Searching the web" : event.name === "web_fetch" ? "Reading a page" : `Using ${event.name.slice(0, 60) || "a connector"}` });
                if (event.type === "text") {
                    out += event.text;
                    for (const m of out.matchAll(/"path"\s*:\s*"([^"\\]{1,200})"/g)) {
                        if (seen.has(m[1])) continue;
                        seen.add(m[1]);
                        send("file", { path: m[1] });
                    }
                    if (out.length - lastProgress > 1500) {
                        lastProgress = out.length;
                        send("progress", { chars: out.length });
                    }
                }
                if (event.type === "done") {
                    stop = event.stop;
                    used = event.usage;
                }
            }
        } catch (error) {
            if (!abort.signal.aborted) send("error", { message: String(error?.message ?? error) });
            res.end();
            return true;
        }
        ai.record(r.w, r.source, used);
        if (stop === "refusal") {
            send("error", { message: "The model declined this request. Try asking differently." });
            res.end();
            return true;
        }
        if (stop === "pause_turn") {
            send("error", { message: "The model paused while using tools. Send the request again to continue." });
            res.end();
            return true;
        }
        if (stop === "max_tokens") {
            send("error", { message: "The answer was too long and got cut off. Ask for a smaller change." });
            res.end();
            return true;
        }
        let result;
        try {
            const raw = tools.length || !claude ? out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1) : out;
            const parsed = JSON.parse(raw);
            result = plan ? { message: String(parsed?.message ?? "").slice(0, 4000), plan: (Array.isArray(parsed?.plan) ? parsed.plan : []).map((p) => String(p).slice(0, 500)).slice(0, 20), files: [], deleted: [] } : cleanResult(parsed);
        } catch {
            send("error", { message: "The model's answer wasn't valid. Try again." });
            res.end();
            return true;
        }
        send("done", result);
        res.end();
        return true;
    }

    // ---- Published apps ----

    const appDir = (id) => join(APPS, id);
    async function readAppMeta(id) {
        try {
            return JSON.parse(await readFile(join(appDir(id), "meta.json"), "utf8"));
        } catch {
            return null;
        }
    }

    // Editors of the Make file may publish (and republish) its app; an app made from a file kept in
    // someone's browser belongs to whoever first published it.
    async function canEdit(fileId, user, key) {
        const room = await loadRoom(fileId);
        return Boolean(room.file && roleFor(room.file, user, key ?? "") === "edit");
    }
    async function canPublish(meta, user, fileId, key) {
        if (!user) return false;
        // An existing app: its file's editors, or (an app from a file kept in a browser) its owner.
        if (meta) return meta.fileId ? canEdit(meta.fileId, user, key) : meta.owner === user.id;
        return fileId ? canEdit(fileId, user, key) : true;
    }

    async function publish(req, res, id) {
        const user = userFromReq(req);
        if (!user) return json(res, 401, { error: "Sign in to publish." });
        if (needsVerification(user)) return json(res, 403, { error: "Verify your email first. Open the link we sent you, or send a new one from the banner.", code: "email-unverified" });
        let body;
        try {
            body = parseObject(await readBody(req, MAX_APP));
        } catch (error) {
            return json(res, 413, { error: error?.message === "too large" ? "The app is too large to publish." : "That upload couldn't be read." });
        }
        const meta = await readAppMeta(id);
        const fileId = typeof body.fileId === "string" && validAppId(body.fileId) ? body.fileId : null;
        if (!(await canPublish(meta, user, fileId, typeof body.key === "string" ? body.key : null))) return json(res, 403, { error: "Only editors of this file can publish its app." });
        if (meta && !meta.fileId && fileId && !(await canEdit(fileId, user, typeof body.key === "string" ? body.key : null))) return json(res, 403, { error: "Only editors of this file can publish its app." });
        const files = Array.isArray(body.files) ? body.files : [];
        if (!files.length || files.length > 200 || !files.some((f) => f?.path === "index.html")) return json(res, 400, { error: "The app needs an index.html." });
        const tmp = join(APPS, `.${id}.${randomBytes(4).toString("hex")}`);
        try {
            for (const f of files) {
                if (!validPath(f?.path) || typeof f.content !== "string") throw new Error(`Bad file: ${String(f?.path).slice(0, 80)}`);
                const target = join(tmp, "site", f.path);
                await mkdir(join(target, ".."), { recursive: true });
                await writeFile(target, f.content);
            }
            const next = { owner: meta?.owner ?? user.id, fileId: meta?.fileId ?? fileId, name: String(body.name ?? "App").slice(0, 120), publishedAt: Date.now(), publishedBy: user.id };
            await writeFile(join(tmp, "meta.json"), JSON.stringify(next));
            await rm(appDir(id), { recursive: true, force: true });
            await rename(tmp, appDir(id));
            return json(res, 200, { ok: true, id, url: `/apps/${id}/`, publishedAt: next.publishedAt });
        } catch (error) {
            await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
            return json(res, 400, { error: String(error?.message ?? error) });
        }
    }

    async function serveApp(req, res, id, rest) {
        const user = userFromReq(req);
        if (req.method === "PUT") return publish(req, res, id);
        if (req.method === "DELETE") {
            const meta = await readAppMeta(id);
            if (!meta) return json(res, 404, { error: "No such app." });
            if (!(await canPublish(meta, user, null, new URL(req.url ?? "/", "http://local").searchParams.get("key")))) return json(res, 403, { error: "Only editors of this file can unpublish its app." });
            await rm(appDir(id), { recursive: true, force: true });
            return json(res, 200, { ok: true });
        }
        if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") return json(res, 405, { error: "Method not allowed." });
        if (rest === null) {
            res.writeHead(301, { location: `/apps/${id}/` }).end();
            return true;
        }
        // Password or team-only apps (sites.mjs).
        if (gate && !(await gate(req, res, id, `/apps/${id}/`))) return true;
        return sendApp(req, res, id, rest);
    }

    async function sendApp(req, res, id, rest) {
        const site = join(appDir(id), "site");
        let decoded;
        try {
            decoded = decodeURIComponent((rest || "index.html").replace(/^\//, "") || "index.html");
        } catch {
            return text(res, 400, "Bad address.");
        }
        const clean = normalize(decoded).replace(/^([/\\]*\.\.)+/, "");
        let path = join(site, clean);
        if (!path.startsWith(site)) return text(res, 403, "Forbidden");
        try {
            const info = await stat(path);
            if (info.isDirectory()) path = join(path, "index.html");
        } catch {
            // Paths the app routes itself (no extension) get its page.
            if (!extname(clean)) path = join(site, "index.html");
        }
        try {
            let data = await readFile(path);
            // A protected app's pages carry the token its backend calls need (they got past the gate).
            const token = appToken && extname(path).toLowerCase() === ".html" ? await appToken(id) : null;
            if (token) {
                // Apps built before the product's rename look for the token under the old name.
                const meta = `<meta name="nagma-app-token" content="${token}"><meta name="${LEGACY.appTokenMeta}" content="${token}">`;
                const html = data.toString("utf8");
                data = Buffer.from(/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + meta) : meta + html);
            }
            res.writeHead(200, {
                "content-type": CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
                "cache-control": "no-cache",
                "access-control-allow-origin": "*",
                // Its own opaque origin: no access to the editor's storage or cookies on this address.
                "content-security-policy": "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads",
                "x-content-type-options": "nosniff",
            });
            res.end(req.method === "HEAD" ? undefined : data);
        } catch {
            text(res, 404, "Not found");
        }
        return true;
    }

    // ---- GitHub: create a repository or push to one, with every file of the project ----
    // The token is the server's (GITHUB_TOKEN) or one the person pasted for this session; it is only
    // ever sent to the GitHub API, never stored or logged here.

    const githubBase = () => (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, "");
    async function github(token, method, path, body) {
        const res = await fetch(`${githubBase()}${path}`, {
            method,
            headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "Nagma-Make", ...(body ? { "content-type": "application/json" } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const error = new Error(res.status === 401 ? "GitHub didn't accept the token." : res.status === 404 ? "That repository wasn't found, or the token can't reach it." : res.status === 422 ? String(data?.errors?.[0]?.message ?? data?.message ?? "GitHub refused the change.") : `GitHub answered ${res.status}.`);
            error.status = res.status;
            throw error;
        }
        return data;
    }

    async function pushToGitHub(req, res) {
        const user = userFromReq(req);
        if (!user) return json(res, 401, { error: "Sign in to push to GitHub." });
        let body;
        try {
            body = parseObject(await readBody(req, MAX_APP));
        } catch {
            return json(res, 413, { error: "The project is too large to push." });
        }
        if (typeof body.fileId === "string" && validAppId(body.fileId) && !(await canEdit(body.fileId, user, typeof body.key === "string" ? body.key : ""))) return json(res, 403, { error: "Only editors of this file can push it." });
        const token = typeof body.token === "string" && body.token.trim() ? body.token.trim() : process.env.GITHUB_TOKEN;
        if (!token) return json(res, 400, { error: "Add a GitHub token to push." });
        const repo = String(body.repo ?? "").trim();
        if (!/^([A-Za-z0-9-]{1,39}\/)?[A-Za-z0-9._-]{1,100}$/.test(repo)) return json(res, 400, { error: "Name the repository like my-app or owner/my-app." });
        const files = Array.isArray(body.files) ? body.files.filter((f) => validPath(f?.path) && typeof f.content === "string" && f.content.length <= MAX_FILE) : [];
        if (!files.length || files.length > 500) return json(res, 400, { error: "There's nothing to push." });
        const message = String(body.message ?? "Update from Make").slice(0, 500) || "Update from Make";
        try {
            const me = await github(token, "GET", "/user");
            const [owner, name] = repo.includes("/") ? repo.split("/") : [me.login, repo];
            let info;
            let created = false;
            try {
                info = await github(token, "GET", `/repos/${owner}/${name}`);
            } catch (error) {
                if (error.status !== 404 || !body.create) throw error;
                // A new repository starts with a first commit, so the files can go on top of it.
                info = owner === me.login ? await github(token, "POST", "/user/repos", { name, private: body.private !== false, auto_init: true, description: String(body.description ?? "").slice(0, 300) }) : await github(token, "POST", `/orgs/${owner}/repos`, { name, private: body.private !== false, auto_init: true });
                created = true;
            }
            const branch = info.default_branch || "main";
            let ref;
            for (let i = 0; i < 5; i++) {
                try {
                    ref = await github(token, "GET", `/repos/${owner}/${name}/git/ref/heads/${branch}`);
                    break;
                } catch (error) {
                    // A repository GitHub is still setting up.
                    if (!created || i === 4) throw error;
                    await new Promise((r) => setTimeout(r, 800));
                }
            }
            const parent = ref.object.sha;
            const base = await github(token, "GET", `/repos/${owner}/${name}/git/commits/${parent}`);
            const tree = [];
            for (const f of files) {
                const blob = await github(token, "POST", `/repos/${owner}/${name}/git/blobs`, { content: f.content, encoding: "utf-8" });
                tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
            }
            const nextTree = await github(token, "POST", `/repos/${owner}/${name}/git/trees`, { base_tree: base.tree.sha, tree });
            const commit = await github(token, "POST", `/repos/${owner}/${name}/git/commits`, { message, tree: nextTree.sha, parents: [parent] });
            await github(token, "PATCH", `/repos/${owner}/${name}/git/refs/heads/${branch}`, { sha: commit.sha });
            return json(res, 200, { ok: true, repo: `${owner}/${name}`, url: info.html_url ?? `https://github.com/${owner}/${name}`, branch, commit: commit.sha, created });
        } catch (error) {
            return json(res, error.status === 401 ? 401 : 502, { error: String(error?.message ?? "Pushing to GitHub failed.") });
        }
    }

    // ---- Kits and templates: projects people publish for others on this server to start from ----
    // A kit is components, styles and guidelines to build with; a template is a whole app.

    const LIBRARY = join(DATA, "make-library.json");
    let library = null;
    async function loadLibrary() {
        if (library) return library;
        try {
            library = JSON.parse(await readFile(LIBRARY, "utf8"));
        } catch {
            library = { items: [] };
        }
        return library;
    }
    async function serveLibrary(req, res, url) {
        const user = userFromReq(req);
        const lib = await loadLibrary();
        const summary = (i) => ({ id: i.id, kind: i.kind, name: i.name, description: i.description, by: i.byName, updatedAt: i.updatedAt, files: Object.keys(i.files).length, mine: Boolean(user && i.owner === user.id) });
        if (req.method === "GET") {
            const id = url.searchParams.get("id");
            if (id) {
                const item = lib.items.find((i) => i.id === id);
                return item ? json(res, 200, { ...summary(item), files: item.files }) : json(res, 404, { error: "No such kit or template." });
            }
            const kind = url.searchParams.get("kind");
            return json(res, 200, { items: lib.items.filter((i) => !kind || i.kind === kind).map(summary) });
        }
        if (!user) return json(res, 401, { error: "Sign in to publish kits and templates." });
        if (req.method === "DELETE") {
            const id = url.searchParams.get("id");
            const item = lib.items.find((i) => i.id === id);
            if (!item) return json(res, 404, { error: "No such kit or template." });
            if (item.owner !== user.id) return json(res, 403, { error: "Only the person who published it can remove it." });
            lib.items = lib.items.filter((i) => i !== item);
            await writeFile(LIBRARY, JSON.stringify(lib));
            return json(res, 200, { ok: true });
        }
        if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });
        let body;
        try {
            body = parseObject(await readBody(req, MAX_APP));
        } catch {
            return json(res, 413, { error: "That's too large to publish." });
        }
        const kind = body.kind === "kit" ? "kit" : body.kind === "template" ? "template" : null;
        const name = String(body.name ?? "").trim().slice(0, 80);
        if (!kind || !name) return json(res, 400, { error: "Give it a name." });
        const files = {};
        for (const [path, content] of Object.entries(body.files ?? {}).slice(0, MAX_FILES)) if (validPath(path) && typeof content === "string" && content.length <= MAX_FILE) files[path] = content;
        if (!Object.keys(files).length) return json(res, 400, { error: "There's nothing to publish." });
        // Publishing again under the same id updates it.
        const existing = typeof body.id === "string" ? lib.items.find((i) => i.id === body.id && i.owner === user.id) : null;
        const item = existing ?? { id: randomBytes(9).toString("base64url"), owner: user.id };
        Object.assign(item, { kind, name, description: String(body.description ?? "").slice(0, 400), files, byName: user.name ?? "Someone", updatedAt: Date.now() });
        if (!existing) lib.items.unshift(item);
        lib.items = lib.items.slice(0, 500);
        await writeFile(LIBRARY, JSON.stringify(lib));
        return json(res, 200, summary(item));
    }

    // ---- The built-in backend: a small JSON store per app (collections of items) ----
    // An app's store exists once a signed-in editor turns the backend on; the app reads and writes it
    // from the preview and the published site. Limits keep it small: 50 collections, 2 MB in all.

    const STORES = join(DATA, "app-data");
    const MAX_STORE = 2 * 1024 * 1024;
    const stores = new Map();
    const storePath = (id) => join(STORES, `${id}.json`);
    async function loadStore(id) {
        if (stores.has(id)) return stores.get(id);
        try {
            const store = JSON.parse(await readFile(storePath(id), "utf8"));
            stores.set(id, store);
            return store;
        } catch {
            return null;
        }
    }
    async function saveStore(id, store) {
        const text = JSON.stringify(store);
        if (text.length > MAX_STORE) return false;
        await mkdir(STORES, { recursive: true });
        await writeFile(storePath(id), text);
        stores.set(id, store);
        return true;
    }
    async function registerBackend(req, res) {
        const user = userFromReq(req);
        if (!user) return json(res, 401, { error: "Sign in to add a backend." });
        let body;
        try {
            body = parseObject(await readBody(req, 4096));
        } catch {
            return json(res, 400, { error: "That request couldn't be read." });
        }
        if (!validAppId(body.appId)) return json(res, 400, { error: "That app id isn't valid." });
        const existing = await loadStore(body.appId);
        if (existing && existing.owner !== user.id) return json(res, 403, { error: "That backend belongs to someone else." });
        if (!existing) await saveStore(body.appId, { owner: user.id, collections: {} });
        return json(res, 200, { ok: true, url: `/app-data/${body.appId}` });
    }
    // A data token for an editor's preview of a protected app (anyone who can open its file, or the
    // backend's owner). Public apps get { token: null }.
    async function previewToken(req, res) {
        const user = userFromReq(req);
        if (!user) return json(res, 401, { error: "Sign in first." });
        let body;
        try {
            body = parseObject(await readBody(req, 4096));
        } catch {
            return json(res, 400, { error: "That request couldn't be read." });
        }
        if (!validAppId(body.appId)) return json(res, 400, { error: "That app id isn't valid." });
        const store = await loadStore(body.appId);
        const room = store && store.owner === user.id ? null : await loadRoom(body.appId);
        const fileId = typeof body.fileId === "string" && validAppId(body.fileId) ? body.fileId : null;
        const viaFile = fileId && fileId !== body.appId ? await loadRoom(fileId) : null;
        const ok = (store && store.owner === user.id) || (room?.file && roleFor(room.file, user, String(body.key ?? ""))) || (viaFile?.file && Object.values(viaFile.file.doc?.nodes ?? {}).some((n) => n?.make?.appId === body.appId) && roleFor(viaFile.file, user, String(body.key ?? "")));
        if (!ok) return json(res, 403, { error: "No access to this app's data." });
        return json(res, 200, { token: appToken ? await appToken(body.appId) : null });
    }
    async function serveAppData(req, res, id, name, itemId) {
        const open = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS", "access-control-allow-headers": `content-type, x-nagma-app-token, ${LEGACY.appTokenHeader}` };
        const reply = (status, body) => (res.writeHead(status, { ...open, "content-type": "application/json" }).end(JSON.stringify(body)), true);
        if (req.method === "OPTIONS") return (res.writeHead(204, open).end(), true);
        const store = await loadStore(id);
        if (!store) return reply(404, { error: "This app has no backend." });
        // A password or team-only app's data needs the token its page (or the editor's preview) got.
        if (appTokenOk && !(await appTokenOk(id, req.headers["x-nagma-app-token"] ?? req.headers[LEGACY.appTokenHeader]))) return reply(401, { error: "This app is protected. Open it again to sign in or enter its password." });
        // Collections are kept by name in a plain object: names that reach Object.prototype
        // ("__proto__", "constructor", "toString"...) would read its properties, so they aren't names.
        if (name in Object.prototype) return reply(400, { error: "That collection name isn't allowed." });
        const list = Object.hasOwn(store.collections, name) && Array.isArray(store.collections[name]) ? store.collections[name] : [];
        if (req.method === "GET") return reply(200, itemId ? (list.find((i) => i.id === itemId) ?? null) : list);
        let body = null;
        if (req.method === "POST" || req.method === "PUT") {
            try {
                body = parseObject(await readBody(req, 64 * 1024));
            } catch (error) {
                return error?.message === "too large" ? reply(413, { error: "Items can be up to 64 KB." }) : reply(400, { error: "Send a JSON object." });
            }
            if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { error: "Send a JSON object." });
        }
        if (!Object.hasOwn(store.collections, name) && Object.keys(store.collections).length >= 50) return reply(400, { error: "This backend has too many collections." });
        let out;
        if (req.method === "POST") {
            out = { ...body, id: randomBytes(6).toString("base64url"), createdAt: Date.now() };
            store.collections[name] = [...list, out];
        } else if (req.method === "PUT" && itemId) {
            const at = list.findIndex((i) => i.id === itemId);
            if (at < 0) return reply(404, { error: "No such item." });
            out = { ...list[at], ...body, id: itemId };
            store.collections[name] = list.map((i, n) => (n === at ? out : i));
        } else if (req.method === "DELETE" && itemId) {
            store.collections[name] = list.filter((i) => i.id !== itemId);
            out = { ok: true };
        } else return reply(405, { error: "Method not allowed." });
        if (!(await saveStore(id, store))) {
            stores.delete(id);
            return reply(413, { error: "This backend is full." });
        }
        return reply(200, out);
    }

    async function serve(req, res) {
        const url = new URL(req.url ?? "/", "http://local");
        const path = url.pathname;
        if (path === "/ai/make" && req.method === "GET") {
            // What's set up (model, models, a GitHub token) is only reported to signed-in people.
            // Signed out, only a key of your own (this device's, or one sent from the browser) is reported.
            const r = ai.resolve(req);
            const signedIn = Boolean(r.w.user);
            if (r.none) return json(res, 200, signedIn ? { available: false, keyNeeded: true, model: null, models: [], signedIn, github: Boolean(process.env.GITHUB_TOKEN) } : { signedIn: false });
            const mine = r.source === "own" ? ai.storedModels(r.w) : models();
            const list = r.source === "own" ? (mine.some((m) => m.id === r.cfg.model) ? mine : [{ id: r.cfg.model, label: r.cfg.model }, ...mine]).slice(0, 60) : mine;
            return json(res, 200, { available: true, model: r.source === "own" ? r.cfg.model : model(), models: list, provider: r.cfg.provider, source: r.source, signedIn, github: signedIn && Boolean(process.env.GITHUB_TOKEN) });
        }
        if (path === "/ai/make/github" && req.method === "POST") return pushToGitHub(req, res);
        if (path === "/ai/make/library") return serveLibrary(req, res, url);
        if (path === "/ai/make/backend" && req.method === "POST") return registerBackend(req, res);
        if (path === "/ai/make/backend/token" && req.method === "POST") return previewToken(req, res);
        const data = /^\/app-data\/([A-Za-z0-9_-]{6,64})\/([A-Za-z0-9_-]{1,40})(?:\/([A-Za-z0-9_-]{1,40}))?$/.exec(path);
        if (data) return serveAppData(req, res, data[1], data[2], data[3] ?? null);
        if (path === "/ai/make" && req.method === "POST") return generate(req, res);
        const app = /^\/apps\/([A-Za-z0-9_-]{6,64})(?:\/(.*))?$/.exec(path);
        if (app && validAppId(app[1])) {
            await mkdir(APPS, { recursive: true });
            return serveApp(req, res, app[1], app[2] ?? (path.endsWith("/") ? "" : null));
        }
        return false;
    }

    // For sites.mjs: a published app's status, its files, and who may manage its address.
    const hosting = {
        status: async (id) => ({ published: Boolean(await readAppMeta(id)) }),
        send: (req, res, id, rest) => sendApp(req, res, id, rest),
        async role(req, url, id) {
            const meta = await readAppMeta(id);
            if (!meta) return { error: "No such app.", status: 404 };
            const user = userFromReq(req);
            if (await canPublish(meta, user, null, url.searchParams.get("key"))) return { role: "edit" };
            return user ? { role: "view" } : { error: "Sign in first.", status: 401 };
        },
    };

    return { serve, hosting };
}
