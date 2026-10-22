// Interactive parts for Nagma Capture's page script (the "Keep interactive parts working" option):
// finds the parts of a page its script runs (tabs, carousels, accordions, dialogs, inputs with
// suggestions, toggles and counters), and makes each a Live frame's source: its HTML, the page's CSS
// rules that apply to it, and a behaviour shim.
//
// The page's own scripts are never carried along or run: the shim is Nagma's, written for the
// pattern it recognises (switch tabs, scroll a carousel, open a panel, show a dialog, filter
// suggestions, flip a toggle, count). A part whose behaviour it doesn't recognise stays layers.

import type { CaptureLive } from "../../web/src/engine/capture-format";
import { compounds, readableSheets, splitSelectors, type ExtraSheet } from "./states";

export interface LivePart {
    root: Element;
    patterns: string[];
}

const MAX_PARTS = 12;
const MAX_SOURCE = 1_500_000;

// ---- Finding them ----

const byId = (id: string | null | undefined) => (id ? document.getElementById(id) : null);

function shown(el: Element | null): el is Element {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

// The nearest element holding all of them.
function common(els: Element[]): Element | null {
    const [first, ...rest] = els;
    if (!first) return null;
    let cur: Element | null = first;
    while (cur && !rest.every((e) => cur?.contains(e))) cur = cur.parentElement;
    return cur;
}

// A root wide enough to hold a part but not the page: none when it's most of it.
function fits(el: Element | null): el is Element {
    if (!el || el === document.body || el === document.documentElement) return false;
    const r = el.getBoundingClientRect();
    const page = document.documentElement.scrollHeight * document.documentElement.clientWidth;
    return r.width > 0 && r.height > 0 && r.width * r.height < page * 0.6;
}

const PREV = /\b(prev|previous|back|left)\b|‹|←|«|❮/i;
const NEXT = /\b(next|forward|right)\b|›|→|»|❯/i;

function label(el: Element): string {
    return `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${el.className && typeof el.className === "string" ? el.className : ""} ${el.textContent?.trim().slice(0, 12) ?? ""}`;
}

function dialogTriggers(dialog: Element): Element[] {
    const id = dialog.id;
    if (!id) return [];
    const esc = CSS.escape(id);
    const sel = [`[aria-controls="${esc}"]`, `[data-target="#${esc}"]`, `[data-bs-target="#${esc}"]`, `[data-dialog="${esc}"]`, `[data-open="${esc}"]`, `[data-modal="${esc}"]`, `[popovertarget="${esc}"]`, `[commandfor="${esc}"]`, `a[href="#${esc}"]`].join(",");
    const found = Array.from(document.querySelectorAll(sel));
    // Inline handlers naming the dialog ("document.getElementById('signup').showModal()").
    for (const el of Array.from(document.querySelectorAll("[onclick]"))) if ((el.getAttribute("onclick") ?? "").includes(id)) found.push(el);
    return found.filter((t) => t !== dialog && !dialog.contains(t));
}

// The parts the shim can keep working, outermost where they nest.
export function findLiveParts(): LivePart[] {
    const found: LivePart[] = [];
    const add = (root: Element | null, pattern: string) => {
        if (!fits(root)) return;
        const known = found.find((p) => p.root === root);
        if (known) {
            if (!known.patterns.includes(pattern)) known.patterns.push(pattern);
            return;
        }
        found.push({ root, patterns: [pattern] });
    };
    // Tabs: a tab list and the panels its tabs control.
    for (const list of Array.from(document.querySelectorAll('[role="tablist"]'))) {
        if (!shown(list)) continue;
        const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
        const panels = tabs.map((t) => byId(t.getAttribute("aria-controls"))).filter((p): p is HTMLElement => Boolean(p));
        if (tabs.length < 2) continue;
        add(common([list, ...panels]), "tabs");
    }
    // Carousels: a row that scrolls sideways (snapping, or with buttons to move it).
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
        if (!(el instanceof HTMLElement) || !shown(el)) continue;
        const cs = getComputedStyle(el);
        if (!/auto|scroll/.test(cs.overflowX) || el.scrollWidth <= el.clientWidth + 8) continue;
        const parent = el.parentElement;
        const buttons = parent ? Array.from(parent.querySelectorAll("button, [role=button], a")).filter((b) => !el.contains(b) && (PREV.test(label(b)) || NEXT.test(label(b)))) : [];
        if (!/x|both|inline/.test(cs.scrollSnapType) && !buttons.length) continue;
        add(buttons.length ? common([el, ...buttons]) : el, "carousel");
    }
    // Accordions: <details>, and buttons that expand the region they control.
    const groups = new Map<Element, Element[]>();
    for (const d of Array.from(document.querySelectorAll("details"))) {
        if (!shown(d) || !d.parentElement) continue;
        groups.set(d.parentElement, [...(groups.get(d.parentElement) ?? []), d]);
    }
    for (const [parent, items] of groups) add(items.length > 1 ? parent : items[0] ?? null, "accordion");
    for (const b of Array.from(document.querySelectorAll("[aria-expanded][aria-controls]"))) {
        if (!shown(b) || b.closest('[role="tablist"]') || /dialog|menu|listbox/.test(b.getAttribute("aria-haspopup") ?? "") || b.getAttribute("role") === "combobox") continue;
        const target = byId(b.getAttribute("aria-controls"));
        if (!target || target.tagName.toLowerCase() === "dialog") continue;
        // A dropdown (its panel laid over the page, outside the trigger's box) can't open inside a
        // frame the trigger's size: it stays layers.
        if (/absolute|fixed/.test(getComputedStyle(target).position)) continue;
        // A button inside what it controls ("See all" on a list) changes it in ways only the
        // page's script knows: layers.
        if (target.contains(b)) continue;
        // The whole group of them when there are several side by side.
        const group = b.parentElement?.parentElement;
        const siblings = group ? Array.from(group.querySelectorAll("[aria-expanded][aria-controls]")) : [];
        add(siblings.length > 1 ? common([group as Element, target]) : common([b, target]), "accordion");
    }
    // Dialogs: a <dialog> (or role=dialog, or a popover) and what opens it.
    for (const d of Array.from(document.querySelectorAll('dialog, [role="dialog"], [role="alertdialog"], [popover]'))) {
        const triggers = dialogTriggers(d).filter(shown);
        if (!triggers.length) continue;
        add(common([d, ...triggers]), "dialog");
    }
    // Inputs with suggestions: a datalist, or a combobox and the list box it controls.
    for (const input of Array.from(document.querySelectorAll("input[list]"))) {
        const list = byId(input.getAttribute("list"));
        if (!shown(input) || !list) continue;
        add(input.closest("label, form, [role=search], fieldset") ?? input.parentElement, "autocomplete");
    }
    for (const box of Array.from(document.querySelectorAll('[role="combobox"], input[aria-autocomplete]'))) {
        const input = box.matches("input") ? box : box.querySelector("input");
        const list = byId(box.getAttribute("aria-controls") ?? box.getAttribute("aria-owns") ?? input?.getAttribute("aria-controls"));
        if (!input || !shown(input) || !list) continue;
        add(common([input, list]), "autocomplete");
    }
    // Toggles and counters.
    for (const t of Array.from(document.querySelectorAll('[aria-pressed], [role="switch"]'))) if (shown(t)) add(t.parentElement?.children.length && t.parentElement.children.length <= 4 ? t.parentElement : t, "toggle");
    for (const b of Array.from(document.querySelectorAll('button, [role="button"]'))) {
        if (!shown(b)) continue;
        const text = `${b.textContent?.trim() ?? ""} ${b.getAttribute("aria-label") ?? ""}`;
        if (!/^[+−-]\s|\b(increase|increment|decrease|decrement|plus|minus|add one|remove one)\b/i.test(`${text} `)) continue;
        const group = b.parentElement;
        if (group && Array.from(group.querySelectorAll("output, input[type=number], [aria-live], span, div")).some((v) => /^-?\d+$/.test((v as HTMLInputElement).value ?? v.textContent?.trim() ?? ""))) add(group, "counter");
    }
    // Elements the devtools protocol found script listeners on: a header that shows the panel after it.
    for (const el of Array.from(document.querySelectorAll("[data-nagma-listens]"))) {
        const next = el.nextElementSibling;
        if (next && (next.hasAttribute("hidden") || getComputedStyle(next).display === "none")) add(el.parentElement, "accordion");
    }
    // Outermost only: one inside another is part of it.
    const outer = found.filter((p) => !found.some((q) => q !== p && q.root.contains(p.root)));
    for (const p of outer) for (const q of found) if (q !== p && p.root.contains(q.root)) for (const pat of q.patterns) if (!p.patterns.includes(pat)) p.patterns.push(pat);
    return outer.slice(0, MAX_PARTS);
}

