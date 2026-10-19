// Load test for the sync server (not part of the normal test run: `node --test apps/server/test/`
// only loads *.test.mjs files). It signs up accounts and creates files through the HTTP API, opens
// many WebSocket clients against a server (one it starts itself with --spawn, or --url), has the
// editors send patches and everyone send presence, and reports relay latency, presence latency,
// throughput, dropped messages and the server's CPU and memory. See docs/load-testing.md.
//
//   node apps/server/test/load/loadtest.mjs --spawn --users 1000 --files 50 --duration 30
//   node apps/server/test/load/loadtest.mjs --url https://nagma.example.com --users 200
//   node apps/server/test/load/loadtest.mjs --config load.json --spawn --profile
//
// Clients run in worker threads (--workers, default: CPU count minus two), so the generator isn't
// the bottleneck. Every latency is measured on this machine: the sender stamps the message and the
// receiver compares with its own clock (the same clock, as all workers are in one process).
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const now = () => performance.timeOrigin + performance.now();
const PRESENCE_SAMPLE = 10;
const PRESENCE_PREFIX = Buffer.from('{"type":"presence');
const LT_MARK = Buffer.from('"lt:');

// ---- Latency histograms: 0.1 ms buckets up to 1 s, then 10 ms buckets up to 60 s (mergeable) ----
const FINE = 10_000;
const COARSE = 5_900;
const histogram = () => new Uint32Array(FINE + COARSE + 1);
function record(h, ms) {
    if (!(ms >= 0)) ms = 0;
    const i = ms < 1000 ? Math.floor(ms * 10) : Math.min(FINE + COARSE, FINE + Math.floor((ms - 1000) / 10));
    h[i] += 1;
}
const bucketValue = (i) => (i < FINE ? i / 10 : 1000 + (i - FINE) * 10);
function percentiles(h) {
    let total = 0;
    for (const c of h) total += c;
    if (!total) return { count: 0, p50: null, p95: null, p99: null, max: null };
    const want = [0.5, 0.95, 0.99].map((q) => Math.ceil(q * total));
    const out = [];
    let seen = 0;
    let max = 0;
    for (let i = 0; i < h.length; i++) {
        if (!h[i]) continue;
        seen += h[i];
        max = i;
        while (out.length < want.length && seen >= want[out.length]) out.push(bucketValue(i));
    }
    return { count: total, p50: out[0], p95: out[1], p99: out[2], max: bucketValue(max) };
}

// ---- Options ----
const DEFAULTS = {
    url: null,
    spawn: false,
    port: 48950,
    users: 200,
    files: 20,
    pages: 2,
    editors: 0.1,
    editRate: 2,
    presenceRate: 20,
    duration: 30,
    warmup: 3,
    ramp: 400,
    workers: Math.max(1, Math.min(8, availableParallelism() - 2)),
    accounts: 10,
    perAccount: 5,
    profile: false,
    profileDir: null,
    json: null,
    drop: false,
    env: {},
    label: "",
};

function parseArgs(argv) {
    const opts = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) continue;
        const [rawKey, inline] = a.slice(2).split("=", 2);
        const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const takesValue = !["spawn", "profile", "drop", "help", "verbose"].includes(key);
        const value = inline ?? (takesValue ? argv[++i] : "true");
        if (key === "env") {
            const [k, ...v] = String(value).split("=");
            opts.env = { ...(opts.env ?? {}), [k]: v.join("=") };
        } else opts[key] = value;
    }
    return opts;
}

function coerce(opts) {
    const out = { ...opts };
    for (const k of ["port", "users", "files", "pages", "editRate", "presenceRate", "duration", "warmup", "ramp", "workers", "accounts", "perAccount"]) if (out[k] !== undefined) out[k] = Number(out[k]);
    if (out.editors !== undefined) out.editors = Number(out.editors);
    for (const k of ["spawn", "profile", "drop", "verbose"]) if (typeof out[k] === "string") out[k] = out[k] === "true";
    return out;
}

