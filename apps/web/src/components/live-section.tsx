import { AlertCircle, X } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Popover as AriaPopover } from "react-aria-components";
import { clearErrors, useLiveUi } from "../canvas/live-snapshots";
import { applyCommand } from "../engine/commands";
import { type LiveField, bindLivePropCommand, documentNetwork, liveFields, liveOf, liveProps, sanitizeOrigin, setAppFilesCommand, setLivePropCommand, setNetworkCommand, setSourceCommand, sourceOf } from "../engine/live";
import { filesKey, makeAppFiles, useLiveApp } from "../engine/live-app";
import { editor, useEditor } from "../engine/store";
import type { LiveSource, SceneNode } from "../engine/types";
import { findVariable, resolveVariable } from "../engine/variables";
import { CodeEditor } from "../make/code-editor";
import { ColorSwatch } from "./color-picker";
import { NumberField } from "./number-field";
import { Section } from "./panel-section";
import { Select } from "./select";
import { VariablePicker } from "./variable-picker";

// The Inspector for a Live frame: Props generated from the schema its code declares (each bindable to
// a variable), and Code: the HTML, CSS and JavaScript (or an app frame's files) in Make's editor,
// applied on Apply or a moment after typing stops, with the frame's errors under it and the network
// origins every Live frame in the file may reach. In a view-only file both are shown, locked.

const input = "h-6 w-full min-w-0 rounded-[5px] border border-transparent bg-input px-1.5 text-ink outline-none hover:border-panel-border focus:border-brand-500";

const VAR_ICON = (
    <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M6 1.2 10.2 3.6v4.8L6 10.8 1.8 8.4V3.6z" strokeLinejoin="round" />
        <circle cx="6" cy="6" r="1.4" />
    </svg>
);

export function LiveSections({ node }: { node: SceneNode }) {
    return (
        <>
            <PropsSection node={node} />
            {/* Keyed by layer: another layer starts from its own saved code. */}
            {node.live?.kind === "app" ? <AppCodeSection key={node.id} node={node} /> : <CodeSection key={node.id} node={node} />}
        </>
    );
}

// Writes a prop: shown at once (a preview of the document), kept in history once the edits pause,
// so dragging a colour or typing a label is one undo step.
function usePropWriter(id: string) {
    const timer = useRef(0);
    const pending = useRef<{ name: string; run: () => void } | null>(null);
    const flush = () => {
        window.clearTimeout(timer.current);
        const p = pending.current;
        pending.current = null;
        p?.run();
    };
    useEffect(() => () => flush(), [id]);
    return {
        write(name: string, value: unknown, now = false) {
            if (pending.current && pending.current.name !== name) flush();
            const base = editor.committed();
            const current = base.nodes[id];
            if (!current || editor.get().readOnly) return;
            const command = setLivePropCommand(current, name, value);
            editor.preview(applyCommand(base, command));
            pending.current = { name, run: () => editor.execute(command, base) };
            window.clearTimeout(timer.current);
            if (now) flush();
            else timer.current = window.setTimeout(flush, 500);
        },
        flush,
    };
}

