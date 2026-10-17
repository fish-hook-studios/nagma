// Nagma sync server: one room per shared file. Clients send property-level patches; the server
// puts them in one order, stores the result, and relays them (plus cursors and comments) to everyone.
// Collaborators apply the same patches in the same order, so everyone ends up with the same file.
// First: settings under the product's old name are read as NAGMA_* (legacy-names.mjs).
import "./legacy-names.mjs";
import { createHash, createHmac, createPublicKey, randomBytes, randomUUID, scryptSync, timingSafeEqual, verify as cryptoVerify } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup as lookupCb } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { createAdmin } from "./admin.mjs";
import { createMake } from "./make.mjs";
import { createAi } from "./ai.mjs";
import { createSiteHosting } from "./sites.mjs";
import { createApiTokens } from "./api-tokens.mjs";
import { createIntegrations } from "./integrations.mjs";
import { devMailFile, domainOf, keepUnsentLink, mailConfigured, sendMail } from "./mail.mjs";
import { createHome, wantsEmail } from "./home.mjs";
import { hashToken, resendWait as resendWaitFor, verifyRequired as requireVerified } from "./email-verification.mjs";
import { createSaml, safeReturnUrl } from "./saml.mjs";
import { createImageProxy } from "./image-proxy.mjs";
import { parseObject } from "./json-body.mjs";
import { saveLater, writeAtomic } from "./atomic-write.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const withSlash = (dir) => (dir.endsWith("/") ? dir : `${dir}/`);
const DATA = withSlash(process.env.DATA_DIR ?? new URL("./data/", import.meta.url).pathname);
// The built editor (apps/web/dist). When present, this one server hosts the whole app.
const STATIC = withSlash(process.env.STATIC_DIR ?? new URL("../web/dist/", import.meta.url).pathname);
const MAX_MESSAGE = 32 * 1024 * 1024;
await mkdir(DATA, { recursive: true });
// Published sites (see "Sites" below).
const SITES = join(DATA, "sites");
await mkdir(SITES, { recursive: true });

/** @type {Map<string, {id: string, file: any, version: number, clients: Map<any, any>, dirty: boolean, timer: any}>} */
const rooms = new Map();

const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(id);
const filePath = (id) => join(DATA, `${id}.json`);

async function loadRoom(id) {
    // Ids come from addresses and request bodies: anything but a plain id ("../x", "/tmp/x") is no
    // file, and never reaches the disk or the room list.
    if (!validId(id)) return { id: String(id), file: null, version: 0, clients: new Map(), dirty: false, timer: null };
    let room = rooms.get(id);
    if (room) return room;
    let file = null;
    try {
        file = JSON.parse(await readFile(filePath(id), "utf8"));
    } catch {
        file = null;
    }
    room = rooms.get(id);
    if (room) return room;
    room = { id, file, version: file?.version ?? 0, clients: new Map(), dirty: false, timer: null };
    rooms.set(id, room);
    return room;
}

// Writes are batched and atomic (write a temp file, then rename), so a crash never leaves half a file.
function scheduleSave(room) {
    room.dirty = true;
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
        if (!room.dirty || !room.file) return;
        room.dirty = false;
        writeAtomic(filePath(room.id), JSON.stringify({ ...room.file, version: room.version }))
            .then(() => (room.touched ? writeMeta(room.id, { updatedAt: room.touched }) : undefined))
            .catch((error) => {
                // The file stays in memory: say so and try again shortly, rather than stop the server.
                console.error(`Couldn't save ${room.id}: ${error?.message ?? error}`);
                setTimeout(() => scheduleSave(room), 2000);
            });
    }, 400);
}

// The same merge every client does: layer properties overwrite, null removes a layer. `patch` has
// passed validPatch.
function applyPatch(doc, patch) {
    for (const [id, change] of Object.entries(patch.nodes ?? {})) {
        if (change === null) delete doc.nodes[id];
        // A partial change to a layer someone else deleted is dropped (as the editor does): kept, it
        // became a layer with no type or children in the stored file.
        else if (!Object.hasOwn(doc.nodes, id) && !(change.id && change.type && Array.isArray(change.children))) continue;
        else doc.nodes[id] = { ...(Object.hasOwn(doc.nodes, id) ? doc.nodes[id] : {}), ...change };
    }
    for (const [id, keys] of Object.entries(patch.removed ?? {})) {
        const node = Object.hasOwn(doc.nodes, id) ? doc.nodes[id] : null;
        if (node) for (const key of keys) delete node[key];
    }
    if (patch.roots) doc.roots = patch.roots;
    if (typeof patch.name === "string") doc.name = patch.name;
    if (patch.images) doc.images = { ...doc.images, ...patch.images };
    // Styles, prototype settings, variables and the rest are whole values, like the sequence.
    for (const key of ["sequence", "styles", "prototype", "variables", "colorProfile", "pluginData", "relaunchData"]) {
        if (patch[key] === undefined) continue;
        if (patch[key] === null) delete doc[key];
        else doc[key] = patch[key];
    }
}

// Whether a patch from a client has the shape every client's merge expects. Layer ids are used as
// keys of plain objects, so names that reach Object.prototype ("__proto__", "constructor") are
// refused along with values of the wrong kind; the whole patch is refused, so everyone stays in step.
const plainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const safeKey = (k) => k !== "__proto__" && k !== "constructor" && k !== "prototype";
function validPatch(patch) {
    if (!plainObject(patch)) return false;
    if (patch.nodes !== undefined && (!plainObject(patch.nodes) || Object.entries(patch.nodes).some(([id, c]) => !safeKey(id) || (c !== null && !plainObject(c))))) return false;
    if (patch.removed !== undefined && (!plainObject(patch.removed) || Object.entries(patch.removed).some(([id, keys]) => !safeKey(id) || !Array.isArray(keys) || keys.some((k) => typeof k !== "string")))) return false;
    if (patch.roots !== undefined && patch.roots !== null && (!Array.isArray(patch.roots) || patch.roots.some((r) => typeof r !== "string"))) return false;
    if (patch.name !== undefined && patch.name !== null && typeof patch.name !== "string") return false;
    if (patch.images !== undefined && patch.images !== null && (!plainObject(patch.images) || Object.keys(patch.images).some((k) => !safeKey(k)))) return false;
    return true;
}

// ---- Files on the server: the team's library (metadata beside each room's document) ----

const metaPath = (id) => join(DATA, `${id}.meta.json`);

async function readMeta(id) {
    try {
        return JSON.parse(await readFile(metaPath(id), "utf8"));
    } catch {
        return {};
    }
}

async function writeMeta(id, patch) {
    const meta = { ...(await readMeta(id)), ...patch, updatedAt: patch.updatedAt ?? Date.now() };
    await writeAtomic(metaPath(id), JSON.stringify(meta));
    return meta;
}

// Every file on the server, with its name, kind, picture and link keys (this is a team server:
// anyone who can reach it is on the team).
async function listFiles(user) {
    // Files on disk, plus new ones still only in memory (their first save is moments away).
    const ids = new Set((await readdir(DATA)).filter((n) => /^[A-Za-z0-9_-]{6,64}\.json$/.test(n)).map((n) => n.slice(0, -5)));
    for (const [id, room] of rooms) if (room.file?.doc) ids.add(id);
    const out = [];
    for (const id of ids) {
        try {
            const room = rooms.get(id);
            const file = room?.file ?? JSON.parse(await readFile(filePath(id), "utf8"));
            if (!file?.doc) continue;
            // Branches live under their main file, not in the file browser; team templates live in
            // Resources, and copies published to the community on the Community page.
            if (file.branchOf || file.template || file.community) continue;
            // Yours, or shared with you. Files from before accounts are listed for everyone signed in,
            // read-only (server admins can edit and claim them); on a server without accounts, for everyone.
            const a = accessOf(file);
            const role = a.owner ? (user ? roleFor(file, user, "") : null) : ownerless(file) ? roleFor(file, user, "") : "edit";
            if (!role) continue;
            const meta = await readMeta(id);
            const stats = await stat(filePath(id)).catch(() => ({ mtimeMs: Date.now() }));
            out.push({
                owner: publicUser(userById(a.owner)),
                role,
                project: file.project ?? null,
                team: file.project ? (projectById(file.project)?.teamId ?? null) : null,
                id,
                name: file.doc.name ?? "Untitled",
                kind: meta.kind ?? (file.doc.sequence ? "video" : "design"),
                updatedAt: meta.updatedAt ?? stats.mtimeMs,
                thumb: meta.thumb ?? null,
                pinned: Boolean(meta.pinned),
                trashed: Boolean(meta.trashed),
                trashedWith: meta.trashedWith ?? null,
                trashedAt: meta.trashedAt ?? null,
                trashedBy: meta.trashedBy ?? null,
                createdAt: meta.createdAt ?? file.createdAt ?? null,
                keys: role === "edit" ? (file.keys ?? null) : null,
                claimable: ownerless(file) && isServerAdmin(user),
                // Invited to it (and so able to leave it).
                invited: Boolean(user && (a.members[user.id] || a.invites[user.email])),
            });
        } catch {
            // A file that can't be read isn't listed.
        }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

// ---- Accounts: users and sessions, kept in data/users.json ----

const USERS = join(DATA, "users.json");
let accounts = { users: [], sessions: {} };
try {
    accounts = JSON.parse(await readFile(USERS, "utf8"));
} catch {
    accounts = { users: [], sessions: {} };
}
let accountsTimer = null;
function saveAccounts() {
    clearTimeout(accountsTimer);
    accountsTimer = setTimeout(() => saveLater(USERS, JSON.stringify(accounts)), 100);
}
const USER_COLORS = ["#F24822", "#FFA629", "#FFCD29", "#14AE5C", "#0D99FF", "#9747FF", "#FF24BD"];
// Accounts made under an older palette take a current colour.
for (const [i, u] of (accounts.users ?? []).entries()) if (u.color && !USER_COLORS.includes(u.color)) u.color = USER_COLORS[i % USER_COLORS.length];
const publicUser = (u) => (u ? { id: u.id, name: u.name, email: u.email, color: u.color, avatar: u.avatar ? `/avatars/${u.id}?v=${u.avatar.v}` : null } : null);
const userById = (id) => accounts.users.find((u) => u.id === id) ?? null;
const userByEmail = (email) => accounts.users.find((u) => u.email === String(email).trim().toLowerCase()) ?? null;

function hashPassword(password, salt) {
    return scryptSync(String(password), salt, 64).toString("base64");
}

// ---- Sessions: sliding expiry. A session that goes unused for SESSION_IDLE_DAYS (30) ends. ----

const SESSION_IDLE_MS = Number(process.env.SESSION_IDLE_DAYS ?? 30) * 24 * 60 * 60 * 1000;

function sessionAlive(session, now = Date.now()) {
    return now - (session.lastUsed ?? session.createdAt ?? 0) < SESSION_IDLE_MS;
}

function purgeSessions() {
    let gone = 0;
    for (const [t, s] of Object.entries(accounts.sessions ?? {})) {
        if (sessionAlive(s)) continue;
        delete accounts.sessions[t];
        gone += 1;
    }
    if (gone) saveAccounts();
}
setTimeout(purgeSessions, 1000).unref();
setInterval(purgeSessions, 6 * 60 * 60 * 1000).unref();

// Who a request is from, by its bearer token (or ?token= for sockets). Each use slides the expiry on
// (written at most once an hour).
function userFromToken(token) {
    const session = token ? accounts.sessions[token] : null;
    if (!session) return null;
    const now = Date.now();
    if (!sessionAlive(session, now)) {
        delete accounts.sessions[token];
        saveAccounts();
        return null;
    }
    if (now - (session.lastUsed ?? 0) > Math.min(60 * 60 * 1000, SESSION_IDLE_MS / 10)) {
        session.lastUsed = now;
        saveAccounts();
    }
    return userById(session.userId);
}
function userFromReq(req) {
    const header = String(req.headers.authorization ?? "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : new URL(req.url ?? "/", "http://local").searchParams.get("token");
    return userFromToken(token);
}

function startSession(user) {
    const token = randomBytes(24).toString("base64url");
    accounts.sessions[token] = { userId: user.id, createdAt: Date.now(), lastUsed: Date.now() };
    saveAccounts();
    return token;
}

// ---- Email verification: a new account proves it owns its address before it can reach anyone ----
// Sign-up makes the account unverified and mails a link (24 hours, single use; only a SHA-256 of
// the token is kept). Until it's opened the account can sign in and work on its drafts, but can't
// invite, share, publish, create teams or be added to one. Single sign-on, a password reset, an
// email change and an emailed invitation's link each prove the address too. Required when the
// server can send mail (NAGMA_SMTP_URL) or keeps links for development (NAGMA_DEV_MAIL_FILE=1);
// NAGMA_REQUIRE_VERIFIED_EMAIL=1 or 0 overrides that. Without mail a server admin verifies accounts.

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const INVITE_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// Accounts made before verification existed count as verified, so nobody is locked out.
{
    let changed = false;
    for (const u of accounts.users ?? []) {
        if (u.emailVerified === undefined) {
            u.emailVerified = true;
            changed = true;
        }
    }
    if (changed) saveAccounts();
}

const mailReady = () => mailConfigured() || devMailFile();
const verifyRequired = () => requireVerified(process.env, mailReady());
const isVerified = (user) => Boolean(user) && user.emailVerified !== false;
// Whether this account is held back from reaching other people until it verifies its email.
const needsVerification = (user) => Boolean(user) && !isVerified(user) && verifyRequired();
const VERIFY_FIRST = "Verify your email first. Open the link we sent you, or send a new one from the banner.";

// What the signed-in person sees of their own account.
const selfUser = (u) => ({ ...publicUser(u), emailVerified: isVerified(u), verifyRequired: verifyRequired(), mailReady: mailReady() });

function markVerified(user) {
    if (!user) return;
    user.emailVerified = true;
    delete user.verify;
    saveAccounts();
}

// The app's address for links in mail: NAGMA_APP_URL, else the address the request came from
// (http or https only), else NAGMA_PUBLIC_URL.
function appBase(origin) {
    if (process.env.NAGMA_APP_URL) return process.env.NAGMA_APP_URL.replace(/\/$/, "");
    const given = String(origin ?? "").replace(/\/$/, "");
    if (/^https?:\/\/[^\s/]+$/i.test(given)) return given;
    return (process.env.NAGMA_PUBLIC_URL ?? "http://localhost:5173").replace(/\/$/, "");
}

const resends = new Map();
// Seconds until another verification mail may go to this account (0: now). At most one a minute
// and five an hour.
const resendWait = (user, now = Date.now()) => resendWaitFor(resends.get(user.id) ?? [], now);
function noteResend(user, now = Date.now()) {
    resends.set(user.id, [...(resends.get(user.id) ?? []).filter((t) => now - t < 60 * 60 * 1000), now]);
}
setInterval(() => {
    const now = Date.now();
    for (const [id, list] of resends) if (!list.some((t) => now - t < 60 * 60 * 1000)) resends.delete(id);
}, 10 * 60 * 1000).unref();

// A fresh link replaces any earlier one. Mailed, or (NAGMA_DEV_MAIL_FILE=1) kept in
// data/email-links.txt like the email-change links.
async function sendVerification(user, origin) {
    const token = randomBytes(32).toString("base64url");
    user.verify = { hash: hashToken(token), email: user.email, expires: Date.now() + VERIFY_TTL_MS };
    saveAccounts();
    noteResend(user);
    const link = `${appBase(origin)}/?verify-account=${token}`;
    const sent = await sendMail(user.email, "Confirm your Nagma email", `Open this link within a day to confirm ${user.email} for your Nagma account:\n\n${link}\n\nIf you didn't make an account, ignore this message.`);
    const kept = sent ? false : await keepUnsentLink(DATA, "email-links.txt", `${new Date().toISOString()} email verification for ${user.id}: ${link} (valid 1 day)\n`, user.email);
    return { sent, kept, mailConfigured: mailConfigured() };
}

// Emailed invitations carry a token for the address they went to: signing up (or, signed in,
// opening the link) with that address proves it. Kept hashed, 14 days, single use.
function inviteEmailToken(email) {
    accounts.emailTokens ??= {};
    const now = Date.now();
    for (const [h, t] of Object.entries(accounts.emailTokens)) if (t.expires < now) delete accounts.emailTokens[h];
    const token = randomBytes(32).toString("base64url");
    accounts.emailTokens[hashToken(token)] = { email: String(email).toLowerCase(), expires: now + INVITE_TOKEN_TTL_MS };
    saveAccounts();
    return token;
}
// Uses up an invitation's token when it was sent to `email`.
function takeInviteToken(token, email) {
    const h = hashToken(token);
    const t = accounts.emailTokens?.[h];
    if (!t || t.expires < Date.now() || t.email !== String(email).toLowerCase()) return false;
    delete accounts.emailTokens[h];
    saveAccounts();
    return true;
}
// The token to put in an invitation mailed to `email`: none for an account that's already verified.
const inviteTokenFor = (email) => (isVerified(userByEmail(email)) ? null : inviteEmailToken(email));

// ---- Single sign-on: shared by OpenID Connect (below) and SAML (saml.mjs) ----

// The Nagma account for someone the identity provider signed in: found by email, or made on their
// first sign-in (with a random password they never use).
function ssoAccount(email, name) {
    let user = userByEmail(email);
    if (!user) {
        const salt = randomBytes(16).toString("base64");
        user = { id: randomBytes(9).toString("base64url"), name: String(name || email.split("@")[0]).slice(0, 60), email, color: USER_COLORS[accounts.users.length % USER_COLORS.length], salt, hash: hashPassword(randomBytes(24).toString("base64"), salt), createdAt: Date.now(), sso: true, emailVerified: true };
        accounts.users.push(user);
        saveAccounts();
        void claimEmailInvites(user, email);
    }
    // The identity provider vouched for the address.
    if (!isVerified(user)) markVerified(user);
    return user;
}

// Starts a session and sends the browser back to the app with it in the address (#sso=…); the app
// picks it up and removes it from there.
function ssoFinish(res, user, back) {
    const token = startSession(user);
    back.hash = `sso=${token}`;
    res.writeHead(302, { location: back.toString(), "cache-control": "no-store" }).end();
}

// ---- Single sign-on (OpenID Connect, e.g. Google Workspace or an identity provider's OIDC app) ----
// Set NAGMA_OIDC_ISSUER, NAGMA_OIDC_CLIENT_ID and NAGMA_OIDC_CLIENT_SECRET (and NAGMA_OIDC_NAME for the
// button, e.g. "Google"). The callback is <origin>/auth/oidc/callback. People sign in with their
// provider; a Nagma account with that email is used, or made. Without the settings, SSO is off.

const oidcFlows = new Map();
let oidcConfig = null;

const oidcEnabled = () => Boolean(process.env.NAGMA_OIDC_ISSUER && process.env.NAGMA_OIDC_CLIENT_ID && process.env.NAGMA_OIDC_CLIENT_SECRET);

async function oidcDiscovery() {
    if (oidcConfig && oidcConfig.at > Date.now() - 60 * 60 * 1000) return oidcConfig.value;
    const issuer = process.env.NAGMA_OIDC_ISSUER.replace(/\/$/, "");
    const res = await fetch(`${issuer}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`The sign-in provider answered ${res.status}.`);
    const value = await res.json();
    const jwks = await (await fetch(value.jwks_uri)).json();
    oidcConfig = { at: Date.now(), value: { ...value, keys: jwks.keys ?? [] } };
    return oidcConfig.value;
}

// Checks an ID token's signature (RS256 or ES256, from the provider's keys), issuer, audience,
// expiry and nonce. Returns its claims.
async function verifyIdToken(token, nonce) {
    const [h, p, sig] = String(token).split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    const config = await oidcDiscovery();
    const jwk = config.keys.find((k) => k.kid === header.kid) ?? (config.keys.length === 1 ? config.keys[0] : null);
    if (!jwk) throw new Error("Unknown signing key.");
    const algorithm = header.alg === "RS256" ? "RSA-SHA256" : header.alg === "ES256" ? "SHA256" : null;
    if (!algorithm) throw new Error("Unsupported token.");
    const key = createPublicKey({ key: jwk, format: "jwk" });
    const ok = cryptoVerify(algorithm, Buffer.from(`${h}.${p}`), header.alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key, Buffer.from(sig, "base64url"));
    if (!ok) throw new Error("Bad token signature.");
    const issuer = process.env.NAGMA_OIDC_ISSUER.replace(/\/$/, "");
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss.replace(/\/$/, "") !== issuer || !aud.includes(process.env.NAGMA_OIDC_CLIENT_ID) || claims.exp * 1000 < Date.now() || claims.nonce !== nonce) throw new Error("That sign-in isn't valid.");
    return claims;
}

async function serveAccountExtras(req, res) {
    const url = new URL(req.url ?? "/", "http://local");
    const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
    if (url.pathname === "/rtc/config") {
        // Only people who can open the file get the relay settings (TURN credentials among them).
        const fid = url.searchParams.get("file") ?? "";
        const room = validId(fid) ? await loadRoom(fid) : null;
        if (!room?.file || !roleFor(room.file, userFromReq(req), url.searchParams.get("key") ?? "")) return json(403, { error: "No access." });
        return json(200, { iceServers: iceServers() });
    }
    if (url.pathname === "/auth/oidc") return json(200, { enabled: oidcEnabled(), name: process.env.NAGMA_OIDC_NAME ?? "Single sign-on" });
    if (url.pathname === "/auth/oidc/start") {
        if (!oidcEnabled()) return json(501, { error: "Single sign-on isn't set up on this server." });
        const back = url.searchParams.get("return") ?? "/";
        const origin = (process.env.NAGMA_PUBLIC_URL ?? `http://${req.headers.host}`).replace(/\/$/, "");
        const state = randomBytes(18).toString("base64url");
        const nonce = randomBytes(18).toString("base64url");
        const verifier = randomBytes(32).toString("base64url");
        const challenge = createHash("sha256").update(verifier).digest("base64url");
        // Only back to this server or the app's own address: the session goes along in the address.
        const host = String(req.headers.host ?? "").replace(/:\d+$/, "");
        const local = ["localhost", "127.0.0.1", "[::1]"].includes(host) || host.endsWith(".localhost");
        oidcFlows.set(state, { nonce, verifier, back: safeReturnUrl(back, [origin, process.env.NAGMA_APP_URL, process.env.NAGMA_PUBLIC_URL], local), origin, at: Date.now() });
        for (const [k, f] of oidcFlows) if (Date.now() - f.at > 10 * 60 * 1000) oidcFlows.delete(k);
        const config = await oidcDiscovery();
        const to = new URL(config.authorization_endpoint);
        for (const [k, v] of Object.entries({ response_type: "code", client_id: process.env.NAGMA_OIDC_CLIENT_ID, redirect_uri: `${origin}/auth/oidc/callback`, scope: "openid email profile", state, nonce, code_challenge: challenge, code_challenge_method: "S256" })) to.searchParams.set(k, v);
        res.writeHead(302, { location: to.toString() }).end();
        return true;
    }
    if (url.pathname === "/auth/oidc/callback") {
        const flow = oidcFlows.get(url.searchParams.get("state") ?? "");
        oidcFlows.delete(url.searchParams.get("state") ?? "");
        if (!flow || !url.searchParams.get("code")) return json(400, { error: "That sign-in has expired. Try again." });
        try {
            const config = await oidcDiscovery();
            const tokenRes = await fetch(config.token_endpoint, {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ grant_type: "authorization_code", code: url.searchParams.get("code"), redirect_uri: `${flow.origin}/auth/oidc/callback`, client_id: process.env.NAGMA_OIDC_CLIENT_ID, client_secret: process.env.NAGMA_OIDC_CLIENT_SECRET, code_verifier: flow.verifier }),
            });
            const tokens = await tokenRes.json();
            if (!tokenRes.ok || !tokens.id_token) throw new Error("The provider didn't sign you in.");
            const claims = await verifyIdToken(tokens.id_token, flow.nonce);
            const email = String(claims.email ?? "").toLowerCase();
            if (!email || claims.email_verified === false) throw new Error("The provider didn't share a verified email.");
            ssoFinish(res, ssoAccount(email, claims.name), new URL(flow.back, flow.origin));
            return true;
        } catch (error) {
            return json(400, { error: error?.message ?? "Sign-in failed." });
        }
    }
    // Your sessions: where you're signed in, and signing out everywhere else.
    if (url.pathname === "/auth/sessions") {
        const user = userFromReq(req);
        if (!user) return json(401, { error: "Sign in first." });
        const header = String(req.headers.authorization ?? "");
        const mine = header.startsWith("Bearer ") ? header.slice(7) : "";
        if (req.method === "DELETE") {
            let ended = 0;
            for (const [t, sess] of Object.entries(accounts.sessions)) if (sess.userId === user.id && t !== mine) (delete accounts.sessions[t], (ended += 1));
            saveAccounts();
            return json(200, { ended });
        }
        const list = Object.entries(accounts.sessions).filter(([, sess]) => sess.userId === user.id).map(([t, sess]) => ({ current: t === mine, createdAt: sess.createdAt, lastUsed: sess.lastUsed ?? sess.createdAt, expiresAt: (sess.lastUsed ?? sess.createdAt) + SESSION_IDLE_MS }));
        return json(200, list.sort((a, b) => b.lastUsed - a.lastUsed));
    }
    return false;
}

// ---- Sign-in limits: failed attempts per address and per account back off exponentially ----
// After LIMIT_FREE failures the next attempt waits 2s, then 4s, 8s... up to 15 minutes; an hour
// without failures forgets them. Locked attempts get 429 with Retry-After.

const LIMIT_FREE = { ip: 10, account: 5 };
const LIMIT_MAX_MS = 15 * 60 * 1000;
const failures = new Map();

function clientAddress(req) {
    const forwarded = process.env.TRUST_PROXY ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
    return forwarded || req.socket?.remoteAddress || "unknown";
}

function limitKeys(req, email) {
    const keys = [["ip", `ip:${clientAddress(req)}`]];
    if (email) keys.push(["account", `account:${String(email).trim().toLowerCase().slice(0, 120)}`]);
    return keys;
}

// Seconds until another attempt is allowed (0: go ahead).
function lockedFor(keys, now = Date.now()) {
    let wait = 0;
    for (const [, key] of keys) {
        const f = failures.get(key);
        if (f && f.until > now) wait = Math.max(wait, Math.ceil((f.until - now) / 1000));
    }
    return wait;
}

function noteFailure(keys, now = Date.now()) {
    for (const [kind, key] of keys) {
        const f = failures.get(key);
        const count = f && now - f.last < 60 * 60 * 1000 ? f.count + 1 : 1;
        const over = count - LIMIT_FREE[kind];
        const until = over > 0 ? now + Math.min(LIMIT_MAX_MS, 1000 * 2 ** over) : 0;
        failures.set(key, { count, last: now, until });
    }
}

function clearFailures(keys) {
    for (const [kind, key] of keys) if (kind === "account") failures.delete(key);
}

setInterval(() => {
    const now = Date.now();
    for (const [key, f] of failures) if (now - f.last > 60 * 60 * 1000 && f.until < now) failures.delete(key);
}, 10 * 60 * 1000).unref();

// Sign-ups per address: at most SIGNUP_PER_HOUR new accounts from one address in a sliding hour
// (NAGMA_SIGNUP_PER_HOUR, default 10), so one client can't mint accounts in bulk. Refused with 429
// and Retry-After set to when the oldest one in the window ages out.
const SIGNUP_PER_HOUR = Math.max(1, Number(process.env.NAGMA_SIGNUP_PER_HOUR) || 10);
const signups = new Map();

function signupWait(req, now = Date.now()) {
    const recent = (signups.get(`ip:${clientAddress(req)}`) ?? []).filter((t) => now - t < 60 * 60 * 1000);
    return recent.length < SIGNUP_PER_HOUR ? 0 : Math.max(1, Math.ceil((recent[0] + 60 * 60 * 1000 - now) / 1000));
}

function noteSignup(req, now = Date.now()) {
    const key = `ip:${clientAddress(req)}`;
    signups.set(key, [...(signups.get(key) ?? []).filter((t) => now - t < 60 * 60 * 1000), now]);
}

setInterval(() => {
    const now = Date.now();
    for (const [key, list] of signups) if (!list.some((t) => now - t < 60 * 60 * 1000)) signups.delete(key);
}, 10 * 60 * 1000).unref();

function tooMany(res, wait) {
    const minutes = Math.ceil(wait / 60);
    const text = wait < 60 ? `${wait} second${wait === 1 ? "" : "s"}` : `${minutes} minute${minutes === 1 ? "" : "s"}`;
    res.writeHead(429, { ...CORS, "content-type": "application/json", "retry-after": String(wait) }).end(JSON.stringify({ error: `Too many attempts. Try again in ${text}.`, retryAfter: wait }));
    return true;
}

async function serveAuth(req, res) {
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname;
    const json = (status, body) => res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body));
    if (path === "/auth/me" && req.method === "GET") {
        const user = userFromReq(req);
        // serverAdmin: whether this account runs the server (NAGMA_ADMINS), so setup hints naming its
        // settings are shown to them only.
        return user ? json(200, { ...selfUser(user), prefs: { emailDigests: user.prefs?.emailDigests !== false, chatWebhook: Boolean(user.prefs?.chatWebhook) }, serverAdmin: isServerAdmin(user) }) : json(401, { error: "Not signed in." });
    }
    // Server admins: the accounts still waiting to verify their email, to vouch for by hand when the
    // server can't send mail.
    if (path === "/auth/admin/unverified" && req.method === "GET") {
        const user = userFromReq(req);
        if (!isServerAdmin(user)) return json(403, { error: "Only a server admin can see this." });
        return json(200, accounts.users.filter((u) => !isVerified(u)).map((u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt ?? null })));
    }
    if (req.method !== "POST") return false;
    let body = {};
    try {
        body = parseObject(await readBody(req, 64 * 1024));
    } catch {
        return json(400, { error: "Bad request." });
    }
    if (path === "/auth/signup") {
        const wait = signupWait(req);
        if (wait) return tooMany(res, wait);
        const name = String(body.name ?? "").trim().slice(0, 60);
        const email = String(body.email ?? "").trim().toLowerCase().slice(0, 120);
        const password = String(body.password ?? "");
        if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Enter your name and a valid email." });
        if (password.length < 8) return json(400, { error: "Use a password of at least 8 characters." });
        if (userByEmail(email)) return json(409, { error: "There's already an account with that email. Sign in instead." });
        const salt = randomBytes(16).toString("base64");
        // An emailed invitation's token for this address proves it at once.
        const invited = typeof body.emailToken === "string" && body.emailToken ? takeInviteToken(body.emailToken, email) : false;
        const user = { id: randomBytes(9).toString("base64url"), name, email, color: USER_COLORS[accounts.users.length % USER_COLORS.length], salt, hash: hashPassword(password, salt), createdAt: Date.now(), emailVerified: invited };
        accounts.users.push(user);
        noteSignup(req);
        await claimEmailInvites(user, email);
        const verification = invited ? { sent: false, kept: false, mailConfigured: mailConfigured() } : mailReady() ? await sendVerification(user, body.origin) : { sent: false, kept: false, mailConfigured: false };
        return json(200, { token: startSession(user), user: selfUser(user), verification });
    }
    if (path === "/auth/signin") {
        const keys = limitKeys(req, body.email);
        const wait = lockedFor(keys);
        if (wait) return tooMany(res, wait);
        const user = userByEmail(body.email ?? "");
        const ok = user && timingSafeEqual(Buffer.from(hashPassword(body.password ?? "", user.salt)), Buffer.from(user.hash));
        if (!ok) {
            noteFailure(keys);
            return json(401, { error: "That email and password don't match." });
        }
        clearFailures(keys);
        return json(200, { token: startSession(user), user: selfUser(user) });
    }
    if (path === "/auth/reset-request") {
        // Reset mails count as attempts too, so they can't be used to flood someone's inbox.
        const keys = limitKeys(req, body.email);
        const wait = lockedFor(keys);
        if (wait) return tooMany(res, wait);
        noteFailure(keys);
        // Mailed through mail.mjs; without SMTP the link is only kept (in data/reset-links.txt) when
        // NAGMA_DEV_MAIL_FILE=1. The answer never says whether the account exists.
        const user = userByEmail(body.email ?? "");
        if (user) {
            user.reset = { token: randomBytes(24).toString("base64url"), expires: Date.now() + 60 * 60 * 1000 };
            saveAccounts();
            const link = `${String(body.origin ?? "").replace(/\/$/, "") || "http://localhost:5173"}/?reset=${user.reset.token}`;
            const line = `${new Date().toISOString()} password reset for ${user.email}: ${link} (valid 1 hour)\n`;
            const sent = await sendMail(user.email, "Reset your Nagma password", `Open this link within an hour to choose a new password:\n\n${link}\n\nIf you didn't ask for this, ignore this message.`);
            if (!sent) await keepUnsentLink(DATA, "reset-links.txt", line, user.email);
        }
        // Whether mail is set up says nothing about whether the account exists.
        return json(200, { ok: true, mailConfigured: mailConfigured(), devMailFile: devMailFile() });
    }
    if (path === "/auth/reset") {
        const token = String(body.token ?? "");
        const user = token ? accounts.users.find((u) => u.reset?.token === token) : null;
        if (!user || user.reset.expires < Date.now()) return json(400, { error: "That reset link isn't valid any more. Ask for a new one." });
        const password = String(body.password ?? "");
        if (password.length < 8) return json(400, { error: "Use a password of at least 8 characters." });
        user.salt = randomBytes(16).toString("base64");
        user.hash = hashPassword(password, user.salt);
        delete user.reset;
        // The link came to this address, so the address is proven.
        markVerified(user);
        // Every other session ends.
        for (const [t, s] of Object.entries(accounts.sessions)) if (s.userId === user.id) delete accounts.sessions[t];
        return json(200, { token: startSession(user), user: selfUser(user) });
    }
    // The link from the verification mail (?verify-account=…): verifies the account and signs it in
    // on this device. An emailed invitation's token verifies the signed-in account it was sent to.
    if (path === "/auth/verify") {
        const token = String(body.token ?? "");
        if (!token || token.length > 200) return json(400, { error: "That verification link isn't valid." });
        const hash = hashToken(token);
        const owner = accounts.users.find((u) => typeof u.verify?.hash === "string" && u.verify.hash.length === hash.length && timingSafeEqual(Buffer.from(u.verify.hash), Buffer.from(hash)));
        if (owner) {
            const fresh = owner.verify.expires >= Date.now() && owner.verify.email === owner.email;
            delete owner.verify;
            saveAccounts();
            if (!fresh) return json(400, { error: "That verification link has expired. Sign in and send a new one." });
            markVerified(owner);
            return json(200, { token: startSession(owner), user: selfUser(owner) });
        }
        const user = userFromReq(req);
        if (user && takeInviteToken(token, user.email)) {
            markVerified(user);
            return json(200, { user: selfUser(user) });
        }
        return json(400, { error: "That verification link isn't valid any more. Sign in and send a new one." });
    }
    if (path === "/auth/verify/resend") {
        const user = userFromReq(req);
        if (!user) return json(401, { error: "Sign in first." });
        if (isVerified(user)) return json(200, { verified: true });
        if (!mailReady()) return json(409, { error: "Email isn't set up on this server, so an admin needs to verify your account." });
        const wait = resendWait(user);
        if (wait) return tooMany(res, wait);
        return json(200, await sendVerification(user, body.origin));
    }
    if (path === "/auth/admin/verify") {
        if (!isServerAdmin(userFromReq(req))) return json(403, { error: "Only a server admin can verify accounts." });
        const target = typeof body.userId === "string" ? userById(body.userId) : typeof body.email === "string" ? userByEmail(body.email) : null;
        if (!target) return json(404, { error: "No such account." });
        markVerified(target);
        return json(200, { id: target.id, emailVerified: true });
    }
    if (path === "/auth/password") {
        const user = userFromReq(req);
        if (!user) return json(401, { error: "Sign in first." });
        const keys = limitKeys(req, user.email);
        const wait = lockedFor(keys);
        if (wait) return tooMany(res, wait);
        const ok = timingSafeEqual(Buffer.from(hashPassword(body.current ?? "", user.salt)), Buffer.from(user.hash));
        if (!ok) {
            noteFailure(keys);
            return json(401, { error: "That isn't your current password." });
        }
        const password = String(body.password ?? "");
        if (password.length < 8) return json(400, { error: "Use a password of at least 8 characters." });
        user.salt = randomBytes(16).toString("base64");
        user.hash = hashPassword(password, user.salt);
        // Signed out everywhere else (as a reset does), so a session someone else has stops working.
        const header = String(req.headers.authorization ?? "");
        const mine = header.startsWith("Bearer ") ? header.slice(7) : null;
        for (const [t, s] of Object.entries(accounts.sessions)) if (s.userId === user.id && t !== mine) delete accounts.sessions[t];
        saveAccounts();
        return json(200, { ok: true });
    }
    if (path === "/auth/prefs") {
        const user = userFromReq(req);
        if (!user) return json(401, { error: "Sign in first." });
        user.prefs = { ...(user.prefs ?? {}), ...(typeof body.emailDigests === "boolean" ? { emailDigests: body.emailDigests } : {}) };
        // A personal Slack or Teams incoming webhook (https only, on those services' hosts), or "" to stop.
        if (typeof body.chatWebhook === "string") {
            const hook = body.chatWebhook.trim();
            if (hook && !/^https:\/\/(hooks\.slack\.com|[a-z0-9-]+\.webhook\.office\.com|[a-z0-9.-]+\.logic\.azure\.com)\//i.test(hook)) return json(400, { error: "Use a Slack or Teams incoming webhook address." });
            user.prefs.chatWebhook = hook.slice(0, 500) || undefined;
        }
        saveAccounts();
        return json(200, { prefs: user.prefs });
    }
    if (path === "/auth/signout") {
        const header = String(req.headers.authorization ?? "");
        const token = header.startsWith("Bearer ") ? header.slice(7) : null;
        if (token) {
            delete accounts.sessions[token];
            saveAccounts();
        }
        return json(200, { ok: true });
    }
    return false;
}

