import "../test/prod-fixtures";
import { describe, expect, it } from "vitest";

const load = async () => ({ ...(await import("./inspect-settings")), ...(await import("./collab")), ...(await import("./links")) });

describe("links for a tool on this computer (the Inspect panel's prompt)", () => {
    it("knows the private network ranges", async () => {
        const { privateHost } = await load();
        for (const host of ["10.0.0.4", "172.16.1.2", "172.31.255.1", "192.168.31.57", "169.254.3.3"]) expect(privateHost(host)).toBe(true);
        for (const host of ["localhost", "8.8.8.8", "172.32.0.1", "nagma.example.com", "[::1]"]) expect(privateHost(host)).toBe(false);
    });

    it("keep this computer's own address rather than a network one", async () => {
        const { fileLink } = await load();
        const link = new URL(fileLink("dev", { local: true }));
        expect(link.origin).toBe(location.origin);
        expect(link.searchParams.get("mode")).toBe("dev");
    });
});
