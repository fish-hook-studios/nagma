import { Play } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "../engine/store";
import { slideIds, slideOf } from "./model";
import { DEFAULT_TRANSITION, animationMods, animationSteps, drawMatched, drawSlide, drawTransition, finalMods, stepLength } from "./render";

// A small picture in the Animate tab that plays the slide's transition (from the slide before
// it) or its object animations, step after step, the way the show would.

const GAP = 350;

export function SlidePreview({ id, what, width = 208 }: { id: string; what: "transition" | "animations"; width?: number }) {
    const ref = useRef<HTMLCanvasElement | null>(null);
    const [playing, setPlaying] = useState(0);
    const doc = useEditor((s) => s.doc);

    useEffect(() => {
        const canvas = ref.current;
        const slide = doc.nodes[id];
        if (!canvas || !slide) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const height = Math.round((width * slide.h) / slide.w);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const scale = (width * dpr) / slide.w;
        const ids = slideIds(doc);
        const prev = doc.nodes[ids[ids.indexOf(id) - 1] ?? ""];
        const spec = slideOf(slide)?.transition ?? DEFAULT_TRANSITION;
        const steps = animationSteps(slide);
        const autoLen = stepLength(steps.auto);
        // When each click step starts, counted from the slide's entry.
        const starts: number[] = [];
        let at = autoLen + GAP;
        for (const step of steps.clicks) {
            starts.push(at);
            at += stepLength(step) + GAP;
        }
        const total = what === "transition" ? spec.duration : at;
        const begin = performance.now();
        let frame = 0;
        const draw = () => {
            const now = performance.now() - begin;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.scale(scale, scale);
            const done = !playing || now >= total;
            if (what === "transition") {
                const p = done ? 1 : now / Math.max(1, spec.duration);
                if (!playing || spec.type === "none" || !prev) drawSlide(ctx, doc, slide, scale, finalMods(doc, slide));
                else if (spec.type === "smart") drawMatched(ctx, doc, prev, slide, p, spec.easing, scale);
                else
                    drawTransition(
                        ctx,
                        slide.w,
                        slide.h,
                        spec,
                        p,
                        () => drawSlide(ctx, doc, prev, scale, finalMods(doc, prev)),
                        () => drawSlide(ctx, doc, slide, scale, finalMods(doc, slide)),
                    );
            } else if (done) drawSlide(ctx, doc, slide, scale, finalMods(doc, slide));
            else {
                let shown = 0;
                while (shown < starts.length && now >= (starts[shown] ?? Infinity)) shown++;
                const stepTime = shown ? now - (starts[shown - 1] ?? 0) : 0;
                drawSlide(ctx, doc, slide, scale, animationMods(doc, slide, shown, stepTime, now));
            }
            if (!done) frame = requestAnimationFrame(draw);
            else if (playing) setPlaying(0);
        };
        draw();
        return () => cancelAnimationFrame(frame);
    }, [doc, id, what, width, playing]);

    const label = what === "transition" ? "Preview transition" : "Play animations";
    return (
        <div className="space-y-1.5">
            <canvas ref={ref} aria-label={`${label} preview`} className="block rounded border border-panel-border" style={{ width, height: (width * 9) / 16 }} />
            <button type="button" onClick={() => setPlaying(Date.now())} className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-field hover:bg-panel-hover">
                <Play className="size-3" /> {label}
            </button>
        </div>
    );
}
