import { ChevronDown, ChevronRight, DotsHorizontal, Plus, X } from "@untitledui/icons";
import { useEffect, useState } from "react";
import { Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { authHeaders } from "../engine/auth";
import { type VersionMeta, collab, exitPreview, openSaveVersion, previewVersion, requestVersions, restoreVersion, saveVersion, shareCurrent, updateVersion, useCollab, versionLink } from "../engine/collab";
import { rememberShared } from "../engine/files";
import { httpBase } from "../engine/server-url";
import { editor } from "../engine/store";
import { versionTitle, when } from "../engine/version-format";
import { Avatar } from "./avatar";
import { DarkMenu } from "./collab-menu";
import { PresenceBar, PresentButton, ShareButton } from "./collab-ui";
import { withServer } from "../engine/servers";

// Version history in the right sidebar, like the reference's: the current version, named versions with their
// descriptions, autosaves grouped together, and a "…" menu on each.

export function SaveVersionDialog() {
    const open = useCollab((s) => s.saveVersionOpen);
    const editing = useCollab((s) => s.editingVersion);
    const versions = useCollab((s) => s.versions);
    const target = editing ? versions.find((v) => v.id === editing) : undefined;
    const close = () => collab.set({ saveVersionOpen: false, editingVersion: null });
    return (
        <AriaModalOverlay isOpen={open} onOpenChange={(o) => !o && close()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-28">
            <AriaModal className="w-[400px] rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                <AriaDialog aria-label={target ? "Edit version info" : "Save to version history"} className="outline-none">
                    <VersionForm key={editing ?? "new"} target={target} close={close} />
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

function VersionForm({ target, close }: { target?: VersionMeta; close: () => void }) {
    const [title, setTitle] = useState(target?.name ?? "");
    const [description, setDescription] = useState(target?.description ?? "");
    const field = "w-full rounded-md border border-panel-border bg-field px-3 text-[12px] text-ink outline-none focus:border-brand-500";
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                if (target) updateVersion(target.id, title.trim() || null, description.trim() || null);
                else {
                    saveVersion(title.trim(), description.trim());
                    editor.notify("Saved to version history.");
                }
                close();
            }}
        >
            <div className="flex h-12 items-center justify-between border-b border-panel-border px-4">
                <h2 className="text-[13px] font-semibold">{target ? "Edit version info" : "Save to version history"}</h2>
                <button type="button" aria-label="Close" onClick={close} className="rounded p-1 text-ink-muted hover:bg-panel-hover">
                    <X className="size-4" />
                </button>
            </div>
            <div className="space-y-3 p-4">
                <label className="block space-y-1">
                    <span className="text-[11px] text-ink-muted">Title</span>
                    <input autoFocus value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className={`${field} h-9`} placeholder="What changed?" />
                </label>
                <label className="block space-y-1">
                    <span className="text-[11px] text-ink-muted">Description</span>
                    <textarea value={description} maxLength={1000} rows={4} onChange={(e) => setDescription(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className={`${field} resize-none py-2`} placeholder="Describe what changed" />
                </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-panel-border px-4 py-3">
                <button type="button" onClick={close} className="h-8 rounded-md px-3 text-[12px] text-ink-muted hover:bg-panel-hover">
                    Cancel
                </button>
                <button type="submit" className="h-8 rounded-md bg-brand-500 px-4 text-[12px] font-semibold text-white hover:bg-brand-600">
                    Save
                </button>
            </div>
        </form>
    );
}

async function duplicateVersion(v: VersionMeta) {
    const fileId = collab.get().fileId;
    if (!fileId) return;
    // Opened now, filled in when the copy exists, so the browser doesn't treat it as a popup.
    const tab = window.open("about:blank", "_blank");
    try {
        const res = await fetch(`${httpBase()}/files/${fileId}/versions/${v.id}/duplicate`, { method: "POST", headers: authHeaders() });
        const data = (await res.json()) as { id?: string; keys?: { edit: string }; name?: string; error?: string };
        if (!res.ok || !data.id) throw new Error(data.error ?? "The server refused that.");
        rememberShared(data.id, data.name ?? "Copy", data.keys?.edit ?? null);
        const url = new URL(location.href);
        for (const k of [...url.searchParams.keys()]) url.searchParams.delete(k);
        url.searchParams.set("file", data.id);
        if (data.keys?.edit) url.searchParams.set("key", data.keys.edit);
        if (tab) tab.location.href = withServer(url).toString();
        editor.notify(`Duplicated as "${data.name}". It's in your drafts.`);
    } catch (error) {
        tab?.close();
        editor.notify(error instanceof Error ? error.message : String(error));
    }
}

function VersionRow({ v, nested }: { v: VersionMeta; nested?: boolean }) {
    const previewing = useCollab((s) => s.previewing);
    const role = useCollab((s) => s.role);
    const active = previewing?.id === v.id;
    const edit = role === "edit";
    const named = Boolean(v.name || v.description);
    return (
        <div className={`group flex items-start gap-2 rounded-md py-1.5 pr-1 ${nested ? "pl-6" : "pl-2"} ${active ? "bg-brand-100" : "hover:bg-panel-hover"}`}>
            <button type="button" onClick={() => previewVersion(v.id)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                <span className="mt-0.5">
                    <Avatar name={v.author.name || "Guest"} color={v.author.color} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className={`block truncate ${named ? "font-semibold" : ""}`}>{named ? (v.name ?? "Untitled version") : versionTitle(v)}</span>
                    {v.description && <span className="mt-0.5 block text-ink-muted [overflow-wrap:anywhere]">{v.description}</span>}
                    <span className="block text-ink-subtle">
                        {when(v.createdAt)} · {v.author.name || "Guest"}
                    </span>
                </span>
            </button>
            <span className={active ? "" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}>
                <DarkMenu
                    label="Version actions"
                    trigger={<DotsHorizontal className="size-3.5" />}
                    width="w-52"
                    items={[
                        { id: "name", label: named ? "Edit version info" : "Name this version", disabled: !edit },
                        { id: "restore", label: "Restore this version", disabled: !edit },
                        { id: "duplicate", label: "Duplicate", disabled: !edit },
                        { id: "link", label: "Copy link" },
                        ...(named ? ["-" as const, { id: "clear", label: "Delete version info", disabled: !edit }] : []),
                    ]}
                    onAction={(id) => {
                        if (id === "name") collab.set({ saveVersionOpen: true, editingVersion: v.id });
                        if (id === "restore") restoreVersion(v.id);
                        if (id === "duplicate") void duplicateVersion(v);
                        if (id === "clear") updateVersion(v.id, null, null);
                        if (id === "link")
                            void navigator.clipboard.writeText(versionLink(v.id)).then(
                                () => editor.notify("Link copied. People need edit access to open a version."),
                                () => editor.notify("The browser didn't allow copying."),
                            );
                    }}
                />
            </span>
        </div>
    );
}

// Runs of consecutive autosaves fold into one expandable group.
type Entry = { kind: "one"; v: VersionMeta } | { kind: "group"; id: string; list: VersionMeta[] };
function group(versions: VersionMeta[]): Entry[] {
    const out: Entry[] = [];
    for (const v of versions) {
        const plain = v.auto && !v.name && !v.description;
        const last = out[out.length - 1];
        if (plain && last?.kind === "group") last.list.push(v);
        else if (plain) out.push({ kind: "group", id: v.id, list: [v] });
        else out.push({ kind: "one", v });
    }
    return out.map((e) => (e.kind === "group" && e.list.length === 1 ? { kind: "one", v: e.list[0] as VersionMeta } : e));
}

// `presence`: in the design editor, with the people / Present / Share row above the title, as the reference keeps it.
export function VersionHistoryPanel({ presence }: { presence?: boolean } = {}) {
    const status = useCollab((s) => s.status);
    const role = useCollab((s) => s.role);
    const versions = useCollab((s) => s.versions);
    const previewing = useCollab((s) => s.previewing);
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [shown, setShown] = useState(40);
    useEffect(() => {
        if (status === "live") requestVersions();
    }, [status]);
    const close = () => {
        exitPreview();
        collab.set({ historyOpen: false });
    };
    const entries = group(versions.slice(0, shown));
    return (
        <aside data-right-panel="" className="flex h-full w-60 shrink-0 flex-col border-l border-panel-border bg-panel text-[11px]">
            {presence && (
                <div className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-2">
                    <PresenceBar chevron />
                    <div className="flex-1" />
                    <PresentButton />
                    <ShareButton size="lg" className="" />
                </div>
            )}
            <header className={`flex h-10 shrink-0 items-center gap-1 pr-2 pl-4 ${presence ? "" : "border-b border-panel-border"}`}>
                <span className="flex-1 font-semibold">Version history</span>
                {status !== "local" && role === "edit" && (
                    <button type="button" aria-label="Save to version history" title="Save to version history (⌥⌘S)" onClick={openSaveVersion} className="flex size-6 items-center justify-center rounded-[5px] text-ink hover:bg-panel-hover">
                        <Plus className="size-4" />
                    </button>
                )}
                <button type="button" aria-label="Close version history" onClick={close} className="flex size-6 items-center justify-center rounded-[5px] text-ink hover:bg-panel-hover">
                    <X className="size-4" />
                </button>
            </header>
            {status === "local" ? (
                <div className="space-y-3 px-3 py-3 leading-relaxed text-ink-muted">
                    <p>Version history keeps checkpoints of files on your server: every 30 minutes while people edit, when everyone leaves, and whenever someone saves one.</p>
                    <button type="button" onClick={() => shareCurrent()} className="h-7 rounded-md bg-brand-500 px-3 font-semibold text-white hover:bg-brand-600">
                        Move this file to the server
                    </button>
                </div>
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2">
                    <button type="button" onClick={exitPreview} title="Everyone's latest changes" className={`flex h-8 w-full items-center gap-[12px] rounded-[5px] px-2 text-left font-medium ${previewing ? "text-ink hover:bg-panel-hover" : "text-link"}`}>
                        <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${previewing ? "bg-field" : "bg-brand-500 text-white"}`}>
                            <span className="size-2.5 rounded-full border-2 border-current" />
                        </span>
                        Current version
                    </button>
                    {versions.length === 0 && <p className="px-2 py-3 text-ink-muted">No versions yet. They appear as people edit, or save one with ⌥⌘S.</p>}
                    {entries.map((e) =>
                        e.kind === "one" ? (
                            <VersionRow key={e.v.id} v={e.v} />
                        ) : (
                            <div key={e.id}>
                                <button type="button" onClick={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))} className="flex h-8 w-full items-center gap-[12px] rounded-[5px] px-2 text-left font-medium text-ink hover:bg-panel-hover">
                                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-field">{open[e.id] ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}</span>
                                    {e.list.length} autosave versions
                                </button>
                                {open[e.id] && e.list.map((v) => <VersionRow key={v.id} v={v} nested />)}
                            </div>
                        ),
                    )}
                    {versions.length > shown && (
                        <button type="button" onClick={() => setShown((n) => n + 40)} className="mt-1 flex h-8 w-full items-center rounded-[5px] pl-[44px] text-link hover:bg-panel-hover">
                            Show older
                        </button>
                    )}
                </div>
            )}
        </aside>
    );
}
