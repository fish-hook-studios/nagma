/* tslint:disable */
/* eslint-disable */

export class PageContent {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Image `index` as straight RGBA8.
     */
    image(index: number): RenderedImage | undefined;
    readonly json: string;
}

export class PdfDoc {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * A page's content as editable pieces (text runs, paths, images) in page view space, as
     * JSON plus the images it refers to (see `extract.rs`).
     */
    content(page: number): PageContent;
    /**
     * Run an organize command, given as JSON:
     * `{"op":"rotate","pages":[0],"degrees":90}`, `{"op":"delete","pages":[1]}`,
     * `{"op":"move","pages":[2],"to":0}`, `{"op":"duplicate","pages":[0]}`,
     * `{"op":"insertBlank","at":1,"width":612,"height":792}`.
     */
    execute(json: string): void;
    constructor(bytes: Uint8Array);
    pageCount(): number;
    /**
     * Each page's displayed size in points (crop box, after its rotation) as JSON
     * `[{width, height, rotation}]`.
     */
    pages(): string;
    redo(): boolean;
    /**
     * One page as straight (not premultiplied) RGBA8, `scale` pixels per point. The size is
     * read back with `lastWidth`/`lastHeight`.
     */
    render(page: number, scale: number): RenderedImage;
    /**
     * The document as PDF bytes: an incremental update of the original, or a compact rewrite.
     */
    save(full: boolean): Uint8Array;
    /**
     * The text of a page, one line per row.
     */
    text(page: number): string;
    undo(): boolean;
}

