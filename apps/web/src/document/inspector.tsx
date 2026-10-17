import { ClockRewind, Trash01 } from "@untitledui/icons";
import { useEffect, useState } from "react";
import { ShareButton } from "../components/collab-ui";
import { PresenceAvatars } from "../components/follow-ui";
import { VersionHistoryPanel } from "../components/version-history";
import { collab, useCollab } from "../engine/collab";
import { useEditor } from "../engine/store";
import { type CommentInfo, DOC_BLUE, SWATCHES, commentLabel, formatBytes, fromHex, pageSizeName, pdfDate, toHex } from "./model";
import { docView, edit, me, useDoc } from "./state";

// The right side: the selected comment's properties (colour, opacity, line width, author, its
// text and replies), or the document's properties when nothing is selected.

const input = "w-full rounded-md border border-panel-border bg-field px-2 text-[12px] text-ink outline-none focus:border-brand-500 disabled:opacity-60";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="border-b border-panel-border px-3 py-3">
            <h3 className="mb-2 text-[11px] font-semibold text-ink">{title}</h3>
            <div className="space-y-2">{children}</div>
        </section>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex items-center gap-2 text-[11px]">
            <span className="w-16 shrink-0 text-ink-muted">{label}</span>
            <span className="min-w-0 flex-1">{children}</span>
        </label>
    );
}

// A text input that commits when it loses focus (or on Enter for single lines).
function Committed({ value, onCommit, multiline, label, disabled, placeholder }: { value: string; onCommit: (v: string) => void; multiline?: boolean; label: string; disabled?: boolean; placeholder?: string }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const props = {
        "aria-label": label,
        value: draft,
        disabled,
        placeholder,
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
        onBlur: () => draft !== value && onCommit(draft),
        onKeyDown: (e: React.KeyboardEvent) => {
            e.stopPropagation();
            if (e.key === "Enter" && !multiline) (e.target as HTMLInputElement).blur();
        },
    };
    return multiline ? <textarea {...props} rows={4} className={`${input} resize-y py-1.5`} /> : <input {...props} className={`${input} h-7`} />;
}

