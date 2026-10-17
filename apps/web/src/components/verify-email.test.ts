import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// An unverified account signed in on this device (as a page load finds it).
const unverified = { id: "acct-unverified", name: "Newbie", email: "newbie@example.com", color: "#0D99FF", emailVerified: false, verifyRequired: true, mailReady: true };
localStorage.setItem("nagma.auth.v1", JSON.stringify({ user: unverified, token: "session-token", others: [] }));

const { VerifyBanner } = await import("./verify-email");
const { auth, refreshSession } = await import("../engine/auth");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the Verify your email banner", () => {
    let root: Root;
    let host: HTMLDivElement;
    beforeAll(async () => {
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
        await act(async () => root.render(createElement(VerifyBanner)));
    });
    afterAll(() => act(() => root.unmount()));

    const resend = () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Resend");

    it("shows for an unverified account, naming the address, with Resend", () => {
        expect(auth.get().user?.id).toBe(unverified.id);
        const banner = host.querySelector('[aria-label="Verify your email"]');
        expect(banner?.textContent).toContain("Verify your email");
        expect(banner?.textContent).toContain("newbie@example.com");
        expect(resend()).toBeTruthy();
    });

    it("Resend asks the server and says when it's too soon", async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockImplementationOnce(async () => reply(429, { error: "Too many attempts. Try again in 42 seconds.", retryAfter: 42 }));
        await act(async () => resend()?.click());
        await act(async () => undefined);
        const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
        expect(url).toMatch(/\/auth\/verify\/resend$/);
        expect(init.method).toBe("POST");
        expect((init.headers as Record<string, string>).authorization).toBe("Bearer session-token");
        expect(host.textContent).toContain("Try again in 42 seconds.");
        fetchMock.mockImplementationOnce(async () => reply(200, { sent: true, kept: false, mailConfigured: true }));
        await act(async () => resend()?.click());
        await act(async () => undefined);
        expect(host.textContent).toContain("Sent. Check newbie@example.com.");
    });

    it("says an admin must verify when the server has no mail, without Resend", async () => {
        vi.mocked(fetch).mockImplementationOnce(async () => reply(200, { ...unverified, mailReady: false }));
        await act(async () => refreshSession());
        expect(host.textContent).toContain("an admin needs to verify your account");
        expect(resend()).toBeUndefined();
    });

    it("goes away once the account is verified", async () => {
        vi.mocked(fetch).mockImplementationOnce(async () => reply(200, { ...unverified, emailVerified: true }));
        await act(async () => refreshSession());
        expect(host.querySelector('[aria-label="Verify your email"]')).toBeNull();
    });

    it("isn't shown when the server doesn't require verification", async () => {
        vi.mocked(fetch).mockImplementationOnce(async () => reply(200, { ...unverified, verifyRequired: false }));
        await act(async () => refreshSession());
        expect(host.querySelector('[aria-label="Verify your email"]')).toBeNull();
    });
});
