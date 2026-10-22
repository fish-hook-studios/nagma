// Email verification: on a server that can deliver mail, sign-up proves the address first with a
// six-digit code (kept as a hash, NAGMA_DEV_MAIL_FILE=1 writes it to the dev mail file) and the
// account only exists once the code comes back, verified; wrong codes are counted and resends
// limited; a pending sign-up expires; an emailed invitation proves the address at once; older
// accounts are verified on load; without mail the account is made and a server admin verifies it;
// and NAGMA_REQUIRE_VERIFIED_EMAIL overrides the default.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call, createFile, signUp, signupCode, startServer, waitUntil } from "./helpers.mjs";
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

describe("sign-up proves the address first (development mail file)", () => {
    let server, admin;
    before(async () => {
        server = await startServer({ NAGMA_DEV_MAIL_FILE: "1", NAGMA_PUBLIC_URL: "http://app.test" });
        admin = await signUp(server, "Admin");
    });
    after(async () => server?.stop());

    const start = (email, name = "Newbie") => call(server, "POST", "/auth/signup", { body: { name, email, password: "correct horse battery" } });

    test("sign-up answers pending, keeps a six-digit code (as a hash) and makes no account", async () => {
        const email = `pending${Date.now().toString(36)}@example.com`;
        const r = await start(email);
        assert.equal(r.status, 202);
        assert.deepEqual(Object.keys(r.body).sort(), ["email", "pending", "verification"]);
        assert.equal(r.body.verification.kept, true);
        const code = await signupCode(server, email);
        assert.match(code, /^\d{6}$/);
        assert.equal((await call(server, "POST", "/auth/signin", { body: { email, password: "correct horse battery" } })).status, 401);
        const data = await waitUntil(async () => { const d = await readUsers(server); return d.pending?.[email] ? d : null; });
        assert.ok(!data.users.some((u) => u.email === email));
        assert.ok(!JSON.stringify(data.pending[email]).includes(code));
        assert.equal(data.pending[email].codeHash, hashToken(`${email}:${code}`));
        assert.ok(data.pending[email].expires - Date.now() > 14 * 60 * 1000);
    });

    test("a wrong code is refused and counted; five of them end the sign-up", async () => {
        const email = `wrong${Date.now().toString(36)}@example.com`;
        await start(email);
        const code = await signupCode(server, email);
        const bad = String((Number(code) + 1) % 1000000).padStart(6, "0");
        for (let i = 1; i <= 4; i++) {
            const r = await call(server, "POST", "/auth/signup/confirm", { body: { email, code: bad } });
            assert.equal(r.status, 400);
            assert.match(r.body.error, new RegExp(`${5 - i} tr`));
        }
        assert.equal((await call(server, "POST", "/auth/signup/confirm", { body: { email, code: "12" } })).status, 400);
        const last = await call(server, "POST", "/auth/signup/confirm", { body: { email, code: bad } });
        assert.equal(last.status, 400);
        assert.match(last.body.error, /Too many wrong codes/);
        // Gone: even the right code can't make the account now.
        assert.match((await call(server, "POST", "/auth/signup/confirm", { body: { email, code } })).body.error, /expired/);
    });

    test("the right code makes a verified account, signs in, and is used up", async () => {
        const email = `right${Date.now().toString(36)}@example.com`;
        await start(email, "Right One");
        const code = await signupCode(server, email);
        const r = await call(server, "POST", "/auth/signup/confirm", { body: { email: email.toUpperCase(), code: ` ${code.slice(0, 3)} ${code.slice(3)} ` } });
        assert.equal(r.status, 200);
        assert.equal(r.body.user.emailVerified, true);
        assert.equal(r.body.user.name, "Right One");
        assert.ok(r.body.token);
        const me = await call(server, "GET", "/auth/me", { token: r.body.token });
        assert.equal(me.body.emailVerified, true);
        assert.equal((await call(server, "POST", "/teams", { token: r.body.token, body: { name: "Mine" } })).status, 200);
        assert.equal((await call(server, "POST", "/auth/signup/confirm", { body: { email, code } })).status, 400);
        assert.equal((await call(server, "POST", "/auth/signin", { body: { email, password: "correct horse battery" } })).status, 200);
    });

    test("resending waits a minute, and a sign-up nobody started can't be resent", async () => {
        const email = `again${Date.now().toString(36)}@example.com`;
        await start(email);
        const r = await call(server, "POST", "/auth/signup/resend", { body: { email } });
        assert.equal(r.status, 429);
        const wait = Number(r.headers.get("retry-after"));
        assert.ok(wait > 0 && wait <= 60, String(wait));
        assert.equal((await call(server, "POST", "/auth/signup/resend", { body: { email: "nobody@example.com" } })).status, 400);
        // Starting again within the minute waits too.
        assert.equal((await start(email)).status, 429);
    });

    test("a made-up link token is refused", async () => {
        assert.equal((await call(server, "POST", "/auth/verify", { body: { token: "x".repeat(43) } })).status, 400);
        assert.equal((await call(server, "POST", "/auth/verify", { body: {} })).status, 400);
    });

    test("an emailed invitation's link proves the address at sign-up at once, and only that address", async () => {
        const file = await createFile(server, admin.token);
        const email = `invited${Date.now().toString(36)}@example.com`;
        assert.equal((await call(server, "PUT", `/files/${file.id}/access`, { token: admin.token, body: { invite: { email, role: "edit" } } })).status, 200);
        const token = await waitUntil(async () => {
            const text = await readFile(join(server.dataDir, "email-links.txt"), "utf8").catch(() => "");
            return new RegExp(`invitation for ${email}: \\S*email-token=([A-Za-z0-9_-]+)`).exec(text)?.[1] ?? null;
        });
        // Another address with that token still has to prove itself with a code.
        const wrong = await call(server, "POST", "/auth/signup", { body: { name: "Other", email: `other-${email}`, password: "correct horse battery", emailToken: token } });
        assert.equal(wrong.status, 202);
        const right = await call(server, "POST", "/auth/signup", { body: { name: "Invited", email, password: "correct horse battery", emailToken: token } });
        assert.equal(right.status, 200);
        assert.equal(right.body.user.emailVerified, true);
        assert.equal(right.body.verification.sent, false);
        // Used up.
        assert.equal((await call(server, "POST", "/auth/verify", { token: right.body.token, body: { token } })).status, 400);
    });
});

