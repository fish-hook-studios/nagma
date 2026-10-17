// Personal access tokens (read-only, revocable), teams (roles, invites by email and by link, the
// admin console), folders, and server admins (NAGMA_ADMINS) claiming files from before accounts.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { call, connect, createFile, sampleDoc, signUp, startServer } from "./helpers.mjs";

describe("personal access tokens", () => {
    let server, a, b, file, other, pat, patId;
    before(async () => {
        server = await startServer();
        a = await signUp(server, "Token owner");
        b = await signUp(server, "Someone else");
        file = await createFile(server, a.token, { doc: sampleDoc("Readable") });
        other = await createFile(server, b.token, { doc: sampleDoc("Not yours") });
        await call(server, "PUT", `/files/${other.id}/access`, { token: b.token, body: { link: "none" } });
        const r = await call(server, "POST", "/account/tokens", { token: a.token, body: { name: "CLI" } });
        assert.equal(r.status, 200);
        pat = r.body.token;
        patId = r.body.record.id;
    });
    after(async () => server?.stop());

    test("tokens are shown once, listed by hint only, and need a session to make", async () => {
        assert.ok(pat.startsWith("nagma_pat_"));
        const list = await call(server, "GET", "/account/tokens", { token: a.token });
        assert.equal(list.body.tokens.length, 1);
        assert.ok(!JSON.stringify(list.body).includes(pat));
        assert.equal(list.body.tokens[0].hint, pat.slice(-4));
        assert.deepEqual(list.body.tokens[0].scopes, ["files:read"]);
        assert.equal((await call(server, "POST", "/account/tokens", { body: { name: "x" } })).status, 401);
        // A token can't make more tokens (or list them).
        assert.equal((await call(server, "POST", "/account/tokens", { token: pat, body: { name: "x" } })).status, 401);
        assert.equal((await call(server, "GET", "/account/tokens", { token: pat })).status, 401);
        assert.equal((await call(server, "POST", "/account/tokens", { token: a.token, body: { name: "" } })).status, 400);
        const neg = await call(server, "POST", "/account/tokens", { token: a.token, body: { name: "neg", expiresInDays: -5 } });
        assert.equal(neg.body.record.expiresAt, null);
        await call(server, "DELETE", `/account/tokens/${neg.body.record.id}`, { token: a.token });
    });

    test("tokens read: /v1/me, /v1/files, a file, its nodes; only files the owner can open", async () => {
        const me = await call(server, "GET", "/v1/me", { token: pat });
        assert.equal(me.status, 200);
        assert.equal(me.body.user.id, a.user.id);
        const viaHeader = await call(server, "GET", "/v1/me", { headers: { "x-nagma-token": pat } });
        assert.equal(viaHeader.status, 200);
        const files = await call(server, "GET", "/v1/files", { token: pat });
        assert.ok(files.body.files.some((f) => f.id === file.id));
        assert.ok(!files.body.files.some((f) => f.id === other.id));
        assert.ok(!JSON.stringify(files.body).includes(file.keys.edit));
        const doc = await call(server, "GET", `/v1/files/${file.id}`, { token: pat });
        assert.equal(doc.body.document.nodes.text1.text, "hello world");
        const nodes = await call(server, "GET", `/v1/files/${file.id}/nodes?ids=rect1,nope`, { token: pat });
        assert.equal(nodes.body.nodes.rect1.root, "rect1");
        assert.equal(nodes.body.nodes.nope, null);
        assert.equal((await call(server, "GET", `/v1/files/${other.id}`, { token: pat })).status, 403);
        assert.equal((await call(server, "GET", "/v1/files/nosuchfile1", { token: pat })).status, 404);
        // Sessions aren't tokens.
        assert.equal((await call(server, "GET", "/v1/me", { token: a.token })).status, 401);
        assert.equal((await call(server, "GET", "/v1/me", { token: "nagma_pat_forged" })).status, 401);
    });

    test("tokens can't write anything, anywhere", async () => {
        for (const [method, path] of [["POST", "/v1/files"], ["PUT", `/v1/files/${file.id}`], ["DELETE", `/v1/files/${file.id}`], ["PATCH", "/v1/me"]]) {
            assert.equal((await call(server, method, path, { token: pat, body: {} })).status, 405, `${method} ${path}`);
        }
        const writes = [
            ["POST", "/files", { doc: sampleDoc() }],
            ["PUT", `/files/${file.id}/meta`, { name: "via token" }],
            ["DELETE", `/files/${file.id}/meta`],
            ["PUT", `/files/${file.id}/access`, { link: "edit" }],
            ["DELETE", `/files/${file.id}/forever`],
            ["POST", `/files/${file.id}/duplicate`],
            ["POST", "/teams", { name: "token team" }],
            ["PUT", "/account", { name: "renamed" }],
            ["POST", "/auth/password", { current: a.password, password: "newpassword1" }],
            ["DELETE", "/auth/sessions"],
        ];
        for (const [method, path, body] of writes) {
            const r = await call(server, method, path, { token: pat, body });
            assert.ok([401, 403].includes(r.status), `${method} ${path}: ${r.status}`);
        }
        assert.equal((await call(server, "GET", `/files/${file.id}/doc`, { token: a.token })).body.name, "Readable");
        assert.equal((await call(server, "GET", "/auth/me", { token: a.token })).body.name, "Token owner");
        // Nor over the socket.
        await call(server, "PUT", `/files/${file.id}/access`, { token: a.token, body: { link: "none" } });
        const s = await connect(server, file.id, { token: pat });
        assert.equal(s.first.type, "denied");
    });

    test("revoked tokens stop working at once; only the owner can revoke", async () => {
        const r = await call(server, "POST", "/account/tokens", { token: a.token, body: { name: "short-lived" } });
        const t2 = r.body.token;
        assert.equal((await call(server, "GET", "/v1/me", { token: t2 })).status, 200);
        assert.equal((await call(server, "DELETE", `/account/tokens/${r.body.record.id}`, { token: b.token })).status, 404);
        assert.equal((await call(server, "GET", "/v1/me", { token: t2 })).status, 200);
        assert.equal((await call(server, "DELETE", `/account/tokens/${r.body.record.id}`, { token: a.token })).status, 200);
        assert.equal((await call(server, "GET", "/v1/me", { token: t2 })).status, 401);
        assert.equal((await call(server, "DELETE", `/account/tokens/${r.body.record.id}`, { token: a.token })).status, 404);
        // The other token is unaffected.
        assert.equal((await call(server, "GET", "/v1/me", { token: pat })).status, 200);
        await call(server, "DELETE", `/account/tokens/${patId}`, { token: a.token });
        assert.equal((await call(server, "GET", "/v1/files", { token: pat })).status, 401);
    });

    test("a token stops reading files its owner loses access to", async () => {
        const shared = await createFile(server, b.token);
        await call(server, "PUT", `/files/${shared.id}/access`, { token: b.token, body: { invite: { email: a.email, role: "view" }, link: "none" } });
        const t = (await call(server, "POST", "/account/tokens", { token: a.token, body: { name: "reader" } })).body.token;
        assert.equal((await call(server, "GET", `/v1/files/${shared.id}`, { token: t })).status, 200);
        await call(server, "PUT", `/files/${shared.id}/access`, { token: b.token, body: { remove: a.user.id } });
        assert.equal((await call(server, "GET", `/v1/files/${shared.id}`, { token: t })).status, 403);
    });
});

