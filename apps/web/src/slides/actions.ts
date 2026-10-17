import { nanoid } from "nanoid";
import { applyCommand } from "../engine/commands";
import { download, buildPdf, safeName, zipFiles } from "../engine/export";
import { renderNodesToPng } from "../canvas/render";
import { inlineImages } from "../engine/image-store";
import { editor } from "../engine/store";
import { readImage } from "../engine/images";
import type { Command, Paint, SceneNode } from "../engine/types";
import { LAYOUTS, type SlideGroup, placeholderImageCommands, addSlideCommands, arrangeCommands, deckBatch, deckOf, deckPage, duplicateSlideCommands, editTemplateCommands, layoutLayers, newGroup, remixTheme, slideIds, slideOf, slidesBySection, templateColors, templateCommands, templatesOf, themeCommands, themeOf } from "./model";
import { currentSlide, goToSlide, selectedSlides, slides } from "./state";
import type { DeckTheme, NumberFormat, ObjectAnimation, SlideLayout, SlideTransition } from "./types";
import type { SlideInfo } from "./model";

// Edits to the deck, each one undo step, with slides kept in rows and numbered.

function run(commands: Command[]) {
    const s = editor.get();
    if (s.readOnly || !commands.length) return;
    editor.execute(deckBatch(s.doc, commands));
}

// A new slide after `after` in the deck's main template, or in the template given (its layouts
// can come from any template; the template joins the deck).
export function addSlide(layout: SlideLayout, after: string | null = currentSlide(), theme?: DeckTheme, join = false, before = false) {
    const s = editor.get();
    if (s.readOnly) return;
    const deck = deckOf(s.doc);
    let doc = s.doc;
    const extra: Command[] = [];
    const page = deckPage(doc);
    if (theme && page && theme.id !== deck.theme.id) {
        const themes = [...(deck.themes ?? []).filter((t) => t.id !== theme.id), (deck.themes ?? []).find((t) => t.id === theme.id) ?? theme];
        extra.push({ type: "node.update", id: page.id, patch: { deck: { ...deck, themes } } });
        doc = applyCommand(doc, extra[0] as Command);
    }
    const look = theme ? (templatesOf(doc).find((t) => t.id === theme.id) ?? theme) : undefined;
    const made = addSlideCommands(doc, layout, after, look, join, before);
    const commands = [...extra, ...made.commands];
    const id = made.id;
    run(commands);
    goToSlide(id);
}

export function duplicateSlide(id: string) {
    const made = duplicateSlideCommands(editor.get().doc, id);
    if (!made) return;
    run(made.commands);
    goToSlide(made.id);
}

// Duplicates each slide, the copy right after its original.
export function duplicateSlides(ids: string[]) {
    let doc = editor.get().doc;
    const commands: Command[] = [];
    const made: string[] = [];
    for (const id of ids) {
        const copy = duplicateSlideCommands(doc, id);
        if (!copy) continue;
        doc = applyCommand(doc, { type: "batch", commands: copy.commands });
        commands.push(...copy.commands);
        made.push(copy.id);
    }
    run(commands);
    const last = made[made.length - 1];
    if (last) {
        goToSlide(last);
        if (made.length > 1) slides.set({ picked: made });
    }
}

// Skips the slides, or shows them again when they are all skipped already.
export function toggleSkipSlides(ids: string[]) {
    const doc = editor.get().doc;
    const skip = !ids.every((id) => slideOf(doc.nodes[id])?.skip);
    const commands: Command[] = [];
    for (const id of ids) {
        const info = slideOf(doc.nodes[id]);
        if (info && Boolean(info.skip) !== skip) commands.push({ type: "node.update", id, patch: { deck: { ...info, skip } } });
    }
    run(commands);
}

// The deck's groups, to rearrange and write back with `arrange`.
function groupsOf(doc = editor.get().doc): SlideGroup[] {
    return slidesBySection(doc).map((g) => ({ section: g.section, ids: [...g.ids] }));
}

