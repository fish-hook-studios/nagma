import type { JamData } from "../board/types";
import type { DeckData } from "../slides/types";
import type { CampaignData } from "../campaign/types";
import type { SiteData } from "../site/types";
import type { MakeData } from "../make/types";

// The Nagma document model. Pure data, so it can be serialized, synced and replayed.
// Phase 0 keeps it in TypeScript; later phases move node kinds onto the Rust engines (VectorCraft and friends).

// Groups have no appearance of their own: their box always wraps their children.
// Components are frames that can be reused; instances are live copies of a component.
// A component set holds variants: components named like "Size=Large, State=Hover".
// Vectors are pen paths; booleans combine their children's shapes live (union, subtract…).
export type NodeType = "page" | "frame" | "component" | "componentSet" | "instance" | "group" | "boolean" | "rect" | "ellipse" | "vector" | "text";

export interface SceneNode {
    id: string;
    type: NodeType;
    name: string;
    parentId: string | null;
    children: string[];
    x: number;
    y: number;
    w: number;
    h: number;
    // Rotation in degrees around the layer's centre, then mirroring. Children of a frame live in the
    // frame's own (unrotated) space, so rotating a frame turns its contents with it.
    rotation: number;
    flipX: boolean;
    flipY: boolean;
    // Paints stack bottom to top, like layers.
    fills: Paint[];
    strokes: Paint[];
    strokeWidth: number;
    strokeAlign: "inside" | "center" | "outside";
    // Stroke ends and corners, and an optional dash pattern (dash, gap).
    strokeCap?: "butt" | "round" | "square";
    // Open paths: a shape at either end (arrow heads, dots), on top of the plain cap.
    strokeCapStart?: EndCap;
    strokeCapEnd?: EndCap;
    strokeJoin?: "miter" | "round" | "bevel";
    // Miter joins turn into bevels below this angle (degrees; 28.96 when absent).
    miterAngle?: number;
    dash?: [number, number] | null;
    // A custom dash pattern (dash, gap, dash, gap…); overrides `dash` when set.
    dashPattern?: number[] | null;
    // Frames: column, row or grid guides drawn over the frame while layout guides are shown.
    guides?: LayoutGuide[];
    // The guide style the frame's guides come from (until edited by hand).
    gridStyleId?: string | null;
    // Prototype: how the layer behaves when its screen scrolls, and (frames) whether their content scrolls.
    scrollPosition?: "parent" | "fixed" | "sticky";
    overflow?: "none" | "vertical" | "horizontal" | "both";
    // Styles the layer follows (its paints and type come from them until detached).
    fillStyleId?: string | null;
    strokeStyleId?: string | null;
    textStyleId?: string | null;
    effectStyleId?: string | null;
    // Text: a list marker per paragraph, and the writing direction.
    list?: "bullet" | "number" | null;
    direction?: "ltr" | "rtl";
    // Rectangles and frames: which sides carry the stroke (all when unset).
    strokeSides?: { top: boolean; right: boolean; bottom: boolean; left: boolean } | null;
    // Rectangles and frames: a weight per side (top, right, bottom, left), the reference's "Custom" sides.
    strokeWeights?: [number, number, number, number] | null;
    // Vectors: stroke width multipliers along the path (start, middle, end), for a variable-width stroke.
    strokeProfile?: [number, number, number] | null;
    // Vectors: width points along the stroke (position 0 to 1 along the whole outline, width as a
    // multiple of the stroke weight). Takes over from strokeProfile when set.
    widthPoints?: { t: number; w: number }[] | null;
    // Draw mode's stroke types (Advanced stroke: Basic, Dynamic, Brush; engine/stroke-styles.ts),
    // each drawn as a filled outline along the centre line.
    dynamicStroke?: DynamicStroke | null;
    brushStroke?: BrushStroke | null;
    // Polygons and stars stay parametric until their points are edited: the point count, and for
    // stars the inner radius as a fraction of the outer one. `radius` rounds their corners.
    parametric?: { kind: "polygon" | "star"; count: number; ratio: number } | null;
    // Strokes: only the part of the outline between these fractions of its length is drawn
    // (0 and 1 when absent). Animating them draws, erases or travels along the path.
    trimStart?: number;
    trimEnd?: number;
    // Frames: a section is a labelled region of the canvas that doesn't clip or export as a screen.
    // Keeps width and height in proportion when either is typed or dragged, at the ratio taken
    // when the lock was set (the current size when absent).
    lockAspect?: boolean;
    targetAspectRatio?: { w: number; h: number } | null;
    // Motion: a scale around the layer's centre (1 when absent), applied with its children.
    scaleX?: number;
    scaleY?: number;
    isSection?: boolean;
    // Sections: their contents are hidden on the canvas (the section itself still shows).
    sectionContentsHidden?: boolean;
    // Frames and sections: the Inspect status (engine/dev-status.ts). "changed" is also shown when a
    // ready or completed design no longer matches the fingerprint taken when it was marked.
    devStatus?: "ready" | "completed" | "changed" | null;
    devStatusSig?: string | null;
    // Why the design changed, given when a changed design is marked ready again.
    devStatusNote?: string | null;
    // Top-level frames and sections: when something inside last changed (engine/edited-at.ts).
    editedAt?: number;
    // Data plugins keep on the layer, keyed "pluginId:key"; shared data is keyed
    // "shared:namespace:key" so any plugin can read it (engine/plugins.ts).
    pluginData?: Record<string, string>;
    // Relaunch buttons plugins put on the layer: by plugin id, each command with its description
    // (shown in the Design panel when the layer is selected).
    relaunchData?: Record<string, Record<string, string>>;
    // A widget's root layer: which widget drew it and its synced state (engine/widgets.ts). Layers
    // inside it with a click handler keep the handler's index.
    widget?: { pluginId: string; state: Record<string, unknown> };
    widgetHandler?: number;
    // Who marked it ready, when, and its layers at that moment (for Compare changes).
    devReady?: { at: number; by: string; snapshot: Record<string, SceneNode> } | null;
    // Inspect: links for developers (code, docs, tickets) attached to this layer.
    devResources?: { id: string; name: string; url: string }[];
    // Frames: a slice is an export region. It draws nothing and exports what lies under it.
    isSlice?: boolean;
    // Dev notes pinned to this layer (the Annotation tool): plain text plus the rich text (limited
    // HTML: bold, italic, lists, links), properties of the layer shown live, and a category.
    annotations?: Annotation[];
    // Pages: measurements kept between two layers, or along one layer (the Measurement tool), with an
    // optional label instead of the number and an offset that moves the line off the design.
    measurements?: { id: string; a: string; b: string; label?: string; offset?: number }[];
    // The file's first page: the annotation categories (Development, Interaction…), editable per file.
    annotationCategories?: AnnotationCategory[];
    // The file's first page: brushes made in this file (Create brush), listed with the built-ins.
    customBrushes?: CustomBrushDef[];
    // Text: the vector, line or shape whose outline this text runs along, and how far along it
    // (0 to 1) the text starts.
    pathId?: string | null;
    textPathStart?: number;
    // How the layer mixes with what's below it.
    blendMode: BlendMode;
    radius: number;
    // Independent corner radii (top-left, top-right, bottom-right, bottom-left) override `radius`.
    radii?: [number, number, number, number] | null;
    // 0 to 1: how far the corner curve continues past the radius (iOS-style "squircle" corners).
    cornerSmoothing?: number;
    // Ellipses: an arc or ring (degrees from the right, clockwise; inner radius as a fraction).
    arc?: { start: number; sweep: number; inner: number } | null;
    opacity: number;
    shadow: Shadow | null;
    blur: number;
    // More effects on top of the shadow and blur above: inner shadows, extra drop shadows, background blur.
    effects?: Effect[];
    // A mask hides the siblings above it (in the same parent) outside its own shape.
    isMask?: boolean;
    maskType?: "alpha" | "vector" | "luminance";
    // Frames only: hide children outside the frame's bounds.
    clip: boolean;
    // Frames only: stack children automatically.
    layout: AutoLayout | null;
    // How this layer is sized on each axis: its own size, its content's ("hug", auto-layout frames and
    // text), or its auto-layout parent's remaining space ("fill").
    sizing: { h: Sizing; v: Sizing };
    // Inside auto layout: an absolute child is taken out of the flow and keeps its constraints.
    positioning?: "auto" | "absolute";
    // Inside a grid: the cell it starts in (from 0; absent for automatic placement), how many
    // columns and rows it covers, and how it sits in that area ("auto" follows the grid's alignment).
    gridPosition?: { col: number; row: number } | null;
    gridSpan?: { col: number; row: number } | null;
    gridAlign?: { h: "auto" | "start" | "center" | "end"; v: "auto" | "start" | "center" | "end" } | null;
    // Limits that hug and fill sizing respect.
    minW?: number | null;
    maxW?: number | null;
    minH?: number | null;
    maxH?: number | null;
    visible: boolean;
    locked: boolean;
    text?: string;
    fontSize?: number;
    fontWeight?: number;
    fontFamily?: string;
    italic?: boolean;
    // Line height as a multiple of the font size; null is "auto".
    lineHeight?: number | null;
    // Letter spacing as a percentage of the font size.
    letterSpacing?: number;
    textAlign?: "left" | "center" | "right" | "justify";
    textAlignV?: "top" | "middle" | "bottom";
    decoration?: "none" | "underline" | "strikethrough";
    // How the underline or strikethrough is drawn: its line style, distance below the baseline
    // (px; null is the font's own), thickness (px; null is the font's own), colour (null follows
    // the text) and whether it skips descenders.
    decorationStyle?: TextDecorationStyle;
    decorationOffset?: number | null;
    decorationThickness?: number | null;
    decorationColor?: string | null;
    decorationSkipInk?: boolean;
    // Letter case applied when drawing (the characters stay as typed). "small-caps-forced" sets
    // every letter in small capitals, not just the lower-case ones.
    textCase?: TextCase;
    // Cut the text after this many lines with an ellipsis (fixed-height text).
    maxLines?: number | null;
    // Truncate text: ends the last allowed line with an ellipsis (max lines applies only when on).
    truncate?: boolean;
    // Extra space between paragraphs, and the indent of each paragraph's first line.
    paragraphSpacing?: number;
    paragraphIndent?: number;
    // A link the whole layer opens in the prototype player: a URL, or "node:<id>" to go to a frame.
    hyperlink?: string | null;
    // What an image shows, for people using screen readers (slides read it out while presenting).
    altText?: string;
    // Rich text: styles for ranges of characters on top of the layer's own (engine/rich-text.ts).
    spans?: TextSpan[];
    // One entry per paragraph (text split on "\n"): its list marker and indentation level, like
    // The reference's text lines. Without it every paragraph follows the layer's `list`.
    paragraphs?: ParagraphStyle[];
    // Extra space between list items, and list markers hanging outside the box.
    listSpacing?: number;
    hangingList?: boolean;
    // Quotes and punctuation at a line's start (or end, right aligned) sit outside the text edge.
    hangingPunctuation?: boolean;
    // Vertical trim: "cap" fits the box from the first line's cap height to the last baseline.
    leadingTrim?: "none" | "cap";
    // Line breaking: greedy (auto), even line lengths (balance) or no lone last word (pretty).
    textWrap?: "auto" | "balance" | "pretty";
    // OpenType features switched on or off by tag (liga, tnum, smcp...), and variable font axes by tag.
    openType?: Record<string, boolean>;
    fontVariations?: Record<string, number>;
    // Vectors: the path, in its own coordinates (scaled to the layer's size when drawn).
    path?: VectorPath;
    // Vector networks: the regions filled one by one (the Paint tool). Each is the region's segment
    // signature and a point inside it (as a fraction of the layer's box), which finds the region
    // again after points are added. Absent: every closed subpath fills, as for a plain path.
    regionFills?: RegionFill[];
    // Motion mode keyframes.
    animation?: Animation;
    // Booleans: how the children's shapes combine.
    booleanOp?: BooleanOp;
    // How the layer follows its frame when the frame is resized (ignored inside auto layout).
    constraints?: Constraints;
    // Prototype links from this layer, and (frames only) whether a prototype flow starts here.
    interactions?: Interaction[];
    flowStart?: boolean;
    // The flow's name, shown by the play marker and in the Flows list.
    flowName?: string;
    flowDescription?: string;
    // Transform groups (Draw mode): repeat the group's layers in a line or around a centre. Their
    // generated copies carry `repeatOf` (the group's id) and are rebuilt after each edit.
    repeat?: RepeatTransform | null;
    repeatOf?: string;
    // Instances: the main component this is a copy of, and a uniform scale applied to the whole
    // instance (1 when absent).
    componentId?: string;
    scaleFactor?: number;
    // Frames detached from an instance: the component they came from, so it can be found again.
    detachedInfo?: { componentId: string; componentKey?: string } | null;
    // Components: the properties instances can set (show/hide, text, swap a nested instance).
    componentProps?: ComponentProp[];
    // Components and component sets: what it is for, and links to its documentation.
    description?: string;
    // The description with light markdown (bold, italics, links, lists); `description` is its plain text.
    descriptionMarkdown?: string;
    docLinks?: { label?: string; url: string }[];
    // Components and component sets: hand-written code for the component per language (Inspect's
    // connected code). {Property} placeholders take an instance's property values.
    codeConnect?: CodeConnectSnippet[];
    // Components and component sets: left out when the file is published as a library (the reference's
    // "Hide when publishing"). Names starting with "." or "_" are hidden the same way.
    hiddenFromPublishing?: boolean;
    // Components cached from a library (on the file's internal page): which library, and the
    // published item's key, so instances keep their link and pick up library updates.
    libraryId?: string;
    libraryKey?: string;
    // A main component pasted here from another file (cut from a published library and moved):
    // that file and the component's id there, so files using the old one can follow it here.
    movedFrom?: { fileId: string; key: string } | null;
    // Nested instances inside a component: their properties show on the outer instance.
    exposed?: boolean;
    // Layers inside a component: which property drives what (a slot frame takes any layers in instances).
    propBindings?: { visible?: string; text?: string; swap?: string; slot?: string } | null;
    // Pages: the hidden page that keeps library components this file uses, and the enabled libraries.
    internal?: boolean;
    libraries?: LibraryLink[];
    // Instances: the values chosen for the component's properties.
    propValues?: Record<string, boolean | string>;
    // Variables bound to fields; the value is kept in step with the variable (engine/variables.ts).
    boundVariables?: Record<string, string>;
    // Frames: which mode each collection uses for this subtree.
    variableModes?: Record<string, string>;
    // Pages: ruler guides.
    rulerGuides?: { axis: "x" | "y"; at: number }[];
    // Export presets remembered on the layer: a size as a scale or a fixed width or height, a file
    // name suffix, and per-format options (engine/export.ts).
    exportSettings?: ExportSetting[];
    // Layers inside an instance: the component layer they mirror.
    sourceId?: string;
    // Properties changed on this instance (or layer inside one) that survive component updates.
    overrides?: string[];
    // Board objects (stickies, shapes with text, connectors, stamps, tables, tape, marker strokes)
    // carry what makes them board objects here (board/types.ts).
    jam?: JamData;
    // Slides files: the deck's settings (on the page), a slide's notes, transition and animations
    // (on its frame), and what an element is to the theme or as a live widget (slides/types.ts).
    deck?: DeckData;
    // Campaign assets, their template fields and the campaign's rows (campaign/types.ts).
    campaign?: CampaignData;
    // Sites: pages and breakpoints, the site's settings and CMS, and each layer's web settings (site/types.ts).
    site?: SiteData;
    // Make files: the project, its chat and versions, on the page (make/types.ts).
    make?: MakeData;
}

