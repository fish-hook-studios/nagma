// Email verification: sign-up makes an unverified account and keeps its link (NAGMA_DEV_MAIL_FILE=1);
// unverified accounts can't invite, share, publish, create or join teams; the link is single use and
// expires after a day; resends are limited; older accounts are verified on load; a password reset
// and an emailed invitation prove the address; server admins verify by hand; and
// NAGMA_REQUIRE_VERIFIED_EMAIL overrides the default.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call, createFile, signUp, startServer, verificationToken, verifyAccount, waitUntil } from "./helpers.mjs";
import { hashToken, resendWait, verifyRequired } from "../email-verification.mjs";

const readUsers = async (server) => JSON.parse(await readFile(join(server.dataDir, "users.json"), "utf8").catch(() => '{"users":[]}'));
const blocked = (r) => r.status === 403 && r.body?.code === "email-unverified";

describe("email verification: the rules", () => {
    test("required by default only when the server can deliver the link", () => {
        assert.equal(verifyRequired({}, false), false);
        assert.equal(verifyRequired({}, true), true);
        assert.equal(verifyRequired({ NAGMA_REQUIRE_VERIFIED_EMAIL: "1" }, false), true);
        assert.equal(verifyRequired({ NAGMA_REQUIRE_VERIFIED_EMAIL: "0" }, true), false);
    });

    test("resends: one a minute, five an hour", () => {
        const now = 10 * 60 * 60 * 1000;
        assert.equal(resendWait([], now), 0);
        assert.ok(resendWait([now - 10_000], now) > 0 && resendWait([now - 10_000], now) <= 50);
        assert.equal(resendWait([now - 61_000], now), 0);
        const five = [50, 40, 30, 20, 2].map((m) => now - m * 60 * 1000);
        // The oldest of the five ages out of the hour in 10 minutes.
        assert.equal(resendWait(five, now), 10 * 60);
        assert.equal(resendWait(five.slice(1), now), 0);
    });

    test("tokens are kept as a SHA-256", () => {
        assert.match(hashToken("abc"), /^[0-9a-f]{64}$/);
        assert.notEqual(hashToken("abc"), hashToken("abd"));
    });
});

