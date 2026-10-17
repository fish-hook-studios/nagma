# QA summary

One pass of rigorous QA over every Nagma product, run in six areas. Each area has its own report in this
folder with the full test matrix, the bug list (repro, root cause, fix commit, test) and its known issues.

| Area | Report | Test cases | Bugs found | S1 | S2 | S3 | S4 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Automated suite, engine and server | [QA-suite.md](QA-suite.md) | ~300 matrix rows | 48 | 12 | 12 | 20 | 4 |
| Design editor | [QA-design.md](QA-design.md) | 397 | 23 | 3 | 5 | 11 | 4 |
| Board and Slides | [QA-board-slides.md](QA-board-slides.md) | 205 | 62 | 2 | 16 | 33 | 11 |
| Campaign, Sites and Make | [QA-campaign-sites-make.md](QA-campaign-sites-make.md) | 282 | 31 | 3 | 6 | 15 | 7 |
| Video, Document and import | [QA-video-document-import.md](QA-video-document-import.md) | 256 | 41 | 5 | 5 | 21 | 10 |
| Home, admin, sharing, multiplayer, desktop | [QA-platform.md](QA-platform.md) | 213 | 24 | 8 | 6 | 5 | 5 |
| **Total** | | **~1,650** | **229** | **33** | **50** | **105** | **41** |

Severity: S1 crash, data loss or security; S2 broken feature; S3 wrong behaviour; S4 cosmetic.
Every bug in the table is fixed at its root cause, and almost all have a regression test.

## Automated tests

The repository had no tests before this pass. It now has:

| Suite | Command | Tests |
| --- | --- | --- |
| Web (Vitest, jsdom) | `cd apps/web && npx vitest run` | 1,459 in 47 files |
| Server (node:test) | `node --test apps/server/test/` | 155 |
| Desktop file opening (node:test) | `node --test apps/desktop/test/` | 4 |

`npm run build` in apps/web type-checks the tests as well as the app.

## The most serious problems fixed

Security
- Server crashes anyone could trigger (a throwing route, malformed socket frames, `__proto__` names), prototype
  pollution through patches, a socket hearing a private file before its hello, path traversal through file
  ids, SSRF through IPv6 address forms, script injection through SVG export and `javascript:` link cards,
  unsandboxed embeds, a session token sent to any OIDC return address, signed-out site publishing.
- New files on the server were editable by anyone with the link; any viewer could approve a branch review;
  protected Make apps exposed their data; hidden votes were readable early; an invited editor could permanently
  delete the owner's files; invites stayed with an email address instead of the account.
- The desktop app gave camera, microphone and clipboard to any website opened through a link, and trusted
  malformed IPC messages.

Data loss
- Autosave cancelled when switching files or closing the tab; Document edits lost on leaving.
- After a dropped connection, one file's room could overwrite another file.
- Overlapping saves crashed the sync server.
- Concurrent votes and poll answers lost; redo wiped by housekeeping writes; stale presenter notes written back.
- ⌘A then Delete removed the page; copies left their contents behind; a component could nest inside itself and
  grow the file on every edit.

## Still open

Each area report lists its known issues with reasons. The main ones:
- Characters outside basic Latin draw as "?" in PDF text boxes and forms (needs the Rust engine rebuilt; no
  Rust toolchain on this machine).
- Local drafts belong to the browser, not the signed-in account.
- Sign-up does not verify email ownership.
- Slides vector PDF export uses Helvetica instead of the deck's fonts.
- Timers and vote deadlines use each person's clock.
- Large pages are slow in the dev build (the layers list is not virtualised).
- Drawing a frame around layers does not put them inside it; copying a main component makes another main.
- Make apps could not be rendered in the test browser (it blocks the package CDN), so Make's preview tools
  were not exercised end to end; Make chat was tested against a stand-in model only.
- Features that need outside credentials (mail, AI, GitHub, GIF and stock providers, webhooks, signing,
  update feed, real domains) were tested against local stand-ins.
