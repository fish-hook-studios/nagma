# Video: what the motion engine can do versus what the Video product lets a person do

The Video product's compositor is the motion engine (`apps/web/src/engines/motion-engine.ts`, a
WebAssembly build of `engines/effectcraft`). The WebAssembly surface (`engines/motion/nagma_motion.d.ts`)
exposes four things: the effects catalogue and `applyEffect` (one effect on one RGBA frame), the
MP4 (H.264) and GIF encoders, and `inspectLottie`. Everything else the engine does (its layer
model, shape layers, masks, mattes, parenting, 3D, expressions, text animators, the render queue)
lives in the Rust crates and is not reachable from the browser build, so the Video product draws
those itself in `render.ts` on a 2D canvas, keeping the engine's model as the reference.

"Engine" below means the full engine (README, docs/gaps.md); "WASM" says whether the browser build
exposes it. "UI/model" is what `engine/video/model.ts` stores and the panels let a person do.

| Feature | Engine | WASM | UI/model | Status |
|---|---|---|---|---|
| Layer types: footage (video, image), solid, adjustment, nested comp, audio | Yes | No (drawn by render.ts) | Yes: video, audio, image, solid, adjustment, comp, plus titles and design frames | Done |
| Null layers | Yes | No | No. A clip with no source (a solid at 0% opacity) parents the same way | Left out (low value here) |
| Shape layers: a list of shape items (rectangle, ellipse, polygon, star, free path) | Yes | No | Was one primitive per clip (`VShape`). Now `clip.shapes: VShapeItem[]`, each rectangle, ellipse, polygon, star or path from points, drawn in order (`render.ts`, `drawShapeItems`); legacy `clip.shape` still reads | Done (this pass) |
| Shape fill and stroke (width, caps, joins, dashes) | Yes | No | Fill colour, stroke colour, width (keyframeable), cap, join, dash pattern and dash offset (keyframeable) per item | Done (this pass) |
| Trim Paths (start, end, offset) | Yes | No | Per item, keyframeable `shape.<id>.trimStart/trimEnd/trimOffset` | Done (this pass) |
| Shape geometry keyframes (size, radius, points, inner radius, rotation, position) | Yes | No | Keyframeable through `anim` (`shape.<id>.x/y/w/h/radius/sides/inner/rotation/opacity`) | Done (this pass) |
| Repeater, merge paths, round corners, offset paths, zig zag, twist, wiggle paths, gradient fills and strokes | Yes | No | No | Left out (next: repeater and gradient fill are the most used) |
| Free path editing on the monitor (pen tool, Bezier handles) | Yes | No | A shape path's points are edited as a list in the Inspector (pixels from the item's centre); no Bezier handles. Mask paths have vertex editing on the monitor; shape paths don't yet | Partly |
| Masks: drawn paths with modes, feather, expansion, vertex editing | Yes (add, subtract, intersect, lighten, darken, difference) | No | Rectangle and ellipse were the only shapes, add and subtract the only modes. Now path masks (`shape: "path"`, points as fractions of the layer), modes add, subtract and intersect, feather, expansion and opacity, vertices dragged, added and removed on the monitor (Masks ▸ Edit points) | Done (this pass; lighten, darken, difference left out; mask points not keyframeable) |
| Track mattes (alpha, alpha inverted, luma, luma inverted) | Yes | No | `clip.matte`: the clip on the video track above is the matte and is not drawn itself | Done (this pass) |
| Blend modes (38 in the engine) | Yes | No | The 17 the 2D canvas has, plus Add | Partly (the canvas has no Linear Burn, Darker Color, Dissolve, Classic Color Burn and the like) |
| Effects (306) | Yes | Yes, every effect whose parameters are plain values (`effectCatalog`) | Library ▸ Effects, parameters in the Inspector, numbers keyframeable | Done (effects needing a second layer or a camera are filtered out by `usableEffects`) |
| Layer styles (drop shadow, glows, bevel, satin, stroke) | Yes | No | No. Titles have their own shadow, stroke and box; the effects list has Drop Shadow and Glow | Left out (needs the engine's layer-style pass in WASM) |
| Expressions (wiggle, loopOut, pick-whip) | Yes | No | No. Motion presets and the spring easing cover the common cases | Left out (needs the engine's expression runtime; a JavaScript port is a project of its own) |
| Precomps (nested compositions) | Yes | No | Nest into a sequence (⌘G), open and edit, time shown through `sourceAt` | Done |
| Text layers and text animators (range selectors) | Yes | No | Titles with fonts, stroke, shadow, box and 14 in/out animations; no per-character animators | Partly |
| 3D layers, cameras, lights | Yes | No | No | Left out (needs the engine's 3D renderer in WASM) |
| Motion blur | Yes | No | `clip.motionBlur`: the clip is drawn as the average of sub-frame samples over a 180 degree shutter when its transform is keyframed (off in drafts) | Done (this pass) |
| Parenting (a layer follows another layer's transform) | Yes | No | `clip.parent`: the clip's position, rotation and scale are measured in its parent's space (parent chain, cycles ignored) | Done (this pass) |
| Anchor point editing in the viewer | Yes | No | A handle on the monitor at the selected clip's anchor; dragging it moves the anchor and keeps the picture still | Done (this pass) |
| Keyframe interpolation: linear, Bezier, hold, auto Bezier, Easy Ease, roving keys | Yes | No | Linear, ease in, ease out, ease in and out, hold, custom cubic Bezier (two handles in the graph editor), spring. Now also back in, back out, bounce and elastic | Done (this pass for the new eases; auto Bezier and roving keys left out) |
| Graph editor with value and speed graphs | Yes | No | Value graph with handles; no speed graph | Partly |
| Time remapping | Yes | No | `anim.time`: keyframes of seconds into the source (video and nested comps), toggled in the Inspector; `sourceAt` reads it for pictures and sound alike | Done (this pass; a freeze frame is two keys on one source time) |
| Time stretch, reverse, freeze frame | Yes | No | Speed and reverse per clip; a freeze is a 1 frame still (no one-click freeze) | Partly |
| Audio: mixing, levels, pans, waveforms, audio effects | Yes | No | Volume, pan, fades, waveforms, the Web Audio mixer; no audio effects | Partly |
| Export: H.264 MP4, GIF | Yes | Yes (`Mp4Encoder`, `GifEncoder`) | Export dialog: MP4, GIF, WebM (browser encoder), PNG frame, vector Lottie | Done |
| Export: ProRes, HEVC, AV1, WebM (VP9), image sequences, EXR, WAV | Yes | No | WebM comes from the browser's own encoder | Left out (needs those encoders on the WASM surface) |
| Lottie import | Yes | `inspectLottie` only describes the file | Inspect only; no import into the timeline | Left out (needs the engine's Lottie reader to hand back layers) |

## Needs a change inside the WASM engine itself (not attempted)

- Exposing the engine's layer compositor (shape layers, masks, mattes, 3D, layer styles, the
  38 blend modes) so render.ts can hand it a composition instead of drawing on a 2D canvas.
- The expression runtime.
- The ProRes, HEVC, AV1, VP9 and Opus encoders and image-sequence writers.
- A Lottie reader that returns layers (today it only returns names and warnings).

## Collaboration in Video

The shared collaboration layer (`engine/collab.ts`) is document-wide: the video editor runs on the
same document store (`editor.execute` with `sequence.set` commands), so the room, presence, version
history and sharing work without video-specific code.

| Feature | How it reaches Video | Status |
|---|---|---|
| Presence (who is here) | `PresenceBar` in the Inspector's header (`components/video/inspector.tsx`) | Works |
| Sharing (links, roles, requests) | `ShareButton` in the Inspector's header | Works |
| Version history | `VersionHistoryPanel` replaces the Inspector while `historyOpen`; File ▸ Save to version history | Works |
| Live edits from others | Every edit is a document command, so the room applies them like any other | Works |
| Cursors | Design's cursors are world coordinates on the canvas; the monitor has no cursor layer | Not shown in Video (left out: the timeline and monitor would each need their own cursor space) |
| Comments | Were missing: no comment tool, no pins on the monitor, no Comments panel. Now: a Comment button on the monitor (⇧ C), pins and threads drawn over the monitor (`VideoCommentLayer`, anchored to the composition's pixels with the page id `video:<comp>`), and the Comments panel in the Inspector while commenting. `goToComment` opens the composition a comment is on | Fixed (this pass) |
