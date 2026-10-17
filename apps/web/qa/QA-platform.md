# QA: Platform (Home, admin console, auth and sharing, multiplayer, desktop)

Exploratory and adversarial QA of the platform around the editors: Home (file browser, tabs,
search, notifications, account settings, multiple accounts, new-file flows), the admin console and
its permissions, sign-up/sign-in and sessions, sharing (invites, link access, requests, branches,
comments and digests), multiplayer, the desktop app, and the items left open by earlier waves.
Branch `feature/qa-platform`.

How it was tested, and its limits:

- The web app ran on Vite (:5235) against a scratch sync server (:48815, own data folder,
  `NAGMA_DEV_MAIL_FILE=1`) with test accounts made for this pass (Alice, Bob, Carol; their test
  password is in the scratchpad, not here). Flows were driven in the built-in browser with real
  clicks, drags and keys at 1024x768, and checked against the editor state (`window.nagma`) and the
  server's stored files.
- Multiplayer used one browser tab (Alice) and a second client driven from a Node script over the
  same WebSocket protocol as `apps/server/test` (Bob), so both sides were real sessions on one file.
  A network drop was made by stopping and restarting the scratch server.
- Server security and permission checks were also run as an 80-check scripted sweep against a fresh
  server (rows marked "API sweep").
- The desktop app was loaded in Electron through a harness that sets its own user data folder,
  stubs protocol registration and points at the QA Vite server (no local server, port 47878 never
  touched, the installed app never launched). Real full-screen could not be entered offscreen, so
  the full-screen row checks the renderer half by sending the main process's message.
- Video, Document and import code were left to the other QA agent.

Totals: **213 test rows: 170 pass, 37 fail (all fixed and re-verified), 6 known**.
**24 bugs found (8 S1, 6 S2, 5 S3, 5 S4), all fixed.** Regression tests: 17 new server tests
(`apps/server/test/qa-platform.test.mjs`, `apps/server/test/desktop-guards.test.mjs`) and 3 new
Vitest tests; 3 older server tests updated where they encoded the old behaviour. Suites: Vitest
1429 passed, server 155 passed; type check and lint clean.

## 1. Test matrix

