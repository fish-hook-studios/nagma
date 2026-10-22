// Interaction states for Nagma Capture's page script: which elements the page styles on :hover,
// :focus (and :focus-visible) and :active, and a way to show an element in one of those states
// without a pointer or keyboard.
//
// Rules are read from every style sheet the page can read, plus the text of the ones it can't
// (other origins), which the service worker fetches and hands in. Forcing a state either happens
// outside (the devtools protocol, when the person allowed the debugger permission), or here: each
// state rule gets a twin whose state pseudo-class is an attribute instead ([data-nagma-hover]),
// placed right after it so the cascade is the same, and the element and its ancestors carry the
// attribute while the state is read.

import type { CaptureStateName, CaptureTransition } from "../../web/src/engine/capture-format";

export type StateName = CaptureStateName;

// :hover, :focus, :focus-visible and :active (and nothing longer, such as :focus-within).
const STATE_PSEUDO = /:(hover|focus-visible|focus|active)(?![\w-])/g;
const PSEUDO_ELEMENT = /::?(before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)(?![\w-])/g;
const ATTR: Record<string, string> = { hover: "data-nagma-hover", "focus-visible": "data-nagma-focus", focus: "data-nagma-focus", active: "data-nagma-active" };
const STATE_OF: Record<string, StateName> = { hover: "hover", "focus-visible": "focus", focus: "focus", active: "active" };

// The most elements given states in one capture, and the largest (a state on a whole section is
// a layout effect, not a control's).
const MAX_ELEMENTS = 120;
const MAX_AREA = 260_000;

export interface ExtraSheet {
    href: string;
    text: string;
}

// Style rules in a list, inside @media that applies now, @supports, @layer and @container.
export function* styleRules(list: CSSRuleList | undefined): Generator<CSSStyleRule> {
    if (!list) return;
    for (const rule of Array.from(list)) {
        if (rule instanceof CSSStyleRule) {
            yield rule;
            continue;
        }
        if (rule instanceof CSSMediaRule) {
            if (!window.matchMedia(rule.conditionText || rule.media.mediaText).matches) continue;
            yield* styleRules(rule.cssRules);
            continue;
        }
        if (typeof CSSSupportsRule !== "undefined" && rule instanceof CSSSupportsRule) {
            if (CSS.supports(rule.conditionText)) yield* styleRules(rule.cssRules);
            continue;
        }
        if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules && !(rule instanceof CSSKeyframesRule)) yield* styleRules((rule as CSSGroupingRule).cssRules);
    }
}

// Every sheet's rules the page script can reach: its own readable sheets, constructed ones, and
// the cross-origin ones parsed from the text the service worker fetched.
export function readableSheets(extra: ExtraSheet[] = []): { sheet: CSSStyleSheet; own: boolean; href: string }[] {
    const out: { sheet: CSSStyleSheet; own: boolean; href: string }[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
        try {
            void sheet.cssRules;
            if (!sheet.disabled) out.push({ sheet, own: true, href: sheet.href ?? document.baseURI });
        } catch {
            // Another origin's: read from the fetched text below.
        }
    }
    for (const sheet of document.adoptedStyleSheets ?? []) out.push({ sheet, own: true, href: document.baseURI });
    for (const e of extra) {
        try {
            const sheet = new CSSStyleSheet({ baseURL: e.href } as CSSStyleSheetInit);
            sheet.replaceSync(e.text);
            out.push({ sheet, own: false, href: e.href });
        } catch {
            // Not parseable here.
        }
    }
    return out;
}

// The address of each sheet the page has but can't read (for the service worker to fetch).
export function unreadableSheets(): string[] {
    const out: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
        try {
            void sheet.cssRules;
        } catch {
            if (sheet.href) out.push(sheet.href);
        }
    }
    return out;
}

