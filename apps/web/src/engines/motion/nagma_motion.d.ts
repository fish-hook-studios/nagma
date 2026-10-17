/* tslint:disable */
/* eslint-disable */

/**
 * An effect's result: it can grow past the frame (a glow, a shadow), so it says where its
 * pixels sit: the frame's top left is at (`offsetX`, `offsetY`) in the result.
 */
export class EffectFrame {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly height: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly rgba: Uint8Array;
    readonly width: number;
}

/**
 * An animated GIF, looping forever.
 */
export class GifEncoder {
    free(): void;
    [Symbol.dispose](): void;
    finish(): Uint8Array;
    constructor(width: number, height: number, fps: number);
    /**
     * One frame of straight RGBA, `width` × `height`.
     */
    push(rgba: Uint8Array): void;
}

/**
 * H.264 in MP4. Frames go in as RGBA; the file comes out of `finish`.
 */
export class Mp4Encoder {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The finished MP4 file.
     */
    finish(): Uint8Array;
    /**
     * `width` and `height` are rounded down to even numbers (4:2:0 video needs them).
     */
    constructor(width: number, height: number, fps: number, kbps: number);
    /**
     * One frame of straight RGBA, `width` × `height`.
     */
    push(rgba: Uint8Array): void;
    readonly height: number;
    readonly width: number;
}

/**
 * Runs effect `id` on a `width` × `height` straight RGBA frame. `params` is a JSON object of
 * parameter values by id (numbers, `[x, y]` points as fractions of the layer, `[r, g, b, a]`
 * colours 0..1, booleans, popup indices); missing ones take the effect's defaults. The frame
 * shows the layer at `scale` (pixels per layer pixel) so a preview can run small; `time` is the
 * layer time in seconds.
 */
export function applyEffect(id: string, params: string, rgba: Uint8Array, width: number, height: number, scale: number, time: number, fps: number, seed: number): EffectFrame;

/**
 * `[{id, name, category, params: [{id, name, kind, default, min?, max?, sliderMin?, sliderMax?, options?}]}]`
 * for every effect whose parameters are plain values. Point defaults are fractions of the layer.
 */
export function effectCatalog(): string;

/**
 * Reads a Lottie file with EffectCraft's importer and describes it as JSON:
 * `{name, width, height, fps, frames, layers: [names], warnings}`.
 */
export function inspectLottie(bytes: Uint8Array): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_effectframe_free: (a: number, b: number) => void;
    readonly __wbg_gifencoder_free: (a: number, b: number) => void;
    readonly __wbg_mp4encoder_free: (a: number, b: number) => void;
    readonly applyEffect: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number];
    readonly effectCatalog: () => [number, number];
    readonly effectframe_height: (a: number) => number;
    readonly effectframe_offsetX: (a: number) => number;
    readonly effectframe_offsetY: (a: number) => number;
    readonly effectframe_rgba: (a: number) => [number, number];
    readonly effectframe_width: (a: number) => number;
    readonly gifencoder_finish: (a: number) => [number, number, number, number];
    readonly gifencoder_new: (a: number, b: number, c: number) => [number, number, number];
    readonly gifencoder_push: (a: number, b: number, c: number) => [number, number];
    readonly inspectLottie: (a: number, b: number) => [number, number, number, number];
    readonly mp4encoder_finish: (a: number) => [number, number, number, number];
    readonly mp4encoder_height: (a: number) => number;
    readonly mp4encoder_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly mp4encoder_push: (a: number, b: number, c: number) => [number, number];
    readonly mp4encoder_width: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
