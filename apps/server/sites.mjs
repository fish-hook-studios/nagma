import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseObject } from "./json-body.mjs";
import { LEGACY } from "./legacy-names.mjs";
import { writeAtomic } from "./atomic-write.mjs";

// Where published sites live besides /sites/<file id>/, and who may see them.
//
// - A name: the site is served at /s/<name>/ on this server, and at <name>.<sites domain> when the
//   server is reached by that host (NAGMA_SITES_DOMAIN, "localhost" by default, so
//   http://<name>.localhost:<port>/ works on this machine).
// - A custom domain: served at the domain's root once its DNS is verified. The editor shows two
//   records to add (a TXT record proving ownership and a CNAME pointing the domain here); Verify
//   looks them up with the system resolver and nothing else.
// - Access: anyone with the address, a password, or only people signed in to this server (checked
//   here, remembered with a signed cookie; signed-in people open it through a short-lived ticket).
//
// Sites are keyed by their file id; Make's published apps (registered as the "app" kind) by their
// app id. GET/PUT /files/<id>/site/settings, POST …/verify and POST …/ticket (and the same under
// /apps/<id>/hosting) need access to the file (PUT and verify need edit access).

const MAX_SETTINGS = 16 * 1024;
const RESERVED = new Set(["www", "api", "app", "admin", "mail", "s", "sites", "apps", "files", "media", "auth", "localhost"]);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SITE_HEADERS = {
    "content-security-policy": "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
};

