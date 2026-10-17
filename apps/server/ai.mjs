// AI keys: everyone brings their own. Each account keeps a provider (Claude, OpenAI, or a server
// that speaks the OpenAI API, such as a local model), a key, a model and an image provider, set in
// Account settings › AI. Keys are encrypted at rest (AES-256-GCM, with a key derived by scrypt from
// NAGMA_SECRET_KEY, or from a secret generated into the data folder on first run), never sent back
// to the app after saving and never logged.
//
// Who pays for a request, in order: the person's own key; then the server's shared key
// (ANTHROPIC_API_KEY, for signed-in people, unless NAGMA_SHARED_AI=0); otherwise the route answers
// with code "ai-key-needed" and the app shows where to add a key.
//
// Without an account: in the desktop app (NAGMA_LOCAL_DEVICE=1, a server on this computer) the key
// is kept by that server for this device, the same way; in a browser it stays in the browser and
// comes with each request in the x-nagma-ai header.
//
// Requests and tokens are counted per person per day (ai-usage.json) for the AI tab and, for the
// shared key, the admin console. Each person gets NAGMA_AI_PER_MINUTE requests a minute (30).
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { saveLater } from "./atomic-write.mjs";
import { parseObject } from "./json-body.mjs";
import { AiError, IMAGE_PROVIDERS, PROVIDERS, complete, generateImage, listModels, testKey } from "./ai-providers.mjs";

export const KEY_NEEDED = "Add your AI key in Account settings to use this.";
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_KEY = 600;
const KEEP_DAYS = 60;

// ---- Encryption ----

// The server's secret: NAGMA_SECRET_KEY, or one made once and kept in the data folder.
export function loadSecret(DATA, log = console.log) {
    if (process.env.NAGMA_SECRET_KEY) return process.env.NAGMA_SECRET_KEY;
    const path = join(DATA, "secret-key");
    try {
        const saved = readFileSync(path, "utf8").trim();
        if (saved) return saved;
    } catch {
        // Made below.
    }
    const secret = randomBytes(32).toString("hex");
    writeFileSync(path, `${secret}\n`, { mode: 0o600 });
    try {
        chmodSync(path, 0o600);
    } catch {
        // Not every file system has modes.
    }
    log(`Generated the secret that encrypts AI keys: ${path}. Back it up with the data folder, or set NAGMA_SECRET_KEY.`);
    return secret;
}

export function keyring(secret) {
    const key = scryptSync(String(secret), "nagma-ai-keys-v1", 32);
    return {
        // `bind` ties the ciphertext to its owner and use, so a value copied to another record won't open.
        seal(plain, bind) {
            const iv = randomBytes(12);
            const cipher = createCipheriv("aes-256-gcm", key, iv);
            cipher.setAAD(Buffer.from(bind));
            const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
            return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
        },
        open(sealed, bind) {
            const [v, iv, tag, data] = String(sealed ?? "").split(".");
            if (v !== "v1" || !iv || !tag || data === undefined) return null;
            try {
                const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
                decipher.setAAD(Buffer.from(bind));
                decipher.setAuthTag(Buffer.from(tag, "base64url"));
                return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
            } catch {
                return null;
            }
        },
    };
}

const keyEnd = (key) => (key ? String(key).slice(-4) : "");
const today = (t = Date.now()) => new Date(t).toLocaleDateString("sv");
const cleanKey = (v) => (typeof v === "string" ? v.trim() : "");
const validKey = (k) => k.length >= 8 && k.length <= MAX_KEY && !/\s/.test(k);
const validModel = (m) => typeof m === "string" && /^[A-Za-z0-9._:/@-]{1,120}$/.test(m);

