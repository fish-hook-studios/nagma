// Test helpers: each test file starts its own sync server on a free port with a fresh data folder,
// and stops it by its process handle. No external services: AI, mail, GitHub and image keys are
// removed from the child's environment.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SERVER = new URL("../server.mjs", import.meta.url).pathname;
const SCRUB = /^(ANTHROPIC_|NAGMA_|GITHUB_|SMTP|SESSION_|TRUST_PROXY|AUTO_VERSION|DIGEST_|PORT$|DATA_DIR$|STATIC_DIR$)/;

export function freePort() {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.unref();
        srv.on("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

// Starts a server. `env` adds variables (NAGMA_ADMINS, NAGMA_DEV_MAIL_FILE...). Returns
// { url, port, dataDir, proc, logs(), stop() }. `opts.dataDir` reuses a data folder (a restart; stop
// the earlier server with stop({ keep: true }) so the folder stays).
export async function startServer(env = {}, opts = {}) {
    const port = await freePort();
    const dataDir = opts.dataDir ?? (await mkdtemp(join(tmpdir(), "nagma-test-")));
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SCRUB.test(k)));
    const proc = spawn(process.execPath, [SERVER], {
        env: { ...clean, PORT: String(port), DATA_DIR: dataDir, STATIC_DIR: join(dataDir, "no-static"), NAGMA_SIGNUP_PER_HOUR: "1000", ...env },
        stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (out += d));
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 15000);
        const check = () => {
            if (out.includes("sync server on")) {
                clearTimeout(timer);
                resolve();
            }
        };
        proc.stdout.on("data", check);
        proc.on("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`server exited (${code}):\n${out}`));
        });
    });
    const url = `http://127.0.0.1:${port}`;
    return {
        url,
        wsUrl: `ws://127.0.0.1:${port}`,
        port,
        dataDir,
        proc,
        logs: () => out,
        alive: () => proc.exitCode === null && proc.signalCode === null,
        async stop({ keep = false } = {}) {
            if (proc.exitCode === null && proc.signalCode === null) {
                const exited = new Promise((r) => proc.once("exit", r));
                proc.kill("SIGTERM");
                await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
                if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
            }
            if (!keep) await rm(dataDir, { recursive: true, force: true });
        },
    };
}

// fetch with JSON in and out. Returns { status, headers, body, text }.
export async function call(server, method, path, { token, body, headers = {}, raw } = {}) {
    const h = { ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    let payload = raw;
    if (body !== undefined && raw === undefined) {
        h["content-type"] = "application/json";
        payload = JSON.stringify(body);
    }
    const res = await fetch(server.url + path, { method, headers: h, body: payload, redirect: "manual" });
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }
    return { status: res.status, headers: res.headers, body: json, text };
}

let counter = 0;
// Signs up a fresh account. Returns { token, user, email, password }.
export async function signUp(server, name = "Tester") {
    const email = `user${Date.now().toString(36)}${counter++}@example.com`;
    const password = "correct horse battery";
    const r = await call(server, "POST", "/auth/signup", { body: { name, email, password } });
    if (r.status !== 200) throw new Error(`signup failed ${r.status} ${r.text}`);
    return { token: r.body.token, user: r.body.user, email, password };
}

// The latest verification link the server kept for `userId` (NAGMA_DEV_MAIL_FILE=1), as its token.
export async function verificationToken(server, userId, timeout = 4000) {
    const { readFile } = await import("node:fs/promises");
    return waitUntil(async () => {
        const text = await readFile(join(server.dataDir, "email-links.txt"), "utf8").catch(() => "");
        const lines = text.split("\n").filter((l) => l.includes(`email verification for ${userId}:`));
        return /verify-account=([A-Za-z0-9_-]+)/.exec(lines.at(-1) ?? "")?.[1] ?? null;
    }, timeout, `verification link for ${userId}`);
}

// Opens the account's verification link (servers with NAGMA_DEV_MAIL_FILE=1). Returns the answer.
export async function verifyAccount(server, account) {
    const token = await verificationToken(server, account.user.id);
    const r = await call(server, "POST", "/auth/verify", { body: { token } });
    if (r.status !== 200) throw new Error(`verify failed ${r.status} ${r.text}`);
    return r.body;
}