// ---- Mail: over SMTP when NAGMA_SMTP_URL is set (mail.mjs); otherwise a "mail skipped" line ----

// ---- Trash: files trashed for longer than TRASH_DAYS (30) are removed, at start and every six hours ----

const TRASH_DAYS = Number(process.env.TRASH_DAYS ?? 30);

async function removeFile(id) {
    const room = rooms.get(id);
    if (room) {
        for (const ws of room.clients.keys()) ws.close(4004, "The file was deleted.");
        rooms.delete(id);
    }
    await unlink(filePath(id)).catch(() => undefined);
    await unlink(metaPath(id)).catch(() => undefined);
    // Its published library and published site go with it.
    await rm(join(DATA, "libraries", id), { recursive: true, force: true }).catch(() => undefined);
    await rm(join(SITES, id), { recursive: true, force: true }).catch(() => undefined);
}

async function purgeTrash() {
    const names = (await readdir(DATA)).filter((n) => /^[A-Za-z0-9_-]{6,64}\.meta\.json$/.test(n));
    const cutoff = Date.now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const n of names) {
        const id = n.slice(0, -10);
        const meta = await readMeta(id);
        if (meta.trashed && (meta.trashedAt ?? meta.updatedAt ?? 0) < cutoff) {
            await removeFile(id);
            removed += 1;
        }
    }
    // Folders in the trash that long go as well (org is loaded by the time the files are read).
    const stale = org.projects.filter((p) => p.trashed && (p.trashedAt ?? 0) < cutoff).map((p) => p.id);
    if (stale.length) {
        org.projects = org.projects.filter((p) => !stale.includes(p.id));
        saveOrg();
    }
    if (removed) console.log(`Trash: removed ${removed} file${removed === 1 ? "" : "s"} older than ${TRASH_DAYS} days.`);
}
void purgeTrash();
setInterval(() => void purgeTrash(), 6 * 60 * 60 * 1000).unref();

// ---- Teams and projects: teams have members with roles; projects belong to a team; files sit in a project ----

const TEAMS = join(DATA, "teams.json");
let org = { teams: [], projects: [] };
try {
    org = JSON.parse(await readFile(TEAMS, "utf8"));
} catch {
    org = { teams: [], projects: [] };
}
let orgTimer = null;
function saveOrg() {
    clearTimeout(orgTimer);
    orgTimer = setTimeout(() => saveLater(TEAMS, JSON.stringify(org)), 100);
}
const TEAM_ROLES = new Set(["admin", "edit", "view"]);
const teamById = (id) => org.teams.find((t) => t.id === id) ?? null;
const projectById = (id) => org.projects.find((p) => p.id === id) ?? null;
const teamRole = (team, user) => (team && user ? (team.members[user.id] ?? null) : null);
const myTeams = (user) => (user ? org.teams.filter((t) => t.members[user.id]) : []);
// A folder as the file browser sees it.
const publicProject = (p, user) => ({ id: p.id, name: p.name, teamId: p.teamId, parentId: p.parentId ?? null, members: p.members ?? {}, role: memberProjectRole(p, user), createdAt: p.createdAt ?? 0, updatedAt: p.updatedAt ?? p.createdAt ?? 0, trashed: Boolean(p.trashed), trashedWith: p.trashedWith ?? null, trashedAt: p.trashedAt ?? null, trashedBy: p.trashedBy ?? null, createdBy: p.createdBy ?? null, color: p.color ?? null, audience: p.audience === "invited" ? "invited" : "team", guests: Object.entries(p.guests ?? {}).map(([id, role]) => ({ ...publicUser(userById(id)), role })).filter((g) => g.id), invites: Object.entries(p.invites ?? {}).map(([email, role]) => ({ email, role })), connections: Object.entries(p.connections ?? {}).map(([id, role]) => ({ id, name: teamById(id)?.name ?? "Team", role })) });
// Folders of other teams connected to `t` (with what's inside them), for people not on those teams.
function connectedProjects(t, user) {
    const out = [];
    for (const p of org.projects) {
        if (p.teamId === t.id || p.trashed || !p.connections?.[t.id] || teamRole(teamById(p.teamId), user)) continue;
        for (const x of projectSubtree(p)) if (!x.trashed) out.push({ ...publicProject(x, user), connectedFrom: teamById(p.teamId)?.name ?? "Another team" });
    }
    return out;
}
const publicTeam = (t, user) => ({
    id: t.id,
    name: t.name,
    role: teamRole(t, user),
    // The plan from the team's billing (admin console), shown beside its name.
    plan: admin.ensure(t).billing.plan,
    // Products the team's admins allow.
    features: { devMode: t.settings.devMode !== false, make: t.settings.make !== false, sitesPublishing: t.settings.sitesPublishing !== false },
    // Libraries turned on in the team's files unless someone turns them off (set by admins).
    defaultLibraries: t.settings?.defaultLibraries ?? [],
    members: Object.entries(t.members).map(([id, role]) => ({ ...publicUser(userById(id)), role })).filter((m) => m.id),
    projects: [...org.projects.filter((p) => p.teamId === t.id).map((p) => publicProject(p, user)), ...connectedProjects(t, user)],
});

// Projects are folders: each may sit inside another of the same team (parentId), to any depth.
// Projects from before nesting have no parentId and are the team's top-level folders.
function projectChain(project) {
    const chain = [];
    const seen = new Set();
    for (let p = project; p && !seen.has(p.id); p = p.parentId ? projectById(p.parentId) : null) {
        seen.add(p.id);
        chain.push(p);
    }
    return chain;
}
// A folder and everything inside it (the folder first).
function projectSubtree(project) {
    const out = [project];
    for (let i = 0; i < out.length; i += 1) for (const p of org.projects) if (p.parentId === out[i].id && !out.includes(p)) out.push(p);
    return out;
}

// A member's role inside a project: the nearest override on the folder or a folder around it, else
// the team role. Team admins keep admin access to every project; "none" shuts a member out of that
// folder (and the folders inside it, unless one of those lets them back in).
// People who aren't on the team get in through a folder invitation (by account or by email) or a
// team the folder is connected to; a folder shared with "only people invited" leaves the rest of the
// team out (admins keep access).
function memberProjectRole(project, user) {
    const team = project ? teamById(project.teamId) : null;
    if (!team || !user) return null;
    const base = teamRole(team, user);
    if (base === "admin") return "admin";
    const chain = projectChain(project);
    // Workspace admins (set in the admin console) administer the folders in their workspace.
    if (base && (team.workspaces ?? []).some((w) => w.admins?.includes(user.id) && chain.some((p) => w.folders?.includes(p.id)))) return "admin";
    for (const p of chain) {
        const override = base ? p.members?.[user.id] : null;
        if (override === "none") return null;
        if (override) return override;
        const guest = p.guests?.[user.id] ?? p.invites?.[user.email];
        if (guest === "edit" || guest === "view") return guest;
        const linked = connectionRole(p, user);
        if (linked) return linked;
        if (p.audience === "invited") return null;
    }
    return base;
}
// The best role a folder's connections to other teams give `user`.
function connectionRole(project, user) {
    let role = null;
    for (const [tid, r] of Object.entries(project.connections ?? {})) if (teamRole(teamById(tid), user) && (r === "edit" || r === "view")) role = role === "edit" ? role : r;
    return role;
}
const canEditProject = (project, user) => ["admin", "edit"].includes(memberProjectRole(project, user) ?? "");

// The team role a file's project gives `user`, as a file role.
function projectRole(file, user) {
    const project = file.project ? projectById(file.project) : null;
    const role = project ? memberProjectRole(project, user) : null;
    return role === "admin" || role === "edit" ? "edit" : role === "view" ? "view" : null;
}

