# Load testing the sync server

One Nagma server process carries every open file's live session: a WebSocket per open file per
person, patches (edits) relayed to everyone in the file, and presence (cursors, selections, where
people are looking) relayed many times a second. This page has the load-test tool, the numbers before
and after the changes that let one small server carry thousands of connections, the settings that
matter, and how the server could be split across processes if one ever isn't enough.

## The tool

`apps/server/test/load/loadtest.mjs` (not part of `node --test apps/server/test/`). It:

1. starts a scratch server (`--spawn`, in a temporary data folder, stopped afterwards) or uses a
   running one (`--url`);
2. signs up accounts and creates files through the HTTP API (each file has `--pages` pages with 20
   rectangles, and its link set to "can edit");
3. opens `--users` WebSocket clients spread evenly over the files and pages, from worker threads, at
   `--ramp` new connections a second. Every `1/--editors`-th client opens the file's edit link and
   edits; the rest open the view link. The first `--accounts × --per-account` clients sign in, the
   rest are guests;
4. after `--warmup` seconds, measures for `--duration` seconds: editors send `--edit-rate` patches a
   second (moving a rectangle on their page), everyone sends `--presence-rate` presence updates a
   second (a moving cursor), and clients follow the server's `presence-rate` messages as the editor
   does;
5. prints a report, and with `--json <file>` writes it as JSON.

What it measures:

- **Patch relay**: from a client sending a patch to another client in the file receiving it (each
  patch carries the sender's clock; all clients are in one process, so they share the clock).
- **Patch ack**: from sending a patch to the sender getting it back in the server's order.
- **Presence latency**: the same for presence; one presence message in ten is parsed for this (all are
  counted), so the generator keeps up.
- **Rates**: patches and presence sent and received a second, messages and megabytes received.
- **Problems**: dropped patches (gaps in the versions a client sees), unexpected closes, connection
  errors, rate-limited and rejected messages, and clients joined as viewers because the file already
  had as many editors as it allows.
- **Server**: CPU (from `/health` statistics, or `ps` for a spawned server), the largest resident
  memory, and the event loop's p99 delay. `/health` reports these with `NAGMA_HEALTH_STATS=1` (the
  tool sets it for `--spawn`) or to a signed-in server admin.
- **Load generator**: its own event-loop delay. When its maximum is high, the generator was busy and
  latencies include its own delay; the report says so.
- `--drop`: after the run, every client drops at the same moment (no close handshake); the report
  says whether the server stayed up and how soon `/health` answered.
- `--profile` (with `--spawn`): the server runs with `node --cpu-prof`; the profile is written when it
  stops (open it in Chrome DevTools › Performance). `--profile-dir` chooses the folder.

```
node apps/server/test/load/loadtest.mjs --help
node apps/server/test/load/loadtest.mjs --spawn --users 1000 --files 100 --duration 30
node apps/server/test/load/loadtest.mjs --url https://staging.example.com --users 200 --files 20
node apps/server/test/load/loadtest.mjs --spawn --users 3000 --files 300 --profile --profile-dir prof
node apps/server/test/load/loadtest.mjs --config load.json --spawn --verbose
```

Options can also come from a JSON file (`--config`; command-line options win), with `env` for the
spawned server's settings: `{"users": 500, "files": 5, "env": {"NAGMA_ROOM_EDITORS": "50"}}`, or
`--env NAGMA_ROOM_EDITORS=50` on the command line. `--server <path to server.mjs>` spawns another copy
of the server (an older checkout, for before/after numbers). `--verbose` prints throughput and server
CPU every second; `NAGMA_LOAD_DEBUG=1` makes each worker write a heartbeat to stderr.

Against a server that isn't yours, ask first: thousands of connections look like an attack. Against a
server behind Cloudflare, the per-account and per-connection limits apply as for anyone; give the
test accounts' server `NAGMA_WS_PER_ACCOUNT` room, or use guests (`--accounts 0`).

The tool raises the spawned server's open-file limit (`ulimit -n 65536`); each socket is a file on
both sides. On macOS, check `ulimit -n` in the shell that runs the tool too (the load generator holds
`--users` sockets).

## Results