// For the devtools protocol: number the elements worth asking about their listeners.
export function listenerCandidates(): number {
    const els = Array.from(document.querySelectorAll("button, [role=button], [tabindex], summary, li, h2, h3, h4, div[class], span[class]")).filter((el) => shown(el) && getComputedStyle(el).cursor === "pointer").slice(0, 300);
    els.forEach((el, i) => el.setAttribute("data-nagma-candidate", String(i)));
    return els.length;
}

export function markListener(i: number) {
    document.querySelector(`[data-nagma-candidate="${i}"]`)?.setAttribute("data-nagma-listens", "");
}

export function clearListenerMarks() {
    for (const el of Array.from(document.querySelectorAll("[data-nagma-candidate], [data-nagma-listens]"))) {
        el.removeAttribute("data-nagma-candidate");
        el.removeAttribute("data-nagma-listens");
    }
}

// ---- The CSS that applies ----

// Attributes and classes a page uses for states: left out of a selector when deciding whether a rule
// is about the part, so the rules for its other states (the other tab selected, the panel open)
// come along too.
const STATE_ATTR = /\[(aria-(selected|expanded|hidden|current|pressed|checked|disabled)|open|hidden|data-state|data-active|data-open|data-selected|data-headlessui-state)(?:[~|^$*]?=[^\]]*)?\]/gi;
const STATE_CLASS = /\.(active|is-[\w-]+|has-[\w-]+|open|opened|selected|current|show|shown|visible|expanded|collapsed|hidden|in|on|off|closed|checked|disabled|focus|focused)(?![\w-])/gi;
const PSEUDO_CLASS = /:(hover|focus-visible|focus-within|focus|active|visited|checked|disabled|enabled|placeholder-shown|target|open|popover-open|modal|empty|valid|invalid|indeterminate|default|required|optional|read-only|read-write|autofill)(?![\w-])/g;
const PSEUDO_ELEMENT = /::?(before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)(?![\w-])/g;

