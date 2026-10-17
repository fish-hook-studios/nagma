import { nanoid } from "nanoid";
import { KEY_NEEDED, aiError, aiRequestHeaders, keyNeeded, onAiChange } from "../engine/ai-settings";
import { auth } from "../engine/auth";
import { buildTokens } from "../engine/design-tokens";
import { imageDataUrl, storeDataUrl, storeImage } from "../engine/image-store";
import { libraryPreviewDoc, loadManifest } from "../engine/library";
import { httpBase } from "../engine/server-url";
import { editor } from "../engine/store";
import type { NagmaDocument } from "../engine/types";
import { describeFrame, frameImage, framesToApp } from "./frames";
import { addTurn, applyAnswer, makeData, updateMake, writeFile } from "./model";
import { make, type AiStatus } from "./state";
import type { MakeAttachment, MakeTurn, PickedElement } from "./types";

// Sending a prompt: the model writes the project (POST /ai/make, streamed, with your own AI key or
// the server's shared one), or, with no key to use, attached frames are converted into a static app
// as they are.

export async function checkAi(): Promise<AiStatus> {
    let status: AiStatus;
    try {
        const res = await fetch(`${httpBase()}/ai/make`, { headers: aiRequestHeaders() });
        const data = (await res.json()) as Partial<AiStatus>;
        // Without a key nothing answers prompts; signed out the server doesn't say more.
        status = { available: Boolean(data.available), model: data.model ?? null, models: data.models ?? [], github: Boolean(data.github), signedIn: Boolean(data.signedIn), keyNeeded: !data.available, source: data.source, provider: data.provider };
    } catch {
        status = { available: false, model: null, signedIn: Boolean(auth.get().user), offline: true };
    }
    make.set({ ai: status });
    return status;
}
auth.onChange(() => void checkAi());
onAiChange(() => void checkAi());

// Pictures the model reads: PNG, JPEG, GIF or WebP, at most 1568 pixels on the long side.
async function modelImage(dataUrl: string): Promise<string> {
    const img = new Image();
    img.src = dataUrl;
    await img.decode().catch(() => undefined);
    const long = Math.max(img.naturalWidth, img.naturalHeight);
    const ok = /^data:image\/(png|jpeg|gif|webp);base64,/.test(dataUrl);
    if (ok && long <= 1568 && dataUrl.length < 3_000_000) return dataUrl;
    const scale = long > 1568 ? 1568 / long : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
}

// Adds a picture to the document (the media store) and to the prompt being written.
export async function attachImage(file: Blob, name: string) {
    const ref = await storeImage(file);
    const id = nanoid(12);
    editor.execute({ type: "image.add", id, data: ref });
    const attachment: MakeAttachment = { id: nanoid(8), kind: "image", name, image: id };
    make.set({ attachments: [...make.get().attachments, attachment] });
}

// Frames from a design file: each pictured and described; the whole set also converted into a
// static app straight away, for sending without a model.
export async function attachFrames(doc: NagmaDocument, ids: string[], fileName: string) {
    const out: MakeAttachment[] = [];
    const commands: { type: "image.add"; id: string; data: string }[] = [];
    for (const id of ids) {
        const node = doc.nodes[id];
        if (!node) continue;
        const picture = await frameImage(doc, id);
        const imageId = nanoid(12);
        commands.push({ type: "image.add", id: imageId, data: await storeDataUrl(picture) });
        out.push({ id: nanoid(8), kind: "frame", name: node.name, image: imageId, fileName, description: describeFrame(doc, id), w: Math.round(node.w), h: Math.round(node.h) });
    }
    if (!out.length) return;
    const first = out[0];
    if (first) first.offline = await framesToApp(doc, ids.filter((id) => doc.nodes[id]), editor.get().doc.name || "App");
    editor.execute({ type: "batch", commands });
    make.set({ attachments: [...make.get().attachments, ...out] });
}

export function removeAttachment(id: string) {
    make.set({ attachments: make.get().attachments.filter((a) => a.id !== id) });
}

// The design system for the prompt: the library's variables and styles as CSS variables (also
// written to src/design-system.css, which every page loads) and its components with descriptions.
async function designSystem(libraryId: string | null | undefined): Promise<string> {
    if (!libraryId) return "";
    const manifest = await loadManifest(libraryId).catch(() => null);
    if (!manifest) return "";
    const { css } = buildTokens(manifest);
    if (makeData(editor.get().doc).files["src/design-system.css"] !== css) writeFile("src/design-system.css", css);
    const listed = manifest.components.filter((c) => !c.hidden);
    const components = listed.slice(0, 200).map((c) => `- ${c.name}${c.description ? `: ${c.description.replace(/\s+/g, " ").slice(0, 300)}` : ""}`);
    // The first components' layers too (sizes, colours, type, text), so the app's versions of them
    // match the library's.
    const layers: string[] = [];
    let budget = 40000;
    for (const c of listed.slice(0, 16)) {
        if (budget <= 0) break;
        const doc = await libraryPreviewDoc(libraryId, c.id, c.hash).catch(() => null);
        if (!doc?.nodes[c.id]) continue;
        const target = doc.nodes[c.id]?.type === "componentSet" ? (doc.nodes[c.id]?.children[0] ?? c.id) : c.id;
        const text = describeFrame(doc, target, Math.min(6000, budget));
        budget -= text.length;
        layers.push(`Component "${c.name}" (build it as a React component in src/components when the app needs it):\n${text}`);
    }
    return [`Library "${manifest.name}" (version ${manifest.version}).`, `CSS variables, in src/design-system.css:\n${css}`, components.length ? `Components:\n${components.join("\n")}` : "", ...layers].filter(Boolean).join("\n\n");
}

