// Team administration: seats, plan and monthly statements, AI credits, requests, user groups,
// unassigned drafts, settings, the design token registry and team templates. Everything is kept on
// the team record in teams.json. Billing here is bookkeeping only: plans, seat counts and prices are
// set by the team's admins and statements are computed from them. Nothing is charged and no payment
// details are ever collected.
import { randomBytes } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { parseObject } from "./json-body.mjs";

const SEATS = ["full", "dev", "collab", "view"];
const SEAT_SET = new Set(SEATS);
const PAID = ["full", "dev", "collab"];
const DEFAULT_PRICES = { full: 16, dev: 12, collab: 3, view: 0 };
const DEFAULT_ALLOWANCE = { full: 100, dev: 50, collab: 25, view: 0 };
const DEFAULT_SETTINGS = {
    displayName: "",
    handle: "",
    invoiceDetails: { company: "", address: "", note: "" },
    taxId: "",
    seatApproval: "admins",
    autoApproveDigests: false,
    billingContacts: [],
    aiCreditRequests: true,
    uiKits: true,
    sourceControl: { provider: "", organization: "", repositories: "", access: "admins" },
    contentTraining: false,
    defaultLibraries: [],
    // Products people on the team can use: Inspect in design files, Make, and publishing sites.
    devMode: true,
    make: true,
    sitesPublishing: true,
};
const id = () => randomBytes(9).toString("base64url");
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const num = (v, min, max, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// The same calendar day `n` months later (the last day of a shorter month when it doesn't exist).
function addMonths(t, n) {
    const d = new Date(t);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return d.getTime();
}

// The period around `now` for a cycle anchored at `anchor`, `months` long.
function periodAt(anchor, months, now = Date.now()) {
    let i = 0;
    while (addMonths(anchor, (i + 1) * months) <= now) i++;
    return { index: i, start: addMonths(anchor, i * months), end: addMonths(anchor, (i + 1) * months) };
}

export function createAdmin(ctx) {
    const hasOwnAiKey = (user) => Boolean(ctx.hasOwnAiKey?.(user));
    const { getOrg, saveOrg, accounts, saveAccounts, userById, publicUser, teamById, teamRole, readBody, CORS, DATA, filePath, rooms, loadRoom, scheduleSave, readMeta, writeMeta, removeFile, makeFile, applyRoleChanges, userFromReq, notify } = ctx;
    const needsVerification = ctx.needsVerification ?? (() => false);

    // Defaults filled in on first use so older teams get a plan, seats and settings too.
    function ensure(t) {
        const members = Object.keys(t.members);
        t.seats ??= {};
        for (const uid of members) if (!SEAT_SET.has(t.seats[uid])) t.seats[uid] = t.members[uid] === "view" ? "view" : "full";
        for (const uid of Object.keys(t.seats)) if (!t.members[uid]) delete t.seats[uid];
        t.joined ??= {};
        for (const uid of members) t.joined[uid] ??= t.createdAt ?? Date.now();
        const paid = PAID.reduce((n, s) => n + Object.values(t.seats).filter((x) => x === s).length, 0);
        t.billing ??= { plan: "Professional", interval: "monthly", startedAt: t.createdAt ?? Date.now(), seatsPurchased: paid, prices: { ...DEFAULT_PRICES }, currency: "USD", cancelAtPeriodEnd: false, extraCredits: 0 };
        t.billing.prices = { ...DEFAULT_PRICES, ...(t.billing.prices ?? {}) };
        // Assigning a paid seat beyond what was bought adds one, like a seat added mid-cycle.
        if (paid > t.billing.seatsPurchased) {
            seatEvent(t, paid - t.billing.seatsPurchased);
            t.billing.seatsPurchased = paid;
        }
        // Annual plans: fewer seats take effect at renewal.
        if (t.billing.pendingSeats && t.billing.pendingSeats.at <= Date.now()) {
            t.billing.seatsPurchased = Math.max(paid, t.billing.pendingSeats.count);
            delete t.billing.pendingSeats;
        }
        t.ai ??= { allowance: { ...DEFAULT_ALLOWANCE } };
        t.ai.allowance = { ...DEFAULT_ALLOWANCE, ...(t.ai.allowance ?? {}) };
        // Credits beyond each seat's allowance come from the team's monthly pool, then a
        // pay-as-you-go budget; a daily limit per person (0: none) keeps one person from using it all.
        t.ai.pool ??= 0;
        t.ai.payg ??= { enabled: false, budget: 0, price: 0.04 };
        t.ai.daily ??= 0;
        t.billingGroups ??= [];
        t.workspaces ??= [];
        t.requests ??= [];
        t.groups ??= [];
        t.unassigned ??= [];
        t.invoices ??= [];
        t.seatEvents ??= [];
        t.templates ??= [];
        t.registry ??= { name: "", versions: [] };
        t.settings = { ...DEFAULT_SETTINGS, ...(t.settings ?? {}) };
        return t;
    }

    function seatEvent(t, delta) {
        t.seatEvents ??= [];
        t.seatEvents.push({ at: Date.now(), delta });
        if (t.seatEvents.length > 200) t.seatEvents.splice(0, t.seatEvents.length - 200);
    }

    const months = (t) => (t.billing.interval === "annual" ? 12 : 1);
    const counts = (t) => Object.fromEntries(SEATS.map((s) => [s, Object.values(t.seats).filter((x) => x === s).length]));

    // What one cycle costs: each assigned paid seat at its price, unassigned paid seats at the full price.
    function costLines(t, seats = counts(t), purchased = t.billing.seatsPurchased) {
        const p = t.billing.prices;
        const m = months(t);
        const lines = PAID.filter((s) => seats[s] > 0).map((s) => ({ label: `${s[0].toUpperCase()}${s.slice(1)} seats`, qty: seats[s], unit: p[s] * m, amount: seats[s] * p[s] * m }));
        const assigned = PAID.reduce((n, s) => n + seats[s], 0);
        const spare = Math.max(0, purchased - assigned);
        if (spare) lines.push({ label: "Available seats", qty: spare, unit: p.full * m, amount: spare * p.full * m });
        if (seats.view) lines.push({ label: "View seats", qty: seats.view, unit: 0, amount: 0 });
        return lines;
    }

    // Seats added during the current cycle, charged for the part of the cycle that's left.
    function adjustments(t, period) {
        const len = period.end - period.start;
        const out = [];
        for (const e of t.seatEvents ?? []) {
            if (e.at < period.start || e.at >= period.end || e.delta <= 0) continue;
            const share = (period.end - e.at) / len;
            out.push({ at: e.at, label: `${e.delta} seat${e.delta === 1 ? "" : "s"} added`, amount: Math.round(e.delta * t.billing.prices.full * months(t) * share * 100) / 100 });
        }
        return out;
    }

    // Monthly (or yearly) statements, written at the start of each cycle with the seats at that time.
    function syncInvoices(t) {
        const m = months(t);
        const now = Date.now();
        const cur = periodAt(t.billing.startedAt, m, now);
        const have = new Set(t.invoices.map((i) => i.start));
        for (let i = Math.max(0, cur.index - 24); i <= cur.index; i++) {
            const start = addMonths(t.billing.startedAt, i * m);
            if (have.has(start)) continue;
            const prev = { start: addMonths(t.billing.startedAt, (i - 1) * m), end: start };
            const lines = costLines(t);
            const adj = i > 0 ? adjustments(t, prev) : [];
            const total = lines.reduce((n, l) => n + l.amount, 0) + adj.reduce((n, a) => n + a.amount, 0);
            t.invoices.push({ id: id(), number: `M-${String(t.invoices.length + 1).padStart(4, "0")}`, start, end: addMonths(t.billing.startedAt, (i + 1) * m), issuedAt: start, plan: t.billing.plan, interval: t.billing.interval, lines, adjustments: adj, total: Math.round(total * 100) / 100, currency: t.billing.currency });
        }
        t.invoices.sort((a, b) => b.start - a.start);
    }

    // AI credits: one credit per request to the agent, counted per person and reset monthly on the billing day.
    const creditPeriod = (t) => periodAt(t.billing.startedAt, 1);
    const aiUsed = (u, period) => (u?.aiLog ?? []).filter((at) => at >= period.start && at < period.end).length;
    const allowanceOf = (t, uid) => t.ai.allowance[t.seats[uid] ?? "view"] ?? 0;
    const usedToday = (u) => {
        const day = new Date();
        day.setHours(0, 0, 0, 0);
        return (u?.aiLog ?? []).filter((at) => at >= day.getTime()).length;
    };

    // Where this month's credits beyond the seat allowances come from.
    function creditSources(t, list) {
        const overage = list.reduce((n, p) => n + Math.max(0, p.aiUsed - p.aiAllowance), 0);
        const pool = t.ai.pool + (t.billing.extraCredits ?? 0);
        const fromPool = Math.min(overage, pool);
        const payg = t.ai.payg.enabled ? t.ai.payg.budget : 0;
        const fromPayg = Math.min(overage - fromPool, payg);
        return { overage, pool, fromPool, payg: { ...t.ai.payg, used: fromPayg, cost: Math.round(fromPayg * t.ai.payg.price * 100) / 100 }, blocked: overage - fromPool - fromPayg };
    }

    // Whether `user` can use another credit in `t` now, and why not.
    function creditCheck(t, user) {
        const period = creditPeriod(t);
        if (t.ai.daily && usedToday(user) >= t.ai.daily) return { allowed: false, reason: `You've used today's ${t.ai.daily} credits. More are available tomorrow.` };
        const used = aiUsed(user, period);
        if (used < allowanceOf(t, user.id)) return { allowed: true, reason: null };
        const src = creditSources(t, people(t));
        return src.overage < src.pool + src.payg.budget * (t.ai.payg.enabled ? 1 : 0) ? { allowed: true, reason: null } : { allowed: false, reason: "The team is out of AI credits for this month. Ask an admin for more." };
    }

    function people(t) {
        const period = creditPeriod(t);
        return Object.entries(t.members)
            .map(([uid, role]) => {
                const u = userById(uid);
                if (!u) return null;
                return { ...publicUser(u), role, seat: t.seats[uid], lastActive: u.lastActive ?? null, joinedAt: t.joined?.[uid] ?? null, aiUsed: aiUsed(u, period), aiToday: usedToday(u), aiAllowance: allowanceOf(t, uid), groups: t.groups.filter((g) => g.members.includes(uid)).map((g) => g.id), billingGroup: t.billingGroups.find((g) => g.members.includes(uid))?.id ?? null };
            })
            .filter(Boolean);
    }

    function billingView(t) {
        const m = months(t);
        const period = periodAt(t.billing.startedAt, m);
        const seats = counts(t);
        const lines = costLines(t);
        const adj = adjustments(t, period);
        const monthly = lines.reduce((n, l) => n + l.amount, 0);
        const assigned = PAID.reduce((n, s) => n + seats[s], 0);
        return {
            plan: t.billing.plan,
            interval: t.billing.interval,
            currency: t.billing.currency,
            prices: t.billing.prices,
            startedAt: t.billing.startedAt,
            periodStart: period.start,
            periodEnd: period.end,
            renewsAt: period.end,
            cancelAtPeriodEnd: Boolean(t.billing.cancelAtPeriodEnd),
            seatsPurchased: t.billing.seatsPurchased,
            seats,
            assigned,
            available: Math.max(0, t.billing.seatsPurchased - assigned),
            lines,
            adjustments: adj,
            cycleCost: Math.round(monthly * 100) / 100,
            nextInvoice: { due: period.end, amount: Math.round((monthly + adj.reduce((n, a) => n + a.amount, 0)) * 100) / 100 },
            extraCredits: t.billing.extraCredits ?? 0,
            // Annual plans: seats added mid-year are billed at renewal; fewer seats start then too.
            pendingSeats: t.billing.pendingSeats ?? null,
            deferred: t.billing.interval === "annual",
            groups: t.billingGroups.map((g) => {
                const costs = costLines(t, Object.fromEntries(SEATS.map((st) => [st, g.members.filter((uid) => t.seats[uid] === st).length])), 0);
                return { ...g, cost: Math.round(costs.reduce((n, l) => n + l.amount, 0) * 100) / 100 };
            }),
        };
    }

    function adminView(t, user) {
        ensure(t);
        syncInvoices(t);
        const period = creditPeriod(t);
        const list = people(t);
        return {
            isAdmin: true,
            team: { id: t.id, name: t.name, createdAt: t.createdAt ?? null },
            me: user.id,
            people: list,
            billing: billingView(t),
            ai: { allowance: t.ai.allowance, extraCredits: t.billing.extraCredits ?? 0, periodStart: period.start, resetAt: period.end, using: list.filter((p) => p.aiUsed > 0).length, atLimit: list.filter((p) => p.aiUsed > 0 && p.aiUsed >= p.aiAllowance).length, pool: t.ai.pool, daily: t.ai.daily, sources: creditSources(t, list) },
            connected: connections(t),
            workspaces: t.workspaces,
            requests: t.requests.map((r) => ({ ...r, user: publicUser(userById(r.userId)) })),
            groups: t.groups,
            unassigned: t.unassigned.map(({ fileIds, ...u }) => ({ ...u, files: fileIds.length })),
            settings: t.settings,
            registry: { name: t.registry.name || `@${slug(t.name)}/tokens`, versions: t.registry.versions.map(({ tokens: _t, ...v }) => v) },
        };
    }

    // Connected folders: folders shared between teams on this server. Incoming ones belong to other
    // teams and are open to this team's members; outgoing ones are this team's, open to other teams.
    function connections(t) {
        const org = getOrg();
        const row = (p, tid) => ({ projectId: p.id, name: p.name, team: { id: tid, name: teamById(tid)?.name ?? "Team" }, owner: { id: p.teamId, name: teamById(p.teamId)?.name ?? "Team" }, role: p.connections[tid], connectedAt: p.connectedAt?.[tid] ?? null });
        return {
            incoming: org.projects.filter((p) => p.teamId !== t.id && !p.trashed && p.connections?.[t.id]).map((p) => row(p, t.id)),
            outgoing: org.projects.filter((p) => p.teamId === t.id && !p.trashed && p.connections).flatMap((p) => Object.keys(p.connections).map((tid) => row(p, tid))),
            teams: org.teams.filter((x) => x.id !== t.id).map((x) => ({ id: x.id, name: x.name })),
            folders: org.projects.filter((p) => p.teamId === t.id && !p.trashed && !p.parentId).map((p) => ({ id: p.id, name: p.name })),
        };
    }
    function refreshAccess(project) {
        const org = getOrg();
        const inside = new Set([project.id]);
        for (let grew = true; grew; ) {
            grew = false;
            for (const p of org.projects) if (p.parentId && inside.has(p.parentId) && !inside.has(p.id)) (inside.add(p.id), (grew = true));
        }
        for (const room of rooms.values()) if (room.file?.project && inside.has(room.file.project)) applyRoleChanges(room);
    }
    const adminsOf = (t) => Object.entries(t.members).filter(([, r]) => r === "admin").map(([uid]) => uid);

    // What a member who isn't an admin sees: their own seat and requests, and the plan's name.
    function memberView(t, user) {
        ensure(t);
        const period = creditPeriod(t);
        return {
            isAdmin: false,
            team: { id: t.id, name: t.name, createdAt: t.createdAt ?? null },
            me: user.id,
            role: t.members[user.id],
            seat: t.seats[user.id],
            plan: t.billing.plan,
            admins: Object.entries(t.members).filter(([, r]) => r === "admin").map(([uid]) => publicUser(userById(uid))).filter(Boolean),
            aiUsed: aiUsed(user, period),
            aiAllowance: allowanceOf(t, user.id),
            aiToday: usedToday(user),
            aiDaily: t.ai.daily,
            resetAt: period.end,
            requests: t.requests.filter((r) => r.userId === user.id),
        };
    }

    // Drafts (files with no project) a person owns that they made after joining the team.
    async function draftsOf(uid, since) {
        const out = [];
        const names = (await readdir(DATA)).filter((n) => /^[A-Za-z0-9_-]{6,64}\.json$/.test(n));
        for (const n of names) {
            const fid = n.slice(0, -5);
            try {
                const file = rooms.get(fid)?.file ?? JSON.parse(await readFile(filePath(fid), "utf8"));
                if (!file?.doc || file.branchOf || file.template || file.community || file.owner !== uid || file.project) continue;
                const meta = await readMeta(fid);
                if (meta.trashed) continue;
                const created = meta.createdAt ?? (await stat(filePath(fid))).birthtimeMs;
                if (created < since) continue;
                out.push(fid);
            } catch {
                // Unreadable files are skipped.
            }
        }
        return out;
    }

    // Files someone owns inside the team's projects.
    async function teamFilesOf(t, uid) {
        const org = getOrg();
        const projects = new Set(org.projects.filter((p) => p.teamId === t.id).map((p) => p.id));
        const out = [];
        const names = (await readdir(DATA)).filter((n) => /^[A-Za-z0-9_-]{6,64}\.json$/.test(n));
        for (const n of names) {
            const fid = n.slice(0, -5);
            try {
                const file = rooms.get(fid)?.file ?? JSON.parse(await readFile(filePath(fid), "utf8"));
                if (!file?.doc || file.branchOf || file.template || file.owner !== uid || !projects.has(file.project)) continue;
                const meta = await readMeta(fid);
                if (meta.trashed) continue;
                out.push({ id: fid, name: file.doc.name ?? "Untitled", kind: meta.kind ?? "design", project: file.project, updatedAt: meta.updatedAt ?? 0 });
            } catch {
                // Skipped.
            }
        }
        return out.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    // A member left or was removed: their drafts from their time on the team wait here for an admin.
    async function onMemberRemoved(t, uid) {
        ensure(t);
        const u = userById(uid);
        const fileIds = await draftsOf(uid, t.joined?.[uid] ?? 0);
        delete t.seats[uid];
        delete t.joined[uid];
        for (const g of t.groups) g.members = g.members.filter((m) => m !== uid);
        t.requests = t.requests.filter((r) => r.userId !== uid);
        if (fileIds.length) {
            for (const fid of fileIds) {
                const room = await loadRoom(fid);
                if (!room.file) continue;
                room.file.unassignedFrom = t.id;
                scheduleSave(room);
            }
            t.unassigned.push({ id: id(), userId: uid, name: u?.name ?? "Removed user", email: u?.email ?? "", color: u?.color ?? "#888888", removedAt: Date.now(), fileIds });
        }
        saveOrg();
    }

    function noteJoined(t, uid) {
        t.joined ??= {};
        t.joined[uid] ??= Date.now();
    }

    // Last active: the most recent request a signed-in person made, written at most once a minute.
    function noteActive(user) {
        if (!user) return;
        const now = Date.now();
        if (user.lastActive && now - user.lastActive < 60_000) return;
        user.lastActive = now;
        saveAccounts();
    }

    const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "team";

    async function serve(req, res) {
        const url = new URL(req.url ?? "/", "http://local");
        const path = url.pathname;
        const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
        const body = async (limit = 256 * 1024) => {
            try {
                return parseObject(await readBody(req, limit));
            } catch {
                return {};
            }
        };
        const user = userFromReq(req);

        // Credits are counted by the server when the shared key answers (ai.mjs record); older
        // clients that still report their own requests are answered without counting.
        if (path === "/ai/usage" && req.method === "POST") return json(200, { ok: false, counted: false });

        // Whether the agent can take another request (the seat allowance, the team's pool and budget,
        // and the daily limit, on the best of the person's teams).
        if (path === "/ai/usage" && req.method === "GET") {
            if (!user) return json(200, { allowed: true, reason: null });
            if (hasOwnAiKey(user)) return json(200, { allowed: true, reason: null, ownKey: true });
            const checks = getOrg().teams.filter((t) => t.members[user.id]).map((t) => creditCheck(ensure(t), user));
            return json(200, checks.find((c) => c.allowed) ?? checks[0] ?? { allowed: true, reason: null });
        }

        const m = /^\/teams\/([A-Za-z0-9_-]{6,64})\/(admin|templates)(?:\/([A-Za-z0-9_.-]+))?(?:\/([A-Za-z0-9_.-]+))?$/.exec(path);
        if (!m) return false;
        if (!user) return json(401, { error: "Sign in first." });
        const t = teamById(m[1]);
        const role = teamRole(t, user);
        if (!t || !role) return json(404, { error: "No such team." });
        ensure(t);
        const admin = role === "admin";
        const [, , area, a, b] = m;

        if (area === "templates") return serveTemplates(req, res, t, user, role, a, b, json, body);

        if (!a && req.method === "GET") return json(200, admin ? adminView(t, user) : memberView(t, user));

        // Anyone on the team can ask for a different seat, more AI credits or access; admins decide.
        if (a === "requests" && req.method === "POST" && !b) {
            const q = await body();
            const kind = ["seat", "credits", "access"].includes(q.kind) ? q.kind : "seat";
            const seat = SEAT_SET.has(q.seat) ? q.seat : "full";
            if (t.requests.some((r) => r.userId === user.id && r.kind === kind && r.status === "pending")) return json(400, { error: "You already have a request waiting for an admin." });
            const r = { id: id(), userId: user.id, kind, seat, note: str(q.note, 500), at: Date.now(), status: "pending" };
            t.requests.push(r);
            if (kind === "seat" && t.settings.seatApproval === "auto") decide(t, r, "approved", null);
            else for (const uid of adminsOf(t)) notify(uid, { why: "team-request", teamId: t.id, requestId: r.id, fileName: t.name, author: { name: user.name, color: user.color }, text: kind === "seat" ? `Asks for a ${seat} seat${r.note ? `: ${r.note}` : "."}` : kind === "credits" ? `Asks for more AI credits${r.note ? `: ${r.note}` : "."}` : `Asks for access${r.note ? `: ${r.note}` : "."}` });
            saveOrg();
            return json(200, memberView(t, user));
        }

        if (!admin) return json(403, { error: "Only team admins can do that." });

        if (a === "invoices" && req.method === "GET") {
            syncInvoices(t);
            saveOrg();
            return json(200, t.invoices);
        }
        if (a === "files" && b && req.method === "GET") return json(200, await teamFilesOf(t, b));
        if (a === "registry" && b && req.method === "GET") {
            const v = t.registry.versions.find((x) => x.version === b);
            return v ? json(200, v) : json(404, { error: "No such version." });
        }
        if (req.method !== "POST" || !a) return json(405, { error: "Method not allowed." });
        const q = await body(a === "registry" ? 8 * 1024 * 1024 : 256 * 1024);

        switch (a) {
            case "seat": {
                if (!t.members[q.userId] || !SEAT_SET.has(q.seat)) return json(400, { error: "Pick a person and a seat type." });
                if (t.seats[q.userId] !== q.seat && q.userId !== user.id) notify(q.userId, { why: "seat-changed", teamId: t.id, fileName: t.name, author: { name: user.name, color: user.color }, text: `Your seat on ${t.name} is now ${q.seat === "full" ? "Full" : q.seat === "dev" ? "Dev" : q.seat === "collab" ? "Collab" : "View"}.` });
                t.seats[q.userId] = q.seat;
                break;
            }
            case "role": {
                if (!t.members[q.userId] || !["admin", "edit", "view"].includes(q.role)) return json(400, { error: "Pick a person and a role." });
                if (q.userId === user.id && q.role !== "admin" && Object.values(t.members).filter((r) => r === "admin").length < 2) return json(400, { error: "A team needs at least one admin." });
                t.members[q.userId] = q.role;
                for (const room of rooms.values()) if (room.file) applyRoleChanges(room);
                break;
            }
            case "remove": {
                if (!t.members[q.userId]) return json(404, { error: "That person isn't on the team." });
                if (q.userId === user.id) return json(400, { error: "You can't remove yourself here." });
                delete t.members[q.userId];
                await onMemberRemoved(t, q.userId);
                for (const room of rooms.values()) if (room.file) applyRoleChanges(room);
                break;
            }
            case "invite": {
                const emails = String(q.emails ?? "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean).slice(0, 50);
                if (!emails.length) return json(400, { error: "Add at least one email." });
                const seat = SEAT_SET.has(q.seat) ? q.seat : "full";
                const memberRole = ["admin", "edit", "view"].includes(q.role) ? q.role : "edit";
                const missing = [];
                const invalid = [];
                const already = [];
                // Accounts that haven't verified their email can't be added yet.
                const unverified = [];
                for (const email of emails) {
                    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                        invalid.push(email);
                        continue;
                    }
                    const invitee = ctx.userByEmail(email);
                    if (!invitee) {
                        missing.push(email);
                        continue;
                    }
                    // Someone already on the team keeps their role and seat (inviting an admin again
                    // made them a member, and could leave the team with no admin); change those in People.
                    if (t.members[invitee.id]) {
                        already.push(email);
                        continue;
                    }
                    if (needsVerification(invitee)) {
                        unverified.push(email);
                        continue;
                    }
                    noteJoined(t, invitee.id);
                    t.members[invitee.id] = memberRole;
                    t.seats[invitee.id] = seat;
                }
                for (const room of rooms.values()) if (room.file) applyRoleChanges(room);
                ensure(t);
                saveOrg();
                return json(200, { ...adminView(t, user), missing, invalid, already, unverified });
            }
            case "billing": {
                const bl = t.billing;
                if (typeof q.plan === "string" && q.plan.trim()) bl.plan = str(q.plan, 40);
                if (q.interval === "monthly" || q.interval === "annual") bl.interval = q.interval;
                if (q.prices && typeof q.prices === "object") for (const s of SEATS) if (q.prices[s] !== undefined) bl.prices[s] = num(q.prices[s], 0, 100000, bl.prices[s]);
                if (typeof q.currency === "string" && /^[A-Z]{3}$/.test(q.currency)) bl.currency = q.currency;
                if (q.seatsPurchased !== undefined) {
                    const assigned = PAID.reduce((n, s) => n + Object.values(t.seats).filter((x) => x === s).length, 0);
                    const next = Math.round(num(q.seatsPurchased, assigned, 100000, bl.seatsPurchased));
                    if (next > bl.seatsPurchased) {
                        seatEvent(t, next - bl.seatsPurchased);
                        bl.seatsPurchased = next;
                        delete bl.pendingSeats;
                    } else if (next < bl.seatsPurchased && bl.interval === "annual") bl.pendingSeats = { count: next, at: periodAt(bl.startedAt, 12).end };
                    else bl.seatsPurchased = next;
                }
                if (typeof q.cancelAtPeriodEnd === "boolean") bl.cancelAtPeriodEnd = q.cancelAtPeriodEnd;
                if (q.renewalDay !== undefined) {
                    const day = Math.round(num(q.renewalDay, 1, 28, new Date(bl.startedAt).getDate()));
                    const d = new Date(bl.startedAt);
                    d.setDate(day);
                    bl.startedAt = d.getTime();
                    t.invoices = [];
                }
                break;
            }
            case "ai": {
                if (q.allowance && typeof q.allowance === "object") for (const s of SEATS) if (q.allowance[s] !== undefined) t.ai.allowance[s] = Math.round(num(q.allowance[s], 0, 1_000_000, t.ai.allowance[s]));
                if (q.extraCredits !== undefined) t.billing.extraCredits = Math.round(num(q.extraCredits, 0, 10_000_000, 0));
                if (q.pool !== undefined) t.ai.pool = Math.round(num(q.pool, 0, 10_000_000, 0));
                if (q.daily !== undefined) t.ai.daily = Math.round(num(q.daily, 0, 100_000, 0));
                if (q.payg && typeof q.payg === "object") t.ai.payg = { enabled: Boolean(q.payg.enabled), budget: Math.round(num(q.payg.budget, 0, 10_000_000, t.ai.payg.budget)), price: num(q.payg.price, 0, 100, t.ai.payg.price) };
                break;
            }
            case "settings": {
                const s = t.settings;
                const p = q.settings ?? {};
                if (p.displayName !== undefined) s.displayName = str(p.displayName, 60);
                if (p.handle !== undefined) s.handle = str(p.handle, 40).replace(/[^A-Za-z0-9_-]/g, "");
                if (p.invoiceDetails) s.invoiceDetails = { company: str(p.invoiceDetails.company, 120), address: str(p.invoiceDetails.address, 400), note: str(p.invoiceDetails.note, 400) };
                if (p.taxId !== undefined) s.taxId = str(p.taxId, 40);
                if (p.seatApproval === "admins" || p.seatApproval === "auto") s.seatApproval = p.seatApproval;
                if (typeof p.autoApproveDigests === "boolean") s.autoApproveDigests = p.autoApproveDigests;
                if (Array.isArray(p.billingContacts)) s.billingContacts = p.billingContacts.map((e) => str(e, 120).toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+$/.test(e)).slice(0, 20);
                if (typeof p.aiCreditRequests === "boolean") s.aiCreditRequests = p.aiCreditRequests;
                if (typeof p.uiKits === "boolean") s.uiKits = p.uiKits;
                if (p.sourceControl) s.sourceControl = { provider: str(p.sourceControl.provider, 40), organization: str(p.sourceControl.organization, 80), repositories: str(p.sourceControl.repositories, 400), access: p.sourceControl.access === "everyone" ? "everyone" : "admins" };
                if (typeof p.contentTraining === "boolean") s.contentTraining = p.contentTraining;
                for (const k of ["devMode", "make", "sitesPublishing"]) if (typeof p[k] === "boolean") s[k] = p[k];
                if (Array.isArray(p.defaultLibraries)) s.defaultLibraries = p.defaultLibraries.filter((x) => typeof x === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(x)).slice(0, 50);
                if (typeof p.teamName === "string" && p.teamName.trim()) t.name = str(p.teamName, 60);
                break;
            }
            case "decide": {
                const r = t.requests.find((x) => x.id === q.id);
                if (!r || r.status !== "pending") return json(404, { error: "That request was already handled." });
                decide(t, r, q.approve ? "approved" : "denied", user.id);
                notify(r.userId, { why: q.approve ? "team-request-approved" : "team-request-denied", teamId: t.id, fileName: t.name, author: { name: user.name, color: user.color }, text: `${q.approve ? "Approved" : "Declined"} your request for ${r.kind === "seat" ? `a ${r.seat} seat` : r.kind === "credits" ? "more AI credits" : "access"}.` });
                break;
            }
            case "connect": {
                const p = getOrg().projects.find((x) => x.id === q.projectId && x.teamId === t.id && !x.trashed);
                const to = teamById(q.teamId);
                if (!p || !to || to.id === t.id) return json(400, { error: "Pick one of the team's folders and another team." });
                p.connections ??= {};
                p.connectedAt ??= {};
                p.connections[to.id] = q.role === "view" ? "view" : "edit";
                p.connectedAt[to.id] = Date.now();
                for (const uid of adminsOf(to)) notify(uid, { why: "folder-connected", teamId: to.id, fileName: p.name, author: { name: user.name, color: user.color }, text: `${t.name} connected the folder "${p.name}" to ${to.name}.` });
                refreshAccess(p);
                break;
            }
            case "disconnect": {
                const p = getOrg().projects.find((x) => x.id === q.projectId);
                if (!p?.connections?.[q.teamId] || (p.teamId !== t.id && q.teamId !== t.id)) return json(404, { error: "That folder isn't connected." });
                delete p.connections[q.teamId];
                if (p.connectedAt) delete p.connectedAt[q.teamId];
                refreshAccess(p);
                break;
            }
            case "billingGroup": {
                if (q.delete) t.billingGroups = t.billingGroups.filter((g) => g.id !== q.id);
                else {
                    const members = (Array.isArray(q.members) ? q.members : []).filter((uid) => t.members[uid]);
                    // A person is in one billing group at most.
                    for (const g of t.billingGroups) if (g.id !== q.id) g.members = g.members.filter((uid) => !members.includes(uid));
                    const g = q.id ? t.billingGroups.find((x) => x.id === q.id) : null;
                    if (q.id && !g) return json(404, { error: "No such billing group." });
                    const name = str(q.name, 60);
                    if (g) {
                        if (name) g.name = name;
                        if (Array.isArray(q.members)) g.members = members;
                        if (q.manager !== undefined) g.manager = t.members[q.manager] ? q.manager : null;
                    } else {
                        if (!name) return json(400, { error: "Give the billing group a name." });
                        t.billingGroups.push({ id: id(), name, members, manager: t.members[q.manager] ? q.manager : null, createdAt: Date.now() });
                    }
                }
                break;
            }
            case "workspace": {
                if (q.delete) t.workspaces = t.workspaces.filter((w) => w.id !== q.id);
                else {
                    const folders = (Array.isArray(q.folders) ? q.folders : []).filter((pid) => getOrg().projects.some((p) => p.id === pid && p.teamId === t.id));
                    const admins = (Array.isArray(q.admins) ? q.admins : []).filter((uid) => t.members[uid]);
                    const w = q.id ? t.workspaces.find((x) => x.id === q.id) : null;
                    if (q.id && !w) return json(404, { error: "No such workspace." });
                    const name = str(q.name, 60);
                    if (w) {
                        if (name) w.name = name;
                        if (Array.isArray(q.folders)) w.folders = folders;
                        if (Array.isArray(q.admins)) w.admins = admins;
                        if (typeof q.description === "string") w.description = str(q.description, 300);
                    } else {
                        if (!name) return json(400, { error: "Give the workspace a name." });
                        t.workspaces.push({ id: id(), name, description: str(q.description, 300), folders, admins, createdAt: Date.now() });
                    }
                }
                for (const room of rooms.values()) if (room.file) applyRoleChanges(room);
                break;
            }
            case "group": {
                if (q.delete) t.groups = t.groups.filter((g) => g.id !== q.id);
                else if (q.id) {
                    const g = t.groups.find((x) => x.id === q.id);
                    if (!g) return json(404, { error: "No such group." });
                    if (typeof q.name === "string" && q.name.trim()) g.name = str(q.name, 60);
                    if (Array.isArray(q.members)) g.members = q.members.filter((uid) => t.members[uid]);
                } else {
                    const name = str(q.name, 60);
                    if (!name) return json(400, { error: "Give the group a name." });
                    t.groups.push({ id: id(), name, members: (Array.isArray(q.members) ? q.members : []).filter((uid) => t.members[uid]), createdAt: Date.now() });
                }
                break;
            }
            case "drafts": {
                const entry = t.unassigned.find((x) => x.id === q.id);
                if (!entry) return json(404, { error: "Those drafts were already handled." });
                if (q.action === "delete") {
                    for (const fid of entry.fileIds) await removeFile(fid);
                } else {
                    const project = getOrg().projects.find((p) => p.id === q.project && p.teamId === t.id);
                    if (!project) return json(400, { error: "Pick one of the team's folders." });
                    for (const fid of entry.fileIds) {
                        const room = await loadRoom(fid);
                        if (!room.file) continue;
                        room.file.project = project.id;
                        room.file.owner = user.id;
                        delete room.file.unassignedFrom;
                        scheduleSave(room);
                        await writeMeta(fid, { project: project.id });
                        applyRoleChanges(room);
                    }
                }
                t.unassigned = t.unassigned.filter((x) => x.id !== entry.id);
                break;
            }
            case "registry": {
                const tokens = q.tokens;
                if (!tokens || typeof tokens !== "object") return json(400, { error: "Nothing to publish." });
                if (typeof q.name === "string" && /^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(q.name)) t.registry.name = q.name;
                const last = t.registry.versions[0]?.version ?? "0.0.0";
                const [maj, min, pat] = last.split(".").map(Number);
                const bump = q.bump === "major" ? `${maj + 1}.0.0` : q.bump === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
                const version = t.registry.versions.length ? bump : "1.0.0";
                t.registry.versions.unshift({ version, at: Date.now(), by: publicUser(user), source: str(q.source, 120), notes: str(q.notes, 500), counts: { colors: num(q.counts?.colors, 0, 1e6, 0), texts: num(q.counts?.texts, 0, 1e6, 0), variables: num(q.counts?.variables, 0, 1e6, 0) }, tokens });
                if (t.registry.versions.length > 50) t.registry.versions.length = 50;
                break;
            }
            default:
                return json(404, { error: "Not found." });
        }
        ensure(t);
        saveOrg();
        return json(200, adminView(t, user));
    }

    function decide(t, r, status, by) {
        r.status = status;
        r.decidedAt = Date.now();
        r.decidedBy = by;
        if (status === "approved" && r.kind === "seat" && t.members[r.userId]) t.seats[r.userId] = r.seat;
        ensure(t);
    }

    // ---- Templates: copies of files the team starts new files from ----

    async function templateList(t) {
        const out = [];
        for (const tp of t.templates) {
            const meta = await readMeta(tp.fileId);
            out.push({ ...tp, thumb: meta.thumb ?? null, createdBy: publicUser(userById(tp.createdBy)) });
        }
        return out;
    }

    async function serveTemplates(req, res, t, user, role, a, b, json, body) {
        if (!a && req.method === "GET") return json(200, await templateList(t));
        if (!a && req.method === "POST") {
            if (role === "view") return json(403, { error: "Viewers can't create templates." });
            const q = await body(32 * 1024 * 1024);
            let doc = null;
            let kind = typeof q.kind === "string" ? q.kind.slice(0, 20) : "design";
            let thumb = null;
            if (typeof q.fileId === "string") {
                const room = await loadRoom(q.fileId);
                if (!room.file?.doc || !ctx.roleFor(room.file, user, typeof q.key === "string" ? q.key : "")) return json(403, { error: "You can't make a template from that file." });
                doc = JSON.parse(JSON.stringify(room.file.doc));
                const meta = await readMeta(q.fileId);
                kind = meta.kind ?? kind;
                thumb = meta.thumb ?? null;
            } else if (q.doc?.nodes) doc = q.doc;
            if (!doc) return json(400, { error: "Pick a file for the template." });
            const name = str(q.name, 120) || doc.name || "Untitled template";
            doc.name = name;
            const made = await makeFile(user, doc, null, kind, { template: t.id, link: "none" });
            if (thumb) await writeMeta(made.id, { thumb });
            const tp = { id: id(), name, description: str(q.description, 300), kind, fileId: made.id, createdBy: user.id, createdAt: Date.now(), uses: 0 };
            t.templates.unshift(tp);
            saveOrg();
            return json(200, await templateList(t));
        }
        const tp = t.templates.find((x) => x.id === a);
        if (!tp) return json(404, { error: "No such template." });
        if (b === "use" && req.method === "POST") {
            const q = await body();
            const room = await loadRoom(tp.fileId);
            if (!room.file?.doc) return json(404, { error: "The template's file is missing." });
            const project = typeof q.project === "string" ? getOrg().projects.find((p) => p.id === q.project) : null;
            if (project && !["admin", "edit"].includes(teamRole(teamById(project.teamId), user) ?? "")) return json(403, { error: "You can't add files to that project." });
            const doc = JSON.parse(JSON.stringify(room.file.doc));
            doc.name = tp.name;
            const made = await makeFile(user, doc, project?.id ?? null, tp.kind);
            const meta = await readMeta(tp.fileId);
            if (meta.thumb) await writeMeta(made.id, { thumb: meta.thumb });
            tp.uses = (tp.uses ?? 0) + 1;
            saveOrg();
            return json(200, { id: made.id, keys: made.file.keys, name: doc.name, kind: tp.kind });
        }
        if (!b && req.method === "PUT") {
            if (role !== "admin" && tp.createdBy !== user.id) return json(403, { error: "Only admins or the template's creator can change it." });
            const q = await body();
            if (typeof q.name === "string" && q.name.trim()) tp.name = str(q.name, 120);
            if (typeof q.description === "string") tp.description = str(q.description, 300);
            saveOrg();
            return json(200, await templateList(t));
        }
        if (!b && req.method === "DELETE") {
            if (role !== "admin" && tp.createdBy !== user.id) return json(403, { error: "Only admins or the template's creator can delete it." });
            t.templates = t.templates.filter((x) => x.id !== tp.id);
            await removeFile(tp.fileId);
            saveOrg();
            return json(200, await templateList(t));
        }
        return json(405, { error: "Method not allowed." });
    }

    return { serve, onMemberRemoved, noteJoined, noteActive, ensure };
}

