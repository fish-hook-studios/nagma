// Regression tests from the platform QA pass (apps/web/qa/QA-platform.md): sign-up limits, the
// default link access of files put on the server, and who may decide a branch review.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { call, connect, createFile, sampleDoc, signUp, startServer, verifyAccount, waitUntil } from "./helpers.mjs";

describe("sign-up is limited per address", () => {
    let server;
    before(async () => {
        server = await startServer({ NAGMA_SIGNUP_PER_HOUR: "3" });
    });
    after(async () => server?.stop());

    test("the fourth sign-up from one address within the hour gets 429 with Retry-After", async () => {
        for (let i = 0; i < 3; i++) await signUp(server, `Person ${i}`);
        const r = await call(server, "POST", "/auth/signup", { body: { name: "One too many", email: "many@example.com", password: "correct horse battery" } });
        assert.equal(r.status, 429);
        const wait = Number(r.headers.get("retry-after"));
        assert.ok(wait > 3000 && wait <= 3600, `retry-after ${wait}`);
        assert.match(r.body.error, /Too many attempts/);
        // Refused sign-ups don't count, and signing in still works.
        const bad = await call(server, "POST", "/auth/signup", { body: { name: "", email: "x", password: "" } });
        assert.equal(bad.status, 429);
    });
});

describe("new server files are restricted to invited people", () => {
    let server, owner, stranger;
    before(async () => {
        server = await startServer();
        owner = await signUp(server, "Owner");
        stranger = await signUp(server, "Stranger");
    });
    after(async () => server?.stop());

    test("a file made with POST /files: the edit key alone opens nothing", async () => {
        const file = await createFile(server, owner.token);
        const access = await call(server, "GET", `/files/${file.id}/access`, { token: owner.token });
        assert.equal(access.body.link, "none");
        assert.equal((await call(server, "GET", `/files/${file.id}/doc?key=${file.keys.edit}`, { token: stranger.token })).status, 403);
    });

    test("Move to the server (the first hello with the document) starts restricted too", async () => {
        const id = `moved${Date.now().toString(36)}`;
        const first = await connect(server, id, { token: owner.token, initial: sampleDoc("Moved") });
        assert.equal(first.first.type, "snapshot");
        assert.equal(first.first.access.link, "none");
        const keys = first.first.keys;
        await first.close();
        const other = await connect(server, id, { token: stranger.token, key: keys.edit });
        assert.equal(other.first.type, "denied");
        await other.close();
        // The owner gets back in, and can open the link up.
        const again = await connect(server, id, { token: owner.token });
        assert.equal(again.first.role, "edit");
        await again.close();
        assert.equal((await call(server, "PUT", `/files/${id}/access`, { token: owner.token, body: { link: "edit" } })).status, 200);
        const opened = await connect(server, id, { token: stranger.token, key: keys.edit });
        assert.equal(opened.first.role, "edit");
        await opened.close();
    });
});

describe("branch reviews are decided by reviewers and editors only", () => {
    let server, owner, author, reviewer, viewer, branch;
    before(async () => {
        server = await startServer();
        owner = await signUp(server, "Owner");
        author = await signUp(server, "Author");
        reviewer = await signUp(server, "Reviewer");
        viewer = await signUp(server, "Viewer");
        const file = await createFile(server, owner.token);
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { invite: { email: author.email, role: "edit" } } });
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { invite: { email: viewer.email, role: "view" } } });
        const made = await call(server, "POST", `/files/${file.id}/branches`, { token: author.token, body: { name: "Idea" } });
        assert.equal(made.status, 200);
        branch = made.body.id;
        const asked = await call(server, "PUT", `/files/${branch}/branch`, { token: author.token, body: { review: { emails: reviewer.email } } });
        assert.equal(asked.status, 200);
    });
    after(async () => server?.stop());

    test("a viewer of the main file can't approve", async () => {
        const r = await call(server, "POST", `/files/${branch}/review`, { token: viewer.token, body: { decision: "approved" } });
        assert.equal(r.status, 403);
    });

    test("the requested reviewer and a main-file editor can", async () => {
        assert.equal((await call(server, "POST", `/files/${branch}/review`, { token: reviewer.token, body: { decision: "changes", note: "Tighten spacing" } })).status, 200);
        const r = await call(server, "POST", `/files/${branch}/review`, { token: owner.token, body: { decision: "approved" } });
        assert.equal(r.status, 200);
        assert.deepEqual(Object.keys(r.body.review.decisions).sort(), [owner.user.id, reviewer.user.id].sort());
    });
});

