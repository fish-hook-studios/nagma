// Live sync over the socket (the protocol in apps/web/src/engine/collab.ts): patches from two
// editors come back to both in one order and land in the stored file; presence is relayed; viewers
// can't edit; sockets that never got in hear nothing; odd messages don't hurt the server.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { call, connect, createFile, readStored, sampleDoc, signUp, sleep, startServer } from "./helpers.mjs";

// Also run against room workers (room-workers.test.mjs): `extra` goes to the server's environment.
export function websocketSync(extra = {}, label = "") {
    describe(`websocket sync${label}`, () => {
        let server, owner, editor, viewer, stranger;
        before(async () => {
            server = await startServer(extra);
            owner = await signUp(server, "Owner");
            editor = await signUp(server, "Editor");
            viewer = await signUp(server, "Viewer");
            stranger = await signUp(server, "Stranger");
        });
        after(async () => server?.stop());

        // A file the owner shares with the editor and the viewer, with its link off.
        async function sharedFile(name = "Sync file") {
            const f = await createFile(server, owner.token, { doc: sampleDoc(name) });
            await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { invite: { email: editor.email, role: "edit" }, link: "none" } });
            await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { invite: { email: viewer.email, role: "view" } } });
            return f;
        }

        test("snapshots carry the role, and keys only for editors", async () => {
            const f = await sharedFile();
            const a = await connect(server, f.id, { token: owner.token });
            const b = await connect(server, f.id, { token: editor.token });
            const c = await connect(server, f.id, { token: viewer.token });
            assert.equal(a.first.type, "snapshot");
            assert.equal(a.first.role, "edit");
            assert.ok(a.first.keys?.edit);
            assert.equal(b.first.role, "edit");
            assert.equal(c.first.role, "view");
            assert.equal(c.first.keys, undefined);
            assert.equal(c.first.doc.nodes.rect1.w, 10);
            // Peers: each sees the ones who came before.
            assert.equal(c.first.peers.length, 2);
            assert.ok(c.first.peers.some((p) => p.name === "Owner"));
            await Promise.all([a.close(), b.close(), c.close()]);
        });

        test("two editors' concurrent patches reach both in the same order and are stored", async () => {
            const f = await sharedFile();
            const a = await connect(server, f.id, { token: owner.token });
            const b = await connect(server, f.id, { token: editor.token });
            const fromA = a.messages.length;
            const fromB = b.messages.length;
            for (let i = 0; i < 10; i++) {
                a.send({ type: "patch", id: `a${i}`, patch: { nodes: { rect1: { x: i } } } });
                b.send({ type: "patch", id: `b${i}`, patch: { nodes: { rect1: { y: i * 2 }, [`new${i}`]: { id: `new${i}`, type: "rect", parentId: "page1", children: [] } } } });
            }
            const patches = async (c, from) => {
                await c.next((m, i) => m.type === "patch" && m.version === 20, { from });
                return c.messages.slice(from).filter((m) => m.type === "patch");
            };
            const pa = await patches(a, fromA);
            const pb = await patches(b, fromB);
            assert.equal(pa.length, 20);
            assert.deepEqual(pa.map((p) => [p.version, p.id]), pb.map((p) => [p.version, p.id]));
            assert.deepEqual(pa.map((p) => p.version), Array.from({ length: 20 }, (_, i) => i + 1));
            // Each sender's own patches arrive in the order sent (acknowledgements).
            assert.deepEqual(pa.filter((p) => p.id.startsWith("a")).map((p) => p.id), Array.from({ length: 10 }, (_, i) => `a${i}`));
            const stored = await readStored(server, f.id, (r) => r.version === 20);
            assert.equal(stored.doc.nodes.rect1.x, 9);
            assert.equal(stored.doc.nodes.rect1.y, 18);
            assert.equal(stored.doc.nodes.rect1.w, 10);
            for (let i = 0; i < 10; i++) assert.ok(stored.doc.nodes[`new${i}`]);
            // A layer set to null goes; removed keys go.
            a.send({ type: "patch", id: "del", patch: { nodes: { new0: null }, removed: { rect1: ["y"] } } });
            await b.next((m) => m.type === "patch" && m.id === "del");
            const after = await readStored(server, f.id, (r) => r.version === 21);
            assert.equal(after.doc.nodes.new0, undefined);
            assert.equal(after.doc.nodes.rect1.y, undefined);
            // A later client starts from the merged document.
            const c = await connect(server, f.id, { token: viewer.token });
            assert.equal(c.first.version, 21);
            assert.equal(c.first.doc.nodes.rect1.x, 9);
            await Promise.all([a.close(), b.close(), c.close()]);
        });

        test("presence and cursors are relayed to the others, with the account's name", async () => {
            const f = await sharedFile();
            const a = await connect(server, f.id, { token: owner.token, name: "Fake name" });
            const b = await connect(server, f.id, { token: viewer.token });
            a.send({ type: "presence", name: "Owner", color: "#FF0000", cursor: { x: 12, y: 34 }, selection: ["rect1"], pageId: "page1", camera: { x: 1, y: 2, zoom: 2, w: 100, h: 80 }, chat: "hi" });
            const p = await b.next((m) => m.type === "presence" && m.presence.cursor?.x === 12);
            assert.deepEqual(p.presence.cursor, { x: 12, y: 34 });
            assert.deepEqual(p.presence.selection, ["rect1"]);
            assert.equal(p.presence.chat, "hi");
            assert.equal(p.presence.accountId, owner.user.id);
            assert.equal(p.presence.userId, a.first.you);
            // The sender doesn't get its own presence back.
            await sleep(100);
            assert.ok(!a.messages.some((m) => m.type === "presence" && m.presence.userId === a.first.you));
            // Leaving is announced.
            await a.close();
            const left = await b.next("leave");
            assert.equal(left.userId, a.first.you);
            await b.close();
        });

        // Regression: hello's `user` was spread into presence whole, so a client could take another's
        // presence id (and with it their audio signals and their place in everyone's peer list).
        test("hello can't choose the presence id or the account", async () => {
            const f = await sharedFile();
            const a = await connect(server, f.id, { token: owner.token });
            const b = await connect(server, f.id, { token: editor.token, user: { name: "Impostor", color: "#00FF00", userId: a.first.you, accountId: owner.user.id } });
            assert.notEqual(b.first.you, a.first.you);
            const seen = await a.next((m) => m.type === "presence" && m.presence.name === "Editor");
            assert.equal(seen.presence.userId, b.first.you);
            assert.equal(seen.presence.accountId, editor.user.id);
            // A guest can't claim an account either.
            await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { link: "view" } });
            const g = await connect(server, f.id, { key: f.keys.view, user: { name: "Guest", color: "#00FF00", accountId: owner.user.id, userId: a.first.you } });
            assert.equal(g.first.role, "view");
            const gp = await a.next((m) => m.type === "presence" && m.presence.name === "Guest");
            assert.equal(gp.presence.accountId, undefined);
            assert.notEqual(gp.presence.userId, a.first.you);
            await Promise.all([a.close(), b.close(), g.close()]);
        });

        test("a viewer's patch is rejected, not relayed and not stored", async () => {
            const f = await sharedFile();
            const a = await connect(server, f.id, { token: owner.token });
            const v = await connect(server, f.id, { token: viewer.token });
            const from = a.messages.length;
            v.send({ type: "patch", id: "evil", patch: { nodes: { rect1: { x: 999 } }, name: "Hacked" } });
            const r = await v.next("rejected");
            assert.equal(r.id, "evil");
            assert.equal(r.reason, "view-only");
            // Other edits still flow; the viewer's never shows up.
            a.send({ type: "patch", id: "ok", patch: { nodes: { rect1: { x: 1 } } } });
            await v.next((m) => m.type === "patch" && m.id === "ok");
            assert.ok(!a.messages.slice(from).some((m) => m.type === "patch" && m.id === "evil"));
            const stored = await readStored(server, f.id, (rec) => rec.version === 1);
            assert.equal(stored.doc.nodes.rect1.x, 1);
            assert.equal(stored.doc.name, "Sync file");
            // Viewers can't save versions or reset the link keys either.
            v.send({ type: "version.save", name: "viewer version" });
            v.send({ type: "keys.reset" });
            await sleep(200);
            a.send({ type: "versions" });
            const vers = await a.next("versions");
            assert.ok(!vers.versions.some((x) => x.name === "viewer version"));
            assert.equal((await call(server, "GET", `/files/${f.id}/access`, { token: owner.token })).status, 200);
            const list = (await call(server, "GET", "/files", { token: owner.token })).body.find((x) => x.id === f.id);
            assert.deepEqual(list.keys, f.keys);
            await Promise.all([a.close(), v.close()]);
        });

        test("no access: strangers and signed-out sockets are denied and closed; prototype links show nothing", async () => {
            const f = await sharedFile();
            const s = await connect(server, f.id, { token: stranger.token });
            assert.equal(s.first.type, "denied");
            assert.equal(s.first.signedIn, true);
            assert.equal(s.first.doc, undefined);
            assert.equal((await s.waitClosed()).code, 4003);
            const g = await connect(server, f.id, {});
            assert.equal(g.first.type, "denied");
            assert.equal(g.first.name, null);
            assert.equal((await g.waitClosed()).code, 4003);
            const k = await connect(server, f.id, { key: f.keys.edit });
            assert.equal(k.first.type, "denied");
            // A bad token is no one.
            const t = await connect(server, f.id, { token: "not-a-session" });
            assert.equal(t.first.type, "denied");
        });

        // Regression: a socket was added to the room before it said hello, so one that never did (to a
        // file it can't open) received every patch, cursor and comment, and could send presence.
        test("a socket that never says hello hears nothing and can't send presence", async () => {
            const f = await sharedFile("Private");
            const lurker = await connect(server, f.id, { hello: false });
            const a = await connect(server, f.id, { token: owner.token });
            const b = await connect(server, f.id, { token: editor.token });
            lurker.send({ type: "presence", name: "Lurker", cursor: { x: 1, y: 1 } });
            a.send({ type: "patch", id: "secret", patch: { nodes: { text1: { text: "the secret plan" } } } });
            a.send({ type: "presence", name: "Owner", cursor: { x: 5, y: 5 } });
            a.send({ type: "comment.op", op: { op: "add", comment: { id: "comment01", text: "private note", x: 1, y: 1, pageId: "page1" } } });
            await b.next((m) => m.type === "comments");
            await b.next((m) => m.type === "presence" && m.presence.cursor?.x === 5);
            await sleep(150);
            assert.deepEqual(lurker.messages, []);
            assert.ok(!a.messages.some((m) => m.type === "presence" && m.presence.name === "Lurker"));
            assert.ok(!b.messages.some((m) => m.type === "presence" && m.presence.name === "Lurker"));
            // Patches and the other commands do nothing either.
            lurker.send({ type: "patch", id: "x", patch: { nodes: { rect1: { x: 77 } } } });
            lurker.send({ type: "comment.op", op: { op: "add", comment: { id: "comment02", text: "spam", x: 1, y: 1, pageId: "page1" } } });
            await sleep(150);
            const stored = await readStored(server, f.id, (r) => r.version === 1);
            assert.equal(stored.doc.nodes.rect1.x, 0);
            assert.equal(stored.comments.length, 1);
            // Peer lists don't include it.
            const c = await connect(server, f.id, { token: viewer.token });
            assert.equal(c.first.peers.length, 2);
            await Promise.all([lurker.close(), a.close(), b.close(), c.close()]);
        });

        test("guests with a view link: view role, no keys, can comment but not edit", async () => {
            const f = await createFile(server, owner.token);
            await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { link: "view" } });
            const g = await connect(server, f.id, { key: f.keys.view, clientId: "guestbrowser1" });
            assert.equal(g.first.role, "view");
            assert.equal(g.first.keys, undefined);
            assert.equal(g.first.uid, "g:guestbrowser1");
            g.send({ type: "patch", id: "g1", patch: { nodes: { rect1: { x: 3 } } } });
            assert.equal((await g.next("rejected")).id, "g1");
            g.send({ type: "comment.op", op: { op: "add", comment: { id: "guestcomment1", text: "nice", x: 0, y: 0, pageId: "page1" } } });
            const cm = await g.next("comments");
            assert.equal(cm.comments[0].author.uid, "g:guestbrowser1");
            await g.close();
        });

        test("role changes reach open sockets: removed people are closed, upgraded people can edit", async () => {
            const f = await sharedFile();
            const v = await connect(server, f.id, { token: viewer.token });
            const e = await connect(server, f.id, { token: editor.token });
            await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { role: { userId: viewer.user.id, role: "edit" } } });
            const role = await v.next("role");
            assert.equal(role.role, "edit");
            assert.ok(role.keys?.edit);
            v.send({ type: "patch", id: "now-ok", patch: { nodes: { rect1: { x: 5 } } } });
            await e.next((m) => m.type === "patch" && m.id === "now-ok");
            await call(server, "PUT", `/files/${f.id}/access`, { token: owner.token, body: { remove: editor.user.id } });
            await e.next("denied");
            assert.equal((await e.waitClosed()).code, 4003);
            await v.close();
        });

        test("comments: authors edit their own; others can't; editors delete any thread", async () => {
            const f = await sharedFile();
            const a = await connect(server, f.id, { token: owner.token });
            const v = await connect(server, f.id, { token: viewer.token });
            v.send({ type: "comment.op", op: { op: "add", comment: { id: "vcomment01", text: "from viewer", x: 0, y: 0, pageId: "page1" } } });
            await a.next((m) => m.type === "comments" && m.comments.length === 1);
            a.send({ type: "comment.op", op: { op: "edit", threadId: "vcomment01", messageId: "vcomment01", text: "rewritten" } });
            const denied = await a.next("comment.denied");
            assert.match(denied.reason, /author/);
            a.send({ type: "comment.op", op: { op: "add", comment: { id: "acomment01", text: "from owner", x: 0, y: 0, pageId: "page1" } } });
            await v.next((m) => m.type === "comments" && m.comments.length === 2);
            v.send({ type: "comment.op", op: { op: "delete", threadId: "acomment01" } });
            assert.match((await v.next("comment.denied")).reason, /author or an editor/);
            a.send({ type: "comment.op", op: { op: "delete", threadId: "vcomment01" } });
            await v.next((m) => m.type === "comments" && m.comments.length === 1);
            // Bad shapes are refused, not stored.
            for (const op of [{ op: "add", comment: { id: "x", text: "short id", x: 0, y: 0, pageId: "p" } }, { op: "add", comment: { id: "goodid01", text: "", x: 0, y: 0, pageId: "p" } }, { op: "add", comment: { id: "goodid02", text: "t", x: "a", y: 0, pageId: "p" } }, { op: "nonsense" }, null]) {
                const from = v.messages.length;
                v.send({ type: "comment.op", op });
                await v.next("comment.denied", { from });
            }
            await Promise.all([a.close(), v.close()]);
        });

        test("odd messages and odd paths don't hurt the server", async () => {
            const f = await sharedFile();
            const a = await connect(server, f.id, { token: owner.token });
            for (const raw of ["not json", "null", "[]", "42", '"str"', "{}", '{"type":"nope"}', '{"type":"patch"}', '{"type":"patch","patch":5}', '{"type":"presence","cursor":"x","selection":"y","camera":5}', '{"type":"version.restore","id":"../../etc"}', '{"type":"version.get","id":{"a":1}}', '{"type":"rtc","to":5}', '{"type":"comment.read","reads":{"__proto__":5,"x":1}}']) a.send(raw);
            a.send({ type: "patch", id: "after", patch: { nodes: { rect1: { x: 42 } } } });
            await a.next((m) => m.type === "patch" && m.id === "after");
            assert.ok(server.alive());
            // Unknown or bad ids are refused at once.
            for (const bad of ["abc", "..%2F..%2Fusers", "a".repeat(80)]) {
                const s = await connect(server, bad, { hello: false });
                assert.equal((await s.waitClosed()).code, 4000, bad);
            }
            // A missing file answers an empty snapshot; with accounts, only someone signed in can create it.
            const nf = await connect(server, "nosuchfile1", {});
            assert.equal(nf.first.type, "snapshot");
            assert.equal(nf.first.doc, null);
            const create = await connect(server, "brandnewfile1", { initial: sampleDoc("Created over the socket") });
            assert.equal(create.first.type, "denied");
            assert.equal(create.first.reason, "sign-in");
            const created = await connect(server, "brandnewfile2", { token: stranger.token, initial: sampleDoc("Created over the socket") });
            assert.equal(created.first.role, "edit");
            assert.ok(created.first.keys?.edit);
            await Promise.all([a.close(), created.close()]);
        });

        // Regression: the message listener went on only after the file was read from disk, so a hello sent
        // as the socket opened (as the app does) was dropped when reading took a moment, and the client
        // waited for a snapshot forever.
        test("a hello sent while a large file is still loading gets its snapshot", async () => {
            const { writeFile } = await import("node:fs/promises");
            const { join } = await import("node:path");
            const big = sampleDoc("Big file");
            for (let i = 0; i < 60000; i++) big.nodes[`n${i}`] = { id: `n${i}`, type: "rect", name: `Layer ${i} with a longer name`, parentId: "page1", children: [], x: i, y: i, w: 10, h: 10, fills: [{ type: "solid", color: "#FF0000", opacity: 1 }] };
            for (const id of ["bigfile0001", "bigfile0002", "bigfile0003"]) await writeFile(join(server.dataDir, `${id}.json`), JSON.stringify({ doc: big, owner: owner.user.id, keys: { edit: "k".repeat(22), view: "v".repeat(22) }, link: "none", members: {}, comments: [], versions: [] }));
            for (const id of ["bigfile0001", "bigfile0002", "bigfile0003"]) {
                const c = await connect(server, id, { token: owner.token });
                assert.equal(c.first.type, "snapshot", id);
                assert.equal(Object.keys(c.first.doc.nodes).length, 60003);
                await c.close();
            }
        });

        // Regression: a text frame that isn't UTF-8 (or any frame ws refuses) emitted "error" on a socket
        // with no error listener, which threw and exited the server. One frame, no sign-in.
        test("bad frames close that socket only", async () => {
            const f = await sharedFile();
            const a = await connect(server, f.id, { token: owner.token });
            const bad = await connect(server, f.id, { hello: false });
            bad.ws.send(Buffer.from([0xff, 0xfe, 0xfd]), { binary: false });
            assert.equal((await bad.waitClosed()).code, 1007);
            const bad2 = await connect(server, "otherfile01", { hello: false });
            bad2.ws.send(Buffer.from([0xc3, 0x28]), { binary: false });
            await bad2.waitClosed();
            await new Promise((r) => setTimeout(r, 100));
            assert.ok(server.alive(), server.logs().slice(-600));
            a.send({ type: "patch", id: "still-here", patch: { nodes: { rect1: { x: 2 } } } });
            await a.next((m) => m.type === "patch" && m.id === "still-here");
            await a.close();
        });

        // Regression: patch keys like "__proto__" reached Object.prototype ({ removed: { __proto__: [...] } }
        // deleted its methods for the whole server), and non-array `removed` values threw and took the
        // process down.
        test("prototype-pollution and malformed patches leave the server and other files intact", async () => {
            const f = await sharedFile();
            const a = await connect(server, f.id, { token: owner.token });
            const evil = [
                { removed: { __proto__: ["toString", "hasOwnProperty", "valueOf"] } },
                JSON.parse('{"removed":{"__proto__":["toString","valueOf"]}}'),
                JSON.parse('{"nodes":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}}'),
                { removed: { rect1: 5 } },
                { removed: { rect1: "x" } },
                { removed: { rect1: null } },
                { nodes: { rect1: "string" } },
                { nodes: { rect1: [1, 2] } },
                { nodes: "abc" },
                { roots: "not-an-array" },
                { images: "x" },
                { styles: { __proto__: { polluted: true } } },
            ];
            let n = 0;
            for (const patch of evil) a.send(JSON.stringify({ type: "patch", id: `evil${n++}`, patch }));
            a.send({ type: "patch", id: "fine", patch: { nodes: { rect1: { x: 8 } } } });
            await a.next((m) => (m.type === "patch" || m.type === "rejected") && m.id === "fine", { timeout: 4000 });
            assert.ok(server.alive(), server.logs());
            // Every malformed one is refused whole (as JS literals, evil0 and evil11 lose their __proto__ key
            // to the object's prototype and arrive empty, which is harmless).
            const rejected = a.messages.filter((m) => m.type === "rejected");
            for (let i = 1; i <= 10; i++) assert.equal(rejected.find((m) => m.id === `evil${i}`)?.reason, "invalid", `evil${i}`);
            assert.ok(!a.messages.some((m) => m.type === "patch" && /^evil([1-9]|10)$/.test(m.id)));
            // Object.prototype still has its methods: a comment whose text is an object still becomes text.
            a.send({ type: "comment.op", op: { op: "add", comment: { id: "objtext01", text: { a: 1 }, x: 0, y: 0, pageId: "page1" } } });
            const c = await a.next("comments");
            assert.equal(c.comments.at(-1).text, "[object Object]");
            assert.ok(server.alive(), server.logs());
            const stored = await readStored(server, f.id, (r) => r.doc.nodes.rect1?.x === 8);
            assert.equal(stored.doc.nodes.rect1.w, 10);
            assert.equal(stored.doc.nodes.polluted, undefined);
            assert.ok(Array.isArray(stored.doc.roots));
            assert.equal(Object.getPrototypeOf(stored.doc.nodes), Object.prototype);
            // Another file is unaffected.
            const other = await createFile(server, owner.token);
            const r = await call(server, "GET", `/files/${other.id}/doc`, { token: owner.token });
            assert.equal(r.body.doc.polluted, undefined);
            assert.equal(r.body.doc.nodes.polluted, undefined);
            await a.close();
        });

        // Regression: a change to a layer a collaborator had deleted (a drag or edit still in flight) was
        // stored as a layer with no type or children; a whole layer still creates one.
        test("a partial change to a deleted layer is dropped, a whole new layer is kept", async () => {
            const f = await sharedFile();
            const a = await connect(server, f.id, { token: owner.token });
            a.send({ type: "patch", id: "ghost", patch: { nodes: { ghost1: { x: 5 } } } });
            a.send({ type: "patch", id: "made", patch: { nodes: { made1: { id: "made1", type: "rect", parentId: "page1", children: [], x: 1, y: 2, w: 3, h: 4 } } } });
            await a.next((m) => (m.type === "patch" || m.type === "rejected") && m.id === "made", { timeout: 4000 });
            const stored = await readStored(server, f.id, (r) => r.doc.nodes.made1);
            assert.equal(stored.doc.nodes.made1.type, "rect");
            assert.equal(Object.hasOwn(stored.doc.nodes, "ghost1"), false);
            await a.close();
        });

        // Regression: a reaction named "__proto__" or "constructor" made the comment code call a method
        // that wasn't there; the error went unhandled and the whole server exited. Any viewer could do it.
        test("reactions with prototype names don't crash the server", async () => {
            const f = await sharedFile();
            const a = await connect(server, f.id, { token: owner.token });
            a.send({ type: "comment.op", op: { op: "add", comment: { id: "reactme01", text: "react", x: 0, y: 0, pageId: "page1" } } });
            await a.next("comments");
            const v = await connect(server, f.id, { token: viewer.token });
            for (const emoji of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) v.send({ type: "comment.op", op: { op: "react", threadId: "reactme01", emoji } });
            v.send({ type: "comment.op", op: { op: "react", threadId: "reactme01", emoji: "👍" } });
            const done = await v.next((m) => m.type === "comments" && m.comments[0].reactions["👍"], { timeout: 4000 });
            assert.equal(done.comments[0].reactions["👍"].length, 1);
            assert.ok(server.alive(), server.logs());
            assert.equal((await call(server, "GET", "/health")).status, 200);
            await Promise.all([a.close(), v.close()]);
        });
    });
}

websocketSync();
