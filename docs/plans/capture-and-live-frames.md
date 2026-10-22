# Capture and Live frames

Two features that work as one: a browser extension that turns any web page, with its interactions, into
editable Nagma layers; and Live frames, a layer kind in Design that runs real code on the canvas with
editable props. Capture produces Live frames when it meets behaviour that layers alone cannot hold.

This is a plan, not a spec: numbered phases, each shippable on its own, with what exists today, what
is new, and how we know it works.

## What Nagma has today that this builds on

| Piece | Where | Used for |
|---|---|---|
| Design file model: frames, auto layout, text, images, vectors, constraints, components, variables | apps/web/src/engine | The target of every capture |
| Paste from the web: an HTML/CSS/SVG clipboard becomes layers | engine/svg-import.ts, paste handling | The parser that a DOM walk feeds |
| Layout import (paged documents to layers) | engine/layout-import.ts | The pattern for a "document to layers" importer |
| Sites: layers to responsive HTML with breakpoints, links, hover states | apps/web/src/site | The reverse direction, and the runtime that will host Live frames |
| Make: a prompt or frames to a running app, previewed in a sandboxed iframe | apps/web/src/make, preview-pane.tsx | The sandbox, the bundler and the props model Live frames reuse |
| Prototype: flows, triggers, transitions between frames | engine prototype code, components/prototype | Where captured interactions land |
| Inspect: code for any layer (CSS, Tailwind, SwiftUI, UIKit, Compose, XML) | engine/dev-code.ts | Round trip: a Live frame's code shows here as is |
| Personal access tokens, MCP server, a sync server with files and media | apps/server, apps/mcp | How the extension signs in and sends captures |
| VS Code extension | apps/vscode-extension | Packaging and release pattern for an extension |

## Phase 1: Capture a page as layers (extension, static)

**Extension.** A browser extension (Manifest V3, Chromium first; Firefox and Safari from the same code
later) with one button and one shortcut: capture this page. It runs a content script in the tab:

1. Walk the DOM from `document.body`. For every rendered element take its box (`getBoundingClientRect`),
   computed style (background, borders, radius, shadows, opacity, overflow, transforms, font, text
   properties), text runs, images (`<img>`, `background-image`, `<picture>`, `<svg>` inline, canvas as a
   bitmap), and the pseudo elements `::before` and `::after`.
2. Resolve every asset in the page: images fetched as bytes (same origin and CORS permitting; otherwise
   a screenshot of that box), fonts by family and weight, with the font files listed so Nagma can match
   or substitute.
3. Build a capture document: a tree of boxes with styles, text and assets, plus the viewport size,
   scroll height and the page's title and URL. One JSON, assets as blobs.
4. Send it to Nagma: to the app open in another tab (`postMessage` through the extension), or to a
   server the person is signed in to (a personal access token, `POST /captures`), which makes a new
   file and opens it.

**In Nagma.** A capture importer (`engine/capture-import.ts`) turns the tree into layers:

- Block boxes become frames; flex and grid containers become auto layout with the right direction, gap,
  padding and alignment, read from computed style; absolute positions stay absolute.
- Text becomes text layers with the matched font, size, weight, line height, letter spacing, colour,
  alignment; one layer per block, runs as styled ranges.
- Images, SVGs and canvases become image or vector layers; backgrounds and borders become fills and
  strokes; shadows and radii map one to one; `overflow: hidden` becomes clip.
- Repeated structures (lists, cards) are recognised by matching subtrees and become a component with
  instances, so the capture is editable, not a flat picture.
- The page is one top frame named after the title, sized to the viewport, with the full scroll height.

