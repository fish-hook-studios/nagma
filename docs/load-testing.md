# Load testing the sync server

One Nagma server process carries every open file's live session: a WebSocket per open file per
person, patches (edits) relayed to everyone in the file, and presence (cursors, selections, where
people are looking) relayed many times a second. This page has the load-test tool, the numbers before
and after the changes that let one small server carry thousands of connections, the settings that
matter, and room workers (`NAGMA_WORKERS`), which spread live sessions over several processes when
one isn't enough.

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
  processes; see [Room workers](#room-workers-more-than-one-core).

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
| `NAGMA_PRESENCE_HZ` | 20 | Presence messages a second per person (at most 20). Clients are told the rate and send at it, so lowering it cuts cursor traffic both ways. |
| `NAGMA_WORKERS` | 1 | Processes for live sessions: `N` above 1 adds N room workers, `auto` one per core but one. See [Room workers](#room-workers-more-than-one-core). |
| `NAGMA_HEALTH_STATS` | off | `1` adds process and room statistics to `/health`. |
| `NAGMA_TRUST_PROXY` | off | `1` behind a proxy, `cloudflare` behind Cloudflare (visitor addresses for rate limits). |

## Room workers: more than one core

One process uses one core. `NAGMA_WORKERS=N` (N above 1, or `auto`: one per core but one) spreads
live sessions over N room worker processes beside the main one (`apps/server/room-workers.mjs`,
`room-worker.mjs`). `1`, the default, is the single process above, unchanged, with no messages between
processes; the desktop app's server always runs that way.

### How it works

- **The main process accepts every connection.** For a WebSocket upgrade it takes the socket out of
  its HTTP server, stops reading it, and hands it (with the request's headers and any bytes already
  read) to the worker the file's id hashes to (FNV-1a of the id, modulo N), over Node's IPC with the
  socket's handle. The worker completes the handshake, so everyone in one file meets in the same
  worker. Everything else (HTTP API, accounts, sessions, teams, inbox, notifications, media, sites,
  AI, admin) stays in the main process, with its state, as before.
- **A worker holds the sockets** of its files: it reads and parses every message, applies the
  per-connection limits (`NAGMA_WS_PER_SECOND`, the presence cap, flood closes), keeps everyone's
  presence and sends it per room (page filtering, the busy-room rate, `presence-rate`, leaves),
  pings, compresses large messages, and writes everything to the sockets. That is most of the work:
  presence never leaves the worker. A worker sends a room's presence messages in slices of 4 ms with
  its event loop free in between, so edits aren't held up behind a whole round of cursor messages
  (at 5,000 people on the laptop: edit relay p99 101 → 47 ms).
- **The main process keeps each room's state**: the document, the order of changes and the
  recent-operations ring (resume), saving (2 s / 500 changes, as before), the hello (sign-in, access,
  link keys, the per-account limit, the editor cap and promotion), comments, versions and restores,
  votes, dev statuses and their notifications. A worker passes every message but presence up, and the
  main process answers with what to send: to one socket, or to a whole room (encoded once; the worker
  writes the same buffer to each socket). For the code in `server.mjs` a remote socket is a stand-in
  with `send`, `close` and `readyState`, and a client's role is mirrored to its worker as it changes,
  so HTTP routes that reach rooms (sharing and role changes, renames, deletes, version restores,
  merges) work unchanged. The API's live selection asks the worker for the person's presence. Messages
  between processes are batched per event-loop turn (Node's `advanced` serialization).
- **A worker that stops** (crash, out-of-memory kill) is logged and started again (straight away,
  backing off to 5 s if it keeps stopping); upgrades meanwhile wait for it. Its people's sockets
  closed with it; clients reconnect with backoff and resume from the last version they have. The
  documents were never in the worker, so nothing is lost beyond messages in flight, which the client
  sends again (unconfirmed edits) on resume. Rooms in other workers carry on.
- **Stopping** (SIGTERM, SIGINT): the main process tells the workers, each closes its sockets with
  1012 (restarting) and exits; the main process writes unsaved files and waits for them. A worker
  whose main process goes away closes its sockets and exits.
- **`/health` statistics** add up CPU, memory, connections and counters over every process, take
  the worst event-loop delay, and list each process under `processes` (with `workers: N`). The load
  tool then also reports the main process's and the busiest worker's CPU and event-loop delay.

### Results on the production hardware

Measured on the hosted instance's machine type: Oracle Cloud Ampere A1, 4 ARM cores, 24 GB, Ubuntu,
Node 22, with the load generator on the same machine (2 generator threads) and the scratch server on
a spare port, over loopback. "Before" is one process (`NAGMA_WORKERS=1`, the same code path as commit
`00f9649`); "after" is `NAGMA_WORKERS=3` (main process + 3 workers: every core). Each run: 10% of
people editing at 2 patches a second, everyone moving a cursor at 20 updates a second, files of 10
people with 2 pages, 30 s measured.

| Run | Edit relay p50 / p95 / p99 (ms) | Cursors p50 / p95 / p99 (ms) | Sent by the generator: edits/s, cursor updates/s (of those asked for) | Cursor updates delivered /s | Server CPU (all processes) | Memory (all processes) | Generator event-loop p99 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 people, 100 editors, before | 52.8 / 101 / 113 | 80.6 / 123 / 139 | 200 of 200, 19,645 of 20,000 | 38,048 | 105% | 301 MB | 16 ms |
| 1,000 people, 100 editors, after | 5.3 / 15.4 / **30.3** | 28.6 / 52.1 / 61.2 | 198 of 200, 18,966 of 20,000 | 75,357 | 181% (main 5%, busiest worker 61%) | 550 MB | 24 ms |
| 2,000 people, 200 editors, before | 92.9 / 188 / 266 | 175 / 286 / 328 | 394 of 400, 36,750 of 40,000 | 2,180 | 109% | 462 MB | 23 ms |
| 2,000 people, 200 editors, after | 60.1 / 140 / 170 | 76.3 / 159 / 199 | 355 of 400, 21,155 of 40,000 | 72,485 | 221% (main 5%, busiest worker 82%) | 691 MB | 139 ms ¹ |
| 3,000 people, 300 editors, before | 169 / 365 / 498 | 300 / 493 / 570 | 549 of 600, 40,968 of 60,000 | 2,782 | 107% | 612 MB | 62 ms |
| 3,000 people, 300 editors, after | 138 / 306 / 391 | 134 / 361 / 478 | 454 of 600, 18,551 of 60,000 | 48,465 | 183% (main 6%, busiest worker 64%) | 888 MB | 406 ms ¹ |
| 5,000 people, 500 editors, before | 391 / 846 / 1,070 | 568 / 906 / 1,010 | 789 of 1,000, 41,490 of 100,000 | 4,121 | 107% | 878 MB | 165 ms ¹ |
| 5,000 people, 500 editors, after | 260 / 455 / 633 | 277 / 617 / 811 | 610 of 1,000, 14,923 of 100,000 | 39,886 | 162% (main 8%, busiest worker 56%) | 1,133 MB | 667 ms ¹ |
| 5,000 people all editing, before | 6,830 / 20,330 / 24,080 | none delivered | 7,661 of 10,000, 31,589 of 100,000 | 0 | 107% | 955 MB | 225 ms ¹ |
| 5,000 people all editing, after | 2,790 / 5,190 / 5,930 | 816 / 2,000 / 2,970 | 4,471 of 10,000, 7,039 of 100,000 | 4,117 | not sampled ² | – | 1,591 ms ¹ |

Edits only (`--presence-rate 0`: nobody moves a cursor), same machine:

| Run | Edit relay p50 / p95 / p99 (ms) | Edits sent /s | Server CPU | Memory |
| --- | --- | --- | --- | --- |
| 5,000 people, 500 editors, before | 1.5 / 5.8 / 58.3 | 999 of 1,000 | 46% | 684 MB |
| 5,000 people, 500 editors, after | 2.2 / 10.0 / **22.4** | 1,000 of 1,000 | 58% (main 14%, busiest worker 17%) | 1,029 MB |
| 5,000 people all editing, before | 6,650 / 21,610 / 26,220 | 9,996 of 10,000 | 100% | 724 MB |
| 5,000 people all editing, after | 2,100 / 5,420 / 6,890 | 8,548 of 10,000 | not sampled ² | 1,044 MB |

With fewer cursor updates (`NAGMA_PRESENCE_HZ`, below), 5,000 people and 500 editors: at 10 a second,
edit relay p99 1,200 ms before and 377 ms after; at 5 a second, 831 ms before and 442 ms after (the
generator again starved after: 549 to 722 ms event-loop delay). With 2 workers instead of 3, the
workers were pinned at 100% and did worse (p99 301 ms at 3,000 people, 1,540 ms at 5,000).

¹ The machine was saturated: the generator and the server share 4 cores, the kernel took 35 to 40%
of the CPU (loopback TCP: every message costs its sending and its receiving side on this machine),
and the generator managed to send only 15 to 70% of what it was asked to (its event loop 140 to
1,600 ms late), so these latencies include the generator's own delay and the load is lower than the
row says. "Before" sent more because its server only ever took one core.
² `/health` didn't answer within the tool's 900 ms often enough to sample: the workers were
overloaded.

What the numbers say:

- **Where the machine can drive the load (1,000 people), edits are 3.7 times faster** (p99 113 →
  30 ms) and cursors twice as fast, and twice as many cursor updates reach people: one process was
  pinned at 100% of a core and coalescing cursor traffic to keep up. The main process uses 5% of a
  core; the three workers share the rest evenly.
- **From 2,000 people up, this machine can't both generate and serve the load.** With the server on
  every core the generator gets less CPU and sends less (15 to 50% of the cursor updates), so these
  rows understate the load for "after" and the latencies include the generator's delay. Still, edits
  are faster with workers at every size (p99 633 vs 1,070 ms at 5,000), and cursors keep flowing:
  40,000 to 72,000 updates a second delivered, where one process had effectively stopped relaying
  them (2,000 to 4,000 a second).
- **The goal (5,000 people, 500 editors, edit p99 under 150 ms) was not reached on this machine with
  the generator on it**: 633 ms. Edits alone at 5,000 people are well under it (22 ms p99, against
  58 ms in one process). What's left is cursor traffic: at 20 updates a second, 5,000 people mean
  about 100,000 cursor messages a second each way, and on these cores each message in or out costs
  the server 35 to 45 µs (at 1,000 people; writing to sockets, which over loopback includes the
  receiving side's work, is over a third of it), so that rate needs more than 4 of them whatever the
  process model. Real sessions send far less (cursors move only while the pointer does, hidden tabs
  send nothing); `NAGMA_PRESENCE_HZ=10` halves the traffic in both directions for a server that needs
  it.
- **Everyone editing at once (10,000 edits a second)** is still beyond this machine: 24 s → 6 s p99.
  The main process handles the edits themselves at 40% of a core; the workers writing 90,000 edit
  messages a second to sockets are the limit.
- **Memory**: each worker adds about 80 MB at rest; each connection costs about 150 KB wherever it
  is. 5,000 connections: 1.1 GB with 3 workers, 0.9 GB in one process.

### Results on a laptop

The same runs on the MacBook from [Results](#results) (10 cores, so the generator, with 8 threads,
keeps up; Node 24; the machine was again swapping, so runs vary): one process against 3 workers.

| Run | Edit relay p50 / p95 / p99 (ms), one process | 3 workers | Cursor updates delivered /s, one process | 3 workers | Server CPU, one process | 3 workers |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 people, 100 editors | 0.2 / 0.9 / 4.6 | 0.3 / 1.0 / 3.6 | 78,950 | 78,912 | 44% | 66% |
| 3,000 people, 300 editors | 0.6 / 5.6 / 43.4 | 0.5 / 1.7 / 6.5 | 230,173 | 237,163 | 84% | 134% |
| 5,000 people, 500 editors (3 runs) | p99 55.4, 64.8, 38.4 | p99 11.1, 40.2, 356 ³ | 202,000–229,000 | 388,000–394,000 | 113–114% | 207–211% |
| 5,000 people all editing | 54.6 / 229 / 317 | 19.1 / 67.5 / 138 | 18,667 | 300,370 | 115% | 304% |

³ The generator was busy in that run (event loop up to 278 ms late). At 5,000 people one process
delivers about half the cursor updates (it falls behind and coalesces them; cursor p50 43–47 ms
against 24 ms) and its event loop is up to 374 ms late; with 3 workers everyone gets every update.

### Commands

On the server (scratch copies only; the load tool is `apps/server/test/load/loadtest.mjs`):

```bash
# This branch's server, with its dependencies (no dev dependencies):
rsync -a --exclude node_modules --exclude test apps/server/ server:/home/ubuntu/nagma-src-workers/
ssh server 'cd /home/ubuntu/nagma-src-workers && npm ci --omit=dev'
# On the server, from the folder with loadtest.mjs and ws installed:
S="--spawn --port 48960 --workers 2 --server /home/ubuntu/nagma-src-workers/server.mjs"
for w in 1 3; do
  node loadtest.mjs $S --env NAGMA_WORKERS=$w --users 1000 --files 100 --editors 0.1 --duration 30 --json w$w-1000.json
  node loadtest.mjs $S --env NAGMA_WORKERS=$w --users 2000 --files 200 --editors 0.1 --duration 30 --json w$w-2000.json
  node loadtest.mjs $S --env NAGMA_WORKERS=$w --users 3000 --files 300 --editors 0.1 --duration 30 --json w$w-3000.json
  node loadtest.mjs $S --env NAGMA_WORKERS=$w --users 5000 --files 500 --editors 0.1 --duration 30 --json w$w-5000.json
  node loadtest.mjs $S --env NAGMA_WORKERS=$w --users 5000 --files 500 --editors 1 --duration 30 --json w$w-5000-all.json
  node loadtest.mjs $S --env NAGMA_WORKERS=$w --users 5000 --files 500 --editors 0.1 --presence-rate 0 --duration 30 --json w$w-5000-p0.json
  node loadtest.mjs $S --env NAGMA_WORKERS=$w --users 5000 --files 500 --editors 1 --presence-rate 0 --duration 30 --json w$w-5000-all-p0.json
  for hz in 10 5; do
    node loadtest.mjs $S --env NAGMA_WORKERS=$w --env NAGMA_PRESENCE_HZ=$hz --users 5000 --files 500 --editors 0.1 --duration 30 --json w$w-5000-hz$hz.json
  done
done
node loadtest.mjs $S --env NAGMA_WORKERS=2 --users 3000 --files 300 --editors 0.1 --duration 30
node loadtest.mjs $S --env NAGMA_WORKERS=2 --users 5000 --files 500 --editors 0.1 --duration 30
```

On the laptop (`ulimit -n 65536` first), the same with `--port 48951` and the default 8 generator
threads, from the repository:

```bash
L=apps/server/test/load/loadtest.mjs
for w in 1 3; do
  node $L --spawn --port 48951 --env NAGMA_WORKERS=$w --users 1000 --files 100 --editors 0.1 --duration 30
  node $L --spawn --port 48951 --env NAGMA_WORKERS=$w --users 3000 --files 300 --editors 0.1 --duration 30
  node $L --spawn --port 48951 --env NAGMA_WORKERS=$w --users 5000 --files 500 --editors 0.1 --duration 30
  node $L --spawn --port 48951 --env NAGMA_WORKERS=$w --users 5000 --files 500 --editors 1 --duration 30
done
```

### Limits

- **The main process still does every room's ordering**: each edit is applied, recorded and saved
  there, and every hello, comment, version and restore goes through it. That's light (40% of a
  laptop core at 10,000 edits a second, 5 to 14% of an ARM core in the runs above), but it is one
  core: past roughly 20,000 edits a second it is the limit.
- **A file never spans workers**: one very busy file is limited to one worker's core (the editor cap
  and the busy-room presence rate keep that in bounds). Files are spread by a fixed hash, so a few
  huge files can land on the same worker; nothing rebalances them.
- **A worker restart drops its connections** (only its files'); clients reconnect and resume.
- **The socket hand-over** uses Node's handle passing and stops the main process's copy reading
  with `socket._handle.readStop()` (an internal, long-stable API); without it, a client's first
  message could be read by the main process and lost (seen at 2–8 in 1,000 connections on the ARM
  machine). If a Node release changed that, the room-worker tests would show it.
- **`/health` with workers** waits for each worker's answer (up to 2 s); an overloaded worker shows
  as `down` in that answer.

## Not measured

- Real browsers (the generator speaks the protocol directly; the editor's own throttle is tested with
  vitest), a real network between clients and server, and Cloudflare in front: every number here is
  over loopback, with the generator on the same machine. On the 4-core ARM server that limits what
  can be measured (see [Room workers](#room-workers-more-than-one-core)); a generator on other
  machines would show what the server alone carries.
- Long runs (hours): memory over time, and rooms coming and going.
- Very large documents: the test files are small, so snapshots and saves are cheap here.
