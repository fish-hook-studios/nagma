import { CheckCircle, MessageTextSquare01, XCircle } from "@untitledui/icons";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button as AriaButton } from "react-aria-components";
import { authHeaders, openSignIn, useAuth } from "../engine/auth";
import { currentLinkKey, useCollab } from "../engine/collab";
import { usePeople } from "../engine/people";
import { httpBase } from "../engine/server-url";
import { editor, useEditor } from "../engine/store";
import { showAsset } from "./actions";
import { AssetThumb, PanelShell } from "./left-panel";
import { assetData, pageData, setPageData } from "./model";

// Reviews: an editor asks people to approve assets; each reviewer approves or requests changes
// with a comment. The sync server keeps the reviews on the file and tells the people involved
// (the bell and mail). Assets carry a badge with their status in the asset list, the strip, the
// grid view and Bulk edit; the Reviews panel lists what's waiting. A campaign can require approval
// before assets are exported.

export type ReviewStatus = "pending" | "approved" | "changes";

interface Person {
    id: string;
    name: string;
    email: string;
    color: string;
}

export interface AssetReview {
    assetId: string;
    status: ReviewStatus;
    requestedBy: Person;
    reviewers: Person[];
    note: string;
    at: number;
    decisions: Record<string, { decision: "approved" | "changes"; note: string; at: number; by: Person }>;
    history: { kind: "requested" | "approved" | "changes" | "reset"; by: Person; note: string; at: number }[];
}

let reviews: Record<string, AssetReview> = {};
let loadedFor: string | null = null;
const listeners = new Set<() => void>();
const emit = () => {
    for (const l of listeners) l();
    // The canvas draws the badges too.
    editor.set({});
};

function set(list: AssetReview[], fileId: string | null) {
    reviews = Object.fromEntries(list.map((r) => [r.assetId, r]));
    loadedFor = fileId;
    emit();
}

export function useReviews(): Record<string, AssetReview> {
    return useSyncExternalStore(
        (l) => (listeners.add(l), () => void listeners.delete(l)),
        () => reviews,
    );
}

export const reviewOf = (assetId: string): AssetReview | undefined => reviews[assetId];

async function call(fileId: string, path: string, init: RequestInit = {}): Promise<AssetReview[]> {
    const key = currentLinkKey();
    const res = await fetch(`${httpBase()}/files/${fileId}/asset-reviews${path}${key ? `?key=${encodeURIComponent(key)}` : ""}`, { ...init, headers: { "content-type": "application/json", ...authHeaders(), ...(init.headers ?? {}) } });
    const data = (await res.json().catch(() => ({}))) as { reviews?: AssetReview[]; error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    const list = data.reviews ?? [];
    set(list, fileId);
    return list;
}

export async function loadReviews(fileId: string | null) {
    if (!fileId) return set([], null);
    try {
        await call(fileId, "");
    } catch {
        if (loadedFor !== fileId) set([], fileId);
    }
}

export const requestReview = (fileId: string, assetIds: string[], emails: string, note: string) => call(fileId, "", { method: "POST", body: JSON.stringify({ assetIds, emails, note }) });
export const decideReview = (fileId: string, assetId: string, decision: "approved" | "changes", note: string) => call(fileId, `/${assetId}/decide`, { method: "POST", body: JSON.stringify({ decision, note }) });
export const cancelReview = (fileId: string, assetId: string) => call(fileId, `/${assetId}`, { method: "DELETE" });

// The file's reviews, kept fresh while it's open (other people decide in their own browsers).
export function useReviewSync() {
    const fileId = useCollab((s) => (s.status === "live" ? s.fileId : null));
    // Ticks when the server withdraws approvals (an approved asset was edited).
    const changed = useCollab((s) => s.reviewsChanged);
    const user = useAuth((s) => s.user);
    useEffect(() => {
        if (fileId && user && changed) void loadReviews(fileId);
    }, [fileId, user, changed]);
    useEffect(() => {
        if (!fileId || !user) {
            set([], null);
            return;
        }
        void loadReviews(fileId);
        const timer = window.setInterval(() => void loadReviews(fileId), 30000);
        const onFocus = () => void loadReviews(fileId);
        window.addEventListener("focus", onFocus);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("focus", onFocus);
        };
    }, [fileId, user]);
}