export function createSiteHosting({ readBody, CORS, DATA, loadRoom, roleFor, userFromReq, secret, sendSite, siteStatus, limitKeys, lockedFor, noteFailure }) {
    // What each kind of published thing needs: whether it's up, how to send a file, who may manage it.
    const kinds = {
        site: {
            status: siteStatus,
            send: sendSite,
            async role(req, url, id) {
                const room = await loadRoom(id);
                if (!room.file) return { error: "No such file.", status: 404 };
                const role = roleFor(room.file, userFromReq(req), url.searchParams.get("key") ?? "");
                if (!role) return { error: "No access to this file.", status: 403 };
                if (!room.file.doc?.site) return { role, error: "Only site files can be published.", status: 400 };
                return { role };
            },
        },
    };
    const register = (kind, handlers) => (kinds[kind] = handlers);
    const PATH = join(DATA, "site-hosting.json");
    let cache = null;
    async function load() {
        if (cache) return cache;
        try {
            cache = JSON.parse(await readFile(PATH, "utf8"));
        } catch {
            cache = {};
        }
        cache.files ??= {};
        return cache;
    }
    async function save() {
        await writeAtomic(PATH, JSON.stringify(cache), { mode: 0o600 });
    }
    const sitesDomain = () => (process.env.NAGMA_SITES_DOMAIN || "localhost").toLowerCase().replace(/^\.+|\.+$/g, "");
    const cnameTarget = (req) => (process.env.NAGMA_SITES_CNAME || `sites.${String(req.headers.host ?? "localhost").replace(/:\d+$/, "")}`).toLowerCase();
    const hostOf = (req) => String(req.headers.host ?? "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");

    function byName(data, slug) {
        for (const [id, entry] of Object.entries(data.files)) if (entry.slug === slug) return id;
        return null;
    }
    function byDomain(data, domain) {
        for (const [id, entry] of Object.entries(data.files)) if (entry.domain === domain && entry.verified) return id;
        return null;
    }

    // What the editor sees: the addresses, the DNS records and the access setting (never the password).
    async function summary(id, req) {
        const data = await load();
        const entry = data.files[id] ?? {};
        return {
            slug: entry.slug ?? null,
            domain: entry.domain ?? null,
            verified: Boolean(entry.verified),
            checkedAt: entry.checkedAt ?? null,
            access: entry.passwordHash ? "password" : entry.team ? "team" : "public",
            sitesDomain: sitesDomain(),
            records: entry.domain
                ? [
                      { type: "TXT", name: `_nagma.${entry.domain}`, value: `nagma-site-verification=${entry.token}` },
                      { type: "CNAME", name: entry.domain, value: req ? cnameTarget(req) : (process.env.NAGMA_SITES_CNAME ?? "sites.<this server>") },
                  ]
                : [],
        };
    }

    async function serveSettings(req, res, url, id, what, kind = "site") {
        const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
        const check = await kinds[kind].role(req, url, id);
        if (!check.role) return json(check.status ?? 403, { error: check.error ?? "No access." });
        if (what === "settings" && req.method === "GET") return json(200, await summary(id, req));
        if (what === "ticket") {
            if (req.method !== "POST") return json(405, { error: "Method not allowed." });
            // Team-only sites are for people signed in here: a guest with the file's link gets no ticket.
            if (!userFromReq(req)) return json(401, { error: "Sign in to open team-only sites." });
            const exp = Date.now() + 12 * 60 * 60 * 1000;
            return json(200, { ticket: `${exp}.${sign(`ticket:${id}:${exp}`)}` });
        }
        if (check.role !== "edit") return json(403, { error: "Only people who can edit this file can change where it's published." });
        // Addresses, domains and access are an account's to change, not an edit link's.
        if (!userFromReq(req)) return json(401, { error: "Sign in to change where this is published." });
        if (check.error) return json(check.status ?? 400, { error: check.error });
        const data = await load();
        const entry = (data.files[id] ??= {});
        entry.kind = kind;
        if (what === "verify") {
            if (req.method !== "POST") return json(405, { error: "Method not allowed." });
            if (!entry.domain) return json(400, { error: "Add a custom domain first." });
            const resolver = new Resolver({ timeout: 4000, tries: 2 });
            let txt = [];
            let cname = [];
            try {
                txt = (await resolver.resolveTxt(`_nagma.${entry.domain}`)).map((parts) => parts.join(""));
            } catch {
                txt = [];
            }
            // A record added before the product's rename (old host and value) still verifies.
            let legacyTxt = [];
            try {
                legacyTxt = (await resolver.resolveTxt(`${LEGACY.siteTxtHost}.${entry.domain}`)).map((parts) => parts.join(""));
            } catch {
                legacyTxt = [];
            }
            try {
                cname = await resolver.resolveCname(entry.domain);
            } catch {
                cname = [];
            }
            const want = `nagma-site-verification=${entry.token}`;
            entry.verified = txt.includes(want) || legacyTxt.includes(`${LEGACY.siteTxtValue}=${entry.token}`);
            entry.checkedAt = Date.now();
            await save();
            const target = cnameTarget(req);
            return json(200, {
                ...(await summary(id, req)),
                found: { txt, cname },
                checks: [
                    { type: "TXT", ok: entry.verified },
                    { type: "CNAME", ok: cname.some((c) => c.toLowerCase().replace(/\.$/, "") === target) },
                ],
            });
        }
        if (req.method !== "PUT") return json(405, { error: "Method not allowed." });
        let body;
        try {
            body = parseObject(await readBody(req, MAX_SETTINGS));
        } catch {
            return json(400, { error: "That request isn't readable." });
        }
        if (body.slug !== undefined) {
            const slug = body.slug === null || body.slug === "" ? null : String(body.slug).toLowerCase();
            if (slug !== null) {
                if (!SLUG.test(slug) || RESERVED.has(slug)) return json(400, { error: "Use 3 to 40 lowercase letters, digits and hyphens, starting and ending with a letter or digit." });
                const owner = byName(data, slug);
                if (owner && owner !== id) return json(409, { error: "That name is taken. Try another." });
            }
            entry.slug = slug;
        }
        if (body.domain !== undefined) {
            const domain = body.domain === null || body.domain === "" ? null : String(body.domain).toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
            if (domain !== null) {
                if (!DOMAIN.test(domain) || domain.endsWith(`.${sitesDomain()}`)) return json(400, { error: "Enter a domain like www.example.com." });
                const taken = Object.entries(data.files).some(([other, e]) => other !== id && e.domain === domain);
                if (taken) return json(409, { error: "Another site already uses that domain." });
            }
            if (domain !== entry.domain) {
                entry.domain = domain;
                entry.verified = false;
                entry.checkedAt = null;
                entry.token = randomBytes(12).toString("hex");
            }
        }
        if (body.access === "public" || body.access === "team") {
            delete entry.passwordHash;
            delete entry.salt;
            entry.team = body.access === "team";
        } else if (body.access === "password") {
            entry.team = false;
            const password = typeof body.password === "string" ? body.password : "";
            if (password.length < 4 && !entry.passwordHash) return json(400, { error: "Use a password of at least 4 characters." });
            if (password.length >= 4) {
                if (password.length > 200) return json(400, { error: "That password is too long." });
                entry.salt = randomBytes(16).toString("hex");
                entry.passwordHash = scryptSync(password, entry.salt, 32).toString("hex");
            }
        }
        await save();
        return json(200, await summary(id, req));
    }

    const sign = (text) => createHmac("sha256", secret()).update(text).digest("base64url").slice(0, 32);
    // The cookie a correct password (or a team ticket) gives: changes whenever the password does.
    const pass = (id, entry) => (entry.passwordHash ? sign(`site:${id}:${entry.salt}:${entry.passwordHash}`) : sign(`team:${id}`));
    const ticketOk = (id, ticket) => {
        const [exp, mac] = String(ticket ?? "").split(".");
        return Number(exp) > Date.now() && typeof mac === "string" && mac.length === 32 && timingSafeEqual(Buffer.from(mac), Buffer.from(sign(`ticket:${id}:${exp}`)));
    };
    const cookieName = (id) => `msite_${id.replace(/[^A-Za-z0-9]/g, "")}`;
    function cookieOf(req, name) {
        for (const part of String(req.headers.cookie ?? "").split(";")) {
            const [k, ...v] = part.trim().split("=");
            if (k === name) return v.join("=");
        }
        return "";
    }
    const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    function passwordPage(res, prefix, wrong) {
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Password required</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:15px/1.5 system-ui,sans-serif;background:#f5f5f7;color:#101828}form{background:#fff;padding:32px;border-radius:14px;box-shadow:0 10px 40px rgba(16,24,40,.1);width:min(340px,90vw)}h1{font-size:18px;margin:0 0 6px}p{margin:0 0 16px;color:#667085}input{width:100%;box-sizing:border-box;height:40px;border:1px solid #d0d5dd;border-radius:8px;padding:0 12px;font:inherit}button{margin-top:12px;width:100%;height:40px;border:0;border-radius:8px;background:#101828;color:#fff;font:inherit;font-weight:600;cursor:pointer}.err{color:#d92d20;margin:8px 0 0}</style></head>
<body><form method="post" action="${escape(prefix)}"><h1>This site is protected</h1><p>Enter the password to view it.</p><input type="password" name="password" aria-label="Password" autofocus required>${wrong ? '<p class="err" role="alert">That password isn’t right.</p>' : ""}<button type="submit">View site</button></form></body></html>`;
        res.writeHead(wrong ? 401 : 401, { ...SITE_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(html);
    }

    // True when the request may see the site; otherwise answers it (the password page, or the
    // redirect after a correct password).
    async function allowed(req, res, id, prefix) {
        const data = await load();
        const entry = data.files[id];
        if (entry?.team && !entry.passwordHash) {
            const name = cookieName(id);
            const want = pass(id, entry);
            const have = cookieOf(req, name);
            if (have.length === want.length && timingSafeEqual(Buffer.from(have), Buffer.from(want))) return true;
            const url = new URL(req.url ?? "/", "http://local");
            if (ticketOk(id, url.searchParams.get("ticket"))) {
                const secure = req.headers["x-forwarded-proto"] === "https" || req.socket?.encrypted ? "; Secure" : "";
                res.writeHead(303, { location: url.pathname, "set-cookie": `${name}=${want}; Path=${prefix}; HttpOnly; SameSite=Lax; Max-Age=43200${secure}` }).end();
                return false;
            }
            res.writeHead(401, { ...SITE_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Sign in to view</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:15px/1.5 system-ui,sans-serif;background:#f5f5f7;color:#101828}div{background:#fff;padding:32px;border-radius:14px;box-shadow:0 10px 40px rgba(16,24,40,.1);max-width:360px}h1{font-size:18px;margin:0 0 6px}p{margin:0;color:#667085}</style></head><body><div><h1>Only for people on this team</h1><p>Sign in to Nagma, then open this from the file's Publish menu.</p></div></body></html>`);
            return false;
        }
        if (!entry?.passwordHash) {
            if (req.method === "POST") {
                res.writeHead(303, { location: prefix }).end();
                return false;
            }
            return true;
        }
        const name = cookieName(id);
        const want = pass(id, entry);
        const have = cookieOf(req, name);
        if (have.length === want.length && timingSafeEqual(Buffer.from(have), Buffer.from(want))) {
            if (req.method !== "POST") return true;
        }
        if (req.method === "POST") {
            // Wrong passwords back off like sign-in (per address, and per address on this site).
            // The site's count is kept per address too: a stranger guessing can only lock themselves out,
            // never the real visitors.
            const ip = limitKeys ? limitKeys(req, null) : [];
            const keys = ip.length ? [...ip, ["account", `site:${id}:${ip[0][1]}`]] : [];
            const wait = keys.length ? lockedFor(keys) : 0;
            if (wait) {
                res.writeHead(429, { ...SITE_HEADERS, "content-type": "text/plain; charset=utf-8", "retry-after": String(wait), "cache-control": "no-store" }).end(`Too many attempts. Try again in ${wait} seconds.`);
                return false;
            }
            let password = "";
            try {
                password = new URLSearchParams((await readBody(req, 4096)).toString("utf8")).get("password") ?? "";
            } catch {
                password = "";
            }
            const hash = scryptSync(password, entry.salt, 32);
            if (timingSafeEqual(hash, Buffer.from(entry.passwordHash, "hex"))) {
                const secure = req.headers["x-forwarded-proto"] === "https" || req.socket?.encrypted ? "; Secure" : "";
                res.writeHead(303, { location: prefix, "set-cookie": `${name}=${want}; Path=${prefix}; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}` }).end();
                return false;
            }
            if (keys.length) noteFailure(keys);
            passwordPage(res, prefix, true);
            return false;
        }
        passwordPage(res, prefix, false);
        return false;
    }

    async function serveId(req, res, id, prefix, rest) {
        const kind = kinds[(await load()).files[id]?.kind ?? "site"] ?? kinds.site;
        const status = await kind.status(id);
        if (!status.published) {
            res.writeHead(404, { ...SITE_HEADERS, "content-type": "text/plain; charset=utf-8" }).end("This site isn't published.");
            return true;
        }
        if (!(await allowed(req, res, id, prefix))) return true;
        if (req.method === "POST") {
            res.writeHead(303, { location: prefix }).end();
            return true;
        }
        await kind.send(req, res, id, rest, new URL(req.url ?? "/", "http://local"));
        return true;
    }

    // /s/<name>/...
    async function serveSlug(req, res) {
        const url = new URL(req.url ?? "/", "http://local");
        const match = /^\/s\/([a-z0-9-]{3,40})(\/.*)?$/.exec(url.pathname);
        if (!match) return false;
        if (!match[2]) {
            res.writeHead(301, { location: `/s/${match[1]}/` }).end();
            return true;
        }
        const id = byName(await load(), match[1]);
        if (!id) {
            res.writeHead(404, { ...SITE_HEADERS, "content-type": "text/plain; charset=utf-8" }).end("No site is published at this address.");
            return true;
        }
        return serveId(req, res, id, `/s/${match[1]}/`, match[2]);
    }

    // <name>.<sites domain> and verified custom domains, at the root.
    async function serveHost(req, res) {
        const host = hostOf(req);
        if (!host || !["GET", "HEAD", "POST"].includes(req.method ?? "")) return false;
        const data = await load();
        const base = sitesDomain();
        let id = null;
        if (host.endsWith(`.${base}`)) {
            const name = host.slice(0, -base.length - 1);
            if (SLUG.test(name)) id = byName(data, name);
        }
        if (!id) id = byDomain(data, host);
        if (!id) return false;
        const url = new URL(req.url ?? "/", "http://local");
        return serveId(req, res, id, "/", url.pathname);
    }

    // ---- Data of protected apps (Make's built-in backend) ----
    // A password or team-only app's data is as protected as its page: reading or writing it needs a
    // data token, which the app page gets (in a <meta> tag) only after passing the same gate, and an
    // editor's preview gets from the server. Tokens last 12 hours and stop working when the password
    // or the access setting changes. Public apps need none.
    const protectedPass = async (id) => {
        const entry = (await load()).files[id];
        return entry?.passwordHash || entry?.team ? pass(id, entry) : null;
    };
    async function appToken(id) {
        const version = await protectedPass(id);
        if (!version) return null;
        const exp = Date.now() + 12 * 60 * 60 * 1000;
        return `${exp}.${sign(`appdata:${id}:${exp}:${version}`)}`;
    }
    async function appTokenOk(id, token) {
        const version = await protectedPass(id);
        if (!version) return true;
        const [exp, mac] = String(token ?? "").split(".");
        return Number(exp) > Date.now() && typeof mac === "string" && mac.length === 32 && timingSafeEqual(Buffer.from(mac), Buffer.from(sign(`appdata:${id}:${exp}:${version}`)));
    }

    // Whether a published site or app is behind a password or for its team only (so no shared cache keeps it).
    const gated = async (id) => {
        const entry = (await load()).files[id];
        return Boolean(entry?.passwordHash || entry?.team);
    };
    return { serveSettings, serveSlug, serveHost, allowed, gated, register, summary: (id) => summary(id), appToken, appTokenOk };
}