// ---- Shared fixtures for the integration suites ----

// Waits until `fn()` returns something truthy (polled), or throws after `timeout` ms.
export async function waitUntil(fn, timeout = 4000, label = "condition") {
    const end = Date.now() + timeout;
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
        await new Promise((r) => setTimeout(r, 25));
    }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A small document: one page with one rectangle and one text layer.
export function sampleDoc(name = "Test file", text = "hello world") {
    return {
        name,
        roots: ["page1"],
        nodes: {
            page1: { id: "page1", type: "page", name: "Page 1", parentId: null, children: ["rect1", "text1"] },
            rect1: { id: "rect1", type: "rect", name: "Box", parentId: "page1", children: [], x: 0, y: 0, w: 10, h: 10 },
            text1: { id: "text1", type: "text", name: "Label", parentId: "page1", children: [], x: 0, y: 20, w: 50, h: 10, text },
        },
    };
}

// Creates a server file owned by `token`'s account. Returns { id, keys, project }.
export async function createFile(server, token, { doc = sampleDoc(), project, kind } = {}) {
    const r = await call(server, "POST", "/files", { token, body: { doc, ...(project ? { project } : {}), ...(kind ? { kind } : {}) } });
    if (r.status !== 200) throw new Error(`create file failed ${r.status} ${r.text}`);
    return r.body;
}

// The stored record of a file, once its batched save has reached the disk.
export async function readStored(server, id, until = () => true, timeout = 4000) {
    const { readFile } = await import("node:fs/promises");
    let last = null;
    return waitUntil(async () => {
        try {
            last = JSON.parse(await readFile(join(server.dataDir, `${id}.json`), "utf8"));
        } catch {
            return null;
        }
        return until(last) ? last : null;
    }, timeout, `stored file ${id}`);
}

// A sync client: opens /files/<id>, says hello and collects every message. `first` resolves with the
// answer to the hello (snapshot or denied).
export async function connect(server, fileId, { token, key, name = "Tester", initial, clientId, user, hello = true } = {}) {
    const { WebSocket } = await import("ws");
    const ws = new WebSocket(`${server.wsUrl}/files/${fileId}`);
    const messages = [];
    const waiters = new Set();
    let closed = null;
    ws.on("message", (raw) => {
        let m;
        try {
            m = JSON.parse(String(raw));
        } catch {
            return;
        }
        messages.push(m);
        for (const w of [...waiters]) w();
    });
    ws.on("close", (code, reason) => {
        closed = { code, reason: String(reason) };
        for (const w of [...waiters]) w();
    });
    await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
    });
    const send = (m) => ws.send(typeof m === "string" ? m : JSON.stringify(m));
    // The next message (after `from`) matching `pred` (a type name or a function).
    const next = (pred, { timeout = 3000, from = 0 } = {}) => {
        const test = typeof pred === "string" ? (m) => m.type === pred : pred;
        return new Promise((resolve, reject) => {
            const check = () => {
                const found = messages.slice(from).find(test);
                if (found) {
                    waiters.delete(check);
                    clearTimeout(timer);
                    resolve(found);
                }
            };
            const timer = setTimeout(() => {
                waiters.delete(check);
                reject(new Error(`no ${typeof pred === "string" ? pred : "matching"} message (got ${messages.map((m) => m.type).join(", ")})`));
            }, timeout);
            waiters.add(check);
            check();
        });
    };
    const client = {
        ws,
        messages,
        send,
        next,
        closed: () => closed,
        waitClosed: (timeout = 3000) => waitUntil(() => closed, timeout, "socket close"),
        close: () => new Promise((r) => (ws.readyState === 3 ? r() : (ws.once("close", r), ws.close()))),
    };
    if (hello) {
        send({ type: "hello", user: user ?? { name, color: "#0D99FF" }, initial: initial ?? null, key: key ?? null, token: token ?? null, clientId: clientId ?? null });
        client.first = await next((m) => m.type === "snapshot" || m.type === "denied");
    }
    return client;
}