export type Sizing = "fixed" | "hug" | "fill";

export type TextDecorationStyle = "solid" | "double" | "dotted" | "dashed" | "wavy";
export type TextCase = "none" | "upper" | "lower" | "title" | "small-caps" | "small-caps-forced";

export interface ExportSetting {
    format: "png" | "jpg" | "svg" | "pdf";
    // Raster size: a scale (0.5x to 4x), or a width or height in pixels with the other side in proportion.
    scale: number;
    constraint?: "scale" | "width" | "height";
    size?: number;
    suffix: string;
    // SVG: text as outlines, layer names as ids, inside and outside strokes written as centre strokes.
    svgOutlineText?: boolean;
    svgIncludeId?: boolean;
    svgSimplifyStroke?: boolean;
    // Raster and PDF: only the layer (true), or everything that shows within its bounds (false).
    contentsOnly?: boolean;
    // Raster: the layer's full bounds, ignoring what its parents clip away (text overflow included).
    absoluteBounds?: boolean;
    // JPG: compression quality 0 to 1 (0.9 when absent). PDF: how its images are compressed.
    jpgQuality?: number;
    pdfQuality?: "high" | "medium" | "low";
    // Raster: images resampled smoothly when scaled, or kept as sharp pixels.
    resampling?: "smooth" | "detailed";
    // Raster: the colour space the file is written in ("document" follows the file's setting).
    colorProfile?: "document" | "srgb" | "p3";
}