**Done when:** ten varied pages (a landing page, a docs page, a dashboard, a shop, a blog, a form, a
pricing table, a news site, a web app's settings screen, a page in RTL script) capture into editable
layers that match a screenshot at 1x within tolerance, and the layers panel reads sensibly (names from
tags, classes, ARIA and text).

## Phase 2: Capture breakpoints and states

- **Breakpoints.** The extension captures the same page at desktop, tablet and phone widths (resizing
  the viewport or a hidden iframe) and the importer makes one Sites-style page with three breakpoints
  or three frames side by side, the person's choice.
- **States.** For every element with a `:hover`, `:focus` or `:active` rule, the content script forces
  the state (via the devtools protocol where available, else by replaying the rule) and records the
  differences. Differences become component variants (Default, Hover, Pressed) and prototype
  interactions (while hovering, on press). Transitions declared in CSS become the prototype's easing
  and duration.
- **Scroll and sticky.** Fixed and sticky elements are marked, so the frame's scroll behaviour matches.

**Done when:** a page's nav hover states and button states come in as variants with the right
transition, and a captured page previews in Prototype with those states working.

## Phase 3: Live frames in Design

A new layer kind: a frame whose content is code. The code is HTML plus CSS plus JavaScript, or a
component (React, Svelte, Vue, Web Components) bundled the way Make bundles apps.

- **Model.** `type: "live"` with `source` (the code, or a reference to a Make app's file), `props` (a
  JSON object, with a schema the code declares), `size` and ordinary frame properties (position,
  constraints, auto layout participation). Props can be bound to variables, so a theme or a mode
  changes the live content with the rest of the design.
- **Render.** On the canvas the frame renders in a sandboxed iframe (same sandbox as Make's preview,
  no network unless allowed, CSP, no access to the host page), positioned and scaled with the camera,
  with pointer events off unless the person enters it (double-click, like editing text). Exports and
  thumbnails rasterise it through the same iframe, so a PNG or PDF export shows what the canvas shows.
- **Inspector.** A Code tab: the source with syntax highlighting (reuse Make's editor), a Props section
  generated from the schema (text, number, boolean, colour, select, image), and Variables binding.
- **Interactions.** A Live frame can send events out (`nagma.emit("submit")`) that Prototype uses as
  triggers, and receive variable changes in. That is how a captured page's real widgets (a date picker,
  a map, a chart) keep working inside a design.
- **Sites and Make.** A Live frame published in Sites ships its code; placed in Make it becomes a
  component in the app. Inspect shows its code as is.
- **Collaboration.** The code is document data, so it syncs, has history and comments like any layer.

**Done when:** a chart library component, a form with validation and an embedded map each live on a
Design canvas, take props from the Inspector, export to PNG, publish in Sites and survive a round trip
through a .nagma.json local copy.

## Phase 4: Capture interactions into Live frames

Where layers and variants cannot hold the behaviour (a carousel, a search box with suggestions, a
chart, anything scripted), the extension captures the element's HTML, the CSS that applies to it and
the scripts' effects as a Live frame instead of flattening it. It records the subtree, resolves its
styles inline, snapshots the data it rendered with, and wraps it as a self-contained component. The
rest of the page is still plain layers, so a person edits the design around the live parts.

**Done when:** a page with a carousel and a search box captures with both still working on the canvas
and in Sites, and everything else editable as layers.

## Phase 5: Round trips and polish

- **Back to the web.** A captured page edited in Nagma publishes through Sites with the Live frames
  intact: capture, change the copy and colours, publish, is one afternoon's job.
- **Diffing.** Capture the same URL again and Nagma shows what changed on the page since the last
  capture, layer by layer.
- **Safari and Firefox** builds of the extension; a bookmarklet fallback for browsers without one.
- **Privacy.** Captures never leave the browser unless the person sends them; the extension needs no
  account; sending to a server uses a personal access token; a capture of a page behind a login holds
  what the person could see and nothing else, and the extension says so.

## Order and sizing

| Phase | Depends on | Rough size |
|---|---|---|
| 1 Capture static | nothing | 3 to 4 weeks: extension 1, importer 2, matching and tests 1 |
| 2 Breakpoints and states | 1 | 2 weeks |
| 3 Live frames | nothing (can run in parallel with 1) | 4 weeks: model and render 2, Inspector and props 1, Sites/Make/Inspect 1 |
| 4 Interactions into Live frames | 1, 3 | 2 weeks |
| 5 Round trips and polish | 1 to 4 | ongoing |

Phases 1 and 3 can start together; each ships on its own. The first public release is 1 plus 3: capture
any page as layers, and put real code on the canvas.

## Names and words

- The extension: **Nagma Capture**. The action: "Capture this page".
- The layer kind: **Live frame**. In the Layers panel: a frame with a lightning mark. Inspector tab: Code.
- No competitor names or their feature names anywhere in code, docs, UI or commits. We describe what
  it does: "capture a web page as editable layers", "a frame that runs real code".

## Risks and how we handle them

- **Cross-origin assets.** Images and fonts served from other origins may refuse CORS. Fallback: a
  screenshot of that box via the extension's tab capture, flagged as a bitmap in the layer name.
- **Pages that fight capture.** Infinite scroll, canvas-rendered apps, heavy frameworks. Capture what
  is rendered at that moment and say so; a Live frame captures the rest.
- **Sandbox safety.** Live frames run untrusted code: iframe sandbox without same-origin, CSP, no
  storage, network off by default, a per-document allowlist for domains the person approves.
- **Size.** A capture can be tens of MB of images. Media go to the media store (or the bucket), not the
  document; the importer dedupes by hash.
- **Fonts.** Matching web fonts to what Nagma can load: Google Fonts by name, otherwise the nearest
  from the list, with the original family kept on the layer so a self-hosted font can be added later.