function PropsSection({ node }: { node: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    const fields = liveFields(node.live?.schema);
    const props = liveProps(doc, node);
    const writer = usePropWriter(node.id);
    const event = useLiveUi((s) => s.lastEvent[node.id]);
    const readOnly = useEditor((s) => s.readOnly);
    return (
        <Section title="Props" label="Props">
            {fields.length === 0 && <p className="text-[11px] leading-relaxed text-ink-muted">{node.live?.kind === "app" ? "The app declares no props yet. Its default export gets them as React props once the code calls nagma.declare." : "The code declares no props yet. Call nagma.declare in the Code below to list them here."}</p>}
            {fields.map((field) => (
                <PropRow key={field.name} node={node} field={field} value={props[field.name]} write={writer.write} readOnly={readOnly} />
            ))}
            {readOnly && fields.length > 0 && <p className="text-[11px] text-ink-muted">View only: double-click the frame on the canvas to use it.</p>}
            {event && (
                <p className="truncate text-[11px] text-ink-muted" title={JSON.stringify(event.detail) ?? ""}>
                    Last event: <span className="font-medium text-ink">{event.name}</span>
                </p>
            )}
        </Section>
    );
}

function PropRow({ node, field, value, write, readOnly }: { node: SceneNode; field: LiveField; value: unknown; write: (name: string, value: unknown, now?: boolean) => void; readOnly: boolean }) {
    const doc = useEditor((s) => s.doc);
    const bound = node.live?.bindings?.[field.name] ?? null;
    const found = bound ? findVariable(doc, bound) : null;
    return (
        <div className="grid grid-cols-[64px_minmax(0,1fr)_20px] items-center gap-1.5" data-live-prop={field.name}>
            <span className="truncate text-[11px] text-ink-muted" title={field.name}>
                {field.label}
            </span>
            <div className="min-w-0">
                {found ? (
                    <BoundPill node={node} field={field} name={found.variable.name} variableId={found.variable.id} readOnly={readOnly} />
                ) : readOnly ? (
                    <LockedValue field={field} value={value} />
                ) : (
                    <PropControl field={field} value={value} onChange={(v, now) => write(field.name, v, now)} />
                )}
            </div>
            {readOnly ? <span /> : <BindButton node={node} field={field} current={bound} />}
        </div>
    );
}

// A prop's value in a view-only file: shown, not editable.
function LockedValue({ field, value }: { field: LiveField; value: unknown }) {
    const text = value === undefined || value === null ? "" : field.control === "toggle" ? (value === true ? "On" : "Off") : field.control === "image" ? (value ? "Picture" : "None") : Array.isArray(value) ? value.join(", ") : String(value);
    return (
        <div aria-label={`${field.label} (locked)`} aria-readonly="true" className="flex h-6 min-w-0 items-center gap-1.5 rounded-[5px] bg-input/60 px-1.5 text-[11px] text-ink-muted">
            {field.control === "color" && typeof value === "string" && <span className="size-3.5 shrink-0 rounded border border-black/20" style={{ background: value }} />}
            <span className="truncate">{text}</span>
        </div>
    );
}

function PropControl({ field, value, onChange }: { field: LiveField; value: unknown; onChange: (value: unknown, now?: boolean) => void }) {
    switch (field.control) {
        case "number":
            return <NumberField label="" title={field.label} value={typeof value === "number" ? value : 0} min={field.min} max={field.max} step={field.step ?? 1} onCommit={(n) => onChange(n, true)} />;
        case "toggle":
            return (
                <label className="flex h-6 items-center gap-1.5 text-[11px] text-ink">
                    <input type="checkbox" aria-label={field.label} checked={value === true} onChange={(e) => onChange(e.target.checked, true)} />
                    {value === true ? "On" : "Off"}
                </label>
            );
        case "color": {
            const color = typeof value === "string" && value ? value : "#000000";
            return (
                <div className="flex h-6 items-center gap-1.5 rounded-[5px] bg-input px-1">
                    <ColorSwatch color={color} label={field.label} size={4} showOpacity={false} onChange={(c) => onChange(c, true)} onPreview={(c) => onChange(c)} />
                    <TextInput label={`${field.label} hex`} value={color.toUpperCase()} onChange={(t) => /^#[0-9a-f]{3,8}$/i.test(t.trim()) && onChange(t.trim())} bare />
                </div>
            );
        }
        case "select":
            return (
                <Select aria-label={field.label} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value, true)} className={input}>
                    {(field.options ?? []).map((o) => (
                        <option key={o} value={o}>
                            {o}
                        </option>
                    ))}
                </Select>
            );
        case "numbers":
            return <TextInput label={field.label} value={Array.isArray(value) ? value.join(", ") : ""} onChange={(t) => onChange(t)} placeholder="1, 2, 3" />;
        case "image":
            return <ImageControl label={field.label} value={typeof value === "string" ? value : ""} onChange={(v) => onChange(v, true)} />;
        default:
            return <TextInput label={field.label} value={typeof value === "string" ? value : value === undefined || value === null ? "" : String(value)} onChange={(t) => onChange(t)} />;
    }
}

