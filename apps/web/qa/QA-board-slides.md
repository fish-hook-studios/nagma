# QA: Board and Slides (area "board-slides")

Branch `feature/qa-board-slides`. Exploratory QA of the Board (whiteboard) and Slides in the
running app (Vite on :5232, scratch sync server on :48812), driven with clicks, drags and key
presses in the built-in browser and confirmed by reading the editor state. Two read-only code
reviews of `src/board` and `src/slides` ran alongside it. Every finding below was checked against
the code (and in the app where it could be reached), fixed at the root, and covered by a regression
test wherever the code can run under Vitest.

## Summary

| | Count |
|---|---|
| Matrix rows (flows and controls checked) | 205: 126 pass, 79 fail (all fixed) |
| Bugs found and fixed | 62: S1 2, S2 16, S3 33, S4 11 |
| Fix commits | 40 |
| Web tests (Vitest, 24 files) | 1351 run, 1351 pass (1310 before; 41 added) |
| Server tests (node:test) | 130 run, 130 pass |
| Known issues not fixed | 12 (at the end) |

Checks before every commit: `npx tsc --noEmit -p tsconfig.app.json` clean, `npx oxlint src` 0 errors.
`npx tsc --noEmit -p tsconfig.test.json` is clean too.

New test files: `src/board/board-qa.test.ts` (19 tests) and `src/slides/slides-qa.test.ts`
(16 tests). Tests were also added to `src/slides/pptx-import.test.ts` (5),
`src/slides/slides.test.ts` (1 changed for the new "New group" behaviour) and
`src/engine/store.test.ts` (1). Run them with `cd apps/web && npx vitest run src/board src/slides src/engine/store.test.ts`.

### How the app was tested

- Board: a new board from Home, every toolbar tool with real clicks, drags and keys, then the
  context bar controls. After signing in with a seed test account from
  `apps/server/seed-accounts.example.json` (created with `POST /auth/signup` on the scratch server),
  a board was moved to the scratch server and opened through its edit link in a second tab on
  another origin (`two.localhost:5232`, a guest). That tab checked live sync of stickies, timer,
  voting, votes, end for everyone, cursors and cursor chat.
- Slides: a new deck from Home with the Ocean template and every layout, then the slide list,
  groups, shortcuts, notes, animations, transitions, slide numbers, footer, presenting (keys, help,
  go to number, end screen, inline presenter view), grid view and reload persistence. Exports were
  caught at the download step and their bytes inspected, without saving to Downloads.
  `~/Downloads/Untitled.deck` was copied to the scratch folder and dropped on the canvas. A .pptx
  exported from Nagma was imported again (round trip), and hand-built .pptx files were imported in
  the unit tests (4:3, groups, alternate content, damaged numbers, fonts and bullets).
- 1024 px wide and light and dark themes: layout checks (no page overflow, toolbars inside the
  viewport) and a text contrast sweep over every visible label.
- Part-way through, the browser pane was hidden (screenshots stopped). From then on, checks used
  the accessibility tree, DOM events and editor state. A dev-only gotcha: modules Vite has updated
  load with `?t=`, so test code must import the same URL the app uses (from
  `performance.getEntriesByType("resource")`) to share module state.

## 1. Test matrix

### Board