export const STATUS_LABEL: Record<ReviewStatus, string> = { pending: "In review", approved: "Approved", changes: "Changes requested" };
const STATUS_CLASS: Record<ReviewStatus, string> = {
    pending: "bg-[#f5a623] text-black",
    approved: "bg-[#14ae5c] text-white",
    changes: "bg-[#f24822] text-white",
};
// The same colours for the canvas, which draws its own badges.
export const STATUS_COLOR: Record<ReviewStatus, string> = { pending: "#F5A623", approved: "#14AE5C", changes: "#F24822" };

export function ReviewBadge({ assetId, small, className }: { assetId: string; small?: boolean; className?: string }) {
    const review = useReviews()[assetId];
    if (!review) return null;
    const label = STATUS_LABEL[review.status];
    if (small) return <span role="img" aria-label={label} title={label} className={`block size-2.5 rounded-full border border-panel ${STATUS_CLASS[review.status]} ${className ?? ""}`} />;
    return <span className={`rounded-full px-1.5 py-px text-[9.5px] leading-[14px] font-semibold ${STATUS_CLASS[review.status]} ${className ?? ""}`}>{label}</span>;
}

// Whether every asset may be exported: when the campaign requires approval, only approved ones may.
export function unapproved(doc: ReturnType<typeof editor.get>["doc"], ids: string[]): string[] {
    if (!pageData(doc).requireApproval) return [];
    return ids.filter((id) => reviews[id]?.status !== "approved");
}

// ---- Asking for a review ----

