import { aiError, aiRequestHeaders, keyNeeded, notifyKeyNeeded } from "../engine/ai-settings";
import { makeNode } from "../engine/nodes";
import { solid } from "../engine/paint";
import { httpBase } from "../engine/server-url";
import { editor } from "../engine/store";
import { worldBounds } from "../engine/transform";
import type { Command, SceneNode } from "../engine/types";
import { addAdjacent, myName, placeAt } from "./actions";
import { STICKY_SIZE, makeSticky } from "./model";
import { board } from "./state";

// Board AI: sort stickies into groups by topic, summarize what's selected into a sticky, and
// generate ideas from a sticky, shape or mind map topic. The model answers with the person's own AI
// key (or the server's shared one); without one, sorting and summarizing work out of the text
// itself, ideas come from a set of brainstorming prompts, and a notice says how to add a key.

const STOP = new Set("a an the and or but if then of to in on for with at by from is are was were be been it this that these those we you they i our your their as not no so do does did can could should would will just about into over more most very".split(" "));

function words(text: string): string[] {
    // Plurals count as the same word.
    return text.toLowerCase().match(/[\p{L}\p{N}']+/gu)?.filter((w) => w.length > 2 && !STOP.has(w)).map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)) ?? [];
}

// Asks the model (the person's own AI key, or the server's shared one): its reply, or null when
// there's no model to ask (`keyNeeded` then says there's no key) or it didn't answer.
let keyMissing = false;
async function ask(prompt: string, items: { id: string; text: string }[]): Promise<string | null> {
    keyMissing = false;
    try {
        const res = await fetch(`${httpBase()}/ai/chat`, { method: "POST", headers: { "content-type": "application/json", ...aiRequestHeaders() }, body: JSON.stringify({ text: prompt, selection: items.map((i) => ({ id: i.id, type: "sticky", name: i.text.slice(0, 40), text: i.text })) }), signal: AbortSignal.timeout(30000) });
        if (!res.ok) {
            keyMissing = keyNeeded(await aiError(res));
            return null;
        }
        const data = (await res.json()) as { reply?: string };
        return data.reply ?? null;
    } catch {
        return null;
    }
}

// Done without the model: says so, with the way to add a key when that's why.
function doneWithout(done: string, withAi: string) {
    if (keyMissing) notifyKeyNeeded(`${done} Add your AI key in Account settings ${withAi}.`);
    else editor.notify(done);
}

function selectedTexts(kinds: string[] = ["sticky"]): SceneNode[] {
    const { doc, selection } = editor.get();
    return selection.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n && n.jam && kinds.includes(n.jam.kind) && n.text?.trim()));
}

// ---- Sort ----

