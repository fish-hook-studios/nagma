// Search and notifications only show what you can open; published sites' addresses, passwords and
// team-only access; community pages.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { call, connect, createFile, sampleDoc, signUp, startServer } from "./helpers.mjs";

describe("search and notifications", () => {
    let server, alice, bob, carol, secretFile, sharedFile;
    before(async () => {
        server = await startServer();
        alice = await signUp(server, "Alice Searcher");
        bob = await signUp(server, "Bob Prober");
        carol = await signUp(server, "Carol Collaborator");
        secretFile = await createFile(server, alice.token, { doc: { ...sampleDoc("Quarterly secret plan", "zanzibar-launch-codes"), roots: ["page1"] } });
        await call(server, "PUT", `/files/${secretFile.id}/access`, { token: alice.token, body: { link: "view" } });
        sharedFile = await createFile(server, alice.token, { doc: sampleDoc("Shared roadmap", "kumquat-roadmap-text") });
        await call(server, "PUT", `/files/${sharedFile.id}/access`, { token: alice.token, body: { invite: { email: carol.email, role: "view" }, link: "none" } });
    });
    after(async () => server?.stop());

    test("search finds your own files by name, page name and text, with a snippet", async () => {
        const byName = await call(server, "GET", "/search?q=quarterly", { token: alice.token });
        assert.equal(byName.body.files[0].id, secretFile.id);
        const byText = await call(server, "GET", "/search?q=zanzibar", { token: alice.token });
        assert.equal(byText.body.files[0].id, secretFile.id);
        assert.equal(byText.body.files[0].match.type, "text");
        assert.match(byText.body.files[0].match.text, /zanzibar-launch-codes/);
        const byPage = await call(server, "GET", "/search?q=page%201", { token: alice.token });
        assert.ok(byPage.body.files.some((f) => f.id === secretFile.id));
        assert.equal((await call(server, "GET", "/search?q=x")).status, 401);
    });

    test("search never shows files, names, text or people you can't see", async () => {
        for (const q of ["quarterly", "zanzibar", "launch-codes", "secret", "kumquat", "roadmap", ""]) {
            const r = await call(server, "GET", `/search?q=${encodeURIComponent(q)}`, { token: bob.token });
            assert.equal(r.status, 200);
            assert.deepEqual(r.body.files, [], q);
            assert.ok(!JSON.stringify(r.body).includes("zanzibar"), q);
        }
        // Holding the view link isn't enough to make it searchable.
        assert.equal((await call(server, "GET", `/files/${secretFile.id}/doc?key=${secretFile.keys.view}`)).status, 200);
        assert.deepEqual((await call(server, "GET", "/search?q=zanzibar", { token: bob.token })).body.files, []);
        // People: strangers aren't found by name or email.
        const people = await call(server, "GET", "/search?q=alice", { token: bob.token });
        assert.deepEqual(people.body.people, []);
        const byMail = await call(server, "GET", `/search?q=${encodeURIComponent(alice.email.split("@")[0])}`, { token: bob.token });
        assert.deepEqual(byMail.body.people, []);
    });

    test("search follows sharing: invited people find it (without keys), and lose it when removed", async () => {
        const r = await call(server, "GET", "/search?q=kumquat", { token: carol.token });
        assert.equal(r.body.files.length, 1);
        assert.equal(r.body.files[0].keys, null);
        assert.equal(r.body.files[0].role, "view");
        assert.equal(r.body.files[0].location, "Shared with you");
        await call(server, "PUT", `/files/${sharedFile.id}/access`, { token: alice.token, body: { remove: carol.user.id } });
        assert.deepEqual((await call(server, "GET", "/search?q=kumquat", { token: carol.token })).body.files, []);
        await call(server, "PUT", `/files/${sharedFile.id}/access`, { token: alice.token, body: { invite: { email: carol.email, role: "view" } } });
    });

    test("trashed files drop out of search; filters and limits behave", async () => {
        const f = await createFile(server, alice.token, { doc: sampleDoc("Trash candidate", "pomegranate") });
        assert.equal((await call(server, "GET", "/search?q=pomegranate", { token: alice.token })).body.files.length, 1);
        await call(server, "DELETE", `/files/${f.id}/meta`, { token: alice.token });
        assert.equal((await call(server, "GET", "/search?q=pomegranate", { token: alice.token })).body.files.length, 0);
        const lim = await call(server, "GET", "/search?q=&limit=1", { token: alice.token });
        assert.equal(lim.body.files.length, 1);
        assert.ok(lim.body.total >= 2);
        for (const q of ["limit=-5", "limit=abc", "limit=99999", "type=__proto__", "location=team:__proto__", "location=folder:", "sort=../../etc", "creator=constructor"]) {
            const r = await call(server, "GET", `/search?q=a&${q}`, { token: alice.token });
            assert.equal(r.status, 200, q);
        }
        const drafts = await call(server, "GET", "/search?q=&location=drafts", { token: alice.token });
        assert.ok(drafts.body.files.every((f) => !f.project));
    });

    test("notifications: mentions reach the person mentioned only if they can open the file", async () => {
        const a = await connect(server, sharedFile.id, { token: alice.token });
        a.send({ type: "comment.op", op: { op: "add", comment: { id: "mention0001", text: "@Carol and @Bob look", x: 0, y: 0, pageId: "page1", mentions: [carol.user.id, bob.user.id] } } });
        await a.next("comments");
        await a.close();
        const c = await call(server, "GET", "/notifications", { token: carol.token });
        const n = c.body.find((x) => x.threadId === "mention0001");
        assert.ok(n);
        assert.equal(n.why, "mention");
        assert.equal(n.key, null);
        const b = await call(server, "GET", "/notifications", { token: bob.token });
        assert.ok(!JSON.stringify(b.body).includes("mention0001"));
        assert.ok(!JSON.stringify(b.body).includes("look"));
        assert.deepEqual((await call(server, "GET", "/notifications")).body, []);
    });

    test("notification replies need access to the file; read state is per person", async () => {
        const ok = await call(server, "POST", "/notifications/reply", { token: carol.token, body: { fileId: sharedFile.id, threadId: "mention0001", text: "on it" } });
        assert.equal(ok.status, 200);
        const no = await call(server, "POST", "/notifications/reply", { token: bob.token, body: { fileId: sharedFile.id, threadId: "mention0001", text: "sneaky" } });
        assert.equal(no.status, 403);
        assert.equal((await call(server, "POST", "/notifications/reply", { token: carol.token, body: { fileId: sharedFile.id, threadId: "nosuchthread", text: "x" } })).status, 400);
        assert.equal((await call(server, "POST", "/notifications/reply", { token: carol.token, body: { fileId: sharedFile.id, threadId: "mention0001", text: "   " } })).status, 400);
        // Alice hears about Carol's reply in her thread.
        const al = await call(server, "GET", "/notifications", { token: alice.token });
        assert.ok(al.body.some((n) => n.threadId === "mention0001" && n.text === "on it"));
        const read = await call(server, "POST", "/notifications/read", { token: carol.token, body: { ids: ["x1", "x2", 5, { a: 1 }] } });
        assert.deepEqual(read.body.read, ["x1", "x2"]);
        const all = await call(server, "POST", "/notifications/read", { token: carol.token, body: {} });
        assert.ok(all.body.readAt > 0);
        assert.deepEqual((await call(server, "GET", "/notifications/state", { token: bob.token })).body, { readAt: 0, read: [] });
    });

    test("losing access removes the file's notifications", async () => {
        await call(server, "PUT", `/files/${sharedFile.id}/access`, { token: alice.token, body: { remove: carol.user.id } });
        const c = await call(server, "GET", "/notifications", { token: carol.token });
        assert.ok(!c.body.some((n) => n.fileId === sharedFile.id && n.threadId));
    });
});

