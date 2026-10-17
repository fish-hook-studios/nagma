// F6 (⇧F6 backwards) moves keyboard focus between the editor's regions: the toolbar, the left
// panel, the canvas and the right panel. Each region's root carries data-region; focus lands on
// its first focusable control, or on the region itself.
const ORDER = ["toolbar", "left", "canvas", "right"] as const;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function cycleFocusRegion(step: 1 | -1) {
    const active = document.activeElement as HTMLElement | null;
    const current = active?.closest<HTMLElement>("[data-region]")?.dataset.region ?? null;
    const start = current ? ORDER.indexOf(current as (typeof ORDER)[number]) : -1;
    for (let i = 1; i <= ORDER.length; i++) {
        const name = ORDER[(start + step * i + ORDER.length * 2) % ORDER.length];
        const region = document.querySelector<HTMLElement>(`[data-region="${name}"]`);
        if (!region) continue;
        const target = name === "canvas" ? region : (region.querySelector<HTMLElement>(FOCUSABLE) ?? region);
        if (!target.hasAttribute("tabindex") && target === region) target.tabIndex = -1;
        target.focus();
        return;
    }
}
