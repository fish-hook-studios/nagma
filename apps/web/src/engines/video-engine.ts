// Loads FilmCraft's video engine (WebAssembly, built from engines/video-wasm) on first use: it
// reads video files frame by frame with audio and writes MP4 files with sound.

export interface VideoInfo {
    width: number;
    height: number;
    fps: number;
    seconds: number;
    hasVideo: boolean;
    hasAudio: boolean;
    codec: string;
    container: string;
    sampleRate: number;
    channels: number;
}

export interface RgbaFrame {
    readonly width: number;
    readonly height: number;
    readonly rgba: Uint8Array;
    free(): void;
}

export interface VideoSource {
    info(): string;
    frame(seconds: number, scale: number): RgbaFrame;
    audio(seconds: number, frames: number, rate: number, channels: number): Float32Array;
    free(): void;
}

export interface Mp4Writer {
    readonly width: number;
    readonly height: number;
    push(rgba: Uint8Array): void;
    pushAudio(samples: Float32Array): void;
    // Consumes the writer.
    finish(): Uint8Array;
    free(): void;
}

interface VideoModule {
    VideoSource: new (name: string, bytes: Uint8Array) => VideoSource;
    Mp4Writer2: new (width: number, height: number, fps: number, kbps: number, rate: number, channels: number) => Mp4Writer;
}

let loading: Promise<VideoModule> | null = null;

export function loadVideoEngine(): Promise<VideoModule> {
    loading ??= (async () => {
        const glue = await import("./video/nagma_video.js");
        await glue.default({ module_or_path: new URL("./video/nagma_video_bg.wasm", import.meta.url) });
        return glue as unknown as VideoModule;
    })();
    return loading;
}

export function isVideoFile(file: { name: string; type?: string }): boolean {
    return Boolean(file.type?.startsWith("video/")) || /\.(mp4|m4v|mov|mkv|webm|mxf|mts|m2ts|ts|mpg|mpeg|avi|3gp|y4m)$/i.test(file.name);
}

export function parseVideoInfo(source: VideoSource): VideoInfo {
    return JSON.parse(source.info()) as VideoInfo;
}
