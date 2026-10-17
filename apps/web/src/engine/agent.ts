import { alignSelection, distributeSelection, tidyUp } from "./arrange";
import { createComponent, deleteSelection, duplicateSelection, groupSelection, selectAll } from "./actions";
import { KEY_NEEDED, aiError, aiRequestHeaders, keyNeeded } from "./ai-settings";
import { zoomToFit, zoomToSelection } from "./camera";
import { applyCommand } from "./commands";
import { makeNode } from "./nodes";
import { activePage, layerRoots } from "./page";
import { solid } from "./paint";
import { httpBase } from "./server-url";
import { editor } from "./store";
import type { Command, NagmaDocument, SceneNode } from "./types";
import { userStorage } from "./user-storage";

// The Agents panel. Requests go to the sync server's /ai/chat, answered with the person's own AI key
// (or the server's shared one); a set of local intents handles the common asks directly first, so
// the panel is useful without a key and offline too.

export interface AgentMessage {
    role: "user" | "agent";
    text: string;
    // What the agent did, for the "applied" line under its reply.
    applied?: string[];
    // A button under the reply: "ai-settings" opens Account settings › AI.
    action?: "ai-settings";
}

export interface AgentChat {
    id: string;
    title: string;
    messages: AgentMessage[];
    createdAt: number;
}

const CHATS_KEY = "nagma.agent.chats.v1";
let chats: AgentChat[] = [];
try {
    chats = JSON.parse(userStorage.getItem(CHATS_KEY) ?? "[]") as AgentChat[];
} catch {
    chats = [];
}
const listeners = new Set<() => void>();
function save() {
    try {
        userStorage.setItem(CHATS_KEY, JSON.stringify(chats.slice(0, 50)));
    } catch {
        // Kept for this session.
    }
    for (const l of listeners) l();
}
export function subscribeChats(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
export function getChats(): AgentChat[] {
    return chats;
}
export function newChat(): AgentChat {
    const chat: AgentChat = { id: Math.random().toString(36).slice(2, 10), title: "New chat", messages: [], createdAt: Date.now() };
    chats = [chat, ...chats];
    save();
    return chat;
}
export function deleteChat(id: string) {
    chats = chats.filter((c) => c.id !== id);
    save();
}
function update(id: string, fn: (c: AgentChat) => AgentChat) {
    const before = chats.find((c) => c.id === id)?.messages.length ?? 0;
    chats = chats.map((c) => (c.id === id ? fn(c) : c));
    save();
    const after = chats.find((c) => c.id === id)?.messages;
    if (after && after.length > before && after[after.length - 1]?.role === "agent") chime();
}

// Preferences › Play audio notifications in AI chat: a short two-note chime when an answer arrives.
function chime() {
    if (!editor.get().prefs.aiChatSound || typeof AudioContext === "undefined") return;
    try {
        const ctx = new AudioContext();
        [660, 880].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = freq;
            const at = ctx.currentTime + i * 0.12;
            gain.gain.setValueAtTime(0.0001, at);
            gain.gain.exponentialRampToValueAtTime(0.15, at + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
            osc.connect(gain).connect(ctx.destination);
            osc.start(at);
            osc.stop(at + 0.3);
        });
        setTimeout(() => void ctx.close(), 800);
    } catch {
        // No audio output: stay quiet.
    }
}

// ---- Local intents ----

const COLORS: Record<string, string> = {
    red: "#EF4444",
    orange: "#F97316",
    yellow: "#EAB308",
    green: "#22C55E",
    teal: "#14B8A6",
    blue: "#0D99FF",
    indigo: "#6366F1",
    purple: "#A855F7",
    pink: "#EC4899",
    black: "#000000",
    white: "#FFFFFF",
    grey: "#9CA3AF",
    gray: "#9CA3AF",
};

function selectedNodes(): SceneNode[] {
    const { doc, selection } = editor.get();
    return selection.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
}

function patchSelection(fn: (n: SceneNode) => Partial<SceneNode>): number {
    const nodes = selectedNodes();
    if (!nodes.length) return 0;
    editor.execute({ type: "batch", commands: nodes.map((n) => ({ type: "node.update" as const, id: n.id, patch: fn(n) })) });
    return nodes.length;
}

