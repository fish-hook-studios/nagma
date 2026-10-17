import { editor } from "../engine/store";
import { hexToVec, usesTime } from "../engine/shaders";
import type { ShaderUniform } from "../engine/types";

// Draws shader paints and shader effects (engine/shaders.ts) with WebGL2: one shared context
// renders the user's fragment shader into an offscreen canvas sized to the layer, and the result
// is composited onto the 2D canvas as the fill (or over the layer, for an effect). Renders are
// cached per layer, code, uniforms and size; a shader that reads `iTime` is drawn again every
// frame while it is on screen.

const PRELUDE = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform sampler2D iLayer;
in vec2 vUv;
out vec4 fragColor;
`;

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
    vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

interface Program {
    program: WebGLProgram | null;
    error: string | null;
    locations: Map<string, WebGLUniformLocation | null>;
}

let gl: WebGL2RenderingContext | null | undefined;
let glCanvas: HTMLCanvasElement | null = null;
let quad: WebGLBuffer | null = null;
let layerTexture: WebGLTexture | null = null;
const programs = new Map<string, Program>();
const started = typeof performance !== "undefined" ? performance.now() : 0;

function context(): WebGL2RenderingContext | null {
    if (gl !== undefined) return gl;
    if (typeof document === "undefined") return (gl = null);
    glCanvas = document.createElement("canvas");
    gl = glCanvas.getContext("webgl2", { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    layerTexture = gl.createTexture();
    return gl;
}

// Strips a #version line and the built-in declarations the user may have repeated.
function userCode(code: string): string {
    return code
        .replace(/^\s*#version[^\n]*\n/, "")
        .replace(/^\s*precision\s+\w+\s+float\s*;[^\n]*\n/m, "")
        .replace(/^\s*uniform\s+vec2\s+iResolution\s*;[^\n]*$/m, "")
        .replace(/^\s*uniform\s+float\s+iTime\s*;[^\n]*$/m, "")
        .replace(/^\s*uniform\s+sampler2D\s+iLayer\s*;[^\n]*$/m, "")
        .replace(/^\s*(in|varying)\s+vec2\s+vUv\s*;[^\n]*$/m, "")
        .replace(/^\s*out\s+vec4\s+fragColor\s*;[^\n]*$/m, "");
}

// The GLSL error with line numbers shifted back to the user's code.
function userError(log: string): string {
    const offset = PRELUDE.split("\n").length - 1;
    return log
        .replace(/\0/g, "")
        .trim()
        .split("\n")
        .map((line) => line.replace(/ERROR:\s*\d+:(\d+):/, (_m, n) => `Line ${Math.max(1, Number(n) - offset)}:`))
        .join("\n");
}

function compile(code: string): Program {
    const cached = programs.get(code);
    if (cached) return cached;
    const g = context();
    const out: Program = { program: null, error: null, locations: new Map() };
    if (!g) {
        out.error = "Shaders need WebGL2, which this browser does not have.";
        programs.set(code, out);
        return out;
    }
    const make = (type: number, src: string) => {
        const s = g.createShader(type);
        if (!s) return null;
        g.shaderSource(s, src);
        g.compileShader(s);
        if (!g.getShaderParameter(s, g.COMPILE_STATUS)) {
            out.error = userError(g.getShaderInfoLog(s) ?? "Shader did not compile.");
            g.deleteShader(s);
            return null;
        }
        return s;
    };
    const vs = make(g.VERTEX_SHADER, VERTEX);
    const fs = make(g.FRAGMENT_SHADER, PRELUDE + userCode(code));
    if (vs && fs) {
        const program = g.createProgram();
        if (program) {
            g.attachShader(program, vs);
            g.attachShader(program, fs);
            g.bindAttribLocation(program, 0, "aPos");
            g.linkProgram(program);
            if (g.getProgramParameter(program, g.LINK_STATUS)) out.program = program;
            else out.error = userError(g.getProgramInfoLog(program) ?? "Shader did not link.");
        }
    }
    if (programs.size > 64) programs.clear();
    programs.set(code, out);
    return out;
}

// The compile error for a shader (null when it compiles), for the editor's error line.
export function shaderError(code: string): string | null {
    return compile(code).error;
}

interface Entry {
    code: string;
    uniforms: string;
    w: number;
    h: number;
    time: number;
    canvas: HTMLCanvasElement;
    layerKey: string;
}

const renders = new Map<string, Entry>();
let animating = false;
let animateFrame = 0;

// Keeps redrawing while an animated shader was drawn this frame.
function keepAnimating() {
    animating = true;
    if (animateFrame) return;
    animateFrame = requestAnimationFrame(() => {
        animateFrame = 0;
        if (!animating) return;
        animating = false;
        editor.set({});
    });
}

export interface ShaderSource {
    code: string;
    uniforms: ShaderUniform[];
}

// Renders a shader at w×h device pixels. `layer` is what the shader may read as `iLayer` (an effect
// reads the layer as drawn so far; a fill reads nothing). Returns the finished canvas, or null when
// the shader does not compile.
export function renderShader(key: string, shader: ShaderSource, w: number, h: number, layer: HTMLCanvasElement | null = null): HTMLCanvasElement | null {
    const g = context();
    const built = compile(shader.code);
    if (!g || !built.program || !glCanvas) return null;
    const width = Math.max(1, Math.min(2048, Math.round(w)));
    const height = Math.max(1, Math.min(2048, Math.round(h)));
    const animated = usesTime(shader.code);
    const time = animated ? (performance.now() - started) / 1000 : 0;
    const uniformsKey = JSON.stringify(shader.uniforms);
    const layerKey = layer ? `${layer.width}x${layer.height}` : "";
    const hit = renders.get(key);
    if (hit && hit.code === shader.code && hit.uniforms === uniformsKey && hit.w === width && hit.h === height && !animated && !layer) return hit.canvas;
    if (glCanvas.width !== width || glCanvas.height !== height) {
        glCanvas.width = width;
        glCanvas.height = height;
    }
    g.viewport(0, 0, width, height);
    g.useProgram(built.program);
    g.bindBuffer(g.ARRAY_BUFFER, quad);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    const loc = (name: string) => {
        if (!built.locations.has(name)) built.locations.set(name, g.getUniformLocation(built.program as WebGLProgram, name));
        return built.locations.get(name) ?? null;
    };
    g.uniform2f(loc("iResolution"), width, height);
    g.uniform1f(loc("iTime"), time);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, layerTexture);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (layer) g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, layer);
    else g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    g.uniform1i(loc("iLayer"), 0);
    for (const u of shader.uniforms) {
        const l = loc(u.name);
        if (!l) continue;
        if (u.type === "color" && typeof u.value === "string") {
            const [r, gg, b] = hexToVec(u.value);
            const glType = new RegExp(`uniform\\s+vec4\\s+${u.name}\\b`).test(shader.code) ? "vec4" : "vec3";
            if (glType === "vec4") g.uniform4f(l, r, gg, b, 1);
            else g.uniform3f(l, r, gg, b);
        } else if (u.type === "vec2" && Array.isArray(u.value)) g.uniform2f(l, u.value[0], u.value[1]);
        else if (typeof u.value === "number") {
            if (new RegExp(`uniform\\s+int\\s+${u.name}\\b`).test(shader.code)) g.uniform1i(l, Math.round(u.value));
            else g.uniform1f(l, u.value);
        }
    }
    g.disable(g.BLEND);
    g.clearColor(0, 0, 0, 0);
    g.clear(g.COLOR_BUFFER_BIT);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    const canvas = hit?.canvas ?? document.createElement("canvas");
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    const c = canvas.getContext("2d");
    if (!c) return null;
    c.clearRect(0, 0, width, height);
    c.drawImage(glCanvas, 0, 0);
    if (renders.size > 64) renders.clear();
    renders.set(key, { code: shader.code, uniforms: uniformsKey, w: width, h: height, time, canvas, layerKey });
    if (animated) keepAnimating();
    return canvas;
}

type Box = { x: number; y: number; w: number; h: number };

// The device-pixel rectangle a box covers under the context's transform.
function deviceRect(ctx: CanvasRenderingContext2D, box: Box) {
    const m = ctx.getTransform();
    const pts = [
        m.transformPoint(new DOMPoint(box.x, box.y)),
        m.transformPoint(new DOMPoint(box.x + box.w, box.y)),
        m.transformPoint(new DOMPoint(box.x, box.y + box.h)),
        m.transformPoint(new DOMPoint(box.x + box.w, box.y + box.h)),
    ];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x0 = Math.floor(Math.min(...xs));
    const y0 = Math.floor(Math.min(...ys));
    return { x: x0, y: y0, w: Math.max(1, Math.ceil(Math.max(...xs)) - x0), h: Math.max(1, Math.ceil(Math.max(...ys)) - y0) };
}

// A shader paint drawn into the current clip over the box, at the resolution the box has on screen.
export function drawShaderPaint(ctx: CanvasRenderingContext2D, key: string, shader: ShaderSource, box: Box, pixelScale: number) {
    const w = box.w * pixelScale;
    const h = box.h * pixelScale;
    const canvas = renderShader(key, shader, w, h);
    if (!canvas) {
        // A shader that does not compile shows as a flat grey, so the layer is still there.
        ctx.fillStyle = "rgba(128, 128, 128, 0.35)";
        ctx.fillRect(box.x, box.y, box.w, box.h);
        return;
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, box.x, box.y, box.w, box.h);
}

let grab: HTMLCanvasElement | null = null;

// A shader effect: the layer as drawn so far (the pixels under the box) goes in as `iLayer`, and
// the shader's output lands back over the box inside the current clip.
export function drawShaderEffect(ctx: CanvasRenderingContext2D, key: string, shader: ShaderSource, box: Box) {
    if (!ctx.canvas.width || !ctx.canvas.height) return;
    const r = deviceRect(ctx, box);
    grab ??= document.createElement("canvas");
    if (grab.width !== r.w || grab.height !== r.h) {
        grab.width = r.w;
        grab.height = r.h;
    }
    const gc = grab.getContext("2d");
    if (!gc) return;
    gc.clearRect(0, 0, r.w, r.h);
    gc.drawImage(ctx.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const canvas = renderShader(key, shader, r.w, r.h, grab);
    if (!canvas) return;
    ctx.save();
    const t = ctx.getTransform();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // The shader replaces what it read, inside the clip (its alpha says how much shows).
    ctx.globalCompositeOperation = ctx.globalCompositeOperation === "source-over" ? "source-over" : ctx.globalCompositeOperation;
    ctx.drawImage(canvas, r.x, r.y, r.w, r.h);
    ctx.setTransform(t);
    ctx.restore();
}

// A shader as a PNG data URL at the given size (for SVG export and thumbnails).
export function shaderDataUrl(key: string, shader: ShaderSource, w: number, h: number): string | null {
    const canvas = renderShader(key, shader, w, h);
    return canvas ? canvas.toDataURL("image/png") : null;
}