// Lays the slides out in these groups; nothing (and no undo step) when the rows come out as they
// are (a slide dropped where it was got a new group id, an empty step).
function arrange(groups: SlideGroup[]) {
    const now = groupsOf().filter((g) => g.ids.length).map((g) => g.ids.join(","));
    const next = groups.filter((g) => g.ids.length).map((g) => g.ids.join(","));
    if (now.length === next.length && now.every((row, i) => row === next[i])) return;
    run(arrangeCommands(editor.get().doc, groups));
}

// ⌘[ and ⌘]: a slide in a group moves within it, stepping out of the group at its edge; a slide
// on its own trades places with the group or slide before (after) it.
export function nudgeSlides(by: -1 | 1, ids: string[] = selectedSlides()) {
    const groups = groupsOf();
    let changed = false;
    // A group whose slides are all picked moves as one, past the next row (before, its last slide
    // stepped out of it and the rest stayed put: nothing moved).
    const picked = new Set(ids);
    const whole = new Set(groups.filter((g) => g.ids.length > 1 && g.ids.every((s) => picked.has(s))));
    for (const group of by < 0 ? [...whole] : [...whole].reverse()) {
        const gi = groups.indexOf(group);
        const other = gi + by;
        if (other < 0 || other >= groups.length || groups[other]?.ids.some((s) => picked.has(s))) continue;
        groups[gi] = groups[other] as SlideGroup;
        groups[other] = group;
        changed = true;
    }
    const order = (by < 0 ? ids : [...ids].reverse()).filter((id) => ![...whole].some((g) => g.ids.includes(id)));
    for (const id of order) {
        const gi = groups.findIndex((g) => g.ids.includes(id));
        const group = groups[gi];
        if (!group) continue;
        const i = group.ids.indexOf(id);
        if (group.ids.length > 1) {
            const j = i + by;
            if (j >= 0 && j < group.ids.length) {
                if (ids.includes(group.ids[j] as string)) continue;
                group.ids[i] = group.ids[j] as string;
                group.ids[j] = id;
            } else {
                // Out of the group's edge: a row of its own just before (after) the group.
                group.ids.splice(i, 1);
                groups.splice(by < 0 ? gi : gi + 1, 0, { section: newGroup(), ids: [id] });
            }
            changed = true;
            continue;
        }
        const other = gi + by;
        if (other < 0 || other >= groups.length || groups[other]?.ids.some((s) => ids.includes(s))) continue;
        groups[gi] = groups[other] as SlideGroup;
        groups[other] = group;
        changed = true;
    }
    if (changed) arrange(groups);
}

// Dropping dragged slides between two others in the list: `before` is the slide they land in
// front of (null: the end). Indented (dragged to the right), or between two slides of one group,
// they join the group of the slide above; otherwise each becomes a row of its own.
export function dropSlides(ids: string[], before: string | null, indent: boolean) {
    const moving = new Set(ids);
    const all = slideIds(editor.get().doc);
    // Dropped on one of the dragged slides: it lands before the next slide that stays.
    const target = before ? (all.slice(all.indexOf(before)).find((s) => !moving.has(s)) ?? null) : null;
    const flatBefore = all.filter((s) => !moving.has(s));
    const at = target ? flatBefore.indexOf(target) : flatBefore.length;
    const groups = groupsOf().map((g) => ({ ...g, ids: g.ids.filter((s) => !moving.has(s)) }));
    const above = flatBefore[at - 1];
    const below = flatBefore[at];
    const aboveGroup = groups.find((g) => above !== undefined && g.ids.includes(above));
    const join = aboveGroup && above !== undefined && (indent || (below !== undefined && aboveGroup.ids.includes(below)));
    if (join && aboveGroup && above !== undefined) aboveGroup.ids.splice(aboveGroup.ids.indexOf(above) + 1, 0, ...ids);
    else {
        const index = aboveGroup ? groups.indexOf(aboveGroup) + 1 : 0;
        groups.splice(index, 0, ...ids.map((id) => ({ section: newGroup(), ids: [id] })));
    }
    arrange(groups);
}

