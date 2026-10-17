import { ChevronDown, XClose } from "@untitledui/icons";
import { useRef } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Popover as AriaPopover } from "react-aria-components";
import { BEZIERS, DEFAULT_BEZIER, DEFAULT_SPRING, EASINGS, SPRINGS, easeTransition, springDuration, easingLabel } from "../engine/easing-curves";
import { legacy } from "../engine/legacy-names";
import { editor } from "../engine/store";
import type { Easing, Spring, Transition } from "../engine/types";
import { NumberField } from "./number-field";

// Easing like the reference's: the curve and its name open an Easing window; the custom bezier and custom
// spring are edited there (drag the bezier's two handles; set a spring's mass, stiffness and damping).

// The curve as an SVG path in a w×h box (progress up, time across), with room for overshoot.
// `top` is the progress shown at the top edge (above 1 leaves room for overshoot).
function curvePath(t: Pick<Transition, "easing" | "bezier" | "spring">, w: number, h: number, pad: number, top = 1): string {
    const pts: string[] = [];
    const n = 64;
    for (let i = 0; i <= n; i++) {
        const x = i / n;
        const y = easeTransition(t, x) / top;
        pts.push(`${(pad + x * (w - pad * 2)).toFixed(2)},${(h - pad - y * (h - pad * 2)).toFixed(2)}`);
    }
    return `M${pts.join("L")}`;
}

export function CurvePreview({ transition, size = 20 }: { transition: Pick<Transition, "easing" | "bezier" | "spring">; size?: number }) {
    return (
        <svg viewBox={`0 0 ${size} ${size}`} className="shrink-0" style={{ width: size, height: size }} fill="none">
            <path d={curvePath(transition, size, size, 3)} stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
    );
}

const EASING_GROUPS: Easing[][] = [["linear"], ["ease-in", "ease-out", "ease-in-out", "ease-in-back", "ease-out-back", "ease-in-out-back", "custom-bezier"], ["spring-gentle", "spring-quick", "spring-bouncy", "spring-slow", "custom-spring"]];

