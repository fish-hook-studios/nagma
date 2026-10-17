// The desktop app's checks on what pages send the main process and on nagma:// links
// (apps/desktop/guards.cjs; platform QA, apps/web/qa/QA-platform.md).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const guards = createRequire(import.meta.url)("../../desktop/guards.cjs");

describe("desktop guards", () => {
    test("file menus: every section a list; bad entries and accelerators dropped", () => {
        assert.equal(guards.fileMenus(null), null);
        assert.equal(guards.fileMenus([1]), null);
        const m = guards.fileMenus({ app: "nope", file: [{ id: "save", label: "Save", accelerator: "CmdOrCtrl+S" }, "-", { id: "x", label: 5 }, { sub: "More", items: [{ id: "a", label: "A", accelerator: "Shift+CmdOrCtrl+<" }] }], view: [{ id: "z", label: "Zoom", accelerator: "CmdOrCtrl+Q+Q+Q+Q+Q+Q" }] });
        assert.deepEqual(m.app, []);
        assert.deepEqual(m.help, []);
        assert.equal(m.file.length, 3);
        assert.equal(m.file[0].accelerator, "CmdOrCtrl+S");
        assert.equal(m.file[2].items[0].accelerator, "Shift+CmdOrCtrl+<");
        assert.equal(m.view[0].accelerator, undefined);
        // Deep nesting is cut off.
        let deep = { id: "leaf", label: "Leaf" };
        for (let i = 0; i < 6; i++) deep = { sub: `L${i}`, items: [deep] };
        assert.ok(JSON.stringify(guards.fileMenus({ file: [deep] })).split('"sub"').length <= 5);
    });

    test("notifications keep their links on the sending page's server", () => {
        const page = "http://127.0.0.1:47878/?file=abc";
        assert.equal(guards.notice({ title: "Hi", url: "/?file=xyz" }, page).url, "http://127.0.0.1:47878/?file=xyz");
        assert.equal(guards.notice({ title: "Hi", url: "https://evil.example/" }, page).url, "");
        assert.equal(guards.notice({ title: "Hi", url: "javascript:alert(1)" }, page).url, "");
        assert.equal(guards.notice({ title: 42 }, page), null);
        assert.equal(guards.notice({ title: "T", text: { x: 1 } }, page).text, "");
        assert.equal(guards.notices("x", page).length, 0);
        assert.deepEqual(guards.closedTabs([{ id: "a", name: { evil: 1 } }, null, { id: 3 }]), [{ id: "a", name: "" }]);
    });

    test("nagma:// links", () => {
        assert.deepEqual(guards.protocolLink("nagma://open?url=https%3A%2F%2Fteam.example%2F%3Ffile%3Dabc"), { kind: "url", url: "https://team.example/?file=abc" });
        assert.deepEqual(guards.protocolLink("nagma://open?url=javascript%3Aalert(1)"), { kind: "home" });
        assert.deepEqual(guards.protocolLink("nagma://open?url=file%3A%2F%2F%2Fetc%2Fpasswd"), { kind: "home" });
        assert.deepEqual(guards.protocolLink("nagma://open?url=https%3A%2F%2Fuser%3Apw%40team.example%2F"), { kind: "home" });
        assert.deepEqual(guards.protocolLink("nagma://file/abcdef123?key=k-1~p"), { kind: "file", id: "abcdef123", key: "k-1~p" });
        assert.deepEqual(guards.protocolLink("nagma://file/abcdef123?key=%22%3E%3Cx"), { kind: "file", id: "abcdef123", key: null });
        assert.deepEqual(guards.protocolLink("nagma://file/../../x"), { kind: "home" });
        assert.equal(guards.protocolLink("https://example.com"), null);
        assert.equal(guards.protocolLink("not a url"), null);
    });

    test("a file on another server opens in this app's editor, which offers to connect to that server", () => {
        const base = "http://127.0.0.1:47878";
        assert.equal(guards.localFileLink("https://team.example/?file=abcdef123&key=k1#c", base), "http://127.0.0.1:47878/?file=abcdef123&key=k1&server=https%3A%2F%2Fteam.example#c");
        // A link that already names its server keeps it.
        assert.equal(guards.localFileLink("http://10.0.0.5:47878/?file=abcdef123&server=https%3A%2F%2Fteam.example", base), "http://127.0.0.1:47878/?file=abcdef123&server=https%3A%2F%2Fteam.example");
        // This app's own links, links that aren't to a file, and anything not http(s) stay as they are.
        assert.equal(guards.localFileLink("http://127.0.0.1:47878/?file=abcdef123", base), null);
        assert.equal(guards.localFileLink("https://team.example/pricing", base), null);
        assert.equal(guards.localFileLink("https://team.example/?file=../x", base), null);
        assert.equal(guards.localFileLink("https://u:p@team.example/?file=abcdef123", base), null);
        assert.equal(guards.localFileLink("javascript:alert(1)//?file=abcdef123", base), null);
    });
});
