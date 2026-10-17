import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Without an AI key, every AI entry point says so, with a button to Account settings › AI; and,
// signed out in a browser, a key is kept in this browser and sent with each AI request.
localStorage.removeItem("nagma.auth.v1");

const ai = await import("./ai-settings");
const { askModel, sendToAgent, newChat, getChats } = await import("./agent");
const { generateImage, ImageKeyNeeded } = await import("./media-providers");
const { checkAi } = await import("../make/generate");
const { editor } = await import("./store");
const { useSettingsTab, closeAccountSettings } = await import("./account");
const { AccountSettingsHost } = await import("../components/account-settings");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const needed = (status = 401) => reply(status, { error: ai.KEY_NEEDED, code: "ai-key-needed" });
const browserView = {
    scope: "browser",
    signedIn: false,
    text: null,
    image: null,
    shared: { text: false, image: false, provider: null, disabled: false },
    usage: { requests: 0, input: 0, output: 0, tokens: 0, shared: null },
    perMinute: 30,
    privateUrls: false,
    providers: [],
    imageProviders: [],
};

describe("no AI key", () => {
    it("the agent answers with where to add a key and a button to the AI tab", async () => {
        vi.mocked(fetch).mockImplementationOnce(async () => needed());
        expect(await askModel("make the card friendlier", editor.get().doc, [])).toEqual({ reply: "", keyNeeded: true });
        const chat = newChat();
        vi.mocked(fetch).mockImplementation(async (url) => (String(url).endsWith("/ai/chat") ? needed() : reply(404, {})));
        await sendToAgent(chat.id, "write a poem about this layout");
        vi.mocked(fetch).mockReset();
        vi.mocked(fetch).mockImplementation(async () => {
            throw new TypeError("fetch is disabled in tests");
        });
        const last = getChats().find((c) => c.id === chat.id)?.messages.at(-1);
        expect(last?.text).toContain("Add your AI key in Account settings to use this.");
        expect(last?.action).toBe("ai-settings");
    });

    it("image generation throws a key-needed error the panels turn into the same notice", async () => {
        vi.mocked(fetch).mockImplementationOnce(async () => needed(412));
        await expect(generateImage("a lighthouse", "1024x1024")).rejects.toBeInstanceOf(ImageKeyNeeded);
    });

    it("Make reports no model, so its notice offers the AI tab", async () => {
        vi.mocked(fetch).mockImplementationOnce(async () => reply(200, { signedIn: false }));
        const status = await checkAi();
        expect(status.available).toBe(false);
        expect(status.keyNeeded).toBe(true);
    });

    it("the notice's button opens the AI tab, signed out too", async () => {
        ai.notifyKeyNeeded();
        expect(editor.get().toast).toBe("Add your AI key in Account settings to use this.");
        expect(editor.get().toastAction?.label).toBe("Open AI settings");
        editor.get().toastAction?.run();
        expect(useSettingsTab).toBeTypeOf("function");
        const host = document.createElement("div");
        document.body.append(host);
        const root: Root = createRoot(host);
        vi.mocked(fetch).mockImplementationOnce(async () => reply(200, browserView));
        await act(async () => root.render(createElement(AccountSettingsHost)));
        await act(async () => undefined);
        const tabs = [...document.querySelectorAll('[role="tablist"] button')].map((b) => b.textContent);
        expect(tabs).toEqual(["AI"]);
        expect(document.body.textContent).toContain("Stored in this browser only.");
        await act(async () => closeAccountSettings());
        await act(async () => root.unmount());
    });
});

describe("a key kept in this browser", () => {
    it("is checked by the server, kept in this browser and sent with AI requests", async () => {
        expect(ai.aiHeaders()).toEqual({});
        const fetchMock = vi.mocked(fetch);
        const saved = { ...browserView, text: { provider: "openai", model: "gpt-5", baseUrl: "", keySet: true, keyEnd: "5678", models: [], savedAt: null } };
        // By address: saving also tells Make and the image panels to check again.
        fetchMock.mockImplementation(async (url, init) => {
            const path = new URL(String(url)).pathname;
            if (path === "/ai/settings" && init?.method === "PUT") return reply(200, { ...browserView, saved: { model: "gpt-5", models: [{ id: "gpt-5", label: "gpt-5" }] } });
            if (path === "/ai/settings") return reply(200, ai.aiHeaders()["x-nagma-ai"] ? saved : browserView);
            return reply(200, { signedIn: false });
        });
        const view = await ai.saveAiText({ provider: "openai", key: "sk-fake-browser-key-5678" });
        const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT") as [string, RequestInit];
        expect(JSON.parse(String(put[1].body)).key).toBe("sk-fake-browser-key-5678");
        expect(view.text?.models).toEqual([{ id: "gpt-5", label: "gpt-5" }]);
        expect(view.text?.keyEnd).toBe("5678");
        const header = ai.aiHeaders()["x-nagma-ai"];
        expect(header).toBeTruthy();
        const sent = JSON.parse(atob(header!.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
        expect(sent).toMatchObject({ provider: "openai", key: "sk-fake-browser-key-5678", model: "gpt-5" });
        expect(sent.models).toBeUndefined();
        expect(ai.aiRequestHeaders()["x-nagma-ai"]).toBe(header);
        await ai.removeAiText();
        expect(ai.aiHeaders()).toEqual({});
        expect(localStorage.getItem("nagma.ai.browser.v1")).toBeNull();
        expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
        fetchMock.mockReset();
        fetchMock.mockImplementation(async () => {
            throw new TypeError("fetch is disabled in tests");
        });
    });
});