Measured on a MacBook (Apple silicon, 10 cores, 16 GB, macOS, Node 24.18.1) with the server and the
load generator on the same machine (8 generator threads), so the network is loopback: latencies are
the server's own, without the internet's. The machine was also running other work and swapping
heavily (10 of 11 GB of swap in use), so single runs vary; the 3,000-connection "after" run was
run three times, with patch relay p99 of 9.7, 30.6 and 96.1 ms.

Each run: 10% editors at 2 patches a second, everyone moving a cursor at 20 presence updates a second,
files with 2 pages and people spread evenly over them, 30 s measured after 3 s of warm-up. "Before" is
the server at commit `0aec439`; "after" is this branch.

| Run | Patch relay p50 / p95 / p99 (ms) | Presence p50 / p95 / p99 (ms) | Messages received /s | Server CPU avg / max | Server memory |
| --- | --- | --- | --- | --- | --- |
| 200 people, 20 files, before | 0.1 / 2.3 / 4.0 | 1.5 / 3.9 / 5.1 | 36,180 (14.5 MB/s) | 23% / 27% | 117 MB |
| 200 people, 20 files, after | 0.3 / 0.9 / 1.6 | 30.9 / 50.0 / 51.0 | 4,387 (6.1 MB/s) | 24% / 30% | 105 MB |
| 1,000 people, 100 files, before | 1.3 / 14.2 / 32.8 | 3.2 / 19.3 / 38.3 | 180,935 (71.9 MB/s) | 65% / 82% | 212 MB |
| 1,000 people, 100 files, after | 0.2 / 0.8 / 1.7 | 25.4 / 48.5 / 50.3 | 21,998 (30.3 MB/s) | 45% / 53% | 242 MB |
| 3,000 people, 300 files, before | 2,360 / 6,590 / 7,860 | 2,340 / 6,730 / 8,020 | 85,222 (33.8 MB/s) | 23% / 93% ¹ | 259 MB |
| 3,000 people, 300 files, after | 1.0 / 36.9 / 96.1 | 28.7 / 54.0 / 73.4 | 57,499 (78.6 MB/s) | 86% / 96% | 385 MB |
| 1,000 people in 10 files (100 each), before | 4,110 / 13,930 / 16,900 | 4,340 / 13,880 / 16,990 | 164,791 (65.5 MB/s) | 53% / 98% ¹ | 148 MB |
| 1,000 people in 10 files (100 each), after | 0.6 / 2.8 / 4.8 | 42.5 / 182 / 200 ² | 24,977 (93.8 MB/s) | 34% / 37% | 209 MB |
| 1,000 people, 300 editors (30%), before | 1.5 / 10.0 / 12.8 | 4.9 / 12.4 / 14.4 | — | 66% / 71% | 208 MB |
| 1,000 people, 300 editors (30%), after | 0.3 / 1.0 / 1.5 | 26.4 / 49.0 / 50.6 | — | 49% / 57% | 241 MB |

¹ The server fell behind: it couldn't send what it was asked to (3,000 people at 20 cursor updates a
second in rooms of 10 is 540,000 messages a second), its send buffers grew, and it delivered in bursts
seconds late; it then stalled the load generator with a flood of backlog (generator delays of 8–27 s),
so "before" at these sizes overstates throughput and CPU is averaged over idle stretches. Edits
arrived 2–17 seconds late.
² In files with more than 50 people, presence goes at 5 updates a second instead of 20, so a cursor
waits up to 200 ms.

Dropping all 3,000 connections at once (`--drop`): before, the server took 35.4 s to answer `/health`
again (sending the backlog to sockets that were gone); after, 0.2 s, with every socket closed and the
rooms leaving memory once idle. The node:test suite does the same with 3,000 sockets on every run.

What the numbers say:

- **Edits** got faster everywhere (relay p99 1.6–1.7 ms at 200–1,000 people instead of 4–33 ms) and
  stay well under 100 ms at 3,000 connections with 300 editors, where the old server was seconds
  behind. Patches are encoded once per room and are no longer queued behind cursor traffic.
- **Presence** costs about a tenth of the messages it did, which is what lets 3,000 connections run:
  each person now gets one message per 50 ms with everyone else's latest cursors, instead of one
  message per person per update. The price is latency: a cursor waits for the room's next presence
  message, 25 ms on average and 50 ms at most (200 ms in busy rooms), on top of the network. That is
  the same 20 updates a second the editor always sent, delivered on a beat; a 25 ms room tick halved
  the wait but cost a fifth more CPU at 3,000 connections (socket writes are most of the server's
  work). Drawing peers' cursors with a short glide between updates would hide the beat entirely (not
  done here).
