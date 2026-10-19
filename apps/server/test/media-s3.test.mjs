// Media in an S3-compatible bucket (media-store.mjs), against the stand-in in stand-in-s3.mjs:
// browsers upload straight to the bucket with presigned addresses and read from it the same way,
// so the bytes never pass through the server; the server checks access, signs, keeps each asset's
// record, removes uploads never completed, holds the size and rate limits, and moves media between
// disk and bucket (media-migrate.mjs). Also the local store's side of the same questions.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { call, createFile, sampleDoc, signUp, sleep, startServer, waitUntil } from "./helpers.mjs";
import { startStandInS3 } from "./stand-in-s3.mjs";
import { presignUrl } from "../media-store.mjs";
import { migrateMedia } from "../media-migrate.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const q = (fileId, extra = {}) => `?${new URLSearchParams({ file: fileId, ...extra })}`;

async function ask(server, id, fileId, bytes, { token, type = "image/png", sha256 = sha(bytes), size = bytes.length, key } = {}) {
    return call(server, "POST", `/media/${id}/upload${q(fileId, key ? { key } : {})}`, { token, body: { type, size, sha256 } });
}

// The whole direct flow: ask, PUT to the presigned address, complete.
async function directUpload(server, id, fileId, bytes, opts = {}) {
    const asked = await ask(server, id, fileId, bytes, opts);
    if (asked.status !== 200 || asked.body.mode !== "direct") return { asked };
    const put = await fetch(asked.body.url, { method: "PUT", headers: asked.body.headers, body: bytes });
    const done = await call(server, "POST", `/media/${id}/complete${q(fileId)}`, { token: opts.token, body: { sha256: sha(bytes) } });
    return { asked, put, done };
}

const meta = async (server, id) => JSON.parse(await readFile(join(server.dataDir, "media", `${id}.meta.json`), "utf8").catch(() => "null"));
// After a restart: a fresh session (the last one may not have reached the disk).
async function signIn(server, account) {
    const r = await call(server, "POST", "/auth/signin", { body: { email: account.email, password: account.password } });
    assert.equal(r.status, 200, r.text);
    return r.body.token;
}