// Layer names that say nothing ("Rectangle 3") get a name from their role.
function renameGenericLayers(): number {
    const { doc } = editor.get();
    const commands: Command[] = [];
    for (const node of Object.values(doc.nodes)) {
        if (node.type === "page" || node.sourceId) continue;
        if (!/^(Rectangle|Ellipse|Frame|Text|Vector|Group|Line)( \d+)?$/.test(node.name)) continue;
        let name = node.name;
        if (node.type === "text" && node.text) name = node.text.split("\n")[0]?.slice(0, 30) || name;
        else if (node.fills.some((p) => p.type === "image")) name = "Image";
        else if (node.type === "rect" && node.radius >= Math.min(node.w, node.h) / 2) name = "Pill";
        else if (node.type === "rect" && node.h <= 56 && node.w >= 120 && node.children.length === 0) name = "Button";
        else if (node.type === "frame" && node.layout) name = node.layout.direction === "vertical" ? "Stack" : "Row";
        else if (node.type === "frame" && !node.parentId) name = "Screen";
        if (name !== node.name) commands.push({ type: "node.update", id: node.id, patch: { name } });
    }
    if (commands.length) editor.execute({ type: "batch", commands });
    return commands.length;
}

function roundToPixel(): number {
    const { doc } = editor.get();
    const commands: Command[] = [];
    for (const node of Object.values(doc.nodes)) {
        if (node.type === "page" || node.sourceId) continue;
        const patch: Partial<SceneNode> = {};
        for (const k of ["x", "y", "w", "h"] as const) if (node[k] !== Math.round(node[k])) patch[k] = Math.round(node[k]);
        if (Object.keys(patch).length) commands.push({ type: "node.update", id: node.id, patch });
    }
    if (commands.length) editor.execute({ type: "batch", commands });
    return commands.length;
}

// A generated screen: a 390×844 frame to the right of everything, filled by the builder.
function generateScreen(name: string, build: (add: (type: SceneNode["type"], rect: { x: number; y: number; w: number; h: number }, parentId: string, overrides?: Partial<SceneNode>) => string, frame: string) => void): string {
    let doc = editor.get().doc;
    const roots = layerRoots(doc).map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    const x = roots.length ? Math.max(...roots.map((n) => n.x + n.w)) + 80 : 0;
    const y = roots.length ? Math.min(...roots.map((n) => n.y)) : 0;
    const commands: Command[] = [];
    const add = (type: SceneNode["type"], rect: { x: number; y: number; w: number; h: number }, parentId: string, overrides: Partial<SceneNode> = {}) => {
        const parent = doc.nodes[parentId];
        const placed = parent && parent.type !== "page" ? { ...rect, x: rect.x + parent.x, y: rect.y + parent.y } : rect;
        const node = makeNode(doc, type, placed, parentId, overrides);
        const command: Command = { type: "node.create", node };
        commands.push(command);
        doc = applyCommand(doc, command);
        return node.id;
    };
    const frame = add("frame", { x, y, w: 390, h: 844 }, activePage.id, { name, fills: [solid("#FFFFFF")], clip: true });
    build(add, frame);
    editor.execute({ type: "batch", commands });
    editor.set({ selection: [frame] });
    zoomToSelection();
    return frame;
}

const INK = "#1E1E1E";
const MUTED = "#7F7F7F";
const LINE = "#E6E6E6";
const ACCENT = "#0D99FF";