async function serveTeams(req, res) {
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname;
    const user = userFromReq(req);
    const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
    const body = async () => {
        try {
            return parseObject(await readBody(req, 64 * 1024));
        } catch {
            return {};
        }
    };
    // Invite links: anyone can see what a link is for; accepting needs an account.
    const invite = /^\/invites\/([A-Za-z0-9_-]+)(\/accept)?$/.exec(path);
    if (invite) {
        // Own keys only: a token like "toString" or "__proto__" isn't an invite.
        const found = org.teams.map((t) => [t, t.invites && Object.hasOwn(t.invites, invite[1]) ? t.invites[invite[1]] : null]).find(([, i]) => i);
        if (!found) return json(404, { error: "That invite link isn't valid any more." });
        const [t, i] = found;
        if (!invite[2]) return json(200, { team: t.name, role: i.role, members: Object.keys(t.members).length });
        if (!user) return json(401, { error: "Sign in to join the team." });
        if (needsVerification(user) && !t.members[user.id]) return json(403, { error: VERIFY_FIRST, code: "email-unverified" });
        if (!t.members[user.id]) admin.noteJoined(t, user.id);
        if (!t.members[user.id] || t.members[user.id] === "view") t.members[user.id] = i.role;
        i.uses += 1;
        saveOrg();
        for (const room of rooms.values()) if (room.file) applyRoleChanges(room);
        return json(200, publicTeam(t, user));
    }
    if (!user) return json(401, { error: "Sign in first." });
    if (path === "/teams" && req.method === "GET") return json(200, myTeams(user).map((t) => publicTeam(t, user)));
    if (path === "/teams" && req.method === "POST") {
        if (needsVerification(user)) return json(403, { error: VERIFY_FIRST, code: "email-unverified" });
        const b = await body();
        const name = String(b.name ?? "").trim().slice(0, 60);
        if (!name) return json(400, { error: "Give the team a name." });
        const team = { id: randomBytes(9).toString("base64url"), name, createdAt: Date.now(), members: { [user.id]: "admin" } };
        org.teams.push(team);
        saveOrg();
        return json(200, publicTeam(team, user));
    }
    const team = /^\/teams\/([A-Za-z0-9_-]{6,64})$/.exec(path);
    if (team) {
        const t = teamById(team[1]);
        if (!t || !teamRole(t, user)) return json(404, { error: "No such team." });
        if (req.method === "GET") return json(200, publicTeam(t, user));
        if (req.method === "PUT") {
            if (teamRole(t, user) !== "admin") return json(403, { error: "Only team admins can change the team." });
            const b = await body();
            if (typeof b.name === "string" && b.name.trim()) t.name = b.name.trim().slice(0, 60);
            if (b.invite && typeof b.invite.email === "string") {
                const invitee = userByEmail(b.invite.email);
                if (!invitee) return json(404, { error: "No account with that email yet. Ask them to create one first." });
                if (needsVerification(user)) return json(403, { error: VERIFY_FIRST, code: "email-unverified" });
                if (needsVerification(invitee) && !t.members[invitee.id]) return json(403, { error: "That person hasn't verified their email yet. They can be added once they have.", code: "invitee-unverified" });
                if (!t.members[invitee.id]) {
                    admin.noteJoined(t, invitee.id);
                    notify(invitee.id, { why: "team-invite", teamId: t.id, fileName: t.name, author: { name: user.name, color: user.color }, text: `You're on ${t.name} now.` });
                }
                t.members[invitee.id] = TEAM_ROLES.has(b.invite.role) ? b.invite.role : "edit";
            }
            if (b.role && typeof b.role.userId === "string" && t.members[b.role.userId] && TEAM_ROLES.has(b.role.role)) t.members[b.role.userId] = b.role.role;
            if (typeof b.remove === "string" && b.remove !== user.id && t.members[b.remove]) {
                delete t.members[b.remove];
                await admin.onMemberRemoved(t, b.remove);
            }
            saveOrg();
            for (const room of rooms.values()) if (room.file) applyRoleChanges(room);
            return json(200, publicTeam(t, user));
        }
        if (req.method === "DELETE") {
            if (teamRole(t, user) !== "admin") return json(403, { error: "Only team admins can delete the team." });
            org.teams = org.teams.filter((x) => x.id !== t.id);
            org.projects = org.projects.filter((p) => p.teamId !== t.id);
            saveOrg();
            return json(200, { ok: true });
        }
    }
    // Leaving a team: anyone but its last admin.
    const leave = /^\/teams\/([A-Za-z0-9_-]{6,64})\/leave$/.exec(path);
    if (leave && req.method === "POST") {
        const t = teamById(leave[1]);
        if (!t || !teamRole(t, user)) return json(404, { error: "No such team." });
        const admins = Object.entries(t.members).filter(([, r]) => r === "admin").map(([id]) => id);
        if (admins.length === 1 && admins[0] === user.id && Object.keys(t.members).length > 1) return json(400, { error: "Make someone else an admin before you leave." });
        delete t.members[user.id];
        if (!Object.keys(t.members).length) {
            org.teams = org.teams.filter((x) => x.id !== t.id);
            org.projects = org.projects.filter((p) => p.teamId !== t.id);
        } else await admin.onMemberRemoved(t, user.id);
        saveOrg();
        for (const room of rooms.values()) if (room.file) applyRoleChanges(room);
        return json(200, { ok: true });
    }
    const invites = /^\/teams\/([A-Za-z0-9_-]{6,64})\/invites(?:\/([A-Za-z0-9_-]+))?$/.exec(path);
    if (invites) {
        const t = teamById(invites[1]);
        if (!t || teamRole(t, user) !== "admin") return json(403, { error: "Only team admins manage invite links." });
        t.invites ??= {};
        if (req.method === "POST") {
            if (needsVerification(user)) return json(403, { error: VERIFY_FIRST, code: "email-unverified" });
            const b = await body();
            const token = randomBytes(18).toString("base64url");
            t.invites[token] = { role: TEAM_ROLES.has(b.role) && b.role !== "admin" ? b.role : "edit", createdAt: Date.now(), uses: 0 };
            saveOrg();
            return json(200, { token, role: t.invites[token].role });
        }
        if (req.method === "DELETE" && invites[2]) {
            delete t.invites[invites[2]];
            saveOrg();
            return json(200, { ok: true });
        }
        if (req.method === "GET") return json(200, Object.entries(t.invites).map(([token, i]) => ({ token, ...i })));
    }
    const projects = /^\/teams\/([A-Za-z0-9_-]{6,64})\/projects$/.exec(path);
    if (projects && req.method === "POST") {
        const t = teamById(projects[1]);
        const role = teamRole(t, user);
        if (!t || !role) return json(404, { error: "No such team." });
        const b = await body();
        // A folder inside another folder needs edit access there; a top-level one, on the team.
        const parent = typeof b.parentId === "string" ? projectById(b.parentId) : null;
        if (b.parentId && (!parent || parent.teamId !== t.id || parent.trashed)) return json(404, { error: "No such folder." });
        if (parent ? !canEditProject(parent, user) : role === "view") return json(403, { error: "Viewers can't create folders." });
        const name = String(b.name ?? "").trim().slice(0, 60) || "Untitled folder";
        const project = { id: randomBytes(9).toString("base64url"), teamId: t.id, name, parentId: parent?.id ?? null, createdBy: user.id, createdAt: Date.now(), updatedAt: Date.now() };
        org.projects.push(project);
        if (parent) parent.updatedAt = Date.now();
        saveOrg();
        return json(200, { ...publicTeam(t, user), created: project.id });
    }
    const project = /^\/projects\/([A-Za-z0-9_-]{6,64})(\/forever|\/duplicate)?$/.exec(path);
    if (project) {
        const p = projectById(project[1]);
        const t = p ? teamById(p.teamId) : null;
        const role = teamRole(t, user);
        if (!p || !role) return json(404, { error: "No such folder." });
        if (!canEditProject(p, user)) return json(403, { error: "Only people who can edit this folder can change it." });
        if (project[2] === "/duplicate" && req.method === "POST") {
            const made = await duplicateProject(p, p.parentId ?? null, user, true);
            saveOrg();
            return json(200, { ...publicTeam(t, user), created: made });
        }
        if (project[2] === "/forever" && req.method === "DELETE") {
            // Only a folder that was deleted (not one inside it) is deleted for good, with what went with it.
            if (!p.trashed || p.trashedWith !== p.id) return json(400, { error: "Move the folder to the trash first." });
            const gone = new Set(org.projects.filter((x) => x.trashedWith === p.id).map((x) => x.id));
            org.projects = org.projects.filter((x) => !gone.has(x.id));
            saveOrg();
            let removed = 0;
            await eachServerFile(async (id, file, meta) => {
                if (meta.trashedWith === p.id || (meta.trashed && gone.has(file.project))) {
                    await removeFile(id);
                    removed += 1;
                }
            });
            return json(200, { ...publicTeam(t, user), removed });
        }
        if (project[2]) return json(404, { error: "Not found." });
        if (req.method === "PUT") {
            const b = await body();
            if (typeof b.name === "string" && b.name.trim()) p.name = b.name.trim().slice(0, 60);
            // Moving: into another folder of the same team (that you can edit), or to the top level.
            if (b.parentId !== undefined) {
                const target = b.parentId ? projectById(b.parentId) : null;
                if (b.parentId && (!target || target.teamId !== p.teamId || target.trashed)) return json(404, { error: "No such folder." });
                if (target ? !canEditProject(target, user) : role === "view") return json(403, { error: "You can't move folders there." });
                if (target && projectChain(target).some((x) => x.id === p.id)) return json(400, { error: "A folder can't go inside itself." });
                p.parentId = target?.id ?? null;
                if (target) target.updatedAt = Date.now();
                // Access inherited from the folders around it changes with the move.
                const moved = new Set(projectSubtree(p).map((x) => x.id));
                for (const room of rooms.values()) if (room.file?.project && moved.has(room.file.project)) applyRoleChanges(room);
            }
            // Restoring a deleted folder brings back what went to the trash with it.
            if (b.restore === true && p.trashed) {
                if (p.trashedWith !== p.id) return json(400, { error: "Restore the folder it was deleted with." });
                for (const x of org.projects) {
                    if (x.trashedWith !== p.id) continue;
                    x.trashed = false;
                    x.trashedWith = null;
                    x.trashedAt = null;
                }
                const parent = p.parentId ? projectById(p.parentId) : null;
                if (!parent || parent.trashed) p.parentId = null;
                await eachServerFile(async (id, _file, meta) => {
                    if (meta.trashedWith === p.id) await writeMeta(id, { trashed: false, trashedAt: null, trashedWith: null });
                });
            }
            // Per-folder access: { access: { userId, role: "edit" | "view" | "none" | null } } (editors
            // and admins; admins can't be shut out).
            if (b.access && typeof b.access.userId === "string") {
                if (!t.members[b.access.userId]) return json(404, { error: "That person isn't on the team." });
                if (t.members[b.access.userId] === "admin") return json(400, { error: "Team admins can open every folder." });
                p.members ??= {};
                if (b.access.role === null || b.access.role === undefined) delete p.members[b.access.userId];
                else if (["edit", "view", "none"].includes(b.access.role)) p.members[b.access.userId] = b.access.role;
                const inside = new Set(projectSubtree(p).map((x) => x.id));
                for (const room of rooms.values()) if (room.file?.project && inside.has(room.file.project)) applyRoleChanges(room);
            }
            if (b.invite && needsVerification(user)) return json(403, { error: VERIFY_FIRST, code: "email-unverified" });
            await folderSharing(p, t, user, b);
            p.updatedAt = Date.now();
            saveOrg();
            return json(200, publicTeam(t, user));
        }
        if (req.method === "DELETE") {
            // Deleting a folder sends it, the folders inside it and their files to the trash, together.
            const now = Date.now();
            const inside = projectSubtree(p).filter((x) => !x.trashed || x.id === p.id);
            for (const x of inside) {
                x.trashed = true;
                x.trashedWith = p.id;
                x.trashedAt = now;
                x.trashedBy = user.id;
            }
            const ids = new Set(inside.map((x) => x.id));
            saveOrg();
            await eachServerFile(async (id, file, meta) => {
                if (file.project && ids.has(file.project) && !meta.trashed) await writeMeta(id, { trashed: true, trashedAt: now, trashedWith: p.id, trashedBy: user.id });
            });
            return json(200, publicTeam(t, user));
        }
    }
    return false;
}

// ---- Folder colour and sharing: who has access (the team, or only people invited) and inviting
// people by email, on the team or not ----

const FOLDER_COLORS = new Set(["#b1bbd0", "#0d99ff", "#14ae5c", "#ffcd29", "#ffa629", "#f24822", "#9747ff", "#ff24bd", "#667799"]);
async function folderSharing(p, t, user, b) {
    if (b.color === null || FOLDER_COLORS.has(b.color)) p.color = b.color ?? undefined;
    if (b.audience === "team" || b.audience === "invited") p.audience = b.audience;
    // Whoever limits a folder to people invited stays in it.
    if (b.audience === "invited" && t.members[user.id] && t.members[user.id] !== "admin") (p.members ??= {})[user.id] ??= "edit";
    if (b.invite && typeof b.invite.emails === "string") {
        const role = b.invite.role === "view" ? "view" : "edit";
        const emails = b.invite.emails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).slice(0, 50);
        p.guests ??= {};
        p.invites ??= {};
        for (const email of emails) {
            const invitee = userByEmail(email);
            if (invitee && t.members[invitee.id] === "admin") continue;
            if (invitee && t.members[invitee.id]) (p.members ??= {})[invitee.id] = role;
            else if (invitee) p.guests[invitee.id] = role;
            else p.invites[email] = role;
            if (invitee) notify(invitee.id, { why: "folder-invite", teamId: t.id, fileName: p.name, author: { name: user.name, color: user.color }, text: `You can ${role === "edit" ? "edit" : "view"} the files in it now.` });
            if (!invitee || wantsEmail(invitee, "invites")) {
                const origin = (process.env.NAGMA_PUBLIC_URL ?? "").replace(/\/$/, "");
                const proof = origin ? inviteTokenFor(email) : null;
                await sendMail(email, `${user.name} shared the folder "${p.name}" with you`, `${user.name} invited you to ${role === "edit" ? "edit" : "view"} the files in "${p.name}" (${t.name}) on Nagma.${origin ? `\n\nOpen Nagma: ${origin}/${proof ? `?email-token=${proof}` : ""}` : ""}${invitee ? "" : "\n\nCreate an account with this email address to get in."}`);
            }
        }
    }
    if (b.guest && typeof b.guest === "object") {
        const role = b.guest.role === "view" ? "view" : b.guest.role === "edit" ? "edit" : null;
        if (typeof b.guest.userId === "string" && p.guests?.[b.guest.userId]) role ? (p.guests[b.guest.userId] = role) : delete p.guests[b.guest.userId];
        if (typeof b.guest.email === "string" && p.invites?.[b.guest.email]) role ? (p.invites[b.guest.email] = role) : delete p.invites[b.guest.email];
    }
    if (b.audience !== undefined || b.invite || b.guest) {
        const inside = new Set(projectSubtree(p).map((x) => x.id));
        for (const room of rooms.values()) if (room.file?.project && inside.has(room.file.project)) applyRoleChanges(room);
    }
}

// Creates a file on the server from a document (owned by the signed-in user), optionally in a project.
async function createServerFile(req, res) {
    const user = userFromReq(req);
    const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
    if (!user) return json(401, { error: "Sign in first." });
    let b;
    try {
        b = parseObject(await readBody(req, MAX_MESSAGE));
    } catch {
        return json(400, { error: "Bad request." });
    }
    if (!b.doc?.nodes) return json(400, { error: "A document is needed." });
    const project = typeof b.project === "string" ? projectById(b.project) : null;
    if (b.project && (!project || project.trashed || !canEditProject(project, user))) return json(403, { error: "You can't add files to that folder." });
    const made = await makeFile(user, b.doc, project?.id ?? null, typeof b.kind === "string" ? b.kind.slice(0, 20) : "design");
    return json(200, { id: made.id, keys: made.file.keys, project: project?.id ?? null });
}

// A new server file owned by `user` (in a project, or their drafts).
async function makeFile(user, doc, projectId, kind = "design", extra = {}) {
    const id = randomBytes(9).toString("base64url");
    const room = await loadRoom(id);
    room.file = { doc, comments: [], versions: [], keys: { edit: newKey(), view: newKey() }, owner: user.id, members: {}, link: "none", project: projectId, ...extra };
    room.version = 0;
    room.touched = Date.now();
    scheduleSave(room);
    await writeMeta(id, { kind, project: projectId, createdAt: Date.now() });
    return { id, file: room.file };
}

// Every server file (not branches), with its stored record and metadata.
async function eachServerFile(fn) {
    // Files on disk, plus new ones still only in memory (their first save is moments away).
    const ids = new Set((await readdir(DATA)).filter((n) => /^[A-Za-z0-9_-]{6,64}\.json$/.test(n)).map((n) => n.slice(0, -5)));
    for (const [id, room] of rooms) if (room.file) ids.add(id);
    for (const id of ids) {
        try {
            const file = rooms.get(id)?.file ?? JSON.parse(await readFile(filePath(id), "utf8"));
            if (!file?.doc || file.branchOf) continue;
            await fn(id, file, await readMeta(id));
        } catch {
            // A file that can't be read is left alone.
        }
    }
}

// Invitations sent to an email address before its account existed become the account's own
// (file members, folder guests), so they follow the person and not the address: changing the email
// keeps them, and whoever gets the old address later doesn't inherit them.
async function claimEmailInvites(user, email) {
    if (!user || !email) return;
    const ids = new Set((await readdir(DATA)).filter((n) => /^[A-Za-z0-9_-]{6,64}\.json$/.test(n)).map((n) => n.slice(0, -5)));
    for (const [id, room] of rooms) if (room.file) ids.add(id);
    for (const id of ids) {
        try {
            const stored = rooms.get(id)?.file ?? JSON.parse(await readFile(filePath(id), "utf8"));
            if (!stored?.invites || !Object.hasOwn(stored.invites, email)) continue;
            const room = await loadRoom(id);
            const invites = room.file?.invites;
            if (!invites || !Object.hasOwn(invites, email)) continue;
            if (room.file.owner !== user.id) room.file.members = { ...(room.file.members ?? {}), [user.id]: best(room.file.members?.[user.id] ?? null, fileRole(invites[email])) };
            delete invites[email];
            scheduleSave(room);
            applyRoleChanges(room);
        } catch {
            // A file that can't be read is left alone.
        }
    }
    let changed = false;
    for (const p of org.projects) {
        if (!p.invites || !Object.hasOwn(p.invites, email)) continue;
        p.guests = { ...(p.guests ?? {}), [user.id]: p.guests?.[user.id] ?? p.invites[email] };
        delete p.invites[email];
        changed = true;
    }
    if (changed) saveOrg();
}

// Copies a folder (and the folders and files inside it that `user` can open) under `parentId`.
// Returns the new folder's id.
async function duplicateProject(project, parentId, user, top) {
    const copy = { id: randomBytes(9).toString("base64url"), teamId: project.teamId, name: top ? `${project.name} (copy)`.slice(0, 60) : project.name, parentId, createdBy: user.id, createdAt: Date.now(), updatedAt: Date.now() };
    org.projects.push(copy);
    const files = [];
    await eachServerFile(async (id, file, meta) => {
        if (file.project === project.id && !meta.trashed && roleFor(file, user, "")) files.push([id, file, meta]);
    });
    for (const [, file, meta] of files) {
        const made = await makeFile(user, JSON.parse(JSON.stringify(file.doc)), copy.id, meta.kind ?? "design");
        if (meta.thumb) await writeMeta(made.id, { thumb: meta.thumb });
    }
    for (const child of org.projects.filter((x) => x.parentId === project.id && !x.trashed)) await duplicateProject(child, copy.id, user, false);
    return copy.id;
}

// ---- Permissions: a file's owner, the people invited to it, and what its link allows ----

// What a file's link allows: edit, view, view prototypes only, or nothing ("none": only people invited).
const LINK_ROLES = new Set(["edit", "view", "prototype", "none"]);
const FILE_ROLES = new Set(["edit", "view", "prototype"]);
const RANK = { prototype: 1, view: 2, edit: 3 };
const atMost = (role, cap) => (role && RANK[role] > RANK[cap] ? cap : role);
const best = (a, b) => (!a ? b : !b ? a : RANK[a] >= RANK[b] ? a : b);
const fileRole = (role) => (FILE_ROLES.has(role) ? role : "edit");

// ---- Files from before accounts (no owner): read-only until a server admin claims them ----
// The server admins are the accounts named in NAGMA_ADMINS (comma separated emails), or else the
// first account made on the server. A server with no accounts at all (a desktop app's own server)
// keeps the old open behaviour: there's nobody else to protect the files from.

function serverAdmins() {
    const named = String(process.env.NAGMA_ADMINS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (named.length) return accounts.users.filter((u) => named.includes(u.email));
    const first = [...accounts.users].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))[0];
    return first ? [first] : [];
}
const isServerAdmin = (user) => Boolean(user) && serverAdmins().some((u) => u.id === user.id);
const ownerless = (file) => !file.owner && accounts.users.length > 0;

// A server admin takes an ownerless file: it becomes theirs and gets new link keys (the old ones
// were handed to everyone while the file was open to all).
function claimFile(room, user) {
    room.file.owner = user.id;
    room.file.keys = { edit: newKey(), view: newKey() };
    if (!LINK_ROLES.has(room.file.link)) room.file.link = "none";
    room.file.claimedAt = Date.now();
    scheduleSave(room);
    applyRoleChanges(room);
    for (const [ws, c] of room.clients) if (c.role === "edit") send(ws, { type: "keys", keys: room.file.keys });
}

function accessOf(file) {
    return { owner: file.owner ?? null, members: file.members ?? {}, link: LINK_ROLES.has(file.link) ? file.link : "edit", invites: file.invites ?? {} };
}

// What `user` (maybe nobody) can do in `file`, given the link key they came with. The best of:
// owner, invited (by account or by email before they had one), the project's team, and the link.
function roleFor(file, user, key) {
    if (ownerless(file)) {
        // Server admins can edit (and claim) it; anyone else who could open it before can view it.
        if (isServerAdmin(user)) return "edit";
        const role = openRoleFor(file, user, key) ?? (user ? "view" : null);
        return atMost(role, "view");
    }
    return openRoleFor(file, user, key);
}

function openRoleFor(file, user, key) {
    const a = accessOf(file);
    let role = null;
    if (user) {
        if (a.owner === user.id) return "edit";
        const invited = a.members[user.id];
        if (FILE_ROLES.has(invited)) role = invited;
        const byEmail = a.invites[user.email];
        if (FILE_ROLES.has(byEmail)) role = best(role, byEmail);
        role = best(role, projectRole(file, user));
        role = best(role, groupRole(file, user));
    }
    if (a.link !== "none" && file.keys) {
        // A link key may carry the pass a link password gives (key~pass).
        const [k, pass] = String(key ?? "").split("~");
        if (linkGate(file, pass) === "open") {
            if (k === file.keys.edit) role = best(role, a.link);
            else if (k === file.keys.view) role = best(role, atMost(a.link, "view"));
        }
    }
    return role;
}

// Everyone with access to a file and how they got it: owner, invited, or through the project's team.
function peopleWithAccess(file) {
    const a = accessOf(file);
    const out = new Map();
    const add = (id, role, via) => {
        const u = publicUser(userById(id));
        if (u && !out.has(id)) out.set(id, { ...u, role, via });
    };
    if (a.owner) add(a.owner, "owner", "owner");
    for (const [id, role] of Object.entries(a.members)) add(id, role, "invited");
    for (const [gid, role] of Object.entries(file.groups ?? {})) for (const id of groupById(gid)?.group.members ?? []) add(id, role, "group");
    const project = file.project ? projectById(file.project) : null;
    const team = project ? teamById(project.teamId) : null;
    if (team) {
        for (const id of Object.keys(team.members)) {
            const role = memberProjectRole(project, userById(id));
            if (role) add(id, role === "admin" || role === "edit" ? "edit" : "view", "project");
        }
    }
    return [...out.values()];
}

// ---- Sharing: user groups, link passwords and expiry, access requests, and each person's inbox ----

// A team's user group (from the admin console), wherever it is.
function groupById(gid) {
    for (const team of org.teams) {
        const group = (team.groups ?? []).find((g) => g.id === gid);
        if (group) return { group, team };
    }
    return null;
}

// The best role any group the file was shared with gives `user`.
function groupRole(file, user) {
    let role = null;
    for (const [gid, r] of Object.entries(file.groups ?? {})) if (FILE_ROLES.has(r) && groupById(gid)?.group.members.includes(user.id)) role = best(role, r);
    return role;
}

// Groups `user` can share with: those of the teams they're on.
const groupsFor = (user) => myTeams(user).flatMap((t) => (t.groups ?? []).map((g) => ({ id: g.id, name: g.name, team: t.name, count: g.members.length })));

// What the link allows right now: "open", "expired", or "password" (a password is set and `pass`
// isn't the pass it gives). The pass changes whenever the password does.
const linkPass = (file) => createHmac("sha256", mediaSecret).update(`pass:${file.linkPassword.salt}:${file.linkPassword.hash}`).digest("base64url").slice(0, 22);
function linkGate(file, pass) {
    if (file.linkExpires && file.linkExpires < Date.now()) return "expired";
    if (file.linkPassword?.hash && pass !== linkPass(file)) return "password";
    return "open";
}

// Why someone with a link key can't get in (for the "denied" message), or null.
function deniedReason(file, key) {
    const [k] = String(key ?? "").split("~");
    if (!file.keys || (k !== file.keys.edit && k !== file.keys.view) || accessOf(file).link === "none") return null;
    const gate = linkGate(file, String(key ?? "").split("~")[1]);
    return gate === "open" ? null : gate;
}

// The inbox: notices for one person that don't come from comments (invitations, access requests and
// their answers, branch reviews). Kept in data/inbox.json, the newest 200 per person.
const INBOX = join(DATA, "inbox.json");
let inbox = {};
try {
    inbox = JSON.parse(await readFile(INBOX, "utf8"));
} catch {
    inbox = {};
}
let inboxTimer = null;
function saveInbox() {
    clearTimeout(inboxTimer);
    inboxTimer = setTimeout(() => saveLater(INBOX, JSON.stringify(inbox)), 100);
}
function notify(userId, notice) {
    if (!userId) return;
    const entry = { id: randomBytes(9).toString("base64url"), at: Date.now(), ...notice };
    inbox[userId] = [entry, ...(inbox[userId] ?? [])].slice(0, 200);
    saveInbox();
    return entry;
}

// Inbox notices in the bell's shape; access requests carry their current state.
async function inboxNotices(user) {
    const out = [];
    for (const n of inbox[user.id] ?? []) {
        const notice = { id: `inbox:${n.id}`, fileId: n.fileId, fileName: n.fileName ?? "a file", kind: n.kind ?? "design", key: null, threadId: n.threadId ?? null, author: n.author ?? { name: "Nagma", color: "#9747FF" }, text: n.text ?? "", at: n.at, why: n.why, resolved: false, branchId: n.branchId ?? null };
        if (n.why === "access-request" && n.fileId) {
            const room = await loadRoom(n.fileId);
            const r = (room.file?.accessRequests ?? []).find((x) => x.id === n.requestId);
            if (!r || !room.file || !canManage(room.file, user)) continue;
            notice.request = { id: r.id, role: r.role, status: r.status, decidedBy: r.decidedBy ?? null };
        }
        if (n.why === "team-request") {
            const t = teamById(n.teamId);
            const r = (t?.requests ?? []).find((x) => x.id === n.requestId);
            if (!r || teamRole(t, user) !== "admin") continue;
            notice.teamRequest = { teamId: t.id, id: r.id, kind: r.kind, seat: r.seat, status: r.status };
        }
        if (n.teamId) notice.teamId = n.teamId;
        if (n.fileId && n.why !== "access-denied") {
            const room = await loadRoom(n.fileId);
            if (room.file && roleFor(room.file, user, "") === "edit") notice.key = room.file.keys?.edit ?? null;
        }
        out.push(notice);
    }
    return out;
}

// The @mentions noted on a board (kept on its first page, see board/mentions.ts).
function boardMentions(file) {
    const page = file?.doc?.nodes?.[file.doc.roots?.[0] ?? ""];
    return page?.jam?.kind === "board" && Array.isArray(page.jam.mentions) ? page.jam.mentions.filter((m) => m && typeof m.to === "string") : [];
}
const userByName = (name) => accounts.users.find((u) => u.name === name) ?? null;

// Mail and an inbox notice for someone given access to a file.
async function announceInvite(room, by, email, role) {
    const invitee = userByEmail(email);
    const name = room.file.doc?.name ?? "Untitled";
    const verb = role === "edit" ? "edit" : role === "view" ? "view" : "view prototypes in";
    if (invitee) notify(invitee.id, { why: "invite", fileId: room.id, fileName: name, author: { name: by.name, color: by.color }, text: `You can ${verb} it now.` });
    const origin = process.env.NAGMA_PUBLIC_URL ?? "";
    if (invitee && !wantsEmail(invitee, "invites")) return;
    // The link proves the address to whoever opens it from this mail (and signs up with it).
    const proof = origin ? inviteTokenFor(email) : null;
    const link = origin ? `${origin.replace(/\/$/, "")}/?file=${room.id}${proof ? `&email-token=${proof}` : ""}` : "";
    const sent = await sendMail(email, `${by.name} shared "${name}" with you`, `${by.name} invited you to ${verb} "${name}" on Nagma.${link ? `\n\nOpen it: ${link}` : ""}${invitee ? "" : "\n\nCreate an account with this email address to open it."}`);
    // A development server keeps the invitation's link with the other mail links.
    if (!sent && proof && devMailFile()) await keepUnsentLink(DATA, "email-links.txt", `${new Date().toISOString()} invitation for ${email}: ${link} (valid 14 days)\n`, email);
}

