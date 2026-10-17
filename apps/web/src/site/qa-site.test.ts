import { describe, expect, it, vi } from "vitest";
import { RUNTIME } from "./runtime";

// Regression tests from the Campaign, Sites and Make QA pass (apps/web/qa/QA-campaign-sites-make.md).

describe("published page script: Scroll to", () => {
    it("jumps when Smooth is off and glides when it's on (the page's CSS scrolls smoothly by default)", () => {
        document.body.innerHTML = `
            <a id="jump" href="#" data-scroll-to="faq" data-offset="20" data-smooth="0">Jump</a>
            <a id="glide" href="#" data-scroll-to="faq" data-offset="0" data-smooth="1">Glide</a>
            <section id="faq">FAQ</section>`;
        const scroll = vi.fn();
        window.scrollTo = scroll as unknown as typeof window.scrollTo;
        new Function(RUNTIME)();
        document.getElementById("jump")?.click();
        document.getElementById("glide")?.click();
        // "auto" would follow html{scroll-behavior:smooth}, so Smooth off still glided.
        expect(scroll.mock.calls.map((c) => (c[0] as ScrollToOptions).behavior)).toEqual(["instant", "smooth"]);
        expect((scroll.mock.calls[0]?.[0] as ScrollToOptions).top).toBe(-20);
    });
});

describe("CMS dates", () => {
    const collection = { id: "c", name: "People", fields: [{ id: "joined", name: "Joined", type: "date" as const }], items: [] };
    const item = (raw: string) => ({ id: "i", slug: "i", values: { joined: raw } });
    it("a plain date is that day in any time zone, and an impossible one shows as written", async () => {
        const { fieldText } = await import("./model");
        const before = process.env.TZ;
        process.env.TZ = "America/Los_Angeles";
        try {
            expect(fieldText(collection, item("2024-01-05"), "joined")).toBe("January 5, 2024");
            expect(fieldText(collection, item("2024-02-30"), "joined")).toBe("2024-02-30");
            expect(fieldText(collection, item("2024-02-29"), "joined")).toBe("February 29, 2024");
            expect(fieldText(collection, item("someday"), "joined")).toBe("someday");
        } finally {
            process.env.TZ = before;
        }
    });
});

