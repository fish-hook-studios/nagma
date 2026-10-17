// Files over HTTP and who may do what with them: owner, invited editor, invited viewer, someone
// without access, signed-out guests with link keys, link passwords and expiry, access requests,
// the trash, and ids that try to leave the data folder.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { call, createFile, readStored, sampleDoc, signUp, startServer, waitUntil } from "./helpers.mjs";

describe("file roles", () => {
    let server, owner, editor, viewer, stranger, file;
    before(async () => {
        server = await startServer({ TRUST_PROXY: "1" });
        owner = await signUp(server, "Owner");
        editor = await signUp(server, "Editor");
        viewer = await signUp(server, "Viewer");
        stranger = await signUp(server, "Stranger");
        file = await createFile(server, owner.token, { doc: sampleDoc("Roles file") });
        const r = await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { invite: { email: editor.email, role: "edit" } } });
        assert.equal(r.status, 200);
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { invite: { email: viewer.email, role: "view" } } });
    });
    after(async () => server?.stop());

    const who = () => ({ owner: owner.token, editor: editor.token, viewer: viewer.token, stranger: stranger.token, guest: undefined });

    test("creating a file needs an account and a document", async () => {
        assert.equal((await call(server, "POST", "/files", { body: { doc: sampleDoc() } })).status, 401);
        assert.equal((await call(server, "POST", "/files", { token: owner.token, body: { doc: { name: "x" } } })).status, 400);
        assert.equal((await call(server, "POST", "/files", { token: owner.token, raw: "{oops", headers: { "content-type": "application/json" } })).status, 400);
        const r = await call(server, "POST", "/files", { token: owner.token, body: { doc: sampleDoc(), project: "nosuchproject1" } });
        assert.equal(r.status, 403);
        assert.ok(server.alive());
    });

    test("the access endpoint reports each person's role", async () => {
        const expect = { owner: "edit", editor: "edit", viewer: "view" };
        for (const [name, token] of Object.entries(who())) {
            const r = await call(server, "GET", `/files/${file.id}/access`, { token });
            if (expect[name]) {
                assert.equal(r.status, 200, name);
                assert.equal(r.body.you, expect[name], name);
            } else assert.equal(r.status, 403, name);
        }
    });

    test("reading the document: owner, editor, viewer yes; stranger and guest no", async () => {
        const expect = { owner: 200, editor: 200, viewer: 200, stranger: 403, guest: 403 };
        for (const [name, token] of Object.entries(who())) {
            const r = await call(server, "GET", `/files/${file.id}/doc`, { token });
            assert.equal(r.status, expect[name], name);
            if (r.status === 200) assert.equal(r.body.doc.nodes.text1.text, "hello world");
            else assert.equal(r.body?.doc, undefined);
        }
    });

    test("the file list shows each person only what they can open, with keys only for editors", async () => {
        for (const [name, token] of Object.entries(who())) {
            const r = await call(server, "GET", "/files", { token });
            const row = r.body.find((f) => f.id === file.id);
            if (name === "stranger" || name === "guest") assert.equal(row, undefined, name);
            else {
                assert.ok(row, name);
                if (name === "viewer") assert.equal(row.keys, null);
                else assert.ok(row.keys?.edit, name);
            }
        }
    });

    test("renaming and trashing need edit access", async () => {
        const expect = { owner: 200, editor: 200, viewer: 403, stranger: 403, guest: 403 };
        for (const [name, token] of Object.entries(who())) {
            const r = await call(server, "PUT", `/files/${file.id}/meta`, { token, body: { name: `Renamed by ${name}` } });
            assert.equal(r.status, expect[name], name);
        }
        const doc = await call(server, "GET", `/files/${file.id}/doc`, { token: owner.token });
        assert.equal(doc.body.name, "Renamed by editor");
        for (const name of ["viewer", "stranger", "guest"]) assert.equal((await call(server, "DELETE", `/files/${file.id}/meta`, { token: who()[name] })).status, 403, name);
        const meta = await call(server, "PUT", `/files/${file.id}/meta`, { token: owner.token, raw: "{bad", headers: { "content-type": "application/json" } });
        assert.equal(meta.status, 400);
    });

    test("changing access needs edit access; viewers and strangers can't invite themselves up", async () => {
        for (const name of ["viewer", "stranger", "guest"]) {
            const r = await call(server, "PUT", `/files/${file.id}/access`, { token: who()[name], body: { invite: { email: who()[name] ? viewer.email : "x@example.com", role: "edit" }, link: "edit" } });
            assert.equal(r.status, 403, name);
        }
        const r = await call(server, "GET", `/files/${file.id}/access`, { token: viewer.token });
        assert.equal(r.body.you, "view");
        // New files are only for invited people until the owner opens the link (QA platform B-2).
        assert.equal(r.body.link, "none");
        const bad = await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { invite: { email: "not-an-email", role: "edit" } } });
        assert.equal(bad.status, 400);
    });

    test("viewers duplicate unless the owner turned copying off; strangers never", async () => {
        assert.equal((await call(server, "POST", `/files/${file.id}/duplicate`, { token: viewer.token })).status, 200);
        assert.equal((await call(server, "POST", `/files/${file.id}/duplicate`, { token: stranger.token })).status, 403);
        assert.equal((await call(server, "POST", `/files/${file.id}/duplicate`)).status, 401);
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { viewersCanExport: false } });
        assert.equal((await call(server, "POST", `/files/${file.id}/duplicate`, { token: viewer.token })).status, 403);
        assert.equal((await call(server, "POST", `/files/${file.id}/duplicate`, { token: editor.token })).status, 200);
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { viewersCanExport: true } });
    });

    test("people list (mentions) needs access", async () => {
        assert.equal((await call(server, "GET", `/files/${file.id}/people`, { token: stranger.token })).status, 403);
        const r = await call(server, "GET", `/files/${file.id}/people`, { token: viewer.token });
        assert.equal(r.status, 200);
        assert.ok(r.body.some((p) => p.id === owner.user.id));
    });

    test("link keys: the view key gives view, the edit key edit, wrong keys nothing; link 'none' turns them off", async () => {
        const keys = file.keys;
        assert.equal((await call(server, "GET", `/files/${file.id}/doc?key=${keys.view}`)).status, 403);
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { link: "edit" } });
        assert.equal((await call(server, "GET", `/files/${file.id}/doc?key=${keys.view}`)).status, 200);
        assert.equal((await call(server, "PUT", `/files/${file.id}/meta?key=${keys.view}`, { body: { name: "guest rename" } })).status, 403);
        assert.equal((await call(server, "GET", `/files/${file.id}/doc?key=${keys.edit}x`)).status, 403);
        assert.equal((await call(server, "GET", `/files/${file.id}/doc?key=`)).status, 403);
        assert.equal((await call(server, "PUT", `/files/${file.id}/meta?key=${keys.edit}`, { body: { pinned: true } })).status, 200);
        // A stranger with the view key can view, but the access endpoint needs an account.
        assert.equal((await call(server, "GET", `/files/${file.id}/access?key=${keys.view}`, { token: stranger.token })).body.you, "view");
        assert.equal((await call(server, "GET", `/files/${file.id}/access?key=${keys.view}`)).status, 403);
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { link: "none" } });
        assert.equal((await call(server, "GET", `/files/${file.id}/doc?key=${keys.view}`)).status, 403);
        assert.equal((await call(server, "GET", `/files/${file.id}/doc?key=${keys.edit}`)).status, 403);
        // Invited people keep their access.
        assert.equal((await call(server, "GET", `/files/${file.id}/doc`, { token: viewer.token })).status, 200);
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { link: "view" } });
        // Link "view": even the edit key only views.
        assert.equal((await call(server, "PUT", `/files/${file.id}/meta?key=${keys.edit}`, { body: { pinned: false } })).status, 403);
        assert.equal((await call(server, "GET", `/files/${file.id}/doc?key=${keys.edit}`)).status, 200);
        // "prototype": the doc isn't readable over HTTP.
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { link: "prototype" } });
        assert.equal((await call(server, "GET", `/files/${file.id}/doc?key=${keys.view}`)).status, 403);
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { link: "bogus" } });
        assert.equal((await call(server, "GET", `/files/${file.id}/access`, { token: owner.token })).body.link, "prototype");
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { link: "edit" } });
    });

    test("link password: the key alone is refused, wrong passwords back off, the pass opens it", async () => {
        const f = await createFile(server, owner.token);
        await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { link: "view", password: "open sesame" } });
        assert.equal((await call(server, "GET", `/files/${f.id}/access`, { token: owner.token })).body.password, true);
        assert.equal((await call(server, "GET", `/files/${f.id}/doc?key=${f.keys.view}`)).status, 403);
        const ip = { "x-forwarded-for": "10.77.0.1" };
        const wrong = await call(server, "POST", `/files/${f.id}/unlock`, { body: { password: "nope" }, headers: ip });
        assert.equal(wrong.status, 401);
        const right = await call(server, "POST", `/files/${f.id}/unlock`, { body: { password: "open sesame" }, headers: { "x-forwarded-for": "10.77.0.2" } });
        assert.equal(right.status, 200);
        const pass = right.body.pass;
        assert.ok(pass.length > 10);
        assert.equal((await call(server, "GET", `/files/${f.id}/doc?key=${f.keys.view}~${pass}`)).status, 200);
        assert.equal((await call(server, "GET", `/files/${f.id}/doc?key=${f.keys.view}~${pass}x`)).status, 403);
        // Invited people and the owner don't need it.
        assert.equal((await call(server, "GET", `/files/${f.id}/doc`, { token: owner.token })).status, 200);
        // Six wrong guesses for this file lock guesses for it.
        for (let i = 0; i < 6; i++) await call(server, "POST", `/files/${f.id}/unlock`, { body: { password: `guess${i}` }, headers: { "x-forwarded-for": `10.77.1.${i}` } });
        const locked = await call(server, "POST", `/files/${f.id}/unlock`, { body: { password: "open sesame" }, headers: { "x-forwarded-for": "10.77.2.1" } });
        assert.equal(locked.status, 429);
        assert.ok(Number(locked.headers.get("retry-after")) >= 1);
        // A new password changes the pass: the old one stops working.
        await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { password: "second secret" } });
        assert.equal((await call(server, "GET", `/files/${f.id}/doc?key=${f.keys.view}~${pass}`)).status, 403);
        // Removing it opens the link again.
        await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { password: null } });
        assert.equal((await call(server, "GET", `/files/${f.id}/doc?key=${f.keys.view}`)).status, 200);
    });

    test("link expiry can't be set in the past (at least a minute ahead)", async () => {
        const f = await createFile(server, owner.token);
        await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { link: "view", expires: Date.now() - 1000 } });
        const a = await call(server, "GET", `/files/${f.id}/access`, { token: owner.token });
        assert.ok(a.body.expires >= Date.now() + 50_000);
        assert.equal((await call(server, "GET", `/files/${f.id}/doc?key=${f.keys.view}`)).status, 200);
        await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { expires: "tomorrow" } });
        assert.equal((await call(server, "GET", `/files/${f.id}/access`, { token: owner.token })).body.expires, a.body.expires);
    });

    test("access requests: ask, see, approve; ask again, deny; only managers decide", async () => {
        const f = await createFile(server, owner.token, { doc: sampleDoc("Requested") });
        const asker = await signUp(server, "Asker");
        assert.equal((await call(server, "POST", `/files/${f.id}/requests`, { body: { role: "view" } })).status, 401);
        const r = await call(server, "POST", `/files/${f.id}/requests`, { token: asker.token, body: { role: "view", note: "please" } });
        assert.equal(r.status, 200);
        // Asking twice keeps one request.
        assert.equal((await call(server, "POST", `/files/${f.id}/requests`, { token: asker.token, body: { role: "view" } })).body.already, true);
        assert.equal((await call(server, "GET", `/files/${f.id}/requests`, { token: asker.token })).status, 403);
        const list = await call(server, "GET", `/files/${f.id}/requests`, { token: owner.token });
        assert.equal(list.body.length, 1);
        assert.equal(list.body[0].note, "please");
        const rid = list.body[0].id;
        // The owner's bell has it.
        const bell = await call(server, "GET", "/notifications", { token: owner.token });
        assert.ok(bell.body.some((n) => n.why === "access-request" && n.request?.id === rid));
        // The asker can't approve their own request.
        assert.equal((await call(server, "POST", `/files/${f.id}/requests/${rid}`, { token: asker.token, body: { approve: true } })).status, 403);
        assert.equal((await call(server, "POST", `/files/${f.id}/requests/nosuchreq`, { token: owner.token, body: { approve: true } })).status, 404);
        const ok = await call(server, "POST", `/files/${f.id}/requests/${rid}`, { token: owner.token, body: { approve: true } });
        assert.equal(ok.body.status, "approved");
        assert.equal((await call(server, "GET", `/files/${f.id}/doc`, { token: asker.token })).status, 200);
        assert.equal((await call(server, "PUT", `/files/${f.id}/meta`, { token: asker.token, body: { name: "x" } })).status, 403);
        // Deciding again doesn't change it.
        assert.equal((await call(server, "POST", `/files/${f.id}/requests/${rid}`, { token: owner.token, body: { approve: false } })).body.status, "approved");
        // Already a viewer: asking for view again is refused; asking for edit then denied.
        assert.equal((await call(server, "POST", `/files/${f.id}/requests`, { token: asker.token, body: { role: "view" } })).status, 400);
        await call(server, "POST", `/files/${f.id}/requests`, { token: asker.token, body: { role: "edit" } });
        const rid2 = (await call(server, "GET", `/files/${f.id}/requests`, { token: owner.token })).body[0].id;
        const no = await call(server, "POST", `/files/${f.id}/requests/${rid2}`, { token: owner.token, body: { approve: false } });
        assert.equal(no.body.status, "denied");
        assert.equal((await call(server, "PUT", `/files/${f.id}/meta`, { token: asker.token, body: { name: "x" } })).status, 403);
        const askerBell = await call(server, "GET", "/notifications", { token: asker.token });
        assert.ok(askerBell.body.some((n) => n.why === "access-denied"));
        assert.ok(askerBell.body.some((n) => n.why === "access-granted"));
    });

    test("leave: invited people can leave; owners and strangers can't", async () => {
        const f = await createFile(server, owner.token);
        const guest = await signUp(server, "Leaving");
        await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { invite: { email: guest.email, role: "view" }, link: "none" } });
        assert.equal((await call(server, "POST", `/files/${f.id}/leave`, { token: owner.token })).status, 400);
        assert.equal((await call(server, "POST", `/files/${f.id}/leave`, { token: stranger.token })).status, 400);
        assert.equal((await call(server, "POST", `/files/${f.id}/leave`, { token: guest.token })).status, 200);
        assert.equal((await call(server, "GET", `/files/${f.id}/doc`, { token: guest.token })).status, 403);
    });

    test("trash and restore; empty trash removes only trashed files you edit", async () => {
        const keep = await createFile(server, owner.token, { doc: sampleDoc("Keep me") });
        const bin = await createFile(server, owner.token, { doc: sampleDoc("Bin me") });
        assert.equal((await call(server, "DELETE", `/files/${bin.id}/meta`, { token: owner.token })).status, 200);
        let list = (await call(server, "GET", "/files", { token: owner.token })).body;
        assert.equal(list.find((f) => f.id === bin.id).trashed, true);
        assert.equal(list.find((f) => f.id === keep.id).trashed, false);
        const restored = await call(server, "PUT", `/files/${bin.id}/meta`, { token: owner.token, body: { trashed: false } });
        assert.equal(restored.body.trashed, false);
        await call(server, "DELETE", `/files/${bin.id}/meta`, { token: owner.token });
        // The viewer's empty trash leaves it alone.
        await call(server, "PUT", `/files/${bin.id}/access`, { token: owner.token, body: { invite: { email: viewer.email, role: "view" } } });
        assert.equal((await call(server, "DELETE", "/files/trash", { token: viewer.token })).body.removed, 0);
        assert.equal((await call(server, "DELETE", "/files/trash")).status, 401);
        const emptied = await call(server, "DELETE", "/files/trash", { token: owner.token });
        assert.ok(emptied.body.removed >= 1);
        list = (await call(server, "GET", "/files", { token: owner.token })).body;
        assert.equal(list.find((f) => f.id === bin.id), undefined);
        assert.ok(list.find((f) => f.id === keep.id));
        assert.equal((await call(server, "GET", `/files/${bin.id}/access`, { token: owner.token })).status, 404);
    });

    // Regression: an invited editor could permanently delete the owner's file without it ever going
    // to the trash (the folder route already refused that).
    test("delete forever: only a trashed file, by someone who edits it", async () => {
        const f = await createFile(server, owner.token, { doc: sampleDoc("Precious") });
        await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { invite: { email: editor.email, role: "edit" } } });
        await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { invite: { email: viewer.email, role: "view" } } });
        assert.equal((await call(server, "DELETE", `/files/${f.id}/forever`, { token: editor.token })).status, 403);
        assert.equal((await call(server, "DELETE", `/files/${f.id}/forever`, { token: owner.token })).status, 400);
        assert.equal((await call(server, "GET", `/files/${f.id}/doc`, { token: owner.token })).status, 200);
        await call(server, "DELETE", `/files/${f.id}/meta`, { token: owner.token });
        assert.equal((await call(server, "DELETE", `/files/${f.id}/forever`, { token: viewer.token })).status, 403);
        assert.equal((await call(server, "DELETE", `/files/${f.id}/forever?key=${f.keys.edit}`)).status, 403);
        // Only the owner deletes for good (QA platform): an invited editor can't, directly or by
        // emptying their trash.
        assert.equal((await call(server, "DELETE", `/files/${f.id}/forever`, { token: editor.token })).status, 403);
        assert.equal((await call(server, "DELETE", "/files/trash", { token: editor.token })).body.removed, 0);
        assert.equal((await call(server, "GET", `/files/${f.id}/doc`, { token: owner.token })).status, 200);
        assert.equal((await call(server, "DELETE", `/files/${f.id}/forever`, { token: owner.token })).status, 200);
        assert.equal((await call(server, "GET", `/files/${f.id}/doc`, { token: owner.token })).status, 404);
    });

    test("moving a file into a folder needs edit access to the folder", async () => {
        const team = (await call(server, "POST", "/teams", { token: stranger.token, body: { name: "Stranger team" } })).body;
        const made = await call(server, "POST", `/teams/${team.id}/projects`, { token: stranger.token, body: { name: "Their folder" } });
        const f = await createFile(server, owner.token);
        const r = await call(server, "PUT", `/files/${f.id}/meta`, { token: owner.token, body: { project: made.body.created } });
        assert.equal(r.status, 403);
        const nope = await call(server, "PUT", `/files/${f.id}/meta`, { token: owner.token, body: { project: "nosuchproject" } });
        assert.equal(nope.status, 403);
    });
});

