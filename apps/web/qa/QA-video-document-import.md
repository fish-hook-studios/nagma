# QA: video, document and import

Area: Video editor (`components/video*`, `engine/video/*`), Document (PDF workbench, `document/*`), and the import pipeline (`engine/images.ts` `IMPORT_ACCEPT`, the importers it routes to, and the desktop open-file path in `apps/desktop/main.cjs`). Branch `feature/qa-media`.

## How it was tested

- One Vite dev server (port 5234) and one scratch sync server (port 48814), driven in one browser tab at 1024×768 (and in light and dark themes).
- Every test file was generated in the page, never downloaded: PNG/JPEG/WebP from canvas, a hand-built animated GIF, SVGs (including a malicious one with scripts, event handlers, `foreignObject`, `javascript:` links, an XXE entity, `@import` and external `href`s), PDFs from jsPDF (multi-page, images, AcroForm text field and checkbox, landscape pages, 200 pages, a 5.7 MB image page), minimal PSD and PSB files, .sketch zips (artboard, group, rect, oval, text, bitmap, path), .pptx from the app's own exporter, WebM clips from canvas + MediaRecorder with a WebAudio tone, WAV from samples, MP4s from the app's own exporter, and 200 MB synthetic files with valid headers. Untitled.deck, Untitled.buzz and two .fig files were copied from ~/Downloads first.
- Input was real where the pane allows it: clicks, drags, key presses, the Import… menu (its file picker fed through a patched `input.click`), and HTML5 drag-and-drop dispatched with one `DataTransfer` (the pane's mouse drags don't fire drag events). Results were checked by state and by decoding outputs in the page: PDFs reopened in the engine and every Flate stream inflated (redaction), MP4/WebM decoded by the app's video engine and a `<video>` (duration, size, codec, frame contents by the position of the clip's moving square, audio RMS), GIFs with `ImageDecoder` (frames, durations, loop count), Lottie/dotLottie/SVG parsed. Downloads were captured in the page; nothing was saved to disk.
- Regression tests: 30 new tests in the web suite (1393 → 1423), 4 new desktop tests (`node --test apps/desktop/test/`, new), server suite unchanged (131). Test helpers added: `src/test/memory-doc-store.ts` (in-memory autosave store) and `src/test/pdf-engine-node.ts` (the PDF and photo engines loaded from disk, media in memory), so Document and PSD behaviour runs in Vitest against the real WebAssembly engines.

## Results

