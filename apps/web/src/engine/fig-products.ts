import { nanoid } from "nanoid";
import { DEFAULT_BRAND, SIZE_PRESETS, arrangeCommands } from "../campaign/model";
import { THEMES, tidyCommands } from "../slides/model";
import type { DeckSection, DeckTheme } from "../slides/types";
import { applyCommand } from "./commands";
import type { FigImportResult } from "./fig-import";
import type { FileKind } from "./files";
import type { NagmaDocument, SceneNode } from "./types";

// An imported .deck becomes a slides file and a .buzz a campaign: the frames the slide grid held
// are stamped with what each product keeps on its layers, and laid out the way the product does.

export function productDocument(result: FigImportResult): { doc: NagmaDocument; kind: FileKind } {
    if (result.kind === "deck" && result.product) return { doc: deckDocument(result), kind: "slides" };
    if (result.kind === "campaign" && result.product) return { doc: campaignDocument(result), kind: "campaign" };
    return { doc: result.doc, kind: "design" };
}

// The page the product shows, moved first (both products read their page from the front).
function withMainPageFirst(doc: NagmaDocument): { doc: NagmaDocument; page: SceneNode } {
    const mainId = doc.roots.find((id) => !doc.nodes[id]?.internal) ?? doc.roots[0];
    const page = doc.nodes[mainId ?? ""] as SceneNode;
    const roots = [page.id, ...doc.roots.filter((id) => id !== page.id)];
    return { doc: { ...doc, roots }, page };
}

function memberNodes(result: FigImportResult, members: string[]): string[] {
    return members.map((key) => result.ids[key]).filter((id): id is string => Boolean(id && result.doc.nodes[id]));
}

function solidFill(node: SceneNode | undefined): string | null {
    const paint = node?.fills.find((p) => p.type === "solid" && p.visible !== false);
    return paint && paint.type === "solid" ? paint.color : null;
}

function* subtree(doc: NagmaDocument, id: string): Generator<SceneNode> {
    const node = doc.nodes[id];
    if (!node) return;
    yield node;
    for (const child of node.children) yield* subtree(doc, child);
}