// The Easing field: the curve and its name; it opens a small "Easing" window listing every curve,
// with a bezier editor for Custom bezier and stiffness, damping and mass for Custom spring.
export function EasingButton({ transition, onChange }: { transition: Transition; onChange: (next: Transition) => void }) {
    const setEasing = (easing: Easing) => {
        const next: Transition = { ...transition, easing };
        // A custom curve starts from the one in use.
        if (easing === "custom-bezier" && !transition.bezier) next.bezier = BEZIERS[transition.easing] ?? DEFAULT_BEZIER;
        if (easing === "custom-spring" && !transition.spring) next.spring = SPRINGS[transition.easing] ?? DEFAULT_SPRING;
        onChange(next);
    };
    const sp: Spring = transition.spring ?? SPRINGS[transition.easing] ?? DEFAULT_SPRING;
    const bezier = transition.bezier ?? BEZIERS[transition.easing] ?? DEFAULT_BEZIER;
    // Easing values travel between interactions through the clipboard (also as text).
    const copyEasing = () => {
        const payload = { easing: transition.easing, bezier: transition.bezier, spring: transition.spring, duration: transition.duration };
        void navigator.clipboard?.writeText(`nagma-easing:${JSON.stringify(payload)}`).then(() => editor.notify("Easing copied."), () => editor.notify("The browser didn't allow copying."));
    };
    const pasteEasing = () => {
        void navigator.clipboard?.readText().then((text) => {
            const raw = text.trim();
            const prefix = ["nagma-easing:", legacy.easingPrefix].find((p) => raw.startsWith(p));
            const json = prefix ? raw.slice(prefix.length) : raw;
            try {
                const v = JSON.parse(json) as Partial<Transition>;
                if (!v.easing || !EASINGS.some(([id]) => id === v.easing)) throw new Error("not an easing");
                onChange({ ...transition, easing: v.easing, ...(v.bezier ? { bezier: v.bezier } : {}), ...(v.spring ? { spring: v.spring } : {}), ...(typeof v.duration === "number" ? { duration: v.duration } : {}) });
                editor.notify("Easing pasted.");
            } catch {
                editor.notify("The clipboard has no easing to paste.");
            }
        }, () => editor.notify("The browser didn't allow reading the clipboard."));
    };
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label="Easing" className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border border-panel-border bg-transparent pr-2 pl-1.5 text-left text-ink outline-none hover:border-ink-subtle focus-visible:border-brand-500 data-[pressed]:border-ink-subtle">
                <span className="text-ink-muted">
                    <CurvePreview transition={transition} size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate">{easingLabel(transition.easing)}</span>
                <ChevronDown className="size-3 shrink-0 text-ink-subtle" />
            </AriaButton>
            <AriaPopover placement="left top" offset={12} className="outline-none">
                <AriaDialog aria-label="Easing" className="outline-none">
                    {({ close }) => (
                        <div data-interaction-keep="" className="w-60 rounded-lg border border-panel-border bg-panel-raised text-ink shadow-xl">
                            <div className="flex h-10 items-center justify-between border-b border-panel-border pr-1.5 pl-3">
                                <span className="font-semibold">Easing</span>
                                <span className="flex items-center gap-0.5">
                                    <button type="button" onClick={copyEasing} title="Copy the easing values" className="h-6 rounded px-1.5 text-ink-muted hover:bg-panel-hover hover:text-ink">
                                        Copy
                                    </button>
                                    <button type="button" onClick={pasteEasing} title="Paste easing values" className="h-6 rounded px-1.5 text-ink-muted hover:bg-panel-hover hover:text-ink">
                                        Paste
                                    </button>
                                    <button type="button" aria-label="Close" onClick={close} className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                                        <XClose className="size-3.5" />
                                    </button>
                                </span>
                            </div>
                            <div role="listbox" aria-label="Easing curves" className="max-h-72 overflow-y-auto p-1">
                                {EASING_GROUPS.map((group, gi) => (
                                    <div key={gi}>
                                        {gi > 0 && <div className="my-1 h-px bg-panel-border" />}
                                        {group.map((id) => (
                                            <button
                                                key={id}
                                                type="button"
                                                role="option"
                                                aria-selected={transition.easing === id}
                                                onClick={() => setEasing(id)}
                                                className={`flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left ${transition.easing === id ? "bg-brand-500 text-white" : "hover:bg-panel-hover"}`}
                                            >
                                                <span className={transition.easing === id ? "text-white" : "text-ink-muted"}>
                                                    <CurvePreview transition={id === "custom-bezier" ? { easing: id, bezier } : id === "custom-spring" ? { easing: id, spring: sp } : { easing: id }} size={16} />
                                                </span>
                                                {easingLabel(id)}
                                            </button>
                                        ))}
                                    </div>
                                ))}
                            </div>
                            {transition.easing === "custom-bezier" && (
                                <div className="space-y-2 border-t border-panel-border p-2">
                                    <BezierCanvas value={bezier} onChange={(b) => onChange({ ...transition, easing: "custom-bezier", bezier: b })} />
                                    <div className="grid grid-cols-4 gap-1">
                                        {bezier.map((v, i) => (
                                            <NumberField
                                                key={i}
                                                label=""
                                                title={["X1", "Y1", "X2", "Y2"][i]}
                                                step={0.01}
                                                min={i % 2 === 0 ? 0 : -2}
                                                max={i % 2 === 0 ? 1 : 3}
                                                value={Math.round(v * 100) / 100}
                                                onCommit={(n) => onChange({ ...transition, easing: "custom-bezier", bezier: bezier.map((x, k) => (k === i ? n : x)) as [number, number, number, number] })}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}
                            {transition.easing === "custom-spring" && <SpringEditor spring={sp} onChange={(spring) => onChange({ ...transition, easing: "custom-spring", spring })} />}
                        </div>
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

function SpringEditor({ spring: sp, onChange }: { spring: Spring; onChange: (next: Spring) => void }) {
    const set = (patch: Partial<Spring>) => onChange({ ...sp, ...patch });
    return (
        <div className="space-y-2 border-t border-panel-border p-2">
            <div className="flex h-20 items-center justify-center rounded-md bg-field text-brand-500">
                <svg viewBox="0 0 200 80" className="h-full w-full" fill="none">
                    <line x1="6" x2="194" y1={6 + 68 * (1 - 1 / 1.6)} y2={6 + 68 * (1 - 1 / 1.6)} stroke="currentColor" strokeOpacity="0.25" strokeDasharray="3 3" />
                    <path d={curvePath({ easing: "custom-spring", spring: sp }, 200, 80, 6, 1.6)} stroke="currentColor" strokeWidth="1.5" />
                </svg>
            </div>
            <div className="grid grid-cols-[1fr_76px] items-center gap-x-2 gap-y-1">
                <span className="text-ink-muted">Stiffness</span>
                <NumberField label="" title="Stiffness" min={1} max={1000} value={sp.stiffness} onCommit={(stiffness) => set({ stiffness })} onScrub={(stiffness) => set({ stiffness })} />
                <span className="text-ink-muted">Damping</span>
                <NumberField label="" title="Damping" min={0} max={100} value={sp.damping} onCommit={(damping) => set({ damping })} onScrub={(damping) => set({ damping })} />
                <span className="text-ink-muted">Mass</span>
                <NumberField label="" title="Mass" min={0.1} max={10} step={0.1} value={sp.mass} onCommit={(mass) => set({ mass })} onScrub={(mass) => set({ mass })} />
                <span className="text-ink-muted">Initial velocity</span>
                <NumberField label="" title="Initial velocity" min={-50} max={50} step={0.5} value={sp.initialVelocity ?? 0} onCommit={(initialVelocity) => set({ initialVelocity })} onScrub={(initialVelocity) => set({ initialVelocity })} />
            </div>
            <p className="text-ink-subtle">Settles in {springDuration(sp)}ms</p>
        </div>
    );
}

// A square with the curve and its two handles; y can go past the box for overshoot.
export function BezierCanvas({ value, onChange }: { value: [number, number, number, number]; onChange: (next: [number, number, number, number]) => void }) {
    const W = 220;
    const H = 180;
    const pad = 40;
    const box = { x: 20, y: pad, w: W - 40, h: H - pad * 2 };
    const toX = (x: number) => box.x + x * box.w;
    const toY = (y: number) => box.y + box.h - y * box.h;
    const drag = useRef<number | null>(null);
    const svg = useRef<SVGSVGElement>(null);
    const [x1, y1, x2, y2] = value;
    const move = (event: React.PointerEvent) => {
        const which = drag.current;
        const el = svg.current;
        if (which === null || !el) return;
        const r = el.getBoundingClientRect();
        const px = ((event.clientX - r.left) / r.width) * W;
        const py = ((event.clientY - r.top) / r.height) * H;
        const nx = Math.round(Math.min(1, Math.max(0, (px - box.x) / box.w)) * 100) / 100;
        const ny = Math.round(Math.min(3, Math.max(-2, (box.y + box.h - py) / box.h)) * 100) / 100;
        const next = [...value] as [number, number, number, number];
        next[which * 2] = nx;
        next[which * 2 + 1] = ny;
        onChange(next);
    };
    const path = `M${toX(0)},${toY(0)} C${toX(x1)},${toY(y1)} ${toX(x2)},${toY(y2)} ${toX(1)},${toY(1)}`;
    return (
        <svg
            ref={svg}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full touch-none rounded-md bg-field"
            onPointerMove={move}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
        >
            <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="none" stroke="currentColor" className="text-panel-border" />
            <line x1={toX(0)} y1={toY(0)} x2={toX(x1)} y2={toY(y1)} stroke="currentColor" className="text-ink-subtle" />
            <line x1={toX(1)} y1={toY(1)} x2={toX(x2)} y2={toY(y2)} stroke="currentColor" className="text-ink-subtle" />
            <path d={path} fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-500" />
            {/* The start and end keyframes: click one to put its handle back where it started. */}
            {[0, 1].map((i) => (
                <rect
                    key={`k${i}`}
                    role="button"
                    aria-label={i === 0 ? "Reset first handle" : "Reset second handle"}
                    x={toX(i) - 4}
                    y={toY(i) - 4}
                    width={8}
                    height={8}
                    className="cursor-pointer fill-ink-muted"
                    onClick={() => {
                        const next = [...value] as [number, number, number, number];
                        next[i * 2] = DEFAULT_BEZIER[i * 2] as number;
                        next[i * 2 + 1] = DEFAULT_BEZIER[i * 2 + 1] as number;
                        onChange(next);
                    }}
                />
            ))}
            {[
                [x1, y1],
                [x2, y2],
            ].map(([x, y], i) => (
                <circle
                    key={i}
                    role="slider"
                    aria-label={i === 0 ? "First handle" : "Second handle"}
                    aria-valuenow={y}
                    cx={toX(x ?? 0)}
                    cy={toY(y ?? 0)}
                    r={6}
                    className="cursor-grab fill-white stroke-brand-500"
                    strokeWidth={2}
                    onPointerDown={(e) => {
                        e.preventDefault();
                        (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
                        drag.current = i;
                    }}
                />
            ))}
        </svg>
    );
}
