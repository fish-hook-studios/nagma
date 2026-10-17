// What makes a document a website, kept on its layers so undo, sync, copies and version history
// carry it along like any other property.
//
// - Each site page is a document page holding one frame per breakpoint (Desktop, Tablet, Mobile).
//   Desktop is the primary breakpoint: the other frames are copies kept in step with it, except for
//   the properties changed on them (their overrides).
// - The library page (listed as Components) holds the site's settings, its CMS collections and the
//   main components shared across pages.
// - Any layer can carry web settings: the HTML element it becomes, a link, hover and press states,
//   a scroll effect, a form field, an embed, or a CMS binding.

// "desktop" is the primary breakpoint; "tablet" and "mobile" are the usual others, and breakpoints
// added later get ids of their own (letters, digits, "-" and "_", never "@").
export type BreakpointId = string;

export interface SitePageData {
    kind: "page";
    // The address of the page inside the site: "/" for the home page, "/about", "/blog"...
    path: string;
    // The page shown for addresses that don't exist.
    notFound?: boolean;
    // SEO: the tab title (the site's title when empty), the search description and a social image.
    title?: string;
    description?: string;
    socialImage?: string | null;
    // Keep this page out of search engines.
    noindex?: boolean;
    // A CMS item page: one page per item of this collection, at <path>/<item slug>.
    collectionId?: string | null;
    // The item shown while editing an item page.
    previewItem?: string | null;
}

export interface SiteFont {
    id: string;
    family: string;
    // An uploaded font file (media id), or none to load the family from the web font service.
    media?: string | null;
    format?: "woff2" | "woff" | "truetype" | "opentype";
    weight?: number;
    italic?: boolean;
}

export type PageTransition = "none" | "fade" | "slide" | "zoom";

export interface SiteSettings {
    title: string;
    description: string;
    lang: string;
    favicon: string | null;
    socialImage: string | null;
    fonts: SiteFont[];
    // Families used in the design are loaded from the web font service.
    webFonts: boolean;
    analytics: string;
    headCode: string;
    bodyCode: string;
    transition: PageTransition;
    noindex: boolean;
}

export type FieldType = "text" | "richtext" | "image" | "link" | "date" | "number";

export interface CollectionField {
    id: string;
    name: string;
    type: FieldType;
}

export interface CollectionItem {
    id: string;
    slug: string;
    // Field id → value. Images hold an image id from the document's images.
    values: Record<string, string>;
}

export interface Collection {
    id: string;
    name: string;
    // The first field is the item's title; slugs come from it.
    fields: CollectionField[];
    items: CollectionItem[];
}

export interface SiteLibraryData {
    kind: "library";
    settings: SiteSettings;
    collections: Collection[];
}

export interface SiteBreakpointData {
    kind: "bp";
    bp: BreakpointId;
    // The narrowest window this breakpoint is used for (the smallest breakpoint always starts at 0,
    // so ranges adjust themselves as breakpoints come and go). Defaults: Desktop 1024, Tablet 800 (768 when not stored, from before).
    min?: number;
    // Non-primary breakpoints: the properties changed on this breakpoint's frame itself.
    ov?: string[];
    // The page's scroll behaviour (on the primary breakpoint's frame): "y" scrolls down only, "both"
    // also sideways. New pages store "both"; pages from before have none and scroll down only.
    overflow?: "y" | "both";
}

export type SiteLink =
    | { kind: "page"; pageId: string; anchor?: string | null }
    | { kind: "url"; url: string; newTab?: boolean }
    | { kind: "section"; nodeId: string }
    | { kind: "email"; email: string }
    // Bound to a CMS link field (or, in a list, the item's own page).
    | { kind: "field"; field: string }
    | { kind: "item" };

export type WebTag = "auto" | "div" | "section" | "header" | "nav" | "main" | "footer" | "article" | "aside" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "button" | "img" | "ul" | "li" | "blockquote" | "details" | "summary";

// Hover and press states: what changes while the pointer is over the layer or pressing it.
export interface StateStyle {
    fill?: string | null;
    textColor?: string | null;
    opacity?: number | null;
    scale?: number | null;
    // Moves the layer by this many pixels (negative lifts it).
    y?: number | null;
    shadow?: boolean;
    duration?: number;
}

