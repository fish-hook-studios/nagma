import "./dommatrix";
import { vi } from "vitest";

// No test talks to a real server: background requests modules make as they load (notifications,
// stars, plugins) fail fast instead. A test that needs a response stubs `fetch` itself.
vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
        throw new TypeError("fetch is disabled in tests");
    }),
);

// jsdom has no canvas: return null quietly (text measuring then uses its fixed-width fallback)
// instead of logging "not implemented" for every call.
if (typeof HTMLCanvasElement !== "undefined") {
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
}
