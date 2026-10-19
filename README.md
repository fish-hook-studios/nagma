# Nagma

[![CI](https://github.com/fish-hook-studios/nagma/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/fish-hook-studios/nagma/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/fish-hook-studios/nagma?include_prereleases&sort=semver)](https://github.com/fish-hook-studios/nagma/releases/latest)
[![Licence: MPL-2.0](https://img.shields.io/badge/licence-MPL--2.0-blue)](LICENSE)

Nagma is an open-source, self-hostable design suite. One editor and one small sync server cover design, prototyping, whiteboards, slides, campaign assets, sites, apps, video and documents, with live collaboration on files you host yourself.

Website: https://nagma.app
Source: https://github.com/fish-hook-studios/nagma

## Download

The desktop app (editor plus its own local sync server) for macOS, Windows and Linux: **[latest release](https://github.com/fish-hook-studios/nagma/releases/latest)**.

| System | File |
|---|---|
| macOS, Apple silicon | `Nagma-<version>-arm64.dmg` |
| macOS, Intel | `Nagma-<version>-x64.dmg` |
| Windows (x64 and Arm) | `Nagma-Setup-<version>.exe`, or `Nagma-<version>-portable.exe` without installing |
| Linux | `.AppImage` (make it executable and run it) or `.deb` (`sudo apt install ./Nagma-<version>-amd64.deb`) |

The app updates itself from the releases page. Until the builds are signed, the systems warn the first time you open them:

- **macOS**: right-click Nagma in Applications › Open, then Open again (or System Settings › Privacy & Security › Open Anyway). Unsigned Mac builds can't install updates in place: when one is out, Nagma says so and opens its download page.
- **Windows**: on the "Windows protected your PC" screen, choose More info › Run anyway.

To run your own server for a team, see [docs/self-hosting.md](docs/self-hosting.md). Maintainers: [docs/releasing.md](docs/releasing.md).

## Run it

Two processes: the editor and the sync server (only needed for shared files).

```bash
cd apps/web && npm install && npm run dev -- --host
```

```bash
cd apps/server && npm install && npm run dev
```

Open http://localhost:5173. Shared files are stored in `apps/server/data/`.

To host it, build the editor (`npm run build` in apps/web) and run only the sync server: it serves the editor too, on one port. The Dockerfile does both; `fly.toml` is ready for Fly.io.

Everything is free, and anyone can run a Nagma server for their team: `docker-compose.yml` (with Caddy for automatic HTTPS), `.env.example` and the one-command `tools/install.sh` are described in [docs/self-hosting.md](docs/self-hosting.md). The web and desktop apps connect to any Nagma server from the server picker (the badge next to your account on Home, or Nagma > Server… in the desktop app); "This computer" is the server the app came with. Don't want to run one? The project's hosted server, "Nagma (hosted)" in the picker, is free: sign up in the app and Share gives you links that work anywhere.

## What works today

**Collaboration**
- Share gives two links: "can edit" and "can view" (view links can look around and comment; the server refuses their edits). Reset links makes new ones and turns the old ones away
- Share links use this computer's network address when opened on localhost, so they work on other devices
- Live editing: everyone's changes appear instantly; simultaneous changes to different properties merge, the same property takes the last change
- Live cursors with names, collaborators' selections in their colour, avatars and connection status
- Undo and redo only revert your own changes
- Comments (C): pin a comment anywhere, reply in threads, resolve or delete
- Reconnects automatically and re-sends anything that wasn't confirmed
- Version history: checkpoints every 10 minutes of editing and when everyone leaves, plus named versions; preview any version and restore it as one undoable change

**Canvas and chrome**
- Dark and light themes, a left icon rail (File, Assets, Settings), rulers that highlight the selection (⇧R)
- Pan (space + drag, scroll, hand tool) and zoom (⌘ + scroll, pinch, ⌘ + / −, ⇧1 fit, ⇧2 selection)
- Multiple pages: add, rename, duplicate, delete; each page remembers its view

**Drawing and editing**
- Frames, rectangles, ellipses and text (F, R, O, T); frame presets for phone, tablet, desktop, social and print
- Select, shift-select, marquee, ⌘-click to select inside frames, double-click to step into groups, Tab and ⇧Enter to walk the tree
- Move, resize and rotate (drag just outside a corner), flip (⇧H, ⇧V), all working inside rotated frames
- Smart guides: edges and centres snap to siblings and the parent frame; hold ⌥ to measure distances
- Groups (⌘G, ⇧⌘G), frame selection (⌥⌘G), layer order (⌘ [ ], ⌥⌘ [ ]), show/hide (⇧⌘H), lock (⇧⌘L)
- Right-click menu on the canvas and layers list; drag layers in the list to reorder or move them into frames
- Copy, cut, paste (also between Nagma tabs), duplicate, undo and redo

**Home and files**
- Nagma opens on a tab bar with Home and the open file, reopening whatever was open last: a draft from this browser, or a shared file rejoined on the server (with your account, or the link key this browser used before); if that's refused or the server is away, it starts on Home. Home is a file browser: Recents, Drafts, Shared with me and Trash, search, a type filter, grid or list, and file cards with a picture of the first page and when it was edited
- Create ▾ starts a Design file, a Document (pages from PDF, InDesign or DesignCraft), a Video or the sample app; cards can be renamed, duplicated, trashed, restored or deleted
- Accounts live on your Nagma server (sign in from Home or Share): a file shared to the server is owned by whoever shared it. Share invites people by email as Can edit or Can view, lists who has access with their role, and sets what the link allows (Can edit, Can view, No access). Role changes reach open files at once, and the server rejects edits from viewers
- Drafts live in this browser's IndexedDB (the index of names and pictures in localStorage); drafts saved by earlier versions move over on the next start. Home › Shared files lists the files you own on the server and the ones shared with you, with their pictures. Files shared before accounts existed stay open to everyone who reaches the server
- Teams and projects, like a design tool's: Home's sidebar lists your teams and their projects. A team has members with roles (Admin, Can edit, Can view) managed from the Members dialog; admins create projects; files created in a project start on the server inside it, and any file's … menu moves it into a project or out. Team members get edit or view access to every file in the team's projects; a file's own invites take precedence
- Team invite links: admins make a link (Can edit or Can view) from the Members dialog; opening it joins the team after signing in or creating an account. Password reset without mail: "Forgot password?" makes the server write a one-hour reset link to its log and `apps/server/data/reset-links.txt` for the person running it to pass on; signed-in users change their password from the account menu on Home
- Test accounts for a local server are in `apps/server/seed-accounts.example.json`
- Images, PDFs, PSDs and videos live in the media store, not in the document: the document holds a `media:<id>` reference, the bytes sit in this browser's IndexedDB and on the server (`PUT /media/:id`), and collaborators and other devices fetch them on demand. Files that still embed images as data URLs are moved over in the background when they open, without undo steps. Exports (SVG, PDF, Lottie) inline the images they need

**Image fills (PhotoCraft engine)**
- An image is a fill: the fill popover has Solid, Gradient, Image and Video kinds; Image shows the picture, Upload from computer, Fill/Fit, and sliders for Exposure, Contrast, Saturation, Temperature, Tint, Highlights and Shadows, baked by PhotoCraft's raw-style adjustment (WebAssembly, loaded on first use) with the original kept
- Edit in Photo… opens the full PhotoCraft editor: layers, every adjustment (Levels, Curves, Hue/Saturation, …) and 78 filters, with live previews and undo
- Drop in Photoshop files (PSD/PSB): they show flattened in the design and reopen with their layers; saving keeps an edited PSD

**PDFs (PdfCraft engine)**
- Drop in a PDF, or File › New › Pages from PDF, InDesign or DesignCraft…: each page becomes a frame, drawn by PdfCraft's renderer (WebAssembly, loaded on first use)
- Right-click a page › Organize PDF pages: rotate, reorder by dragging, duplicate, insert blank pages and delete, with undo
- Saving updates the page frames in the design and keeps the edited PDF; Download gives you the PDF itself

**Page layouts (DesignCraft engine)**
- Drop in InDesign (IDML) and DesignCraft files, or use File › New › Sample magazine to see it work
- Every page becomes a frame of editable layers: shapes, gradients, strokes, shadows, groups, placed images (cropped as laid out), tables, and text
- Text is set by DesignCraft's paragraph composer (threading, wrap, parent pages, page numbers), then kept with its line breaks as Nagma text layers in the same fonts (Source Serif 4 and Source Sans 3 ship with Nagma)

**Video (FilmCraft engine)**
- Video fills: place or drop a video (MP4, MOV, MKV, WebM, MXF and more), or pick Video in the fill popover. FilmCraft reads the file for its facts and poster frame; the bytes stay in this browser's media store. Video fills play in Motion mode and the prototype player (the browser decodes what it can; FilmCraft decodes the rest, such as ProRes), with Fill/Fit, Loop and Muted
- Export › Animated › MP4 renders video fills frame by frame through FilmCraft and carries their sound as AAC
- Video files: a sequence editor with a preview, transport, a clip strip (videos trimmed with In and Out, stills with a length, titles that are frames on the file's page with their Motion keyframes), split at the playhead, reorder, remove, and Export MP4: H.264 and AAC written by FilmCraft, in the browser, no FFmpeg

**Motion mode (EffectCraft and FilmCraft engines)**
- The toolbar's mode switch is Draw, Design, Motion and Inspect
- Motion adds a timeline: play, auto keyframe, time and duration, loop, a ruler and a row per animated layer with a track per property. Every value in the panel gets a keyframe diamond (X, Y, W, H, rotation, opacity, corner radius); dragging a layer with auto keyframe on records where it is at the playhead; Animations presets (fade, slide, scale, pop) write keyframes in one click
- In Design mode an animated frame shows "Open Motion timeline" above the toolbar, and its Export section gains Static / Animated: Animated has Format (MP4, GIF, Lottie), Size, Quality and Frame rate. A frame with a prototype flow but no keyframes exports the flow instead
- MP4 is H.264 from FilmCraft's encoder and MP4 writer; GIF loops; both run in WebAssembly, no FFmpeg. Lottie writes every layer with keyframes, and EffectCraft's importer reads it back before saving
- Draw mode leads with Brush and Pencil (freehand vectors); the Shape tool has Rectangle, Line, Arrow, Ellipse, Polygon, Star and Image/video…; Actions (⌘K) searches every tool and command
- Inspect makes the file read-only and shows the selection as CSS, iOS or Android code with measurements

**Prototyping**
- Prototype tab: interactions on any layer (on click, on hover, after delay) that navigate, go back, open or close overlays, or open a link
- Transitions: instant, dissolve, match animate (matching layers by name), move in, push and slide in, with direction, easing and duration
- Blue connections on the canvas; drag the handle on a selected layer onto a frame to link it; flow starting points
- Prototype player (play button or ⌥⌘↵): clickable hotspots, back (⌫), restart (R), hotspot hints when clicking elsewhere

**Vectors**
- Pen tool (P): click for corners, drag for curves, click the first point to close, Enter or Escape to finish
- Point editing (double-click or Enter on a shape): drag points and handles (⌥ breaks a smooth handle), double-click a point to switch sharp/smooth, Delete removes it
- Flatten (⌘E) turns rectangles and ellipses into vectors
- Live boolean groups: union, subtract, intersect and exclude (⌥⇧U, S, I, E) with the shapes still editable inside

**Auto layout**
- Vertical and horizontal stacks with gap, padding, 9-way alignment and space-between (⇧A to add, ⌥⇧A to remove)
- Hug contents, fixed size, or fill the parent; dragging inside a stack reorders it

**Text**
- Auto width, auto height (wraps) and fixed text boxes; drag with the text tool for a wrapping box
- Font family (Google Fonts on demand), weight, italic, size, line height, letter spacing, alignment, underline and strikethrough

**Components**
- Create components (⌥⌘K) from a frame or any selection; place instances from Assets, the right-click menu or the properties panel
- Editing a main component updates every instance; changes on an instance are kept as overrides (and survive copy, duplicate and reload)
- Variants: "Add variant" turns a component into a component set; instances switch variants from property dropdowns, keeping text and other changes on matching layers
- Swap, detach (⌥⌘B), reset changes, and go to main component

**Style**
- Multiple fills and strokes per layer, each solid, linear, radial or angular gradient, or image, with its own opacity, visibility and blend mode
- Gradient editor with draggable stops; image fills by drop, paste or ⇧⌘K (fill or fit)
- Stroke weight and position (inside, center, outside); layer blend modes; corner radius and opacity
- Drop shadow and layer blur; clip content on frames
- Constraints (left, right, left and right, center, scale; top, bottom, …) applied when frames and instances are resized or stretched by auto layout
- Export to PNG or JPG (0.5x to 4x), SVG (vector, with gradients, images, strokes and booleans), and PDF (vector, one page per selected frame); copy as SVG

## Engines

`engines/photocraft` is a submodule pointing at the private PhotoCraft mirror. `engines/photo-wasm` is a small Rust bridge
that exposes its engine to JavaScript; `engines/build-photo.sh` rebuilds it into `apps/web/src/engines/photo` (needs Rust
with the wasm32 target, wasm-bindgen-cli and binaryen). The built module is committed, so the editor builds without Rust.

`engines/pdfcraft` and `engines/pdf-wasm` work the same way for PDFs (PdfCraft's document, organize and render crates);
`engines/build-pdf.sh` rebuilds them into `apps/web/src/engines/pdf`. `engines/designcraft` and `engines/layout-wasm` do the
same for page layouts (`engines/build-layout.sh` → `apps/web/src/engines/layout`), and `engines/effectcraft`, `engines/filmcraft`
and `engines/motion-wasm` for motion export (`engines/build-motion.sh` → `apps/web/src/engines/motion`), and `engines/video-wasm`
for video decoding and MP4 writing (`engines/build-video.sh` → `apps/web/src/engines/video`).

## How it is built

`apps/web` is React 19, TypeScript, Tailwind v4 and React Aria, with a 2D canvas renderer.

Every edit is a **command**: plain JSON such as `{ "type": "node.move", "ids": [...], "dx": 10, "dy": 0 }`, applied by a pure function (`src/engine/commands.ts`). Commands produce new documents without mutating old ones, so undo is free, and each committed command is appended to a journal. That journal is what the phase 1 sync server orders and broadcasts. It mirrors how the Craft engines (VectorCraft and friends) model edits, so their Rust engines can take over node kinds without changing the editor's shape.

```
src/
├── engine/      document model, commands, store, camera, text metrics
├── canvas/      renderer, hit testing, pointer gestures, in-place text editor
├── components/  layers panel, design panel, toolbar, fields
└── hooks/       keyboard shortcuts
```

## Roadmap

| Phase | Goal |
|---|---|
| 0 | Editor shell and canvas in the browser (this) |
| 1 | Multiplayer: sync server, live cursors, comments, sharing (done, for a local network) |
| 2 | UI design: auto-layout, components and variants, prototyping |
| 3 | Photo layers (PhotoCraft engine, WebAssembly) (first version done) |
| 4 | Pages and PDF (DesignCraft and PdfCraft) (PDF pages and layout import done) |
| 5 | Motion and Lottie export (EffectCraft) (flow export to MP4, GIF and Lottie done) |
| 6 | Video (FilmCraft) (video fills, video files with a sequence editor, MP4 with sound: done) |

The engine sources are private mirrors under the `Ashhhwath` GitHub account (MIT OR Apache-2.0). Keep their licence and NOTICE files, never use ArtCraft names or logos, and keep their clean-room rules: no assets, code or icons from other design tools.

## Server environment

`apps/server/server.mjs` reads: `PORT` (8787), `DATA_DIR`, `STATIC_DIR`; `MAIL_API_KEY` + `MAIL_FROM` to send password reset mails through Resend (`MAIL_API_URL` to point elsewhere), otherwise the link is logged to `data/reset-links.txt`; `TRASH_DAYS` (30) before trashed files are purged; AI runs on each person's own key, set in Account settings › AI (Claude, OpenAI, or an OpenAI-compatible server such as a local model, plus an image model). Keys are encrypted at rest with a key derived from `NAGMA_SECRET_KEY` (without it, a secret is generated into `DATA_DIR/secret-key` on first run: back it up with the data folder) and are never sent back to the app. `ANTHROPIC_API_KEY` (and optional `ANTHROPIC_MODEL`) is an optional shared key for signed-in people who haven't added their own; `NAGMA_SHARED_AI=0` turns it (and the shared `NAGMA_IMAGE_API_URL`/`NAGMA_IMAGE_API_KEY` image model) off. `NAGMA_AI_PER_MINUTE` (30) limits AI requests per person; `NAGMA_AI_PRIVATE_URLS=1` lets people point the OpenAI-compatible provider at private addresses (on by default in the desktop app, which sets `NAGMA_LOCAL_DEVICE=1` so its own server can keep a key for drafts without an account). `ANTHROPIC_BASE_URL` and `OPENAI_BASE_URL` change where Claude and OpenAI requests go. Usage per person per day is kept in `DATA_DIR/ai-usage.json`.

### Mail and email verification

Mail goes over SMTP when `NAGMA_SMTP_URL` is set (`smtp://user:pass@host:587` or `smtps://…:465`; sender `NAGMA_MAIL_FROM`). On a development server `NAGMA_DEV_MAIL_FILE=1` writes the links that couldn't be mailed into the data folder instead: `email-links.txt` (sign-up verification, email changes, invitation links), `reset-links.txt`, `digests.txt`.

Sign-up makes an unverified account and sends a verification link (random 32 bytes, kept only as a SHA-256, valid 24 hours, single use; opening it verifies the account and signs it in on that device). Until then the account can sign in and work on its drafts, sees a "Verify your email" banner with Resend (at most one mail a minute and five an hour), and can't invite people, share files or folders, publish (community, sites, libraries, Make apps), create teams or be added to one. Single sign-on (OIDC, SAML), a completed password reset, a confirmed email change and the link in an emailed invitation (`?email-token=`, 14 days, sent when `NAGMA_PUBLIC_URL` is set) each prove the address too. Accounts made before verification existed are marked verified when the server loads them.

`NAGMA_REQUIRE_VERIFIED_EMAIL`: `1` requires verification, `0` turns it off. Unset, it's required when the server can deliver the link (`NAGMA_SMTP_URL` or `NAGMA_DEV_MAIL_FILE=1`) and off otherwise, so a local single-user server isn't held back. When it's required and no mail is set up, the banner says so and a server admin (`NAGMA_ADMINS`, or the first account) verifies accounts under Settings › Account (`GET /auth/admin/unverified`, `POST /auth/admin/verify`). Verification links point at `NAGMA_APP_URL` when set, else the address the request came from, else `NAGMA_PUBLIC_URL`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) (setup, tests, the brand-name and clean-room rules), the [Code of Conduct](CODE_OF_CONDUCT.md) and, for security problems, [SECURITY.md](SECURITY.md).

## Licence

Nagma is released under the Mozilla Public License 2.0 (see `LICENSE`). You can use it, self-host it, change it and build on it; changes to Nagma's own files must be shared under the same licence.

Third-party fonts, libraries and engines ship under their own licences, listed in `THIRD_PARTY_NOTICES.md`. Importing other tools' file formats (`.fig`, `.deck`, `.buzz`, `.sketch`, `.pptx`, `.psd`, `.idml`) uses clean-room readers written for interoperability; Nagma contains no code, assets or icons from any other design product.
