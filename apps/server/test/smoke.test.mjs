import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { call, signUp, startServer } from "./helpers.mjs";

let server;
before(async () => (server = await startServer()));
after(async () => server?.stop());

test("server starts and answers /auth/me", async () => {
    const r = await call(server, "GET", "/auth/me");
    assert.equal(r.status, 401);
    const me = await signUp(server);
    const r2 = await call(server, "GET", "/auth/me", { token: me.token });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.email, me.email);
});