describe("teams, invites and the admin console", () => {
    let server, admin, member, outsider;
    before(async () => {
        server = await startServer();
        admin = await signUp(server, "Team admin");
        member = await signUp(server, "Member");
        outsider = await signUp(server, "Outsider");
    });
    after(async () => server?.stop());

    async function newTeam(name = "Team") {
        const r = await call(server, "POST", "/teams", { token: admin.token, body: { name } });
        assert.equal(r.status, 200);
        return r.body;
    }

    test("making a team: needs an account and a name; the maker is its admin; only members see it", async () => {
        assert.equal((await call(server, "POST", "/teams", { body: { name: "x" } })).status, 401);
        assert.equal((await call(server, "POST", "/teams", { token: admin.token, body: { name: "  " } })).status, 400);
        const t = await newTeam("Visible");
        assert.equal(t.role, "admin");
        assert.ok((await call(server, "GET", "/teams", { token: admin.token })).body.some((x) => x.id === t.id));
        assert.ok(!(await call(server, "GET", "/teams", { token: outsider.token })).body.some((x) => x.id === t.id));
        assert.equal((await call(server, "GET", `/teams/${t.id}`, { token: outsider.token })).status, 404);
        assert.equal((await call(server, "PUT", `/teams/${t.id}`, { token: outsider.token, body: { name: "Mine now" } })).status, 404);
        assert.equal((await call(server, "DELETE", `/teams/${t.id}`, { token: outsider.token })).status, 404);
    });

    test("only admins rename, invite, change roles, remove and delete", async () => {
        const t = await newTeam("Roles");
        const add = await call(server, "PUT", `/teams/${t.id}`, { token: admin.token, body: { invite: { email: member.email, role: "view" } } });
        assert.equal(add.status, 200);
        assert.equal(add.body.members.find((m) => m.id === member.user.id).role, "view");
        assert.equal((await call(server, "PUT", `/teams/${t.id}`, { token: admin.token, body: { invite: { email: "no-account@example.com" } } })).status, 404);
        for (const body of [{ name: "Renamed" }, { invite: { email: outsider.email, role: "admin" } }, { role: { userId: member.user.id, role: "admin" } }, { remove: admin.user.id }]) {
            assert.equal((await call(server, "PUT", `/teams/${t.id}`, { token: member.token, body })).status, 403, JSON.stringify(body));
        }
        assert.equal((await call(server, "DELETE", `/teams/${t.id}`, { token: member.token })).status, 403);
        const after = await call(server, "GET", `/teams/${t.id}`, { token: admin.token });
        assert.equal(after.body.name, "Roles");
        assert.equal(after.body.members.length, 2);
        // A viewer can't make folders; an editor can.
        assert.equal((await call(server, "POST", `/teams/${t.id}/projects`, { token: member.token, body: { name: "f" } })).status, 403);
        await call(server, "PUT", `/teams/${t.id}`, { token: admin.token, body: { role: { userId: member.user.id, role: "edit" } } });
        assert.equal((await call(server, "POST", `/teams/${t.id}/projects`, { token: member.token, body: { name: "f" } })).status, 200);
        // Roles outside admin/edit/view are ignored.
        await call(server, "PUT", `/teams/${t.id}`, { token: admin.token, body: { role: { userId: member.user.id, role: "owner" } } });
        assert.equal((await call(server, "GET", `/teams/${t.id}`, { token: admin.token })).body.members.find((m) => m.id === member.user.id).role, "edit");
    });

    test("files in a team folder follow team roles; removed members lose access at once", async () => {
        const t = await newTeam("Files");
        await call(server, "PUT", `/teams/${t.id}`, { token: admin.token, body: { invite: { email: member.email, role: "view" } } });
        const folder = (await call(server, "POST", `/teams/${t.id}/projects`, { token: admin.token, body: { name: "Shared" } })).body.created;
        const f = await createFile(server, admin.token, { project: folder });
        assert.equal((await call(server, "GET", `/files/${f.id}/access`, { token: member.token })).body.you, "view");
        assert.equal((await call(server, "GET", `/files/${f.id}/doc`, { token: outsider.token })).status, 403);
        // Members who aren't editors can't add files there.
        assert.equal((await call(server, "POST", "/files", { token: member.token, body: { doc: sampleDoc(), project: folder } })).status, 403);
        const sock = await connect(server, f.id, { token: member.token });
        assert.equal(sock.first.role, "view");
        await call(server, "PUT", `/teams/${t.id}`, { token: admin.token, body: { remove: member.user.id } });
        await sock.next("denied");
        assert.equal((await call(server, "GET", `/files/${f.id}/doc`, { token: member.token })).status, 403);
    });

    test("invite links: admins make and revoke them; anyone signed in can join with one, never as admin", async () => {
        const t = await newTeam("Linked");
        await call(server, "PUT", `/teams/${t.id}`, { token: admin.token, body: { invite: { email: member.email, role: "edit" } } });
        assert.equal((await call(server, "POST", `/teams/${t.id}/invites`, { token: member.token, body: { role: "edit" } })).status, 403);
        assert.equal((await call(server, "GET", `/teams/${t.id}/invites`, { token: member.token })).status, 403);
        const link = await call(server, "POST", `/teams/${t.id}/invites`, { token: admin.token, body: { role: "admin" } });
        assert.equal(link.body.role, "edit");
        const token = link.body.token;
        const info = await call(server, "GET", `/invites/${token}`);
        assert.equal(info.status, 200);
        assert.equal(info.body.team, "Linked");
        assert.equal((await call(server, "POST", `/invites/${token}/accept`)).status, 401);
        const joined = await call(server, "POST", `/invites/${token}/accept`, { token: outsider.token });
        assert.equal(joined.status, 200);
        assert.equal(joined.body.role, "edit");
        // Accepting doesn't lower an admin.
        await call(server, "POST", `/invites/${token}/accept`, { token: admin.token });
        assert.equal((await call(server, "GET", `/teams/${t.id}`, { token: admin.token })).body.role, "admin");
        // Revoked: gone for everyone.
        assert.equal((await call(server, "DELETE", `/teams/${t.id}/invites/${token}`, { token: admin.token })).status, 200);
        assert.equal((await call(server, "GET", `/invites/${token}`)).status, 404);
        const late = await signUp(server, "Late");
        assert.equal((await call(server, "POST", `/invites/${token}/accept`, { token: late.token })).status, 404);
        assert.equal((await call(server, "GET", `/teams/${t.id}`, { token: late.token })).status, 404);
        assert.equal((await call(server, "POST", "/invites/notarealtoken/accept", { token: late.token })).status, 404);
    });

    // Regression: invite tokens were looked up as plain object keys, so /invites/toString (or
    // constructor, __proto__...) matched every team with invite links: anyone could read a team's
    // name and size, and accepting wrote junk members (and a "uses" counter onto Object.prototype).
    test("invite tokens that are names of Object.prototype properties match nothing", async () => {
        const t = await newTeam("Secret team name");
        await call(server, "POST", `/teams/${t.id}/invites`, { token: admin.token, body: { role: "view" } });
        for (const token of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "__defineGetter__"]) {
            const info = await call(server, "GET", `/invites/${token}`);
            assert.equal(info.status, 404, token);
            assert.ok(!info.text.includes("Secret team name"), token);
            const accept = await call(server, "POST", `/invites/${token}/accept`, { token: outsider.token });
            assert.equal(accept.status, 404, token);
        }
        const team = await call(server, "GET", `/teams/${t.id}`, { token: admin.token });
        assert.deepEqual(team.body.members.map((m) => m.id), [admin.user.id]);
        assert.equal(({}).uses, undefined);
        assert.equal((await call(server, "GET", `/teams/${t.id}`, { token: outsider.token })).status, 404);
    });

    test("leaving: the last admin of a team with others can't; others can", async () => {
        const t = await newTeam("Leavers");
        await call(server, "PUT", `/teams/${t.id}`, { token: admin.token, body: { invite: { email: member.email, role: "edit" } } });
        assert.equal((await call(server, "POST", `/teams/${t.id}/leave`, { token: admin.token })).status, 400);
        assert.equal((await call(server, "POST", `/teams/${t.id}/leave`, { token: outsider.token })).status, 404);
        assert.equal((await call(server, "POST", `/teams/${t.id}/leave`, { token: member.token })).status, 200);
        assert.equal((await call(server, "GET", `/teams/${t.id}`, { token: member.token })).status, 404);
    });

    test("admin console: members get their own view; admin actions need an admin", async () => {
        const t = await newTeam("Console");
        await call(server, "PUT", `/teams/${t.id}`, { token: admin.token, body: { invite: { email: member.email, role: "edit" } } });
        assert.equal((await call(server, "GET", `/teams/${t.id}/admin`)).status, 401);
        assert.equal((await call(server, "GET", `/teams/${t.id}/admin`, { token: outsider.token })).status, 404);
        const mine = await call(server, "GET", `/teams/${t.id}/admin`, { token: member.token });
        assert.equal(mine.body.isAdmin, false);
        assert.equal(mine.body.people, undefined);
        assert.equal(mine.body.billing, undefined);
        const full = await call(server, "GET", `/teams/${t.id}/admin`, { token: admin.token });
        assert.equal(full.body.isAdmin, true);
        assert.equal(full.body.people.length, 2);
        for (const [a, body] of [["role", { userId: member.user.id, role: "admin" }], ["seat", { userId: member.user.id, seat: "view" }], ["remove", { userId: admin.user.id }], ["settings", { settings: { make: false } }], ["billing", { plan: "Free" }], ["invite", { emails: outsider.email }], ["group", { name: "g" }]]) {
            assert.equal((await call(server, "POST", `/teams/${t.id}/admin/${a}`, { token: member.token, body })).status, 403, a);
        }
        assert.equal((await call(server, "GET", `/teams/${t.id}/admin/invoices`, { token: member.token })).status, 403);
        assert.equal((await call(server, "GET", `/teams/${t.id}/admin/files/${admin.user.id}`, { token: member.token })).status, 403);
        // Members may ask for things, once at a time.
        assert.equal((await call(server, "POST", `/teams/${t.id}/admin/requests`, { token: member.token, body: { kind: "seat", seat: "dev" } })).status, 200);
        assert.equal((await call(server, "POST", `/teams/${t.id}/admin/requests`, { token: member.token, body: { kind: "seat", seat: "dev" } })).status, 400);
        // The last admin can't step down; promoting someone first works.
        assert.equal((await call(server, "POST", `/teams/${t.id}/admin/role`, { token: admin.token, body: { userId: admin.user.id, role: "edit" } })).status, 400);
        assert.equal((await call(server, "POST", `/teams/${t.id}/admin/role`, { token: admin.token, body: { userId: member.user.id, role: "admin" } })).status, 200);
        assert.equal((await call(server, "POST", `/teams/${t.id}/admin/role`, { token: admin.token, body: { userId: admin.user.id, role: "edit" } })).status, 200);
        assert.equal((await call(server, "GET", `/teams/${t.id}/admin`, { token: admin.token })).body.isAdmin, false);
        assert.equal((await call(server, "POST", `/teams/${t.id}/admin/role`, { token: admin.token, body: { userId: admin.user.id, role: "admin" } })).status, 403);
        // Bad input is refused, not stored.
        assert.equal((await call(server, "POST", `/teams/${t.id}/admin/role`, { token: member.token, body: { userId: outsider.user.id, role: "admin" } })).status, 400);
        assert.equal((await call(server, "POST", `/teams/${t.id}/admin/role`, { token: member.token, body: { userId: admin.user.id, role: "owner" } })).status, 400);
        assert.equal((await call(server, "POST", `/teams/${t.id}/admin/nonsense`, { token: member.token, body: {} })).status, 404);
    });

    test("team SAML settings and integrations are for admins", async () => {
        const t = await newTeam("Integrations");
        await call(server, "PUT", `/teams/${t.id}`, { token: admin.token, body: { invite: { email: member.email, role: "edit" } } });
        assert.equal((await call(server, "GET", `/teams/${t.id}/saml`, { token: member.token })).status, 403);
        assert.equal((await call(server, "PUT", `/teams/${t.id}/saml`, { token: member.token, body: { enabled: false } })).status, 403);
        assert.equal((await call(server, "GET", `/teams/${t.id}/saml`, { token: outsider.token })).status, 404);
        assert.equal((await call(server, "GET", `/teams/${t.id}/saml`, { token: admin.token })).status, 200);
        assert.equal((await call(server, "GET", `/teams/${t.id}/integrations`, { token: outsider.token })).status, 403);
        assert.equal((await call(server, "PUT", `/teams/${t.id}/integrations`, { token: member.token, body: { addHook: { url: "https://hooks.slack.com/services/x" } } })).status, 403);
        const bad = await call(server, "PUT", `/teams/${t.id}/integrations`, { token: admin.token, body: { addHook: { url: "https://169.254.169.254/latest/meta-data" } } });
        assert.equal(bad.status, 400);
        const ok = await call(server, "PUT", `/teams/${t.id}/integrations`, { token: admin.token, body: { addHook: { url: "https://hooks.slack.com/services/T0/B0/secretpart" } } });
        assert.equal(ok.status, 200);
        // The hook's secret path never comes back.
        const seen = await call(server, "GET", `/teams/${t.id}/integrations`, { token: member.token });
        assert.ok(!JSON.stringify(seen.body).includes("secretpart"));
    });

    test("folder invitations by email reach only that address's account", async () => {
        const t = await newTeam("Guests");
        const folder = (await call(server, "POST", `/teams/${t.id}/projects`, { token: admin.token, body: { name: "For a guest" } })).body.created;
        const f = await createFile(server, admin.token, { project: folder });
        const invited = `future${Date.now()}@example.com`;
        await call(server, "PUT", `/projects/${folder}`, { token: admin.token, body: { invite: { emails: invited, role: "view" } } });
        // Someone else can't get in.
        assert.equal((await call(server, "GET", `/files/${f.id}/doc`, { token: outsider.token })).status, 403);
        const wrong = await call(server, "POST", "/auth/signup", { body: { name: "Wrong", email: `not-${invited}`, password: "longenough1" } });
        assert.equal((await call(server, "GET", `/files/${f.id}/doc`, { token: wrong.body.token })).status, 403);
        // The right address gets view access when it signs up.
        const right = await call(server, "POST", "/auth/signup", { body: { name: "Right", email: invited, password: "longenough1" } });
        assert.equal((await call(server, "GET", `/files/${f.id}/doc`, { token: right.body.token })).status, 200);
        assert.equal((await call(server, "PUT", `/files/${f.id}/meta`, { token: right.body.token, body: { name: "x" } })).status, 403);
        // Folders can't be changed by people outside the team.
        assert.equal((await call(server, "PUT", `/projects/${folder}`, { token: outsider.token, body: { name: "Taken" } })).status, 404);
        assert.equal((await call(server, "DELETE", `/projects/${folder}`, { token: right.body.token })).status, 404);
    });
});

