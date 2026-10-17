// Loads DesignCraft's layout engine (WebAssembly, built from engines/layout-wasm) on first use, so
// opening Nagma doesn't pay for it until someone opens an InDesign or DesignCraft file.

export interface LayoutRender {
    readonly width: number;
    readonly height: number;
    readonly rgba: Uint8Array;
    free(): void;
}

export interface LayoutAsset {
    readonly mime: string;
    readonly bytes: Uint8Array;
    free(): void;
}

export interface LayoutDocument {
    title(): string;
    pageCount(): number;
    render(page: number, scale: number): LayoutRender;
    page(page: number): string;
    asset(id: string): LayoutAsset;
    save(): Uint8Array;
    exportIdml(): Uint8Array;
    free(): void;
}

interface LayoutModule {
    LayoutDoc: { new (bytes: Uint8Array): LayoutDocument; sample(): LayoutDocument };
}

let loading: Promise<LayoutModule> | null = null;

export function loadLayoutEngine(): Promise<LayoutModule> {
    loading ??= (async () => {
        const glue = await import("./layout/nagma_layout.js");
        await glue.default({ module_or_path: new URL("./layout/nagma_layout_bg.wasm", import.meta.url) });
        return glue as unknown as LayoutModule;
    })();
    return loading;
}

export function isLayoutFile(file: { name: string }): boolean {
    return /\.(idml|designcraft)$/i.test(file.name);
}

// What the engine hands back for one page (engines/layout-wasm/src/lib.rs, `Flatten`).
export type Point = [number, number];

export interface LayoutBox {
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
}

export interface LayoutSubpath {
    points: { p: Point; in: Point | null; out: Point | null }[];
    closed: boolean;
}

export type LayoutFill =
    | { type: "solid"; color: string }
    | { type: "linear" | "radial"; stops: { position: number; color: string; opacity: number }[]; from: Point; to: Point }
    | null;

export interface LayoutParagraph {
    text: string;
    box: LayoutBox | null;
    family: string;
    weight: number;
    italic: boolean;
    size: number;
    lineHeight: number;
    color: string;
    align: "left" | "center" | "right";
    underline: boolean;
    strikethrough: boolean;
}

export interface LayoutItem {
    kind: "rect" | "ellipse" | "path" | "group" | "clip";
    name: string;
    opacity: number;
    blend: string | null;
    box: LayoutBox | null;
    bounds: { x: number; y: number; w: number; h: number };
    shadow: { x: number; y: number; blur: number; color: string; opacity: number } | null;
    fill?: LayoutFill;
    stroke?: { color: string; weight: number; align: "inside" | "center" | "outside" } | null;
    path?: LayoutSubpath[];
    closed?: boolean;
    children?: LayoutItem[];
    image?: { asset: string; box: LayoutBox | null; name: string };
    text?: {
        paragraphs: LayoutParagraph[];
        decos: { box: LayoutBox | null; color: string }[];
        cells: { box: LayoutBox | null; color: string }[];
        rules: { a: Point; b: Point; color: string; weight: number }[];
    } | null;
}

export interface LayoutPage {
    name: string;
    width: number;
    height: number;
    paper: string;
    items: LayoutItem[];
    assets: string[];
    skipped: number;
}
