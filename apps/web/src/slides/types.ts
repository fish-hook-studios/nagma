// What makes a layer part of a slides file. Slides are ordinary frames on the file's one page (so
// selection, editing, undo, sync, comments and export keep working); this says what the deck does
// with them on top of that.

export type SlideLayout = "title" | "title-body" | "two-columns" | "three-columns" | "section" | "image-text" | "text-image" | "full-image" | "comparison" | "agenda" | "quote" | "big-number" | "closing" | "blank";

// What a layer is to the theme: which text style it takes, or which theme colour a shape wears.
export type TextRole = "title" | "subtitle" | "heading" | "body" | "caption" | "quote" | "number" | "slide-number" | "footer";
export type ShapeRole = "accent" | "placeholder" | "surface";

export type TransitionKind = "none" | "dissolve" | "smart" | "slide-in" | "slide-out" | "push" | "move-in" | "move-out";
export type SlideDirection = "left" | "right" | "up" | "down";
export type SlideEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "gentle" | "quick" | "bouncy" | "slow";

export interface SlideTransition {
    type: TransitionKind;
    // The way the incoming slide travels (move, push and slide).
    direction: SlideDirection;
    easing: SlideEasing;
    // Milliseconds.
    duration: number;
    // Plays by itself this many milliseconds after the slide before has finished (absent: on click).
    after?: number | null;
}

export type AnimEffect = "appear" | "fade" | "slide" | "scale" | "rise" | "typewriter";
// On click starts a new step; with previous starts alongside the one before; after previous waits for it.
export type AnimTrigger = "click" | "with" | "after";

export interface ObjectAnimation {
    id: string;
    // A layer directly inside the slide.
    target: string;
    effect: AnimEffect;
    trigger: AnimTrigger;
    delay: number;
    duration: number;
    // Slide: the way the layer travels in.
    direction?: SlideDirection;
    // Animates the layer out of view instead of in.
    exit?: boolean;
}

// The five colours every template has; templates can name them and add more.
export type ThemeColorKey = "background" | "surface" | "text" | "muted" | "accent";

export interface TemplateColor {
    id: string;
    name: string;
    color: string;
}

// A text style added to a template: text set in it follows the template when it changes.
export interface TemplateTextStyle {
    id: string;
    name: string;
    fontFamily: string;
    fontWeight: number;
    fontSize: number;
    // One of the template's colours (a ThemeColorKey or an added colour's id).
    color: string;
}

export interface DeckTheme {
    id: string;
    name: string;
    background: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    headingFont: string;
    bodyFont: string;
    headingWeight: number;
    // What the five colours are called (Background, Surface, Text, Muted, Accent when absent).
    names?: Partial<Record<ThemeColorKey, string>>;
    colors?: TemplateColor[];
    textStyles?: TemplateTextStyle[];
}

// A group of slides: one row of the grid. Unnamed groups ("") show no heading.
export interface DeckSection {
    id: string;
    name: string;
}

// "3", "3 / 12" or "3 of 12".
export type NumberFormat = "plain" | "slash" | "of";

export type PollVotes = Record<string, number>;

export type DeckData =
    // The page: the theme every slide follows, slide numbers (and how they read), a footer on every
    // slide, and the sections slides sit in. `picker` shows the template picker over a new deck.
    // `groups`: each section is a group of slides (a row in the grid); slides outside a group sit
    // in a section of their own. Decks from before groups keep their sections until opened.
    // `themes`: the other templates slides in this deck use (a slide names its own in `theme`).
    // `template`: published as a template, so it heads the template library of everyone who has it.
    | { kind: "deck"; theme: DeckTheme; themes?: DeckTheme[]; slideNumbers?: boolean; numberFormat?: NumberFormat; footer?: string; sections: DeckSection[]; picker?: boolean; groups?: boolean; template?: boolean }
    | {
          kind: "slide";
          layout: SlideLayout;
          // The template this slide follows, when it isn't the deck's main one.
          theme?: string;
          section?: string;
          notes?: string;
          skip?: boolean;
          transition?: SlideTransition;
          animations?: ObjectAnimation[];
          // A background chosen for this slide instead of the theme's.
          background?: string | null;
          // Leaves the deck's footer off this slide.
          noFooter?: boolean;
      }
    // Auto-fit: the text shrinks below `fit` (its full size) when it would overflow its box.
    // `style`: a text style the template added (it wins over the role's look). `placed`: a slide
    // number put on the slide by hand (kept when the deck's slide numbers are off).
    // `format` is that number's own reading ("3", "3 / 12", "3 of 12").
    | { kind: "text"; role: TextRole; fit?: number; style?: string; placed?: boolean; format?: NumberFormat }
    | { kind: "shape"; role: ShapeRole }
    // Live widgets the audience answers while presenting; answers are kept by voter id.
    // Hidden results show only how many have answered, until the presenter reveals them.
    | { kind: "poll"; question: string; options: string[]; votes: PollVotes; hideResults?: boolean }
    | { kind: "scale"; question: string; left: string; right: string; votes: PollVotes; hideResults?: boolean }
    | { kind: "stamps"; prompt: string; stamps: { id: string; who: string; glyph: string; x: number; y: number }[] }
    // An embedded page; `prototype` when it shows a prototype from a design file (picked by name).
    | { kind: "embed"; url: string; prototype?: { file: string; frame: string; name: string } }
    // The faces of everyone watching the presentation.
    | { kind: "facepile" }
    // A video from a video site, played in place while presenting.
    | { kind: "video-link"; url: string; start?: number; autoplay?: boolean }
    // Code: the language it's highlighted as, on a dark or light block.
    | { kind: "code"; lang: string; theme?: "dark" | "light" }
    // Tables: column widths and row heights, and the look chosen for it. Cells know their row and
    // column and how many they span.
    | { kind: "table"; cols?: number[]; rows?: number[]; look?: "header" | "banded" | "lined" | "plain" }
    | { kind: "cell"; r: number; c: number; rs?: number; cs?: number }
    // A bar chart drawn from its data.
    | { kind: "chart"; labels?: string[]; values?: number[] };

export type DeckKind = DeckData["kind"];