describe("server admins (NAGMA_ADMINS) and files from before accounts", () => {
    let server, legacyId, boss, first;
    before(async () => {
        server = await startServer({ NAGMA_ADMINS: "boss@example.com" });
        // With no accounts yet, a file can be made over the socket by anyone: it has no owner.
        legacyId = "legacyfile01";
        const s = await connect(server, legacyId, { initial: sampleDoc("From before accounts") });
        assert.equal(s.first.role, "edit");
        await s.close();
        first = await signUp(server, "First account");
        boss = (await call(server, "POST", "/auth/signup", { body: { name: "Boss", email: "boss@example.com", password: "longenough1" } })).body;
    });
    after(async () => server?.stop());

    test("ownerless files are read-only for everyone signed in, editable by the named admin only", async () => {
        const list = await call(server, "GET", "/files", { token: first.token });
        const row = list.body.find((f) => f.id === legacyId);
        assert.equal(row.role, "view");
        assert.equal(row.claimable, false);
        assert.equal(row.keys, null);
        assert.equal((await call(server, "PUT", `/files/${legacyId}/meta`, { token: first.token, body: { name: "mine" } })).status, 403);
        const bossRow = (await call(server, "GET", "/files", { token: boss.token })).body.find((f) => f.id === legacyId);
        assert.equal(bossRow.role, "edit");
        assert.equal(bossRow.claimable, true);
        // Signed out: nothing.
        assert.ok(!(await call(server, "GET", "/files")).body.some((f) => f.id === legacyId));
    });

    test("claiming: refused for others, done by the admin with new link keys", async () => {
        assert.equal((await call(server, "POST", `/files/${legacyId}/claim`)).status, 401);
        assert.equal((await call(server, "POST", `/files/${legacyId}/claim`, { token: first.token })).status, 403);
        const oldKeys = (await call(server, "GET", "/files", { token: boss.token })).body.find((f) => f.id === legacyId).keys;
        const r = await call(server, "POST", `/files/${legacyId}/claim`, { token: boss.token });
        assert.equal(r.status, 200);
        assert.notEqual(r.body.keys.edit, oldKeys?.edit);
        assert.equal((await call(server, "POST", `/files/${legacyId}/claim`, { token: boss.token })).status, 400);
        // Now it's the admin's: the first account can't see it any more.
        assert.ok(!(await call(server, "GET", "/files", { token: first.token })).body.some((f) => f.id === legacyId));
        if (oldKeys?.edit) assert.equal((await call(server, "GET", `/files/${legacyId}/doc?key=${oldKeys.edit}`)).status, 403);
    });

    test("with accounts on the server, a signed-out socket can't create a file", async () => {
        const s = await connect(server, "newfile0001", { initial: sampleDoc("Sneaky") });
        assert.equal(s.first.type, "denied");
        assert.equal((await call(server, "GET", "/files/newfile0001/doc", { token: boss.token })).status, 404);
    });
});
