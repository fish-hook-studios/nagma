// A small WebM writer: VP9 (or VP8) video and Opus sound from the browser's WebCodecs encoders,
// laid out as a Matroska file (EBML header, segment info, two tracks, then clusters of blocks).
// Everything is kept in memory and written once at the end, so every size is known.

type Chunk = { track: 1 | 2; time: number; key: boolean; data: Uint8Array };

const enc = new TextEncoder();

function idBytes(id: number): number[] {
    const out: number[] = [];
    let v = id;
    while (v > 0) {
        out.unshift(v & 0xff);
        v = Math.floor(v / 256);
    }
    return out;
}

// Element sizes as 8-byte vints (simple, and any size fits).
function sizeBytes(n: number): number[] {
    const out = [0x01];
    for (let i = 6; i >= 0; i--) out.push(Math.floor(n / 2 ** (8 * i)) & 0xff);
    return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}

function el(id: number, body: Uint8Array | Uint8Array[]): Uint8Array {
    const data = Array.isArray(body) ? concat(body) : body;
    return concat([new Uint8Array([...idBytes(id), ...sizeBytes(data.length)]), data]);
}

function uint(id: number, n: number): Uint8Array {
    const bytes: number[] = [];
    let v = n;
    do {
        bytes.unshift(v & 0xff);
        v = Math.floor(v / 256);
    } while (v > 0);
    return el(id, new Uint8Array(bytes));
}

function float(id: number, n: number): Uint8Array {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, n);
    return el(id, b);
}

const str = (id: number, s: string) => el(id, enc.encode(s));

// Opus's identification header, as the codec's private data.
function opusHead(channels: number, rate: number): Uint8Array {
    const b = new Uint8Array(19);
    b.set(enc.encode("OpusHead"), 0);
    const v = new DataView(b.buffer);
    v.setUint8(8, 1);
    v.setUint8(9, channels);
    v.setUint16(10, 312, true);
    v.setUint32(12, rate, true);
    v.setUint16(16, 0, true);
    v.setUint8(18, 0);
    return b;
}

export function muxWebm(opts: { width: number; height: number; codec: "V_VP9" | "V_VP8"; audio: { rate: number; channels: number } | null; duration: number; chunks: Chunk[] }): Blob {
    const header = el(0x1a45dfa3, [uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), str(0x4282, "webm"), uint(0x4287, 4), uint(0x4285, 2)]);
    const info = el(0x1549a966, [uint(0x2ad7b1, 1_000_000), str(0x4d80, "Nagma"), str(0x5741, "Nagma"), float(0x4489, opts.duration * 1000)]);
    const tracks: Uint8Array[] = [el(0xae, [uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 1), str(0x86, opts.codec), el(0xe0, [uint(0xb0, opts.width), uint(0xba, opts.height)])])];
    if (opts.audio) tracks.push(el(0xae, [uint(0xd7, 2), uint(0x73c5, 2), uint(0x83, 2), str(0x86, "A_OPUS"), el(0x63a2, opusHead(opts.audio.channels, opts.audio.rate)), uint(0x56aa, 6_500_000), uint(0x56bb, 80_000_000), el(0xe1, [float(0xb5, opts.audio.rate), uint(0x9f, opts.audio.channels)])]));
    const trackList = el(0x1654ae6b, tracks);
    // Clusters: a new one at each video key frame (and at least every 30 s, for the 16-bit offsets).
    const sorted = [...opts.chunks].sort((a, b) => a.time - b.time || a.track - b.track);
    const clusters: Uint8Array[] = [];
    let blocks: Uint8Array[] = [];
    let base = -1;
    const flush = () => {
        if (base >= 0 && blocks.length) clusters.push(el(0x1f43b675, [uint(0xe7, base), ...blocks]));
        blocks = [];
    };
    for (const c of sorted) {
        const ms = Math.round(c.time * 1000);
        if (base < 0 || (c.track === 1 && c.key) || ms - base > 30000) {
            flush();
            base = ms;
        }
        const rel = ms - base;
        const head = new Uint8Array([0x80 | c.track, (rel >> 8) & 0xff, rel & 0xff, c.key ? 0x80 : 0x00]);
        blocks.push(el(0xa3, concat([head, c.data])));
    }
    flush();
    const segment = el(0x18538067, [info, trackList, ...clusters]);
    return new Blob([header as BlobPart, segment as BlobPart], { type: "video/webm" });
}

export const webmSupported = () => typeof window !== "undefined" && "VideoEncoder" in window;

// Encodes frames as they're drawn on `canvas` and sound as it's handed over; finish() gives the file.
export async function webmWriter(canvas: HTMLCanvasElement, fps: number, bitrate: number, audio: { rate: number; channels: number } | null) {
    if (!webmSupported()) throw new Error("This browser can't write WebM video.");
    const chunks: Chunk[] = [];
    let failure: unknown = null;
    const take = (track: 1 | 2) => (chunk: EncodedVideoChunk | EncodedAudioChunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push({ track, time: chunk.timestamp / 1e6, key: chunk.type === "key", data });
    };
    let codec: "V_VP9" | "V_VP8" = "V_VP9";
    const base = { width: canvas.width, height: canvas.height, bitrate, framerate: fps };
    let config: VideoEncoderConfig = { ...base, codec: "vp09.00.10.08" };
    if (!(await VideoEncoder.isConfigSupported(config)).supported) {
        codec = "V_VP8";
        config = { ...base, codec: "vp8" };
        if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error("This browser can't encode VP8 or VP9 video.");
    }
    const video = new VideoEncoder({ output: take(1), error: (e) => (failure = e) });
    video.configure(config);
    let sound: AudioEncoder | null = null;
    if (audio && "AudioEncoder" in window) {
        const aconfig: AudioEncoderConfig = { codec: "opus", sampleRate: audio.rate, numberOfChannels: audio.channels, bitrate: 128_000 };
        if ((await AudioEncoder.isConfigSupported(aconfig)).supported) {
            sound = new AudioEncoder({ output: take(2), error: (e) => (failure = e) });
            sound.configure(aconfig);
        }
    }
    let index = 0;
    return {
        hasAudio: Boolean(sound),
        async frame() {
            if (failure) throw failure;
            const f = new VideoFrame(canvas, { timestamp: Math.round((index / fps) * 1e6), duration: Math.round(1e6 / fps) });
            video.encode(f, { keyFrame: index % Math.max(1, Math.round(fps * 2)) === 0 });
            f.close();
            index++;
            // Don't let the encoder's queue grow without end.
            while (video.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 2));
        },
        // Interleaved stereo samples starting at `at` seconds.
        sound(samples: Float32Array, at: number) {
            if (!sound || !audio) return;
            const frames = samples.length / audio.channels;
            const data = new AudioData({ format: "f32", sampleRate: audio.rate, numberOfFrames: frames, numberOfChannels: audio.channels, timestamp: Math.round(at * 1e6), data: samples as Float32Array<ArrayBuffer> });
            sound.encode(data);
            data.close();
        },
        async finish(duration: number): Promise<Blob> {
            await video.flush();
            if (sound) await sound.flush();
            video.close();
            sound?.close();
            if (failure) throw failure;
            return muxWebm({ width: canvas.width, height: canvas.height, codec, audio: sound ? audio : null, duration, chunks });
        },
        cancel() {
            if (video.state !== "closed") video.close();
            if (sound && sound.state !== "closed") sound.close();
        },
    };
}