describe("published sites and community", () => {
    let server, owner, viewer, outsider, site;
    const b64 = (s) => Buffer.from(s).toString("base64");
    before(async () => {
        server = await startServer({ TRUST_PROXY: "1" });
        owner = await signUp(server, "Publisher");
        viewer = await signUp(server, "Site viewer");
        outsider = await signUp(server, "Outsider");
        site = await createFile(server, owner.token, { doc: { name: "Site", roots: [], nodes: {}, site: { pages: [] } } });
        await call(server, "PUT", `/files/${site.id}/access`, { token: owner.token, body: { invite: { email: viewer.email, role: "view" }, link: "view" } });
        const r = await call(server, "POST", `/files/${site.id}/site`, { token: owner.token, body: { files: [{ path: "index.html", data: b64("<h1>Hello site</h1>") }] } });
        assert.equal(r.status, 200);
    });
    after(async () => server?.stop());

    test("site names: valid, not reserved, not taken; only editors set them", async () => {
        for (const slug of ["ab", "-bad", "bad-", "a_b", "admin", "s", "with space", "a".repeat(41), "../x"]) {
            const r = await call(server, "PUT", `/files/${site.id}/site/settings`, { token: owner.token, body: { slug } });
            assert.ok([400, 409].includes(r.status), `${slug}: ${r.status}`);
        }
        assert.equal((await call(server, "PUT", `/files/${site.id}/site/settings`, { token: viewer.token, body: { slug: "viewer-site" } })).status, 403);
        assert.equal((await call(server, "PUT", `/files/${site.id}/site/settings`, { token: outsider.token, body: { slug: "outsider-site" } })).status, 403);
        assert.equal((await call(server, "PUT", `/files/${site.id}/site/settings`, { token: owner.token, body: { slug: "my-site" } })).status, 200);
        const page = await call(server, "GET", "/s/my-site/");
        assert.equal(page.status, 200);
        assert.match(page.text, /Hello site/);
        assert.match(page.headers.get("content-security-policy"), /sandbox/);
        const other = await createFile(server, outsider.token, { doc: { name: "Other", roots: [], nodes: {}, site: { pages: [] } } });
        assert.equal((await call(server, "PUT", `/files/${other.id}/site/settings`, { token: outsider.token, body: { slug: "my-site" } })).status, 409);
    });

    // Regression: wrong site passwords weren't counted, so a password-protected site could be
    // guessed as fast as the server answered.
    test("password sites: the form, wrong guesses back off, the right one sets a cookie", async () => {
        assert.equal((await call(server, "PUT", `/files/${site.id}/site/settings`, { token: owner.token, body: { access: "password", password: "abc" } })).status, 400);
        assert.equal((await call(server, "PUT", `/files/${site.id}/site/settings`, { token: owner.token, body: { access: "password", password: "hunter22" } })).status, 200);
        const gate = await call(server, "GET", "/s/my-site/");
        assert.equal(gate.status, 401);
        assert.ok(!gate.text.includes("Hello site"));
        const settings = await call(server, "GET", `/files/${site.id}/site/settings`, { token: owner.token });
        assert.equal(settings.body.access, "password");
        assert.ok(!JSON.stringify(settings.body).includes("hunter22") && !JSON.stringify(settings.body).includes("passwordHash"));
        const formPost = (password, ip) => call(server, "POST", "/s/my-site/", { raw: new URLSearchParams({ password }).toString(), headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip } });
        assert.equal((await formPost("wrong", "10.5.0.1")).status, 401);
        const ok = await formPost("hunter22", "10.5.0.2");
        assert.equal(ok.status, 303);
        const cookie = ok.headers.get("set-cookie").split(";")[0];
        assert.match(ok.headers.get("set-cookie"), /HttpOnly/);
        assert.equal((await call(server, "GET", "/s/my-site/", { headers: { cookie } })).status, 200);
        assert.equal((await call(server, "GET", "/s/my-site/", { headers: { cookie: `${cookie}x` } })).status, 401);
        // The same cookie works at /sites/<id>/ too (same site, same access).
        assert.equal((await call(server, "GET", `/sites/${site.id}/`)).status, 401);
        // Wrong guesses back off per address on this site (QA platform: a stranger can't lock out
        // the real visitors any more).
        for (let i = 0; i < 6; i++) await formPost(`guess${i}`, "10.5.1.1");
        const locked = await formPost("hunter22", "10.5.1.1");
        assert.equal(locked.status, 429);
        assert.ok(Number(locked.headers.get("retry-after")) >= 1);
        assert.equal((await formPost("hunter22", "10.5.2.1")).status, 303);
        // A new password ends old cookies.
        await call(server, "PUT", `/files/${site.id}/site/settings`, { token: owner.token, body: { access: "password", password: "another-one" } });
        assert.equal((await call(server, "GET", "/s/my-site/", { headers: { cookie } })).status, 401);
    });

    // Regression: a signed-out guest holding the file's view link could get a ticket into a site
    // limited to people signed in to the server.
    test("team-only sites: tickets for signed-in people with access only", async () => {
        await call(server, "PUT", `/files/${site.id}/site/settings`, { token: owner.token, body: { access: "team" } });
        assert.equal((await call(server, "GET", "/s/my-site/")).status, 401);
        assert.equal((await call(server, "POST", `/files/${site.id}/site/ticket?key=${site.keys.view}`)).status, 401);
        assert.equal((await call(server, "POST", `/files/${site.id}/site/ticket`, { token: outsider.token })).status, 403);
        const t = await call(server, "POST", `/files/${site.id}/site/ticket`, { token: viewer.token });
        assert.equal(t.status, 200);
        const enter = await call(server, "GET", `/s/my-site/?ticket=${encodeURIComponent(t.body.ticket)}`);
        assert.equal(enter.status, 303);
        const cookie = enter.headers.get("set-cookie").split(";")[0];
        assert.equal((await call(server, "GET", "/s/my-site/", { headers: { cookie } })).status, 200);
        // A ticket for another site, or a forged one, doesn't open it.
        for (const ticket of [`${Date.now() + 60_000}.${"A".repeat(32)}`, `${Date.now() - 1}.${t.body.ticket.split(".")[1]}`, "garbage", ""]) {
            assert.equal((await call(server, "GET", `/s/my-site/?ticket=${encodeURIComponent(ticket)}`)).status, 401, ticket);
        }
        await call(server, "PUT", `/files/${site.id}/site/settings`, { token: owner.token, body: { access: "public" } });
        assert.equal((await call(server, "GET", "/s/my-site/")).status, 200);
    });

    test("a trashed site file's site goes dark", async () => {
        const f = await createFile(server, owner.token, { doc: { name: "Gone soon", roots: [], nodes: {}, site: { pages: [] } } });
        await call(server, "POST", `/files/${f.id}/site`, { token: owner.token, body: { files: [{ path: "index.html", data: b64("<p>soon gone</p>") }] } });
        assert.equal((await call(server, "GET", `/sites/${f.id}/`)).status, 200);
        await call(server, "DELETE", `/files/${f.id}/meta`, { token: owner.token });
        assert.equal((await call(server, "GET", `/sites/${f.id}/`)).status, 404);
    });

    // Regression: community entries and profiles carried the publisher's email address to everyone
    // on the server (looked up by id or handle).
    test("community pages don't show email addresses; only editors publish; only publishers unpublish", async () => {
        const f = await createFile(server, owner.token, { doc: sampleDoc("Community file") });
        assert.equal((await call(server, "POST", "/community", { token: viewer.token, body: { fileId: f.id } })).status, 403);
        const pub = await call(server, "POST", "/community", { token: owner.token, body: { fileId: f.id, name: "Shared kit", tags: "ui, kit" } });
        assert.equal(pub.status, 200);
        assert.equal(pub.body.by.email, undefined);
        const list = await call(server, "GET", "/community", { token: outsider.token });
        assert.ok(list.body.some((e) => e.id === pub.body.id));
        assert.ok(!JSON.stringify(list.body).includes(owner.email));
        const prof = await call(server, "GET", `/community/people/${owner.user.id}`, { token: outsider.token });
        assert.equal(prof.status, 200);
        assert.equal(prof.body.email, undefined);
        assert.ok(!JSON.stringify(prof.body).includes(owner.email));
        assert.equal((await call(server, "DELETE", `/community/${pub.body.id}`, { token: outsider.token })).status, 403);
        // The published copy opens view-only; later edits to the source stay private.
        await call(server, "PUT", `/files/${f.id}/meta`, { token: owner.token, body: { name: "Renamed later" } });
        const copy = await call(server, "GET", `/files/${pub.body.fileId}/doc?key=${pub.body.viewKey}`);
        assert.equal(copy.body.name, "Shared kit");
        assert.equal((await call(server, "PUT", `/files/${pub.body.fileId}/meta?key=${pub.body.viewKey}`, { body: { name: "x" } })).status, 403);
        assert.equal((await call(server, "DELETE", `/community/${pub.body.id}`, { token: owner.token })).status, 200);
    });
});
