import { ChevronDown, GitBranch01, X } from "@untitledui/icons";
import { useEffect, useMemo, useState } from "react";
import { Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { type BranchInfo, type BranchList, type Change, branchChanges, changePictures, createBranch, decideReview, listBranches, mainUpdates, mergeBranch, openFile, openMain, setBranch, updateFromMain } from "../engine/branches";
import type { NagmaDocument } from "../engine/types";
import { collab, useCollab } from "../engine/collab";
import { timeAgo } from "../engine/comments";
import { editor, useEditor } from "../engine/store";
import { Avatar } from "./avatar";
import { DarkMenu } from "./collab-menu";

// Branching UI: the branch label over the canvas with its menu, and the dialogs to create a branch,
// review and merge it, and list a file's branches.

const close = () => collab.set({ branchDialog: null });

function Shell({ title, width = "w-[440px]", children }: { title: string; width?: string; children: React.ReactNode }) {
    return (
        <AriaModal className={`${width} max-h-[80vh] overflow-hidden rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none`}>
            <AriaDialog aria-label={title} className="flex max-h-[80vh] flex-col outline-none">
                <div className="flex h-12 shrink-0 items-center justify-between border-b border-panel-border px-4">
                    <h2 className="truncate text-[13px] font-semibold">{title}</h2>
                    <button type="button" aria-label="Close" onClick={close} className="rounded p-1 text-ink-muted hover:bg-panel-hover">
                        <X className="size-4" />
                    </button>
                </div>
                {children}
            </AriaDialog>
        </AriaModal>
    );
}

export function BranchDialogs() {
    const dialog = useCollab((s) => s.branchDialog);
    const overlay = (id: typeof dialog, child: React.ReactNode) => (
        <AriaModalOverlay isOpen={dialog === id} onOpenChange={(o) => !o && close()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-20">
            {child}
        </AriaModalOverlay>
    );
    return (
        <>
            {overlay("create", <CreateBranch />)}
            {overlay("review", <ReviewBranch />)}
            {overlay("list", <BranchesList />)}
            {overlay("update", <UpdateFromMain />)}
        </>
    );
}

function CreateBranch() {
    const [name, setName] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    return (
        <Shell title="Create branch">
            <form
                className="space-y-3 p-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    setBusy(true);
                    createBranch(name.trim())
                        .then(close)
                        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
                        .finally(() => setBusy(false));
                }}
            >
                <p className="text-[12px] leading-relaxed text-ink-muted">A branch is a copy of this file to explore changes in. Main stays as it is until you merge the branch back.</p>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Branch name" aria-label="Branch name" maxLength={80} className="h-9 w-full rounded-md border border-panel-border bg-field px-3 text-[12px] outline-none focus:border-brand-500" />
                {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div>}
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={close} className="h-8 rounded-md px-3 text-[12px] text-ink-muted hover:bg-panel-hover">
                        Cancel
                    </button>
                    <button type="submit" disabled={busy || !name.trim()} className="h-8 rounded-md bg-brand-500 px-4 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                        Create
                    </button>
                </div>
            </form>
        </Shell>
    );
}

const KIND_LABEL = { added: "Added", changed: "Edited", removed: "Removed" } as const;
const KIND_TONE = { added: "text-emerald-500", changed: "text-brand-500", removed: "text-red-400" } as const;

// The review badge on a branch.
const REVIEW_BADGE = {
    requested: { label: "In review", tone: "bg-brand-500/15 text-brand-500" },
    approved: { label: "Approved", tone: "bg-emerald-500/15 text-emerald-500" },
    changes: { label: "Changes suggested", tone: "bg-amber-500/15 text-amber-500" },
} as const;