test("presigned addresses match AWS's published Signature Version 4 example", () => {
    const url = presignUrl({ method: "GET", base: "https://examplebucket.s3.amazonaws.com", key: "test.txt", region: "us-east-1", accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", expires: 86400, now: new Date("2013-05-24T00:00:00Z") });
    assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
});

describe("media in a bucket", () => {
    let s3, server, owner, editor, viewer, stranger, file;
    const bytes = Buffer.from("\x89PNG direct upload bytes, never through the server");
    before(async () => {
        s3 = await startStandInS3();
        server = await startServer(s3.env());
        owner = await signUp(server, "Owner");
        editor = await signUp(server, "Editor");
        viewer = await signUp(server, "Viewer");
        stranger = await signUp(server, "Stranger");
        file = await createFile(server, owner.token, { doc: sampleDoc("Bucket file") });
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { invite: { email: editor.email, role: "edit" }, link: "none" } });
        await call(server, "PUT", `/files/${file.id}/access`, { token: owner.token, body: { invite: { email: viewer.email, role: "view" } } });
    });
    after(async () => {
        await server?.stop();
        await s3?.stop();
    });

    test("a direct upload: presigned PUT to the bucket, then complete records it", async () => {
        const before = s3.requests.length;
        const { asked, put, done } = await directUpload(server, "direct00001", file.id, bytes, { token: editor.token });
        assert.equal(asked.status, 200);
        assert.equal(asked.body.mode, "direct");
        assert.ok(asked.body.url.startsWith(`${s3.url}/nagma/direct00001?`));
        assert.match(asked.body.url, /X-Amz-Signature=/);
        assert.deepEqual(asked.body.headers, { "content-type": "image/png" });
        assert.ok(asked.body.expires > Date.now() && asked.body.expires <= Date.now() + 10 * 60 * 1000 + 1000);
        assert.equal(put.status, 200);
        assert.equal(done.status, 200, done.text);
        assert.equal(done.body.size, bytes.length);
        // The bytes reached the bucket from the client; the server only HEADed the object.
        const seen = s3.requests.slice(before);
        assert.deepEqual(seen.map((r) => `${r.method} ${r.key} ${r.bytes}`), [`PUT direct00001 ${bytes.length}`, "HEAD direct00001 0"]);
        assert.deepEqual(s3.objects.get("direct00001").body, bytes);
        const m = await meta(server, "direct00001");
        assert.equal(m.pending, undefined);
        assert.deepEqual({ type: m.type, size: m.size, files: m.files, by: m.by, sha256: m.sha256, store: m.store }, { type: "image/png", size: bytes.length, files: [file.id], by: editor.user.id, sha256: sha(bytes), store: "s3" });
        // Completing again is harmless.
        assert.equal((await call(server, "POST", `/media/direct00001/complete${q(file.id)}`, { token: editor.token, body: {} })).body.existing, true);
    });

    test("asking to upload needs an account with edit access, a media type and a size", async () => {
        assert.equal((await ask(server, "askupload01", file.id, bytes, {})).status, 401);
        assert.equal((await ask(server, "askupload01", file.id, bytes, { token: viewer.token })).status, 403);
        assert.equal((await ask(server, "askupload01", file.id, bytes, { token: stranger.token })).status, 403);
        assert.equal((await ask(server, "askupload01", "nosuchfile1", bytes, { token: owner.token })).status, 403);
        assert.equal((await ask(server, "askupload01", file.id, bytes, { token: owner.token, type: "not a type" })).status, 400);
        assert.equal((await ask(server, "askupload01", file.id, bytes, { token: owner.token, size: -1 })).status, 400);
        assert.equal((await call(server, "GET", `/media/askupload01/upload${q(file.id)}`, { token: owner.token })).status, 405);
        // Nothing was presigned for any of those.
        assert.equal(await meta(server, "askupload01"), null);
    });

    test("the bucket refuses presigned addresses that were changed, and a type other than the one signed", async () => {
        const asked = await ask(server, "tamper00001", file.id, bytes, { token: owner.token });
        const u = new URL(asked.body.url);
        const other = new URL(u);
        other.pathname = "/nagma/someoneelse1";
        assert.equal((await fetch(other, { method: "PUT", headers: asked.body.headers, body: bytes })).status, 403);
        const longer = new URL(u);
        longer.searchParams.set("X-Amz-Expires", "604800");
        assert.equal((await fetch(longer, { method: "PUT", headers: asked.body.headers, body: bytes })).status, 403);
        assert.equal((await fetch(u, { method: "PUT", headers: { "content-type": "text/html" }, body: bytes })).status, 403);
        assert.equal((await fetch(u, { method: "GET" })).status, 403);
        assert.equal(s3.objects.has("someoneelse1"), false);
        // Not uploaded: completing says so, and the asset isn't there for anyone.
        const done = await call(server, "POST", `/media/tamper00001/complete${q(file.id)}`, { token: owner.token, body: {} });
        assert.equal(done.status, 409);
        assert.equal((await call(server, "GET", `/media/tamper00001${q(file.id)}`, { token: owner.token })).status, 404);
        // Only the uploader completes it, and someone else can't take the id meanwhile.
        assert.equal((await call(server, "POST", `/media/tamper00001/complete${q(file.id)}`, { token: editor.token, body: {} })).status, 403);
        assert.equal((await ask(server, "tamper00001", file.id, bytes, { token: editor.token })).status, 409);
        assert.equal((await call(server, "POST", "/media/nosuchupload/complete", { token: owner.token, body: {} })).status, 404);
    });

    test("reads: a short-lived bucket address after the access check, or a redirect to one", async () => {
        await directUpload(server, "reads000001", file.id, bytes, { token: owner.token, type: "video/mp4" });
        const made = await call(server, "GET", `/media/reads000001/url${q(file.id)}`, { token: viewer.token });
        assert.equal(made.status, 200);
        assert.ok(made.body.url.startsWith(`${s3.url}/nagma/reads000001?`));
        assert.ok(made.body.expires > Date.now() && made.body.expires <= Date.now() + 11 * 60 * 1000);
        const got = await fetch(made.body.url);
        assert.equal(got.status, 200);
        assert.deepEqual(Buffer.from(await got.arrayBuffer()), bytes);
        // GET /media/<id> (an <img> or <video>, older apps) redirects there.
        const r = await call(server, "GET", `/media/reads000001${q(file.id)}`, { token: viewer.token });
        assert.equal(r.status, 302);
        assert.ok(r.headers.get("location").startsWith(`${s3.url}/nagma/reads000001?`));
        assert.equal(r.headers.get("cache-control"), "private, no-store");
        // Seeking in a video: ranges come straight from the bucket.
        const part = await fetch(r.headers.get("location"), { headers: { range: "bytes=5-14" } });
        assert.equal(part.status, 206);
        assert.equal(part.headers.get("content-range"), `bytes 5-14/${bytes.length}`);
        assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(5, 15));
        // The server's own signed addresses (made earlier, or by older apps) redirect too.
        const secret = await readFile(join(server.dataDir, "secret.key"));
        const exp = Date.now() + 60_000;
        const sig = createHmac("sha256", secret).update(`media:reads000001:${exp}`).digest("base64url");
        const signedLocal = await call(server, "GET", `/media/reads000001?exp=${exp}&sig=${sig}`);
        assert.equal(signedLocal.status, 302);
        assert.ok(signedLocal.headers.get("location").startsWith(`${s3.url}/nagma/reads000001?`));
    });

    test("no access: 401 or 403, and never a signed address", async () => {
        await directUpload(server, "private0001", file.id, bytes, { token: owner.token });
        const cases = [
            ["guest", undefined, `?file=${file.id}`, 401],
            ["guest, no file", undefined, "", 401],
            ["guest with the view key while the link is off", undefined, `?file=${file.id}&key=${file.keys.view}`, 403],
            ["stranger", stranger.token, `?file=${file.id}`, 403],
            ["owner, no file", owner.token, "", 403],
        ];
        for (const [label, token, query, status] of cases) {
            for (const path of [`/media/private0001${query}`, `/media/private0001/url${query}`]) {
                const r = await call(server, "GET", path, { token });
                assert.equal(r.status, status, `${label} ${path}`);
                assert.equal(r.headers.get("location"), null, label);
                assert.doesNotMatch(r.text, /X-Amz|127\.0\.0\.1/, label);
            }
        }
        // An upload not completed isn't readable, even by its uploader.
        await ask(server, "unfinished1", file.id, Buffer.from("not finished"), { token: owner.token });
        assert.equal((await call(server, "GET", `/media/unfinished1/url${q(file.id)}`, { token: owner.token })).status, 404);
        assert.equal((await call(server, "GET", "/media/unfinished1")).status, 401);
    });

    test("the same bytes from the same person are stored once; from someone else, again", async () => {
        const once = Buffer.from("the same picture, uploaded twice");
        await directUpload(server, "dedupe00001", file.id, once, { token: owner.token });
        const objects = s3.objects.size;
        const again = await ask(server, "dedupe00002", file.id, once, { token: owner.token });
        assert.equal(again.body.mode, "exists");
        assert.equal(again.body.deduped, true);
        assert.equal(s3.objects.size, objects);
        assert.equal((await meta(server, "dedupe00002")).object, "dedupe00001");
        const r = await call(server, "GET", `/media/dedupe00002/url${q(file.id)}`, { token: viewer.token });
        assert.deepEqual(Buffer.from(await (await fetch(r.body.url)).arrayBuffer()), once);
        // Another person claiming the same hash doesn't get the stored object: they upload.
        const other = await ask(server, "dedupe00003", file.id, once, { token: editor.token });
        assert.equal(other.body.mode, "direct");
    });

    test("an older app's PUT still works, and the bytes go to the bucket", async () => {
        const old = Buffer.from("sent the old way");
        const r = await fetch(`${server.url}/media/oldclient01${q(file.id)}`, { method: "PUT", body: old, headers: { "content-type": "image/gif", authorization: `Bearer ${owner.token}` } });
        assert.equal(r.status, 200);
        assert.deepEqual(s3.objects.get("oldclient01").body, old);
        assert.equal((await meta(server, "oldclient01")).store, "s3");
        assert.equal((await stat(join(server.dataDir, "media", "oldclient01")).catch(() => null)), null);
    });

    test("a type that would run as a page is a download from the bucket", async () => {
        await directUpload(server, "htmlinbuck1", file.id, Buffer.from("<script>alert(1)</script>"), { token: owner.token, type: "text/html" });
        const r = await call(server, "GET", `/media/htmlinbuck1/url${q(file.id)}`, { token: owner.token });
        const got = await fetch(r.body.url);
        assert.equal(got.headers.get("content-disposition"), "attachment");
    });

    test("browsers may upload from any origin the bucket's CORS rules allow", async () => {
        const pre = await fetch(`${s3.url}/nagma/anything01`, { method: "OPTIONS", headers: { origin: "http://localhost:5300", "access-control-request-method": "PUT", "access-control-request-headers": "content-type" } });
        assert.equal(pre.status, 200);
        assert.equal(pre.headers.get("access-control-allow-origin"), "*");
        assert.match(pre.headers.get("access-control-allow-methods"), /PUT/);
    });
});

