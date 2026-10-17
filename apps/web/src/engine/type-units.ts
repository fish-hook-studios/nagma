// Small pure pieces of the Typography controls: typed values with units ("24", "150%", "1.5px",
// "Auto") and the stops a variable font's named instances put on an axis slider.

export type TypedValue = { kind: "auto" } | { kind: "number"; value: number; unit: "px" | "%" | null };

// What was typed into a line height or letter spacing field. A unit switches the field to it;
// a bare number keeps the field's unit. Maths and relative edits are left to the number field.
export function parseTypedUnit(text: string): TypedValue | null {
    const t = text.trim().toLowerCase();
    if (t === "auto") return { kind: "auto" };
    const m = /^(-?\d*\.?\d+)\s*(px|%)?$/.exec(t);
    if (!m) return null;
    const value = Number(m[1]);
    if (!Number.isFinite(value)) return null;
    return { kind: "number", value, unit: (m[2] as "px" | "%" | undefined) ?? null };
}

export interface AxisInstance {
    name: string;
    coords: Record<string, number>;
}

// The values the font's named instances (Thin, Regular, Bold...) take on an axis, in order, for the
// dots on its slider. An axis the instances don't vary has none.
export function axisStops(tag: string, min: number, max: number, instances: AxisInstance[]): { value: number; name: string }[] {
    const byValue = new Map<number, string>();
    for (const inst of instances) {
        const v = inst.coords[tag];
        if (v === undefined || v < min || v > max) continue;
        // The first instance at a value names it (fonts list the upright styles first).
        if (!byValue.has(v)) byValue.set(v, inst.name);
    }
    if (byValue.size < 2) return [];
    return [...byValue.entries()].sort((a, b) => a[0] - b[0]).map(([value, name]) => ({ value, name }));
}

// Dragging near a stop lands on it: within `pull` of the axis range (2% by default).
export function snapToStop(value: number, stops: { value: number }[], min: number, max: number, pull = 0.02): number {
    const range = Math.max(1e-9, max - min);
    let best = value;
    let distance = Infinity;
    for (const s of stops) {
        const d = Math.abs(s.value - value);
        if (d < distance) {
            distance = d;
            best = s.value;
        }
    }
    return distance / range <= pull ? best : value;
}
