import { defineConfig } from "vitest/config";

// Engine and product logic tests, run in a jsdom window (engine modules read `location`, `window` and
// `localStorage` as they load). The sync server address points nowhere and `fetch` is stubbed in
// src/test/setup.ts, so a test never reaches a real server by accident.
export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        environment: "jsdom",
        setupFiles: ["src/test/setup.ts"],
        testTimeout: 30000,
        env: { VITE_SYNC_URL: "ws://127.0.0.1:9" },
    },
});