// Splits a selector list on its top-level commas.
export function splitSelectors(text: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    let quote = "";
    for (const ch of text) {
        if (quote) {
            cur += ch;
            if (ch === quote) quote = "";
            continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === "(" || ch === "[") depth++;
        else if (ch === ")" || ch === "]") depth--;
        if (ch === "," && depth === 0) {
            out.push(cur.trim());
            cur = "";
        } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

// A complex selector's compounds and the combinators between them: ".a:hover > .b" →
// [".a:hover", ">", ".b"].
export function compounds(selector: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    let quote = "";
    const push = () => {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
    };
    for (let i = 0; i < selector.length; i++) {
        const ch = selector[i] as string;
        if (quote) {
            cur += ch;
            if (ch === quote) quote = "";
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            cur += ch;
            continue;
        }
        if (ch === "(" || ch === "[") depth++;
        else if (ch === ")" || ch === "]") depth--;
        if (depth === 0 && (ch === ">" || ch === "+" || ch === "~")) {
            push();
            out.push(ch);
            continue;
        }
        if (depth === 0 && /\s/.test(ch)) {
            push();
            if (out.length && !/^[>+~ ]$/.test(out[out.length - 1] as string)) out.push(" ");
            continue;
        }
        cur += ch;
    }
    push();
    // A descendant space before an explicit combinator is no combinator of its own.
    return out.filter((c, i) => !(c === " " && /^[>+~]$/.test(out[i + 1] ?? "")));
}

// The states a compound asks for at its own level (not inside :not() or :is()).
function topStates(compound: string): StateName[] {
    let depth = 0;
    const out: StateName[] = [];
    for (let i = 0; i < compound.length; i++) {
        const ch = compound[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === ":" && depth === 0 && compound[i + 1] !== ":") {
            const m = /^:(hover|focus-visible|focus|active)(?![\w-])/.exec(compound.slice(i));
            if (m) out.push(STATE_OF[m[1] as string] as StateName);
        }
    }
    return out;
}

const strip = (s: string) => s.replace(STATE_PSEUDO, "").replace(PSEUDO_ELEMENT, "");

// For one complex selector: each element selector that takes a state, with the states. ".card:hover
// .title" → [".card", ["hover"]]; ".nav a:hover" → [".nav a", ["hover"]].
export function stateTargets(selector: string): { selector: string; states: StateName[] }[] {
    const parts = compounds(selector);
    const out: { selector: string; states: StateName[] }[] = [];
    parts.forEach((part, i) => {
        if (/^[>+~ ]$/.test(part)) return;
        const states = topStates(part);
        if (!states.length) return;
        const prefix = parts
            .slice(0, i + 1)
            .map((p) => (/^[>+~ ]$/.test(p) ? (p === " " ? " " : ` ${p} `) : strip(p) || "*"))
            .join("")
            .trim();
        out.push({ selector: prefix, states: [...new Set(states)] });
    });
    return out;
}

// The twin of a state rule's selector: state pseudo-classes as attributes.
export function forcedSelector(selector: string): string {
    return selector.replace(STATE_PSEUDO, (_, name: string) => `[${ATTR[name]}]`);
}

export interface StateElement {
    el: Element;
    states: StateName[];
    transition: CaptureTransition | null;
}

function transitionOf(el: Element): CaptureTransition | null {
    const cs = getComputedStyle(el);
    const props = cs.transitionProperty.split(",").map((s) => s.trim());
    const durations = cs.transitionDuration.split(",").map((s) => s.trim());
    const delays = cs.transitionDelay.split(",").map((s) => s.trim());
    const easings = splitSelectors(cs.transitionTimingFunction);
    const time = (v: string | undefined) => (v ? (v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000) || 0 : 0);
    // The longest entry stands for the element (one easing and duration per variant change).
    let best = -1;
    let bestMs = 0;
    props.forEach((p, i) => {
        if (p === "none") return;
        const ms = time(durations[i % durations.length]);
        if (ms > bestMs) {
            bestMs = ms;
            best = i;
        }
    });
    if (best < 0) return null;
    return { property: props[best] as string, duration: Math.round(bestMs), easing: easings[best % easings.length] ?? "ease", delay: Math.round(time(delays[best % delays.length])) };
}

// The elements the page styles on hover, focus or press: the outermost one where they nest.
export function findStateElements(extra: ExtraSheet[] = []): StateElement[] {
    const found = new Map<Element, Set<StateName>>();
    for (const { sheet } of readableSheets(extra)) {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            continue;
        }
        for (const rule of styleRules(rules)) {
            const text = rule.selectorText;
            if (!text || !STATE_PSEUDO.test(text)) continue;
            STATE_PSEUDO.lastIndex = 0;
            for (const sel of splitSelectors(text)) {
                for (const target of stateTargets(sel)) {
                    let els: Element[];
                    try {
                        els = Array.from(document.querySelectorAll(target.selector));
                    } catch {
                        continue;
                    }
                    for (const el of els) {
                        const set = found.get(el) ?? new Set();
                        target.states.forEach((s) => set.add(s));
                        found.set(el, set);
                    }
                }
            }
        }
    }
    const out: StateElement[] = [];
    for (const [el, states] of found) {
        if (el === document.documentElement || el === document.body || el.closest("svg") !== null && el.tagName.toLowerCase() !== "svg") continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || r.width * r.height > MAX_AREA) continue;
        if (getComputedStyle(el).visibility !== "visible") continue;
        // The outermost: an element inside another one with states is part of that one's variants.
        let up = el.parentElement;
        let nested = false;
        while (up) {
            if (found.has(up)) {
                const ur = up.getBoundingClientRect();
                if (ur.width * ur.height <= MAX_AREA && up !== document.body) {
                    nested = true;
                    break;
                }
            }
            up = up.parentElement;
        }
        if (nested) continue;
        out.push({ el, states: [...states].sort(), transition: transitionOf(el) });
        if (out.length >= MAX_ELEMENTS) break;
    }
    return out;
}