describe("media in a bucket: public addresses", () => {
    let s3, server, owner, open, closed;
    before(async () => {
        s3 = await startStandInS3({ publicRead: true });
        server = await startServer(s3.env({ NAGMA_S3_PUBLIC_URL: `${s3.url}/nagma`, NAGMA_S3_PREFIX: "m" }));
        owner = await signUp(server, "Owner");
        open = await createFile(server, owner.token, { doc: sampleDoc("Link on") });
        closed = await createFile(server, owner.token, { doc: sampleDoc("Link off") });
        await call(server, "PUT", `/files/${open.id}/access`, { token: owner.token, body: { link: "view" } });
        await call(server, "PUT", `/files/${closed.id}/access`, { token: owner.token, body: { link: "none" } });
    });
    after(async () => {
        await server?.stop();
        await s3?.stop();
    });

    test("a file whose link is on reads from the public address; otherwise presigned", async () => {
        const b = Buffer.from("public picture");
        await directUpload(server, "public00001", open.id, b, { token: owner.token });
        assert.ok(s3.objects.has("m/public00001"), "kept under the prefix");
        const viaKey = await call(server, "GET", `/media/public00001/url${q(open.id, { key: open.keys.view })}`);
        assert.equal(viaKey.body.url, `${s3.url}/nagma/m/public00001`);
        assert.deepEqual(Buffer.from(await (await fetch(viaKey.body.url)).arrayBuffer()), b);
        await directUpload(server, "private0002", closed.id, b, { token: owner.token });
        const presigned = await call(server, "GET", `/media/private0002/url${q(closed.id)}`, { token: owner.token });
        assert.match(presigned.body.url, /X-Amz-Signature=/);
        // The guest with the key still needs the file's access to get even the public address.
        assert.equal((await call(server, "GET", `/media/private0002/url${q(closed.id, { key: closed.keys.view })}`)).status, 403);
    });
});