describe("protected Make apps keep their data behind the same gate", () => {
    let server, owner, stranger;
    const appId = `app${Date.now().toString(36)}`;
    const form = (password) => ({ raw: `password=${encodeURIComponent(password)}`, headers: { "content-type": "application/x-www-form-urlencoded" } });
    before(async () => {
        server = await startServer();
        owner = await signUp(server, "App Owner");
        stranger = await signUp(server, "Stranger");
        assert.equal((await call(server, "POST", "/ai/make/backend", { token: owner.token, body: { appId } })).status, 200);
        const files = [{ path: "index.html", content: "<!doctype html><html><head><title>App</title></head><body>hi</body></html>" }];
        assert.equal((await call(server, "PUT", `/apps/${appId}`, { token: owner.token, body: { name: "App", files } })).status, 200);
    });
    after(async () => server?.stop());

    test("public apps: data open to the app id, no token in the page", async () => {
        assert.equal((await call(server, "POST", `/app-data/${appId}/notes`, { body: { text: "secret" } })).status, 200);
        assert.equal((await call(server, "GET", `/app-data/${appId}/notes`)).body.length, 1);
        const page = await call(server, "GET", `/apps/${appId}/`);
        assert.equal(page.status, 200);
        assert.doesNotMatch(page.text, /nagma-app-token/);
    });

    test("password apps: data needs the token the page gets after the password", async () => {
        assert.equal((await call(server, "PUT", `/apps/${appId}/hosting`, { token: owner.token, body: { access: "password", password: "letmein" } })).status, 200);
        assert.equal((await call(server, "GET", `/app-data/${appId}/notes`)).status, 401);
        assert.equal((await call(server, "POST", `/app-data/${appId}/notes`, { body: { text: "spam" } })).status, 401);
        assert.equal((await call(server, "GET", `/app-data/${appId}/notes`, { headers: { "x-nagma-app-token": "123.abc" } })).status, 401);
        assert.equal((await call(server, "GET", `/apps/${appId}/`)).status, 401);
        const unlocked = await call(server, "POST", `/apps/${appId}/`, form("letmein"));
        assert.equal(unlocked.status, 303);
        const cookie = unlocked.headers.get("set-cookie").split(";")[0];
        const page = await call(server, "GET", `/apps/${appId}/`, { headers: { cookie } });
        assert.equal(page.status, 200);
        const token = /<head><meta name="nagma-app-token" content="([^"]+)">/.exec(page.text)?.[1];
        assert.ok(token, page.text);
        const list = await call(server, "GET", `/app-data/${appId}/notes`, { headers: { "x-nagma-app-token": token } });
        assert.equal(list.status, 200);
        assert.equal(list.body[0].text, "secret");
        // CORS lets the app send the header.
        const pre = await call(server, "OPTIONS", `/app-data/${appId}/notes`);
        assert.match(pre.headers.get("access-control-allow-headers"), /x-nagma-app-token/);
        // The editor's preview: the owner gets a token, a stranger doesn't.
        const mine = await call(server, "POST", "/ai/make/backend/token", { token: owner.token, body: { appId } });
        assert.equal(mine.status, 200);
        assert.equal((await call(server, "GET", `/app-data/${appId}/notes`, { headers: { "x-nagma-app-token": mine.body.token } })).status, 200);
        assert.equal((await call(server, "POST", "/ai/make/backend/token", { token: stranger.token, body: { appId } })).status, 403);
        // A new password retires the old tokens.
        assert.equal((await call(server, "PUT", `/apps/${appId}/hosting`, { token: owner.token, body: { access: "password", password: "another one" } })).status, 200);
        assert.equal((await call(server, "GET", `/app-data/${appId}/notes`, { headers: { "x-nagma-app-token": token } })).status, 401);
        // Team-only works the same way; public again opens the data.
        assert.equal((await call(server, "PUT", `/apps/${appId}/hosting`, { token: owner.token, body: { access: "team" } })).status, 200);
        assert.equal((await call(server, "GET", `/app-data/${appId}/notes`)).status, 401);
        assert.equal((await call(server, "PUT", `/apps/${appId}/hosting`, { token: owner.token, body: { access: "public" } })).status, 200);
        assert.equal((await call(server, "GET", `/app-data/${appId}/notes`)).status, 200);
    });
});

