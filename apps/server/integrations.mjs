// Team integrations, kept in data/integrations.json by team id:
// - Slack and Teams incoming webhooks a team admin pastes (one per channel). Inspect status changes
//   sent with the "Slack or Teams" channel are posted to them. The addresses are secrets: they are
//   stored here and never sent back in full.
// - Inspect settings: who on the team may use Inspect, the code language Inspect starts with, and
//   which plugins may run there. The editor reads them for a file through /files/<id>/team-settings.
// - Code Connect: repository reads on GitHub with the server's own token (/code-connect/github).
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseObject } from "./json-body.mjs";
import { saveLater } from "./atomic-write.mjs";

const HOOK_HOSTS = /^https:\/\/(hooks\.slack\.com|[a-z0-9-]+\.webhook\.office\.com|[a-z0-9.-]+\.logic\.azure\.com)\//i;
const ACCESS = new Set(["everyone", "edit", "admins"]);
const LANGUAGES = new Set(["css", "tailwind", "swiftui", "uikit", "compose", "xml", "react", "html"]);
const MAX_HOOKS = 10;

const DEFAULT_INSPECT = { access: "everyone", defaultLanguage: "css", pluginAllowlist: null };

export function createIntegrations({ DATA, teamById, teamRole, projectById, userFromReq, loadRoom, roleFor, readBody, CORS, postChat }) {
    const PATH = join(DATA, "integrations.json");
    let store = { teams: {} };
    let loaded = false;
    let timer = null;

    async function load() {
        if (loaded) return;
        loaded = true;
        try {
            store = JSON.parse(await readFile(PATH, "utf8"));
            if (!store.teams || typeof store.teams !== "object") store = { teams: {} };
        } catch {
            store = { teams: {} };
        }
    }

    function save() {
        clearTimeout(timer);
        timer = setTimeout(() => saveLater(PATH, JSON.stringify(store)), 200);
    }

    const entry = (teamId) => (store.teams[teamId] ??= { hooks: [], inspect: { ...DEFAULT_INSPECT } });
    const inspectOf = (teamId) => ({ ...DEFAULT_INSPECT, ...(store.teams[teamId]?.inspect ?? {}) });
    // A hook as people see it: the service, the label and where it points, without the secret path.
    const publicHook = (h) => ({ id: h.id, service: h.service, label: h.label, host: new URL(h.url).host, hint: h.url.slice(-4), addedAt: h.addedAt });

    function teamOfFile(file) {
        const project = file?.project ? projectById(file.project) : null;
        return project ? teamById(project.teamId) : null;
    }

    function mayInspect(settings, team, user, fileRole) {
        if (settings.access === "everyone") return true;
        const role = teamRole(team, user);
        if (settings.access === "admins") return role === "admin";
        return role === "admin" || role === "edit" || fileRole === "edit";
    }

    // Posts an Inspect status notice to the webhooks of the file's team.
    async function notifyStatus(file, text) {
        await load();
        const team = teamOfFile(file);
        if (!team) return;
        const name = file.doc?.name ?? "Untitled";
        const origin = (process.env.NAGMA_PUBLIC_URL ?? "").replace(/\/$/, "");
        for (const hook of store.teams[team.id]?.hooks ?? []) await postChat(hook.url, `${name}: ${text}${origin ? `\n${origin}` : ""}`);
    }

    // Code Connect from a repository: signed-in people read a GitHub repository's tree and files
    // through the server with the server's token (GITHUB_TOKEN in the environment), so the token never
    // reaches browsers. Only repository reads are passed on.
    async function serveGithub(req, res, url, user) {
        const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
        if (!user) return json(401, { error: "Sign in first." });
        if (req.method !== "GET") return json(405, { error: "Not allowed." });
        const path = url.searchParams.get("path") ?? "";
        if (!/^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/(git\/trees\/[A-Za-z0-9_./-]+|contents\/[^?#]*))?$/.test(path) || path.includes("..")) return json(400, { error: "Only repository reads are allowed." });
        const token = process.env.GITHUB_TOKEN ?? process.env.NAGMA_GITHUB_TOKEN ?? "";
        if (!token) return json(501, { error: "The server has no GitHub token. Paste one for this session instead." });
        const query = url.searchParams.get("recursive") ? "?recursive=1" : url.searchParams.get("ref") ? `?ref=${encodeURIComponent(url.searchParams.get("ref"))}` : "";
        try {
            const upstream = await fetch(`https://api.github.com${path}${query}`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "nagma-code-connect" } });
            const body = await upstream.text();
            res.writeHead(upstream.status, { ...CORS, "content-type": "application/json" }).end(body);
            return true;
        } catch {
            return json(502, { error: "Couldn't reach GitHub." });
        }
    }

    async function serve(req, res) {
        const url = new URL(req.url ?? "/", "http://local");
        const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body)), true);
        await load();
        const user = userFromReq(req);
        if (url.pathname === "/code-connect/github") return serveGithub(req, res, url, user);

        const forFile = /^\/files\/([A-Za-z0-9_-]{6,64})\/team-settings$/.exec(url.pathname);
        if (forFile) {
            if (req.method !== "GET") return json(405, { error: "Not allowed." });
            const room = await loadRoom(forFile[1]);
            if (!room.file) return json(404, { error: "No such file." });
            const role = roleFor(room.file, user, url.searchParams.get("key") ?? "");
            if (!role) return json(403, { error: "No access." });
            const team = teamOfFile(room.file);
            if (!team) return json(200, { teamId: null, inspect: DEFAULT_INSPECT, canInspect: true, chat: false });
            const inspect = inspectOf(team.id);
            return json(200, { teamId: team.id, inspect, canInspect: mayInspect(inspect, team, user, role), chat: (store.teams[team.id]?.hooks ?? []).length > 0 });
        }

        const forTeam = /^\/teams\/([A-Za-z0-9_-]+)\/integrations$/.exec(url.pathname);
        if (!forTeam) return false;
        const team = teamById(forTeam[1]);
        if (!team) return json(404, { error: "No such team." });
        const role = teamRole(team, user);
        if (!role) return json(403, { error: "Only people on the team can see its integrations." });
        const view = () => ({ hooks: (store.teams[team.id]?.hooks ?? []).map(publicHook), inspect: inspectOf(team.id), admin: role === "admin" });
        if (req.method === "GET") return json(200, view());
        if (req.method !== "PUT") return json(405, { error: "Not allowed." });
        if (role !== "admin") return json(403, { error: "Only team admins can change integrations." });
        let body = {};
        try {
            body = parseObject(await readBody(req, 32 * 1024));
        } catch {
            return json(400, { error: "Bad request." });
        }
        const e = entry(team.id);
        if (body.addHook) {
            const hookUrl = String(body.addHook.url ?? "").trim();
            const service = body.addHook.service === "teams" ? "teams" : "slack";
            if (!HOOK_HOSTS.test(hookUrl)) return json(400, { error: "Use a Slack or Teams incoming webhook address." });
            if (e.hooks.length >= MAX_HOOKS) return json(400, { error: `A team can connect up to ${MAX_HOOKS} channels.` });
            e.hooks.push({ id: randomBytes(6).toString("base64url"), service, url: hookUrl.slice(0, 500), label: String(body.addHook.label ?? "").trim().slice(0, 60) || (service === "teams" ? "Teams channel" : "Slack channel"), addedBy: user.id, addedAt: Date.now() });
        }
        if (typeof body.removeHook === "string") e.hooks = e.hooks.filter((h) => h.id !== body.removeHook);
        if (typeof body.testHook === "string") {
            const hook = e.hooks.find((h) => h.id === body.testHook);
            if (!hook) return json(404, { error: "No such channel." });
            await postChat(hook.url, `Nagma is connected. Inspect status changes for ${team.name} will be posted here.`);
        }
        if (body.inspect && typeof body.inspect === "object") {
            const next = { ...inspectOf(team.id) };
            if (ACCESS.has(body.inspect.access)) next.access = body.inspect.access;
            if (LANGUAGES.has(body.inspect.defaultLanguage)) next.defaultLanguage = body.inspect.defaultLanguage;
            if (body.inspect.pluginAllowlist === null) next.pluginAllowlist = null;
            else if (Array.isArray(body.inspect.pluginAllowlist)) next.pluginAllowlist = body.inspect.pluginAllowlist.map((p) => String(p).trim().slice(0, 120)).filter(Boolean).slice(0, 100);
            e.inspect = next;
        }
        save();
        return json(200, view());
    }

    return { serve, notifyStatus };
}