// Dragging a group by its handle: it lands in front of the group holding `before` (the end when
// null), or, dropped indented under a slide, joins that slide's group.
export function dropGroup(section: string, before: string | null, indent: boolean) {
    const groups = groupsOf();
    const moving = groups.find((g) => g.section.id === section);
    if (!moving || (before && moving.ids.includes(before))) return;
    const rest = groups.filter((g) => g !== moving);
    const flat = rest.flatMap((g) => g.ids);
    const at = before ? flat.indexOf(before) : flat.length;
    const above = flat[at - 1];
    const aboveGroup = rest.find((g) => above !== undefined && g.ids.includes(above));
    if (indent && aboveGroup && above !== undefined) aboveGroup.ids.splice(aboveGroup.ids.indexOf(above) + 1, 0, ...moving.ids);
    else {
        const target = before ? rest.findIndex((g) => g.ids.includes(before)) : rest.length;
        rest.splice(target < 0 ? rest.length : target, 0, moving);
    }
    arrange(rest);
}

// The selected slides in one group, where the first of them is.
export function groupSlides(ids: string[]) {
    if (ids.length < 2) return;
    const order = slideIds(editor.get().doc).filter((s) => ids.includes(s));
    const groups = groupsOf();
    const first = groups.findIndex((g) => g.ids.includes(order[0] as string));
    const group = { section: newGroup(), ids: order };
    const rest = groups.map((g) => ({ ...g, ids: g.ids.filter((s) => !ids.includes(s)) }));
    rest.splice(first, 0, group);
    arrange(rest);
}

// Every slide of the group becomes a row of its own.
export function ungroup(section: string) {
    const groups = groupsOf().flatMap((g) => (g.section.id === section ? g.ids.map((id, i) => ({ section: i === 0 ? g.section : newGroup(), ids: [id] })) : [g]));
    arrange(groups);
}

// Moves slides to the end of a group; with `section` null, into a new group where the first of
// them was (it went to the end of the deck).
export function moveSlidesToSection(ids: string[], section: string | null) {
    const moving = new Set(ids);
    const before = groupsOf();
    const order = slideIds(editor.get().doc).filter((s) => moving.has(s));
    const from = before.findIndex((g) => g.ids.includes(order[0] as string));
    const groups = before.map((g) => ({ ...g, ids: g.ids.filter((s) => !moving.has(s)) }));
    const target = section ? groups.find((g) => g.section.id === section) : null;
    if (target) target.ids.push(...ids);
    else groups.splice(from < 0 ? groups.length : from + 1, 0, { section: newGroup(), ids: order.length ? order : [...ids] });
    arrange(groups);
}

// Decks made before groups had sections for rows: a deck with one section becomes one row per
// slide. Group ids come from the slides so collaborators opening it at once agree.
export function migrateGroups() {
    const s = editor.get();
    const deck = deckOf(s.doc);
    if (s.readOnly || deck.groups || !s.doc.slides) return;
    const groups = groupsOf(s.doc);
    const split = groups.length > 1 ? groups : groups.flatMap((g) => g.ids.map((id, i) => ({ section: i === 0 ? g.section : { id: `g-${id}`, name: "" }, ids: [id] })));
    const commands = arrangeCommands(s.doc, split);
    editor.executeSilently(deckBatch(s.doc, commands));
}

export function deleteSlides(ids: string[]) {
    const doc = editor.get().doc;
    const all = slideIds(doc);
    const left = all.filter((id) => !ids.includes(id));
    if (!left.length) {
        editor.notify("A deck keeps at least one slide.");
        return;
    }
    const at = Math.max(0, all.indexOf(ids[0] ?? "") - 1);
    run([{ type: "node.delete", ids }]);
    const next = left[Math.min(at, left.length - 1)];
    if (next) goToSlide(next);
}