// The parts of an access change that are about groups and the link's password and expiry:
// { inviteGroup: { id, role } }, { groupRole: { id, role } }, { removeGroup: id },
// { password: "…" | null }, { expires: <time> | null }.
function applySharingChanges(room, user, body) {
    const groups = { ...(room.file.groups ?? {}) };
    const mine = new Set(groupsFor(user).map((g) => g.id));
    if (body.inviteGroup && mine.has(body.inviteGroup.id)) {
        const role = fileRole(body.inviteGroup.role);
        groups[body.inviteGroup.id] = role;
        const found = groupById(body.inviteGroup.id);
        for (const uid of found?.group.members ?? []) {
            const u = userById(uid);
            if (u && uid !== room.file.owner && uid !== user.id) void announceInvite(room, user, u.email, role);
        }
    }
    if (body.groupRole && groups[body.groupRole.id]) groups[body.groupRole.id] = fileRole(body.groupRole.role);
    if (typeof body.removeGroup === "string") delete groups[body.removeGroup];
    room.file.groups = groups;
    if (body.password === null || body.password === "") delete room.file.linkPassword;
    else if (typeof body.password === "string") {
        const salt = randomBytes(16).toString("base64");
        room.file.linkPassword = { salt, hash: hashPassword(body.password.slice(0, 200), salt) };
    }
    if (body.expires === null) delete room.file.linkExpires;
    else if (Number.isFinite(body.expires)) room.file.linkExpires = Math.max(Date.now() + 60_000, Number(body.expires));
    // People in through the link now may not be any more (a new password, an earlier expiry).
    if (body.password !== undefined || body.expires !== undefined) broadcastLinkGate(room);
}

function broadcastLinkGate(room) {
    for (const [ws, client] of room.clients) {
        const next = roleFor(room.file, client.user, client.key);
        if (next) continue;
        send(ws, { type: "denied", reason: deniedReason(room.file, client.key) ?? "no-access", signedIn: Boolean(client.user) });
        ws.close(4003, "No access");
    }
}

// What the share dialog shows about groups, the link's password and expiry, and requests.
function sharingView(file, user) {
    const manage = canManage(file, user);
    return {
        groups: Object.entries(file.groups ?? {}).map(([gid, role]) => {
            const found = groupById(gid);
            return found ? { id: gid, name: found.group.name, team: found.team.name, count: found.group.members.length, role } : null;
        }).filter(Boolean),
        availableGroups: manage ? groupsFor(user) : [],
        password: Boolean(file.linkPassword?.hash),
        expires: file.linkExpires ?? null,
        requests: manage ? (file.accessRequests ?? []).filter((r) => r.status === "pending").map((r) => ({ id: r.id, role: r.role, note: r.note, at: r.at, user: publicUser(userById(r.userId)) })) : [],
        myRequest: user ? ((file.accessRequests ?? []).filter((r) => r.userId === user.id).at(-1) ?? null) : null,
    };
}

// /files/<id>/unlock, /files/<id>/requests[/<request id>]
async function serveSharing(req, res, url, id, rest) {
    const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
    const user = userFromReq(req);
    const room = await loadRoom(id);
    if (!room.file) return json(404, { error: "No such file." });
    const body = async () => {
        try {
            return parseObject(await readBody(req, 64 * 1024));
        } catch {
            return {};
        }
    };
    // A link password: the right one gives a pass to add to the link key. Wrong guesses back off.
    if (rest === "unlock" && req.method === "POST") {
        const b = await body();
        const keys = limitKeys(req, `file:${id}`);
        const wait = lockedFor(keys);
        if (wait) return tooMany(res, wait);
        if (linkGate(room.file, "") === "expired") return json(410, { error: "This link has expired. Ask the file's owner for a new one." });
        const pw = room.file.linkPassword;
        if (!pw?.hash) return json(200, { pass: "" });
        const ok = timingSafeEqual(Buffer.from(hashPassword(String(b.password ?? ""), pw.salt)), Buffer.from(pw.hash));
        if (!ok) {
            noteFailure(keys);
            return json(401, { error: "That password isn't right." });
        }
        return json(200, { pass: linkPass(room.file) });
    }
    if (!user) return json(401, { error: "Sign in to ask for access." });
    const name = room.file.doc?.name ?? "Untitled";
    if (rest === "requests" && req.method === "GET") {
        if (!canManage(room.file, user)) return json(403, { error: "Only editors see access requests." });
        return json(200, (room.file.accessRequests ?? []).filter((r) => r.status === "pending").map((r) => ({ ...r, user: publicUser(userById(r.userId)) })));
    }
    // Asking for access (no access yet) or for edit access (a viewer).
    if (rest === "requests" && req.method === "POST") {
        const b = await body();
        const want = b.role === "edit" ? "edit" : "view";
        const has = roleFor(room.file, user, "");
        if (has && RANK[has] >= RANK[want]) return json(400, { error: "You already have that access." });
        room.file.accessRequests ??= [];
        if (room.file.accessRequests.some((r) => r.userId === user.id && r.status === "pending")) return json(200, { ok: true, already: true });
        const r = { id: randomBytes(9).toString("base64url"), userId: user.id, role: want, note: String(b.note ?? "").slice(0, 500), at: Date.now(), status: "pending" };
        room.file.accessRequests = [...room.file.accessRequests, r].slice(-200);
        scheduleSave(room);
        // The owner and the people invited to edit hear about it.
        const managers = new Set([room.file.owner, ...Object.entries(room.file.members ?? {}).filter(([, role]) => role === "edit").map(([uid]) => uid)].filter(Boolean));
        const text = `${want === "edit" ? "Asks to edit" : "Asks for access"}${r.note ? `: "${r.note}"` : "."}`;
        for (const uid of managers) {
            notify(uid, { why: "access-request", fileId: id, fileName: name, requestId: r.id, author: { name: user.name, color: user.color }, text });
            const to = userById(uid);
            if (to) await sendMail(to.email, `${user.name} asks for ${want === "edit" ? "edit access to" : "access to"} "${name}"`, `${user.name} (${user.email}) ${want === "edit" ? "would like to edit" : "would like to open"} "${name}".${r.note ? `\n\n"${r.note}"` : ""}\n\nApprove or deny it from the notifications in Nagma.`);
        }
        return json(200, { ok: true });
    }
    const decide = /^requests\/([A-Za-z0-9_-]+)$/.exec(rest);
    if (decide && req.method === "POST") {
        if (!canManage(room.file, user)) return json(403, { error: "Only editors can answer access requests." });
        const r = (room.file.accessRequests ?? []).find((x) => x.id === decide[1]);
        if (!r) return json(404, { error: "No such request." });
        if (r.status !== "pending") return json(200, { ...r });
        const b = await body();
        const approve = Boolean(b.approve);
        r.status = approve ? "approved" : "denied";
        r.decidedBy = publicUser(user);
        r.decidedAt = Date.now();
        const asker = userById(r.userId);
        if (approve && asker && asker.id !== room.file.owner) {
            const role = FILE_ROLES.has(b.role) ? b.role : r.role;
            room.file.members = { ...(room.file.members ?? {}), [asker.id]: best(room.file.members?.[asker.id] ?? null, role) };
            applyRoleChanges(room);
        }
        scheduleSave(room);
        if (asker) {
            notify(asker.id, { why: approve ? "access-granted" : "access-denied", fileId: id, fileName: name, author: { name: user.name, color: user.color }, text: approve ? `Approved your request to ${r.role === "edit" ? "edit" : "open"} it.` : "Declined your request for access." });
            await sendMail(asker.email, approve ? `You can ${r.role === "edit" ? "edit" : "open"} "${name}" now` : `Your request for "${name}" was declined`, approve ? `${user.name} approved your request.` : `${user.name} declined your request for access to "${name}".`);
        }
        return json(200, { ...r });
    }
    return json(405, { error: "Not allowed." });
}

function canManage(file, user) {
    return Boolean(user) && roleFor(file, user, "") === "edit";
}

// Deleting a file for good is the owner's (or, in a team folder, a folder admin's; for a file from
// before accounts, a server admin's). Editors can move it to the trash, where the owner can restore it.
function canDeleteForever(file, user) {
    if (!user) return false;
    if (file.owner === user.id) return true;
    if (ownerless(file)) return isServerAdmin(user);
    const project = file.project ? projectById(file.project) : null;
    return Boolean(project && memberProjectRole(project, user) === "admin");
}

// A member's role changed: connected clients learn straight away.
function applyRoleChanges(room) {
    for (const [ws, client] of room.clients) {
        const next = roleFor(room.file, client.user, client.key);
        if (next === client.role) continue;
        client.role = next;
        if (!next) {
            send(ws, { type: "denied" });
            ws.close(4003, "No access");
        } else {
            send(ws, { type: "role", role: next, keys: next === "edit" ? room.file.keys : undefined });
        }
    }
}

// ---- Media: video files and other large assets, by id ----

const MEDIA = join(DATA, "media");
await mkdir(MEDIA, { recursive: true });
const MAX_MEDIA = 1024 * 1024 * 1024;
const mediaPath = (id) => join(MEDIA, id);

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS", "access-control-allow-headers": "content-type, authorization, x-nagma-ai" };