export function createAi({ DATA, readBody, CORS, userFromReq, userById, teamById, teamRole, isServerAdmin, checkPublicUrl, saveAccounts = () => undefined, log = console.log }) {
    const ring = keyring(loadSecret(DATA, log));
    const KEYS = join(DATA, "ai-keys.json");
    const USAGE = join(DATA, "ai-usage.json");
    let store = { owners: {} };
    let usage = { days: {} };
    const ready = Promise.all([
        readFile(KEYS, "utf8").then((t) => (store = { owners: {}, ...JSON.parse(t) }), () => undefined),
        readFile(USAGE, "utf8").then((t) => (usage = { days: {}, ...JSON.parse(t) }), () => undefined),
    ]);
    const saveKeys = () => saveLater(KEYS, JSON.stringify(store), { mode: 0o600 });
    let usageTimer = null;
    const saveUsage = () => {
        clearTimeout(usageTimer);
        usageTimer = setTimeout(() => saveLater(USAGE, JSON.stringify(usage)), 200);
    };

    const deviceMode = () => process.env.NAGMA_LOCAL_DEVICE === "1";
    const privateUrls = () => deviceMode() || process.env.NAGMA_AI_PRIVATE_URLS === "1";
    const sharedOn = () => process.env.NAGMA_SHARED_AI !== "0";
    const sharedKey = () => (sharedOn() ? (process.env.ANTHROPIC_API_KEY ?? "") : "");
    const sharedModel = () => process.env.ANTHROPIC_MODEL ?? PROVIDERS.anthropic.defaultModel;
    const sharedImage = () => (sharedOn() && process.env.NAGMA_IMAGE_API_URL && process.env.NAGMA_IMAGE_API_KEY ? { provider: "compatible", endpoint: process.env.NAGMA_IMAGE_API_URL, key: process.env.NAGMA_IMAGE_API_KEY, model: process.env.NAGMA_IMAGE_MODEL ?? "" } : null);
    const perMinute = () => Math.max(1, Number(process.env.NAGMA_AI_PER_MINUTE ?? 30) || 30);

    // ---- Who is asking ----

    // Only this computer's own pages count as the device: a loopback connection, to a loopback host
    // name (not a name rebound to 127.0.0.1), from no page or from this server's own page.
    function localRequest(req) {
        if (!LOOPBACK.has(req.socket?.remoteAddress ?? "")) return false;
        const host = String(req.headers.host ?? "");
        if (!LOOPBACK_HOSTS.has(host.replace(/:\d+$/, ""))) return false;
        const origin = req.headers.origin;
        if (!origin) return true;
        try {
            return new URL(origin).host === host;
        } catch {
            return false;
        }
    }

    // A key kept in the browser, sent with the request (base64url JSON).
    function browserConfig(req) {
        const raw = req.headers["x-nagma-ai"];
        if (typeof raw !== "string" || !raw || raw.length > 8192) return null;
        try {
            const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
            const text = v && typeof v === "object" && PROVIDERS[v.provider] ? { provider: v.provider, key: cleanKey(v.key), model: validModel(v.model) ? v.model : PROVIDERS[v.provider].defaultModel, baseUrl: typeof v.baseUrl === "string" ? v.baseUrl.slice(0, 500) : "" } : null;
            const image = v?.image && IMAGE_PROVIDERS[v.image.provider] ? { provider: v.image.provider, key: cleanKey(v.image.key), model: validModel(v.image.model) ? v.image.model : IMAGE_PROVIDERS[v.image.provider].defaultModel, baseUrl: typeof v.image.baseUrl === "string" ? v.image.baseUrl.slice(0, 500) : "" } : null;
            return { text: text && (text.key || text.provider === "compatible") ? text : null, image };
        } catch {
            return null;
        }
    }

    // { user, scope: "account" | "device" | "browser", owner } — owner names the stored record (or,
    // for a browser, its usage line: a hash of the key, never the key).
    function who(req) {
        const user = userFromReq(req);
        if (user) return { user, scope: "account", owner: user.id };
        if (deviceMode() && localRequest(req)) return { user: null, scope: "device", owner: "device" };
        const cfg = browserConfig(req);
        const id = cfg?.text?.key || cfg?.image?.key || cfg?.text?.baseUrl || "";
        return { user: null, scope: "browser", owner: id ? `browser:${createHash("sha256").update(id).digest("hex").slice(0, 16)}` : `ip:${req.socket?.remoteAddress ?? "?"}`, browser: cfg };
    }

    function stored(owner, part) {
        const rec = store.owners[owner]?.[part];
        if (!rec) return null;
        const key = rec.key ? ring.open(rec.key, `${owner}:${part}`) : "";
        if (rec.key && key === null) {
            log(`An AI key saved for ${owner === "device" ? "this device" : "an account"} can't be opened: the server's secret changed. It has to be added again.`);
            return null;
        }
        return { ...rec, key };
    }
    function storeKey(owner, part, rec) {
        store.owners[owner] ??= {};
        const { key, ...rest } = rec;
        store.owners[owner][part] = { ...rest, key: key ? ring.seal(key, `${owner}:${part}`) : "", keyEnd: keyEnd(key), savedAt: Date.now() };
        saveKeys();
    }
    function forget(owner, part) {
        if (!store.owners[owner]) return;
        if (part) delete store.owners[owner][part];
        else delete store.owners[owner];
        if (store.owners[owner] && !Object.keys(store.owners[owner]).length) delete store.owners[owner];
        saveKeys();
    }

    // The person's own text model, if they set one.
    function ownText(w) {
        if (w.scope === "browser") return w.browser?.text ?? null;
        const rec = stored(w.owner, "text");
        return rec ? { provider: rec.provider, key: rec.key, model: rec.model, baseUrl: rec.baseUrl ?? "" } : null;
    }
    function ownImage(w) {
        const own = w.scope === "browser" ? w.browser?.image : stored(w.owner, "image");
        if (own?.provider) {
            // OpenAI images with no key of their own use the person's OpenAI text key.
            if (!own.key && own.provider === "openai") {
                const text = ownText(w);
                if (text?.provider === "openai" && text.key) return { provider: "openai", key: text.key, model: own.model || IMAGE_PROVIDERS.openai.defaultModel, baseUrl: "" };
                return null;
            }
            return { provider: own.provider, key: own.key, model: own.model ?? "", baseUrl: own.baseUrl ?? "" };
        }
        return null;
    }

    // Which key answers this request: { cfg, source: "own" | "shared", w } or { none: { status, body } }.
    function resolve(req) {
        const w = who(req);
        const own = ownText(w);
        if (own) return { cfg: own, source: "own", w };
        const key = w.user ? sharedKey() : "";
        if (key) return { cfg: { provider: "anthropic", key, model: sharedModel(), baseUrl: "" }, source: "shared", w };
        return { none: noKey(w), w };
    }
    function resolveImage(req) {
        const w = who(req);
        const own = ownImage(w);
        if (own) return { cfg: own, source: "own", w };
        const shared = w.user ? sharedImage() : null;
        if (shared) return { cfg: shared, source: "shared", w };
        return { none: noKey(w), w };
    }
    // Signed out answers 401 (as before), signed in 412: both say where to add a key.
    const noKey = (w) => ({ status: w.user || w.scope === "device" ? 412 : 401, body: { error: KEY_NEEDED, code: "ai-key-needed" } });

    // ---- Limits and usage ----

    const recent = new Map();
    function allow(w) {
        const now = Date.now();
        const list = (recent.get(w.owner) ?? []).filter((t) => now - t < 60_000);
        if (list.length >= perMinute()) {
            recent.set(w.owner, list);
            throw new AiError(`That's ${perMinute()} AI requests in a minute. Wait a moment and try again.`, 429, "ai-rate-limited");
        }
        list.push(now);
        recent.set(w.owner, list);
        if (recent.size > 5000) for (const [k, v] of recent) if (!v.some((t) => now - t < 60_000)) recent.delete(k);
    }

    function record(w, source, used = {}) {
        // A team AI credit is spent only when the server's shared key answered: a person's own key
        // costs the team nothing.
        if (source === "shared" && w.user) {
            w.user.aiLog = [...(w.user.aiLog ?? []), Date.now()].slice(-5000);
            saveAccounts();
        }
        const day = today();
        const lines = (usage.days[day] ??= {});
        const line = (lines[w.owner] ??= {});
        const n = (line[source === "shared" ? "shared" : "own"] ??= { requests: 0, input: 0, output: 0 });
        n.requests += 1;
        n.input += Math.max(0, Math.round(used.input ?? 0));
        n.output += Math.max(0, Math.round(used.output ?? 0));
        const days = Object.keys(usage.days).sort();
        for (const d of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete usage.days[d];
        saveUsage();
    }
    function usageOf(owner, day = today()) {
        const line = usage.days[day]?.[owner] ?? {};
        const sum = { requests: 0, input: 0, output: 0 };
        for (const n of Object.values(line)) {
            sum.requests += n.requests;
            sum.input += n.input;
            sum.output += n.output;
        }
        return { ...sum, tokens: sum.input + sum.output, shared: line.shared ? { ...line.shared, tokens: line.shared.input + line.shared.output } : null };
    }

    // ---- Settings ----

    const label = (p) => PROVIDERS[p]?.label ?? p;
    function view(w) {
        const text = w.scope === "browser" ? w.browser?.text : store.owners[w.owner]?.text;
        const image = w.scope === "browser" ? w.browser?.image : store.owners[w.owner]?.image;
        const sharedText = Boolean(w.user && sharedKey());
        return {
            scope: w.scope,
            signedIn: Boolean(w.user),
            text: text ? { provider: text.provider, model: text.model ?? "", baseUrl: text.baseUrl ?? "", keySet: Boolean(text.keyEnd ?? text.key), keyEnd: text.keyEnd ?? keyEnd(text.key), models: text.models ?? [], savedAt: text.savedAt ?? null } : null,
            image: image?.provider ? { provider: image.provider, model: image.model ?? "", baseUrl: image.baseUrl ?? "", keySet: Boolean(image.keyEnd ?? image.key), keyEnd: image.keyEnd ?? keyEnd(image.key) } : null,
            shared: { text: sharedText, image: Boolean(w.user && sharedImage()), provider: sharedText ? label("anthropic") : null, disabled: !sharedOn() },
            usage: usageOf(w.owner),
            perMinute: perMinute(),
            privateUrls: privateUrls(),
            providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, defaultModel: p.defaultModel })),
            imageProviders: Object.entries(IMAGE_PROVIDERS).map(([id, p]) => ({ id, label: p.label, defaultModel: p.defaultModel })),
        };
    }

    // An address for a compatible server: http(s), and public unless this server allows private ones.
    async function checkBase(raw) {
        let url;
        try {
            url = new URL(String(raw ?? "").trim());
        } catch {
            throw new AiError("Enter the model server's address, like https://example.com/v1.", 400, "ai-bad-address");
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new AiError("The address must start with http:// or https://.", 400, "ai-bad-address");
        if (url.username || url.password) throw new AiError("Leave the key out of the address; put it in the key field.", 400, "ai-bad-address");
        if (!privateUrls() && !(await checkPublicUrl(url.toString()))) throw new AiError("This server only reaches public addresses on port 80 or 443. Local models work in the desktop app, or on a server with NAGMA_AI_PRIVATE_URLS=1.", 400, "ai-bad-address");
        return url.toString().replace(/\/+$/, "");
    }

    // A compatible server's address is checked again on each use (its name could point elsewhere now).
    async function ensureSafe(cfg) {
        if (cfg.provider === "compatible" && !cfg.endpoint && !privateUrls()) await checkBase(cfg.baseUrl);
        return cfg;
    }

    const pickModel = (provider, models, wanted) => {
        if (wanted && (models.length === 0 || models.some((m) => m.id === wanted))) return wanted;
        const preferred = PROVIDERS[provider]?.defaultModel;
        if (preferred && (models.length === 0 || models.some((m) => m.id === preferred))) return preferred;
        return models[0]?.id ?? wanted ?? preferred ?? "";
    };

    // Saves (or, for a browser, only checks) a text model: the key must answer a test call.
    async function saveText(w, b) {
        const provider = String(b.provider ?? "");
        if (!PROVIDERS[provider]) throw new AiError("Choose Claude, OpenAI or an OpenAI-compatible server.", 400, "ai-bad-provider");
        const before = w.scope === "browser" ? null : stored(w.owner, "text");
        const sameProvider = before?.provider === provider;
        let key = cleanKey(b.key);
        if (key && !validKey(key)) throw new AiError("That doesn't look like an API key.", 400, "ai-bad-key");
        if (!key && sameProvider) key = before.key;
        if (!key && provider !== "compatible") throw new AiError(`Paste your ${label(provider)} API key.`, 400, "ai-bad-key");
        const baseUrl = provider === "compatible" ? await checkBase(b.baseUrl) : "";
        const cfg = { provider, key, baseUrl, model: "" };
        let models = [];
        try {
            models = (await listModels(cfg)).slice(0, 200);
        } catch (error) {
            if (error?.code === "ai-key-rejected") throw new AiError(`${label(provider)} didn't accept this key. Check it and try again.`, 400, "ai-key-rejected");
            models = sameProvider ? (before.models ?? []) : [];
        }
        cfg.model = pickModel(provider, models, validModel(b.model) ? b.model : sameProvider ? before.model : "");
        if (!cfg.model) throw new AiError("Choose a model.", 400, "ai-no-model");
        try {
            await testKey(cfg);
        } catch (error) {
            throw new AiError(error?.code === "ai-key-rejected" ? `${label(provider)} didn't accept this key. Check it and try again.` : `The test call failed: ${error?.message ?? "no answer"}`, 400, error?.code === "ai-key-rejected" ? "ai-key-rejected" : "ai-test-failed");
        }
        if (w.scope !== "browser") storeKey(w.owner, "text", { provider, key, baseUrl, model: cfg.model, models });
        return { model: cfg.model, models };
    }

    async function saveImage(w, b) {
        const provider = String(b.provider ?? "");
        if (provider === "none" || !provider) {
            if (w.scope !== "browser") forget(w.owner, "image");
            return {};
        }
        if (!IMAGE_PROVIDERS[provider]) throw new AiError("Choose OpenAI or a compatible endpoint.", 400, "ai-bad-provider");
        const before = w.scope === "browser" ? null : stored(w.owner, "image");
        let key = cleanKey(b.key);
        if (key && !validKey(key)) throw new AiError("That doesn't look like an API key.", 400, "ai-bad-key");
        if (!key && before?.provider === provider) key = before.key;
        const baseUrl = provider === "compatible" ? await checkBase(b.baseUrl) : "";
        const model = validModel(b.model) ? b.model : IMAGE_PROVIDERS[provider].defaultModel;
        // An OpenAI key is checked by listing its models (free); making a test picture would cost.
        const text = ownText(w);
        const checkWith = key || (provider === "openai" && text?.provider === "openai" ? text.key : "");
        if (provider === "openai" && !checkWith) throw new AiError("Paste an OpenAI key, or use OpenAI for text above.", 400, "ai-bad-key");
        if (provider === "openai") {
            try {
                await listModels({ provider: "openai", key: checkWith });
            } catch (error) {
                throw new AiError(error?.code === "ai-key-rejected" ? "OpenAI didn't accept this key. Check it and try again." : `The test call failed: ${error?.message ?? "no answer"}`, 400, error?.code === "ai-key-rejected" ? "ai-key-rejected" : "ai-test-failed");
            }
        }
        if (w.scope !== "browser") storeKey(w.owner, "image", { provider, key, baseUrl, model });
        return { model };
    }

    // ---- Routes ----

    const json = (res, status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
    const fail = (res, error) => {
        if (error instanceof AiError) return json(res, error.status === 499 ? 400 : error.status, { error: error.message, code: error.code });
        throw error;
    };
    async function body(req, limit = 64 * 1024) {
        try {
            return parseObject(await readBody(req, limit));
        } catch (error) {
            throw new AiError(error?.message === "too large" ? "That request is too large." : "That request couldn't be read.", error?.message === "too large" ? 413 : 400, "bad-request");
        }
    }

    // The agent panel, board AI, campaign fill and slide drafts: a reply and, for designs, commands.
    const CHAT_SYSTEM = [
        "You are the design agent inside Nagma, a design editor. The user asks for changes to the selected layers.",
        "Answer with the apply tool: a short reply and a list of commands. Commands are JSON objects of the form",
        '{"type":"node.update","id":"<layer id>","patch":{...}} where patch may set: name, x, y, w, h, rotation, opacity (0-1), radius,',
        'fills (array of {type:"solid",color:"#RRGGBB",opacity:1,visible:true,blend:"normal"}), strokes (same shape), strokeWidth,',
        "text, fontSize, fontWeight (100-900), textAlign (left|center|right), visible, shadow ({x,y,blur,color,opacity} or null), blur.",
        "Only use ids from the selection given. Keep changes minimal and explain them in one sentence.",
    ].join(" ");
    const APPLY = { name: "apply", description: "Reply and apply commands to the file.", schema: { type: "object", properties: { reply: { type: "string" }, commands: { type: "array", items: { type: "object" } } }, required: ["reply", "commands"] } };

    async function chat(req, res) {
        const r = resolve(req);
        if (r.none) return json(res, r.none.status, r.none.body);
        allow(r.w);
        const b = await body(req, 256 * 1024);
        const out = await complete(await ensureSafe(r.cfg), {
            system: CHAT_SYSTEM,
            maxTokens: 1500,
            tools: [APPLY],
            toolChoice: "apply",
            messages: [{ role: "user", content: `Selection: ${JSON.stringify(b.selection ?? [])}\n\nRequest: ${String(b.text ?? "").slice(0, 4000)}` }],
            timeout: 120000,
        });
        record(r.w, r.source, out.usage);
        const call = out.toolCalls.find((c) => c.name === "apply");
        const answer = call?.input ?? { reply: out.text, commands: [] };
        return json(res, 200, { reply: String(answer.reply ?? ""), commands: Array.isArray(answer.commands) ? answer.commands.filter((c) => c && c.type === "node.update" && typeof c.id === "string" && c.patch && typeof c.patch === "object") : [] });
    }

    async function image(req, res) {
        const r = resolveImage(req);
        if (r.none) return json(res, r.none.status, r.none.body);
        allow(r.w);
        const b = await body(req);
        const prompt = String(b.prompt ?? "").trim().slice(0, 1000);
        if (!prompt) return json(res, 400, { error: "Describe the image first." });
        const size = ["1024x1024", "1536x1024", "1024x1536"].includes(b.size) ? b.size : "1024x1024";
        await ensureSafe(r.cfg);
        const picture = await generateImage(r.cfg, { prompt, size });
        record(r.w, r.source, {});
        return json(res, 200, { image: picture });
    }

    // Shared key use for the admin console: a team's members (team admins), or everyone (server admins).
    function sharedUsage(req, res, url) {
        const user = userFromReq(req);
        if (!user) return json(res, 401, { error: "Sign in first." });
        const teamId = url.searchParams.get("team");
        const team = teamId ? teamById(teamId) : null;
        const admin = isServerAdmin(user);
        if (teamId && !team) return json(res, 404, { error: "No such team." });
        if (team ? teamRole(team, user) !== "admin" && !admin : !admin) return json(res, 403, { error: "Only admins see this." });
        const members = team ? new Set(Object.keys(team.members ?? {})) : null;
        const days = [];
        const people = new Map();
        for (let i = 13; i >= 0; i--) {
            const day = today(Date.now() - i * 86_400_000);
            let requests = 0;
            let tokens = 0;
            for (const [owner, line] of Object.entries(usage.days[day] ?? {})) {
                if (!line.shared || (members && !members.has(owner))) continue;
                requests += line.shared.requests;
                tokens += line.shared.input + line.shared.output;
                if (i === 0) people.set(owner, { requests: line.shared.requests, tokens: line.shared.input + line.shared.output });
            }
            days.push({ day, requests, tokens });
        }
        return json(res, 200, {
            configured: Boolean(process.env.ANTHROPIC_API_KEY),
            enabled: Boolean(sharedKey()),
            model: process.env.ANTHROPIC_API_KEY ? sharedModel() : null,
            image: Boolean(sharedImage()),
            perMinute: perMinute(),
            days,
            people: [...people.entries()].map(([id, n]) => ({ id, name: userById(id)?.name ?? "Someone", ...n })).sort((a, b) => b.requests - a.requests),
        });
    }

    async function serve(req, res) {
        const url = new URL(req.url ?? "/", "http://local");
        const path = url.pathname;
        await ready;
        try {
            if (path === "/ai/chat" && req.method === "POST") return await chat(req, res);
            if (path === "/providers/image" && req.method === "POST") return await image(req, res);
            if (path === "/providers" && req.method === "GET") {
                const r = resolveImage(req);
                return json(res, 200, { stock: Boolean(process.env.NAGMA_STOCK_KEY), stockProvider: process.env.NAGMA_STOCK_PROVIDER === "pexels" ? "Pexels" : "Unsplash", image: !r.none, imageKeyNeeded: Boolean(r.none) });
            }
            if (path === "/ai/shared-usage" && req.method === "GET") return sharedUsage(req, res, url);
            const m = /^\/ai\/settings(?:\/(image|test|models))?$/.exec(path);
            if (!m) return false;
            const w = who(req);
            const part = m[1] ?? null;
            if (!part && req.method === "GET") return json(res, 200, view(w));
            if (!part && req.method === "PUT") {
                const out = await saveText(w, await body(req));
                return json(res, 200, { ...view(who(req)), saved: out });
            }
            if (part === "image" && req.method === "PUT") {
                const out = await saveImage(w, await body(req));
                return json(res, 200, { ...view(who(req)), saved: out });
            }
            if (!part && req.method === "DELETE") {
                if (w.scope !== "browser") forget(w.owner, "text");
                return json(res, 200, view(w));
            }
            if (part === "image" && req.method === "DELETE") {
                if (w.scope !== "browser") forget(w.owner, "image");
                return json(res, 200, view(w));
            }
            if (part === "test" && req.method === "POST") {
                const own = ownText(w);
                if (!own) return json(res, 400, { ok: false, error: "Add a key first.", code: "ai-key-needed" });
                allow(w);
                try {
                    const out = await testKey(await ensureSafe(own));
                    record(w, "own", out.usage);
                    return json(res, 200, { ok: true, ms: out.ms, model: own.model, provider: own.provider });
                } catch (error) {
                    if (!(error instanceof AiError)) throw error;
                    return json(res, 200, { ok: false, error: error.message, code: error.code });
                }
            }
            if (part === "models" && req.method === "POST") {
                const own = ownText(w);
                if (!own) return json(res, 400, { error: "Add a key first.", code: "ai-key-needed" });
                const models = (await listModels(await ensureSafe(own))).slice(0, 200);
                if (w.scope !== "browser") {
                    const rec = store.owners[w.owner]?.text;
                    if (rec) rec.models = models;
                    saveKeys();
                }
                return json(res, 200, { models });
            }
            return json(res, 405, { error: "Method not allowed." });
        } catch (error) {
            return fail(res, error);
        }
    }

    // Whether this person has an AI key of their own (so team credits never apply to them).
    const hasOwnKey = (user) => Boolean(user && ownText({ user, scope: "account", owner: user.id }));
    return { serve, resolve, resolveImage, allow, record, ensureSafe, hasOwnKey, forget: (userId) => forget(userId), storedModels: (w) => (w.scope === "browser" ? [] : (store.owners[w.owner]?.text?.models ?? [])), sharedOn, ready };
}