- Matrix: 256 cases, 197 pass, 56 failed before a fix (all fixed), 3 not applicable.
- Bugs: 41 found and fixed: S1 5, S2 5, S3 21, S4 10. 26 commits.
- Worst: lost edits on switching files or closing the tab (autosave and the Document's PDF save), a damaged .fig crashing the tab, video exports of browser-decoded clips coming out as one frozen frame, Sketch imports with every nested layer misplaced, and VP8 WebM failing to import into design files.

## 1. Test matrix

| Area | Steps | Expected | Actual | Result | Fix |
|---|---|---|---|---|---|
| Import | Home More > Import… opens picker with IMPORT_ACCEPT, multiple | picker accepts all listed types | as expected | PASS | |
| Import | zero-byte .png via Import… | clean error, no file left | made and opened empty design file "empty" | FAIL | 09f2422 |
| Import | .txt via Import… | clean error, no file | empty design file left open | FAIL | 09f2422 |
| Import | text renamed .png | clean error, no file | empty file left | FAIL | 09f2422 |
| Import | zero-byte .pdf | "Couldn't open … not a readable PDF", stays on Home | as expected | PASS | |
| Import | text renamed .pdf | clean error, Home | as expected | PASS | |
| Import | zero-byte .fig | clean error | "Not a .fig, .deck or .buzz file (unknown header)" | PASS | |
| Import | zero-byte .pptx | clean error | "invalid zip data" (terse but clean) | PASS | |
| Import | zero-byte .sketch | clean error | "invalid zip data" | PASS | |
| Import | zero-byte .psd | clean error, no file | empty file left; message "codec: unrecognized image format" | FAIL | 09f2422 |
| Import | truncated PSD / PNG renamed .psd | clean error | "it isn't a Photoshop file, or it's damaged." | PASS (after fix) | 09f2422 |
| Import | zero-byte .idml | clean IDML error, no file | called it "not a DesignCraft document: EOF while parsing…", empty file left | FAIL | 09f2422 |
| Import | zip header only .idml | clean error | as expected after fix | PASS | 09f2422 |
| Import | zero-byte .designcraft | clean error, no file | parser message, empty file left | FAIL | 09f2422 |
| Import | zero-byte .mov | clean error, no file | "unsupported media: empty.mov: unrecognised format", empty file left | FAIL | 09f2422 |
| Import | 5 KB junk .mkv | clean error | "its format isn't supported, or the file is damaged." | PASS (after fix) | 09f2422 |
| Import | canvas PNG | design file "pic" with one image layer | as expected | PASS | |
| Import | canvas JPG | design file with image | as expected | PASS | |
| Import | canvas WebP | design file with image | as expected | PASS | |
| Import | 2-frame animated GIF | image keeps GIF bytes (media store) | as expected | PASS | |
| Import | minimal valid PSD (RGB 8-bit, no layers) | design file with image + source | as expected | PASS | |
| Import | minimal valid PSB (v2) | design file with image | as expected | PASS | |
| Import | PNG + JPG together | one "Untitled" design file with two images | as expected | PASS | |
| Import | malicious SVG (script, onload, foreignObject iframe/img onerror, javascript: link, XXE entity, @import, external image/use/fill refs, nested data:svg with script) | no script runs, no external fetch, layers made | no __pwned, no requests to 127.0.0.1, XXE not expanded | PASS | |
| Import | .deck (Untitled.deck) via Import… | opens as Slides file with content | slides file, 365 layers, "Not carried over" list | PASS | |
| Import | .buzz (Untitled.buzz) | opens as Campaign | campaign file, 19 layers | PASS | |
| Import | .fig (Animation 1) | opens as Design | design, 82 layers | PASS | |
| Import | .fig 8 MB design system | opens, no hang | 22,959 layers in ~5 s | PASS | |
| Import | .deck renamed .fig | detects by header, opens as Slides | slides | PASS | |
| Import | PNG renamed .fig | clean error | "Not a .fig, .deck or .buzz file (unknown header)." | PASS | |
| Import | .pptx built by the app's own exporter | opens as Slides | slides file "Roundtrip" | PASS | |
| Import | .PPTX upper-case extension | opens | opens | PASS | |
| Import | truncated .pptx (half) | clean error | "invalid zip data" | FAIL (S4) | 2d08799 |
| Import | .sketch (artboard, rect with border+radius+rotation, group, oval, text, bitmap, shape path) | layers in place inside artboard | all children kept Sketch's parent-relative coordinates: everything fell outside the artboard (clipped away) | FAIL (S2) | 2d08799 |
| Import | .sketch with bad JSON | clean error | raw JSON parser message | FAIL (S4) | 2d08799 |
| Import | .sketch with no pages | clean error | "No pages were found in that .sketch file." | PASS | |
| Import | text, font weight from PostScript name, centre alignment, fill opacity from Sketch | carried over | Inter 600, centre, #00FF00 @ 0.5 | PASS | |
| Drop on canvas | PNG | image layer at drop point | as expected | PASS | |
| Drop on canvas | .sketch | opens as own file like .fig | "Those files aren't images Nagma can open." | FAIL (S3) | 7511d2d |
| Drop on canvas | .pptx | opens as own file | refused as not an image | FAIL (S3) | 7511d2d |
| Drop on canvas | PDF (2 pages) | pages placed as frames with progress | "Placed 2 pages…" | PASS | |
| Drop on canvas | SVG | editable layers | frame + rect | PASS | |
| Drop on canvas | .txt | clean refusal | "Those files aren't images…" | PASS | |
| Drop on canvas | PNG + .sketch together | PNG lands in current file, sketch opens as new file | PNG was placed, but lost: opening the new file cancelled the current file's pending autosave | FAIL (S1 data loss) | 7511d2d |
| Autosave | edit, then open another file within 300 ms, come back | edit kept | edit lost | FAIL (S1) | 7511d2d |
| Autosave | edit, then reopen the same file at once | edit kept | older copy read back | FAIL (S1) | 7511d2d |
| Document | rotate a page, switch tab within 500 ms, come back | rotation kept | rotation lost (pending PDF save dropped) | FAIL (S1) | 87b25bd |
| Document | rotate a page, close the tab at once, reopen | rotation kept | lost | FAIL (S1) | 87b25bd |
| Document | PDF from Home Import… (4 pages, image, AcroForm text+checkbox, landscape page) | opens in Document workbench | 4 pages, 2 fields, A4, jsPDF producer shown | PASS | |
| Document | Redact tool (R), drag across a text line, Apply (confirm) | text removed from content stream, not just covered; stored bytes free of it | text gone from text layer and from every inflated stream of the stored PDF; black box drawn | PASS | |
| Document | Redact only part of a line (one word) and half of an image | only covered glyphs removed; image pixels under the mark blanked | "code\\nre." left; covered image pixels zeroed in the image stream | PASS | |
| Document | Redaction marks then Clear marks | marks removed, count 0 | as expected | PASS | |
| Document | toolbar at 1024 px | every tool reachable | Edit, Organize, Redact, Protect, Reduce, All tools, Find, Download past the right edge with no scrollbar | FAIL (S3) | aad7236 |
| Document | redact options bar at 1024 px | Clear/Apply on one line | buttons wrapped onto two clipped lines | FAIL (S4) | aad7236 |
| Document | open another document after using Redact | Select tool | Redact still active | FAIL (S4) | aad7236 |
| Document | E, double-click a 3-line paragraph, type more words, ⌘↩ | rewraps to paragraph width, extra lines added below | rewrapped into 4 lines | PASS | |
| Document | ⌘Z after paragraph edit | whole paragraph back in one step | only the last line undone ("Undid add text"), 4 undos needed | FAIL (S3) | 9adf22d |
| Document | ⇧⌘Z after paragraph undo | paragraph edit redone | "Redid edit paragraph." | PASS | 9adf22d |
| Document | ⇧U / ⇧S | underline / strikeout tool | as expected | PASS | |
| Document | ⇧2 / ⇧1 | fit page / fit width | fit "page" 68% / "width" 76% | PASS | |
| Document | ⌘= / ⌘- / ⌘0 | zoom in/out/100% | 1.2 / 1 / 100% | PASS | |
| Document | U then drag across text | highlight annotation over the dragged words | Highlight [50,91,202,102] | PASS | |
| Document | C then click | sticky note at click point; inspector opens | note placed; inspector shows note | PASS | |
| Document | type comment, reply, Enter | contents saved, reply threaded (inReplyTo) | as expected | PASS | |
| Document | D then drag | ink annotation | Ink | PASS | |
| Document | T then drag, type text incl. HTML and Unicode, ⌘↩ | FreeText with text as typed | stored verbatim; ✓ renders as "?" in the standard font appearance | PASS (known limit) | |
| Document | text box placeholder | says what to type | "Type a comment" for a text box | FAIL (S4) | d6f308b |
| Document | S (no signature) | signature dialog | Add a signature dialog (Draw/Type/Upload) | PASS | |
| Document | draw signature, Place, click page | signature placed at click | placed, tool back to Select | PASS | |
| Document | AcroForm text field: click, type (quotes, accents, <x>), Enter | value set and drawn | value stored and rendered | PASS | |
| Document | AcroForm checkbox: click twice | Off then On, each undoable | as expected ("Fill in agree") | PASS | |
| Document | Protect with open password | encrypted AES-256, bytes have /Encrypt, no plaintext | as expected | PASS | |
| Document | Protect with a typo'd password | asked to confirm | single field: a typo locks the PDF for good | FAIL (S3) | d6f308b |
| Document | reopen protected file, wrong password then right | "That password isn't right." then opens | as expected | PASS | |
| Document | Remove protection | /Encrypt gone, text readable | as expected | PASS | |
| Document | Escape in Protect dialog | closes | closes | PASS | |
| Document | open another document with Protect dialog open / scrolled to page 25 | fresh state, page 1 | dialog followed into next file; page number carried over (clamped) | FAIL (S3) | b142e27 |
| Document | 200-page PDF with image | opens < 2 s, no long jank | 1.26 s, one 75 ms long task, pages drawn lazily (8 of 200) | PASS | |
| Organize | drag page 1 after page 2 | 2,1,3,4,5 | as expected | PASS | |
| Organize | click + ⇧click, Right | pages 3-4 rotated 90° | as expected | PASS | |
| Organize | Duplicate | copies after selection, selection moves to copies | as expected | PASS | |
| Organize | Delete key | selected pages removed | as expected | PASS | |
| Organize | Blank page | blank inserted after current | as expected | PASS | |
| Organize | ⌘Z ×5 / ⇧⌘Z ×5 | each step reverts / reapplies | as expected | PASS | |
| Organize | keyboard: Tab to a page, Space, ⇧Tab, ⇧Enter | pages selected | tiles focusable but keys did nothing, no focus ring | FAIL (S3) | 8bc844d |
| Organize | ⌘-click + Extract | 2-page PDF with those pages and rotation | "Org pages 3,4.pdf" 2 pages, rotations kept | PASS | |
| Organize | Split every 4 pages (6 pages) | zip with 1-4 and 5-6 | as expected | PASS | |
| Organize | Split note for a single part | no zip promised | "1 file, downloaded together as a zip" | FAIL (S4) | 05fbc2f |
| Organize | Insert or merge files: PDF + PNG + junk.pdf | good files in, junk reported | junk reported; a junk file first stopped the rest | FAIL (S3) | 05fbc2f |
| Document | drop .txt on pages | says it can't be added | nothing happened | FAIL (S4) | 05fbc2f |
| Document | drop junk.pdf + PDF + PNG | 2 added, junk reported | "Added 2 files. Couldn't add bad.pdf…" | PASS (after fix) | 05fbc2f |
| Document | Reduce file size on 5.7 MB image PDF | smaller file, content kept | 288 KB, text and image kept | PASS | |
| Document | Reduce file size asks first | confirm (lossy, can't be undone) | ran at a click, undo history cleared | FAIL (S3) | 495bbdb |
| Document | All tools > Download PDF | valid PDF, safe file name | "Exp-ort-Test-.pdf", 3 pages, fields kept | PASS | |
| Document | All tools > Export pages as PNG | zip of page PNGs at 2× | 3 × 1191×1684 | PASS | |
| Document | All tools > Export as plain text | text with page breaks | as expected | PASS | |
| Document | Title / Author fields | set in PDF info, undoable | "Change Author" | PASS | |
| Document | reload after page edits | edits persisted | order and rotation kept after reload | PASS | |
| Document | Create document flow from Home Import (PDF) | Document file opens on page 1 | as expected | PASS | |
| Document | OCR | n/a | no OCR feature in the workbench | N/A | |
| Document | form field creation | n/a | engine has addField but no UI | N/A (known gap) | |
| New document | drop JPEG on "Open a PDF" | Document with the picture as a page | 1 page | PASS | |
| New document | drop WebP / SVG | Document with the picture | engine refused: "use a PNG, JPEG, …" | FAIL (S3) | a49ef49 |
| New document | drop .txt / zero-byte PNG | one clear error, no file | "Couldn't open a.txt: a.txt: use a PNG…" (name twice) | FAIL (S4) | a49ef49 |
| New document | drop malicious SVG (DOCTYPE entity) | refused cleanly, no script | "it isn't a PDF or a picture Nagma can read.", nothing ran | PASS | |
| Large file | 200 MB junk .pdf | clean error, UI recovers | error in 2.8 s, one 1.1 s long task | PASS | |
| Large file | 200 MB junk .mp4 | clean error | error in 1.8 s | PASS | |
| Large file | 200 MB junk .png | clean error | "Those files aren't images…" in 1.8 s | PASS | |
| Large file | 200 MB .fig (valid header, zero padding) | clean error | tab ran out of memory and crashed (one empty chunk per 4 bytes) | FAIL (S1) | 86976aa |
| Large file | 200 MB .sketch / .idml / .designcraft / .pptx junk | clean error, memory bounded | errors in ~1.3 s, heap +10 to +200 MB | PASS | |
| Large file | 190 MB PSD (8000×8000 RGB) | opens, memory bounded | opens in 3 s, peak heap 626 MB; the original was copied into a 270 MB data URL | FAIL (S3 memory) | ad12d61 |
| Desktop | open-file regex | every Import… type | only .fig/.deck/.buzz/.pptx/.pdf; .sketch, PSD, images, video ignored | FAIL (S3) | 9eae500 |
| Desktop | picture opened from Finder | read as picture | File had no type, so readImage refused it ("aren't images") once allowed | FAIL (S3) | 9eae500 |
| Desktop | 300 MB file opened from Finder | refused with message | read whole file, base64 through executeJavaScript (≈400 MB string) | FAIL (S3) | 9eae500 |
| Desktop | open a file with all windows closed (macOS) | a window opens and imports it | waited until a window was opened by hand | FAIL (S3) | 9eae500 |
| Desktop | flags, app path, nagma:// links in argv | ignored | ignored (unit test) | PASS | |
| Video | Home > More > Video | Video file opens with empty sequence 1920×1080 30 fps | as expected | PASS | |
| Video | Import media: 2 WebM (MediaRecorder, one with Opus audio), WAV, PNG, junk .mov, .txt | 4 added with duration/size/audio/waveform; failures reported | added, but "Added 4 files." replaced both failure messages | FAIL (S3) | 41582d5 |
| Video | import a damaged file | not stored/uploaded | stored in media store and uploaded before the read failed | FAIL (S4) | 41582d5 |
| Video | import still reading while another file opens | not added to the other file | would be added to whichever file was open | FAIL (S2) | 41582d5 |
| Video | first video sets empty sequence size/rate | 320×180 30 fps | as expected | PASS | |
| Video | bin posters and waveform | thumbnails show | shown after load | PASS | |
| Video | drag bin item to V1 | linked video + audio clips at drop time | V1+A1 linked | PASS | |
| Video | drag selected bin items | all selected media placed | as expected | PASS | |
| Video | drag WAV to A2, PNG to V2 | audio clip, 5 s still | as expected | PASS | |
| Video | drag clip near start (snapping on) | snaps to 0 | 0.233 → 0 | PASS | |
| Video | ⌘K with clip selected at 1.9 s | linked pair split, halves relinked | as expected | PASS | |
| Video | ⌥⌫ on first half | ripple: later clips on those tracks move left | V1/A1 shifted 1.9 s, other tracks kept | PASS | |
| Video | ⌘Z ×2 / ⇧⌘Z ×2 | exact states restored | as expected | PASS | |
| Video | trim clip start by dragging its left edge | in/start/duration change, end fixed, snaps | 1.6→2.033 (snapped to tone end) | PASS | |
| Video | timeline zoom - / = | px/s changes | 80 → 35.6 → 80 | PASS | |
| Video | lock V1, drag a clip on it / ⌫ | nothing moves or deletes | as expected | PASS | |
| Video | lock V1, ⌘A then ⌥→ | locked clips stay | locked clips nudged | FAIL (S3) | fbffa43 |
| Video | locked clip still selected: nudge, cut, duplicate, disable, nest | locked clip unchanged | changed/moved/removed | FAIL (S3) | fbffa43 |
| Video | ⌘A with a locked track | locked clips not selected | selected | FAIL (S4) | fbffa43 |
| Video | ⌘K with nothing selected | cuts unlocked clips under playhead | V2 and A2 cut, locked V1 not | PASS | |
| Video | I / O at 0.5 s and 2.0 s | in 0.5, out 2 | as expected | PASS | |
| Video | Export MP4, In to out | 1.5 s, 320×180, H.264+AAC, first frame at 0.5 s | 1.5 s, audio RMS 0.46, square at x=50 | PASS | |
| Video | Export WebM, In to out | 1.5 s VP9+Opus | as expected | PASS | |
| Video | Export GIF loop / play once | 25 fps, NETSCAPE loop / none | 38 frames 1.52 s; repetition ∞ / 0 | PASS | |
| Video | Export Lottie | fr 30, op-ip = 45, 320×180 | as expected, 45 image assets | PASS | |
| Video | Export dotLottie | zip with manifest + animations/<id>.json | as expected | PASS | |
| Video | Export animated SVG | 320×180, 1.5 s animation, no script | 45 images, dur 1.5s | PASS | |
| Video | Export PNG at 0.2/1.0/2.0/0.5 s (fresh page) | that frame | correct (17/100/200/50) | PASS | |
| Video | Export MP4 whole range of a browser-decoded WebM after a few idle seconds | moving picture | every frame frozen at one time (Chrome suspends the idle hidden seek player) | FAIL (S1 wrong output) | 31f0d3f |
| Video | Export PNG after idle | frame at the playhead | same stale frame at any playhead | FAIL (S2) | 31f0d3f |
| Video | Export after 32 s idle (after fix) | correct frames | 0/50/100/147/200/250 | PASS | 31f0d3f |
| Video | ⌘E in the browser pane | Export opens | pane's browser takes ⌘E; handler works with the key event | N/A (env) | |
| Video | Library > Effects: double-click Black & White with a clip selected | effect added, monitor grey | as expected | PASS | |
| Video | Library > Transitions: double-click Dip to black, playhead at clip start | in-transition 0.8 s | as expected | PASS | |
| Video | T at 1.0 s | Headline title on V2 at 1 s, 4 s, selected | added | PASS | |
| Video | inspector after adding a title while a transition was picked | shows the title | still showed the transition; ⌫ would remove the transition | FAIL (S3) | b241d05 |
| Video | stopwatch on Position X at 0.5 s, type 250 at 2.0 s | two keys, ease-in-out, 205 midway | as expected | PASS | |
| Video | inspector number fields' accessible names | named | unnamed inputs | FAIL (S4 a11y) | a0c3ff9 |
| Video | Code section: CSS / React / JSON tabs, Copy | keyframes as CSS etc. | as expected | PASS | |
| Video | Code section spring easing | CSS curve matches editor's spring | hand-written curve overshot 1.13 vs 1.06 | FAIL (S3) | a0c3ff9 |
| Video | mute A1 then export | only A2 audio | RMS 0.617 → 0.259 | PASS | |
| Video | solo a muted track | silent | silent | PASS | |
| Video | audio mix clipping | limited to ±1 | hard clip at ±1 | PASS | |
| Video | right-click clip / track / empty lane / monitor | menus with matching shortcut labels | as expected | PASS | |
| Video | right-click a clip on a locked track | not picked | picked it (then Add dissolve etc. changed it) | FAIL (S3) | 3f1c2d3 |
| Video | track menu "Select clips on this track" on locked track | off | selected locked clips | FAIL (S4) | 3f1c2d3 |
| Video | drop an effect/transition on a locked track's clip | refused | applied | FAIL (S3) | 3f1c2d3 |
| Video | ⌫ on a picked transition of a locked clip | kept | removed | FAIL (S4) | 3f1c2d3 |
| Video | menu labels vs keys (every VIDEO_ACTIONS shortcut) | each label's key does it | all match | PASS | |
| Video | Ctrl+⇧+? shortcuts panel | video shortcuts listed | as expected | PASS | |
| Video | 49 × ⌘D on a clip (50 video + 50 audio clips) | responsive | 2.1 s total, one 69 ms long task | PASS | |
| Video | scrub with 50 clips | no long tasks | none | PASS | |
| Video | reload | clips, media, in/out, track states, keyframes kept | 102 clips, all kept | PASS | |
| Video | Space play/pause; L L (2×), K, J (reverse) | playhead moves at rate | 1.97 s after 2 s; rate 2; rate -1 | PASS | |
| Video | Select dropdowns | no console warnings | "<Section> is deprecated" on each open | FAIL (S4) | b44a267 |
| Import | Home Import… of an MP4 the app exported / same renamed .mov | design file with a video fill (1.5 s, audio) | as expected | PASS | |
| Import | Home Import… of a VP8 WebM / .mkv (MediaRecorder) | design file with a video fill | "unsupported media: no decoder for VP8 video" | FAIL (S2) | 9a495da |
| Import | VP8 video fill exact frames and audio for export | right frame, sound | browser fallback: frames 18/98 px at 0.2/1.0 s, audio RMS 0.70 | PASS (after fix) | 9a495da |
| Import | MXF header-only file | clean error | "its format isn't supported, or the file is damaged." | PASS | |
| Document | All tools > Flatten comments and fields (confirm) | fields flattened, undoable | 2 → 0 fields, "Undid flatten." | PASS | |
| Document | All tools > Remove hidden information (confirm) | metadata gone, undoable | producer cleared, undo restores | PASS | |
| Autosave | close the tab within 300 ms of an edit | edit kept | lost (no flush on pagehide) | FAIL (S1) | a90ad7f |
| Theme | Video editor in light theme at 1024 px | readable, all controls reachable | readable; transport and timeline toolbar clipped (fixed) | FAIL (S3) | 66bf8be |
| Theme | Document and video editors in dark theme | readable | as expected | PASS | |
| Console | errors during flows | none from my area | only 401 /teams polls while signed out (server area) and transient HMR errors | PASS | |
| Video shortcuts | Import media… (⌘ I) | label matches key: opens picker | Import picker | PASS | |
| Video shortcuts | Export… (⌘ E) | label matches key: opens Export | dialog opens (key event) | PASS | |
| Video shortcuts | Export frame as PNG (⇧ ⌘ E) | label matches key: PNG of playhead frame | handler bound | PASS | |
| Video shortcuts | Save to version history… (⌥ ⌘ S) | label matches key: version dialog | handler bound | PASS | |
| Video shortcuts | Undo (⌘ Z) | label matches key: undo | pressed, worked | PASS | |
| Video shortcuts | Redo (⇧ ⌘ Z) | label matches key: redo | pressed, worked | PASS | |
| Video shortcuts | Cut (⌘ X) | label matches key: cut selection | handler bound | PASS | |
| Video shortcuts | Copy (⌘ C) | label matches key: copy | handler bound | PASS | |
| Video shortcuts | Paste at playhead (⌘ V) | label matches key: paste | handler bound | PASS | |
| Video shortcuts | Duplicate (⌘ D) | label matches key: duplicate | pressed 49×, worked | PASS | |
| Video shortcuts | Delete (⌫) | label matches key: delete | pressed, worked | PASS | |
| Video shortcuts | Ripple delete (⌥ ⌫) | label matches key: ripple | pressed, worked | PASS | |
| Video shortcuts | Select all clips (⌘ A) | label matches key: select all | pressed, worked | PASS | |
| Video shortcuts | Deselect (Esc) | label matches key: clear selection | handler bound | PASS | |
| Video shortcuts | Split at playhead (S) | label matches key: split | handler bound | PASS | |
| Video shortcuts | Split (add edit) (⌘ K) | label matches key: split | pressed, worked | PASS | |
| Video shortcuts | Razor tool (C) | label matches key: razor toggle | handler bound | PASS | |
| Video shortcuts | Selection tool (V) | label matches key: select tool | handler bound | PASS | |
| Video shortcuts | Link clips (⌘ L) | label matches key: link | handler bound | PASS | |
| Video shortcuts | Unlink clips (⇧ ⌘ L) | label matches key: unlink | handler bound | PASS | |
| Video shortcuts | Enable or disable clip (⇧ E) | label matches key: toggle | handler bound | PASS | |
| Video shortcuts | Nest into a sequence (⌘ G) | label matches key: nest | handler bound | PASS | |
| Video shortcuts | Title (T) | label matches key: add title | pressed, worked | PASS | |
| Video shortcuts | Play or pause (Space) | label matches key: toggle playback | pressed, worked | PASS | |
| Video shortcuts | Back one frame (←) | label matches key: step -1 | handler bound | PASS | |
| Video shortcuts | Forward one frame (→) | label matches key: step +1 | handler bound | PASS | |
| Video shortcuts | Previous edit (↑) | label matches key: jump | handler bound | PASS | |
| Video shortcuts | Next edit (↓) | label matches key: jump | handler bound | PASS | |
| Video shortcuts | Mark in (I) | label matches key: in point | pressed, worked | PASS | |
| Video shortcuts | Mark out (O) | label matches key: out point | pressed, worked | PASS | |
| Video shortcuts | Clear in and out (⌥ X) | label matches key: clear | handler bound | PASS | |
| Video shortcuts | Add marker (M) | label matches key: marker | handler bound | PASS | |
| Video shortcuts | Snapping (⇧ S) | label matches key: toggle | handler bound | PASS | |
| Video shortcuts | Zoom timeline in (=) | label matches key: zoom | pressed, worked | PASS | |
| Video shortcuts | Zoom timeline out (-) | label matches key: zoom | pressed, worked | PASS | |
| Video shortcuts | Fit the sequence (\\) | label matches key: fit | handler bound | PASS | |
| Video shortcuts | Play backwards (J) | label matches key: shuttle -1 | pressed, worked | PASS | |
| Video shortcuts | Stop (K) | label matches key: shuttle 0 | pressed, worked | PASS | |
| Video shortcuts | Play forwards (L) | label matches key: shuttle +1, faster each press | pressed twice: rate 2 | PASS | |
| Video shortcuts | Go to start (Home) | label matches key: seek 0 | handler bound | PASS | |
| Video shortcuts | Go to end (End) | label matches key: seek end | handler bound | PASS | |
| Video shortcuts | Previous keyframe ([) | label matches key: jump key | handler bound | PASS | |
| Video shortcuts | Next keyframe (]) | label matches key: jump key | handler bound | PASS | |
| Video shortcuts | Nudge left (⌥ ←) | label matches key: nudge -1 frame | handler bound | PASS | |
| Video shortcuts | Nudge right (⌥ →) | label matches key: nudge +1 frame | pressed, worked | PASS | |
| Video shortcuts | Open nested sequence (↵) | label matches key: open | handler bound | PASS | |
| Video shortcuts | Show or hide left panel (⌘ \\) | label matches key: toggle | handler bound | PASS | |
| Video shortcuts | Keyboard shortcuts (⌃ ⇧ ?) | label matches key: panel | pressed, worked | PASS | |
| Document shortcuts | Select (V) | key does what the tooltip says | handler bound | PASS | |
| Document shortcuts | Hand (H) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Add a comment (C) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Highlight (U) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Draw (D) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Text box (T) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Sign (S) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Edit text and images (E) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Redact (R) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Fill & Sign: add text (F) | key does what the tooltip says | handler bound | PASS | |
| Document shortcuts | Underline (⇧ U) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Strike through (⇧ S) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Fit width (⇧ 1) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Fit page (⇧ 2) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Undo (⌘ Z) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Redo (⇧ ⌘ Z / ⌘ Y) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Find (⌘ F) | key does what the tooltip says | handler bound | PASS | |
| Document shortcuts | Print (⌘ P) | key does what the tooltip says | handler bound | PASS | |
| Document shortcuts | Save (⌘ S) | key does what the tooltip says | handler bound | PASS | |
| Document shortcuts | Copy selected text (⌘ C) | key does what the tooltip says | handler bound | PASS | |
| Document shortcuts | Zoom in (⌘ =) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Zoom out (⌘ -) | key does what the tooltip says | handler bound | PASS | |
| Document shortcuts | 100% (⌘ 0) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Select all pages (Organize) (⌘ A) | key does what the tooltip says | handler bound | PASS | |
| Document shortcuts | Previous / next page (← → PgUp PgDn) | key does what the tooltip says | handler bound | PASS | |
| Document shortcuts | Escape (Esc) | key does what the tooltip says | pressed, worked | PASS | |
| Document shortcuts | Delete comment / pages (⌫) | key does what the tooltip says | pressed, worked | PASS | |

## 2. Bugs

| ID | Sev | Area | Repro | Root cause | Fix | Test |
|---|---|---|---|---|---|---|
| VDI-1 | S1 | Autosave | Edit a file (or drop an image with a .fig), open another file within 300 ms, come back | `loadDocument`/`scheduleSave` cancelled the open file's pending 300 ms autosave timer before scheduling the next file's | `flushSave()` writes the waiting autosave before another document or storage key takes over, and before `openFile` reads storage | engine/autosave.test.ts |
| VDI-2 | S1 | Document | Rotate a page, switch tab or close the tab within 500 ms | The workbench's pending save ran after the switch; `saveNow` bailed because another file was open, and `closeWorkbench` freed the engine | `editor.onLeave` hook: the Document writes its PDF into the document synchronously (`storeImageNow`) before the switch | document/document.test.ts |
| VDI-3 | S1 | Import | Import a 200 MB .fig whose header is valid and the rest zeros | `figChunks` read a length of 0 every 4 bytes and pushed ~52 M empty chunks until the tab ran out of memory | A zero-length chunk ends the file; a chunk past the end is reported as damaged | engine/fig-import.test.ts |
| VDI-4 | S1 | Video export | Import a MediaRecorder WebM, wait ~15 s, export MP4 (or PNG at any playhead) | FilmCraft has no VP8 decoder, so frames come from a hidden `<video>`; Chrome suspends idle paused players, after which seeks fire `seeked` but the picture never changes, and every frame was the last one shown | Seek player replaced after 8 s idle; each seek waits for `requestVideoFrameCallback`, and a seek with no new frame replaces the player and retries | engine/video/video.test.ts |
| VDI-5 | S1 | Autosave | Edit, close the tab within 300 ms | No flush on `pagehide` | `pagehide` and hidden `visibilitychange` flush the waiting autosave | engine/autosave.test.ts |
| VDI-6 | S2 | Import | Import a .sketch with layers in an artboard or group | Sketch child frames are parent-relative; Nagma layers keep page positions, but the walker reset offsets to 0 | Children are offset by the parent's page position | engine/sketch-import.test.ts |
| VDI-7 | S2 | Import | Home Import… of a VP8 WebM or .mkv | Design video fills only used FilmCraft, which can't decode VP8 | Browser fallback for facts and poster (`browserInfo`), and for export frames and audio (`sources.exactFrame`, `readAudio`) | engine/video-fill.test.ts |
| VDI-8 | S2 | Video | Import media, open another file while it's read | `importFiles` committed to whichever file was open after the awaits | The file id is checked after reading; the import stops with a message | engine/video/video.test.ts |
| VDI-9 | S2 | Media sync | Save a Document (or import media) and switch files before the local write finishes | `upload` read the media context at upload time, after `putLocal`, so the blob went up under the next file | The file id is captured when the media is stored | (covered by VDI-2 flow; code review) |
| VDI-10 | S2 | Document | Edit a Document and switch to another Document | The thumbnail timer drew whatever the workbench held then | Thumbnail only drawn while the workbench holds that file | (code review, verified in app) |
| VDI-11 | S3 | Import | Import… a .txt, a zero-byte or fake PNG, PSD, IDML, video | A new design/document file was created and opened before the content was read | A file that ends up with nothing on its pages is discarded (`discardFile`), and Home shows again | engine/images.test.ts |
| VDI-12 | S3 | Import | Drop a .sketch or .pptx on the canvas | Only .fig/.deck/.buzz were routed to their importers; the rest reached the image reader | All own-kind files open as their own files after the rest is placed | engine/images.test.ts |
| VDI-13 | S3 | Document | Open a Document at 1024 px | Toolbar `overflow-x-auto` with hidden scrollbar: 8 tools past the edge | Toolbar and tool options wrap | (UI, verified in app) |
| VDI-14 | S3 | Document | Double-click a paragraph, edit, ⌘↩, then ⌘Z | Each rewrapped line was a separate engine edit | One `batch` edit, "Edit paragraph"; the rewrap moved to `paragraphEdit` in document/text.ts | document/document.test.ts |
| VDI-15 | S3 | Document | Protect with a mistyped open password | One password field; the password can't be recovered | Confirmation field; Protect disabled until they match | (UI, verified in app) |
| VDI-16 | S3 | Document | Scroll a 30-page Document, open a 3-page one (or leave Protect open) | `syncWorkbench` compared `state.fileId` after already setting it, so the page number carried over; dialog state was never reset | Switch detected before the update; page 0, dialog, search, tool reset | document/document.test.ts |
| VDI-17 | S3 | Document | Organize: Tab to a page, press Space | Tiles were `role=button tabIndex=0` with no key handler and no focus ring | Space/Enter pick (with ⇧/⌘), focus rings on tiles and thumbnails | (UI, verified in app) |
| VDI-18 | S3 | Document | Insert or merge files with a bad file first | `run()` failure `return`ed out of the loop | Shared `insertFileList`: continues, reports added and failed together | document/document.test.ts |
| VDI-19 | S3 | Document | Reduce file size | Lossy recompression with no undo ran at a click | Confirmation first | (UI) |
| VDI-20 | S3 | Document | New document from a WebP/SVG, or insert one as a page | The engine's `fromImage` takes PNG/JPEG/TIFF/GIF/BMP only | Other pictures are decoded by the browser (an `<img>`, no scripts) and passed as PNG | document/document.test.ts |
| VDI-21 | S3 | Import | Import a 190 MB PSD | The original was copied into a data URL (≈270 MB string) | The file itself is stored as the source blob | engine/photo.test.ts |
| VDI-22 | S3 | Desktop | Open a .sketch, PSD, picture or video from Finder / Dock | `openFigs` let only .fig/.deck/.buzz/.pptx/.pdf through | `open-files.cjs`: every Import… type | apps/desktop/test/open-files.test.mjs |
| VDI-23 | S3 | Desktop | Picture opened from Finder | Delivered `File` had no type; `readImage` requires `image/*` | `typeForName` gives the MIME type | engine/images.test.ts |
| VDI-24 | S3 | Desktop | Open a 300 MB file from Finder | Whole file read and pushed as base64 through `executeJavaScript` | Refused over 256 MB with a message, before reading | apps/desktop/test/open-files.test.mjs |
| VDI-25 | S3 | Desktop | Open a file with every window closed (macOS) | Pending files waited for a window opened by hand | A window is created to take them | (code review) |
| VDI-26 | S3 | Video | Import media with some bad files | Each message replaced the last; "Added 4 files." hid failures | Problems collected and shown with the result | engine/video/video.test.ts |
| VDI-27 | S3 | Video | Lock V1, ⌘A, ⌥→ (or cut/duplicate/disable/nest) | `selectAll` and these actions ignored track locks (only delete/split/drag checked) | `editableSelection`; Select all skips locked clips; locking drops them from the selection | engine/video/video.test.ts |
| VDI-28 | S3 | Video | Pick a transition, press T, press ⌫ | `transition` stayed set when clips were picked; inspector and delete preferred it | `vui.set` clears transition/marker whenever clips are picked | engine/video/video.test.ts |
| VDI-29 | S3 | Video | Spring easing in the Code section | Hand-written CSS `linear()` curve differed from the render curve | Sampled from `ease("spring")` every 5% | engine/video/video.test.ts |
| VDI-30 | S3 | Video | Right-click a locked clip; drop an effect on it; ⌫ its transition; track menu Select clips | Context menu picked it; lane drop and transition delete had no lock check | Locked clips get the timeline menu; drops refused; transition kept; menu item off | engine/video/video.test.ts |
| VDI-31 | S3 | Video | Video editor at 1024 px | Transport bar and timeline toolbar were `overflow-hidden` | Both wrap | (UI, verified in app) |
| VDI-32 | S4 | Import | Damaged PSD / IDML / DesignCraft / video | Engine messages quoted ("codec: unrecognized image format", "not a DesignCraft document: EOF…" for an .idml) | Plain "it isn't a … file, or it's damaged." per kind | engine/photo.test.ts |
| VDI-33 | S4 | Import | Damaged .sketch / .pptx | "invalid zip data", raw JSON errors | Plain damaged-file messages | engine/sketch-import.test.ts, slides/pptx-import.test.ts |
| VDI-34 | S4 | Document | Use Redact, open another Document | Tool state global across files | Reset on switch | document/document.test.ts |
| VDI-35 | S4 | Document | Text box placeholder | Said "Type a comment" | "Type here" | (UI) |
| VDI-36 | S4 | Document | Drop a .txt on pages; Split into 1 part | Silent; note promised a zip | Message; note fixed | document/document.test.ts (insert part) |
| VDI-37 | S4 | Document | Open a .txt as a Document | "a.txt: use a PNG, JPEG…" with the name twice | One clear message | document/document.test.ts |
| VDI-38 | S4 | Video | Import a damaged file into the bin | Stored and uploaded before the read failed | Stored only once readable | (code review) |
| VDI-39 | S4 | Video a11y | Inspector property fields | `NumberField label=""` left inputs unnamed | `name` prop → `aria-label` | (UI) |
| VDI-40 | S4 | Console | Open any dropdown | Deprecated `Section` warning | `MenuSection` in Select | (UI) |
| VDI-41 | S4 | Import | Discarded import | Pending autosave re-created the deleted doc in storage | Storage key cleared (flushing first) before delete | engine/images.test.ts |

## 3. Known issues not fixed

- **Unicode in standard-font annotations**: a text box or form value with characters outside WinAnsi (✓, CJK) is stored correctly but its appearance draws "?"; needs font embedding in the PDF engine (Rust, not rebuildable here: no cargo on this machine).
- **VP8 in FilmCraft**: the engine itself still has no VP8 decoder; the app now falls back to the browser everywhere (bin, design fills, export), which is slower and depends on seeking. A native decoder belongs in engines/filmcraft.
- **200 MB PDF parse blocks the main thread ~1.1 s** (synchronous wasm parse); moving the workbench to a worker is a larger change.
- **Form field creation**: the engine supports `addField` but the workbench has no UI for creating fields (filling works). No OCR feature exists.
- **Title in/out presets aren't in the Code hand-off** (only keyframed transform and opacity are), as the section says.
- **PSD/PSB placed at full size**: other images are capped at 4096 px on import, PSDs aren't (an 8000 px PSD makes an 8000 px layer).
- **401 noise while signed out**: Home polls `/teams` and logs 401s in the console (server/Home area, not changed).
- **Deprecated `Section` in other shared menus** (design panel, blend menu, variable picker): left alone to keep shared edits small; Select (used across the app) is fixed.
- **Destructive confirmations use `window.confirm`** (Flatten, Remove hidden information, Apply redactions, Reduce file size), matching the existing pattern rather than an app dialog.
- **Testing environment**: the browser pane takes ⌘E and named keys like "equal"/"minus"/"backslash"; those shortcuts were checked by dispatching the key events and by the character keys.
