import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { call, createFile, readStored, signUp, startServer } from "./helpers.mjs";

// Usage, counted on the server: app loads and distinct devices per day (salted hashes, no address
// kept), sign-ups, files made; read by server admins only at /auth/admin/stats.
describe("usage stats", () => {
    let server, boss, other;
    before(async () => {
        server = await startServer({ NAGMA_ADMINS: "boss@example.com" });
        const r = await call(server, "POST", "/auth/signup", { body: { name: "Boss", email: "boss@example.com", password: "correct horse battery" } });
        boss = { token: r.body.token, user: r.body.user };
        other = await signUp(server, "Other");
    });
    after(async () => server?.stop());

    const page = (ua) => fetch(`${server.url}/`, { headers: { accept: "text/html,application/xhtml+xml", "user-agent": ua } });

    test("only a server admin can read them", async () => {
        assert.equal((await call(server, "GET", "/auth/admin/stats", { token: other.token })).status, 403);
        assert.equal((await call(server, "GET", "/auth/admin/stats")).status, 403);
        assert.equal((await call(server, "GET", "/auth/admin/stats", { token: boss.token })).status, 200);
    });

    test("counts the app's page served to a browser, and the distinct devices behind the loads", async () => {
        await page("Browser A");
        await page("Browser A");
        await page("Browser B");
        // Assets and JSON probes are not loads.
        await fetch(`${server.url}/health`);
        await fetch(`${server.url}/assets/app.js`);
        const r = await call(server, "GET", "/auth/admin/stats", { token: boss.token });
        const today = r.body.days.find((d) => d.day === r.body.today);
        assert.equal(today.loads, 3);
        assert.equal(today.devices, 2);
    });

    test("counts sign-ups, verified accounts and files made, and the totals", async () => {
        const a = await createFile(server, boss.token);
        const b = await createFile(server, other.token);
        // Files reach the disk in a batch; the total counts what is on disk.
        await readStored(server, a.id);
        await readStored(server, b.id);
        const r = await call(server, "GET", "/auth/admin/stats", { token: boss.token });
        const today = r.body.days.find((d) => d.day === r.body.today);
        assert.equal(today.signups, 2);
        assert.equal(today.files, 2);
        assert.equal(r.body.totals.accounts, 2);
        assert.equal(r.body.totals.files, 2);
        assert.ok(r.body.now && typeof r.body.now.connections === "number");
        assert.equal(typeof r.body.since, "string");
    });

    test("keeps no address: the stored day holds hashes under a salt and nothing else", async () => {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        await new Promise((r) => setTimeout(r, 900));
        const stored = JSON.parse(await readFile(join(server.dataDir, "stats.json"), "utf8"));
        const day = Object.values(stored.days)[0];
        assert.ok(Array.isArray(day.seen) && day.seen.length === 2);
        assert.ok(day.seen.every((h) => /^[A-Za-z0-9_-]{22}$/.test(h)));
        assert.ok(!JSON.stringify(stored).includes("127.0.0.1"));
        assert.ok(!JSON.stringify(stored).includes("Browser A"));
    });
});
