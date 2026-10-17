import type { ShaderPaint, ShaderUniform } from "./types";

// Shader paints and effects: GLSL fragment shaders written by the user (or picked from the presets
// below). The code gets a prelude with `iResolution` (px), `iTime` (seconds), `iLayer` (the layer
// as drawn so far, for effects), `vUv` (0 to 1 across the box) and `fragColor`; every `uniform`
// the code declares becomes a control, with its starting value read from a trailing comment:
//   uniform float speed; // 0.5 [0, 2]
//   uniform vec3 tint; // #FF7A59
//   uniform vec2 centre; // 0.5, 0.5

export interface ShaderPreset {
    id: string;
    name: string;
    code: string;
}

export const SHADER_PRESETS: ShaderPreset[] = [
    {
        id: "gradient-noise",
        name: "Gradient noise",
        code: `uniform vec3 colorA; // #6D4AFF
uniform vec3 colorB; // #FF7A59
uniform float scale; // 3.0 [0.5, 12]
uniform float speed; // 0.3 [0, 2]

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(dot(hash2(i), f), dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
               mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
    vec2 uv = vUv * vec2(iResolution.x / iResolution.y, 1.0);
    float n = noise(uv * scale + iTime * speed) * 0.5 + 0.5;
    n += 0.5 * noise(uv * scale * 2.0 - iTime * speed * 0.7) * 0.5;
    fragColor = vec4(mix(colorA, colorB, clamp(n, 0.0, 1.0)), 1.0);
}`,
    },
    {
        id: "stripes",
        name: "Stripes",
        code: `uniform vec3 colorA; // #111111
uniform vec3 colorB; // #F5F5F5
uniform float count; // 8.0 [1, 64]
uniform float angle; // 45.0 [0, 180]
uniform float softness; // 0.02 [0, 0.5]

void main() {
    float a = radians(angle);
    vec2 uv = vUv * vec2(iResolution.x / iResolution.y, 1.0);
    float t = fract((uv.x * cos(a) + uv.y * sin(a)) * count);
    float band = smoothstep(0.5 - softness, 0.5 + softness, abs(t - 0.5) * 2.0);
    fragColor = vec4(mix(colorA, colorB, band), 1.0);
}`,
    },
    {
        id: "plasma",
        name: "Plasma",
        code: `uniform float speed; // 0.6 [0, 3]
uniform float scale; // 4.0 [1, 16]
uniform vec3 colorA; // #FF3D81
uniform vec3 colorB; // #2BD9A3
uniform vec3 colorC; // #3A7BFF

void main() {
    vec2 uv = vUv * scale;
    float t = iTime * speed;
    float v = sin(uv.x + t) + sin(uv.y + t * 0.7) + sin((uv.x + uv.y) * 0.5 + t * 1.3) + sin(length(uv - scale * 0.5) + t);
    v = v * 0.25 + 0.5;
    vec3 c = v < 0.5 ? mix(colorA, colorB, v * 2.0) : mix(colorB, colorC, (v - 0.5) * 2.0);
    fragColor = vec4(c, 1.0);
}`,
    },
    {
        id: "grain",
        name: "Grain",
        code: `uniform vec3 base; // #D9D9D9
uniform float amount; // 0.2 [0, 1]
uniform float size; // 1.0 [0.5, 8]

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    float g = hash(floor(gl_FragCoord.xy / size)) - 0.5;
    fragColor = vec4(base + g * amount, 1.0);
}`,
    },
    {
        id: "glass-refraction",
        name: "Glass refraction",
        code: `uniform float strength; // 0.08 [0, 0.5]
uniform float ripples; // 6.0 [1, 30]
uniform float speed; // 0.4 [0, 3]
uniform vec3 tint; // #FFFFFF

void main() {
    vec2 uv = vUv;
    vec2 d = vec2(sin(uv.y * ripples + iTime * speed), cos(uv.x * ripples - iTime * speed)) * strength;
    vec4 behind = texture(iLayer, clamp(uv + d, 0.0, 1.0));
    float edge = smoothstep(0.0, 0.08, uv.x) * smoothstep(0.0, 0.08, uv.y) * smoothstep(0.0, 0.08, 1.0 - uv.x) * smoothstep(0.0, 0.08, 1.0 - uv.y);
    vec3 c = mix(behind.rgb, tint, 0.12 + 0.2 * (1.0 - edge));
    fragColor = vec4(c, max(behind.a, 0.15 + 0.2 * (1.0 - edge)));
}`,
    },
];

export const DEFAULT_SHADER_PRESET = SHADER_PRESETS[0] as ShaderPreset;

// A fresh shader paint from a preset.
export function shaderPaint(preset: ShaderPreset = DEFAULT_SHADER_PRESET): ShaderPaint {
    return { type: "shader", code: preset.code, uniforms: parseUniforms(preset.code), preset: preset.id, opacity: 1, visible: true, blend: "normal" };
}

export function hexToVec(hex: string): [number, number, number] {
    const v = hex.replace("#", "");
    const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
    return [parseInt(full.slice(0, 2), 16) / 255 || 0, parseInt(full.slice(2, 4), 16) / 255 || 0, parseInt(full.slice(4, 6), 16) / 255 || 0];
}

// The uniforms a shader declares (the built-in ones aside), with defaults from their comments.
// Existing values are kept where the name and type still match.
export function parseUniforms(code: string, existing: ShaderUniform[] = []): ShaderUniform[] {
    const out: ShaderUniform[] = [];
    const re = /uniform\s+(float|int|vec2|vec3|vec4)\s+(\w+)\s*;[ \t]*(?:\/\/\s*([^\n]*))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
        const [, glType, name, comment = ""] = m;
        if (!name || name === "iTime" || name === "iResolution" || name === "iLayer") continue;
        const type: ShaderUniform["type"] = glType === "vec3" || glType === "vec4" ? "color" : glType === "vec2" ? "vec2" : "float";
        const old = existing.find((u) => u.name === name && u.type === type);
        const range = /\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/.exec(comment);
        const head = comment.replace(/\[.*\]/, "").trim();
        let value: ShaderUniform["value"];
        if (type === "color") value = old?.value ?? (/^#[0-9a-f]{3,6}$/i.test(head) ? head.toUpperCase() : "#FFFFFF");
        else if (type === "vec2") {
            const parts = head.split(/[,\s]+/).map(Number);
            value = old?.value ?? [Number.isFinite(parts[0]) ? (parts[0] as number) : 0.5, Number.isFinite(parts[1]) ? (parts[1] as number) : 0.5];
        } else {
            const n = parseFloat(head);
            value = old?.value ?? (Number.isFinite(n) ? n : 0);
        }
        const uniform: ShaderUniform = { name, type, value };
        if (range) {
            uniform.min = Number(range[1]);
            uniform.max = Number(range[2]);
        } else if (type === "float") {
            uniform.min = 0;
            uniform.max = Math.max(1, typeof value === "number" ? value * 2 : 1);
        }
        out.push(uniform);
    }
    return out;
}

// Whether the shader animates (reads the time uniform).
export function usesTime(code: string): boolean {
    return /\biTime\b/.test(code);
}