// Groups by shared words: each sticky joins the group whose words it shares most, or starts one.
function localGroups(nodes: SceneNode[]): { name: string; ids: string[] }[] {
    const groups: { words: Map<string, number>; ids: string[] }[] = [];
    for (const n of nodes) {
        const w = words(n.text ?? "");
        let best: (typeof groups)[number] | null = null;
        let score = 0;
        for (const g of groups) {
            const s = w.filter((x) => g.words.has(x)).length / Math.max(1, Math.min(w.length, g.words.size));
            if (s > score) {
                score = s;
                best = g;
            }
        }
        const target = best && score >= 0.3 ? best : null;
        if (target) {
            target.ids.push(n.id);
            for (const x of w) target.words.set(x, (target.words.get(x) ?? 0) + 1);
        } else groups.push({ words: new Map(w.map((x) => [x, 1])), ids: [n.id] });
    }
    // Lone stickies share an "Other" group.
    const big = groups.filter((g) => g.ids.length > 1);
    const lone = groups.filter((g) => g.ids.length === 1).flatMap((g) => g.ids);
    const named = big.map((g) => ({ name: [...g.words.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Group", ids: g.ids }));
    if (lone.length) named.push({ name: "Other", ids: lone });
    return named.map((g) => ({ ...g, name: g.name.charAt(0).toUpperCase() + g.name.slice(1) }));
}

// The model's groups made safe to lay out: each sticky once (its first group), only stickies that
// were sent, no empty groups, and any it left out together under "Other". (A sticky listed twice
// was moved twice, leaving an empty slot in the first group's section.)
export function cleanGroups(raw: { name?: unknown; ids?: unknown }[], known: string[]): { name: string; ids: string[] }[] {
    const left = new Set(known);
    const out: { name: string; ids: string[] }[] = [];
    for (const g of raw) {
        const ids = (Array.isArray(g.ids) ? g.ids : []).filter((id): id is string => typeof id === "string" && left.delete(id));
        if (ids.length) out.push({ name: String(g.name ?? "Group").slice(0, 40), ids });
    }
    if (left.size) {
        const other = out.find((g) => g.name === "Other");
        if (other) other.ids.push(...left);
        else out.push({ name: "Other", ids: [...left] });
    }
    return out;
}

// Sorts the selected stickies into labelled groups, side by side where they were.
export async function sortStickies() {
    const nodes = selectedTexts();
    if (nodes.length < 2) return editor.notify("Select a few stickies to sort.");
    editor.notify("Sorting stickies…");
    const reply = await ask('Group these sticky notes by topic. Reply only with JSON: {"groups":[{"name":"Short topic","ids":["id", ...]}]}, using every id once.', nodes.map((n) => ({ id: n.id, text: n.text ?? "" })));
    let groups: { name: string; ids: string[] }[] | null = null;
    try {
        const json = reply ? (JSON.parse(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1)) as { groups?: { name: string; ids: string[] }[] }) : null;
        groups = json?.groups ? cleanGroups(json.groups, nodes.map((n) => n.id)) : null;
    } catch {
        groups = null;
    }
    groups ??= localGroups(nodes);
    const doc = editor.get().doc;
    const boxes = nodes.map((n) => worldBounds(doc, n));
    const left = Math.min(...boxes.map((b) => b.x));
    const top = Math.min(...boxes.map((b) => b.y));
    const commands: Command[] = [];
    const page = editor.get().pageId;
    let x = left;
    for (const g of groups) {
        const cols = Math.min(3, g.ids.length);
        const rows = Math.ceil(g.ids.length / cols);
        const w = cols * (STICKY_SIZE + 24) + 56;
        const h = rows * (STICKY_SIZE + 24) + 80;
        const section = makeNode(doc, "frame", { x, y: top, w, h }, page, { name: g.name, isSection: true, clip: false, fills: [solid("#F2F2F2")], radius: 8 });
        commands.push({ type: "node.create", node: section });
        g.ids.forEach((id, i) => {
            commands.push({ type: "node.reparent", id, parentId: section.id });
            commands.push({ type: "node.update", id, patch: { x: x + 32 + (i % cols) * (STICKY_SIZE + 24), y: top + 56 + Math.floor(i / cols) * (STICKY_SIZE + 24) } });
        });
        x += w + 48;
    }
    editor.execute({ type: "batch", commands });
    const done = `Sorted into ${groups.length} group${groups.length === 1 ? "" : "s"}${reply ? "" : " by shared words"}.`;
    if (reply) editor.notify(done);
    else doneWithout(done, "to sort by topic with AI");
}

// ---- Summarize ----

// The sentences that carry the most frequent words, as a short bulleted summary.
export function localSummary(texts: string[]): string {
    const freq = new Map<string, number>();
    for (const t of texts) for (const w of words(t)) freq.set(w, (freq.get(w) ?? 0) + 1);
    const sentences = texts.flatMap((t) => t.split(/(?<=[.!?])\s+|\n+/)).map((s) => s.trim()).filter(Boolean);
    // Each pick is the sentence that adds the most of what's common and not yet covered, so the
    // bullets span the notes' topics (two notes about the same thing used to fill every bullet).
    const count = Math.min(5, Math.max(2, Math.ceil(sentences.length / 2)));
    const left = sentences.map((s, i) => ({ s, i, w: words(s) }));
    const covered = new Set<string>();
    const top: { s: string; i: number }[] = [];
    while (top.length < count && left.length) {
        const gain = (c: (typeof left)[number]) => c.w.filter((w) => !covered.has(w)).reduce((a, w) => a + (freq.get(w) ?? 0), 0) / Math.max(1, c.w.length);
        let best = 0;
        for (let k = 1; k < left.length; k++) if (gain(left[k] as (typeof left)[number]) > gain(left[best] as (typeof left)[number])) best = k;
        const [pick] = left.splice(best, 1);
        if (!pick) break;
        pick.w.forEach((w) => covered.add(w));
        top.push(pick);
    }
    top.sort((a, b) => a.i - b.i);
    const themes = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
    return `Summary${themes.length ? ` (${themes.join(", ")})` : ""}\n${top.map((t) => `• ${t.s}`).join("\n")}`;
}

export async function summarizeSelection() {
    const nodes = selectedTexts(["sticky", "shape", "code"]);
    if (!nodes.length) return editor.notify("Select stickies or shapes with text to summarize.");
    editor.notify("Summarizing…");
    const reply = await ask("Summarize these notes in at most five short bullet points. Reply with just the bullets, one per line.", nodes.map((n) => ({ id: n.id, text: n.text ?? "" })));
    const text = reply?.trim() ? `Summary\n${reply.trim()}` : localSummary(nodes.map((n) => n.text ?? ""));
    const doc = editor.get().doc;
    const boxes = nodes.map((n) => worldBounds(doc, n));
    const right = Math.max(...boxes.map((b) => b.x + b.w));
    const top = Math.min(...boxes.map((b) => b.y));
    const at = placeAt(doc, right + 80, top);
    const note = { ...makeSticky(doc, at.x, at.y, "#E4CCFF", at.parentId, myName(), true), text, name: "Summary", h: Math.max(STICKY_SIZE, 60 + text.split("\n").length * 30) };
    editor.execute({ type: "node.create", node: note });
    editor.set({ selection: [note.id] });
    if (!reply?.trim()) doneWithout("Summarized from the most common words.", "for AI summaries");
}

// ---- Generate ----

const PROMPTS = ["How might we make {t} simpler?", "What would {t} look like in a year?", "Who benefits most from {t}?", "Biggest risk in {t}", "The smallest first step for {t}", "What if {t} were free?"];

export async function generateIdeas() {
    const { doc, selection } = editor.get();
    const node = selection.length === 1 ? doc.nodes[selection[0] ?? ""] : undefined;
    if (!node?.text?.trim() || (node.jam?.kind !== "sticky" && node.jam?.kind !== "shape")) return editor.notify("Select a sticky or shape with text to grow ideas from.");
    editor.notify("Generating ideas…");
    const topic = node.text.trim().split("\n")[0]?.slice(0, 80) ?? "";
    const reply = await ask(`Suggest four short, distinct ideas (under eight words each) that build on: "${topic}". Reply with one idea per line, no numbering.`, [{ id: node.id, text: node.text }]);
    const ideas = (reply?.split("\n").map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean) ?? PROMPTS.slice(0, 4).map((p) => p.replace("{t}", topic.toLowerCase()))).slice(0, 4);
    // Each idea is a branch: a copy beside the topic, joined to it (a mind map tidies itself).
    // All of them are one undo step.
    const steps = editor.get().past.length;
    let made = 0;
    for (const idea of ideas) {
        const id: string | null = addAdjacent(node.id, "right", { connect: true });
        if (!id) break;
        made++;
        editor.execute({ type: "node.update", id, patch: { text: idea, name: idea.slice(0, 40) } });
        editor.mergeLast();
    }
    for (let i = 1; i < made && editor.get().past.length > steps + 1; i++) editor.mergeLast();
    board.set({ editing: null });
    editor.set({ selection: [node.id] });
    if (!reply) doneWithout("Added starter prompts.", "for ideas from AI");
}
