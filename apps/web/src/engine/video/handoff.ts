import { type Ease, type VClip, type VComp, type VKey, ease, propAt } from "./model";

// Hand-off for a clip's motion: its keyframed position, scale, rotation and opacity as CSS
// @keyframes, as a React component using them, and as JSON (times, values and easing), for
// rebuilding the animation in code.

const PATHS = ["x", "y", "scaleX", "scaleY", "rotation", "opacity"] as const;

// The spring as CSS: the editor's own spring curve (model.ts, ease) sampled every 5%. A hand-written
// curve here overshot twice as far and rose more slowly than what the editor shows and exports.
const SPRING = `linear(${Array.from({ length: 21 }, (_, i) => {
    const p = i / 20;
    const v = Math.round(ease("spring", p) * 1000) / 1000;
    return i === 0 || i === 20 ? String(v) : `${v} ${i * 5}%`;
}).join(", ")})`;

const EASES: Record<Exclude<Ease, "bezier" | "hold">, string> = { spring: SPRING, linear: "linear", "ease-in": "cubic-bezier(0.42, 0, 1, 1)", "ease-out": "cubic-bezier(0, 0, 0.58, 1)", "ease-in-out": "cubic-bezier(0.42, 0, 0.58, 1)" };

function cssEase(key: VKey | undefined): string {
    if (!key) return "linear";
    if (key.ease === "bezier" && key.bezier) return `cubic-bezier(${key.bezier.join(", ")})`;
    if (key.ease === "hold") return "steps(1, end)";
    return EASES[(key.ease === "bezier" ? "linear" : key.ease) ?? "linear"];
}

const r = (n: number) => Math.round(n * 1000) / 1000;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "clip";

// Every time a transform key sits at, with the clip's look then and the easing out of it.
function stops(comp: VComp, clip: VClip): { at: number; css: string; ease: string }[] {
    const times = [...new Set([0, clip.duration, ...PATHS.flatMap((p) => (clip.anim[p] ?? []).map((k) => k.t))])].filter((t) => t >= 0 && t <= clip.duration).sort((a, b) => a - b);
    return times.map((t) => {
        const v = Object.fromEntries(PATHS.map((p) => [p, propAt(comp, clip, p, t)])) as Record<(typeof PATHS)[number], number>;
        const dx = v.x - comp.width / 2;
        const dy = v.y - comp.height / 2;
        const key = PATHS.map((p) => (clip.anim[p] ?? []).find((k) => Math.abs(k.t - t) < 1e-6)).find(Boolean);
        return { at: clip.duration ? t / clip.duration : 0, css: `transform: translate(${r(dx)}px, ${r(dy)}px) rotate(${r(v.rotation)}deg) scale(${r(v.scaleX / 100)}, ${r(v.scaleY / 100)}); opacity: ${r(v.opacity / 100)};`, ease: cssEase(key) };
    });
}

export function animated(clip: VClip): boolean {
    return PATHS.some((p) => (clip.anim[p]?.length ?? 0) > 1);
}

export function clipCss(comp: VComp, clip: VClip): string {
    const name = slug(clip.name);
    const frames = stops(comp, clip)
        .map((s) => `  ${r(s.at * 100)}% { ${s.css} animation-timing-function: ${s.ease}; }`)
        .join("\n");
    return `/* ${clip.name}: ${r(clip.duration)}s, from ${r(clip.start)}s in the sequence (${comp.width}×${comp.height}). */\n@keyframes ${name} {\n${frames}\n}\n\n.${name} {\n  animation: ${name} ${r(clip.duration)}s ${r(clip.start)}s both;\n  transform-origin: 50% 50%;\n}`;
}

export function clipReact(clip: VClip): string {
    const name = slug(clip.name);
    const component = name.replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase()).replace(/^\d/, "C$&");
    return `// Uses the CSS from the CSS tab (put it in a stylesheet the page loads).\nexport function ${component}({ children }: { children: React.ReactNode }) {\n  return <div className="${name}">{children}</div>;\n}`;
}

export function clipJson(comp: VComp, clip: VClip): string {
    const tracks = Object.fromEntries(PATHS.filter((p) => clip.anim[p]?.length).map((p) => [p, (clip.anim[p] ?? []).map((k) => ({ time: r(k.t), value: r(k.v), easing: k.ease === "bezier" ? k.bezier : (k.ease ?? "linear") }))]));
    const still = Object.fromEntries(PATHS.filter((p) => !clip.anim[p]?.length).map((p) => [p, r(propAt(comp, clip, p, 0))]));
    return JSON.stringify({ name: clip.name, start: r(clip.start), duration: r(clip.duration), frame: { width: comp.width, height: comp.height, fps: comp.fps }, keyframes: tracks, values: still }, null, 2);
}
