// Requests built to break things: paths that try to leave their folder (raw, so nothing normalises
// them on the way), malformed percent-encoding, oversized and malformed bodies, prototype-named keys.
// After each group the server must still be up.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { connect as netConnect } from "node:net";
import { join } from "node:path";
import { call, createFile, signUp, startServer } from "./helpers.mjs";

// One HTTP/1.1 request with the path exactly as given. Resolves to { status, headers, body }.
function raw(server, method, path, { headers = {}, body = "" } = {}) {
    return new Promise((resolve, reject) => {
        const socket = netConnect(server.port, "127.0.0.1");
        let data = Buffer.alloc(0);
        socket.on("data", (d) => (data = Buffer.concat([data, d])));
        socket.on("error", reject);
        socket.on("close", () => {
            const text = data.toString("latin1");
            const [head, ...rest] = text.split("\r\n\r\n");
            const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(head)?.[1] ?? 0);
            resolve({ status, head, body: rest.join("\r\n\r\n") });
        });
        const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("");
        socket.write(`${method} ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n${extra}${body ? `Content-Length: ${Buffer.byteLength(body)}\r\n` : ""}\r\n${body}`);
    });
}

describe("robustness", () => {
    let server, a;
    before(async () => {
        server = await startServer();
        a = await signUp(server, "Robust");
        // A built app to serve, and secrets beside it that must never be served.
        await mkdir(join(server.dataDir, "no-static", "assets"), { recursive: true });
        await writeFile(join(server.dataDir, "no-static", "index.html"), "<!doctype html><title>app</title>");
        await writeFile(join(server.dataDir, "no-static", "assets", "a.js"), "console.log(1)");
        await writeFile(join(server.dataDir, "SECRET-OUTSIDE.json"), '{"secret":"do-not-serve"}');
    });
    after(async () => server?.stop());

    const leaks = (r) => /do-not-serve|"salt"|"sessions"|BEGIN|root:/.test(r.body);

    test("the static app: traversal in every spelling stays inside (index.html or 403/404)", async () => {
        const ok = await raw(server, "GET", "/assets/a.js");
        assert.equal(ok.status, 200);
        assert.match(ok.body, /console\.log/);
        const paths = [
            "/../SECRET-OUTSIDE.json",
            "/../../../../etc/passwd",
            "/%2e%2e/SECRET-OUTSIDE.json",
            "/%2e%2e%2fSECRET-OUTSIDE.json",
            "/..%2fSECRET-OUTSIDE.json",
            "/..%2f..%2f..%2fetc%2fpasswd",
            "/assets/..%2f..%2fSECRET-OUTSIDE.json",
            "/%252e%252e/SECRET-OUTSIDE.json",
            "/..\\SECRET-OUTSIDE.json",
            "/..%5cSECRET-OUTSIDE.json",
            "//etc/passwd",
            "/%2fetc%2fpasswd",
            "/assets/a.js%00.png",
            "/users.json",
            "/secret.key",
        ];
        for (const p of paths) {
            const r = await raw(server, "GET", p);
            assert.ok([200, 400, 403, 404].includes(r.status), `${p}: ${r.status}`);
            assert.ok(!leaks(r), `${p} leaked`);
            if (r.status === 200) assert.match(r.body, /<title>app<\/title>|console\.log/, p);
        }
        assert.ok(server.alive());
    });

    // Regression: a path with broken percent-encoding threw in decodeURIComponent; the rejection
    // wasn't handled and the server exited (no sign-in needed).
    test("malformed percent-encoding answers 400/404 and the server stays up", async () => {
        for (const p of ["/%E0%A4%A", "/%", "/assets/%ZZ", "/apps/abcdefg/%E0%A4%A", "/apps/abcdefg/%", "/sites/abcdefg/%E0%A4%A", "/s/my-site/%E0", "/files/%E0/access", "/media/%ZZ"]) {
            const r = await raw(server, "GET", p);
            assert.ok(r.status >= 300 && r.status < 500, `${p}: ${r.status}`);
            assert.ok(server.alive(), `${p} took the server down:\n${server.logs().slice(-800)}`);
        }
    });

    test("published apps: files stay inside the app's folder", async () => {
        const put = await call(server, "PUT", "/apps/robustapp1", { token: a.token, body: { files: [{ path: "index.html", content: "<p>app</p>" }, { path: "src/x.js", content: "1" }] } });
        assert.equal(put.status, 200);
        assert.match((await raw(server, "GET", "/apps/robustapp1/")).body, /<p>app<\/p>/);
        for (const p of ["/apps/robustapp1/..%2fmeta.json", "/apps/robustapp1/..%2f..%2f..%2fusers.json", "/apps/robustapp1/%2e%2e/meta.json", "/apps/robustapp1/src/..%2f..%2fmeta.json", "/apps/robustapp1/..%5c..%5cusers.json"]) {
            const r = await raw(server, "GET", p);
            assert.ok(!r.body.includes('"owner"') && !leaks(r), `${p}: ${r.status} ${r.body.slice(0, 80)}`);
        }
        // Publishing refuses paths that leave the folder.
        for (const path of ["../meta.json", "a/../../x", "/abs.html", "a//b.html", "./x.html", "a\\b.html"]) {
            const r = await call(server, "PUT", "/apps/robustapp2", { token: a.token, body: { files: [{ path: "index.html", content: "x" }, { path, content: "x" }] } });
            assert.equal(r.status, 400, path);
        }
    });

    test("sites: publishing refuses paths outside the site; serving stays inside", async () => {
        const f = await createFile(server, a.token, { doc: { name: "Site", roots: [], nodes: {}, site: { pages: [] } } });
        const b64 = (s) => Buffer.from(s).toString("base64");
        for (const path of ["../x.html", "a/../../x.html", "/x.html", ".site.json", "x.php", "a//b.html"]) {
            const r = await call(server, "POST", `/files/${f.id}/site`, { token: a.token, body: { files: [{ path, data: b64("x") }] } });
            assert.equal(r.status, 400, path);
        }
        const ok = await call(server, "POST", `/files/${f.id}/site`, { token: a.token, body: { files: [{ path: "index.html", data: b64("<h1>site</h1>") }] } });
        assert.equal(ok.status, 200);
        assert.match((await raw(server, "GET", `/sites/${f.id}/`)).body, /<h1>site<\/h1>/);
        for (const p of [`/sites/${f.id}/.site.json`, `/sites/${f.id}/..%2f..%2fusers.json`, `/sites/${f.id}/%2e%2e/%2e%2e/users.json`, `/sites/${f.id}/index.html%00`, `/sites/${f.id}/..%5cusers.json`]) {
            const r = await raw(server, "GET", p);
            assert.equal(r.status, 404, p);
            assert.ok(!leaks(r) && !r.body.includes("publishedAt"), p);
        }
        // Viewers can't publish.
        const v = await signUp(server, "SiteViewer");
        await call(server, "PUT", `/files/${f.id}/access`, { token: a.token, body: { invite: { email: v.email, role: "view" } } });
        assert.equal((await call(server, "POST", `/files/${f.id}/site`, { token: v.token, body: { files: [{ path: "index.html", data: b64("x") }] } })).status, 403);
        assert.equal((await call(server, "DELETE", `/files/${f.id}/site`, { token: v.token })).status, 403);
    });

    // Regression: the app backend kept collections in a plain object, so a collection named
    // "__proto__" or "constructor" read Object.prototype or Object itself and the next call threw;
    // the rejection wasn't handled and the server exited. Anyone could do it once a backend existed.
    test("app backend collections named like prototype properties don't crash the server", async () => {
        assert.equal((await call(server, "POST", "/ai/make/backend", { token: a.token, body: { appId: "backendapp1" } })).status, 200);
        assert.equal((await call(server, "POST", "/app-data/backendapp1/todos", { body: { title: "one" } })).status, 200);
        for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
            for (const [method, path, body] of [["GET", `/app-data/backendapp1/${name}`], ["GET", `/app-data/backendapp1/${name}/abc`], ["POST", `/app-data/backendapp1/${name}`, { x: 1 }], ["PUT", `/app-data/backendapp1/${name}/abc`, { x: 1 }], ["DELETE", `/app-data/backendapp1/${name}/abc`]]) {
                const r = await call(server, method, path, { body });
                assert.ok(r.status < 500, `${method} ${path}: ${r.status}`);
                assert.ok(server.alive(), `${method} ${path} took the server down:\n${server.logs().slice(-600)}`);
            }
        }
        const list = await call(server, "GET", "/app-data/backendapp1/todos");
        assert.equal(list.body.length, 1);
        // Item bodies with __proto__ keys stay plain data.
        const p = await call(server, "POST", "/app-data/backendapp1/todos", { raw: '{"__proto__":{"admin":true},"title":"two"}', headers: { "content-type": "application/json" } });
        assert.equal(p.status, 200);
        assert.equal((await call(server, "GET", "/app-data/backendapp1/todos")).body.length, 2);
        // Someone else can't take over the backend.
        const b = await signUp(server, "Taker");
        assert.equal((await call(server, "POST", "/ai/make/backend", { token: b.token, body: { appId: "backendapp1" } })).status, 403);
        assert.equal((await call(server, "POST", "/ai/make/backend", { body: { appId: "backendapp2" } })).status, 401);
    });

    // Regression: a body over a route's limit destroyed the connection, so the 413 (or 400) the
    // route meant to send never arrived and callers saw a network error instead.
    test("oversized bodies get a clean error answer (no reset) and the server stays up", async () => {
        const cases = [
            ["POST", "/auth/signup", 200_000, [400, 413]],
            ["POST", "/auth/signin", 200_000, [400, 413]],
            ["PUT", "/apps/bigapp001", 9_000_000, [413]],
            ["PUT", "/account/tokens", 100_000, [400, 405, 413]],
            ["POST", "/account/tokens", 100_000, [400, 413]],
        ];
        for (const [method, path, size, statuses] of cases) {
            const r = await call(server, method, path, { token: a.token, raw: JSON.stringify({ name: "x".repeat(size), files: [] }), headers: { "content-type": "application/json" } });
            assert.ok(statuses.includes(r.status), `${method} ${path}: ${r.status} ${r.text.slice(0, 80)}`);
            assert.ok(r.body?.error || r.text, path);
        }
        const f = await createFile(server, a.token);
        const meta = await call(server, "PUT", `/files/${f.id}/meta`, { token: a.token, raw: JSON.stringify({ thumb: `data:image/png;base64,${"A".repeat(5_000_000)}` }), headers: { "content-type": "application/json" } });
        assert.ok([400, 413].includes(meta.status), String(meta.status));
        assert.ok(server.alive());
        // And the connection after it works.
        assert.equal((await call(server, "GET", "/auth/me", { token: a.token })).status, 200);
    });

    test("malformed JSON bodies answer 400 (or are ignored) everywhere, and the server stays up", async () => {
        const f = await createFile(server, a.token);
        const team = (await call(server, "POST", "/teams", { token: a.token, body: { name: "JSON team" } })).body;
        const routes = [
            ["POST", "/auth/signup"],
            ["POST", "/auth/signin"],
            ["POST", "/files"],
            ["PUT", `/files/${f.id}/access`],
            ["PUT", `/files/${f.id}/meta`],
            ["POST", `/files/${f.id}/requests`],
            ["POST", `/files/${f.id}/unlock`],
            ["PUT", `/libraries/${f.id}`],
            ["POST", `/libraries/${f.id}/items/get`],
            ["PUT", `/libraries/${f.id}/items`],
            ["POST", "/account/tokens"],
            ["PUT", "/account"],
            ["POST", "/teams"],
            ["PUT", `/teams/${team.id}`],
            ["POST", `/teams/${team.id}/admin/settings`],
            ["PUT", `/teams/${team.id}/integrations`],
            ["PUT", `/teams/${team.id}/saml`],
            ["POST", "/community"],
            ["PUT", `/files/${f.id}/site/settings`],
            ["POST", "/ai/make/backend"],
            ["PUT", "/apps/jsonapp01"],
            ["POST", "/notifications/reply"],
            ["PUT", `/asset-templates/tmpl000001`],
        ];
        for (const body of ["{bad", "[1,2", "\u0000", "nul", '{"a":1}}', '"\\ud800"']) {
            for (const [method, path] of routes) {
                const r = await call(server, method, path, { token: a.token, raw: body, headers: { "content-type": "application/json" } });
                assert.ok(r.status < 500, `${method} ${path} with ${JSON.stringify(body)}: ${r.status} ${r.text.slice(0, 120)}`);
            }
            assert.ok(server.alive(), server.logs().slice(-600));
        }
        // JSON that parses to null, a number or an array instead of an object.
        for (const body of ["null", "42", "[]", '"text"', "true"]) {
            for (const [method, path] of routes) {
                const r = await call(server, method, path, { token: a.token, raw: body, headers: { "content-type": "application/json" } });
                assert.ok(r.status < 500, `${method} ${path} with ${body}: ${r.status} ${r.text.slice(0, 120)}`);
                assert.ok(server.alive(), `${method} ${path} with ${body} took the server down:\n${server.logs().slice(-800)}`);
            }
        }
    });

    test("prototype-named keys in request bodies don't change other accounts or teams", async () => {
        const team = (await call(server, "POST", "/teams", { token: a.token, body: { name: "Proto team" } })).body;
        const r1 = await call(server, "PUT", `/teams/${team.id}`, { token: a.token, raw: '{"role":{"userId":"__proto__","role":"admin"},"remove":"__proto__","invite":{"email":"__proto__@x.com"}}', headers: { "content-type": "application/json" } });
        assert.ok(r1.status < 500);
        const r2 = await call(server, "POST", `/teams/${team.id}/admin/role`, { token: a.token, body: { userId: "constructor", role: "admin" } });
        assert.ok(r2.status < 500);
        const r3 = await call(server, "PUT", "/account", { token: a.token, raw: '{"__proto__":{"isAdmin":true},"name":"Still me","notify":{"__proto__":{"email":false}}}', headers: { "content-type": "application/json" } });
        assert.equal(r3.status, 200);
        assert.equal(r3.body.isAdmin, undefined);
        const b = await signUp(server, "Fresh");
        const me = await call(server, "GET", "/account", { token: b.token });
        assert.equal(me.body.isAdmin, undefined);
        assert.equal(me.body.notify.comments.email, true);
        const t = await call(server, "GET", `/teams/${team.id}`, { token: a.token });
        assert.deepEqual(t.body.members.map((m) => m.id), [a.user.id]);
        assert.ok(server.alive());
    });

    test("methods a route doesn't take answer 4xx, not 5xx", async () => {
        const f = await createFile(server, a.token);
        for (const [method, path] of [["PATCH", "/files"], ["DELETE", "/files"], ["PUT", "/auth/signin"], ["DELETE", `/files/${f.id}/requests`], ["PATCH", `/media/abcdefgh`], ["POST", `/libraries/${f.id}`], ["TRACE", "/"], ["DELETE", "/v1/files"], ["POST", "/v1/me"]]) {
            const r = await call(server, method, path, { token: a.token }).catch((e) => ({ status: 0, text: String(e) }));
            assert.ok(r.status === 0 || r.status < 500, `${method} ${path}: ${r.status}`);
        }
        assert.ok(server.alive());
    });
});
