# QA: automated test suite (area "suite")

Branch `feature/qa-suite`. This area set up the automated test suites for the web app and the sync
server, then used them to find and fix bugs in the engine, the products and the server.

## Summary

| | Count |
|---|---|
| Web tests (Vitest, 22 files) | 1310 run, 1310 pass, 0 fail, 0 skipped |
| Server tests (node:test, 10 files) | 130 run, 130 pass, 0 fail, 0 skipped |
| Bugs found and fixed | 48: S1 12, S2 12, S3 20, S4 4 |
| Known issues not fixed | 17 (listed at the end) |

Other checks:

- `npm run build` (tsc -b, which now includes the tests, then vite build) passes.
- `npx tsc --noEmit -p tsconfig.test.json` is clean.
- `npx oxlint src` reports 0 errors; the warnings it shows were there before this work.

Bug ids are grouped by prefix:

| Prefix | Area |
|---|---|
| SRV | Server |
| CORE | Commands, history, geometry, layout, text, SVG export |
| SYS | Variables, expressions, prototype runtime, motion, components |
| PROD | Import, campaign, sites, slides, board |
| LEAD | Cross-cutting fixes made while integrating the four areas |

## How to run the tests

**Web (engine and product logic):**

```sh
cd apps/web
npm test                                  # same as: npx vitest run
npx vitest run src/engine/store.test.ts   # one file
npx vitest                                # watch mode
npx tsc --noEmit -p tsconfig.test.json    # type-check the tests (also part of npm run build)
```

- Tests live beside the code as `src/**/*.test.ts`. Config is in `vitest.config.ts`.
- Every file runs in jsdom with `src/test/setup.ts`, which:
  - stubs `fetch` to throw, so no test reaches a server; a test that needs a response stubs it itself;
  - makes canvas `getContext` return null, so text measuring uses its fixed-width fallback (width = characters × size × 0.5);
  - installs the 2D `DOMMatrix` and `DOMPoint` stand-in from `src/test/dommatrix.ts`.
- `VITE_SYNC_URL` points at an unused port.
- Shared fixtures are in `src/test/` (`core-fixtures.ts`, `sys-fixtures.ts`, `prod-fixtures.ts`).
- Some files import `./inspect-settings` first. Loaded alone in a test, `actions.ts` runs into an import cycle between `collab.ts` and `inspect-settings.ts`; the app bundle doesn't hit it.

**Real import files (optional):**

- The fig import tests read `Untitled.deck` and `Untitled.buzz` from the folder in `NAGMA_FIG_FIXTURES`. The default is this session's scratch folder `.../scratchpad/qa-data/suite/fixtures`.
- Copy your own files there or point the variable elsewhere: `NAGMA_FIG_FIXTURES=~/fixtures npm test`.
- Without the files, those 7 tests are skipped with a message and everything else still runs. The files are never committed.

**Server (integration):**

```sh
node --test apps/server/test/                     # every file in one process (test/package.json → all.mjs)
node --test 'apps/server/test/*.test.mjs'         # every file in its own process (faster)
node --test apps/server/test/auth.test.mjs        # one file
cd apps/server && npm test
```

- Node 24 won't take a folder for `--test`, so `apps/server/test/package.json` points at `all.mjs`, which imports every `*.test.mjs`.
- Each file starts its own servers with `startServer(env)` from `apps/server/test/helpers.mjs`:
  - a free port, a temporary `DATA_DIR` and no static app;
  - AI, mail, GitHub and SMTP variables removed from the environment;
  - stopped by its process handle, never by name.
- Helpers:

  | Helper | What it does |
  |---|---|
  | `call` | JSON request |
  | `signUp` | New account |
  | `createFile` | New file |
  | `connect` | WebSocket client: collects messages, `next(type)` waits for one |
  | `readStored` | Reads a stored file |
  | `waitUntil` | Waits for a condition |

- Rate-limit tests use `TRUST_PROXY=1` with distinct `X-Forwarded-For` addresses.
- Session expiry uses `SESSION_IDLE_DAYS=2/86400` (2 seconds).
- The signed SAML tests need `openssl` and skip themselves with a reason when it is missing.

## 1. Test matrix

One row per case or table-driven group. Every row is an automated test that passes now. A FAIL row
failed when first written and shows the commit that fixed it.

### Setup and cross-cutting

| Area | Case | Expected | Result |
|---|---|---|---|
| Setup | `npx vitest run`, `node --test apps/server/test/`, `node --test 'apps/server/test/*.test.mjs'` | All green | PASS |
| Setup | `npm run build`, tsc on tests, oxlint | No errors | PASS (no build-only errors) |
| History | Edit then select its result in the same task | One undo step: undo removes the result and restores the earlier selection; redo reselects | FAIL→fixed 2b01ee4 |
| History | Several selection changes in the same task | All fold into the edit | FAIL→fixed 2b01ee4 |
| History | Selection change in a later task | A step of its own | PASS |
| History | mergeLast within the task, then select | Still one step; not fresh after the task | FAIL→fixed 2b01ee4 |
| History | Edit, select, edit, mergeLast | Both edits fold; the earlier step is untouched | FAIL→fixed 2b01ee4 |
| History | Selection change after undo or redo | A step of its own | PASS |
| History | Mask two layers, undo once | Document restored (the group used to stay) | FAIL→fixed 2b01ee4 |
| History | Add a linear repeat to two layers, undo once | Document restored | FAIL→fixed 2b01ee4 |
| Fig import | Whiteboard container with an 8-byte header padded with `.`, NUL or space | Recognised as "jam" and decodes | FAIL→fixed 5461dbb |
| Fig import | Near-miss headers (a design header with its last letter changed, the whiteboard header cut short, the whiteboard header with a letter added) | Refused as unknown | PASS |
| Components | `moveWouldNestItself`: a frame holding an instance of card, or card's instance, into btn or card | true; unrelated moves false | FAIL→fixed 5d77ac2 |
| Components | Layers panel: drop a frame holding an instance of card into btn | Refused, document unchanged; a harmless drop works | FAIL→fixed 5d77ac2 |
| Components | addToSlot: card into a slot that sits inside card | Refused; another component is fine | FAIL→fixed 5d77ac2 |
| Components | Detach an outer instance whose resize stretched a nested instance (constraints) | Nested instance keeps 300 px and its contents; still follows its component; undo exact | FAIL→fixed f1eb8b1 |
| Variables | Delete a variable aliased from another collection whose modes are listed in a different order | Each mode takes the value of the mode with the same name | FAIL→fixed 535b5d1 |
| Variables | Delete a variable inherited by an extended collection | Override of it dropped; override aliases become literals; aliases read through the extension's mode; undo exact | FAIL→fixed 535b5d1 |
| Variables | Delete a variable group | Aliases to its variables become literals | FAIL→fixed 535b5d1 |
| Variables | Delete a collection | Aliases to its variables become literals; extensions detached; no dangling alias anywhere; undo exact | FAIL→fixed 535b5d1 |
| Variables | Delete an unknown variable | No undo step | PASS |

