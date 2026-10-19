# Self-hosting Nagma

Nagma is free, all of it. Collaboration, teams, comments, published sites and Make apps run on a
Nagma server, and anyone can run one: on a small VPS for a team, on a machine in the office, or on
your own laptop (the desktop app already runs one for your own files). The web and desktop apps
connect to any Nagma server.

One server is one container: the editor and the sync server on a single port, with everything it
keeps (files, accounts, uploads, sites) in one data folder.

## Requirements

- A Linux server with Ubuntu 22.04+ or Debian 12+ (other systems work with Docker installed by hand).
- 1 CPU and 1 GB of memory for a small team; 2 GB or more if you build the image on the server
  (the first build compiles the editor). Disk: a few GB plus your files and uploads.
- Ports 80 and 443 open (HTTPS), or one port of your choice for plain HTTP.
- A domain name, for HTTPS. Without one, Nagma runs on `http://<server address>:8080`, which is
  fine on a private network but not on the internet.
- Optional: an SMTP account for mail (verification links, password resets, invitations, digests).

## Install with one command

On the server, as root or with sudo:

```bash
curl -fsSL https://raw.githubusercontent.com/fish-hook-studios/nagma/main/tools/install.sh | sudo bash
```

Or from a checkout of the repository:

```bash
git clone https://github.com/fish-hook-studios/nagma.git nagma && cd nagma
sudo bash tools/install.sh
```

The installer:

1. installs Docker and its compose plugin if they're missing (from get.docker.com);
2. gets Nagma's source: the checkout it's run from, or a clone into `/opt/nagma`;
3. asks for your domain, the admin's email, the server's name, and optionally an SMTP address;
4. writes `.env` (readable by root only);
5. builds and starts the containers with `docker compose up -d --build`, with Caddy in front for
   automatic HTTPS when you gave a domain;
6. prints the address and what to do first.

Every question has a flag for unattended installs (`--domain`, `--admin-email`, `--name`,
`--smtp-url`, `--mail-from`, `--port`, `--dir`, `--yes`); `bash tools/install.sh --help` lists them.
`--dry-run` prints every step and the `.env` it would write, and changes nothing.

### First admin

Open the address the installer printed, choose **Sign in or create an account**, then **Create
account** with the admin email you gave. That account is the server admin (`NAGMA_ADMINS`). Without
`NAGMA_ADMINS`, the first account made on the server is the admin.

When mail isn't set up but verification is required (`NAGMA_REQUIRE_VERIFIED_EMAIL=1`), the admin
verifies new accounts under **Settings › Account**.

## Install by hand

```bash
git clone https://github.com/fish-hook-studios/nagma.git nagma && cd nagma
cp .env.example .env        # then edit it: at least NAGMA_PUBLIC_URL and NAGMA_ADMINS
docker compose up -d --build
```

For automatic HTTPS, set `NAGMA_DOMAIN=nagma.example.com`, `COMPOSE_PROFILES=https`,
`NAGMA_PUBLIC_URL=https://nagma.example.com`, `NAGMA_BIND=127.0.0.1` and `TRUST_PROXY=1` in `.env`,
then `docker compose up -d`. Caddy gets and renews the certificate on its own.

`docker-compose.yml` has two services:

- **nagma**: built from the repository's `Dockerfile`, restarts always, keeps its data on the named
  volume `nagma-data` (mounted at `/data`), reads `.env`, and is published on
  `${NAGMA_BIND}:${NAGMA_HTTP_PORT}` (default `0.0.0.0:8080`).
- **caddy** (profile `https`): a reverse proxy on ports 80 and 443 for `NAGMA_DOMAIN`, with its
  certificates on the `caddy-data` volume. Live collaboration uses WebSockets, which Caddy passes
  through as they are.

Any other reverse proxy works too (nginx, Traefik, a load balancer): send the domain to port 8080,
pass WebSocket upgrades through, and set `TRUST_PROXY=1`.

## DNS

Point your domain at the server with an **A** record (and **AAAA** for IPv6), for example
`nagma.example.com → 203.0.113.10`. Caddy gets the certificate the first time the domain is
visited, once DNS has reached it.

