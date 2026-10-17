import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Account settings › AI, signed in: the key is saved through the server (which tests it first), comes
// back only as its last four characters, and the tab shows the model, a test result and usage.
localStorage.setItem("nagma.auth.v1", JSON.stringify({ user: { id: "acct-1", name: "Ada", email: "ada@example.com", color: "#0D99FF" }, token: "session-token", others: [] }));

const { AiTab } = await import("./ai-settings");
const { aiHeaders } = await import("../engine/ai-settings");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const base = {
    scope: "account",
    signedIn: true,
    text: null,
    image: null,
    shared: { text: false, image: false, provider: null, disabled: false },
    usage: { requests: 0, input: 0, output: 0, tokens: 0, shared: null },
    perMinute: 30,
    privateUrls: false,
    providers: [
        { id: "anthropic", label: "Claude", defaultModel: "claude-sonnet-5-5" },
        { id: "openai", label: "OpenAI", defaultModel: "gpt-5" },
        { id: "compatible", label: "OpenAI-compatible", defaultModel: "" },
    ],
    imageProviders: [{ id: "openai", label: "OpenAI", defaultModel: "gpt-image-1" }],
};
const withKey = {
    ...base,
    text: { provider: "anthropic", model: "claude-sonnet-5-5", baseUrl: "", keySet: true, keyEnd: "1234", models: [{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" }, { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" }], savedAt: 1 },
    usage: { requests: 12, input: 40000, output: 8000, tokens: 48000, shared: null },
};

function type(input: HTMLInputElement, value: string) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("the AI tab", () => {
    let root: Root;
    let host: HTMLDivElement;
    const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label);
    beforeAll(async () => {
        vi.mocked(fetch).mockImplementationOnce(async () => reply(200, base));
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
        await act(async () => root.render(createElement(AiTab)));
        await act(async () => undefined);
    });
    afterAll(() => act(() => root.unmount()));

    it("says AI is off until a key is added, with Claude chosen", () => {
        expect(host.textContent).toContain("AI features are off until you add a key.");
        expect(host.textContent).toContain("Encrypted and kept with your account on this server.");
        expect(host.textContent).toContain("Today: 0 requests, ~0 tokens");
        expect(button("Save and test")?.hasAttribute("disabled")).toBe(true);
    });

    it("saves the key through the server, then shows only its last four characters", async () => {
        const key = host.querySelector<HTMLInputElement>('input[aria-label="API key"]');
        expect(key?.type).toBe("password");
        await act(async () => type(key!, "sk-ant-fake-key-00001234"));
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockImplementationOnce(async () => reply(200, { ...withKey, saved: { model: "claude-sonnet-5-5", models: withKey.text.models } }));
        fetchMock.mockImplementationOnce(async () => reply(200, withKey));
        await act(async () => button("Save and test")?.click());
        await act(async () => undefined);
        const [url, init] = fetchMock.mock.calls.at(-2) as [string, RequestInit];
        expect(url).toMatch(/\/ai\/settings$/);
        expect(init.method).toBe("PUT");
        expect(JSON.parse(String(init.body))).toMatchObject({ provider: "anthropic", key: "sk-ant-fake-key-00001234" });
        expect((init.headers as Record<string, string>).authorization).toBe("Bearer session-token");
        expect(host.textContent).toContain("Key set, ends in ••••1234");
        expect(host.innerHTML).not.toContain("sk-ant-fake-key");
        expect(host.querySelector<HTMLInputElement>('input[aria-label="API key"]')?.value).toBe("");
        expect(host.textContent).toContain("Claude Sonnet 5.5");
        expect(host.textContent).toContain("Today: 12 requests, ~48k tokens");
    });

    it("Test makes one call and says how it went", async () => {
        vi.mocked(fetch).mockImplementationOnce(async () => reply(200, { ok: true, ms: 420, model: "claude-sonnet-5-5", provider: "anthropic" }));
        vi.mocked(fetch).mockImplementationOnce(async () => reply(200, withKey));
        await act(async () => button("Test")?.click());
        await act(async () => undefined);
        expect(host.textContent).toContain("Works. claude-sonnet-5-5 answered in 420 ms.");
        vi.mocked(fetch).mockImplementationOnce(async () => reply(200, { ok: false, error: "The provider didn't accept this key.", code: "ai-key-rejected" }));
        vi.mocked(fetch).mockImplementationOnce(async () => reply(200, withKey));
        await act(async () => button("Test")?.click());
        await act(async () => undefined);
        expect(host.textContent).toContain("Test failed: The provider didn't accept this key.");
    });

    it("shows the server's refusal when a key fails its test", async () => {
        const key = host.querySelector<HTMLInputElement>('input[aria-label="API key"]');
        await act(async () => type(key!, "sk-ant-wrong-key-99999999"));
        vi.mocked(fetch).mockImplementationOnce(async () => reply(400, { error: "Claude didn't accept this key. Check it and try again.", code: "ai-key-rejected" }));
        await act(async () => button("Save and test")?.click());
        await act(async () => undefined);
        expect(host.textContent).toContain("Claude didn't accept this key.");
        expect(host.textContent).toContain("Key set, ends in ••••1234");
    });

    it("Remove deletes the key on the server", async () => {
        vi.mocked(fetch).mockImplementationOnce(async () => reply(200, base));
        vi.mocked(fetch).mockImplementationOnce(async () => reply(200, base));
        await act(async () => button("Remove")?.click());
        await act(async () => undefined);
        const [url, init] = vi.mocked(fetch).mock.calls.at(-2) as [string, RequestInit];
        expect(url).toMatch(/\/ai\/settings$/);
        expect(init.method).toBe("DELETE");
        expect(host.textContent).toContain("AI features are off until you add a key.");
    });

    it("signed in, nothing goes in the browser's key header", () => {
        expect(aiHeaders()).toEqual({});
    });
});