| # | Flow / control | Steps | Expected | Actual | Result |
| --- | --- | --- | --- | --- | --- |
| B1 | New board from Home | Click Board on Home | Opens empty white board, move tool active | As expected | PASS |
| B2 | Sticky place | Sticky tool, click canvas | 240x240 sticky centred on click, editing text | As expected | PASS |
| B3 | Sticky type | Type text, Escape | Text stored, name follows text, selection kept | As expected | PASS |
| B4 | Sticky undo/redo | Cmd+Z twice, Cmd+Shift+Z twice | Text then sticky removed; redo restores both | As expected | PASS |
| B5 | Sticky colour | Colour menu, Blue | Fill #A8DAFF | As expected | PASS |
| B6 | Sticky author toggle | Author switch off | showAuthor false, label hidden | As expected | PASS |
| B7 | Sticky bold | Cmd+B with sticky selected | fontWeight 700 | As expected | PASS |
| B8 | Shape tray | Click Shapes and connectors | Tray with connectors, 8 shapes, More shapes | As expected | PASS |
| B9 | Rectangle with text | Drag rect, type, Escape | Shape with text Box | As expected | PASS |
| B10 | Connector from shape handle | Drag from shape side dot to sticky | Elbow connector attached both ends, arrow end | As expected | PASS |
| B11 | Connector line types | Curved button | line curved, radius control hidden | As expected | PASS |
| B12 | ERD caps | Start point > Zero or many | startCap erd-zero-or-many, drawn | As expected | PASS |
| B13 | Connector follows | Move attached sticky | End point follows sticky | As expected | PASS |
| B14 | Connector label | Double-click connector, type | Label text stored and drawn mid-line | As expected | PASS |
| B15 | Marker draw | Drawing tools, violet, drag | Marker vector, colour #9747FF, width 4 | As expected | PASS |
| B16 | Washi tape | Washi tape tool, drag | Washi tape object along drag | As expected | PASS |
| B17 | Eraser | Eraser, drag across 2 strokes | Both strokes removed | As expected | PASS |
| B18 | Eraser undo | Cmd+Z | Both strokes back in one step | As expected | PASS |
| B19 | Text tool | T, click, type, Esc | Text layer created | Created at 12px ("Teensy"), below every board preset | PASS (note) |
| B20 | Section draw | Shift+S, drag over shape | Section adopts shape, white fill, outline | Section drawn on top of a connector reaching into it, hiding the connector's end and cap | FAIL, fixed in b85dc46 |
| B21 | Section undo/redo | Cmd+Z, Cmd+Shift+Z | One step each, shape back on page | As expected | PASS |
| B22 | Section rename | Rename in bar, type, Enter | Name Ideas | As expected | PASS |
| B23 | Section hide contents | Eye button | Children hidden, striped "Contents hidden" | As expected | PASS |
| B24 | Section show contents | Eye button again | Children visible | As expected | PASS |
| B25 | Table place | Shift+T, click | 3x3 table, header row tinted | As expected | PASS |
| B26 | Table toolbar near left edge | Select table at left of view | Bar fully visible | Bar ran off the left edge (fixed 260px clamp) | FAIL, fixed in 003bf44 |
| B27 | Table cell typing + Tab | Double-click cell, type, Tab x3 | A1 B1 C1 then wraps to A2 | As expected | PASS |
| B28 | Table cell undo | Cmd+Z | Last cell edit undone | As expected | PASS |
| B29 | Column grabber | Click top grabber | Column picked, bar shows Left/Right/Resize/Delete/Merge | As expected (bar off-screen before fix) | PASS |
| B30 | Insert column right | + Right | Empty column after picked, text kept | As expected | PASS |
| B31 | Insert undo | Cmd+Z | Column removed | As expected | PASS |
| B32 | Multi-cell select | Drag across 2x2 cells | Block picked, Merge offered | As expected | PASS |
| B33 | Merge cells | Merge | merges [{r1,c0,rs2,cs2}], Unmerge offered | As expected | PASS |
| B34 | Per-cell fill | Fill menu, blue | Picked cells #C2E5FF | As expected | PASS |
| B35 | Enter edits picked cell | Enter, type | Text in merged anchor | As expected | PASS |
| B36 | Stamp wheel from toolbar | Click Stamp | Wheel of 10 stamps, emoji, cursor chat, Faces row | Faces row overlapped the bottom toolbar | FAIL, fixed in 7e8ea2e |
| B37 | Stamp place | Pick Thumbs up, click canvas | 48px stamp with author | As expected | PASS |
| B38 | Stamp tool exit | Escape | Back to move | As expected | PASS |
| B39 | Timer start | Panel, 00:02, Enter | Timer runs, pill counts down, music on | As expected | PASS |
| B40 | Timer after 00:00 | Click 3 min, Start | Display 03:00, Start enabled | Display stuck at 00:00, Start disabled until Stop | FAIL, fixed in 6704f81 |
| B41 | Timer music with panel closed | Start with music, close panel | Music continues | Music stopped (panel hook cleanup) | FAIL, fixed in 6704f81 |
| B42 | Timer stop | Stop | Timer cleared | As expected | PASS |
| B43 | Templates far from origin | Pan away, insert Retrospective | Stickies inside their sections | Stickies near world origin | FAIL, fixed in ef1bea3 |
| B44 | Template into section | Section > Templates > Flowchart | Centred in section | Built around world (w/2,h/2) | FAIL, fixed in ef1bea3 |
| B45 | Sign in (seed test account) | Home > Sign in, seed account | Signed in as Ava Tester | As expected | PASS |
| B46 | Move board to server | Share > Move to the server and share | URL gets file and key, collab live | As expected | PASS |
| B47 | Second tab via edit link | Open link in a second origin (guest) | Live, edit role, sees Ava | As expected | PASS |
| B48 | Sticky sync | Ava places sticky with text | Guest sees text and author | As expected | PASS |
| B49 | Timer sync | Ava starts 1 min timer | Guest sees timer | As expected | PASS |
| B50 | Voting sync | Ava starts voting with prompt | Guest sees prompt, cannot end while host here | As expected | PASS |
| B51 | Votes from two people | Guest joins and votes, Ava votes | Both votes counted (2) | As expected | PASS |
| B52 | Simultaneous votes | Two writes from the same base state | Both kept | Later write dropped the other vote (LWW per property) | FAIL, fixed in 3958f4f |
| B53 | End voting for everyone | Host ends | Guest sees session closed | As expected | PASS |
| B54 | Timer stop sync | Host stops | Guest timer gone | As expected | PASS |
| B55 | Cursor sync | Ava moves pointer | Guest sees Ava's cursor position | As expected | PASS |
| B56 | Cursor chat | / then type | Guest sees chat text | As expected | PASS |
| B57 | Cursor chat close | Escape | Chat closes | As expected | PASS |
| B58 | New board after a slide deck | Open deck at 73%, Home > Board | New board at 100% | Opened at 73% with the deck's scroll | FAIL, fixed in eb866c5 |
| B59 | Zoom in button | + twice | x2 steps (73->147->293%) | As expected | PASS |
| B60 | Zoom 100% | Shift+0 | 100% | As expected | PASS |
| B61 | Zoom out/in keys | Cmd+- / Cmd+= | x0.5 / x2 | As expected | PASS |
| B62 | More panel | More | Tabs Templates, Widgets, Plugins, Stickers, Faces, Community; widgets list | As expected | PASS |
| B63 | More > Poll | Click Poll | Poll widget at view centre | As expected | PASS |
| B64 | More > Code block | Click, click canvas | Code block (TypeScript) editing | As expected | PASS |
| B65 | Code block typing | Type JS with URL string | Text stored | As expected | PASS |
| B66 | More > Mind map | Click | Root, 4 ideas, 4 curved lines, one undo step | As expected | PASS |
| B67 | More > Checklist / Counter | Click each | Widgets placed | As expected | PASS |
| B68 | Undo/redo all | Undo to empty then redo all | Counts mirror (13..0..13) | As expected | PASS |
| B69 | Export PNG solid | Export, PNG, Solid | White opaque corner pixel, 2x | As expected | PASS |
| B70 | Export PNG transparent | Transparent | Corner alpha 0 | As expected | PASS |
| B71 | Export PNG grid | Grid | White with dots | As expected | PASS |
| B72 | Export JPG | JPG | JFIF bytes | As expected | PASS |
| B73 | Export PDF | PDF | Small PDF | 3.4 MB (raw pixels) | FAIL, fixed in 0c6b383 |
| B74 | Export CSV with no stickies | CSV | Notice, no file | As expected | PASS |
| B75 | AI summarize (offline) | 4 stickies on 2 topics, Summarize | Bullets covering both topics | Both bullets on one topic | FAIL, fixed in d4bf722 |
| B76 | AI sort (offline) | Sort stickies | 2 sections Launch, Bug; one undo step | As expected | PASS |
| B77 | Image drop | Drop a PNG on the board | Image layer 64x48, media store, one step | As expected | PASS |
| B78 | Link preview (video) | Insert a video link | Embed card 480x302 with privacy-mode player | As expected | PASS |
| B79 | Link display minimized | Display > Minimized | 320x48 chip | As expected | PASS |
| B80 | Link back to text | Change back to text | Text with the link, card removed | As expected | PASS |
| B81 | More > Templates tab | Templates tab | Built-in templates listed with categories | As expected | PASS |
| B82 | More > Plugins tab | Plugins tab | "No plugins yet", import from manifest | As expected | PASS |
| B83 | More > Stickers tab | Stickers tab | Emoji sticker grid | As expected | PASS |
| B84 | More > Faces tab | Faces tab | Signed-in face Ava Tester | As expected | PASS |
| B85 | More > Community tab | Community tab | Join a team message | As expected | PASS |
| B86 | More search | Type "kan" | Only Templates: Kanban | Empty Widgets/Plugins/Community headings shown | FAIL, fixed in 513de30 |
| B87 | More search no match | Type "zzz" | Nothing matches | Only headings, no message | FAIL, fixed in 513de30 |
| B88 | 1024px | Viewport 1024x768, table selected | Toolbars inside the viewport, no page scroll | As expected | PASS |
| B89 | Light/dark | Switch theme both ways | No low-contrast text | As expected | PASS |
| B90 | Sticky colours (all 10) | Colour menu, each swatch | Fill matches swatch | As expected (FFFFFF..FFE299) | PASS |
| B91 | Sticky text sizes | Text size: Small..Huge, Auto | 16/24/40/64/96, Auto=null | As expected | PASS |
| B92 | Sticky fonts | Font: Bookish, Technical, Scribbled, Simple | Source Serif 4, Roboto Mono, Caveat, Inter | As expected | PASS |
| B93 | Strike / lists keys | Cmd+Shift+X, 8, 7 on sticky | strikethrough, bullet, number, toggle off | As expected | PASS |
| B94 | Every shape kind | Place each of the 71 shapes | Finite path, one step each | As expected | PASS |
| B95 | Code block lang | Code block bar | Language list, TypeScript default | As expected | PASS |
| B96 | Mind map Cmd+Return on root | Select central topic, Cmd+Return | Curved arrowless map branch, map tidies | Arrowed elbow outside the map | FAIL, fixed in d1b0626 |
| B97 | Mind map Cmd+Return on sticky topic | Stickies map topic, Cmd+Return | Branch with a line | Loose sticky, no line | FAIL, fixed in d1b0626 |
| B98 | Generate ideas undo | AI > Generate ideas, Cmd+Z | All four ideas removed in one step | Only the last idea removed | FAIL, fixed in d1b0626 |
| B99 | Type to edit undo | Select sticky, type keys, Esc, Cmd+Z | One undo restores | First key was its own step | FAIL, fixed in bcb216a |
| B100 | Picked cell type to edit undo | Pick cell, type, Cmd+Z | One undo | Two steps | FAIL, fixed in bcb216a |
| B101 | Duplicate merged columns | Merge A1:B1, duplicate cols A-B | Original merge kept, copy merged | Merge dropped | FAIL, fixed in bcdf1fe |
| B102 | Duplicate row inside merge | Merge A1:A3, duplicate row 2 | Merge grows to 4 rows | Merge dropped | FAIL, fixed in bcdf1fe |
| B103 | Merge over existing merge | Merge A2:A3 then A3:B3 | Anchor A2 picked | Covered cell picked | FAIL, fixed in bcdf1fe |
| B104 | Counter double-click | Double-click + | +2 | +3 | FAIL, fixed in 3eeecf9 |
| B105 | Poll add option while voting | Add option dialog open, another vote lands | Both kept | Vote dropped by stale copy | FAIL, fixed in 3eeecf9 |
| B106 | Rotated checklist | Rotate 180, click a box | Row under pointer ticks | Wrong row | FAIL, fixed in 3eeecf9 |
| B107 | Poll widget simultaneous votes | Two votes from the same base | Both kept | One lost | FAIL, fixed in 3958f4f |
| B108 | Voting after host leaves | Host starts untimed session, leaves | Others can end it | Nobody could end or clear it | FAIL, fixed in ee3561a |
| B109 | Votes on deleted objects | Vote 3, delete one voted sticky | 1 vote left, not in results | 0 left, deleted id in results | FAIL, fixed in ee3561a |
| B110 | Cmd+Shift+U | Sticky selected, Cmd+Shift+U | Link dialog | Nothing | FAIL, fixed in 6b0b6b5 |
| B111 | Cmd+Shift+U on picked cells | Pick cells, Cmd+Shift+U | Cell link dialog | Nothing | FAIL, fixed in 6b0b6b5 |
| B112 | javascript: link card | Card with javascript: URL (synced or crafted), double-click | Nothing opens | window.open ran it | FAIL, fixed in 4140ff1 |
| B113 | Embed sandbox | Embed iframe attributes | Sandboxed, no top navigation | Unsandboxed | FAIL, fixed in 4140ff1 |
| B114 | Code comment in string | const u = "https://x.com"; | String coloured as string | Rest of line grey | FAIL, fixed in aebbde6 |
| B115 | Python # in string | print("#1") # done | Only "# done" grey | From first # grey | FAIL, fixed in aebbde6 |
| B116 | AI sort duplicate ids | Model lists a sticky twice | Placed once | Empty slot in first section | FAIL, fixed in 8e72dd9 |
| B117 | Undo puts sticky over topic | Move sticky off a topic, Cmd+Z | No branch, redo kept | Branch made, redo lost | FAIL, fixed in 8f0f67f |
| B118 | Template into existing section | Section > Templates > any | Centred in that section | Built near world origin | FAIL, fixed in ef1bea3 |
| B119 | Timer chime on open | Open a file whose timer ended | No chime | Chimed (and twice with the panel open) | FAIL, fixed in 6704f81 |
| B120 | Templates (all 9) | Insert each far from origin | Section contents inside their sections | Contents near origin | FAIL, fixed in ef1bea3 |
| B121 | Tables insert/delete/move | Unit tests (board.test.ts) | Text and size follow | As expected | PASS |
| B122 | Connector routing | Unit tests (board.test.ts) | Elbow/straight/curved routes | As expected | PASS |