describe("email verification with the development mail file", () => {
    let server, admin, newbie;
    before(async () => {
        server = await startServer({ NAGMA_DEV_MAIL_FILE: "1", NAGMA_PUBLIC_URL: "http://app.test" });
        admin = await signUp(server, "Admin");
        await verifyAccount(server, admin);
        newbie = await signUp(server, "Newbie");
    });
    after(async () => server?.stop());

    test("sign-up makes the account unverified and keeps a link, stored only as a hash", async () => {
        assert.equal(newbie.user.emailVerified, false);
        assert.equal(newbie.user.verifyRequired, true);
        const me = await call(server, "GET", "/auth/me", { token: newbie.token });
        assert.equal(me.body.emailVerified, false);
        assert.equal(me.body.mailReady, true);
        const token = await verificationToken(server, newbie.user.id);
        assert.equal(token.length, 43);
        const users = await waitUntil(async () => {
            const u = (await readUsers(server)).users.find((x) => x.id === newbie.user.id);
            return u?.verify ? u : null;
        });
        assert.equal(users.verify.hash, hashToken(token));
        assert.ok(!JSON.stringify(users).includes(token));
        assert.ok(users.verify.expires - Date.now() > 23 * 60 * 60 * 1000);
    });

    test("an unverified account keeps its drafts but can't invite, share, publish or make a team", async () => {
        const file = await createFile(server, newbie.token);
        assert.ok(file.id);
        assert.ok(blocked(await call(server, "PUT", `/files/${file.id}/access`, { token: newbie.token, body: { invite: { email: admin.email, role: "edit" } } })));
        assert.ok(blocked(await call(server, "PUT", `/files/${file.id}/access`, { token: newbie.token, body: { link: "view" } })));
        // Closing the link stays allowed.
        assert.equal((await call(server, "PUT", `/files/${file.id}/access`, { token: newbie.token, body: { link: "none" } })).status, 200);
        assert.ok(blocked(await call(server, "POST", "/teams", { token: newbie.token, body: { name: "Mine" } })));
        assert.ok(blocked(await call(server, "POST", "/community", { token: newbie.token, body: { fileId: file.id, name: "Look" } })));
        assert.ok(blocked(await call(server, "PUT", `/libraries/${file.id}`, { token: newbie.token, body: { manifest: {} } })));
        assert.ok(blocked(await call(server, "POST", `/files/${file.id}/site`, { token: newbie.token, body: { files: [] } })));
    });

    test("an unverified account can't join or be added to a team", async () => {
        const team = (await call(server, "POST", "/teams", { token: admin.token, body: { name: "Crew" } })).body;
        const add = await call(server, "PUT", `/teams/${team.id}`, { token: admin.token, body: { invite: { email: newbie.email, role: "edit" } } });
        assert.equal(add.status, 403);
        assert.equal(add.body.code, "invitee-unverified");
        const consoleInvite = await call(server, "POST", `/teams/${team.id}/admin/invite`, { token: admin.token, body: { emails: newbie.email } });
        assert.equal(consoleInvite.status, 200);
        assert.deepEqual(consoleInvite.body.unverified, [newbie.email]);
        const link = await call(server, "POST", `/teams/${team.id}/invites`, { token: admin.token, body: { role: "edit" } });
        assert.ok(blocked(await call(server, "POST", `/invites/${link.body.token}/accept`, { token: newbie.token })));
        const teams = await call(server, "GET", "/teams", { token: newbie.token });
        assert.deepEqual(teams.body, []);
    });

    test("resending waits a minute after the last mail", async () => {
        const r = await call(server, "POST", "/auth/verify/resend", { token: newbie.token, body: { origin: "http://app.test" } });
        assert.equal(r.status, 429);
        const wait = Number(r.headers.get("retry-after"));
        assert.ok(wait > 0 && wait <= 60, String(wait));
        assert.equal((await call(server, "POST", "/auth/verify/resend", {})).status, 401);
    });

    test("the link verifies and signs in on this device, once", async () => {
        const token = await verificationToken(server, newbie.user.id);
        const r = await call(server, "POST", "/auth/verify", { body: { token } });
        assert.equal(r.status, 200);
        assert.equal(r.body.user.emailVerified, true);
        assert.ok(r.body.token);
        const me = await call(server, "GET", "/auth/me", { token: r.body.token });
        assert.equal(me.body.emailVerified, true);
        assert.equal((await call(server, "POST", "/auth/verify", { body: { token } })).status, 400);
        assert.equal((await call(server, "POST", "/teams", { token: newbie.token, body: { name: "Now mine" } })).status, 200);
        // Verified accounts are told so when they ask again.
        assert.deepEqual((await call(server, "POST", "/auth/verify/resend", { token: newbie.token, body: {} })).body, { verified: true });
    });

    test("a made-up token is refused", async () => {
        assert.equal((await call(server, "POST", "/auth/verify", { body: { token: "x".repeat(43) } })).status, 400);
        assert.equal((await call(server, "POST", "/auth/verify", { body: {} })).status, 400);
    });

    test("a password reset proves the address", async () => {
        const who = await signUp(server, "Forgetful");
        await call(server, "POST", "/auth/reset-request", { body: { email: who.email, origin: "http://app.test" } });
        const token = await waitUntil(async () => {
            const text = await readFile(join(server.dataDir, "reset-links.txt"), "utf8").catch(() => "");
            return new RegExp(`password reset for ${who.email}: \\S*\\?reset=([A-Za-z0-9_-]+)`).exec(text)?.[1] ?? null;
        });
        const r = await call(server, "POST", "/auth/reset", { body: { token, password: "another long one" } });
        assert.equal(r.status, 200);
        assert.equal(r.body.user.emailVerified, true);
    });

    test("an emailed invitation's link proves the address at sign-up, and only that address", async () => {
        const file = await createFile(server, admin.token);
        const email = `invited${Date.now().toString(36)}@example.com`;
        assert.equal((await call(server, "PUT", `/files/${file.id}/access`, { token: admin.token, body: { invite: { email, role: "edit" } } })).status, 200);
        const token = await waitUntil(async () => {
            const text = await readFile(join(server.dataDir, "email-links.txt"), "utf8").catch(() => "");
            return new RegExp(`invitation for ${email}: \\S*email-token=([A-Za-z0-9_-]+)`).exec(text)?.[1] ?? null;
        });
        const wrong = await call(server, "POST", "/auth/signup", { body: { name: "Other", email: `other-${email}`, password: "correct horse battery", emailToken: token } });
        assert.equal(wrong.body.user.emailVerified, false);
        const right = await call(server, "POST", "/auth/signup", { body: { name: "Invited", email, password: "correct horse battery", emailToken: token } });
        assert.equal(right.status, 200);
        assert.equal(right.body.user.emailVerified, true);
        assert.equal(right.body.verification.sent, false);
        // Used up.
        const again = await call(server, "POST", "/auth/verify", { token: right.body.token, body: { token } });
        assert.equal(again.status, 400);
    });

    test("an existing unverified account invited by email verifies by opening the link signed in", async () => {
        const who = await signUp(server, "Existing");
        const file = await createFile(server, admin.token);
        await call(server, "PUT", `/files/${file.id}/access`, { token: admin.token, body: { invite: { email: who.email, role: "view" } } });
        const token = await waitUntil(async () => {
            const text = await readFile(join(server.dataDir, "email-links.txt"), "utf8").catch(() => "");
            return new RegExp(`invitation for ${who.email}: \\S*email-token=([A-Za-z0-9_-]+)`).exec(text)?.[1] ?? null;
        });
        // Signed out, the invitation's token doesn't sign anyone in.
        assert.equal((await call(server, "POST", "/auth/verify", { body: { token } })).status, 400);
        const r = await call(server, "POST", "/auth/verify", { token: who.token, body: { token } });
        assert.equal(r.status, 200);
        assert.equal(r.body.user.emailVerified, true);
        assert.equal(r.body.token, undefined);
    });
});