const GENERATORS: Record<string, (add: Parameters<Parameters<typeof generateScreen>[1]>[0], frame: string) => void> = {
    login: (add, f) => {
        add("text", { x: 24, y: 120, w: 342, h: 40 }, f, { name: "Title", text: "Welcome back", fontSize: 30, fontWeight: 700, fills: [solid(INK)] });
        add("text", { x: 24, y: 166, w: 342, h: 22 }, f, { name: "Subtitle", text: "Sign in to continue", fontSize: 15, fills: [solid(MUTED)] });
        for (const [i, label] of ["Email", "Password"].entries()) {
            const y = 240 + i * 84;
            add("text", { x: 24, y, w: 200, h: 16 }, f, { name: `${label} label`, text: label, fontSize: 12, fills: [solid(MUTED)] });
            const field = add("frame", { x: 24, y: y + 22, w: 342, h: 52 }, f, { name: `${label} field`, fills: [solid("#FFFFFF")], strokes: [solid(LINE)], strokeWidth: 1, radius: 12, clip: false });
            add("text", { x: 16, y: 16, w: 280, h: 20 }, field, { name: "Placeholder", text: label === "Email" ? "you@example.com" : "••••••••", fontSize: 15, fills: [solid(MUTED)] });
        }
        const button = add("frame", { x: 24, y: 440, w: 342, h: 52 }, f, { name: "Sign in button", fills: [solid(ACCENT)], radius: 12, clip: false });
        add("text", { x: 0, y: 15, w: 342, h: 22 }, button, { name: "Label", text: "Sign in", fontSize: 16, fontWeight: 600, textAlign: "center", fills: [solid("#FFFFFF")], sizing: { h: "fixed", v: "hug" } });
        add("text", { x: 0, y: 512, w: 390, h: 18 }, f, { name: "Forgot", text: "Forgot password?", fontSize: 13, textAlign: "center", fills: [solid(ACCENT)], sizing: { h: "fixed", v: "hug" } });
    },
    signup: (add, f) => {
        add("text", { x: 24, y: 120, w: 342, h: 40 }, f, { name: "Title", text: "Create your account", fontSize: 28, fontWeight: 700, fills: [solid(INK)] });
        for (const [i, label] of ["Name", "Email", "Password"].entries()) {
            const y = 200 + i * 84;
            add("text", { x: 24, y, w: 200, h: 16 }, f, { name: `${label} label`, text: label, fontSize: 12, fills: [solid(MUTED)] });
            add("frame", { x: 24, y: y + 22, w: 342, h: 52 }, f, { name: `${label} field`, fills: [solid("#FFFFFF")], strokes: [solid(LINE)], strokeWidth: 1, radius: 12, clip: false });
        }
        const button = add("frame", { x: 24, y: 480, w: 342, h: 52 }, f, { name: "Continue button", fills: [solid(ACCENT)], radius: 12, clip: false });
        add("text", { x: 0, y: 15, w: 342, h: 22 }, button, { name: "Label", text: "Continue", fontSize: 16, fontWeight: 600, textAlign: "center", fills: [solid("#FFFFFF")], sizing: { h: "fixed", v: "hug" } });
    },
    settings: (add, f) => {
        add("text", { x: 24, y: 64, w: 300, h: 32 }, f, { name: "Title", text: "Settings", fontSize: 24, fontWeight: 700, fills: [solid(INK)] });
        const rows = ["Account", "Notifications", "Appearance", "Privacy", "Help", "Sign out"];
        const list = add("frame", { x: 24, y: 120, w: 342, h: rows.length * 52 }, f, { name: "Settings list", fills: [solid("#F5F5F5")], radius: 16, clip: true });
        rows.forEach((r, i) => {
            add("text", { x: 16, y: 16 + i * 52, w: 240, h: 20 }, list, { name: r, text: r, fontSize: 15, fills: [solid(INK)] });
            add("text", { x: 300, y: 14 + i * 52, w: 24, h: 22 }, list, { name: "Chevron", text: "›", fontSize: 18, fills: [solid(MUTED)] });
            if (i < rows.length - 1) add("rect", { x: 16, y: 51 + i * 52, w: 310, h: 1 }, list, { name: "Line", fills: [solid(LINE)] });
        });
    },
    empty: (add, f) => {
        add("ellipse", { x: 155, y: 300, w: 80, h: 80 }, f, { name: "Illustration", fills: [solid("#E5F4FF")] });
        add("text", { x: 0, y: 404, w: 390, h: 28 }, f, { name: "Title", text: "Nothing here yet", fontSize: 20, fontWeight: 600, textAlign: "center", fills: [solid(INK)], sizing: { h: "fixed", v: "hug" } });
        add("text", { x: 40, y: 440, w: 310, h: 40 }, f, { name: "Body", text: "When you add something it shows up here.", fontSize: 14, textAlign: "center", fills: [solid(MUTED)], sizing: { h: "fixed", v: "hug" } });
        const button = add("frame", { x: 95, y: 500, w: 200, h: 44 }, f, { name: "Button", fills: [solid(ACCENT)], radius: 22, clip: false });
        add("text", { x: 0, y: 12, w: 200, h: 20 }, button, { name: "Label", text: "Get started", fontSize: 15, fontWeight: 600, textAlign: "center", fills: [solid("#FFFFFF")], sizing: { h: "fixed", v: "hug" } });
    },
};