### Slides

| # | Flow / control | Steps | Expected | Actual | Result |
| --- | --- | --- | --- | --- | --- |
| S1 | New deck from Home | Click Slides on Home | Template picker with 9 templates and Add all slides | As expected | PASS |
| S2 | Pick template with all layouts | Ocean, Add all slides checked | 13 slides, one per layout, Ocean colours and fonts | As expected | PASS |
| S3 | Notes typing | Type in presenter notes, pause | Saved after 600ms as one step | As expected | PASS |
| S4 | Notes undo | Undo after notes saved | Doc and field revert, blur doesn't re-save | Field kept old text and blur wrote it back as a new step | FAIL, fixed in 6562219 |
| S5 | Notes per-slide save | Type on slide A, switch, type on B within 600ms | Both saved | A's words lost (single global timer) | FAIL, fixed in 6562219 |
| S6 | Insert slide above first | Context menu on slide 1 > Insert slide above | New slide first | Went to end of deck | FAIL, fixed in cb22422 |
| S7 | New slide > layout with other template | Slide on Ocean, deck main Light, New slide > layout | New slide uses Ocean | Used main template | FAIL, fixed in 0838dcf |
| S8 | Video from link without scheme | Video link "youtube.com/embed/x", present | Plays | Presentation crashed (Invalid URL) | FAIL, fixed in ad1ada9 |
| S9 | Import 4:3 pptx | Import 9144000x6858000 deck | Letterboxed | Bottom quarter cropped | FAIL, fixed in 7a8d26b |
| S10 | Import pptx groups | Shapes inside p:grpSp | Placed via group transform | Placed at raw child coords | FAIL, fixed in 7a8d26b |
| S11 | Import pptx alternate content | mc:AlternateContent | Choice only | Choice and Fallback both imported | FAIL, fixed in 7a8d26b |
| S12 | Import pptx damaged numbers | cx="abc", sz NaN, sldSz 0 | Finite geometry | NaN/Infinity geometry | FAIL, fixed in 7a8d26b |
| S13 | Redo after code/auto-fit edit undo | Edit auto-fit text, undo, redo | Redo works | Redo stack wiped by housekeeping | FAIL, fixed in c29f4d5 |
| S14 | Insert slide above (UI) | Right-click slide 1 > Insert slide above | New slide at top | As expected after fix | PASS |
| S15 | Group slides | Click slide 2, shift-click 3, Cmd+G | Group "Slides 2 to 3" | As expected | PASS |
| S16 | Ungroup | Shift+Cmd+G | Rows split | As expected | PASS |
| S17 | Group/ungroup undo/redo | Cmd+Z x2, Cmd+Shift+Z | Each one step | As expected | PASS |
| S18 | Move group down | Group picked, Cmd+] | Group swaps with next row | Last slide left the group, nothing moved | FAIL, fixed in 716edbf |
| S19 | Reload persistence | Reload page | Deck, groups, notes kept | As expected | PASS |
| S20 | Present | Present button | Full-screen show of current slide, counter | As expected | PASS |
| S21 | Present next/prev keys | Right, Right | Advances 2 slides | As expected | PASS |
| S22 | Present help | ? key | Shortcuts overlay listing keys | As expected | PASS |
| S23 | Present help close | Escape | Overlay closes, show stays | As expected | PASS |
| S24 | Present go to number | Type 1 2 Enter | Jumps to slide 12 | As expected | PASS |
| S25 | Present End then next | End, Right | End screen "End of presentation" | As expected | PASS |
| S26 | Present Esc | Escape | Show ends, editor on last slide | As expected | PASS |
| S27 | Present options menu | Chevron by Present | From start, from current, presenter view, rehearse, copy link, offline | As expected | PASS |
| S28 | Full image placeholder | Full image layout slide | Checker placeholder image | As expected (placeholder svg in media store) | PASS |
| S29 | Export PDF with notes | Export slides, notes on, Export | Small PDF, 14 pages | 45.5 MB file (raw pixels) | FAIL, fixed in 461b9e9 |
| S30 | Export PDF bytes | Inspect blob | %PDF-1.3 header, 14 /Page, %%EOF | As expected | PASS |
| S31 | Export vector PDF | Export > PDF | 14 pages 1920x1080, %PDF header | As expected; text uses standard Helvetica (fonts not embedded) | PASS (known issue) |
| S32 | Export PNG | Export > PNG | Zip of 14 PNGs (PK header) | As expected | PASS |
| S33 | Export PPTX | Export > PPTX | PK zip | As expected | PASS |
| S34 | Import .deck | Drop Untitled.deck (copied to scratch) on canvas | Opens as slides file, 1 slide rendered | As expected | PASS |
| S35 | PPTX round trip | Import the exported .pptx | 14 slides, text, colours, fonts and bullets | Fonts and bullets dropped | FAIL, fixed in 4e644a5 |
| S36 | 1024px | Viewport 1024x768 | Panels 250/524/250, toolbar inside, no page scroll | As expected | PASS |
| S37 | Light/dark | Switch theme both ways | No low-contrast text | As expected | PASS |
| S38 | Add animation | Select Heading, Animate, + | Fade on click | As expected | PASS |
| S39 | Second animation after previous | Body +, Trigger > After previous | Runs 400-800 in same click step | As expected | PASS |
| S40 | Move animation up | Move up on second | Order swapped; leading "after previous" plays on entry | As expected | PASS |
| S41 | First Move up disabled | Look at first row | Disabled | As expected | PASS |
| S42 | Transition Match animate | Transition > Match animate | type smart, ease out, 400ms | As expected | PASS |
| S43 | Preview transition / Play animations | Buttons | Play without errors | As expected | PASS |
| S44 | Slide numbers | Slide numbers switch | 1..14 on every slide, one step | As expected | PASS |
| S45 | Footer | Type footer, Enter | Footer on all 14 slides in one step | As expected | PASS |
| S46 | Footer undo | Cmd+Z | Footers removed | As expected (selection moves to the slides) | PASS |
| S47 | Presenter view | Present with presenter view | Popup blocked in this browser, inline presenter view with timer, current/next, notes | As expected | PASS |
| S48 | Presenter steps | Next, Next | Step 1 of 1 then slide 2 | As expected | PASS |
| S49 | Presenter notes edit | Edit notes, type | Saved to the slide | Field kept stale text and could overwrite newer notes | FAIL, fixed in 6bff393 |
| S50 | Presenter notes Esc | Esc in notes | Leaves notes; next Esc ends show | Esc did nothing (keyboard trapped) | FAIL, fixed in 6bff393 |
| S51 | Grid view | Grid view radio | Rows per group, Add row | As expected | PASS |
| S52 | Grid Add row + undo | Add row, Cmd+Z | 15 then 14 slides | As expected | PASS |
| S53 | Reload persistence | Reload | 14 slides, numbers, animations, transition, notes kept | As expected | PASS |
| S54 | Insert above in a group | Insert slide above on a grouped slide | Right before it, in its group | After the previous slide | FAIL, fixed in cb22422 |
| S55 | Redo after code edit undo | Edit code block, Cmd+Z, Cmd+Shift+Z | Redo restores | Redo stack wiped by re-colouring | FAIL, fixed in c29f4d5 |
| S56 | Match animate with click animations | Slide 2 layer fades in on click, Match animate | Layer hidden during transition | Shown then vanished | FAIL, fixed in 537af3d |
| S57 | Match animate after exits | Slide 1 layer animated out, advance | Stays gone | Came back during transition | FAIL, fixed in 537af3d |
| S58 | Video link without scheme | youtube.com/embed/id | Plays | Crash (Invalid URL) | FAIL, fixed in ad1ada9 |
| S59 | Empty video link | Video with no link, present | Blank player | Loaded the app inside the player | FAIL, fixed in ad1ada9 |
| S60 | Simultaneous poll answers | Two answers from the same base | Both kept | One lost | FAIL, fixed in 3958f4f |
| S61 | Simultaneous stamps | Two stamps together | Both kept | One lost | FAIL, fixed in 3958f4f |
| S62 | PPTX damaged numbers | cx="abc", sz bad | Finite | NaN geometry saved | FAIL, fixed in 7a8d26b |
| S63 | Typing notes across slides | Type on A, next slide, type within 600ms | Both saved | A's last words lost | FAIL, fixed in 6562219 |
| S64 | Poll option reorder | Swap options with votes | Votes follow options | Votes moved to other options | FAIL, fixed in 259d795 |
| S65 | Poll option removed | Remove an option with votes | Votes dropped, 100% total | Percentages off | FAIL, fixed in 259d795 |
| S66 | Poll option added | Add an option | Row on slide | No row on slide, thumbnail, export | FAIL, fixed in 259d795 |
| S67 | Template sharing an id | Remix Light, Browse > Light on one slide | Other slides keep remix | Deck template replaced | FAIL, fixed in c926dc4 |
| S68 | From your decks scan | Library > From your decks while deck changes | List finishes | Restarted every render | FAIL, fixed in 468382d |
| S69 | Paste 40 columns | Paste tab-separated 40 columns | Positive text widths | Negative widths | FAIL, fixed in bf856ad |
| S70 | Paste 400 rows | Paste 400-row CSV | Rows at least 40px | 2px rows | FAIL, fixed in bf856ad |
| S71 | Chart 1e999 | Chart data value 1e999 | Bar drawn as 0 | NaN bars | FAIL, fixed in 7b2d779 |
| S72 | Remix #FFF | Template with #FFF accent, Remix | Stays white | Turned yellow | FAIL, fixed in 7b2d779 |
| S73 | PPTX export control chars | Text with vertical tab, export | Valid XML | PowerPoint repair prompt | FAIL, fixed in 7b2d779 |
| S74 | Drop slide in place | Drag a slide and drop where it was | No undo step | Empty undo step | FAIL, fixed in dd0f10c |
| S75 | New group on one slide | Move to group > New group | Group where the slide is | Moved to end | FAIL, fixed in dd0f10c |
| S76 | Rehearsal end screen | Rehearse, end screen, back, next | End-screen time not counted | Added to last slide | FAIL, fixed in 26d4bcc |
| S77 | Slide deleted during show | Collaborator deletes current slide | Show moves on | Blank screen | FAIL, fixed in 97bac6d |
| S78 | Two code blocks edited quickly | Edit two blocks within 300ms | Both re-coloured | First skipped | FAIL, fixed in 06dd850 |
| S79 | Two auto-fit texts edited quickly | Edit two within 250ms | Both fitted | First skipped | FAIL, fixed in 06dd850 |
| S80 | Remix colours | Remix button | Accent, surface, muted turn round the wheel | As expected | PASS |
| S81 | Ungroup / Cmd+[ inside group | Unit tests (slides.test.ts) | Order and grouping per audit | As expected | PASS |
| S82 | Tables edge bars, merge, split | Unit tests (slides.test.ts) | Insert/delete/move/merge | As expected | PASS |
| S83 | Import real .deck | fig-import tests with ~/Downloads/Untitled.deck | One slide in one section | As expected | PASS |

## 2. Bug list

Severity: S1 crash, data loss or security; S2 broken feature; S3 wrong behaviour; S4 cosmetic.
"Found" says how each bug surfaced: the app (exploratory) or the code reviews (review).

| Id | Sev | Found | Bug and repro | Root cause | Fix | Test |
|---|---|---|---|---|---|---|
| BS-01 | S1 | review, app | Slides: a video link typed without `https://` (`youtube.com/embed/x`) crashed the presentation into its error screen. | `videoEmbedUrl` passed the scheme-less link to `new URL`, which throws. | Links get `https://`, a link that doesn't parse or isn't http(s) plays `about:blank` (`widgets.ts`). ad1ada9 | slides-qa "video links" |
| BS-02 | S1 | review | Board: a link card holding `javascript:` (synced from a collaborator or a crafted file) ran it on double-click or Open link; embeds were unsandboxed. | The scheme was checked only when a card was made, never where it's used. | `webUrl`/`openWebUrl` check at use; iframes get a sandbox without top navigation (`links.ts`, `embeds.tsx`, `plugin.ts`, `context-bar.tsx`). 4140ff1 | board-qa "link cards" |
| BS-03 | S2 | review | Redo did nothing after undoing an edit to a slides code block or auto-fit text (also after a timer or vote tick, or a link unfurl landing). | `executeSilently` goes through `execute`, which empties `future`. | `executeSilently` keeps the redo stack (`store.ts`). c29f4d5 | store.test "executeSilently after an undo" |
| BS-04 | S2 | review | Slides notes: after an undo the notes field kept the old text, and leaving the field wrote it back as a new step. | The draft only resynced on slide change. | Draft tracks `base`/`sent` and shows saved notes that aren't your own typing (`slides-editor.tsx`, later `notes-draft.ts`). 6562219 | slides-qa "presenter notes drafts" |
| BS-05 | S2 | review | Slides notes: typing on another slide within 600 ms dropped the last words on the slide before. | One global debounce timer. | One timer per slide (`actions.ts setNotes`). 6562219 | slides-qa "presenter notes" |
| BS-06 | S2 | review | .pptx import cropped 4:3 decks (bottom quarter lost). | Scale used the width only. | Fit both sides and letterbox (`pptx.ts`). 7a8d26b | pptx-import "letterboxes a 4:3 deck" |
| BS-07 | S2 | review | .pptx import: damaged numbers or a zero page size put NaN/Infinity geometry in the document. | `Number()` without a finiteness check. | `num()` with fallbacks (`pptx.ts`). 7a8d26b | pptx-import "keeps geometry finite" |
| BS-08 | S2 | review | Board templates: section contents (stickies, tables) landed near the board origin, outside their sections, whenever the view wasn't there. Into an existing section, every template was built around the origin. | Templates wrote section-relative positions, but layers keep world coordinates. | `placeInSections` offsets them; into-section uses the section's world centre (`templates.ts`). ef1bea3 | board-qa "board templates" |
| BS-09 | S2 | review | Board widgets: a dialog (title, add or rename an item) wrote the copy from before it opened, dropping votes or items added meanwhile. | The closure captured `jam`. | `update` reads the live widget (`widgets.ts`). 3eeecf9 | (dialog flow; logic in update) |
| BS-10 | S2 | review | Board voting: with the host gone, nobody could end an untimed session or clear it, and no new one could start. | End was host-only. | `hostHere`/`canEndVoting`: anyone can end once the host has left; a timed session is ended by whoever is here (`voting.ts`, `voting-ui.tsx`). ee3561a | board-qa "board voting" |
| BS-11 | S2 | review | Slides: a collaborator deleting the slide on screen blanked the show. | `show.order` is fixed at start. | `pruneShow` on every document change (`show.ts`, `present.tsx`). 97bac6d | slides-qa "a show while slides are deleted" |
| BS-12 | S2 | review | Slides polls: editing options moved votes to other options, kept votes for removed ones (percentages off) and left the slide's option rows stale. | Votes are keyed by index; only existing label texts were updated. | `setPollOptions` redraws rows, `remapVotes` follows option text, totals count valid votes (`widgets.ts`, `inspector.tsx`, `present.tsx`). 259d795 | slides-qa "editing a poll's options" |
| BS-13 | S2 | app | Slides: a notes PDF of 14 slides was 45 MB (the Display P3 PDF had the same flaw). | jsPDF without `compress` stores pictures as raw pixels. | Compressed losslessly (`slides/actions.ts`). 461b9e9 | in app: 45.5 MB to 0.3 MB |
| BS-14 | S2 | review, app | Board voting, board polls, slide polls, scales and stamps: two people answering at the same moment lost one answer. | Sync is last-writer-wins per layer property, and every answer rewrote the whole property. | Each person re-asserts their own entry when a write drops it (`engine/reassert.ts`, used by `voting.ts`, `board/widgets.ts`, `slides/widgets.ts`). 3958f4f | board-qa x2, slides-qa "live poll answers" |
| BS-15 | S2 | app | Slides presenter view: the speaker notes field kept its first text and wrote it back over notes changed elsewhere. | Uncontrolled textarea with `defaultValue`. | Shared `useNotesDraft` (`notes-draft.ts`, `present.tsx`). 6bff393 | slides-qa "presenter notes drafts" |
| BS-16 | S2 | review | Board: undoing a move that put a sticky back over a mind map topic attached it as a branch (a new step that also cost the redo). | After-edit fixes ran after undo and redo too. | They run for your edits only (`connectors.ts`). 8f0f67f | board-qa "undo near a mind map" |
| BS-17 | S2 | review | Board timer: closing the timer panel or switching to Voting stopped the music for you; 00:00 chimed twice, and also on opening a file whose timer had ended. | Every reader of the timer hook played and stopped the shared music. | `useTimerSound` used once, by the pill; it chimes only after seeing the timer run (`timer.ts`, `meetings.tsx`). 6704f81 | (audio; verified in app) |
| BS-18 | S2 | review | .pptx export could be invalid XML (a pasted vertical tab), so PowerPoint asked to repair the file. | `esc` kept XML-illegal control characters. | They're dropped (`pptx-export.ts`). 7b2d779 | (string helper) |
| BS-19 | S3 | app | Board: a new section was drawn over a connector reaching into it, hiding its end and cap. | New sections went on top; the board gives them an opaque fill. | New sections go behind other objects, above other sections (`connectors.ts newObjectFixes`). b85dc46 | board-qa "board sections" |
| BS-20 | S3 | review | Slides: Insert slide above on slide 1 put the new slide at the end of the deck. | `null` anchor means "append". | `before` option for `addSlide`/`addSlideCommands`/`placeAfter` (`model.ts`, `actions.ts`, `slide-list.tsx`). cb22422 | slides-qa "insert slide above" |
| BS-21 | S3 | review | Slides: New slide > layout used the deck's main template even when the current slide's (named in the menu) differed. | Compared against the slide's own template, always equal. | Compare with the deck's main template (`slide-list.tsx`). 0838dcf | in app |
| BS-22 | S3 | review | .pptx import placed shapes inside groups at raw child coordinates. | Group transforms (chOff/chExt) were ignored. | `groupPlace` maps through every enclosing group (`pptx.ts`). 7a8d26b | pptx-import "inside groups" |
| BS-23 | S3 | review | .pptx import duplicated shapes from alternate content (choice and fallback). | Every element was read. | Fallback copies are skipped (`pptx.ts`). 7a8d26b | pptx-import "alternate content" |
| BS-24 | S3 | review | Slides: an empty video link loaded the app itself inside the player. | `src=""`. | Plays `about:blank` (`widgets.ts`). ad1ada9 | slides-qa "video links" |
| BS-25 | S3 | app | Slides: ⌘] / ⌘[ with a whole group picked didn't move it (its last slide stepped out and back) and made an empty undo step. | Per-slide nudging only. | Whole picked groups move as one (`actions.ts nudgeSlides`). 716edbf | slides-qa "moving a picked group" |
| BS-26 | S3 | review | Board timer: after 00:00 the presets and fields changed a hidden draft; the display stayed 00:00 and Start stayed off until Stop. | The display showed `left` while a timer existed. | After 00:00 an edit shows and starts the new time (`meetings.tsx`). 6704f81 | in app |
| BS-27 | S3 | review | Board tables: duplicating rows or columns that touch a merge dropped the original merge. | A duplicated index made the set check fail. | First copies keep the merge, full copies get their own, a copy inside grows it (`table.ts permute`). bcdf1fe | board-qa "duplicating tracks keeps merges" |
| BS-28 | S4 | review | Board tables: merging over an existing merge left a covered cell picked. | Picked the block's corner, not the grown range's. | Picks the expanded anchor (`table.ts mergeCells`). bcdf1fe | board-qa "merging over an existing merge" |
| BS-29 | S3 | review | Board mind maps: ⌘Return on the central topic made an arrowed elbow outside the map. | The line look came only from a line into the topic. | Falls back to the map's outgoing lines (`actions.ts addAdjacent`). d1b0626 | board-qa "mind maps and AI ideas" |
| BS-30 | S3 | review | Board mind maps: ⌘Return on a sticky topic made a loose sticky with no line. | Only shapes connected. | Topics in a map always connect (`actions.ts`). d1b0626 | board-qa |
| BS-31 | S3 | review | Board: Generate ideas made four undo steps. | One step per idea. | Merged into one (`ai.ts`). d1b0626 | board-qa |
| BS-32 | S3 | review, app | Board: typing on a selected sticky, shape or picked cell made the first key its own undo step. | The text session's merge began at its own first write. | `typed` flag starts the session at one step (`state.ts`, `actions.ts`, `text-edit.tsx`, `board-editor.tsx`, `plugin.ts`). bcb216a | in app (one Cmd+Z restores) |
| BS-33 | S3 | review | Board widgets: a double-click applied an extra click (counter +3). | The dblclick handler acted as a third click. | A double-click only opens an item's text (`widgets.ts`). 3eeecf9 | board-qa "board widgets" |
| BS-34 | S3 | review | Board widgets: clicks on a rotated widget hit the wrong rows. | Unrotated geometry. | Points mapped through the widget's world matrix (`widgets.ts`). 3eeecf9 | board-qa "board widgets" |
| BS-35 | S3 | review | Board voting: votes on deleted objects still counted against "votes left" and showed in results. | `myVotes` and `results` didn't filter. | Both skip deleted objects (`voting.ts`). ee3561a | board-qa "board voting" |
| BS-36 | S3 | review | Board: ⌘⇧U did nothing, though the bar and the shortcut list advertise it. | No key handling. | `linkForKey` + `askLink` on objects and picked cells (`actions.ts`, `board-editor.tsx`, `text-edit.tsx`). 6b0b6b5 | board-qa "⌘⇧U" + in app |
| BS-37 | S3 | review | Board AI sort: a sticky listed twice was moved twice, leaving an empty slot; left-out stickies weren't placed. | Only unknown ids were filtered. | `cleanGroups` (`ai.ts`). 8e72dd9 | board-qa "AI sort" |
| BS-38 | S3 | review | Slides: Move to group > New group on one slide sent it to the end of the deck. | New group pushed to the end. | Made where the slide is (`actions.ts moveSlidesToSection`). dd0f10c | slides.test (updated) |
| BS-39 | S3 | review | Slides: a template sharing an id with the deck's (built-in Light over a remixed Light) replaced the deck template while restyling only the picked slides. | `templateCommands` matched by id. | A different template under a taken id joins as a copy (`model.ts`). c926dc4 | slides-qa "templates sharing an id" |
| BS-40 | S3 | review | Slides template library: "From your decks" restarted its scan on every render and could never finish while the deck was busy. | Effect depended on a new array each render. | List read inside the effect, keyed on file (`template-picker.tsx`). 468382d | in app |
| BS-41 | S3 | review | Slides: pasting a 40-column table made negative text widths, a 400-row one 2px rows. | Sizes divided without floors. | Cells at least 96x40, padding scales (`widgets.ts tableNodes`). bf856ad | slides-qa "pasting big tables" |
| BS-42 | S3 | review | Slides: a chart value of `1e999` gave NaN bars. | Infinity reached the bar maths. | Non-finite values draw as 0 (`widgets.ts`, `object-sections.tsx`). 7b2d779 | slides-qa "small slide fixes" |
| BS-43 | S3 | review | Slides: code blocks or auto-fit texts edited within the debounce lost their re-colour or fit. | One pending timer per pass dropped the earlier list. | Pending ids accumulate (`widgets.ts`, `autofit.ts`). 06dd850 | slides-qa "code blocks re-colour" |
| BS-44 | S3 | review | Slides Match animate: layers that animate in on a click showed during the transition and then vanished; layers already animated out came back. | `drawMatched` drew without animation states. | Old slide drawn final, new slide at entry; hidden layers aren't matched (`render.ts`). 537af3d | (canvas; logic in code) |
| BS-45 | S3 | app | Slides .pptx round trip lost fonts and bullets. | Import didn't read `a:latin` or `a:buChar`/`a:buAutoNum`. | Read both (`pptx.ts`). 4e644a5 | pptx-import "round trip keeps typefaces and lists" |
| BS-46 | S3 | app | A new board made after a slide deck opened at the deck's 47% zoom and scroll. | Zoom to fit did nothing on an empty page, keeping the old camera. | `openPageView` sets the default view for an empty page (`camera.ts`, `main.tsx`). eb866c5 | board-qa "a new empty board's first view" |
| BS-47 | S3 | app | Board PDF export of a small board was 3.4 MB. | jsPDF without `compress`. | Compressed losslessly (`board/export.ts`). 0c6b383 | in app: 3.4 MB to 41 KB |
| BS-48 | S3 | app | Slides presenter view: Esc in the speaker notes did nothing, trapping the keyboard. | Show keys ignore text fields. | Esc leaves the notes; the next Esc ends the show (`present.tsx`). 6bff393 | in app |
| BS-49 | S3 | review | Slides rehearsal: time on the end screen was added to the last slide. | Going back didn't reset the clock. | `previous()` from the end restarts it (`show.ts`). 26d4bcc | slides-qa "rehearsal timings" |
| BS-50 | S3 | review | Board code blocks: `//` or `#` inside a string greyed the rest of the line. | Comments were cut before tokenising. | Comments are a token kind tried where tokens start (`code.ts`). aebbde6 | board-qa "board code blocks" |
| BS-51 | S4 | app | Board: the table's selection bar ran off the left edge of the canvas. | Fixed 260px clamp; the bar is up to 770px wide. | Clamped by measured width, again on resize (`context-bar.tsx`, `barCenter` in `model.ts`). 003bf44 | board-qa "context bar placement" |
| BS-52 | S4 | app | Board: the stamp wheel's Faces row overlapped the bottom toolbar. | Bottom clamp ignored the row. | Higher clamp (`stamp-wheel.tsx`). 7e8ea2e | in app |
| BS-53 | S4 | review | Slides: Remix colours turned `#FFF` yellow. | `"FFF".padEnd(6,"0")`. | #RGB expands to #RRGGBB (`model.ts toHsl`). 7b2d779 | slides-qa "small slide fixes" |
| BS-54 | S4 | review | Slides: dropping a slide where it was made an empty undo step. | `arrange` always wrote. | No-op arrangements are skipped (`actions.ts`). dd0f10c | slides-qa "slide moves that change nothing" |
| BS-55 | S4 | app | Board AI summary (offline): four notes on two topics gave two bullets on one topic. | Top-scored sentences only. | Greedy picks favour words not yet covered (`ai.ts localSummary`). d4bf722 | board-qa "AI summary" |
| BS-56 | S4 | app | Board More panel search showed empty Widgets, Plugins and Community headings, and nothing when no result matched. | Headings shown for every kind. | Only kinds with matches, plus a no-match line (`board-toolbar.tsx`). 513de30 | in app |
| BS-57 | S4 | review | Board timer: opening a file whose timer had ended chimed and shook the pill. | The ended effect fired on mount. | Only after seeing it run (`timer.ts`). 6704f81 | in app |
| BS-58 | S4 | review | Board code blocks: `#` in Python strings was read as a comment (same root as BS-50). | Same. | Same. aebbde6 | board-qa |
| BS-59 | S3 | review | Slides poll percentages counted votes for removed options (same root as BS-12). | Same. | Same. 259d795 | slides-qa |
| BS-60 | S3 | review | Board poll widget: simultaneous votes lost one (same root as BS-14). | Same. | Same. 3958f4f | board-qa |
| BS-61 | S4 | review | Slides: `insertTable` text padding fixed at 28px whatever the cell width (with BS-41). | Same. | Same. bf856ad | slides-qa |
| BS-62 | S4 | review | Slides chart data field accepted Infinity into the deck (with BS-42). | Same. | Same. 7b2d779 | slides-qa |

## 3. Known issues not fixed

| # | Issue | Why not fixed |
|---|---|---|
| K1 | The vector PDF export of slides (and designs) uses the standard Helvetica/Courier fonts, not the deck's fonts. | Shared engine export (`engine/export.ts` via svg2pdf). Fonts would have to be fetched and embedded, which is a larger change in the design editor's area. |
| K2 | Board voting stores everyone's votes in the shared document, so "hidden until the end" votes can be read from the document or network before the host ends voting. | Needs server-held ballots, which is an architecture change. |
| K3 | Timer and voting deadlines are absolute times from the starter's clock, so a viewer whose clock is off sees a different countdown. | Needs a server time offset in collab. |
| K4 | Simultaneous timer actions (two people pressing +1 min together) still resolve last-writer-wins. | The timer is one shared value; re-asserting it would fight. Rare and harmless. |
| K5 | The board Text tool makes 12 px text, labelled "Teensy" in the bar, below every board preset. | It's the design editor's text default (shared). The reference default couldn't be confirmed. |
| K6 | Undoing a deck-wide change (footer, slide numbers) with nothing selected selects the slides it touched, which switches the right panel to the layer view. | Deliberate store behaviour (reselect what an undo touched), shared with every product. |
| K7 | The presenter view pop-up is blocked in the embedded browser, so it falls back to the inline presenter view. Audience and presenter windows in two tabs could not be tried. | Environment. The inline view was tested. |
| K8 | Link previews ask the sync server to unfurl the page, which reaches the internet. | By design. Only one unfurl ran in this session. |
| K9 | While a show runs, the editor's notes field under the show overlay can still take keyboard focus. | Minor. The overlay should be made inert, a shared change. |
| K10 | .pptx import still skips tables, charts, SmartArt, masters and layout decorations, as documented in `pptx.ts`. | Feature scope. |
| K11 | Concurrent edits to the same widget's other fields (two people renaming a poll title at once) remain last-writer-wins. | Only answers and votes, where everyone writes their own entry, are re-asserted. |
| K12 | Connector caps, Match animate and the Grid export background were checked in code and the pixel sampling the export allowed, not by eye after the pane was hidden. | Environment. |
