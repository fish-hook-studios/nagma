# Nagma Capture

A browser extension that captures any web page as editable Nagma Design layers: boxes become
frames, flex and grid containers become auto layout, text becomes text layers with its fonts,
pictures become image fills, inline SVG becomes vectors, and repeated cards become a component
with instances. It can also bring a page's hover, press and focus looks as component variants, the
page at several widths, the page's own fonts, and the parts its script runs as Live frames that keep
working. Chromium browsers first (Chrome, Edge, Brave, Arc); Manifest V3. A Firefox build comes
from the same source.

## Install (from this repository)

1. Build it: `cd apps/browser-extension && npm install && npm run build`. The extension is written
   to `apps/browser-extension/dist`.
2. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, choose
   **Load unpacked** and pick `apps/browser-extension/dist`.
3. Pin **Nagma Capture** to the toolbar.

`npm run watch` rebuilds on every change; press the reload arrow on the extension's card to pick it up.

### Firefox

`npm run build:firefox` writes `dist-firefox`: the same code with a manifest Firefox takes (the
background script runs as an event page, the add-on id is `capture@nagma.app`) and without the
debugger features, which Firefox doesn't have (states and widths use the fallbacks below). Load it
from `about:debugging` › This Firefox › **Load Temporary Add-on…** (pick `dist-firefox/manifest.json`),
then allow it on all sites in the add-on's Permissions (Firefox asks for site access separately).

### Safari

Convert the Chromium build with Xcode's converter, then build and enable the app it makes:

```sh
xcrun safari-web-extension-converter apps/browser-extension/dist --app-name "Nagma Capture"
```

There is no Safari build in this repository.

## Use

