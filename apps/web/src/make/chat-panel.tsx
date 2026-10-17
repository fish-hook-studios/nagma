import { AlertCircle, ArrowUp, Attachment01, ClockRewind, CursorClick02, File04, Image01, Grid01, Settings01, Stars02, StopCircle, X } from "@untitledui/icons";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover } from "react-aria-components";
import { MenuRow } from "../components/left-sidebar";
import { Select } from "../components/select";
import { KEY_NEEDED, openAiSettings } from "../engine/ai-settings";
import { imageSrc, onImageReady } from "../engine/image-store";
import { refreshLibraries, useLibrarySummaries } from "../engine/library";
import { editor, useEditor } from "../engine/store";
import { selectionInDesign } from "./frames";
import { answerPlan, attachFrames, attachImage, checkAi, removeAttachment, send, stop } from "./generate";
import { makeData, restoreTurn, setLibrary } from "./model";
import { sourceOf } from "./point-edit";
import { make, useMake } from "./state";
import type { MakeAttachment, MakeTurn, PickedElement } from "./types";

// The chat beside the preview: the conversation (each answer listing the files it changed, with
// "Restore this version"), what's being generated, the element picked in the preview, and the
// prompt box with its attachments and design system.

let imageTick = 0;
onImageReady(() => imageTick++);
function useImage(id: string): string | null {
    const images = useEditor((s) => s.doc.images);
    useSyncExternalStore(onImageReady, () => imageTick);
    return imageSrc(images, id);
}

function AttachmentChip({ a, onRemove }: { a: MakeAttachment; onRemove?: () => void }) {
    const src = useImage(a.image);
    return (
        <span className="group relative flex items-center gap-1.5 rounded-md border border-panel-border bg-field py-1 pr-2 pl-1 text-[11px] text-ink" title={a.fileName ? `${a.name} in ${a.fileName}` : a.name}>
            {src ? <img src={src} alt="" className="size-7 rounded object-cover" /> : <span className="size-7 rounded bg-panel-hover" />}
            <span className="flex min-w-0 flex-col leading-tight">
                <span className="max-w-32 truncate">{a.name}</span>
                <span className="text-[10px] text-ink-subtle">{a.kind === "frame" ? "Frame" : "Picture"}</span>
            </span>
            {onRemove && (
                <button type="button" aria-label={`Remove ${a.name}`} onClick={onRemove} className="ml-0.5 flex size-4 items-center justify-center rounded text-ink-subtle hover:text-ink">
                    <X className="size-3" />
                </button>
            )}
        </span>
    );
}

