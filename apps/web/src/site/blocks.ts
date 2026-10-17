import { nanoid } from "nanoid";
import { storeDataUrl } from "../engine/image-store";
import { makeNode } from "../engine/nodes";
import { imagePaint, solid } from "../engine/paint";
import { editor } from "../engine/store";
import type { AutoLayout, Command, NagmaDocument, NodeType, SceneNode } from "../engine/types";
import { addPageCommands, bpFrames, bpOfNode, breakpointsOf, collectionsOf, itemPageFor, libraryCommand, libraryPage, mirrorIdFor, newCollection, pageData, primaryOf, sitePages, uniquePath, uniqueSlug } from "./model";
import type { Collection, SiteNodeData } from "./types";

// Ready-made web sections for the Insert panel. Each is a tree of auto layout frames (so it reflows
// at every width) with web settings already set (semantic elements, links, form fields), plus the
// tablet and mobile changes a designer would make anyway (fewer columns, smaller type).

export const INK = "#101828";
export const MUTED = "#475467";
export const BRAND = "#4F46E5";
export const SURFACE = "#F9FAFB";
export const LINE = "#EAECF0";

interface Spec {
    type: NodeType;
    name: string;
    props?: Partial<SceneNode>;
    web?: SiteNodeData;
    children?: Spec[];
    tablet?: Partial<SceneNode>;
    mobile?: Partial<SceneNode>;
}

const stack = (direction: "vertical" | "horizontal", gap: number, padding: [number, number, number, number] = [0, 0, 0, 0], primary: AutoLayout["primary"] = "start", counter: AutoLayout["counter"] = "start", wrap = false): AutoLayout => ({
    direction,
    gap,
    padding,
    primary,
    counter,
    ...(wrap ? { wrap: true, counterGap: gap } : {}),
});

function frame(name: string, layout: AutoLayout | null, props: Partial<SceneNode> = {}, children: Spec[] = [], extra: Omit<Spec, "type" | "name" | "props" | "children"> = {}): Spec {
    return { type: "frame", name, props: { fills: [], clip: false, layout, sizing: { h: "fill", v: "hug" }, ...props }, children, ...extra };
}

function text(value: string, size: number, weight = 400, color = INK, props: Partial<SceneNode> = {}, extra: Omit<Spec, "type" | "name" | "props"> = {}): Spec {
    return {
        type: "text",
        name: value.length > 28 ? `${value.slice(0, 28)}…` : value,
        props: { text: value, fontSize: size, fontWeight: weight, fontFamily: "Inter", lineHeight: size >= 32 ? 1.15 : 1.5, letterSpacing: size >= 32 ? -2 : 0, fills: [solid(color)], sizing: { h: "fill", v: "hug" }, ...props },
        ...extra,
    };
}

function button(label: string, primary = true, link: SiteNodeData["link"] = null, extra: Partial<SceneNode> = {}): Spec {
    return frame(
        `Button: ${label}`,
        stack("horizontal", 8, [12, 20, 12, 20], "center", "center"),
        { fills: [solid(primary ? BRAND : "#FFFFFF")], strokes: primary ? [] : [solid(LINE)], strokeWidth: 1, radius: 8, sizing: { h: "hug", v: "hug" }, ...extra },
        [text(label, 15, 600, primary ? "#FFFFFF" : INK, { sizing: { h: "hug", v: "hug" }, lineHeight: 1.4 })],
        { web: { link: link ?? { kind: "url", url: "#" }, hover: primary ? { fill: "#4338CA", y: -1, duration: 150 } : { fill: SURFACE, duration: 150 } } },
    );
}

// A full-width section with a centred content column at most 1120 wide.
function section(name: string, tag: SiteNodeData["tag"], bg: string, children: Spec[], gap = 48, pad = 96, align: AutoLayout["counter"] = "start"): Spec {
    return frame(name, stack("vertical", 0, [pad, 32, pad, 32], "start", "center"), { fills: bg ? [solid(bg)] : [] }, [frame("Container", stack("vertical", gap, [0, 0, 0, 0], "start", align), { maxW: 1120 }, children, { mobile: { layout: stack("vertical", Math.round(gap * 0.66), [0, 0, 0, 0], "start", align) } })], {
        web: { tag },
        mobile: { layout: stack("vertical", 0, [Math.round(pad * 0.6), 20, Math.round(pad * 0.6), 20], "start", "center") },
    });
}

function heading(title: string, sub: string, center = true): Spec {
    return frame("Heading", stack("vertical", 16, [0, 0, 0, 0], "start", center ? "center" : "start"), {}, [
        text(title, 40, 700, INK, { textAlign: center ? "center" : "left" }, { web: { tag: "h2" }, mobile: { fontSize: 30 } }),
        text(sub, 18, 400, MUTED, { textAlign: center ? "center" : "left", maxW: 640 }, { web: { tag: "p" }, mobile: { fontSize: 16 } }),
    ]);
}