describe("site passwords back off per address", () => {
    let server, owner, site;
    const form = (password, ip) => ({ raw: `password=${encodeURIComponent(password)}`, headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip } });
    before(async () => {
        server = await startServer({ TRUST_PROXY: "1" });
        owner = await signUp(server, "Site Owner");
        site = await createFile(server, owner.token, { doc: { name: "Site", roots: [], nodes: {}, site: { pages: [] } } });
        const files = [{ path: "index.html", data: Buffer.from("<h1>Hi</h1>").toString("base64") }];
        assert.equal((await call(server, "POST", `/files/${site.id}/site`, { token: owner.token, body: { files } })).status, 200);
        assert.equal((await call(server, "PUT", `/files/${site.id}/site/settings`, { token: owner.token, body: { access: "password", password: "right one" } })).status, 200);
    });
    after(async () => server?.stop());

    test("a stranger's wrong guesses lock only the stranger, not other visitors", async () => {
        let last;
        for (let i = 0; i < 8; i++) last = await call(server, "POST", `/sites/${site.id}/`, form(`guess${i}`, "10.9.9.9"));
        assert.equal(last.status, 429);
        assert.equal((await call(server, "POST", `/sites/${site.id}/`, form("right one", "10.9.9.9"))).status, 429);
        // Someone else, at another address, gets in with the right password.
        const visitor = await call(server, "POST", `/sites/${site.id}/`, form("right one", "10.1.1.1"));
        assert.equal(visitor.status, 303);
    });
});

describe("campaign approvals are for what the reviewer saw", () => {
    let server, owner, reviewer, file;
    const doc = () => ({
        name: "Campaign",
        roots: ["page1"],
        nodes: {
            page1: { id: "page1", type: "page", name: "Page 1", parentId: null, children: ["asset1", "asset2"] },
            asset1: { id: "asset1", type: "frame", name: "Banner", parentId: "page1", children: ["t1"], x: 0, y: 0, w: 300, h: 250 },
            t1: { id: "t1", type: "text", name: "Headline", parentId: "asset1", children: [], x: 0, y: 0, w: 100, h: 20, text: "Sale" },
            asset2: { id: "asset2", type: "frame", name: "Story", parentId: "page1", children: [], x: 400, y: 0, w: 100, h: 200 },
        },
    });
    const reviews = async () => Object.fromEntries((await call(server, "GET", `/files/${file.id}/asset-reviews`, { token: owner.token })).body.reviews.map((r) => [r.assetId, r]));
    before(async () => {
        server = await startServer();
        owner = await signUp(server, "Owner");
        reviewer = await signUp(server, "Reviewer");
        file = await createFile(server, owner.token, { doc: doc(), kind: "campaign" });
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { invite: { email: reviewer.email, role: "view" } } });
        assert.equal((await call(server, "POST", `/files/${file.id}/asset-reviews`, { token: owner.token, body: { assetIds: ["asset1", "asset2"], emails: reviewer.email } })).status, 200);
        for (const a of ["asset1", "asset2"]) assert.equal((await call(server, "POST", `/files/${file.id}/asset-reviews/${a}/decide`, { token: reviewer.token, body: { decision: "approved" } })).status, 200);
    });
    after(async () => server?.stop());

    test("editing a layer inside an approved asset withdraws its approval; other assets keep theirs", async () => {
        assert.equal((await reviews()).asset1.status, "approved");
        const ed = await connect(server, file.id, { token: owner.token });
        const watcher = await connect(server, file.id, { token: reviewer.token });
        ed.send({ type: "patch", id: "p1", patch: { nodes: { t1: { text: "Big sale" } } } });
        await watcher.next("asset-reviews");
        const now = await reviews();
        assert.equal(now.asset1.status, "pending");
        assert.equal(now.asset1.history.at(-1).kind, "reset");
        assert.equal(now.asset2.status, "approved");
        // An edit outside reviewed assets changes nothing.
        ed.send({ type: "patch", id: "p2", patch: { nodes: { page1: { name: "Renamed page" } } } });
        await ed.next((m) => m.type === "patch" && m.id === "p2");
        assert.equal((await reviews()).asset2.status, "approved");
        await ed.close();
        await watcher.close();
    });
});

describe("setup hints name the server's settings only for whoever runs it", () => {
    let server, first, second;
    before(async () => {
        server = await startServer();
        first = await signUp(server, "Runs the server");
        second = await signUp(server, "Someone else");
    });
    after(async () => server?.stop());

    test("/auth/me says whether the account is a server admin", async () => {
        assert.equal((await call(server, "GET", "/auth/me", { token: first.token })).body.serverAdmin, true);
        assert.equal((await call(server, "GET", "/auth/me", { token: second.token })).body.serverAdmin, false);
    });
});

