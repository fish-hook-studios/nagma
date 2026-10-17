import { Edit02, File04, Plus, Trash01 } from "@untitledui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { askText } from "../components/ask-text";
import { editor, useEditor } from "../engine/store";
import { deleteFile, makeData, renameFile, writeFile } from "./model";
import { send } from "./generate";
import { highlight } from "./highlight";
import { make, useMake } from "./state";

const GUIDELINES = `# Guidelines

The model reads this file before every answer. Write the rules your app should follow.

## Design
- Colours, type and spacing to use (or "use the design system's variables").
- Components to reuse and how they should look.

## Content and behaviour
- Tone of voice, naming, what the app must always or never do.
`;

const COLOURS = ".hl-keyword{color:#A855F7}.hl-string{color:#16A34A}.hl-number{color:#EA580C}.hl-comment{color:#8A8F98;font-style:italic}.hl-tag{color:#2563EB}.hl-attr{color:#0891B2}.hl-type{color:#CA8A04}";

// guidelines.md: write it from a starting point, upload one, or have the model write it.
function GuidelinesBox() {
    const has = useEditor((s) => "guidelines.md" in makeData(s.doc).files);
    const ai = useMake((s) => s.ai);
    const upload = useRef<HTMLInputElement>(null);
    if (has) return null;
    return (
        <div className="m-2 rounded-lg border border-dashed border-panel-border p-2 text-[11px]">
            <div className="font-semibold text-ink">Guidelines</div>
            <p className="mt-0.5 leading-relaxed text-ink-muted">A guidelines.md the model always follows.</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
                <button type="button" className="h-6 rounded-md border border-panel-border px-2 text-ink hover:bg-panel-hover" onClick={() => (writeFile("guidelines.md", GUIDELINES), make.set({ openFile: "guidelines.md" }))}>
                    Write
                </button>
                <button type="button" className="h-6 rounded-md border border-panel-border px-2 text-ink hover:bg-panel-hover" onClick={() => upload.current?.click()}>
                    Upload
                </button>
                {ai?.available && (
                    <button
                        type="button"
                        className="h-6 rounded-md border border-panel-border px-2 text-ink hover:bg-panel-hover"
                        onClick={() => {
                            make.set({ view: "preview", prompt: "Write guidelines.md for this project: the design rules (colours, type, spacing, components) and the behaviour the app follows, as short lists. Don't change other files." });
                            void send();
                        }}
                    >
                        Generate
                    </button>
                )}
                <input
                    ref={upload}
                    type="file"
                    accept=".md,.markdown,.txt,text/markdown,text/plain"
                    hidden
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 200_000) return editor.notify("That file is too large for guidelines.");
                        void file.text().then((text) => {
                            writeFile("guidelines.md", text);
                            make.set({ openFile: "guidelines.md" });
                        });
                    }}
                />
            </div>
        </div>
    );
}

// The Files view: the project's files in a tree, and the open file in an editor. Hand edits are saved
// to the file a moment after typing stops, and the preview follows.

const ORDER = ["src/App.tsx", "src/App.jsx", "src/main.tsx", "index.html"];
const validPath = (p: string) => /^[A-Za-z0-9._@\-/]+$/.test(p) && !p.split("/").some((s) => s === "" || s === "." || s === "..");

function openFileOf(files: Record<string, string>, wanted: string | null): string | null {
    if (wanted && wanted in files) return wanted;
    return ORDER.find((p) => p in files) ?? Object.keys(files).sort()[0] ?? null;
}