// Puts the attribute twins of every state rule in place (right after each original in the page's
// own sheets; at the end, in a sheet of their own, for rules from other origins). Returns the undo.
export function installForcedRules(extra: ExtraSheet[] = []): () => void {
    const undo: (() => void)[] = [];
    const tail: string[] = [];
    const visit = (list: CSSRuleList, own: boolean, owner: CSSStyleSheet | CSSGroupingRule, wrap: (s: string) => string) => {
        // Backwards, so inserting after a rule doesn't move the ones still to visit.
        for (let i = list.length - 1; i >= 0; i--) {
            const rule = list[i];
            if (!rule) continue;
            if (rule instanceof CSSStyleRule) {
                if (!rule.selectorText || !/:(hover|focus-visible|focus|active)(?![\w-])/.test(rule.selectorText)) continue;
                const twin = `${forcedSelector(rule.selectorText)}{${rule.style.cssText}}`;
                if (own) {
                    try {
                        const added = owner.cssRules[owner.insertRule(twin, i + 1)];
                        undo.push(() => {
                            const at = Array.from(owner.cssRules).indexOf(added as CSSRule);
                            if (at >= 0) owner.deleteRule(at);
                        });
                    } catch {
                        // A selector this browser parses but won't take back: skipped.
                    }
                } else tail.unshift(wrap(twin));
                continue;
            }
            if (rule instanceof CSSMediaRule) {
                const cond = rule.media.mediaText;
                visit(rule.cssRules, own, rule, (s) => wrap(`@media ${cond}{${s}}`));
                continue;
            }
            if (typeof CSSSupportsRule !== "undefined" && rule instanceof CSSSupportsRule) {
                const cond = rule.conditionText;
                visit(rule.cssRules, own, rule, (s) => wrap(`@supports ${cond}{${s}}`));
                continue;
            }
            if ("cssRules" in rule && !(rule instanceof CSSKeyframesRule) && (rule as CSSGroupingRule).cssRules) visit((rule as CSSGroupingRule).cssRules, own, rule as CSSGroupingRule, wrap);
        }
    };
    for (const { sheet, own } of readableSheets(extra)) {
        try {
            visit(sheet.cssRules, own, sheet, (s) => s);
        } catch {
            // Unreadable after all.
        }
    }
    let style: HTMLStyleElement | null = null;
    if (tail.length) {
        style = document.createElement("style");
        style.setAttribute("data-nagma-capture", "");
        style.textContent = tail.join("\n");
        document.head.appendChild(style);
    }
    // Each twin is found again by identity, so the order of undoing doesn't matter.
    return () => {
        for (const u of undo) u();
        style?.remove();
    };
}

// Turns transitions off while states are read, so each reads its end value at once.
export function stillTransitions(): () => void {
    const style = document.createElement("style");
    style.setAttribute("data-nagma-capture", "");
    style.textContent = "*,*::before,*::after{transition:none!important}";
    document.head.appendChild(style);
    return () => style.remove();
}

// Shows an element in a state with the attribute twins: the attribute on it and (for hover and
// press, which the pointer gives every ancestor too) on its ancestors. Returns the undo.
export function applyState(el: Element, state: StateName): () => void {
    const names = state === "active" ? [ATTR.hover as string, ATTR.active as string] : state === "focus" ? [ATTR.focus as string] : [ATTR.hover as string];
    const touched: Element[] = [];
    let cur: Element | null = el;
    while (cur) {
        for (const n of names) cur.setAttribute(n, "");
        touched.push(cur);
        if (state === "focus") break;
        cur = cur.parentElement;
    }
    return () => {
        for (const t of touched) for (const n of names) t.removeAttribute(n);
    };
}

// The element's own properties that a state changes (for the record, and for Sites' hover).
export const WATCHED = ["background-color", "background-image", "color", "border-top-color", "border-top-width", "box-shadow", "opacity", "transform", "text-decoration-line", "outline-style", "outline-color", "outline-width", "filter", "scale", "translate"];

export function ownStyle(el: Element): Record<string, string> {
    const cs = getComputedStyle(el);
    const out: Record<string, string> = {};
    for (const p of WATCHED) out[p] = cs.getPropertyValue(p);
    return out;
}

export function styleChanges(before: Record<string, string>, after: Record<string, string>): Record<string, [string, string]> {
    const out: Record<string, [string, string]> = {};
    for (const p of WATCHED) if (before[p] !== after[p]) out[p] = [before[p] ?? "", after[p] ?? ""];
    return out;
}