// Each compound loosened on its own (one left with nothing becomes "*"), the combinators kept.
export function looseSelector(sel: string): string {
    return compounds(sel)
        .map((part) => {
            if (/^[>+~ ]$/.test(part)) return part === " " ? " " : ` ${part} `;
            const loose = part.replace(PSEUDO_ELEMENT, "").replace(PSEUDO_CLASS, "").replace(STATE_ATTR, "").replace(STATE_CLASS, "").trim();
            return loose || "*";
        })
        .join("")
        .trim();
}

function aboutPart(root: Element, selectorText: string): boolean {
    for (const sel of splitSelectors(selectorText)) {
        const loose = looseSelector(sel);
        if (!loose) continue;
        try {
            if (root.matches(loose) || root.querySelector(loose)) return true;
        } catch {
            // A selector this browser won't match with: left out.
        }
    }
    return false;
}

// Absolute addresses in url(), so the service worker can read them (and the frame gets data).
function absoluteUrls(css: string, base: string): string {
    return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, _q: string, url: string) => {
        if (/^(data|blob):/.test(url) || url.startsWith("#")) return m;
        try {
            return `url("${new URL(url, base).href}")`;
        } catch {
            return m;
        }
    });
}

function familiesIn(root: Element): Set<string> {
    const out = new Set<string>();
    for (const el of [root, ...Array.from(root.querySelectorAll("*"))].slice(0, 400)) {
        for (const f of getComputedStyle(el).fontFamily.split(",")) out.add(f.trim().replace(/^["']|["']$/g, "").toLowerCase());
    }
    return out;
}

function partCss(root: Element, sheets: ExtraSheet[]): { css: string; vars: Set<string> } {
    const out: string[] = [];
    const families = familiesIn(root);
    const visit = (list: CSSRuleList, base: string) => {
        for (const rule of Array.from(list)) {
            if (rule instanceof CSSStyleRule) {
                if (rule.selectorText && aboutPart(root, rule.selectorText)) out.push(absoluteUrls(rule.cssText, base));
            } else if (rule instanceof CSSMediaRule) {
                // The page's width decides, as it did when captured: the frame is narrower.
                if (window.matchMedia(rule.media.mediaText).matches) visit(rule.cssRules, base);
            } else if (typeof CSSSupportsRule !== "undefined" && rule instanceof CSSSupportsRule) {
                if (CSS.supports(rule.conditionText)) visit(rule.cssRules, base);
            } else if (rule instanceof CSSKeyframesRule) {
                out.push(rule.cssText);
            } else if (rule instanceof CSSFontFaceRule) {
                const family = rule.style.getPropertyValue("font-family").trim().replace(/^["']|["']$/g, "").toLowerCase();
                if (families.has(family)) out.push(absoluteUrls(rule.cssText, base));
            } else if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) visit((rule as CSSGroupingRule).cssRules, base);
        }
    };
    for (const { sheet, href } of readableSheets(sheets)) {
        try {
            visit(sheet.cssRules, href);
        } catch {
            // Unreadable after all.
        }
    }
    const css = out.join("\n");
    const vars = new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1] as string));
    return { css, vars };
}

// ---- The markup ----

const INHERITED = ["font-family", "font-size", "font-weight", "font-style", "font-variant", "line-height", "color", "letter-spacing", "word-spacing", "text-align", "text-transform", "text-indent", "white-space", "direction", "cursor", "-webkit-font-smoothing", "font-feature-settings", "font-variation-settings"];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// The part's markup with the page's scripts taken out and its live state (typed values, open
// dialogs) written in, and pictures at absolute addresses.
function cleanCopy(root: Element): Element {
    const copy = root.cloneNode(true) as Element;
    const src = [root, ...Array.from(root.querySelectorAll("*"))];
    const dst = [copy, ...Array.from(copy.querySelectorAll("*"))];
    src.forEach((from, i) => {
        const to = dst[i];
        if (!to) return;
        if (from instanceof HTMLInputElement) {
            if (from.type === "checkbox" || from.type === "radio") to.toggleAttribute("checked", from.checked);
            else if (from.type !== "password" && from.type !== "file") to.setAttribute("value", from.value);
        } else if (from instanceof HTMLTextAreaElement) to.textContent = from.value;
        else if (from instanceof HTMLSelectElement) Array.from((to as HTMLSelectElement).options).forEach((o, k) => o.toggleAttribute("selected", from.options[k]?.selected ?? false));
        else if (from instanceof HTMLImageElement) {
            to.setAttribute("src", from.currentSrc || from.src);
            to.removeAttribute("srcset");
            to.removeAttribute("sizes");
            to.removeAttribute("loading");
        } else if (from instanceof HTMLVideoElement && from.poster) to.setAttribute("poster", from.poster);
        const inline = to.getAttribute("style");
        if (inline?.includes("url(")) to.setAttribute("style", absoluteUrls(inline, document.baseURI));
        for (const attr of Array.from(to.attributes)) {
            if (/^on/i.test(attr.name) || /^data-nagma-/.test(attr.name)) to.removeAttribute(attr.name);
            else if ((attr.name === "href" || attr.name === "src" || attr.name === "action" || attr.name === "formaction") && /^\s*javascript:/i.test(attr.value)) to.removeAttribute(attr.name);
        }
    });
    for (const s of Array.from(copy.querySelectorAll("script, iframe, object, embed, noscript, link, meta, base"))) s.remove();
    for (const p of Array.from(copy.querySelectorAll("picture source"))) p.remove();
    for (const el of Array.from(copy.querySelectorAll("source[src]"))) {
        try {
            el.setAttribute("src", new URL(el.getAttribute("src") as string, document.baseURI).href);
        } catch {
            el.remove();
        }
    }
    return copy;
}

// The element's ancestors as wrappers that take no room (display: contents), so selectors that
// name them ("main .tabs .tab") still match, the root's own place inside them kept.
function wrapped(root: Element, inner: string): string {
    const chain: Element[] = [];
    for (let up = root.parentElement; up && up !== document.body; up = up.parentElement) chain.unshift(up);
    let html = inner;
    for (const el of chain.reverse()) {
        const tag = el.tagName.toLowerCase();
        const attrs = Array.from(el.attributes)
            .filter((a) => !/^on/i.test(a.name) && a.name !== "style" && !/^data-nagma-/.test(a.name))
            .map((a) => ` ${a.name}="${esc(a.value)}"`)
            .join("");
        html = `<${tag}${attrs} style="display:contents">${html}</${tag}>`;
    }
    return html;
}

// What's painted behind the part on the page (its first ancestor with a background colour).
function backdrop(root: Element): string {
    for (let el: Element | null = root; el; el = el.parentElement) {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
    }
    return "rgb(255, 255, 255)";
}

export function serializePart(part: LivePart, sheets: ExtraSheet[]): CaptureLive | null {
    const { root } = part;
    const rect = root.getBoundingClientRect();
    const cs = getComputedStyle(root);
    const { css, vars } = partCss(root, sheets);
    const rootVars = getComputedStyle(root);
    const varDecls = [...vars].map((v) => `${v}:${rootVars.getPropertyValue(v).trim() || "initial"}`).join(";");
    const inherited = INHERITED.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";");
    const copy = cleanCopy(root);
    copy.setAttribute("data-nl-root", "");
    const html = wrapped(root, copy.outerHTML);
    const htmlEl = document.documentElement;
    const body = document.body;
    const base = [
        // The part fills the frame's width, from its top; what it opens scrolls inside the frame.
        `html,body{background:${backdrop(root)};overflow:auto!important}`,
        `[hidden]{display:none!important}`,
        `[data-nl-root]{${inherited};${varDecls ? `${varDecls};` : ""}margin:0!important;width:${Math.round(rect.width)}px!important;max-width:none!important;box-sizing:border-box;position:relative!important;inset:auto!important;transform:none!important}`,
    ].join("\n");
    const js = shimScript({ html: htmlEl.className, body: body.className, htmlAttrs: attrsOf(htmlEl), bodyAttrs: attrsOf(body), patterns: part.patterns });
    const source = { html, css: `${base}\n${css}`, js, pattern: part.patterns.join(" ") };
    if (source.html.length + source.css.length > MAX_SOURCE) return null;
    return source;
}