function CommentPanel({ c }: { c: CommentInfo }) {
    const comments = useDoc((s) => s.info?.comments);
    const readOnly = useEditor((s) => s.readOnly);
    const [reply, setReply] = useState("");
    const [opacity, setOpacity] = useState(c.opacity);
    useEffect(() => setOpacity(c.opacity), [c.opacity, c.index]);
    const replies = (comments ?? []).filter((r) => r.inReplyTo && r.inReplyTo === c.name && r.subtype === "Text" && !r.state);
    const ref = { page: c.page, index: c.index };
    const locked = readOnly || c.locked;
    const style = (patch: Record<string, unknown>) => edit({ op: "styleAnnotation", ...ref, ...patch });
    const isText = c.subtype === "FreeText";
    return (
        <>
            <Section title={`${commentLabel(c)} on page ${c.page + 1}`}>
                <p className="text-[11px] text-ink-subtle">
                    {c.author || "Unknown"}
                    {c.modified ? ` · ${pdfDate(c.modified)}` : ""}
                    {c.locked ? " · Locked" : ""}
                </p>
                <Committed label={isText ? "Text" : "Comment"} multiline value={c.contents ?? ""} disabled={locked} placeholder={isText ? "Text in the box" : "Add a comment"} onCommit={(text) => edit({ op: "setContents", ...ref, text })} />
            </Section>
            {c.restylable && (
                <Section title="Appearance">
                    <div className="flex flex-wrap items-center gap-1">
                        {SWATCHES.map((s) => (
                            <button key={s.join()} type="button" disabled={locked} aria-label={`Colour ${toHex(s)}`} onClick={() => style({ color: s })} className="size-5 rounded-full border border-black/25" style={{ background: toHex(s), boxShadow: toHex(s) === toHex(c.color) ? `0 0 0 2px ${DOC_BLUE}` : undefined }} />
                        ))}
                        <input type="color" aria-label="Custom colour" disabled={locked} value={toHex(c.color)} onChange={(e) => style({ color: fromHex(e.target.value) })} className="size-6 cursor-pointer border-0 bg-transparent p-0" />
                    </div>
                    <Row label="Opacity">
                        <span className="flex items-center gap-2">
                            <input
                                type="range"
                                aria-label="Opacity"
                                disabled={locked}
                                min={0.1}
                                max={1}
                                step={0.05}
                                value={opacity}
                                onChange={(e) => setOpacity(Number(e.target.value))}
                                onPointerUp={() => opacity !== c.opacity && style({ opacity })}
                                onKeyUp={() => opacity !== c.opacity && style({ opacity })}
                                className="min-w-0 flex-1 accent-(--doc-accent)"
                            />
                            <span className="w-8 text-right tabular-nums">{Math.round(opacity * 100)}%</span>
                        </span>
                    </Row>
                    {c.width !== null && !["Highlight", "Underline", "StrikeOut", "Squiggly", "Text"].includes(c.subtype) && (
                        <Row label="Stroke">
                            <input type="number" aria-label="Stroke width" disabled={locked} min={0} max={50} step={0.5} defaultValue={c.width ?? 1} key={`${c.index}-${c.width}`} onBlur={(e) => Number(e.target.value) !== c.width && style({ width: Number(e.target.value) })} onKeyDown={(e) => e.stopPropagation()} className={`${input} h-7`} />
                        </Row>
                    )}
                </Section>
            )}
            <Section title="Details">
                <Row label="Author">
                    <Committed label="Author" value={c.author ?? ""} disabled={locked} onCommit={(author) => edit({ op: "setAnnotationInfo", ...ref, author })} />
                </Row>
                <Row label="Subject">
                    <Committed label="Subject" value={c.subject ?? ""} disabled={locked} onCommit={(subject) => edit({ op: "setAnnotationInfo", ...ref, subject })} />
                </Row>
            </Section>
            <Section title={replies.length ? `Replies (${replies.length})` : "Replies"}>
                {replies.map((r) => (
                    <div key={r.index} className="rounded-md bg-panel-hover/60 px-2 py-1.5">
                        <p className="text-[11px] text-ink-muted">
                            <span className="font-semibold text-ink">{r.author || "Unknown"}</span> {pdfDate(r.modified)}
                        </p>
                        <p className="whitespace-pre-wrap text-[12px]">{r.contents}</p>
                    </div>
                ))}
                {!readOnly && (
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (reply.trim() && edit({ op: "reply", ...ref, text: reply.trim(), author: me() })) setReply("");
                        }}
                        className="flex gap-1"
                    >
                        <input aria-label="Reply" value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Reply" className={`${input} h-7`} />
                        <button type="submit" disabled={!reply.trim()} className="h-7 rounded-md px-2 text-[11px] font-semibold text-white disabled:opacity-40" style={{ background: DOC_BLUE }}>
                            Reply
                        </button>
                    </form>
                )}
            </Section>
            {!locked && (
                <div className="px-3 py-3">
                    <button type="button" onClick={() => edit({ op: "deleteAnnotation", ...ref }, { selected: null })} className="flex h-7 items-center gap-1.5 rounded-md border border-panel-border px-2 text-[11px] text-red-400 hover:bg-panel-hover">
                        <Trash01 className="size-3.5" /> Delete {commentLabel(c).toLowerCase()}
                    </button>
                </div>
            )}
        </>
    );
}