export function RequestReviewForm({ ids, onDone }: { ids: string[]; onDone: () => void }) {
    const fileId = useCollab((s) => (s.status === "live" ? s.fileId : null));
    const user = useAuth((s) => s.user);
    const people = usePeople().filter((p) => !p.group && p.email && p.uid !== user?.id);
    const [chosen, setChosen] = useState<Set<string>>(new Set());
    const [extra, setExtra] = useState("");
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    if (!user) {
        return (
            <p className="text-ink-muted">
                Sign in to ask for reviews.{" "}
                <button type="button" onClick={openSignIn} className="text-brand-500 hover:underline">
                    Sign in
                </button>
            </p>
        );
    }
    if (!fileId) return <p className="text-ink-muted">Reviews are kept on the sync server: share or move this campaign there first.</p>;
    const emails = [...chosen, ...extra.split(/[,\s]+/).map((e) => e.trim()).filter(Boolean)];
    const send = () => {
        setBusy(true);
        setError(null);
        requestReview(fileId, ids, emails.join(","), note)
            .then(() => {
                editor.notify(`Asked ${emails.length} reviewer${emails.length === 1 ? "" : "s"} to review ${ids.length} asset${ids.length === 1 ? "" : "s"}.`);
                onDone();
            })
            .catch((e) => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => setBusy(false));
    };
    return (
        <div className="space-y-3">
            <div>
                <div className="mb-1 font-semibold">Reviewers</div>
                {people.length === 0 && <p className="text-ink-subtle">Nobody else has access yet. Add reviewers by email below.</p>}
                <div className="max-h-40 space-y-0.5 overflow-y-auto">
                    {people.map((p) => (
                        <label key={p.uid} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-panel-hover">
                            <input
                                type="checkbox"
                                checked={chosen.has(p.email ?? "")}
                                onChange={(e) => {
                                    const next = new Set(chosen);
                                    if (e.target.checked) next.add(p.email ?? "");
                                    else next.delete(p.email ?? "");
                                    setChosen(next);
                                }}
                                className="accent-brand-500"
                            />
                            <span className="flex size-5 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: p.color }}>
                                {p.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            <span className="truncate text-ink-subtle">{p.email}</span>
                        </label>
                    ))}
                </div>
                <input aria-label="Other reviewers' emails" placeholder="Other emails, comma separated" value={extra} onChange={(e) => setExtra(e.target.value)} className="mt-1.5 h-7 w-full rounded-md border border-panel-border bg-panel px-2 text-[11.5px] text-ink outline-none focus:border-brand-500" />
            </div>
            <div>
                <div className="mb-1 font-semibold">Note</div>
                <textarea aria-label="Note for reviewers" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should they look at?" className="w-full rounded-md border border-panel-border bg-panel px-2 py-1.5 text-[11.5px] text-ink outline-none focus:border-brand-500" />
            </div>
            {error && <p className="text-red-500">{error}</p>}
            <div className="flex justify-end">
                <button type="button" disabled={busy || !emails.length} onClick={send} className="h-8 rounded-md bg-brand-500 px-3 text-[12px] font-semibold text-white outline-none hover:bg-brand-600 disabled:opacity-40">
                    {busy ? "Sending…" : `Request review of ${ids.length} asset${ids.length === 1 ? "" : "s"}`}
                </button>
            </div>
        </div>
    );
}

// ---- The Reviews panel ----

function when(at: number) {
    const d = new Date(at);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function ReviewCard({ review, mine }: { review: AssetReview; mine: boolean }) {
    const doc = useEditor((s) => s.doc);
    const fileId = useCollab((s) => s.fileId);
    const user = useAuth((s) => s.user);
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const asset = doc.nodes[review.assetId];
    if (!asset || !assetData(asset) || !fileId) return null;
    const decide = (decision: "approved" | "changes") => {
        setBusy(true);
        decideReview(fileId, review.assetId, decision, note)
            .then(() => setNote(""))
            .catch((e) => editor.notify(e instanceof Error ? e.message : String(e)))
            .finally(() => setBusy(false));
    };
    const myDecision = user ? review.decisions[user.id] : undefined;
    return (
        <article className="space-y-2 border-b border-panel-border px-4 py-2.5" aria-label={`Review of ${asset.name}`}>
            <button type="button" onClick={() => showAsset(asset.id)} className="flex w-full items-center gap-2 text-left">
                <AssetThumb id={asset.id} width={40} height={32} className="shrink-0 rounded-[3px] bg-canvas" />
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-ink">{asset.name}</span>
                    <span className="block truncate text-[10px] text-ink-muted">Asked by {review.requestedBy.name}, {when(review.at)}</span>
                    <ReviewBadge assetId={asset.id} className="mt-0.5 inline-block" />
                </span>
            </button>
            {review.note && <p className="rounded-md bg-field px-2 py-1.5 text-[11px] text-ink">{review.note}</p>}
            <ul className="space-y-1 text-[10.5px]">
                {review.reviewers.map((r) => {
                    const d = review.decisions[r.id];
                    return (
                        <li key={r.id} className="flex items-start gap-1.5">
                            {d?.decision === "approved" ? <CheckCircle className="mt-px size-3 shrink-0 text-[#14ae5c]" /> : d?.decision === "changes" ? <XCircle className="mt-px size-3 shrink-0 text-[#f24822]" /> : <span className="mt-[3px] size-2 shrink-0 rounded-full border border-ink-subtle" />}
                            <span className="min-w-0 flex-1 text-ink-muted">
                                <span className="text-ink">{r.name}</span> {d ? (d.decision === "approved" ? "approved" : "requested changes") : "hasn't reviewed yet"}
                                {d?.note ? <span className="block text-ink">{d.note}</span> : null}
                            </span>
                        </li>
                    );
                })}
            </ul>
            {mine && (
                <div className="space-y-1.5">
                    <textarea aria-label={`Comment on ${asset.name}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={myDecision ? "Change your answer with a comment" : "Add a comment"} className="w-full rounded-md border border-panel-border bg-panel px-2 py-1 text-[11px] text-ink outline-none focus:border-brand-500" />
                    <div className="grid grid-cols-2 gap-1.5">
                        <AriaButton isDisabled={busy} onPress={() => decide("changes")} className="h-6 rounded-[5px] border border-panel-border px-1 text-[11px] whitespace-nowrap text-ink outline-none hover:bg-panel-hover disabled:opacity-40">
                            Request changes
                        </AriaButton>
                        <AriaButton isDisabled={busy} onPress={() => decide("approved")} className="h-6 rounded-[5px] bg-brand-500 text-[11px] font-semibold text-white outline-none hover:bg-brand-600 disabled:opacity-40">
                            Approve
                        </AriaButton>
                    </div>
                </div>
            )}
            {!mine && user?.id === review.requestedBy.id && (
                <AriaButton onPress={() => void cancelReview(fileId, review.assetId).catch((e) => editor.notify(e instanceof Error ? e.message : String(e)))} className="text-[10.5px] text-ink-muted outline-none hover:text-ink hover:underline">
                    Cancel review
                </AriaButton>
            )}
        </article>
    );
}

export function ReviewsPanel() {
    const list = Object.values(useReviews());
    const user = useAuth((s) => s.user);
    const fileId = useCollab((s) => (s.status === "live" ? s.fileId : null));
    const doc = useEditor((s) => s.doc);
    const readOnly = useEditor((s) => s.readOnly);
    const [tab, setTab] = useState<"mine" | "all">("mine");
    const requireApproval = Boolean(pageData(doc).requireApproval);
    useEffect(() => {
        void loadReviews(fileId);
    }, [fileId]);
    const present = list.filter((r) => assetData(doc.nodes[r.assetId]));
    const mine = present.filter((r) => user && r.reviewers.some((p) => p.id === user.id) && r.status !== "approved");
    const shown = (tab === "mine" ? mine : present).sort((a, b) => b.at - a.at);
    const tabClass = (on: boolean) => `h-5 rounded-[5px] px-1.5 text-[11px] outline-none ${on ? "bg-field font-medium text-ink" : "text-ink-muted hover:text-ink"}`;
    return (
        <PanelShell
            title="Reviews"
            search={
                <div role="tablist" aria-label="Which reviews" className="flex gap-1 px-4 pb-2">
                    <button type="button" role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")} className={tabClass(tab === "mine")}>
                        For you {mine.length ? `(${mine.length})` : ""}
                    </button>
                    <button type="button" role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")} className={tabClass(tab === "all")}>
                        All {present.length ? `(${present.length})` : ""}
                    </button>
                </div>
            }
            footer={
                !readOnly ? (
                    <label className="flex items-center gap-2 px-4 py-2.5 text-[11px] text-ink">
                        <input type="checkbox" checked={requireApproval} onChange={(e) => setPageData({ requireApproval: e.target.checked })} className="accent-brand-500" />
                        Require approval to export
                    </label>
                ) : undefined
            }
        >
            {!user ? (
                <p className="px-4 text-[11px] text-ink-muted">
                    <button type="button" onClick={openSignIn} className="text-brand-500 hover:underline">
                        Sign in
                    </button>{" "}
                    to review assets and ask for reviews.
                </p>
            ) : !fileId ? (
                <p className="px-4 text-[11px] text-ink-muted">Reviews are kept on the sync server: share or move this campaign there to use them.</p>
            ) : shown.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 pt-6 text-center text-[11px] text-ink-muted">
                    <MessageTextSquare01 className="size-5" />
                    {tab === "mine" ? "Nothing is waiting for your review." : "No reviews yet. Right-click an asset and choose Request review."}
                </div>
            ) : (
                shown.map((r) => <ReviewCard key={r.assetId} review={r} mine={Boolean(user && r.reviewers.some((p) => p.id === user.id))} />)
            )}
        </PanelShell>
    );
}