// Runs what the request asks for locally. Returns a reply, or null when nothing matched.
export function runLocalIntent(text: string): { reply: string; applied: string[] } | null {
    const t = text.toLowerCase();
    const applied: string[] = [];
    const has = editor.get().selection.length > 0;
    const say = (reply: string) => ({ reply, applied });

    if (/\b(tidy|polish|clean ?up|organi[sz]e)\b/.test(t)) {
        if (has && editor.get().selection.length > 1) {
            tidyUp();
            applied.push("Tidied the selection");
        }
        const renamed = renameGenericLayers();
        if (renamed) applied.push(`Renamed ${renamed} generic layer${renamed === 1 ? "" : "s"}`);
        const rounded = roundToPixel();
        if (rounded) applied.push(`Rounded ${rounded} layer${rounded === 1 ? "" : "s"} to whole pixels`);
        return say(applied.length ? "Tidied and polished." : "Everything already looks tidy: names are meaningful and positions sit on whole pixels.");
    }
    const gen = /\b(generate|create|make|build|design)\b.*\b(login|sign[- ]?in)\b/.test(t) ? "login" : /\b(sign[- ]?up|register|onboarding)\b/.test(t) ? "signup" : /\bsettings?\b/.test(t) && /\b(screen|page|generate|create|make|design)\b/.test(t) ? "settings" : /\bempty state\b/.test(t) ? "empty" : null;
    if (gen) {
        const builder = GENERATORS[gen];
        if (builder) {
            generateScreen(gen === "login" ? "Login" : gen === "signup" ? "Sign up" : gen === "settings" ? "Settings" : "Empty state", builder);
            applied.push(`Generated a ${gen} screen`);
            return say("Here's a first draft. Ask for changes, or edit it directly.");
        }
    }
    const colorWord = Object.keys(COLORS).find((c) => new RegExp(`\\b${c}\\b`).test(t));
    const hexMatch = /#([0-9a-f]{6})\b/i.exec(text);
    if ((colorWord || hexMatch) && /\b(fill|colou?r|make|paint|turn|background)\b/.test(t)) {
        const color = hexMatch ? `#${hexMatch[1]?.toUpperCase()}` : (COLORS[colorWord ?? ""] ?? "#000000");
        const n = patchSelection((node) => ({ fills: node.fills.length && node.fills[0]?.type === "solid" ? [{ ...node.fills[0], color }, ...node.fills.slice(1)] : [solid(color)] }));
        if (!n) return say("Select a layer first, then ask me to colour it.");
        applied.push(`Filled ${n} layer${n === 1 ? "" : "s"} with ${color}`);
        return say("Done.");
    }
    const radius = /\b(round|radius|corners?)\b/.test(t) ? /(\d+)/.exec(t)?.[1] : null;
    if (radius) {
        const n = patchSelection(() => ({ radius: Number(radius) }));
        if (!n) return say("Select a layer first.");
        applied.push(`Set the corner radius to ${radius} on ${n} layer${n === 1 ? "" : "s"}`);
        return say("Done.");
    }
    if (/\b(shadow)\b/.test(t)) {
        const n = patchSelection(() => ({ shadow: /\b(remove|no|drop the)\b/.test(t) ? null : { x: 0, y: 4, blur: 16, color: "#000000", opacity: 0.18 } }));
        if (!n) return say("Select a layer first.");
        applied.push(`${/\bremove|no\b/.test(t) ? "Removed" : "Added"} a shadow on ${n} layer${n === 1 ? "" : "s"}`);
        return say("Done.");
    }
    if (/\b(bigger|larger|scale up)\b/.test(t) || /\b(smaller|scale down)\b/.test(t)) {
        const k = /\b(bigger|larger|scale up)\b/.test(t) ? 1.25 : 0.8;
        const n = patchSelection((node) => ({ w: Math.max(1, Math.round(node.w * k)), h: Math.max(1, Math.round(node.h * k)) }));
        if (!n) return say("Select a layer first.");
        applied.push(`Scaled ${n} layer${n === 1 ? "" : "s"} by ${Math.round(k * 100)}%`);
        return say("Done.");
    }
    if (/\balign\b/.test(t) && has) {
        const mode = /\bleft\b/.test(t) ? "left" : /\bright\b/.test(t) ? "right" : /\btop\b/.test(t) ? "top" : /\bbottom\b/.test(t) ? "bottom" : /\bvertical/.test(t) ? "vcenter" : "hcenter";
        alignSelection(mode);
        applied.push(`Aligned ${mode}`);
        return say("Aligned.");
    }
    if (/\b(distribute|space (them )?evenly|even spacing)\b/.test(t) && has) {
        distributeSelection(/\bvertical/.test(t) ? "v" : "h");
        applied.push("Distributed spacing");
        return say("Spaced evenly.");
    }
    if (/\b(group)\b/.test(t) && has) {
        groupSelection();
        applied.push("Grouped the selection");
        return say("Grouped.");
    }
    if (/\b(component)\b/.test(t) && has) {
        createComponent();
        applied.push("Made a component");
        return say("It's a component now; find it in Assets.");
    }
    if (/\b(duplicate|copy)\b/.test(t) && has) {
        duplicateSelection();
        applied.push("Duplicated");
        return say("Duplicated.");
    }
    if (/\b(delete|remove)\b/.test(t) && has && !/\b(shadow|fill|stroke)\b/.test(t)) {
        deleteSelection();
        applied.push("Deleted the selection");
        return say("Deleted.");
    }
    if (/\b(dark|light) (mode|theme)\b/.test(t)) {
        const theme = /\bdark\b/.test(t) ? "dark" : "light";
        editor.setPrefs({ theme });
        applied.push(`Switched to the ${theme} theme`);
        return say("Switched.");
    }
    if (/\bselect all\b/.test(t)) {
        selectAll();
        applied.push("Selected everything");
        return say("Selected.");
    }
    if (/\bzoom\b/.test(t)) {
        if (has) zoomToSelection();
        else zoomToFit();
        return say("Zoomed.");
    }
    if (/\b(rename)\b/.test(t)) {
        const n = renameGenericLayers();
        applied.push(`Renamed ${n} layer${n === 1 ? "" : "s"}`);
        return say(n ? "Renamed the generic layers." : "Every layer already has a meaningful name.");
    }
    return null;
}