export function ReviewBadge({ state }: { state: BranchInfo["reviewState"] }) {
    if (!state) return null;
    const b = REVIEW_BADGE[state];
    return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${b.tone}`}>{b.label}</span>;
}

function ChangeCard({ c, onOpen }: { c: Change; onOpen?: () => void }) {
    const pic = (src: string | null, label: string) =>
        src ? <img src={src} alt={`${c.name}, ${label}`} className="h-16 w-24 shrink-0 rounded border border-panel-border object-cover" /> : <span className="flex h-16 w-24 shrink-0 items-center justify-center rounded border border-dashed border-panel-border text-[10px] text-ink-subtle">{label === "before" ? "Not in main" : "Removed"}</span>;
    return (
        <button type="button" onClick={onOpen} disabled={!onOpen} className="flex w-full items-center gap-3 rounded-md border border-panel-border p-2 text-left enabled:hover:border-ink-subtle">
            <div className="flex gap-1.5">
                {c.kind !== "added" && pic(c.before, "before")}
                {c.kind !== "removed" && pic(c.after, "after")}
            </div>
            <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium">{c.name}</div>
                <div className="text-[11px] text-ink-subtle">
                    <span className={KIND_TONE[c.kind]}>{KIND_LABEL[c.kind]}</span> · {c.type === "page" ? (c.page === "File" ? "File" : "Page") : "Frame"}
                </div>
            </div>
        </button>
    );
}

// Changes grouped under the page they're on (pages added or removed, and file-wide settings, first).
function ByPage({ changes, onOpen }: { changes: Change[]; onOpen?: (c: Change) => void }) {
    const pages = new Map<string, Change[]>();
    for (const c of changes) {
        const key = c.type === "page" ? (c.page === "File" ? "File" : "Pages") : c.page || "Page";
        pages.set(key, [...(pages.get(key) ?? []), c]);
    }
    return (
        <>
            {[...pages].map(([page, list]) => (
                <div key={page} className="space-y-1.5">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-ink-muted">
                        <span className="truncate">{page}</span>
                        <span className="text-ink-subtle">{list.length === 1 ? "1 change" : `${list.length} changes`}</span>
                    </div>
                    {list.map((c) => (
                        <ChangeCard key={`${c.kind}${c.id}`} c={c} onOpen={onOpen && c.page !== "File" ? () => onOpen(c) : undefined} />
                    ))}
                </div>
            ))}
        </>
    );
}

// One change up close: side by side, or overlaid (the new version over the old, with a slider).
function ChangeDetail({ c, before, after, onBack }: { c: Change; before: NagmaDocument; after: NagmaDocument; onBack: () => void }) {
    const [mode, setMode] = useState<"side" | "overlay">("side");
    const [mix, setMix] = useState(50);
    const pics = useMemo(() => changePictures(before, after, c), [before, after, c]);
    const empty = (label: string) => <span className="flex aspect-[13/8] w-full items-center justify-center rounded border border-dashed border-panel-border text-[11px] text-ink-subtle">{label}</span>;
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <button type="button" onClick={onBack} className="h-7 rounded-md px-2 text-[12px] text-ink-muted hover:bg-panel-hover">
                    ← All changes
                </button>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                    {c.name} <span className={KIND_TONE[c.kind]}>{KIND_LABEL[c.kind]}</span>
                </span>
                <div className="flex rounded-md bg-field p-0.5" role="radiogroup" aria-label="Compare">
                    {(["side", "overlay"] as const).map((m) => (
                        <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`h-6 rounded px-2 text-[11px] ${mode === m ? "bg-panel-raised text-ink shadow" : "text-ink-muted"}`}>
                            {m === "side" ? "Side by side" : "Overlay"}
                        </button>
                    ))}
                </div>
            </div>
            {mode === "side" ? (
                <div className="grid grid-cols-2 gap-2">
                    {[
                        ["Before", pics.before, "Not in main"],
                        ["After", pics.after, "Removed"],
                    ].map(([label, src, none]) => (
                        <div key={label} className="space-y-1">
                            <div className="text-[11px] text-ink-subtle">{label}</div>
                            {src ? <img src={src} alt={`${c.name}, ${label}`} className="w-full rounded border border-panel-border bg-white object-contain" /> : empty(none ?? "")}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="relative overflow-hidden rounded border border-panel-border bg-white">
                        {pics.before ? <img src={pics.before} alt={`${c.name}, before`} className="block w-full" /> : empty("Not in main")}
                        {pics.after && <img src={pics.after} alt={`${c.name}, after`} className="absolute inset-0 block w-full" style={{ opacity: mix / 100 }} />}
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

function ReviewBranch() {
    const branch = useCollab((s) => s.branch);
    const fileId = useCollab((s) => s.fileId);
    const tick = useCollab((s) => s.branchesChanged);
    const accountId = useCollab((s) => s.accountId);
    const [state, setState] = useState<{ changes: Change[]; mainChanged: boolean; base: NagmaDocument; branch: NagmaDocument } | null>(null);
    const [info, setInfo] = useState<BranchInfo | null>(null);
    const [mainRole, setMainRole] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [reviewer, setReviewer] = useState("");
    const [note, setNote] = useState("");
    const [detail, setDetail] = useState<Change | null>(null);
    useEffect(() => {
        if (!fileId || !branch) return;
        branchChanges(fileId)
            .then(setState)
            .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
        listBranches(fileId)
            .then((l) => {
                setInfo(l?.branches.find((b) => b.id === fileId) ?? null);
                setMainRole(l?.main.role ?? null);
            })
            .catch(() => undefined);
    }, [fileId, branch, tick]);
    if (!branch || !fileId) return null;
    const run = (job: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        job()
            .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
            .finally(() => setBusy(false));
    };
    const review = info?.review ?? null;
    const reviewers = review?.reviewers ?? (review?.reviewer ? [review.reviewer] : []);
    const decisions = Object.values(review?.decisions ?? {});
    // The people asked to review, or editors of the main file (the server checks the same).
    const canDecide = Boolean(review && accountId && review.requestedBy?.id !== accountId && (reviewers.some((r) => r.id === accountId) || mainRole === "edit"));
    return (
        <Shell title={`Review and merge ${branch.name}`} width="w-[600px]">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                {state?.mainChanged && (
                    <div className="flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
                        <span className="flex-1">Main has changed since this branch started. Review main's changes and update the branch before merging.</span>
                        <button type="button" disabled={busy} onClick={() => collab.set({ branchDialog: "update" })} className="h-6 shrink-0 rounded bg-amber-500 px-2 font-semibold text-white">
                            Review updates
                        </button>
                    </div>
                )}
                {!state && !error && <p className="text-[12px] text-ink-muted">Comparing with main…</p>}
                {state && state.changes.length === 0 && <p className="text-[12px] text-ink-muted">No changes yet. Edit the branch, then come back to merge.</p>}
                {state && detail ? <ChangeDetail c={detail} before={state.base} after={state.branch} onBack={() => setDetail(null)} /> : state && <ByPage changes={state.changes} onOpen={setDetail} />}
                <div className="space-y-2 border-t border-panel-border pt-3">
                    <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold">Reviews</span>
                        <ReviewBadge state={info?.reviewState ?? null} />
                    </div>
                    {review && (
                        <div className="space-y-1.5 text-[11px] text-ink-muted">
                            <p>
                                {review.requestedBy.name} asked {reviewers.length ? reviewers.map((r) => r.name).join(", ") : "for a review"} {timeAgo(review.at)}.{" "}
                                <button type="button" className="text-brand-500 hover:underline" onClick={() => run(() => setBranch(fileId, { review: null }).then(() => setInfo((i) => (i ? { ...i, review: null, reviewState: null } : i))))}>
                                    Cancel request
                                </button>
                            </p>
                            {decisions.map((d) => (
                                <div key={d.by.id} className="flex items-start gap-2 rounded-md bg-field p-2">
                                    <Avatar name={d.by.name} color={d.by.color} size={18} />
                                    <span className="min-w-0 flex-1">
                                        <b className="text-ink">{d.by.name}</b> {d.decision === "approved" ? "approved" : "suggested changes"} · {timeAgo(d.at)}
                                        {d.note && <span className="block text-ink">{d.note}</span>}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                    {canDecide && (
                        <div className="space-y-2 rounded-md border border-panel-border p-2">
                            <textarea value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.stopPropagation()} rows={2} placeholder="Leave a note (it goes on the branch as a comment when you suggest changes)" aria-label="Review note" className="w-full resize-none rounded-md bg-field p-2 text-[12px] outline-none focus:ring-1 focus:ring-brand-500" />
                            <div className="flex justify-end gap-2">
                                <button type="button" disabled={busy} onClick={() => run(() => decideReview(fileId, "changes", note).then((b) => (setInfo(b), setNote(""))))} className="h-7 rounded-md border border-panel-border px-3 text-[12px] hover:bg-panel-hover disabled:opacity-50">
                                    Suggest changes
                                </button>
                                <button type="button" disabled={busy} onClick={() => run(() => decideReview(fileId, "approved", note).then((b) => (setInfo(b), setNote(""))))} className="h-7 rounded-md bg-emerald-600 px-3 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                                    Approve
                                </button>
                            </div>
                        </div>
                    )}
                    <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            run(() =>
                                setBranch(fileId, { review: { emails: reviewer.trim() } }).then((b) => {
                                    setInfo(b);
                                    setReviewer("");
                                    editor.notify("Review requested. Reviewers get a notification and an email.");
                                }),
                            );
                        }}
                    >
                        <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Reviewers' emails, comma separated" aria-label="Reviewers' emails" className="h-8 min-w-0 flex-1 rounded-md border border-panel-border bg-field px-3 text-[12px] outline-none focus:border-brand-500" />
                        <button type="submit" disabled={busy || !reviewer.trim()} className="h-8 rounded-md border border-panel-border px-3 text-[12px] hover:bg-panel-hover disabled:opacity-50">
                            Request review
                        </button>
                    </form>
                </div>
                {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div>}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-panel-border px-4 py-3">
                {state?.mainChanged && <span className="mr-auto text-[11px] text-ink-subtle">Update from main to merge.</span>}
                <button type="button" onClick={close} className="h-8 rounded-md px-3 text-[12px] text-ink-muted hover:bg-panel-hover">
                    Cancel
                </button>
                <button
                    type="button"
                    disabled={busy || !state || state.changes.length === 0 || state.mainChanged}
                    onClick={() =>
                        run(async () => {
                            await mergeBranch(fileId);
                            close();
                            await openMain();
                            editor.notify(`Merged "${branch.name}" into main. The branch is archived.`);
                        })
                    }
                    className="h-8 rounded-md bg-brand-500 px-4 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                >
                    Merge branch
                </button>
            </div>
        </Shell>
    );
}

// Updating from main: what main changed since the branch started, by page, and the layers both
// changed, each kept as the branch has it or taken from main. Applied all at once.
function UpdateFromMain() {
    const branch = useCollab((s) => s.branch);
    const fileId = useCollab((s) => s.fileId);
    const [state, setState] = useState<Awaited<ReturnType<typeof mainUpdates>> | null>(null);
    const [take, setTake] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [detail, setDetail] = useState<Change | null>(null);
    useEffect(() => {
        if (!fileId || !branch) return;
        mainUpdates(fileId)
            .then(setState)
            .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }, [fileId, branch]);
    if (!branch || !fileId) return null;
    const conflictIds = new Set(state?.conflicts.map((c) => c.id) ?? []);
    return (
        <Shell title="Update from main" width="w-[600px]">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                {!state && !error && <p className="text-[12px] text-ink-muted">Comparing main with where this branch started…</p>}
                {state && state.changes.length === 0 && <p className="text-[12px] text-ink-muted">Main hasn't changed since this branch started. Nothing to update.</p>}
                {state && state.changes.length > 0 && !detail && <p className="text-[12px] text-ink-muted">These changes from main come into the branch. You can't pick and choose, except where main and this branch changed the same thing.</p>}
                {state && detail ? (
                    <ChangeDetail c={detail} before={state.base} after={state.main} onBack={() => setDetail(null)} />
                ) : (
                    state && <ByPage changes={state.changes.filter((c) => !conflictIds.has(c.id))} onOpen={setDetail} />
                )}
                {state && state.conflicts.length > 0 && !detail && (
                    <div className="space-y-1.5">
                        <div className="text-[11px] font-semibold text-amber-500">Conflicts ({state.conflicts.length})</div>
                        {state.conflicts.map((c) => (
                            <div key={c.id} className="flex items-center gap-3 rounded-md border border-amber-500/40 p-2">
                                <div className="flex gap-1.5">
                                    {[
                                        ["Main", c.before ?? null, true],
                                        ["Branch", c.after ?? null, false],
                                    ].map(([label, src, fromMain]) => (
                                        <button key={String(label)} type="button" onClick={() => setTake((t) => { const n = new Set(t); if (fromMain) n.add(c.id); else n.delete(c.id); return n; })} className={`relative rounded border-2 ${take.has(c.id) === fromMain ? "border-brand-500" : "border-transparent"}`} aria-pressed={take.has(c.id) === fromMain}>
                                            {src ? <img src={String(src)} alt={`${c.name} in ${label}`} className="h-14 w-20 rounded object-cover" /> : <span className="flex h-14 w-20 items-center justify-center text-[10px]">{String(label)}</span>}
                                            <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] text-white">{String(label)}</span>
                                        </button>
                                    ))}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-[12px] font-medium">{c.name}</div>
                                    <div className="text-[11px] text-ink-subtle">{c.page} · keep {take.has(c.id) ? "main's version" : "the branch's version"}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div>}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-panel-border px-4 py-3">
                <button type="button" onClick={close} className="h-8 rounded-md px-3 text-[12px] text-ink-muted hover:bg-panel-hover">
                    Cancel
                </button>
                <button
                    type="button"
                    disabled={busy || !state || state.changes.length === 0}
                    onClick={() => {
                        setBusy(true);
                        updateFromMain(fileId, [...take])
                            .then(() => collab.set({ branchDialog: "review" }))
                            .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
                            .finally(() => setBusy(false));
                    }}
                    className="h-8 rounded-md bg-brand-500 px-4 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                >
                    Update branch
                </button>
            </div>
        </Shell>
    );
}

function BranchesList() {
    const fileId = useCollab((s) => s.fileId);
    const tick = useCollab((s) => s.branchesChanged);
    const [list, setList] = useState<BranchList | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [archived, setArchived] = useState(false);
    useEffect(() => {
        listBranches()
            .then(setList)
            .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }, [fileId, tick]);
    const shown = list?.branches.filter((b) => (archived ? b.status === "archived" : b.status === "active")) ?? [];
    return (
        <Shell title="Branches">
            <div className="flex gap-1 border-b border-panel-border px-4 py-2">
                {[false, true].map((a) => (
                    <button key={String(a)} type="button" onClick={() => setArchived(a)} className={`h-7 rounded-md px-2 text-[12px] ${archived === a ? "bg-panel-hover font-semibold text-ink" : "text-ink-muted hover:text-ink"}`}>
                        {a ? "Archived" : "Active"}
                    </button>
                ))}
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                {error && <div className="m-2 rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div>}
                {list && !archived && (
                    <button type="button" onClick={() => (close(), list.main.id !== fileId && openFile(list.main.id, list.main.key, list.main.name))} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-panel-hover ${list.main.id === fileId ? "bg-panel-hover" : ""}`}>
                        <GitBranch01 className="size-4 text-ink-muted" />
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{list.main.name}</span>
                        <span className="text-[11px] text-ink-subtle">Main</span>
                    </button>
                )}
                {list && shown.length === 0 && <p className="px-2 py-4 text-center text-[12px] text-ink-muted">{archived ? "No archived branches." : "No branches yet."}</p>}
                {shown.map((b) => (
                    <div key={b.id} className={`group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-panel-hover ${b.id === fileId ? "bg-panel-hover" : ""}`}>
                        {b.author ? <Avatar name={b.author.name} color={b.author.color} size={20} /> : <GitBranch01 className="size-4" />}
                        <button type="button" onClick={() => (close(), b.id !== fileId && openFile(b.id, b.key, `${list?.main.name ?? ""} / ${b.name}`))} className="min-w-0 flex-1 text-left">
                            <span className="flex items-center gap-1.5">
                                <span className="truncate text-[12px] font-medium">{b.name}</span>
                                <ReviewBadge state={b.reviewState} />
                            </span>
                            <span className="block text-[11px] text-ink-subtle">
                                {b.mergedAt ? `Merged ${timeAgo(b.mergedAt)}` : `Edited ${timeAgo(b.updatedAt)}`}
                                {b.review && b.reviewState === "requested" ? ` · Review requested${b.review.reviewer ? ` from ${(b.review.reviewers ?? [b.review.reviewer]).map((r) => r.name).join(", ")}` : ""}` : ""}
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() =>
                                void setBranch(b.id, { status: archived ? "active" : "archived" })
                                    .then(() => listBranches().then(setList))
                                    .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
                            }
                            className="h-6 rounded px-2 text-[11px] text-ink-muted opacity-0 group-hover:opacity-100 hover:bg-panel hover:text-ink"
                        >
                            {archived ? "Restore" : "Archive"}
                        </button>
                    </div>
                ))}
            </div>
        </Shell>
    );
}