describe("media limits and cleanup", () => {
    let s3, server, owner, file, other;
    const KB = 1024;
    before(async () => {
        s3 = await startStandInS3();
        // 8 KB per file, 20 KB per file in all, 6 uploads or 40 KB an hour; unfinished uploads go after ~0.7 s.
        server = await startServer(s3.env({ NAGMA_MEDIA_MAX_MB: String(8 / 1024), NAGMA_FILE_MEDIA_MAX_MB: String(20 / 1024), NAGMA_MEDIA_UPLOADS_PER_HOUR: "6", NAGMA_MEDIA_MB_PER_HOUR: String(40 / 1024), NAGMA_MEDIA_PENDING_HOURS: String(0.7 / 3600), NAGMA_MEDIA_GC_MINUTES: String(0.3 / 60) }));
        owner = await signUp(server, "Owner");
        file = await createFile(server, owner.token);
        other = await createFile(server, owner.token);
    });
    after(async () => {
        await server?.stop();
        await s3?.stop();
    });

    test("uploads never completed are removed, bytes and record", async () => {
        const b = Buffer.alloc(KB, 1);
        const asked = await ask(server, "abandoned01", other.id, b, { token: owner.token });
        assert.equal((await fetch(asked.body.url, { method: "PUT", headers: asked.body.headers, body: b })).status, 200);
        assert.ok(s3.objects.has("abandoned01"));
        await waitUntil(async () => !s3.objects.has("abandoned01") && !(await meta(server, "abandoned01")), 6000, "the unfinished upload to go");
        assert.equal((await call(server, "POST", `/media/abandoned01/complete${q(other.id)}`, { token: owner.token, body: {} })).status, 404);
        assert.match(server.logs(), /removed 1 upload never completed/);
    });

    test("too large for one upload, or for the file, says so", async () => {
        const big = await ask(server, "toobig00001", file.id, Buffer.alloc(9 * KB), { token: owner.token });
        assert.equal(big.status, 413);
        assert.match(big.body.error, /Media files can be up to 8 KB on this server; this one is 9 KB\./);
        // Saying it's small and sending more: refused when completing, and the object removed.
        const liar = Buffer.alloc(9 * KB, 2);
        const asked = await ask(server, "liar0000001", file.id, Buffer.alloc(KB), { token: owner.token });
        await fetch(asked.body.url, { method: "PUT", headers: asked.body.headers, body: liar });
        const done = await call(server, "POST", `/media/liar0000001/complete${q(file.id)}`, { token: owner.token, body: {} });
        assert.equal(done.status, 413);
        assert.equal(s3.objects.has("liar0000001"), false);
        assert.equal(await meta(server, "liar0000001"), null);
        // 20 KB per file: two of 8 KB fit, a third doesn't.
        for (const id of ["fits0000001", "fits0000002"]) assert.equal((await directUpload(server, id, file.id, Buffer.alloc(8 * KB, id.length + Number(id.at(-1))), { token: owner.token })).done.status, 200);
        const third = await ask(server, "fits0000003", file.id, Buffer.alloc(8 * KB, 9), { token: owner.token });
        assert.equal(third.status, 413);
        assert.match(third.body.error, /This file has reached its media limit/);
    });

    test("uploads per account per hour, by count and by bytes", async () => {
        // Used so far: abandoned01, liar0000001, fits 1 and 2 (four of six).
        const fresh = await createFile(server, owner.token);
        assert.equal((await ask(server, "rate0000001", fresh.id, Buffer.alloc(KB, 3), { token: owner.token })).body.mode, "direct");
        assert.equal((await ask(server, "rate0000002", fresh.id, Buffer.alloc(KB, 4), { token: owner.token })).body.mode, "direct");
        const over = await ask(server, "rate0000003", fresh.id, Buffer.alloc(KB, 5), { token: owner.token });
        assert.equal(over.status, 429);
        assert.match(over.body.error, /upload limit \(6 uploads an hour\)\. Try again in \d+ minutes?\./);
        assert.ok(Number(over.headers.get("retry-after")) > 0);
        // Someone else isn't held up by it.
        const someone = await signUp(server, "Someone");
        const theirs = await createFile(server, someone.token);
        assert.equal((await ask(server, "rate0000004", theirs.id, Buffer.alloc(KB, 6), { token: someone.token })).body.mode, "direct");
    });
});