describe("expired links (after a restart with an expiry in the past)", () => {
    let server, owner, f, pass;
    before(async () => {
        const first = await startServer();
        owner = await signUp(first, "Expirer");
        f = await createFile(first, owner.token);
        await call(first, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { link: "view", expires: Date.now() + 120_000 } });
        await readStored(first, f.id, (rec) => rec.linkExpires);
        // Sessions are saved shortly after sign-up.
        await waitUntil(async () => (await readFile(join(first.dataDir, "users.json"), "utf8").catch(() => "")).includes(owner.email));
        await first.stop({ keep: true });
        const rec = JSON.parse(await readFile(join(first.dataDir, `${f.id}.json`), "utf8"));
        rec.linkExpires = Date.now() - 1000;
        await writeFile(join(first.dataDir, `${f.id}.json`), JSON.stringify(rec));
        server = await startServer({}, { dataDir: first.dataDir });
    });
    after(async () => server?.stop());

    test("an expired link key opens nothing; unlock says 410; the owner still gets in", async () => {
        assert.equal((await call(server, "GET", `/files/${f.id}/doc?key=${f.keys.view}`)).status, 403);
        const u = await call(server, "POST", `/files/${f.id}/unlock`, { body: { password: "x" } });
        assert.equal(u.status, 410);
        pass = u.body?.pass;
        assert.equal(pass, undefined);
        assert.equal((await call(server, "GET", `/files/${f.id}/doc`, { token: owner.token })).status, 200);
        // Clearing the expiry opens the link again.
        await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { expires: null } });
        assert.equal((await call(server, "GET", `/files/${f.id}/doc?key=${f.keys.view}`)).status, 200);
    });
});

