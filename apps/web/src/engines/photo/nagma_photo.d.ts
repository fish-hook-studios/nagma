/* tslint:disable */
/* eslint-disable */

export class PhotoDoc {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Runs a PhotoCraft command by id with JSON parameters; returns its JSON result.
     */
    execute(id: string, params: string): string;
    /**
     * Saves to a format chosen by name or extension: "png", "jpg", "webp", "tiff", "psd", …
     */
    export(name_or_ext: string): Uint8Array;
    height(): number;
    /**
     * The layer tree, top first: id, name, kind, visibility, opacity, depth, and which is active.
     */
    layers(): string;
    /**
     * Opens image or document bytes (PNG, JPEG, WebP, TIFF, PSD, …) as a new photo document.
     */
    constructor(name: string, bytes: Uint8Array);
    redo(): boolean;
    /**
     * The flattened image as 8-bit straight RGBA, row by row (width × height × 4 bytes).
     */
    render(): Uint8Array;
    undo(): boolean;
    width(): number;
}

/**
 * Every PhotoCraft command: id, label, menu path, shortcut and parameter description.
 */
export function commands(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_photodoc_free: (a: number, b: number) => void;
    readonly commands: () => [number, number];
    readonly photodoc_execute: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly photodoc_export: (a: number, b: number, c: number) => [number, number, number, number];
    readonly photodoc_height: (a: number) => number;
    readonly photodoc_layers: (a: number) => [number, number, number, number];
    readonly photodoc_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly photodoc_redo: (a: number) => number;
    readonly photodoc_render: (a: number) => [number, number, number, number];
    readonly photodoc_undo: (a: number) => number;
    readonly photodoc_width: (a: number) => number;
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
