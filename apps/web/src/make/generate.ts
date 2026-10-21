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
    // The website's recording mode behaves like a configured model (see demoAnswer below).
    if (import.meta.env.VITE_MAKE_DEMO === "1") {
        const status: AiStatus = { available: true, model: "demo", models: [], github: false, signedIn: false, keyNeeded: false };
        make.set({ ai: status });
        return status;
    }
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
    if (import.meta.env.VITE_MAKE_DEMO === "1" && !offlineApp) {
        await demoAnswer(text);
        return;
    }
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

// A staged, canned answer for recording the website's Make loop (VITE_MAKE_DEMO=1 at build time;
// never on in a normal build). It walks the same busy states a real answer does, then writes a small
// app named after the prompt. No model is involved and no key is read.
async function demoAnswer(prompt: string) {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const fileId = editor.get().fileId;
    const abort = new AbortController();
    make.set({ busy: { status: "Thinking", files: [], startedAt: Date.now(), abort } });
    const title = prompt.replace(/^(a|an|the)\s+/i, "").split(/[.,]/)[0].trim().replace(/^./, (c) => c.toUpperCase()).slice(0, 40) || "My app";
    // The recording can hand in its own app (files and the reply) on the window; otherwise the routine app below.
    const staged = (window as unknown as { __nagmaDemoApp?: { files: Record<string, string>; reply: string } }).__nagmaDemoApp;
    const files: Record<string, string> = staged?.files ?? {
        "index.html": `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>\n<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>\n</html>\n`,
        "src/main.tsx": `import { createRoot } from "react-dom/client";\nimport { App } from "./App";\nimport "./styles.css";\n\ncreateRoot(document.getElementById("root")!).render(<App />);\n`,
        "src/App.tsx": `import { useState } from "react";\n\nconst DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];\nconst DATES = [7, 8, 9, 10, 11, 12, 13];\nconst START = [\n  { name: "Drink a glass of water", streak: 3, mins: 5, icon: "🥤", done: true },\n  { name: "Meditate to relax", streak: 6, mins: 15, icon: "🧘", done: true },\n  { name: "Stretch for 10 minutes", streak: 5, mins: 10, icon: "🤸", done: false },\n  { name: "Go for a short walk", streak: 3, mins: 20, icon: "🚶", done: false },\n];\nconst STATS = [\n  { label: "Walking", pct: 48, color: "#5b3a2b" },\n  { label: "Running", pct: 33, color: "#8a5a3c" },\n  { label: "Meditation", pct: 27, color: "#8da84a" },\n  { label: "Drink", pct: 40, color: "#e08ac9" },\n];\n\nexport function App() {\n  const [routine, setRoutine] = useState(START);\n  const [view, setView] = useState<"today" | "progress">("today");\n  const toggle = (i: number) => setRoutine((r) => r.map((x, j) => (j === i ? { ...x, done: !x.done } : x)));\n  const done = routine.filter((r) => r.done).length;\n  if (view === "progress")\n    return (\n      <main className="app">\n        <header className="top">\n          <h1>Your progress<br />and insights</h1>\n          <button className="close" onClick={() => setView("today")} aria-label="Close">×</button>\n        </header>\n        <section className="chart">\n          {STATS.map((s) => (\n            <div className="col" key={s.label}>\n              <div className="track"><div className="bar" style={{ height: s.pct + "%", background: s.color }}><span>{s.pct}%</span></div></div>\n              <b>{s.label}</b>\n            </div>\n          ))}\n        </section>\n        <section className="points">\n          <div className="row"><div><b>Points earned</b><small>For this week</small></div><strong>842 <span>Points</span></strong></div>\n          <div className="facts"><div><small>Post</small><b>440 lb</b></div><div><small>Forest area</small><b>200 ft²</b></div><div><small>Time</small><b>7h 30m</b></div></div>\n          <button className="primary">Share progress</button>\n        </section>\n      </main>\n    );\n  return (\n    <main className="app">\n      <header className="top">\n        <div><h1>Morning, Ash</h1><p>Thursday, 10 March</p></div>\n        <div className="avatar">A</div>\n      </header>\n      <div className="week">\n        {DAYS.map((d, i) => (\n          <div className={"day" + (i === 3 ? " on" : "")} key={d}><small>{d}</small><b>{DATES[i]}</b></div>\n        ))}\n      </div>\n      <section className="remind">\n        <div><b>Set the reminder</b><p>Never miss your morning routine. Set a reminder to stay on track.</p><button className="small">Set now</button></div>\n        <span className="bell">🔔</span>\n      </section>\n      <div className="rowhead"><b>Daily routine</b><a onClick={() => setView("progress")}>See all</a></div>\n      <ul className="list">\n        {routine.map((r, i) => (\n          <li key={r.name} className={r.done ? "done" : ""}>\n            <button className="check" onClick={() => toggle(i)} aria-label={r.name} />\n            <span className="icon">{r.icon}</span>\n            <div><b>{r.name}</b><small>Streak {r.streak} days</small></div>\n            <em>{r.mins} min</em>\n          </li>\n        ))}\n      </ul>\n      <p className="count">{done} of {routine.length} done</p>\n      <button className="fab" aria-label="Add">+</button>\n    </main>\n  );\n}\n`,
        "src/styles.css": `:root { font-family: Inter, system-ui, sans-serif; color: #2b1d16; background: #d9e7f4; }\nbody { margin: 0; padding: 24px 16px; }\n.app { max-width: 400px; margin: 0 auto; padding: 28px 20px 96px; position: relative; min-height: calc(100vh - 48px); box-sizing: border-box; background: #fff; border-radius: 28px; box-shadow: 0 20px 60px -30px rgba(20,20,19,.35); }\n.top { display: flex; justify-content: space-between; align-items: flex-start; }\nh1 { font-size: 28px; line-height: 1.15; margin: 0; font-weight: 600; }\n.top p { margin: 4px 0 0; color: #7a6a60; font-size: 14px; }\n.avatar { width: 44px; height: 44px; border-radius: 50%; background: #f5c842; display: grid; place-items: center; font-weight: 700; }\n.close { width: 40px; height: 40px; border-radius: 50%; border: 0; background: #fff; font-size: 22px; cursor: pointer; }\n.week { display: flex; justify-content: space-between; margin: 24px 0 18px; }\n.day { text-align: center; }\n.day small { display: block; color: #9a8b80; font-size: 12px; margin-bottom: 8px; }\n.day b { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: #f6efe8; font-weight: 600; }\n.day.on b { background: #2b1d16; color: #fff; }\n.remind { display: flex; align-items: center; justify-content: space-between; background: #ffd9c2; border-radius: 18px; padding: 18px; gap: 12px; }\n.remind b { display: block; font-size: 16px; }\n.remind p { margin: 6px 0 12px; font-size: 13px; color: #7a6a60; }\n.small { padding: 8px 14px; border-radius: 10px; border: 0; background: #2b1d16; color: #fff; font-weight: 600; }\n.bell { font-size: 44px; }\n.rowhead { display: flex; justify-content: space-between; align-items: baseline; margin: 24px 0 12px; }\n.rowhead b { font-size: 18px; }\n.rowhead a { color: #e86f1e; font-size: 13px; font-weight: 600; cursor: pointer; }\n.list { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }\n.list li { display: grid; grid-template-columns: 24px 44px 1fr auto; gap: 12px; align-items: center; background: #f6efe8; border-radius: 16px; padding: 12px 14px; }\n.check { width: 20px; height: 20px; border-radius: 50%; border: 2px solid #d9cfc7; background: #fff; cursor: pointer; }\n.done .check { background: #e86f1e; border-color: #e86f1e; }\n.icon { width: 44px; height: 44px; border-radius: 12px; background: #fbe9dc; display: grid; place-items: center; font-size: 22px; }\n.list b { display: block; font-size: 15px; }\n.list small { color: #9a8b80; font-size: 12px; }\n.list em { font-style: normal; font-size: 12px; color: #7a6a60; }\n.count { text-align: center; color: #9a8b80; font-size: 13px; margin-top: 16px; }\n.fab { position: absolute; right: 20px; bottom: 28px; width: 56px; height: 56px; border-radius: 50%; border: 0; background: #2b1d16; color: #fff; font-size: 28px; cursor: pointer; }\n.chart { display: flex; gap: 12px; height: 300px; margin: 28px 0; }\n.col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 10px; }\n.track { flex: 1; width: 100%; border-radius: 999px; background: repeating-linear-gradient(135deg, #e8dfd7 0 6px, #fbf7f3 6px 12px); display: flex; align-items: flex-end; overflow: hidden; }\n.bar { width: 100%; border-radius: 999px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 14px; box-sizing: border-box; color: #fff; font-weight: 600; font-size: 14px; }\n.col b { font-size: 13px; font-weight: 500; }\n.points { background: #f6efe8; border-radius: 20px; padding: 20px; }\n.points .row { display: flex; justify-content: space-between; align-items: center; }\n.points small { display: block; color: #9a8b80; font-size: 12px; }\n.points strong { font-size: 22px; color: #e86f1e; }\n.points strong span { font-size: 14px; color: #7a6a60; font-weight: 500; }\n.facts { display: flex; justify-content: space-between; margin: 18px 0; }\n.facts b { display: block; font-size: 16px; }\n.primary { width: 100%; padding: 16px; border-radius: 999px; border: 0; background: #ff7a1a; color: #fff; font-weight: 700; font-size: 16px; cursor: pointer; }\n`,
    };
    try {
        await wait(1400);
        const busy = () => make.get().busy;
        if (!busy()) return;
        make.set({ busy: { ...busy()!, status: "Planning the layout" } });
        await wait(1200);
        for (const path of Object.keys(files)) {
            const b = busy();
            if (!b) return;
            make.set({ busy: { ...b, status: `Writing ${path}`, files: [...b.files, path] } });
            await wait(path === "src/App.tsx" ? 1800 : 700);
        }
        if (editor.get().fileId !== fileId) return;
        applyAnswer(staged?.reply ?? `Here's ${title}: a greeting with the week, a reminder card, the daily routine with streaks and a tap to tick each one off, and a progress screen with this week's chart and points. Tell me what to change.`, files, []);
        make.set({ view: "preview", error: null });
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
