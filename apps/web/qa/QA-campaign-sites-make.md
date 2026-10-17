# QA: Campaign, Sites and Make

Exploratory and adversarial QA of Campaign (marketing assets), Sites and Make, end to end in the
running web app (Vite dev build on :5233 against a scratch sync server on :48813 with three test
accounts and a test team), plus security probes of their server routes with curl. Branch
`feature/qa-campaign-sites`.

How it was tested, and its limits:

- The built-in browser pane was hidden for most of the session, so screenshots and pointer/keyboard
  input through the browser tool were refused ("the page is not compositing frames"). Flows were
  driven through the real UI elements instead: clicks on the buttons and menu items, values typed
  into the fields with input/change/focusout events, keydown events at the focused element or
  window, HTML drag events on the asset list and Bulk edit grips, pointer events on the fill handle,
  and file pickers fed generated files. Results were read from the editor state (`window.nagma`,
  `window.nagmaModules`) and the DOM. Early rows (asset list, context menus, ⌘D, ⌫, grid "+",
  real right-click and Escape) used real input while the pane was visible.
- Test media was made in the page (canvas + MediaRecorder: H.264 MP4 with sound, VP9 and VP8
  WebM). Exports were caught before download (nothing saved to Downloads) and checked by their
  bytes (magic numbers, ZIP directory names, decoded duration and size, PNG iCCP chunk).
- Untitled.buzz was copied into the worktree's ignored `apps/web/.qa-tmp/` (removed afterwards) so
  the dev server could hand it to the importer.
- Make prompts were exercised against a stand-in model API on localhost (ANTHROPIC_BASE_URL),
  never a real model; without a key the server's own messages were checked.
- The test browser blocks esm.sh, so Make apps (which import React from it) never render: the
  preview-dependent tools (Copy as design layers, the Edit tool and its properties panel) and the
  published app's UI are marked BLOCKED.

Totals: **282 test rows: 245 pass, 34 fail (each fixed and re-verified), 2 blocked, 1 known**.
31 bugs found (3 S1, 6 S2, 15 S3, 7 S4), all fixed. Regression tests: 25 new Vitest tests
(`src/campaign/qa-campaign.test.ts`, `src/site/qa-site.test.ts`, `src/site/qa-sample.test.ts`,
`src/engine/collab-switch.test.ts`; suite now 1377, all pass) and 7 new server tests
(`apps/server/test/qa-sites-make.test.mjs`; suite now 138, all pass). Type-check clean, oxlint
0 errors.

## 1. Test matrix

FAIL rows failed before the fix in the last column; each passes now.

