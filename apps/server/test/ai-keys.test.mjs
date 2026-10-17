// Bring your own AI key: keys encrypted at rest and never sent back, the order keys are used in
// (your own, then the server's shared key unless NAGMA_SHARED_AI=0), the "add your key" answers,
// both API shapes (Claude Messages and OpenAI Chat Completions) through a stand-in model server,
// streaming for Make, image generation, usage counts, the per-minute limit, keys kept in a browser
// and keys kept by the desktop app's own server for drafts without an account.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keyring, loadSecret } from "../ai.mjs";
import { scrub } from "../ai-providers.mjs";
import { call, signUp, startServer } from "./helpers.mjs";
import { startStandIn } from "./stand-in-model.mjs";

const CLAUDE_KEY = "fake-claude-key-aaaa1234";
const CLAUDE_KEY_2 = "fake-claude-key-bbbb9999";
const SHARED_KEY = "fake-shared-key-cccc0000";
const OPENAI_KEY = "fake-openai-key-dddd5678";
const ALL_KEYS = [CLAUDE_KEY, CLAUDE_KEY_2, SHARED_KEY, OPENAI_KEY];
const header = (cfg) => ({ "x-nagma-ai": Buffer.from(JSON.stringify(cfg)).toString("base64url") });
const selection = [{ id: "rect1", type: "rectangle", name: "Box" }];

// Reads a Make answer (server-sent events) into [{ event, data }].
function readEvents(text) {
    return text
        .split("\n\n")
        .filter(Boolean)
        .map((raw) => ({ event: /^event: (.+)$/m.exec(raw)?.[1], data: JSON.parse(/^data: (.+)$/m.exec(raw)?.[1] ?? "null") }));
}