// A request's body, up to `limit` bytes; more rejects with "too large". The rest of a body that's too
// large is read and dropped rather than cutting the connection, so the route's answer (a 413 that
// says what was too large) reaches the caller; one far over the limit is cut off.
function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let over = false;
        const tooLarge = () => {
            over = true;
            chunks.length = 0;
            reject(new Error("too large"));
        };
        if (Number(req.headers["content-length"]) > limit) tooLarge();
        req.on("data", (c) => {
            size += c.length;
            if (over) {
                if (size > limit + 16 * 1024 * 1024) req.destroy();
                return;
            }
            if (size > limit) return tooLarge();
            chunks.push(c);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

// ---- Media access: every asset belongs to the files it was uploaded to or is used in ----
// Uploads need someone signed in with edit access to the file (?file=<id>). Downloads need access to
// a file (any role, by account, invitation, team or link key) that the asset belongs to: it was
// uploaded there, or the file's document or comments use it. A short-lived signed address
// (/media/<id>/url) lets places that can't send headers (a <video> element) load it too.

const SECRET_PATH = join(DATA, "secret.key");
let mediaSecret;
try {
    mediaSecret = await readFile(SECRET_PATH);
} catch {
    mediaSecret = randomBytes(32);
    await writeFile(SECRET_PATH, mediaSecret, { mode: 0o600 });
}
const MEDIA_URL_MS = 10 * 60 * 1000;
const mediaSignature = (id, exp) => createHmac("sha256", mediaSecret).update(`media:${id}:${exp}`).digest("base64url");

async function readMediaMeta(id) {
    try {
        return JSON.parse(await readFile(`${mediaPath(id)}.meta.json`, "utf8"));
    } catch {
        return null;
    }
}

// Whether a file's document (or its comments) uses the asset. The text is kept per document version.
function fileUses(room, id) {
    if (!room.file) return false;
    if (room.usesText?.version !== room.version) room.usesText = { version: room.version, text: `${JSON.stringify(room.file.doc ?? {})}${JSON.stringify(room.file.comments ?? [])}` };
    return room.usesText.text.includes(id);
}

// The file (of those asked about) through which `user` may load the asset, or null.
async function mediaFileFor(id, meta, fileIds, user, key) {
    for (const fid of fileIds) {
        if (!validId(fid)) continue;
        const room = await loadRoom(fid);
        if (!room.file || !roleFor(room.file, user, key)) continue;
        if ((meta.files ?? []).includes(fid) || fileUses(room, id)) return fid;
    }
    return null;
}

async function serveMedia(req, res, url, id, wantsUrl) {
    const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
    const user = userFromReq(req);
    const key = url.searchParams.get("key") ?? "";
    const fileIds = url.searchParams.getAll("file").slice(0, 4);
    const meta = await readMediaMeta(id);
    if (req.method === "PUT") {
        if (!user) return json(401, { error: "Sign in to upload." });
        const fid = fileIds[0];
        const room = validId(fid) ? await loadRoom(fid) : null;
        if (!room?.file || roleFor(room.file, user, key) !== "edit") return json(403, { error: "Only people who can edit the file can add media to it." });
        if (meta) {
            // An asset never changes once stored; the same upload again just says so.
            const mine = await mediaFileFor(id, meta, meta.files ?? [], user, "");
            if (!mine && !(meta.files ?? []).includes(fid)) return json(409, { error: "That media id is taken." });
            if (!(meta.files ?? []).includes(fid)) await writeFile(`${mediaPath(id)}.meta.json`, JSON.stringify({ ...meta, files: [...(meta.files ?? []), fid].slice(-50) }));
            return json(200, { ok: true, size: meta.size, existing: true });
        }
        try {
            const body = await readBody(req, MAX_MEDIA);
            const type = String(req.headers["content-type"] ?? "application/octet-stream").slice(0, 100);
            await writeFile(`${mediaPath(id)}.tmp`, body);
            await rename(`${mediaPath(id)}.tmp`, mediaPath(id));
            await writeFile(`${mediaPath(id)}.meta.json`, JSON.stringify({ type, size: body.length, files: [fid], by: user.id, at: Date.now() }));
            return json(200, { ok: true, size: body.length });
        } catch (error) {
            return json(413, { error: String(error?.message ?? error) });
        }
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(405, { error: "Method not allowed." });
    // Unknown ids answer like forbidden ones until someone signs in, so ids cannot be probed.
    if (!meta) return user || key ? (res.writeHead(404, CORS).end(), true) : json(401, { error: "No access to that media." });
    // A signed address made for someone with access a few minutes ago.
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig");
    let ok = false;
    if (sig && Number.isFinite(exp) && exp > Date.now()) {
        const expected = Buffer.from(mediaSignature(id, exp));
        ok = expected.length === Buffer.from(sig).length && timingSafeEqual(expected, Buffer.from(sig));
    }
    if (!ok) {
        const fid = await mediaFileFor(id, meta, fileIds, user, key);
        if (!fid) return json(user || key ? 403 : 401, { error: "No access to that media." });
        // Remember where it's used, so it stays reachable from this file.
        if (!(meta.files ?? []).includes(fid)) await writeFile(`${mediaPath(id)}.meta.json`, JSON.stringify({ ...meta, files: [...(meta.files ?? []), fid].slice(-50) })).catch(() => undefined);
        if (wantsUrl) {
            const until = Date.now() + MEDIA_URL_MS;
            return json(200, { url: `/media/${id}?exp=${until}&sig=${mediaSignature(id, until)}`, expires: until });
        }
    }
    try {
        const info = await stat(mediaPath(id));
        res.writeHead(200, { ...CORS, "content-type": meta.type ?? "application/octet-stream", "content-length": info.size, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox" });
        if (req.method === "HEAD") res.end();
        else createReadStream(mediaPath(id)).pipe(res);
    } catch {
        res.writeHead(404, CORS).end();
    }
    return true;
}

// ---- Libraries: what shared files publish (a manifest, plus one record per component or image) ----
// A library's id is its file's id, so who may see or publish it follows the file's access.

const LIBS = join(DATA, "libraries");
await mkdir(LIBS, { recursive: true });
const libDir = (id) => join(LIBS, id);
const libItemPath = (id, key) => join(LIBS, id, "items", `${Buffer.from(String(key)).toString("base64url")}.json`);

async function readManifest(id) {
    try {
        return JSON.parse(await readFile(join(libDir(id), "manifest.json"), "utf8"));
    } catch {
        return null;
    }
}

async function serveLibraries(req, res, path) {
    const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
    const user = userFromReq(req);
    if (path === "/libraries" && req.method === "GET") {
        const out = [];
        for (const id of await readdir(LIBS).catch(() => [])) {
            if (!validId(id)) continue;
            const manifest = await readManifest(id);
            if (!manifest) continue;
            const room = await loadRoom(id);
            if (room.file && !roleFor(room.file, user, "")) continue;
            const { components: _c, styles: _s, variables: _v, variableHashes: _h, history: _y, ...summary } = manifest;
            out.push({ ...summary, server: true });
        }
        return json(200, out);
    }
    const m = /^\/libraries\/([A-Za-z0-9_-]{6,64})(\/items(\/get)?)?$/.exec(path);
    if (!m) return json(404, { error: "Not found." });
    const id = m[1];
    const room = await loadRoom(id);
    if (!room.file) return json(404, { error: "No such file." });
    const role = roleFor(room.file, user, "");
    const readable = Boolean(role);
    const writable = role === "edit";
    if (!m[2]) {
        if (req.method === "GET") {
            if (!readable) return json(403, { error: "No access to this library." });
            const manifest = await readManifest(id);
            return manifest ? json(200, manifest) : json(404, { error: "Not published." });
        }
        if (req.method === "PUT") {
            if (!writable) return json(403, { error: "Only editors of the file can publish it." });
            if (needsVerification(user)) return json(403, { error: VERIFY_FIRST, code: "email-unverified" });
            let body;
            try {
                body = parseObject(await readBody(req, MAX_MESSAGE));
            } catch {
                return json(400, { error: "Bad request." });
            }
            if (!body?.manifest || body.manifest.id !== id) return json(400, { error: "A manifest for this file is needed." });
            await mkdir(join(libDir(id), "items"), { recursive: true });
            for (const key of Array.isArray(body.removed) ? body.removed : []) await unlink(libItemPath(id, key)).catch(() => undefined);
            await writeAtomic(join(libDir(id), "manifest.json"), JSON.stringify({ ...body.manifest, server: true }));
            // A publish is a moment in the file's version history too, with its note.
            if (room.file.doc) {
                const actor = { uid: user?.id ?? null, presence: { name: user?.name ?? "Nagma", color: user?.color ?? "#9747FF" } };
                await saveVersion(room, actor, `Published library v${body.manifest.version ?? ""}`.trim(), false, { description: String(body.manifest.description ?? "").slice(0, 1000) || null, label: "Library published" });
                broadcast(room, { type: "versions", versions: room.file.versions });
            }
            return json(200, { ok: true, version: body.manifest.version });
        }
        if (req.method === "DELETE") {
            if (!writable) return json(403, { error: "Only editors of the file can unpublish it." });
            await rm(libDir(id), { recursive: true, force: true });
            return json(200, { ok: true });
        }
        return json(405, { error: "Method not allowed." });
    }
    if (m[3] && req.method === "POST") {
        if (!readable) return json(403, { error: "No access to this library." });
        let body;
        try {
            body = parseObject(await readBody(req, 1024 * 1024));
        } catch {
            return json(400, { error: "Bad request." });
        }
        const out = {};
        for (const key of (Array.isArray(body?.keys) ? body.keys : []).slice(0, 500)) {
            if (typeof key !== "string" || key.length > 300) continue;
            try {
                out[key] = JSON.parse(await readFile(libItemPath(id, key), "utf8"));
            } catch {
                // Missing items are left out.
            }
        }
        return json(200, out);
    }
    if (!m[3] && req.method === "PUT") {
        if (!writable) return json(403, { error: "Only editors of the file can publish it." });
        let body;
        try {
            body = parseObject(await readBody(req, MAX_MESSAGE));
        } catch {
            return json(400, { error: "Bad request." });
        }
        await mkdir(join(libDir(id), "items"), { recursive: true });
        let count = 0;
        for (const [key, item] of Object.entries(body?.items ?? {})) {
            if (key.length > 300) continue;
            await writeFile(libItemPath(id, key), JSON.stringify(item));
            count++;
        }
        return json(200, { ok: true, count });
    }
    return json(405, { error: "Method not allowed." });
}

// ---- Campaign templates: assets published to a team, for anyone on it to start from ----
// One JSON file per template under data/asset-templates: its details, a picture, and the asset's
// layers with the images they use (as data URLs, so any file can take them in). Reading needs a
// signed-in team member; publishing, updating and unpublishing also need edit access to the file
// the template comes from.

const ASSET_TEMPLATES = join(DATA, "asset-templates");
await mkdir(ASSET_TEMPLATES, { recursive: true });
const assetTemplatePath = (id) => join(ASSET_TEMPLATES, `${id}.json`);

async function readAssetTemplate(id) {
    try {
        return JSON.parse(await readFile(assetTemplatePath(id), "utf8"));
    } catch {
        return null;
    }
}

const assetTemplateSummary = ({ payload: _p, ...t }) => t;

async function serveAssetTemplates(req, res, url) {
    const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
    const user = userFromReq(req);
    if (!user) return json(401, { error: "Sign in to use team templates." });
    const m = /^\/asset-templates(?:\/([A-Za-z0-9_-]{6,64}))?$/.exec(url.pathname);
    if (!m) return json(404, { error: "Not found." });
    const id = m[1];
    if (!id && req.method === "GET") {
        const teamId = url.searchParams.get("team") ?? "";
        const team = teamById(teamId);
        if (!team || !teamRole(team, user)) return json(403, { error: "Only people on the team can see its templates." });
        const out = [];
        for (const name of await readdir(ASSET_TEMPLATES).catch(() => [])) {
            if (!name.endsWith(".json")) continue;
            const t = await readAssetTemplate(name.slice(0, -5));
            if (t && t.teamId === teamId) out.push(assetTemplateSummary(t));
        }
        out.sort((a, b) => b.updatedAt - a.updatedAt);
        return json(200, out);
    }
    if (!id) return json(405, { error: "Method not allowed." });
    const existing = await readAssetTemplate(id);
    if (req.method === "GET") {
        if (!existing) return json(404, { error: "That template isn't published." });
        if (!teamRole(teamById(existing.teamId), user)) return json(403, { error: "Only people on the team can use its templates." });
        return json(200, existing);
    }
    // Publishing and unpublishing: the source file's editors who are on the team (and not view-only there).
    const mayPublish = async (teamId, fileId) => {
        const role = teamRole(teamById(teamId), user);
        if (!role || role === "view") return "Only the team's editors can publish templates to it.";
        const room = validId(fileId) ? await loadRoom(fileId) : null;
        if (!room?.file) return "Move the file to the server before publishing its templates.";
        if (roleFor(room.file, user, url.searchParams.get("key") ?? "") !== "edit") return "Only editors of the file can publish its templates.";
        return null;
    };
    if (req.method === "PUT") {
        let body;
        try {
            body = parseObject(await readBody(req, MAX_MESSAGE));
        } catch {
            return json(400, { error: "Bad request." });
        }
        const teamId = existing?.teamId ?? String(body.teamId ?? "");
        const fileId = existing?.fileId ?? String(body.fileId ?? "");
        const denied = await mayPublish(teamId, fileId);
        if (denied) return json(403, { error: denied });
        if (!body.payload || !Array.isArray(body.payload.nodes) || !body.payload.nodes.length) return json(400, { error: "A template needs its layers." });
        const now = Date.now();
        const record = {
            id,
            teamId,
            fileId,
            assetId: String(body.assetId ?? existing?.assetId ?? ""),
            name: String(body.name ?? existing?.name ?? "Template").trim().slice(0, 120) || "Template",
            description: String(body.description ?? existing?.description ?? "").slice(0, 1000),
            category: String(body.category ?? existing?.category ?? "").slice(0, 60),
            w: Number(body.w) || existing?.w || 0,
            h: Number(body.h) || existing?.h || 0,
            preset: String(body.preset ?? existing?.preset ?? "custom").slice(0, 60),
            thumb: typeof body.thumb === "string" && body.thumb.length < 400_000 ? body.thumb : (existing?.thumb ?? null),
            version: (existing?.version ?? 0) + 1,
            publishedBy: existing?.publishedBy ?? publicUser(user),
            publishedAt: existing?.publishedAt ?? now,
            updatedBy: publicUser(user),
            updatedAt: now,
            payload: { nodes: body.payload.nodes, images: body.payload.images && typeof body.payload.images === "object" ? body.payload.images : {} },
        };
        await writeAtomic(assetTemplatePath(id), JSON.stringify(record));
        return json(200, assetTemplateSummary(record));
    }
    if (req.method === "DELETE") {
        if (!existing) return json(404, { error: "That template isn't published." });
        const denied = await mayPublish(existing.teamId, existing.fileId);
        if (denied) return json(403, { error: denied });
        await unlink(assetTemplatePath(id)).catch(() => undefined);
        return json(200, { ok: true });
    }
    return json(405, { error: "Method not allowed." });
}

// ---- Board voting: ballots stay on the server until the session ends ----
// While a voting session is open, each person's votes are kept here (room.file.ballots, by session
// and voter), not in the shared document, where everyone in the file could read them. The document
// only carries the session itself, names and who's done. When the session ends (the host ends it, or
// its time runs out), the ballots go into the document as the results, in one patch everyone gets.

function boardVoting(doc) {
    const page = doc?.nodes?.[doc?.roots?.[0] ?? ""];
    const jam = page?.jam;
    return jam?.kind === "board" && plainObject(jam.voting) ? { page, jam, voting: jam.voting } : null;
}

const votingIsOpen = (v) => Boolean(v.open && (!v.endsAt || Date.now() < v.endsAt));

function turnoutOf(room, session) {
    return Object.values(room.file.ballots?.[session] ?? {}).filter((ids) => ids.length).length;
}

// A ballot from someone in the file: { session, votes: [layer ids] }.
function castBallot(room, client, ws, message) {
    const found = boardVoting(room.file.doc);
    if (!found || typeof message.session !== "string" || found.voting.id !== message.session || !votingIsOpen(found.voting)) return send(ws, { type: "ballot", session: message.session ?? null, votes: [], refused: "closed" });
    const limit = Math.max(1, Math.min(99, Number(found.voting.limit) || 1));
    const votes = (Array.isArray(message.votes) ? message.votes : []).filter((id) => typeof id === "string" && Object.hasOwn(room.file.doc.nodes, id)).slice(0, limit);
    const session = found.voting.id;
    room.file.ballots = { [session]: { ...(room.file.ballots?.[session] ?? {}), [client.uid]: votes } };
    scheduleSave(room);
    send(ws, { type: "ballot", session, votes });
    broadcast(room, { type: "turnout", session, voted: turnoutOf(room, session) });
}

// Ends the hiding once a session is over: its ballots become the document's votes. Also drops the
// ballots of sessions that were cleared or replaced.
function revealBallots(room) {
    if (!room.file.ballots) return;
    const found = boardVoting(room.file.doc);
    const session = found?.voting.id;
    for (const id of Object.keys(room.file.ballots)) if (id !== session) delete room.file.ballots[id];
    if (!found || !room.file.ballots[session] || votingIsOpen(found.voting)) return;
    const votes = Object.fromEntries(Object.entries(room.file.ballots[session]).filter(([, ids]) => ids.length));
    delete room.file.ballots[session];
    const patch = { nodes: { [found.page.id]: { jam: { ...found.jam, voting: { ...found.voting, open: false, votes } } } } };
    applyPatch(room.file.doc, patch);
    room.version += 1;
    scheduleSave(room);
    broadcast(room, { type: "patch", version: room.version, patch, id: null, from: null });
}

// ---- Campaign reviews: asking people to approve assets ----
// Kept on the file (file.assetReviews, by asset id): who asked, the reviewers, each reviewer's
// decision with a comment, and the history. Everything needs a signed-in person with access to
// the file; asking needs edit access, deciding needs to be one of the reviewers. Reviewers and the
// person who asked hear about it through the inbox (the bell) and by mail.

function assetReviewState(review) {
    const decisions = Object.values(review.decisions ?? {});
    if (decisions.some((d) => d.decision === "changes")) return "changes";
    if (decisions.some((d) => d.decision === "approved")) return "approved";
    return "pending";
}

const publicAssetReview = (assetId, r) => ({ assetId, ...r, status: assetReviewState(r) });

// The reviewed assets a patch changes: an asset, or any layer inside it (where it was before the
// patch and where it is after; call before and after applying).
function assetsTouched(file, patch) {
    const out = new Set();
    const reviewed = file.assetReviews ?? {};
    if (!Object.keys(reviewed).length) return out;
    const nodes = file.doc?.nodes ?? {};
    const ids = [...Object.keys(patch.nodes ?? {}), ...Object.keys(patch.removed ?? {})];
    for (const id of ids) {
        let at = id;
        for (let hops = 0; at && hops < 200; hops++) {
            if (Object.hasOwn(reviewed, at)) out.add(at);
            at = Object.hasOwn(nodes, at) ? nodes[at]?.parentId : null;
        }
    }
    return out;
}

// An approved asset that's changed afterwards goes back to waiting for its reviewers: the approval
// was for what they saw. True when any approval was withdrawn.
function resetApprovals(room, assetIds, user) {
    let changed = false;
    for (const id of assetIds) {
        const review = room.file.assetReviews?.[id];
        if (!review || assetReviewState(review) !== "approved") continue;
        review.decisions = {};
        review.history = [...(review.history ?? []), { kind: "reset", by: user ? publicUser(user) : { id: null, name: "Someone", color: "#888888" }, note: "Edited after approval", at: Date.now() }].slice(-50);
        changed = true;
    }
    return changed;
}

async function serveAssetReviews(req, res, url, id, assetId, decide) {
    const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
    const user = userFromReq(req);
    if (!user) return json(401, { error: "Sign in to work with reviews." });
    const room = await loadRoom(id);
    if (!room.file) return json(404, { error: "No such file." });
    const role = roleFor(room.file, user, url.searchParams.get("key") ?? "");
    if (!role || role === "prototype") return json(403, { error: "No access to this file." });
    const reviews = room.file.assetReviews ?? {};
    const list = () => json(200, { reviews: Object.entries(room.file.assetReviews ?? {}).map(([aid, r]) => publicAssetReview(aid, r)) });
    const body = async () => {
        try {
            return parseObject(await readBody(req, 64 * 1024));
        } catch {
            return {};
        }
    };
    const fileName = room.file.doc?.name ?? "Untitled";
    const assetName = (aid) => String(room.file.doc?.nodes?.[aid]?.name ?? "an asset");
    const link = process.env.NAGMA_PUBLIC_URL ? `\n\nOpen it: ${process.env.NAGMA_PUBLIC_URL.replace(/\/$/, "")}/?file=${room.id}` : "";
    if (!assetId && req.method === "GET") return list();
    if (!assetId && req.method === "POST") {
        if (role !== "edit") return json(403, { error: "Only editors can ask for reviews." });
        const b = await body();
        const ids = (Array.isArray(b.assetIds) ? b.assetIds : []).filter((a) => typeof a === "string" && room.file.doc?.nodes?.[a]).slice(0, 200);
        if (!ids.length) return json(400, { error: "Pick the assets to review." });
        const emails = String(b.emails ?? "").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean).slice(0, 20);
        const reviewers = [];
        for (const email of emails) {
            const u = userByEmail(email);
            if (!u) return json(400, { error: `No one with the email ${email} has an account here.` });
            if (!reviewers.some((r) => r.id === u.id)) reviewers.push(u);
        }
        if (!reviewers.length) return json(400, { error: "Choose at least one reviewer." });
        const note = String(b.note ?? "").slice(0, 1000);
        const at = Date.now();
        for (const aid of ids) {
            const before = reviews[aid];
            reviews[aid] = { requestedBy: publicUser(user), reviewers: reviewers.map(publicUser), note, at, decisions: {}, history: [...(before?.history ?? []), { kind: "requested", by: publicUser(user), note, at }].slice(-50) };
        }
        room.file.assetReviews = reviews;
        for (const u of reviewers) {
            // Reviewers need to be able to open the file.
            if (!roleFor(room.file, u, "")) room.file.members = { ...(room.file.members ?? {}), [u.id]: "view" };
            const what = ids.length === 1 ? `"${assetName(ids[0])}"` : `${ids.length} assets`;
            notify(u.id, { why: "asset-review-request", fileId: room.id, fileName, kind: "campaign", author: { name: user.name, color: user.color }, text: note || `Review ${what}.` });
            void sendMail(u.email, `${user.name} asked you to review ${what}`, `${user.name} asked you to review ${what} in "${fileName}".${note ? `\n\n"${note}"` : ""}${link}`);
        }
        applyRoleChanges(room);
        scheduleSave(room);
        return list();
    }
    const review = reviews[assetId];
    if (!review) return json(404, { error: "Nobody asked for a review of that asset." });
    if (decide && req.method === "POST") {
        if (!review.reviewers.some((r) => r.id === user.id)) return json(403, { error: "Only the reviewers can approve or ask for changes." });
        const b = await body();
        if (!["approved", "changes"].includes(b.decision)) return json(400, { error: "Approve or request changes." });
        const note = String(b.note ?? "").trim().slice(0, 2000);
        const at = Date.now();
        review.decisions = { ...(review.decisions ?? {}), [user.id]: { decision: b.decision, note, at, by: publicUser(user) } };
        review.history = [...(review.history ?? []), { kind: b.decision, by: publicUser(user), note, at }].slice(-50);
        scheduleSave(room);
        const to = review.requestedBy?.id;
        if (to && to !== user.id) {
            const verb = b.decision === "approved" ? "Approved" : "Requested changes";
            notify(to, { why: "asset-review", fileId: room.id, fileName, kind: "campaign", author: { name: user.name, color: user.color }, text: `${verb} on "${assetName(assetId)}"${note ? `: ${note}` : "."}` });
            const u = userById(to);
            if (u) void sendMail(u.email, `${user.name} ${b.decision === "approved" ? "approved" : "requested changes to"} "${assetName(assetId)}"`, `${note || (b.decision === "approved" ? "The asset is approved." : "Have a look at the comments on the asset.")}${link}`);
        }
        return list();
    }
    if (!decide && req.method === "DELETE") {
        if (role !== "edit") return json(403, { error: "Only editors can cancel reviews." });
        delete reviews[assetId];
        room.file.assetReviews = reviews;
        scheduleSave(room);
        return list();
    }
    return json(405, { error: "Method not allowed." });
}

async function serveApi(req, res) {
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname;
    if (req.method === "OPTIONS") {
        res.writeHead(204, CORS).end();
        return true;
    }
    const media = /^\/media\/([A-Za-z0-9_-]{6,64})(\/url)?$/.exec(path);
    if (media) return serveMedia(req, res, url, media[1], Boolean(media[2]));
    if (path === "/libraries" || path.startsWith("/libraries/")) return serveLibraries(req, res, path);
    const assetReviews = /^\/files\/([A-Za-z0-9_-]{6,64})\/asset-reviews(?:\/([A-Za-z0-9_-]{1,64})(\/decide)?)?$/.exec(path);
    if (assetReviews) return serveAssetReviews(req, res, url, assetReviews[1], assetReviews[2] ?? null, Boolean(assetReviews[3]));
    const publish = /^\/files\/([A-Za-z0-9_-]{6,64})\/site$/.exec(path);
    if (publish) return servePublish(req, res, url, publish[1]);
    const hosting = /^\/files\/([A-Za-z0-9_-]{6,64})\/site\/(settings|verify|ticket)$/.exec(path);
    if (hosting) return siteHosting.serveSettings(req, res, url, hosting[1], hosting[2]);
    if (path === "/files" && req.method === "POST") return createServerFile(req, res);
    if (path === "/files" && req.method === "GET") {
        const user = userFromReq(req);
        res.writeHead(200, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(await listFiles(user)));
        return true;
    }
    const access = /^\/files\/([A-Za-z0-9_-]{6,64})\/access$/.exec(path);
    if (access) {
        const room = await loadRoom(access[1]);
        const user = userFromReq(req);
        const json = (status, body) => res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body));
        if (!room.file) return json(404, { error: "No such file." }), true;
        if (!user || !roleFor(room.file, user, url.searchParams.get("key") ?? "")) return json(403, { error: "Only people with access can see who has it." }), true;
        if (req.method === "PUT") {
            if (!canManage(room.file, user)) return json(403, { error: "Only editors can change access." }), true;
            let body = {};
            try {
                body = parseObject(await readBody(req, 64 * 1024));
            } catch {
                return json(400, { error: "Bad request." }), true;
            }
            // Sharing (inviting people or groups, opening the link) waits for a verified email.
            if (needsVerification(user) && (body.invite || body.inviteGroup || (LINK_ROLES.has(body.link) && body.link !== "none" && body.link !== room.file.link))) return json(403, { error: VERIFY_FIRST, code: "email-unverified" }), true;
            const a = accessOf(room.file);
            if (!room.file.owner && user) {
                if (ownerless(room.file)) claimFile(room, user);
                else room.file.owner = user.id;
            }
            if (LINK_ROLES.has(body.link)) room.file.link = body.link;
            if (typeof body.viewersCanExport === "boolean" && body.viewersCanExport !== (room.file.viewersCanExport !== false)) {
                room.file.viewersCanExport = body.viewersCanExport;
                broadcast(room, { type: "access", access: { link: accessOf(room.file).link, owner: room.file.owner ?? null, project: room.file.project ?? null, viewersCanExport: body.viewersCanExport } });
            }
            else if (room.file.link === undefined) room.file.link = a.link;
            const members = { ...a.members };
            const invites = { ...a.invites };
            // Invite by email (several, comma separated): people with an account get access now;
            // other addresses are kept and get access when they sign up with that email. No mail is sent.
            if (body.invite && typeof body.invite.email === "string") {
                const role = fileRole(body.invite.role);
                const emails = body.invite.email.split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean).slice(0, 50);
                const bad = emails.find((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
                if (!emails.length || bad) return json(400, { error: bad ? `"${bad}" isn't an email address.` : "Enter an email." }), true;
                for (const email of emails) {
                    const invitee = userByEmail(email);
                    if (invitee) {
                        if (invitee.id !== room.file.owner) members[invitee.id] = role;
                    } else invites[email] = role;
                    if (invitee?.id !== room.file.owner) void announceInvite(room, user, email, role);
                }
            }
            applySharingChanges(room, user, body);
            if (body.role && typeof body.role.userId === "string" && members[body.role.userId]) members[body.role.userId] = fileRole(body.role.role);
            if (body.role && typeof body.role.email === "string" && invites[body.role.email]) invites[body.role.email] = fileRole(body.role.role);
            if (typeof body.remove === "string") delete members[body.remove];
            if (typeof body.removeInvite === "string") delete invites[body.removeInvite];
            room.file.members = members;
            room.file.invites = invites;
            scheduleSave(room);
            applyRoleChanges(room);
        }
        const a = accessOf(room.file);
        const project = room.file.project ? projectById(room.file.project) : null;
        const team = project ? teamById(project.teamId) : null;
        return (
            json(200, {
                owner: publicUser(userById(a.owner)),
                members: Object.entries(a.members).map(([id, role]) => ({ ...publicUser(userById(id)), role })).filter((m) => m.id),
                invites: Object.entries(a.invites).map(([email, role]) => ({ email, role })),
                link: a.link,
                viewersCanExport: room.file.viewersCanExport !== false,
                you: roleFor(room.file, user, url.searchParams.get("key") ?? ""),
                // Access that comes from the project the file is in, and its team.
                project: project ? { id: project.id, name: project.name } : null,
                team: team ? { id: team.id, name: team.name } : null,
                inherited: peopleWithAccess(room.file).filter((p) => p.via === "project"),
                ...sharingView(room.file, user),
            }),
            true
        );
    }
    // Branches: a copy of a main file to work in, reviewed and merged back.
    const branchRoute = /^\/files\/([A-Za-z0-9_-]{6,64})\/(branches|branch|merge|update|doc|base|review)$/.exec(path);
    if (branchRoute) return serveBranches(req, res, url, branchRoute[1], branchRoute[2]);
    // Version history over HTTP: duplicate a version as a new file.
    const dup = /^\/files\/([A-Za-z0-9_-]{6,64})\/versions\/([A-Za-z0-9-]{6,64})\/duplicate$/.exec(path);
    if (dup && req.method === "POST") {
        const room = await loadRoom(dup[1]);
        const user = userFromReq(req);
        const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
        if (!user) return json(401, { error: "Sign in to duplicate a version." });
        if (!room.file || roleFor(room.file, user, url.searchParams.get("key") ?? "") !== "edit") return json(403, { error: "Only editors can duplicate versions." });
        const meta = (room.file.versions ?? []).find((v) => v.id === dup[2]);
        if (!meta) return json(404, { error: "No such version." });
        let doc;
        try {
            doc = JSON.parse(await readFile(versionPath(room.id, meta.id), "utf8"));
        } catch {
            return json(404, { error: "That version couldn't be loaded." });
        }
        doc.name = `${doc.name ?? "Untitled"} (${meta.name ?? "copy"})`.slice(0, 120);
        const made = await makeFile(user, doc, null, (await readMeta(room.id)).kind ?? "design");
        return json(200, { id: made.id, keys: made.file.keys, name: doc.name });
    }
    // Duplicate from the file browser or the file menu: a copy of the current document in your drafts.
    const copy = /^\/files\/([A-Za-z0-9_-]{6,64})\/duplicate$/.exec(path);
    if (copy && req.method === "POST") {
        const room = await loadRoom(copy[1]);
        const user = userFromReq(req);
        const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
        if (!user) return json(401, { error: "Sign in to duplicate a file." });
        const role = room.file ? roleFor(room.file, user, url.searchParams.get("key") ?? "") : null;
        if (!role || role === "prototype") return json(403, { error: "You can't duplicate that file." });
        if (role !== "edit" && room.file.viewersCanExport === false) return json(403, { error: "The file's owner turned off copying for viewers." });
        const doc = JSON.parse(JSON.stringify(room.file.doc));
        doc.name = `Copy of ${doc.name ?? "Untitled"}`.slice(0, 120);
        const meta = await readMeta(room.id);
        const made = await makeFile(user, doc, null, meta.kind ?? "design");
        if (meta.thumb) await writeMeta(made.id, { thumb: meta.thumb });
        return json(200, { id: made.id, keys: made.file.keys, name: doc.name, kind: meta.kind ?? "design" });
    }
    // Notifications: comments that mention you, and replies in threads you started or joined, across files you can open.
    if (path === "/notifications" && req.method === "GET") {
        const user = userFromReq(req);
        const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
        if (!user) return json(200, []);
        const out = [];
        for (const f of await listFiles(user)) {
            if (f.trashed) continue;
            const room = rooms.get(f.id);
            let file = room?.file;
            if (!file) {
                try {
                    file = JSON.parse(await readFile(filePath(f.id), "utf8"));
                } catch {
                    continue;
                }
            }
            for (const n of file.devNotices ?? []) {
                if (!n || n.by?.uid === user.id) continue;
                out.push({ id: `${f.id}:dev:${n.id}`, fileId: f.id, fileName: f.name, kind: f.kind, key: f.keys?.edit ?? null, threadId: null, author: { name: n.by?.name ?? "Someone", color: n.by?.color ?? "#888888" }, text: String(n.text ?? "").slice(0, 280), at: n.at ?? 0, why: n.status === "completed" ? "completed" : "ready", resolved: false, nodeId: n.ids?.[0] ?? null });
            }
            for (const c of file.comments ?? []) {
                const thread = [c, ...(c.replies ?? [])];
                const joined = thread.some((m) => m.author?.uid === user.id);
                thread.forEach((m, i) => {
                    if (!m || m.author?.uid === user.id) return;
                    const mentioned = (m.mentions ?? []).includes(user.id) || ((m.mentions ?? []).some((x) => x.startsWith("group:")) && mentionReach(file, m.mentions ?? []).has(user.id));
                    const reply = i > 0 && joined;
                    // New threads on files you own count too.
                    const onMine = i === 0 && file.owner === user.id;
                    if (!mentioned && !reply && !onMine) return;
                    out.push({ id: `${f.id}:${c.id}:${m.id}`, fileId: f.id, fileName: f.name, kind: f.kind, key: f.keys?.edit ?? null, threadId: c.id, author: { name: m.author?.name ?? "Someone", color: m.author?.color ?? "#888888" }, text: String(m.text ?? "").slice(0, 280), at: m.createdAt ?? 0, why: mentioned ? "mention" : reply ? "reply" : "comment", resolved: Boolean(c.resolved) });
                });
            }
            // @mentions written on a board (in stickies, shapes and text) reach the inbox too.
            for (const m of boardMentions(file)) {
                if (m.to !== user.id) continue;
                const node = file.doc?.nodes?.[m.node];
                out.push({ id: `${f.id}:board:${m.id}`, fileId: f.id, fileName: f.name, kind: f.kind, key: f.keys?.edit ?? null, threadId: null, nodeId: m.node ?? null, author: { name: m.by ?? "Someone", color: userByName(m.by)?.color ?? "#888888" }, text: String(node?.text ?? "").slice(0, 280), at: m.at ?? 0, why: "mention", resolved: false });
            }
        }
        out.push(...(await inboxNotices(user)));
        out.sort((a, b) => b.at - a.at);
        return json(200, out.slice(0, 50));
    }
    // Everyone who can be @mentioned: the owner, people invited, and the project's team.
    const people = /^\/files\/([A-Za-z0-9_-]{6,64})\/people$/.exec(path);
    if (people && req.method === "GET") {
        const room = await loadRoom(people[1]);
        const user = userFromReq(req);
        const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
        if (!room.file) return json(404, { error: "No such file." });
        if (!roleFor(room.file, user, url.searchParams.get("key") ?? "")) return json(403, { error: "No access." });
        return json(200, [...peopleWithAccess(room.file).map(({ role: _role, via: _via, ...p }) => p), ...mentionGroups(room.file)]);
    }
    const sharing = /^\/files\/([A-Za-z0-9_-]{6,64})\/(unlock|requests(?:\/[A-Za-z0-9_-]+)?)$/.exec(path);
    if (sharing) return serveSharing(req, res, url, sharing[1], sharing[2]);
    // Leave: someone invited to a file takes themselves off it.
    const leaveFile = /^\/files\/([A-Za-z0-9_-]{6,64})\/leave$/.exec(path);
    if (leaveFile && req.method === "POST") {
        const user = userFromReq(req);
        const room = await loadRoom(leaveFile[1]);
        const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
        if (!room.file) return json(404, { error: "No such file." });
        if (!user) return json(401, { error: "Sign in first." });
        if (room.file.owner === user.id) return json(400, { error: "Owners can't leave their own file. Move it to the trash instead." });
        const members = { ...(room.file.members ?? {}) };
        const invites = { ...(room.file.invites ?? {}) };
        if (!members[user.id] && !invites[user.email]) return json(400, { error: "You weren't invited to this file." });
        delete members[user.id];
        delete invites[user.email];
        room.file.members = members;
        room.file.invites = invites;
        scheduleSave(room);
        applyRoleChanges(room);
        return json(200, { ok: true });
    }
    // Claim: a server admin makes a file from before accounts theirs.
    const claim = /^\/files\/([A-Za-z0-9_-]{6,64})\/claim$/.exec(path);
    if (claim && req.method === "POST") {
        const user = userFromReq(req);
        const room = await loadRoom(claim[1]);
        const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
        if (!room.file) return json(404, { error: "No such file." });
        if (!user) return json(401, { error: "Sign in first." });
        if (room.file.owner) return json(400, { error: "That file already has an owner." });
        if (!isServerAdmin(user)) return json(403, { error: "Only a server admin can claim files from before accounts." });
        claimFile(room, user);
        return json(200, { ok: true, keys: room.file.keys });
    }
    // Delete forever: the owner (or a project editor) removes a trashed file now; "Empty trash" does it for all of yours.
    const forever = /^\/files\/([A-Za-z0-9_-]{6,64})\/forever$/.exec(path);
    if (forever && req.method === "DELETE") {
        const user = userFromReq(req);
        const room = await loadRoom(forever[1]);
        if (!room.file || !user || !canDeleteForever(room.file, user)) {
            res.writeHead(403, { ...CORS, "content-type": "text/plain" }).end("Only the file's owner can delete it for good.");
            return true;
        }
        // Like folders: only a file in the trash is deleted for good.
        if (!(await readMeta(forever[1])).trashed) {
            res.writeHead(400, { ...CORS, "content-type": "text/plain" }).end("Move the file to the trash first.");
            return true;
        }
        await removeFile(forever[1]);
        res.writeHead(200, { ...CORS, "content-type": "application/json" }).end("{}");
        return true;
    }
    if (path === "/files/trash" && req.method === "DELETE") {
        const user = userFromReq(req);
        if (!user) {
            res.writeHead(401, { ...CORS, "content-type": "text/plain" }).end("Sign in first.");
            return true;
        }
        let removed = 0;
        for (const f of await listFiles(user)) {
            if (!f.trashed || f.role !== "edit") continue;
            // Only files this person may delete for good: an editor emptying their trash took the
            // owner's files with it.
            const room = await loadRoom(f.id);
            if (!room.file || !canDeleteForever(room.file, user)) continue;
            await removeFile(f.id);
            removed += 1;
        }
        // Folders deleted with the files in them go too.
        const gone = org.projects.filter((p) => p.trashed && p.trashedWith && canEditProject(projectById(p.trashedWith) ?? p, user)).map((p) => p.id);
        if (gone.length) {
            org.projects = org.projects.filter((p) => !gone.includes(p.id));
            saveOrg();
        }
        res.writeHead(200, { ...CORS, "content-type": "application/json" }).end(JSON.stringify({ removed }));
        return true;
    }
    const file = /^\/files\/([A-Za-z0-9_-]{6,64})\/meta$/.exec(path);
    if (file && (req.method === "PUT" || req.method === "DELETE")) {
        const id = file[1];
        try {
            const patch = req.method === "DELETE" ? { trashed: true } : parseObject(await readBody(req, 4 * 1024 * 1024));
            // Only people who can edit the file change what it's called, its picture or whether it's in the trash.
            const metaUser = userFromReq(req);
            const metaRoom = await loadRoom(id);
            if (!metaRoom.file || roleFor(metaRoom.file, metaUser, url.searchParams.get("key") ?? "") !== "edit") {
                res.writeHead(403, { ...CORS, "content-type": "text/plain" }).end("Only people who can edit the file can change it.");
                return true;
            }
            const allowed = {};
            // Renamed from the file browser: the document's name changes for everyone in the file now.
            if (typeof patch.name === "string" && patch.name.trim() && metaRoom.file.doc) {
                const name = patch.name.trim().slice(0, 120);
                metaRoom.file.doc.name = name;
                metaRoom.version += 1;
                scheduleSave(metaRoom);
                broadcast(metaRoom, { type: "patch", version: metaRoom.version, patch: { name }, id: null, from: null });
            }
            if (typeof patch.kind === "string") allowed.kind = patch.kind.slice(0, 20);
            if (typeof patch.thumb === "string" && patch.thumb.startsWith("data:image/")) allowed.thumb = patch.thumb.slice(0, 2_000_000);
            // Pinned to the top of its folder in the file browser.
            if (typeof patch.pinned === "boolean") allowed.pinned = patch.pinned;
            if (typeof patch.trashed === "boolean") {
                allowed.trashed = patch.trashed;
                allowed.trashedAt = patch.trashed ? Date.now() : null;
                allowed.trashedWith = null;
                allowed.trashedBy = patch.trashed ? (metaUser?.id ?? null) : null;
                // Restored on its own while its folder is in the trash: it goes to the nearest folder
                // around it that isn't (or to its owner's drafts).
                const home = !patch.trashed && metaRoom.file.project ? projectById(metaRoom.file.project) : null;
                if (home?.trashed && patch.project === undefined) {
                    const live = projectChain(home).find((x) => !x.trashed) ?? null;
                    metaRoom.file.project = live?.id ?? null;
                    scheduleSave(metaRoom);
                    applyRoleChanges(metaRoom);
                    allowed.project = live?.id ?? null;
                }
            }
            if (patch.project !== undefined) {
                const user = userFromReq(req);
                const room = await loadRoom(id);
                const target = patch.project ? projectById(patch.project) : null;
                const ok = room.file && user && (roleFor(room.file, user, "") === "edit") && (!patch.project || (target && !target.trashed && canEditProject(target, user)));
                if (!ok) {
                    res.writeHead(403, { ...CORS, "content-type": "text/plain" }).end("You can't move that file there.");
                    return true;
                }
                room.file.project = target?.id ?? null;
                scheduleSave(room);
                applyRoleChanges(room);
                allowed.project = target?.id ?? null;
            }
            const meta = await writeMeta(id, allowed);
            res.writeHead(200, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(meta));
        } catch (error) {
            res.writeHead(400, { ...CORS, "content-type": "text/plain" }).end(String(error?.message ?? error));
        }
        return true;
    }
    return false;
}

// ---- Branching ----

const basePath = (id) => join(DATA, `${id}.base.json`);
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Applies what `theirs` changed since `base` onto `ours`: changed layers take theirs, layers they
// removed go, pages they added or removed follow, and file-level settings they changed come along.
function threeWay(base, ours, theirs) {
    const out = JSON.parse(JSON.stringify(ours));
    const ids = new Set([...Object.keys(base.nodes ?? {}), ...Object.keys(theirs.nodes ?? {})]);
    for (const id of ids) {
        const b = base.nodes?.[id];
        const t = theirs.nodes?.[id];
        if (sameJson(b, t)) continue;
        if (!t) delete out.nodes[id];
        else out.nodes[id] = JSON.parse(JSON.stringify(t));
    }
    const removed = (base.roots ?? []).filter((id) => !(theirs.roots ?? []).includes(id));
    const added = (theirs.roots ?? []).filter((id) => !(base.roots ?? []).includes(id));
    out.roots = [...(out.roots ?? []).filter((id) => !removed.includes(id)), ...added.filter((id) => !(out.roots ?? []).includes(id))];
    for (const key of ["styles", "variables", "prototype", "sequence"]) {
        if (sameJson(base[key], theirs[key])) continue;
        if (theirs[key] === undefined) delete out[key];
        else out[key] = theirs[key];
    }
    out.images = { ...(ours.images ?? {}), ...(theirs.images ?? {}) };
    return repairDoc(out);
}

// Parent and child lists agree; layers whose parent is gone go too.
function repairDoc(doc) {
    const nodes = doc.nodes;
    for (const node of Object.values(nodes)) node.children = (node.children ?? []).filter((id, i, list) => list.indexOf(id) === i && nodes[id]?.parentId === node.id);
    for (const node of Object.values(nodes)) {
        const parent = node.parentId ? nodes[node.parentId] : null;
        if (parent && !parent.children.includes(node.id)) parent.children.push(node.id);
    }
    let lost = Object.values(nodes).filter((n) => n.parentId && !nodes[n.parentId]);
    while (lost.length) {
        for (const n of lost) delete nodes[n.id];
        lost = Object.values(nodes).filter((n) => n.parentId && !nodes[n.parentId]);
    }
    doc.roots = (doc.roots ?? []).filter((id, i, list) => list.indexOf(id) === i && nodes[id] && nodes[id].parentId === null);
    for (const n of Object.values(nodes)) if (n.parentId === null && !doc.roots.includes(n.id)) doc.roots.push(n.id);
    return doc;
}

const publicBranch = (b) => ({ id: b.id, name: b.name, createdAt: b.createdAt, author: b.author, status: b.status ?? "active", review: b.review ?? null, reviewState: reviewState(b.review), mergedAt: b.mergedAt ?? null, updatedAt: b.updatedAt ?? b.createdAt });

// ---- Branch reviews: reviewers are asked by email, then approve or suggest changes ----

// The badge a branch shows: "changes" if anyone's latest word is to suggest changes, "approved" if
// someone approved and nobody asked for changes, "requested" while waiting, else null.
function reviewState(review) {
    if (!review) return null;
    const decisions = Object.values(review.decisions ?? {});
    if (decisions.some((d) => d.decision === "changes")) return "changes";
    if (decisions.some((d) => d.decision === "approved")) return "approved";
    return "requested";
}

// { emails: "a@x, b@y" | email, note }: asks each of them to review (by notification and email).
function requestReview(entry, room, mainRoom, user, body) {
    const emails = String(body.emails ?? body.email ?? "").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean).slice(0, 20);
    const reviewers = [];
    for (const email of emails) {
        const u = userByEmail(email);
        if (!u) return `No one with the email ${email} has an account here.`;
        reviewers.push(u);
    }
    const note = String(body.note ?? "").slice(0, 500);
    const before = entry.review?.reviewers ?? (entry.review?.reviewer ? [entry.review.reviewer] : []);
    const all = [...before.filter((r) => !reviewers.some((u) => u.id === r.id)), ...reviewers.map(publicUser)];
    entry.review = { requestedBy: publicUser(user), reviewer: all[0] ?? null, reviewers: all, at: Date.now(), note, decisions: entry.review?.decisions ?? {} };
    const fileName = `${mainRoom.file.doc?.name ?? "Untitled"} / ${entry.name}`;
    for (const u of reviewers) {
        // Reviewers need to be able to open the branch.
        if (!roleFor(room.file, u, "")) room.file.members = { ...(room.file.members ?? {}), [u.id]: "view" };
        notify(u.id, { why: "review-request", fileId: room.id, fileName, branchId: room.id, author: { name: user.name, color: user.color }, text: note || `Review "${entry.name}" before it's merged.` });
        void sendMail(u.email, `${user.name} asked you to review "${entry.name}"`, `${user.name} asked you to review the branch "${entry.name}" of "${mainRoom.file.doc?.name ?? "Untitled"}".${note ? `\n\n"${note}"` : ""}${process.env.NAGMA_PUBLIC_URL ? `\n\nOpen it: ${process.env.NAGMA_PUBLIC_URL.replace(/\/$/, "")}/?file=${room.id}` : ""}`);
    }
    applyRoleChanges(room);
    return entry.review;
}

function mayDecideReview(entry, mainRoom, user) {
    const reviewers = entry.review?.reviewers ?? (entry.review?.reviewer ? [entry.review.reviewer] : []);
    return reviewers.some((r) => r?.id === user.id) || roleFor(mainRoom.file, user, "") === "edit";
}

// A reviewer's decision: { decision: "approved" | "changes", note }. Suggestions also go on the branch
// as a comment, so they can be discussed there.
function decideReview(entry, room, mainRoom, user, body) {
    if (!entry.review) return "Nobody asked for a review of this branch.";
    if (!["approved", "changes"].includes(body.decision)) return "Approve or suggest changes.";
    const note = String(body.note ?? "").trim().slice(0, 2000);
    entry.review.decisions = { ...(entry.review.decisions ?? {}), [user.id]: { decision: body.decision, note, at: Date.now(), by: publicUser(user) } };
    if (body.decision === "changes" && note) {
        const page = room.file.doc?.roots?.[0] ?? "";
        const comment = { id: randomBytes(8).toString("base64url"), author: { uid: user.id, name: user.name, color: user.color }, text: `Suggested changes: ${note}`, createdAt: Date.now(), pageId: page, x: 0, y: 0, nodeId: null, offset: null, region: null, replies: [], resolved: false, attachments: [], mentions: [], reactions: {} };
        room.file.comments = [...(room.file.comments ?? []), comment];
        broadcast(room, { type: "comments", comments: room.file.comments });
    }
    const fileName = `${mainRoom.file.doc?.name ?? "Untitled"} / ${entry.name}`;
    const to = new Set([entry.review.requestedBy?.id, entry.author?.id].filter((id) => id && id !== user.id));
    for (const uid of to) {
        notify(uid, { why: "review", fileId: room.id, fileName, branchId: room.id, author: { name: user.name, color: user.color }, text: body.decision === "approved" ? `Approved${note ? `: ${note}` : "."}` : `Suggested changes${note ? `: ${note}` : "."}` });
        const u = userById(uid);
        if (u) void sendMail(u.email, `${user.name} ${body.decision === "approved" ? "approved" : "suggested changes to"} "${entry.name}"`, note || (body.decision === "approved" ? "The branch is approved and ready to merge." : "Have a look at the suggestions on the branch."));
    }
    return entry.review;
}

// Replaces whole top-level layers (and what's inside them) in `doc` with main's copies: the conflicts
// someone chose to settle in main's favour when updating a branch.
function takeFromMain(doc, main, ids) {
    const subtreeIds = (d, id) => {
        const out = [];
        const walk = (nid) => {
            const n = d.nodes[nid];
            if (!n) return;
            out.push(nid);
            for (const c of n.children ?? []) walk(c);
        };
        walk(id);
        return out;
    };
    for (const id of ids) {
        for (const nid of subtreeIds(doc, id)) delete doc.nodes[nid];
        for (const nid of subtreeIds(main, id)) doc.nodes[nid] = JSON.parse(JSON.stringify(main.nodes[nid]));
        const parent = main.nodes[id] ? doc.nodes[main.nodes[id].parentId] : null;
        if (parent && !parent.children.includes(id)) parent.children.push(id);
    }
    return repairDoc(doc);
}

// Replaces a room's document for everyone in it, keeping checkpoints around the change.
async function replaceDoc(room, doc, who, before, after) {
    const actor = { uid: who?.id ?? null, presence: { name: who?.name ?? "Nagma", color: who?.color ?? "#9747FF" } };
    if (before) await saveVersion(room, actor, null, true, { label: before });
    room.file.doc = doc;
    room.version += 1;
    room.touched = Date.now();
    scheduleSave(room);
    broadcast(room, { type: "reset", doc, version: room.version, by: who?.name ?? null });
    if (after) await saveVersion(room, actor, after, false);
    broadcast(room, { type: "versions", versions: room.file.versions });
}

async function serveBranches(req, res, url, id, action) {
    const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
    const user = userFromReq(req);
    const key = url.searchParams.get("key") ?? "";
    const room = await loadRoom(id);
    if (!room.file) return json(404, { error: "No such file." });
    const role = roleFor(room.file, user, key);
    if (!role || role === "prototype") return json(403, { error: "No access to this file." });
    const body = async () => {
        try {
            return parseObject(await readBody(req, 64 * 1024));
        } catch {
            return {};
        }
    };
    const mainRoom = room.file.branchOf ? await loadRoom(room.file.branchOf) : room;
    if (!mainRoom.file) return json(404, { error: "The main file is gone." });
    const entry = room.file.branchOf ? (mainRoom.file.branches ?? []).find((b) => b.id === id) : null;
    if (action === "doc" && req.method === "GET") return json(200, { doc: room.file.doc, name: room.file.doc?.name ?? "Untitled" });
    if (action === "base" && req.method === "GET") {
        if (!room.file.branchOf) return json(400, { error: "This isn't a branch." });
        try {
            return json(200, { doc: JSON.parse(await readFile(basePath(id), "utf8")) });
        } catch {
            return json(404, { error: "The branch's starting point is missing." });
        }
    }
    if (action === "branches" && req.method === "GET") {
        const mainRole = roleFor(mainRoom.file, user, key) ?? (room.file.branchOf ? role : null);
        // Editors get the keys that open each one, so moving between main and branches just works.
        const canOpen = mainRole === "edit" || role === "edit";
        const branches = [];
        for (const b of mainRoom.file.branches ?? []) {
            const br = canOpen ? await loadRoom(b.id) : null;
            branches.push({ ...publicBranch(b), key: br?.file?.keys?.edit ?? null });
        }
        return json(200, { main: { id: mainRoom.id, name: mainRoom.file.doc?.name ?? "Untitled", role: mainRole, key: canOpen ? (mainRoom.file.keys?.edit ?? null) : null }, branches });
    }
    if (!user) return json(401, { error: "Sign in to work with branches." });
    if (action === "branches" && req.method === "POST") {
        if (room.file.branchOf) return json(400, { error: "Branches are made from the main file." });
        if (role !== "edit") return json(403, { error: "Only editors can create branches." });
        const b = await body();
        const name = String(b.name ?? "").trim().slice(0, 80) || "Untitled branch";
        const doc = JSON.parse(JSON.stringify(room.file.doc));
        const made = await makeFile(user, doc, room.file.project ?? null, (await readMeta(room.id)).kind ?? "design", {
            branchOf: room.id,
            branchName: name,
            // A branch has the main file's people and link settings.
            members: { ...(room.file.members ?? {}) },
            invites: { ...(room.file.invites ?? {}) },
            link: accessOf(room.file).link,
        });
        if (room.file.owner && room.file.owner !== user.id) made.file.members[room.file.owner] = "edit";
        await writeFile(basePath(made.id), JSON.stringify(doc));
        room.file.branches = [...(room.file.branches ?? []), { id: made.id, name, createdAt: Date.now(), author: publicUser(user), status: "active", review: null }];
        scheduleSave(room);
        broadcast(room, { type: "branches" });
        return json(200, { id: made.id, keys: made.file.keys, name });
    }
    if (!room.file.branchOf || !entry) return json(400, { error: "This isn't a branch." });
    let base;
    try {
        base = JSON.parse(await readFile(basePath(id), "utf8"));
    } catch {
        return json(404, { error: "The branch's starting point is missing." });
    }
    if (action === "branch" && req.method === "PUT") {
        if (role !== "edit") return json(403, { error: "Only editors can change the branch." });
        const b = await body();
        if (typeof b.name === "string" && b.name.trim()) {
            entry.name = b.name.trim().slice(0, 80);
            room.file.branchName = entry.name;
        }
        if (b.status === "archived" || b.status === "active") entry.status = b.status;
        if (b.review === null) entry.review = null;
        else if (b.review && typeof b.review === "object") {
            const result = requestReview(entry, room, mainRoom, user, b.review);
            if (typeof result === "string") return json(404, { error: result });
        }
        entry.updatedAt = Date.now();
        scheduleSave(mainRoom);
        scheduleSave(room);
        broadcast(mainRoom, { type: "branches" });
        broadcast(room, { type: "branches" });
        return json(200, publicBranch(entry));
    }
    if (action === "merge" && req.method === "POST") {
        if (roleFor(mainRoom.file, user, "") !== "edit") return json(403, { error: "You need edit access to the main file to merge." });
        if (entry.status === "archived") return json(400, { error: "Restore the branch before merging it." });
        const merged = threeWay(base, mainRoom.file.doc, room.file.doc);
        merged.name = mainRoom.file.doc.name;
        await replaceDoc(mainRoom, merged, user, `Before merging ${entry.name}`, `Merged ${entry.name}`);
        entry.status = "archived";
        entry.mergedAt = Date.now();
        entry.review = null;
        await writeFile(basePath(id), JSON.stringify(merged));
        scheduleSave(mainRoom);
        broadcast(mainRoom, { type: "branches" });
        broadcast(room, { type: "branches" });
        broadcast(room, { type: "notice", text: `${user.name} merged this branch into the main file. It's archived now.` });
        return json(200, { ok: true, main: mainRoom.id });
    }
    if (action === "review" && req.method === "POST") {
        // Only the people asked to review, or editors of the main file, decide; viewers can't approve.
        if (!mayDecideReview(entry, mainRoom, user)) return json(403, { error: "Only the requested reviewers or editors of the main file can review this branch." });
        const result = decideReview(entry, room, mainRoom, user, await body());
        if (typeof result === "string") return json(400, { error: result });
        entry.updatedAt = Date.now();
        scheduleSave(mainRoom);
        scheduleSave(room);
        broadcast(mainRoom, { type: "branches" });
        broadcast(room, { type: "branches" });
        return json(200, publicBranch(entry));
    }
    if (action === "update" && req.method === "POST") {
        if (role !== "edit") return json(403, { error: "Only editors can update the branch." });
        const b = await body();
        // Main's changes since the branch started come in; where both changed a layer, the branch keeps
        // its own unless it was picked to take main's ({ take: [top-level layer ids] }).
        const merged = threeWay(base, mainRoom.file.doc, room.file.doc);
        const take = Array.isArray(b.take) ? b.take.filter((x) => typeof x === "string").slice(0, 2000) : [];
        const fromMain = take.length ? takeFromMain(merged, mainRoom.file.doc, take) : merged;
        fromMain.name = room.file.doc.name;
        await replaceDoc(room, fromMain, user, "Before updating from main", null);
        await writeFile(basePath(id), JSON.stringify(mainRoom.file.doc));
        entry.updatedAt = Date.now();
        scheduleSave(mainRoom);
        broadcast(room, { type: "branches" });
        return json(200, { ok: true });
    }
    return json(405, { error: "Not allowed." });
}

const newKey = () => randomBytes(16).toString("base64url");
const versionPath = (id, versionId) => join(DATA, `${id}.versions`, `${versionId}.json`);
// An autosave checkpoint every 30 minutes of editing.
const AUTO_VERSION_MS = Number(process.env.AUTO_VERSION_MS ?? 30 * 60 * 1000);

// A version is a full copy of the document at a moment, listed newest first.
async function saveVersion(room, client, name, auto, extra = {}) {
    // Copy the document now, before any await lets the next change in.
    const snapshot = JSON.stringify(room.file.doc);
    const meta = { id: randomUUID(), createdAt: Date.now(), name, description: null, auto, author: { name: client?.presence?.name ?? "Nagma", color: client?.presence?.color ?? "#9747FF", uid: client?.uid ?? null }, ...extra };
    await mkdir(join(DATA, `${room.id}.versions`), { recursive: true });
    await writeFile(versionPath(room.id, meta.id), snapshot);
    room.file.versions = [meta, ...(room.file.versions ?? [])].slice(0, 500);
    room.file.lastVersionAt = meta.createdAt;
    room.changedSinceVersion = false;
    scheduleSave(room);
    return meta;
}

// Keeps a checkpoint every so often while people are editing, taken before the next change lands.
function maybeAutoVersion(room, client) {
    room.changedSinceVersion = true;
    const last = room.file.lastVersionAt ?? 0;
    if (Date.now() - last > AUTO_VERSION_MS) {
        room.file.lastVersionAt = Date.now();
        void saveVersion(room, client, null, true).then(() => broadcast(room, { type: "versions", versions: room.file.versions }));
    }
}

// ---- Comments: one operation at a time, each checked against who is asking ----
// Anyone who can open the file can comment, reply, react and resolve; only a message's author edits
// it; a thread's author or an editor moves or deletes it; a reply's author or an editor deletes it.

const EMOJI_MAX = 16;
const cleanText = (text) => String(text ?? "").slice(0, 5000);
const cleanAttachments = (list) =>
    (Array.isArray(list) ? list : [])
        .filter((a) => a && validId(a.id))
        .slice(0, 10)
        .map((a) => ({ id: a.id, name: String(a.name ?? "image").slice(0, 120), type: String(a.type ?? "image/png").slice(0, 60), w: Number(a.w) || 0, h: Number(a.h) || 0 }));
const cleanMentions = (list) => (Array.isArray(list) ? list.filter((m) => typeof m === "string").slice(0, 50).map((m) => m.slice(0, 80)) : []);
const cleanPoint = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null);
// A comment on an area: how far its box reaches back from the pin.
const cleanRegion = (r) => (r && Number.isFinite(r.w) && Number.isFinite(r.h) && r.w > 0 && r.h > 0 ? { w: Math.min(r.w, 1e6), h: Math.min(r.h, 1e6) } : null);

function commentOp(room, client, op) {
    const list = room.file.comments ?? [];
    const author = { uid: client.uid, name: client.presence.name, color: client.presence.color };
    const isEditor = client.role === "edit";
    const thread = op.threadId ? list.find((c) => c.id === op.threadId) : null;
    const mine = (m) => m && m.author?.uid && m.author.uid === client.uid;
    const replace = (next) => list.map((c) => (c.id === next.id ? next : c));
    switch (op.op) {
        case "add": {
            const c = op.comment ?? {};
            if (!validId(c.id) || list.some((x) => x.id === c.id)) return "Bad comment.";
            const text = cleanText(c.text).trim();
            const attachments = cleanAttachments(c.attachments);
            if (!text && !attachments.length) return "Write something first.";
            if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || typeof c.pageId !== "string") return "Bad comment.";
            const comment = { id: c.id, author, text, createdAt: Date.now(), pageId: c.pageId.slice(0, 64), x: c.x, y: c.y, nodeId: typeof c.nodeId === "string" ? c.nodeId.slice(0, 64) : null, offset: cleanPoint(c.offset), region: cleanRegion(c.region), replies: [], resolved: false, attachments, mentions: cleanMentions(c.mentions), reactions: {} };
            return [...list, comment].slice(-2000);
        }
        case "reply": {
            if (!thread) return "That comment was deleted.";
            const r = op.reply ?? {};
            const text = cleanText(r.text).trim();
            const attachments = cleanAttachments(r.attachments);
            if (!validId(r.id) || (!text && !attachments.length)) return "Write something first.";
            return replace({ ...thread, replies: [...thread.replies, { id: r.id, author, text, createdAt: Date.now(), attachments, mentions: cleanMentions(r.mentions), reactions: {} }].slice(-500) });
        }
        case "edit": {
            if (!thread) return "That comment was deleted.";
            const target = op.messageId === thread.id ? thread : thread.replies.find((m) => m.id === op.messageId);
            if (!target) return "That reply was deleted.";
            if (!mine(target)) return "Only the author can edit a comment.";
            const text = cleanText(op.text).trim();
            if (!text && !(target.attachments ?? []).length) return "A comment can't be empty.";
            const edited = { ...target, text, editedAt: Date.now(), mentions: cleanMentions(op.mentions) };
            return replace(target === thread ? { ...thread, ...edited } : { ...thread, replies: thread.replies.map((m) => (m.id === target.id ? edited : m)) });
        }
        case "delete": {
            if (!thread) return list;
            if (!op.messageId || op.messageId === thread.id) {
                if (!mine(thread) && !isEditor) return "Only the author or an editor can delete this thread.";
                return list.filter((c) => c.id !== thread.id);
            }
            const target = thread.replies.find((m) => m.id === op.messageId);
            if (!target) return list;
            if (!mine(target) && !isEditor) return "Only the author or an editor can delete this reply.";
            return replace({ ...thread, replies: thread.replies.filter((m) => m.id !== target.id) });
        }
        case "resolve": {
            if (!thread) return "That comment was deleted.";
            return replace({ ...thread, resolved: Boolean(op.resolved), resolvedBy: op.resolved ? author : null });
        }
        case "move": {
            if (!thread) return "That comment was deleted.";
            if (!mine(thread) && !isEditor) return "Only the author or an editor can move this comment.";
            if (!Number.isFinite(op.x) || !Number.isFinite(op.y)) return "Bad position.";
            return replace({ ...thread, pageId: typeof op.pageId === "string" ? op.pageId.slice(0, 64) : thread.pageId, x: op.x, y: op.y, nodeId: typeof op.nodeId === "string" ? op.nodeId.slice(0, 64) : null, offset: cleanPoint(op.offset) });
        }
        case "react": {
            if (!thread) return "That comment was deleted.";
            const emoji = String(op.emoji ?? "").slice(0, EMOJI_MAX);
            // Reactions are kept by emoji in a plain object: names that reach Object.prototype aren't emoji.
            if (!emoji || !safeKey(emoji)) return "Pick an emoji.";
            const toggle = (m) => {
                const reactions = { ...(m.reactions ?? {}) };
                const who = Object.hasOwn(reactions, emoji) && Array.isArray(reactions[emoji]) ? reactions[emoji] : [];
                const has = who.some((r) => r.uid === client.uid);
                const next = has ? who.filter((r) => r.uid !== client.uid) : [...who, { uid: client.uid, name: author.name }];
                if (next.length) reactions[emoji] = next;
                else delete reactions[emoji];
                return { ...m, reactions };
            };
            if (op.messageId === thread.id || !op.messageId) return replace(toggle(thread));
            if (!thread.replies.some((m) => m.id === op.messageId)) return "That reply was deleted.";
            return replace({ ...thread, replies: thread.replies.map((m) => (m.id === op.messageId ? toggle(m) : m)) });
        }
    }
    return "Unknown comment change.";
}

