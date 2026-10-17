// Loads PdfCraft's page engine (WebAssembly, built from engines/pdf-wasm) on first use, so
// opening Nagma doesn't pay for it until someone drops in a PDF.

export interface PdfPageInfo {
    width: number;
    height: number;
    rotation: number;
}

export interface PdfRender {
    readonly width: number;
    readonly height: number;
    readonly rgba: Uint8Array;
    free(): void;
}

// A page's content as editable pieces (engine/pdf-import.ts reads the JSON), and the pictures
// it refers to by index.
export interface PdfPageContent {
    readonly json: string;
    image(index: number): PdfRender | undefined;
    free(): void;
}

export interface PdfDocument {
    pageCount(): number;
    pages(): string;
    render(page: number, scale: number): PdfRender;
    text(page: number): string;
    content(page: number): PdfPageContent;
    execute(json: string): void;
    undo(): boolean;
    redo(): boolean;
    save(full: boolean): Uint8Array;
    free(): void;
}

// A whole editing session over one PDF (Document files): see engines/pdf-wasm/src/workbench.rs.
// Geometry is in page view space: points from the top-left of the page as shown, y down.
export interface PdfWorkbench {
    pageCount(): number;
    info(): string;
    render(page: number, scale: number): PdfRender;
    textLayer(page: number): string;
    plainText(page: number): string;
    textLines(page: number): string;
    textBlocks(page: number): string;
    pageImages(page: number): string;
    apply(json: string): void;
    insertPdf(at: number, name: string, bytes: Uint8Array): void;
    addPicture(page: number, rect: string, name: string, bytes: Uint8Array, author: string): void;
    addImage(page: number, rect: string, name: string, bytes: Uint8Array): void;
    replaceImage(page: number, index: number, name: string, bytes: Uint8Array): void;
    undo(): string | undefined;
    redo(): string | undefined;
    save(full: boolean): Uint8Array;
    reduced(): Uint8Array;
    extract(pages: string): Uint8Array;
    attachment(index: number): Uint8Array;
    setLayerVisible(index: number, visible: boolean): boolean;
    stampByLine(author: string): string;
    free(): void;
}

interface PdfWorkbenchClass {
    new (bytes: Uint8Array, name: string, password?: string | null): PdfWorkbench;
    blank(width: number, height: number, pages: number): Uint8Array;
    fromImage(name: string, bytes: Uint8Array): Uint8Array;
    combine(first: Uint8Array, second: Uint8Array): Uint8Array;
}

interface PdfModule {
    PdfDoc: new (bytes: Uint8Array) => PdfDocument;
    PdfWorkbench: PdfWorkbenchClass;
}

let loading: Promise<PdfModule> | null = null;

export function loadPdfEngine(): Promise<PdfModule> {
    loading ??= (async () => {
        const glue = await import("./pdf/nagma_pdf.js");
        await glue.default({ module_or_path: new URL("./pdf/nagma_pdf_bg.wasm", import.meta.url) });
        return glue as unknown as PdfModule;
    })();
    return loading;
}

export function isPdfFile(file: { name: string; type?: string }): boolean {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export function pageInfo(doc: PdfDocument): PdfPageInfo[] {
    return JSON.parse(doc.pages()) as PdfPageInfo[];
}

// Draws a page onto a canvas at `scale` pixels per point.
export function drawPage(doc: PdfDocument, page: number, scale: number, canvas: HTMLCanvasElement) {
    const out = doc.render(page, scale);
    try {
        canvas.width = out.width;
        canvas.height = out.height;
        const rgba = out.rgba;
        canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), out.width, out.height), 0, 0);
    } finally {
        out.free();
    }
}