// A text field that writes as it is typed (the writer keeps one undo step per pause) and shows
// outside changes when it isn't being edited.
function TextInput({ label, value, onChange, placeholder, bare }: { label: string; value: string; onChange: (text: string) => void; placeholder?: string; bare?: boolean }) {
    const [draft, setDraft] = useState(value);
    const focused = useRef(false);
    useEffect(() => {
        if (!focused.current) setDraft(value);
    }, [value]);
    return (
        <input
            aria-label={label}
            value={draft}
            placeholder={placeholder}
            onFocus={() => (focused.current = true)}
            onBlur={() => {
                focused.current = false;
                setDraft(value);
            }}
            onChange={(e) => {
                setDraft(e.target.value);
                onChange(e.target.value);
            }}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={bare ? "h-6 w-full min-w-0 bg-transparent text-ink outline-none" : input}
        />
    );
}

const MAX_IMAGE = 2_000_000;

// A picture for an image prop, kept in the props as a data URL (the frame has no network).
function ImageControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    const file = useRef<HTMLInputElement>(null);
    return (
        <div className="flex h-6 items-center gap-1.5">
            {value && <img src={value} alt="" className="size-5 shrink-0 rounded border border-panel-border object-cover" />}
            <button type="button" onClick={() => file.current?.click()} className="h-6 min-w-0 flex-1 truncate rounded-[5px] bg-input px-1.5 text-left text-ink hover:bg-panel-hover">
                {value ? "Replace…" : "Choose image…"}
            </button>
            {value && (
                <button type="button" aria-label={`Remove ${label}`} onClick={() => onChange("")} className="flex size-5 items-center justify-center rounded text-ink-subtle hover:text-ink">
                    <X className="size-3" />
                </button>
            )}
            <input
                ref={file}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    if (f.size > MAX_IMAGE) return editor.notify("Pick a picture under 2 MB for a Live frame.");
                    const reader = new FileReader();
                    reader.onload = () => typeof reader.result === "string" && onChange(reader.result);
                    reader.readAsDataURL(f);
                }}
            />
        </div>
    );
}

function BoundPill({ node, field, name, variableId, readOnly }: { node: SceneNode; field: LiveField; name: string; variableId: string; readOnly?: boolean }) {
    const doc = useEditor((s) => s.doc);
    const r = resolveVariable(doc, variableId, node);
    return (
        <div className="flex h-6 min-w-0 items-center gap-1.5 rounded-md border border-brand-500/40 bg-brand-100/60 px-1.5" title={`${field.label} follows ${name}`}>
            {field.variableType === "color" && <span className="size-3.5 shrink-0 rounded border border-black/20" style={{ background: typeof r?.value === "string" ? r.value : "#000" }} />}
            <span className="text-ink-subtle">{VAR_ICON}</span>
            <span className="min-w-0 flex-1 truncate">{name.split("/").pop()}</span>
            {!readOnly && (
                <button type="button" aria-label={`Detach ${field.label}`} onClick={() => editor.execute(bindLivePropCommand(node, field.name, null))} className="flex size-4 shrink-0 items-center justify-center rounded text-ink-subtle hover:text-ink">
                    <X className="size-3" />
                </button>
            )}
        </div>
    );
}

