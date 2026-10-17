// The product was called Migfa before it was Nagma: settings, tokens and apps from before the rename
// keep working (legacy-names.mjs).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LEGACY, adoptLegacyEnv } from "../legacy-names.mjs";
import { call, signUp, startServer } from "./helpers.mjs";

describe("names from before the rename", () => {
    test("MIGFA_* settings are read as NAGMA_* unless those are set, with one deprecation line", () => {
        const env = { MIGFA_PUBLIC_URL: "https://old.example", MIGFA_ADMINS: "a@x", NAGMA_ADMINS: "b@x", PATH: "/bin" };
        const lines = [];
        assert.deepEqual(adoptLegacyEnv(env, (l) => lines.push(l)), ["MIGFA_PUBLIC_URL"]);
        assert.equal(env.NAGMA_PUBLIC_URL, "https://old.example");
        assert.equal(env.NAGMA_ADMINS, "b@x");
        assert.equal(lines.length, 1);
        assert.match(lines[0], /Deprecated: MIGFA_PUBLIC_URL is read as NAGMA_PUBLIC_URL/);
        assert.deepEqual(adoptLegacyEnv(env, (l) => lines.push(l)), []);
        assert.equal(lines.length, 1);
    });

    describe("a running server", () => {
        let server, owner, dataDir;
        const legacyToken = `${LEGACY.tokenPrefix}${"k".repeat(40)}`;
        const appId = `app${Date.now().toString(36)}`;
        const form = (password) => ({ raw: `password=${encodeURIComponent(password)}`, headers: { "content-type": "application/x-www-form-urlencoded" } });
        before(async () => {
            server = await startServer();
            owner = await signUp(server, "Old Timer");
            // A token made before the rename: its hash is what the server keeps.
            const made = await call(server, "POST", "/account/tokens", { token: owner.token, body: { name: "new" } });
            assert.equal(made.status, 200);
            dataDir = server.dataDir;
            // Tokens are written a moment after the change.
            await new Promise((r) => setTimeout(r, 800));
            await server.stop({ keep: true });
            const file = join(dataDir, "tokens.json");
            const store = JSON.parse(await readFile(file, "utf8"));
            store.tokens.push({ ...store.tokens[0], id: "legacytoken1", name: "old", hint: legacyToken.slice(-4), hash: createHash("sha256").update(legacyToken).digest("hex") });
            await writeFile(file, JSON.stringify(store));
            server = await startServer({ MIGFA_PUBLIC_URL: "https://old.example/" }, { dataDir });
        });
        after(async () => server?.stop());

        test("reads MIGFA_PUBLIC_URL and says it's deprecated", async () => {
            assert.equal((await call(server, "GET", "/health")).body.publicUrl, "https://old.example");
            assert.match(server.logs(), /Deprecated: MIGFA_PUBLIC_URL/);
        });

        test("accepts access tokens with the old prefix, in the old header too", async () => {
            assert.equal((await call(server, "GET", "/v1/me", { token: legacyToken })).body.user.id, owner.user.id);
            assert.equal((await call(server, "GET", "/v1/me", { headers: { [LEGACY.tokenHeader]: legacyToken } })).status, 200);
            assert.equal((await call(server, "GET", "/v1/me", { token: `${LEGACY.tokenPrefix}forged` })).status, 401);
        });

        test("protected Make apps built before the rename find their token and may send it in the old header", async () => {
            assert.equal((await call(server, "POST", "/ai/make/backend", { token: owner.token, body: { appId } })).status, 200);
            const files = [{ path: "index.html", content: "<!doctype html><html><head><title>App</title></head><body>hi</body></html>" }];
            assert.equal((await call(server, "PUT", `/apps/${appId}`, { token: owner.token, body: { name: "App", files } })).status, 200);
            assert.equal((await call(server, "PUT", `/apps/${appId}/hosting`, { token: owner.token, body: { access: "password", password: "letmein" } })).status, 200);
            const unlocked = await call(server, "POST", `/apps/${appId}/`, form("letmein"));
            const cookie = unlocked.headers.get("set-cookie").split(";")[0];
            const page = await call(server, "GET", `/apps/${appId}/`, { headers: { cookie } });
            const token = new RegExp(`<meta name="${LEGACY.appTokenMeta}" content="([^"]+)">`).exec(page.text)?.[1];
            assert.ok(token, page.text);
            assert.equal((await call(server, "GET", `/app-data/${appId}/notes`, { headers: { [LEGACY.appTokenHeader]: token } })).status, 200);
            assert.equal((await call(server, "GET", `/app-data/${appId}/notes`, { headers: { [LEGACY.appTokenHeader]: "1.bad" } })).status, 401);
            const pre = await call(server, "OPTIONS", `/app-data/${appId}/notes`);
            assert.ok(pre.headers.get("access-control-allow-headers").includes(LEGACY.appTokenHeader));
        });
    });
});
