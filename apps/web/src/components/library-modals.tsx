import { BookOpen01, ChevronDown, ChevronRight, Eye, EyeOff, RefreshCw01, SearchSm, Upload01, XClose } from "@untitledui/icons";
import { useEffect, useMemo, useState } from "react";
import { Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { fileMeta } from "../engine/files";
import {
    type HiddenItem,
    setHiddenFromPublishing,
    type LibraryChange,
    type LibraryUpdate,
    type PublishProgress,
    type Snapshot,
    acceptUpdates,
    changesSince,
    checkForUpdates,
    dismissUpdates,
    enabledLibraries,
    libraryIdFor,
    openReview,
    publishLibrary,
    publishedManifest,
    refreshLibraries,
    setLibraryEnabled,
    snapshotFile,
    unpublishLibrary,
    updatesSignature,
    swapLibrary,
    useLibrarySummaries,
    useLibraryUpdates,
} from "../engine/library";
import { adminAction } from "../engine/admin";
import { useCollab } from "../engine/collab";
import { pageOf } from "../engine/page";
import { projectOf, refreshTeams, useTeams } from "../engine/teams";
import type { NagmaDocument } from "../engine/types";
import "../engine/default-libraries";
import type { LibraryManifest } from "../engine/library-types";
import { swatchCss } from "../engine/paint";
import { editor, useEditor } from "../engine/store";
import type { VariableCollection } from "../engine/types";
import { AssetThumb, LibraryThumb } from "./asset-thumb";
import { ComponentIcon } from "./component-icons";
import { StyleEditorHost } from "./style-picker";
import { PropertyModalHost } from "./component-props";

// Libraries: the Libraries window (this file's library, updates, and every library
// to enable), the Publish window with the list of changes, and the review of library updates.

import { type Tab, openPublish, setUi, useUi } from "./library-ui";

const overlay = "fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-16";
const modal = "flex max-h-[80vh] flex-col overflow-hidden rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none";
const primary = "h-8 rounded-md bg-brand-500 px-3 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-40";
const secondary = "h-8 rounded-md border border-panel-border px-3 text-[12px] hover:bg-panel-hover disabled:opacity-40";

// Everything libraries put on screen, mounted once by the app.
export function LibraryHost() {
    const state = useUi();
    const updates = useLibraryUpdates();
    return (
        <>
            {state.libraries && <LibrariesModal tab={state.libraries} />}
            {state.publish && <PublishModal />}
            {updates.reviewOpen && <ReviewModal />}
            <UpdateBanner />
            <StyleEditorHost />
            <PropertyModalHost />
        </>
    );
}

function when(ms: number): string {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(ms).toLocaleDateString();
}

function counts(c: { components: number; styles: number; variables: number } | undefined): string {
    if (!c) return "Nothing published";
    const parts = [];
    if (c.components) parts.push(`${c.components.toLocaleString()} component${c.components === 1 ? "" : "s"}`);
    if (c.styles) parts.push(`${c.styles.toLocaleString()} style${c.styles === 1 ? "" : "s"}`);
    if (c.variables) parts.push(`${c.variables.toLocaleString()} variable${c.variables === 1 ? "" : "s"}`);
    return parts.join(", ") || "Nothing published";
}

// ---- The Libraries window ----

function LibrariesModal({ tab }: { tab: Tab }) {
    const updates = useLibraryUpdates();
    const close = () => setUi({ libraries: null });
    const nav = (key: Tab, label: string, badge?: number) => (
        <button type="button" onClick={() => setUi({ libraries: key })} className={`flex h-8 w-full items-center justify-between rounded-md px-2 text-left ${tab === key ? "bg-panel-hover font-semibold" : "hover:bg-panel-hover"}`}>
            <span>{label}</span>
            {badge ? <span className="rounded-full bg-brand-500 px-1.5 text-[10px] font-semibold text-white">{badge}</span> : null}
        </button>
    );
    return (
        <AriaModalOverlay isOpen isDismissable onOpenChange={(open) => !open && close()} className={overlay}>
            <AriaModal className={`${modal} h-[560px] w-[760px]`}>
                <AriaDialog className="flex h-full min-h-0 flex-col outline-none" aria-label="Libraries">
                    <header className="flex h-12 shrink-0 items-center justify-between border-b border-panel-border px-4">
                        <h2 className="text-[14px] font-semibold">Libraries</h2>
                        <button type="button" aria-label="Close" onClick={close} className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                            <XClose className="size-4" />
                        </button>
                    </header>
                    <div className="flex min-h-0 flex-1">
                        <nav className="w-44 shrink-0 space-y-0.5 border-r border-panel-border p-2 text-[12px]">
                            {nav("file", "This file")}
                            {nav("updates", "Updates", updates.updates.length)}
                            {nav("libraries", "All libraries")}
                        </nav>
                        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-[12px]">{tab === "file" ? <ThisFileTab /> : tab === "updates" ? <UpdatesTab /> : <AllLibrariesTab />}</div>
                    </div>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

function ThisFileTab() {
    const fileId = useEditor((s) => s.fileId);
    const doc = useEditor((s) => s.doc);
    const summaries = useLibrarySummaries();
    const [manifest, setManifest] = useState<LibraryManifest | null | undefined>(undefined);
    const meta = fileMeta(fileId);
    useEffect(() => {
        let live = true;
        void publishedManifest(fileId).then((m) => live && setManifest(m));
        return () => {
            live = false;
        };
    }, [fileId, summaries]);
    const used = enabledLibraries(doc);
    return (
        <div className="space-y-5">
            <section>
                <h3 className="mb-2 font-semibold">This file's library</h3>
                <div className="flex items-center gap-3 rounded-lg border border-panel-border p-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-500/15 text-brand-500">
                        <BookOpen01 className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{meta?.name ?? doc.name}</div>
                        <div className="text-ink-muted">
                            {manifest === undefined ? "Checking…" : manifest ? `Published ${when(manifest.publishedAt)}. ${counts(manifest.counts)}` : "Not published yet"}
                        </div>
                    </div>
                    {manifest && (
                        <button
                            type="button"
                            className={secondary}
                            onClick={() => {
                                if (fileId) void unpublishLibrary(fileId).then(() => setManifest(null));
                            }}
                        >
                            Unpublish
                        </button>
                    )}
                    <button type="button" className={primary} disabled={!meta} onClick={openPublish}>
                        {manifest ? "Publish changes" : "Publish"}
                    </button>
                </div>
                {!meta && <p className="mt-2 text-ink-muted">Save this file to your library first.</p>}
                {meta && !meta.shared && <p className="mt-2 text-ink-muted">This file is in this browser, so its library is available to your other files here. Share the file to publish it to your team.</p>}
                {manifest?.history?.length ? (
                    <div className="mt-3 space-y-1">
                        <div className="text-ink-muted">Publish history</div>
                        {manifest.history.slice(0, 5).map((h) => (
                            <div key={h.version} className="flex gap-2">
                                <span className="w-24 shrink-0 text-ink-subtle">{when(h.at)}</span>
                                <span className="min-w-0 flex-1 truncate">{h.description || `${h.changes} change${h.changes === 1 ? "" : "s"}`}</span>
                            </div>
                        ))}
                    </div>
                ) : null}
            </section>
            <section>
                <h3 className="mb-2 font-semibold">Libraries used in this file</h3>
                {used.length === 0 && <p className="text-ink-muted">None yet. Turn a library on under All libraries.</p>}
                {used.map((l) => {
                    const s = summaries.find((x) => x.id === l.id);
                    return (
                        <div key={l.id} className="flex h-10 items-center gap-2 border-b border-panel-border">
                            <ComponentIcon className="size-4 shrink-0 text-ink-muted" />
                            <span className="min-w-0 flex-1 truncate">{s?.name ?? l.name}</span>
                            <span className="text-ink-subtle">{s ? counts(s.counts) : "Not available"}</span>
                            <SwapLibrary fromId={l.id} fromName={s?.name ?? l.name} />
                            <button type="button" className={secondary} onClick={() => setLibraryEnabled(s ?? { ...l, fileId: l.id, publishedAt: 0, counts: { components: 0, styles: 0, variables: 0 } }, false)}>
                                Remove
                            </button>
                        </div>
                    );
                })}
            </section>
        </div>
    );
}

// Swap library: what this file uses from one library switches to the same-named items in another.
function SwapLibrary({ fromId, fromName }: { fromId: string; fromName: string }) {
    const summaries = useLibrarySummaries();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const choices = summaries.filter((s) => s.id !== fromId);
    if (!open)
        return (
            <button type="button" className={secondary} disabled={!choices.length} onClick={() => setOpen(true)}>
                Swap library
            </button>
        );
    return (
        <select
            autoFocus
            aria-label={`Swap ${fromName} for`}
            disabled={busy}
            defaultValue=""
            onBlur={() => !busy && setOpen(false)}
            onChange={(e) => {
                const to = choices.find((c) => c.id === e.target.value);
                if (!to) return;
                setBusy(true);
                void swapLibrary(fromId, to.id)
                    .then((r) => editor.notify(`Swapped ${r.instances} instance${r.instances === 1 ? "" : "s"} and ${r.styles} style${r.styles === 1 ? "" : "s"} to ${to.name}.${r.missing.length ? ` ${r.missing.length} component${r.missing.length === 1 ? " has" : "s have"} no match there.` : ""}`))
                    .catch((err: unknown) => editor.notify(err instanceof Error ? err.message : String(err)))
                    .finally(() => (setBusy(false), setOpen(false)));
            }}
            className="h-8 max-w-44 rounded-md border border-panel-border bg-field px-1.5 text-[12px] outline-none"
        >
            <option value="" disabled>
                Swap with…
            </option>
            {choices.map((c) => (
                <option key={c.id} value={c.id}>
                    {c.name}
                </option>
            ))}
        </select>
    );
}

// The team a shared file belongs to (through its folder), when you're on it.
function useFileTeam() {
    const project = useCollab((s) => s.access?.project ?? null);
    useTeams();
    return projectOf(project)?.team ?? null;
}

function AllLibrariesTab() {
    const doc = useEditor((s) => s.doc);
    const fileId = useEditor((s) => s.fileId);
    const summaries = useLibrarySummaries();
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        void refreshLibraries().finally(() => setLoading(false));
    }, []);
    const own = libraryIdFor(fileId);
    const enabled = new Set(enabledLibraries(doc).map((l) => l.id));
    const team = useFileTeam();
    const defaults = new Set(team?.defaultLibraries ?? []);
    const setDefault = (id: string, on: boolean) => {
        if (!team) return;
        const next = on ? [...defaults, id] : [...defaults].filter((x) => x !== id);
        void adminAction(team.id, "settings", { settings: { defaultLibraries: next } })
            .then(() => refreshTeams())
            .catch((err: unknown) => editor.notify(err instanceof Error ? err.message : String(err)));
    };
    const q = query.trim().toLowerCase();
    const list = summaries.filter((s) => s.id !== own && (!q || s.name.toLowerCase().includes(q)));
    return (
        <div className="space-y-3">
            <label className="flex h-8 items-center gap-2 rounded-md border border-panel-border bg-field px-2 text-ink-muted focus-within:border-brand-500">
                <SearchSm className="size-4 shrink-0" />
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search libraries" aria-label="Search libraries" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-subtle" />
            </label>
            {loading && !summaries.length && <p className="text-ink-muted">Looking for libraries…</p>}
            {!loading && list.length === 0 && <p className="text-ink-muted">{q ? "No libraries match." : "No published libraries yet. Open a file with components or styles and publish it from Libraries › This file."}</p>}
            {list.map((s) => {
                const on = enabled.has(s.id);
                return (
                    <div key={s.id} className="flex items-center gap-3 rounded-lg border border-panel-border p-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-field text-ink-muted">
                            <ComponentIcon className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="truncate font-semibold">{s.name}</div>
                            <div className="truncate text-ink-muted">
                                {counts(s.counts)} · {s.server ? "Team" : "This browser"} · Published {when(s.publishedAt)}
                                {s.publishedBy ? ` by ${s.publishedBy}` : ""}
                                {defaults.has(s.id) ? ` · On by default in ${team?.name}` : ""}
                            </div>
                        </div>
                        {team?.role === "admin" && s.server && (
                            <label className="flex shrink-0 items-center gap-1 text-[11px] text-ink-muted" title={`Turn this library on in every file of ${team.name}`}>
                                <input type="checkbox" checked={defaults.has(s.id)} onChange={(e) => setDefault(s.id, e.target.checked)} className="accent-brand-500" />
                                Team default
                            </label>
                        )}
                        <button
                            type="button"
                            role="switch"
                            aria-checked={on}
                            aria-label={on ? `Turn off ${s.name}` : `Turn on ${s.name}`}
                            onClick={() => setLibraryEnabled(s, !on)}
                            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-brand-500" : "bg-ink-subtle/40"}`}
                        >
                            <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

function UpdatesTab() {
    const updates = useLibraryUpdates();
    const [checking, setChecking] = useState(false);
    const byLib = groupUpdates(updates.updates);
    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-ink-muted">{updates.updates.length ? `${updates.updates.length} update${updates.updates.length === 1 ? "" : "s"} for items this file uses` : "Everything this file uses is up to date."}</span>
                <button
                    type="button"
                    className={`${secondary} flex items-center gap-1.5`}
                    onClick={() => {
                        setChecking(true);
                        void checkForUpdates().finally(() => setChecking(false));
                    }}
                >
                    <RefreshCw01 className={`size-3.5 ${checking ? "animate-spin" : ""}`} /> Check again
                </button>
            </div>
            {[...byLib.entries()].map(([lib, list]) => (
                <div key={lib} className="flex items-center gap-2 rounded-lg border border-panel-border p-3">
                    <span className="min-w-0 flex-1 truncate font-semibold">{list[0]?.libraryName}</span>
                    <span className="text-ink-muted">{list.length} change{list.length === 1 ? "" : "s"}</span>
                </div>
            ))}
            {updates.updates.length > 0 && (
                <button
                    type="button"
                    className={primary}
                    onClick={() => {
                        setUi({ libraries: null });
                        openReview(true);
                    }}
                >
                    Review updates
                </button>
            )}
        </div>
    );
}

function groupUpdates(list: LibraryUpdate[]): Map<string, LibraryUpdate[]> {
    const out = new Map<string, LibraryUpdate[]>();
    for (const u of list) out.set(u.libraryId, [...(out.get(u.libraryId) ?? []), u]);
    return out;
}

// ---- Publish ----

const STATUS_LABEL: Record<LibraryChange["status"], string> = { new: "New", changed: "Modified", removed: "Removed" };
const STATUS_TONE: Record<LibraryChange["status"], string> = { new: "text-emerald-400", changed: "text-brand-500", removed: "text-red-400" };

function PublishModal() {
    const fileId = useEditor((s) => s.fileId);
    const [snap, setSnap] = useState<Snapshot | null>(null);
    const [previous, setPrevious] = useState<LibraryManifest | null>(null);
    const [checking, setChecking] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
    const [chosen, setChosen] = useState<Set<string>>(new Set());
    const [description, setDescription] = useState("");
    const [progress, setProgress] = useState<PublishProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    // The document as it was when the window opened (or after hiding or showing an item): what gets published.
    const [doc, setDoc] = useState(() => editor.get().doc);
    // Hide when publishing / Show when publishing: changes the file, then checks again.
    const toggleHidden = (item: { kind: "component" | "style"; id: string }, hidden: boolean) => {
        setHiddenFromPublishing(item, hidden);
        setSnap(null);
        setDoc(editor.get().doc);
    };
    const close = () => setUi({ publish: false });

    useEffect(() => {
        let live = true;
        void (async () => {
            const prev = await publishedManifest(fileId);
            const s = await snapshotFile(doc, (done, total) => live && setChecking({ done, total }));
            if (!live) return;
            setPrevious(prev);
            setSnap(s);
            setChosen(new Set(changesSince(prev, s).map((c) => c.key)));
        })();
        return () => {
            live = false;
        };
    }, [doc, fileId]);

    const changes = useMemo(() => (snap ? changesSince(previous, snap) : []), [snap, previous]);
    const groups: [string, LibraryChange[]][] = [
        ["Components", changes.filter((c) => c.kind === "component")],
        ["Styles", changes.filter((c) => c.kind === "style")],
        ["Variables", changes.filter((c) => c.kind === "variables")],
    ];
    const busy = progress !== null && progress.phase !== "done";
    const publish = async () => {
        if (!snap || !fileId) return;
        setError(null);
        try {
            setProgress({ phase: "saving", done: 0, total: 0 });
            await publishLibrary(doc, fileId, snap, previous, chosen, description, setProgress);
            editor.notify(`Published ${fileMeta(fileId)?.name ?? "the library"}.`);
            close();
        } catch (e) {
            setProgress(null);
            setError(e instanceof Error ? e.message : String(e));
        }
    };
    const meta = fileMeta(fileId);
    return (
        <AriaModalOverlay isOpen isDismissable={!busy} onOpenChange={(open) => !open && !busy && close()} className={overlay}>
            <AriaModal className={`${modal} w-[560px]`}>
                <AriaDialog className="flex min-h-0 flex-col outline-none" aria-label="Publish library">
                    <header className="flex h-12 shrink-0 items-center justify-between border-b border-panel-border px-4">
                        <div className="min-w-0">
                            <h2 className="text-[14px] font-semibold">Publish library</h2>
                        </div>
                        <button type="button" aria-label="Close" disabled={busy} onClick={close} className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                            <XClose className="size-4" />
                        </button>
                    </header>
                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-[12px]">
                        <div className="text-ink-muted">{meta?.name}</div>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            placeholder="Describe your changes (optional)"
                            aria-label="Describe your changes"
                            rows={2}
                            className="w-full resize-none rounded-md border border-panel-border bg-field px-2 py-1.5 text-ink outline-none placeholder:text-ink-subtle focus:border-brand-500"
                        />
                        {!snap ? (
                            <p className="text-ink-muted">{checking.total ? `Checking for changes: ${checking.done.toLocaleString()} of ${checking.total.toLocaleString()} components` : "Checking for changes…"}</p>
                        ) : changes.length === 0 ? (
                            <p className="text-ink-muted">{previous ? "No changes since the last publish." : "This file has no components, styles or variables to publish."}</p>
                        ) : (
                            groups.map(([title, list]) => (list.length ? <ChangeGroup key={title} title={title} list={list} doc={doc} libraryId={previous?.id ?? ""} chosen={chosen} setChosen={setChosen} onHide={(c) => c.kind !== "variables" && toggleHidden({ kind: c.kind, id: c.id }, true)} /> : null))
                        )}
                        {snap && snap.hidden.length > 0 && <HiddenGroup list={snap.hidden} onShow={(h) => h.kind !== "variables" && toggleHidden({ kind: h.kind, id: h.id }, false)} />}
                        {error && <p className="text-red-400">{error}</p>}
                    </div>
                    <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-panel-border px-4 text-[12px]">
                        <span className="min-w-0 flex-1 truncate text-ink-muted">
                            {progress
                                ? progress.phase === "uploading"
                                    ? `Uploading ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`
                                    : progress.phase === "saving"
                                      ? `Saving ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`
                                      : "Published"
                                : snap
                                  ? `${chosen.size.toLocaleString()} of ${changes.length.toLocaleString()} changes selected`
                                  : ""}
                        </span>
                        <button type="button" className={secondary} disabled={busy} onClick={close}>
                            Cancel
                        </button>
                        <button type="button" className={`${primary} flex items-center gap-1.5`} disabled={!snap || busy || (changes.length > 0 && chosen.size === 0) || (changes.length === 0 && Boolean(previous))} onClick={() => void publish()}>
                            <Upload01 className="size-3.5" /> Publish
                        </button>
                    </footer>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

// What this publish leaves out: names starting with "." or "_", and items marked Hide when publishing.
function HiddenGroup({ list, onShow }: { list: HiddenItem[]; onShow: (item: HiddenItem) => void }) {
    const [open, setOpen] = useState(false);
    return (
        <section className="rounded-lg border border-panel-border">
            <button type="button" onClick={() => setOpen(!open)} className="flex h-9 w-full items-center gap-1 px-2 text-left font-semibold">
                {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                Hidden
                <span className="font-normal text-ink-muted">{list.length.toLocaleString()}</span>
            </button>
            {open && (
                <div className="border-t border-panel-border">
                    <p className="px-2 py-1.5 text-ink-muted">Not published. Names that start with . or _ stay hidden; rename them to publish.</p>
                    {list.map((h) => (
                        <div key={h.key} className="group flex h-9 items-center gap-2 px-2 hover:bg-panel-hover">
                            <EyeOff className="size-3.5 shrink-0 text-ink-subtle" />
                            <span className="min-w-0 flex-1 truncate">{h.name}</span>
                            <span className="text-ink-subtle">{h.kind === "component" ? (h.detail === "componentSet" ? "Component set" : "Component") : h.kind === "style" ? "Style" : "Collection"}</span>
                            {h.reason === "flag" ? (
                                <button type="button" onClick={() => onShow(h)} className="flex h-6 items-center gap-1 rounded px-1.5 text-brand-500 hover:bg-black/20">
                                    <Eye className="size-3.5" /> Show when publishing
                                </button>
                            ) : (
                                <span className="text-ink-subtle" title="The name starts with . or _">By name</span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

function ChangeGroup({ title, list, doc, libraryId, chosen, setChosen, onHide }: { title: string; list: LibraryChange[]; doc: ReturnType<typeof editor.get>["doc"]; libraryId: string; chosen: Set<string>; setChosen: (s: Set<string>) => void; onHide: (c: LibraryChange) => void }) {
    const [open, setOpen] = useState(list.length <= 60);
    const [shown, setShown] = useState(150);
    const all = list.every((c) => chosen.has(c.key));
    const some = list.some((c) => chosen.has(c.key));
    const toggleAll = () => {
        const next = new Set(chosen);
        for (const c of list) {
            if (all) next.delete(c.key);
            else next.add(c.key);
        }
        setChosen(next);
    };
    void libraryId;
    return (
        <section className="rounded-lg border border-panel-border">
            <div className="flex h-9 items-center gap-2 px-2">
                <input
                    type="checkbox"
                    aria-label={`Publish all ${title.toLowerCase()}`}
                    checked={all}
                    ref={(el) => {
                        if (el) el.indeterminate = some && !all;
                    }}
                    onChange={toggleAll}
                    className="accent-brand-500"
                />
                <button type="button" onClick={() => setOpen(!open)} className="flex flex-1 items-center gap-1 text-left font-semibold">
                    {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    {title}
                    <span className="font-normal text-ink-muted">{list.length.toLocaleString()}</span>
                </button>
            </div>
            {open && (
                <div className="border-t border-panel-border">
                    {list.slice(0, shown).map((c) => (
                        <label key={c.key} className="group flex h-10 items-center gap-2 px-2 hover:bg-panel-hover" title={c.description || undefined}>
                            <input
                                type="checkbox"
                                checked={chosen.has(c.key)}
                                onChange={() => {
                                    const next = new Set(chosen);
                                    if (next.has(c.key)) next.delete(c.key);
                                    else next.add(c.key);
                                    setChosen(next);
                                }}
                                className="accent-brand-500"
                            />
                            <ChangePreview change={c} doc={doc} />
                            <span className="min-w-0 flex-1 truncate">{c.name}</span>
                            {c.kind !== "variables" && c.status !== "removed" && (
                                <button
                                    type="button"
                                    aria-label="Hide when publishing"
                                    title="Hide when publishing"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        onHide(c);
                                    }}
                                    className="flex size-6 items-center justify-center rounded text-ink-muted opacity-0 group-hover:opacity-100 hover:bg-black/20 hover:text-ink"
                                >
                                    <EyeOff className="size-3.5" />
                                </button>
                            )}
                            <span className={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</span>
                        </label>
                    ))}
                    {list.length > shown && (
                        <button type="button" onClick={() => setShown(shown + 300)} className="h-8 w-full text-brand-500 hover:bg-panel-hover">
                            Show {Math.min(300, list.length - shown).toLocaleString()} more
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}

function ChangePreview({ change, doc }: { change: LibraryChange; doc: ReturnType<typeof editor.get>["doc"] }) {
    if (change.kind === "component" && doc.nodes[change.id]) return <AssetThumb doc={doc} id={change.id} w={64} h={48} className="h-7 w-9 shrink-0 rounded" />;
    if (change.kind === "style") {
        const color = doc.styles?.colors.find((s) => s.id === change.id);
        if (color) return <span className="size-6 shrink-0 rounded border border-black/20" style={{ background: swatchCss(color.paint, {}) }} />;
        return <span className="flex size-6 shrink-0 items-center justify-center rounded bg-field text-[10px] font-semibold text-ink-muted">{change.detail === "text" ? "Ag" : "fx"}</span>;
    }
    return <span className="flex size-6 shrink-0 items-center justify-center rounded bg-field text-ink-muted">{change.kind === "variables" ? "⬡" : <ComponentIcon className="size-3.5" />}</span>;
}

// ---- Updates ----

function UpdateBanner() {
    const updates = useLibraryUpdates();
    const homeOpen = useEditor((s) => s.homeOpen);
    if (homeOpen || !updates.updates.length || updates.reviewOpen || updates.dismissed === updatesSignature(updates.updates)) return null;
    const libs = new Set(updates.updates.map((u) => u.libraryName));
    return (
        <div role="status" className="fixed right-72 bottom-20 z-40 flex w-80 items-start gap-3 rounded-lg border border-panel-border bg-panel-raised p-3 text-[12px] text-ink shadow-2xl">
            <BookOpen01 className="mt-0.5 size-4 shrink-0 text-brand-500" />
            <div className="min-w-0 flex-1">
                <div className="font-semibold">Library updates available</div>
                <div className="text-ink-muted">
                    {updates.updates.length} update{updates.updates.length === 1 ? "" : "s"} from {[...libs].join(", ")}
                </div>
                <div className="mt-2 flex gap-2">
                    <button type="button" className={primary} onClick={() => openReview(true)}>
                        Review
                    </button>
                    <button type="button" className={secondary} onClick={dismissUpdates}>
                        Later
                    </button>
                </div>
            </div>
        </div>
    );
}

// Whether an update touches the page you're on: instances of the component, or layers using the
// style, there. Variables count everywhere.
function onPage(doc: NagmaDocument, pageId: string, u: LibraryUpdate): boolean {
    if (u.kind === "variables") return true;
    const nodes = Object.values(doc.nodes);
    if (u.kind === "style") {
        const id = `${u.libraryId}~${u.id}`;
        return nodes.some((n) => (n.fillStyleId === id || n.strokeStyleId === id || n.textStyleId === id || n.effectStyleId === id) && pageOf(doc, n) === pageId);
    }
    const local = u.moved ? doc.nodes[u.moved.localId] : nodes.find((n) => n.libraryId === u.libraryId && n.libraryKey === u.id);
    if (!local) return false;
    const mains = new Set([local.id, ...local.children]);
    return nodes.some((n) => n.type === "instance" && n.componentId && mains.has(n.componentId) && pageOf(doc, n) === pageId);
}

function ReviewModal() {
    const updates = useLibraryUpdates();
    const doc = useEditor((s) => s.doc);
    const pageId = useEditor((s) => s.pageId);
    const [busy, setBusy] = useState(false);
    const [allPages, setAllPages] = useState(false);
    const [open, setOpen] = useState<string | null>(updates.updates[0]?.key ?? null);
    const here = useMemo(() => updates.updates.filter((u) => onPage(doc, pageId, u)), [updates.updates, doc, pageId]);
    const shown = allPages ? updates.updates : here;
    const close = () => openReview(false);
    const accept = async (list: LibraryUpdate[]) => {
        setBusy(true);
        try {
            await acceptUpdates(list);
        } catch (e) {
            editor.notify(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };
    useEffect(() => {
        if (!updates.updates.length) close();
    }, [updates.updates.length]);
    return (
        <AriaModalOverlay isOpen isDismissable={!busy} onOpenChange={(o) => !o && close()} className={overlay}>
            <AriaModal className={`${modal} w-[620px]`}>
                <AriaDialog className="flex min-h-0 flex-col outline-none" aria-label="Review library updates">
                    <header className="flex h-12 shrink-0 items-center justify-between border-b border-panel-border px-4">
                        <h2 className="text-[14px] font-semibold">Review library updates</h2>
                        <button type="button" aria-label="Close" onClick={close} className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                            <XClose className="size-4" />
                        </button>
                    </header>
                    <div className="flex shrink-0 items-center gap-2 border-b border-panel-border px-4 py-2 text-[12px]">
                        <span className="flex-1 text-ink-muted">{allPages ? `${updates.updates.length} update${updates.updates.length === 1 ? "" : "s"} in this file` : `${here.length} of ${updates.updates.length} on this page`}</span>
                        <div className="flex rounded-md bg-field p-0.5" role="radiogroup" aria-label="Show updates for">
                            {[false, true].map((all) => (
                                <button key={String(all)} type="button" role="radio" aria-checked={allPages === all} onClick={() => setAllPages(all)} className={`h-6 rounded px-2 text-[11px] ${allPages === all ? "bg-panel-raised text-ink shadow" : "text-ink-muted"}`}>
                                    {all ? "All pages" : "Current page"}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[12px]">
                        {!shown.length && <p className="p-2 text-ink-muted">Nothing on this page uses these updates. Switch to All pages to see them.</p>}
                        {[...groupUpdates(shown).entries()].map(([lib, list]) => (
                            <div key={lib} className="mb-3">
                                <div className="px-1 pb-1 font-semibold text-ink-muted">{list[0]?.libraryName}</div>
                                {list.map((u) => (
                                    <div key={u.key} className="border-b border-panel-border">
                                        <div className="flex h-10 items-center gap-2 px-1">
                                            <button type="button" onClick={() => setOpen(open === u.key ? null : u.key)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                                                {open === u.key ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                                                <span className="min-w-0 truncate">{u.name}</span>
                                                <span className="shrink-0 text-ink-subtle">{u.moved ? `Moved from ${u.moved.fromName}` : u.kind === "component" ? "Component" : u.kind === "style" ? "Style" : "Variables"}</span>
                                            </button>
                                            <button type="button" className={secondary} disabled={busy} onClick={() => void accept([u])}>
                                                Accept
                                            </button>
                                        </div>
                                        {open === u.key && <BeforeAfter update={u} doc={doc} />}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                    <footer className="flex h-14 shrink-0 items-center justify-end gap-2 border-t border-panel-border px-4 text-[12px]">
                        <button type="button" className={secondary} disabled={busy} onClick={close}>
                            Not now
                        </button>
                        <button type="button" className={primary} disabled={busy || !updates.updates.length} onClick={() => void accept(updates.updates)}>
                            {busy ? "Updating…" : "Accept all"}
                        </button>
                    </footer>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

function BeforeAfter({ update, doc }: { update: LibraryUpdate; doc: ReturnType<typeof editor.get>["doc"] }) {
    const box = "flex-1 rounded-md border border-panel-border p-2";
    const label = "mb-1 text-[11px] text-ink-muted";
    if (update.kind === "component") return <ComponentBeforeAfter update={update} doc={doc} />;
    if (update.kind === "style") {
        const show = (s: unknown) => {
            if (!s || typeof s !== "object") return <span className="text-ink-subtle">Not in this file</span>;
            const style = s as { paint?: Parameters<typeof swatchCss>[0]; fontFamily?: string; fontSize?: number; fontWeight?: number; shadow?: { x: number; y: number; blur: number; color: string } | null; blur?: number; name: string; description?: string };
            if (style.paint) return <span className="block h-10 w-full rounded border border-black/20" style={{ background: swatchCss(style.paint, {}) }} />;
            if (style.fontFamily) return <span style={{ fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontSize: Math.min(28, style.fontSize ?? 14) }}>Ag {style.fontFamily} {style.fontSize}</span>;
            return <span>{style.shadow ? `Shadow ${style.shadow.x}, ${style.shadow.y}, blur ${style.shadow.blur}` : `Blur ${style.blur ?? 0}`}</span>;
        };
        return (
            <div className="flex gap-2 px-1 pb-2">
                <div className={box}>
                    <div className={label}>Before</div>
                    {show(update.before)}
                </div>
                <div className={box}>
                    <div className={label}>After</div>
                    {show(update.after?.style)}
                </div>
            </div>
        );
    }
    return <VariablesDiff before={update.beforeCollection} after={update.afterCollection} />;
}

// A component update side by side, or overlaid (the new version over the old, with a slider).
function ComponentBeforeAfter({ update, doc }: { update: LibraryUpdate; doc: NagmaDocument }) {
    const [mode, setMode] = useState<"side" | "overlay">("side");
    const [mix, setMix] = useState(50);
    const local = update.moved ? doc.nodes[update.moved.localId] : Object.values(doc.nodes).find((n) => n.libraryId === update.libraryId && n.libraryKey === update.id);
    const before = local ? <AssetThumb doc={doc} id={local.id} w={240} h={150} className="aspect-[8/5] w-full rounded" /> : <div className="aspect-[8/5] w-full rounded bg-field" />;
    const after = <LibraryThumb libraryId={update.libraryId} assetId={update.id} hash={update.hash} w={240} h={150} className="aspect-[8/5] w-full rounded" />;
    return (
        <div className="space-y-2 px-1 pb-2">
            <div className="flex justify-end">
                <div className="flex rounded-md bg-field p-0.5" role="radiogroup" aria-label="Compare">
                    {(["side", "overlay"] as const).map((m) => (
                        <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`h-6 rounded px-2 text-[11px] ${mode === m ? "bg-panel-raised text-ink shadow" : "text-ink-muted"}`}>
                            {m === "side" ? "Side by side" : "Overlay"}
                        </button>
                    ))}
                </div>
            </div>
            {mode === "side" ? (
                <div className="flex gap-2">
                    <div className="flex-1 rounded-md border border-panel-border p-2">
                        <div className="mb-1 text-[11px] text-ink-muted">Before</div>
                        {before}
                    </div>
                    <div className="flex-1 rounded-md border border-panel-border p-2">
                        <div className="mb-1 text-[11px] text-ink-muted">After</div>
                        {after}
                    </div>
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="relative mx-auto w-2/3 rounded-md border border-panel-border p-2">
                        {before}
                        <div className="absolute inset-2" style={{ opacity: mix / 100 }}>
                            {after}
                        </div>
                    </div>
                    <label className="flex items-center gap-2 text-[11px] text-ink-muted">
                        Before
                        <input type="range" min={0} max={100} value={mix} onChange={(e) => setMix(Number(e.target.value))} aria-label="Before and after" className="flex-1 accent-brand-500" />
                        After
                    </label>
                </div>
            )}
        </div>
    );
}

function VariablesDiff({ before, after }: { before?: VariableCollection; after?: VariableCollection }) {
    if (!after) return null;
    const mode = after.defaultModeId ?? after.modes[0]?.id ?? "";
    const old = new Map((before?.variables ?? []).map((v) => [v.id, v]));
    const rows = after.variables.filter((v) => JSON.stringify(old.get(v.id)?.values) !== JSON.stringify(v.values) || old.get(v.id)?.name !== v.name);
    const gone = (before?.variables ?? []).filter((v) => !after.variables.some((x) => x.id === v.id));
    const cell = (value: unknown) => {
        if (value === undefined) return <span className="text-ink-subtle">None</span>;
        if (typeof value === "string" && value.startsWith("#")) return (
            <span className="flex items-center gap-1">
                <span className="size-3 rounded-sm border border-black/20" style={{ background: value }} />
                {value}
            </span>
        );
        if (typeof value === "object" && value && "alias" in value) return <span className="text-ink-muted">Alias</span>;
        return <span>{String(value)}</span>;
    };
    return (
        <div className="px-1 pb-2">
            <div className="grid grid-cols-[1fr_1fr_1fr] gap-x-2 gap-y-1">
                <span className="text-[11px] text-ink-muted">Variable</span>
                <span className="text-[11px] text-ink-muted">Before</span>
                <span className="text-[11px] text-ink-muted">After</span>
                {rows.slice(0, 40).map((v) => (
                    <div key={v.id} className="contents">
                        <span className="truncate">{v.name}</span>
                        {cell(old.get(v.id)?.values[mode])}
                        {cell(v.values[mode])}
                    </div>
                ))}
                {gone.map((v) => (
                    <div key={v.id} className="contents">
                        <span className="truncate line-through">{v.name}</span>
                        {cell(v.values[mode])}
                        <span className="text-red-400">Removed</span>
                    </div>
                ))}
            </div>
            {rows.length > 40 && <p className="mt-1 text-ink-muted">and {rows.length - 40} more</p>}
        </div>
    );
}