function BindButton({ node, field, current }: { node: SceneNode; field: LiveField; current: string | null }) {
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label={`Apply variable to ${field.label}`} className={`flex size-5 shrink-0 items-center justify-center rounded outline-none hover:bg-panel-hover ${current ? "text-brand-500" : "text-ink-subtle hover:text-ink"}`}>
                {VAR_ICON}
            </AriaButton>
            <AriaPopover placement="left top" offset={8} className="rounded-lg border border-panel-border bg-panel-raised text-ink shadow-xl outline-none">
                <AriaDialog className="outline-none" aria-label="Variables">
                    {({ close }) => (
                        <VariablePicker
                            nodes={[node]}
                            field={`live:${field.name}`}
                            current={current}
                            onPick={(id) => {
                                const latest = editor.get().doc.nodes[node.id];
                                if (latest) editor.execute(bindLivePropCommand(latest, field.name, id));
                                close();
                            }}
                            onClose={close}
                        />
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

// ---- Code ----

type Part = keyof LiveSource;
const PARTS: { id: Part; label: string; path: string }[] = [
    { id: "html", label: "HTML", path: "index.html" },
    { id: "css", label: "CSS", path: "style.css" },
    { id: "js", label: "JS", path: "main.js" },
];

function CodeSection({ node }: { node: SceneNode }) {
    const readOnly = useEditor((s) => s.readOnly);
    const saved = sourceOf(node);
    const [part, setPart] = useState<Part>("js");
    const [draft, setDraft] = useState<LiveSource | null>(null);
    const [auto, setAuto] = useState(true);
    const errors = useLiveUi((s) => s.errors[node.id]) ?? [];
    const timer = useRef(0);
    const text = (draft ?? saved)[part];
    const dirty = draft !== null && (draft.html !== saved.html || draft.css !== saved.css || draft.js !== saved.js);

    const apply = (source: LiveSource | null = draft) => {
        window.clearTimeout(timer.current);
        const current = editor.get().doc.nodes[node.id];
        if (!source || !current) return;
        const now = sourceOf(current);
        if (source.html !== now.html || source.css !== now.css || source.js !== now.js) {
            clearErrors(node.id);
            editor.execute(setSourceCommand(current, source));
        }
        setDraft(null);
    };
    useEffect(() => () => window.clearTimeout(timer.current), []);

    const change = (value: string) => {
        const next = { ...(draft ?? saved), [part]: value };
        setDraft(next);
        window.clearTimeout(timer.current);
        if (auto) timer.current = window.setTimeout(() => apply(next), 900);
    };

    return (
        <Section
            title="Code"
            label="Code"
            action={
                !readOnly && (
                    <>
                        <label className="flex items-center gap-1 text-[11px] text-ink-muted" title="Apply a moment after typing stops">
                            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} aria-label="Apply automatically" />
                            Auto
                        </label>
                        <button type="button" disabled={!dirty} onClick={() => apply()} className="h-6 rounded-md bg-brand-500 px-2 text-[11px] font-semibold text-white disabled:opacity-40">
                            Apply
                        </button>
                    </>
                )
            }
        >
            <div role="tablist" aria-label="Code part" className="flex gap-1">
                {PARTS.map((p) => (
                    <button key={p.id} type="button" role="tab" aria-selected={part === p.id} onClick={() => setPart(p.id)} className={`h-6 rounded-md px-2 text-[11px] font-semibold ${part === p.id ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}>
                        {p.label}
                    </button>
                ))}
                {dirty && <span className="ml-auto self-center text-[10px] text-ink-subtle">Not applied</span>}
            </div>
            <div className="flex h-56 overflow-hidden rounded-md border border-panel-border bg-canvas">
                <CodeEditor key={part} compact path={PARTS.find((p) => p.id === part)?.path ?? "main.js"} value={text} readOnly={readOnly} onChange={change} onCommit={() => dirty && apply()} label={`${PARTS.find((p) => p.id === part)?.label} of ${node.name}`} />
            </div>
            {errors.length > 0 && (
                <div role="alert" className="flex items-start gap-1.5 rounded-md border border-red-500/40 p-1.5 text-[11px]">
                    <AlertCircle className="mt-px size-3.5 shrink-0 text-red-500" />
                    <div className="min-w-0 flex-1 font-mono break-words whitespace-pre-wrap text-ink-muted">{errors[errors.length - 1]}</div>
                    <button type="button" aria-label="Dismiss" onClick={() => clearErrors(node.id)} className="flex size-4 items-center justify-center text-ink-subtle hover:text-ink">
                        <X className="size-3" />
                    </button>
                </div>
            )}
            <NetworkRow node={node} />
        </Section>
    );
}

// The origins every Live frame in this file may reach (the document's list). None: no network at
// all. An app frame also lists the origins its scripts still come from (modules that couldn't be
// kept offline).
function NetworkRow({ node }: { node: SceneNode }) {
    const readOnly = useEditor((s) => s.readOnly);
    const doc = useEditor((s) => s.doc);
    const allow = documentNetwork(doc);
    const app = useLiveApp(node.live?.kind === "app" ? node.live.files : undefined);
    const [adding, setAdding] = useState("");
    const write = (next: string[]) => editor.execute(setNetworkCommand(editor.get().doc, next));
    const add = () => {
        const origin = sanitizeOrigin(adding);
        if (!origin) return editor.notify("Type an https address, like https://api.example.com.");
        write([...allow, origin]);
        setAdding("");
    };
    return (
        <div className="space-y-1" data-live-network="">
            <div className="text-[11px] text-ink-muted" title="The same list applies to every Live frame in this file">
                {allow.length ? "Network: only these origins, for every Live frame in this file" : "Network: off for every Live frame in this file"}
            </div>
            {allow.map((o) => (
                <div key={o} className="flex h-6 items-center gap-1 rounded-[5px] bg-input px-1.5 text-[11px]">
                    <span className="min-w-0 flex-1 truncate font-mono">{o}</span>
                    {!readOnly && (
                        <button type="button" aria-label={`Remove ${o}`} onClick={() => write(allow.filter((x) => x !== o))} className="flex size-4 items-center justify-center text-ink-subtle hover:text-ink">
                            <X className="size-3" />
                        </button>
                    )}
                </div>
            ))}
            {(app?.blocked ?? []).length > 0 && (
                <div className="space-y-1" data-live-app-network="">
                    <div className="text-[11px] text-ink-muted">Scripts this app still loads (they couldn't be kept offline):</div>
                    {app?.blocked.map((o) => (
                        <div key={o} className="flex h-6 items-center gap-1 rounded-[5px] border border-dashed border-panel-border px-1.5 text-[11px]">
                            <span className="min-w-0 flex-1 truncate font-mono">{o}</span>
                            <span className="text-[10px] text-ink-subtle">this frame</span>
                        </div>
                    ))}
                </div>
            )}
            {!readOnly && (
                <div className="flex gap-1">
                    <input aria-label="Allow an origin" placeholder="https://api.example.com" value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => (e.stopPropagation(), e.key === "Enter" && add())} className={input} />
                    <button type="button" disabled={!adding.trim()} onClick={add} className="h-6 shrink-0 rounded-md border border-panel-border px-2 text-[11px] text-ink hover:bg-panel-hover disabled:opacity-40">
                        Allow
                    </button>
                </div>
            )}
        </div>
    );
}

// ---- An app frame's code: its files ----

function AppCodeSection({ node }: { node: SceneNode }) {
    const readOnly = useEditor((s) => s.readOnly);
    const live = liveOf(node);
    const saved = live.files ?? {};
    const paths = Object.keys(saved).sort((a, b) => (a === "src/App.jsx" || a === "src/App.tsx" ? -1 : b === "src/App.jsx" || b === "src/App.tsx" ? 1 : a.localeCompare(b)));
    const [path, setPath] = useState(() => paths.find((p) => /App\.(jsx|tsx)$/.test(p)) ?? paths[0] ?? "");
    const [draft, setDraft] = useState<Record<string, string> | null>(null);
    const [checking, setChecking] = useState(false);
    const [changed, setChanged] = useState<boolean | null>(null);
    const errors = useLiveUi((s) => s.errors[node.id]) ?? [];
    const app = useLiveApp(live.files);
    const timer = useRef(0);
    // A Make app's copy is changed in Make, then brought over; a component's code is edited here.
    const fromMake = Boolean(live.app);
    const locked = readOnly || fromMake;
    const files = draft ?? saved;
    const dirty = draft !== null && filesKey(draft) !== filesKey(saved);

    const apply = (next: Record<string, string> | null = draft) => {
        window.clearTimeout(timer.current);
        const current = editor.get().doc.nodes[node.id];
        if (!next || !current) return;
        if (filesKey(next) !== filesKey(current.live?.files ?? {})) {
            clearErrors(node.id);
            editor.execute(setAppFilesCommand(current, next));
        }
        setDraft(null);
    };
    useEffect(() => () => window.clearTimeout(timer.current), []);
    const change = (value: string) => {
        const next = { ...files, [path]: value };
        setDraft(next);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => apply(next), 900);
    };

    // Whether the Make app has changed since this copy (checked when asked, and once on open).
    const check = async (update: boolean) => {
        if (!live.app) return;
        setChecking(true);
        const got = await makeAppFiles(live.app).catch(() => null);
        setChecking(false);
        if (!got) return void editor.notify("That Make app can't be opened from here.");
        const differs = filesKey(got.files) !== filesKey(saved);
        setChanged(differs);
        const current = editor.get().doc.nodes[node.id];
        if (update && differs && current) {
            clearErrors(node.id);
            editor.execute(setAppFilesCommand(current, got.files));
            setChanged(false);
            editor.notify(`Updated from ${got.name}.`);
        } else if (update) editor.notify("Already up to date.");
    };
    useEffect(() => {
        if (live.app && !readOnly) void check(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once per layer
    }, []);

    return (
        <Section title="Code" label="Code">
            {fromMake && (
                <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                    <span className="min-w-0 flex-1 truncate">
                        Runs a copy of <span className="font-medium text-ink">{live.appName ?? "a Make app"}</span>
                        {changed ? " (the app has changed since)" : ""}
                    </span>
                    {!readOnly && (
                        <button type="button" disabled={checking} onClick={() => void check(true)} className="h-6 shrink-0 rounded-md border border-panel-border px-2 text-[11px] text-ink hover:bg-panel-hover disabled:opacity-40">
                            {checking ? "Checking…" : "Update from app"}
                        </button>
                    )}
                </div>
            )}
            <div role="tablist" aria-label="File" className="flex flex-wrap gap-1">
                {paths.map((p) => (
                    <button key={p} type="button" role="tab" aria-selected={path === p} title={p} onClick={() => setPath(p)} className={`h-6 max-w-[140px] truncate rounded-md px-2 text-[11px] font-semibold ${path === p ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}>
                        {p.split("/").pop()}
                    </button>
                ))}
                {dirty && <span className="ml-auto self-center text-[10px] text-ink-subtle">Not applied</span>}
            </div>
            <div className="flex h-56 overflow-hidden rounded-md border border-panel-border bg-canvas">
                <CodeEditor key={path} compact path={path || "src/App.jsx"} value={files[path] ?? ""} readOnly={locked} onChange={change} onCommit={() => dirty && apply()} label={`${path} of ${node.name}`} />
            </div>
            {!app && <p className="text-[11px] text-ink-muted">Bundling the app…</p>}
            {app && !app.component && <p className="text-[11px] text-ink-muted">No default export in App: the app runs as it does in Make, without props.</p>}
            {errors.length > 0 && (
                <div role="alert" className="flex items-start gap-1.5 rounded-md border border-red-500/40 p-1.5 text-[11px]">
                    <AlertCircle className="mt-px size-3.5 shrink-0 text-red-500" />
                    <div className="min-w-0 flex-1 font-mono break-words whitespace-pre-wrap text-ink-muted">{errors[errors.length - 1]}</div>
                    <button type="button" aria-label="Dismiss" onClick={() => clearErrors(node.id)} className="flex size-4 items-center justify-center text-ink-subtle hover:text-ink">
                        <X className="size-3" />
                    </button>
                </div>
            )}
            <NetworkRow node={node} />
        </Section>
    );
}
