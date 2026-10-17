import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { call, startServer } from "./helpers.mjs";

describe("/health", () => {
    let plain, configured;
    before(async () => {
        [plain, configured] = await Promise.all([startServer({ NAGMA_PUBLIC_URL: "" }), startServer({ NAGMA_PUBLIC_URL: "https://nagma.example.com/", NAGMA_SERVER_NAME: "  Studio server  " })]);
    });
    after(async () => Promise.all([plain?.stop(), configured?.stop()]));

    test("reports the configured public address (without the trailing slash) for links that must not name this machine", async () => {
        assert.equal((await call(configured, "GET", "/health")).body.publicUrl, "https://nagma.example.com");
    });
    test("reports none when no public address is set", async () => {
        const r = await call(plain, "GET", "/health");
        assert.equal(r.status, 200);
        assert.equal(r.body.publicUrl, null);
        assert.ok(Array.isArray(r.body.addresses));
    });
    test("names the server for the apps' server picker: NAGMA_SERVER_NAME, trimmed, else Nagma", async () => {
        assert.equal((await call(configured, "GET", "/health")).body.name, "Studio server");
        assert.equal((await call(plain, "GET", "/health")).body.name, "Nagma");
    });
    test("reports the server's version, and any app may read it (the picker checks servers on other origins)", async () => {
        const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
        const res = await fetch(`${plain.url}/health`);
        assert.equal(res.headers.get("access-control-allow-origin"), "*");
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.equal(body.version, pkg.version);
    });
});
