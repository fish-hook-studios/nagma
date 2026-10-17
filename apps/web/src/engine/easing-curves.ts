import type { Easing, Spring, Transition } from "./types";

// The easing menu, in the reference's order.
export const EASINGS: [Easing, string][] = [
    ["linear", "Linear"],
    ["ease-in", "Ease in"],
    ["ease-out", "Ease out"],
    ["ease-in-out", "Ease in and out"],
    ["ease-in-back", "Ease in back"],
    ["ease-out-back", "Ease out back"],
    ["ease-in-out-back", "Ease in and out back"],
    ["custom-bezier", "Custom bezier"],
    ["spring-gentle", "Gentle spring"],
    ["spring-quick", "Quick spring"],
    ["spring-bouncy", "Bouncy spring"],
    ["spring-slow", "Slow spring"],
    ["custom-spring", "Custom spring"],
];

export function easingLabel(easing: Easing): string {
    return EASINGS.find(([id]) => id === easing)?.[1] ?? easing;
}

// Easing curves for prototype animations: cubic beziers (the named curves and custom ones) and
// springs worked out from their physics, like the reference's spring presets.

// The reference's named curves as cubic beziers (x1, y1, x2, y2).
export const BEZIERS: Partial<Record<Easing, [number, number, number, number]>> = {
    linear: [0, 0, 1, 1],
    "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1],
    "ease-in-out": [0.42, 0, 0.58, 1],
    "ease-in-back": [0.3, -0.05, 0.7, -0.5],
    "ease-out-back": [0.45, 1.45, 0.8, 1],
    "ease-in-out-back": [0.7, -0.4, 0.4, 1.4],
};

export const SPRINGS: Partial<Record<Easing, Spring>> = {
    "spring-gentle": { mass: 1, stiffness: 100, damping: 15 },
    "spring-quick": { mass: 1, stiffness: 300, damping: 20 },
    "spring-bouncy": { mass: 1, stiffness: 600, damping: 15 },
    "spring-slow": { mass: 1, stiffness: 80, damping: 20 },
};

// A custom bezier starts from the curve in use; from a spring it starts from the default easing (ease out).
export const DEFAULT_BEZIER: [number, number, number, number] = [0, 0, 0.58, 1];
export const DEFAULT_SPRING: Spring = { mass: 1, stiffness: 100, damping: 15 };

export function isSpring(kind: Easing): boolean {
    return kind === "custom-spring" || kind in SPRINGS;
}

// y on a cubic bezier from (0,0) to (1,1) at x = t.
export function bezierAt(x1: number, y1: number, x2: number, y2: number, t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const x = (s: number) => ((ax * s + bx) * s + cx) * s;
    const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
    let s = t;
    for (let i = 0; i < 8; i++) {
        const err = x(s) - t;
        if (Math.abs(err) < 1e-6) break;
        const d = dx(s);
        if (Math.abs(d) < 1e-6) break;
        s -= err / d;
    }
    if (s < 0 || s > 1 || Math.abs(x(s) - t) > 1e-4) {
        let lo = 0;
        let hi = 1;
        s = t;
        for (let i = 0; i < 40; i++) {
            if (x(s) < t) lo = s;
            else hi = s;
            s = (lo + hi) / 2;
        }
    }
    return ((ay * s + by) * s + cy) * s;
}

// Progress of a spring released from 0 towards 1 after `seconds`, starting at the spring's
// initial velocity (distances per second; 0 at rest).
export function springAt(spring: Spring, seconds: number): number {
    const m = Math.max(0.01, spring.mass);
    const k = Math.max(0.01, spring.stiffness);
    const c = Math.max(0, spring.damping);
    const v0 = spring.initialVelocity ?? 0;
    const w0 = Math.sqrt(k / m);
    const zeta = c / (2 * Math.sqrt(k * m));
    const t = seconds;
    // The displacement x(t) from rest with x(0) = -1 and x'(0) = v0.
    if (zeta < 1) {
        const wd = w0 * Math.sqrt(1 - zeta * zeta);
        const b = (v0 - zeta * w0) / wd;
        return 1 + Math.exp(-zeta * w0 * t) * (-Math.cos(wd * t) + b * Math.sin(wd * t));
    }
    if (zeta === 1) return 1 + Math.exp(-w0 * t) * (-1 + (v0 - w0) * t);
    const r1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
    const r2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
    // Solve a + b = -1 and a r1 + b r2 = v0.
    const b = (v0 + r1) / (r2 - r1);
    const a = -1 - b;
    return 1 + a * Math.exp(r1 * t) + b * Math.exp(r2 * t);
}

// How long a spring takes to settle (within 0.1% of its rest, for good), in milliseconds.
export function springDuration(spring: Spring): number {
    const step = 1 / 120;
    let settled = 0;
    for (let t = 0; t < 10; t += step) {
        if (Math.abs(1 - springAt(spring, t)) > 0.001) settled = t + step;
    }
    return Math.round(Math.min(10, Math.max(0.05, settled)) * 1000);
}

export function springOf(transition: Pick<Transition, "easing" | "spring">): Spring | null {
    if (transition.easing === "custom-spring") return transition.spring ?? DEFAULT_SPRING;
    return SPRINGS[transition.easing] ?? null;
}

// The animation's length: springs decide their own.
export function transitionDuration(transition: Transition): number {
    if (transition.type === "instant") return 0;
    const spring = springOf(transition);
    return spring ? springDuration(spring) : Math.max(0, transition.duration);
}

// Eased progress at t (0 to 1 over the transition's duration).
export function easeTransition(transition: Pick<Transition, "easing" | "spring" | "bezier">, t: number): number {
    const x = Math.min(1, Math.max(0, t));
    const spring = springOf(transition);
    if (spring) return x >= 1 ? 1 : springAt(spring, (x * springDuration(spring)) / 1000);
    const curve = transition.easing === "custom-bezier" ? (transition.bezier ?? DEFAULT_BEZIER) : BEZIERS[transition.easing];
    if (!curve) return x;
    if (transition.easing === "linear") return x;
    return bezierAt(curve[0], curve[1], curve[2], curve[3], x);
}