export interface Constraints {
    h: "left" | "right" | "left-right" | "center" | "scale";
    v: "top" | "bottom" | "top-bottom" | "center" | "scale";
}

export type TransitionType = "instant" | "dissolve" | "move-in" | "move-out" | "push" | "slide-in" | "slide-out" | "smart";
export type Direction = "left" | "right" | "up" | "down";

export type Easing =
    | "linear"
    | "ease-in"
    | "ease-out"
    | "ease-in-out"
    | "ease-in-back"
    | "ease-out-back"
    | "ease-in-out-back"
    | "custom-bezier"
    | "spring-gentle"
    | "spring-quick"
    | "spring-bouncy"
    | "spring-slow"
    | "custom-spring";

// A spring's physics: the duration follows from them (the spring settles). The initial velocity
// (in units of the distance per second, 0 by default) gives the spring a push at the start.
export interface Spring {
    mass: number;
    stiffness: number;
    damping: number;
    initialVelocity?: number;
}

export interface Transition {
    type: TransitionType;
    // Which way new content travels, for move, push and slide.
    direction: Direction;
    // Milliseconds (springs work theirs out from the physics).
    duration: number;
    easing: Easing;
    // Custom bezier: the two control points (x1, y1, x2, y2), as in CSS cubic-bezier.
    bezier?: [number, number, number, number];
    // Custom spring.
    spring?: Spring;
    // Move, push and slide: layers with the same name on both screens match animate between them
    // instead of travelling with their screen.
    matchLayers?: boolean;
    // Easing and timing variables the curve and duration follow (engine/variables.ts).
    easingVariable?: string;
    durationVariable?: string;
    // An animation style the whole transition follows (engine/styles.ts).
    styleId?: string | null;
}