function DocumentPanel() {
    const info = useDoc((s) => s.info);
    const page = useDoc((s) => s.page);
    const readOnly = useEditor((s) => s.readOnly);
    if (!info) return null;
    const p = info.pages[page];
    const set = (key: string) => (value: string) => edit({ op: "setInfo", key, value });
    const disabled = readOnly || !info.allows.modify;
    return (
        <>
            <Section title="Document">
                <Row label="Title">
                    <Committed label="Title" value={info.title ?? ""} disabled={disabled} onCommit={set("Title")} />
                </Row>
                <Row label="Author">
                    <Committed label="Author" value={info.author ?? ""} disabled={disabled} onCommit={set("Author")} />
                </Row>
                <Row label="Subject">
                    <Committed label="Subject" value={info.subject ?? ""} disabled={disabled} onCommit={set("Subject")} />
                </Row>
                <Row label="Keywords">
                    <Committed label="Keywords" value={info.keywords ?? ""} disabled={disabled} onCommit={set("Keywords")} />
                </Row>
            </Section>
            {p && (
                <Section title={`Page ${p.label || page + 1}`}>
                    <Row label="Size">
                        <span>
                            {pageSizeName(p)} <span className="text-ink-subtle">({Math.round(p.width)} × {Math.round(p.height)} pt)</span>
                        </span>
                    </Row>
                    <Row label="Rotation">
                        <span>{p.rotation}°</span>
                    </Row>
                </Section>
            )}
            <Section title="File">
                <Row label="Pages">
                    <span>{info.pages.length}</span>
                </Row>
                <Row label="Size">
                    <span>{formatBytes(info.fileSize)}</span>
                </Row>
                <Row label="Version">
                    <span>PDF {info.pdfVersion}</span>
                </Row>
                {info.creator && (
                    <Row label="Creator">
                        <span className="break-words">{info.creator}</span>
                    </Row>
                )}
                {info.producer && (
                    <Row label="Producer">
                        <span className="break-words">{info.producer}</span>
                    </Row>
                )}
                <Row label="Security">
                    <span>{info.security ? `${info.security.method}${info.security.pending ? " (on next save)" : ""}` : info.encrypted ? "Encrypted" : "None"}</span>
                </Row>
                <Row label="Tagged">
                    <span>{info.tagged ? "Yes" : "No"}</span>
                </Row>
                {info.fields.length > 0 && (
                    <Row label="Form">
                        <span>
                            {info.fields.length} field{info.fields.length === 1 ? "" : "s"}
                        </span>
                    </Row>
                )}
            </Section>
            {info.fonts.length > 0 && (
                <Section title="Fonts">
                    <ul className="space-y-0.5 text-[11px] text-ink-muted">
                        {info.fonts.slice(0, 30).map((f, i) => (
                            <li key={i} className="truncate">
                                {f}
                            </li>
                        ))}
                    </ul>
                </Section>
            )}
            {info.readOnlyReason && (
                <Section title="Editing">
                    <p className="text-[11px] text-ink-muted">{info.readOnlyReason}</p>
                </Section>
            )}
            <div className="px-3 py-3">
                <button type="button" onClick={() => collab.set({ historyOpen: true })} className="flex h-7 items-center gap-1.5 rounded-md border border-panel-border px-2 text-[11px] hover:bg-panel-hover">
                    <ClockRewind className="size-3.5" /> Version history
                </button>
            </div>
        </>
    );
}

export function DocInspector() {
    const history = useCollab((s) => s.historyOpen);
    const selected = useDoc((s) => s.selected);
    const comments = useDoc((s) => s.info?.comments);
    const c = selected ? comments?.find((x) => x.page === selected.page && x.index === selected.index) : undefined;
    useEffect(() => {
        if (selected && comments && !c) docView.set({ selected: null });
    }, [selected, comments, c]);
    if (history) return <VersionHistoryPanel />;
    return (
        <aside data-right-panel="" aria-label="Properties" className="flex h-full w-64 shrink-0 flex-col border-l border-panel-border bg-panel text-ink">
            <header className="flex h-11 shrink-0 items-center gap-1 border-b border-panel-border px-3">
                <PresenceAvatars />
                <div className="flex-1" />
                <ShareButton className="ml-1 bg-(--doc-accent)! hover:brightness-110!" />
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">{c ? <CommentPanel key={`${c.page}-${c.index}`} c={c} /> : <DocumentPanel />}</div>
        </aside>
    );
}