describe("AI key encryption", () => {
    test("seals and opens a key; another owner, a changed value or another secret can't open it", () => {
        const ring = keyring("server-secret-one");
        const sealed = ring.seal(CLAUDE_KEY, "user1:text");
        assert.ok(!sealed.includes(CLAUDE_KEY) && !sealed.includes("aaaa1234"));
        assert.equal(ring.open(sealed, "user1:text"), CLAUDE_KEY);
        assert.notEqual(ring.seal(CLAUDE_KEY, "user1:text"), sealed, "a fresh IV each time");
        assert.equal(ring.open(sealed, "user2:text"), null);
        assert.equal(ring.open(sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA"), "user1:text"), null);
        assert.equal(keyring("server-secret-two").open(sealed, "user1:text"), null);
        assert.equal(ring.open("garbage", "user1:text"), null);
    });

    test("without NAGMA_SECRET_KEY a secret is made once in the data folder, readable only by its owner", async () => {
        const dir = await mkdtemp(join(tmpdir(), "nagma-secret-"));
        const saved = process.env.NAGMA_SECRET_KEY;
        delete process.env.NAGMA_SECRET_KEY;
        try {
            const lines = [];
            const first = loadSecret(dir, (l) => lines.push(l));
            assert.match(first, /^[0-9a-f]{64}$/);
            assert.equal(lines.length, 1);
            assert.ok(lines[0].includes(join(dir, "secret-key")));
            assert.ok(!lines[0].includes(first), "the secret itself isn't logged");
            assert.equal((await stat(join(dir, "secret-key"))).mode & 0o777, 0o600);
            assert.equal(loadSecret(dir, (l) => lines.push(l)), first);
            assert.equal(lines.length, 1);
            process.env.NAGMA_SECRET_KEY = "from-the-environment";
            assert.equal(loadSecret(dir), "from-the-environment");
        } finally {
            if (saved === undefined) delete process.env.NAGMA_SECRET_KEY;
            else process.env.NAGMA_SECRET_KEY = saved;
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("provider messages lose anything that looks like a key", () => {
        assert.equal(scrub(`Incorrect API key provided: ${OPENAI_KEY}`, OPENAI_KEY), "Incorrect API key provided: [key]");
        assert.ok(!scrub("Incorrect API key provided: sk-proj-abc****wxyz", "").includes("wxyz"));
    });
});

describe("bring your own AI key", () => {
    let model, server, noShared, alice, bob, carol, admin;
    before(async () => {
        model = await startStandIn({ claudeKeys: [CLAUDE_KEY, CLAUDE_KEY_2, SHARED_KEY], openaiKeys: [OPENAI_KEY] });
        const env = { ANTHROPIC_BASE_URL: model.url, OPENAI_BASE_URL: `${model.url}/v1`, NAGMA_AI_PRIVATE_URLS: "1", NAGMA_SECRET_KEY: "test-secret", NAGMA_ADMINS: "" };
        server = await startServer({ ...env, ANTHROPIC_API_KEY: SHARED_KEY, NAGMA_AI_PER_MINUTE: "8" });
        noShared = await startServer({ ...env, ANTHROPIC_API_KEY: SHARED_KEY, NAGMA_SHARED_AI: "0" });
        admin = await signUp(server, "Admin");
        alice = await signUp(server, "Alice");
        bob = await signUp(server, "Bob");
        carol = await signUp(noShared, "Carol");
    });
    after(async () => {
        await server?.stop();
        await noShared?.stop();
        await model?.close();
    });

    test("with no key of your own and the shared key turned off, every AI route says to add a key", async () => {
        for (const [method, path, body] of [["POST", "/ai/chat", { text: "hi", selection: [] }], ["POST", "/ai/make", { prompt: "an app" }], ["POST", "/providers/image", { prompt: "a cat" }]]) {
            const r = await call(noShared, method, path, { token: carol.token, body });
            assert.equal(r.status, 412, path);
            assert.equal(r.body.code, "ai-key-needed", path);
            assert.equal(r.body.error, "Add your AI key in Account settings to use this.");
            const out = await call(noShared, method, path, { body });
            assert.equal(out.status, 401, `${path} signed out`);
            assert.equal(out.body.code, "ai-key-needed");
        }
        const status = await call(noShared, "GET", "/ai/make", { token: carol.token });
        assert.equal(status.body.available, false);
        assert.equal(status.body.keyNeeded, true);
        assert.equal((await call(noShared, "GET", "/providers", { token: carol.token })).body.imageKeyNeeded, true);
        const settings = await call(noShared, "GET", "/ai/settings", { token: carol.token });
        assert.equal(settings.body.text, null);
        assert.equal(settings.body.shared.text, false);
        assert.equal(settings.body.shared.disabled, true);
        assert.ok(!model.requests.some((r) => r.headers["x-api-key"] === SHARED_KEY), "the shared key was never used");
    });

    test("signed in with no key of your own, the server's shared key answers", async () => {
        const before = model.requests.length;
        const r = await call(server, "POST", "/ai/chat", { token: bob.token, body: { text: "make it blue", selection } });
        assert.equal(r.status, 200, r.text);
        assert.equal(r.body.reply, "Made it blue (Claude).");
        assert.deepEqual(r.body.commands.map((c) => c.id), ["rect1"], "only node.update commands pass");
        const sent = model.requests.slice(before).find((q) => q.path === "/v1/messages");
        assert.equal(sent.headers["x-api-key"], SHARED_KEY);
        assert.equal(sent.body.model, "claude-sonnet-5-5");
        assert.equal(sent.body.tool_choice.name, "apply");
        // Signed out never uses the shared key.
        assert.equal((await call(server, "POST", "/ai/chat", { body: { text: "hi", selection: [] } })).status, 401);
    });

    test("a key that fails the test isn't saved; a good one is saved encrypted and never sent back", async () => {
        const bad = await call(server, "PUT", "/ai/settings", { token: alice.token, body: { provider: "anthropic", key: "fake-wrong-key-00000000" } });
        assert.equal(bad.status, 400);
        assert.equal(bad.body.code, "ai-key-rejected");
        assert.equal((await call(server, "GET", "/ai/settings", { token: alice.token })).body.text, null);
        const good = await call(server, "PUT", "/ai/settings", { token: alice.token, body: { provider: "anthropic", key: CLAUDE_KEY } });
        assert.equal(good.status, 200, good.text);
        assert.equal(good.body.text.provider, "anthropic");
        assert.equal(good.body.text.keySet, true);
        assert.equal(good.body.text.keyEnd, "1234");
        assert.equal(good.body.text.model, "claude-sonnet-5-5");
        assert.deepEqual(good.body.text.models.map((m) => m.id), ["claude-sonnet-5-5", "claude-haiku-5-5"]);
        const view = await call(server, "GET", "/ai/settings", { token: alice.token });
        for (const r of [good, view]) assert.ok(!r.text.includes(CLAUDE_KEY) && !r.text.includes("aaaa1234"), "the key never comes back");
        await new Promise((r) => setTimeout(r, 300));
        const onDisk = await readFile(join(server.dataDir, "ai-keys.json"), "utf8");
        assert.ok(!onDisk.includes(CLAUDE_KEY) && !onDisk.includes("fake-claude"), "encrypted at rest");
        assert.equal((await stat(join(server.dataDir, "ai-keys.json"))).mode & 0o777, 0o600);
        // The model picker: another model the key lists.
        const picked = await call(server, "PUT", "/ai/settings", { token: alice.token, body: { provider: "anthropic", model: "claude-haiku-5-5" } });
        assert.equal(picked.body.text.model, "claude-haiku-5-5");
        assert.equal(picked.body.text.keyEnd, "1234", "the saved key stays when only the model changes");
    });

    test("your own key comes before the shared key", async () => {
        const before = model.requests.length;
        const r = await call(server, "POST", "/ai/chat", { token: alice.token, body: { text: "make it blue", selection } });
        assert.equal(r.status, 200);
        const sent = model.requests.slice(before).find((q) => q.path === "/v1/messages");
        assert.equal(sent.headers["x-api-key"], CLAUDE_KEY);
        assert.equal(sent.body.model, "claude-haiku-5-5");
        const test = await call(server, "POST", "/ai/settings/test", { token: alice.token });
        assert.equal(test.body.ok, true);
        // Your key goes even with the shared key turned off.
        assert.equal((await call(noShared, "PUT", "/ai/settings", { token: carol.token, body: { provider: "anthropic", key: CLAUDE_KEY_2 } })).status, 200);
        const mine = await call(noShared, "POST", "/ai/chat", { token: carol.token, body: { text: "hi", selection } });
        assert.equal(mine.status, 200);
        assert.equal(model.requests.at(-1).headers["x-api-key"], CLAUDE_KEY_2);
    });

    test("OpenAI: chat with tools through Chat Completions, models from the provider, gpt-5 by default", async () => {
        const saved = await call(server, "PUT", "/ai/settings", { token: bob.token, body: { provider: "openai", key: OPENAI_KEY } });
        assert.equal(saved.status, 200, saved.text);
        assert.equal(saved.body.text.model, "gpt-5");
        assert.deepEqual(saved.body.text.models.map((m) => m.id), ["gpt-5", "gpt-5-mini"], "chat models only");
        const before = model.requests.length;
        const r = await call(server, "POST", "/ai/chat", { token: bob.token, body: { text: "fade it", selection } });
        assert.equal(r.status, 200, r.text);
        assert.equal(r.body.reply, "Made it red (OpenAI).");
        assert.deepEqual(r.body.commands, [{ type: "node.update", id: "rect1", patch: { opacity: 0.5 } }]);
        const sent = model.requests.slice(before).find((q) => q.path === "/v1/chat/completions");
        assert.equal(sent.headers.authorization, `Bearer ${OPENAI_KEY}`);
        assert.equal(sent.body.tools[0].function.name, "apply");
        assert.equal(sent.body.tool_choice.function.name, "apply");
        assert.equal(sent.body.messages[0].role, "developer");
        assert.ok(sent.body.max_completion_tokens > 0);
        // A rejected OpenAI key: the provider's message (with a masked key) isn't passed on.
        const bad = await call(server, "PUT", "/ai/settings", { token: bob.token, body: { provider: "openai", key: "fake-openai-wrong-1111" } });
        assert.equal(bad.status, 400);
        assert.ok(!bad.text.includes("1111"));
    });

    test("Make streams with either provider; Claude-only tools are left out for OpenAI", async () => {
        const claude = await call(server, "POST", "/ai/make", { token: alice.token, body: { prompt: "a counter", web: true } });
        assert.equal(claude.status, 200, claude.text);
        const ce = readEvents(claude.text);
        assert.ok(ce.some((e) => e.event === "thinking"));
        assert.deepEqual(ce.find((e) => e.event === "file")?.data, { path: "src/App.tsx" });
        assert.equal(ce.at(-1).event, "done");
        assert.equal(ce.at(-1).data.files[0].path, "src/App.tsx");
        const claudeReq = model.requests.findLast((q) => q.path === "/v1/messages");
        assert.equal(claudeReq.body.stream, true);
        assert.ok(claudeReq.body.tools.some((t) => t.name === "web_search"));

        const openai = await call(server, "POST", "/ai/make", { token: bob.token, body: { prompt: "a counter", web: true } });
        assert.equal(openai.status, 200, openai.text);
        const oe = readEvents(openai.text);
        assert.ok(oe.some((e) => e.event === "status" && /need a Claude key/.test(e.data.text)));
        assert.equal(oe.at(-1).event, "done");
        assert.equal(oe.at(-1).data.message, "Made a counter.");
        const openaiReq = model.requests.findLast((q) => q.path === "/v1/chat/completions");
        assert.equal(openaiReq.body.stream, true);
        assert.equal(openaiReq.body.tools, undefined);
        assert.equal(openaiReq.body.response_format.type, "json_schema");

        const status = await call(server, "GET", "/ai/make", { token: bob.token });
        assert.equal(status.body.available, true);
        assert.equal(status.body.provider, "openai");
        assert.equal(status.body.model, "gpt-5");
    });

    test("an OpenAI-compatible server: its address, its models, max_tokens and no schema", async () => {
        const saved = await call(server, "PUT", "/ai/settings", { token: admin.token, body: { provider: "compatible", baseUrl: `${model.url}/v1/`, key: OPENAI_KEY, model: "local-llama" } });
        assert.equal(saved.status, 200, saved.text);
        assert.equal(saved.body.text.baseUrl, `${model.url}/v1`);
        assert.equal(saved.body.text.model, "local-llama");
        assert.equal(saved.body.text.models.length, 4, "every model the server lists");
        const r = await call(server, "POST", "/ai/chat", { token: admin.token, body: { text: "fade it", selection } });
        assert.equal(r.status, 200, r.text);
        const sent = model.requests.findLast((q) => q.path === "/v1/chat/completions");
        assert.equal(sent.body.model, "local-llama");
        assert.equal(sent.body.messages[0].role, "system");
        assert.ok(sent.body.max_tokens > 0);
        assert.equal((await call(server, "DELETE", "/ai/settings", { token: admin.token })).body.text, null);
    });

    test("image generation: your own OpenAI key (reused from text), else the server's image endpoint", async () => {
        const none = await call(server, "POST", "/providers/image", { token: bob.token, body: { prompt: "a cat" } });
        assert.equal(none.body.code, "ai-key-needed");
        const set = await call(server, "PUT", "/ai/settings/image", { token: bob.token, body: { provider: "openai" } });
        assert.equal(set.status, 200, set.text);
        assert.equal(set.body.image.provider, "openai");
        assert.equal((await call(server, "GET", "/providers", { token: bob.token })).body.image, true);
        const r = await call(server, "POST", "/providers/image", { token: bob.token, body: { prompt: "a cat", size: "1536x1024" } });
        assert.equal(r.status, 200, r.text);
        assert.match(r.body.image, /^data:image\/png;base64,/);
        const sent = model.requests.findLast((q) => q.path === "/v1/images/generations");
        assert.equal(sent.headers.authorization, `Bearer ${OPENAI_KEY}`);
        assert.equal(sent.body.model, "gpt-image-1");
        assert.equal(sent.body.size, "1536x1024");
        assert.equal((await call(server, "DELETE", "/ai/settings/image", { token: bob.token })).body.image, null);
    });

    test("usage is counted per person per day, and admins see the shared key's use", async () => {
        const mine = await call(server, "GET", "/ai/settings", { token: bob.token });
        assert.ok(mine.body.usage.requests >= 4, JSON.stringify(mine.body.usage));
        assert.ok(mine.body.usage.tokens > 0);
        assert.equal(mine.body.usage.shared.requests, 1);
        assert.equal((await call(server, "GET", "/ai/shared-usage", { token: alice.token })).status, 403);
        // The first account on a server is its admin.
        const all = await call(server, "GET", "/ai/shared-usage", { token: admin.token });
        assert.equal(all.status, 200, all.text);
        assert.equal(all.body.enabled, true);
        assert.equal(all.body.days.length, 14);
        assert.equal(all.body.days.at(-1).requests, 1);
        assert.deepEqual(all.body.people.map((p) => p.name), ["Bob"]);
    });

    test("team AI credits are spent only by the shared key; the balance check lets own-key users through", async () => {
        // Erin has no key of her own: the shared key answers and one credit is counted.
        const erin = await signUp(server, "Erin");
        const credits = async (who) => ((await call(server, "GET", "/ai/usage", { token: who.token })).body);
        const log = async (who) => {
            // The save is debounced (100 ms); read the file once it has landed.
            await new Promise((r) => setTimeout(r, 250));
            const accounts = JSON.parse(await readFile(join(server.dataDir, "users.json"), "utf8"));
            const list = Array.isArray(accounts) ? accounts : Array.isArray(accounts.users) ? accounts.users : Object.values(accounts.users ?? accounts);
            const me = list.find((u) => u && (u.id === who.user?.id || u.email === who.email));
            return (me?.aiLog ?? []).length;
        };
        const erinBefore = await log(erin);
        assert.equal((await call(server, "POST", "/ai/chat", { token: erin.token, body: { text: "hi", selection } })).status, 200);
        assert.equal(await log(erin), erinBefore + 1);
        // Alice uses her own key: nothing is counted, and the balance check doesn't apply to her.
        const aliceBefore = await log(alice);
        assert.equal((await call(server, "POST", "/ai/chat", { token: alice.token, body: { text: "hi", selection } })).status, 200);
        assert.equal(await log(alice), aliceBefore);
        assert.deepEqual(await credits(alice), { allowed: true, reason: null, ownKey: true });
        // Old clients reporting a request themselves no longer count one.
        assert.equal((await call(server, "POST", "/ai/usage", { token: erin.token })).body.counted, false);
        assert.equal(await log(erin), erinBefore + 1);
    });

    test("each person gets a limited number of requests a minute", async () => {
        const dave = await signUp(server, "Dave");
        const codes = [];
        for (let i = 0; i < 9; i++) codes.push((await call(server, "POST", "/ai/chat", { token: dave.token, body: { text: "hi", selection: [] } })).status);
        assert.deepEqual(codes.slice(0, 8), Array(8).fill(200));
        assert.equal(codes[8], 429);
    });

    test("signed out in a browser: the key comes with each request and is never kept", async () => {
        const cfg = { provider: "anthropic", key: CLAUDE_KEY_2, model: "claude-sonnet-5-5" };
        const check = await call(server, "PUT", "/ai/settings", { body: { provider: "anthropic", key: CLAUDE_KEY_2 } });
        assert.equal(check.status, 200, check.text);
        assert.equal(check.body.scope, "browser");
        assert.equal(check.body.saved.model, "claude-sonnet-5-5");
        const r = await call(server, "POST", "/ai/chat", { body: { text: "hi", selection }, headers: header(cfg) });
        assert.equal(r.status, 200, r.text);
        assert.equal(model.requests.at(-1).headers["x-api-key"], CLAUDE_KEY_2);
        const view = await call(server, "GET", "/ai/settings", { headers: header(cfg) });
        assert.equal(view.body.scope, "browser");
        assert.equal(view.body.text.keyEnd, "9999");
        assert.equal(view.body.usage.requests, 1);
        assert.ok(!view.text.includes(CLAUDE_KEY_2));
        const make = await call(server, "GET", "/ai/make", { headers: header(cfg) });
        assert.equal(make.body.available, true);
        assert.equal(make.body.signedIn, false);
        await new Promise((r) => setTimeout(r, 300));
        assert.ok(!(await readFile(join(server.dataDir, "ai-keys.json"), "utf8").catch(() => "")).includes("browser"), "nothing stored for browsers");
    });

    test("deleting the key turns AI back to the shared key", async () => {
        const removed = await call(server, "DELETE", "/ai/settings", { token: alice.token });
        assert.equal(removed.body.text, null);
        const r = await call(server, "POST", "/ai/chat", { token: alice.token, body: { text: "hi", selection } });
        assert.equal(r.status, 200);
        assert.equal(model.requests.at(-1).headers["x-api-key"], SHARED_KEY);
    });

    test("no key ever reaches the server's log", () => {
        for (const s of [server, noShared]) for (const k of ALL_KEYS) assert.ok(!s.logs().includes(k), `log has ${k}`);
    });
});

describe("AI keys on a public server and in the desktop app", () => {
    let model, pub, desktop, user;
    before(async () => {
        model = await startStandIn({ claudeKeys: [CLAUDE_KEY], openKeys: true });
        pub = await startServer({ ANTHROPIC_BASE_URL: model.url, NAGMA_SECRET_KEY: "test-secret" });
        desktop = await startServer({ ANTHROPIC_BASE_URL: model.url, NAGMA_LOCAL_DEVICE: "1" });
        user = await signUp(pub, "Pat");
    });
    after(async () => {
        await pub?.stop();
        await desktop?.stop();
        await model?.close();
    });

    test("a public server won't send requests to private addresses", async () => {
        const r = await call(pub, "PUT", "/ai/settings", { token: user.token, body: { provider: "compatible", baseUrl: `${model.url}/v1`, model: "local-llama" } });
        assert.equal(r.status, 400);
        assert.equal(r.body.code, "ai-bad-address");
        const header = { "x-nagma-ai": Buffer.from(JSON.stringify({ provider: "compatible", baseUrl: `${model.url}/v1`, model: "local-llama", key: "anything-goes-here" })).toString("base64url") };
        const chat = await call(pub, "POST", "/ai/chat", { body: { text: "hi", selection: [] }, headers: header });
        assert.equal(chat.status, 400);
        assert.equal(chat.body.code, "ai-bad-address");
    });

    test("the desktop app's own server keeps a key for drafts without an account, for this computer's pages only", async () => {
        // A local model with no key at all.
        const saved = await call(desktop, "PUT", "/ai/settings", { body: { provider: "compatible", baseUrl: `${model.url}/v1`, model: "local-llama" } });
        assert.equal(saved.status, 200, saved.text);
        assert.equal(saved.body.scope, "device");
        assert.equal(saved.body.text.keySet, false);
        assert.equal((await call(desktop, "POST", "/ai/chat", { body: { text: "hi", selection } })).status, 200);
        assert.equal(model.requests.at(-1).headers.authorization, undefined);
        const claude = await call(desktop, "PUT", "/ai/settings", { body: { provider: "anthropic", key: CLAUDE_KEY } });
        assert.equal(claude.body.scope, "device");
        assert.equal(claude.body.text.keyEnd, "1234");
        const chat = await call(desktop, "POST", "/ai/chat", { body: { text: "hi", selection } });
        assert.equal(chat.status, 200, chat.text);
        assert.equal(model.requests.at(-1).headers["x-api-key"], CLAUDE_KEY);
        // A page from elsewhere (another site, or a name rebound to this computer) isn't this device.
        const foreign = await call(desktop, "POST", "/ai/chat", { body: { text: "hi", selection }, headers: { origin: "https://evil.example" } });
        assert.equal(foreign.status, 401);
        // (fetch won't send another Host, so this one goes by node:http.)
        const rebound = await new Promise((resolve, reject) => {
            const req = request({ host: "127.0.0.1", port: desktop.port, path: "/ai/settings", headers: { host: `evil.example:${desktop.port}` } }, (res) => {
                let text = "";
                res.on("data", (d) => (text += d));
                res.on("end", () => resolve(JSON.parse(text)));
            });
            req.on("error", reject);
            req.end();
        });
        assert.equal(rebound.scope, "browser");
        assert.equal((await call(desktop, "GET", "/ai/settings", { headers: { origin: desktop.url } })).body.text.keyEnd, "1234");
    });
});
