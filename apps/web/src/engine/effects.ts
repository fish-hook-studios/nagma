import type { Command, Effect, SceneNode } from "./types";

// Effects on a layer: labels, the default new effect, and reading the older shadow and blur fields.

export const EFFECT_LABELS: Record<Effect["type"], string> = {
    "drop-shadow": "Drop shadow",
    "inner-shadow": "Inner shadow",
    "layer-blur": "Layer blur",
    "background-blur": "Background blur",
    "motion-blur": "Motion blur",
    noise: "Noise",
    texture: "Texture",
    glass: "Glass",
    shader: "Shader",
};

export const DEFAULT_EFFECT: Effect = { type: "drop-shadow", visible: true, x: 0, y: 4, blur: 4, spread: 0, color: "#000000", opacity: 0.25, showBehind: false };

// What a new effect of each kind starts with (the reference's defaults, roughly).
export function defaultEffect(type: Effect["type"], visible = true): Effect {
    const base = { visible, x: 0, y: 0, spread: 0, color: "#000000", opacity: 1 };
    switch (type) {
        case "drop-shadow":
        case "inner-shadow":
            return { ...DEFAULT_EFFECT, type, visible };
        case "layer-blur":
        case "background-blur":
            return { ...base, type, blur: 4 };
        case "motion-blur":
            return { ...base, type, blur: 8, angle: 0 };
        case "noise":
            return { ...base, type, blur: 0, noiseType: "mono", noiseSize: 0.5, noiseSizeY: 0.5, density: 1, opacity: 0.25, color2: "#FFFFFF", opacity2: 0.25 };
        case "texture":
            return { ...base, type, blur: 4, noiseSize: 0.5, noiseSizeY: 0.5, clipToShape: true };
        case "glass":
            return { ...base, type, blur: 4, color: "#FFFFFF", lightAngle: -45, lightIntensity: 0.8, refraction: 0.8, depth: 20, dispersion: 0.5, splay: 0 };
        case "shader":
            return { ...base, type, blur: 0, shader: { code: SHADER_EFFECT_PRESET, uniforms: [], preset: "grain" } };
    }
}

// What a new shader effect starts with: film grain over the layer (canvas/shader-paint.ts).
const SHADER_EFFECT_PRESET = `uniform float amount; // 0.25
uniform float size; // 1.5

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec4 layer = texture(iLayer, vUv);
    float g = hash(floor(gl_FragCoord.xy / max(size, 0.5))) - 0.5;
    fragColor = vec4(layer.rgb + g * amount, layer.a);
}`;

export const isBlurEffect = (type: Effect["type"]) => type === "layer-blur" || type === "background-blur" || type === "motion-blur";

// A layer's effects, with its older single shadow and blur fields read as the first rows.
export function effectsOf(node: SceneNode): Effect[] {
    const legacy: Effect[] = [];
    if (node.shadow) legacy.push({ type: "drop-shadow", visible: true, x: node.shadow.x, y: node.shadow.y, blur: node.shadow.blur, spread: 0, color: node.shadow.color, opacity: node.shadow.opacity });
    if (node.blur > 0) legacy.push({ type: "layer-blur", visible: true, x: 0, y: 0, blur: node.blur, spread: 0, color: "#000000", opacity: 1 });
    return [...legacy, ...(node.effects ?? [])];
}

// The kinds offered by the Effects section's + menu, in its order.
export const ADDABLE_EFFECTS: Effect["type"][] = ["drop-shadow", "inner-shadow", "layer-blur", "background-blur", "noise", "texture", "glass"];

// Adds an effect (a drop shadow unless told otherwise) on top of every given layer's effects.
// Glass also turns the layer's first solid fill down to 10%, so what is behind shows through.
export function addEffectCommand(nodes: SceneNode[], type: Effect["type"] = "drop-shadow"): Command {
    return {
        type: "batch",
        commands: nodes.map((n) => {
            const k = type === "glass" ? n.fills.findIndex((p) => p.type === "solid") : -1;
            const fills = k >= 0 ? { fills: n.fills.map((p, i) => (i === k ? { ...p, opacity: 0.1 } : p)) } : {};
            return { type: "node.update" as const, id: n.id, patch: { effects: [...effectsOf(n), defaultEffect(type)], shadow: null, blur: 0, ...fills } };
        }),
    };
}