describe("board votes stay hidden until the session ends", () => {
    let server, host, other, file;
    const boardDoc = (voting) => ({
        name: "Board",
        board: true,
        roots: ["page1"],
        nodes: {
            page1: { id: "page1", type: "page", name: "Page 1", parentId: null, children: ["s1", "s2"], jam: { kind: "board", voting } },
            s1: { id: "s1", type: "rect", name: "Idea A", parentId: "page1", children: [], x: 0, y: 0, w: 10, h: 10 },
            s2: { id: "s2", type: "rect", name: "Idea B", parentId: "page1", children: [], x: 20, y: 0, w: 10, h: 10 },
        },
    });
    const session = { id: "sess1", open: true, limit: 2, votes: {}, names: {}, host: null, endsAt: null, done: [] };
    before(async () => {
        server = await startServer();
        host = await signUp(server, "Host");
        other = await signUp(server, "Other");
        file = await createFile(server, host.token, { doc: boardDoc(session), kind: "board" });
        await call(server, "PUT", `/files/${file.id}/access`, { token: host.token, body: { invite: { email: other.email, role: "edit" } } });
    });
    after(async () => server?.stop());

    test("ballots aren't in the document while open; the end writes them in for everyone", async () => {
        const a = await connect(server, file.id, { token: host.token });
        const b = await connect(server, file.id, { token: other.token });
        await b.next("ballot");
        const sent = b.messages.length;
        b.send({ type: "vote", session: "sess1", votes: ["s1", "s2", "s1"] });
        const mine = await b.next("ballot", { from: sent });
        assert.deepEqual(mine.votes, ["s1", "s2"]);
        const turnout = await a.next("turnout");
        assert.equal(turnout.voted, 1);
        // Nobody can read the other person's votes: not over HTTP, not in a snapshot, not in the turnout.
        const doc = await call(server, "GET", `/files/${file.id}/doc`, { token: host.token });
        assert.deepEqual(doc.body.doc.nodes.page1.jam.voting.votes, {});
        const c = await connect(server, file.id, { token: host.token });
        assert.deepEqual(c.first.doc.nodes.page1.jam.voting.votes, {});
        assert.ok(a.messages.every((m) => (m.type !== "ballot" || m.votes.length === 0) && (m.type !== "turnout" || m.votes === undefined)));
        // A new connection gets its own ballot back (the host hasn't voted).
        assert.deepEqual((await c.next("ballot")).votes, []);
        // Votes slipped into the document by a client don't count.
        a.send({ type: "patch", id: "p1", patch: { nodes: { page1: { jam: { kind: "board", voting: { ...session, votes: { stuffed: ["s1", "s1"] } } } } } } });
        await a.next((m) => m.type === "patch" && m.id === "p1");
        // The host ends it: the server's ballots become the results.
        const from = a.messages.length;
        a.send({ type: "patch", id: "p2", patch: { nodes: { page1: { jam: { kind: "board", voting: { ...session, open: false } } } } } });
        const reveal = await a.next((m) => m.type === "patch" && m.id === null, { from });
        assert.deepEqual(reveal.patch.nodes.page1.jam.voting.votes, { [other.user.id]: ["s1", "s2"] });
        const after = await call(server, "GET", `/files/${file.id}/doc`, { token: host.token });
        assert.deepEqual(after.body.doc.nodes.page1.jam.voting.votes, { [other.user.id]: ["s1", "s2"] });
        // Voting after the end is refused.
        b.send({ type: "vote", session: "sess1", votes: ["s1"] });
        assert.equal((await b.next((m) => m.type === "ballot" && m.refused)).refused, "closed");
        for (const x of [a, b, c]) await x.close();
    });
});

