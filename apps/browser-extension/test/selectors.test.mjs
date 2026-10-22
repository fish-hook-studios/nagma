// The page script's selector helpers (src/states.ts, src/live-capture.ts), bundled for Node:
//   cd apps/browser-extension && npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
    stdin: { contents: 'export { stateTargets, forcedSelector, compounds, splitSelectors } from "./src/states.ts"; export { looseSelector } from "./src/live-capture.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" },
    bundle: true,
    format: "esm",
    write: false,
    platform: "neutral",
});
const lib = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

test("finds the element a state rule is about, and its states", () => {
    assert.deepEqual(lib.stateTargets(".card:hover .title"), [{ selector: ".card", states: ["hover"] }]);
    assert.deepEqual(lib.stateTargets(".nav a:hover"), [{ selector: ".nav a", states: ["hover"] }]);
    assert.deepEqual(lib.stateTargets("button:hover:not(:disabled)"), [{ selector: "button:not(:disabled)", states: ["hover"] }]);
    assert.deepEqual(lib.stateTargets(".btn:focus-visible::after"), [{ selector: ".btn", states: ["focus"] }]);
    assert.deepEqual(lib.stateTargets(".menu > button:active"), [{ selector: ".menu > button", states: ["active"] }]);
    // :focus-within and states inside :not() aren't the element's own.
    assert.deepEqual(lib.stateTargets(".form:focus-within label"), []);
    assert.deepEqual(lib.stateTargets("a:not(:hover)"), []);
});

test("writes a state rule's twin with attributes for the pseudo-classes", () => {
    assert.equal(lib.forcedSelector(".btn:hover, .btn:focus-visible"), ".btn[data-nagma-hover], .btn[data-nagma-focus]");
    assert.equal(lib.forcedSelector(".a:active:hover .b"), ".a[data-nagma-active][data-nagma-hover] .b");
});

test("splits selectors and compounds at the top level only", () => {
    assert.deepEqual(lib.splitSelectors('a, b:is(.x, .y), [data-x="1,2"]'), ["a", "b:is(.x, .y)", '[data-x="1,2"]']);
    assert.deepEqual(lib.compounds(".a > .b  .c+d"), [".a", ">", ".b", " ", ".c", "+", "d"]);
});

test("loosens a selector to whether it's about a part in any state, combinators kept", () => {
    assert.equal(lib.looseSelector(".menu > button"), ".menu > button");
    assert.equal(lib.looseSelector(".menu.open > button:hover"), ".menu > button");
    assert.equal(lib.looseSelector('.tabs [aria-selected="true"]'), ".tabs *");
    assert.equal(lib.looseSelector(".tab.is-active::after"), ".tab");
    assert.equal(lib.looseSelector("[aria-expanded=true] + .panel"), "* + .panel");
});
