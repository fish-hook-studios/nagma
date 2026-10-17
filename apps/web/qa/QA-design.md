# QA: Design editor

Exploratory and scripted QA of the Design editor (tools, canvas, layers, pages, right panel,
clipboard, menus and shortcuts, import and export, rendering, performance) in the running web app
(Vite dev build on :5231, a scratch sync server on :48811, Chrome in the built-in browser at
1440×900 and 1024×768, dark and light themes). Branch `feature/qa-design`.

How it was tested: real clicks, drags, typing and key presses where the browser tool could send
them; where it couldn't (modifier drags, keys whose character ⌥ or ⇧ changes on a Mac, clipboard
events, file drops), events were dispatched to the same elements with the values a Mac keyboard and
mouse send, and the result read from the editor state (`window.nagma`) and the DOM. Three sweeps
covered every relevant item at once:

- **Shortcut sweep**: each of the 86 menu actions that has a shortcut, run once by its Mac key event
  and once from the menu from the same starting document; both must change something, identically.
- **Action sweep**: every menu action (136) on ten kinds of selection (rectangle, two, three, group,
  layer in a group, line, main component, instance, text, nothing), 1,079 runs: no exception or
  console error, **one** ⌘Z restores the document exactly, ⇧⌘Z re-applies it. A second pass listed
  items that are enabled but do nothing.
- **Render sweep**: the canvas renderer (PNG export) against the SVG export, pixel by pixel, for
  shapes, strokes, gradients, effects, masks, opacity and blend modes, and for 50 components of an
  imported 23,000-layer design system.

Totals: **397 test rows: 349 pass, 48 fail (every fail fixed and re-verified)**. 23 bugs found
(3 S1, 5 S2, 11 S3, 4 S4), all fixed, with regression tests: 42 Vitest tests in 12 files
(`apps/web/src/**/*.test.ts`, jsdom). Type-check clean, oxlint 0 errors.

## 1. Test matrix

FAIL rows failed before the fix in the last column; each passes now.

