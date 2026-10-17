// Home: account settings (profile, avatar, email change with verification, notification
// preferences, deleting an account), search across file names, page names and text, starred files
// and folders that follow the account, the notifications inbox's actions (read state, replying to a
// comment), the community (files and templates people on this server publish), and the stock photo
// provider (its key from the environment, never sent to browsers).
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { keepUnsentLink, mailConfigured } from "./mail.mjs";
import { join } from "node:path";
import { parseObject } from "./json-body.mjs";
import { saveLater } from "./atomic-write.mjs";

// What can be notified about, each by email and on the desktop.
export const NOTICE_KINDS = ["comments", "mentions", "invites", "requests", "devStatus", "reviews"];
const DEFAULT_NOTIFY = { comments: { email: true, desktop: true }, mentions: { email: true, desktop: true }, invites: { email: true, desktop: true }, requests: { email: true, desktop: true }, devStatus: { email: false, desktop: true }, reviews: { email: true, desktop: true } };

export function notifyPrefs(user) {
    const saved = user?.prefs?.notify ?? {};
    return Object.fromEntries(NOTICE_KINDS.map((k) => [k, { email: saved[k]?.email ?? DEFAULT_NOTIFY[k].email, desktop: saved[k]?.desktop ?? DEFAULT_NOTIFY[k].desktop }]));
}