function Turn({ turn, latest, readOnly }: { turn: MakeTurn; latest: boolean; readOnly: boolean }) {
    if (turn.role === "user") {
        return (
            <div className="flex flex-col items-end gap-1.5">
                {turn.attachments?.length ? (
                    <div className="flex flex-wrap justify-end gap-1">
                        {turn.attachments.map((a) => (
                            <AttachmentChip key={a.id} a={a} />
                        ))}
                    </div>
                ) : null}
                {turn.element && (
                    <span className="flex items-center gap-1 rounded bg-field px-1.5 py-0.5 font-mono text-[10.5px] text-ink-muted">
                        <CursorClick02 className="size-3" />
                        {turn.element}
                    </span>
                )}
                <div className="max-w-[92%] rounded-xl rounded-br-sm bg-brand-500 px-3 py-2 text-[12px] leading-relaxed break-words whitespace-pre-wrap text-white">{turn.text}</div>
            </div>
        );
    }
    return (
        <div className="flex gap-2">
            <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${turn.error ? "bg-red-500/15 text-red-500" : "bg-brand-500/15 text-brand-500"}`}>{turn.error ? <AlertCircle className="size-3" /> : <Stars02 className="size-3" />}</span>
            <div className="min-w-0 flex-1">
                <div className={`text-[12px] leading-relaxed break-words whitespace-pre-wrap ${turn.error ? "text-ink-muted" : "text-ink"}`}>{turn.text}</div>
                {turn.plan && (
                    <div className="mt-1.5 overflow-hidden rounded-lg border border-panel-border">
                        <div className="border-b border-panel-border bg-field px-2 py-1 text-[10.5px] font-semibold text-ink-muted">Plan</div>
                        <ol className="list-decimal space-y-1 py-1.5 pr-2 pl-6 text-[11.5px] text-ink">
                            {turn.plan.map((step, i) => (
                                <li key={i}>{step}</li>
                            ))}
                        </ol>
                        {turn.planState === "proposed" && !readOnly ? (
                            <div className="flex gap-1.5 border-t border-panel-border p-1.5">
                                <button type="button" onClick={() => answerPlan(turn.id, true)} className="h-6 rounded-md bg-brand-500 px-2 text-[11px] font-semibold text-white">
                                    Build this plan
                                </button>
                                <button type="button" onClick={() => answerPlan(turn.id, false)} className="h-6 rounded-md px-2 text-[11px] text-ink-muted hover:bg-panel-hover hover:text-ink">
                                    Dismiss
                                </button>
                            </div>
                        ) : (
                            <div className="border-t border-panel-border px-2 py-1 text-[10.5px] text-ink-subtle">{turn.planState === "approved" ? "Approved" : turn.planState === "dismissed" ? "Dismissed" : ""}</div>
                        )}
                    </div>
                )}
                {(turn.changed?.length || turn.removed?.length) ? (
                    <div className="mt-1.5 overflow-hidden rounded-lg border border-panel-border">
                        <div className="border-b border-panel-border bg-field px-2 py-1 text-[10.5px] font-semibold text-ink-muted">
                            {(turn.changed?.length ?? 0) + (turn.removed?.length ?? 0) === 1 ? "1 file changed" : `${(turn.changed?.length ?? 0) + (turn.removed?.length ?? 0)} files changed`}
                        </div>
                        {turn.changed?.map((p) => (
                            <button key={p} type="button" onClick={() => make.set({ view: "code", openFile: p })} className="flex w-full items-center gap-1.5 px-2 py-1 text-left font-mono text-[10.5px] text-ink hover:bg-panel-hover">
                                <File04 className="size-3 shrink-0 text-ink-subtle" />
                                <span className="truncate">{p}</span>
                            </button>
                        ))}
                        {turn.removed?.map((p) => (
                            <div key={p} className="flex items-center gap-1.5 px-2 py-1 font-mono text-[10.5px] text-ink-subtle line-through">
                                <File04 className="size-3 shrink-0" />
                                <span className="truncate">{p}</span>
                            </div>
                        ))}
                    </div>
                ) : null}
                {turn.snapshot && !readOnly && !latest && (
                    <button type="button" onClick={() => {
                            if (!restoreTurn(turn.id)) return editor.notify("That version can't be restored.");
                            make.set({ picked: null, picks: [] });
                        }} className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink">
                        <ClockRewind className="size-3" /> Restore this version
                    </button>
                )}
            </div>
        </div>
    );
}

function Busy() {
    const busy = useMake((s) => s.busy);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!busy) return;
        const t = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(t);
    }, [busy]);
    if (!busy) return null;
    const seconds = Math.max(0, Math.round((now - busy.startedAt) / 1000));
    return (
        <div className="flex gap-2" role="status" aria-live="polite">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-500">
                <Stars02 className="size-3 animate-pulse" />
            </span>
            <div className="min-w-0 flex-1 text-[12px]">
                <div className="flex items-center gap-2 text-ink">
                    <span className="truncate">{busy.status}</span>
                    <span className="shrink-0 text-[11px] text-ink-subtle">{seconds}s</span>
                </div>
                {busy.files.length > 0 && (
                    <div className="mt-1 flex flex-col gap-0.5">
                        {busy.files.map((p, i) => (
                            <span key={p} className="flex items-center gap-1.5 font-mono text-[10.5px] text-ink-muted">
                                <span className={`size-1.5 rounded-full ${i === busy.files.length - 1 ? "animate-pulse bg-brand-500" : "bg-emerald-500"}`} />
                                {p}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// Point and edit: the picked element, its text and colours to change directly, or a prompt for it.
function PickedCard() {
    const picked = useMake((s) => s.picked);
    return picked ? <PickedEditor key={`${picked.src}|${picked.text}`} picked={picked} /> : null;
}

function PickedEditor({ picked }: { picked: PickedElement }) {
    const picks = useMake((s) => s.picks);
    const { path, line } = sourceOf(picked);
    return (
        <div className="mx-3 mb-2 rounded-lg border border-brand-500/50 bg-brand-500/5 p-2 text-[11px]">
            <div className="flex items-center gap-1.5">
                <CursorClick02 className="size-3.5 text-brand-500" />
                <span className="font-mono text-ink">{picks.length > 1 ? `${picks.length} elements` : `<${picked.tag}>`}</span>
                <button type="button" onClick={() => make.set({ view: "code", openFile: path })} className="min-w-0 truncate font-mono text-ink-muted hover:text-ink" title="Show in Code">
                    {path}:{line}
                </button>
                <button type="button" aria-label="Clear the selected element" onClick={() => make.set({ picked: null, picks: [] })} className="ml-auto flex size-5 items-center justify-center rounded text-ink-subtle hover:text-ink">
                    <X className="size-3" />
                </button>
            </div>
            <div className="mt-1.5 text-ink-subtle">Change it in the properties panel, or describe a change below.</div>
        </div>
    );
}

function Notice() {
    const ai = useMake((s) => s.ai);
    if (!ai || ai.available) return null;
    return (
        <div className="mx-3 mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11.5px] leading-relaxed text-ink">
            {ai.offline ? (
                <>The server can't be reached, so prompts can't be answered. Attach frames from a design file to turn them into an app, or edit the code by hand.</>
            ) : (
                <>
                    <span className="font-semibold">{KEY_NEEDED}</span> You can still attach frames from a design file and send them: they become a static React app, built as they are.{" "}
                    <button type="button" onClick={openAiSettings} className="font-semibold text-brand-500 hover:underline">
                        Open AI settings
                    </button>
                </>
            )}
        </div>
    );
}

function DesignSystem() {
    const libraryId = useEditor((s) => makeData(s.doc).libraryId ?? null);
    const readOnly = useEditor((s) => s.readOnly);
    const libraries = useLibrarySummaries();
    useEffect(() => void refreshLibraries().catch(() => undefined), []);
    if (!libraries.length && !libraryId) return null;
    return (
        <Select aria-label="Design system" title="Include a library's variables, styles and components in prompts" value={libraryId ?? ""} disabled={readOnly} onChange={(e) => setLibrary(e.target.value || null)} className="h-6 max-w-40 rounded-md bg-field pr-6 pl-2 text-[11px] text-ink">
            <option value="">No design system</option>
            {libraries.map((l) => (
                <option key={l.id} value={l.id}>
                    {l.name}
                </option>
            ))}
        </Select>
    );
}

function Composer() {
    const prompt = useMake((s) => s.prompt);
    const attachments = useMake((s) => s.attachments);
    const busy = useMake((s) => s.busy !== null);
    const picked = useMake((s) => s.picked);
    const ai = useMake((s) => s.ai);
    const readOnly = useEditor((s) => s.readOnly);
    const picking = useMake((s) => s.picking);
    const mode = useMake((s) => s.mode);
    const queue = useMake((s) => s.queue);
    const input = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);
    if (readOnly) return <div className="border-t border-panel-border p-3 text-[11.5px] text-ink-muted">This file is view only.</div>;
    const addFiles = (list: FileList | File[]) => {
        for (const f of [...list]) if (f.type.startsWith("image/")) void attachImage(f, f.name || "Picture");
    };
    const selection = selectionInDesign();
    // While an answer is being made, more prompts can be written; they're sent in turn.
    const canSend = prompt.trim().length > 0 || (!busy && attachments.length > 0);
    const placeholder = busy ? "Add another prompt; it's sent when this answer is done" : mode === "plan" ? "Describe what to plan…" : picked ? `Describe a change to this <${picked.tag}>…` : ai && !ai.available ? "Attach frames to build from, or describe your app…" : Object.keys(makeData(editor.get().doc).files).length ? "Ask for changes" : "Describe the app you want…";
    return (
        <div
            className={`m-4 mt-0 rounded-[13px] border bg-field ${dragging ? "border-brand-500" : "border-panel-border"} focus-within:border-brand-500`}
            onDragOver={(e) => {
                if (![...e.dataTransfer.types].includes("Files")) return;
                e.preventDefault();
                setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
            }}
        >
            {queue.length > 0 && (
                <div className="flex flex-col gap-1 p-2 pb-0">
                    {queue.map((q, i) => (
                        <span key={i} className="flex items-center gap-1.5 rounded-md bg-panel px-2 py-1 text-[11px] text-ink-muted">
                            <span className="shrink-0 text-ink-subtle">Next {i + 1}</span>
                            <span className="min-w-0 flex-1 truncate">{q}</span>
                            <button type="button" aria-label="Remove this queued prompt" onClick={() => make.set({ queue: make.get().queue.filter((_, n) => n !== i) })} className="text-ink-subtle hover:text-ink">
                                <X className="size-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
            {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1 p-2 pb-0">
                    {attachments.map((a) => (
                        <AttachmentChip key={a.id} a={a} onRemove={() => removeAttachment(a.id)} />
                    ))}
                </div>
            )}
            <textarea
                aria-label="Prompt"
                value={prompt}
                placeholder={placeholder}
                rows={3}
                onChange={(e) => make.set({ prompt: e.target.value })}
                onPaste={(e) => {
                    const images = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
                    if (images.length) {
                        e.preventDefault();
                        addFiles(images);
                    }
                }}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        if (canSend) void send();
                    }
                }}
                className="block max-h-60 min-h-[120px] w-full resize-none bg-transparent px-3 pt-3 pb-2 text-[12.5px] text-ink outline-none placeholder:text-ink-subtle"
            />
            <div className="flex items-center gap-1 px-2 pb-2">
                <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
                <AriaMenuTrigger>
                    <AriaButton aria-label="Attach" className="flex size-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-brand-500">
                        <Attachment01 className="size-4" />
                    </AriaButton>
                    <AriaPopover placement="top start" offset={6} className="w-64 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                        <AriaMenu
                            aria-label="Attach"
                            className="outline-none"
                            onAction={(key) => {
                                if (key === "image") input.current?.click();
                                if (key === "frames") make.set({ attachOpen: true });
                                if (key === "selection" && selection) void attachFrames(selection.doc, selection.ids, selection.fileName);
                            }}
                        >
                            <MenuRow id="image" label="Picture from this computer…" icon={Image01} />
                            <MenuRow id="frames" label="Frames from a design file…" icon={Grid01} />
                            {selection && <MenuRow id="selection" label={`Current selection in ${selection.fileName}`} />}
                        </AriaMenu>
                    </AriaPopover>
                </AriaMenuTrigger>
                <button
                    type="button"
                    aria-label="Point and edit"
                    aria-pressed={picking}
                    title="Point and edit: pick an element in the preview"
                    onClick={() => make.set({ picking: !picking, view: "preview" })}
                    className={`flex size-7 items-center justify-center rounded-md outline-none ${picking ? "bg-brand-500 text-white" : "text-ink-muted hover:bg-panel-hover hover:text-ink"}`}
                >
                    <CursorClick02 className="size-4" />
                </button>
                <Select aria-label="Mode" title="Plan: the model proposes the steps first, for you to approve. Build: it changes the code." value={mode} onChange={(e) => make.set({ mode: e.target.value as "build" })} className="h-6 rounded-md bg-field pr-6 pl-2 text-[11px] text-ink">
                    <option value="build">Build</option>
                    <option value="plan">Plan</option>
                </Select>
                <DesignSystem />
                <button type="button" aria-label="Make settings" title="Model, web search, connectors and backend" onClick={() => make.set({ dialog: "settings" })} className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <Settings01 className="size-4" />
                </button>
                <span className="flex-1" />
                {busy && prompt.trim() && (
                    <button type="button" aria-label="Queue prompt" onClick={() => void send()} className="flex size-7 items-center justify-center rounded-full bg-brand-500 text-white">
                        <ArrowUp className="size-4" />
                    </button>
                )}
                {busy ? (
                    <button type="button" aria-label="Stop" onClick={stop} className="flex size-7 items-center justify-center rounded-full bg-ink text-canvas">
                        <StopCircle className="size-4" />
                    </button>
                ) : (
                    <button type="button" aria-label="Send" disabled={!canSend} onClick={() => void send()} className="flex size-7 items-center justify-center rounded-full bg-brand-500 text-white disabled:opacity-40">
                        <ArrowUp className="size-4" />
                    </button>
                )}
            </div>
        </div>
    );
}

export function ChatPanel() {
    const turns = useEditor((s) => makeData(s.doc).turns);
    const readOnly = useEditor((s) => s.readOnly);
    const busy = useMake((s) => s.busy !== null);
    const list = useRef<HTMLDivElement>(null);
    useEffect(() => void checkAi(), []);
    useEffect(() => {
        const el = list.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [turns.length, busy]);
    const lastAnswer = [...turns].reverse().find((t) => t.snapshot)?.id;
    return (
        <aside className="flex h-full w-[368px] shrink-0 flex-col border-r border-panel-border bg-panel">
            <Notice />
            <div ref={list} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
                {turns.length === 0 && !busy && (
                    <div className="mt-6 flex flex-col items-center gap-2 px-4 text-center">
                        <span className="flex size-9 items-center justify-center rounded-full bg-brand-500/15 text-brand-500">
                            <Stars02 className="size-4.5" />
                        </span>
                        <div className="text-[13px] font-semibold text-ink">What do you want to make?</div>
                        <div className="text-[11.5px] leading-relaxed text-ink-muted">Describe an app, paste a picture of one, or attach frames from a design file. Then keep asking for changes, or pick an element in the preview to change it. Start with /plan to agree on a plan first.</div>
                        {!readOnly && (
                            <button type="button" onClick={() => make.set({ dialog: "library" })} className="mt-1 h-7 rounded-md border border-panel-border px-2.5 text-[11.5px] text-ink hover:bg-panel-hover">
                                Start from a kit or template
                            </button>
                        )}
                    </div>
                )}
                {turns.map((t) => (
                    <Turn key={t.id} turn={t} latest={t.id === lastAnswer} readOnly={readOnly} />
                ))}
                <Busy />
            </div>
            <PickedCard />
            <Composer />
        </aside>
    );
}
