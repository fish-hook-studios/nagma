# Nagma Capture

A browser extension that captures any web page as editable Nagma Design layers: boxes become
frames, flex and grid containers become auto layout, text becomes text layers with its fonts,
pictures become image fills, inline SVG becomes vectors, and repeated cards become a component
with instances. Chromium browsers first (Chrome, Edge, Brave, Arc); Manifest V3.

## Install (from this repository)

1. Build it: `cd apps/browser-extension && npm install && npm run build`. The extension is written
   to `apps/browser-extension/dist`.
2. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, choose
   **Load unpacked** and pick `apps/browser-extension/dist`.
3. Pin **Nagma Capture** to the toolbar.

`npm run watch` rebuilds on every change; press the reload arrow on the extension's card to pick it up.

## Use

- **Capture this page** (the popup's button, or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>):
  captures the page you're on and opens it in Nagma as a new file in Drafts. Nagma opens in a tab
  at the address in Options (or the tab already open there is used).
- **Download capture**: saves `<page title>.nagma-capture.json`. Drop it on Nagma's Home, or open
  it with File › Import… (the desktop app's Open takes it too).
- **Options › Send to**: Nagma (`https://api.nagma.app`), this computer (`http://localhost:5310`,
  the web app's dev server) or another address, such as your own server.
- **Include hover and focus states** is coming (variants for each state).

What's captured is the page as it is drawn at that moment, at the window's width: scroll to load
what a page loads lazily, close pop-ups, then capture.

## Privacy

- A capture stays in your browser until you send it to Nagma or save it. Sending hands it to the
  Nagma tab in this browser; nothing goes to any server from the extension itself.
- No account is needed, and the extension keeps nothing but your Options.
- A capture of a page behind a sign-in holds what you could see on it, and nothing else.

## Permissions

| Permission | Why |
|---|---|
| `activeTab`, `scripting` | Run the capture script in the tab you capture, and hand the capture to the Nagma tab. |
| `<all_urls>` (host access) | Read the page's pictures from wherever they're served (a page can show pictures it couldn't hand to a script), take a screenshot of a box whose picture can't be read (an embedded page, a protected canvas), and reach the Nagma address you choose. |
| `storage` | Remember the Nagma address. |

## How it works

- `src/capture.ts` runs in the page. It walks the rendered DOM and records each element's box and
  the computed styles that map to layers (display, flex and grid, gaps, padding, alignment,
  position, backgrounds and gradients, borders, radii, shadows, opacity, overflow, rotation,
  z-index), text as runs with the first family the browser could draw with, pictures (`img`,
  `picture`, backgrounds, canvas, video frames or posters), inline SVG with its computed paint
  written in, `::before` and `::after` (stood in for by real elements during the walk), list
  markers and form controls. Hidden, zero-size and `display: none` elements are left out.
- `src/background.ts` (the service worker) reads the pictures the page couldn't (deduplicated by
  address, up to 40 MB in all), falls back to a screenshot of the box, and hands the capture over:
  it opens or focuses the Nagma tab and posts the capture to that page's own window
  (`{ type: "nagma-capture", capture }`) after the app answers that it's listening.
- The format is `apps/web/src/engine/capture-format.ts`; the importer that makes the layers is
  `apps/web/src/engine/capture-import.ts`, and `capture-open.ts` opens one in the app.

## Testing

`test/fixtures` holds pages to capture (a landing page, docs, a dashboard, pricing, a form, a blog
post, a shop, settings, a right-to-left page, SVG and canvas, an embedded page). `test/run-fixtures.cjs`
captures each with the built script in an offscreen window, opens the capture in the Nagma dev
server the way the extension does, and saves the page's screenshot next to an export of the
imported frame; `test/compare.py` measures and pictures the difference:

```sh
python3 -m http.server 5733 --bind 127.0.0.1 --directory apps/browser-extension/test/fixtures &
cd apps/desktop && npx electron ../browser-extension/test/run-fixtures.cjs --out /tmp/capture landing docs shop
python3 ../browser-extension/test/compare.py /tmp/capture
```

`npm run check` type-checks the extension. The importer's tests are
`apps/web/src/engine/capture-import.test.ts` and `capture-open.test.ts`.