| # | Area | Flow | Steps | Expected | Actual | Result | Fix |
|---|---|---|---|---|---|---|---|
| 1 | Auth | Create account (UI) | Account menu > Sign in or create an account > Create account, name/email/password, Enter | Account made, signed in, Home shows name | As expected | PASS |  |
| 2 | Auth | Sign in wrong password (UI) | Add account dialog, right email, wrong password, Enter | "That email and password don't match." shown inline | As expected | PASS |  |
| 3 | Auth | Sign in right password (UI) | Same dialog, correct password | Signed in as second account, first kept in Others | As expected | PASS |  |
| 4 | Auth | Sign-up rate limit | 11+ sign-ups from one address within an hour | 429 with Retry-After | No limit: unlimited accounts from one client | FAIL | 13b51cf |
| 5 | Auth | Sign-up limit counts only made accounts | Refused sign-ups (bad email) don't count; signing in still works | Only successful sign-ups counted | As expected | PASS |  |
| 6 | Auth | Sign-up limit configurable | NAGMA_SIGNUP_PER_HOUR=3: 4th refused | 429, Retry-After 3000-3600 s | As expected | PASS |  |
| 7 | Auth | Sign-in backoff per address and account | Repeated wrong passwords | Exponential 429 with Retry-After (existing tests) | As expected | PASS |  |
| 8 | Auth | Sessions list (UI) | Settings > Security | This device, signed-in / last used / ends dates | As expected | PASS |  |
| 9 | Auth | Sign out other sessions | DELETE /auth/sessions with two sessions | Other session ends, current stays | As expected | PASS |  |
| 10 | Auth | Password change wrong current | Security tab, wrong current password | 401, message; backoff counts | As expected | PASS |  |
| 11 | Auth | Sign out ends session | POST /auth/signout then /auth/me | 401 | As expected | PASS |  |
| 12 | Auth | Session idle expiry | lastUsed bumped hourly, idle 30 days ends it | As designed (code review + existing tests) | As expected | PASS |  |
| 13 | Auth | Multiple accounts: switch (UI) | Account menu > Switch to Alice | Active account switches, other kept | As expected | PASS |  |
| 14 | Auth | Multiple accounts in admin console menu | Account menu inside admin console | Switch offered | Only Back to files/Settings/Theme/Log out; switch is on Home's menu | KNOWN |  |
| 15 | Auth | Sign-in dialog title on Create account tab | Switch tab to Create account | Title reads Create your account | Visible header updates; the dialog's accessible name stays "Sign in" and Forgot password? stays | KNOWN |  |
| 16 | Sharing | Default link access, POST /files | Create a file on the server | Only invited people | Anyone with the edit link could edit | FAIL | 13b51cf |
| 17 | Sharing | Default link access, Move to the server | Share > Move to the server and share (hello with initial doc) | Only invited people | Snapshot access.link was "edit" | FAIL | 13b51cf |
| 18 | Sharing | Server without accounts keeps open link | Hello with initial doc, no accounts on server | Edit link (nobody to invite) | As expected | PASS |  |
| 19 | Sharing | Share dialog shows restricted (UI) | Open Share on new server file | "Only people invited to this file" | As expected | PASS |  |
| 20 | Sharing | Copy link with access unknown | fileLink before snapshot arrives | No key in link (was edit key) | Fallback was "edit" | FAIL | 13b51cf |
| 21 | Sharing | Change role edit > view (UI) | Share dialog, Bob's role > can view | Bob's socket gets role message, patches rejected view-only | As expected | PASS |  |
| 22 | Sharing | Invite by email (API sweep) | PUT access invite | Invitee reads doc | As expected | PASS |  |
| 23 | Sharing | Request edit access | Viewer POST requests role edit | Owner notified; Requests tab shows it | As expected | PASS |  |
| 24 | Sharing | Approve request (UI) | Notifications > Approve | Requester gets access, notified | As expected | PASS |  |
| 25 | Sharing | Deny request (UI) | Notifications > Deny | Request marked Denied, no access | As expected | PASS |  |
| 26 | Sharing | Request again after deny | Carol requests again right after denial | Cooldown | Allowed at once (new mail each time) | KNOWN |  |
| 27 | Sharing | Requester can't approve own request | POST requests/<id> as requester | 403 | As expected | PASS |  |
| 28 | Sharing | Link password | Set password; key alone; unlock; key~pass | 403 / pass / 200 | As expected | PASS |  |
| 29 | Sharing | Link expiry in the past | PUT expires: 1 | Clamped to at least a minute ahead | As expected | PASS |  |
| 30 | Sharing | Email invite before account, then email change | Invite x@, x signs up, changes email | Keeps access | Lost access (invite stayed keyed to the old address) | FAIL | 07647c1 |
| 31 | Sharing | Email invite squatting | After the change, someone signs up with the old address | Gets nothing | Inherited the invite | FAIL | 07647c1 |
| 32 | Sharing | Folder guest invites by email | Project invite by email, then sign-up | Becomes a folder guest by account |  | PASS | 07647c1 |
| 33 | Branches | Create branch | POST branches as editor | Branch with main's people | As expected | PASS |  |
| 34 | Branches | Request review | PUT branch review emails | Reviewers notified, get view access | As expected | PASS |  |
| 35 | Branches | Viewer approves review | Main-file viewer POST review approved | 403 | 200: any viewer could approve | FAIL | 13b51cf |
| 36 | Branches | Requested reviewer decides | Reviewer suggests changes | 200, comment added | As expected | PASS |  |
| 37 | Branches | Main-file editor decides | Owner approves | 200, both decisions kept | As expected | PASS |  |
| 38 | Branches | Review buttons hidden for non-reviewers (UI) | Review panel as a viewer | No Approve/Suggest changes | Shown to everyone but the requester | FAIL | 13b51cf |
| 39 | Multiplayer | Presence of second client | Node client (Bob) joins the file Alice has open | Bob's avatar shows; Bob sees Alice's selection | As expected | PASS |  |
| 40 | Multiplayer | Live edits converge | Bob patches r2 (x, fill) | Alice's view updates | As expected | PASS |  |
| 41 | Multiplayer | Undo isolation, different layers | Alice drags r1; Bob changes r2; Alice ⌘Z | r1 back, r2 keeps Bob's change | As expected | PASS |  |
| 42 | Multiplayer | Undo isolation, same layer | Alice nudges r2; Bob recolours r2; Alice ⌘Z | r2 position back, Bob's colour kept | As expected | PASS |  |
| 43 | Multiplayer | Viewer can't edit | Bob set to view, sends patch | rejected view-only | As expected | PASS |  |
| 44 | Multiplayer | Presence leaves on disconnect | Bob quits | Alice's peers empty | As expected | PASS |  |
| 45 | Multiplayer | Offline queue | Stop server, nudge, restart | Status offline, 1 unsynced, synced after reconnect (stored x=410) | As expected | PASS |  |
| 46 | Multiplayer | Server file tab after another tab | Open campaign tab, click the shared file's tab | Joins room, shows the server doc | Previous file's document shown under the shared file's name, offline | FAIL | 1ba633f |
| 47 | Multiplayer | Back to local tab | Click local tab after shared | Room left, local doc shown | As expected | PASS |  |
| 48 | Multiplayer | Spotlight / follow | Presence carries camera and spotlight | Relayed (code review; ws-sync tests) | As expected | PASS |  |
| 49 | Home | Tab bar at 1024px with 12 tabs | Open 12 files | Tabs shrink then scroll, + stays visible | Page 2404px wide, window scrolled sideways | FAIL | fd56843 |
| 50 | Home | Open tab scrolls into view | Activate a far tab | Strip scrolls to it | As expected | PASS |  |
| 51 | Home | Close button on keyboard focus | Tab to a tab's close button | Visible on focus and for the open tab | Invisible (opacity 0) unless hovered | FAIL | fd56843 |
| 52 | Home | File card context menu (local) | Right-click card | Open, Add to starred, Rename F2, Duplicate, Move to…, Move to trash | As expected | PASS |  |
| 53 | Home | Rename to spaces only | Rename, type spaces, Enter | Name kept | As expected | PASS |  |
| 54 | Home | New file: Design/Board/Slides/Campaign/Site/Make | + menu in tab bar, each item | File created and opened, no console errors | As expected | PASS |  |
| 55 | Home | Search ⌘/ | ⌘/ then type | Field focused, preview opens | As expected | PASS |  |
| 56 | Home | Search preview while loading | Type a query | Searching… until answered | "No quick matches" flashed; earlier query's results shown for a new query | FAIL | 55ab2a6 |
| 57 | Home | Search access filtering | Stranger searches name and text of a private file | Nothing | As expected | PASS |  |
| 58 | Home | Search huge query | 5000-char q | 200, no crash | As expected | PASS |  |
| 59 | Home | Notifications: access request | Bell red dot, request row with Approve/Deny | Shown | As expected | PASS |  |
| 60 | Home | Notification text | Access request row | One description | "asks to edit" and "Asks to edit:" both | KNOWN |  |
| 61 | Home | Delete forever by invited editor | Editor: DELETE /files/<id>/forever on owner's trashed file | 403 | Allowed | FAIL | 41d27d6 |
| 62 | Home | Empty trash by invited editor | Editor empties trash with owner's trashed file listed | Owner's file kept | Owner's file deleted for good | FAIL | 41d27d6 |
| 63 | Home | Delete forever menu for non-owners | Trashed shared file someone else owns | Item hidden | Shown | FAIL | 41d27d6 |
| 64 | Home | Delete forever by owner | Owner, trashed file | Deleted after confirm | As expected | PASS |  |
| 65 | Home | Team folder empty state | New team, All folders | Copy names the + Folder button | Said "Use New folder" | FAIL | 2a0c6a9 |
| 66 | Home | Create team (UI) | Create team, name, Enter | Team made, Professional badge, Admin entry | As expected | PASS |  |
| 67 | Home | Local drafts with two accounts | Switch to Bob | Only Bob's drafts | Drafts kept in this browser show for every account on it | KNOWN |  |
| 68 | Home | URL after going Home | Home tab from a shared file | Clean address | ?file= stays until another file opens | KNOWN |  |
| 69 | Account | Account tab | Settings | Avatar, name, email, theme, accounts on device, connected accounts | As expected | PASS |  |
| 70 | Account | Tokens: create | Name, Enter | Token shown once, listed with hint | As expected | PASS |  |
| 71 | Account | Tokens: revoke the new token | Revoke | Gone from list and from the copy box | Copy box kept showing the dead token | FAIL | 2a0c6a9 |
| 72 | Account | Tokens: two quick revokes | Revoke twice fast | Both gone | Stale list could bring the first back | FAIL | 2a0c6a9 |
| 73 | Account | Tokens: empty name | Create with no name | Button disabled | As expected | PASS |  |
| 74 | Account | Email change taken address | POST /account/email to another account's email | 409 | As expected | PASS |  |
| 75 | Account | Email change link (dev mail file) | Change, confirm with token from data | Email changes, invites kept | As expected | PASS |  |
| 76 | Account | Avatar non-image | PUT avatar text/html | 400 | As expected | PASS |  |
| 77 | Account | Handle taken (case-insensitive) | Second account takes ANN | 409 | As expected | PASS |  |
| 78 | Account | Delete account sole admin of a team with others | DELETE /account | 400 make someone else admin | As expected | PASS |  |
| 79 | Account | Delete account wrong password | DELETE /account | 401 | As expected | PASS |  |
| 80 | Account | Mail setup hint for non-admins | Email change without mail | Plain sentence | Named NAGMA_SMTP_URL to everyone | FAIL | ed20542 |
| 81 | Admin | Dashboard at 1024px | Admin > Dashboard | Cards readable | Requests card squeezed to ~60px | FAIL | 2a0c6a9 |
| 82 | Admin | Billing at 1024px | Admin > Billing | Columns stack | Same squeeze | FAIL | 2a0c6a9 |
| 83 | Admin | People: invite existing admin | Invite yourself (admin) as Member | Role kept | Admin demoted to member (team can end up with no admin) | FAIL | 2a0c6a9 |
| 84 | Admin | People: invite invalid email | "foo" | Named as invalid | "No account yet for foo" | FAIL | 2a0c6a9 |
| 85 | Admin | People: invite existing account | bob@… | Joins with seat and role | As expected | PASS |  |
| 86 | Admin | People: invite missing account | newbie@… | Note to share invite link | As expected | PASS |  |
| 87 | Admin | Settings page renders | Admin > Settings | All sections incl. Products toggles, SAML, OIDC | As expected | PASS |  |
| 88 | Admin | OIDC env names for admins | Settings > Single sign-on | Admins may see variable names | As expected | PASS |  |
| 89 | Admin | Member opens admin | Bob (member) > Admin | Member notice with request form | As expected | PASS |  |
| 90 | Admin | Seat announcement for members | Bob > Admin | Hidden | Told members to use People/Billing they can't open | FAIL | 9d310d2 |
| 91 | Admin | Member API calls | settings, invoices, invite, invite links as member | 403 | As expected | PASS |  |
| 92 | Admin | Non-member admin GET | Stranger GET /teams/<id>/admin | 404 | As expected | PASS |  |
| 93 | Admin | Invite link role | Ask for admin invite link | Capped to edit | As expected | PASS |  |
| 94 | Admin | Seat request twice | Same pending request | 400 | As expected | PASS |  |
| 95 | Admin | Products: sites publishing off | Publish a site in that team's folder | 403 (code review) | As expected | PASS |  |
| 96 | Admin | Products: Make off | All teams off, POST /ai/make | 403 (code review) | As expected | PASS |  |
| 97 | Earlier waves | Protected Make app data | Password app, GET /app-data/<id>/notes without token | 401 | 200: anyone with the app id read and wrote it | FAIL | e37fc6d |
| 98 | Earlier waves | Protected app page token | Unlock with password, page has meta token, data with header | 200 | As expected | PASS |  |
| 99 | Earlier waves | Editor preview token | Owner POST /ai/make/backend/token; stranger | Token / 403 | As expected | PASS |  |
| 100 | Earlier waves | Old tokens after password change | Change password | 401 | As expected | PASS |  |
| 101 | Earlier waves | Team-only app data | access team | 401 without token | As expected | PASS |  |
| 102 | Earlier waves | Old projects' backend helper | Build/preview with old src/lib/backend.ts | Helper replaced with the token-sending one | As expected | PASS |  |
| 103 | Earlier waves | Site password lockout | Stranger 8 wrong guesses; real visitor elsewhere | Visitor gets in | Site locked for everyone 15 min | FAIL | e37fc6d |
| 104 | Earlier waves | Campaign approval after edit | Approve asset, edit a layer inside it | Approval withdrawn, editors reload | Stayed approved | FAIL | a820dba |
| 105 | Earlier waves | Campaign: edit outside reviewed assets | Rename the page | Approvals kept | As expected | PASS |  |
| 106 | Earlier waves | Campaign server export path | Look for any server-side export | None exists (export is browser-only); nothing to enforce | As expected | PASS |  |
| 107 | Earlier waves | Media panel env names | Non-admin, no stock/image keys | Friendly sentence | NAGMA_STOCK_KEY / NAGMA_IMAGE_API_* shown | FAIL | ed20542 |
| 108 | Earlier waves | Media panel env names, admin | Server admin | Variable names shown | As expected | PASS |  |
| 109 | Earlier waves | Hidden votes | Ballots during an open session | Not in the shared document | Every vote readable from the doc | FAIL | 4cb13b9 |
| 110 | Earlier waves | Voting UI end to end (UI) | Join, vote, End voting | Doc votes {} while open, server turnout 1, results 1 vote after end | As expected | PASS |  |
| 111 | Earlier waves | Voting: stuffed votes in doc | Patch writes votes into the open session | Replaced by server ballots at the end | As expected | PASS |  |
| 112 | Earlier waves | Voting: vote after end | vote message | refused closed | As expected | PASS |  |
| 113 | Earlier waves | Digests to mail file | Mention someone, NAGMA_DEV_MAIL_FILE=1 | data/digests.txt | Digest only logged as skipped | FAIL | 891bac9 |
| 114 | Desktop | Remote origin powers | nagma://open?url=https://evil.example | Asks first; no camera/mic/clipboard for untrusted pages | Opened in an app window; permission handler granted media and clipboard-read to any origin | FAIL | 9cc41b4 |
| 115 | Desktop | Open URL From Clipboard | Copy unknown https link | Asks first | Opened in-app | FAIL | 9cc41b4 |
| 116 | Desktop | Notification link | Page sends notify with https://evil.example | Dropped (same origin only) | Opened in-app on click | FAIL | 9cc41b4 |
| 117 | Desktop | IPC from untrusted frame | Page on untrusted origin calls bridge | Ignored | As expected | PASS |  |
| 118 | Desktop | Malformed menus over IPC | fileMenus({app: 5, file: [{label: {}}]}) | Ignored safely | buildMenu threw in the main process | FAIL | 9cc41b4 |
| 119 | Desktop | Malformed notifications / closed tabs | text: 5, name: {} | Cleaned | Menu/tray build could throw | FAIL | 9cc41b4 |
| 120 | Desktop | Menus base state | No file open (harness) | Nagma, File, Edit, View, Window, Help | As expected | PASS |  |
| 121 | Desktop | Menus file state | Design file open (harness) | Adds Object, Text, Arrange, Vector, Plugins, Widgets; File menu 16 items | As expected | PASS |  |
| 122 | Desktop | Full-screen class | main sends nagma:full-screen true | desktop-full-screen on <html> | As expected | PASS |  |
| 123 | Desktop | Single instance | requestSingleInstanceLock, second-instance focuses | As designed (code review) | As expected | PASS |  |
| 124 | Desktop | Deep link before server is up | second-instance nagma:// during start | Queued | Opened "null/?file=…" | FAIL | 9cc41b4 |
| 125 | Desktop | nagma://file key validation | key with quotes | Key dropped | As expected | PASS |  |
| 126 | Desktop | nagma://open non-http URL | javascript:, file:, user:pass@ | Home only | As expected | PASS |  |
| 127 | Desktop | will-navigate / window-open | Other origins | Open in browser; same origin new window | As expected | PASS |  |
| 128 | Desktop | Quit with unsynced | before-quit asks per window | Prompt when count > 0 | As expected | PASS |  |
| 129 | Desktop | Quit with a stuck window | One renderer doesn't answer | Quit continues after 2 s | Waited forever | FAIL | 9cc41b4 |
| 130 | Desktop | Kept windows on untrusted origin | Quit and Keep Windows then relaunch | Untrusted ones reopen Home | As expected | PASS |  |
| 131 | API sweep | signup returns token and user | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 132 | API sweep | me with token | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 133 | API sweep | me without token 401 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 134 | API sweep | me with garbage token 401 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 135 | API sweep | signup duplicate email (case) 409 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 136 | API sweep | signup short password 400 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 137 | API sweep | signup non-JSON body 400 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 138 | API sweep | signin wrong password 401 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 139 | API sweep | signin unknown email 401 same message | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 140 | API sweep | reset-request unknown email answers ok (no enumeration) | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 141 | API sweep | reset with bad token 400 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 142 | API sweep | create file | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 143 | API sweep | create file signed out 401 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 144 | API sweep | create file without doc 400 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 145 | API sweep | new file link restricted | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 146 | API sweep | stranger can't read doc | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 147 | API sweep | stranger search doesn't find it | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 148 | API sweep | stranger search by text inside doesn't find it | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 149 | API sweep | owner search finds it | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 150 | API sweep | search signed out 401 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 151 | API sweep | search huge q handled | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 152 | API sweep | stranger file list excludes it | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 153 | API sweep | stranger people list 403 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 154 | API sweep | stranger access GET 403 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 155 | API sweep | stranger rename 403 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 156 | API sweep | stranger trash 403 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 157 | API sweep | stranger duplicate 403 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 158 | API sweep | stranger branch list 403 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 159 | API sweep | stranger asset reviews 403 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 160 | API sweep | invite Ben as viewer | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 161 | API sweep | viewer reads doc | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 162 | API sweep | viewer search finds it | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 163 | API sweep | viewer list has no keys | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 164 | API sweep | viewer can't invite | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 165 | API sweep | viewer can't open link | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 166 | API sweep | viewer request edit ok | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 167 | API sweep | viewer request view again 400 (already has) | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 168 | API sweep | owner sees request | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 169 | API sweep | viewer can't approve own request | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 170 | API sweep | owner approves | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 171 | API sweep | Ben now edits (rename) | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 172 | API sweep | approving twice is a no-op | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 173 | API sweep | notifications: Ben was told | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 174 | API sweep | set link view + password | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 175 | API sweep | key alone refused with password | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 176 | API sweep | unlock gives pass | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 177 | API sweep | key+pass opens | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 178 | API sweep | expiry in past clamped | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 179 | API sweep | restore link none | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 180 | API sweep | create team | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 181 | API sweep | team name empty 400 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 182 | API sweep | non-member admin GET 404 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 183 | API sweep | invite link can't be admin role | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 184 | API sweep | invite link preview anonymous | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 185 | API sweep | invite accept signed out 401 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 186 | API sweep | Cy joins via link | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 187 | API sweep | member admin GET is member view | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 188 | API sweep | member can't change settings | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 189 | API sweep | member can't see invoices | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 190 | API sweep | member can't invite | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 191 | API sweep | member can't make invite links | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 192 | API sweep | member seat request ok | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 193 | API sweep | duplicate seat request 400 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 194 | API sweep | prototype pollution team id 404 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 195 | API sweep | invite token __proto__ 404 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 196 | API sweep | transfer info | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 197 | API sweep | delete account wrong password 401 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 198 | API sweep | only admin can't delete while others on team | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 199 | API sweep | avatar bad data 400 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 200 | API sweep | handle taken 409 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 201 | API sweep | name blank 400 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 202 | API sweep | email change to taken 409 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 203 | API sweep | sessions list | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 204 | API sweep | sign out others ends second session | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 205 | API sweep | password change wrong current 401 | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 206 | API sweep | signout ends session | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 207 | API sweep | notifications read-all | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 208 | API sweep | community list signed in | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 209 | API sweep | providers public | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 210 | API sweep | health | Scripted against a fresh server (scratchpad sweep.mjs) | As named | As expected | PASS |  |
| 211 | Suites | Web Vitest | cd apps/web && npx vitest run | Green | 1429 passed (1426 + 3 new) | PASS |  |
| 212 | Suites | Server node:test | node --test apps/server/test/ | Green | 155 passed (138 + 17 new) | PASS |  |
| 213 | Suites | Type check and lint | tsc -p tsconfig.app.json; oxlint src | 0 errors | As expected | PASS |  |