// Whether `user` wants mail about `kind` (digests of comments and mentions, invitations, requests…).
export const wantsEmail = (user, kind) => notifyPrefs(user)[kind]?.email !== false;

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const AVATAR_MAX = 512 * 1024;
const AVATAR_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export function createHome(ctx) {
    const { accounts, saveAccounts, userById, userByEmail, hashPassword, sendMail, domainOf, readBody, CORS, DATA, listFiles, loadRoom, roleFor, readMeta, writeMeta, scheduleSave, broadcast, commentOp, makeFile, getOrg, saveOrg, myTeams, teamById, removeFile, applyRoleChanges, limitKeys, lockedFor, noteFailure, tooMany, onMemberRemoved, userFromReq, rooms, eachServerFile, dropInbox, claimEmailInvites } = ctx;
    const needsVerification = ctx.needsVerification ?? (() => false);
    const AVATARS = join(DATA, "avatars");
    const COMMUNITY = join(DATA, "community.json");

    // ---- People: what others see of an account (avatar and community profile included) ----

    const avatarUrl = (u) => (u?.avatar ? `/avatars/${u.id}?v=${u.avatar.v}` : null);
    const profileOf = (u) => ({ handle: u.profile?.handle ?? "", bio: u.profile?.bio ?? "" });
    const person = (u) => (u ? { id: u.id, name: u.name, email: u.email, color: u.color, avatar: avatarUrl(u), handle: u.profile?.handle ?? "" } : null);
    // What everyone on the server sees on the community pages: no email address.
    const communityPerson = (u) => (u ? { id: u.id, name: u.name, color: u.color, avatar: avatarUrl(u), handle: u.profile?.handle ?? "" } : null);

    // People `user` works with: everyone on their teams.
    function colleagues(user) {
        const ids = new Set();
        for (const t of myTeams(user)) for (const uid of Object.keys(t.members)) ids.add(uid);
        ids.delete(user.id);
        return [...ids].map(userById).filter(Boolean);
    }

    function accountView(user) {
        return {
            ...person(user),
            profile: profileOf(user),
            notify: notifyPrefs(user),
            emailDigests: user.prefs?.emailDigests !== false,
            emailPending: user.emailChange && user.emailChange.expires > Date.now() ? user.emailChange.email : null,
            // Sign-in methods and services tied to the account.
            connected: [
                { id: "password", name: "Email and password", detail: user.email, removable: false },
                ...(user.sso ? [{ id: "sso", name: process.env.NAGMA_OIDC_NAME ?? "Single sign-on", detail: user.email, removable: false }] : []),
                ...(user.prefs?.chatWebhook ? [{ id: "chat", name: /slack/i.test(user.prefs.chatWebhook) ? "Slack" : "Teams", detail: "Comment digests", removable: true }] : []),
            ],
            createdAt: user.createdAt ?? null,
        };
    }

    // The current password, checked with the same back-off as signing in.
    function checkPassword(req, res, user, password) {
        const keys = limitKeys(req, user.email);
        const wait = lockedFor(keys);
        if (wait) return (tooMany(res, wait), false);
        const ok = timingSafeEqual(Buffer.from(hashPassword(String(password ?? ""), user.salt)), Buffer.from(user.hash));
        if (!ok) noteFailure(keys);
        return ok;
    }

    // ---- Search: an index of each file's name, page names and text, rebuilt when the file changes ----

    const index = new Map();
    function textOf(doc) {
        const pages = (doc.roots ?? []).map((id) => doc.nodes?.[id]?.name).filter((n) => typeof n === "string");
        const parts = [];
        let size = 0;
        for (const n of Object.values(doc.nodes ?? {})) {
            if (!n || size > 400_000) continue;
            for (const t of [n.text, n.jam?.text, n.content]) {
                if (typeof t !== "string" || !t.trim()) continue;
                parts.push(t);
                size += t.length;
            }
        }
        return { pages, text: parts.join("\n") };
    }
    async function indexed(id) {
        const room = rooms.get(id);
        const meta = await readMeta(id);
        const stamp = `${meta.updatedAt ?? 0}:${room?.version ?? ""}`;
        const hit = index.get(id);
        if (hit && hit.stamp === stamp) return hit;
        let file = room?.file;
        if (!file) {
            try {
                file = JSON.parse(await readFile(join(DATA, `${id}.json`), "utf8"));
            } catch {
                return { stamp, pages: [], text: "" };
            }
        }
        const entry = { stamp, ...textOf(file?.doc ?? {}) };
        index.set(id, entry);
        return entry;
    }
    const snippet = (text, at, len) => `${at > 30 ? "…" : ""}${text.slice(Math.max(0, at - 30), at + len + 50).replace(/\s+/g, " ").trim()}`;

    async function search(user, params) {
        const q = str(params.get("q"), 100).toLowerCase();
        const type = params.get("type") ?? "all";
        const creator = params.get("creator") ?? "all";
        const location = params.get("location") ?? "all";
        const sort = params.get("sort") ?? "relevance";
        const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 60));
        const org = getOrg();
        const files = [];
        for (const f of await listFiles(user)) {
            if (f.trashed) continue;
            if (type !== "all" && f.kind !== type) continue;
            if (creator !== "all" && f.owner?.id !== creator) continue;
            const project = f.project ? org.projects.find((p) => p.id === f.project) : null;
            if (location === "drafts" && project) continue;
            if (location.startsWith("team:") && project?.teamId !== location.slice(5)) continue;
            if (location.startsWith("folder:") && project?.id !== location.slice(7)) continue;
            const name = f.name.toLowerCase();
            let score = 0;
            let match = null;
            if (!q) score = 1;
            else if (name === q) score = 100;
            else if (name.startsWith(q)) score = 80;
            else if (name.includes(q)) score = 60;
            if (q) {
                const ix = await indexed(f.id);
                const page = ix.pages.find((p) => p.toLowerCase().includes(q));
                if (page) {
                    if (!score) match = { type: "page", text: page };
                    score = Math.max(score, 40);
                }
                const at = ix.text.toLowerCase().indexOf(q);
                if (at >= 0) {
                    if (!score) match = { type: "text", text: snippet(ix.text, at, q.length) };
                    score = Math.max(score, 25);
                }
            }
            if (!score) continue;
            // Recently changed files rank a little higher among equals.
            const days = (Date.now() - (f.updatedAt ?? 0)) / 86_400_000;
            const team = project ? teamById(project.teamId) : null;
            files.push({ id: f.id, name: f.name, kind: f.kind, thumb: f.thumb, updatedAt: f.updatedAt, createdAt: f.createdAt, owner: f.owner ? person(userById(f.owner.id)) : null, role: f.role, project: f.project, team: team ? { id: team.id, name: team.name } : null, location: project ? [team?.name ?? "Team", project.name].join(" / ") : f.owner && f.owner.id !== user.id ? "Shared with you" : "Drafts", keys: f.keys ?? null, match, score: score + Math.max(0, 10 - days) / 10 });
        }
        files.sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name, undefined, { numeric: true }) : sort === "modified" ? b.updatedAt - a.updatedAt : b.score - a.score || b.updatedAt - a.updatedAt));
        const known = new Map();
        for (const u of [user, ...colleagues(user)]) known.set(u.id, u);
        for (const f of files) if (f.owner && !known.has(f.owner.id)) known.set(f.owner.id, userById(f.owner.id));
        const people = q ? [...known.values()].filter((u) => u && (u.name.toLowerCase().includes(q) || u.email.includes(q) || (u.profile?.handle ?? "").toLowerCase().includes(q))).slice(0, 12).map(person) : [];
        const creators = [...new Map(files.filter((f) => f.owner).map((f) => [f.owner.id, { id: f.owner.id, name: f.owner.name }])).values()];
        return { files: files.slice(0, limit), total: files.length, people, creators };
    }

    // ---- Community: files and templates published by people on this server ----

    let community = null;
    async function readCommunity() {
        if (community) return community;
        try {
            community = JSON.parse(await readFile(COMMUNITY, "utf8"));
        } catch {
            community = { entries: [] };
        }
        return community;
    }
    let communityTimer = null;
    function saveCommunity() {
        clearTimeout(communityTimer);
        communityTimer = setTimeout(() => saveLater(COMMUNITY, JSON.stringify(community)), 100);
    }
    async function communityEntry(e, user) {
        const room = await loadRoom(e.fileId);
        const meta = await readMeta(e.fileId);
        const by = userById(e.by);
        return { id: e.id, name: e.name, description: e.description, kind: e.kind, template: Boolean(e.template), tags: e.tags ?? [], publishedAt: e.publishedAt, updatedAt: e.updatedAt ?? e.publishedAt, thumb: meta.thumb ?? null, fileId: e.fileId, viewKey: room.file?.keys?.view ?? null, by: communityPerson(by) ?? { id: e.by, name: "Removed user", color: "#888888", avatar: null, handle: "" }, team: e.team ?? null, likes: e.likes.length, liked: e.likes.includes(user.id), duplicates: e.duplicates ?? 0, mine: e.by === user.id };
    }

    async function serve(req, res) {
        const url = new URL(req.url ?? "/", "http://local");
        const path = url.pathname;
        const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
        const body = async (limit = 64 * 1024) => {
            try {
                return parseObject(await readBody(req, limit));
            } catch {
                return {};
            }
        };

        // Avatars are public pictures (like the colour beside a name).
        const av = /^\/avatars\/([A-Za-z0-9_-]{6,64})$/.exec(path);
        if (av && req.method === "GET") {
            const u = userById(av[1]);
            if (!u?.avatar) return json(404, { error: "No picture." });
            try {
                const data = await readFile(join(AVATARS, `${u.id}.${u.avatar.ext}`));
                res.writeHead(200, { ...CORS, "content-type": u.avatar.type, "cache-control": "public, max-age=31536000, immutable" }).end(data);
            } catch {
                json(404, { error: "No picture." });
            }
            return true;
        }

        // Confirming a new email works from the link alone (the person may be signed out).
        if (path === "/account/email/verify" && req.method === "POST") {
            const b = await body();
            const token = String(b.token ?? "");
            const user = token ? accounts.users.find((u) => u.emailChange?.token === token) : null;
            if (!user || user.emailChange.expires < Date.now()) return json(400, { error: "That confirmation link isn't valid any more. Change your email again to get a new one." });
            const next = user.emailChange.email;
            if (userByEmail(next) && userByEmail(next) !== user) return json(409, { error: "Another account uses that email now." });
            const before = user.email;
            // What was shared with the old address stays with the account.
            await claimEmailInvites?.(user, before);
            user.email = next;
            delete user.emailChange;
            // The link came to the new address: it's proven.
            ctx.markVerified?.(user);
            saveAccounts();
            await sendMail(before, "Your Nagma email changed", `The email on your Nagma account is now ${next}. If you didn't do this, reset your password straight away.`);
            return json(200, { email: next });
        }

        const user = userFromReq(req);
        if (!user) return json(401, { error: "Sign in first." });

        // ---- Account ----
        if (path === "/account" && req.method === "GET") return json(200, accountView(user));
        if (path === "/account" && req.method === "PUT") {
            const b = await body();
            if (typeof b.name === "string") {
                const name = str(b.name, 60);
                if (!name) return json(400, { error: "Enter a name." });
                user.name = name;
            }
            if (b.profile && typeof b.profile === "object") {
                const handle = str(b.profile.handle, 30).replace(/^@/, "").replace(/[^A-Za-z0-9_-]/g, "");
                if (handle && accounts.users.some((u) => u !== user && (u.profile?.handle ?? "").toLowerCase() === handle.toLowerCase())) return json(409, { error: `@${handle} is taken. Try another handle.` });
                user.profile = { handle, bio: str(b.profile.bio, 280) };
            }
            if (b.notify && typeof b.notify === "object") {
                const cur = notifyPrefs(user);
                for (const k of NOTICE_KINDS) {
                    const v = b.notify[k];
                    if (!v || typeof v !== "object") continue;
                    if (typeof v.email === "boolean") cur[k].email = v.email;
                    if (typeof v.desktop === "boolean") cur[k].desktop = v.desktop;
                }
                user.prefs = { ...(user.prefs ?? {}), notify: cur, emailDigests: cur.comments.email || cur.mentions.email };
            }
            if (b.disconnect === "chat" && user.prefs) delete user.prefs.chatWebhook;
            saveAccounts();
            return json(200, accountView(user));
        }
        if (path === "/account/avatar" && req.method === "PUT") {
            const b = await body(AVATAR_MAX * 1.5);
            const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data ?? ""));
            if (!m) return json(400, { error: "Use a PNG, JPG, WebP or GIF picture." });
            const data = Buffer.from(m[2], "base64");
            if (data.length > AVATAR_MAX) return json(413, { error: "Use a picture under 512 KB." });
            await mkdir(AVATARS, { recursive: true });
            if (user.avatar) await unlink(join(AVATARS, `${user.id}.${user.avatar.ext}`)).catch(() => undefined);
            const ext = AVATAR_TYPES[m[1]];
            await writeFile(join(AVATARS, `${user.id}.${ext}`), data);
            user.avatar = { ext, type: m[1], v: randomBytes(4).toString("hex") };
            saveAccounts();
            return json(200, accountView(user));
        }
        if (path === "/account/avatar" && req.method === "DELETE") {
            if (user.avatar) await unlink(join(AVATARS, `${user.id}.${user.avatar.ext}`)).catch(() => undefined);
            delete user.avatar;
            saveAccounts();
            return json(200, accountView(user));
        }
        // Changing email: the current password, then a link sent to the new address confirms it.
        if (path === "/account/email" && req.method === "POST") {
            const b = await body();
            const email = str(b.email, 120).toLowerCase();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Enter a valid email." });
            if (email === user.email) return json(400, { error: "That's already your email." });
            if (userByEmail(email)) return json(409, { error: "Another account uses that email." });
            if (!checkPassword(req, res, user, b.password)) return res.writableEnded ? true : json(401, { error: "That isn't your current password." });
            user.emailChange = { email, token: randomBytes(24).toString("base64url"), expires: Date.now() + 24 * 60 * 60 * 1000 };
            saveAccounts();
            const link = `${String(b.origin ?? "").replace(/\/$/, "") || process.env.NAGMA_PUBLIC_URL || "http://localhost:5173"}/?verify-email=${user.emailChange.token}`;
            const sent = await sendMail(email, "Confirm your new Nagma email", `Open this link within a day to use ${email} for your Nagma account:\n\n${link}\n\nIf you didn't ask for this, ignore this message.`);
            const kept = sent ? false : await keepUnsentLink(DATA, "email-links.txt", `${new Date().toISOString()} email change for ${user.id}: ${link} (valid 1 day)\n`, email);
            return json(200, { ...accountView(user), sent, mailConfigured: mailConfigured(), kept });
        }
        if (path === "/account/email" && req.method === "DELETE") {
            delete user.emailChange;
            saveAccounts();
            return json(200, accountView(user));
        }
        // Before deleting: how many files you own, and who could take them.
        if (path === "/account/transfer" && req.method === "GET") {
            let owned = 0;
            await eachServerFile(async (_id, file) => {
                if (file.owner === user.id && !file.community && !file.template) owned += 1;
            });
            const blocking = myTeams(user).filter((t) => t.members[user.id] === "admin" && Object.keys(t.members).length > 1 && Object.values(t.members).filter((r) => r === "admin").length === 1).map((t) => t.name);
            return json(200, { owned, people: colleagues(user).map(person), blocking });
        }
        if (path === "/account" && req.method === "DELETE") {
            const b = await body();
            if (!checkPassword(req, res, user, b.password)) return res.writableEnded ? true : json(401, { error: "That isn't your current password." });
            const blocking = myTeams(user).filter((t) => t.members[user.id] === "admin" && Object.keys(t.members).length > 1 && Object.values(t.members).filter((r) => r === "admin").length === 1);
            if (blocking.length) return json(400, { error: `Make someone else an admin of ${blocking.map((t) => t.name).join(", ")} first.` });
            const heir = typeof b.transferTo === "string" ? colleagues(user).find((u) => u.id === b.transferTo) : null;
            if (b.transferTo && !heir) return json(400, { error: "Pick someone from your teams to take your files." });
            // Files you own go to the person you picked, or are deleted.
            const mine = [];
            await eachServerFile(async (id, file) => {
                if (file.owner === user.id) mine.push(id);
            });
            for (const id of mine) {
                const room = await loadRoom(id);
                if (!room.file) continue;
                if (heir && !room.file.community) {
                    room.file.owner = heir.id;
                    if (room.file.members) delete room.file.members[heir.id];
                    scheduleSave(room);
                    applyRoleChanges(room);
                } else await removeFile(id);
            }
            const org = getOrg();
            for (const t of myTeams(user)) {
                delete t.members[user.id];
                if (!Object.keys(t.members).length) {
                    org.teams = org.teams.filter((x) => x.id !== t.id);
                    org.projects = org.projects.filter((p) => p.teamId !== t.id);
                } else await onMemberRemoved(t, user.id);
            }
            saveOrg();
            const c = await readCommunity();
            c.entries = c.entries.filter((e) => e.by !== user.id);
            for (const e of c.entries) e.likes = e.likes.filter((uid) => uid !== user.id);
            saveCommunity();
            if (user.avatar) await unlink(join(AVATARS, `${user.id}.${user.avatar.ext}`)).catch(() => undefined);
            for (const [t, s] of Object.entries(accounts.sessions)) if (s.userId === user.id) delete accounts.sessions[t];
            dropInbox(user.id);
            // Its AI keys go with it.
            ctx.onAccountDeleted?.(user.id);
            accounts.users = accounts.users.filter((u) => u.id !== user.id);
            saveAccounts();
            return json(200, { ok: true, transferred: heir ? mine.length : 0 });
        }

        // ---- Starred files and folders, kept with the account ----
        if (path === "/account/stars") {
            if (req.method === "PUT") {
                const b = await body();
                const clean = (list) => (Array.isArray(list) ? [...new Set(list.filter((x) => typeof x === "string" && x.length <= 80))].slice(0, 500) : []);
                user.stars = { files: clean(b.files), folders: clean(b.folders) };
                saveAccounts();
            }
            return json(200, user.stars ?? { files: [], folders: [] });
        }

        // ---- Search ----
        if (path === "/search" && req.method === "GET") return json(200, await search(user, url.searchParams));

        // ---- Notifications: read state and replying from the inbox ----
        if (path === "/notifications/state" && req.method === "GET") return json(200, { readAt: user.noticesReadAt ?? 0, read: user.noticesRead ?? [] });
        if (path === "/notifications/read" && req.method === "POST") {
            const b = await body();
            if (Array.isArray(b.ids)) user.noticesRead = [...new Set([...(user.noticesRead ?? []), ...b.ids.filter((x) => typeof x === "string").map((x) => x.slice(0, 120))])].slice(-500);
            else {
                user.noticesReadAt = Date.now();
                user.noticesRead = [];
            }
            saveAccounts();
            return json(200, { readAt: user.noticesReadAt ?? 0, read: user.noticesRead ?? [] });
        }
        if (path === "/notifications/reply" && req.method === "POST") {
            const b = await body();
            const room = typeof b.fileId === "string" ? await loadRoom(b.fileId) : null;
            if (!room?.file) return json(404, { error: "That file was deleted." });
            const role = roleFor(room.file, user, "");
            if (!role) return json(403, { error: "You can't open that file any more." });
            const client = { uid: user.id, presence: { name: user.name, color: user.color }, role };
            const next = commentOp(room, client, { op: "reply", threadId: String(b.threadId ?? ""), reply: { id: randomBytes(8).toString("base64url"), text: str(b.text, 5000), attachments: [], mentions: [] } });
            if (typeof next === "string") return json(400, { error: next });
            room.file.comments = next;
            scheduleSave(room);
            broadcast(room, { type: "comments", comments: room.file.comments });
            return json(200, { ok: true });
        }

        // ---- Community ----
        if (path === "/community" && req.method === "GET") {
            const c = await readCommunity();
            const q = str(url.searchParams.get("q"), 100).toLowerCase();
            const kind = url.searchParams.get("kind") ?? "all";
            const by = url.searchParams.get("by");
            const sort = url.searchParams.get("sort") ?? "popular";
            let list = c.entries.filter((e) => (kind === "all" ? true : kind === "templates" ? e.template : e.kind === kind) && (!by || e.by === by));
            if (q) list = list.filter((e) => `${e.name} ${e.description} ${(e.tags ?? []).join(" ")} ${userById(e.by)?.name ?? ""}`.toLowerCase().includes(q));
            list.sort((a, b) => (sort === "recent" ? b.publishedAt - a.publishedAt : b.likes.length + (b.duplicates ?? 0) - (a.likes.length + (a.duplicates ?? 0)) || b.publishedAt - a.publishedAt));
            return json(200, await Promise.all(list.slice(0, 200).map((e) => communityEntry(e, user))));
        }
        if (path === "/community" && req.method === "POST") {
            if (needsVerification(user)) return json(403, { error: "Verify your email first. Open the link we sent you, or send a new one from the banner.", code: "email-unverified" });
            const b = await body();
            const room = typeof b.fileId === "string" ? await loadRoom(b.fileId) : null;
            if (!room?.file?.doc) return json(404, { error: "No such file." });
            if (roleFor(room.file, user, typeof b.key === "string" ? b.key : "") !== "edit") return json(403, { error: "Only editors can publish a file." });
            const c = await readCommunity();
            const meta = await readMeta(b.fileId);
            const doc = JSON.parse(JSON.stringify(room.file.doc));
            const name = str(b.name, 120) || doc.name || "Untitled";
            doc.name = name;
            const entryId = randomBytes(9).toString("base64url");
            // A copy is published, so later edits to the file stay private until it's published again.
            const made = await makeFile(user, doc, null, meta.kind ?? "design", { community: entryId, link: "view" });
            if (meta.thumb) await writeMeta(made.id, { thumb: meta.thumb });
            const team = myTeams(user)[0];
            c.entries.unshift({ id: entryId, fileId: made.id, source: b.fileId, name, description: str(b.description, 600), tags: (Array.isArray(b.tags) ? b.tags : String(b.tags ?? "").split(",")).map((t) => str(t, 30)).filter(Boolean).slice(0, 8), kind: meta.kind ?? "design", template: Boolean(b.template), by: user.id, team: team ? { id: team.id, name: team.settings?.displayName || team.name } : null, publishedAt: Date.now(), likes: [], duplicates: 0 });
            saveCommunity();
            return json(200, await communityEntry(c.entries[0], user));
        }
        const ce = /^\/community\/([A-Za-z0-9_-]{6,64})(\/like|\/duplicate)?$/.exec(path);
        if (ce) {
            const c = await readCommunity();
            const e = c.entries.find((x) => x.id === ce[1]);
            if (!e) return json(404, { error: "That file isn't published any more." });
            if (!ce[2] && req.method === "DELETE") {
                if (e.by !== user.id) return json(403, { error: "Only the publisher can unpublish it." });
                c.entries = c.entries.filter((x) => x !== e);
                saveCommunity();
                await removeFile(e.fileId);
                return json(200, { ok: true });
            }
            if (ce[2] === "/like" && req.method === "POST") {
                e.likes = e.likes.includes(user.id) ? e.likes.filter((u) => u !== user.id) : [...e.likes, user.id];
                saveCommunity();
                return json(200, await communityEntry(e, user));
            }
            if (ce[2] === "/duplicate" && req.method === "POST") {
                const room = await loadRoom(e.fileId);
                if (!room.file?.doc) return json(404, { error: "The published file is missing." });
                const doc = JSON.parse(JSON.stringify(room.file.doc));
                const made = await makeFile(user, doc, null, e.kind);
                const meta = await readMeta(e.fileId);
                if (meta.thumb) await writeMeta(made.id, { thumb: meta.thumb });
                e.duplicates = (e.duplicates ?? 0) + 1;
                saveCommunity();
                return json(200, { id: made.id, keys: made.file.keys, name: doc.name, kind: e.kind });
            }
            if (!ce[2] && req.method === "GET") return json(200, await communityEntry(e, user));
        }
        const prof = /^\/community\/people\/([A-Za-z0-9_-]{1,64})$/.exec(path);
        if (prof && req.method === "GET") {
            const u = userById(prof[1]) ?? accounts.users.find((x) => (x.profile?.handle ?? "").toLowerCase() === prof[1].toLowerCase());
            if (!u) return json(404, { error: "No such profile." });
            const c = await readCommunity();
            const mine = c.entries.filter((e) => e.by === u.id);
            return json(200, { ...communityPerson(u), bio: u.profile?.bio ?? "", joinedAt: u.createdAt ?? null, likes: mine.reduce((n, e) => n + e.likes.length, 0), files: await Promise.all(mine.map((e) => communityEntry(e, user))) });
        }

        // ---- Stock photos (NAGMA_STOCK_KEY; NAGMA_STOCK_PROVIDER=unsplash|pexels) ----
        if (path === "/providers/stock" && req.method === "GET") {
            const key = process.env.NAGMA_STOCK_KEY;
            if (!key) return json(501, { error: "No stock photo provider is connected on this server." });
            const q = str(url.searchParams.get("q"), 100) || "nature";
            const page = Math.max(1, Math.min(50, Number(url.searchParams.get("page")) || 1));
            const pexels = process.env.NAGMA_STOCK_PROVIDER === "pexels";
            try {
                const upstream = pexels ? await fetch(`https://api.pexels.com/v1/search?per_page=24&page=${page}&query=${encodeURIComponent(q)}`, { headers: { authorization: key } }) : await fetch(`https://api.unsplash.com/search/photos?per_page=24&page=${page}&query=${encodeURIComponent(q)}`, { headers: { authorization: `Client-ID ${key}`, "accept-version": "v1" } });
                if (!upstream.ok) return json(502, { error: `The stock photo service answered ${upstream.status}.` });
                const data = await upstream.json();
                const utm = "utm_source=nagma&utm_medium=referral";
                const out = pexels
                    ? (data.photos ?? []).map((p) => ({ id: String(p.id), alt: p.alt ?? "", url: p.src?.large2x ?? p.src?.original, preview: p.src?.medium, w: p.width, h: p.height, color: p.avg_color ?? null, author: p.photographer ?? "", authorUrl: p.photographer_url ?? "", source: "Pexels", sourceUrl: p.url ?? "https://www.pexels.com" }))
                    : (data.results ?? []).map((p) => ({ id: p.id, alt: p.alt_description ?? "", url: p.urls?.regular, preview: p.urls?.small, w: p.width, h: p.height, color: p.color ?? null, author: p.user?.name ?? "", authorUrl: p.user?.links?.html ? `${p.user.links.html}?${utm}` : "", source: "Unsplash", sourceUrl: `https://unsplash.com/?${utm}`, download: p.links?.download_location ?? null }));
                return json(200, out.filter((p) => p.url && p.preview));
            } catch {
                return json(502, { error: "The stock photo service can't be reached." });
            }
        }
        // The picture itself, fetched here so it can go on the canvas (only from the providers' image hosts).
        if (path === "/providers/stock/image" && req.method === "GET") {
            if (!process.env.NAGMA_STOCK_KEY) return json(501, { error: "No stock photo provider is connected on this server." });
            let target;
            try {
                target = new URL(String(url.searchParams.get("url") ?? ""));
            } catch {
                return json(400, { error: "Bad address." });
            }
            if (target.protocol !== "https:" || !["images.unsplash.com", "images.pexels.com"].includes(target.hostname)) return json(400, { error: "Not a stock photo address." });
            const download = url.searchParams.get("download");
            // Unsplash asks apps to report each use of a photo.
            if (download && process.env.NAGMA_STOCK_PROVIDER !== "pexels" && /^https:\/\/api\.unsplash\.com\//.test(download)) void fetch(download, { headers: { authorization: `Client-ID ${process.env.NAGMA_STOCK_KEY}` } }).catch(() => undefined);
            try {
                const upstream = await fetch(target);
                const type = upstream.headers.get("content-type") ?? "";
                if (!upstream.ok || !type.startsWith("image/")) return json(502, { error: "The picture couldn't be fetched." });
                const data = Buffer.from(await upstream.arrayBuffer());
                if (data.length > 25 * 1024 * 1024) return json(413, { error: "That picture is too large." });
                res.writeHead(200, { ...CORS, "content-type": type }).end(data);
                return true;
            } catch {
                return json(502, { error: "The picture couldn't be fetched." });
            }
        }
        // (GET /providers and image generation are in ai.mjs: the person's own image key, then the server's.)
        return false;
    }

    // Community copies and their source: lets the file browser skip published copies.
    return { serve, person, avatarUrl, readCommunity };
}