- **Memory** is a little higher (compression for large messages, the recent-operations ring) and
  bounded: idle rooms leave memory, and each socket's compressor is small.
- **One process tops out around here**: 3,000 connections with every cursor moving 20 times a second
  and 300 people editing keeps one core about 90% busy on this machine, and a cloud ARM core is
  slower. Real sessions are lighter (cursors only move while the pointer does, hidden tabs send
  nothing, the editor stops sending when nothing changed), but past this point the next step is more
  processes; see [Sharding](#sharding-across-processes).

### Exact commands

```bash
# The "before" server: the same files at commit 0aec439, with this checkout's node_modules.
mkdir -p /tmp/nagma-before
git archive 0aec439 apps/server | tar -x -C /tmp/nagma-before
ln -s "$PWD/apps/server/node_modules" /tmp/nagma-before/apps/server/node_modules
BEFORE="--server /tmp/nagma-before/apps/server/server.mjs"

L=apps/server/test/load/loadtest.mjs
for who in before after; do
  X=""; [ "$who" = before ] && X="$BEFORE"
  node $L --spawn --port 48951 --users 200  --files 20  --duration 30 --label "$who 200"  --json $who-u200.json  $X
  node $L --spawn --port 48951 --users 1000 --files 100 --duration 30 --label "$who 1000" --json $who-u1000.json $X
  node $L --spawn --port 48951 --users 3000 --files 300 --duration 30 --label "$who 3000" --json $who-u3000.json $X
  node $L --spawn --port 48951 --users 1000 --files 10  --duration 30 --label "$who big rooms" --json $who-big.json $X
  node $L --spawn --port 48951 --users 1000 --files 100 --editors 0.3 --duration 30 --label "$who 300 editors" --json $who-editors300.json $X
  node $L --spawn --port 48951 --users 3000 --files 300 --duration 10 --drop --label "$who drop" --json $who-drop.json $X
done
```

(Run with `bash`: in zsh, `$X` doesn't split into two arguments; write the options out instead.)

## What changed

- **Presence** (`apps/server/sync-scale.mjs`, `apps/web/src/engine/presence-throttle.ts`): the editor
  sends at most 20 updates a second (coalesced, always ending on the latest state), nothing while its
  tab is hidden or when nothing changed, and moves the camera at most 5 times a second. The server
  gathers each room's presence and sends each person one message (`presences`, a list; `presence`
  when there's one) at most every 50 ms, never with their own update, with cursors, selections and
  cameras only from people on the same page (a page switch, spotlight, the call and the like go to
  everyone; someone who switches page gets everyone already there). Rooms with more than
  `NAGMA_BUSY_ROOM` (50) people go to 5 updates a second, and the server tells their clients to slow
  down (`presence-rate`); a message carries at most 60 people. Cursors are passed on as two numbers
  and selections as ids only. People leaving at the same moment are announced in one `leave` message.
  Presence is sent uncompressed.
- **Rooms** (`apps/server/server.mjs`): each room keeps its last `NAGMA_ROOM_OPS` (1000) operations.
  A reconnecting client says which version it has (`since`) and gets only what it missed (`resume`),
  or the whole file when that's further back; its own edits the server already applied come back as
  `ack` instead of being applied twice. A file is written at most every `NAGMA_SAVE_MS` (2 s) while
  people edit, or after `NAGMA_SAVE_OPS` (500) changes (before, every change pushed the write back, so
  a busy file wasn't written until people paused). Rooms nobody is in leave memory after
  `NAGMA_ROOM_IDLE_MS` (10 minutes), only once their file is written. On SIGTERM or SIGINT the server
  writes unsaved files and tells clients it is restarting (1012) before exiting.
- **Editors per file**: at most `NAGMA_ROOM_EDITORS` (100). Others with edit access join as viewers
  with a message saying why (`capped`), their edits are kept (`rejected` with `editors-full`), and the
  first one waiting becomes an editor (`role`) when an editor leaves.
- **Limits per connection and account**: `NAGMA_WS_PER_SECOND` (60) messages a second per connection,
  presence aside (presence beyond 80 a second is dropped). Beyond that, messages wait in line and are
  handled in order, with a `rate-limited` message (code 429); more than five seconds' worth waiting
  closes the connection (4013) and the editor reconnects and sends what wasn't confirmed.
  `NAGMA_WS_PER_ACCOUNT` (10) connections per account; the next is refused with a notice (4029) and the
  editor waits to be asked before trying again. Sockets that stop answering pings are closed within a
  minute, so they don't hold a seat or count against an account.
- **Sending**: messages to a room are encoded once (one buffer for every socket). Compression
  (`perMessageDeflate`) for messages over 1 KB (snapshots, large patches), fast and with a small
  window, so each socket's compressor is about 25 KB.
- **Reconnecting** (`apps/web/src/engine/reconnect.ts`, `collab.ts`): exponential backoff with jitter
  (0.25–0.5 s, then doubling, up to 7.5–15 s), so a crowd that lost the server doesn't come back in the
  same instant. Editing carries on while disconnected (as before, kept in the browser for 30 days);
  more than 20 waiting changes go up as one patch.
- **Reads at the edge**: ETags and `Cache-Control` on the app's files, published sites and the file
  list (see [Behind Cloudflare](self-hosting.md#behind-cloudflare)); `NAGMA_TRUST_PROXY=cloudflare`.
- **`/health` statistics**: CPU, memory, connections, rooms, people and editors, the busiest room,
  event-loop delay and message counters, with `NAGMA_HEALTH_STATS=1` or for a server admin.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `NAGMA_ROOM_EDITORS` | 100 | People editing one file at once; more join as viewers until a spot frees up. |
| `NAGMA_WS_PER_SECOND` | 60 | Messages a second per connection (presence aside). |
| `NAGMA_WS_PER_ACCOUNT` | 10 | Open connections per account. |
| `NAGMA_ROOM_IDLE_MS` | 600000 | How long a file nobody has open stays in memory. |
| `NAGMA_ROOM_OPS` | 1000 | Recent operations kept per open file for reconnecting clients. |
| `NAGMA_SAVE_MS`, `NAGMA_SAVE_OPS` | 2000, 500 | An open file is written at most this often, or after this many changes. |
| `NAGMA_BUSY_ROOM` | 50 | Above this many people in a file, presence goes at 5 updates a second. |
| `NAGMA_HEALTH_STATS` | off | `1` adds process and room statistics to `/health`. |
| `NAGMA_TRUST_PROXY` | off | `1` behind a proxy, `cloudflare` behind Cloudflare (visitor addresses for rate limits). |

## Sharding across processes

Not built: one process carries the numbers above, and splitting it doesn't fit cleanly today. The
server keeps accounts, sessions, teams, projects, the inbox and every file's access rules in one
process's memory, writes them as JSON files, and HTTP routes change rooms directly (renaming a file,
changing its access, restoring versions). Two processes would each have their own copy of accounts and
teams, and both would write `users.json`. What it would take, behind `NAGMA_WORKERS=<n>`:

1. **A router in the main process** (`node:cluster` primary, or a plain `net` server): it accepts
   connections and, for WebSocket upgrades to `/files/<id>`, hands the socket to worker
   `hash(id) % n` (`worker.send("upgrade", socket)` with the request head), so everyone in a file
   meets in the same worker; HTTP stays in the main process.
2. **Rooms only in workers**: each worker runs the sync half of `server.mjs` (rooms, presence, the op
   ring, saving files) for its share of file ids.
3. **Shared state through the main process**: workers ask it to check a session token and a file's
   access (`roleFor`), and the main process tells the right worker when access changes
   (`applyRoleChanges`), a file is renamed, deleted or restored, so those routes reach rooms through a
   message instead of the room object. Accounts and teams stay written by the main process only.
4. **Per-account limits** counted in the main process (a worker asks before accepting a connection).

Until then, scale in this order: keep cursors light (the defaults above), give the server a fast core
rather than many, put Cloudflare in front for everything that isn't live editing, and move media to a
bucket ([Media storage](self-hosting.md#media-storage)) so the process only handles live sessions.

## Not measured

- Real browsers (the generator speaks the protocol directly; the editor's own throttle is tested with
  vitest), a real network between clients and server, Cloudflare in front, and a 4-core ARM server:
  these numbers are from one laptop over loopback.
- Long runs (hours): memory over time, and rooms coming and going.
- Very large documents: the test files are small, so snapshots and saves are cheap here.
