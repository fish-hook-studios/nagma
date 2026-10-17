// Accounts: sign up, sign in, sign out, validation, rate limits, sessions (list, revoke, idle
// expiry), password change, email change and password reset through the dev mail file.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { call, signUp, sleep, startServer, waitUntil } from "./helpers.mjs";

// Every request here comes from 127.0.0.1, and failed attempts count per address too, so each
// scenario that fails on purpose speaks from its own forwarded address (TRUST_PROXY=1).
let ipCounter = 1;
const freshIp = () => ({ "x-forwarded-for": `10.9.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}` });

describe("auth", () => {
    let server;
    before(async () => (server = await startServer({ TRUST_PROXY: "1", NAGMA_DEV_MAIL_FILE: "1" })));
    after(async () => server?.stop());

    test("sign up returns a session and the public user (no hash or salt)", async () => {
        const r = await call(server, "POST", "/auth/signup", { body: { name: "  Ada  ", email: "  ADA@Example.COM ", password: "longenough1" }, headers: freshIp() });
        assert.equal(r.status, 200);
        assert.ok(r.body.token.length >= 30);
        assert.equal(r.body.user.email, "ada@example.com");
        assert.equal(r.body.user.name, "Ada");
        assert.equal(r.body.user.hash, undefined);
        assert.equal(r.body.user.salt, undefined);
        const me = await call(server, "GET", "/auth/me", { token: r.body.token });
        assert.equal(me.status, 200);
        assert.equal(me.body.email, "ada@example.com");
    });

    const badSignups = [
        ["no name", { name: "", email: "a1@example.com", password: "longenough1" }, 400],
        ["spaces-only name", { name: "   ", email: "a2@example.com", password: "longenough1" }, 400],
        ["no email", { name: "A", password: "longenough1" }, 400],
        ["email without @", { name: "A", email: "nope.example.com", password: "longenough1" }, 400],
        ["email without dot", { name: "A", email: "a@localhost", password: "longenough1" }, 400],
        ["email with space", { name: "A", email: "a b@example.com", password: "longenough1" }, 400],
        ["short password", { name: "A", email: "a3@example.com", password: "short" }, 400],
        ["7-char password", { name: "A", email: "a4@example.com", password: "1234567" }, 400],
        ["object as email", { name: "A", email: { $ne: 1 }, password: "longenough1" }, 400],
        ["array as name", { name: [], email: "a5@example.com", password: "longenough1" }, 400],
    ];
    for (const [label, body, status] of badSignups) {
        test(`sign up refuses ${label}`, async () => {
            const r = await call(server, "POST", "/auth/signup", { body, headers: freshIp() });
            assert.equal(r.status, status, r.text);
            assert.ok(r.body.error);
        });
    }

    test("sign up refuses a duplicate email, whatever its case", async () => {
        const a = await signUp(server, "Dup");
        const r = await call(server, "POST", "/auth/signup", { body: { name: "Other", email: a.email.toUpperCase(), password: "longenough1" }, headers: freshIp() });
        assert.equal(r.status, 409);
        // The first account's password still works; the second wasn't made.
        const s = await call(server, "POST", "/auth/signin", { body: { email: a.email, password: a.password }, headers: freshIp() });
        assert.equal(s.status, 200);
        assert.equal(s.body.user.name, "Dup");
    });

    test("malformed JSON to sign up and sign in answers 400 and the server stays up", async () => {
        for (const path of ["/auth/signup", "/auth/signin", "/auth/password", "/auth/reset"]) {
            const r = await call(server, "POST", path, { raw: "{not json", headers: { "content-type": "application/json", ...freshIp() } });
            assert.equal(r.status, 400, path);
        }
        assert.ok(server.alive());
    });

    test("sign in: right password, wrong password, unknown account, case-insensitive email", async () => {
        const a = await signUp(server, "Signer");
        const ip = freshIp();
        const ok = await call(server, "POST", "/auth/signin", { body: { email: a.email.toUpperCase(), password: a.password }, headers: ip });
        assert.equal(ok.status, 200);
        assert.notEqual(ok.body.token, a.token);
        const wrong = await call(server, "POST", "/auth/signin", { body: { email: a.email, password: "wrong password" }, headers: ip });
        assert.equal(wrong.status, 401);
        const unknown = await call(server, "POST", "/auth/signin", { body: { email: "nobody-here@example.com", password: "whatever1" }, headers: ip });
        assert.equal(unknown.status, 401);
        // The same message either way: no account enumeration.
        assert.equal(wrong.body.error, unknown.body.error);
        const empty = await call(server, "POST", "/auth/signin", { body: {}, headers: ip });
        assert.equal(empty.status, 401);
    });

    test("five wrong passwords for one account lock it with 429 and Retry-After, from any address", async () => {
        const a = await signUp(server, "Locked");
        for (let i = 0; i < 5; i++) {
            const r = await call(server, "POST", "/auth/signin", { body: { email: a.email, password: `wrong${i}xxx` }, headers: freshIp() });
            assert.equal(r.status, 401, `attempt ${i}`);
        }
        // The sixth failure starts the back-off.
        const sixth = await call(server, "POST", "/auth/signin", { body: { email: a.email, password: "wrong6xxx" }, headers: freshIp() });
        assert.equal(sixth.status, 401);
        const locked = await call(server, "POST", "/auth/signin", { body: { email: a.email, password: a.password }, headers: freshIp() });
        assert.equal(locked.status, 429);
        const retry = Number(locked.headers.get("retry-after"));
        assert.ok(retry >= 1 && retry <= 2, `retry-after ${retry}`);
        assert.equal(locked.body.retryAfter, retry);
        // After the wait, the right password works and clears the account's count.
        await sleep(retry * 1000 + 100);
        const ok = await call(server, "POST", "/auth/signin", { body: { email: a.email, password: a.password }, headers: freshIp() });
        assert.equal(ok.status, 200);
    });

    test("ten failures from one address lock that address for every account", async () => {
        const ip = freshIp();
        for (let i = 0; i < 11; i++) await call(server, "POST", "/auth/signin", { body: { email: `ghost${i}@example.com`, password: "nopenope" }, headers: ip });
        const b = await signUp(server, "Innocent");
        const r = await call(server, "POST", "/auth/signin", { body: { email: b.email, password: b.password }, headers: ip });
        assert.equal(r.status, 429);
        assert.ok(Number(r.headers.get("retry-after")) >= 1);
        // Another address is unaffected.
        const other = await call(server, "POST", "/auth/signin", { body: { email: b.email, password: b.password }, headers: freshIp() });
        assert.equal(other.status, 200);
    });

    test("sign out ends that session only", async () => {
        const a = await signUp(server, "Leaver");
        const second = await call(server, "POST", "/auth/signin", { body: { email: a.email, password: a.password }, headers: freshIp() });
        const out = await call(server, "POST", "/auth/signout", { token: a.token });
        assert.equal(out.status, 200);
        assert.equal((await call(server, "GET", "/auth/me", { token: a.token })).status, 401);
        assert.equal((await call(server, "GET", "/auth/me", { token: second.body.token })).status, 200);
        // Signing out again (or with no token) is harmless.
        assert.equal((await call(server, "POST", "/auth/signout", { token: a.token })).status, 200);
        assert.equal((await call(server, "POST", "/auth/signout")).status, 200);
    });

    test("odd bearer tokens are not sessions (prototype names, empty, huge)", async () => {
        for (const token of ["__proto__", "constructor", "toString", "hasOwnProperty", "x".repeat(5000)]) {
            const r = await call(server, "GET", "/auth/me", { token });
            assert.equal(r.status, 401, token.slice(0, 20));
            const f = await call(server, "GET", "/files", { token });
            assert.equal(f.status, 200);
            assert.deepEqual(f.body, []);
        }
        const r = await call(server, "GET", "/auth/me?token=__proto__");
        assert.equal(r.status, 401);
        assert.ok(server.alive());
    });

    test("session list marks the current one and revoking ends the others", async () => {
        const a = await signUp(server, "Multi");
        const s2 = (await call(server, "POST", "/auth/signin", { body: { email: a.email, password: a.password }, headers: freshIp() })).body.token;
        const s3 = (await call(server, "POST", "/auth/signin", { body: { email: a.email, password: a.password }, headers: freshIp() })).body.token;
        const list = await call(server, "GET", "/auth/sessions", { token: a.token });
        assert.equal(list.status, 200);
        assert.equal(list.body.length, 3);
        assert.equal(list.body.filter((s) => s.current).length, 1);
        // Tokens themselves are never listed.
        assert.ok(!JSON.stringify(list.body).includes(s2));
        for (const s of list.body) assert.ok(s.expiresAt > Date.now());
        const del = await call(server, "DELETE", "/auth/sessions", { token: a.token });
        assert.equal(del.status, 200);
        assert.equal(del.body.ended, 2);
        assert.equal((await call(server, "GET", "/auth/me", { token: s2 })).status, 401);
        assert.equal((await call(server, "GET", "/auth/me", { token: s3 })).status, 401);
        assert.equal((await call(server, "GET", "/auth/me", { token: a.token })).status, 200);
        assert.equal((await call(server, "GET", "/auth/sessions")).status, 401);
        // Someone else's sessions are untouched.
        const b = await signUp(server, "Bystander");
        await call(server, "DELETE", "/auth/sessions", { token: a.token });
        assert.equal((await call(server, "GET", "/auth/me", { token: b.token })).status, 200);
    });

    test("password change needs the current password and a valid new one, and signs out other sessions", async () => {
        const a = await signUp(server, "Changer");
        const h = freshIp();
        assert.equal((await call(server, "POST", "/auth/password", { body: { current: "x", password: "newpassword1" } })).status, 401);
        const wrong = await call(server, "POST", "/auth/password", { token: a.token, body: { current: "not it at all", password: "newpassword1" }, headers: h });
        assert.equal(wrong.status, 401);
        const short = await call(server, "POST", "/auth/password", { token: a.token, body: { current: a.password, password: "short" }, headers: h });
        assert.equal(short.status, 400);
        const other = (await call(server, "POST", "/auth/signin", { body: { email: a.email, password: a.password }, headers: freshIp() })).body.token;
        const ok = await call(server, "POST", "/auth/password", { token: a.token, body: { current: a.password, password: "newpassword1" }, headers: h });
        assert.equal(ok.status, 200);
        // Regression: other sessions (a stolen one, say) used to survive a password change.
        assert.equal((await call(server, "GET", "/auth/me", { token: other })).status, 401);
        assert.equal((await call(server, "GET", "/auth/me", { token: a.token })).status, 200);
        assert.equal((await call(server, "POST", "/auth/signin", { body: { email: a.email, password: a.password }, headers: freshIp() })).status, 401);
        assert.equal((await call(server, "POST", "/auth/signin", { body: { email: a.email, password: "newpassword1" }, headers: freshIp() })).status, 200);
    });

    test("email change: needs the password, mails a link (kept in the dev mail file), the link switches sign-in", async () => {
        const a = await signUp(server, "Mover");
        const taken = await signUp(server, "Taken");
        const next = `moved${Date.now()}@example.org`;
        const h = freshIp();
        assert.equal((await call(server, "POST", "/account/email", { token: a.token, body: { email: "bad", password: a.password }, headers: h })).status, 400);
        assert.equal((await call(server, "POST", "/account/email", { token: a.token, body: { email: a.email, password: a.password }, headers: h })).status, 400);
        assert.equal((await call(server, "POST", "/account/email", { token: a.token, body: { email: taken.email, password: a.password }, headers: h })).status, 409);
        assert.equal((await call(server, "POST", "/account/email", { token: a.token, body: { email: next, password: "wrong one" }, headers: h })).status, 401);
        const r = await call(server, "POST", "/account/email", { token: a.token, body: { email: next, password: a.password, origin: "http://app.test" }, headers: h });
        assert.equal(r.status, 200);
        assert.equal(r.body.emailPending, next);
        assert.equal(r.body.kept, true);
        assert.equal(r.body.sent, false);
        // Not changed yet.
        assert.equal((await call(server, "GET", "/auth/me", { token: a.token })).body.email, a.email);
        const lines = await waitUntil(async () => (await readFile(join(server.dataDir, "email-links.txt"), "utf8").catch(() => "")).split("\n").filter((l) => l.includes(a.user.id)));
        const token = /verify-email=([A-Za-z0-9_-]+)/.exec(lines.at(-1))[1];
        assert.ok(lines.at(-1).startsWith(new Date().getFullYear().toString()));
        assert.ok(lines.at(-1).includes("http://app.test/?verify-email="));
        // A wrong token does nothing.
        assert.equal((await call(server, "POST", "/account/email/verify", { body: { token: "nope" } })).status, 400);
        assert.equal((await call(server, "POST", "/account/email/verify", { body: {} })).status, 400);
        const v = await call(server, "POST", "/account/email/verify", { body: { token } });
        assert.equal(v.status, 200);
        assert.equal(v.body.email, next);
        // The link works once.
        assert.equal((await call(server, "POST", "/account/email/verify", { body: { token } })).status, 400);
        assert.equal((await call(server, "GET", "/auth/me", { token: a.token })).body.email, next);
        assert.equal((await call(server, "POST", "/auth/signin", { body: { email: next, password: a.password }, headers: freshIp() })).status, 200);
        assert.equal((await call(server, "POST", "/auth/signin", { body: { email: a.email, password: a.password }, headers: freshIp() })).status, 401);
    });

    test("email change: a confirmation link loses to an account that took the address meanwhile", async () => {
        const a = await signUp(server, "Slow");
        const next = `race${Date.now()}@example.org`;
        await call(server, "POST", "/account/email", { token: a.token, body: { email: next, password: a.password }, headers: freshIp() });
        const lines = await waitUntil(async () => (await readFile(join(server.dataDir, "email-links.txt"), "utf8").catch(() => "")).split("\n").filter((l) => l.includes(a.user.id)));
        const token = /verify-email=([A-Za-z0-9_-]+)/.exec(lines.at(-1))[1];
        const r = await call(server, "POST", "/auth/signup", { body: { name: "Quick", email: next, password: "longenough1" }, headers: freshIp() });
        assert.equal(r.status, 200);
        assert.equal((await call(server, "POST", "/account/email/verify", { body: { token } })).status, 409);
    });

    test("password reset: answers the same for unknown accounts, the kept link resets once and ends other sessions", async () => {
        const a = await signUp(server, "Forgetful");
        const unknown = await call(server, "POST", "/auth/reset-request", { body: { email: "nobody-at-all@example.com" }, headers: freshIp() });
        const known = await call(server, "POST", "/auth/reset-request", { body: { email: a.email, origin: "http://app.test" }, headers: freshIp() });
        assert.equal(unknown.status, 200);
        assert.deepEqual(unknown.body, known.body);
        const lines = await waitUntil(async () => (await readFile(join(server.dataDir, "reset-links.txt"), "utf8").catch(() => "")).split("\n").filter((l) => l.includes(a.email)));
        const token = /reset=([A-Za-z0-9_-]+)/.exec(lines.at(-1))[1];
        assert.equal((await call(server, "POST", "/auth/reset", { body: { token: "bogus", password: "brandnew123" } })).status, 400);
        assert.equal((await call(server, "POST", "/auth/reset", { body: { token, password: "short" } })).status, 400);
        const r = await call(server, "POST", "/auth/reset", { body: { token, password: "brandnew123" } });
        assert.equal(r.status, 200);
        assert.ok(r.body.token);
        assert.equal((await call(server, "GET", "/auth/me", { token: a.token })).status, 401);
        assert.equal((await call(server, "POST", "/auth/reset", { body: { token, password: "another123" } })).status, 400);
        assert.equal((await call(server, "POST", "/auth/signin", { body: { email: a.email, password: "brandnew123" }, headers: freshIp() })).status, 200);
    });

    test("account deletion needs the password and removes sessions and owned files", async () => {
        const a = await signUp(server, "Goner");
        const f = await call(server, "POST", "/files", { token: a.token, body: { doc: { name: "Mine", roots: [], nodes: {} } } });
        assert.equal(f.status, 200);
        assert.equal((await call(server, "DELETE", "/account", { token: a.token, body: { password: "wrong" }, headers: freshIp() })).status, 401);
        const r = await call(server, "DELETE", "/account", { token: a.token, body: { password: a.password }, headers: freshIp() });
        assert.equal(r.status, 200);
        assert.equal((await call(server, "GET", "/auth/me", { token: a.token })).status, 401);
        assert.equal((await call(server, "POST", "/auth/signin", { body: { email: a.email, password: a.password }, headers: freshIp() })).status, 401);
        const b = await signUp(server, "Prober");
        assert.equal((await call(server, "GET", `/files/${f.body.id}/access`, { token: b.token })).status, 404);
    });

    test("prefs: chat webhooks only on Slack or Teams hosts", async () => {
        const a = await signUp(server, "Prefs");
        for (const hook of ["http://hooks.slack.com/x", "https://evil.example.com/hooks.slack.com/", "https://hooks.slack.com.evil.com/x", "https://127.0.0.1/x"]) {
            assert.equal((await call(server, "POST", "/auth/prefs", { token: a.token, body: { chatWebhook: hook } })).status, 400, hook);
        }
        const ok = await call(server, "POST", "/auth/prefs", { token: a.token, body: { chatWebhook: "https://hooks.slack.com/services/T/B/C", emailDigests: false } });
        assert.equal(ok.status, 200);
        assert.equal(ok.body.prefs.emailDigests, false);
    });
});

describe("session idle expiry (SESSION_IDLE_DAYS)", () => {
    let server;
    // Two seconds of idleness end a session.
    before(async () => (server = await startServer({ SESSION_IDLE_DAYS: String(2 / 86400) })));
    after(async () => server?.stop());

    test("a session used within the window slides on; one left idle ends", async () => {
        const a = await signUp(server, "Idle");
        const busy = (await call(server, "POST", "/auth/signin", { body: { email: a.email, password: a.password } })).body.token;
        // Keep `busy` in use every half second for three seconds.
        for (let i = 0; i < 6; i++) {
            await sleep(500);
            assert.equal((await call(server, "GET", "/auth/me", { token: busy })).status, 200, `busy at ${i}`);
        }
        // `a.token` sat idle for three seconds.
        assert.equal((await call(server, "GET", "/auth/me", { token: a.token })).status, 401);
        const list = await call(server, "GET", "/auth/sessions", { token: busy });
        assert.equal(list.body.length, 1);
        await sleep(2300);
        assert.equal((await call(server, "GET", "/auth/me", { token: busy })).status, 401);
    });
});