export function patchSlide(id: string, patch: Partial<SlideInfo>) {
    const node = editor.get().doc.nodes[id];
    const info = slideOf(node);
    if (!node || !info) return;
    run([{ type: "node.update", id, patch: { deck: { ...info, ...patch } } }]);
}

export function toggleSkip(id: string) {
    const info = slideOf(editor.get().doc.nodes[id]);
    if (info) patchSlide(id, { skip: !info.skip });
}

// Puts a slide at `index` in a section's list.
export function moveSlide(id: string, section: string, index: number) {
    const doc = editor.get().doc;
    const page = deckPage(doc);
    const node = doc.nodes[id];
    const info = slideOf(node);
    if (!page || !node || !info) return;
    const rows = slidesBySection(doc);
    const target = (rows.find((r) => r.section.id === section)?.ids ?? []).filter((s) => s !== id);
    const before = target[Math.max(0, Math.min(index, target.length))];
    const after = before ? undefined : target[target.length - 1];
    const others = page.children.filter((c) => c !== id);
    const at = before ? others.indexOf(before) : after ? others.indexOf(after) + 1 : others.length;
    run([
        { type: "node.update", id, patch: { deck: { ...info, section } } },
        { type: "node.reparent", id, parentId: page.id, index: at },
    ]);
}

function setDeck(patch: Partial<ReturnType<typeof deckOf>>) {
    const doc = editor.get().doc;
    const page = deckPage(doc);
    if (!page) return;
    run([{ type: "node.update", id: page.id, patch: { deck: { ...deckOf(doc), ...patch } } }]);
}

export function setSlideNumbers(on: boolean) {
    setDeck({ slideNumbers: on });
}

export function setNumberFormat(numberFormat: NumberFormat) {
    setDeck({ numberFormat });
}

export function setPublishedTemplate(on: boolean) {
    setDeck({ template: on || undefined });
    editor.notify(on ? "Published as a template: its templates head the template library for everyone with this deck." : "No longer published as a template.");
}

export function setFooter(footer: string) {
    setDeck({ footer: footer.trim() || undefined });
}

// New slide's "Add all slides": a slide of every layout in a template (but Blank), after `after`,
// in one step. The template joins the deck when it isn't in it yet.
export function addAllLayouts(theme: DeckTheme, after: string | null = currentSlide()) {
    const s = editor.get();
    const page = deckPage(s.doc);
    if (!page || s.readOnly) return;
    const deck = deckOf(s.doc);
    let doc = s.doc;
    const commands: Command[] = [];
    if (theme.id !== deck.theme.id && !(deck.themes ?? []).some((t) => t.id === theme.id)) {
        const join: Command = { type: "node.update", id: page.id, patch: { deck: { ...deck, themes: [...(deck.themes ?? []), theme] } } };
        doc = applyCommand(doc, join);
        commands.push(join);
    }
    const look = templatesOf(doc).find((t) => t.id === theme.id) ?? theme;
    let last = after;
    for (const layout of LAYOUTS) {
        if (layout.id === "blank") continue;
        const made = addSlideCommands(doc, layout.id, last, look.id === deckOf(doc).theme.id ? undefined : look);
        doc = applyCommand(doc, { type: "batch", commands: made.commands });
        commands.push(...made.commands);
        last = made.id;
    }
    editor.execute(deckBatch(s.doc, commands));
    if (last) goToSlide(last);
}

// The template picker over a new deck: a style for the deck, optionally a slide of every layout.
export function chooseTemplate(theme: DeckTheme | null, allLayouts = false) {
    const s = editor.get();
    const page = deckPage(s.doc);
    if (!page || s.readOnly) return;
    let doc = s.doc;
    const commands: Command[] = theme ? themeCommands(doc, theme) : [];
    if (commands.length) doc = applyCommand(doc, { type: "batch", commands });
    let last = slideIds(doc).at(-1) ?? null;
    if (allLayouts) {
        for (const layout of LAYOUTS) {
            if (layout.id === "blank" || layout.id === "title") continue;
            const made = addSlideCommands(doc, layout.id, last);
            doc = applyCommand(doc, { type: "batch", commands: made.commands });
            commands.push(...made.commands);
            last = made.id;
        }
    }
    commands.push({ type: "node.update", id: page.id, patch: { deck: { ...deckOf(doc), picker: false } } });
    editor.execute(deckBatch(s.doc, commands));
}