const HELP = `Usage: node apps/server/test/load/loadtest.mjs [options]

  --spawn               start a scratch server (in a temp data folder) and stop it afterwards
  --url <http(s)://…>   or test a running server
  --port <n>            port for --spawn (default 48950)
  --server <server.mjs> (--spawn) which server to start (default: this checkout's), e.g. an older copy
  --config <file.json>  options as JSON (command-line options win)
  --users <n>           WebSocket clients (default 200)
  --files <n>           files (rooms) the clients spread over (default 20)
  --pages <n>           pages per file; each client sits on one (default 2)
  --editors <0..1>      share of clients that edit (default 0.1)
  --edit-rate <n>       patches per second per editor (default 2)
  --presence-rate <n>   presence updates per second per client (default 20)
  --duration <s>        measured seconds (default 30), after --warmup <s> (default 3)
  --ramp <n>            new connections per second while connecting (default 400)
  --workers <n>         worker threads for the clients (default CPU count - 2, at most 8)
  --accounts <n>        signed-in accounts (default 10), each used by --per-account clients (default 5);
                        everyone else opens the files' links as a guest
  --env KEY=VALUE       extra environment for --spawn (repeatable), e.g. --env NAGMA_ROOM_EDITORS=50
  --profile             (--spawn) write a CPU profile of the server (node --cpu-prof)
  --drop                after the run, drop every connection at once and check the server recovers
  --json <file>         also write the results as JSON
  --verbose             print throughput and server CPU every second
  --label <text>        a name for this run in the report`;

// ---- The server ----

async function portFree(port) {
    const { createServer } = await import("node:net");
    return new Promise((resolve) => {
        const srv = createServer();
        srv.once("error", () => resolve(false));
        srv.listen(port, () => srv.close(() => resolve(true)));
    });
}

async function startScratchServer(opts) {
    if (!(await portFree(opts.port))) throw new Error(`port ${opts.port} is in use: pick another with --port`);
    const dataDir = await mkdtemp(join(tmpdir(), "nagma-load-"));
    const serverPath = opts.server ?? new URL("../../server.mjs", import.meta.url).pathname;
    const nodeArgs = [];
    let profileDir = null;
    if (opts.profile) {
        profileDir = opts.profileDir ?? join(process.cwd(), `nagma-profile-${Date.now()}`);
        await mkdir(profileDir, { recursive: true });
        nodeArgs.push("--cpu-prof", `--cpu-prof-dir=${profileDir}`);
    }
    const env = {
        ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(NAGMA_|PORT$|DATA_DIR$|STATIC_DIR$|TRUST_PROXY$)/.test(k))),
        PORT: String(opts.port),
        DATA_DIR: dataDir,
        STATIC_DIR: join(dataDir, "no-static"),
        NAGMA_SIGNUP_PER_HOUR: "1000000",
        NAGMA_HEALTH_STATS: "1",
        ...opts.env,
    };
    // A raised open-file limit for the server (each socket is a file); macOS shells often start at 256.
    const proc = spawn("/bin/sh", ["-c", `ulimit -n 65536 2>/dev/null || ulimit -n 10240 2>/dev/null; exec "${process.execPath}" ${nodeArgs.join(" ")} "${serverPath}"`], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (out += d));
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 20000);
        proc.stdout.on("data", () => out.includes("sync server on") && (clearTimeout(timer), resolve()));
        proc.on("exit", (code) => (clearTimeout(timer), reject(new Error(`server exited (${code}):\n${out}`))));
    });
    return {
        url: `http://127.0.0.1:${opts.port}`,
        pid: proc.pid,
        profileDir,
        logs: () => out,
        alive: () => proc.exitCode === null && proc.signalCode === null,
        async stop() {
            if (proc.exitCode === null && proc.signalCode === null) {
                const exited = new Promise((r) => proc.once("exit", r));
                proc.kill("SIGTERM");
                await Promise.race([exited, new Promise((r) => setTimeout(r, 8000))]);
                if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
            }
            await rm(dataDir, { recursive: true, force: true });
        },
    };
}

async function api(base, method, path, { token, body } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        json = null;
    }
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
    return json;
}