// ---- Comment extras: group mentions, email digests of unread mentions, GIF search ----

// What can be @mentioned as a group in a file: everyone with access, the project's team, and the
// user groups the file is shared with or that belong to its team.
function mentionGroups(file) {
    const everyone = peopleWithAccess(file);
    const out = [{ id: "group:everyone", name: "everyone", color: "#9747FF", group: true, count: everyone.length }];
    const project = file.project ? projectById(file.project) : null;
    const team = project ? teamById(project.teamId) : null;
    if (team) out.push({ id: "group:team", name: "team", color: "#0D99FF", group: true, count: Object.keys(team.members).length });
    const ids = new Set([...Object.keys(file.groups ?? {}), ...(team?.groups ?? []).map((g) => g.id)]);
    for (const gid of ids) {
        const found = groupById(gid);
        if (found) out.push({ id: `group:${gid}`, name: found.group.name, color: "#14AE5C", group: true, count: found.group.members.length });
    }
    return out;
}

// Everyone a message's mentions reach (people mentioned directly, and the members of groups).
function mentionReach(file, mentions) {
    const out = new Set();
    for (const m of mentions) {
        if (!m.startsWith("group:")) out.add(m);
        else if (m === "group:everyone") for (const p of peopleWithAccess(file)) out.add(p.id);
        else if (m === "group:team") {
            const project = file.project ? projectById(file.project) : null;
            for (const uid of Object.keys(teamById(project?.teamId)?.members ?? {})) out.add(uid);
        } else for (const uid of groupById(m.slice(6))?.group.members ?? []) out.add(uid);
    }
    return out;
}