| # | Product | Feature | Steps | Expected | Actual (before any fix) | Result | Fix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Campaign | Campaign › New file | Home › Campaign | Editor opens with "Start your campaign" picker (size select, 5 starters, Blank, Your team's, From a design file) | As expected | PASS |  |
| 2 | Campaign | Picker › Photo on top | Click Photo on top | Template asset 1080x1080 with Photo, Headline, Subhead, Logo, Button; one undo step | As expected | PASS |  |
| 3 | Campaign | Add dialog | New asset | Dialog lists 46 presets with sizes, Custom, From a design file, Blank asset, Starter template | 46 presets listed | PASS |  |
| 4 | Campaign | Preset: Square post | New asset › Square post › Blank asset | Asset 1080x1080 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 5 | Campaign | Preset: Portrait post | New asset › Portrait post › Blank asset | Asset 1080x1350 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 6 | Campaign | Preset: Story | New asset › Story › Blank asset | Asset 1080x1920 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 7 | Campaign | Preset: Reel cover | New asset › Reel cover › Blank asset | Asset 1080x1920 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 8 | Campaign | Preset: Landscape | New asset › Landscape › Blank asset | Asset 1920x1080 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 9 | Campaign | Preset: Wide post | New asset › Wide post › Blank asset | Asset 1600x900 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 10 | Campaign | Preset: Feed post | New asset › Feed post › Blank asset | Asset 1200x630 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 11 | Campaign | Preset: Link share | New asset › Link share › Blank asset | Asset 1200x627 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 12 | Campaign | Preset: Professional post | New asset › Professional post › Blank asset | Asset 1200x1200 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 13 | Campaign | Preset: Professional post, square | New asset › Professional post, square › Blank asset | Asset 1080x1080 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 14 | Campaign | Preset: Professional post, portrait | New asset › Professional post, portrait › Blank asset | Asset 1080x1350 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 15 | Campaign | Preset: Pin | New asset › Pin › Blank asset | Asset 1000x1500 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 16 | Campaign | Preset: Cover banner | New asset › Cover banner › Blank asset | Asset 1640x624 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 17 | Campaign | Preset: Event cover | New asset › Event cover › Blank asset | Asset 1920x1005 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 18 | Campaign | Preset: Header banner | New asset › Header banner › Blank asset | Asset 1500x500 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 19 | Campaign | Preset: Profile banner | New asset › Profile banner › Blank asset | Asset 1584x396 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 20 | Campaign | Preset: Article cover | New asset › Article cover › Blank asset | Asset 1920x1080 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 21 | Campaign | Preset: Medium rectangle | New asset › Medium rectangle › Blank asset | Asset 300x250 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 22 | Campaign | Preset: Large rectangle | New asset › Large rectangle › Blank asset | Asset 336x280 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 23 | Campaign | Preset: Leaderboard | New asset › Leaderboard › Blank asset | Asset 728x90 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 24 | Campaign | Preset: Half page | New asset › Half page › Blank asset | Asset 300x600 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 25 | Campaign | Preset: Wide skyscraper | New asset › Wide skyscraper › Blank asset | Asset 160x600 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 26 | Campaign | Preset: Billboard | New asset › Billboard › Blank asset | Asset 970x250 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 27 | Campaign | Preset: Mobile banner | New asset › Mobile banner › Blank asset | Asset 320x50 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 28 | Campaign | Preset: Photo ad | New asset › Photo ad › Blank asset | Asset 1080x1080 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 29 | Campaign | Preset: Square ad | New asset › Square ad › Blank asset | Asset 1080x1080 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 30 | Campaign | Preset: Portrait ad | New asset › Portrait ad › Blank asset | Asset 1080x1350 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 31 | Campaign | Preset: Promoted pin | New asset › Promoted pin › Blank asset | Asset 1000x1500 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 32 | Campaign | Preset: Sponsored landscape | New asset › Sponsored landscape › Blank asset | Asset 1200x628 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 33 | Campaign | Preset: Sponsored square | New asset › Sponsored square › Blank asset | Asset 1200x1200 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 34 | Campaign | Preset: Sponsored vertical | New asset › Sponsored vertical › Blank asset | Asset 720x900 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 35 | Campaign | Preset: Video thumbnail | New asset › Video thumbnail › Blank asset | Asset 1280x720 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 36 | Campaign | Preset: Channel banner | New asset › Channel banner › Blank asset | Asset 2560x1440 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 37 | Campaign | Preset: Video ad | New asset › Video ad › Blank asset | Asset 1920x1080 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 38 | Campaign | Preset: Stream banner | New asset › Stream banner › Blank asset | Asset 1200x480 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 39 | Campaign | Preset: Video call background | New asset › Video call background › Blank asset | Asset 1920x1080 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 40 | Campaign | Preset: Banner | New asset › Banner › Blank asset | Asset 1200x400 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 41 | Campaign | Preset: Wide banner | New asset › Wide banner › Blank asset | Asset 1600x400 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 42 | Campaign | Preset: Ultrawide banner | New asset › Ultrawide banner › Blank asset | Asset 2400x400 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 43 | Campaign | Preset: Letter flyer | New asset › Letter flyer › Blank asset | Asset 2550x3300 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 44 | Campaign | Preset: A4 flyer | New asset › A4 flyer › Blank asset | Asset 1240x1754 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 45 | Campaign | Preset: Poster | New asset › Poster › Blank asset | Asset 5400x7200 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 46 | Campaign | Preset: Card, landscape | New asset › Card, landscape › Blank asset | Asset 2100x1500 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 47 | Campaign | Preset: Card, portrait | New asset › Card, portrait › Blank asset | Asset 1500x2100 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 48 | Campaign | Preset: Name tag, portrait | New asset › Name tag, portrait › Blank asset | Asset 900x1200 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 49 | Campaign | Preset: Name tag, landscape | New asset › Name tag, landscape › Blank asset | Asset 1200x900 with that preset id, selected, added at the row's end | As expected | PASS |  |
| 50 | Campaign | Rows wrap at 12 | 47 assets in Row 1 | Lines of 12,12,12,11; each line below the tallest of the one above + 120 | y = 0, 2040, 3660, 5280 | PASS |  |
| 51 | Campaign | Asset list drag reorder | Drag card 2 onto the top half of card 5 | Card lands before card 5; one undo step | As expected | PASS |  |
| 52 | Campaign | Drag to new row | Drag a card onto "Drop for a new row", ⌘Z | Row 2 with the card; one ⌘Z restores one row | Two undo steps; first ⌘Z left an empty Row 2 | FAIL | 8609829 |
| 53 | Campaign | Redo after reorder | Reorder assets, ⌘Z, ⇧⌘Z | Redo re-applies | The asset view narrowed the selection with a recorded step, wiping redo | FAIL | 8609829 |
| 54 | Campaign | Asset view framing after reorder | Select an asset, drag its card elsewhere in the list (or ⌘Z/⇧⌘Z) | Asset stays centred in the asset view | View stayed put; asset half off screen | FAIL | 2f13636 |
| 55 | Campaign | Asset menu › Duplicate | Right-click card › Duplicate | Copy right after it, selected, one step | As expected | PASS |  |
| 56 | Campaign | Asset menu › Order › Move to end of row | Right-click › Order › Move to end | Card last in its row | As expected | PASS |  |
| 57 | Campaign | Asset menu › Order › Move to start of row | (from end) | Card first | As expected | PASS |  |
| 58 | Campaign | Asset menu › Order › Move later / earlier | from first | Position 1 then 0 | As expected | PASS |  |
| 59 | Campaign | Asset menu › Order disabled states | Order submenu on the first card | Start and Earlier disabled | As expected | PASS |  |
| 60 | Campaign | Asset menu › Move to row › Row 2 |  | Asset moves to Row 2's end | As expected | PASS |  |
| 61 | Campaign | Asset menu › Move to row › New row, ⌘Z |  | New row with the asset; one ⌘Z restores | Two steps (empty row left) | FAIL | 8609829 |
| 62 | Campaign | Asset menu › Use as template / Stop using |  | template flag on/off | As expected | PASS |  |
| 63 | Campaign | Asset menu › Resize to… | Template › Story, Leaderboard, Mobile banner, Poster › Create 4 copies | 4 copies next to it, layers reflowed and type scaled, one step | As expected (smallest sizes clamp type to 6px) | PASS |  |
| 64 | Campaign | Asset menu › Copy / Paste properties | Copy from red rounded asset, paste on another | Fill and radius copied, size kept | As expected | PASS |  |
| 65 | Campaign | Asset menu › Escape | Right-click then Esc | Menu closes | Closes; focus goes to body, not back to the card | PASS |  |
| 66 | Campaign | Keys › ⌘D on selected card | Click card, ⌘D | Copy added and selected | As expected | PASS |  |
| 67 | Campaign | Keys › ⌫ on selected card | ⌫ | Asset deleted, grid closes up | As expected | PASS |  |
| 68 | Campaign | Grid view | Rail › Grid view | All rows on the canvas with row labels, 12 per line | As expected | PASS |  |
| 69 | Campaign | Grid view "+" | Hover an asset, click the + beside it | Copy next to it in its row, selected | As expected | PASS |  |
| 70 | Campaign | Text panel › Add text box / title / headline / subheadline / body | Click each | Text layer in the asset on show, selected, one step each | As expected | PASS |  |
| 71 | Campaign | Text panel › 12 font combinations | Click each tile | Heading + body stack in the asset, one step, fonts load on canvas | Stack inserted; second line lost the tile's capitals and weight | FAIL | 6f1551e |
| 72 | Campaign | Opening a campaign | Reopen a file whose oldest asset moved to Row 3 | Opens on the list's first asset (highlighted) | Opened on the oldest layer (Row 3), no card highlighted | FAIL | 1074a13 |
| 73 | Campaign | Media panel › stock photos without key | Rail › Media | "Connect a provider in settings" for stock photos | As expected | PASS |  |
| 74 | Campaign | Media panel › Make an image without key | Make an image | Connect state; Make a brand picture fallback | As expected | PASS |  |
| 75 | Campaign | Media › Make a brand picture | Click | Image rect in the asset, selected | As expected | PASS |  |
| 76 | Campaign | Media › Upload video (H.264 MP4 with sound) | Upload a 2.5 s MP4 | Video layer at 80% of the asset, poster, toast | As expected | PASS |  |
| 77 | Campaign | Media › Upload video (VP9 WebM) | Upload | Added | As expected | PASS |  |
| 78 | Campaign | Media › Upload video (VP8 WebM) | Upload | Added, or a clean refusal | "Couldn't open qa-clip.webm: unsupported media: no decoder for VP8 video" (clean; see known issues) | PASS |  |
| 79 | Campaign | Media › video tiles | Media panel after upload | File videos listed with a play badge | As expected | PASS |  |
| 80 | Campaign | Video toolbar | Select video layer | Fill, Stroke, Corner radius, Video, Effects, Position, Alignment, Lock | As expected | PASS |  |
| 81 | Campaign | Video › Play (canvas button) | Click the play button on the canvas | Element plays from trim start with sound | Element playing (currentTime advancing, unmuted, volume 1) | PASS |  |
| 82 | Campaign | Video › Pause | Click again | Stops | As expected | PASS |  |
| 83 | Campaign | Video › Trim In/Out typing | In 0.5, Out 2 | trimStart 0.5, trimEnd 2, label "0:00.5 to 0:02.0" | As expected | PASS |  |
| 84 | Campaign | Video › Trim out of range | In 5, Out "abc" | Clamped to Out-0.1; invalid ignored | 1.9 / 2 | PASS |  |
| 85 | Campaign | Video › Volume keyboard | Focus slider, End, ←×30 | 70%, playing element follows, one step per run | As expected | PASS |  |
| 86 | Campaign | Video › Mute | Click | muted, element muted, label "Muted" | As expected | PASS |  |
| 87 | Campaign | Video › Loop off | Uncheck | loop false | As expected | PASS |  |
| 88 | Campaign | Video › Adjust › Saturation | Home on the slider | saturation -100, drawn through a filter | drawImage with saturate(0) on the canvas | PASS |  |
| 89 | Campaign | Export › MP4 | Template with trimmed video › MP4 | Valid MP4 (ftyp), asset size, length = trim (min 0.5 s) | 97 KB, 1080x1080, 0.5 s for a 0.1 s trim (minimum) | PASS |  |
| 90 | Campaign | Export › WebM | trim 0.5-2.0 › WebM | Valid WebM, ~1.5 s | EBML header, 1.48 s | PASS |  |
| 91 | Campaign | Export › PNG / JPG / PDF | each | Correct magic bytes and names | PNG, JPEG, %PDF-1.3 | PASS |  |
| 92 | Campaign | Export › 2x + Display P3 | Size 2x, Colour Display P3 | 2160x2160 PNG with an ICC profile | iCCP present | PASS |  |
| 93 | Campaign | Export › several selected | ⇧-click two cards › Export 2 assets › zip | Zip with Row 1/<name>.png for each | Only one asset could be selected (⇧-click narrowed away) | FAIL | b69273f |
| 94 | Campaign | Floating toolbar for several assets | ⇧-select two assets in the asset view | "2 assets · Export" on one line, on screen | Kept on screen but wrapped "2 / assets" at the right edge | FAIL | 49a487f |
| 95 | Campaign | Inserts › Objects (Button, Badge, Rating, Quote card, Divider, Avatar) | Click each | Layer(s) in the asset on show, selected, one step | As expected | PASS |  |
| 96 | Campaign | Inserts › Shapes (Rectangle, Rounded rectangle, Ellipse, Triangle, Star, Line, Arrow) | Click each | One layer each in the asset, one step | As expected (Triangle is named "Polygon 1") | PASS |  |
| 97 | Campaign | Inserts › search | "star" then "zzzz" | Star only; then "Nothing matches." | As expected | PASS |  |
| 98 | Campaign | Inserts › Add library with none published | Add library | Empty state | "No published libraries yet." | PASS |  |
| 99 | Campaign | Plugins › Remove background | Picture selected › Remove background | New cut-out image, one step, toast | As expected | PASS |  |
| 100 | Campaign | Plugins › Make an image | Click | Brand picture in the asset | As expected | PASS |  |
| 101 | Campaign | Plugins › Resize to sizes | Click | Resize dialog for the asset | As expected | PASS |  |
| 102 | Campaign | Plugins › Tidy asset grid | Click on a tidy grid | No change, no step | As expected | PASS |  |
| 103 | Campaign | Plugins › Make text editable | Template whose texts are all fields | "Every text layer here is already a field." | As expected | PASS |  |
| 104 | Campaign | Plugins › Bulk create from data | Click | Bulk create dialog on the template | As expected | PASS |  |
| 105 | Campaign | Plugins › Update from data | Click | Bulk edit opens | As expected | PASS |  |
| 106 | Campaign | Plugins › Export all | Click with one asset selected | Export dialog on All | Opened on "Selected (1)" | FAIL | e8d4959 |
| 107 | Campaign | Plugins › Browse more in Community | Click | Home opens on Community | Opened on Recents | FAIL | e8d4959 |
| 108 | Campaign | Plugins › Import… with no plugins | Panel | "No plugins yet. Import one from its manifest." | As expected | PASS |  |
| 109 | Campaign | Templates panel layout | Rail › Templates | No horizontal scroll | Panel 13px too wide (brand colour input), horizontal scrollbar | FAIL | a71876d |
| 110 | Campaign | Templates › Publish… on a local file | Publish… | Says to move the file to the server | As expected | PASS |  |
| 111 | Campaign | Share › Move to the server and share | Click | File moves to the server; share dialog | As expected | PASS |  |
| 112 | Campaign | Publish template v1 | Publish… › Review › Set details (name with HTML) › Publish to QA Team | v1 on the team, "Published v1" in the panel, toast | As expected | PASS |  |
| 113 | Campaign | Your team tab | Your team | Template listed with name escaped, category, version | As expected; no script ran | PASS |  |
| 114 | Campaign | Add a team template | Click it in Your team | Asset made from it, fromTemplate set, one step | As expected | PASS |  |
| 115 | Campaign | Update template (v2) | Publish… again | Version 2 with the same name | v2 renamed to the layer name ("Template"), description blanked | FAIL | 44c2ca9 |
| 116 | Campaign | Review and select defaults | Publish… with a team-sourced copy in the file | Copy unticked (would duplicate) | Ticked as "New" | FAIL | 44c2ca9 |
| 117 | Campaign | Unpublish | Publish… › Unpublish | Removed from the team, "New" again, toast | As expected | PASS |  |
| 118 | Campaign | Team templates API › non-member list | curl as a non-member | 403 | 403 | PASS |  |
| 119 | Campaign | Team templates API › signed out | curl | 401 | 401 | PASS |  |
| 120 | Campaign | Team templates API › non-member delete | curl DELETE | 403 | 403 | PASS |  |
| 121 | Campaign | Team templates API › member without file edit, update/delete | curl PUT/DELETE as Ben | 403 | 403 | PASS |  |
| 122 | Sites | New site | Home › Site | Editor with Home page, three breakpoints, empty-page prompt | As expected | PASS |  |
| 123 | Sites | Page settings › breakpoint ranges | Read the Breakpoints section | "Used for windows 1024 wide and wider" | "Used for windows 1024 and wider wide" | FAIL | 2db83b8 |
| 124 | Sites | Add breakpoint › preset | Add breakpoint › Large phone | Large phone 430 [430-767], Mobile [0-429], one step; Small laptop not offered (≥ primary) | As expected | PASS |  |
| 125 | Sites | Breakpoint › resize frame | Large phone W 414 | Frame 414, range unchanged | As expected | PASS |  |
| 126 | Sites | Breakpoint › start width | Tablet Min 800 | Tablet [800-1023], Large phone [430-799] | As expected | PASS |  |
| 127 | Sites | Breakpoint › rename | Large phone → Phablet | Renamed | As expected | PASS |  |
| 128 | Sites | Breakpoint › refused start | Tablet Min 5000 | Message; field shows 800 again | Message; field kept "5000" | FAIL | 2db83b8 |
| 129 | Sites | Breakpoint › width clamp | W 0, 99999, -5 | Clamped to 120 / 4000 and shown | Stored clamped, field showed the typed value | FAIL | 2db83b8 |
| 130 | Sites | Breakpoint › empty name | Name "   " | Name kept and shown | Field left blank | FAIL | 2db83b8 |
| 131 | Sites | Breakpoint › delete, undo, redo | Delete Phablet | Mobile [0-799]; undo restores Phablet and ranges; one step | As expected | PASS |  |
| 132 | Sites | Use a template › Product launch | Click | Blocks on every breakpoint, toast | As expected | PASS |  |
| 133 | Sites | Inheritance › desktop text | Edit a desktop heading | Tablet and mobile follow | As expected | PASS |  |
| 134 | Sites | Override › tablet text | Edit the tablet copy | Desktop unchanged; mobile follows tablet | As expected | PASS |  |
| 135 | Sites | Override kept | Edit desktop again | Tablet and mobile keep "Tab B" | As expected; undo/redo exact | PASS |  |
| 136 | Sites | Publish from this computer | Publish › Publish (local file) | Moves to server, publishes, shows address and hosting | Published, but "No such file." from before the move stayed and hosting was missing | FAIL | 59e7567 |
| 137 | Sites | Published HTML escapes text | Text, layer name, page name with <script> and onerror payloads › publish | Payload appears only escaped | Escaped; no raw script or img | PASS |  |
| 138 | Sites | Published site headers | curl /sites/<id>/ | CSP sandbox without same-origin, nosniff | As expected | PASS |  |
| 139 | Sites | Security › view link | DELETE site / PUT settings with the view key, signed out | 403 | 403 | PASS |  |
| 140 | Sites | Security › other account | Cal (no access) PUT settings / DELETE site | 403 | 403 | PASS |  |
| 141 | Sites | Security › signed out with edit link | PUT settings, POST/DELETE site, verify with the edit key, no account | 401 | 200: name, access and publishing changed anonymously | FAIL | 59e7567 |
| 142 | Sites | Security › single sign-on return | /auth/oidc/start?return=https://evil/ | Session only returned to this server or the app | Any http(s) address accepted (session token in its hash) | FAIL | 59e7567 |
| 143 | Sites | Security › redirects | GET //evil.example/about on a site's host; folder without slash | Stays on this server | Stays (URL parsing reads it as a path) | PASS |  |
| 144 | Sites | Password site brute force | 14 wrong passwords to /s/<name>/ | Locked (429 with Retry-After) after a few | 401 ×6 then 429 | PASS |  |
| 145 | Sites | Custom domain › bad input | "not a domain", "a.b", "evil.localhost" | 400 "Enter a domain like www.example.com." | As expected | PASS |  |
| 146 | Sites | Custom domain › normalise | "https://WWW.QA-Example.com/path" | www.qa-example.com with TXT and CNAME records | As expected | PASS |  |
| 147 | Sites | Custom domain › Verify without DNS | Verify | Fails cleanly: both checks false, nothing found | 200 with checks false in 0.3 s | PASS |  |
| 148 | Make | App data › register | signed out / owner / another account | 401 / 200 / 403 | As expected | PASS |  |
| 149 | Make | App data › item ids | POST with "id":"forced" | Server id | As expected | PASS |  |
| 150 | Make | App data › script in data | POST title "<script>…" | Stored as data (the app decides how to show it) | As expected | PASS |  |
| 151 | Make | App data › prototype names | GET /__proto__, /constructor | 400 | 400 | PASS |  |
| 152 | Make | App data › 2 MB limit | 40 × 60 KB items | 413 "This backend is full." once over 2 MB | 413 after 34 | PASS |  |
| 153 | Make | App data › 50 collections | 55 collections | 400 after 50 | As expected | PASS |  |
| 154 | Make | App data › oversized item | 70 KB item | 413 saying the limit | 400 "Send a JSON object." | FAIL | b640b6a |
| 155 | Make | New app | Home › Make | Make editor with chat, "No AI model" notice, Build/Preview/Code | As expected | PASS |  |
| 156 | Make | Prompt without a model key | Type a prompt › Send | Clean message in the chat, no crash | "There's no AI model on this server, so prompts can't be answered…" | PASS |  |
| 157 | Make | /ai/make signed out | curl POST | 401 | 401 "Sign in to generate apps with AI." | PASS |  |
| 158 | Make | /ai/make without key | curl POST signed in | 501 | 501 "No model key on this server." | PASS |  |
| 159 | Make | /ai/make GET signed out | curl | Only {signedIn:false} (no model or token info) | As expected | PASS |  |
| 160 | Make | Code › New file | New file › index.html, src/main.tsx, src/App.tsx | Files in the tree, last one open | As expected | PASS |  |
| 161 | Make | Code › bad path | New file "../x" | Refused with a message | As expected (validPath) | PASS |  |
| 162 | Make | Code › editing | Type into each file, switch files | Each file saved (debounced 500 ms, on blur, on switch) | As expected | PASS |  |
| 163 | Make | Code › syntax colouring | Open App.tsx | Keywords, strings, numbers, comments, tags, attributes coloured | As expected (capitalised words in JSX text are coloured as types) | PASS |  |
| 164 | Make | Code › delete file, undo | Delete guidelines.md, ⌘Z | Gone; undo brings it back | As expected (no confirmation) | PASS |  |
| 165 | Make | Guidelines › Write | Write | guidelines.md made and opened | As expected | PASS |  |
| 166 | Make | Guidelines › Upload | Upload a .md | guidelines.md holds the file's text | As expected | PASS |  |
| 167 | Make | Plan mode UI | Mode › Plan, send "/plan …" | Mode shows Plan, placeholder "Describe what to plan…", prompt sent | As expected (no model: clean message) | PASS |  |
| 168 | Make | Preview sizes | Desktop / Tablet / Phone | Frame 1100 / 768 scaled / 375 scaled, pressed state | 1100 / 413 (768 at 0.54) / 254 (375 at 0.68) | PASS |  |
| 169 | Make | Preview sandbox | Inspect the frame | sandbox="allow-scripts" (no same-origin) | As expected | PASS |  |
| 170 | Make | Publish to the scratch server | Publish › Publish | Live at /apps/<id>/ with address, Copy, Open, hosting | As expected | PASS |  |
| 171 | Make | Published app headers | curl | CSP sandbox, nosniff, index.html with import map | As expected | PASS |  |
| 172 | Make | Published app in the tab | Open /apps/<id>/ | App renders | Blank: the test browser blocks esm.sh (ERR_BLOCKED_BY_CLIENT); not a product fault | BLOCKED |  |
| 173 | Make | App publish/unpublish by others | signed out / Cal: DELETE, PUT | 403 / 401 | 403, 403, 401 | PASS |  |
| 174 | Make | App hosting settings by others | Cal PUT /apps/<id>/hosting; signed out | 403; 401 | As expected | PASS |  |
| 175 | Make | App path traversal | /apps/<id>/..%2fmeta.json | 404 | 404 | PASS |  |
| 176 | Make | View-only link | Menu › Copy view-only preview link | Link with the file's view key and makeView=preview; opens the preview alone with "View only" | As expected | PASS |  |
| 177 | Make | Push to GitHub without a token | Menu › Push to GitHub… | Token field; push disabled until one is given | As expected | PASS |  |
| 178 | Make | GitHub API without a token | curl signed in / out | 400 "Add a GitHub token to push." / 401 | As expected | PASS |  |
| 179 | Campaign | Keys on a non-element target | keydown dispatched at document | No error | "target.closest is not a function" thrown from the campaign key handler | FAIL | 06227f5 |
| 180 | Campaign | Bulk edit › open | Rail › Bulk edit | Table: grip, Asset size, Photo, Headline, Subhead, Button colour, Button label; template row | As expected | PASS |  |
| 181 | Campaign | Bulk edit › TSV paste | Cursor on Headline, paste 3 rows × 2 columns (one with a quoted line break) | 2 assets added, cells filled, quoted newline kept, one undo step; undo/redo exact | As expected | PASS |  |
| 182 | Campaign | Bulk edit › arrows, Tab | Arrow keys and Tab from a cell | Cursor moves one cell; Tab moves right | As expected | PASS |  |
| 183 | Campaign | Bulk edit › ⇧ ranges | ⇧↓ ⇧→ | 2 then 4 cells selected | As expected | PASS |  |
| 184 | Campaign | Bulk edit › typing edits | Type "X" on a cell | Editor opens with "X" | As expected | PASS |  |
| 185 | Campaign | Bulk edit › Enter commits, invalid colour | "X" in Button colour, Enter | Refused, cursor moves down | Ignored silently (no message), cursor moves | PASS |  |
| 186 | Campaign | Bulk edit › valid colour | Enter, "#ff0000", Enter | Button fill #FF0000, one step | As expected | PASS |  |
| 187 | Campaign | Bulk edit › fill handle | "Deal 1" handle dragged to the last row | Deal 2, Deal 3, one step | As expected | PASS |  |
| 188 | Campaign | Bulk edit › fill handle series (unit) | "SKU-1", "$9.99", "1.9" | SKU-2…, $10.00…, 2.0… | SKU0, SKU1; $9.100; 1.10 | FAIL | 6d68709 |
| 189 | Campaign | Bulk edit › + Asset | Click Asset | A copy of the template added as a row | As expected | PASS |  |
| 190 | Campaign | Bulk edit › Delete clears | Delete on a cell | Cell emptied | As expected | PASS |  |
| 191 | Campaign | Bulk edit › Fill empty cells with AI (no model) | Column menu › Fill empty cells with AI | Series fallback, toast | "Deal 4", "Filled 1 empty cell in Headline." | PASS |  |
| 192 | Campaign | Bulk edit › row grip reorder | Drag the last row's grip onto the first copy | Row moves in the table and on the canvas | Canvas moved; table unchanged | FAIL | 8e55e99 |
| 193 | Campaign | Bulk edit › column menu | Headline column menu | Select column, Fill empty cells with AI | As expected | PASS |  |
| 194 | Campaign | Reviews › request with unknown email | Asset menu › Request review…, "nobody@nowhere.test" | Error in the dialog, nothing sent | "No one with the email … has an account here." | PASS |  |
| 195 | Campaign | Reviews › request | Ben's email, note with HTML › Request | Toast, review stored, Ben notified (inbox), Ben gets view access | As expected | PASS |  |
| 196 | Campaign | Reviews › non-reviewer decides | curl as Cal (no access) / bad decision as Ben | 403 / 400 | As expected | PASS |  |
| 197 | Campaign | Reviews › viewer cancels | curl DELETE as Ben (viewer) | 403 | 403 | PASS |  |
| 198 | Campaign | Reviews › request changes (API, Ben) | decision changes with an HTML note | Ava's inbox notice; panel shows "Changes requested" and the note as text | As expected (escaped) | PASS |  |
| 199 | Campaign | Reviews panel › All tab | Rail › Reviews › All | Asset, asker, status, note, decisions, Cancel review | As expected | PASS |  |
| 200 | Campaign | Require approval to export | Toggle on | Page data requireApproval true | As expected | PASS |  |
| 201 | Campaign | Export gate | Export › All with nothing approved | All listed "Not approved", "Export 0 assets" disabled | As expected | PASS |  |
| 202 | Campaign | Export gate after approval | Ben approves (API), focus the window | Template 2 exportable, "Export 1 asset" | As expected | PASS |  |
| 203 | Campaign | Reviews as Ben (second account in the UI) | Add account › Ben, open the file without the key | View only; For you lists Template 2; Request changes with a comment | As expected | PASS |  |
| 204 | Campaign | Viewer can't edit | As Ben: Text › Add a title, Bulk edit typing, Media | Nothing added; panels that add stay closed | As expected | PASS |  |
| 205 | Campaign | Account switch back | Home › account menu › Switch to Ava | Ava signed in | As expected | PASS |  |
| 206 | Campaign | Import Untitled.buzz | Import (copy of ~/Downloads/Untitled.buzz) | Opens as a new campaign with its asset, text, images and vectors | One 300×250 asset, 19 layers, 3 images, toast "Opened Untitled.buzz." in 2.6 s | PASS |  |
| 207 | Campaign | Toolbars › shape (rect) | Fill, Stroke, Corner radius, Effects, Position, Alignment, Locked for editors: every control | Each change one undo step that restores the layer | All controls: one step, undo exact | PASS |  |
| 208 | Campaign | Toolbars › image (Logo) | Fill, Stroke, Corner radius, Image (11 controls), Effects, Position, Alignment, Lock | As above | As expected | PASS |  |
| 209 | Campaign | Toolbars › ellipse with image | Fill, Stroke, Image, Effects | As above | As expected | PASS |  |
| 210 | Campaign | Toolbars › group | Fill, Stroke, Effects, Position, Alignment, Lock | As above | As expected | PASS |  |
| 211 | Campaign | Toolbars › text | Text colour, Paragraph, Font family, Font style, Size, B/I/U, Alignment, Effects, Position, More | As above | As expected | PASS |  |
| 212 | Campaign | Toolbars › asset | Asset size, Background, Border, Change layout, Template | Menus open | As expected | PASS |  |
| 213 | Campaign | Asset size menu | Open | 46 presets and "Resize to… (make copies)" | As expected | PASS |  |
| 214 | Campaign | Asset size › Story on a 300×250 ad without auto layout | Size menu › Story | Layers reflow, type and boxes in proportion, one step | Type scaled 3.6× but boxes kept their size: 133×636 text columns | FAIL | e14769a |
| 215 | Campaign | Asset size › Story on a starter (auto layout) | resizedCopy | Reflows, type kept | As expected | PASS |  |
| 216 | Campaign | Change layout › Browse | Edit Headline, Change layout › Side by side | New layout, "Custom headline" and other fields kept, one step; undo exact | As expected | PASS |  |
| 217 | Campaign | Change layout › Customize › Horizontal | Click | direction horizontal, one step | As expected | PASS |  |
| 218 | Campaign | Change layout › Customize › Align middle centre | Click | primary/counter center, one step | As expected | PASS |  |
| 219 | Campaign | Change layout › Customize › Reverse the order | Click | Children reversed, one step | As expected | PASS |  |
| 220 | Campaign | Change layout › Customize › Freeform | Click | Auto layout removed, one step | As expected | PASS |  |
| 221 | Campaign | Change layout › Customize › Vertical from Freeform | Click | Auto layout added, vertical, one step | Two undo steps (reorder, then flow) | FAIL | f15ae7f |
| 222 | Campaign | Change layout › Customize keeps the asset size | Freeform, then Vertical on a 1080×1080 square post | Stays 1080×1080 | Shrank to 599×1110 (hug) while still labelled Square post | FAIL | 2b4b069 |
| 223 | Campaign | Asset › Background | Add, hex, opacity, hide, remove | One step each, undo exact (only editedAt moves) | As expected | PASS |  |
| 224 | Campaign | Asset › Border | Add border, weight, Solid, Dashed | One step each | As expected | PASS |  |
| 225 | Campaign | Asset › Template popover | Template switch, Make all text editable, Every layer becomes a field, Duplicate as variant, Resize to…, Export this asset…, export format/scale | Each works, one step | As expected | PASS |  |
| 226 | Campaign | Variable modes on an asset | Language collection (English/Spanish), Button label bound; toolbar Variable modes › Spanish | Label "Comprar", toolbar shows "Spanish" | As expected | PASS |  |
| 227 | Campaign | Bulk edit › variable-mode column | Bulk edit | "Language" column with each asset's mode | As expected | PASS |  |
| 228 | Shared | Server stays up during heavy campaign saves | Edit a multi-MB campaign (images) with saves 400 ms apart | Saves queue; server keeps running | Server process exited: ENOENT renaming <file>.<pid>.tmp (two saves shared one temp file), unhandled rejection | FAIL | b12b825 |
| 229 | Shared | Switching files while offline | Open a server campaign, stop the server, import a .buzz and edit it, start the server | The import and its edit stay; the campaign rejoins only when opened | The stale room took the editor back on reconnect and overwrote the import's saved copy with the campaign (earlier run: the server copy was overwritten the other way) | FAIL | bbfd886 |
| 230 | Shared | Switching files while live | Open a server campaign (live), import a .buzz | Room left, ?file= cleared | As expected | PASS |  |
| 231 | Sites | Interactions menu | Select a section › Add interaction | Change to (needs instance), Back, Scroll to, Hover, Press, Reveal, Parallax, Scroll transform, Cursor, Marquee, Lightbox (needs picture) | As expected; unavailable ones disabled with the reason | PASS |  |
| 232 | Sites | Add Reveal / Parallax / Scroll transform / Hover / Press / Marquee / Cursor | Add each to a section | Stored on the layer with defaults | As expected | PASS |  |
| 233 | Sites | Add Scroll to / Back / Lightbox | Nav link, nav link, product picture | Stored | As expected | PASS |  |
| 234 | Sites | Change to on a text | Add interaction › Change to | Disabled (needs an instance) | As expected | PASS |  |
| 235 | Sites | Published › attributes | Publish, read HTML | data-appear, data-parallax, data-scroll, data-marquee, data-scroll-to, data-back, data-lightbox present | As expected | PASS |  |
| 236 | Sites | Published › Reveal | Load /s/<name>/ | Hero animates in (is-in, opacity 1) | As expected | PASS |  |
| 237 | Sites | Published › Parallax | Load and scroll | translate follows scrolling | translate 0 24.9px at load | PASS |  |
| 238 | Sites | Published › Scroll transform | Load | Opacity/translate/scale mixed by progress | 0.321 / 50.9px / 0.932 at load | PASS |  |
| 239 | Sites | Published › Marquee | Load | Track duplicated and animating; pause on hover rule | As expected | PASS |  |
| 240 | Sites | Published › Lightbox | Click the picture, Esc | Dialog with the picture, Esc closes and focus returns | As expected | PASS |  |
| 241 | Sites | Published › Hover / Press / Cursor | Read CSS | :hover scale(1.02) under (hover:hover), :active scale(0.97), cursor:pointer on the section | As expected | PASS |  |
| 242 | Sites | Published › Scroll to, Smooth off | Click "Contact" | FAQ at the top, jumping | Arrived, but glided (behavior auto follows html scroll-behavior smooth) | FAIL | e7c2ffe |
| 243 | Sites | Published › page scrolls | scrollTo / scrollIntoView | Page scrolls | Scrolls (once the viewport emulation is off) | PASS |  |
| 244 | Sites | Inline preview (⇧Space) | Shift+Space with nothing selected | Sandboxed frame (no same-origin), Back, Forward, Reload, Close, Page and Scale | As expected | PASS |  |
| 245 | Sites | Inline preview › Scale | Fit, 50%, 75%, 100%, 125% | Frame width 428 (fit), 640, 960, 1280, 1600 | As expected | PASS |  |
| 246 | Sites | Add page | Pages › Add page › Blank page | Page 2 at /page-2 | As expected | PASS |  |
| 247 | Sites | Page template › Blog | Use a template › Blog | Posts collection (3 items), list, item page /posts | As expected | PASS |  |
| 248 | Sites | CMS › CSV import | Import people.csv (BOM, quoted commas and newlines, HTML, javascript: link, formula, invalid date) | New collection, types guessed (text, rich text, date), 3 items | As expected | PASS |  |
| 249 | Sites | CMS › Insert list / Make item page | For people | List on Page 2 on every breakpoint, item page /people with fields bound | As expected | PASS |  |
| 250 | Sites | CMS › published escaping | Publish, read people pages | Script text escaped; rich text keeps p/b/a, drops img/onerror, javascript: href becomes # | As expected | PASS |  |
| 251 | Sites | CMS › titles | Item page titles | Escaped item name | As expected | PASS |  |
| 252 | Sites | CMS › dates | 2024-01-05 and 2024-02-30 | January 5, 2024; impossible date as written | 2024-02-30 shown as "March 1, 2024"; west of UTC 2024-01-05 shows January 4 | FAIL | d8f516c |
| 253 | Make | Prompt with a model (stand-in on localhost) | Send "slow first request" | Thinking status, file list, "Built: …", 1 file changed, Restore this version | As expected | PASS |  |
| 254 | Make | Queued prompts | Send two more while the first runs | Send becomes "Queue prompt"; prompts run in order | Ran 1, 2, 3 in order; App.tsx from the third | PASS |  |
| 255 | Make | Prompt text with HTML | "second request <b>bold</b>" | Shown as text | As expected | PASS |  |
| 256 | Make | Restore this version, undo | Restore the first answer, ⌘Z | App.tsx back to call 1; undo returns call 3 | As expected | PASS |  |
| 257 | Make | Plan mode with a model | Mode › Plan, "a habit tracker" | Plan steps, Build this plan, Dismiss | As expected | PASS |  |
| 258 | Make | Build this plan | Click | Sent as a build with the steps; mode back to Build | As expected | PASS |  |
| 259 | Make | Comment on the preview with the keyboard | F6, ⇧→, Enter, type, Post | Pin "1" on the preview, comments panel opens, HTML shown as text | As expected | PASS |  |
| 260 | Make | App access › password | PUT /apps/<id>/hosting password | Page and its assets 401 until the password; right password 303 with cookie | As expected | PASS |  |
| 261 | Make | Copy as design layers / Edit tool / Properties panel | Preview tools | Need the preview rendered | Blocked: the test browser blocks esm.sh, so the app never renders | BLOCKED |  |
| 262 | Campaign | Templates › search | "banner", then "zzzz" | Banner only; "No templates match." | As expected | PASS |  |
| 263 | Campaign | Templates › Blank asset / New template | Click each | Blank asset; a template asset | As expected | PASS |  |
| 264 | Campaign | Templates › Add all 5 templates, ⌘Z | Click, then one undo | Five starters; one undo removes all five | Five undo steps | FAIL | 90cae9d |
| 265 | Campaign | Templates › Category and Template size | Category Ads, size Leaderboard, Headline | Headline starter at 728×90 | As expected | PASS |  |
| 266 | Campaign | Design mode (⇧D) | ⇧D, ⇧D | Design toolbar (Move, Frame, Rectangle, Pen, Text, Comment, Actions), Design panel (Position, Layout, Appearance, Fill, Stroke, Effects, Export), no floating toolbar; back to Campaign | As expected | PASS |  |
| 267 | Sites | Publish dialog › bad subdomain | "Bad Name!" | Message; field back to the current name | Message, but the field kept "Bad Name!" | FAIL | 3992616 |
| 268 | Sites | Publish dialog › custom domain + Verify (no DNS) | www.qa-test-domain.com › Verify | TXT and CNAME records, not verified, no crash | As expected | PASS |  |
| 269 | Sites | Who can view › signed in only | Access team; anonymous GET; Cal (no access) ticket; Ava ticket | 401; 403; 303 with a cookie for the site's path | As expected | PASS |  |
| 270 | Sites | Breakpoint override › fill | Tablet copy fill red, then desktop fill green | Desktop green; tablet and mobile keep red | As expected | PASS |  |
| 271 | Sites | Appear "while another layer is in view" | HTML for trigger layer | data-appear="layer" and data-appear-target with the target's anchor | As expected (anchors made for targets) | PASS |  |
| 272 | Sites | Page templates › Event, Portfolio | Use a template on a blank page | Blocks on every breakpoint, toast | As expected | PASS |  |
| 273 | Sites | Page templates › Team directory | Use a template | A people collection with profile pages | A second "Posts" collection of blog posts and /posts-2 | FAIL | 7624037 |
| 274 | Campaign | Libraries › Add library | Publish a design library (two components) from a test design file; Inserts › Add library › pick it | Library listed with its components; brand kit linked; component named Logo offered under Logos | As expected | PASS |  |
| 275 | Campaign | Libraries › insert a component | Add Sale badge | Instance of the library component inside the asset on show | As expected (plus a separate selection-only undo step) | PASS |  |
| 276 | Campaign | Libraries › Apply styles / Review design updates | Library options menu | Run without errors; review dialog opens | As expected | PASS |  |
| 277 | Campaign | Libraries › Swap content to | With one library | Submenu offers other libraries only | Nothing to swap to (one library) | PASS |  |
| 278 | Campaign | Libraries › Remove | Library options › Remove | Library leaves the panel | Removed (brand kit keeps its pulled values and the old library id) | PASS |  |
| 279 | Campaign | Bulk create from data | Plugins › Bulk create, paste CSV (quoted comma, HTML) › Create 3 assets | 3 assets named from Headline in a new bulk row, one step; undo removes them and the row | As expected | PASS |  |
| 280 | Campaign | Video › Poster frame | Poster slider to 2 s › Use this frame | New poster picture | As expected | PASS |  |
| 281 | Campaign | Video › Replace video | Replace with a VP9 WebM | New file, size and length; trim, volume and loop kept; one step | As expected | PASS |  |
| 282 | Shared | Narrow window (1024) with many tabs open | Open 10 files | Tab bar scrolls or shrinks | Tabs run past the window edge (unreachable); app shell, outside this area | KNOWN |  |

