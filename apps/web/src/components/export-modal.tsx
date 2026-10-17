import { refuseExport } from "../engine/share-settings";
import { X } from "@untitledui/icons";
import { useEffect, useMemo, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { renderNodesToPng } from "../canvas/render";
import { DEFAULT_SETTING, exportWithSettings, settingLabel } from "../engine/export";
import { type AnimatedExport, exportAnimated, isAnimatedFrame } from "../engine/motion";
import { editor, useEditor } from "../engine/store";
import type { ExportSetting, NagmaDocument, SceneNode } from "../engine/types";
import { useVectorUi, vectorUi } from "../engine/vector-ui";
import { Select } from "./select";

// The Export dialog (⇧⌘E, File › Export…): every layer in the file with export settings, with a
// thumbnail and its settings, checked to export together (several files arrive as one zip). The
// selection is offered too when it has no settings of its own. Frames with Motion are on the
// Animated tab.

interface Entry {
    node: SceneNode;
    page: string;
    settings: ExportSetting[];
    fallback: boolean;
}

function entriesOf(doc: NagmaDocument, selection: string[]): Entry[] {
    const out: Entry[] = [];
    const seen = new Set<string>();
    for (const pageId of doc.roots) {
        const page = doc.nodes[pageId];
        if (!page) continue;
        const visit = (ids: string[]) => {
            for (const id of ids) {
                const node = doc.nodes[id];
                if (!node) continue;
                if (node.exportSettings?.length) {
                    out.push({ node, page: page.name, settings: node.exportSettings, fallback: false });
                    seen.add(id);
                }
                visit(node.children);
            }
        };
        visit(page.children);
    }
    for (const id of selection) {
        const node = doc.nodes[id];
        if (!node || seen.has(id) || node.type === "page") continue;
        let page: SceneNode | undefined = node;
        while (page && page.type !== "page") page = page.parentId ? doc.nodes[page.parentId] : undefined;
        out.push({ node, page: page?.name ?? "", settings: [{ ...DEFAULT_SETTING, scale: 2, suffix: "" }], fallback: true });
    }
    return out;
}

const thumbs = new WeakMap<SceneNode, string>();

function Thumb({ doc, node }: { doc: NagmaDocument; node: SceneNode }) {
    const [url, setUrl] = useState<string | null>(() => thumbs.get(node) ?? null);
    useEffect(() => {
        if (thumbs.has(node)) return;
        let live = true;
        const k = 56 / Math.max(1, node.w, node.h);
        void renderNodesToPng(doc, node, Math.min(1, k)).then((blob) => {
            if (!blob || !live) return;
            const u = URL.createObjectURL(blob);
            thumbs.set(node, u);
            setUrl(u);
        });
        return () => {
            live = false;
        };
    }, [doc, node]);
    return (
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-[repeating-conic-gradient(#8882_0_25%,transparent_0_50%)] bg-[length:8px_8px]">
            {url ? <img src={url} alt="" className="max-h-10 max-w-10 object-contain" /> : null}
        </div>
    );
}

export function ExportModal() {
    const open = useVectorUi((s) => s.exportOpen);
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    const entries = useMemo(() => (open ? entriesOf(doc, selection) : []), [open, doc, selection]);
    const animatedFrames = useMemo(() => (open ? doc.roots.flatMap((p) => doc.nodes[p]?.children ?? []).map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n && isAnimatedFrame(doc, n))) : []), [open, doc]);
    const [tab, setTab] = useState<"static" | "animated">("static");
    const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [anim, setAnim] = useState<AnimatedExport>({ format: "mp4", scale: 1, fps: 30, quality: 1 });
    const close = () => vectorUi.set({ exportOpen: false });
    const list = tab === "static" ? entries.map((e) => e.node.id) : animatedFrames.map((f) => f.id);
    const checked = list.filter((id) => !unchecked.has(id));
    const toggle = (id: string) => {
        const next = new Set(unchecked);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setUnchecked(next);
    };
    const files = tab === "static" ? entries.filter((e) => !unchecked.has(e.node.id)).reduce((n, e) => n + e.settings.length, 0) : checked.length;

    const run = async () => {
        if (refuseExport()) return close();
        setBusy(true);
        try {
            if (tab === "static") {
                const byId = new Map(entries.map((e) => [e.node.id, e.settings]));
                const count = await exportWithSettings(doc, checked, (id) => byId.get(id) ?? [], doc.name || "Export");
                editor.notify(count ? `Exported ${count} ${count === 1 ? "file" : "files"}.` : "Nothing to export.");
            } else for (const id of checked) await exportAnimated(doc, id, anim);
            close();
        } catch (error) {
            console.error(error);
            editor.notify("Export failed. Try another format, or fewer layers.");
        } finally {
            setBusy(false);
        }
    };

    const select = "h-7 rounded-md border border-transparent bg-field px-1.5 text-ink outline-none hover:border-panel-border focus:border-brand-500";
    return (
        <AriaModalOverlay isOpen={open} onOpenChange={(o) => !o && close()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-20">
            <AriaModal className="w-[460px] rounded-xl border border-panel-border bg-panel-raised text-[12px] text-ink shadow-2xl outline-none">
                <AriaDialog className="outline-none" aria-label="Export">
                    <div className="flex h-11 items-center justify-between border-b border-panel-border px-4">
                        <span className="text-[13px] font-semibold">Export</span>
                        <AriaButton aria-label="Close" onPress={close} className="flex size-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <X className="size-4" />
                        </AriaButton>
                    </div>
                    {animatedFrames.length > 0 && (
                        <div className="mx-4 mt-3 grid grid-cols-2 gap-0.5 rounded-md bg-field p-0.5">
                            {(["static", "animated"] as const).map((t) => (
                                <button key={t} type="button" onClick={() => setTab(t)} className={`h-6 rounded text-[11px] font-medium ${tab === t ? "bg-panel text-ink shadow-sm" : "text-ink-subtle hover:text-ink"}`}>
                                    {t === "static" ? "Static" : "Animated"}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="max-h-[50vh] overflow-y-auto px-2 py-2">
                        {list.length === 0 ? (
                            <p className="px-2 py-6 text-center text-ink-muted">
                                {tab === "static" ? "No exports yet. Select layers, or add export settings in the Design panel's Export section." : "No frames with Motion keyframes."}
                            </p>
                        ) : (
                            <>
                                <label className="flex h-8 items-center gap-2 px-2 text-ink-muted">
                                    <input type="checkbox" checked={checked.length === list.length} onChange={(e) => setUnchecked(e.target.checked ? new Set() : new Set(list))} className="accent-brand-500" />
                                    {checked.length === list.length ? "Deselect all" : "Select all"}
                                </label>
                                {(tab === "static" ? entries.map((e) => ({ node: e.node, page: e.page, detail: e.settings.map((s) => `${s.format === "svg" || s.format === "pdf" ? "" : `${settingLabel(s)} `}${s.format.toUpperCase()}${s.suffix ? ` ${s.suffix}` : ""}`).join(", ") + (e.fallback ? " (no settings yet)" : "") })) : animatedFrames.map((f) => ({ node: f, page: "", detail: "Motion" }))).map(({ node, page, detail }) => (
                                    <label key={node.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-panel-hover">
                                        <input type="checkbox" checked={!unchecked.has(node.id)} onChange={() => toggle(node.id)} className="accent-brand-500" />
                                        <Thumb doc={doc} node={node} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate font-medium">{node.name}</span>
                                            <span className="block truncate text-ink-subtle">
                                                {page ? `${page} · ` : ""}
                                                {detail}
                                            </span>
                                        </span>
                                    </label>
                                ))}
                            </>
                        )}
                    </div>
                    {tab === "animated" && list.length > 0 && (
                        <div className="grid grid-cols-3 gap-1.5 border-t border-panel-border px-4 py-2.5">
                            <Select aria-label="Animated format" value={anim.format} onChange={(e) => setAnim({ ...anim, format: e.target.value as AnimatedExport["format"] })} className={select}>
                                <option value="mp4">MP4</option>
                                <option value="webm">WebM</option>
                                <option value="gif">GIF</option>
                                <option value="lottie">Lottie</option>
                                <option value="dotlottie">dotLottie</option>
                                <option value="svganim">Animated SVG</option>
                            </Select>
                            <Select aria-label="Animated size" value={anim.scale} onChange={(e) => setAnim({ ...anim, scale: Number(e.target.value) })} className={select}>
                                {[0.5, 1, 2, 3, 4].map((v) => (
                                    <option key={v} value={v}>
                                        {v}x
                                    </option>
                                ))}
                            </Select>
                            <Select aria-label="Animated frame rate" value={anim.fps} onChange={(e) => setAnim({ ...anim, fps: Number(e.target.value) })} className={select}>
                                {[24, 30, 60].map((v) => (
                                    <option key={v} value={v}>
                                        {v} fps
                                    </option>
                                ))}
                            </Select>
                        </div>
                    )}
                    <div className="flex items-center justify-end gap-2 border-t border-panel-border px-4 py-3">
                        <AriaButton onPress={close} className="h-8 rounded-md px-3 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            Cancel
                        </AriaButton>
                        <AriaButton isDisabled={busy || !checked.length} onPress={() => void run()} className="h-8 rounded-md bg-brand-500 px-3 font-medium text-white outline-none hover:bg-brand-600 disabled:opacity-50">
                            {busy ? "Exporting…" : tab === "static" ? `Export ${files} ${files === 1 ? "file" : "files"}` : `Export ${checked.length} ${checked.length === 1 ? "frame" : "frames"}`}
                        </AriaButton>
                    </div>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}