function grid(name: string, columns: number, children: Spec[], gap = 24): Spec {
    return frame(name, { ...stack("horizontal", gap), grid: { columns, rows: null, columnGap: gap, rowGap: gap } }, {}, children, {
        tablet: { layout: { ...stack("horizontal", gap), grid: { columns: Math.min(columns, 2), rows: null, columnGap: gap, rowGap: gap } } },
        mobile: { layout: { ...stack("horizontal", 16), grid: { columns: 1, rows: null, columnGap: 16, rowGap: 16 } } },
    });
}

function card(children: Spec[], name = "Card", gap = 12): Spec {
    return frame(name, stack("vertical", gap, [28, 28, 28, 28]), { fills: [solid("#FFFFFF")], strokes: [solid(LINE)], strokeWidth: 1, radius: 16, sizing: { h: "fill", v: "hug" } }, children);
}

function image(name: string, imageId: string, h: number, radius = 16): Spec {
    return { type: "rect", name, props: { fills: [imagePaint(imageId, "fill")], radius, w: 400, h, sizing: { h: "fill", v: "fixed" }, altText: name } };
}

function embed(name: string, data: SiteNodeData["embed"], h: number): Spec {
    return frame(name, null, { fills: [solid("#F2F4F7")], radius: 12, clip: true, w: 800, h, sizing: { h: "fill", v: "fixed" } }, [], { web: { embed: data }, mobile: { h: Math.round(h * 0.55) } });
}