## 2. Bugs

| ID | Sev | Product | Bug and repro | Root cause | Fix | Test |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | S1 | Server | The sync server exited while a large campaign (images, several MB) was being edited: `ENOENT: rename '<id>.json.<pid>.tmp'`. | Every debounced save wrote the same `<file>.<pid>.tmp` and renamed it. A save still writing when the next timer fired had its temp file renamed away by the other; the second rename failed, an unhandled rejection from a timer, which ends Node. | `atomic-write.mjs`: `writeAtomic` gives each write its own temp file and runs writes to one path one at a time, in order; timer saves log failures (rooms retry) instead of throwing. Used by every debounced writer (rooms, metadata, accounts, teams, inbox, tokens, integrations, community, site hosting, SAML replay cache, libraries, asset templates). b12b825 | `qa-sites-make.test.mjs` "saving files" |
| B2 | S1 | All (sync) | Data loss: open a server file, lose the connection (server stopped), open or import another file and edit it, connection returns: the room takes the editor back and the other file's saved copy is overwritten with the shared file (an earlier run overwrote the shared file with the other one). | The editor's file-switch watcher only left the room when its status was `live`; while connecting/offline the room stayed joined with `?file=` in the address, and its snapshot on reconnect switched the editor's file and loaded its document over the open one. | Leave the room whenever the open file isn't the room's own, whatever the connection is doing (`engine/collab.ts`). bbfd886 | `src/engine/collab-switch.test.ts` |
| B3 | S1 | Server (sign-in) | `/auth/oidc/start?return=https://evil.example/` was accepted; after sign-in the callback sends the browser to that address with the new session token in its hash (`#sso=…`). | The OIDC flow kept any `http(s)://` return address (SAML already used `safeRelayPath`). | `safeReturnUrl`: a path, or an address on the server's own, NAGMA_APP_URL's or NAGMA_PUBLIC_URL's origin, or a loopback address when the server itself is on loopback; anything else becomes `/`. 59e7567 | `qa-sites-make.test.mjs` "single sign-on return addresses" |
| B4 | S2 | Sites | Signed out, anyone holding a site's edit link could publish, unpublish, rename the address, change access and set a custom domain (`by: "Someone with the edit link"`). | Site publish and hosting settings checked only the file role, which an edit link grants without an account (Make's apps already required one). | Publishing, unpublishing and hosting changes need a signed-in account (401 otherwise). 59e7567 | `qa-sites-make.test.mjs` "site publishing needs an account" |
| B5 | S2 | Campaign | Size menu › Story on a 300×250 ad without auto layout: type grew 3.6× while boxes kept their size (Subheadline 133×636). Same for Resize to…. | `resizedCopy` scaled fonts, radii and spacing by the shorter side but layers of a frame without auto layout only followed their constraints at their old size. | Without auto layout, layers first scale with the type (place and size), then follow constraints from the scaled frame. e14769a | `qa-campaign.test.ts` "Resize scales a frame…" |
| B6 | S2 | Campaign / Sites | Change layout › Customize › Vertical on a square post shrank it to 599×1110 while it still said Square post (⇧A in Design mode too; a site breakpoint frame would change the page width). | `addAutoLayout` always set sizing to hug. | Campaign assets keep fixed sizing, site breakpoint frames a fixed width. 2b4b069 | `qa-campaign.test.ts` "turning auto layout on…" |
| B7 | S2 | Campaign | ⇧-click a second card in the asset list: only one asset stayed selected, so Export N assets / Duplicate / Delete couldn't act on several from the asset view. | The asset view narrows selections that span assets (meant for layers) and also narrowed whole-asset selections. | Whole-asset selections are kept. b69273f | in app (component effect) |
| B8 | S2 | Campaign | Publish… on a template already on the team renamed it to the layer name and blanked its description (v2 "Promo" → "Template"). | Set details defaulted to the asset's layer name, not the team's record. | Details start from the team's published record. 44c2ca9 | in app |
| B9 | S2 | Sites | Use a template › Team directory made a second "Posts" collection of blog posts and an item page at /posts-2. | `sampleCollection` only knew blog posts. | Team directory gets a Team collection (Name, Role, Photo) of people; a second sample of a kind is named "Posts 2". 7624037 | `qa-sample.test.ts` |
| B10 | S3 | Campaign | Drag a card onto "Drop for a new row" (or Move to row › New row, or the Add dialog's New row), ⌘Z: an empty Row 2 is left. | Two steps: the row, then the asset. | `inRow`/`asOneStep` fold them. 8609829 | `qa-campaign.test.ts` |
| B11 | S3 | Campaign | After undoing a reorder (any change to several assets) redo did nothing. | Undo selected the touched assets; the asset view narrowed that with a recorded selection step, which clears redo. | `editor.set(…, { history: false })` for the view's own narrowing. 8609829 | `qa-campaign.test.ts` |
| B12 | S3 | Campaign | The asset on show moved off screen after reordering it, Order, undo or a collaborator's change. | The view only re-framed on size or identity changes. | Re-frame when a commit moves the asset on show. 2f13636 | in app |
| B13 | S3 | Campaign | Font combinations inserted the second line in mixed case at 400 though the tile shows capitals/semibold. | `addFontPair` ignored `subUpper`/`subWeight`. | Applied. 6f1551e | `qa-campaign.test.ts` |
| B14 | S3 | Campaign | A file opened on the oldest asset layer (in Row 3), not the list's first, with no card highlighted. | "First asset" was the page's first child. | `firstAsset` follows rows. 1074a13 | `qa-campaign.test.ts` |
| B15 | S3 | Campaign | Plugins › Export all opened on "Selected (1)"; Browse more in Community opened Home on Recents. | No "all" scope passed; Home reopened its last section. | `all: true`; `openCommunity()`. e8d4959 | in app |
| B16 | S3 | Campaign | Review and select ticked a template added from Your team, so publishing put a second copy on the team. | All templates ticked by default. | Team-sourced, unpublished ones start unticked. 44c2ca9 | in app |
| B17 | S3 | Sites | Breakpoint fields kept refused or clamped values (Min 5000, W 0 or 99999, empty name). | Fields keyed on the stored value, which didn't change. | Fields show what the breakpoint has after every edit. 2db83b8 | in app |
| B18 | S3 | Campaign | Fill handle from "SKU-1" gave SKU0, SKU1; from "$9.99" gave $9.100. | Hyphen read as minus; decimals counted without carry. | Minus only at start or after a space; decimals step in their last place with carry. 6d68709 | `qa-campaign.test.ts` |
| B19 | S3 | Campaign | Dragging a Bulk edit row's grip moved the asset on the canvas but not in the table. | Groups listed assets in layer order. | Rows follow rows and places. 8e55e99 | `qa-campaign.test.ts` |
| B20 | S3 | Campaign / Design | Turning auto layout on from Freeform took two undos. | `addAutoLayout` and the flow update were separate steps. | `chooseFlow` folds them. f15ae7f | `qa-campaign.test.ts` |
| B21 | S3 | Sites | Scroll to with Smooth off still glided on the published page. | `behavior: "auto"` follows `html{scroll-behavior:smooth}`. | `"instant"`. e7c2ffe | `qa-site.test.ts` |
| B22 | S3 | Sites | CMS date 2024-02-30 showed as "March 1, 2024"; west of UTC 2024-01-05 showed January 4. | `new Date("YYYY-MM-DD")` is UTC midnight, rolls over invalid days. | Plain dates read as that calendar day (UTC); impossible ones as written. d8f516c | `qa-site.test.ts` |
| B23 | S3 | Campaign | Templates › Add all 5 templates took five undos. | One step per template. | `asOneStep`. 90cae9d | `qa-campaign.test.ts` |
| B24 | S3 | Sites | Publish from this computer showed "No such file." under Published. | The hosting section loaded once, before the file reached the server. | Mounted once the status is known, afresh after each publish. 59e7567 | in app |
| B25 | S4 | Campaign | The several-assets toolbar wrapped ("2 / assets") at the canvas edge. | Absolute box shrank to the room left. | `w-max whitespace-nowrap`. 49a487f | in app |
| B26 | S4 | Campaign | The Templates panel scrolled sideways (13px). | A hidden `input[type=color]` kept its intrinsic width. | `size-full`. a71876d | in app |
| B27 | S4 | Sites | "Used for windows 1024 and wider wide". | Sentence built around `rangeLabel`. | Reworded. 2db83b8 | in app |
| B28 | S4 | Make | A 70 KB app data item answered 400 "Send a JSON object." | Read errors all mapped to 400. | 413 "Items can be up to 64 KB." b640b6a | `qa-sites-make.test.mjs` |
| B29 | S4 | Shared | The New file / Rename / confirm prompt wasn't announced as a dialog. | No role. | `role="dialog"`, `aria-modal`, labelled by its title. 06227f5 | in app |
| B30 | S4 | Campaign | `target.closest is not a function` from the Campaign key handler for a keydown at the document. | Assumed an Element target. | Guarded. 06227f5 | in app |
| B31 | S4 | Sites / Make | After a refused subdomain or domain the field kept the refused text. | Field keyed on the unchanged value. | Puts the current value back. 3992616 | in app |

## 3. Known issues not fixed

- **Make app data is public even when the app isn't.** `/app-data/<app id>` answers anyone with
  the id, also for password or signed-in-only apps. Published apps run in an opaque origin
  (CSP sandbox) and their cookie is scoped to `/apps/<id>/`, so they can't send the gate's cookie
  to the store; closing this needs an authenticated data API for apps (a design change).
- **VP8 WebM can't be uploaded** ("unsupported media: no decoder for VP8 video"): the video engine
  decodes H.264 and VP9 (Nagma's own WebM export uses VP9, so round trips work). Clean refusal.
- **Approval to export is enforced in the browser only**, and an approved asset stays approved after
  it's edited. Workflow control rather than security; resetting approval on edit needs a product
  decision.
- **Site password lockout is per site as well as per address**, so a stranger can lock out real
  visitors for up to 15 minutes with wrong guesses (the same trade-off as account sign-in).
- **Bulk edit**: an invalid colour is ignored without a message; cursor moves are selection undo
  steps (the store's design for every editor).
- **Libraries**: inserting a library component adds a separate selection-only undo step; removing
  a library leaves its id on the brand kit.
- **Media panel copy** names the stock providers and the server's environment variables to every
  user.
- **File tab bar at 1024px** with many files open runs past the window edge (app shell, outside this
  area).
- **After "Move to the server and share" the link defaults to "Anyone with the link can edit"**
  (sharing, outside this area; worth a product look).
- **Not verified here**: Make preview rendering and the tools that need it (esm.sh blocked in the test
  browser), video frames advancing on the canvas while the pane was hidden (the playing element's time
  advanced, unmuted, at the set volume), and component-property columns in Bulk edit (no instance with
  properties in the test files).