// Email digests: every DIGEST_MINUTES (30), each person gets one mail listing the mentions and
// replies they haven't read since the last one (by NAGMA_SMTP_URL; skipped without it). People can
// turn them off (POST /auth/prefs { emailDigests: false }), and can have the same digest posted to a
// Slack or Teams incoming webhook of their own ({ chatWebhook: "https://…" }).
const DIGEST_MS = Number(process.env.DIGEST_MINUTES ?? 30) * 60 * 1000;

async function unreadFor(user, since) {
    const items = [];
    await eachServerFile(async (id, file, meta) => {
        if (meta.trashed || !roleFor(file, user, "")) return;
        const reads = file.commentReads?.[user.id] ?? {};
        for (const c of file.comments ?? []) {
            const thread = [c, ...(c.replies ?? [])];
            const joined = thread.some((m) => m.author?.uid === user.id);
            thread.forEach((m, i) => {
                if (!m || m.author?.uid === user.id || (m.createdAt ?? 0) <= since || (m.createdAt ?? 0) <= (reads[c.id] ?? 0)) return;
                const mentioned = mentionReach(file, m.mentions ?? []).has(user.id);
                if (!mentioned && !(i > 0 && joined)) return;
                // Each kind only when the account settings ask for its email.
                if (!wantsEmail(user, mentioned ? "mentions" : "comments")) return;
                items.push({ fileId: id, fileName: file.doc?.name ?? "Untitled", author: m.author?.name ?? "Someone", text: String(m.text ?? "").slice(0, 200), why: mentioned ? "mentioned you" : "replied", at: m.createdAt });
            });
        }
        if (!wantsEmail(user, "mentions")) return;
        for (const m of boardMentions(file)) {
            if (m.to !== user.id || (m.at ?? 0) <= since) continue;
            items.push({ fileId: id, fileName: file.doc?.name ?? "Untitled", author: m.by ?? "Someone", text: String(file.doc?.nodes?.[m.node]?.text ?? "").slice(0, 200), why: "mentioned you on the board", at: m.at });
        }
    });
    return items.sort((a, b) => a.at - b.at);
}

// Slack and Teams incoming webhooks both take { text }.
async function postChat(hook, text) {
    try {
        const res = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: text.slice(0, 3500) }) });
        if (!res.ok) console.warn(`chat notification failed: ${res.status}`);
    } catch (error) {
        console.warn(`chat notification failed: ${error?.message ?? error}`);
    }
}

async function sendDigests() {
    const now = Date.now();
    for (const user of accounts.users) {
        if (user.prefs?.emailDigests === false) continue;
        const since = Math.max(user.digestAt ?? now - DIGEST_MS, now - 7 * 24 * 60 * 60 * 1000);
        if (now - since < DIGEST_MS * 0.9) continue;
        const items = await unreadFor(user, since);
        user.digestAt = now;
        if (!items.length) continue;
        const origin = (process.env.NAGMA_PUBLIC_URL ?? "").replace(/\/$/, "");
        const byFile = new Map();
        for (const it of items) byFile.set(it.fileId, [...(byFile.get(it.fileId) ?? []), it]);
        const lines = [];
        for (const [fid, list] of byFile) {
            lines.push(`${list[0].fileName}${origin ? ` (${origin}/?file=${fid})` : ""}`);
            for (const it of list) lines.push(`  ${it.author} ${it.why}: ${it.text}`);
            lines.push("");
        }
        const subject = `${items.length} unread comment${items.length === 1 ? "" : "s"} on Nagma`;
        const text = `${lines.join("\n")}\nTurn these emails off in Nagma under your account settings.`;
        // Without mail set up, a development server keeps the digest in data/digests.txt
        // (NAGMA_DEV_MAIL_FILE=1), like reset and confirmation links.
        if (!(await sendMail(user.email, subject, text))) await keepUnsentLink(DATA, "digests.txt", `${new Date(now).toISOString()} digest for ${user.email}: ${subject}\n${text}\n\n`, user.email);
        if (user.prefs?.chatWebhook) await postChat(user.prefs.chatWebhook, `${items.length} unread comment${items.length === 1 ? "" : "s"} on Nagma\n\n${lines.join("\n")}`);
    }
    saveAccounts();
}
setInterval(() => void sendDigests().catch((e) => console.warn(`digest failed: ${e?.message ?? e}`)), Math.min(DIGEST_MS, 15 * 60 * 1000)).unref();

// GIF search for the comment picker, through GIPHY or Tenor with a key from the environment
// (NAGMA_GIF_KEY, NAGMA_GIF_PROVIDER=giphy|tenor). Without a key: 501, and the picker shows stickers.
async function serveGifs(req, res, url) {
    const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
    const key = process.env.NAGMA_GIF_KEY;
    if (!key) return json(501, { error: "No GIF provider on this server." });
    if (!userFromReq(req)) return json(401, { error: "Sign in to search GIFs." });
    const q = String(url.searchParams.get("q") ?? "").slice(0, 100);
    const tenor = process.env.NAGMA_GIF_PROVIDER === "tenor";
    const endpoint = tenor
        ? `https://tenor.googleapis.com/v2/${q ? "search" : "featured"}?key=${encodeURIComponent(key)}&limit=24&contentfilter=medium&media_filter=gif,tinygif${q ? `&q=${encodeURIComponent(q)}` : ""}`
        : `https://api.giphy.com/v1/gifs/${q ? "search" : "trending"}?api_key=${encodeURIComponent(key)}&limit=24&rating=g${q ? `&q=${encodeURIComponent(q)}` : ""}`;
    try {
        const upstream = await fetch(endpoint);
        if (!upstream.ok) return json(502, { error: `The GIF service answered ${upstream.status}.` });
        const data = await upstream.json();
        const out = tenor
            ? (data.results ?? []).map((g) => ({ id: g.id, title: g.content_description ?? "", url: g.media_formats?.gif?.url, preview: g.media_formats?.tinygif?.url ?? g.media_formats?.gif?.url, w: g.media_formats?.gif?.dims?.[0] ?? 0, h: g.media_formats?.gif?.dims?.[1] ?? 0 }))
            : (data.data ?? []).map((g) => ({ id: g.id, title: g.title ?? "", url: g.images?.downsized?.url ?? g.images?.original?.url, preview: g.images?.fixed_width_small?.url ?? g.images?.fixed_height_small?.url, w: Number(g.images?.downsized?.width) || 0, h: Number(g.images?.downsized?.height) || 0 }));
        return json(200, out.filter((g) => g.url && g.preview));
    } catch {
        return json(502, { error: "The GIF service can't be reached." });
    }
}

// ---- Audio: people in a file talk over WebRTC; the server only passes their connection details on ----
// Media goes between browsers directly. ICE servers (STUN, and TURN with its credentials) come from
// NAGMA_ICE_SERVERS (JSON, as RTCPeerConnection takes them); without it, people on the same network
// connect directly.

function relayAudio(room, client, message) {
    if (!room.file || !client.role || typeof message.to !== "string") return;
    const signal = message.signal && typeof message.signal === "object" ? message.signal : null;
    if (!signal || JSON.stringify(signal).length > 64 * 1024) return;
    for (const [ws, other] of room.clients) if (other.presence.userId === message.to) send(ws, { type: "rtc", from: client.presence.userId, signal });
}

function iceServers() {
    try {
        const list = JSON.parse(process.env.NAGMA_ICE_SERVERS ?? "[]");
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

// Each person's read state, by thread: the time they last read it (0 marks it unread again).
function markRead(room, client, reads) {
    if (!reads || typeof reads !== "object") return;
    room.file.commentReads ??= {};
    const mine = { ...(room.file.commentReads[client.uid] ?? {}) };
    for (const [id, at] of Object.entries(reads).slice(0, 2000)) if (typeof id === "string" && Number.isFinite(at)) mine[id.slice(0, 64)] = at;
    room.file.commentReads[client.uid] = mine;
    scheduleSave(room);
}

function send(ws, message) {
    if (ws.readyState === 1) ws.send(JSON.stringify(message));
}

// Everyone in the file: sockets join a room when they connect, but only hear what happens in it once
// their hello got them in (a role), and stop when their access goes.
function broadcast(room, message, except) {
    const text = JSON.stringify(message);
    for (const [ws, client] of room.clients) if (ws !== except && client.role && ws.readyState === 1) ws.send(text);
}

function peers(room, except) {
    return [...room.clients.entries()].filter(([ws, client]) => ws !== except && client.role).map(([, client]) => client.presence);
}

// ---- Sites: a site file's editors publish its built pages; they're served at /sites/<file id>/ ----
// Published pages run in a sandbox of their own (a CSP sandbox without same-origin), so code an
// editor put in a site can't reach the editor app or anyone's session on this server.

const MAX_SITE = 80 * 1024 * 1024;
const SITE_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
};
const SITE_HEADERS = {
    "content-security-policy": "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "access-control-allow-origin": "*",
};

async function siteStatus(id) {
    try {
        const info = JSON.parse(await readFile(join(SITES, id, ".site.json"), "utf8"));
        return { published: true, publishedAt: info.publishedAt ?? null, by: info.by ?? null, pages: info.pages ?? 0, bytes: info.bytes ?? 0 };
    } catch {
        return { published: false, publishedAt: null, by: null, pages: 0, bytes: 0 };
    }
}

async function servePublish(req, res, url, id) {
    const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
    const room = await loadRoom(id);
    if (!room.file) return json(404, { error: "No such file." });
    const user = userFromReq(req);
    const role = roleFor(room.file, user, url.searchParams.get("key") ?? "");
    if (!role) return json(403, { error: "No access to this file." });
    if (req.method === "GET") return json(200, { ...(await siteStatus(id)), ...(await siteHosting.summary(id)) });
    if (req.method !== "POST" && req.method !== "DELETE") return json(405, { error: "Method not allowed." });
    if (role !== "edit") return json(403, { error: "Only people who can edit this file can publish it." });
    // Putting pages on this server's addresses (or taking them down) needs an account, as it does
    // for Make's apps: the edit link alone isn't enough.
    if (!user) return json(401, { error: "Sign in to publish or unpublish this site." });
    if (req.method === "POST" && needsVerification(user)) return json(403, { error: VERIFY_FIRST, code: "email-unverified" });
    if (!room.file.doc?.site) return json(400, { error: "Only site files can be published." });
    const team = room.file.project ? teamById(projectById(room.file.project)?.teamId) : null;
    if (req.method === "POST" && team?.settings?.sitesPublishing === false) return json(403, { error: `Publishing sites is turned off for ${team.name}. A team admin can turn it on in the admin console.` });
    if (req.method === "DELETE") {
        await rm(join(SITES, id), { recursive: true, force: true });
        return json(200, { ...(await siteStatus(id)), ...(await siteHosting.summary(id)) });
    }
    let body;
    try {
        body = parseObject(await readBody(req, MAX_SITE));
    } catch {
        return json(413, { error: "The site is too large to publish." });
    }
    const files = Array.isArray(body?.files) ? body.files : [];
    if (!files.length || files.length > 5000) return json(400, { error: "Nothing to publish." });
    // Paths stay inside the site's folder: plain names, no "..", known file types only.
    for (const f of files) {
        const ok = typeof f?.path === "string" && typeof f?.data === "string" && f.path.length <= 300 && /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(f.path) && !f.path.split("/").some((part) => part === ".." || part === "." || part === "") && SITE_TYPES[extname(f.path).toLowerCase()];
        if (!ok) return json(400, { error: `That file can't be published: ${String(f?.path ?? "").slice(0, 80)}` });
    }
    const tmp = join(SITES, `.${id}.${randomUUID()}`);
    let bytes = 0;
    try {
        for (const f of files) {
            const data = Buffer.from(f.data, "base64");
            bytes += data.length;
            const target = join(tmp, f.path);
            if (!target.startsWith(`${tmp}/`)) throw new Error("bad path");
            await mkdir(join(target, ".."), { recursive: true });
            await writeFile(target, data);
        }
        const info = { publishedAt: Date.now(), by: user?.name ?? "Someone with the edit link", pages: files.filter((f) => f.path.endsWith(".html")).length, bytes };
        await writeFile(join(tmp, ".site.json"), JSON.stringify(info));
        // Swap the new copy in as a whole.
        const old = join(SITES, `.${id}.old.${randomUUID()}`);
        await rename(join(SITES, id), old).catch(() => undefined);
        await rename(tmp, join(SITES, id));
        await rm(old, { recursive: true, force: true }).catch(() => undefined);
    } catch {
        await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
        return json(500, { error: "The site couldn't be saved on the server." });
    }
    return json(200, { ...(await siteStatus(id)), ...(await siteHosting.summary(id)) });
}

async function serveSite(req, res) {
    const url = new URL(req.url ?? "/", "http://local");
    const match = /^\/sites\/([A-Za-z0-9_-]{6,64})(\/.*)?$/.exec(url.pathname);
    if (!match) return void res.writeHead(404, { ...SITE_HEADERS, "content-type": "text/plain; charset=utf-8" }).end("This site isn't published.");
    const id = match[1];
    if (!match[2]) return void res.writeHead(301, { location: `/sites/${id}/` }).end();
    if (!(await siteHosting.allowed(req, res, id, `/sites/${id}/`))) return;
    return sendSite(req, res, id, match[2], url);
}

// One published site's file: `rest` is the path inside the site ("/", "/about/", "/assets/x.png").
async function sendSite(req, res, id, rest, url) {
    const notFound = () => res.writeHead(404, { ...SITE_HEADERS, "content-type": "text/plain; charset=utf-8" }).end("This site isn't published.");
    const meta = await readMeta(id);
    if (meta.trashed) return notFound();
    const dir = join(SITES, id);
    try {
        rest = decodeURIComponent(rest);
    } catch {
        return notFound();
    }
    if (rest.split("/").some((part) => part === ".." || part.startsWith("."))) return notFound();
    let path = normalize(join(dir, rest));
    if (path !== dir && !path.startsWith(`${dir}/`)) return notFound();
    let status = 200;
    try {
        const info = await stat(path);
        if (info.isDirectory()) {
            // Folders need their trailing slash so the pages' relative links resolve.
            if (!url.pathname.endsWith("/")) return void res.writeHead(301, { location: `${url.pathname}/${url.search}` }).end();
            path = join(path, "index.html");
        }
        await stat(path);
    } catch {
        status = 404;
        path = join(dir, "404.html");
        try {
            await stat(path);
        } catch {
            return notFound();
        }
    }
    const type = SITE_TYPES[extname(path).toLowerCase()];
    if (!type) return notFound();
    const body = await readFile(path).catch(() => null);
    if (!body) return notFound();
    res.writeHead(status, { ...SITE_HEADERS, "content-type": type, "cache-control": type.startsWith("text/html") ? "no-cache" : "public, max-age=300" });
    res.end(req.method === "HEAD" ? undefined : body);
}

// NAGMA_PUBLIC_URL as an http(s) origin and path (no trailing slash), or null.
function configuredPublicUrl() {
    const raw = String(process.env.NAGMA_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
    return /^https?:\/\/[^\s/]+(\/\S*)?$/.test(raw) ? raw : null;
}

// What the server calls itself where apps list the servers they can connect to (NAGMA_SERVER_NAME).
function serverName() {
    return String(process.env.NAGMA_SERVER_NAME ?? "").trim().slice(0, 80) || "Nagma";
}

// The version this server runs: NAGMA_VERSION when the build sets one, else the package's.
const SERVER_VERSION = (() => {
    if (process.env.NAGMA_VERSION) return String(process.env.NAGMA_VERSION).slice(0, 40);
    try {
        return String(JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version ?? "") || null;
    } catch {
        return null;
    }
})();

// This machine's addresses on the local network, so share links made on "localhost" can be opened
// from other devices.
function lanAddresses() {
    return Object.values(networkInterfaces())
        .flat()
        .filter((a) => a && a.family === "IPv4" && !a.internal)
        .map((a) => a.address);
}

const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
    ".map": "application/json",
    ".webmanifest": "application/manifest+json",
};

// Serves the built editor. Unknown paths get index.html so links like /?file=… always open the app.
async function serveStatic(req, res) {
    const url = new URL(req.url ?? "/", "http://local");
    let decoded;
    try {
        decoded = decodeURIComponent(url.pathname);
    } catch {
        res.writeHead(400, { "content-type": "text/plain" }).end("Bad address.");
        return;
    }
    const clean = normalize(decoded).replace(/^([/\\]*\.\.)+/, "");
    let path = join(STATIC, clean);
    if (!path.startsWith(STATIC)) {
        res.writeHead(403).end();
        return;
    }
    try {
        const info = await stat(path);
        if (info.isDirectory()) path = join(path, "index.html");
    } catch {
        path = join(STATIC, "index.html");
    }
    try {
        const body = await readFile(path);
        const type = TYPES[extname(path)] ?? "application/octet-stream";
        // Built assets have content hashes in their names, so they can be cached for good.
        const cache = path.includes(`${join(STATIC, "assets")}`) ? "public, max-age=31536000, immutable" : "no-cache";
        res.writeHead(200, { "content-type": type, "cache-control": cache });
        res.end(body);
    } catch {
        res.writeHead(404, { "content-type": "text/plain" }).end("Nagma isn't built yet. Run `npm run build` in apps/web.");
    }
}

// Link previews on boards: the title, description, image and site name of a public web page.
// Only http(s) pages on public addresses are fetched (no localhost or private networks, checked at
// every redirect), with a short timeout and a size cap.
function privateAddress(ip) {
    const v = String(ip).toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
    if (isIP(v) === 4) {
        const [a, b, c] = v.split(".").map(Number);
        return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
    }
    // Anything that isn't an address isn't known to be public.
    if (isIP(v) !== 6) return true;
    // The eight 16-bit words, with "::" filled in and a trailing dotted IPv4 part as two words.
    const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(v);
    const hex = dotted ? v.slice(0, dotted.index) + [((+dotted[1] << 8) | +dotted[2]).toString(16), ((+dotted[3] << 8) | +dotted[4]).toString(16)].join(":") : v;
    const [h, t] = hex.includes("::") ? hex.split("::") : [hex, null];
    const head = h ? h.split(":") : [];
    const tail = t ? t.split(":") : [];
    const w = [...head, ...Array(t === null ? 0 : 8 - head.length - tail.length).fill("0"), ...tail].map((x) => parseInt(x, 16));
    const v4 = (hi, lo) => privateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    const zero = (from, to) => w.slice(from, to).every((x) => x === 0);
    // ::, ::1 and IPv4-compatible ::a.b.c.d (deprecated: never public).
    if (zero(0, 6)) return true;
    // IPv4-mapped ::ffff:a.b.c.d (the URL parser writes ::ffff:127.0.0.1 as ::ffff:7f00:1).
    if (zero(0, 5) && w[5] === 0xffff) return v4(w[6], w[7]);
    // NAT64 64:ff9b::a.b.c.d, and the local-use 64:ff9b:1::/48.
    if (w[0] === 0x64 && w[1] === 0xff9b) return zero(2, 6) ? v4(w[6], w[7]) : true;
    // 6to4 2002:AABB:CCDD:: carries an IPv4 address; Teredo (2001::/32) hides one.
    if (w[0] === 0x2002) return v4(w[1], w[2]);
    if (w[0] === 0x2001 && w[1] === 0) return true;
    // Unique local fc00::/7, link-local fe80::/10, site-local fec0::/10, multicast ff00::/8,
    // discard 100::/64, documentation 2001:db8::/32.
    return (w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xffc0) === 0xfec0 || (w[0] & 0xff00) === 0xff00 || (w[0] === 0x100 && zero(1, 4)) || (w[0] === 0x2001 && w[1] === 0xdb8);
}

async function publicUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== "80" && url.port !== "443") return null;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) return null;
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (!addresses.length || addresses.some((a) => privateAddress(a.address))) return null;
    return url;
}

function metaContent(html, names) {
    for (const name of names) {
        const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
        const tag = re.exec(html)?.[0];
        const content = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1];
        if (content) return decodeEntities(content).trim().slice(0, 300);
    }
    return null;
}

function decodeEntities(text) {
    return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// Resolves the host as the connection is made and refuses private addresses there, so the address
// that was checked is the one connected to (a name can't switch to a private address in between).
function safeLookup(hostname, options, callback) {
    lookupCb(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err);
        const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
        if (!list.length || list.some((a) => privateAddress(a.address))) return callback(new Error("Private address"));
        if (options.all) return callback(null, list);
        callback(null, list[0].address, list[0].family);
    });
}

// A GET that connects only to public addresses, with a 5 second limit. Resolves to a fetch-like
// response: status, headers.get, ok, and a body reader.
function pinnedGet(url) {
    return new Promise((resolve, reject) => {
        const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, { method: "GET", lookup: safeLookup, headers: { "user-agent": "NagmaLinkPreview/1.0", accept: "text/html" }, timeout: 5000 }, (res) => {
            const status = res.statusCode ?? 0;
            const chunks = [];
            let done = false;
            let waiting = null;
            res.on("data", (c) => {
                chunks.push(new Uint8Array(c));
                if (waiting) (waiting(), (waiting = null));
            });
            res.on("end", () => {
                done = true;
                if (waiting) (waiting(), (waiting = null));
            });
            res.on("error", () => {
                done = true;
                if (waiting) (waiting(), (waiting = null));
            });
            resolve({
                status,
                ok: status >= 200 && status < 300,
                headers: { get: (name) => {
                    const v = res.headers[name.toLowerCase()];
                    return Array.isArray(v) ? v.join(", ") : (v ?? null);
                } },
                body: {
                    getReader: () => ({
                        read: async () => {
                            while (!chunks.length && !done) await new Promise((r) => (waiting = r));
                            return chunks.length ? { done: false, value: chunks.shift() } : { done: true, value: undefined };
                        },
                        cancel: async () => res.destroy(),
                    }),
                },
            });
        });
        req.on("timeout", () => req.destroy(new Error("Timed out")));
        req.on("error", reject);
        req.end();
    });
}

async function serveUnfurl(req, res) {
    const send = (code, body) => res.writeHead(code, { ...CORS, "content-type": "application/json", "cache-control": "public, max-age=3600" }).end(JSON.stringify(body));
    const target = new URL(req.url ?? "/", "http://local").searchParams.get("url") ?? "";
    let url = await publicUrl(target);
    if (!url) return send(400, { error: "That address can't be previewed." });
    try {
        let response;
        for (let hop = 0; hop < 4; hop++) {
            response = await pinnedGet(url);
            if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
                url = await publicUrl(new URL(response.headers.get("location"), url).toString());
                if (!url) return send(400, { error: "That address can't be previewed." });
                continue;
            }
            break;
        }
        if (!response || !response.ok || !/text\/html/i.test(response.headers.get("content-type") ?? "")) return send(200, { url: url.toString() });
        const reader = response.body.getReader();
        let html = "";
        const decoder = new TextDecoder();
        while (html.length < 512 * 1024) {
            const { done, value } = await reader.read();
            if (done) break;
            html += decoder.decode(value, { stream: true });
            if (/<\/head>/i.test(html)) break;
        }
        void reader.cancel().catch(() => {});
        const title = metaContent(html, ["og:title", "twitter:title"]) ?? decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "").trim().slice(0, 300);
        const image = metaContent(html, ["og:image", "twitter:image"]);
        send(200, {
            url: url.toString(),
            title: title || null,
            description: metaContent(html, ["og:description", "description", "twitter:description"]),
            site: metaContent(html, ["og:site_name"]),
            image: image ? new URL(image, url).toString() : null,
        });
    } catch {
        send(200, { url: url.toString() });
    }
}

