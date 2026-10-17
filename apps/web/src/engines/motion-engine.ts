// Loads the motion engine (WebAssembly, built from engines/motion-wasm: FilmCraft's H.264 encoder
// and MP4 writer, a GIF encoder, EffectCraft's Lottie reader and its effects library) on first use.

export interface Mp4Encoder {
    readonly width: number;
    readonly height: number;
    push(rgba: Uint8Array): void;
    // Consumes the encoder.
    finish(): Uint8Array;
    free(): void;
}

export interface GifEncoder {
    push(rgba: Uint8Array): void;
    finish(): Uint8Array;
    free(): void;
}

// What EffectCraft's importer makes of a Lottie file.
export interface LottieInfo {
    name: string;
    width: number;
    height: number;
    fps: number;
    seconds: number;
    layers: string[];
    warnings: string[];
}

// One effect of EffectCraft's library and its parameters (point defaults are fractions of the layer).
export interface EffectParamSpec {
    id: string;
    name: string;
    kind: "number" | "angle" | "percent" | "pixels" | "bool" | "enum" | "color" | "point" | "hidden";
    default: number | boolean | number[];
    min?: number;
    max?: number;
    sliderMin?: number;
    sliderMax?: number;
    decimals?: number;
    options?: string[];
}

export interface EffectSpecInfo {
    id: string;
    name: string;
    category: string;
    params: EffectParamSpec[];
}

// An effect's result, which can be larger than the frame it was given: the frame's top left
// sits at (offsetX, offsetY) in it.
export interface EffectFrame {
    readonly width: number;
    readonly height: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly rgba: Uint8Array;
    free(): void;
}

interface MotionModule {
    Mp4Encoder: new (width: number, height: number, fps: number, kbps: number) => Mp4Encoder;
    GifEncoder: new (width: number, height: number, fps: number) => GifEncoder;
    inspectLottie(bytes: Uint8Array): string;
    effectCatalog(): string;
    applyEffect(id: string, params: string, rgba: Uint8Array, width: number, height: number, scale: number, time: number, fps: number, seed: number): EffectFrame;
}

let loading: Promise<MotionModule> | null = null;
let loaded: MotionModule | null = null;

// The engine once it has loaded (null before), for callers that can't wait.
export function motionEngineNow(): MotionModule | null {
    return loaded;
}

export function loadMotionEngine(): Promise<MotionModule> {
    loading ??= (async () => {
        const glue = await import("./motion/nagma_motion.js");
        await glue.default({ module_or_path: new URL("./motion/nagma_motion_bg.wasm", import.meta.url) });
        loaded = glue as unknown as MotionModule;
        return loaded;
    })();
    return loading;
}

export async function inspectLottie(bytes: Uint8Array): Promise<LottieInfo> {
    const engine = await loadMotionEngine();
    return JSON.parse(engine.inspectLottie(bytes)) as LottieInfo;
}

let catalog: EffectSpecInfo[] | null = null;

// The effects library: every effect whose parameters the editor can show.
export async function effectCatalog(): Promise<EffectSpecInfo[]> {
    if (catalog) return catalog;
    const engine = await loadMotionEngine();
    catalog = JSON.parse(engine.effectCatalog()) as EffectSpecInfo[];
    return catalog;
}