describe("a pending sign-up expires", () => {
    let server, first;
    after(async () => Promise.all([first?.stop(), server?.stop()]));

    test("a code older than fifteen minutes is refused; starting again sends a new one", async () => {
        first = await startServer({ NAGMA_DEV_MAIL_FILE: "1" });
        const email = `late${Date.now().toString(36)}@example.com`;
        assert.equal((await call(first, "POST", "/auth/signup", { body: { name: "Late", email, password: "correct horse battery" } })).status, 202);
        const code = await signupCode(first, email);
        await waitUntil(async () => (await readUsers(first)).pending?.[email]);
        await first.stop({ keep: true });
        const data = await readUsers(first);
        data.pending[email].expires = Date.now() - 1000;
        await writeFile(join(first.dataDir, "users.json"), JSON.stringify(data));
        server = await startServer({ NAGMA_DEV_MAIL_FILE: "1" }, { dataDir: first.dataDir });
        first = null;
        const r = await call(server, "POST", "/auth/signup/confirm", { body: { email, code } });
        assert.equal(r.status, 400);
        assert.match(r.body.error, /expired/);
        assert.equal((await call(server, "POST", "/auth/signup", { body: { name: "Late", email, password: "correct horse battery" } })).status, 202);
        const fresh = await signupCode(server, email);
        assert.notEqual(fresh, code);
        assert.equal((await call(server, "POST", "/auth/signup/confirm", { body: { email, code: fresh } })).status, 200);
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