export function renameSection(id: string, name: string) {
    const deck = deckOf(editor.get().doc);
    setDeck({ sections: deck.sections.map((s) => (s.id === id ? { ...s, name } : s)) });
}

export function moveSection(id: string, by: number) {
    const deck = deckOf(editor.get().doc);
    const i = deck.sections.findIndex((s) => s.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= deck.sections.length) return;
    const sections = [...deck.sections];
    const [moved] = sections.splice(i, 1);
    if (moved) sections.splice(j, 0, moved);
    setDeck({ sections });
}

// Puts the whole deck on a template.
export function applyTheme(theme: DeckTheme) {
    run(templateCommands(editor.get().doc, theme));
}

// Puts slides on a template ("Template style" for the selected slides).
export function setSlideTemplate(ids: string[], theme: DeckTheme) {
    run(templateCommands(editor.get().doc, theme, ids));
}

// A template's colours, fonts or text styles changed: every slide on it follows.
export function editTemplate(theme: DeckTheme) {
    run(editTemplateCommands(editor.get().doc, theme));
}

export function remixTemplate(theme: DeckTheme) {
    editTemplate(remixTheme(theme));
}

export function addTemplateColor(theme: DeckTheme, color = theme.accent) {
    const colors = theme.colors ?? [];
    editTemplate({ ...theme, colors: [...colors, { id: nanoid(8), name: `Colour ${templateColors(theme).length + 1}`, color }] });
}

// A text style for the template, from the selected text when there is one.
export function addTemplateTextStyle(theme: DeckTheme, from?: SceneNode): string {
    const id = nanoid(8);
    const styles = theme.textStyles ?? [];
    const color = from?.fills[0]?.type === "solid" ? (templateColors(theme).find((c) => c.color.toUpperCase() === (from.fills[0] as { color: string }).color.toUpperCase())?.id ?? "text") : "text";
    editTemplate({
        ...theme,
        textStyles: [...styles, { id, name: `Text style ${styles.length + 1}`, fontFamily: from?.fontFamily ?? theme.bodyFont, fontWeight: from?.fontWeight ?? 400, fontSize: from?.fontSize ?? 40, color }],
    });
    return id;
}

// Changing a slide's layout: its layout layers are replaced, keeping their text where the new
// layout has a layer for the same role.
export function changeLayout(id: string, layout: SlideLayout) {
    const doc = editor.get().doc;
    const slide = doc.nodes[id];
    const info = slideOf(slide);
    if (!slide || !info) return;
    const theme = themeOf(doc, id);
    const old = slide.children.map((c) => doc.nodes[c]).filter((n): n is SceneNode => Boolean(n && (n.deck?.kind === "text" ? n.deck.role !== "slide-number" && n.deck.role !== "footer" : n.deck?.kind === "shape")));
    const texts = new Map<string, string[]>();
    for (const n of old) if (n.deck?.kind === "text") texts.set(n.deck.role, [...(texts.get(n.deck.role) ?? []), n.text ?? ""]);
    const made = layoutLayers(doc, slide, layout, theme).map((n) => {
        if (n.deck?.kind !== "text") return n;
        const list = texts.get(n.deck.role);
        const keep = list?.shift();
        return keep !== undefined ? { ...n, text: keep } : n;
    });
    run([
        ...(made.some((n) => n.deck?.kind === "shape" && n.deck.role === "placeholder") ? placeholderImageCommands(doc) : []),
        ...(old.length ? [{ type: "node.delete" as const, ids: old.map((n) => n.id) }] : []),
        { type: "node.update", id, patch: { deck: { ...info, layout, animations: info.animations?.filter((a) => !old.some((n) => n.id === a.target)) } } },
        ...made.map((node) => ({ type: "node.create" as const, node })),
    ]);
}