describe("media on the server's disk (the local store)", () => {
    let server, owner, file;
    before(async () => {
        server = await startServer({ NAGMA_MEDIA_MAX_MB: String(16 / 1024), NAGMA_MEDIA_UPLOADS_PER_HOUR: "3" });
        owner = await signUp(server, "Owner");
        file = await createFile(server, owner.token);
    });
    after(async () => server?.stop());

    test("the upload question answers 'send it here', and the same bytes again need nothing", async () => {
        const b = Buffer.from("local bytes for a video");
        const asked = await ask(server, "localask001", file.id, b, { token: owner.token });
        assert.deepEqual(asked.body.mode, "server");
        const put = await fetch(`${server.url}/media/localask001${q(file.id)}`, { method: "PUT", body: b, headers: { "content-type": "video/mp4", authorization: `Bearer ${owner.token}` } });
        assert.equal(put.status, 200);
        assert.equal((await meta(server, "localask001")).sha256, sha(b));
        const again = await ask(server, "localask002", file.id, b, { token: owner.token });
        assert.equal(again.body.mode, "exists");
        const r = await fetch(`${server.url}/media/localask002${q(file.id)}`, { headers: { authorization: `Bearer ${owner.token}` } });
        assert.deepEqual(Buffer.from(await r.arrayBuffer()), b);
        // /url is the server's own signed address.
        const made = await call(server, "GET", `/media/localask001/url${q(file.id)}`, { token: owner.token });
        assert.match(made.body.url, /^\/media\/localask001\?exp=\d+&sig=/);
    });

    test("ranges, for seeking in a video", async () => {
        const r = await fetch(`${server.url}/media/localask001${q(file.id)}`, { headers: { authorization: `Bearer ${owner.token}`, range: "bytes=6-10" } });
        assert.equal(r.status, 206);
        assert.equal(r.headers.get("content-range"), "bytes 6-10/23");
        assert.equal(Buffer.from(await r.arrayBuffer()).toString(), "bytes");
        const tail = await fetch(`${server.url}/media/localask001${q(file.id)}`, { headers: { authorization: `Bearer ${owner.token}`, range: "bytes=-5" } });
        assert.equal(Buffer.from(await tail.arrayBuffer()).toString(), "video");
        const bad = await fetch(`${server.url}/media/localask001${q(file.id)}`, { headers: { authorization: `Bearer ${owner.token}`, range: "bytes=99-" } });
        assert.equal(bad.status, 416);
    });

    test("the size and rate limits hold for uploads to the server too", async () => {
        const big = await fetch(`${server.url}/media/localbig001${q(file.id)}`, { method: "PUT", body: Buffer.alloc(17 * 1024), headers: { "content-type": "video/mp4", authorization: `Bearer ${owner.token}` } });
        assert.equal(big.status, 413);
        assert.match((await big.json()).error, /can be up to/);
        // Three an hour: one used above (the dedupe counts as one more).
        for (const id of ["localrate01"]) assert.equal((await fetch(`${server.url}/media/${id}${q(file.id)}`, { method: "PUT", body: Buffer.from(id), headers: { authorization: `Bearer ${owner.token}` } })).status, 200);
        const over = await fetch(`${server.url}/media/localrate02${q(file.id)}`, { method: "PUT", body: Buffer.from("x"), headers: { authorization: `Bearer ${owner.token}` } });
        assert.equal(over.status, 429);
        assert.match((await over.json()).error, /upload limit/);
    });
});