export type Trigger =
    // An interaction that is set up but never fires (the reference's "None").
    | "none"
    | "click"
    | "hover"
    | "press"
    | "drag"
    | "delay"
    | "mouse-enter"
    | "mouse-leave"
    | "mouse-down"
    | "mouse-up"
    | "key"
    // Layers with a video fill: when it plays to its end, or reaches `videoTime`.
    | "video-end"
    | "video-time";

export interface OverlaySettings {
    position: "center" | "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right" | "manual";
    // Manual: offset from the screen's corner.
    x: number;
    y: number;
    background: boolean;
    backgroundColor: string;
    backgroundOpacity: number;
    closeOnOutside: boolean;
}

export type ActionType =
    | "navigate"
    | "change-to"
    | "back"
    | "scroll-to"
    | "url"
    | "overlay"
    | "swap"
    | "close"
    | "set-variable"
    | "set-mode"
    | "conditional"
    | "video"
    // Layer animations (Motion mode keyframes): play, pause or toggle, or move the playhead.
    | "animation"
    | "set-playhead";

export type AnimationOp = "play" | "pause" | "toggle";

export type VideoOp = "play" | "pause" | "toggle-play" | "mute" | "unmute" | "toggle-mute" | "jump" | "seek";

// One step of an interaction. Which fields matter depends on the type.
export interface PrototypeAction {
    type: ActionType;
    // Navigate, overlay, swap: a top-level frame or a section; change to: a variant; scroll to: a
    // layer on the same screen; video: a layer with a video fill.
    target?: string | null;
    // Open link: the address, and whether it opens in a new tab.
    url?: string;
    newTab?: boolean;
    transition?: Transition;
    overlay?: OverlaySettings;
    // State management (navigate, change to, overlays, back).
    resetScroll?: boolean;
    resetState?: boolean;
    resetVideo?: boolean;
    // Scroll to: offset from the layer's corner.
    offset?: { x: number; y: number };
    // Set variable: which one, and an expression for its new value (engine/expressions.ts).
    variableId?: string;
    expression?: string;
    // Set variable mode.
    collectionId?: string;
    modeId?: string;
    // Conditional: "if" blocks checked in order, the last one may be an "else" (no condition).
    blocks?: ConditionalBlock[];
    // Video: play, pause, mute, jump forward or back by `seconds`, or seek to `seconds`.
    video?: { op: VideoOp; seconds: number };
    // Play/pause animation (target: an animated layer).
    animation?: { op: AnimationOp };
    // Set playhead (target: an animated layer): the time in milliseconds, and whether it plays on
    // from there or stays paused.
    playhead?: { ms: number; play: boolean };
}

export interface ConditionalBlock {
    condition: string | null;
    actions: PrototypeAction[];
}

// Where a "key" trigger listens: the keyboard, or a game controller (the Gamepad API); "controller"
// is any controller.
export type TriggerDevice = "keyboard" | "xbox" | "playstation" | "switch" | "controller";

export interface Interaction {
    trigger: Trigger;
    // For "delay": milliseconds after the frame appears.
    delay: number;
    // For "key": the key name (as in KeyboardEvent.key), with modifiers written before it
    // ("Shift+Meta+k"); for a controller, the button index (standard gamepad mapping).
    key?: string;
    device?: TriggerDevice;
    button?: number;
    // Mouse enter, leave, down and up: milliseconds to wait before the actions run.
    triggerDelay?: number;
    // For "video-time": seconds into the video.
    videoTime?: number;
    // What happens, in order. Older files keep one action on the interaction itself (the fields
    // below); actionsOf in engine/prototype.ts reads either.
    actions?: PrototypeAction[];
    action?: "navigate" | "back" | "overlay" | "swap" | "close" | "url" | "scroll-to" | "set-variable" | "set-mode";
    variableId?: string;
    value?: VariableValue;
    collectionId?: string;
    modeId?: string;
    condition?: { variableId: string; op: "==" | "!=" | ">" | "<" | ">=" | "<="; value: string | number | boolean } | null;
    target?: string | null;
    url?: string;
    transition?: Transition;
    overlay?: OverlaySettings;
}

export type BooleanOp = "union" | "subtract" | "intersect" | "exclude";

// One anchor of a path. Handles are absolute positions in path coordinates; null means a sharp corner.
export interface PathPoint {
    x: number;
    y: number;
    in: { x: number; y: number } | null;
    out: { x: number; y: number } | null;
    // A sharp point's own corner radius (vector edit mode), drawn as an arc between its two segments.
    radius?: number;
}

export interface RegionFill {
    id: string;
    x: number;
    y: number;
}

export interface Subpath {
    points: PathPoint[];
    closed: boolean;
}

// A path drawn in a w×h box; the layer's own size scales it.
export interface VectorPath {
    w: number;
    h: number;
    subpaths: Subpath[];
}

export interface LayoutGuide {
    kind: "columns" | "rows" | "grid";
    // Columns or rows: how many, the gutter between them and the margin at the edges. Grid: the cell size.
    count: number;
    gutter: number;
    margin: number;
    size: number;
    color: string;
    visible: boolean;
    // Columns or rows: "stretch" fills the frame between the margins; "start", "center"
    // and "end" use cells `size` wide, offset `margin` from that edge (stretch when absent).
    align?: "stretch" | "start" | "center" | "end";
    // As many cells as fit (fixed-width alignments only).
    countAuto?: boolean;
    // The colour's opacity (older guides draw bands at 12% and grid lines at 35%).
    opacity?: number;
}

// A named set of layout guides frames can follow.
export interface GridStyle {
    id: string;
    name: string;
    guides: LayoutGuide[];
}