export class PdfWorkbench {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Edit text and images ▸ Add image: an image drawn into the page content at `rect` (view space).
     */
    addImage(page: number, rect: string, name: string, bytes: Uint8Array): void;
    /**
     * A picture (PNG or JPEG: an uploaded or drawn signature, an image stamp) as a stamp comment
     * filling `rect` (view space).
     */
    addPicture(page: number, rect: string, name: string, bytes: Uint8Array, author: string): void;
    /**
     * Runs an edit given as JSON (see `edit_from`). Each is one undo step.
     */
    apply(json: string): void;
    /**
     * The bytes of attachment `index`.
     */
    attachment(index: number): Uint8Array;
    /**
     * A new PDF of `pages` empty pages, `width` × `height` points.
     */
    static blank(width: number, height: number, pages: number): Uint8Array;
    /**
     * Several PDFs as one (Combine files).
     */
    static combine(first: Uint8Array, second: Uint8Array): Uint8Array;
    /**
     * A new PDF of just these pages (JSON list, 0-based).
     */
    extract(pages: string): Uint8Array;
    /**
     * A PDF from an image file (PNG, JPEG, TIFF, GIF, BMP): one page sized to it.
     */
    static fromImage(name: string, bytes: Uint8Array): Uint8Array;
    /**
     * Everything the panels show, as JSON: pages, document properties, bookmarks, attachments,
     * layers, comments, form fields, security, and the undo state.
     */
    info(): string;
    /**
     * Inserts the pages of another PDF at `at` (Insert from file, Merge).
     */
    insertPdf(at: number, name: string, bytes: Uint8Array): void;
    /**
     * Opens a PDF. A wrong or missing password fails with the message "password".
     */
    constructor(bytes: Uint8Array, name: string, password?: string | null);
    pageCount(): number;
    /**
     * Images (and grouped artwork) drawn on a page: `[{rect, width, height, form}]`.
     */
    pageImages(page: number): string;
    /**
     * The page's text as plain lines.
     */
    plainText(page: number): string;
    redo(): string | undefined;
    /**
     * Reduce File Size: a compressed, optimized copy (the open document is unchanged).
     */
    reduced(): Uint8Array;
    /**
     * One page with its comments and fields as straight RGBA8, `scale` pixels per point.
     */
    render(page: number, scale: number): RenderedImage;
    /**
     * Edit text and images ▸ Replace image: image `index` on `page` shows this file instead.
     */
    replaceImage(page: number, index: number, name: string, bytes: Uint8Array): void;
    /**
     * The document as PDF bytes (an incremental update of what was opened or last saved, or a
     * compact full rewrite), and editing continues from them.
     */
    save(full: boolean): Uint8Array;
    /**
     * Shows or hides layer `index` (optional content) in the view.
     */
    setLayerVisible(index: number, visible: boolean): boolean;
    /**
     * A dynamic stamp's "By … at …" line, for previews.
     */
    stampByLine(author: string): string;
    /**
     * Paragraphs of existing text: `[{text, rect, font, size, bold, italic, color, lines}]`.
     */
    textBlocks(page: number): string;
    /**
     * A page's text layer as JSON: glyph boxes (view space, flattened `[x0,y0,x1,y1,…]`), their
     * text, line index, and whether a word break comes before each.
     */
    textLayer(page: number): string;
    /**
     * Lines of existing text that Edit text can change: `[{text, rect, font, size, bold, italic, color, decodable}]`.
     */
    textLines(page: number): string;
    /**
     * Undoes the last edit; returns its label, or nothing when there is none.
     */
    undo(): string | undefined;
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
    readonly __wbg_pagecontent_free: (a: number, b: number) => void;
    readonly __wbg_pdfdoc_free: (a: number, b: number) => void;
    readonly __wbg_pdfworkbench_free: (a: number, b: number) => void;
    readonly __wbg_renderedimage_free: (a: number, b: number) => void;
    readonly pagecontent_image: (a: number, b: number) => number;
    readonly pagecontent_json: (a: number) => [number, number];
    readonly pdfdoc_content: (a: number, b: number) => [number, number, number];
    readonly pdfdoc_execute: (a: number, b: number, c: number) => [number, number];
    readonly pdfdoc_new: (a: number, b: number) => [number, number, number];
    readonly pdfdoc_pageCount: (a: number) => number;
    readonly pdfdoc_pages: (a: number) => [number, number];
    readonly pdfdoc_redo: (a: number) => [number, number, number];
    readonly pdfdoc_render: (a: number, b: number, c: number) => [number, number, number];
    readonly pdfdoc_save: (a: number, b: number) => [number, number, number, number];
    readonly pdfdoc_text: (a: number, b: number) => [number, number];
    readonly pdfdoc_undo: (a: number) => [number, number, number];
    readonly pdfworkbench_addImage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly pdfworkbench_addPicture: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly pdfworkbench_apply: (a: number, b: number, c: number) => [number, number];
    readonly pdfworkbench_attachment: (a: number, b: number) => [number, number, number, number];
    readonly pdfworkbench_blank: (a: number, b: number, c: number) => [number, number, number, number];
    readonly pdfworkbench_combine: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly pdfworkbench_extract: (a: number, b: number, c: number) => [number, number, number, number];
    readonly pdfworkbench_fromImage: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly pdfworkbench_info: (a: number) => [number, number, number, number];
    readonly pdfworkbench_insertPdf: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly pdfworkbench_new: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly pdfworkbench_pageCount: (a: number) => number;
    readonly pdfworkbench_pageImages: (a: number, b: number) => [number, number, number, number];
    readonly pdfworkbench_plainText: (a: number, b: number) => [number, number, number, number];
    readonly pdfworkbench_redo: (a: number) => [number, number, number, number];
    readonly pdfworkbench_reduced: (a: number) => [number, number, number, number];
    readonly pdfworkbench_render: (a: number, b: number, c: number) => [number, number, number];
    readonly pdfworkbench_replaceImage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly pdfworkbench_save: (a: number, b: number) => [number, number, number, number];
    readonly pdfworkbench_setLayerVisible: (a: number, b: number, c: number) => number;
    readonly pdfworkbench_stampByLine: (a: number, b: number, c: number) => [number, number];
    readonly pdfworkbench_textBlocks: (a: number, b: number) => [number, number, number, number];
    readonly pdfworkbench_textLayer: (a: number, b: number) => [number, number, number, number];
    readonly pdfworkbench_textLines: (a: number, b: number) => [number, number, number, number];
    readonly pdfworkbench_undo: (a: number) => [number, number, number, number];
    readonly renderedimage_height: (a: number) => number;
    readonly renderedimage_rgba: (a: number) => [number, number];
    readonly renderedimage_width: (a: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