// Over the canvas while on a branch: "main / branch" with the branch's menu.
export function BranchPill() {
    const branch = useCollab((s) => s.branch);
    const fileId = useCollab((s) => s.fileId);
    const role = useCollab((s) => s.role);
    const presenting = useEditor((s) => s.presentingId !== null || s.uiHidden);
    const tick = useCollab((s) => s.branchesChanged);
    const [mainName, setMainName] = useState<string>("Main");
    const [reviewState, setReviewState] = useState<BranchInfo["reviewState"]>(null);
    useEffect(() => {
        if (branch)
            void listBranches()
                .then((l) => {
                    if (!l) return;
                    setMainName(l.main.name);
                    setReviewState(l.branches.find((b) => b.id === fileId)?.reviewState ?? null);
                })
                .catch(() => undefined);
    }, [branch, fileId, tick]);
    if (!branch || !fileId || presenting) return null;
    return (
        <div className="pointer-events-auto absolute top-7 left-7 z-10">
            <DarkMenu
                label="Branch menu"
                placement="bottom start"
                width="w-60"
                className="flex h-7 items-center gap-1.5 rounded-md bg-tooltip px-2 text-[11px] text-white shadow-lg outline-none hover:bg-black"
                trigger={
                    <>
                        <GitBranch01 className="size-3.5" />
                        <span className="text-white/60">{mainName} /</span>
                        <span className="font-semibold">{branch.name}</span>
                        {reviewState && <span className={`size-1.5 rounded-full ${reviewState === "approved" ? "bg-emerald-400" : reviewState === "changes" ? "bg-amber-400" : "bg-brand-400"}`} title={REVIEW_BADGE[reviewState].label} />}
                        <ChevronDown className="size-3" />
                    </>
                }
                items={[
                    { id: "review", label: "Review and merge changes…" },
                    { id: "update", label: "Update from main…", disabled: role !== "edit" },
                    { id: "list", label: "Show branches" },
                    { id: "main", label: "Open main file" },
                    "-",
                    { id: "archive", label: "Archive branch", disabled: role !== "edit" },
                ]}
                onAction={(id) => {
                    if (id === "review" || id === "list") collab.set({ branchDialog: id });
                    if (id === "update") collab.set({ branchDialog: "update" });
                    if (id === "main") void openMain();
                    if (id === "archive")
                        void setBranch(fileId, { status: "archived" }).then(
                            () => {
                                editor.notify(`Archived "${branch.name}". Restore it from Show branches.`);
                                void openMain();
                            },
                            (err: unknown) => editor.notify(err instanceof Error ? err.message : String(err)),
                        );
                }}
            />
        </div>
    );
}