export function setBackground(id: string, color: string | null) {
    const doc = editor.get().doc;
    const slide = doc.nodes[id];
    const info = slideOf(slide);
    if (!slide || !info) return;
    const theme = themeOf(doc, id);
    run([{ type: "node.update", id, patch: { deck: { ...info, background: color }, fills: [{ type: "solid", color: color ?? theme.background, opacity: 1, visible: true, blend: "normal" }] } }]);
}

// A gradient or image background instead of a flat colour. The slide keeps a colour in its deck
// data (the gradient's first stop, or the colour behind the image) so theme changes leave it alone.
export function setBackgroundPaint(id: string, paint: Paint, color: string, extra: Command[] = []) {
    const slide = editor.get().doc.nodes[id];
    const info = slideOf(slide);
    if (!slide || !info) return;
    run([...extra, { type: "node.update", id, patch: { deck: { ...info, background: color }, fills: [paint] } }]);
}

export function setGradientBackground(id: string, from: string, to: string) {
    setBackgroundPaint(
        id,
        { type: "linear", visible: true, opacity: 1, blend: "normal", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, stops: [{ position: 0, color: from, opacity: 1 }, { position: 1, color: to, opacity: 1 }] },
        from,
    );
}

// Asks for a picture and fills the slide with it.
export function pickBackgroundImage(id: string) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const image = await readImage(file);
        if (!image) {
            editor.notify(`Couldn't read ${file.name}.`);
            return;
        }
        const color = slideOf(editor.get().doc.nodes[id])?.background ?? themeOf(editor.get().doc, id).background;
        setBackgroundPaint(id, { type: "image", id: image.id, mode: "fill", visible: true, opacity: 1, blend: "normal" }, color, [{ type: "image.add", id: image.id, data: image.data }]);
    };
    input.click();
}

export function setTransition(id: string, transition: SlideTransition | undefined) {
    patchSlide(id, { transition });
}

export function setTransitionAll(transition: SlideTransition, ids?: string[]) {
    const doc = editor.get().doc;
    const commands: Command[] = [];
    for (const id of ids ?? slideIds(doc)) {
        const info = slideOf(doc.nodes[id]);
        if (info) commands.push({ type: "node.update", id, patch: { deck: { ...info, transition } } });
    }
    run(commands);
}

export function setAnimations(id: string, animations: ObjectAnimation[]) {
    patchSlide(id, { animations });
}

// The slide layer a selected layer belongs to (animations go on layers directly in the slide).
export function slideLayerOf(nodeId: string, slideId: string): string | null {
    const doc = editor.get().doc;
    let node: SceneNode | undefined = doc.nodes[nodeId];
    while (node && node.parentId !== slideId) node = node.parentId ? doc.nodes[node.parentId] : undefined;
    return node?.id ?? null;
}

// One animation per layer: layers that already have one are left as they are.
export function addAnimation(slideId: string, targets: string[]) {
    const info = slideOf(editor.get().doc.nodes[slideId]);
    if (!info) return;
    const taken = new Set((info.animations ?? []).map((a) => a.target));
    const layers = targets.map((t) => slideLayerOf(t, slideId)).filter((t, i, all): t is string => Boolean(t) && all.indexOf(t) === i);
    if (layers.length && layers.every((t) => taken.has(t))) {
        editor.notify(layers.length > 1 ? "These layers are already animated." : "This layer is already animated.");
        return;
    }
    const fresh = layers
        .filter((t) => !taken.has(t))
        .map((target, i): ObjectAnimation => ({ id: nanoid(8), target, effect: "fade", trigger: i === 0 ? "click" : "with", delay: 0, duration: 400, direction: "up" }));
    if (fresh.length) patchSlide(slideId, { animations: [...(info.animations ?? []), ...fresh] });
}