export interface AutoLayout {
    direction: "vertical" | "horizontal";
    gap: number;
    // Top, right, bottom, left.
    padding: [number, number, number, number];
    // Along the stacking direction. The gap's "Auto" options: "between" spreads children to the
    // edges, "around" gives each child equal space on both sides, "evenly" makes every space equal.
    primary: "start" | "center" | "end" | "between" | "around" | "evenly";
    // Across the stacking direction; "baseline" (horizontal) lines up the first text baselines.
    counter: "start" | "center" | "end" | "baseline";
    // Wrap onto new lines when the children overflow the stacking axis; the gap between lines.
    wrap?: boolean;
    counterGap?: number;
    // Draw the first child on top (the last one is on top otherwise).
    reverseZ?: boolean;
    // Space between with a single child: centre it (the reference's older "space evenly" setting).
    loneCenter?: boolean;
    // The reference's "Include stroke in layout": the frame's stroke pads its content like extra padding.
    strokesIncluded?: boolean;
    // Wrapping: how the lines share the counter axis ("auto" packs them; "between" spreads them).
    alignContent?: "auto" | "between";
    // Grid: children fill cells row by row; `columns` across, rows as needed (or `rows` when set).
    // Track sizes per column and row (missing entries: fill when the frame is fixed on that axis,
    // hug when it hugs); without any, cells are equal (or as big as the largest child when hugging).
    // `autoTracks` sizes tracks not listed in columnSizes/rowSizes; `itemsPositioning` "manual"
    // keeps children in the cells they were given instead of flowing them into the first free cell.
    grid?: { columns: number; rows: number | null; columnGap: number; rowGap: number; columnSizes?: GridTrack[]; rowSizes?: GridTrack[]; autoTracks?: GridTrack; itemsPositioning?: "auto" | "manual" } | null;
}

// A grid column or row: a fixed size in px, a share of the free space (`value` as fr), or the size
// of its content.
export interface GridTrack {
    type: "fixed" | "fill" | "hug";
    value: number;
}

// Canvas compositing names, which match the usual design-tool blend modes.
// "pass-through" (groups and frames only) lets children blend with what is behind the layer;
// "plus-darker" and "plus-lighter" add or subtract light, clipped at black and white.
export type BlendMode =
    | "pass-through"
    | "normal"
    | "plus-darker"
    | "plus-lighter"
    | "darken"
    | "multiply"
    | "color-burn"
    | "lighten"
    | "screen"
    | "color-dodge"
    | "overlay"
    | "soft-light"
    | "hard-light"
    | "difference"
    | "exclusion"
    | "hue"
    | "saturation"
    | "color"
    | "luminosity";

interface PaintBase {
    visible: boolean;
    opacity: number;
    blend: BlendMode;
}

export interface SolidPaint extends PaintBase {
    type: "solid";
    color: string;
}

export interface GradientStop {
    // 0 to 1 along the gradient.
    position: number;
    color: string;
    opacity: number;
}

// Gradient ends are fractions of the layer's box: (0,0) top-left to (1,1) bottom-right. Radial and
// angular gradients are centred on `from`; `to` sets the radius or start angle.
export interface GradientPaint extends PaintBase {
    type: "linear" | "radial" | "angular" | "diamond";
    stops: GradientStop[];
    from: { x: number; y: number };
    to: { x: number; y: number };
}

export interface ImagePaint extends PaintBase {
    type: "image";
    id: string;
    // The original file it came from (e.g. a layered PSD), for re-opening in the photo editor.
    source?: string;
    // When the source is a PDF: which of its pages (from 0) this image shows.
    page?: number;
    // Image adjustments (PhotoCraft): the untouched image and the slider values baked into `id`.
    original?: string;
    adjust?: ImageAdjust;
    // A video fill: `id` is its poster frame; the file itself is media `video.id` (engine/media.ts).
    video?: VideoFill;
    // Fill crops to cover the layer; fit shows the whole image inside it; crop shows the region
    // of the image that `crop` picks (the reference's crop mode).
    mode: "fill" | "fit" | "tile" | "crop";
    // Crop: maps the layer's unit square to the image's unit square, as [m00, m01, m02, m10, m11, m12].
    // A negative scale mirrors the image.
    crop?: [number, number, number, number, number, number];
    // Tile: the pattern's scale (1 = the image's own pixels).
    tileScale?: number;
    // Fill, fit and tile: the image turned clockwise, in degrees (0 when absent).
    rotation?: number;
}

// A video behind an image fill, read by FilmCraft.
export interface VideoFill {
    id: string;
    name: string;
    seconds: number;
    width: number;
    height: number;
    fps: number;
    hasAudio: boolean;
    // Playback: start over at the end, and play without sound.
    loop: boolean;
    muted: boolean;
    // Prototype: starts playing when its screen appears (on unless turned off).
    autoplay?: boolean;
    // The part of the file that plays, in seconds into it (the whole file when absent), and the
    // sound's level from 0 to 1 (1 when absent). Campaign assets set these.
    trimStart?: number;
    trimEnd?: number;
    volume?: number;
}

// The image fill's sliders, each -100 to 100 with 0 as no change.
export interface ImageAdjust {
    exposure: number;
    contrast: number;
    saturation: number;
    temperature: number;
    tint: number;
    highlights: number;
    shadows: number;
}

// A pattern: another layer repeated as tiles, on a rectangular grid or in staggered (hexagonal)
// rows or columns, scaled, spaced apart and aligned across the shape.
export interface PatternPaint extends PaintBase {
    type: "pattern";
    sourceId: string;
    tile: "rectangular" | "horizontal-hex" | "vertical-hex";
    // 1 is the source's own size.
    scale: number;
    // Extra space between tiles, in px.
    spacing: { x: number; y: number };
    // Where the tiles line up horizontally: from the left edge, centred, or from the right edge.
    align: "start" | "center" | "end";
}

// A shader: a GLSL fragment shader run over the layer's box (canvas/shader-paint.ts). Its
// `uniform` declarations become controls; `iTime` animates when the code reads it.
export interface ShaderUniform {
    name: string;
    type: "float" | "color" | "vec2";
    value: number | string | [number, number];
    // Float sliders: the range the control offers.
    min?: number;
    max?: number;
}

export interface ShaderPaint extends PaintBase {
    type: "shader";
    code: string;
    uniforms: ShaderUniform[];
    // The built-in preset the code started from, for the menu.
    preset?: string;
}

export type Paint = SolidPaint | GradientPaint | ImagePaint | PatternPaint | ShaderPaint;

export interface Shadow {
    x: number;
    y: number;
    blur: number;
    color: string;
    opacity: number;
}

// A hand-drawn stroke: how often its width and line waver (0.01 to 20), how far (0 and up, in
// stroke weights) and how smoothly (0 to 1).
export interface DynamicStroke {
    frequency: number;
    wiggle: number;
    smoothen: number;
}