// Images for pasted layers (image-proxy.mjs): image hosts only, public addresses, no redirects.
const serveImageProxy = createImageProxy({ CORS, userFromReq, safeLookup });

// Team administration and templates (admin.mjs), with what it needs from here.
const admin = createAdmin({ getOrg: () => org, saveOrg, accounts, saveAccounts, userById, userByEmail, publicUser, teamById, teamRole, roleFor, readBody, CORS, DATA, filePath, rooms, loadRoom, scheduleSave, readMeta, writeMeta, removeFile, makeFile, applyRoleChanges, userFromReq, notify, needsVerification, hasOwnAiKey: (user) => ai.hasOwnKey(user) });

// Published sites' addresses (/s/<name>/, <name>.<sites domain>, custom domains) and passwords (sites.mjs).
const siteHosting = createSiteHosting({ readBody, CORS, DATA, loadRoom, roleFor, userFromReq, secret: () => mediaSecret, sendSite, siteStatus, limitKeys, lockedFor, noteFailure });

// SAML single sign-on for teams (saml.mjs). Metadata URLs are fetched like link previews: public
// addresses only, checked at every redirect.
async function fetchPublicText(raw, limit) {
    let url = await publicUrl(raw);
    for (let hop = 0; url && hop < 4; hop++) {
        const response = await pinnedGet(url);
        if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
            await response.body.getReader().cancel();
            url = await publicUrl(new URL(response.headers.get("location"), url).toString());
            continue;
        }
        if (!response.ok) throw new Error(`The metadata URL answered ${response.status}.`);
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > limit) {
                await reader.cancel();
                throw new Error("That metadata is too large.");
            }
            chunks.push(value);
        }
        return Buffer.concat(chunks).toString("utf8");
    }
    return null;
}
const saml = createSaml({ getOrg: () => org, saveOrg, teamById, teamRole, userFromReq, readBody, CORS, DATA, fetchPublic: fetchPublicText, ssoAccount, ssoFinish });
// AI keys (ai.mjs): each person's own provider and key, the shared fallback, usage and limits.
const ai = createAi({ DATA, readBody, CORS, userFromReq, userById, teamById, teamRole, isServerAdmin, checkPublicUrl: (raw) => publicUrl(raw), saveAccounts });
const make = createMake({ ai, readBody, CORS, DATA, userFromReq, needsVerification, loadRoom, roleFor, saveAccounts, gate: (req, res, id, prefix) => siteHosting.allowed(req, res, id, prefix), appToken: (id) => siteHosting.appToken(id), appTokenOk: (id, token) => siteHosting.appTokenOk(id, token) });
siteHosting.register("app", make.hosting);

// Personal access tokens (Account settings › Tokens) and the read-only /v1 API they open (api-tokens.mjs).
const apiTokens = createApiTokens({ DATA, rooms, userById, publicUser, userFromReq, loadRoom, roleFor, listFiles, readBody, CORS });
// Team integrations: Slack and Teams webhooks for Inspect status notices, and Inspect settings (integrations.mjs).
const integrations = createIntegrations({ DATA, teamById, teamRole, projectById, userFromReq, loadRoom, roleFor, readBody, CORS, postChat });
// Home: account settings, search, stars, inbox actions, the community and media providers (home.mjs).
const home = createHome({
    accounts,
    saveAccounts,
    userById,
    userByEmail,
    hashPassword,
    sendMail,
    domainOf,
    readBody,
    CORS,
    DATA,
    listFiles,
    loadRoom,
    roleFor,
    readMeta,
    writeMeta,
    scheduleSave,
    broadcast,
    commentOp,
    makeFile,
    getOrg: () => org,
    saveOrg,
    myTeams,
    teamById,
    removeFile,
    applyRoleChanges,
    limitKeys,
    lockedFor,
    noteFailure,
    tooMany,
    onMemberRemoved: (t, uid) => admin.onMemberRemoved(t, uid),
    userFromReq,
    rooms,
    eachServerFile,
    dropInbox: (uid) => (delete inbox[uid], saveInbox()),
    claimEmailInvites,
    needsVerification,
    markVerified,
    onAccountDeleted: (id) => ai.forget(id),
});

// Every request, by address. (createServer below catches what any route throws.)
async function route(req, res) {
    // A published site on its own address (a name under the sites domain or a custom domain).
    if (await siteHosting.serveHost(req, res)) return;
    if (/^\/s\//.test(req.url ?? "") && (req.method === "GET" || req.method === "HEAD" || req.method === "POST")) {
        if (await siteHosting.serveSlug(req, res)) return;
    }
    if (req.method !== "OPTIONS") admin.noteActive(userFromReq(req));
    if (/^\/(account\/tokens|v1)(\/|$)/.test(new URL(req.url ?? "/", "http://local").pathname) && req.method !== "OPTIONS") {
        if (await apiTokens.serve(req, res)) return;
    }
    if (/^\/(teams\/[A-Za-z0-9_-]+\/integrations|files\/[A-Za-z0-9_-]+\/team-settings|code-connect\/github)$/.test(new URL(req.url ?? "/", "http://local").pathname) && req.method !== "OPTIONS") {
        if (await integrations.serve(req, res)) return;
    }
    // Make: app generation and published apps (make.mjs).
    // A published app's address and access (sites.mjs, with Make's own checks).
    const appHosting = /^\/apps\/([A-Za-z0-9_-]{6,64})\/hosting(?:\/(verify|ticket))?$/.exec(new URL(req.url ?? "/", "http://local").pathname);
    if (appHosting && req.method !== "OPTIONS") {
        await siteHosting.serveSettings(req, res, new URL(req.url ?? "/", "http://local"), appHosting[1], appHosting[2] ?? "settings", "app");
        return;
    }
    if (/^\/ai\/make(\?|$)/.test(req.url ?? "") && req.method === "POST") {
        // Make is off when every team you're on has turned it off (admin console › Settings).
        const teams = myTeams(userFromReq(req));
        if (teams.length && teams.every((t) => t.settings?.make === false)) return void res.writeHead(403, { ...CORS, "content-type": "application/json" }).end(JSON.stringify({ error: "Make is turned off for your team. A team admin can turn it on in the admin console." }));
    }
    if ((/^\/(ai\/make|apps\/)/.test(req.url ?? "") && req.method !== "OPTIONS") || /^\/app-data\//.test(req.url ?? "")) {
        if (await make.serve(req, res)) return;
    }
    // AI: the agent's model, image generation, and each person's AI settings (ai.mjs).
    if (/^\/(ai\/(chat|settings|settings\/(image|test|models)|shared-usage)|providers|providers\/image)$/.test(new URL(req.url ?? "/", "http://local").pathname) && req.method !== "OPTIONS") {
        if (await ai.serve(req, res)) return;
    }
    if (/^\/(teams\/[A-Za-z0-9_-]+\/(admin|templates)|ai\/usage)(\/|$)/.test(new URL(req.url ?? "/", "http://local").pathname) && req.method !== "OPTIONS") {
        if (await admin.serve(req, res)) return;
    }
    if (/^\/(account|avatars|search|community|providers|notifications\/(state|read|reply))(\/|\?|$)/.test(req.url ?? "") && req.method !== "OPTIONS") {
        if (await home.serve(req, res)) return;
    }
    if (/^\/(media|files|ai|libraries|notifications)(\/|$)/.test(req.url ?? "") || req.method === "OPTIONS") {
        if (await serveApi(req, res)) return;
    }
    if (/^\/(auth\/(sso|saml)|teams\/[A-Za-z0-9_-]+\/saml)(\/|\?|$)/.test(req.url ?? "") && req.method !== "OPTIONS") {
        if (await saml.serve(req, res, { enabled: oidcEnabled(), name: process.env.NAGMA_OIDC_NAME ?? "Single sign-on" })) return;
    }
    if (/^\/(rtc\/config|auth\/(oidc|sessions))(\/|\?|$)/.test(req.url ?? "") && req.method !== "OPTIONS") {
        if (await serveAccountExtras(req, res)) return;
    }
    if (/^\/gifs\/search(\?|$)/.test(req.url ?? "") && req.method === "GET") {
        await serveGifs(req, res, new URL(req.url ?? "/", "http://local"));
        return;
    }
    if (/^\/auth\//.test(req.url ?? "")) {
        if (await serveAuth(req, res)) return;
    }
    if (/^\/asset-templates(\/|\?|$)/.test(req.url ?? "") && req.method !== "OPTIONS") {
        await serveAssetTemplates(req, res, new URL(req.url ?? "/", "http://local"));
        return;
    }
    if (/^\/(teams|projects|invites)(\/|$)/.test(req.url ?? "")) {
        if (await serveTeams(req, res)) return;
    }
    if (/^\/sites(\/|$)/.test(req.url ?? "") && (req.method === "GET" || req.method === "HEAD" || req.method === "POST")) {
        await serveSite(req, res);
        return;
    }
    if (/^\/image-proxy(\?|$)/.test(req.url ?? "") && req.method === "GET") {
        // Images of layers pasted from another design tool, when the browser can't fetch them itself.
        await serveImageProxy(req, res);
        return;
    }
    if (/^\/unfurl(\?|$)/.test(req.url ?? "") && req.method === "GET") {
        // Only signed-in people can have the server fetch pages for them.
        if (!userFromReq(req)) return void res.writeHead(401, { ...CORS, "content-type": "application/json" }).end(JSON.stringify({ error: "Sign in to preview links." }));
        await serveUnfurl(req, res);
        return;
    }
    // Health check (also reports network addresses for share links).
    if (req.url === "/health" || req.url === "/") {
        if (req.url === "/health" || req.headers.accept?.includes("application/json")) {
            res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
            // The public address the server was given (NAGMA_PUBLIC_URL), for links that must not name
            // this machine's network address (the Inspect panel's prompt). Its name and version are what
            // the apps' server picker shows when someone connects to it.
            res.end(JSON.stringify({ ok: true, name: serverName(), version: SERVER_VERSION, publicUrl: configuredPublicUrl(), rooms: rooms.size, addresses: lanAddresses() }));
            return;
        }
    }
    await serveStatic(req, res);
}

// A route that throws answers 500 (or, mid-answer, ends the connection) and is logged: it must never
// become an unhandled rejection, which would take the whole server down.
const http = createServer((req, res) => {
    route(req, res).catch((error) => {
        console.warn(`${req.method} ${String(req.url ?? "").slice(0, 200)} failed: ${error?.stack ?? error}`);
        if (!res.headersSent) res.writeHead(500, { ...CORS, "content-type": "application/json" }).end(JSON.stringify({ error: "Something went wrong on the server." }));
        else res.destroy();
    });
});

const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE });

wss.on("connection", (ws, req) => {
    // A bad frame (text that isn't UTF-8, a frame over the size limit) closes this socket; without a
    // listener the error event would throw and take the whole server down.
    ws.on("error", (error) => console.warn(`socket error: ${error?.code ?? error?.message ?? error}`));
    const match = /^\/files\/([^/?]+)/.exec(req.url ?? "");
    const id = match?.[1];
    if (!validId(id)) {
        ws.close(4000, "Unknown file");
        return;
    }
    const client = { presence: { userId: randomUUID(), name: "Guest", color: "#7C5CFF", cursor: null, selection: [], pageId: null } };
    // The listeners go on now, before the file is read: clients say hello as soon as the socket opens,
    // and a message that arrived while the room was loading used to be dropped (the client then waited
    // for a snapshot that never came). Messages wait for the room, in the order they came.
    let room = null;
    const ready = loadRoom(id).then((r) => {
        room = r;
        room.clients.set(ws, client);
        return room;
    });

    ws.on("message", async (raw) => {
        let message;
        try {
            message = JSON.parse(String(raw));
        } catch {
            return;
        }
        // Anything but an object ("null", "42") is ignored; and a message that still throws is
        // logged, not left to take the whole server down as an unhandled rejection.
        if (!plainObject(message)) return;
        try {
            await ready;
            await handleMessage(message);
        } catch (error) {
            console.warn(`socket message (${String(message.type).slice(0, 40)}) failed: ${error?.stack ?? error}`);
        }
    });

    async function handleMessage(message) {
        switch (message.type) {
            case "hello": {
                // Only a name and a colour come from the client: the presence id (which peers, "leave" and
                // audio signals go by) and the account are the server's.
                const said = plainObject(message.user) ? message.user : {};
                client.presence = { ...client.presence, name: typeof said.name === "string" ? said.name.slice(0, 60) : client.presence.name, color: typeof said.color === "string" && /^#[0-9a-fA-F]{6}$/.test(said.color) ? said.color : client.presence.color, cursor: null, selection: [] };
                // The first person to open a new shared file provides its starting content and gets edit access.
                let created = false;
                // Once the server has accounts, only someone signed in can put a new file on it.
                const creator = userFromToken(typeof message.token === "string" ? message.token : null);
                if (!room.file && message.initial?.nodes && accounts.users.length && !creator) {
                    send(ws, { type: "denied", reason: "sign-in" });
                    ws.close(4003, "Sign in to share");
                    break;
                }
                if (!room.file && message.initial?.nodes) {
                    room.file = { doc: message.initial, comments: [], versions: [] };
                    room.version = 0;
                    created = true;
                }
                if (!room.file) {
                    send(ws, { type: "snapshot", doc: null });
                    break;
                }
                // Files shared before links had keys get them now; whoever opens it first keeps edit access.
                const legacy = !room.file.keys;
                if (legacy) room.file.keys = { edit: newKey(), view: newKey() };
                const key = typeof message.key === "string" ? message.key : "";
                client.key = key;
                client.user = userFromToken(typeof message.token === "string" ? message.token : null);
                admin.noteActive(client.user);
                if (client.user) client.presence = { ...client.presence, name: client.user.name, color: client.user.color, accountId: client.user.id };
                // Who this person is across visits: their account, or this browser for guests.
                client.uid = client.user ? client.user.id : `g:${typeof message.clientId === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(message.clientId) ? message.clientId : client.presence.userId}`;
                // A new file belongs to whoever shared it (when they're signed in).
                if (created && client.user && !room.file.owner) room.file.owner = client.user.id;
                // Moved to the server: only invited people until the owner opens the link up. (A server
                // without accounts has no one to invite, so its files keep the edit link.)
                if (created && !room.file.link) room.file.link = room.file.owner ? "none" : "edit";
                client.role = created || (legacy && !ownerless(room.file)) ? "edit" : roleFor(room.file, client.user, key);
                if (!client.role) {
                    send(ws, { type: "denied", reason: deniedReason(room.file, key) ?? "no-access", signedIn: Boolean(client.user), name: client.user ? (room.file.doc?.name ?? null) : null, requested: Boolean(client.user && (room.file.accessRequests ?? []).some((r) => r.userId === client.user.id && r.status === "pending")) });
                    ws.close(4003, "No access");
                    break;
                }
                // Who has opened the file, most recent first (the avatar menu's viewer list).
                room.file.viewers = { ...(room.file.viewers ?? {}), [client.uid]: { uid: client.uid, name: client.presence.name, color: client.presence.color, at: Date.now() } };
                const viewerList = Object.values(room.file.viewers).sort((a, b) => b.at - a.at);
                if (viewerList.length > 100) room.file.viewers = Object.fromEntries(viewerList.slice(0, 100).map((v) => [v.uid, v]));
                scheduleSave(room);
                send(ws, {
                    type: "snapshot",
                    doc: room.file.doc,
                    comments: room.file.comments ?? [],
                    reads: room.file.commentReads?.[client.uid] ?? {},
                    viewers: Object.values(room.file.viewers ?? {}).sort((a, b) => b.at - a.at).slice(0, 50),
                    uid: client.uid,
                    version: room.version,
                    peers: peers(room, ws),
                    you: client.presence.userId,
                    role: client.role,
                    // Only editors can hand out links.
                    keys: client.role === "edit" ? room.file.keys : undefined,
                    access: { link: accessOf(room.file).link, owner: room.file.owner ?? null, project: room.file.project ?? null, viewersCanExport: room.file.viewersCanExport !== false },
                    branch: room.file.branchOf ? { of: room.file.branchOf, name: room.file.branchName ?? "Branch" } : null,
                });
                client.joined = true;
                broadcast(room, { type: "presence", presence: client.presence }, ws);
                // A timed voting session that ran out with nobody in the file shows its results now;
                // an open one tells this person their own ballot and the turnout.
                revealBallots(room);
                const open = boardVoting(room.file.doc);
                if (open?.voting.id && votingIsOpen(open.voting)) send(ws, { type: "ballot", session: open.voting.id, votes: room.file.ballots?.[open.voting.id]?.[client.uid] ?? [], voted: turnoutOf(room, open.voting.id) });
                break;
            }
            case "patch": {
                if (!room.file || !message.patch) return;
                if (client.role !== "edit") {
                    send(ws, { type: "rejected", id: message.id, reason: "view-only" });
                    return;
                }
                if (!validPatch(message.patch)) {
                    send(ws, { type: "rejected", id: message.id, reason: "invalid" });
                    return;
                }
                maybeAutoVersion(room, client);
                const touched = assetsTouched(room.file, message.patch);
                applyPatch(room.file.doc, message.patch);
                for (const id of assetsTouched(room.file, message.patch)) touched.add(id);
                if (resetApprovals(room, touched, client.user)) broadcast(room, { type: "asset-reviews" });
                room.version += 1;
                scheduleSave(room);
                room.touched = Date.now();
                // Everyone (including the sender, as an acknowledgement) gets it in the same order.
                broadcast(room, { type: "patch", version: room.version, patch: message.patch, id: message.id, from: client.presence.userId });
                // A voting session that just ended shows its results.
                revealBallots(room);
                break;
            }
            case "vote": {
                if (!room.file || client.role !== "edit") return;
                castBallot(room, client, ws, message);
                break;
            }
            case "presence": {
                // Only from someone in the file (a socket that hasn't said hello, or was turned away, can't
                // show a cursor to the people in it).
                if (!room.file || !client.role) return;
                const name = typeof message.name === "string" ? message.name.slice(0, 60) : client.presence.name;
                const color = typeof message.color === "string" && /^#[0-9a-fA-F]{6}$/.test(message.color) ? message.color : client.presence.color;
                const num = (v) => (Number.isFinite(v) ? v : 0);
                const camera = message.camera && typeof message.camera === "object" ? { x: num(message.camera.x), y: num(message.camera.y), zoom: num(message.camera.zoom) || 1, w: num(message.camera.w), h: num(message.camera.h) } : null;
                client.presence = {
                    ...client.presence,
                    name,
                    color,
                    cursor: message.cursor ?? null,
                    selection: Array.isArray(message.selection) ? message.selection.slice(0, 200) : [],
                    pageId: message.pageId ?? null,
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
                broadcast(room, { type: "presence", presence: client.presence }, ws);
                break;
            }
            case "versions": {
                if (!room.file || !client.role) return;
                send(ws, { type: "versions", versions: room.file.versions ?? [] });
                break;
            }
            case "version.save": {
                if (!room.file || client.role !== "edit") return;
                await saveVersion(room, client, String(message.name ?? "").trim().slice(0, 80) || null, false, { description: String(message.description ?? "").trim().slice(0, 1000) || null });
                broadcast(room, { type: "versions", versions: room.file.versions });
                break;
            }
            case "version.update": {
                // Name this version, edit its info, or delete the info (it goes back to being an autosave).
                if (!room.file || client.role !== "edit") return;
                const meta = (room.file.versions ?? []).find((v) => v.id === message.id);
                if (!meta) return;
                const name = message.name === null ? null : String(message.name ?? "").trim().slice(0, 80) || null;
                const description = message.description === null ? null : String(message.description ?? "").trim().slice(0, 1000) || null;
                room.file.versions = room.file.versions.map((v) => (v.id === meta.id ? { ...v, name, description, auto: !name && !description } : v));
                scheduleSave(room);
                broadcast(room, { type: "versions", versions: room.file.versions });
                break;
            }
            case "version.restore": {
                // Two checkpoints: the file as it was before restoring, then the restored version.
                if (!room.file || client.role !== "edit") return;
                const meta = (room.file.versions ?? []).find((v) => v.id === message.id);
                if (!meta) return;
                let doc;
                try {
                    doc = JSON.parse(await readFile(versionPath(room.id, meta.id), "utf8"));
                } catch {
                    send(ws, { type: "notice", text: "That version couldn't be loaded." });
                    return;
                }
                await saveVersion(room, client, null, true, { label: "Before restoring" });
                room.file.doc = doc;
                room.version += 1;
                room.touched = Date.now();
                scheduleSave(room);
                broadcast(room, { type: "reset", doc, version: room.version, by: client.presence.name });
                await saveVersion(room, client, null, true, { label: `Restored ${meta.name ?? "an autosave"}`, restoredFrom: meta.id });
                broadcast(room, { type: "versions", versions: room.file.versions });
                break;
            }
            case "version.get": {
                if (!room.file || !client.role) return;
                const meta = (room.file.versions ?? []).find((v) => v.id === message.id);
                if (!meta) return;
                try {
                    const doc = JSON.parse(await readFile(versionPath(room.id, meta.id), "utf8"));
                    send(ws, { type: "version", id: meta.id, doc });
                } catch {
                    send(ws, { type: "version", id: meta.id, doc: null });
                }
                break;
            }
            case "keys.reset": {
                // New links; the old ones stop working for anyone who opens them from now on.
                if (!room.file || client.role !== "edit") return;
                room.file.keys = { edit: newKey(), view: newKey() };
                scheduleSave(room);
                for (const [other, c] of room.clients) if (c.role === "edit") send(other, { type: "keys", keys: room.file.keys });
                break;
            }
            case "comment.op": {
                if (!room.file || !client.role) return;
                const next = commentOp(room, client, message.op ?? {});
                if (typeof next === "string") {
                    send(ws, { type: "comment.denied", reason: next, comments: room.file.comments ?? [] });
                    return;
                }
                room.file.comments = next;
                scheduleSave(room);
                broadcast(room, { type: "comments", comments: room.file.comments });
                break;
            }
            case "comment.read": {
                if (!room.file || !client.role) return;
                markRead(room, client, message.reads);
                break;
            }
            case "rtc": {
                relayAudio(room, client, message);
                break;
            }
            // Inspect statuses: a design marked ready for dev or completed. The record feeds the Home
            // bell of everyone else with access; with the email channel they are mailed too, over SMTP
            // through mail.mjs.
            case "dev.status": {
                // Signed-in editors only: the notice and any mail carry their account.
                if (!room.file || client.role !== "edit" || !client.user) return;
                const status = message.status === "completed" ? "completed" : "ready";
                const names = Array.isArray(message.names) ? message.names.map((n) => String(n).slice(0, 120)).slice(0, 50) : [];
                const notice = {
                    id: randomUUID(),
                    by: { uid: client.uid, name: client.presence.name ?? "Someone", color: client.presence.color ?? "#888888" },
                    ids: Array.isArray(message.ids) ? message.ids.map(String).slice(0, 50) : [],
                    names,
                    status,
                    note: typeof message.note === "string" ? message.note.slice(0, 500) : null,
                    text: typeof message.text === "string" ? message.text.slice(0, 600) : "",
                    at: Date.now(),
                };
                room.file.devNotices = [...(room.file.devNotices ?? []), notice].slice(-200);
                scheduleSave(room);
                broadcast(room, { type: "dev.status", notice }, ws);
                // Slack and Teams: the incoming webhooks the file's team connected (integrations.mjs).
                if (message.notify === "chat") void integrations.notifyStatus(room.file, notice.text || `${notice.names.join(", ")}: ${status === "completed" ? "completed" : "ready for dev"}`);
                if (message.notify === "email") {
                    const subject = `${room.file.doc?.name ?? "Untitled"}: ${status === "completed" ? "completed" : "ready for dev"}`;
                    for (const person of peopleWithAccess(room.file)) {
                        if (!person.email || person.id === client.user?.id) continue;
                        // mail.mjs logs a "mail skipped" line (domain only) when SMTP isn't configured.
                        await sendMail(person.email, subject, notice.text);
                    }
                }
                break;
            }
        }
    }

    ws.on("close", async () => {
        await ready;
        room.clients.delete(ws);
        // Only people who were in the file were announced, so only they are said to leave.
        if (client.joined) broadcast(room, { type: "leave", userId: client.presence.userId });
        if (room.clients.size === 0 && room.file && room.changedSinceVersion) {
            // Everyone left: keep a checkpoint of where they got to.
            void saveVersion(room, client, null, true);
        }
        if (room.clients.size === 0) {
            // Keep idle rooms briefly so a quick reconnect doesn't reload from disk.
            setTimeout(() => {
                if (room.clients.size === 0 && !room.dirty) rooms.delete(room.id);
            }, 60_000);
        }
    });
});

http.listen(PORT, () => console.log(`Nagma sync server on :${PORT}`));
