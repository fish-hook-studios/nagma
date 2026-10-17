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

**Cloudflare**: the record may be proxied (orange cloud). Set **SSL/TLS** to **Full (strict)**, and
keep WebSockets on (the default). Caddy proves the domain over plain HTTP on port 80, which
Cloudflare passes through; if you turned on Cloudflare's **Always Use HTTPS**, either turn the
record to DNS only (grey cloud) until the first certificate is issued or add a page rule that skips
`/.well-known/acme-challenge/*`.

Published sites are always at `https://<your domain>/s/<site name>/`. To serve them at
`<site name>.sites.example.com` as well, add a wildcard record (`*.sites.example.com`), set
`NAGMA_SITES_DOMAIN=sites.example.com`, and give your proxy a wildcard certificate (with Caddy that
needs a DNS provider plugin; the path form needs nothing).

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
| `TRASH_DAYS`, `SESSION_IDLE_DAYS`, `DIGEST_MINUTES`, `AUTO_VERSION_MS` | Housekeeping (30 days, 30 days, 30 minutes, 30 minutes). |
| `TRUST_PROXY` | `1` behind a reverse proxy, so rate limits see the visitor's address. |
| `PORT`, `DATA_DIR`, `STATIC_DIR` | Set inside the container (8080, `/data`, the built editor). |
| `NAGMA_UPDATE_URL`, `NAGMA_UPDATE_CHANNEL` | For building the desktop app: where its updates are published. |

Settings named `MIGFA_*` (the product's name before it was Nagma) are still read as their `NAGMA_*`
names, with a line in the log; rename them when you can.

## Troubleshooting

- **Logs**: `sudo docker compose logs -f nagma` (and `caddy`).
- **Is it up?** `curl http://127.0.0.1:8080/health` on the server.
- **No certificate**: check that the domain resolves to the server (`dig +short nagma.example.com`)
  and that ports 80 and 443 are open; `sudo docker compose logs caddy` says what failed.
- **The app can't connect** (Couldn't reach…): open `https://<your domain>/health` in a browser; it
  must answer with `"ok": true`.
