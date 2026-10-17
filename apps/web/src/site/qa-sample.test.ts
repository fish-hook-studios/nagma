import "../test/prod-fixtures";
import { describe, expect, it, vi } from "vitest";

// The sample pictures go to the image store (IndexedDB in the app); here they only need ids.
vi.mock("../engine/image-store", async (original) => ({ ...(await original<object>()), storeDataUrl: async () => "img-sample" }));

// Regression from the Campaign/Sites/Make QA pass: the Team directory template made a second
// "Posts" collection of blog posts (and a /posts-2 item page) instead of people.
describe("Team directory's sample collection", () => {
    it("is people, and a second sample gets a name of its own", async () => {
        const { sampleCollection } = await import("./blocks");
        const team = await sampleCollection("team", ["Posts"]);
        expect(team.name).toBe("Team");
        expect(team.fields.map((f) => f.name)).toEqual(["Name", "Role", "Photo"]);
        expect(team.items.map((i) => i.values[team.fields[0]?.id ?? ""])).toEqual(["Ada Brooks", "Sam Okafor", "Mia Chen"]);
        const again = await sampleCollection("posts", ["Posts", "Team"]);
        expect(again.name).toBe("Posts 2");
    });
});