// ---- The model: the person's own key, or the server's shared one ----

export interface ModelReply {
    reply: string;
    commands?: Command[];
    // No key to use: the answer says where to add one.
    keyNeeded?: boolean;
    // The model couldn't answer (a rejected key, a busy model, the per-minute limit).
    error?: string;
}

export async function askModel(text: string, doc: NagmaDocument, selection: string[]): Promise<ModelReply | null> {
    try {
        // A compact view of the selection and the page keeps the request small.
        const summary = selection.map((id) => doc.nodes[id]).filter(Boolean).map((n) => ({ id: n!.id, type: n!.type, name: n!.name, x: n!.x, y: n!.y, w: n!.w, h: n!.h, fills: n!.fills.slice(0, 1), text: n!.text }));
        const res = await fetch(`${httpBase()}/ai/chat`, {
            method: "POST",
            headers: { "content-type": "application/json", ...aiRequestHeaders() },
            body: JSON.stringify({ text, selection: summary, pageId: editor.get().pageId }),
        });
        if (res.status === 404 || res.status === 501) return null;
        if (!res.ok) {
            const failure = await aiError(res);
            return keyNeeded(failure) ? { reply: "", keyNeeded: true } : { reply: "", error: failure.error };
        }
        return (await res.json()) as ModelReply;
    } catch (error) {
        console.warn("Agent model unavailable", error);
        return null;
    }
}

// Sends a message: local intents first (they're exact), then the model for the rest.
export async function sendToAgent(chatId: string, text: string): Promise<void> {
    update(chatId, (c) => ({ ...c, title: c.messages.length ? c.title : text.slice(0, 40), messages: [...c.messages, { role: "user", text }] }));
    const local = runLocalIntent(text);
    if (local) {
        update(chatId, (c) => ({ ...c, messages: [...c.messages, { role: "agent", text: local.reply, applied: local.applied }] }));
        return;
    }
    const { doc, selection } = editor.get();
    const model = await askModel(text, doc, selection);
    if (model?.keyNeeded || model?.error) {
        update(chatId, (c) => ({ ...c, messages: [...c.messages, { role: "agent", text: model.keyNeeded ? `${KEY_NEEDED} I can still tidy, rename, align, colour and generate common screens on my own.` : model.error ?? "", action: "ai-settings" }] }));
        return;
    }
    if (model) {
        const applied: string[] = [];
        if (model.commands?.length) {
            try {
                editor.execute({ type: "batch", commands: model.commands });
                applied.push(`Applied ${model.commands.length} change${model.commands.length === 1 ? "" : "s"}`);
            } catch (error) {
                applied.push(`Couldn't apply the changes: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        update(chatId, (c) => ({ ...c, messages: [...c.messages, { role: "agent", text: model.reply, applied }] }));
        return;
    }
    update(chatId, (c) => ({
        ...c,
        messages: [
            ...c.messages,
            {
                role: "agent",
                text: "I can do these on my own: tidy and polish, rename layers, generate a login / sign up / settings / empty-state screen, colour or round or scale the selection, add a shadow, align, distribute, group, make a component, duplicate, delete, zoom, switch theme. For open-ended asks, add your AI key in Account settings.",
                action: "ai-settings",
            },
        ],
    }));
}