// A soft placeholder picture, different for each seed.
async function placeholder(seed: number): Promise<{ id: string; data: string }> {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 560;
    const ctx = canvas.getContext("2d");
    const hue = (seed * 47) % 360;
    if (ctx) {
        const g = ctx.createLinearGradient(0, 0, 800, 560);
        g.addColorStop(0, `hsl(${hue} 70% 82%)`);
        g.addColorStop(1, `hsl(${(hue + 50) % 360} 65% 62%)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 800, 560);
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath();
        ctx.arc(560 + (seed % 3) * 40, 200, 110, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.beginPath();
        ctx.moveTo(0, 560);
        for (let x = 0; x <= 800; x += 20) ctx.lineTo(x, 400 - Math.sin(x / 130 + seed) * 50);
        ctx.lineTo(800, 560);
        ctx.fill();
    }
    const data = await storeDataUrl(canvas.toDataURL("image/png"));
    return { id: nanoid(12), data };
}

export interface BlockDef {
    id: string;
    name: string;
    category: string;
    about: string;
    images?: number;
    build: (images: string[], doc: NagmaDocument) => Spec;
}

const pageLink = (doc: NagmaDocument, index: number): SiteNodeData["link"] => {
    const pages = sitePages(doc);
    const page = pages[index] ?? pages[0];
    return page ? { kind: "page", pageId: page.id } : { kind: "url", url: "#" };
};

export const BLOCKS: BlockDef[] = [
    {
        id: "nav",
        name: "Navigation bar",
        category: "Navigation",
        about: "Logo, links and a button",
        build: (_, doc) =>
            frame(
                "Navigation",
                stack("horizontal", 24, [20, 32, 20, 32], "between", "center", true),
                { fills: [solid("#FFFFFF")], strokes: [solid(LINE)], strokeWidth: 1, strokeSides: { top: false, right: false, bottom: true, left: false } },
                [
                    text("Northwind", 20, 800, INK, { sizing: { h: "hug", v: "hug" }, letterSpacing: -2 }, { web: { link: pageLink(doc, 0) } }),
                    frame(
                        "Links",
                        stack("horizontal", 28, [0, 0, 0, 0], "start", "center", true),
                        { sizing: { h: "hug", v: "hug" } },
                        ["Home", "About", "Pricing", "Contact"].map((label, i) => text(label, 15, 500, MUTED, { sizing: { h: "hug", v: "hug" } }, { web: { link: i < 2 ? pageLink(doc, i) : { kind: "url", url: "#" }, hover: { textColor: INK, duration: 120 } } })),
                        { web: { tag: "nav" }, mobile: { layout: stack("horizontal", 16, [0, 0, 0, 0], "start", "center", true) } },
                    ),
                    button("Get started", true, null),
                ],
                { web: { tag: "header" }, mobile: { layout: stack("horizontal", 12, [14, 20, 14, 20], "between", "center", true) } },
            ),
    },
    {
        id: "hero",
        name: "Hero",
        category: "Hero",
        about: "A big headline with buttons",
        build: () =>
            section(
                "Hero",
                "section",
                "#FFFFFF",
                [
                    frame("Copy", stack("vertical", 24, [0, 0, 0, 0], "start", "center"), {}, [
                        text("NEW · Spring release", 13, 600, BRAND, { sizing: { h: "hug", v: "hug" }, letterSpacing: 4 }, { web: { tag: "p" } }),
                        text("Build a site people remember", 64, 800, INK, { textAlign: "center", maxW: 820, lineHeight: 1.05 }, { web: { tag: "h1" }, tablet: { fontSize: 52 }, mobile: { fontSize: 38 } }),
                        text("Design every page visually, make it work on every screen, and publish it in one click.", 20, 400, MUTED, { textAlign: "center", maxW: 620 }, { mobile: { fontSize: 17 } }),
                        frame("Buttons", stack("horizontal", 12, [8, 0, 0, 0], "center", "center", true), { sizing: { h: "hug", v: "hug" } }, [button("Start for free"), button("See how it works", false)]),
                    ]),
                ],
                48,
                128,
            ),
    },
    {
        id: "hero-image",
        name: "Hero with image",
        category: "Hero",
        about: "Copy beside a picture",
        images: 1,
        build: ([img]) =>
            section("Hero", "section", SURFACE, [
                frame(
                    "Split",
                    stack("horizontal", 56, [0, 0, 0, 0], "start", "center"),
                    {},
                    [
                        frame("Copy", stack("vertical", 20), {}, [
                            text("Everything your team needs, in one place", 52, 800, INK, {}, { web: { tag: "h1" }, mobile: { fontSize: 36 } }),
                            text("Plan, design and ship together. No hand-offs, no lost files.", 19, 400, MUTED),
                            frame("Buttons", stack("horizontal", 12, [8, 0, 0, 0], "start", "center", true), { sizing: { h: "hug", v: "hug" } }, [button("Try it free"), button("Book a demo", false)]),
                        ]),
                        image("Product screenshot", img ?? "", 420),
                    ],
                    { mobile: { layout: stack("vertical", 32) }, tablet: { layout: stack("vertical", 40) } },
                ),
            ]),
    },
    {
        id: "features",
        name: "Features grid",
        category: "Features",
        about: "Three columns of features",
        build: () =>
            section("Features", "section", "#FFFFFF", [
                heading("Why teams switch", "Fast, flexible and built to grow with you."),
                grid(
                    "Feature grid",
                    3,
                    [
                        ["Lightning fast", "Pages load in a blink on every device."],
                        ["Responsive", "Set each breakpoint once and it just works."],
                        ["Secure", "Static pages with nothing to hack."],
                        ["Collaborative", "Edit together and see changes live."],
                        ["Content ready", "Collections keep posts and products tidy."],
                        ["Yours to keep", "Download the site and host it anywhere."],
                    ].map(([title, body], i) =>
                        card([
                            frame("Icon", stack("horizontal", 0, [0, 0, 0, 0], "center", "center"), { w: 44, h: 44, fills: [solid(["#EEF4FF", "#ECFDF3", "#FEF6EE"][i % 3] ?? "#EEF4FF")], radius: 12, sizing: { h: "fixed", v: "fixed" } }, [
                                text(["⚡", "📐", "🔒", "👥", "🗂", "📦"][i] ?? "★", 20, 400, INK, { sizing: { h: "hug", v: "hug" }, lineHeight: 1 }),
                            ]),
                            text(title ?? "", 18, 700, INK, {}, { web: { tag: "h3" } }),
                            text(body ?? "", 15, 400, MUTED),
                        ], title),
                    ),
                ),
            ]),
    },
    {
        id: "testimonials",
        name: "Testimonials",
        category: "Social proof",
        about: "Quotes from happy customers",
        build: () =>
            section("Testimonials", "section", SURFACE, [
                heading("Loved by makers", "Thousands of teams build their sites here."),
                grid(
                    "Quotes",
                    3,
                    [
                        ["“We launched our new site in an afternoon. The breakpoints just make sense.”", "Maya Chen", "Founder, Fieldnote"],
                        ["“Our marketing team finally ships pages without waiting on engineering.”", "Jonas Berg", "Head of Growth, Lumen"],
                        ["“The CMS is simple enough that everyone actually uses it.”", "Priya Raman", "Editor, Daily Loop"],
                    ].map(([quote, who, role]) =>
                        card(
                            [
                                text(quote ?? "", 17, 500, INK, { lineHeight: 1.55 }, { web: { tag: "blockquote" } }),
                                frame("Author", stack("vertical", 2), {}, [text(who ?? "", 15, 700, INK), text(role ?? "", 14, 400, MUTED)]),
                            ],
                            "Testimonial",
                            20,
                        ),
                    ),
                ),
            ]),
    },
    {
        id: "pricing",
        name: "Pricing",
        category: "Pricing",
        about: "Three plans side by side",
        build: () =>
            section("Pricing", "section", "#FFFFFF", [
                heading("Simple pricing", "Start free. Upgrade when you grow."),
                grid(
                    "Plans",
                    3,
                    [
                        ["Starter", "$0", "For personal sites", ["1 site", "Free address", "Basic forms"]],
                        ["Pro", "$12", "For growing teams", ["10 sites", "Custom fonts", "Collections"]],
                        ["Business", "$39", "For whole companies", ["Unlimited sites", "Custom code", "Priority help"]],
                    ].map(([name, price, about, perks], i) =>
                        frame(
                            String(name),
                            stack("vertical", 16, [32, 28, 32, 28]),
                            { fills: [solid(i === 1 ? INK : "#FFFFFF")], strokes: i === 1 ? [] : [solid(LINE)], strokeWidth: 1, radius: 16, sizing: { h: "fill", v: "hug" } },
                            [
                                text(String(name), 16, 600, i === 1 ? "#C7D2FE" : BRAND, {}, { web: { tag: "h3" } }),
                                frame("Price", stack("horizontal", 6, [0, 0, 0, 0], "start", "baseline"), {}, [text(String(price), 44, 800, i === 1 ? "#FFFFFF" : INK, { sizing: { h: "hug", v: "hug" } }), text("/ month", 15, 400, i === 1 ? "#98A2B3" : MUTED, { sizing: { h: "hug", v: "hug" } })]),
                                text(String(about), 15, 400, i === 1 ? "#D0D5DD" : MUTED),
                                text((perks as string[]).join("\n"), 15, 400, i === 1 ? "#FFFFFF" : INK, { list: "bullet", lineHeight: 1.9 }),
                                button(i === 1 ? "Start free trial" : "Choose plan", i === 1, null, { sizing: { h: "fill", v: "hug" } }),
                            ],
                            { web: { hover: { y: -4, shadow: true, duration: 200 } } },
                        ),
                    ),
                ),
            ]),
    },
    {
        id: "faq",
        name: "FAQ accordion",
        category: "FAQ",
        about: "Questions that open on click",
        build: () =>
            section("FAQ", "section", SURFACE, [
                heading("Questions and answers", "Can’t find what you need? Write to us."),
                frame(
                    "Questions",
                    stack("vertical", 12),
                    {},
                    [
                        ["Can I use my own domain?", "Yes. Download the site and host it on any server, or point your domain at the published address."],
                        ["Do I need to code?", "No. Everything is visual. If you like, you can still add your own code."],
                        ["Is there a free plan?", "There is, and it includes everything you need for a personal site."],
                    ].map(([q, a]) =>
                        frame(
                            "Question",
                            stack("vertical", 10, [20, 24, 20, 24]),
                            { fills: [solid("#FFFFFF")], strokes: [solid(LINE)], strokeWidth: 1, radius: 12 },
                            [
                                frame("Summary", stack("horizontal", 16, [0, 0, 0, 0], "between", "center"), {}, [text(q ?? "", 17, 600, INK), text("+", 22, 400, MUTED, { sizing: { h: "hug", v: "hug" }, lineHeight: 1 })], { web: { tag: "summary" } }),
                                text(a ?? "", 15, 400, MUTED),
                            ],
                            { web: { tag: "details" } },
                        ),
                    ),
                ),
            ]),
    },
    {
        id: "form",
        name: "Contact form",
        category: "Forms",
        about: "Name, email, message and send",
        build: () =>
            section("Contact", "section", "#FFFFFF", [
                heading("Get in touch", "We usually answer within a day.", true),
                frame(
                    "Form",
                    stack("vertical", 14),
                    { maxW: 560 },
                    [
                        field("Name", "name", "text", "Your name"),
                        field("Email", "email", "email", "you@example.com"),
                        field("Message", "message", "textarea", "How can we help?", 120),
                        { ...button("Send message", true, null, { sizing: { h: "fill", v: "hug" } }), web: { submit: true, hover: { fill: "#4338CA", duration: 150 } } },
                    ],
                    { web: { form: { action: null, success: "Thanks! We’ll be in touch soon." } } },
                ),
            ], 48, 96, "center"),
    },
    {
        id: "gallery",
        name: "Image gallery",
        category: "Media",
        about: "A grid of pictures",
        images: 6,
        build: (imgs) =>
            section("Gallery", "section", "#FFFFFF", [
                heading("Gallery", "A few of our favourite moments."),
                grid(
                    "Images",
                    3,
                    imgs.map((id, i) => ({ ...image(`Photo ${i + 1}`, id, 240, 12), web: { hover: { scale: 1.03, duration: 250 } } })),
                    16,
                ),
            ]),
    },
    {
        id: "video",
        name: "Video",
        category: "Media",
        about: "A video from a link",
        build: () => section("Video", "section", "#FFFFFF", [embed("Video", { kind: "video", url: "", controls: true }, 540)]),
    },
    {
        id: "map",
        name: "Map",
        category: "Media",
        about: "A map of a place",
        build: () => section("Location", "section", "#FFFFFF", [heading("Visit us", "Open every day from 9 to 6."), embed("Map", { kind: "map", query: "Lisbon, Portugal", zoom: 13 }, 400)]),
    },
    {
        id: "code",
        name: "Code embed",
        category: "Media",
        about: "Your own HTML, CSS and script",
        build: () => embed("Code", { kind: "code", code: '<div style="padding:24px;font-family:system-ui;color:#475467">Your code goes here.</div>' }, 200),
    },
    {
        id: "footer",
        name: "Footer",
        category: "Footer",
        about: "Links in columns and the small print",
        build: (_, doc) =>
            frame(
                "Footer",
                stack("vertical", 40, [64, 32, 40, 32], "start", "center"),
                { fills: [solid(INK)] },
                [
                    frame(
                        "Columns",
                        stack("horizontal", 48, [0, 0, 0, 0], "between", "start", true),
                        { maxW: 1120 },
                        [
                            frame("Brand", stack("vertical", 10), { sizing: { h: "hug", v: "hug" } }, [text("Northwind", 20, 800, "#FFFFFF", { sizing: { h: "hug", v: "hug" } }), text("Websites for small teams.", 14, 400, "#98A2B3", { sizing: { h: "hug", v: "hug" } })]),
                            ...[
                                ["Product", ["Features", "Pricing", "Changelog"]],
                                ["Company", ["About", "Careers", "Contact"]],
                            ].map(([title, links]) =>
                                frame(String(title), stack("vertical", 10), { sizing: { h: "hug", v: "hug" } }, [
                                    text(String(title), 14, 700, "#FFFFFF", { sizing: { h: "hug", v: "hug" } }),
                                    ...(links as string[]).map((l, i) => text(l, 14, 400, "#98A2B3", { sizing: { h: "hug", v: "hug" } }, { web: { link: title === "Company" && i === 0 ? pageLink(doc, 1) : { kind: "url", url: "#" }, hover: { textColor: "#FFFFFF", duration: 120 } } })),
                                ]),
                            ),
                        ],
                        { mobile: { layout: stack("vertical", 28) } },
                    ),
                    frame("Small print", stack("horizontal", 0), { maxW: 1120, strokes: [solid("#344054")], strokeWidth: 1, strokeSides: { top: true, right: false, bottom: false, left: false }, layout: stack("horizontal", 0, [24, 0, 0, 0]) }, [text("© 2026 Northwind. All rights reserved.", 13, 400, "#98A2B3")]),
                ],
                { web: { tag: "footer" }, mobile: { layout: stack("vertical", 32, [48, 20, 32, 20], "start", "center") } },
            ),
    },
    {
        id: "text",
        name: "Text",
        category: "Basics",
        about: "A paragraph",
        build: () => text("Write something people want to read.", 17, 400, MUTED),
    },
    {
        id: "heading",
        name: "Heading",
        category: "Basics",
        about: "A section title",
        build: () => text("A clear heading", 36, 700, INK, {}, { web: { tag: "h2" }, mobile: { fontSize: 28 } }),
    },
    {
        id: "button",
        name: "Button",
        category: "Basics",
        about: "A link that looks like a button",
        build: () => button("Click me"),
    },
    {
        id: "image",
        name: "Image",
        category: "Basics",
        about: "A picture",
        images: 1,
        build: ([img]) => image("Image", img ?? "", 320),
    },
    {
        id: "section",
        name: "Empty section",
        category: "Basics",
        about: "A full-width band to fill",
        build: () => section("Section", "section", "#FFFFFF", [text("Section title", 32, 700, INK, {}, { web: { tag: "h2" } })]),
    },
    {
        id: "columns",
        name: "Two columns",
        category: "Basics",
        about: "Side by side, stacked on mobile",
        build: () =>
            frame("Columns", stack("horizontal", 32), {}, [frame("Column 1", stack("vertical", 12), {}, [text("First column", 20, 700)]), frame("Column 2", stack("vertical", 12), {}, [text("Second column", 20, 700)])], {
                mobile: { layout: stack("vertical", 20) },
            }),
    },
];

function field(name: string, key: string, type: "text" | "email" | "textarea", placeholder: string, h = 46): Spec {
    return frame(
        name,
        stack("horizontal", 0, [12, 14, 12, 14], "start", type === "textarea" ? "start" : "center"),
        { fills: [solid("#FFFFFF")], strokes: [solid("#D0D5DD")], strokeWidth: 1, radius: 8, h, sizing: { h: "fill", v: "fixed" } },
        [text(placeholder, 15, 400, "#98A2B3", { lineHeight: 1.4 })],
        { web: { field: { name: key, type, placeholder, required: key !== "message" ? true : undefined } } },
    );
}

// ---- Turning specs into layers ----

interface Built {
    nodes: SceneNode[];
    tablet: [string, Partial<SceneNode>][];
    mobile: [string, Partial<SceneNode>][];
}

function materialize(doc: NagmaDocument, spec: Spec, parentId: string, x: number, y: number, out: Built): SceneNode {
    const props = spec.props ?? {};
    const w = props.w ?? (spec.type === "text" ? Math.max(40, (props.text?.length ?? 4) * (props.fontSize ?? 16) * 0.5) : 400);
    const h = props.h ?? (spec.type === "text" ? Math.round((props.fontSize ?? 16) * 1.4) : 80);
    const node = makeNode(doc, spec.type, { x, y, w, h }, parentId, { name: spec.name, ...props, ...(spec.web ? { site: spec.web } : {}) });
    out.nodes.push(node);
    if (spec.tablet) out.tablet.push([node.id, spec.tablet]);
    if (spec.mobile) out.mobile.push([node.id, spec.mobile]);
    let cy = y;
    for (const child of spec.children ?? []) {
        const c = materialize(doc, child, node.id, x, cy, out);
        cy += c.h;
    }
    return node;
}

// Where an insert lands: after the selected section of the page's desktop frame, else at its end.
function insertTarget(doc: NagmaDocument, pageId: string): { parentId: string; index: number } | null {
    const frames = bpFrames(doc, pageId);
    const desktop = frames.desktop;
    if (!desktop) return null;
    const selected = editor.get().selection[0];
    if (selected) {
        const where = bpOfNode(doc, selected);
        if (where) {
            let id = primaryOf(doc, selected);
            const target = doc.nodes[id];
            // Into a selected empty-ish container frame with auto layout (not the page frame).
            if (target && target.id !== desktop.id && target.layout && target.type === "frame" && !target.layout.grid && target.children.length === 0) return { parentId: target.id, index: 0 };
            while (doc.nodes[id]?.parentId && doc.nodes[id]?.parentId !== desktop.id) id = doc.nodes[id]?.parentId as string;
            const index = desktop.children.indexOf(id);
            if (index >= 0) return { parentId: desktop.id, index: index + 1 };
        }
    }
    return { parentId: desktop.id, index: desktop.children.length };
}

export async function insertBlock(def: BlockDef, pageId: string) {
    const commands: Command[] = [];
    const images: string[] = [];
    for (let i = 0; i < (def.images ?? 0); i++) {
        const p = await placeholder(i + 1 + Math.floor(Math.random() * 8));
        commands.push({ type: "image.add", id: p.id, data: p.data });
        images.push(p.id);
    }
    const doc = editor.get().doc;
    const target = insertTarget(doc, pageId);
    if (!target) return;
    const parent = doc.nodes[target.parentId] as SceneNode;
    const built: Built = { nodes: [], tablet: [], mobile: [] };
    const root = materialize(doc, def.build(images, doc), parent.id, parent.x, parent.y + parent.h, built);
    built.nodes.forEach((node, i) => commands.push({ type: "node.create", node: { ...node, children: [] }, ...(i === 0 ? { index: target.index } : {}) }));
    editor.execute({ type: "batch", commands });
    applyBreakpointChanges(built, pageId);
    editor.set({ selection: [root.id] });
}

// The block's own tablet and mobile settings, as overrides on the copies (one undo step with the
// insert). Pages whose breakpoints differ use the widest other breakpoint for tablet and the
// narrowest for mobile; narrower breakpoints inherit what wider ones change.
function applyBreakpointChanges(built: Built, pageId: string) {
    const doc = editor.get().doc;
    const others = breakpointsOf(doc, pageId).slice(1);
    const tablet = others.find((b) => b.id === "tablet") ?? others[0];
    const mobile = others.find((b) => b.id === "mobile") ?? (others.length > 1 ? others[others.length - 1] : undefined);
    const updates: Command[] = [];
    for (const [bp, list] of [
        [tablet?.id, built.tablet],
        [mobile?.id, built.mobile],
    ] as const) {
        if (!bp) continue;
        for (const [id, patch] of list) {
            const copy = mirrorIdFor(id, bp);
            if (doc.nodes[copy]) updates.push({ type: "node.update", id: copy, patch });
        }
    }
    if (!updates.length) return;
    editor.execute({ type: "batch", commands: updates });
    editor.mergeLast();
}

// ---- CMS list ----

// Sample content for a new collection list: blog posts, or (the Team directory template) people.
const SAMPLES = {
    posts: {
        name: "Posts",
        fields: ["Title", "Summary", "Image"],
        entries: [
            ["Designing for every screen", "How breakpoints keep one design working from phones to wide monitors."],
            ["Write once, publish everywhere", "Collections turn a simple table into pages, lists and cards."],
            ["Small details, big feelings", "Hover states and gentle motion make a site feel alive."],
        ],
    },
    team: {
        name: "Team",
        fields: ["Name", "Role", "Photo"],
        entries: [
            ["Ada Brooks", "Head of design"],
            ["Sam Okafor", "Engineering lead"],
            ["Mia Chen", "Customer success"],
        ],
    },
} as const;

export async function sampleCollection(kind: keyof typeof SAMPLES = "posts", taken: string[] = []): Promise<Collection> {
    const sample = SAMPLES[kind];
    // A second sample collection gets a name of its own ("Posts 2"), so its item page has its own address.
    let name: string = sample.name;
    for (let n = 2; taken.includes(name); n++) name = `${sample.name} ${n}`;
    const c = newCollection(name);
    c.fields = c.fields.map((f, i) => ({ ...f, name: sample.fields[i] ?? f.name }));
    const [title, summary, img] = c.fields;
    const commands: Command[] = [];
    for (const [i, [t, s]] of sample.entries.entries()) {
        const p = await placeholder(i * 3 + 2);
        commands.push({ type: "image.add", id: p.id, data: p.data });
        c.items.push({ id: nanoid(8), slug: uniqueSlug(c, t), values: { [title?.id ?? "t"]: t, [summary?.id ?? "s"]: s, [img?.id ?? "i"]: p.id } });
    }
    if (commands.length) editor.execute({ type: "batch", commands });
    return c;
}

// A grid of cards listing a collection; each card links to the item's page when there is one.
export async function insertCollectionList(pageId: string, collectionId?: string, sample: keyof typeof SAMPLES = "posts") {
    let doc = editor.get().doc;
    let collection = collectionId === "__new" ? undefined : (collectionsOf(doc).find((c) => c.id === collectionId) ?? collectionsOf(doc)[0]);
    if (!collection) {
        collection = await sampleCollection(sample, collectionsOf(doc).map((c) => c.name));
        const command = libraryCommand(editor.get().doc, { collections: [...collectionsOf(editor.get().doc), collection] });
        if (command) {
            editor.execute(command);
            editor.mergeLast();
        }
        doc = editor.get().doc;
    }
    if (!libraryPage(doc)) return;
    const [title, summary, img] = collection.fields;
    const hasPage = Boolean(itemPageFor(doc, collection.id));
    const cardSpec = frame(
        "Item",
        stack("vertical", 12, [0, 0, 20, 0]),
        { sizing: { h: "fill", v: "hug" } },
        [
            ...(img?.type === "image" ? [{ ...image("Image", collection.items[0]?.values[img.id] ?? "", 200, 12), web: { bind: { field: img.id } } }] : []),
            text("Title", 20, 700, INK, {}, { web: { tag: "h3", bind: { field: title?.id ?? "" } } }),
            ...(summary ? [text("Summary", 15, 400, MUTED, {}, { web: { bind: { field: summary.id } } })] : []),
        ],
        { web: { tag: "article", link: hasPage ? { kind: "item" } : null, hover: { y: -3, duration: 180 } } },
    );
    const listSpec = grid(`${collection.name} list`, 3, [cardSpec]);
    listSpec.web = { list: { collectionId: collection.id, limit: null } };
    const spec = section(collection.name, "section", "#FFFFFF", [heading(`Latest ${collection.name.toLowerCase()}`, "Fresh from the collection.", false), listSpec]);
    const target = insertTarget(doc, pageId);
    if (!target) return;
    const parent = doc.nodes[target.parentId] as SceneNode;
    const built: Built = { nodes: [], tablet: [], mobile: [] };
    const root = materialize(doc, spec, parent.id, parent.x, parent.y + parent.h, built);
    editor.execute({ type: "batch", commands: built.nodes.map((node, i) => ({ type: "node.create" as const, node: { ...node, children: [] }, ...(i === 0 ? { index: target.index } : {}) })) });
    applyBreakpointChanges(built, pageId);
    editor.set({ selection: [root.id] });
}

// Builds an item page's starting layout: image, title and the other text fields, bound.
export function itemPageSpec(collection: Collection): Spec {
    const children: Spec[] = [];
    for (const [i, f] of collection.fields.entries()) {
        if (f.type === "image") children.push({ ...image(f.name, "", 420), web: { bind: { field: f.id } } });
        else if (i === 0) children.push(text(f.name, 48, 800, INK, {}, { web: { tag: "h1", bind: { field: f.id } }, mobile: { fontSize: 34 } }));
        else if (f.type === "text" || f.type === "richtext" || f.type === "date" || f.type === "number") children.push(text(f.name, 18, 400, MUTED, {}, { web: { bind: { field: f.id } } }));
    }
    return section("Item", "article", "#FFFFFF", children, 24, 80);
}

export function insertSpec(spec: Spec, pageId: string) {
    const doc = editor.get().doc;
    const target = insertTarget(doc, pageId);
    if (!target) return;
    const parent = doc.nodes[target.parentId] as SceneNode;
    const built: Built = { nodes: [], tablet: [], mobile: [] };
    materialize(doc, spec, parent.id, parent.x, parent.y + parent.h, built);
    editor.execute({ type: "batch", commands: built.nodes.map((node, i) => ({ type: "node.create" as const, node: { ...node, children: [] }, ...(i === 0 ? { index: target.index } : {}) })) });
    applyBreakpointChanges(built, pageId);
}

// A new page: blank, the not-found page (with its message) or a CMS item page.
export function addPage(kind: "blank" | "notFound" | { collectionId: string }) {
    const doc = editor.get().doc;
    if (kind === "notFound") {
        if (sitePages(doc).some((p) => pageData(p)?.notFound)) return editor.notify("The site already has a page for missing addresses.");
        const { commands, pageId } = addPageCommands(doc, "Page not found", { path: "/404", notFound: true });
        editor.execute({ type: "batch", commands });
        editor.setPage(pageId);
        insertSpec(
            {
                type: "frame",
                name: "Not found",
                props: { fills: [], clip: false, layout: { direction: "vertical", gap: 20, padding: [160, 32, 160, 32], primary: "center", counter: "center" }, sizing: { h: "fill", v: "hug" } },
                web: { tag: "section" },
                children: [
                    { type: "text", name: "404", props: { text: "Page not found", fontSize: 48, fontWeight: 800, fontFamily: "Inter", textAlign: "center", fills: [solid(INK)], sizing: { h: "fill", v: "hug" } }, web: { tag: "h1" } },
                    { type: "text", name: "Explanation", props: { text: "The page you were looking for doesn’t exist.", fontSize: 18, fontFamily: "Inter", textAlign: "center", fills: [solid(MUTED)], sizing: { h: "fill", v: "hug" } } },
                ],
            },
            pageId,
        );
        return;
    }
    if (typeof kind === "object") {
        const collection = collectionsOf(doc).find((c) => c.id === kind.collectionId);
        if (!collection) return;
        const { commands, pageId } = addPageCommands(doc, `${collection.name} item`, { path: uniquePath(doc, `/${collection.name}`), collectionId: collection.id });
        editor.execute({ type: "batch", commands });
        editor.setPage(pageId);
        insertSpec(itemPageSpec(collection), pageId);
        return;
    }
    const n = sitePages(doc).length + 1;
    const name = `Page ${n}`;
    const { commands, pageId } = addPageCommands(doc, name, { path: uniquePath(doc, `/page-${n}`) });
    editor.execute({ type: "batch", commands });
    editor.setPage(pageId);
}

// ---- Templates: a whole page of blocks to start from ----

export interface SiteTemplate {
    id: string;
    name: string;
    category: "Marketing" | "Personal" | "CMS";
    about: string;
    // Block ids in order; "list" is a CMS collection list (with an item page made for it).
    blocks: string[];
}

export const TEMPLATES: SiteTemplate[] = [
    { id: "landing", name: "Product launch", category: "Marketing", about: "Hero, features, quotes, pricing and FAQ", blocks: ["nav", "hero-image", "features", "testimonials", "pricing", "faq", "footer"] },
    { id: "event", name: "Event", category: "Marketing", about: "Hero, agenda, map and sign-up form", blocks: ["nav", "hero", "features", "map", "form", "footer"] },
    { id: "portfolio", name: "Portfolio", category: "Personal", about: "Intro, gallery and contact form", blocks: ["nav", "hero", "gallery", "form", "footer"] },
    { id: "blog", name: "Blog", category: "CMS", about: "Posts from a collection, each with its own page", blocks: ["nav", "hero", "list", "footer"] },
    { id: "directory", name: "Team directory", category: "CMS", about: "People from a collection with profile pages", blocks: ["nav", "heading", "list", "footer"] },
];

// Adds a template's blocks to the end of a page, in one undo step.
export async function applyTemplate(template: SiteTemplate, pageId: string) {
    editor.set({ selection: [] });
    let steps = 0;
    for (const id of template.blocks) {
        if (id === "list") {
            const before = collectionsOf(editor.get().doc).length;
            await insertCollectionList(pageId, template.id === "directory" ? "__new" : undefined, template.id === "directory" ? "team" : "posts");
            const after = collectionsOf(editor.get().doc);
            const collection = after[after.length - 1];
            if (collection && after.length > before && !itemPageFor(editor.get().doc, collection.id)) {
                const keep = editor.get().pageId;
                addPage({ collectionId: collection.id });
                editor.setPage(keep);
                steps++;
            }
        } else {
            const def = BLOCKS.find((b) => b.id === id);
            if (!def) continue;
            await insertBlock(def, pageId);
        }
        editor.set({ selection: [] });
        if (steps++ > 0) editor.mergeLast();
    }
    editor.notify(`Added the ${template.name} template.`);
}