describe("email verification links expire", () => {
    let server, first;
    after(async () => Promise.all([first?.stop(), server?.stop()]));

    test("a link older than a day is refused and used up; a resend gives a fresh one", async () => {
        first = await startServer({ NAGMA_DEV_MAIL_FILE: "1" });
        const who = await signUp(first, "Late");
        const token = await verificationToken(first, who.user.id);
        await waitUntil(async () => (await readUsers(first)).users.find((u) => u.id === who.user.id)?.verify);
        await first.stop({ keep: true });
        const data = await readUsers(first);
        data.users.find((u) => u.id === who.user.id).verify.expires = Date.now() - 1000;
        await writeFile(join(first.dataDir, "users.json"), JSON.stringify(data));
        server = await startServer({ NAGMA_DEV_MAIL_FILE: "1" }, { dataDir: first.dataDir });
        first = null;
        const r = await call(server, "POST", "/auth/verify", { body: { token } });
        assert.equal(r.status, 400);
        assert.match(r.body.error, /expired/);
        assert.equal((await call(server, "GET", "/auth/me", { token: who.token })).body.emailVerified, false);
        // A restart forgets the resend times, so a new link can go at once.
        const resend = await call(server, "POST", "/auth/verify/resend", { token: who.token, body: {} });
        assert.equal(resend.status, 200);
        assert.equal(resend.body.kept, true);
        const fresh = await verificationToken(server, who.user.id);
        assert.notEqual(fresh, token);
        assert.equal((await call(server, "POST", "/auth/verify", { body: { token: fresh } })).status, 200);
    });
});