async function signUp(base, name) {
    const email = `load-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const r = await api(base, "POST", "/auth/signup", { body: { name, email, password: "load test password" } });
    return { token: r.token, id: r.user?.id };
}

// One file: `pages` pages with 20 rectangles each (the editors move them).
function loadDoc(name, pages) {
    const nodes = {};
    const roots = [];
    for (let p = 0; p < pages; p++) {
        const page = `page${p}`;
        roots.push(page);
        const children = [];
        for (let r = 0; r < 20; r++) {
            const id = `r${p}_${r}`;
            children.push(id);
            nodes[id] = { id, type: "rect", name: `Box ${r}`, parentId: page, children: [], x: r * 30, y: 0, w: 20, h: 20 };
        }
        nodes[page] = { id: page, type: "page", name: `Page ${p + 1}`, parentId: null, children };
    }
    return { name, roots, nodes };
}

// CPU time and memory of a process on this machine (when the server was spawned here): cumulative
// CPU seconds (ps "time", [[dd-]hh:]mm:ss.cc), so the caller can take differences between samples.
function psSample(pid) {
    try {
        const [time, rss] = execFileSync("ps", ["-o", "time=,rss=", "-p", String(pid)], { encoding: "utf8" }).trim().split(/\s+/);
        const parts = time.replace("-", ":").split(":").map(Number);
        const cpuSeconds = parts.reduce((acc, v) => acc * 60 + v, 0);
        return { cpuSeconds, rssMb: Number(rss) / 1024 };
    } catch {
        return null;
    }
}

async function health(base, timeout = 5000) {
    try {
        const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeout) });
        return await res.json();
    } catch {
        return null;
    }
}

const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "-" : Number(v).toFixed(d));
const lat = (p) => `p50 ${fmt(p.p50)}  p95 ${fmt(p.p95)}  p99 ${fmt(p.p99)}  max ${fmt(p.max)} ms  (${p.count.toLocaleString("en-US")} samples)`;

async function main() {
    const cli = parseArgs(process.argv.slice(2));
    if (cli.help) return console.log(HELP);
    const fromFile = cli.config ? JSON.parse(await readFile(cli.config, "utf8")) : {};
    const opts = coerce({ ...DEFAULTS, ...fromFile, ...cli, env: { ...DEFAULTS.env, ...(fromFile.env ?? {}), ...(cli.env ?? {}) } });
    if (!opts.url && !opts.spawn) opts.spawn = true;

    const server = opts.spawn ? await startScratchServer(opts) : null;
    const base = (server?.url ?? opts.url).replace(/\/$/, "");
    const wsBase = base.replace(/^http/, "ws");
    const log = (...a) => console.log(`[load] ${a.join(" ")}`);
    try {
        log(`server ${base}${server ? ` (pid ${server.pid}, spawned)` : ""}`);
        // Accounts: one owner for the files, plus the signed-in clients'.
        const owner = await signUp(base, "Load owner");
        const accounts = [];
        for (let i = 0; i < opts.accounts; i++) accounts.push(await signUp(base, `Load user ${i}`));
        const files = [];
        for (let i = 0; i < opts.files; i++) {
            const f = await api(base, "POST", "/files", { token: owner.token, body: { doc: loadDoc(`Load file ${i}`, opts.pages) } });
            await api(base, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { link: "edit" } });
            files.push(f);
        }
        log(`${accounts.length + 1} accounts and ${files.length} files created`);

        // Who is who: users spread evenly over files and pages; every 1/editors-th one edits.
        const editorEvery = opts.editors > 0 ? Math.max(1, Math.round(1 / opts.editors)) : Infinity;
        const clients = [];
        for (let i = 0; i < opts.users; i++) {
            const file = files[i % files.length];
            const editor = i % editorEvery === 0;
            const account = i < opts.accounts * opts.perAccount ? accounts[i % Math.max(1, accounts.length)] : null;
            clients.push({ i, fileId: file.id, key: editor ? file.keys.edit : file.keys.view, token: account?.token ?? null, editor, page: `page${Math.floor(i / files.length) % opts.pages}` });
        }
        const workerCount = Math.max(1, Math.min(opts.workers, opts.users));
        const shares = Array.from({ length: workerCount }, () => []);
        clients.forEach((c, i) => shares[i % workerCount].push(c));

        const workers = [];
        const totals = { connected: 0, failed: 0 };
        const perSecond = [];
        for (let w = 0; w < workerCount; w++) {
            const worker = new Worker(new URL(import.meta.url), { workerData: { wsBase, clients: shares[w], opts: { editRate: opts.editRate, presenceRate: opts.presenceRate, pages: opts.pages, ramp: opts.ramp / workerCount } } });
            const state = { worker, connected: 0, failed: 0, final: null, tick: null };
            worker.on("message", (m) => {
                if (m.type === "connected") state.connected = m.connected, state.failed = m.failed;
                if (m.type === "tick") state.tick = m;
                if (m.type === "final") state.final = m;
            });
            worker.on("error", (e) => console.error(`[load] worker ${w} failed: ${e?.stack ?? e}`));
            workers.push(state);
        }
        const connectStart = Date.now();
        // Wait for everyone to connect (or give up on the stragglers after a while).
        for (;;) {
            totals.connected = workers.reduce((s, w) => s + w.connected, 0);
            totals.failed = workers.reduce((s, w) => s + w.failed, 0);
            if (totals.connected + totals.failed >= opts.users) break;
            if (Date.now() - connectStart > 60_000 + (opts.users / Math.max(1, opts.ramp)) * 3000) break;
            await new Promise((r) => setTimeout(r, 200));
        }
        const connectSeconds = (Date.now() - connectStart) / 1000;
        log(`${totals.connected}/${opts.users} connected in ${connectSeconds.toFixed(1)}s (${totals.failed} failed)`);
        for (const w of workers) w.worker.postMessage({ type: "go" });
        log(`warming up ${opts.warmup}s, then measuring ${opts.duration}s`);
        await new Promise((r) => setTimeout(r, opts.warmup * 1000));

        // Measure: workers record from now; the server is sampled every second.
        for (const w of workers) w.worker.postMessage({ type: "measure" });
        const samples = [];
        let lastCpu = null;
        const lastProcCpu = new Map();
        let sampling = false;
        const sampleTimer = setInterval(async () => {
            // One sample at a time: a busy server answering late mustn't pile requests up.
            if (sampling) return;
            sampling = true;
            const h = await health(base, 900);
            sampling = false;
            const ps = server ? psSample(server.pid) : null;
            const s = { at: Date.now(), ps, stats: h?.stats ?? null };
            // CPU: from the server's own counters when /health has them, else from ps.
            const cpuNow = h?.stats?.cpu ? (h.stats.cpu.user + h.stats.cpu.system) / 1e6 : ps?.cpuSeconds;
            if (Number.isFinite(cpuNow) && lastCpu) s.cpuPercent = ((cpuNow - lastCpu.seconds) / ((s.at - lastCpu.at) / 1000)) * 100;
            if (Number.isFinite(cpuNow)) lastCpu = { at: s.at, seconds: cpuNow };
            // With room workers (NAGMA_WORKERS > 1), /health lists each process: the main one and each
            // worker's CPU, by pid (a restarted worker starts over).
            for (const p of h?.stats?.processes ?? []) {
                if (!p.cpu) continue;
                const seconds = (p.cpu.user + p.cpu.system) / 1e6;
                const prev = lastProcCpu.get(p.pid);
                if (prev) (s.procCpu ??= []).push({ role: p.role, index: p.index, pid: p.pid, percent: ((seconds - prev.seconds) / ((s.at - prev.at) / 1000)) * 100, loopP99: p.eventLoop?.p99 });
                lastProcCpu.set(p.pid, { at: s.at, seconds });
            }
            samples.push(s);
            const ticks = workers.map((w) => w.tick).filter(Boolean);
            const sum = (k) => ticks.reduce((t, x) => t + (x[k] ?? 0), 0);
            perSecond.push({ received: sum("received"), patchesSent: sum("patchesSent"), presenceSent: sum("presenceSent"), open: sum("open"), buffered: sum("buffered") });
            if (opts.verbose) {
                const prev = perSecond.at(-2) ?? { received: 0, patchesSent: 0, presenceSent: 0 };
                const cur = perSecond.at(-1);
                log(`t+${perSecond.length}s received ${cur.received - prev.received}/s, patches sent ${cur.patchesSent - prev.patchesSent}/s, presence sent ${cur.presenceSent - prev.presenceSent}/s, open sockets ${cur.open}, client send buffers ${fmt(cur.buffered / 1048576)} MB, server CPU ${fmt(s.cpuPercent)}%`);
            }
        }, 1000);
        await new Promise((r) => setTimeout(r, opts.duration * 1000));
        clearInterval(sampleTimer);
        for (const w of workers) w.worker.postMessage({ type: "stop" });
        await waitFor(() => workers.every((w) => w.final), 30_000);

        // Merge the workers' results.
        const merged = { ack: histogram(), relay: histogram(), presence: histogram() };
        const count = {};
        for (const w of workers) {
            for (const k of Object.keys(merged)) {
                const h = new Uint32Array(w.final.hist[k]);
                for (let i = 0; i < h.length; i++) merged[k][i] += h[i];
            }
            for (const [k, v] of Object.entries(w.final.count)) count[k] = (count[k] ?? 0) + v;
        }
        const generatorLoopP99 = Math.max(...workers.map((w) => w.final.loopP99 ?? 0));
        const generatorLoopMax = Math.max(...workers.map((w) => w.final.loopMax ?? 0));
        const secs = opts.duration;
        const cpuSamples = samples.map((s) => s.cpuPercent).filter((v) => Number.isFinite(v));
        const rssSamples = samples.map((s) => (s.stats?.rss ? s.stats.rss / 1048576 : s.ps?.rssMb)).filter((v) => Number.isFinite(v));
        const loopP99 = samples.map((s) => s.stats?.eventLoop?.p99).filter((v) => Number.isFinite(v));
        // Per process (room workers): the main process, and the busiest worker in each sample.
        const mainCpu = samples.flatMap((s) => (s.procCpu ?? []).filter((p) => p.role === "main").map((p) => p.percent));
        const workerCpu = samples.map((s) => Math.max(...(s.procCpu ?? []).filter((p) => p.role === "worker").map((p) => p.percent))).filter((v) => Number.isFinite(v));
        const mainLoop = samples.flatMap((s) => (s.procCpu ?? []).filter((p) => p.role === "main").map((p) => p.loopP99)).filter((v) => Number.isFinite(v));
        const workerLoop = samples.flatMap((s) => (s.procCpu ?? []).filter((p) => p.role === "worker").map((p) => p.loopP99)).filter((v) => Number.isFinite(v));
        const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
        const result = {
            label: opts.label || null,
            options: { users: opts.users, files: opts.files, pages: opts.pages, editors: opts.editors, editRate: opts.editRate, presenceRate: opts.presenceRate, duration: opts.duration, workers: workerCount, env: opts.env },
            connected: totals.connected,
            failedToConnect: totals.failed,
            connectSeconds,
            editors: clients.filter((c) => c.editor).length,
            relay: percentiles(merged.relay),
            ack: percentiles(merged.ack),
            presence: percentiles(merged.presence),
            rates: {
                patchesSent: count.patchesSent / secs,
                patchesReceived: count.patchesIn / secs,
                presenceSent: count.presenceSent / secs,
                presenceReceived: count.presenceIn / secs,
                messagesReceived: count.received / secs,
                mbReceived: count.bytesIn / secs / 1048576,
            },
            problems: { droppedPatches: count.gaps ?? 0, unexpectedCloses: count.closed ?? 0, errors: count.errors ?? 0, rateLimited: count.rateLimited ?? 0, rejected: count.rejected ?? 0, demoted: count.capped ?? 0 },
            server: {
                cpuAvg: cpuSamples.length ? cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length : null,
                cpuMax: cpuSamples.length ? Math.max(...cpuSamples) : null,
                rssMaxMb: rssSamples.length ? Math.max(...rssSamples) : null,
                eventLoopP99Max: loopP99.length ? Math.max(...loopP99) : null,
                processes: samples.at(-1)?.stats?.processes?.length ?? 1,
                mainCpuAvg: avg(mainCpu),
                mainCpuMax: mainCpu.length ? Math.max(...mainCpu) : null,
                busiestWorkerCpuAvg: avg(workerCpu),
                busiestWorkerCpuMax: workerCpu.length ? Math.max(...workerCpu) : null,
                mainLoopP99Max: mainLoop.length ? Math.max(...mainLoop) : null,
                workerLoopP99Max: workerLoop.length ? Math.max(...workerLoop) : null,
            },
            // When this is high the load generator itself was busy and the latencies include its delay.
            generatorLoopP99,
            generatorLoopMax,
        };

        if (opts.drop) result.drop = await dropAll(workers, base, server);
        for (const w of workers) w.worker.postMessage({ type: "close" });
        await Promise.all(workers.map((w) => w.worker.terminate().catch(() => undefined)));

        printReport(result);
        if (opts.json) await writeFile(opts.json, JSON.stringify(result, null, 2));
    } finally {
        if (server) {
            if (!server.alive()) console.error(`[load] the server died:\n${server.logs().slice(-4000)}`);
            await server.stop();
            if (server.profileDir) log(`CPU profile written to ${server.profileDir} (open it in Chrome DevTools › Performance)`);
        }
    }
}

// Every client drops at the same moment (no close handshake); the server must stay up and answer.
async function dropAll(workers, base, server) {
    const before = await health(base);
    const t0 = Date.now();
    for (const w of workers) w.worker.postMessage({ type: "terminate" });
    await new Promise((r) => setTimeout(r, 200));
    let answered = null;
    for (let i = 0; i < 60 && !answered; i++) {
        answered = await health(base, 1000);
        if (!answered) await new Promise((r) => setTimeout(r, 100));
    }
    const recoveredMs = Date.now() - t0;
    // A fresh client can still join and edit afterwards.
    await new Promise((r) => setTimeout(r, 1000));
    const after = await health(base, 5000);
    return { serverAlive: server ? server.alive() : Boolean(answered), healthAfterMs: recoveredMs, connectionsBefore: before?.stats?.connections ?? null, connectionsAfter: after?.stats?.connections ?? null, rssAfterMb: after?.stats?.rss ? after.stats.rss / 1048576 : server ? psSample(server.pid)?.rssMb : null };
}

async function waitFor(fn, timeout) {
    const end = Date.now() + timeout;
    while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
}

function printReport(r) {
    const o = r.options;
    const lines = [
        "",
        `Nagma load test${r.label ? ` — ${r.label}` : ""}`,
        `  ${o.users} users (${r.editors} editors at ${o.editRate}/s, presence ${o.presenceRate}/s each), ${o.files} files × ${o.pages} pages, ${o.duration}s, ${o.workers} workers`,
        Object.keys(o.env ?? {}).length ? `  env: ${Object.entries(o.env).map(([k, v]) => `${k}=${v}`).join(" ")}` : null,
        `  connected ${r.connected}/${o.users} in ${fmt(r.connectSeconds)}s, ${r.failedToConnect} failed`,
        "",
        `  patch relay (send → another client):  ${lat(r.relay)}`,
        `  patch ack (send → own echo):          ${lat(r.ack)}`,
        `  presence (send → another client):     ${lat(r.presence)}`,
        "",
        `  patches   sent ${fmt(r.rates.patchesSent, 0)}/s, received ${fmt(r.rates.patchesReceived, 0)}/s`,
        `  presence  sent ${fmt(r.rates.presenceSent, 0)}/s, received ${fmt(r.rates.presenceReceived, 0)}/s`,
        `  messages received ${fmt(r.rates.messagesReceived, 0)}/s, ${fmt(r.rates.mbReceived, 2)} MB/s`,
        `  problems: dropped patches ${r.problems.droppedPatches}, unexpected closes ${r.problems.unexpectedCloses}, errors ${r.problems.errors}, rate-limited ${r.problems.rateLimited}, rejected ${r.problems.rejected}, capped to view ${r.problems.demoted}`,
        `  server: CPU avg ${fmt(r.server.cpuAvg)}% max ${fmt(r.server.cpuMax)}%, RSS max ${fmt(r.server.rssMaxMb, 0)} MB, event-loop delay p99 max ${fmt(r.server.eventLoopP99Max)} ms${r.server.processes > 1 ? ` (all ${r.server.processes} processes)` : ""}`,
        r.server.mainCpuAvg !== null ? `  room workers: main process CPU avg ${fmt(r.server.mainCpuAvg)}% max ${fmt(r.server.mainCpuMax)}%, busiest worker avg ${fmt(r.server.busiestWorkerCpuAvg)}% max ${fmt(r.server.busiestWorkerCpuMax)}%; event-loop delay p99 max: main ${fmt(r.server.mainLoopP99Max)} ms, workers ${fmt(r.server.workerLoopP99Max)} ms` : null,
        `  load generator: event-loop delay p99 ${fmt(r.generatorLoopP99)} ms, max ${fmt(r.generatorLoopMax)} ms${r.generatorLoopMax > 250 ? " (busy: latencies include the generator's own delay)" : ""}`,
        r.drop ? `  drop all: server alive ${r.drop.serverAlive}, /health answered after ${r.drop.healthAfterMs} ms, connections ${r.drop.connectionsBefore ?? "?"} → ${r.drop.connectionsAfter ?? "?"}, RSS after ${fmt(r.drop.rssAfterMb, 0)} MB` : null,
        "",
    ];
    console.log(lines.filter((l) => l !== null).join("\n"));
}

// ---- A worker: a share of the clients ----

async function runWorker() {
    const { WebSocket } = await import("ws");
    const { monitorEventLoopDelay } = await import("node:perf_hooks");
    const { wsBase, clients, opts } = workerData;
    const loop = monitorEventLoopDelay({ resolution: 10 });
    // NAGMA_LOAD_DEBUG=1: each worker writes a heartbeat to stderr (synchronously), to tell a
    // stalled generator from a stalled server.
    if (process.env.NAGMA_LOAD_DEBUG === "1") {
        const { writeSync } = await import("node:fs");
        const { threadId } = await import("node:worker_threads");
        let lastBeat = Date.now();
        setInterval(() => {
            const t = Date.now();
            writeSync(2, `[worker ${threadId}] beat gap ${t - lastBeat} ms, received ${count.received}, heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MB\n`);
            lastBeat = t;
        }, 500).unref();
    }
    const hist = { ack: histogram(), relay: histogram(), presence: histogram() };
    const count = { patchesSent: 0, patchesIn: 0, presenceSent: 0, presenceIn: 0, received: 0, bytesIn: 0, gaps: 0, closed: 0, errors: 0, rateLimited: 0, rejected: 0, capped: 0 };
    let measuring = false;
    let going = false;
    let stopping = false;
    let connected = 0;
    let failed = 0;
    const live = [];
    const report = () => parentPort.postMessage({ type: "connected", connected, failed });
    const add = (k, n = 1) => measuring && (count[k] += n);

    function open(c) {
        return new Promise((resolve) => {
            const ws = new WebSocket(`${wsBase}/files/${c.fileId}`);
            const s = { c, ws, version: null, myId: null, timers: [], presenceHz: opts.presenceRate, x: Math.random() * 1000, y: Math.random() * 1000, done: false };
            const settle = (ok) => {
                if (s.done) return;
                s.done = true;
                if (ok) connected++;
                else failed++;
                report();
                resolve(ok ? s : null);
            };
            ws.on("open", () => ws.send(JSON.stringify({ type: "hello", user: { name: `Load ${c.i}`, color: "#0D99FF" }, key: c.key, token: c.token, clientId: `load${c.i}x` })));
            ws.on("error", () => (add("errors"), settle(false)));
            ws.on("close", () => {
                if (!stopping && s.done) add("closed");
                settle(false);
                for (const t of s.timers) clearInterval(t);
            });
            ws.on("message", (raw) => {
                const t = now();
                if (measuring) {
                    count.received++;
                    count.bytesIn += raw.length;
                }
                // Presence is most of the traffic: counted from the bytes (not decoded), and one
                // message in PRESENCE_SAMPLE parsed for its latency, so the generator keeps up with the
                // server.
                if (raw.length >= PRESENCE_PREFIX.length && raw.compare(PRESENCE_PREFIX, 0, PRESENCE_PREFIX.length, 0, PRESENCE_PREFIX.length) === 0) {
                    if (!measuring) return;
                    let n = 0;
                    for (let at = raw.indexOf(LT_MARK); at >= 0; at = raw.indexOf(LT_MARK, at + 4)) n++;
                    count.presenceIn += n;
                    if (Math.random() >= 1 / PRESENCE_SAMPLE) return;
                }
                const text = String(raw);
                let m;
                try {
                    m = JSON.parse(text);
                } catch {
                    return;
                }
                switch (m.type) {
                    case "snapshot":
                        s.version = m.version;
                        s.myId = m.you;
                        if (m.capped) add("capped");
                        if (m.presenceHz) s.presenceHz = Math.min(opts.presenceRate, m.presenceHz);
                        settle(true);
                        if (going) start(s);
                        break;
                    case "denied":
                        settle(false);
                        break;
                    case "patch": {
                        if (s.version !== null && typeof m.version === "number") {
                            if (m.version > s.version + 1) add("gaps", m.version - s.version - 1);
                            if (m.version > s.version) s.version = m.version;
                        }
                        const change = m.patch?.nodes ? Object.values(m.patch.nodes)[0] : null;
                        if (!measuring || !change?.lt) break;
                        if (m.from === s.myId) record(hist.ack, t - change.lt);
                        else {
                            count.patchesIn++;
                            record(hist.relay, t - change.lt);
                        }
                        break;
                    }
                    case "presence":
                    case "presences": {
                        const list = m.type === "presence" ? [m.presence] : (m.presences ?? []);
                        for (const p of list) {
                            const stamp = p?.selection?.[0];
                            if (!measuring || typeof stamp !== "string" || !stamp.startsWith("lt:")) continue;
                            record(hist.presence, t - Number(stamp.slice(3)));
                        }
                        break;
                    }
                    case "presence-rate":
                        s.presenceHz = Math.min(opts.presenceRate, Number(m.hz) || opts.presenceRate);
                        restartPresence(s);
                        break;
                    case "rate-limited":
                        add("rateLimited");
                        break;
                    case "rejected":
                        add("rejected");
                        break;
                    case "role":
                        if (m.role === "edit") s.c.editor = s.c.wantsEdit ?? s.c.editor;
                        break;
                }
            });
        });
    }

    function sendPresence(s) {
        if (s.ws.readyState !== 1) return;
        s.x += (Math.random() - 0.5) * 20;
        s.y += (Math.random() - 0.5) * 20;
        // Written out rather than JSON.stringify'd: the generator sends tens of thousands a second.
        s.ws.send(`{"type":"presence","name":"Load ${s.c.i}","color":"#0D99FF","cursor":{"x":${s.x},"y":${s.y}},"selection":["lt:${now()}"],"pageId":${JSON.stringify(s.c.page)},"camera":{"x":0,"y":0,"zoom":1,"w":1440,"h":900}}`);
        add("presenceSent");
    }
    function restartPresence(s) {
        if (s.presenceTimer) clearInterval(s.presenceTimer);
        if (!going || !opts.presenceRate) return;
        s.presenceTimer = setInterval(() => sendPresence(s), 1000 / s.presenceHz);
        s.timers.push(s.presenceTimer);
    }
    function start(s) {
        if (s.started) return;
        s.started = true;
        // Spread the first sends over one interval so the clients don't move in lockstep.
        setTimeout(() => restartPresence(s), Math.random() * (1000 / Math.max(1, s.presenceHz)));
        if (s.c.editor && opts.editRate > 0) {
            const page = Number(s.c.page.slice(4));
            setTimeout(() => {
                const t = setInterval(() => {
                    if (s.ws.readyState !== 1) return;
                    const id = `r${page}_${Math.floor(Math.random() * 20)}`;
                    s.ws.send(JSON.stringify({ type: "patch", id: Math.random().toString(36).slice(2, 10), patch: { nodes: { [id]: { x: Math.round(Math.random() * 1000), y: Math.round(Math.random() * 1000), lt: now() } } } }));
                    add("patchesSent");
                }, 1000 / opts.editRate);
                s.timers.push(t);
            }, Math.random() * (1000 / opts.editRate));
        }
    }

    parentPort.on("message", (m) => {
        if (m.type === "go") {
            going = true;
            for (const s of live) start(s);
        }
        if (m.type === "measure") {
            measuring = true;
            loop.enable();
            const tick = setInterval(() => parentPort.postMessage({ type: "tick", received: count.received, patchesSent: count.patchesSent, presenceSent: count.presenceSent, open: live.filter((x) => x.ws.readyState === 1).length, buffered: live.reduce((t, x) => t + x.ws.bufferedAmount, 0) }), 1000);
            tick.unref();
        }
        if (m.type === "stop") {
            measuring = false;
            loop.disable();
            parentPort.postMessage({ type: "final", count, loopP99: loop.percentile(99) / 1e6, loopMax: loop.max / 1e6, hist: Object.fromEntries(Object.entries(hist).map(([k, h]) => [k, h.buffer])) });
        }
        if (m.type === "terminate" || m.type === "close") {
            stopping = true;
            for (const s of live) {
                for (const t of s.timers) clearInterval(t);
                if (m.type === "terminate") s.ws.terminate();
                else s.ws.close();
            }
        }
    });

    // Connect at the ramp rate.
    const gap = 1000 / Math.max(1, opts.ramp);
    const pendingOpens = [];
    for (const c of clients) {
        pendingOpens.push(open(c).then((s) => s && live.push(s)));
        await new Promise((r) => setTimeout(r, gap));
    }
    await Promise.all(pendingOpens);
}

if (isMainThread) {
    main().catch((error) => {
        console.error(error?.stack ?? error);
        process.exitCode = 1;
    });
} else {
    runWorker();
}