// Where the picked element is in the code: its file, line and the lines around it.
export function elementContext(picked: PickedElement, files: Record<string, string>): string {
    const [path, lineText] = [picked.src.slice(0, picked.src.lastIndexOf(":")), picked.src.slice(picked.src.lastIndexOf(":") + 1)];
    const line = Number(lineText);
    const source = files[path] ?? "";
    const lines = source.split("\n");
    const from = Math.max(0, line - 4);
    const snippet = lines
        .slice(from, line + 5)
        .map((l, i) => `${from + i + 1}${from + i + 1 === line ? ">" : " "} ${l}`)
        .join("\n");
    return `<${picked.tag}> in ${path} at line ${line}${picked.text ? `, showing "${picked.text.slice(0, 120)}"` : ""}.\n${snippet}`;
}

const historyText = (t: MakeTurn) => (t.role === "assistant" ? `${t.text}${t.changed?.length ? `\n(Changed: ${t.changed.join(", ")})` : ""}` : `${t.text}${t.attachments?.length ? `\n(Attached: ${t.attachments.map((a) => a.name).join(", ")})` : ""}`);

// MCP connectors' tokens: kept only in this tab's memory and sent with each request.
const connectorTokens = new Map<string, string>();
export const setConnectorToken = (name: string, token: string) => (token ? connectorTokens.set(name, token) : connectorTokens.delete(name));
export const hasConnectorToken = (name: string) => connectorTokens.has(name);

function finish() {
    make.set({ busy: null });
    // Prompts written while the answer was being made go next, one at a time.
    const [next, ...rest] = make.get().queue;
    if (next !== undefined) {
        make.set({ queue: rest, prompt: next });
        window.setTimeout(() => void send(), 0);
    }
}

export function stop() {
    make.get().busy?.abort?.abort();
    finish();
}