function attrsOf(el: Element): Record<string, string> {
    const out: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) if (/^(data-|lang$|dir$)/.test(a.name) && !/^data-nagma-/.test(a.name)) out[a.name] = a.value;
    return out;
}

// ---- The behaviour shim (runs in the Live frame's sandbox) ----

function shimScript(context: { html: string; body: string; htmlAttrs: Record<string, string>; bodyAttrs: Record<string, string>; patterns: string[] }): string {
    return `// Nagma Capture's behaviour for this part (${context.patterns.join(", ")}): written for the pattern, not the page's own script.
(${SHIM.toString()})(${JSON.stringify(context).replace(/</g, "\\u003c")});`;
}

// Kept as a function so it type-checks; sent as its source text. Everything it needs is inside it.
function SHIM(context: { html: string; body: string; htmlAttrs: Record<string, string>; bodyAttrs: Record<string, string> }) {
    const doc = document;
    if (context.html) doc.documentElement.className += ` ${context.html}`;
    if (context.body) doc.body.className += ` ${context.body}`;
    for (const [k, v] of Object.entries(context.htmlAttrs)) doc.documentElement.setAttribute(k, v);
    for (const [k, v] of Object.entries(context.bodyAttrs)) doc.body.setAttribute(k, v);
    const all = (sel: string, root: ParentNode = doc) => Array.from(root.querySelectorAll(sel)) as HTMLElement[];
    const byId = (id: string | null) => (id ? doc.getElementById(id) : null);
    const isShown = (el: Element) => !(el as HTMLElement).hidden && getComputedStyle(el).display !== "none";
    // Classes one member of a group has and the others don't (the page's "selected" look).
    const onClasses = (on: Element | undefined, group: Element[]) => (on ? Array.from(on.classList).filter((c) => group.every((g) => g === on || !g.classList.contains(c))) : []);
    // The page's own class for "open", when one of the usual ones on the element or its parent
    // shows it with the page's CSS (its own display: grid, flex…); kept to take off again.
    const OPEN = ["open", "is-open", "active", "is-active", "show", "shown", "visible", "expanded", "in"];
    const opened = new WeakMap<HTMLElement, { host: Element; name: string }>();
    const reveal = (el: HTMLElement) => {
        for (const host of [el, el.parentElement].filter(Boolean) as Element[]) {
            for (const name of OPEN) {
                if (host.classList.contains(name)) continue;
                host.classList.add(name);
                if (getComputedStyle(el).display !== "none") {
                    opened.set(el, { host, name });
                    return true;
                }
                host.classList.remove(name);
            }
        }
        return false;
    };
    const show = (el: HTMLElement, on: boolean, classes: string[] = []) => {
        el.hidden = !on;
        classes.forEach((c) => el.classList.toggle(c, on));
        el.style.removeProperty("display");
        const mark = opened.get(el);
        if (!on && mark) {
            mark.host.classList.remove(mark.name);
            opened.delete(el);
        }
        if (on && getComputedStyle(el).display === "none" && !reveal(el)) el.style.display = "block";
        if (!on && getComputedStyle(el).display !== "none") el.style.display = "none";
    };
    // Links don't leave the frame (it has no network).
    doc.addEventListener(
        "click",
        (e) => {
            const a = (e.target as Element).closest?.("a[href]");
            if (a && !(a.getAttribute("href") ?? "").startsWith("#")) e.preventDefault();
        },
        true,
    );
    doc.addEventListener("submit", (e) => e.preventDefault(), true);

    // Tabs.
    for (const list of all('[role="tablist"]')) {
        const tabs = all('[role="tab"]', list);
        let panels = tabs.map((t) => byId(t.getAttribute("aria-controls"))).filter(Boolean) as HTMLElement[];
        if (panels.length !== tabs.length) panels = all('[role="tabpanel"]').slice(0, tabs.length);
        const selected = tabs.find((t) => t.getAttribute("aria-selected") === "true") ?? tabs[0];
        const tabOn = onClasses(selected, tabs);
        const panelOn = onClasses(panels.find(isShown), panels);
        const select = (tab: HTMLElement) => {
            tabs.forEach((t, i) => {
                const on = t === tab;
                t.setAttribute("aria-selected", String(on));
                t.tabIndex = on ? 0 : -1;
                tabOn.forEach((c) => t.classList.toggle(c, on));
                const p = panels[i];
                if (p) show(p, on, panelOn);
            });
        };
        tabs.forEach((t, i) => {
            t.addEventListener("click", (e) => {
                e.preventDefault();
                select(t);
            });
            t.addEventListener("keydown", (e) => {
                const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                if (!step) return;
                const next = tabs[(i + step + tabs.length) % tabs.length] as HTMLElement;
                select(next);
                next.focus();
                e.preventDefault();
            });
        });
    }

    // Accordions: buttons that expand what they control (<details> opens by itself).
    const toggles = all("[aria-expanded][aria-controls]").filter((b) => !b.closest('[role="tablist"]') && b.getAttribute("role") !== "combobox" && !/dialog|listbox/.test(b.getAttribute("aria-haspopup") ?? ""));
    const openOn = onClasses(
        toggles.find((b) => b.getAttribute("aria-expanded") === "true"),
        toggles,
    );
    for (const b of toggles) {
        const target = byId(b.getAttribute("aria-controls"));
        if (!target) continue;
        b.addEventListener("click", (e) => {
            e.preventDefault();
            const open = b.getAttribute("aria-expanded") !== "true";
            b.setAttribute("aria-expanded", String(open));
            openOn.forEach((c) => b.classList.toggle(c, open));
            show(target, open);
        });
    }
    // A header that shows the panel right after it (found by its listener).
    for (const h of all("[data-nl-disclosure]")) {
        const panel = h.nextElementSibling as HTMLElement | null;
        if (panel) h.addEventListener("click", () => show(panel, !isShown(panel)));
    }

    // Carousels: sideways rows, moved a page at a time by the buttons beside them.
    const PREV = /\b(prev|previous|back|left)\b|‹|←|«|❮/i;
    const NEXT = /\b(next|forward|right)\b|›|→|»|❯/i;
    const labelOf = (el: Element) => `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${typeof el.className === "string" ? el.className : ""} ${el.textContent?.trim().slice(0, 12) ?? ""}`;
    for (const row of all("*").filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 8)) {
        // Up to the row's parent's parent: the buttons often sit in a header beside the row.
        const scope = row.parentElement?.parentElement ?? row.parentElement ?? doc.body;
        // One item at a time (the distance between the first two), else most of a page.
        const items = Array.from(row.children) as HTMLElement[];
        const step = items.length > 1 ? Math.abs((items[1] as HTMLElement).offsetLeft - (items[0] as HTMLElement).offsetLeft) : 0;
        for (const b of all("button, [role=button], a", scope).filter((b) => !row.contains(b))) {
            const dir = NEXT.test(labelOf(b)) ? 1 : PREV.test(labelOf(b)) ? -1 : 0;
            if (!dir) continue;
            b.addEventListener("click", (e) => {
                e.preventDefault();
                row.scrollBy({ left: dir * (step > 0 && step < row.clientWidth ? step : row.clientWidth * 0.9), behavior: "smooth" });
            });
        }
        // Dots: "slide 3", "go to 3".
        all("button, [role=tab]", scope)
            .filter((b) => !row.contains(b) && /\b(slide|go to|page)\s*\d+/i.test(labelOf(b)))
            .forEach((b) => {
                const n = parseInt(/(\d+)/.exec(labelOf(b))?.[1] ?? "1", 10) - 1;
                b.addEventListener("click", (e) => {
                    e.preventDefault();
                    const item = row.children[n] as HTMLElement | undefined;
                    if (item) row.scrollTo({ left: item.offsetLeft - row.offsetLeft, behavior: "smooth" });
                });
            });
    }

    // Dialogs and what opens them; close buttons inside.
    for (const d of all('dialog, [role="dialog"], [role="alertdialog"]')) {
        const id = d.id;
        if (!id) continue;
        const sel = ["aria-controls", "data-target", "data-bs-target", "data-dialog", "data-open", "data-modal", "commandfor"].map((a) => `[${a}="${id}"],[${a}="#${id}"]`).join(",") + `,a[href="#${id}"]`;
        const native = d instanceof HTMLDialogElement;
        const open = () => {
            if (native) {
                if (!(d as HTMLDialogElement).open) (d as HTMLDialogElement).showModal();
            } else show(d, true);
        };
        const close = () => (native ? (d as HTMLDialogElement).close() : show(d, false));
        const triggers = [...all(sel), ...all("[data-nl-opens]").filter((t) => t.getAttribute("data-nl-opens") === id)];
        triggers.forEach((t) =>
            t.addEventListener("click", (e) => {
                e.preventDefault();
                open();
            }),
        );
        all('[data-close], [data-dismiss], [data-bs-dismiss], [aria-label*="close" i], [aria-label*="dismiss" i], .close, .btn-close, button[value="cancel"], button[formmethod="dialog"]', d).forEach((b) =>
            b.addEventListener("click", (e) => {
                e.preventDefault();
                close();
            }),
        );
        if (native) d.addEventListener("click", (e) => e.target === d && close());
    }

    // Suggestions: a combobox filters its list box as you type (a datalist does this itself).
    for (const box of all('[role="combobox"], input[aria-autocomplete]')) {
        const input = (box.matches("input") ? box : box.querySelector("input")) as HTMLInputElement | null;
        const list = byId(box.getAttribute("aria-controls") ?? box.getAttribute("aria-owns") ?? input?.getAttribute("aria-controls") ?? null);
        if (!input || !list) continue;
        const options = all('[role="option"]', list);
        const update = () => {
            const q = input.value.trim().toLowerCase();
            let any = false;
            for (const o of options) {
                const hit = !q || (o.textContent ?? "").toLowerCase().includes(q);
                o.hidden = !hit;
                any ||= hit;
            }
            const openList = Boolean(q) && any;
            show(list, openList);
            box.setAttribute("aria-expanded", String(openList));
        };
        input.addEventListener("input", update);
        input.addEventListener("focus", () => input.value && update());
        options.forEach((o) =>
            o.addEventListener("mousedown", (e) => {
                e.preventDefault();
                input.value = (o.textContent ?? "").trim();
                show(list, false);
                box.setAttribute("aria-expanded", "false");
            }),
        );
        input.addEventListener("keydown", (e) => {
            const visible = options.filter((o) => !o.hidden);
            const at = visible.findIndex((o) => o.getAttribute("aria-selected") === "true");
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const next = visible[(at + (e.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length];
                options.forEach((o) => o.setAttribute("aria-selected", String(o === next)));
            } else if (e.key === "Enter" && at >= 0) {
                e.preventDefault();
                input.value = (visible[at]?.textContent ?? "").trim();
                show(list, false);
            } else if (e.key === "Escape") show(list, false);
        });
        doc.addEventListener("pointerdown", (e) => {
            if (!box.contains(e.target as Node) && !list.contains(e.target as Node)) show(list, false);
        });
    }

    // Toggles.
    for (const t of all("[aria-pressed]")) t.addEventListener("click", () => t.setAttribute("aria-pressed", String(t.getAttribute("aria-pressed") !== "true")));
    for (const t of all('[role="switch"]')) t.addEventListener("click", () => t.setAttribute("aria-checked", String(t.getAttribute("aria-checked") !== "true")));

    // Counters: + and − beside a number.
    for (const b of all('button, [role="button"]')) {
        const text = `${b.textContent?.trim() ?? ""} ${b.getAttribute("aria-label") ?? ""} `;
        const dir = /^\+\s|\b(increase|increment|plus|add one)\b/i.test(text) ? 1 : /^[−-]\s|\b(decrease|decrement|minus|remove one)\b/i.test(text) ? -1 : 0;
        if (!dir || !b.parentElement) continue;
        const value = all("output, input[type=number], [aria-live], span, div", b.parentElement).find((v) => /^-?\d+$/.test(((v as HTMLInputElement).value ?? v.textContent ?? "").trim()));
        if (!value) continue;
        b.addEventListener("click", (e) => {
            e.preventDefault();
            if (value instanceof HTMLInputElement) {
                if (dir > 0) value.stepUp();
                else value.stepDown();
            } else value.textContent = String(parseInt(value.textContent ?? "0", 10) + dir);
        });
    }
}

// Marks found by the devtools protocol, read by the shim: headers that show the next panel.
export function markDisclosures(root: Element) {
    for (const el of Array.from(root.querySelectorAll("[data-nagma-listens]"))) {
        const next = el.nextElementSibling;
        if (next && (next.hasAttribute("hidden") || getComputedStyle(next).display === "none")) el.setAttribute("data-nl-disclosure", "");
    }
}

// Every part, ready for the walk: element → its Live frame source.
export function captureLiveParts(sheets: ExtraSheet[]): Map<Element, CaptureLive> {
    const out = new Map<Element, CaptureLive>();
    for (const part of findLiveParts()) {
        markDisclosures(part.root);
        try {
            const live = serializePart(part, sheets);
            if (live) out.set(part.root, live);
        } finally {
            for (const el of Array.from(part.root.querySelectorAll("[data-nl-disclosure]"))) el.removeAttribute("data-nl-disclosure");
        }
    }
    return out;
}