**Cloudflare**: the record may be proxied (orange cloud); see [Behind Cloudflare](#behind-cloudflare).

Published sites are always at `https://<your domain>/s/<site name>/`. To serve them at
`<site name>.sites.example.com` as well, add a wildcard record (`*.sites.example.com`), set
`NAGMA_SITES_DOMAIN=sites.example.com`, and give your proxy a wildcard certificate (with Caddy that
needs a DNS provider plugin; the path form needs nothing).

## Behind Cloudflare

Cloudflare in front of the server (a proxied, orange-cloud record) answers the app's files, public
pages and published sites from its edge close to each visitor, and passes live collaboration (a
WebSocket per open file) through to the server. Settings in the Cloudflare dashboard for your domain:

1. **SSL/TLS › Overview: Full (strict).** Cloudflare then talks HTTPS to your server and checks its
   certificate (Caddy's, or a Cloudflare Origin Certificate). "Flexible" would send passwords and
   files from Cloudflare to the server unencrypted, and loops with Caddy's redirect to HTTPS.
2. **Network: WebSockets on** (the default). Live editing, cursors and comments use them; with them
   off, files open read-only and nobody sees anyone else.
3. **Caching › Cache Rules**: the server already says what may be cached, so one rule is enough.
   Create a rule for your hostname with *URI Path starts with `/assets/`* → **Eligible for cache**,
   **Edge TTL: use cache-control header if present**, **Browser TTL: respect origin**. The app's
   built files have content hashes in their names and are sent with
   `Cache-Control: public, max-age=31536000, immutable`, so Cloudflare keeps them until a release
   changes their names. Optionally add the same rule for `/s/` and `/sites/` (published sites):
   public sites are sent `public` (pages `no-cache`, so Cloudflare checks them with their `ETag` and
   gets an empty 304 when they haven't changed; their files for 5 minutes), while sites behind a
   password or for a team only are sent `private` and never stored at the edge. Don't cache
   everything: answers about files, accounts and the file list are per person (`private`).
4. **Don't** turn on Rocket Loader, Auto Minify or Email Address Obfuscation for this hostname: they
   rewrite the app's pages and scripts. **Always Use HTTPS** is fine once the server has its
   certificate; Caddy proves the domain over plain HTTP on port 80, which Cloudflare passes through,
   so either turn the record to DNS only (grey cloud) until the first certificate is issued or add a
   rule that skips `/.well-known/acme-challenge/*`.
5. **Visitor addresses.** Behind Cloudflare every request comes from a Cloudflare address, so set
   `NAGMA_TRUST_PROXY=cloudflare` in `.env`: sign-in and sign-up limits then go by the visitor's
   address in `CF-Connecting-IP`, which Cloudflare sets itself. Anyone who can reach the server
   without going through Cloudflare could send that header too, so allow only
   [Cloudflare's addresses](https://www.cloudflare.com/ips/) to ports 80 and 443 on the server's
   firewall (or use a Cloudflare Tunnel). Behind your own proxy without Cloudflare, use
   `NAGMA_TRUST_PROXY=1` (the address the proxy saw, the last `X-Forwarded-For` entry).
6. **Timeouts.** Cloudflare closes a WebSocket that has been silent for 100 seconds; the server pings
   every 30 seconds, so idle tabs stay connected. When a connection drops anyway (Cloudflare
   restarts its edge from time to time), the editor reconnects on its own, with a growing, random
   wait, and gets only the changes it missed; edits made in the meantime are kept and sent then.

To check: `curl -sI https://nagma.example.com/assets/<a file in dist/assets>` shows
`cf-cache-status: HIT` from the second request on, and `curl -sI https://nagma.example.com/` shows an
`etag`.

## Connect the apps to your server

**Desktop app.** Nagma runs a server on your computer for your own files ("This computer"). To
collaborate, choose **Nagma › Server…** in the menu bar (or click the server badge next to your
name on Home), then **Add server…**, type your server's address (`nagma.example.com`) and choose
**Check server**: Nagma shows the server's name and version. Choose **Connect to** that server, then sign in or
create an account there.

**Web app.** Your server serves the web app itself: open `https://nagma.example.com`. Any Nagma web
app can also connect to another server from the same picker (the badge next to the account on
Home, the account menu's **Server…**, or **Change** in the sign-in dialog).

What switching does:

- Each server has its own accounts and sessions. Switching back signs you in again as you were.
- Drafts stay on your device. What the app keeps for you (drafts, open tabs, recents, stars) is
  kept apart per server and account, so nothing from one server shows on another, and nothing is lost.
- Shared files, teams and sites belong to the server they're on. Tabs for another server's files
  close when you switch away, and come back when you switch back.
- Links to files carry their server. Opening a link to a file on another server (in a browser, or
  through the desktop app's `nagma://` links) offers to switch to it.

The server's name in the picker comes from `NAGMA_SERVER_NAME`. Its `/health` address answers
`{ ok, name, version, publicUrl }`, which is how the picker checks a server.

## Updating

```bash
cd /opt/nagma            # or your checkout
git pull
sudo docker compose up -d --build
```

Your data is on the `nagma-data` volume and survives rebuilds. Take a backup first (below). Running
`tools/install.sh` again also updates a clone in `/opt/nagma` and keeps your `.env`.

## Backups and restore

```bash
sudo bash tools/backup.sh                         # backups/nagma-data-<time>.tar.gz
sudo bash tools/backup.sh --remote b2:my-bucket   # and copy it off the server with rclone
sudo bash tools/backup.sh --stop                  # pause Nagma for a backup taken at one instant
```

The backup is a tar of the whole data volume: files and their versions, accounts and sessions,
uploads, teams, sites, and `secret-key` (which the saved AI keys need). Old local backups beyond `--keep` (14) are removed. For off-site copies,
install [rclone](https://rclone.org/install/), add a remote with `rclone config`, and pass it as
`--remote` or set `NAGMA_BACKUP_REMOTE` in `.env`. Nightly at 3:00, with `sudo crontab -e`:

```
0 3 * * * bash /opt/nagma/tools/backup.sh --quiet
```

To restore (this replaces the current data, stopping and restarting Nagma around it):

```bash
sudo bash tools/backup.sh --restore backups/nagma-data-20261018-030000.tar.gz
```

To move to a new server: install there, restore a backup from the old one, then point DNS at the new
server.

## Media storage

Images, video, audio, PDFs, fonts and comment attachments are kept by id, apart from the files that
use them. By default they're on the server's disk (`DATA_DIR/media`) and go through the server both
ways. That's fine for a team; for many people, put them in an S3-compatible bucket (Cloudflare R2,
Backblaze B2, MinIO, AWS S3): browsers then upload to it and read from it directly, with addresses
the server signs for a few minutes after checking access, so media never passes through the server
and a small server can serve many people. The desktop app's own server always keeps media on disk.

How it works: the editor asks the server to upload (`POST /media/<id>/upload`); the server checks
that the person can edit the file and the limits below, and answers with a presigned `PUT` address in
the bucket (10 minutes). The browser uploads there and tells the server it's done; the server checks
the object (size, type) and records it. Uploads never finished are removed after a day. To read, the
editor asks for a short-lived address (`GET /media/<id>/url`), and `GET /media/<id>` redirects to one,
so links and `<video>` elements (with seeking) keep working. The same bytes uploaded again by the same
person aren't sent twice. The server's disk keeps only a small record per asset.

### Cloudflare R2, step by step

1. **Bucket.** In the Cloudflare dashboard, open R2 and create a bucket (say `nagma-media`). Keep it
   private (no public access) unless you want the public address below.
2. **API token.** R2 → Manage API tokens → Create API token. Permission: **Object Read & Write**,
   applied to that bucket only. Copy the **Access Key ID** and **Secret Access Key** (shown once) and
   the S3 endpoint, `https://<account id>.r2.cloudflarestorage.com`.
3. **CORS.** Browsers upload and read straight from the bucket, so it must allow the editor's origin.
   Bucket → Settings → CORS policy → add:

   ```json
   [
     {
       "AllowedOrigins": ["https://nagma.example.com", "http://127.0.0.1:47878"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["content-type", "range"],
       "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   List every address the editor is opened from: your server's (`NAGMA_PUBLIC_URL`), the separate
   app address if you use `NAGMA_APP_URL`, and `http://127.0.0.1:47878` for the desktop app connected
   to your server (it uses another port when that one is taken). `"*"` also works: every bucket
   address the server hands out is signed and expires in minutes, and CORS only decides which pages
   may use them.
4. **Public address (optional).** For files whose share link is on (no password, no end date), reads
   can use a public address and be cached by Cloudflare's CDN: bucket → Settings → Custom domains →
   connect a domain (say `media.example.com`), and set `NAGMA_S3_PUBLIC_URL` to it. Everything in a
   public bucket can be read by anyone who has an object's address (ids are random, and the server
   only hands out that address to people who can open the file); leave it unset to keep every read
   presigned. The `r2.dev` address is rate limited and not meant for this.
5. **Settings.** Add to `.env` and restart (`docker compose up -d`):

   ```bash
   NAGMA_MEDIA_STORE=s3
   NAGMA_S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
   NAGMA_S3_REGION=auto
   NAGMA_S3_BUCKET=nagma-media
   NAGMA_S3_ACCESS_KEY=<access key id>
   NAGMA_S3_SECRET_KEY=<secret access key>
   # NAGMA_S3_PUBLIC_URL=https://media.example.com
   # NAGMA_S3_PREFIX=nagma/
   ```

   The log says `media: stored in bucket nagma-media` when it's in use.

Other stores: Backblaze B2 (`https://s3.<region>.backblazeb2.com`, its region such as `us-west-004`,
an application key with read and write on the bucket, CORS rules set with the B2 CLI or API), MinIO
(`http://minio:9000`, region `us-east-1`), AWS S3 (`https://s3.<region>.amazonaws.com`). Addresses are
path style (`endpoint/bucket/key`); `NAGMA_S3_PATH_STYLE=0` uses `bucket.endpoint/key` instead.

### Moving existing media

Media already on the disk keeps working after the switch: the server reads each asset wherever it
is. To move it into the bucket (and back, with `--to local`):

```bash
docker compose exec nagma node media-migrate.mjs --to s3            # copy everything to the bucket
docker compose exec nagma node media-migrate.mjs --to s3 --remove   # and delete the disk copies once checked
```

It reads the same settings as the server, can run while the server does, logs each asset, and can
be stopped and run again: what's already moved is skipped. `--dry-run` lists what it would copy.
Without Docker: `DATA_DIR=/path/to/data node apps/server/media-migrate.mjs --to s3` with the
`NAGMA_S3_*` settings in the environment.

### Limits

Whatever the store, the server holds these (each person sees the reason when one is reached):

| Setting | Default |
| --- | --- |
| `NAGMA_MEDIA_MAX_MB` | 500: the largest single upload. |
| `NAGMA_FILE_MEDIA_MAX_MB` | 2048: all the media uploaded to one file. |
| `NAGMA_MEDIA_UPLOADS_PER_HOUR`, `NAGMA_MEDIA_MB_PER_HOUR` | 600 uploads and 5120 MB per account per hour. |
| `NAGMA_MEDIA_URL_MINUTES` | 10: how long a signed read or upload address works. |
| `NAGMA_MEDIA_PENDING_HOURS` | 24: when an upload never finished is removed. |

Backups (above) cover the disk only: with a bucket, back the bucket up with your provider's tools or
`rclone sync`, since that's where the media is.

## Environment reference

Every setting, with a one-line explanation, is in [`.env.example`](../.env.example). Leave settings
you don't use commented out rather than empty: an empty value counts as set. The main ones:

| Setting | What it does |
| --- | --- |
| `NAGMA_DOMAIN` | Domain Caddy serves with automatic HTTPS (with `COMPOSE_PROFILES=https`). |
| `NAGMA_PUBLIC_URL` | The address people reach the server at; used in emailed and shared links. |
| `NAGMA_APP_URL` | Where the editor lives when another address serves it (single sign-on returns there). |
| `NAGMA_SERVER_NAME` | The name the apps' server picker shows (default "Nagma"). |
| `NAGMA_ADMINS` | Comma-separated admin emails; unset, the first account is the admin. |
| `NAGMA_SMTP_URL`, `NAGMA_MAIL_FROM` | Mail over SMTP, and the sender address. |
| `NAGMA_REQUIRE_VERIFIED_EMAIL` | `1` or `0`; unset, verification is required when mail works. |
| `NAGMA_SIGNUP_PER_HOUR` | Sign-ups allowed per address per hour (10). |
| `NAGMA_SITES_DOMAIN`, `NAGMA_SITES_CNAME` | Subdomain hosting for sites, and the CNAME target for custom domains. |
| `NAGMA_ICE_SERVERS` | STUN/TURN servers (JSON) for calls across networks. |
| `NAGMA_OIDC_ISSUER`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_NAME`, `_DOMAINS` | Single sign-on with OpenID Connect. SAML is set up per team in the admin console. |
| `ANTHROPIC_API_KEY` | Server-wide fallback key for AI features; people can also add their own keys. `NAGMA_SHARED_AI=0` turns the shared key off. |
| `NAGMA_SECRET_KEY` | Secret that encrypts the AI keys people save. Unset, the server writes one to `DATA_DIR/secret-key` on first run; keep that file (it is in the backup) or the saved keys can't be read back. |
| `NAGMA_AI_PER_MINUTE` | AI requests allowed per person per minute (30). |
| `NAGMA_STOCK_KEY`, `NAGMA_GIF_KEY`, `NAGMA_IMAGE_API_*`, `NAGMA_GITHUB_TOKEN` | Optional integrations. |
| `NAGMA_MEDIA_STORE`, `NAGMA_S3_*` | Where media lives: `local` (the server's disk, the default) or `s3`, a bucket browsers upload to and read from directly. See [Media storage](#media-storage). |
| `NAGMA_MEDIA_MAX_MB`, `NAGMA_FILE_MEDIA_MAX_MB`, `NAGMA_MEDIA_UPLOADS_PER_HOUR`, `NAGMA_MEDIA_MB_PER_HOUR` | Media limits: per upload (500), per file (2048), per account per hour (600 uploads, 5120 MB). |
| `TRASH_DAYS`, `SESSION_IDLE_DAYS`, `DIGEST_MINUTES`, `AUTO_VERSION_MS` | Housekeeping (30 days, 30 days, 30 minutes, 30 minutes). |
| `NAGMA_TRUST_PROXY` | `1` behind a reverse proxy, so rate limits see the visitor's address (the one the proxy saw); `cloudflare` behind Cloudflare (`CF-Connecting-IP`). The older `TRUST_PROXY=1` still works. |
| `NAGMA_ROOM_EDITORS`, `NAGMA_WS_PER_SECOND`, `NAGMA_WS_PER_ACCOUNT` | Editors at once per file (100; more join as viewers until a spot frees up), messages a second per connection (60, cursors aside), open connections per account (10). |
| `NAGMA_ROOM_IDLE_MS`, `NAGMA_ROOM_OPS`, `NAGMA_SAVE_MS`, `NAGMA_SAVE_OPS`, `NAGMA_BUSY_ROOM` | Memory and disk for open files: unused files leave memory after 10 minutes, the last 1000 changes are kept for reconnecting clients, a file is written at most every 2 s (or after 500 changes), and files with more than 50 people send cursors 5 times a second instead of 20. See [load-testing.md](load-testing.md). |
| `NAGMA_HEALTH_STATS` | `1` adds CPU, memory, connections, rooms and event-loop delay to `/health` (server admins always see them). |
| `PORT`, `DATA_DIR`, `STATIC_DIR` | Set inside the container (8080, `/data`, the built editor). |
| `NAGMA_UPDATE_URL`, `NAGMA_UPDATE_CHANNEL`, `NAGMA_NO_UPDATES` | For building the desktop app: a folder of your own its updates are published to (by default, the project's GitHub Releases), or `NAGMA_NO_UPDATES=1` for builds that never update. See [releasing.md](releasing.md). |

Settings named `MIGFA_*` (the product's name before it was Nagma) are still read as their `NAGMA_*`
names, with a line in the log; rename them when you can.

## Troubleshooting

- **Logs**: `sudo docker compose logs -f nagma` (and `caddy`).
- **Is it up?** `curl http://127.0.0.1:8080/health` on the server.
- **No certificate**: check that the domain resolves to the server (`dig +short nagma.example.com`)
  and that ports 80 and 443 are open; `sudo docker compose logs caddy` says what failed.
- **The app can't connect** (Couldn't reach…): open `https://<your domain>/health` in a browser; it
  must answer with `"ok": true`.