function Tree({ paths, open, readOnly }: { paths: string[]; open: string | null; readOnly: boolean }) {
    return (
        <div role="tree" aria-label="Files" className="min-h-0 flex-1 overflow-y-auto py-1">
            {paths.map((path) => {
                const parts = path.split("/");
                const name = parts[parts.length - 1];
                const folder = parts.slice(0, -1).join("/");
                return (
                    <div key={path} role="treeitem" aria-selected={path === open} className={`group flex h-7 items-center gap-1.5 pr-1 pl-3 text-[11.5px] ${path === open ? "bg-brand-500/15 text-ink" : "text-ink-muted hover:bg-panel-hover hover:text-ink"}`}>
                        <button type="button" onClick={() => make.set({ openFile: path })} className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none" title={path}>
                            <File04 className="size-3.5 shrink-0 text-ink-subtle" />
                            <span className="truncate">{name}</span>
                            {folder && <span className="truncate text-[10.5px] text-ink-subtle">{folder}</span>}
                        </button>
                        {!readOnly && (
                            <span className="hidden shrink-0 items-center group-hover:flex">
                                <button
                                    type="button"
                                    aria-label={`Rename ${path}`}
                                    onClick={() =>
                                        void askText("Rename file", path).then((next) => {
                                            const to = next?.trim();
                                            if (!to || to === path) return;
                                            if (!validPath(to)) return editor.notify("Use letters, numbers, dots, dashes and slashes in file paths.");
                                            renameFile(path, to);
                                            make.set({ openFile: to });
                                        })
                                    }
                                    className="flex size-5 items-center justify-center rounded text-ink-subtle hover:text-ink"
                                >
                                    <Edit02 className="size-3" />
                                </button>
                                <button type="button" aria-label={`Delete ${path}`} onClick={() => deleteFile(path)} className="flex size-5 items-center justify-center rounded text-ink-subtle hover:text-red-500">
                                    <Trash01 className="size-3" />
                                </button>
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

export function CodePane() {
    const files = useEditor((s) => makeData(s.doc).files);
    const readOnly = useEditor((s) => s.readOnly);
    const wanted = useMake((s) => s.openFile);
    const open = openFileOf(files, wanted);
    const paths = useMemo(() => Object.keys(files).sort((a, b) => (a.includes("/") === b.includes("/") ? a.localeCompare(b) : a.includes("/") ? 1 : -1)), [files]);
    const [draft, setDraft] = useState<{ path: string; text: string } | null>(null);
    const timer = useRef(0);
    const gutter = useRef<HTMLPreElement>(null);
    const coloured = useRef<HTMLPreElement>(null);
    const saved = open ? (files[open] ?? "") : "";
    const text = draft && draft.path === open ? draft.text : saved;

    const flush = (d = draft) => {
        window.clearTimeout(timer.current);
        if (d && d.path in makeData(editor.get().doc).files) writeFile(d.path, d.text);
    };
    useEffect(() => () => window.clearTimeout(timer.current), []);

    const change = (next: string) => {
        if (!open) return;
        const d = { path: open, text: next };
        setDraft(d);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => flush(d), 500);
    };
    const lines = text.split("\n").length;

    return (
        <div className="flex min-h-0 flex-1 bg-canvas">
            <div className="flex w-56 shrink-0 flex-col border-r border-panel-border bg-panel">
                <div className="flex h-8 shrink-0 items-center justify-between pr-1 pl-3 text-[11px] font-semibold text-ink">
                    Files
                    {!readOnly && (
                        <button
                            type="button"
                            aria-label="New file"
                            title="New file"
                            onClick={() =>
                                void askText("New file path", "src/components/").then((path) => {
                                    const p = path?.trim();
                                    if (!p) return;
                                    if (!validPath(p)) return editor.notify("Use letters, numbers, dots, dashes and slashes in file paths.");
                                    if (p in makeData(editor.get().doc).files) return make.set({ openFile: p });
                                    writeFile(p, "");
                                    make.set({ openFile: p });
                                })
                            }
                            className="flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink"
                        >
                            <Plus className="size-3.5" />
                        </button>
                    )}
                </div>
                {paths.length ? <Tree paths={paths} open={open} readOnly={readOnly} /> : <div className="px-3 py-2 text-[11px] text-ink-muted">No files yet.</div>}
                {!readOnly && <GuidelinesBox />}
            </div>
            {open ? (
                <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-panel-border px-3 text-[11px] text-ink-muted">
                        <span className="truncate font-mono text-ink">{open}</span>
                        {draft && draft.text !== saved && <span className="text-ink-subtle">Saving…</span>}
                        {readOnly && <span className="ml-auto">View only</span>}
                    </div>
                    <style>{COLOURS}</style>
                    <div className="flex min-h-0 flex-1 font-mono text-[12px] leading-[18px]">
                        <pre ref={gutter} aria-hidden="true" className="w-11 shrink-0 overflow-hidden border-r border-panel-border py-2 pr-2 text-right text-ink-subtle select-none">
                            {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
                        </pre>
                        <div className="relative min-w-0 flex-1">
                        {/* The coloured copy under the (transparent) text being edited. */}
                        <pre ref={coloured} aria-hidden="true" className="pointer-events-none absolute inset-0 m-0 overflow-hidden px-3 py-2 whitespace-pre text-ink" dangerouslySetInnerHTML={{ __html: `${highlight(open, text)}\n` }} />
                        <textarea
                            aria-label={`Contents of ${open}`}
                            value={text}
                            readOnly={readOnly}
                            spellCheck={false}
                            autoCapitalize="off"
                            autoCorrect="off"
                            onChange={(e) => change(e.target.value)}
                            onBlur={() => flush()}
                            onScroll={(e) => {
                                if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
                                if (coloured.current) {
                                    coloured.current.scrollTop = e.currentTarget.scrollTop;
                                    coloured.current.scrollLeft = e.currentTarget.scrollLeft;
                                }
                            }}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Tab" && !e.shiftKey && !readOnly) {
                                    e.preventDefault();
                                    const el = e.currentTarget;
                                    const { selectionStart: a, selectionEnd: b } = el;
                                    const next = `${text.slice(0, a)}    ${text.slice(b)}`;
                                    change(next);
                                    requestAnimationFrame(() => el.setSelectionRange(a + 4, a + 4));
                                }
                                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                                    e.preventDefault();
                                    flush();
                                }
                            }}
                            wrap="off"
                            className="absolute inset-0 h-full w-full resize-none bg-transparent px-3 py-2 text-transparent caret-ink outline-none selection:bg-brand-500/30"
                        />
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex flex-1 items-center justify-center text-[12px] text-ink-muted">No file open.</div>
            )}
        </div>
    );
}