// The deck's theme, read off the first slide: its background, and the fonts and colour of its
// largest and most common text.
function themeFrom(doc: NagmaDocument, slideId: string | undefined): DeckTheme {
    const base = THEMES[0] as DeckTheme;
    if (!slideId) return base;
    const texts = [...subtree(doc, slideId)].filter((n) => n.type === "text");
    const biggest = [...texts].sort((a, b) => (b.fontSize ?? 0) - (a.fontSize ?? 0))[0];
    const fonts = new Map<string, number>();
    for (const t of texts) if (t !== biggest && t.fontFamily) fonts.set(t.fontFamily, (fonts.get(t.fontFamily) ?? 0) + 1);
    const bodyFont = [...fonts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? biggest?.fontFamily ?? base.bodyFont;
    return {
        ...base,
        id: "imported",
        name: "Imported",
        background: solidFill(doc.nodes[slideId]) ?? base.background,
        text: solidFill(biggest) ?? base.text,
        headingFont: biggest?.fontFamily ?? base.headingFont,
        headingWeight: biggest?.fontWeight ?? base.headingWeight,
        bodyFont,
    };
}

function deckDocument(result: FigImportResult): NagmaDocument {
    const product = result.product as NonNullable<FigImportResult["product"]>;
    const { doc: ordered, page } = withMainPageFirst(result.doc);
    const nodes = { ...ordered.nodes };
    const sections: DeckSection[] = product.rows.map((row, i) => ({ id: nanoid(8), name: row.name.trim() || `Section ${i + 1}` }));
    let count = 0;
    let first: string | undefined;
    product.rows.forEach((row, i) => {
        for (const id of memberNodes(result, row.members)) {
            const node = nodes[id] as SceneNode;
            if (node.type !== "frame") continue;
            count += 1;
            first ??= id;
            const notes = product.notes[Object.keys(result.ids).find((k) => result.ids[k] === id) ?? ""] ?? "";
            nodes[id] = {
                ...node,
                name: /^\d*$/.test(node.name.trim()) ? `Slide ${count}` : node.name,
                clip: true,
                deck: { kind: "slide", layout: "blank", section: sections[i]?.id, ...(notes ? { notes } : {}) },
            };
        }
    });
    const theme = themeFrom({ ...ordered, nodes }, first);
    nodes[page.id] = { ...page, name: "Slides", deck: { kind: "deck", theme, sections } };
    const doc: NagmaDocument = { ...ordered, nodes, slides: true };
    return applyCommand(doc, { type: "batch", commands: tidyCommands(doc) });
}

// The campaign tool's size types, and a match by size for the rest.
const SIZE_TYPES: Record<string, string> = {
    GOOGLE_MED_AD: "medium-rectangle",
    GOOGLE_LARGE_RECT: "large-rectangle",
    GOOGLE_LEADERBOARD: "leaderboard",
    GOOGLE_HALF_PAGE: "half-page",
    GOOGLE_SKYSCRAPER: "skyscraper",
    GOOGLE_BILLBOARD: "billboard",
    GOOGLE_MOBILE_BANNER: "mobile-banner",
    GOOGLE_LARGE_AD: "large-rectangle",
    GOOGLE_LEADERBOARD_AD: "leaderboard",
    GOOGLE_SKYSCRAPER_AD: "skyscraper",
    GOOGLE_MOBILE_BANNER_AD: "mobile-banner",
    TWITTER_POST: "wide",
    TWITTER_BANNER: "header",
    LINKEDIN_POST: "pro-post",
    LINKEDIN_POST_SQUARE: "pro-square",
    LINKEDIN_POST_PORTRAIT: "pro-portrait",
    LINKEDIN_POST_LANDSCAPE: "link",
    LINKEDIN_PROFILE_BANNER: "profile-banner",
    LINKEDIN_ARTICLE_BANNER: "article-banner",
    LINKEDIN_AD_LANDSCAPE: "sponsored-landscape",
    LINKEDIN_AD_SQUARE: "sponsored-square",
    LINKEDIN_AD_VERTICAL: "sponsored-vertical",
    INSTA_POST_SQUARE: "square",
    INSTA_POST_PORTRAIT: "portrait",
    INSTA_STORY: "story",
    INSTA_AD: "photo-ad",
    INSTA_REEL_COVER: "reel-cover",
    FACEBOOK_POST: "feed",
    FACEBOOK_COVER_PHOTO: "cover",
    FACEBOOK_EVENT_COVER: "event-cover",
    FACEBOOK_AD_PORTRAIT: "portrait-ad",
    FACEBOOK_AD_SQUARE: "square-ad",
    PINTEREST_AD_PIN: "pin-ad",
    YOUTUBE_THUMBNAIL: "thumbnail",
    YOUTUBE_BANNER: "channel-banner",
    YOUTUBE_AD: "video-ad",
    TWITCH_BANNER: "stream-banner",
    CARD_HORIZONTAL: "card-landscape",
    CARD_VERTICAL: "card-portrait",
    PRINT_US_LETTER: "letter",
    POSTER: "poster",
    BANNER_STANDARD: "banner",
    BANNER_WIDE: "wide-banner",
    BANNER_ULTRAWIDE: "ultrawide-banner",
    NAME_TAG_PORTRAIT: "name-tag-portrait",
    NAME_TAG_LANDSCAPE: "name-tag-landscape",
    ZOOM_BACKGROUND: "call-background",
};

function presetFor(sizeType: string | undefined, node: SceneNode): string {
    const known = sizeType ? SIZE_TYPES[sizeType] : undefined;
    if (known) return known;
    const bySize = SIZE_PRESETS.find((p) => Math.round(node.w) === p.w && Math.round(node.h) === p.h);
    return bySize?.id ?? "custom";
}

function campaignDocument(result: FigImportResult): NagmaDocument {
    const product = result.product as NonNullable<FigImportResult["product"]>;
    const { doc: ordered, page } = withMainPageFirst(result.doc);
    const nodes = { ...ordered.nodes };
    const rows = product.rows.map((row, i) => ({ id: nanoid(8), name: row.name.trim() || `Row ${i + 1}` }));
    product.rows.forEach((row, i) => {
        for (const id of memberNodes(result, row.members)) {
            const node = nodes[id] as SceneNode;
            if (node.type !== "frame") continue;
            const key = Object.keys(result.ids).find((k) => result.ids[k] === id) ?? "";
            nodes[id] = { ...node, clip: true, campaign: { kind: "asset", preset: presetFor(product.sizeType[key], node), rowId: rows[i]?.id ?? (rows[0]?.id as string) } };
        }
    });
    nodes[page.id] = { ...page, name: "Assets", fills: [], campaign: { kind: "page", rows: rows.length ? rows : [{ id: nanoid(8), name: "Row 1" }], brand: DEFAULT_BRAND } };
    const doc: NagmaDocument = { ...ordered, nodes, campaign: true };
    return applyCommand(doc, { type: "batch", commands: arrangeCommands(doc) });
}
