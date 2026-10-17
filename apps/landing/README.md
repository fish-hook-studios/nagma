# nagma.app

The website at https://nagma.app: static files, no build step. Plain HTML, one stylesheet and a
small script (the Download button picks the visitor's system; Copy on the code snippets). Everything
works without JavaScript.

| File | What it is |
|---|---|
| `index.html` | The page |
| `styles.css`, `main.js` | Styles (light and dark from the system setting) and the script |
| `img/` | Screenshots of the app at 1440×900 (and 720-wide copies), plus `og.png` for link previews |
| `favicon.svg` | The N mark, the same as `apps/web/public/favicon.svg` |
| `404.html` | Served by Cloudflare Pages for unknown paths |
| `_headers` | Security headers (CSP, HSTS, frame and referrer rules) and cache times |
| `_redirects` | `/download/mac`, `/download/windows`, `/download/linux`, `/download`, `/github`, `/docs`, `/self-host` |

## Cloudflare Pages

Create a Pages project connected to the GitHub repository (`fish-hook-studios/nagma`) with:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | None |
| Build command | *(none, leave empty)* |
| Build output directory | `apps/landing` |
| Root directory | *(repository root, leave empty)* |

Then add the custom domain `nagma.app` (and `www.nagma.app`, redirected to it) under **Custom
domains**. With the domain's DNS on Cloudflare, Pages creates the records itself; elsewhere, point a
CNAME at the project's `*.pages.dev` address.

To skip builds for commits that don't touch the site, set **Build watch paths** to include only
`apps/landing/*`.

## Downloads

`_redirects` sends `/download/<system>` to the newest GitHub release, so the release assets must
keep these names on every release:

| Link | Asset |
|---|---|
| `/download/mac` | `Nagma-mac-arm64.dmg` |
| `/download/windows` | `Nagma-Setup-x64.exe` |
| `/download/linux` | `Nagma-x86_64.AppImage` |

`/download` itself opens the latest release page, which lists every asset.

## Preview locally

Any static file server works, for example from the repository root:

```bash
python3 -m http.server 8000 --directory apps/landing
```

(`_headers` and `_redirects` apply only on Cloudflare Pages.) Check the links with
`node tools/check-landing-links.mjs`.

## Screenshots

The pictures in `img/` are of the app itself, taken at 1440×900 in the dark theme from files made
with its own starter files and templates. Keep each one under 300 KB (WebP), with `width` and
`height` set in the HTML, and `loading="lazy"` below the first screen.