| # | Area | Steps | Expected | Actual (before any fix) | Result | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Tools | Rectangle tool R, drag on canvas | Rect created at drag box, selected, tool back to Move | As expected | PASS |  |
| 2 | Tools | Frame tool F, drag | Frame created | As expected | PASS |  |
| 3 | Tools | Ellipse O, drag inside frame | Ellipse parented to frame | Parent = frame | PASS |  |
| 4 | Tools | Line L, drag | Vector "Line" from start to end | As expected | PASS |  |
| 5 | Tools | Arrow ⇧L, drag | Vector "Arrow" with end cap | As expected | PASS |  |
| 6 | Tools | Text T, click, type "Hello world", Esc | Auto-width text layer named after its text, selected after Esc | As expected | PASS |  |
| 7 | Undo | ⌘Z x13 after creating 6 layers | All layers removed, history back to 0 | As expected | PASS |  |
| 8 | Undo | ⇧⌘Z x13 | All layers back with same ids and positions | As expected | PASS |  |
| 9 | Persistence | Reload page after edits | Same file reopens with all layers | As expected | PASS |  |
| 10 | Shortcuts | ⌥/ remove fill with Mac key event (key "÷") | Fills removed | Nothing happened | FAIL | 2629968 |
| 11 | Shortcuts | ⇧/ remove stroke (key "?") | Strokes removed | Nothing happened | FAIL | 2629968 |
| 12 | Shortcuts | ⌥⌘A select matching layers (key "å") | Matching layers selected | Nothing (code needed ⇧ too) | FAIL | 2629968 |
| 13 | Shortcuts | ⇧⌘\ minimize UI (key is the vertical bar) | UI minimized | Nothing happened | FAIL | 2629968 |
| 14 | Shortcuts | ⌥⌘\ multiplayer cursors (key "«") | Pref toggled | Nothing | FAIL | 2629968 |
| 15 | Shortcuts | Duplicate by its Mac key event (⌘ D) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 16 | Shortcuts | Rename… by its Mac key event (⌘ R) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 17 | Shortcuts | Delete by its Mac key event (⌫) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 18 | Shortcuts | Find… by its Mac key event (⌘ F) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 19 | Shortcuts | Find and replace… by its Mac key event (⇧ ⌘ F) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 20 | Shortcuts | Copy properties by its Mac key event (⌥ ⌘ C) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 21 | Shortcuts | Paste properties by its Mac key event (⌥ ⌘ V) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 22 | Shortcuts | Pick color by its Mac key event (⌃ C) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 23 | Shortcuts | Select all by its Mac key event (⌘ A) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 24 | Shortcuts | Select matching layers by its Mac key event (⌥ ⌘ A) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 25 | Shortcuts | Select none by its Mac key event (Esc) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 26 | Shortcuts | Select inverse by its Mac key event (⇧ ⌘ A) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 27 | Shortcuts | Pixel grid by its Mac key event (⌘ ') vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 28 | Shortcuts | Layout guides by its Mac key event (⌃ G) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 29 | Shortcuts | Rulers by its Mac key event (⇧ R) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 30 | Shortcuts | Outlines by its Mac key event (⇧ ⌘ O) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 31 | Shortcuts | Pixel preview by its Mac key event (⌃ P) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 32 | Shortcuts | Comments by its Mac key event (⇧ C) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 33 | Shortcuts | Add comment by its Mac key event (C) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 34 | Shortcuts | Show/Hide UI by its Mac key event (⌘ \) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 35 | Shortcuts | Minimize UI by its Mac key event (⇧ ⌘ \) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 36 | Shortcuts | Multiplayer cursors by its Mac key event (⌥ ⌘ \) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 37 | Shortcuts | Collapse layers by its Mac key event (⌥ L) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 38 | Shortcuts | Zoom in by its Mac key event (⌘ +) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 39 | Shortcuts | Zoom out by its Mac key event (⌘ −) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 40 | Shortcuts | Zoom to 100% by its Mac key event (⌘ 0) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 41 | Shortcuts | Zoom to fit by its Mac key event (⇧ 1) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 42 | Shortcuts | Zoom to selection by its Mac key event (⇧ 2) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 43 | Shortcuts | Zoom to next frame by its Mac key event (N) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 44 | Shortcuts | Zoom to previous frame by its Mac key event (⇧ N) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 45 | Shortcuts | Group selection by its Mac key event (⌘ G) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 46 | Shortcuts | Ungroup selection by its Mac key event (⇧ ⌘ G) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 47 | Shortcuts | Frame selection by its Mac key event (⌥ ⌘ G) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 48 | Shortcuts | Wrap in new section by its Mac key event (⌘ S) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 49 | Shortcuts | Resize to fit by its Mac key event (⌥ ⇧ ⌘ R) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 50 | Shortcuts | Use as mask by its Mac key event (⌃ ⌘ M) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 51 | Shortcuts | Add auto layout by its Mac key event (⇧ A) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 52 | Shortcuts | Suggest auto layout by its Mac key event (⌃ ⇧ A) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 53 | Shortcuts | Remove auto layout by its Mac key event (⌥ ⇧ A) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 54 | Shortcuts | Create component by its Mac key event (⌥ ⌘ K) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 55 | Shortcuts | Detach instance by its Mac key event (⌥ ⌘ B) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 56 | Shortcuts | Bring to front by its Mac key event (]) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 57 | Shortcuts | Bring forward by its Mac key event (⌘ ]) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 58 | Shortcuts | Send backward by its Mac key event (⌘ [) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 59 | Shortcuts | Send to back by its Mac key event ([) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 60 | Shortcuts | Flip horizontal by its Mac key event (⇧ H) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 61 | Shortcuts | Flip vertical by its Mac key event (⇧ V) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 62 | Shortcuts | Flatten by its Mac key event (⌘ E) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 63 | Shortcuts | Outline stroke by its Mac key event (⌥ ⌘ O) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 64 | Shortcuts | Edit points by its Mac key event (↵) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 65 | Shortcuts | Union selection by its Mac key event (⌥ ⇧ U) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 66 | Shortcuts | Subtract selection by its Mac key event (⌥ ⇧ S) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 67 | Shortcuts | Intersect selection by its Mac key event (⌥ ⇧ I) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 68 | Shortcuts | Exclude selection by its Mac key event (⌥ ⇧ E) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 69 | Shortcuts | Show/Hide selection by its Mac key event (⇧ ⌘ H) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 70 | Shortcuts | Lock/Unlock selection by its Mac key event (⇧ ⌘ L) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 71 | Shortcuts | Remove fill by its Mac key event (⌥ /) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 72 | Shortcuts | Remove stroke by its Mac key event (⇧ /) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 73 | Shortcuts | Swap fill and stroke by its Mac key event (⇧ X) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 74 | Shortcuts | Bold by its Mac key event (⌘ B) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 75 | Shortcuts | Italic by its Mac key event (⌘ I) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 76 | Shortcuts | Underline by its Mac key event (⌘ U) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 77 | Shortcuts | Strikethrough by its Mac key event (⇧ ⌘ X) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 78 | Shortcuts | Create link by its Mac key event (⇧ ⌘ U) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 79 | Shortcuts | Bulleted list by its Mac key event (⇧ ⌘ 8) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 80 | Shortcuts | Numbered list by its Mac key event (⇧ ⌘ 7) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 81 | Shortcuts | Text align left by its Mac key event (⌥ ⌘ L) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 82 | Shortcuts | Text align center by its Mac key event (⌥ ⌘ T) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 83 | Shortcuts | Text align right by its Mac key event (⌥ ⌘ R) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 84 | Shortcuts | Increase font size by its Mac key event (⇧ ⌘ >) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 85 | Shortcuts | Decrease font size by its Mac key event (⇧ ⌘ <) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 86 | Shortcuts | Increase font weight by its Mac key event (⌥ ⌘ >) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 87 | Shortcuts | Decrease font weight by its Mac key event (⌥ ⌘ <) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 88 | Shortcuts | Align left by its Mac key event (⌥ A) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 89 | Shortcuts | Align horizontal centers by its Mac key event (⌥ H) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 90 | Shortcuts | Align right by its Mac key event (⌥ D) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 91 | Shortcuts | Align top by its Mac key event (⌥ W) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 92 | Shortcuts | Align vertical centers by its Mac key event (⌥ V) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 93 | Shortcuts | Align bottom by its Mac key event (⌥ S) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 94 | Shortcuts | Tidy up by its Mac key event (⌃ ⌥ T) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 95 | Shortcuts | Distribute horizontal spacing by its Mac key event (⌃ ⌥ H) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 96 | Shortcuts | Distribute vertical spacing by its Mac key event (⌃ ⌥ V) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 97 | Shortcuts | Snap to pixel grid by its Mac key event (⇧ ⌘ ') vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 98 | Shortcuts | Keyboard shortcuts by its Mac key event (⌃ ⇧ ?) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 99 | Shortcuts | Inspect by its Mac key event (⇧ D) vs the same menu action, from the same start | Same effect as the menu item | Same effect | PASS |  |
| 100 | Selection | Click empty canvas, ⌘A | All visible unlocked layers on the page selected | The page node itself was selected (right panel showed a 1×1 "Page") | FAIL | c506c1d |
| 101 | Selection | ⌘A then ⌫ with nothing selected | Every layer on the page deleted, page stays | The page was deleted with all its layers (file showed nothing) | FAIL | c506c1d |
| 102 | Selection | Page id in selection then Delete | Nothing deleted | Page deleted | FAIL | c506c1d |
| 103 | Menus/Undo | Delete from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 104 | Menus/Undo | Copy properties from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 105 | Menus/Undo | Paste properties from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 106 | Menus/Undo | Select matching layers from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 107 | Menus/Undo | Select none from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 108 | Menus/Undo | Select all with same properties from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 109 | Menus/Undo | Select all with same fill from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 110 | Menus/Undo | Select all with same stroke from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 111 | Menus/Undo | Select all with same effect from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 112 | Menus/Undo | Select all with same text properties from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 113 | Menus/Undo | Select all with same font from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 114 | Menus/Undo | Select all with same instance from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 115 | Menus/Undo | Zoom to selection from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 116 | Menus/Undo | Ungroup selection from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 117 | Menus/Undo | Convert to section / frame from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 118 | Menus/Undo | Resize to fit from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 119 | Menus/Undo | Suggest auto layout from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 120 | Menus/Undo | Remove auto layout from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 121 | Menus/Undo | Detach instance from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 122 | Menus/Undo | Go to main component from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 123 | Menus/Undo | Reset all changes from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 124 | Menus/Undo | Bring to front from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 125 | Menus/Undo | Bring forward from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 126 | Menus/Undo | Send backward from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 127 | Menus/Undo | Send to back from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 128 | Menus/Undo | Flip horizontal from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 129 | Menus/Undo | Flip vertical from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 130 | Menus/Undo | Rotate 180° from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 131 | Menus/Undo | Rotate 90° left from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 132 | Menus/Undo | Rotate 90° right from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 133 | Menus/Undo | Flatten from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 134 | Menus/Undo | Outline stroke from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 135 | Menus/Undo | Split vector from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 136 | Menus/Undo | Create stretch brush from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 137 | Menus/Undo | Create scatter brush from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 138 | Menus/Undo | Apply transforms to selection from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 139 | Menus/Undo | Edit points from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 140 | Menus/Undo | Show/Hide selection from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 141 | Menus/Undo | Lock/Unlock selection from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 142 | Menus/Undo | Remove fill from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 143 | Menus/Undo | Remove stroke from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 144 | Menus/Undo | Swap fill and stroke from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 145 | Menus/Undo | Align left from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 146 | Menus/Undo | Align horizontal centers from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 147 | Menus/Undo | Align right from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 148 | Menus/Undo | Align top from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 149 | Menus/Undo | Align vertical centers from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 150 | Menus/Undo | Align bottom from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 151 | Menus/Undo | Tidy up from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 152 | Menus/Undo | Offset path… from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 153 | Menus/Undo | Find… from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 154 | Menus/Undo | Find and replace… from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 155 | Menus/Undo | Pick color from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 156 | Menus/Undo | Select all from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 157 | Menus/Undo | Select inverse from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 158 | Menus/Undo | Pixel grid from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 159 | Menus/Undo | Layout guides from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 160 | Menus/Undo | Rulers from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 161 | Menus/Undo | Outlines from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 162 | Menus/Undo | Pixel preview from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 163 | Menus/Undo | Property labels from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 164 | Menus/Undo | Comments from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 165 | Menus/Undo | Add comment from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 166 | Menus/Undo | Show/Hide comments from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 167 | Menus/Undo | Show/Hide UI from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 168 | Menus/Undo | Minimize UI from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 169 | Menus/Undo | Annotations from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 170 | Menus/Undo | Ready for development from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 171 | Menus/Undo | Multiplayer cursors from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 172 | Menus/Undo | Collapse layers from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 173 | Menus/Undo | Zoom in from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 174 | Menus/Undo | Zoom out from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 175 | Menus/Undo | Zoom to 100% from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 176 | Menus/Undo | Zoom to fit from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 177 | Menus/Undo | Zoom to next frame from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 178 | Menus/Undo | Zoom to previous frame from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 179 | Menus/Undo | Remove all interactions from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 180 | Menus/Undo | Snap to objects from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 181 | Menus/Undo | Snap to geometry from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 182 | Menus/Undo | Snap to pixel grid from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 183 | Menus/Undo | Keep tool selected after use from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 184 | Menus/Undo | Rename duplicated layers from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 185 | Menus/Undo | Hide canvas UI during changes from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 186 | Menus/Undo | Flip objects while resizing from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 187 | Menus/Undo | Highlight layers on hover from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 188 | Menus/Undo | Show dimensions on objects from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 189 | Menus/Undo | Invert zoom direction from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 190 | Menus/Undo | Use scroll wheel zoom from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 191 | Menus/Undo | Right-click and drag to pan from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 192 | Menus/Undo | Managed (file's profile) from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 193 | Menus/Undo | Unmanaged (sRGB) from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 194 | Menus/Undo | Accessibility settings… from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 195 | Menus/Undo | Smart symbols from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 196 | Menus/Undo | Use number keys for opacity from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 197 | Menus/Undo | Theme from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 198 | Menus/Undo | Nudge amount… from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 199 | Menus/Undo | Keyboard shortcuts from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 200 | Menus/Undo | Design mode from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 201 | Menus/Undo | Draw mode from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 202 | Menus/Undo | Motion mode from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 203 | Menus/Undo | Inspect from the menu on: rect, two rects, three layers, group, layer in group, line, main component, instance, text, nothing selected; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 204 | Menus/Undo | Union selection from the menu on: two rects, three layers; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 205 | Menus/Undo | Subtract selection from the menu on: two rects, three layers; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 206 | Menus/Undo | Intersect selection from the menu on: two rects, three layers; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 207 | Menus/Undo | Exclude selection from the menu on: two rects, three layers; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 208 | Menus/Undo | Distribute horizontal spacing from the menu on: three layers; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 209 | Menus/Undo | Distribute vertical spacing from the menu on: three layers; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 210 | Menus/Undo | Bold from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 211 | Menus/Undo | Italic from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 212 | Menus/Undo | Underline from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 213 | Menus/Undo | Strikethrough from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 214 | Menus/Undo | Create link from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 215 | Menus/Undo | Bulleted list from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 216 | Menus/Undo | Numbered list from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 217 | Menus/Undo | Left to right from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 218 | Menus/Undo | Right to left from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 219 | Menus/Undo | Text align left from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 220 | Menus/Undo | Text align center from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 221 | Menus/Undo | Text align right from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 222 | Menus/Undo | Increase font size from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 223 | Menus/Undo | Decrease font size from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 224 | Menus/Undo | Increase font weight from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 225 | Menus/Undo | Decrease font weight from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 226 | Menus/Undo | Uppercase from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 227 | Menus/Undo | Lowercase from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 228 | Menus/Undo | Title case from the menu on: text layer; then one ⌘Z and ⇧⌘Z | No exception or console error; one undo restores the document exactly; redo re-applies | As expected | PASS |  |
| 229 | Menus/Undo | Duplicate on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z | One undo restores the document and selection exactly; redo re-applies | First ⌘Z only put the selection back (the action's selection of what it made was its own step); a second ⌘Z was needed. Repeats on an existing group also folded in the previous unrelated edit | FAIL | bdb11ca |
| 230 | Menus/Undo | Group selection on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z | One undo restores the document and selection exactly; redo re-applies | First ⌘Z only put the selection back (the action's selection of what it made was its own step); a second ⌘Z was needed. Repeats on an existing group also folded in the previous unrelated edit | FAIL | bdb11ca |
| 231 | Menus/Undo | Frame selection on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z | One undo restores the document and selection exactly; redo re-applies | First ⌘Z only put the selection back (the action's selection of what it made was its own step); a second ⌘Z was needed. Repeats on an existing group also folded in the previous unrelated edit | FAIL | bdb11ca |
| 232 | Menus/Undo | Wrap in new section on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z | One undo restores the document and selection exactly; redo re-applies | First ⌘Z only put the selection back (the action's selection of what it made was its own step); a second ⌘Z was needed. Repeats on an existing group also folded in the previous unrelated edit | FAIL | bdb11ca |
| 233 | Menus/Undo | Use as mask on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z | One undo restores the document and selection exactly; redo re-applies | First ⌘Z only put the selection back (the action's selection of what it made was its own step); a second ⌘Z was needed. Repeats on an existing group also folded in the previous unrelated edit | FAIL | bdb11ca |
| 234 | Menus/Undo | Add auto layout on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z | One undo restores the document and selection exactly; redo re-applies | First ⌘Z only put the selection back (the action's selection of what it made was its own step); a second ⌘Z was needed. Repeats on an existing group also folded in the previous unrelated edit | FAIL | bdb11ca |
| 235 | Menus/Undo | Create component on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z | One undo restores the document and selection exactly; redo re-applies | First ⌘Z only put the selection back (the action's selection of what it made was its own step); a second ⌘Z was needed. Repeats on an existing group also folded in the previous unrelated edit | FAIL | bdb11ca |
| 236 | Menus/Undo | Add radial repeat on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z | One undo restores the document and selection exactly; redo re-applies | First ⌘Z only put the selection back (the action's selection of what it made was its own step); a second ⌘Z was needed. Repeats on an existing group also folded in the previous unrelated edit | FAIL | bdb11ca |
| 237 | Menus/Undo | Add linear repeat on: rect, two rects, three layers, group, layer in group, line, main component, instance, text; then one ⌘Z | One undo restores the document and selection exactly; redo re-applies | First ⌘Z only put the selection back (the action's selection of what it made was its own step); a second ⌘Z was needed. Repeats on an existing group also folded in the previous unrelated edit | FAIL | bdb11ca |
| 238 | Menus | Simplify path… on rect, two rects, layer in group | Dialog with live preview; Cancel restores; Simplify is one step | Preview until confirmed, as designed | PASS |  |
| 239 | Tools | Click with R, O, F, L, S (slice), ⇧S (section) on empty canvas | 100×100 layer (line 100 long) with its top-left at the click | As expected | PASS |  |
| 240 | Tools | F then click after a preset frame was added | Frame of the last size (393×852) | As expected | PASS |  |
| 241 | Tools | Frame presets panel: iPhone 16 | 393×852 frame named iPhone 16, selected, Move tool back | As expected | PASS |  |
| 242 | Tools | ⇧ drag with Rectangle | Square | 150×150 | PASS |  |
| 243 | Tools | ⌥ drag with Ellipse | Drawn from the centre | Centre at the press point | PASS |  |
| 244 | Tools | ⇧⌥ drag with Rectangle | Square from the centre | As expected | PASS |  |
| 245 | Tools | ⇧ drag with Line at 22° | Snaps to 0° | Horizontal | PASS |  |
| 246 | Text | Drag with Text tool | Fixed-width box, editing starts | 180 wide, auto height, editing | PASS |  |
| 247 | Text | IME composition (compositionstart, updates, Enter while composing, compositionend) | Only the committed text is inserted once; Enter during composition doesn't commit the box | "日本" inserted once, still editing | PASS |  |
| 248 | Text | Type, ⇧⌥← select word, ⌘B | Bold span on the word only | fontWeight 700 on 8–12 | PASS |  |
| 249 | Text | ⌘Z inside text editing (bold, then typing) | Undoes bold, then the typed run as one step; stays editing | As expected | PASS |  |
| 250 | Text | ⇧⌘Z then Esc | Redo; leaves editing with the layer selected | As expected | PASS |  |
| 251 | Canvas | Drag a layer | Moves by the drag | As expected | PASS |  |
| 252 | Canvas | ⇧ drag a layer | Locks to the dominant axis | y unchanged | PASS |  |
| 253 | Canvas | ⌥ drag a layer | Copy left at the start, copy moved | As expected | PASS |  |
| 254 | Canvas | ⌘D after ⌥ drag, twice | Each copy repeats the last offset | +120 y each time | PASS |  |
| 255 | Canvas | Resize from a corner handle | Size follows | 150×140 | PASS |  |
| 256 | Canvas | ⇧ resize corner | Keeps proportion | ratio kept | PASS |  |
| 257 | Canvas | ⌥ resize edge | Resizes from the centre | Both sides grew 20 | PASS |  |
| 258 | Canvas | Drag just outside a corner | Rotates | 11.78° | PASS |  |
| 259 | Canvas | Marquee from empty canvas across part of a layer | Selects layers it touches | Ellipse selected | PASS |  |
| 260 | Canvas | Marquee starting on a top-level frame's empty area | Selects the frame's children it touches | Inner rect selected | PASS |  |
| 261 | Canvas | Click a layer nested two frames deep | Selects the layer (frames don't need deep select) | As expected | PASS |  |
| 262 | Canvas | ⇧↵ twice, ↵, Tab, ⇧Tab | Parent, grandparent, children, next sibling, previous sibling | As expected | PASS |  |
| 263 | Canvas | Wheel (no modifier) | Pans vertically | y -100 | PASS |  |
| 264 | Canvas | ⇧ wheel | Pans horizontally | x -100 | PASS |  |
| 265 | Canvas | Pinch (ctrl+wheel) and ⌘ wheel | Zooms about the pointer | World point under the pointer unchanged | PASS |  |
| 266 | Canvas | Zoom limits | Clamp at 25600% and 2% | 256 and 0.02 | PASS |  |
| 267 | Clipboard | ⌘D on a top-level frame with children | Copy beside it with its contents | Copy frame empty: contents stayed at the original place, clipped | FAIL | 1c55d94 |
| 268 | Clipboard | ⌘C a layer in frame A, select frame B, ⌘V | Lands at the same place inside B | Landed at A-relative page coordinates, outside B (invisible) | FAIL | 1c55d94 |
| 269 | Clipboard | ⌘C a page layer, select a frame that can't hold it, ⌘V | Centred in the frame | Landed outside the frame | FAIL | 1c55d94 |
| 270 | Clipboard | ⇧⌘R paste to replace with a copied frame | Frame takes the replaced layer's place with its contents | Contents left behind | FAIL | 1c55d94 |
| 271 | Clipboard | ⌘C, ⌘V with nothing selected | Copy in place on top, selected | As expected | PASS |  |
| 272 | Clipboard | ⌘V twice | Two copies, numbered names | Rectangle 4, Rectangle 5 | PASS |  |
| 273 | Clipboard | ⌘Z after paste | Paste removed in one step | As expected | PASS |  |
| 274 | Layers | Drag a row above the top row | Layer moves to the front | As expected | PASS |  |
| 275 | Layers | ⌘Z after reorder | Order restored | As expected | PASS |  |
| 276 | Layers | Drag a row onto a group row's middle | Layer moves into the group without moving on the canvas; group grows | As expected | PASS |  |
| 277 | Layers | Double-click a row, Esc | Rename field opens, Esc cancels | As expected | PASS |  |
| 278 | Layers | Double-click a row, click away | Rename commits on blur | As expected | PASS |  |
| 279 | Layers | Keyboard: Tab into the layer list | Rows reachable as a tree, one Tab stop | Rows were plain divs with no role or focus; only the chevron buttons were reachable | FAIL | 5ffb21a |
| 280 | Layers | Keyboard: ↑ ↓ ⇧↓ Home End in the tree | Move focus and selection, ⇧ extends | Not possible before; now as expected | FAIL | 5ffb21a |
| 281 | Layers | Keyboard: → ← on a group row | Open/close, then child/parent | Not possible before; now as expected | FAIL | 5ffb21a |
| 282 | Layers | Keyboard: Space, Return/F2 on a row | Toggle selection, rename | Not possible before; now as expected | FAIL | 5ffb21a |
| 283 | Layers | Click a row then press → | Arrow nudges the layer on the canvas (focus not taken by the row) | As expected | PASS |  |
| 284 | Layers | ⌘R with 3 layers, "Item $nn", Return | Item 1, Item 2, Item 3 in selection order; preview lists all | As expected | PASS |  |
| 285 | Layers | ⌘R then typing immediately | Keys go to the Rename to field | Field focused one frame late, first keys fired canvas shortcuts (tool keys, N zoomed) | FAIL | f815cca |
| 286 | Layers | ⌘Z after batch rename | All names back in one step | As expected | PASS |  |
| 287 | Pages | + Add page | New page "Page N" shown, name field ready to type | Page added but not in rename mode | FAIL | f815cca |
| 288 | Pages | Type a name, Return | Page renamed | As expected | PASS |  |
| 289 | Pages | Right-click Page 1 (10 layers) › Delete page | Confirm dialog naming the layer count | "Its 10 layers will be deleted too. You can undo this." | PASS |  |
| 290 | Pages | Confirm delete | Page removed, view moves to another page, toast with Undo | As expected | PASS |  |
| 291 | Pages | ⌘Z after page delete | Page back in its place with its 10 layers | As expected | PASS |  |
| 292 | Pages | Drag the last page to the top, ⌘Z | Reordered, undo restores | As expected | PASS |  |
| 293 | Keyboard | F6 ×4 | Toolbar → left panel → canvas → right panel → toolbar | As expected | PASS |  |
| 294 | Performance | Create 2,000 layers on a page in one batch | No freeze | Execute 19.5 ms; first paint about 1.9 s (layer list mount, dev build) | PASS |  |
| 295 | Performance | 2,000 layers: select one layer (main-thread cost incl. React commit) | Under ~50 ms | 150–180 ms before; 45–80 ms after (dev build, StrictMode); 17–40 ms with the left panel closed | FAIL | 79be81b |
| 296 | Performance | 2,000 layers: nudge with → | Responsive | 153 ms before; about 70 ms after (dev) | FAIL | 79be81b |
| 297 | Performance | 2,000 layers: ⌘A | Responsive | 144–185 ms (dev); acceptable for a one-off | PASS |  |
| 298 | Performance | 2,000 layers: hover change | Cheap | 1–16 ms React; canvas frame about 50 ms at 30% zoom with every layer visible | PASS |  |
| 299 | Performance | 2,000 layers: pan and zoom (camera change) | No long tasks | 0.3–5 ms, no task over 50 ms at 30%, 100%, 400% | PASS |  |
| 300 | Performance | 2,000 layers: drag a layer (10 pointer moves) | Smooth | 11–32 ms per move with the layer list open, 7–25 ms closed | PASS |  |
| 301 | Right panel | X field "100+20" | Evaluates to 120 | 120 | PASS |  |
| 302 | Right panel | W field "(390-32)/2" | 179 | 179 | PASS |  |
| 303 | Right panel | W field "abc" | Rejected, value kept | Kept 179 | PASS |  |
| 304 | Right panel | W field "-50" and "0" | Clamped to the minimum | 1 | PASS |  |
| 305 | Right panel | H field "1e9" | Accepted without errors | 1,000,000,000, no console errors | PASS |  |
| 306 | Right panel | X field emptied | Value kept | Kept | PASS |  |
| 307 | Right panel | Hex field: FF0000, #00ff00, f00, #abc, padded "  #123456  " | Normalised 6-digit colour | As expected | PASS |  |
| 308 | Right panel | Hex field: 12345, zzzzzz, rgb(), red, 8-digit, empty | Rejected, colour kept | Kept | PASS |  |
| 309 | Right panel | Fill row shows the hex value | Full 6 digits | "0000" (cut; variable button took the space) at 1440 and 1024 wide | FAIL | eb04ee5 |
| 310 | Right panel | Add fill, Add stroke | Second fill D9D9D9, stroke 000000 1px | As expected | PASS |  |
| 311 | Right panel | Add effect menu: Drop shadow, Inner shadow, Layer blur, Background blur, Noise, Texture, Glass, Shader | Each adds its effect; one ⌘Z removes it | As expected (8 of 8) | PASS |  |
| 312 | Right panel | Add export setting | PNG 1x row | As expected | PASS |  |
| 313 | Export | Export frame as PNG via the panel | Valid PNG 400×300 | 89504E47…, 400×300, 4383 bytes | PASS |  |
| 314 | Export | JPG | Valid JPEG 400×300 | FFD8FF…, 400×300 | PASS |  |
| 315 | Export | SVG | Valid SVG with the frame's children at the right places | Rect at 150,350 and ellipse inside clip paths, viewBox 0 0 400 300 with translate(-100 -300) | PASS |  |
| 316 | Export | PDF | Valid PDF page 400×300 | %PDF-1.3, MediaBox 400×300 | PASS |  |
| 317 | Export | Size presets 2x, 0.5x, 512w | 800×600, 200×150, 512×384 | As expected | PASS |  |
| 318 | Clipboard | Paste SVG markup as text | Frame "SVG" with rect, ellipse and path | As expected; ⌘Z removes all | PASS |  |
| 319 | Clipboard | Paste plain multi-line text | Text layer named after the first line | As expected | PASS |  |
| 320 | Clipboard | Paste broken SVG | Message, nothing created | "That SVG couldn't be read." | PASS |  |
| 321 | Import | Drop a PNG file on the canvas | Rectangle with an image fill at the drop point, named after the file | 64×48 "red" centred on the drop | PASS |  |
| 322 | Right panel | Image paint: Rotate 90°, Tile, Exposure 50, ⌘Z | Rotation 90, mode tile, adjusted copy made; undo restores the original image | As expected | PASS |  |
| 323 | Theme | Light theme at 1024×768 with text and frame selected | Readable panels, toolbar fits the canvas | As expected | PASS |  |
| 324 | Components | Change the main component's child fill | Instance follows | As expected | PASS |  |
| 325 | Components | Override instance child fill, then change main again | Override kept | As expected | PASS |  |
| 326 | Components | Reset all changes, ⌘Z | Back to main's colour; undo brings override back | As expected | PASS |  |
| 327 | Components | Detach instance | Frame with copies of its children at the instance's place | As expected | PASS |  |
| 328 | Boolean | Union/Subtract/Intersect/Exclude of two overlapping rects, then Flatten | Correct bounds and point counts (8, 6, 4, 2×6) | As expected | PASS |  |
| 329 | Text | Auto width, typed W (switches to fixed width), Auto height + W 40 (wraps taller), Fixed size H 10, Truncate | Sizing modes behave | As expected | PASS |  |
| 330 | Tools | Pen: 3 clicks, Return | Open 3-point vector, Move tool back | As expected | PASS |  |
| 331 | Tools | Pen: click back on the first point | Closed path, drawing ends | As expected | PASS |  |
| 332 | Tools | Pencil drag | Vector "Pencil" | As expected | PASS |  |
| 333 | Tools | Polygon and Star drag, ⇧ drag, click | Parametric 3-gon / 5-point star, ⇧ keeps square, click 100×100 | As expected | PASS |  |
| 334 | Naming | Draw Line, Line, Arrow, Polygon, Star, Star | Line 1, Line 2, Arrow 1, Polygon 1, Star 1, Star 2 | All named Line, Line, Arrow, Polygon, Star, Star | FAIL | 83ccd58 |
| 335 | Import | Drop "Design System v0.3.fig" (190 KB) on the canvas | Opens as a new file, "Opened …" message | New file (11 pages, 1,124 layers, components, sets, instances, missing fonts noted) but the message was "Those files aren't images Nagma can open." | FAIL | 5b74b91 |
| 336 | Import | Drop "Simple Design System.fig" (8 MB) | Opens | 2.4 s; 31 pages, 22,959 layers, 2,728 components, 6,207 instances, 16 images, 12 variable collections, 12/279/21 colour/text/effect styles; no console errors | PASS |  |
| 337 | Performance | Imported 5,062-layer page: select a layer | Responsive | 75–100 ms main thread (dev build); canvas frame 60–75 ms at fit zoom | PASS |  |
| 338 | Menus | Actions palette ⌘K, type "flip hor", Return | Flip horizontal runs, palette closes | As expected | PASS |  |
| 339 | Menus | Main menu / palette: Go to main component, Detach, Reset with a rectangle selected | Disabled (hidden in the palette) | Enabled; Go to main component said "The main component for this instance was deleted." | FAIL | c63c498 |
| 340 | Menus | Ungroup / Remove auto layout / Resize to fit / Convert to section / Edit points on layers they can't apply to | Disabled | Enabled, did nothing | FAIL | c63c498 |
| 341 | Layers | ⌘R on a layer, then switch page before finishing | Rename request dropped | Row reopened in rename mode whenever it next showed | FAIL | c63c498 |
| 342 | Canvas | Drag from the top ruler, from the left ruler | Horizontal guide at y 200, vertical at x 250 | As expected | PASS |  |
| 343 | Canvas | Drag a guide, drag it back onto the ruler, ⌘Z | Moves, removed, comes back | As expected | PASS |  |
| 344 | Canvas | Snap to pixel grid on, move by 10.33 px at 300% | Lands on whole pixels | 60, 55 | PASS |  |
| 345 | Canvas | Snapping off | Fractional position | 70.33, 60.33 | PASS |  |
| 346 | Canvas | Drag a layer to 3 px from another's edge | Snaps edge to edge | Snapped | PASS |  |
| 347 | Canvas | ⌃ drag | No snapping | Stayed 3 px off | PASS |  |
| 348 | Canvas | Click a locked layer | Selects what is under it, not the locked layer | As expected | PASS |  |
| 349 | Canvas | Click / marquee over a hidden layer | Not selected | As expected | PASS |  |
| 350 | Tools | Hand tool drag, Space+drag | Pans | As expected | PASS |  |
| 351 | Keyboard | ⌥Space, ⇧← ×3, Return | Selection box, moves, selects what it touches | Frame selected | PASS |  |
| 352 | Comments | C, click near the canvas's right edge | Composer inside the canvas | Composer ran under the Comments panel (cut off) | FAIL | 60bd0e8 |
| 353 | Comments | Click near the bottom right, type, Post | Composer and thread above the toolbar, thread opens | Before: under the toolbar; now as expected; thread listed in the panel | FAIL | 60bd0e8 |
| 354 | Clipboard | Copy as PNG (frame) | PNG on the clipboard | image/png 13 KB, "PNG copied." | PASS |  |
| 355 | Clipboard | Copy as SVG | SVG text | <svg … 400×300> | PASS |  |
| 356 | Clipboard | Copy as CSS | CSS text | width/height/background/overflow | PASS |  |
| 357 | Clipboard | Copy as iOS (SwiftUI) | SwiftUI snippet | Rectangle().fill().frame() | PASS |  |
| 358 | Clipboard | Copy as Android (Compose) | Compose snippet | Box(modifier …) | PASS |  |
| 359 | Clipboard | Copy as text (text layer) | Its characters | "Sweep text sample" | PASS |  |
| 360 | Clipboard | Copy link to selection in a local (unshared) file | A link that opens this layer, or a message | "Link to selection copied." with a link that has no file id and a network host: it opens another file | FAIL | 4ca0df8 |
| 361 | Pages | Copy link to page in a local file | Same | Same broken link | FAIL | 4ca0df8 |
| 362 | Auto layout | ⇧A on three loose layers | Wrapped in an auto layout frame, ordered by position, one undo step | Horizontal, hug, gap 0 (overlapping layers) | PASS |  |
| 363 | Auto layout | Gap field 20 (typed) | Gap 20, children re-laid | As expected | PASS |  |
| 364 | Auto layout | Horizontal padding field 24 (typed) | Left and right padding 24, frame grows to 488 | As expected | PASS |  |
| 365 | Constraints | Child Right/Bottom, frame resized +100/+50 from the corner | Child moves +100/+50 | As expected | PASS |  |
| 366 | Constraints | Child Scale/Center | Scales horizontally, stays centred vertically | x 350, w 187.5, y 375 | PASS |  |
| 367 | Constraints | ⌘ resize the frame | Children stay put | As expected | PASS |  |
| 368 | Constraints | ⌘Z after a constrained resize | Frame and children back | As expected | PASS |  |
| 369 | Canvas | →, ⇧↓, ⌘→, ⇧⌘↓, ⌘← | Nudge 1, nudge 10, width +1, height +10, width −1 | As expected | PASS |  |
| 370 | Styles | Create colour style from paint and apply to two layers | Both follow the style | As expected | PASS |  |
| 371 | Styles | Edit the style's colour | Both update | As expected | PASS |  |
| 372 | Styles | Detach one, edit style again | Detached keeps its colour | As expected | PASS |  |
| 373 | Styles | Delete style | Layers keep the last colour, unlinked | As expected | PASS |  |
| 374 | Styles | ⌘Z ×4 | Back to the applied style | As expected | PASS |  |
| 375 | Variables | Bind colour variable to a fill | Fill takes the variable's value | #111111 | PASS |  |
| 376 | Variables | Change the variable's value | Fill follows | #222222 | PASS |  |
| 377 | Variables | Add Dark mode, set layer mode to Dark | Fill takes the Dark value; SVG export uses it | #EEEEEE in both | PASS |  |
| 378 | Tools | Section drawn around two rectangles, ⌘Z | Section adopts them; one undo removes both | As expected | PASS |  |
| 379 | Right panel | Two layers selected with different W and fills | W "Mixed"; Fill "Mixed. Click + to replace them." | As expected | PASS |  |
| 380 | Export | Slice over part of a layer, PNG | 180×120 with what lies under it | Correct pixels inside and transparent outside | PASS |  |
| 381 | Tools | Frame tool + (after) on a frame with contents | Copy with contents beside it, one undo | Copy correct, but named "Frame 1" like the original | FAIL | cdcccfb |
| 382 | Canvas | Number keys 5, 0, 1, then 5 5 quickly, 0 5 | 50%, 100%, 10%, 55%, 5% | As expected | PASS |  |
| 383 | Text | Double-click a word in a text layer, type | Edits with that word selected; typing replaces it | "X text sample"; ⌘Z restores | PASS |  |
| 384 | Collaboration | A collaborator's delete arrives, then a local drag of that layer ends | Edit dropped, no error | "Cannot read properties of undefined (reading 'filter')" thrown from the tree repair; gesture broken | FAIL | 996fd70 |
| 385 | Stroke | Add stroke, Stroke sides › Top | Only the top side | strokeSides top only; canvas and SVG correct | PASS |  |
| 386 | Stroke | Advanced stroke › Stroke style Dashed on a top-only stroke, SVG export | Dashed top line only | Canvas right; SVG dashed all four sides | FAIL | f98fbb2 |
| 387 | Export | Canvas renderer vs SVG export for plain, radius, per-corner radii, inside/outside/centre strokes, dashes, sides, custom weights, rotation, flip, linear/radial gradients, opacity, paint opacity | Same picture | Mean difference 0–0.85/255, under 1.5% of pixels off | PASS |  |
| 388 | Export | PNG/SVG of a layer with a drop shadow from the Effects list | Export includes the shadow | Cut at the layer's edge (120×80); now 138×98 in PNG, SVG and PDF | FAIL | 85d292d |
| 389 | Export | Frame with Clip content off and a child hanging out | Export shows the child | Cut at the frame's edge | FAIL | 85d292d |
| 390 | Export | PDF of a layer with a shadow | Page the SVG's size | Page was the layer's box, SVG squeezed into it | FAIL | c68621e |
| 391 | Export | Inner shadow, layer blur: canvas vs SVG | Close | 6% of pixels differ by more than 48/255 at the edges (different blur kernels); left as is | PASS |  |
| 392 | Rendering | Canvas vs SVG: ellipse, arc, star, polygon, line, arrow, clipping frame, multiply blend | Same picture | 0–0.45 mean difference | PASS |  |
| 393 | Rendering | Group at 50% with two overlapping rectangles (pass through) | Group fades as a whole: overlap shows only the top colour at 50% | Canvas/PNG faded each child (overlap mixed red and blue); SVG faded as a whole | FAIL | ee4bfb2 |
| 394 | Export | SVG of an alpha mask with a black ellipse | Content shows inside the ellipse | Nothing shown (SVG masks read luminance) | FAIL | ee4bfb2 |
| 395 | Rendering | Luminance mask: black, white, grey shapes | Black hides, white shows, grey half | Canvas treated it as alpha (black showed everything) | FAIL | ee4bfb2 |
| 396 | Export | Text: canvas vs SVG in an image element | Close | 7–15% of pixels differ (the SVG image can't load web fonts); expected for that harness, not a product bug | PASS |  |
| 397 | Rendering | Canvas vs SVG on 50 sampled components and instances (no text) from the imported Simple Design System file | Same pictures | 49 identical; 1 differed only because the harness didn't inline the image (identical once inlined, as the real export does) | PASS |  |

## 2. Bugs

| ID | Sev | Bug and repro | Root cause | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| D1 | S1 | Click empty canvas, ⌘A: the page itself is selected (the Design panel shows a 1×1 "Page"); then ⌫ deletes the page with every layer on it. | `selectAll` used `doc.roots` (the page list) as its scope when nothing was selected; `deleteSelection` acted on pages like layers. | Scope is the active page's layers; `selected()` never returns pages. c506c1d | `engine/actions.test.ts` |
| D2 | S1 | ⌘D on a top-level frame with layers: the copy looks empty; its layers sit at the original position, clipped. Same for paste of a frame and Paste to replace. | Layers store page-space coordinates, but `placeCopies` and `pasteToReplace` moved only the copied root. | Every copied layer moves with its root. 1c55d94 | `engine/clipboard.test.ts` |
| D3 | S1 | A collaborator deletes a layer while you drag or edit it here: on release the editor throws "Cannot read properties of undefined (reading 'filter')", the edit is lost; the sync server kept a typeless layer in the stored file. | `execute` replays the gesture's diff onto the latest document; `applyPatch` merged a partial change into a missing layer, creating a node with no type or children, and `repairTree` threw. The server's `applyPatch` did the same. | Partial changes to missing layers are dropped (editor and server). 996fd70 | `engine/patch.test.ts` |
| D4 | S2 | Copy a layer from frame A, select frame B, ⌘V: the copy lands outside B (invisible); a page layer pasted into a frame that can't hold it isn't centred. | The fit check compared page coordinates with the frame's size, as if they were frame-relative. | Keep the offset from the source container, centre on any axis the target can't hold. 1c55d94 | `engine/clipboard.test.ts` |
| D5 | S2 | ⌘G then ⌘Z leaves the group (only the selection goes back); same for frame selection, section, component, mask, add auto layout, duplicate, paste. | Each action executed its edit, then set the selection, which the store recorded as a separate selection-only undo step. Callers using `mergeLast` merged the wrong pair; Add repeat on an existing group merged the previous unrelated edit. | A selection set in the same task as an edit joins that edit's step; auto layout and component fold their wrapping frame in; repeat merges only its own grouping. bdb11ca | `engine/store-undo.test.ts` |
| D6 | S2 | On a Mac ⌥/ (remove fill), ⇧/ (remove stroke), ⌥⌘A (select matching), ⇧⌘\ (minimize UI), ⌥⌘\ (multiplayer cursors) do nothing. | Matched on `event.key`, which ⌥ and ⇧ change ("÷", "?", "å", "\|", "«"); select matching also required ⇧. | Match on `event.code`. 2629968 | `hooks/use-shortcuts.test.ts` |
| D7 | S2 | Export PNG/JPG/SVG/PDF of a layer with a drop shadow or blur from the Effects list: cut at the layer's edge; a frame with Clip content off loses what hangs out; PDF page sized to the box. | PNG padding read only the legacy `shadow`/`blur` fields; SVG used the bare box; PDF used the box for the page. | `exportBounds` (effects and unclipped contents) used by PNG, SVG and PDF. 85d292d, c68621e | `engine/effect-bounds.test.ts` |
| D8 | S2 | SVG/PDF export of an alpha (default) mask with a dark mask shape shows nothing. | SVG masks are luminance by default; black reads as fully transparent. | Alpha and vector masks export with `mask-type:alpha` and a white-alpha colour matrix. ee4bfb2 | `canvas/render.test.ts` |
| D9 | S3 | A group at 50% with overlapping children: on the canvas and in PNG the overlap mixes both colours; SVG shows the group faded as a whole. | Pass-through containers were never isolated, so opacity applied per child. | A pass-through frame or group below 100% with more than one thing to draw is isolated. ee4bfb2 | `canvas/render.test.ts` |
| D10 | S3 | Luminance mask with a black shape shows everything on the canvas (SVG hides it). | The canvas treated luminance masks as alpha. | Mask coverage becomes brightness × alpha. ee4bfb2 | (canvas only; verified by pixel comparison) |
| D11 | S3 | SVG export of a dashed stroke on only the top side dashes all four sides. | The SVG writer had no per-side path for dashed strokes (the canvas uses side lines). | `sidesD` writes the stroked sides' lines; none when every side is off. f98fbb2 | `engine/export-svg.test.ts` |
| D12 | S3 | The Layers list can't be used from the keyboard: rows have no role and no focus; only chevrons are reachable. | Rows were plain divs. | Tree semantics, roving Tab stop, arrows/Home/End/Space/Return/F2; mouse clicks still don't take focus so arrows keep nudging. 5ffb21a | `components/layers-panel.test.ts` |
| D13 | S3 | 2,000 layers on a page: every selection change or nudge costs ~150 ms. | Each row subscribed to the store four times and got new handler closures every render, so every row re-rendered. | Memoised rows, stable handlers, row state passed as props (also in the Slides list). 79be81b | covered by the tree test (render) |
| D14 | S3 | Main menu and palette: Go to main component, Detach, Reset, Ungroup, Remove auto layout, Resize to fit, Convert to section, Edit points enabled where they do nothing; Go to main component on a rectangle says "The main component for this instance was deleted." | Those actions only needed "a selection". | Layer-kind needs (instance, ungroupable, auto layout, fit frame, frame, points). c63c498 | `engine/actions.test.ts` |
| D15 | S3 | ⌘R on a layer, then switch page or file before finishing: the row reopens in rename mode whenever it shows again. | `renameRequest` was only cleared by the row's own input. | Cleared when the file or page changes. c63c498 | `engine/actions.test.ts` |
| D16 | S3 | Copy link to selection / page in a file only on this device: "copied", but the link has no file id and uses the network address (another origin), so it opens another file. | `fileLink` builds links from the shared file id, absent for local files. | Says the file must be shared to get a link. 4ca0df8 | `engine/actions.test.ts` |
| D17 | S3 | Drop a .fig on the canvas: the file opens but the message says "Those files aren't images Nagma can open." | `placeImages` imported design files and then passed them on to the image reader. | Design files leave the list once imported. 5b74b91 | `engine/images.test.ts` |
| D18 | S3 | A comment placed near the right or bottom of the canvas: the composer and thread open under the Comments panel or the toolbar, cut off. | Always placed to the pin's right with no clamping. | Flip left near the edge, keep above the toolbar, cap the thread height. 60bd0e8, 359f92b | `engine/comment-popup.test.ts` |
| D19 | S3 | Add radial/linear repeat on an existing group, then ⌘Z: also undoes the edit made before it. | `mergeLast` ran even when no grouping step had been made. | Merge only after grouping here. bdb11ca | `engine/store-undo.test.ts` |
| D20 | S4 | Fill and stroke rows show "0000" for 000000 at every window width. | The variable button took the hex field's space (29 px for 42 px of text). | Button overlays the field's end on hover/focus. eb04ee5 | visual (re-checked at 1440 and 1024) |
| D21 | S4 | Lines, arrows, polygons and stars are all named "Line", "Arrow", "Polygon", "Star". | `makeShape` gave fixed names instead of the next number. | `nextLabelName`. 83ccd58 | `engine/shapes.test.ts` |
| D22 | S4 | Frame tool quick-add + copies are named like the original ("Frame 1" twice). | Rename duplicated layers not applied there. | Next number, as ⌘D. cdcccfb | `engine/clipboard.test.ts` |
| D23 | S4 | + Add page doesn't open the name for typing; typing right after ⌘R loses the first keys to canvas shortcuts. | No rename on add; the dialog focused its field a frame late. | Add page opens rename; field auto-focuses. f815cca | `engine/actions.test.ts` |

## 3. Known issues not fixed

- **Drawing a frame around existing layers doesn't adopt them** (sections do). The reference's
  behaviour isn't stated in the audit; left as is.
- **Copying, ⌘D or ⌥-dragging a main component makes another main component**, not an instance
  (instances come from the context menu or Assets). The reference likely makes an instance; not
  changed without a confirmed source.
- **Hex fields** accept 3 and 6 digits only (no 1–2 digit shorthand, CSS names or 8-digit alpha).
- **Performance with very large pages (dev build):** with 2,000 layers a selection change is still
  45–80 ms (the list isn't virtualised); on an imported 5,000-layer page a canvas frame at fit zoom
  takes 60–75 ms (no cached raster of unchanged layers). Production builds are faster; virtualising
  the Layers list and caching static content are the next steps.
- **Inner shadow and layer blur** differ slightly between the canvas and SVG (about 6% of edge
  pixels): different blur kernels.
- **The Actions palette lists both "Comments" and "Show/Hide comments"** (same action, ⇧C).
- **Live two-tab editing** wasn't exercised (one browser tab allowed); the race in D3 was found in
  code and reproduced in a test.
- **Nudges** are one undo step each (5 presses, 5 steps).
- **Number fields** with symbol labels (gap "↔", padding "|↔|") are named by the symbol for screen
  readers; their tooltips carry the full name.