export async function send() {
    const s = make.get();
    let prompt = s.prompt.trim();
    if (editor.get().readOnly) return;
    if (!prompt && !s.attachments.length) return;
    // Busy with an answer: this prompt waits its turn.
    if (s.busy) {
        if (prompt) make.set({ queue: [...s.queue, prompt], prompt: "" });
        return;
    }
    // "/plan …" plans whatever the mode.
    let mode = s.mode;
    if (/^\/plan\b/i.test(prompt)) {
        mode = "plan";
        prompt = prompt.replace(/^\/plan\b\s*/i, "");
        if (!prompt && !s.attachments.length) return;
    }
    const ai = s.ai ?? (await checkAi());
    const data = makeData(editor.get().doc);
    const history = data.turns.filter((t) => !t.error);
    const picked = s.picked;
    const element = picked ? elementContext(picked, data.files) : undefined;
    const attachments = s.attachments;
    const offlineApp = attachments.find((a) => a.offline)?.offline;
    const text = prompt || (attachments.some((a) => a.kind === "frame") ? "Build an app from this design." : "Build an app from this picture.");
    addTurn({ role: "user", text, author: auth.get().user?.name ?? editor.get().doc.name, attachments: attachments.map(({ offline: _offline, ...a }) => a), ...(element ? { element: `<${picked?.tag}> ${picked?.src}` } : {}) });
    make.set({ prompt: "", attachments: [], picked: null, picks: [], picking: false });

    // No model here: frames become an app as they are; anything else gets a notice.
    if (!ai.available) {
        if (offlineApp) {
            applyAnswer(`${ai.offline ? "The server can't be reached, so" : "There's no AI key to use, so"} I built the app from the design as it is, without the model. Edit the code by hand, or add your AI key in Account settings to change it with prompts.`, offlineApp, [], { offline: true });
            make.set({ view: "preview" });
        } else {
            addTurn({ role: "assistant", text: ai.offline ? "The server can't be reached, so prompts can't be answered. Attach design frames to turn them into a static app, or edit the code by hand." : `${KEY_NEEDED} Without a key, attach design frames to turn them into a static app, or edit the code by hand.`, error: true });
        }
        return;
    }

    const abort = new AbortController();
    const fileId = editor.get().fileId;
    make.set({ busy: { status: "Starting", files: [], startedAt: Date.now(), abort } });
    try {
        const doc = editor.get().doc;
        const images: { label: string; data: string }[] = [];
        for (const a of attachments) {
            const url = await imageDataUrl(doc.images, a.image);
            if (url) images.push({ label: a.kind === "frame" ? `Design frame "${a.name}"${a.fileName ? ` from ${a.fileName}` : ""}` : a.name, data: await modelImage(url) });
        }
        const ds = await designSystem(data.libraryId);
        const files = Object.entries(makeData(editor.get().doc).files).map(([path, content]) => ({ path, content }));
        const body = {
            prompt: text,
            history: history.map((t) => ({ role: t.role, text: historyText(t) })),
            files,
            images,
            frames: attachments.filter((a) => a.kind === "frame").map((a) => ({ name: a.name, description: a.description ?? "" })),
            designSystem: ds,
            element,
            mode,
            model: data.model ?? undefined,
            web: Boolean(data.web),
            backend: Boolean(data.backend),
            mcp: (data.connectors ?? []).map((c) => ({ name: c.name, url: c.url, token: connectorTokens.get(c.name) })),
        };
        const res = await fetch(`${httpBase()}/ai/make`, { method: "POST", headers: { "content-type": "application/json", ...aiRequestHeaders() }, body: JSON.stringify(body), signal: abort.signal });
        if (!res.ok || !res.body) {
            const failure = await aiError(res);
            if (keyNeeded(failure) || res.status === 501 || res.status === 401) void checkAi();
            throw new Error(failure.error);
        }
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        type Result = { message: string; files: { path: string; content: string }[]; deleted: string[]; plan?: string[] };
        let result: Result | null = null;
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            let at: number;
            while ((at = buffer.indexOf("\n\n")) >= 0) {
                const raw = buffer.slice(0, at);
                buffer = buffer.slice(at + 2);
                const event = /^event: (.+)$/m.exec(raw)?.[1];
                const payload = raw
                    .split("\n")
                    .filter((l) => l.startsWith("data: "))
                    .map((l) => l.slice(6))
                    .join("\n");
                if (!event || !payload) continue;
                const d = JSON.parse(payload) as Partial<Result> & { text?: string; path?: string; chars?: number };
                const busy = make.get().busy;
                if (!busy) continue;
                if (event === "status" || event === "thinking") make.set({ busy: { ...busy, status: d?.text ?? busy.status } });
                if (event === "file" && d?.path) make.set({ busy: { ...busy, status: `Writing ${d.path}`, files: [...busy.files, d.path] } });
                if (event === "progress") make.set({ busy: { ...busy, status: busy.files.length ? `Writing ${busy.files[busy.files.length - 1]}` : "Writing code" } });
                if (event === "error") throw new Error(d?.message ?? "The model stopped with an error.");
                if (event === "done") result = { message: d.message ?? "", files: d.files ?? [], deleted: d.deleted ?? [], plan: (d as { plan?: string[] }).plan };
            }
        }
        if (!result) throw new Error("The answer stopped before it was finished.");
        // Another file was opened meanwhile: the answer isn't written into it.
        if (editor.get().fileId !== fileId) return;
        if (mode === "plan") {
            addTurn({ role: "assistant", text: result.message || "Here's the plan.", plan: result.plan ?? [], planState: "proposed", model: data.model ?? undefined });
            return;
        }
        const written: Record<string, string> = {};
        for (const f of result.files) written[f.path] = f.content;
        applyAnswer(result.message || "Done.", written, result.deleted ?? [], data.model ? { model: data.model } : {});
        make.set({ view: "preview", error: null });
    } catch (error) {
        if (editor.get().fileId !== fileId) return;
        if (abort.signal.aborted) addTurn({ role: "assistant", text: "Stopped.", error: true });
        else addTurn({ role: "assistant", text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
        finish();
    }
}

// The preview's error, sent back to the model to fix.
export function fixError(message: string) {
    make.set({ prompt: `The app shows this error. Fix it:\n${message}` });
    void send();
}

export async function pastedImage(file: File) {
    if (!file.type.startsWith("image/")) return;
    await attachImage(file, file.name || "Pasted picture");
}

// Plan mode: the person approves a proposed plan (and it's built), or sets it aside.
export function answerPlan(turnId: string, approve: boolean) {
    const data = makeData(editor.get().doc);
    const turn = data.turns.find((t) => t.id === turnId);
    if (!turn?.plan) return;
    updateMake((d) => ({ ...d, turns: d.turns.map((t) => (t.id === turnId ? { ...t, planState: approve ? "approved" : "dismissed" } : t)) }));
    if (!approve) return;
    make.set({ mode: "build", prompt: `Build the plan we agreed:\n${turn.plan.map((step, i) => `${i + 1}. ${step}`).join("\n")}` });
    void send();
}