describe("moving media between disk and bucket", () => {
    let s3, server, owner, file, dataDir;
    const items = { migrate0001: Buffer.from("first picture"), migrate0002: Buffer.from("second, a video"), migrate0003: Buffer.from("third") };
    const quiet = () => undefined;
    before(async () => {
        s3 = await startStandInS3();
        server = await startServer();
        dataDir = server.dataDir;
        owner = await signUp(server, "Owner");
        file = await createFile(server, owner.token);
        for (const [id, b] of Object.entries(items)) {
            const r = await fetch(`${server.url}/media/${id}${q(file.id)}`, { method: "PUT", body: b, headers: { "content-type": "image/png", authorization: `Bearer ${owner.token}` } });
            assert.equal(r.status, 200);
        }
    });
    after(async () => {
        await server?.stop();
        await s3?.stop();
    });

    test("--to s3 copies everything, can run again, and a server on the bucket redirects to it", async () => {
        const one = await migrateMedia({ to: "s3", dataDir, env: s3.env(), log: quiet });
        assert.equal(one.copied, 3);
        assert.deepEqual(s3.objects.get("migrate0002").body, items.migrate0002);
        assert.equal((await meta(server, "migrate0001")).store, "s3");
        const again = await migrateMedia({ to: "s3", dataDir, env: s3.env(), log: quiet });
        assert.deepEqual([again.copied, again.skipped], [0, 3]);
        // A server on the bucket now: moved assets redirect; one only on its disk still streams.
        await sleep(700); // accounts and files reach the disk 100 and 400 ms after the last change
        await server.stop({ keep: true });
        server = await startServer(s3.env(), { dataDir });
        owner.token = await signIn(server, owner);
        const r1 = await call(server, "GET", `/media/migrate0001${q(file.id)}`, { token: owner.token });
        assert.equal(r1.status, 302);
        assert.deepEqual(Buffer.from(await (await fetch(r1.headers.get("location"))).arrayBuffer()), items.migrate0001);
    });

    test("--remove deletes each source copy once the destination has it; --to local brings them back", async () => {
        const { writeFile } = await import("node:fs/promises");
        // An asset still only on disk (a record from before the move, no store).
        await writeFile(join(dataDir, "media", "diskonly002"), "still on disk");
        await writeFile(join(dataDir, "media", "diskonly002.meta.json"), JSON.stringify({ type: "image/png", size: 13, files: [file.id], by: owner.user.id, at: Date.now() }));
        const r0 = await call(server, "GET", `/media/diskonly002${q(file.id)}`, { token: owner.token });
        assert.equal(r0.status, 200, "served from disk while not moved");
        assert.equal(r0.text, "still on disk");
        const moved = await migrateMedia({ to: "s3", dataDir, env: s3.env(), remove: true, log: quiet });
        assert.ok(moved.copied >= 1);
        assert.equal(await stat(join(dataDir, "media", "diskonly002")).catch(() => null), null);
        assert.equal(await stat(join(dataDir, "media", "migrate0001")).catch(() => null), null);
        const r1 = await call(server, "GET", `/media/diskonly002${q(file.id)}`, { token: owner.token });
        assert.equal(r1.status, 302);
        // And back.
        const back = await migrateMedia({ to: "local", dataDir, env: s3.env(), remove: true, log: quiet });
        assert.equal(back.failed, 0);
        assert.equal(await readFile(join(dataDir, "media", "migrate0001"), "utf8"), "first picture");
        assert.equal((await meta(server, "migrate0001")).store, undefined);
        assert.equal(s3.objects.size, 0);
        assert.equal((await migrateMedia({ to: "local", dataDir, env: s3.env(), log: quiet })).copied, 0);
        await sleep(700); // accounts and files reach the disk 100 and 400 ms after the last change
        await server.stop({ keep: true });
        server = await startServer({}, { dataDir });
        owner.token = await signIn(server, owner);
        const r2 = await fetch(`${server.url}/media/migrate0002${q(file.id)}`, { headers: { authorization: `Bearer ${owner.token}` } });
        assert.equal(r2.status, 200);
        assert.deepEqual(Buffer.from(await r2.arrayBuffer()), items.migrate0002);
    });

    test("without bucket settings it says what's missing", async () => {
        await assert.rejects(migrateMedia({ to: "s3", dataDir, env: {}, log: quiet }), /NAGMA_S3_ENDPOINT/);
        await assert.rejects(migrateMedia({ to: "elsewhere", dataDir, env: s3.env(), log: quiet }), /--to s3 or --to local/);
    });
});
