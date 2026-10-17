/* tslint:disable */
/* eslint-disable */

/**
 * An MP4 writer: H.264 video from RGBA frames, and AAC audio from interleaved f32 samples.
 */
export class Mp4Writer2 {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The finished MP4 file.
     */
    finish(): Uint8Array;
    /**
     * `rate` 0 writes a silent file (no audio track).
     */
    constructor(width: number, height: number, fps: number, kbps: number, rate: number, channels: number);
    /**
     * Interleaved f32 samples at the writer's rate and channel count, in any chunk size.
     */
    pushAudio(samples: Float32Array): void;
    /**
     * One frame of straight RGBA, `width` × `height`.
     */
    push(rgba: Uint8Array): void;
    readonly height: number;
    readonly width: number;
}

export class RgbaFrame {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly height: number;
    readonly rgba: Uint8Array;
    readonly width: number;
}

/**
 * An opened media file.
 */
export class VideoSource {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `frames` audio frames from `seconds`, resampled to `rate`, interleaved across `channels`
     * (mono or stereo).
     */
    audio(seconds: number, frames: number, rate: number, channels: number): Float32Array;
    /**
     * The frame shown at `seconds`, as straight RGBA8. `scale` under 1 asks for a smaller frame.
     */
    frame(seconds: number, scale: number): RgbaFrame;
    /**
     * `{width, height, fps, seconds, hasVideo, hasAudio, codec, container, sampleRate, channels}`.
     */
    info(): string;
    constructor(name: string, bytes: Uint8Array);
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_mp4writer2_free: (a: number, b: number) => void;
    readonly __wbg_rgbaframe_free: (a: number, b: number) => void;
    readonly __wbg_videosource_free: (a: number, b: number) => void;
    readonly mp4writer2_finish: (a: number) => [number, number, number, number];
    readonly mp4writer2_height: (a: number) => number;
    readonly mp4writer2_new: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly mp4writer2_push: (a: number, b: number, c: number) => [number, number];
    readonly mp4writer2_pushAudio: (a: number, b: number, c: number) => void;
    readonly mp4writer2_width: (a: number) => number;
    readonly rgbaframe_height: (a: number) => number;
    readonly rgbaframe_rgba: (a: number) => [number, number];
    readonly rgbaframe_width: (a: number) => number;
    readonly videosource_audio: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly videosource_frame: (a: number, b: number, c: number) => [number, number, number];
    readonly videosource_info: (a: number) => [number, number];
    readonly videosource_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