## 2. Bugs

| ID | Sev | Bug and repro | Root cause | Fix | Test |
|---|---|---|---|---|---|
| P-1 | S1 | No sign-up limit: one client could create unlimited accounts. | `/auth/signup` had no throttle (sign-in had one). | Sliding hour per address (`NAGMA_SIGNUP_PER_HOUR`, default 10), 429 with Retry-After for when the oldest ages out; refused sign-ups don't count. 13b51cf | qa-platform: sign-up limit |
| P-2 | S1 | Files put on the server were editable by anyone holding the link: Move to the server gave "anyone with the link can edit". | `makeFile` defaulted `link` to "edit"; a file made by the first hello had no `link`, and `accessOf` reads a missing link as "edit"; the client also fell back to "edit" before the snapshot. | New files (POST /files and Move to the server) start "Only people invited" (servers without accounts keep the edit link); branches copy the main file's real link; client fallbacks are "none". 13b51cf | qa-platform: restricted by default (2 tests); files-access tests updated |
| P-3 | S1 | Any viewer of the main file could approve a branch review. | The review route only checked that the person could open the main file or the branch. | Decisions need a requested reviewer or an editor of the main file; the panel hides the buttons for others. 13b51cf | qa-platform: branch reviews |
| P-4 | S1 | A password or team-only Make app's data was readable and writable by anyone with the app id. | `/app-data` was open by design (CORS *), with no tie to the app's access. | Data of protected apps needs a 12-hour data token signed for the app and its current password/access; the page gets it in a meta tag only after passing the gate, the editor preview from a new authenticated endpoint; old backend helpers are upgraded when the project is built. 401 otherwise. e37fc6d | qa-platform: protected app data (2) ; Vitest make/qa-platform |
| P-5 | S2 | A stranger guessing a site password locked real visitors out for up to 15 minutes. | The backoff key was per site ("account:site:<id>"), shared by everyone. | Backoff per address on that site (plus the address-wide key). e37fc6d, ecdc315 | qa-platform: site passwords; search-sites test updated |
| P-6 | S2 | An approved campaign asset could be edited and still count as approved for "require approval to export". | Approvals were never revisited after edits. | Every patch that touches a reviewed asset (or a layer inside it, before or after the move) withdraws its approval (history "reset"), and open editors reload reviews. There is no server-side export path, so the browser check stays the gate. a820dba | qa-platform: campaign approvals |
| P-7 | S3 | The Media panel (and email change, slide notes, agent) told every user server environment variable names. | Hard-coded hints. | `/auth/me` says `serverAdmin`; hints name variables only for server admins, a plain sentence for others. ed20542 | qa-platform: serverAdmin flag |
| P-8 | S1 | Hidden-until-end votes were readable by anyone in the file from the shared document. | Ballots were written into the page's jam in the document. | In shared files ballots go to the server (WebSocket "vote"), kept per session and voter in the file record (never in the document or snapshots); clients get only their own ballot and the turnout; when the session ends (host, anyone after the host left, or time) the server writes all ballots into the document in one patch, replacing anything a client slipped in. Local boards keep the old path. 4cb13b9 | qa-platform: board votes |
| P-9 | S1 | Desktop: a nagma:// link (or a clipboard link, or a notification) could open any website in an app window, which got camera, microphone and clipboard read without asking and whose IPC messages were obeyed. | Permission handlers allowed those for every origin; links opened in-app without a check; IPC didn't look at the sender. | Trusted origins = this laptop's server plus ones the person chose; links elsewhere ask (Open in Nagma / Open in Browser / Cancel); permissions and IPC only for trusted top frames; notification links kept to the sender's server. 9cc41b4 | desktop-guards tests |
| P-10 | S2 | Desktop: a malformed menus or notifications message from a page threw in the main process (menu rebuild failed on every focus). | Main used page data as is. | `guards.cjs` shape-checks menus (sections, accelerators, depth), notifications and closed tabs. 9cc41b4 | desktop-guards tests; harness |
| P-11 | S3 | Desktop: a nagma:// link reaching a second instance during start-up opened "null/?file=…". | Only `open-url` queued links; `second-instance` didn't. | One parser; links queue until the server is up. 9cc41b4 | desktop-guards: nagma:// links |
| P-12 | S3 | Desktop: quitting waited forever if a window's page didn't answer the unsynced-changes question. | Sequential awaits with no timeout. | All windows asked at once, 2 s each. 9cc41b4 | harness / review |
| P-13 | S2 | Tab bar ran past the window edge with many tabs (2404px page at 1024px). | Tabs had no shrink and the strip no overflow. | Tabs shrink to 96px, then the strip scrolls (wheel too); + stays; current tab scrolled into view; close button visible on focus and for the open tab. fd56843 | Verified in browser (layout not measurable in jsdom) |
| P-14 | S1 | Email invitations stayed keyed to the address: changing your email lost files shared before you had an account, and whoever registered the old address later inherited them. | Access by `invites[email]` was evaluated on every request against the current email. | At sign-up (and single sign-on account creation, and before an email change) invitations to that address become file members and folder guests by account. 07647c1 | qa-platform: invitations to an email |
| P-15 | S2 | Admin console: inviting someone already on the team reset their role and seat (an admin became a member; the team could be left with no admin). | `invite` overwrote `members[id]` and `seats[id]`. | Existing members are reported as "already on the team" and left alone. 2a0c6a9 | qa-platform: admin console invites |
| P-16 | S4 | Invalid emails in the invite dialog were reported as "No account yet for foo". | No format check. | Named as invalid. 2a0c6a9 | same |
| P-17 | S4 | Admin dashboard and billing squeezed a card to ~60px at 1024px. | Two columns from `lg` with a fixed 518px column. | Two columns from `xl`. 2a0c6a9 | Verified in browser |
| P-18 | S4 | Revoking the token just made left it in the "Copy this token now" box; quick revokes could bring one back. | Stale closures over the token list; the fresh token wasn't tied to its record. | Functional updates; the box clears when its token is revoked. 2a0c6a9 | Verified in browser |
| P-19 | S4 | Empty team folders said "Use New folder" but the button is "+ Folder". | Copy. | Copy fixed. 2a0c6a9 | n/a |
| P-20 | S3 | Search preview showed an earlier query's files for a new query, and "No quick matches" while still searching. | Results weren't tied to their query. | Results kept with their query; "Searching…" while pending. 55ab2a6 | Verified in browser |
| P-21 | S1 | An invited editor could permanently delete the owner's file, and "Empty trash" by an editor deleted every owner's trashed file they could edit. | Forever-delete and empty trash only checked edit access. | Owner only (folder admins for team files, server admins for files from before accounts); empty trash skips the rest; the menu hides Delete forever for others. 41d27d6 | files-access test extended |
| P-22 | S4 | Members opening the admin console were told to use People and Billing, which they can't open. | Announcement shown to everyone. | Admins only. 9d310d2 | Verified in browser |
| P-23 | S3 | Comment digests weren't written to the development mail file (only "mail skipped" logged). | `sendDigests` ignored `NAGMA_DEV_MAIL_FILE`. | Unsent digests go to data/digests.txt in dev mode. 891bac9 | qa-platform: comment digests |
| P-24 | S2 | Clicking a server file's tab after another tab showed the previous file's document under its name, offline (edits went nowhere; Reopen Closed Tab too). | `openFile` only loaded a local copy (shared files have none), never joined the room, and left the old document on screen. | Opening a server file joins its room (the same path as Home); registered from collab.ts. 1ba633f | Vitest collab-switch |

## 3. Known issues not fixed

- Local drafts are per browser, not per account: switching accounts on one device shows the other
  account's local drafts and tabs. Changing that is a storage redesign (drafts keyed by account,
  migration of existing ones).
- File link passwords still back off per file (not per address like sites): the link key is a
  second secret, so a stranger can't reach the lockout without it, and the per-file count is what
  stops distributed guessing of a leaked key.
- An access request can be sent again right after it is denied (each one mails the owner). Needs a
  product decision on a cooldown.
- Sign-up doesn't verify email ownership, so before the real person signs up, whoever registers
  their address gets what was shared with it. Needs a verification step for new accounts.
- Restoring a version or merging a branch replaces the document without withdrawing campaign
  approvals (only live patches do). Low risk (both need edit access and leave a version), worth a
  follow-up.
- Make apps published before P-4 keep their old backend helper until republished; a protected one
  loses data access until then (publishing again fixes it).
- The account menu inside the admin console has no account switching; Home's menu does.
- The sign-in dialog keeps "Sign in" as its accessible name and shows "Forgot password?" on the
  Create account tab; access-request notifications repeat "asks to edit" in title and body.
- Going Home keeps `?file=` in the address until another file opens.
- A signed-in stranger turned away from a file still learns its name from the denied message.