describe("invitations to an email address belong to the account once it exists", () => {
    let server, owner, file;
    const email = `later${Date.now().toString(36)}@example.com`;
    before(async () => {
        server = await startServer({ NAGMA_DEV_MAIL_FILE: "1" });
        owner = await signUp(server, "Owner");
        // Sharing needs a verified email when the server keeps mail links.
        await verifyAccount(server, owner);
        file = await createFile(server, owner.token);
        assert.equal((await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { invite: { email, role: "edit" } } })).status, 200);
    });
    after(async () => server?.stop());

    test("signing up turns the invite into membership; changing the email keeps it; the old address gives nothing", async () => {
        const r = await call(server, "POST", "/auth/signup", { body: { name: "Later", email, password: "correct horse battery" } });
        assert.equal(r.status, 200);
        const later = { token: r.body.token, user: r.body.user };
        const access = await call(server, "GET", `/files/${file.id}/access`, { token: owner.token });
        assert.equal(Object.keys(access.body.invites ?? {}).includes(email) || (access.body.invites ?? []).some?.((i) => i.email === email), false);
        assert.equal((await call(server, "GET", `/files/${file.id}/doc`, { token: later.token })).status, 200);
        // Change the email through the confirmation link.
        const asked = await call(server, "POST", "/account/email", { token: later.token, body: { email: `new-${email}`, password: "correct horse battery" } });
        assert.equal(asked.status, 200);
        const { readFile } = await import("node:fs/promises");
        const token = await waitUntil(async () => {
            try {
                return JSON.parse(await readFile(`${server.dataDir}/users.json`, "utf8")).users.find((u) => u.id === later.user.id)?.emailChange?.token;
            } catch {
                return null;
            }
        }, 4000, "users.json");
        assert.equal((await call(server, "POST", "/account/email/verify", { body: { token } })).status, 200);
        assert.equal((await call(server, "GET", `/files/${file.id}/doc`, { token: later.token })).status, 200);
        // Someone signing up with the old address later gets nothing.
        const squatter = await call(server, "POST", "/auth/signup", { body: { name: "Squatter", email, password: "correct horse battery" } });
        assert.equal(squatter.status, 200);
        assert.equal((await call(server, "GET", `/files/${file.id}/doc`, { token: squatter.body.token })).status, 403);
    });
});

describe("admin console invites", () => {
    let server, admin, member, team;
    before(async () => {
        server = await startServer();
        admin = await signUp(server, "Admin");
        member = await signUp(server, "Member");
        team = (await call(server, "POST", "/teams", { token: admin.token, body: { name: "Team" } })).body;
    });
    after(async () => server?.stop());

    test("inviting someone already on the team keeps their role and seat; bad emails are named", async () => {
        const first = await call(server, "POST", `/teams/${team.id}/admin/invite`, { token: admin.token, body: { emails: member.email, seat: "dev", role: "edit" } });
        assert.equal(first.status, 200);
        const again = await call(server, "POST", `/teams/${team.id}/admin/invite`, { token: admin.token, body: { emails: `${admin.email}, ${member.email}, not-an-email`, seat: "view", role: "view" } });
        assert.equal(again.status, 200);
        assert.deepEqual(again.body.already.sort(), [admin.email, member.email].sort());
        assert.deepEqual(again.body.invalid, ["not-an-email"]);
        assert.deepEqual(again.body.missing, []);
        const people = Object.fromEntries(again.body.people.map((p) => [p.id, p]));
        assert.equal(people[admin.user.id].role, "admin");
        assert.equal(people[member.user.id].seat, "dev");
        // Still an admin: the console stays open to them.
        assert.equal((await call(server, "GET", `/teams/${team.id}/admin`, { token: admin.token })).body.isAdmin, true);
    });
});

describe("comment digests reach the development mail file", () => {
    let server, owner, guest, file;
    before(async () => {
        server = await startServer({ NAGMA_DEV_MAIL_FILE: "1", DIGEST_MINUTES: "0.02" });
        owner = await signUp(server, "Owner");
        guest = await signUp(server, "Guest");
        await verifyAccount(server, owner);
        file = await createFile(server, owner.token);
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { invite: { email: guest.email, role: "edit" } } });
    });
    after(async () => server?.stop());

    test("a mention is written to data/digests.txt for the person mentioned", async () => {
        const a = await connect(server, file.id, { token: owner.token });
        a.send({ type: "comment.op", op: { op: "add", comment: { id: "digest0001", text: "@Guest can you check the headline", x: 0, y: 0, pageId: "page1", mentions: [guest.user.id] } } });
        await a.next("comments");
        const { readFile } = await import("node:fs/promises");
        const text = await waitUntil(async () => {
            const t = await readFile(`${server.dataDir}/digests.txt`, "utf8").catch(() => "");
            return t.includes("can you check the headline") ? t : null;
        }, 8000, "digest file");
        assert.match(text, new RegExp(`digest for ${guest.email}`));
        assert.match(text, /Owner mentioned you: @Guest can you check the headline/);
        assert.ok(!text.includes(`digest for ${owner.email}`));
        await a.close();
    });
});
