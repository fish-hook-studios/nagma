/* tslint:disable */
/* eslint-disable */

export class AssetData {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly bytes: Uint8Array;
    readonly mime: string;
}

export class LayoutDoc {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The bytes of an image the page refers to, as a browser can show it: web formats as they
     * are, anything else (PDF, TIFF, PSD, EPS previews) decoded to PNG.
     */
    asset(id: string): AssetData;
    /**
     * The document as InDesign Markup (IDML).
     */
    exportIdml(): Uint8Array;
    /**
     * Opens an `.idml` or `.designcraft` file.
     */
    constructor(bytes: Uint8Array);
    pageCount(): number;
    /**
     * A page flattened into simple layers, as JSON (see `Flatten`).
     */
    page(page: number): string;
    /**
     * One page as straight RGBA8 at `scale` pixels per point.
     */
    render(page: number, scale: number): RenderedImage;
    /**
     * DesignCraft's sample magazine.
     */
    static sample(): LayoutDoc;
    /**
     * The document as a `.designcraft` file.
     */
    save(): Uint8Array;
    title(): string;
}

export class RenderedImage {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly height: number;
    readonly rgba: Uint8Array;
    readonly width: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_assetdata_free: (a: number, b: number) => void;
    readonly __wbg_layoutdoc_free: (a: number, b: number) => void;
    readonly __wbg_renderedimage_free: (a: number, b: number) => void;
    readonly assetdata_bytes: (a: number) => [number, number];
    readonly assetdata_mime: (a: number) => [number, number];
    readonly layoutdoc_asset: (a: number, b: number, c: number) => [number, number, number];
    readonly layoutdoc_exportIdml: (a: number) => [number, number];
    readonly layoutdoc_new: (a: number, b: number) => [number, number, number];
    readonly layoutdoc_page: (a: number, b: number) => [number, number, number, number];
    readonly layoutdoc_pageCount: (a: number) => number;
    readonly layoutdoc_render: (a: number, b: number, c: number) => [number, number, number];
    readonly layoutdoc_sample: () => number;
    readonly layoutdoc_save: (a: number) => [number, number, number, number];
    readonly layoutdoc_title: (a: number) => [number, number];
    readonly renderedimage_height: (a: number) => number;
    readonly renderedimage_rgba: (a: number) => [number, number];
    readonly renderedimage_width: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