// One pending save per slide: typing on the next slide (presenter view moves on by itself) must
// not cancel the last words written on the one before.
const notesTimers = new Map<string, number>();
// Notes are saved a moment after typing stops, so each pause is one undo step.
export function setNotes(id: string, notes: string, now = false) {
    window.clearTimeout(notesTimers.get(id));
    notesTimers.delete(id);
    const save = () => {
        notesTimers.delete(id);
        const info = slideOf(editor.get().doc.nodes[id]);
        if (info && (info.notes ?? "") !== notes) editor.execute({ type: "node.update", id, patch: { deck: { ...info, notes } } });
    };
    if (now) save();
    else notesTimers.set(id, window.setTimeout(save, 600));
}

export async function copySlideLink(id: string) {
    const url = new URL(location.href);
    url.searchParams.set("slide", id);
    try {
        await navigator.clipboard.writeText(url.toString());
        editor.notify("Link to slide copied.");
    } catch {
        editor.notify("Couldn't copy the link.");
    }
}

// A link that opens the deck straight into the show, on the slide on screen.
export async function copyPresentationLink() {
    const url = new URL(location.href);
    const id = currentSlide();
    if (id) url.searchParams.set("slide", id);
    url.searchParams.set("present", "1");
    try {
        await navigator.clipboard.writeText(url.toString());
        editor.notify("Presentation link copied.");
    } catch {
        editor.notify("Couldn't copy the link.");
    }
}

// ---- Export ----

export interface SlideExport {
    format: "pdf" | "png" | "jpg" | "pptx";
    content: "all" | "selected";
    // Skipped slides are left out unless asked for.
    skipped: boolean;
    // PDF: a notes page under each slide.
    notes: boolean;
    // PNG and JPG: 1x or 2x.
    scale: number;
    // .pptx: each slide one picture instead of editable text and shapes.
    flat: boolean;
    // PDF: the colour profile (the file's own, sRGB or Display P3) and the quality.
    profile: "document" | "srgb" | "p3";
    quality: "low" | "medium" | "high";
}

export const DEFAULT_EXPORT: SlideExport = { format: "pdf", content: "all", skipped: false, notes: false, scale: 1, flat: false, profile: "document", quality: "medium" };

function exported(options: Pick<SlideExport, "content" | "skipped"> = { content: "all", skipped: false }): string[] {
    const doc = editor.get().doc;
    const ids = options.content === "selected" ? selectedSlides() : slideIds(doc);
    return options.skipped ? ids : ids.filter((id) => !slideOf(doc.nodes[id])?.skip);
}

function deckName(): string {
    return safeName(editor.get().doc.name || "Slides");
}

export async function exportSlides(options: SlideExport) {
    const ids = exported(options);
    if (!ids.length) {
        editor.notify("Nothing to export: every slide is skipped.");
        return;
    }
    editor.notify(`Exporting ${ids.length} slide${ids.length === 1 ? "" : "s"}…`);
    try {
        if (options.format === "pptx") {
            const { buildPptx } = await import("./pptx-export");
            const blob = await buildPptx(await inlineImages(editor.get().doc), ids, { flat: options.flat });
            download(blob, `${deckName()}.pptx`);
            editor.notify("Presentation exported.");
        } else if (options.format === "pdf") {
            const doc = editor.get().doc;
            const p3 = (options.profile === "document" ? (doc.colorProfile ?? "srgb") : options.profile) === "p3";
            const blob = options.notes ? await notesPdf(ids, options) : p3 ? await rasterPdf(ids, options) : await buildPdf(doc, ids, options.quality);
            if (blob) download(blob, `${deckName()}.pdf`);
            editor.notify(blob ? "PDF exported." : "Nothing to export.");
        } else await exportPngs(ids, options.format, options.scale);
    } catch (error) {
        editor.notify(`Couldn't export: ${error instanceof Error ? error.message : String(error)}`);
    }
}

const PDF_SCALE = { low: 1, medium: 1.5, high: 2 } as const;

function blobUrl(blob: Blob): Promise<string> {
    return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
    });
}