// A brush look: a stretch brush pulls its texture along the stroke (forward or backward), a scatter
// brush repeats a shape along it with spacing (gap, in sizes), wander off the line (wiggle), and
// size (0 to 3) and angle (degrees) variation, plus a fixed rotation.
export interface BrushStroke {
    type: "stretch" | "scatter";
    name: string;
    // A brush made from a layer (Create brush): its shape travels with every stroke that uses it,
    // so copied layers bring the brush to other files.
    custom?: CustomBrushShape | null;
    direction?: "forward" | "backward";
    gap?: number;
    wiggle?: number;
    sizeJitter?: number;
    angularJitter?: number;
    rotation?: number;
}

export type EndCap = "none" | "round" | "square" | "arrow-lines" | "arrow-equilateral" | "triangle" | "circle" | "diamond";

export interface Effect {
    // Motion blur smears the layer along `angle` by `blur` pixels (a directional blur). Noise
    // sprinkles grain over the layer, texture roughens its edges, glass bends and frosts what is
    // behind it.
    type: "drop-shadow" | "inner-shadow" | "layer-blur" | "background-blur" | "motion-blur" | "noise" | "texture" | "glass" | "shader";
    visible: boolean;
    x: number;
    y: number;
    blur: number;
    // Shadows: grows (or, negative, shrinks) the shape casting the shadow.
    spread: number;
    color: string;
    opacity: number;
    // Shadows: how the shadow mixes with what is under it ("normal" when absent).
    blend?: BlendMode;
    // Motion blur: the direction in degrees (0 is left to right, clockwise).
    angle?: number;
    // Drop shadows: also shown through the layer's transparent areas. Off cuts the shadow out under
    // the layer's shape (absent counts as on, for older files).
    showBehind?: boolean;
    // Layer and background blur: a progressive blur ramps from `startBlur` at `from` to `blur` at
    // `to` (fractions of the layer's box, like gradient ends).
    progressive?: { startBlur: number; from: { x: number; y: number }; to: { x: number; y: number } } | null;
    // Noise: one colour (mono), two colours (duo, `color2` for the second) or random colours (multi);
    // grain size in px (`noiseSizeY` the height when it differs from the width) and density 0 to 1.
    // Texture uses the same two sizes for its grain.
    noiseType?: "mono" | "duo" | "multi";
    noiseSize?: number;
    noiseSizeY?: number;
    density?: number;
    color2?: string;
    opacity2?: number;
    // Texture: grain size and how far edges move (`blur` holds the radius); off lets the grain
    // spill past the layer's outline.
    clipToShape?: boolean;
    // Glass: light angle (degrees) and intensity (0 to 1), refraction and dispersion (0 to 1), and
    // edge depth in px; `blur` is the frost. Splay (0 to 1) carries the bending from the rim in
    // toward the middle.
    lightAngle?: number;
    lightIntensity?: number;
    refraction?: number;
    depth?: number;
    dispersion?: number;
    splay?: number;
    // Shader: the fragment shader drawn over the layer (it reads the layer as `iLayer`) and its
    // uniforms; `opacity` and `blend` say how it lands on the layer.
    shader?: { code: string; uniforms: ShaderUniform[]; preset?: string } | null;
}

export interface NagmaDocument {
    name: string;
    nodes: Record<string, SceneNode>;
    // Page ids, in order. Each page's children are its top-level layers.
    roots: string[];
    // Image data by id (data URLs for now; phase 1 moves them to file storage).
    images: Record<string, string>;
    // Video files: their tracks, clips and media (engine/video).
    sequence?: Sequence;
    // Colour and text styles, shared across the file (engine/styles.ts).
    styles?: Styles;
    prototype?: PrototypeSettings;
    variables?: VariableCollection[];
    // A whiteboard: opens in the whiteboard editor (board/).
    board?: boolean;
    // A slides file: opens in the presentation editor (slides/).
    slides?: boolean;
    // A campaign: opens in the campaign editor (campaign/).
    campaign?: boolean;
    // A website: opens in the site editor (site/).
    site?: boolean;
    // A Make file: a prompt-to-app project that opens in the Make editor (make/).
    make?: boolean;
    // A Document file: a PDF (its bytes are the media image "pdf") that opens in the PDF
    // workbench (document/). Older Document files without it are design canvases.
    pdf?: boolean;
    // The colour space colours are picked and exported in (sRGB when absent).
    colorProfile?: "srgb" | "p3";
    // Plugin data and relaunch buttons set on the document itself (nagma.root in the plugin API).
    pluginData?: Record<string, string>;
    relaunchData?: Record<string, Record<string, string>>;
}

// A library a file uses: the version its library items were last updated to.
export interface LibraryLink {
    id: string;
    name: string;
    version: number;
    // The content hash of each library item this file holds a copy of ("c:<component>",
    // "s:<style>", "v:<collection>"), so updates are found per item.
    items?: Record<string, string>;
}

// Shared by every style: a description, and for styles that come from a library, where from.
interface StyleMeta {
    description?: string;
    // The description with light markdown (bold, italics, links), and links to documentation.
    descriptionMarkdown?: string;
    docLinks?: { label?: string; url: string }[];
    // Left out when the file is published ("Hide when publishing"; a "." or "_" name does the same).
    hiddenFromPublishing?: boolean;
    libraryId?: string;
    libraryKey?: string;
}

export interface ColorStyle extends StyleMeta {
    id: string;
    name: string;
    paint: Paint;
    // A style made from a bound paint keeps following the variable.
    variableId?: string;
}

export interface TextStyle extends StyleMeta {
    id: string;
    name: string;
    description?: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    italic: boolean;
    lineHeight: number | null;
    letterSpacing: number;
    paragraphSpacing?: number;
    paragraphIndent?: number;
    listSpacing?: number;
    hangingList?: boolean;
    hangingPunctuation?: boolean;
    leadingTrim?: "none" | "cap";
    decoration?: "none" | "underline" | "strikethrough";
    decorationStyle?: TextDecorationStyle;
    decorationOffset?: number | null;
    decorationThickness?: number | null;
    decorationColor?: string | null;
    decorationSkipInk?: boolean;
    textCase?: TextCase;
    openType?: Record<string, boolean>;
    fontVariations?: Record<string, number>;
}

