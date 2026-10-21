# nagma.app

The website at https://nagma.app. A small build script with no dependencies turns the home page,
the guides and the project's own files into a static site.

## Build

```bash
node apps/landing/tools/build-site.mjs
```

This writes `apps/landing/dist/` (not committed) and then checks every internal link and `#anchor`
on every page; a broken one fails the build. Preview it with any static server:

```bash
python3 -m http.server 5392 --bind 127.0.0.1 --directory apps/landing/dist
```

`NAGMA_RELEASES_JSON=<file>` makes the releases page read its list from a file instead of GitHub.

## Cloudflare Pages

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | None |
| Build command | `node apps/landing/tools/build-site.mjs` |
| Build output directory | `apps/landing/dist` |
| Root directory | *(repository root, leave empty)* |
| Environment variable | `NODE_VERSION` = `22` |

Optionally set `GITHUB_TOKEN` (a read-only token) so the releases list isn't subject to GitHub's
anonymous rate limit. Set **Build watch paths** to `apps/landing/*`, `docs/*`, `*.md` and `LICENSE`
so the site rebuilds when a guide changes.

## Where pages come from

| Page | Source |
|---|---|
| `/` | `home.html` (self-contained: its own styles and scripts) |
| `/docs/<name>/` | `docs/<name>.md`; the file's first heading is the title |
| `/contributing/`, `/security/`, `/code-of-conduct/`, `/third-party/` | `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `THIRD_PARTY_NOTICES.md` |
| `/licence/` | `LICENSE` (plain text) |
| `/about/`, `/contact/` | `pages/about.md`, `pages/contact.md` (`title:` in the front matter) |
| `/releases/` | GitHub's releases list, fetched at build time; the stable download links if that fails |
| `/404.html` | Built in the script |

Every generated page uses the home page's nav, footer and cursor (taken from `home.html` at build
time), with `site.css` and `site.js`. Links between these files become links between pages; links to
other repository files go to GitHub. To add a page, add it to the lists at the top of
`tools/build-site.mjs`.

`_redirects` sends `/download/<system>` to the newest GitHub release, so the release assets must keep
the names `Nagma-mac-arm64.dmg`, `Nagma-mac-x64.dmg`, `Nagma-Setup-x64.exe`, `Nagma-x86_64.AppImage`
and `Nagma-amd64.deb`.