- **Capture this page** (the popup's button, or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>):
  captures the page you're on and opens it in Nagma as a new file in Drafts. Nagma opens in a tab
  at the address in Options (or the tab already open there is used).
- **Download capture**: saves `<page title>.nagma-capture.json`. Drop it on Nagma's Home, or open
  it with File › Import… (the desktop app's Open takes it too).
- **Include hover and focus states**: each element the page styles on `:hover`, `:active` or
  `:focus` (or `:focus-visible`) comes in as a component set with the variants State=Default, Hover,
  Pressed and Focused, an instance where the element was, and the prototype interactions While
  hovering and While pressing changing to those variants with the page's transition (its duration
  and easing). Elements that are the same in every way share one set.
- **Breakpoints** (`Desktop 1280, Tablet 800, Phone 375`, editable: a name and a width each,
  two to five): the page is captured at each width. Nagma asks how to open it: **Frames side by
  side** (a Design file, frames named `<title> 1280`, `<title> 800`, `<title> 375`) or **Open as a
  site** (a Sites file whose Home page has a breakpoint per width; the narrower widths' layers are
  linked to the widest one's, so a change to its text or colour reaches every width, and what a
  width shows differently stays that width's own).
- **Keep interactive parts working**: tabs, carousels, accordions, dialogs, inputs with
  suggestions, toggles and counters come in as Live frames (named `Live: …`) that work on the
  canvas and in Sites, with the page's markup and the CSS that applies to it. The page's own scripts
  are never brought along or run: Nagma Capture writes a small behaviour for the pattern it
  recognises (switch the tab, scroll the row, open the panel, show and close the dialog, filter the
  suggestions, flip the toggle, count). A part whose behaviour it doesn't recognise comes in as
  layers, as it looks.
- The page's **fonts**: the files of its `@font-face` rules are read, and Nagma installs them on
  this device, so the text is set in the page's typeface instead of a stand-in (see Fonts below).
- **Videos** come in as their current frame (from the screen when the video is from another site),
  with the video's address in the layer's name.
- **Capture a page again**: when you capture an address you captured before, Nagma asks whether to
  **Open as a new file** or **Compare with** the file the last capture opened as. Comparing adds a
  page named `Changes <date>` to that file: the new capture, each changed layer outlined (text,
  pictures, moved, added; removed ones where they were) and a list of the changes beside it.
- **Options › Send to**: Nagma (`https://api.nagma.app`), this computer (`http://localhost:5310`,
  the web app's dev server) or another address, such as your own server.
- **Options › Send through the server**: instead of handing the capture to a Nagma tab, it's
  uploaded to the address above (`POST <address>/captures`, up to 60 MB) with your personal access
  token (make one in Nagma's Settings › Tokens and paste it in Options), and the address the server
  answers with opens in a new tab.

What's captured is the page as it is drawn at that moment, at the window's width: scroll to load
what a page loads lazily, close pop-ups, then capture.

## Permissions

| Permission | Why |
|---|---|
| `activeTab`, `scripting` | Run the capture script in the tab you capture, and hand the capture to the Nagma tab. |
| `<all_urls>` (host access) | Read the page's pictures, style sheets and font files from wherever they're served (a page can use files it couldn't hand to a script), take a screenshot of a box whose picture can't be read (an embedded page, a protected canvas, a video from another site), and reach the Nagma address you choose. |
| `storage` | Remember your options (and, kept in this browser only, your token). |
| `debugger` (optional) | Asked for the first time you capture with states, breakpoints or interactive parts on. With it, states are forced the way the browser's developer tools force them, widths are set without resizing your window, and parts whose script listeners have no other sign are found. While it's in use the browser shows a bar saying the extension is debugging the tab. Without it (or if you say no): states are read by twins of the page's own state rules, the window is resized for each width and put back (browsers keep windows from getting very narrow, so the narrowest width reached is recorded, about 500 pixels), and interactive parts are found by their roles and structure only. **Allow precise states and widths** in the popup asks again. |

## Fonts

A page's fonts are licensed to that site. Nagma Capture reads the files so you can see the page as
it is; Nagma keeps them **on this device only**: in this browser's own store, not in the file, not
in the media store, never uploaded, shared, published with a site or put in a local copy. Opened on
another device, the text shows a stand-in, and the layers keep the family's name so the font can be
added properly. Fonts Nagma has by itself (Inter, the bundled faces, generic families) are never
installed from the page.

## Privacy

- A capture stays in your browser until you send it to Nagma or save it. Sending hands it to the
  Nagma tab in this browser; with **Send through the server** on, it goes to the server address in
  Options, with your token, and nowhere else.
- No account is needed, and the extension keeps nothing but your Options (and your token, if you
  give one).
- A capture of a page behind a sign-in holds what you could see on it, and nothing else.

## How it works

- `src/capture.ts` runs in the page. It walks the rendered DOM and records each element's box and
  the computed styles that map to layers (display, flex and grid, gaps, padding, alignment,
  position, backgrounds and gradients, borders, radii, shadows, opacity, overflow, rotation,
  z-index), text as runs with the first family the browser could draw with (and its outline, from
  `-webkit-text-stroke`), pictures (`img`, `picture`, backgrounds, canvas, video frames or posters),
  inline SVG with its computed paint written in, `::before` and `::after` (stood in for by real
  elements during the walk), list markers and form controls, and each element's DOM path. Hidden,
  zero-size and `display: none` elements are left out.
- `src/states.ts` finds the elements the page styles on `:hover`, `:focus`, `:focus-visible` and
  `:active` (from every sheet, other origins' read from the text the service worker fetched), and
  reads each state's look: forced through the devtools protocol, or by the twin of each state rule
  (the pseudo-class written as an attribute, placed right after the rule so the cascade is the same)
  with the attribute set on the element and its ancestors. Transitions are off while states are read;
  the element's own transition is recorded.
- `src/live-capture.ts` finds the interactive parts and makes each a Live frame's source: its
  markup (scripts and handlers taken out, typed values written in), the page's CSS rules that apply
  to it or to its other states (media queries as they applied at that width), its custom properties
  and inherited text style, and the behaviour shim.
- `src/background.ts` (the service worker) fetches other origins' style sheets, runs the page
  script at each width, forces states, reads the pictures and font files the page couldn't
  (deduplicated by address, up to 40 MB of pictures and 12 MB of fonts), turns a Live frame's
  pictures and fonts into data (it has no network), falls back to a screenshot of the box, and hands
  the capture over: it opens or focuses the Nagma tab and posts the capture to that page's own
  window (`{ type: "nagma-capture", capture }`) after the app answers that it's listening, or sends
  it through the server (`src/send.ts`).
- The format is `apps/web/src/engine/capture-format.ts`; the importer that makes the layers is
  `apps/web/src/engine/capture-import.ts` (a site: `capture-site.ts`), `capture-open.ts` opens one
  in the app (asking with `capture-dialog.ts`), `capture-fonts.ts` installs the page's fonts and
  `capture-diff.ts` compares two captures.

## Testing

`test/fixtures` holds pages to capture (a landing page, docs, a dashboard, pricing, a form, a blog
post, a shop, settings, a right-to-left page, SVG and canvas, an embedded page; buttons, links,
fields and cards with hover, press and focus looks; a page with three layouts; a page with a web
font; outlined type; videos; tabs, a carousel, an accordion, a dialog and inputs with suggestions;
a page that changes on every load). `test/run-fixtures.cjs` captures each with the built script in
an offscreen window, opens the capture in the Nagma dev server the way the extension does, and saves
the page's screenshot next to an export of the imported frame; `test/compare.py` measures and
pictures the difference:

```sh
python3 -m http.server 5733 --bind 127.0.0.1 --directory apps/browser-extension/test/fixtures &
cd apps/desktop && npx electron ../browser-extension/test/run-fixtures.cjs --out /tmp/capture landing docs shop
npx electron ../browser-extension/test/run-fixtures.cjs --out /tmp/capture --states states
npx electron ../browser-extension/test/run-fixtures.cjs --out /tmp/capture --widths 1280,800,375 responsive   # add --site for a site
npx electron ../browser-extension/test/run-fixtures.cjs --out /tmp/capture --live tabs carousel accordion dialog autocomplete
python3 ../browser-extension/test/compare.py /tmp/capture
```

`--still` pauses a page's CSS animations before it's captured and pictured (for pages that keep
moving, such as nagma.app's drifting shapes, so both are of one moment). `--states` adds a pair per variant (the page with the pointer over, pressing or focusing the
element, and the variant's export); `--live` a pair per Live frame before and after one interaction
(the frame loaded as Nagma runs it). `npm run check` type-checks the extension and `npm test` tests
sending through a server. The importer's tests are in `apps/web/src/engine/capture-*.test.ts`.
