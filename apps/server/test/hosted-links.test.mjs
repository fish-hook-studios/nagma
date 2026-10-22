// A server run for other people (like the hosted one) with NAGMA_PUBLIC_URL set: a file moved to it
// from the app (a sync hello carrying the document) gets links on that public address, never the
// address the server listens on (localhost, a LAN address): /health gives the app the address for
// share links, and the mail links (verification, invitations) use it. Sharing waits for a verified
// email when NAGMA_REQUIRE_VERIFIED_EMAIL=1. The public address is made up: nothing is reached.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { call, connect, readStored, sampleDoc, signupCode, startServer, waitUntil } from "./helpers.mjs";

const PUBLIC = "https://share.nagma.test";
const mailLines = async (server) => (await readFile(join(server.dataDir, "email-links.txt"), "utf8").catch(() => "")).split("\n").filter(Boolean);
const LOCAL = /localhost|127\.0\.0\.1|\[::1\]|\/\/10\.|\/\/192\.168\.|\/\/172\.(1[6-9]|2\d|3[01])\./;

describe("links from a server with a public address", () => {
    let server, owner, fileId;
    before(async () => {
        server = await startServer({ NAGMA_PUBLIC_URL: PUBLIC, NAGMA_DEV_MAIL_FILE: "1", NAGMA_REQUIRE_VERIFIED_EMAIL: "1", NAGMA_SERVER_NAME: "Nagma" });
        // The app signs up with the server's public address as the origin for mail links; the
        // address is proven with a code before the account exists.
        const email = `owner${Date.now()}@example.com`;
        assert.equal((await call(server, "POST", "/auth/signup", { body: { name: "Owner", email, password: "correct horse battery", origin: PUBLIC } })).status, 202);
        const r = await call(server, "POST", "/auth/signup/confirm", { body: { email, code: await signupCode(server, email) } });
        assert.equal(r.status, 200);
        owner = { token: r.body.token, user: r.body.user, email };
    });
    after(async () => server?.stop());

    test("/health names the public address the app builds share links on", async () => {
        const r = await call(server, "GET", "/health");
        assert.equal(r.body.ok, true);
        assert.equal(r.body.name, "Nagma");
        assert.equal(r.body.publicUrl, PUBLIC);
    });

    test("the sign-up code was kept for the address, and the account is verified from the start", async () => {
        const line = await waitUntil(async () => (await mailLines(server)).find((l) => l.includes(`sign-up code for ${owner.email}:`)), 4000, "sign-up code");
        assert.match(line, /: \d{6} \(valid 15 minutes\)/);
        assert.equal(owner.user.emailVerified, true);
    });

    test("a file moved there (a hello with its document) belongs to the account", async () => {
        fileId = `moved${Date.now().toString(36)}`.slice(0, 16);
        const client = await connect(server, fileId, { token: owner.token, initial: sampleDoc("Poster"), name: "Owner" });
        assert.equal(client.first.type, "snapshot");
        await client.close();
        const stored = await readStored(server, fileId, (f) => f.owner === owner.user.id);
        assert.equal(stored.doc.name, "Poster");
    });

    test("sharing it works at once, since the address was proven at sign-up", async () => {
        const r = await call(server, "PUT", `/files/${fileId}/access`, { token: owner.token, body: { link: "view" } });
        assert.equal(r.status, 200);
    });

    test("an invitation's link is on the public address, with the file", async () => {
        const friend = `friend${Date.now()}@example.com`;
        const r = await call(server, "PUT", `/files/${fileId}/access`, { token: owner.token, body: { invite: { email: friend, role: "edit" } } });
        assert.equal(r.status, 200, r.text);
        const line = await waitUntil(async () => (await mailLines(server)).find((l) => l.includes(`invitation for ${friend}:`)), 4000, "invitation link");
        const link = new URL(/(https?:\/\/\S+)/.exec(line.slice(line.indexOf(friend)))?.[1] ?? "");
        assert.equal(link.origin, PUBLIC);
        assert.equal(link.searchParams.get("file"), fileId);
        assert.doesNotMatch(link.href, LOCAL);
        const open = await call(server, "PUT", `/files/${fileId}/access`, { token: owner.token, body: { link: "view" } });
        assert.equal(open.status, 200);
        assert.equal(open.body.link, "view");
    });
});