describe("file ids that try to leave the data folder", () => {
    let server, a, outside, outsideName;
    before(async () => {
        server = await startServer();
        a = await signUp(server, "Traveller");
        // A file-shaped record just outside the data folder.
        outsideName = `nagma-outside-${Date.now()}`;
        outside = join(server.dataDir, "..", `${outsideName}.json`);
        await writeFile(outside, JSON.stringify({ doc: { name: "Outside secret", roots: ["p"], nodes: { p: { id: "p", type: "page", name: "P", parentId: null, children: ["t"] }, t: { id: "t", type: "text", parentId: "p", children: [], text: "zebra-topsecret" } } }, comments: [{ id: "thread1", author: { uid: "x", name: "X" }, text: "hi", replies: [], createdAt: 1 }] }));
    });
    after(async () => {
        await rm(outside, { force: true });
        await server?.stop();
    });

    // Regression: /notifications/reply (and other routes that took a file id from a JSON body) read
    // and wrote <data>/<id>.json with "../" in the id, outside the data folder.
    test("a reply to a file id with ../ is refused and the outside file is untouched", async () => {
        const before = await readFile(outside, "utf8");
        for (const fileId of [`../${outsideName}`, `..%2F${outsideName}`, `/tmp/${outsideName}`, `abc\u0000def`, "", "__proto__", "constructor"]) {
            const r = await call(server, "POST", "/notifications/reply", { token: a.token, body: { fileId, threadId: "thread1", text: "pwned" } });
            assert.ok([400, 403, 404].includes(r.status), `${fileId}: ${r.status}`);
        }
        await new Promise((r) => setTimeout(r, 600));
        assert.equal(await readFile(outside, "utf8"), before);
        // Nothing from it shows up in the file list or in search.
        const list = await call(server, "GET", "/files", { token: a.token });
        assert.ok(!JSON.stringify(list.body).includes("Outside secret"));
        const s = await call(server, "GET", "/search?q=zebra-topsecret", { token: a.token });
        assert.equal(s.body.files.length, 0);
        assert.ok(server.alive());
    });

    test("community publishing and team templates refuse ids with ../", async () => {
        const c = await call(server, "POST", "/community", { token: a.token, body: { fileId: `../${outsideName}`, name: "x" } });
        assert.ok([400, 403, 404].includes(c.status));
        const t = (await call(server, "POST", "/teams", { token: a.token, body: { name: "T" } })).body;
        const tp = await call(server, "POST", `/teams/${t.id}/templates`, { token: a.token, body: { fileId: `../${outsideName}` } });
        assert.equal(tp.status, 403);
        const list = await call(server, "GET", "/community", { token: a.token });
        assert.ok(!JSON.stringify(list.body).includes("Outside secret"));
    });

    test("route ids are checked: odd ids answer 404 and never reach the disk", async () => {
        const paths = [
            "/files/..%2F..%2Fetc%2Fpasswd/access",
            "/files/%2e%2e/access",
            "/files/../users/access",
            "/files/users/access",
            "/files/abc/access",
            "/files/" + "a".repeat(65) + "/access",
            "/files/secret.key/doc",
            "/libraries/..%2Fusers",
            "/media/..%2Fsecret.key",
            "/media/secret.key",
            "/v1/files/..%2Fusers",
        ];
        for (const p of paths) {
            const r = await call(server, "GET", p, { token: a.token });
            assert.ok(r.status >= 400, `${p}: ${r.status}`);
            assert.ok(!r.text.includes("salt") && !r.text.includes("sessions"), p);
        }
        // users.json is a valid id shape ("users"): it isn't a file record, so it reads as missing.
        const users = await call(server, "GET", "/files/users1/doc", { token: a.token });
        assert.equal(users.status, 404);
        assert.ok(server.alive());
    });
});