// A PDF of slide pictures drawn in the Display P3 colour space, at the quality's resolution.
async function rasterPdf(ids: string[], options: Pick<SlideExport, "quality">): Promise<Blob | null> {
    const doc = await inlineImages(editor.get().doc);
    const { jsPDF } = await import("jspdf");
    let pdf: InstanceType<typeof jsPDF> | null = null;
    for (const id of ids) {
        const slide = doc.nodes[id];
        if (!slide) continue;
        const size: [number, number] = [slide.w, slide.h];
        // Always compressed (losslessly): uncompressed, each slide picture was stored as raw pixels.
        if (!pdf) pdf = new jsPDF({ unit: "pt", format: size, orientation: "landscape", compress: true });
        else pdf.addPage(size, "landscape");
        const blob = await renderNodesToPng(doc, slide, PDF_SCALE[options.quality], options.quality === "low" ? "jpeg" : "png", { colorSpace: "display-p3", quality: 0.85 });
        if (blob) pdf.addImage(await blobUrl(blob), options.quality === "low" ? "JPEG" : "PNG", 0, 0, slide.w, slide.h);
    }
    return pdf ? pdf.output("blob") : null;
}

// A PDF with each slide on top of its page and its presenter notes underneath.
async function notesPdf(ids: string[], options: Pick<SlideExport, "quality" | "profile"> = DEFAULT_EXPORT): Promise<Blob | null> {
    const doc = await inlineImages(editor.get().doc);
    const { jsPDF } = await import("jspdf");
    let pdf: InstanceType<typeof jsPDF> | null = null;
    for (const id of ids) {
        const slide = doc.nodes[id];
        if (!slide) continue;
        const notes = slideOf(slide)?.notes?.trim() ?? "";
        const w = slide.w / 2;
        const h = slide.h / 2;
        const margin = 40;
        const pageW = w + margin * 2;
        const pageH = h + margin * 2 + 360;
        // Compressed (losslessly): without it each slide picture went in as raw pixels, about 3 MB
        // a page (45 MB for 14 slides).
        if (!pdf) pdf = new jsPDF({ unit: "pt", format: [pageW, pageH], orientation: "portrait", compress: true });
        else pdf.addPage([pageW, pageH], "portrait");
        const p3 = (options.profile === "document" ? (doc.colorProfile ?? "srgb") : options.profile) === "p3";
        const blob = await renderNodesToPng(doc, slide, PDF_SCALE[options.quality] / 2, "png", p3 ? { colorSpace: "display-p3" } : {});
        if (blob) pdf.addImage(await blobUrl(blob), "PNG", margin, margin, w, h);
        pdf.setDrawColor(200);
        pdf.rect(margin, margin, w, h);
        pdf.setFontSize(16);
        pdf.setTextColor(40);
        const lines = pdf.splitTextToSize(notes || "No presenter notes.", w) as string[];
        pdf.text(lines.slice(0, 18), margin, margin + h + 40);
    }
    return pdf ? pdf.output("blob") : null;
}

export async function exportPdf() {
    await exportSlides({ ...DEFAULT_EXPORT, format: "pdf" });
}

export async function exportPngs(only?: string[], format: "png" | "jpg" = "png", scale = 1) {
    const doc = await inlineImages(editor.get().doc);
    const ids = only ?? exported();
    editor.notify("Exporting slides…");
    const files: { name: string; blob: Blob }[] = [];
    for (const [i, id] of ids.entries()) {
        const node = doc.nodes[id];
        if (!node) continue;
        const blob = await renderNodesToPng(doc, node, scale, format === "jpg" ? "jpeg" : "png");
        if (blob) files.push({ name: `${String(i + 1).padStart(2, "0")} ${safeName(node.name)}.${format}`, blob });
    }
    if (files.length === 1 && files[0]) download(files[0].blob, files[0].name);
    else if (files.length) download(await zipFiles(files), `${deckName()}.zip`);
    editor.notify(files.length ? "Slides exported." : "Nothing to export.");
}
