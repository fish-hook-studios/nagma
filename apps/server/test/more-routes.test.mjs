// The other routes that take a file or a team: libraries, branches, versions, asset reviews and
// templates, team settings for a file, call settings, the model routes and GitHub reads. Each is
// checked against people with and without access.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { call, connect, createFile, sampleDoc, signUp, startServer } from "./helpers.mjs";

describe("more routes", () => {
    let server, owner, editor, viewer, stranger, file;
    before(async () => {
        server = await startServer({ ANTHROPIC_API_KEY: "test-key-not-real", ANTHROPIC_BASE_URL: "http://127.0.0.1:9", GITHUB_TOKEN: "" });
        owner = await signUp(server, "Owner");
        editor = await signUp(server, "Editor");
        viewer = await signUp(server, "Viewer");
        stranger = await signUp(server, "Stranger");
        file = await createFile(server, owner.token, { doc: sampleDoc("Library file") });
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { invite: { email: editor.email, role: "edit" }, link: "none" } });
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { invite: { email: viewer.email, role: "view" } } });
    });
    after(async () => server?.stop());

    test("libraries: editors publish, people with access read, others see nothing", async () => {
        const manifest = { id: file.id, name: "Kit", version: 1, components: [] };
        assert.equal((await call(server, "PUT", `/libraries/${file.id}`, { token: viewer.token, body: { manifest } })).status, 403);
        assert.equal((await call(server, "PUT", `/libraries/${file.id}`, { token: stranger.token, body: { manifest } })).status, 403);
        assert.equal((await call(server, "PUT", `/libraries/${file.id}`, { token: editor.token, body: { manifest: { ...manifest, id: "otherfile1" } } })).status, 400);
        assert.equal((await call(server, "PUT", `/libraries/${file.id}`, { token: editor.token, body: { manifest } })).status, 200);
        assert.equal((await call(server, "PUT", `/libraries/${file.id}/items`, { token: editor.token, body: { items: { "comp/../../x": { a: 1 }, button: { b: 2 } } } })).body.count, 2);
        assert.equal((await call(server, "PUT", `/libraries/${file.id}/items`, { token: viewer.token, body: { items: { x: 1 } } })).status, 403);
        const items = await call(server, "POST", `/libraries/${file.id}/items/get`, { token: viewer.token, body: { keys: ["comp/../../x", "button", "missing", 5] } });
        assert.deepEqual(items.body, { "comp/../../x": { a: 1 }, button: { b: 2 } });
        assert.equal((await call(server, "POST", `/libraries/${file.id}/items/get`, { token: stranger.token, body: { keys: ["button"] } })).status, 403);
        assert.equal((await call(server, "GET", `/libraries/${file.id}`, { token: stranger.token })).status, 403);
        assert.equal((await call(server, "GET", `/libraries/${file.id}`)).status, 403);
        assert.ok((await call(server, "GET", "/libraries", { token: viewer.token })).body.some((l) => l.id === file.id));
        assert.ok(!(await call(server, "GET", "/libraries", { token: stranger.token })).body.some((l) => l.id === file.id));
        assert.ok(!(await call(server, "GET", "/libraries")).body.some((l) => l.id === file.id));
        assert.equal((await call(server, "DELETE", `/libraries/${file.id}`, { token: viewer.token })).status, 403);
    });

    test("branches: editors make them; viewers read but get no keys; merging needs edit on main", async () => {
        assert.equal((await call(server, "POST", `/files/${file.id}/branches`, { token: viewer.token, body: { name: "b" } })).status, 403);
        assert.equal((await call(server, "POST", `/files/${file.id}/branches`, { token: stranger.token, body: { name: "b" } })).status, 403);
        assert.equal((await call(server, "POST", `/files/${file.id}/branches`, { body: { name: "b" } })).status, 403);
        const b = await call(server, "POST", `/files/${file.id}/branches`, { token: editor.token, body: { name: "Feature" } });
        assert.equal(b.status, 200);
        const asViewer = await call(server, "GET", `/files/${file.id}/branches`, { token: viewer.token });
        assert.equal(asViewer.body.main.key, null);
        assert.ok(asViewer.body.branches.every((x) => x.key === null));
        assert.ok((await call(server, "GET", `/files/${file.id}/branches`, { token: editor.token })).body.branches[0].key);
        assert.equal((await call(server, "GET", `/files/${b.body.id}/doc`, { token: stranger.token })).status, 403);
        assert.equal((await call(server, "POST", `/files/${b.body.id}/merge`, { token: viewer.token })).status, 403);
        // Branches don't show in the file browser.
        assert.ok(!(await call(server, "GET", "/files", { token: editor.token })).body.some((f) => f.id === b.body.id));
        const merged = await call(server, "POST", `/files/${b.body.id}/merge`, { token: owner.token });
        assert.equal(merged.status, 200);
    });

    test("versions: only editors duplicate one", async () => {
        const a = await connect(server, file.id, { token: owner.token });
        a.send({ type: "version.save", name: "Named" });
        const v = await a.next((m) => m.type === "versions" && m.versions.some((x) => x.name === "Named"));
        const id = v.versions.find((x) => x.name === "Named").id;
        await a.close();
        assert.equal((await call(server, "POST", `/files/${file.id}/versions/${id}/duplicate`, { token: viewer.token })).status, 403);
        assert.equal((await call(server, "POST", `/files/${file.id}/versions/${id}/duplicate`)).status, 401);
        assert.equal((await call(server, "POST", `/files/${file.id}/versions/../../users/duplicate`, { token: owner.token })).status, 404);
        assert.equal((await call(server, "POST", `/files/${file.id}/versions/${id}/duplicate`, { token: editor.token })).status, 200);
        // version.get with someone else's version id: nothing.
        const s = await connect(server, file.id, { token: viewer.token });
        s.send({ type: "version.get", id: "../../users" });
        s.send({ type: "version.get", id });
        const got = await s.next("version");
        assert.equal(got.id, id);
        await s.close();
    });

    test("asset reviews: editors ask, only named reviewers decide, strangers see nothing", async () => {
        const base = `/files/${file.id}/asset-reviews`;
        assert.equal((await call(server, "GET", base, { token: stranger.token })).status, 403);
        assert.equal((await call(server, "GET", base)).status, 401);
        assert.equal((await call(server, "POST", base, { token: viewer.token, body: { assetIds: ["rect1"], emails: owner.email } })).status, 403);
        assert.equal((await call(server, "POST", base, { token: editor.token, body: { assetIds: ["nosuchlayer"], emails: owner.email } })).status, 400);
        assert.equal((await call(server, "POST", base, { token: editor.token, body: { assetIds: ["rect1"], emails: "nobody@nowhere.example" } })).status, 400);
        const r = await call(server, "POST", base, { token: editor.token, body: { assetIds: ["rect1"], emails: viewer.email } });
        assert.equal(r.status, 200);
        assert.equal((await call(server, "POST", `${base}/rect1/decide`, { token: owner.token, body: { decision: "approved" } })).status, 403);
        assert.equal((await call(server, "POST", `${base}/rect1/decide`, { token: viewer.token, body: { decision: "maybe" } })).status, 400);
        const ok = await call(server, "POST", `${base}/rect1/decide`, { token: viewer.token, body: { decision: "approved" } });
        assert.equal(ok.body.reviews[0].status, "approved");
        assert.equal((await call(server, "DELETE", `${base}/rect1`, { token: viewer.token })).status, 403);
        assert.equal((await call(server, "DELETE", `${base}/rect1`, { token: editor.token })).status, 200);
    });

    test("team asset templates: team editors with edit access publish; others can't read or change them", async () => {
        const team = (await call(server, "POST", "/teams", { token: owner.token, body: { name: "Templates" } })).body;
        await call(server, "PUT", `/teams/${team.id}`, { token: owner.token, body: { invite: { email: viewer.email, role: "view" } } });
        const payload = { nodes: [{ id: "n1", type: "rect" }], images: {} };
        assert.equal((await call(server, "PUT", "/asset-templates/tmpl000001", { token: viewer.token, body: { teamId: team.id, fileId: file.id, payload } })).status, 403);
        assert.equal((await call(server, "PUT", "/asset-templates/tmpl000001", { token: stranger.token, body: { teamId: team.id, fileId: file.id, payload } })).status, 403);
        assert.equal((await call(server, "PUT", "/asset-templates/tmpl000001", { token: owner.token, body: { teamId: team.id, fileId: file.id, payload } })).status, 200);
        assert.equal((await call(server, "GET", "/asset-templates/tmpl000001", { token: stranger.token })).status, 403);
        assert.equal((await call(server, "GET", `/asset-templates?team=${team.id}`, { token: stranger.token })).status, 403);
        assert.equal((await call(server, "GET", "/asset-templates/tmpl000001", { token: viewer.token })).status, 200);
        // Someone on another team can't take the id over.
        const theirs = (await call(server, "POST", "/teams", { token: stranger.token, body: { name: "Theirs" } })).body;
        const sf = await createFile(server, stranger.token);
        assert.equal((await call(server, "PUT", "/asset-templates/tmpl000001", { token: stranger.token, body: { teamId: theirs.id, fileId: sf.id, payload } })).status, 403);
        assert.equal((await call(server, "DELETE", "/asset-templates/tmpl000001", { token: stranger.token })).status, 403);
        assert.equal((await call(server, "GET", "/asset-templates/..%2F..%2Fusers", { token: owner.token })).status, 404);
    });

    test("per-file team settings and call settings need access to the file", async () => {
        assert.equal((await call(server, "GET", `/files/${file.id}/team-settings`, { token: stranger.token })).status, 403);
        assert.equal((await call(server, "GET", `/files/${file.id}/team-settings`, { token: viewer.token })).status, 200);
        assert.equal((await call(server, "GET", `/rtc/config?file=${file.id}`, { token: stranger.token })).status, 403);
        assert.equal((await call(server, "GET", `/rtc/config?file=${file.id}`)).status, 403);
        assert.equal((await call(server, "GET", "/rtc/config?file=../../users")).status, 403);
        assert.equal((await call(server, "GET", `/rtc/config?file=${file.id}`, { token: viewer.token })).status, 200);
    });

    // Regression: /ai/chat used the server's model key for anyone, signed in or not (no AI credit
    // check either), while Make already asked for sign-in first.
    test("model routes ask for sign-in before anything else", async () => {
        const chat = await call(server, "POST", "/ai/chat", { body: { text: "hi", selection: [] } });
        assert.equal(chat.status, 401);
        const make = await call(server, "POST", "/ai/make", { body: { prompt: "an app" } });
        assert.equal(make.status, 401);
        const status = await call(server, "GET", "/ai/make");
        assert.deepEqual(status.body, { signedIn: false });
        assert.ok(server.alive());
    });

    test("GitHub reads: signed in only, repository read paths only", async () => {
        assert.equal((await call(server, "GET", "/code-connect/github?path=/repos/a/b")).status, 401);
        for (const path of ["/user", "/repos/a/b/../../user", "/repos/a/b/issues", "https://evil.example/", "/repos/a/b/contents/x?y", "//evil.example/repos/a/b"]) {
            const r = await call(server, "GET", `/code-connect/github?path=${encodeURIComponent(path)}`, { token: owner.token });
            assert.equal(r.status, 400, path);
        }
        // No server token: says so rather than calling GitHub.
        assert.equal((await call(server, "GET", `/code-connect/github?path=${encodeURIComponent("/repos/a/b")}`, { token: owner.token })).status, 501);
    });
});