// Scroll effects. Appear plays as the layer comes into view (or when the page loads); parallax moves
// it slower or faster than the page; scroll-linked ties its look to how far it has scrolled through
// the window.
export interface AppearEffect {
    kind: "appear";
    // In view of itself, when the page loads, or while another layer (target) is in view.
    trigger: "in-view" | "load" | "layer";
    target?: string | null;
    opacity: number;
    x: number;
    y: number;
    scale: number;
    rotate: number;
    duration: number;
    delay: number;
    easing: "ease" | "ease-out" | "ease-in-out" | "spring" | "linear";
    once: boolean;
}

export interface ParallaxEffect {
    kind: "parallax";
    // -1 to 1: how much slower (positive) or faster (negative) than the page the layer moves.
    speed: number;
}

export interface ScrollLinkedEffect {
    kind: "scroll";
    // What the progress follows: the layer crossing the window (default), the whole page's scroll,
    // or another layer (target) crossing the window.
    trigger?: "self" | "page" | "layer";
    target?: string | null;
    from: { opacity: number; x: number; y: number; scale: number; rotate: number };
    to: { opacity: number; x: number; y: number; scale: number; rotate: number };
}

export type ScrollEffect = AppearEffect | ParallaxEffect | ScrollLinkedEffect;

// What a press (or hover) on the layer does. Change to swaps an instance to another variant of its
// component (and back on the next press, or when the pointer leaves); Back goes to the previous
// page; Scroll to brings another layer into view; Lightbox opens the picture full screen.
export type ActionTrigger = "click" | "hover" | "press";
export type SiteAction =
    | { kind: "change-to"; trigger: ActionTrigger; variantId: string; duration?: number }
    | { kind: "back" }
    | { kind: "scroll-to"; nodeId: string; offset: number; smooth: boolean }
    | { kind: "lightbox"; imageId?: string | null };

// A custom cursor over the layer: a system cursor, or a layer that follows the pointer.
export type CursorEffect =
    | { kind: "system"; cursor: "pointer" | "grab" | "crosshair" | "text" | "zoom-in" | "help" | "move" | "not-allowed" | "none" }
    | { kind: "layer"; nodeId: string; hotspot: "center" | "top-left"; smoothing: number };

// Content that scrolls by itself in a loop.
export interface MarqueeEffect {
    // Pixels per second.
    speed: number;
    direction: "left" | "right" | "up" | "down";
    pauseOnHover: boolean;
}

export interface FormSettings {
    // Where submissions go (an address that accepts form posts); none shows the message instead.
    action?: string | null;
    success: string;
}

export interface FieldSettings {
    name: string;
    type: "text" | "email" | "tel" | "number" | "textarea" | "checkbox" | "select";
    placeholder?: string;
    required?: boolean;
    options?: string[];
}

export type EmbedSettings =
    | { kind: "video"; url: string; autoplay?: boolean; controls?: boolean }
    | { kind: "map"; query: string; zoom?: number }
    | { kind: "code"; code: string };

export type SiteOverflow = "visible" | "hidden" | "x" | "y" | "both";

// Per-layer web data (all optional), plus what the editor keeps to link breakpoints and CMS copies.
export interface SiteNodeData {
    kind?: undefined;
    tag?: WebTag;
    // The id used for links to this section ("#features").
    anchor?: string | null;
    link?: SiteLink | null;
    hover?: StateStyle | null;
    press?: StateStyle | null;
    effect?: ScrollEffect | null;
    action?: SiteAction | null;
    cursor?: CursorEffect | null;
    marquee?: MarqueeEffect | null;
    form?: FormSettings | null;
    field?: FieldSettings | null;
    submit?: boolean;
    embed?: EmbedSettings | null;
    // Scroll behaviour: how the layer's content overflows it (unset: Clip content decides).
    overflow?: SiteOverflow | null;
    // CMS: this layer shows a field of the current item.
    bind?: { field: string } | null;
    // CMS: this frame lists a collection's items, repeating its first child for each one.
    list?: { collectionId: string; limit?: number | null } | null;
    // Breakpoints: the primary layer this one mirrors, and the properties changed here.
    src?: string;
    ov?: string[];
    // A CMS repeat: the template layer it copies and the item it shows (made by the editor).
    rep?: { of: string; item: string };
}

export type SiteData = SitePageData | SiteLibraryData | SiteBreakpointData | SiteNodeData;