// Character styles a range of text can carry; anything unset falls back to the layer's own.
export interface SpanStyle {
    fontFamily?: string;
    fontWeight?: number;
    fontSize?: number;
    italic?: boolean;
    fills?: Paint[];
    decoration?: "none" | "underline" | "strikethrough";
    decorationStyle?: TextDecorationStyle;
    decorationOffset?: number | null;
    decorationThickness?: number | null;
    decorationColor?: string | null;
    decorationSkipInk?: boolean;
    letterSpacing?: number;
    lineHeight?: number | null;
    hyperlink?: string | null;
    textCase?: TextCase;
    openType?: Record<string, boolean>;
    fontVariations?: Record<string, number>;
    // A text style applied to just this range.
    textStyleId?: string | null;
}

// A styled range: characters start (inclusive) to end (exclusive), in UTF-16 units of `text`.
export interface TextSpan extends SpanStyle {
    start: number;
    end: number;
}

export interface ParagraphStyle {
    list?: "bullet" | "number" | null;
    // Indentation level: 0 is none; list items start at 1 (the reference allows five).
    level?: number;
}

export interface EffectStyle extends StyleMeta {
    id: string;
    name: string;
    shadow: Shadow | null;
    blur: number;
    // The full effect stack (newer styles); `shadow` and `blur` stay for older files.
    effects?: Effect[];
}

// A saved prototype transition (animation type, direction, easing, duration), applied by id.
export interface AnimationStyle extends StyleMeta {
    id: string;
    name: string;
    transition: Transition;
}

export interface Styles {
    colors: ColorStyle[];
    texts: TextStyle[];
    effects?: EffectStyle[];
    grids?: GridStyle[];
    animations?: AnimationStyle[];
}

export interface ComponentProp {
    id: string;
    name: string;
    // Variant properties live in the variants' names; these are the others. A slot is an area
    // where instances can place any layers.
    kind: "boolean" | "text" | "swap" | "slot";
    defaultValue: boolean | string;
    description?: string;
    // The default follows this variable (boolean and text properties).
    defaultVariable?: string;
    // Instance swap and slot: components suggested first (ids in this file).
    preferred?: string[];
    // Slot: guidance on how many layers it holds, and whether only preferred instances belong.
    minItems?: number | null;
    maxItems?: number | null;
    onlyPreferred?: boolean;
    // Slot: layers dropped in stretch to the slot's width; instances start with the slot empty.
    stretchChildOnInsert?: boolean;
    displayEmptyByDefault?: boolean;
}

// Easing variables hold a curve (a named curve, a cubic bezier or a spring); timing variables a
// duration in milliseconds. Prototype transitions can follow either.
export type VariableType = "color" | "number" | "string" | "boolean" | "easing" | "timing";

export interface EasingValue {
    easing: Easing;
    bezier?: [number, number, number, number];
    spring?: Spring;
}

// Where a variable may be applied; "all" means anywhere its type fits.
export type VariableScope =
    | "all"
    | "all-fills"
    | "frame-fill"
    | "shape-fill"
    | "text-fill"
    | "stroke"
    | "effect-color"
    | "corner-radius"
    | "width-height"
    | "gap"
    | "opacity"
    | "stroke-width"
    | "effect"
    | "font-size"
    | "line-height"
    | "letter-spacing"
    | "paragraph-spacing"
    | "paragraph-indent"
    | "font-weight"
    | "font-family"
    | "font-style"
    | "text-content"
    // Colour variables scoped to opacity (a number 0 to 100 held in a colour's alpha).
    | "color-opacity";

// A literal, or an alias to another variable (colour aliases can scale the opacity).
export type VariableValue = string | number | boolean | EasingValue | { alias: string; opacity?: number };

export interface Variable {
    // From a library: the published variable's key.
    libraryKey?: string;
    id: string;
    name: string;
    type: VariableType;
    // One value per mode of the collection.
    values: Record<string, VariableValue>;
    scopes?: VariableScope[];
    description?: string;
    codeSyntax?: { web?: string; ios?: string; android?: string };
    hidden?: boolean;
}

export interface VariableCollection {
    // Collections that come from a library (read-only here).
    libraryId?: string;
    id: string;
    name: string;
    modes: { id: string; name: string }[];
    defaultModeId?: string;
    variables: Variable[];
    // An extended collection: it inherits every variable of the collection it extends (resolved in
    // this collection's modes) and may override their values per mode, by variable id then mode id.
    extends?: string;
    overrides?: Record<string, Record<string, VariableValue>>;
}

// Prototype settings for the whole file.
export interface PrototypeSettings {
    // Fit scales a screen down to the player; width fills the player's width and scrolls tall screens.
    scaling: "fit" | "width";
    background: string;
    // The device the prototype is shown in (engine/devices.ts), its colour and orientation, and the
    // size for a custom device.
    device?: { id: string; color?: string; landscape?: boolean; width?: number; height?: number };
}

// A video file's timeline: clips of video (trimmed), stills, or titles (frames in this file).
export type Clip =
    | { id: string; kind: "video"; name: string; poster: string; video: VideoFill; in: number; out: number; muted: boolean }
    | { id: string; kind: "image"; name: string; image: string; duration: number }
    | { id: string; kind: "frame"; name: string; frame: string; duration: number };

export interface Sequence {
    width: number;
    height: number;
    fps: number;
    // First-generation files: clips back to back. Files edited since keep `edit` instead.
    clips: Clip[];
    // Tracks, compositions and the media bin (engine/video/model.ts).
    edit?: import("./video/model").VProject;
}

export interface Annotation {
    id: string;
    text: string;
    html?: string;
    properties?: string[];
    categoryId?: string | null;
}

// A custom brush's outline: closed polygons. Stretch shapes span 0..1 along the stroke and
// -0.5..0.5 across it; scatter shapes sit in a unit box centred on 0.
export interface CustomBrushShape {
    id: string;
    name: string;
    polys: { x: number; y: number }[][];
}

export interface CustomBrushDef extends CustomBrushShape {
    type: "stretch" | "scatter";
}

export interface RepeatTransform {
    kind: "linear" | "radial";
    // How many in all, the original included.
    count: number;
    // Linear: the gap between copies and which way they run. The gap is in px, or with `unit`
    // "relative" a percentage of the originals' size along that way.
    spacing: number;
    unit?: "pixels" | "relative";
    direction: "horizontal" | "vertical";
    // Radial: how far the centre sits below the originals (0: half their height).
    radius: number;
}

