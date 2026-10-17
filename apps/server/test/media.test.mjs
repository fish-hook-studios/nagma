// Media (video, images, attachments by id): who may upload and download, signed addresses
// (tampered or expired ones refused), and ids that can't be probed or taken over.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { call, createFile, sampleDoc, signUp, startServer } from "./helpers.mjs";

async function put(server, id, fileId, bytes, { token, key, type = "image/png" } = {}) {
    const q = new URLSearchParams({ file: fileId, ...(key ? { key } : {}) });
    const res = await fetch(`${server.url}/media/${id}?${q}`, { method: "PUT", body: bytes, headers: { "content-type": type, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    return { status: res.status, body: await res.json().catch(() => null) };
}

async function get(server, path, token) {
    const res = await fetch(`${server.url}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
}

describe("media", () => {
    let server, owner, editor, viewer, stranger, file, secret;
    const bytes = Buffer.from("\x89PNG fake picture bytes");
    before(async () => {
        server = await startServer();
        owner = await signUp(server, "Owner");
        editor = await signUp(server, "Editor");
        viewer = await signUp(server, "Viewer");
        stranger = await signUp(server, "Stranger");
        file = await createFile(server, owner.token, { doc: sampleDoc("Media file") });
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { invite: { email: editor.email, role: "edit" }, link: "view" } });
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { invite: { email: viewer.email, role: "view" } } });
        secret = await readFile(join(server.dataDir, "secret.key"));
    });
    after(async () => server?.stop());

    const sign = (id, exp) => createHmac("sha256", secret).update(`media:${id}:${exp}`).digest("base64url");

    test("uploading needs an account with edit access to the file named", async () => {
        assert.equal((await put(server, "upload00001", file.id, bytes)).status, 401);
        assert.equal((await put(server, "upload00001", file.id, bytes, { key: file.keys.edit })).status, 401);
        assert.equal((await put(server, "upload00001", file.id, bytes, { token: viewer.token })).status, 403);
        assert.equal((await put(server, "upload00001", file.id, bytes, { token: stranger.token })).status, 403);
        assert.equal((await put(server, "upload00001", "nosuchfile1", bytes, { token: owner.token })).status, 403);
        assert.equal((await put(server, "upload00001", "../users", bytes, { token: owner.token })).status, 403);
        const ok = await put(server, "upload00001", file.id, bytes, { token: editor.token });
        assert.equal(ok.status, 200);
        assert.equal(ok.body.size, bytes.length);
        // The same id again is a no-op for people with access.
        assert.equal((await put(server, "upload00001", file.id, Buffer.from("other"), { token: owner.token })).body.existing, true);
        const back = await get(server, `/media/upload00001?file=${file.id}`, owner.token);
        assert.deepEqual(back.bytes, bytes);
    });

    test("an id someone else stored can't be taken over from another file", async () => {
        await put(server, "takeover001", file.id, bytes, { token: owner.token });
        const mine = await createFile(server, stranger.token);
        const r = await put(server, "takeover001", mine.id, Buffer.from("replaced"), { token: stranger.token });
        assert.equal(r.status, 409);
        const back = await get(server, `/media/takeover001?file=${file.id}`, owner.token);
        assert.deepEqual(back.bytes, bytes);
        // And it didn't become reachable through the stranger's file.
        assert.equal((await get(server, `/media/takeover001?file=${mine.id}`, stranger.token)).status, 403);
    });

    test("downloading: anyone who can open a file it belongs to, by account or link key; no one else", async () => {
        await put(server, "download001", file.id, bytes, { token: owner.token, type: "video/mp4" });
        const cases = [
            ["owner", owner.token, `?file=${file.id}`, 200],
            ["editor", editor.token, `?file=${file.id}`, 200],
            ["viewer", viewer.token, `?file=${file.id}`, 200],
            ["guest with view key", undefined, `?file=${file.id}&key=${file.keys.view}`, 200],
            ["guest with a wrong key", undefined, `?file=${file.id}&key=nope`, 403],
            ["guest without key", undefined, `?file=${file.id}`, 401],
            ["guest, no file", undefined, "", 401],
            ["stranger", stranger.token, `?file=${file.id}`, 403],
            ["stranger, no file", stranger.token, "", 403],
            ["owner, no file", owner.token, "", 403],
        ];
        for (const [label, token, q, status] of cases) {
            const r = await get(server, `/media/download001${q}`, token);
            assert.equal(r.status, status, label);
            if (status === 200) {
                assert.deepEqual(r.bytes, bytes, label);
                assert.equal(r.headers.get("content-type"), "video/mp4");
                assert.equal(r.headers.get("x-content-type-options"), "nosniff");
                assert.match(r.headers.get("content-security-policy"), /sandbox/);
            } else assert.ok(!r.bytes.includes(bytes), label);
        }
        // Turning the link off takes the guest's access away.
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { link: "none" } });
        assert.equal((await get(server, `/media/download001?file=${file.id}&key=${file.keys.view}`)).status, 403);
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { link: "view" } });
    });

    test("an uploaded type can't be HTML that runs on this origin", async () => {
        await put(server, "htmlmedia01", file.id, Buffer.from("<script>alert(1)</script>"), { token: owner.token, type: "text/html" });
        const r = await get(server, `/media/htmlmedia01?file=${file.id}`, owner.token);
        assert.equal(r.status, 200);
        assert.match(r.headers.get("content-security-policy"), /default-src 'none'.*sandbox/);
    });

    test("signed addresses: work without sign-in until they expire; tampering is refused", async () => {
        await put(server, "signed00001", file.id, bytes, { token: owner.token });
        assert.equal((await call(server, "GET", "/media/signed00001/url")).status, 401);
        assert.equal((await call(server, "GET", `/media/signed00001/url?file=${file.id}`, { token: stranger.token })).status, 403);
        const made = await call(server, "GET", `/media/signed00001/url?file=${file.id}`, { token: viewer.token });
        assert.equal(made.status, 200);
        assert.ok(made.body.expires > Date.now() && made.body.expires <= Date.now() + 11 * 60 * 1000);
        const ok = await get(server, made.body.url);
        assert.equal(ok.status, 200);
        assert.deepEqual(ok.bytes, bytes);
        const u = new URL(made.body.url, server.url);
        const exp = Number(u.searchParams.get("exp"));
        const sig = u.searchParams.get("sig");
        const tampered = [
            `/media/signed00001?exp=${exp + 1000}&sig=${sig}`,
            `/media/signed00001?exp=${exp}&sig=${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`,
            `/media/signed00001?exp=${exp}&sig=${sig}x`,
            `/media/signed00001?exp=${exp}&sig=`,
            `/media/signed00001?exp=abc&sig=${sig}`,
            `/media/signed00001?sig=${sig}`,
            `/media/download001?exp=${exp}&sig=${sig}`,
            `/media/signed00001?exp=${exp}&sig=${encodeURIComponent(sign("signed00001", exp).toUpperCase())}`,
        ];
        for (const path of tampered) assert.equal((await get(server, path)).status, 401, path);
        // A properly signed address whose time is up is refused too.
        const past = Date.now() - 1000;
        assert.equal((await get(server, `/media/signed00001?exp=${past}&sig=${sign("signed00001", past)}`)).status, 401);
        // (and the same signature, made correctly for a future time, would work: the check is the expiry)
        const future = Date.now() + 60_000;
        assert.equal((await get(server, `/media/signed00001?exp=${future}&sig=${sign("signed00001", future)}`)).status, 200);
    });

    test("probing: signed out, an unknown id answers exactly like one you can't open", async () => {
        await put(server, "probe000001", file.id, bytes, { token: owner.token });
        const known = await call(server, "GET", "/media/probe000001");
        const unknown = await call(server, "GET", "/media/nosuchmedia1");
        assert.equal(known.status, 401);
        assert.equal(unknown.status, known.status);
        assert.equal(unknown.text, known.text);
        const knownUrl = await call(server, "GET", "/media/probe000001/url");
        const unknownUrl = await call(server, "GET", "/media/nosuchmedia1/url");
        assert.equal(knownUrl.status, unknownUrl.status);
        assert.equal(knownUrl.text, unknownUrl.text);
    });

    test("listing a file in ?file= that you can open doesn't open media that isn't used in it", async () => {
        await put(server, "notinthere1", file.id, bytes, { token: owner.token });
        const other = await createFile(server, viewer.token, { doc: sampleDoc("Viewer's own") });
        assert.equal((await get(server, `/media/notinthere1?file=${other.id}`, viewer.token)).status, 403);
        // Several files, one of them a way in: allowed (at most four are looked at).
        assert.equal((await get(server, `/media/notinthere1?file=${other.id}&file=${file.id}`, viewer.token)).status, 200);
        const many = Array.from({ length: 4 }, () => `file=${other.id}`).join("&");
        assert.equal((await get(server, `/media/notinthere1?${many}&file=${file.id}`, viewer.token)).status, 403);
    });

    test("odd methods and ids", async () => {
        assert.equal((await call(server, "DELETE", "/media/upload00001", { token: owner.token })).status, 405);
        assert.equal((await call(server, "POST", "/media/upload00001", { token: owner.token })).status, 405);
        for (const id of ["short", "a".repeat(65), "with.dot01", "..%2Fsecret"]) assert.ok((await get(server, `/media/${id}?file=${file.id}`, owner.token)).status >= 400, id);
        assert.ok(server.alive());
    });
});
