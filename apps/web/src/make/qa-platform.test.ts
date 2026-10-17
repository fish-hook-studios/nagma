// Platform QA (apps/web/qa/QA-platform.md): the backend helper of Make apps sends the data token of
// password and team-only apps, and older projects get the current helper when built.
import { describe, expect, it } from "vitest";

// inspect-settings first (it and collab.ts import each other; see engine/collab-switch.test.ts).
const load = async () => (await import("../engine/inspect-settings"), await import("./publish"));

const OLD = `// The app's backend: collections of items kept on the Nagma server (written by Make; don't edit).
const BASE = "http://x/app-data/abc123";
async function call(path) { return fetch(BASE + path); }
`;

describe("Make backend helper", () => {
    it("brings an older helper up to date, with the app's data token header", async () => {
        const { withCurrentBackend } = await load();
        const out = withCurrentBackend({ "src/lib/backend.ts": OLD, "src/App.tsx": "x" }, "abc123", true);
        expect(out["src/lib/backend.ts"]).toContain("x-nagma-app-token");
        expect(out["src/lib/backend.ts"]).toContain('meta[name="nagma-app-token"]');
        expect(out["src/lib/backend.ts"]).toContain("/app-data/abc123");
        expect(out["src/App.tsx"]).toBe("x");
    });

    it("leaves projects without the backend, or with a helper someone rewrote, alone", async () => {
        const { withCurrentBackend } = await load();
        const files = { "src/lib/backend.ts": "export const mine = 1;" };
        expect(withCurrentBackend(files, "abc123", true)).toBe(files);
        const off = { "src/lib/backend.ts": OLD };
        expect(withCurrentBackend(off, "abc123", false)).toBe(off);
        expect(withCurrentBackend(off, undefined, true)).toBe(off);
    });
});