export interface CodeConnectSnippet {
    id: string;
    lang: "css" | "tailwind" | "swiftui" | "uikit" | "compose" | "xml";
    // The code component's name, and a link to its source.
    name: string;
    source?: string;
    code: string;
}

export interface AnnotationCategory {
    id: string;
    label: string;
    color: string;
}

export type NodePatch = Partial<Omit<SceneNode, "id" | "type" | "parentId" | "children">>;

// Every edit is a command: plain JSON with a stable type id, mirroring the Craft engines' command model.
// This is what the sync server will order and broadcast.
export type Command =
    | { type: "node.create"; node: SceneNode; index?: number }
    // `ignoreConstraints`: a resized frame leaves its children where they are (⌘ while resizing).
    | { type: "node.update"; id: string; patch: NodePatch; ignoreConstraints?: boolean }
    | { type: "node.delete"; ids: string[] }
    | { type: "node.move"; ids: string[]; dx: number; dy: number }
    | { type: "node.reparent"; id: string; parentId: string | null; index?: number }
    | { type: "doc.rename"; name: string }
    // Document-wide settings (the colour profile).
    | { type: "doc.settings"; patch: Partial<Pick<NagmaDocument, "colorProfile" | "pluginData" | "relaunchData">> }
    | { type: "sequence.set"; sequence: Sequence }
    | { type: "styles.set"; styles: Styles }
    | { type: "prototype.set"; prototype: PrototypeSettings }
    | { type: "variables.set"; variables: VariableCollection[] }
    | { type: "image.add"; id: string; data: string }
    // Replaces an image's stored value (moving it into the media store); the id stays.
    | { type: "image.set"; id: string; data: string }
    // Turns a frame into a component and back, or detaches an instance into a frame.
    | { type: "node.convert"; id: string; to: "frame" | "component" | "vector"; path?: VectorPath }
    | { type: "batch"; commands: Command[] };

export type Tool =
    | "move"
    | "hand"
    | "scale"
    | "frame"
    | "section"
    | "slice"
    | "rect"
    | "line"
    | "arrow"
    | "ellipse"
    | "polygon"
    | "star"
    | "text"
    | "textpath"
    | "pen"
    | "pencil"
    | "brush"
    | "comment"
    | "annotation"
    | "measure"
    | "eyedropper";

// The editor's modes, switched from the toolbar: Draw swaps in freehand tools, Motion adds the
// timeline and keyframes, Inspect makes the file read-only and shows code.
export type EditorMode = "draw" | "design" | "motion" | "dev";

// Motion: which values can carry keyframes. The basics: geometry, opacity, radius, the first solid
// fill's colour, scale and path trim.
export type AnimProp = "x" | "y" | "w" | "h" | "rotation" | "opacity" | "radius" | "fill" | "scaleX" | "scaleY" | "trimStart" | "trimEnd";
// More animatable values (engine/animation.ts FIELDS): the first solid stroke's colour, stroke
// weight and per-side weights, auto layout gaps and padding, each corner's radius, grid gaps, text
// size and spacing, uniform scale, and position as one value ("x,y").
export type AnimField =
    | "stroke"
    | "strokeWidth"
    | "gap"
    | "counterGap"
    | "padTop"
    | "padRight"
    | "padBottom"
    | "padLeft"
    | "radiusTL"
    | "radiusTR"
    | "radiusBR"
    | "radiusBL"
    | "borderTop"
    | "borderRight"
    | "borderBottom"
    | "borderLeft"
    | "gridRowGap"
    | "gridColumnGap"
    | "fontSize"
    | "letterSpacing"
    | "lineHeight"
    | "scale"
    | "position";
// An effect's value, by the effect's index: "fx0.x" is the first effect's x offset. (Documents saved
// with the older names, "shadowX", "glassDepth", "strokeTop" and so on, are converted on load.)
export type EffectField = "x" | "y" | "blur" | "spread" | "color" | "opacity" | "depth" | "lightAngle" | "lightIntensity" | "dispersion" | "splay" | "refraction" | "startBlur" | "noiseSize" | "noiseSizeY" | "density" | "color2";
export type TrackProp = AnimProp | AnimField | `fx${number}.${EffectField}`;

export interface Keyframe {
    // Milliseconds from the start of the frame's animation.
    t: number;
    // A number, or a hex colour for "fill".
    v: number | string;
    easing: "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold";
    // A custom cubic-bezier curve for the stretch to the next keyframe (x1, y1, x2, y2), like CSS.
    bezier?: [number, number, number, number];
}

// The reference's text stagger: the same animation played on each letter, word or line in turn.
// Tracks run from 0 to `duration` for one unit: x, y and rotation are offsets, scale and opacity
// multiply the layer's own, blur is in pixels.
export interface TextStagger {
    unit: "letter" | "letter-visible" | "word" | "line" | "paragraph";
    order: "left-right" | "right-left" | "center-out" | "random";
    // Milliseconds before the first unit starts, and each unit's own length.
    delay: number;
    duration: number;
    // How much of a unit's animation overlaps the next one's, 0 to 100.
    overlap: number;
    direction: "in" | "out";
    tracks: Partial<Record<"x" | "y" | "rotation" | "scale" | "opacity" | "blur", Keyframe[]>>;
    // Hide each unit outside its own line box while it moves.
    clip?: boolean;
    // The preset's settings the tracks were made from (what Motion's Text stagger panel edits).
    preset?: StaggerPreset;
}

export interface StaggerPreset {
    easing: Keyframe["easing"];
    bezier?: [number, number, number, number];
    position: { on: boolean; from: "top" | "bottom" | "left" | "right"; distance: number };
    rotation: { on: boolean; clockwise: boolean; amount: number };
    // Percentages: the unit starts at this scale or opacity and ends at 100%.
    scale: { on: boolean; amount: number };
    opacity: { on: boolean; amount: number };
    blur: { on: boolean; amount: number };
}

export interface Animation {
    tracks: Partial<Record<TrackProp, Keyframe[]>>;
    // Text layers: a per-unit animation (the reference's text stagger preset).
    stagger?: TextStagger;
    // Top-level frames only: how long the animation runs, in milliseconds.
    duration?: number;
    // Top-level frames only: how the animation plays in a prototype (once when unset).
    playback?: "once" | "loop" | "ping-pong";
}

export interface Camera {
    x: number;
    y: number;
    zoom: number;
}

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}