describe("accounts from before verification", () => {
    let server;
    after(async () => server?.stop());

    test("are verified when the server loads them", async () => {
        const dataDir = await mkdtemp(join(tmpdir(), "nagma-test-"));
        const { scryptSync } = await import("node:crypto");
        const salt = "c2FsdHNhbHRzYWx0c2FsdA==";
        const hash = scryptSync("old password 1", salt, 64).toString("base64");
        await writeFile(join(dataDir, "users.json"), JSON.stringify({ users: [{ id: "olduser01", name: "Old", email: "old@example.com", color: "#0D99FF", salt, hash, createdAt: 1 }], sessions: {} }));
        server = await startServer({ NAGMA_DEV_MAIL_FILE: "1" }, { dataDir });
        const r = await call(server, "POST", "/auth/signin", { body: { email: "old@example.com", password: "old password 1" } });
        assert.equal(r.status, 200);
        assert.equal(r.body.user.emailVerified, true);
        assert.equal((await call(server, "POST", "/teams", { token: r.body.token, body: { name: "Still works" } })).status, 200);
        const saved = await waitUntil(async () => (await readUsers(server)).users[0].emailVerified === true);
        assert.ok(saved);
    });
});

describe("email verification without mail", () => {
    let plain, strict, admin, newbie;
    before(async () => {
        [plain, strict] = await Promise.all([startServer(), startServer({ NAGMA_REQUIRE_VERIFIED_EMAIL: "1", NAGMA_ADMINS: "boss@example.com" })]);
        const r = await call(strict, "POST", "/auth/signup", { body: { name: "Boss", email: "boss@example.com", password: "correct horse battery" } });
        admin = { token: r.body.token, user: r.body.user };
        newbie = await signUp(strict, "Newbie");
    });
    after(async () => Promise.all([plain?.stop(), strict?.stop()]));

    test("a local server doesn't hold unverified accounts back", async () => {
        const who = await signUp(plain, "Solo");
        assert.equal(who.user.emailVerified, false);
        assert.equal(who.user.verifyRequired, false);
        assert.equal((await call(plain, "POST", "/teams", { token: who.token, body: { name: "Solo" } })).status, 200);
    });

    test("required without mail: no link is sent, resending says an admin must verify", async () => {
        assert.equal(newbie.user.verifyRequired, true);
        assert.equal(newbie.user.mailReady, false);
        assert.ok(blocked(await call(strict, "POST", "/teams", { token: newbie.token, body: { name: "No" } })));
        const r = await call(strict, "POST", "/auth/verify/resend", { token: newbie.token, body: {} });
        assert.equal(r.status, 409);
        assert.match(r.body.error, /admin/);
    });

    test("a server admin lists unverified accounts and verifies one; nobody else can", async () => {
        assert.equal((await call(strict, "GET", "/auth/admin/unverified", { token: newbie.token })).status, 403);
        assert.equal((await call(strict, "POST", "/auth/admin/verify", { token: newbie.token, body: { userId: newbie.user.id } })).status, 403);
        const list = await call(strict, "GET", "/auth/admin/unverified", { token: admin.token });
        assert.equal(list.status, 200);
        assert.ok(list.body.some((u) => u.id === newbie.user.id));
        assert.equal((await call(strict, "POST", "/auth/admin/verify", { token: admin.token, body: { userId: newbie.user.id } })).status, 200);
        assert.equal((await call(strict, "GET", "/auth/me", { token: newbie.token })).body.emailVerified, true);
        assert.equal((await call(strict, "POST", "/teams", { token: newbie.token, body: { name: "Yes" } })).status, 200);
        assert.equal((await call(strict, "POST", "/auth/admin/verify", { token: admin.token, body: { userId: "nobody123" } })).status, 404);
    });
});
