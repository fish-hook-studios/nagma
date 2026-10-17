import { X } from "@untitledui/icons";
import { Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { viewport } from "../engine/camera";
import { useEditor } from "../engine/store";
import { worldBounds } from "../engine/transform";
import type { SceneNode } from "../engine/types";
import { EMBED_HEADER, EMBED_SANDBOX, hostOf, webUrl } from "./links";
import { board, useBoard } from "./state";

// Live embeds over the board: each embedded link on screen gets its player, laid over the canvas
// under its header. Until it's selected the player lets clicks through to the board (so it can be
// picked up like anything else); selected, it plays. Maximize opens it large over everything.

const MAX_LIVE = 8;

export function BoardEmbeds() {
    const doc = useEditor((s) => s.doc);
    const pageId = useEditor((s) => s.pageId);
    const camera = useEditor((s) => s.camera);
    const selection = useEditor((s) => s.selection);
    const editing = useEditor((s) => s.editingTextId);
    const live: { node: SceneNode; src: string; box: { x: number; y: number; w: number; h: number } }[] = [];
    for (const node of Object.values(doc.nodes)) {
        const jam = node.jam;
        if (jam?.kind !== "link" || !jam.embed || jam.display === "minimized" || node.visible === false || node.rotation) continue;
        // Only this page's embeds, and only those in view.
        let p: SceneNode | undefined = node;
        while (p?.parentId) p = doc.nodes[p.parentId];
        if (p?.id !== pageId) continue;
        const box = worldBounds(doc, node);
        const x = box.x * camera.zoom + camera.x;
        const y = (box.y + EMBED_HEADER) * camera.zoom + camera.y;
        const w = box.w * camera.zoom;
        const h = (box.h - EMBED_HEADER) * camera.zoom;
        if (x > viewport.width || y > viewport.height || x + w < 0 || y + h < 0 || w < 40) continue;
        const src = webUrl(jam.embed);
        if (!src) continue;
        live.push({ node, src, box: { x, y, w, h } });
        if (live.length >= MAX_LIVE) break;
    }
    return (
        <>
            {live.map(({ node, src, box }) => {
                const active = selection.length === 1 && selection[0] === node.id && !editing;
                return (
                    <iframe
                        key={node.id}
                        title={node.name}
                        src={src}
                        allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
                        allowFullScreen
                        sandbox={EMBED_SANDBOX}
                        referrerPolicy="strict-origin-when-cross-origin"
                        className="absolute rounded-b-[12px] border-0 bg-transparent"
                        style={{ left: box.x, top: box.y, width: box.w / camera.zoom, height: box.h / camera.zoom, transform: `scale(${camera.zoom})`, transformOrigin: "0 0", pointerEvents: active ? "auto" : "none" }}
                    />
                );
            })}
        </>
    );
}

// The maximized embed, over the whole board.
export function MaximizedEmbed() {
    const id = useBoard((s) => s.embedMax);
    const node = useEditor((s) => (id ? s.doc.nodes[id] : undefined));
    const jam = node?.jam?.kind === "link" ? node.jam : null;
    const close = () => board.set({ embedMax: null });
    return (
        <AriaModalOverlay isOpen={Boolean(jam?.embed)} onOpenChange={(open) => !open && close()} isDismissable className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <AriaModal className="flex h-[86vh] w-[86vw] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none">
                <AriaDialog aria-label={jam?.title ?? "Embed"} className="flex min-h-0 flex-1 flex-col outline-none">
                    <div className="flex h-11 items-center gap-2 border-b border-black/10 px-4 text-[13px] text-[#1E1E1E]">
                        <span className="font-semibold">{jam?.site ?? (jam ? hostOf(jam.url) : "")}</span>
                        <span className="min-w-0 flex-1 truncate text-black/60">{jam?.title}</span>
                        <button type="button" onClick={close} className="h-7 rounded-md px-2 text-[12px] font-medium hover:bg-black/5">Minimize</button>
                        <button type="button" aria-label="Close" onClick={close} className="rounded p-1 hover:bg-black/5"><X className="size-4" /></button>
                    </div>
                    {webUrl(jam?.embed) && <iframe title={jam?.title ?? "Embed"} src={webUrl(jam?.embed) ?? undefined} allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write" allowFullScreen sandbox={EMBED_SANDBOX} referrerPolicy="strict-origin-when-cross-origin" className="min-h-0 w-full flex-1 border-0" />}
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}