### Engine core (commands, history, nodes, paste, layout, geometry, text, SVG, serialization)

| Area | Case | Expected | Result |
|---|---|---|---|
| Commands | node.create: top level, index 0, index past the end or negative (clamped), into a nested group, text | Undo deep-equals before; redo deep-equals after | PASS |
| Commands | Create with a duplicate id or missing parent; batch runs with duplicates and orphans | Ignored, as a single create | PASS |
| Commands | node.update: fills, optional fields added or removed, frame resize with and without constraints, text re-measure, component → instance, instance override, missing node | Undo and redo exact; overrides recorded | PASS |
| Commands | node.delete: leaf, subtree, last child of a nested group, all of a group's children, parent with child, component, unknown ids | Subtree gone; empty groups removed deepest first; undo restores | PASS |
| Commands | node.move: one layer, frame with subtree, frame and child listed together, group | Each layer moved once | PASS |
| Commands | node.reparent: into a frame, index 0, huge index, reorder, out of a group (group shrinks or goes), to the root list, page reorder | One entry in the new parent | PASS |
| Commands | Reparent cycles (self, into a descendant, missing parent or node) | Refused (same doc) | PASS |
| Commands | node.convert: frame ⇄ component, detach (detachedInfo), rect or ellipse → vector, invalid target, no path | As documented | PASS |
| Commands | doc.rename, doc.settings, sequence/styles/prototype/variables set, image.add and image.set rules, batch, empty batch | Undo and redo exact; no-ops return the same object | PASS |
| Commands | Auto layout on, rotated grouped layer, flip, constraints then resize, page create and delete | Undo and redo exact | PASS |
| Commands | Random edit sequences (100 seeds × 60 steps) | Undo and redo exact; tree consistent; settled doc is a fixed point | FAIL→fixed f7efa78, 0c91615 |
| Commands | Concurrent edits merged as patches, then undone (60 seeds) | No throw; consistent tree | FAIL→fixed c06c32c |
| Commands | Stack inside a group inside a stack | Settles in one edit; redo identical | FAIL→fixed f7efa78 |
| Commands | Instance of a hugging component whose size changes | Instance follows in the same edit | FAIL→fixed f7efa78 |
| Commands | Instance set to fill in auto layout | Its contents stretch by their constraints | FAIL→fixed 0c91615 |
| Store | execute, undo and redo over 8 mixed commands | Each step restores the exact snapshot; journal kept | PASS |
| Store | Undo after editor.receive (remote rename, recolour, new layer) | Remote change kept; own edit reverted | PASS |
| Store | Undo or redo after a collaborator deleted the edited layer | No crash; layer stays deleted | FAIL→fixed c06c32c |
| Store | Stale-base execute, resetHistory, executeSilently, mergeLast, selection restore, read-only, 200-step limit, applyLocalPatch | As documented | PASS |
| Nodes | makeNode for 10 types: name, fill, blend mode, sizing, strokes | Defaults (frames white, shapes #D9D9D9, text black, pass-through containers) | PASS |
| Nodes | Text defaults (12px / 400 / left, named by its text); pixel snapping on and off; frames on whole pixels; minimum 1px | As documented | PASS |
| Nodes | nextName per container (frame, page, missing parent, active page) | Numbering per container | PASS |
| Normalise | Legacy fill, fillOpacity, fillVisible, image and stroke → paint lists; idempotent; migrateTracks | Converted and idempotent | PASS |
| Effects | effectsOf legacy rows; defaultEffect for 9 kinds; glass thins the first fill | As documented | PASS |
| Paste | Loose layer pasted in place as "Rectangle 2"; layer copied from a frame goes back into it | Same position | PASS |
| Paste | Top-level frame pastes at w+40 with its contents; duplicating a frame keeps its contents | Children move with the copy | FAIL→fixed 7712fbe |
| Paste | Into a selected frame away from the origin | Inside the target, relative position kept, centred on axes that can't be kept | FAIL→fixed 7712fbe |
| Paste | Multi-frame paste, off-screen paste and paste here | One undo step each; off-screen moves to the view centre | FAIL→fixed 7712fbe |
| Paste | Zoom out for big pastes; paste here beside an auto layout frame; paste over selection; paste to replace | As documented | PASS (paste to replace fixed in 7712fbe) |
| Paste | Plain text centred in the selected frame or the view; blank text ignored | As documented | FAIL→fixed 7712fbe |
| Auto layout | Horizontal start/centre/end; space between/around/evenly; counter alignment; vertical; loneCenter | Exact positions | PASS |
| Auto layout | Hug on both or one axis; fill sharing; cross-axis fill; min/max; fill inside hug; empty hug | As documented | PASS |
| Auto layout | Hidden and absolute children skipped; rotated child takes its turned box; strokes included; nested children translated | As documented | PASS |
| Auto layout | Wrap with and without counterGap; alignContent between; hug never wraps; nested hug and fill stacks | As documented | PASS |
| Grid | Equal cells, hug cells, fill children, chosen cells and spans, clamping, manual positions, fixed/fill/hug tracks, spanning, alignment | As documented | PASS |
| Constraints | left/right/left-right/center/scale and combinations; left-edge move; clamp to ≥1; ignoreConstraints; components; nested frames; groups; auto layout ignores them; undo | As documented | PASS |
| Booleans | Union/subtract/intersect/exclude: bounds, area, containment; disjoint, identical, hole, circles, empty | Exact areas | PASS |
| Booleans | Boolean box equals result extent; hidden children; op change; rotated child | As documented | PASS |
| Booleans | 40 random rectangle pairs | union = A+B−I, exclude = A+B−2I, subtract = A−I | PASS |
| Flatten | Two shapes become one vector; single rect; invalid inputs; layers inside a frame | As documented | PASS |
| Flatten | Rotated shape | Exact box, not pixel-snapped | FAIL→fixed b7eedfc |
| Vector network | One region, open path, split square, three regions from two squares, hole, paint toggles, remembered points, degenerate input | As documented | PASS |
| Offset | Miter/round/bevel grow and shrink by the distance; miter limit; open line; degenerate input | Bounds ± distance | PASS |
| Offset | Offset copy of an ellipse | Exact box | FAIL→fixed b7eedfc |
| Simplify | Open path within tolerance with endpoints kept; closed curve reduced; square corners kept; tolerance ≤ 0; tiny paths | As documented | FAIL→fixed 2780a13 |
| Text layout | Auto width, wrapping, overlong words, CJK, soft breaks, line height, paragraph spacing, empty text, trailing newline, letter spacing | Fixed-width fallback values | PASS |
| Text layout | Left/centre/right/justify, RTL, vertical offset, truncation, list markers (1. a. i.), counters, list spacing | As documented | PASS |
| Text layout | caretAt/indexAt round trip, upstream at a wrap, range rects, letter case, 60 random texts | Round trip | PASS |
| SVG export | Rect with radius (clamped), ellipse, linear gradient, image pattern, hidden or zero-opacity paints, text | Well-formed XML (DOMParser), key attributes | PASS |
| SVG export | Centre/inside/outside strokes, dashes, clipped frame, hidden layer omitted, group opacity, effects filter, rotation, selection and region export, animated SVG | As documented | PASS |
| SVG export | Hostile names and text (`"><script>`) | Escaped | PASS |
| SVG export | Hostile colours, gradient stops, image data, blend mode, join/cap, shadow colour, decoration colour | Stay inside their attribute | FAIL→fixed a406fd2 |
| Serialization | Rich doc (11 node types, styles, variables, prototype, sequence, keyframes) through `prepareDocument(JSON round trip)` | Deep-equal | PASS |
| Serialization | Second round trip; normalizeNode idempotent; legacy loose layers get a page; empty or broken input | As documented | PASS |

### Systems (expressions, variables, prototype runtime, motion, components)

| Area | Case | Expected | Result |
|---|---|---|---|
| Expressions | Tokenize table (17 rows): numbers, variables, straight and curly quotes, hex, keywords in any case, `VAR_MODE_LOOKUP`, unclosed variable or text, `@`, `.` | Right tokens, or a throw | PASS |
| Expressions | Single `=` reads as `==`; `\"` and `\\` escapes | As expected | PASS |
| Expressions | Precedence, left associativity, `%`, unary minus (`-2*3`, `2--3`, `--2`), parentheses | Correct numbers | PASS |
| Expressions | Division and modulo by zero | 0 | PASS |
| Expressions | String joining (`"a"+1+2` = "a12", `1+2+"a"` = "3a"), float noise trimmed | As expected | PASS |
| Expressions | Comparisons across kinds; case-insensitive text equality; booleans against text | As expected | PASS |
| Expressions | and/or/not precedence and short-circuit (a missing variable on the unused side is never read) | As expected | PASS |
| Expressions | `VAR_MODE_LOOKUP` by collection name or id; unknown collection | Mode name / undefined | PASS |
| Expressions | Unknown references; malformed input (`1 +`, `(1`, `1 2`, `1<2<3`, `()`, empty) | undefined, no throw | PASS |
| Expressions | `test()` truthiness table; `problem()` text for 12 malformed inputs | Exact messages, never throws | PASS |
| Expressions | Parse tree shape; references; describe; literal | As expected | PASS |
| Expressions | `literal(v)` reads back as `v` (newline, tab, control character, 1e-7, 2.5e21, quotes, unicode) | Same value | FAIL→fixed 4c315e3 |
| Variables | Resolve literal/number/string/boolean/alias/missing; chosen and stale default mode | As expected | PASS |
| Variables | Alias in the target's mode with opacity multiplied; 3-step alias chain | As expected | PASS |
| Variables | Self alias, 2- and 3-cycles, alias to a missing variable | null in under 500 ms; bound layer unchanged | PASS |
| Variables | Runtime value override; mode with no value | Override wins / null | PASS |
| Variables | Frame modes: descendants follow, nearest ancestor wins, stale id skipped, forced mode wins | As expected | PASS |
| Variables | setFrameMode re-resolves bound fills; clearing it; undo/redo exact | As expected | PASS |
| Variables | Extended collections: inherited order, mode by position, per-mode override, layer reads through the extension | As expected | PASS |
| Variables | Extension cycles (A↔B, extends itself) | No hang | PASS |
| Variables | extendCollection, setOverride, delete parent (extension detached, layers unbound, look kept); undo each | As expected | PASS |
| Variables | fieldInfo table (34 keys); allowedFor for colour/number/boolean/string scopes | As expected | PASS |
| Variables | `fill:<i>:opacity` and `stroke:<i>:opacity` are colour-opacity scope and bindable | Scope color-opacity | FAIL→fixed 7ca0fc1 |
| Variables | resolveVariables writes 21 kinds of bound field; wrong type or unknown field ignored | Values on layers | PASS |
| Variables | No variables returns the same object; second pass stable | As expected | PASS |
| Variables | parseFontStyle table (11 rows) | As expected | PASS |
| Variables | resolveTransition: easing, duration, spring, bezier, forced mode, negative duration clamped, wrong type | As expected | PASS |
| Variables | conditionHolds table (12 rows) plus runtime values | As expected | PASS |
| Variables | Create collection; add/duplicate/move/rename/default/remove mode; last mode kept; undo each | As expected | PASS |
| Variables | Mode actions that change nothing | No undo step | FAIL→fixed 471bcca |
| Variables | Add a variable of each of 6 types; duplicate, rename, update, set value; undo each | As expected | PASS |
| Variables | bindVariable: values on layers, follows changes, unbinding keeps the look, unknown layers skipped | As expected | PASS |
| Variables | deleteVariable: layers unbound with look kept; same- and cross-collection aliases fall back; undo | As expected | PASS |
| Variables | deleteCollection unbinds all; previewValue shows aliases | As expected | PASS |
| Runtime | initialState; navigate (history, effect, transition), section target, missing target, default transition | As expected | PASS |
| Runtime | Back step by step, with nothing to go back to, closing a lone overlay, restoring overlays | As expected | PASS |
| Runtime | Reset scroll on arrival and `resetScroll: false` | As expected | PASS |
| Runtime | Overlay open with given or default settings, stacking, close top, close with none, swap, swap with none | As expected | PASS |
| Runtime | Set variable (11 rows of coercion); no-ops for missing id, missing or broken expression | As expected | PASS |
| Runtime | Conditionals: later actions see earlier sets, first match only, else, no match, nested | As expected | PASS |
| Runtime | Set mode with `VAR_MODE_LOOKUP` by name or id | As expected | PASS |
| Runtime | Older only-if condition and older multi-line set-variable | Runs; value kept | PASS (needs 4c315e3) |
| Runtime | Change to: target inside the instance, toggling back, no source or match | As expected | PASS |
| Runtime | displayDoc: variant drawn, file untouched, resetState, same doc when idle, runtime values and modes, bad variants ignored | As expected | PASS |
| Runtime | Scroll to: vertical with offset, clamped, never negative; horizontal; missing target | As expected | PASS |
| Runtime | Links (https added), empty link; video play/mute/jump/seek/toggle; playhead clamp, pause/toggle; animations start on arrival | As expected | PASS |
| Runtime | revertTo: navigation reversed, overlays closed top first, variants restored, variables kept, nothing to revert | As expected | PASS |
| Motion | trackValue table (17 rows): empty, before first, after last, linear, hold, three keys, colour lerp, lower-case hex, position pair, mixed kinds | As expected | PASS |
| Motion | Ease-in below and ease-out above linear; ease-in-out symmetric; custom bezier per key | As expected | PASS |
| Motion | bezierAt endpoints, clamping, monotonic for 7 valid curves, agrees with cubicBezier; back curves overshoot | As expected | PASS |
| Motion | Springs (4 presets, critical, overdamped, initial velocity, zero clamp) start at 0 and settle near 1 | As expected | PASS |
| Motion | easeTransition 0→0 and 1→1 for 6 curves; transitionDuration | As expected | PASS |
| Motion | setKeyframe adds a resting key at 0, stays sorted, replaces within 1 ms; setKeyEasing; removeKeyframe | As expected | PASS |
| Motion | moveKeyframe move and replace-on-land | As expected | PASS |
| Motion | moveKeyframe from a time with no key | Nothing changes | FAIL→fixed d9d4dc7 |
| Motion | retimeKeys across layers with clamp and replace; removeKeys; setDuration; durationOf | As expected | PASS |
| Motion | Undo/redo exact for 11 keyframe commands through the editor | As expected | PASS |
| Motion | 8 presets key t and t+ms and end at the layer's values | As expected | PASS |
| Motion | Merge x/y into position and split; keying x keys position; scale merge and split | As expected | PASS |
| Motion | animatedNode (opacity, fill, stroke, stroke weight, effect, missing index, corner); animatedDoc | As expected | PASS |
| Motion | migrateTracks: 22 older names map to new names | As expected | PASS |
| Motion | migrateTracks: legacy shadow and blur folded into effects with matching indices; no-legacy indices; missing effect dropped; new name wins; current docs unchanged; idempotent; via normalizeNode | As expected | PASS |
| Components | Mirror ids and fields; nested mirrors carry outer overrides; main edits, added and deleted layers propagate | As expected | PASS |
| Components | Override recording and survival; instanceOverrides; position and type not overridable; size, fill and opacity overrides | As expected | PASS |
| Components | resetOverrideKeys, resetAllOverrides, resetOverrides, push to main, nested overrides; undo each | As expected | PASS |
| Components | Frame → component in place; non-frame convert is a no-op; no component from inside an instance; createInstance with undo | As expected | PASS |
| Components | Create component from a shape | One undo step | FAIL→fixed c39026c |
| Components | Boolean/text/swap properties, propValue, updateProp, resetPropValue, deleteProp keeps the look, default from a variable | As expected | PASS |
| Components | variantProps table (9 rows) and variantName round trip | As expected | PASS |
| Components | setProperties, assetName, findVariant (5 rows and missing set), variantConflicts | As expected | PASS |
| Components | setVariant keeps compatible overrides; combineAsVariants; add/rename/remove variant property; lone component wrapped; undo each | As expected | PASS |
| Components | Detach: look kept, links removed, detachedInfo, no longer follows main | As expected | PASS |
| Components | Detach with a nested instance | It stays an instance and keeps its look | FAIL→fixed 824f31a |
| Components | Detach with a swapped nested instance; component → frame | As expected | PASS |
| Components | wouldNestItself with direct ancestors; swap refused | true / no change | PASS |
| Components | wouldNestItself through instances (one and two levels) | true | FAIL→fixed d35cfa6 |
| Components | Delete the main component: instances kept and editable, "Missing component", undo re-links | As expected | PASS |

### Products and import (fig, pptx, PDF fonts, campaign, sites, slides, board, round trips)

| Area | Case | Expected | Result |
|---|---|---|---|
| Fig (Untitled.deck) | Container, magic, figKind, node type counts from the raw message | "deck"; 1 DOCUMENT, 2 CANVAS, 1 SLIDE_GRID, 1 SLIDE_ROW, 1 SLIDE | PASS |
| Fig (Untitled.deck) | productDocument | Kind slides; page "Slides"; 1 section "Section"; "Slide 1" at 1920×1080 with clip; 16 children in order with their names; empty notes; theme from the first slide; internal canvas last and hidden | PASS |
| Fig (Untitled.deck) | Every `ids` entry points at a node; tree consistent; no NaN; images resolve | Holds | FAIL→fixed 75fbbab |
| Fig (Untitled.deck) | JSON → prepareDocument | Identical and idempotent | PASS |
| Fig (Untitled.buzz) | Images, rows, template data | 4 zip images, 1 row, 1 asset GOOGLE_MED_AD | PASS |
| Fig (Untitled.buzz) | productDocument | Kind campaign; page "Assets"; medium rectangle at 0,0 300×250; 11 layers with their types and names; 3 texts equal to the raw characters | PASS |
| Fig (Untitled.buzz) | Image bytes | Logo and Image decode to exactly the zip's bytes; 2 images in the document | PASS |
| Fig (Untitled.buzz) | Tree, NaN, images, round trip | Holds | PASS |
| Fig (synthetic) | Two rows, 3 slides, notes with paragraphs and breaks, invalid notes JSON | Sections, names, notes, title text and weight | PASS |
| Fig (synthetic) | Campaign size types: known → preset; unknown → by size; else custom; spaced by ASSET_GAP | As expected | PASS |
| Fig (synthetic) | No slide grid; empty message | Design document with one page | PASS |
| Fig | figKind table; well-formed kiwi container; zlib chunks | Decodes | PASS |
| Fig | 12 bad inputs (empty, random, zip header, header only, no chunks, one chunk, length past the end, garbage chunks, truncated deflate, 0xFFFFFFFF length, garbage message, garbage schema) | Clean Error in under 2 s | PASS |
| Fig | importFig with a zip without canvas.fig or a non-fig file; isFigFile extensions | Clear errors; right true/false | PASS |
| Fig | parsePathCommands: closed and open, lowercase, dropped closing point, multiple subpaths, lone move, stray numbers, cubic and quadratic | Correct subpaths | PASS |
| Fig | Truncated commands ("M0 0 L10", "C1 2 3 4 5", "Q1 1") | No NaN points | FAIL→fixed 6982c9e |
| Fig | parseBinaryPath: move/line/close, cubic and quadratic, odd offset, truncated input, unknown opcode, empty | Correct or empty, never throws | PASS |
| pptx | Deck built in the test with fflate (2 slides in reversed file order) | Presentation order; title text, alignment, colour, 44pt → 88px; body runs; background; notes; shapes; picture bytes and box; chart frame skipped | PASS |
| pptx | 4:3 width; unreadable pictures; empty text boxes; 12 slides | Scaled; left out; no empty layers; order kept without overlap | PASS |
| pptx | Not a zip; no presentation.xml; no slides | Rejects with an Error; no file made | PASS |
| PDF | parseFontName for 13 font names | Family, weight, italic | FAIL→fixed e69d8ce |
| Campaign | parseDelimited (11 cases); parseXlsx (shared and inline strings, booleans, gaps, sheet through rels) | Correct tables | PASS |
| Campaign | guessMapping, previewRows | Correct | PASS |
| Campaign | fillSeries (12 cases), parseTsv (5) | Correct series | FAIL→fixed f7f9d66 |
| Campaign | fieldValuePatch and fieldValue for text, colour (case-insensitive no-op, invalid), image | Correct, including no-ops | PASS |
| Campaign | runBulk creates 3 from a template (mapped images, bad colour, missing image) | Names, indexes, sourceId, values, grid, template untouched, failedImages | PASS |
| Campaign | runBulk followed by one undo | Removes the new row and assets | FAIL→fixed 17fd322 (now via 2b01ee4) |
| Campaign | runBulk run again | Updates 1, removes 1, adds 1; each undoable | PASS |
| Campaign | runBulk with a failed URL fetch, empty sheet, missing template | Clean failure; empty row; "The template is gone." | PASS |
| Campaign | resizedCopy (square → story, → leaderboard, minimum font, same size, empty); resizeInPlace with one undo | Type and corners scale; margins kept | PASS |
| Campaign | Duplicate assets (mixed selection), undo and redo | Copies and selection removed and restored | FAIL→fixed 17fd322 (now via 2b01ee4) |
| Campaign | Empty or non-asset selection; delete with undo; reorder; move to row; move row; delete row; orphaned rowId; round trip | Correct; no stray undo steps | PASS |
| Sites | Default breakpoints and ranges; desktop add copies to tablet and mobile in stack order | Copies in place | PASS |
| Sites | Desktop edits flow down; tablet override kept and reaches mobile; mobile override stays | As specified | PASS |
| Sites | Undo and redo across copies; delete a copy on one breakpoint; delete on desktop removes all; mobile-only layers | As specified | PASS |
| Sites | Nested copies; reorder and reparent follow | As specified | PASS |
| Sites | breakpointProblem; add/update/delete breakpoint | Validation and ranges | FAIL→fixed 565546e |
| Sites | HTML export of two pages | Balanced tags; escaped text; h1; safe links (scheme added, `javascript:` → `#`, `target=_blank`); page link `./about/`; img with path, alt and size; asset blob | PASS |
| Sites | Media queries | Tablet and mobile ranges with only the differences; braces balance | PASS |
| Sites | Preview mode; no home page; safeUrl (13 cases); escaped title and description | As expected | PASS |
| Slides | New deck grid; group in deck order; ungroup; undo twice | Correct rows and order | PASS |
| Slides | Grouping fewer than two; nudge at the ends; drop (indented too); moveSlide; move to a new group | Correct; no-ops make no step | PASS |
| Slides | Duplicate; delete keeps one slide; undo | Correct | PASS |
| Slides | Skip and toggleSkipSlides; numbering skips skipped slides; footers with opt-out; notes (one step, unchanged notes make no step, round trip, undo); add slide after current | Correct | PASS |
| Slides tables | Paste becomes a table; add and remove rows and columns, tiling, undo; at least one row and column; move and resize tracks | Correct | PASS |
| Slides tables | Insert a table, one undo; merge cells, one undo | Removed or unmerged in one undo | FAIL→fixed 6929a17 (now via 2b01ee4) |
| Slides tables | Merge a rectangle (texts joined), refuse a non-rectangle, delete a row through a merge, split | Correct | PASS |
| Board tables | Cell text with undo; insert, delete, move and duplicate tracks; merges; stepCell; expand; hasMerge; fill, style, clear | Correct | PASS |
| Board connectors | Geometry helpers; ends on facing sides; moving a shape re-routes in the same step (elbow stays axis-aligned); deleted end goes loose and reattaches on undo; straight and curved; hidden end | Correct | PASS |
| Board | Sticky grows with its text in the same step and shrinks back; hiding a section remembers what showed; lock background; round trip | Correct | PASS |
| Board voting | Limit per person; clicking again takes a vote back; not an undo step; tally; done and rejoin; end; clear; timed close; pages, empty canvas and right button take no votes | Correct | PASS |
| Board voting | Vote on an object later deleted | Doesn't use up a vote | FAIL→fixed f223cd2 |
| Round trip | Design, video, slides, board, campaign, site and make documents; invalid input; legacy loose layers | Identical after JSON → prepareDocument and idempotent; non-documents → null | PASS |

### Server (accounts, files, sockets, media, tokens, teams, search, sites, SAML, SSRF, robustness)

| Area | Case | Expected | Result |
|---|---|---|---|
| Auth | Sign up trims and lowercases; returns token and public user (no hash or salt) | 200 | PASS |
| Auth | Sign up with no or blank name, bad emails (no @, no dot, space, object), password under 8 | 400 | PASS |
| Auth | Duplicate email in any case | 409; first account intact | PASS |
| Auth | Sign in right, wrong, unknown; same error for wrong and unknown | 200 / 401 | PASS |
| Auth | 6 wrong passwords lock the account from any address; Retry-After 1–2 s; works after the wait | 429 with Retry-After | PASS |
| Auth | 11 failures from one address lock that address only | 429 there, 200 elsewhere | PASS |
| Auth | Sign out ends that session only; repeated or tokenless sign out harmless | 401 / 200 | PASS |
| Auth | Bearer `__proto__`, `constructor`, `toString`, 5 KB token | 401; empty file list | PASS |
| Auth | Session list (current flag, no tokens shown); DELETE ends the others only | As stated | PASS |
| Auth | Idle session ends after SESSION_IDLE_DAYS; a used one slides on | 401 / 200 | PASS |
| Auth | Password change needs the current password and ≥ 8 chars; signs out other sessions | 401 / 400 / 200 | FAIL→fixed 824c020 |
| Auth | Email change: password, validation, 409 taken, link in the dev mail file, verifies once, sign-in switches | As stated | PASS |
| Auth | Email confirm loses to an account that took the address meanwhile | 409 | PASS |
| Auth | Password reset: same answer for unknown accounts; link works once; ends other sessions | As stated | PASS |
| Auth | Account delete needs the password; sessions and owned files go | 401 / 200 / 404 | PASS |
| Auth | Chat webhook prefs: Slack and Teams https hosts only | 400 for others | PASS |
| Auth | Malformed JSON to auth routes | 400; server alive | PASS |
| Files | Create needs an account and a doc; bad project 403; bad JSON 400 | As stated | PASS |
| Files | Access, doc, list, rename and trash for owner, editor, viewer, stranger, guest | Role matrix | PASS |
| Files | Viewers and strangers can't change access or invite themselves | 403 | PASS |
| Files | Duplicate: viewer yes unless export is off; stranger 403; signed out 401 | As stated | PASS |
| Files | Link keys view/edit/wrong; link none/view/prototype/bogus | Role per setting | PASS |
| Files | Link password: key alone refused, wrong 401, pass works, backoff 429, new password ends old pass, removal reopens | As stated | PASS |
| Files | Expiry can't be in the past; expired link refused, unlock 410, owner fine, clearing reopens | As stated | PASS |
| Files | Access requests: ask, dedupe, owner notice, self-approve 403, approve gives view, deny keeps out | As stated | PASS |
| Files | Leave: invited yes; owner or stranger 400 | As stated | PASS |
| Files | Trash and restore; empty trash removes only files you edit | As stated | PASS |
| Files | Delete forever only for trashed files, by an editor | 400 / 403 / 200 | FAIL→fixed 6eecdb1 |
| Files | Move into a folder you can't edit | 403 | PASS |
| Traversal | Body file ids with `../`, `/tmp/x`, NUL, `__proto__` (inbox reply, community, team templates) | 4xx; outside file untouched and not listed | FAIL→fixed 1c2942b |
| Traversal | Route ids (`..%2F`, `%2e%2e`, too long, `secret.key`, libraries, media, v1) | ≥ 400, no leak | PASS |
| Traversal | Static app: 15 raw spellings (`..`, `%2e%2e`, `%2f`, `%5c`, double-encoded, `//`, NUL) | index / 403 / 404, no leak | PASS |
| Traversal | Published apps and sites: raw traversal reads and publish paths (`../`, absolute, `//`, `.site.json`) | 400 / 404 | PASS |
| WebSocket | Snapshots carry the role; keys only for editors; peers listed | As stated | PASS |
| WebSocket | 2 editors × 10 concurrent patches | Same order for both, own acks in order, stored file merged, null and removed applied | PASS |
| WebSocket | Presence and cursor relayed with the account's name; no echo; leave announced | As stated | PASS |
| WebSocket | Hello can't set the presence id or accountId | Server-assigned | FAIL→fixed 0dc9aed |
| WebSocket | Viewer patch rejected, not relayed or stored; viewer version.save and keys.reset ignored | As stated | PASS |
| WebSocket | Stranger, signed out, key on a private link, bad token | Denied + 4003 | PASS |
| WebSocket | Socket that never says hello receives nothing and can't send | Silent | FAIL→fixed 0dc9aed |
| WebSocket | Guest with a view link: view, no keys, can comment, can't edit | As stated | PASS |
| WebSocket | Live role change: upgraded can edit; removed denied + 4003 | As stated | PASS |
| WebSocket | Comment permissions and bad comment shapes | comment.denied | PASS |
| WebSocket | Odd messages (`null`, `42`, arrays, bad types), bad ids, missing file, socket create needs sign-in | No crash | FAIL→fixed c2d2138 |
| WebSocket | `__proto__` and `constructor` patches, non-array removed, bad roots and images | Rejected "invalid"; Object.prototype intact | FAIL→fixed c2d2138 |
| WebSocket | Reactions named `__proto__` or `constructor` | No crash | FAIL→fixed c2d2138 |
| WebSocket | Invalid-UTF-8 text frame | 1007 on that socket only | FAIL→fixed 4360421 |
| WebSocket | Hello sent while a large file is still loading | Gets the snapshot | FAIL→fixed 9b7bc51 |
| Media | Upload: signed out 401, viewer and stranger 403, bad file 403, editor 200, same id no-op | As stated | PASS |
| Media | Taking over an id stored for another file | 409; original kept | PASS |
| Media | Download matrix (owner, editor, viewer, view key, wrong key, no key, stranger, no file); link off removes guests | 200 / 401 / 403 | PASS |
| Media | Headers: nosniff, sandbox CSP (also for stored text/html) | Present | PASS |
| Media | Signed URL works signed out; tampered exp or sig, other id, empty, past exp refused | 200 / 401 | PASS |
| Media | Probe: signed out, unknown and forbidden ids answer identically | Identical 401 | PASS |
| Media | `?file=` you can open doesn't open media not used there; at most 4 files checked | 403 | PASS |
| Tokens | Shown once, hint only, need a session; a token can't make or list tokens | As stated | PASS |
| Tokens | /v1/me, files, file, nodes; header form; other people's files 403 | As stated | PASS |
| Tokens | Writes: /v1 POST/PUT/DELETE 405; 10 write routes refused; socket denied | Read-only | PASS |
| Tokens | Revoke: other user 404; own works at once; others unaffected; access loss applies | 401 after | PASS |
| Teams | Create, list, visibility; non-members 404 | As stated | PASS |
| Teams | Only admins rename, invite, change roles, remove, delete; viewers can't make folders; bad roles ignored | 403 | PASS |
| Teams | Folder files follow team roles; a removed member is closed live | Denied | PASS |
| Teams | Invite links: admin-only, never admin role, accept needs sign-in, doesn't lower an admin, revoked 404 | As stated | PASS |
| Teams | `/invites/toString`, `__proto__`, `constructor` | 404; no leak or junk | FAIL→fixed 4360421 |
| Teams | Leave rules; admin console views; 8 admin actions refused for members; last-admin rule | As stated | PASS |
| Teams | SAML settings and integrations admin-only; hook secret never returned; non-Slack hook 400 | As stated | PASS |
| Teams | Folder email invite reaches only that address | As stated | PASS |
| Admins | NAGMA_ADMINS: ownerless files view-only for others; claimable by the named admin only; new keys, old keys dead | As stated | PASS |
| Search | Own files by name, page and text with a snippet; signed out 401 | As stated | PASS |
| Search | Strangers get no files, text or people, even with the view link | Empty | PASS |
| Search | Invited user sees it without keys; removal hides it; trash excluded | As stated | PASS |
| Notifications | Mentions reach only people with access; reply needs access; read state per person; access loss removes them | As stated | PASS |
| Sites | Slug validation, reserved, taken (409), editors only | As stated | PASS |
| Sites | Password site: form, cookie, forged cookie, backoff 429, new password ends cookies | As stated | FAIL→fixed 359e303 |
| Sites | Team-only site: guest with a view key gets no ticket; forged or expired tickets refused | 401 / 403 | FAIL→fixed 3eca43a |
| Sites | Trashed site file goes dark | 404 | PASS |
| Community | No emails in entries or profiles; editors publish; publisher-only unpublish; copy view-only | As stated | FAIL→fixed 5c10126 |
| SSRF | /unfurl needs sign-in | 401 | PASS |
| SSRF | 44 private spellings (decimal, hex, octal, 127.1, `localhost.`, .local, .internal, RFC 1918, CGNAT, 169.254, IPv6 forms, ports, userinfo, non-http) on /unfurl and the SAML metadata URL | 400; nothing stored | FAIL→fixed 2314169 |
| SAML | Metadata with DOCTYPE or entities | 400 | PASS |
| SAML | Config validation (https, cert, domain, domain owned by another team) | 400 | PASS |
| SAML | /auth/sso routing; start redirects to the IdP; foreign, `//`, `/\`, `javascript:` and CRLF RelayState become `/` | As stated | PASS |
| SAML | ACS: no response 400; garbage, unsigned, wrong Destination 401; unknown team 404; team without SAML 400; over 1 MB 413; error page escaped | As stated | PASS |
| SAML | safeRelayPath table (18 inputs) | `/` or a same-origin path | PASS |
| SAML (signed, openssl IdP) | Valid assertion signs in and joins as viewer; foreign RelayState → `/` | 302 | PASS |
| SAML (signed) | Replayed response | 401 "already used" | PASS |
| SAML (signed) | Unknown InResponseTo; wrong recipient, audience, issuer or domain; unsigned; tampered; another team's ACS | 401 | PASS |
| Robustness | Malformed percent-encoding (`/%E0%A4%A`, `/apps/x/%`) | 4xx; alive | FAIL→fixed 425fc79 |
| Robustness | JSON `null`, `42`, `[]`, `"text"`, `true` on 23 JSON routes | 4xx; alive | FAIL→fixed 425fc79, 60b1cf2 |
| Robustness | Malformed JSON on 23 routes | < 500; alive | PASS |
| Robustness | App backend collections `__proto__`, `constructor`, `toString` | 400; alive | FAIL→fixed 6e46c78 |
| Robustness | Oversized bodies | Readable 400 / 413, no connection reset | FAIL→fixed 72babba |
| Robustness | `__proto__` keys in team, admin and account bodies | Other records unchanged | PASS |
| Robustness | Unsupported methods | 4xx | PASS |
| Libraries | Publish, read, list, delete by role; item keys with `../` stay inside | As stated | PASS |
| Branches | Editors create; viewers get no keys; merge needs main edit | As stated | PASS |
| Versions and reviews | Duplicate a version (editors only, bad id 404); asset reviews (reviewers decide); asset templates (team, takeover refused) | As stated | PASS |
| Other | team-settings, rtc/config, GitHub path validation, 501 without a token | As stated | PASS |
| AI | /ai/chat signed out | 401 before any model call | FAIL→fixed 0f69e3f |

## 2. Bug list

Every bug below is fixed. The test that covers each one is marked `// Regression:` in the file named.

### S1: crash, data loss or security

| Id | Repro | Root cause | Fix | Test |
|---|---|---|---|---|
| SRV-1 | `POST /auth/signup` with body `null`, or `GET /%E0%A4%A`, killed the server process | Fire-and-forget async http handler, so every route error was an unhandled rejection; `decodeURIComponent` throws in `serveStatic` and Make's `sendApp` | Route errors answer 500 and are logged; bad encodings answer 400 (`server.mjs`, `make.mjs`) — 425fc79 | robustness.test.mjs |
| SRV-3 | One socket message `null`, or a reaction named `__proto__`, crashed the server | No shape check; reactions read through the prototype | Messages must be objects; handler in try/catch; own-key reaction lookup — c2d2138 | ws-sync.test.mjs |
| SRV-4 | An editor's patch with `removed: {"__proto__": [...]}` deleted Object.prototype methods server-wide | `applyPatch` wrote any key | `validPatch` refuses it ("invalid"); `Object.hasOwn` — c2d2138 | ws-sync.test.mjs |
| SRV-5 | One invalid-UTF-8 WebSocket frame crashed the server | No `error` listener on sockets | Listener added; only that socket closes (1007) — 4360421 | ws-sync.test.mjs |
| SRV-6 | App backend collection `__proto__` or `constructor` crashed the server | Collections read through Object.prototype | Refused with 400 (`make.mjs`) — 6e46c78 | robustness.test.mjs |
| SRV-7 | A socket that never sent hello received every patch, cursor and comment of a file it couldn't open | Sockets joined the room on connect | Broadcasts, peers and presence need a role — 0dc9aed | ws-sync.test.mjs |
| SRV-8 | File ids with `../` in request bodies (inbox reply, community, team templates) read and wrote JSON outside the data folder, then leaked into the list and search | `loadRoom` didn't validate ids | `loadRoom` validates — 1c2942b | files-access.test.mjs |
| SRV-9 | `/unfurl` and the SAML metadata URL reached loopback or 169.254.169.254 through `[::ffff:127.0.0.1]`, NAT64, 6to4, Teredo, fe80::/10 and similar | The IPv6 guard missed embedded IPv4 forms | `privateAddress` reads all 8 words and checks embedded IPv4 — 2314169 | saml-ssrf.test.mjs |
| CORE-1 | Undo, redo or a collaborator's patch threw TypeError when its layer had been deleted meanwhile | `applyPatch` merged a fragment into `{}`; `repairTree` crashed on it | Changes to missing layers dropped; only whole layers created (`patch.ts`) — c06c32c | store.test.ts, commands.test.ts fuzz |
| CORE-2 | A fill colour such as `#fff" onload="…` broke out of its SVG attribute; site export inlines that SVG, so an editor could inject script into a published site | Document strings written into attributes unescaped | Every attribute value escaped (`export-svg.ts`, `text-svg.ts`) — a406fd2 | export-svg.test.ts |
| SYS-6 | An instance of a component that already contains the target component could be placed inside it; the file then grew by about 24 layers on every edit | `wouldNestItself` only checked direct ancestors | Follows instances transitively (`components.ts`) — d35cfa6 | components.test.ts |
| LEAD-4 | Same cycle as SYS-6 through other routes: dragging a frame that holds an instance onto the canvas (only a dragged instance was checked), the layers panel (no check), and adding to a slot (no check) | Guard missing on those routes | `moveWouldNestItself` used on the canvas and in layer-drag; addToSlot checks — 5d77ac2 | components.test.ts |

### S2: broken feature

| Id | Repro | Root cause | Fix | Test |
|---|---|---|---|---|
| LEAD-1 | Any action that edits and then selects its result (duplicate, insert table, merge cells, bulk create, add asset and others) took two undos; the first only changed the selection | The store records a selection change as its own step; products folded it in one by one, and some never did | `store.ts`: a selection set in the same task as an edit joins that edit's step; the folds in campaign `executeArranged` and slides `insertTable`/`mergeCells` removed — 2b01ee4 | store.test.ts, plus the campaign and slides tests (they fail without it) |
| SRV-10 | `/invites/toString`, `__proto__` and similar matched every team with invite links: anyone saw names and sizes, and accept added junk members | Prototype lookup | Own-key lookup — 4360421 | tokens-teams.test.mjs |
| SRV-16 | `/ai/chat` used the server's model key with no sign-in, bypassing credits | No auth check before the model call | Sign-in first — 0f69e3f | more-routes.test.mjs |
| SRV-17 | An invited editor could permanently delete a live file in one call | Delete forever didn't require the trash | Must be in the trash — 6eecdb1 | files-access.test.mjs |
| SRV-18 | A hello sent while a large file loaded was dropped and the client hung | Message listener attached after `await loadRoom` | Listeners first; messages wait for the room — 9b7bc51 | ws-sync.test.mjs |
| CORE-3 | Pasting or duplicating a top-level frame left its children behind; paste into a frame away from the origin, plain text into a frame, and paste to replace were also wrong | Regression from 16d5da3: only the root was shifted; page and frame coordinates mixed | `actions.ts` — 7712fbe | paste.test.ts |
| CORE-5 | Simplify path did nothing on closed shapes; smoothed segments strayed about 4 px | The first point of a ring is also its last, so every distance measured 0 | `path-ops.ts` — 2780a13 | geometry.test.ts |
| CORE-7 | An instance stretched by auto layout kept its contents at the component's size | Layout didn't resize instance children by constraints | `layout.ts` — 0c91615 | commands.test.ts |
| CORE-8 | A stack inside a group inside a stack, and instances of a component that layout resized, didn't settle in one edit, so redo and collaborators diverged | Single-pass settle | `settle` repeats the passes until stable (max 4) — f7efa78 | commands.test.ts |
| SYS-7 | Detaching an instance lost the outer component's overrides on its nested instances (label showed "Label" instead of "Buy") | `convertNode` dropped the nested overrides | `inheritedOverrides` kept along the source chain — 824f31a | components.test.ts |
| PROD-5 | Campaign duplicate, bulk create, add asset and template insert needed two undos | Edit then selection step | Folded — 17fd322 (now covered by LEAD-1) | campaign.test.ts |
| PROD-7 | Slides insert table and merge cells needed two undos | Same cause | 6929a17 (now covered by LEAD-1) | slides.test.ts |

### S3: wrong behaviour

| Id | Repro | Root cause | Fix | Test |
|---|---|---|---|---|
| LEAD-2 | Mask several layers, or add a repeat to them, then undo once: the wrapping group stayed | `mergeLast` folded the edit into the group's selection step | Fixed by LEAD-1 — 2b01ee4 | store.test.ts |
| LEAD-3 | A real whiteboard (.jam) container was refused as "unknown header" | The 7-character whiteboard header name is padded to the 8-byte header, but all 8 bytes were compared | Padding (`.`, NUL, space) trimmed before lookup — 5461dbb | fig-import.test.ts |
| LEAD-5 | Resize an instance so its nested instance stretches by constraints, then detach: the nested instance snapped back to its component's size | The stretched size wasn't an override | Detach records w/h overrides when they differ from the component (`commands.ts`) — f1eb8b1 | components.test.ts |
| LEAD-6 | Deleting a variable used the target's default mode for aliases from other collections; extended collections kept dangling override aliases; deleting a group or collection left every alias to it dangling (resolving to nothing) | Mode mapped by the aliasing collection's id; overrides, groups and collections not handled | `removeVariablesCommand`: mode matched by collection, extension position, name, then position; overrides rewritten or dropped; used by variable, group and collection delete — 535b5d1 | variables.test.ts |
| SRV-2 | `null`, numbers or arrays read as objects on 33 JSON routes (500 after SRV-1) | No shape check | `json-body.mjs` `parseObject`, 400 — 60b1cf2 | robustness.test.mjs |
| SRV-11 | A client's hello could take another peer's presence id or accountId, which also redirects audio signals | `user` spread into presence | Only name and colour taken — 0dc9aed | ws-sync.test.mjs |
| SRV-12 | Changing the password left other sessions signed in | Missing step (a reset already did it) | Other sessions ended — 824c020 | auth.test.mjs |
| SRV-13 | Wrong passwords for a protected site had no rate limit | No backoff | Same backoff as sign-in, 429 + Retry-After — 359e303 | search-sites.test.mjs |
| SRV-14 | A signed-out guest with a view link got a ticket into a team-only site | Missing sign-in check | Sign-in required — 3eca43a | search-sites.test.mjs |
| SRV-15 | Community pages exposed publishers' email addresses | Full user record sent | Name only — 5c10126 | search-sites.test.mjs |
| SRV-19 | Oversized bodies reset the connection, so routes' 413 messages never arrived | `readBody` destroyed the request | Drain and drop; far-over bodies still cut — 72babba | robustness.test.mjs |
| CORE-4 | Paste here, off-screen paste and multi-frame paste took 2–3 undo steps | Intermediate steps | Folded since the paste started — 7712fbe | paste.test.ts |
| SYS-1 | A set-variable value with a line break, tab or exponent (1e-7) didn't read back | Tokenizer lacked JSON escapes and exponents | `expressions.ts` — 4c315e3 | expressions.test.ts |
| SYS-2 | A colour variable scoped to opacity couldn't bind a paint's opacity | `fieldInfo` matched the paint before `:opacity` | `variables.ts` — 7ca0fc1 | variables.test.ts |
| SYS-5 | Create component from shapes took three undo steps | Separate frame, select and convert steps | Merged since a mark (`actions.ts`) — c39026c | components.test.ts |
| PROD-1 | Truncated fig path commands gave NaN points | `num()` read past the end | Incomplete commands dropped — 6982c9e | fig-import.test.ts |
| PROD-2 | Fig import `ids` pointed at layers that no longer exist | `linkInstances` renamed layers without updating the map | Map remapped — 75fbbab | fig-import.test.ts |
| PROD-3 | PDF fonts named TimesNewRomanPS-* came out as family "Times New" | "Roman" stripped as a style word | `pdf-import.ts` — e69d8ce | pptx-import.test.ts |
| PROD-6 | Desktop breakpoint's start could be set below Tablet's | Compared against the second-widest breakpoint | `site/model.ts` — 565546e | site.test.ts |
| PROD-8 | A vote on a deleted board object used up a vote for the rest of the session | Votes on missing objects counted | `voting.ts` — f223cd2 | board.test.ts |

### S4: cosmetic or minor

| Id | Repro | Fix | Test |
|---|---|---|---|
| CORE-6 | Flatten and Offset path snapped the box to whole pixels while the path kept its exact size, so the geometry stretched slightly | Exact box — b7eedfc | geometry.test.ts |
| SYS-3 | Mode actions that changed nothing still added an empty undo step | No step when unchanged — 471bcca | variables.test.ts |
| SYS-4 | `moveKeyframe` from a time with no key deleted the key at the destination | No-op — d9d4dc7 | animation.test.ts |
| PROD-4 | The bulk-edit fill handle zero-padded when counting down ("10", "9" → "08") | Pad only with leading zeros — f7f9d66 | campaign.test.ts |

## 3. Known issues not fixed

| Issue | Reason |
|---|---|
| A size an auto layout or frame gives an instance isn't stored as an override, so rebuilding from the component resets it | Changes the component model: needs a product decision on when layout sizes become overrides. Detach is handled (LEAD-5). |
| Constraint clamping is path-dependent when a frame is squashed below its children's margins | Degenerate case (children clamped to 1 px); noted only. |
| Undo of `image.set` is an empty step | By design, images are never removed by undo. |
| Prototype delays (`Interaction.delay`) aren't unit-tested | Timed by the player UI, not by the runtime functions. |
| `combineAsVariants` names plain components "Property 1=<name>" | Matches the code's documented intent. |
| Colour aliases with opacity < 1 become plain colours (opacity dropped) when their target is deleted | A literal colour can't carry the alias opacity without changing how paints store alpha. |
| Media ids referenced in a doc you edit are readable, even after you lose access to the source file | "Used in the file" design with 71-bit random ids; changing it breaks library media. |
| Signed-in users can tell whether a media id exists (404 vs 403) | By design per the code; signed-out callers can't. |
| Any viewer can approve a branch review | No oracle for who may decide; a one-line check in `decideReview` would restrict it. |
| SSRF re-check on redirects is untested | `publicUrl` only allows ports 80 and 443, so a local test server needs root. The code re-checks every hop. |
| Sign-up has no rate limit; failure counts are shared across sign-in, password checks and link unlocks | Design choices; noted. |
| A site file published at a hidden path (`a/.hidden.html`) is accepted but never served | Harmless. |
| `.jam` files aren't offered by `isFigFile` and whiteboard import makes a design document | Header recognition is fixed (LEAD-3); a whiteboard product mapping is new work. |
| pptx group shapes (`p:grpSp`) ignore the group transform; PDF page drawing isn't covered | pdf.js needs a canvas; no grouped pptx sample to confirm the impact. |
| A slide with an empty name imports as "FRAME" | Seen only in synthetic input; S4. |
| No real canvas in jsdom | Real font measuring and canvas `pathContains` aren't exercised; geometry is checked on sampled outlines. |
| `node --test apps/server/test/` on Node 24 needs the `test/package.json` → `all.mjs` entry | Node 24 doesn't accept a folder for `--test`. |
