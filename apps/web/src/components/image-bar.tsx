import { ChevronDown, MagicWand02, Scissors01 } from "@untitledui/icons";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator } from "react-aria-components";
import { removeBackground } from "../campaign/remove-background";
import { replaceImage } from "../engine/image-actions";
import { startCrop } from "../engine/image-crop";
import { KEY_NEEDED, onAiChange, openAiSettings } from "../engine/ai-settings";
import { ImageKeyNeeded, generateImage, providers } from "../engine/media-providers";
import { firstImagePaint, isImageLayer, openPhotoEditor } from "../engine/photo";
import { editor, useEditor } from "../engine/store";
import type { SceneNode } from "../engine/types";
import { useVectorUi } from "../engine/vector-ui";
import { MenuRow } from "./left-sidebar";

// The contextual bar over the toolbar while one image is selected, as the reference shows it:
// Remove background, Edit with prompt (with an image model of your own or the server's; without
// one it says where to add a key) and More.

const button = "flex h-8 items-center gap-1.5 rounded-lg px-2 text-white/90 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50";

// The image size the model makes closest to the layer's proportions.
function sizeFor(node: SceneNode): "1024x1024" | "1536x1024" | "1024x1536" {
    const r = node.w / Math.max(1, node.h);
    return r > 1.2 ? "1536x1024" : r < 0.83 ? "1024x1536" : "1024x1024";
}

function EditWithPrompt({ node, available }: { node: SceneNode; available: boolean }) {
    const [prompt, setPrompt] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [needKey, setNeedKey] = useState(false);
    const run = (close: () => void) => {
        const text = prompt.trim();
        if (!text) return;
        setBusy(true);
        setError(null);
        void generateImage(text, sizeFor(node))
            .then((data) => {
                const latest = editor.get().doc.nodes[node.id];
                const index = firstImagePaint(latest);
                if (!latest || index < 0) return;
                const id = nanoid(12);
                const fills = latest.fills.map((p, i) => (i === index && p.type === "image" ? { ...p, id, original: undefined, adjust: undefined } : p));
                editor.execute({ type: "batch", commands: [{ type: "image.add", id, data }, { type: "node.update", id: node.id, patch: { fills } }] });
                setPrompt("");
                close();
            })
            .catch((e: unknown) => (e instanceof ImageKeyNeeded ? setNeedKey(true) : setError(e instanceof Error ? e.message : String(e))))
            .finally(() => setBusy(false));
    };
    return (
        <AriaDialogTrigger>
            <AriaButton className={button}>
                <MagicWand02 className="size-4" /> Edit with prompt
            </AriaButton>
            <AriaPopover placement="top" offset={10} className="w-72 rounded-xl border border-white/10 bg-tooltip p-2 text-white shadow-xl outline-none">
                <AriaDialog aria-label="Edit with prompt" className="outline-none">
                    {({ close }) =>
                        !available || needKey ? (
                            <div className="space-y-2 p-1 text-[12px]">
                                <p>{KEY_NEEDED}</p>
                                <p className="text-[11px] text-white/50">Image generation uses an image model with your own key, such as OpenAI images.</p>
                                <button type="button" onClick={() => (close(), openAiSettings())} className="h-7 rounded-lg bg-brand-500 px-3 text-[12px] font-medium text-white hover:bg-brand-600">
                                    Open AI settings
                                </button>
                            </div>
                        ) : (
                        <div className="space-y-2" onKeyDown={(e) => e.stopPropagation()}>
                            <textarea
                                autoFocus
                                rows={3}
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(close);
                                }}
                                placeholder="Describe the image you want here"
                                aria-label="Describe the image"
                                className="w-full resize-none rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-[12px] text-white outline-none placeholder:text-white/40 focus:border-brand-500"
                            />
                            {error && <p className="text-[11px] text-red-400">{error}</p>}
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] text-white/50">Makes a new image for this layer.</span>
                                <button type="button" disabled={busy || !prompt.trim()} onClick={() => run(close)} className="h-7 rounded-lg bg-brand-500 px-3 text-[12px] font-medium text-white hover:bg-brand-600 disabled:opacity-50">
                                    {busy ? "Making…" : "Generate"}
                                </button>
                            </div>
                        </div>
                        )
                    }
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

export function ImageBar() {
    const mode = useEditor((s) => s.mode);
    const node = useEditor((s) => (s.selection.length === 1 ? s.doc.nodes[s.selection[0] ?? ""] : undefined));
    const editingText = useEditor((s) => s.editingTextId);
    const editingVector = useEditor((s) => s.editingVectorId);
    const cropping = useVectorUi((s) => s.crop !== null);
    const [model, setModel] = useState(false);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        let live = true;
        const check = () => void providers().then((p) => live && setModel(p.image));
        check();
        const off = onAiChange(check);
        return () => {
            live = false;
            off();
        };
    }, []);
    if (mode !== "design" || !node || !isImageLayer(node) || cropping || editingText || editingVector) return null;
    return (
        <div className="pointer-events-auto flex h-11 items-center gap-0.5 rounded-xl bg-tooltip px-1.5 text-[12px] text-white shadow-xl" role="toolbar" aria-label="Image actions">
            <button
                type="button"
                disabled={busy}
                onClick={() => {
                    setBusy(true);
                    void removeBackground(node.id)
                        .then((ok) => !ok && editor.notify("Couldn't remove this image's background."))
                        .catch((e: unknown) => editor.notify(e instanceof Error ? e.message : String(e)))
                        .finally(() => setBusy(false));
                }}
                className={button}
            >
                <Scissors01 className="size-4" /> {busy ? "Removing…" : "Remove background"}
            </button>
            <EditWithPrompt node={node} available={model} />
            <span className="mx-1 h-6 w-px bg-white/15" />
            <AriaMenuTrigger>
                <AriaButton className={button}>
                    More <ChevronDown className="size-3.5" />
                </AriaButton>
                <AriaPopover placement="top end" offset={10} className="w-52 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                    <AriaMenu
                        aria-label="More image actions"
                        className="outline-none"
                        onAction={(k) => {
                            if (k === "crop") startCrop(node.id);
                            else if (k === "photo") openPhotoEditor(node.id);
                            else if (k === "replace") replaceImage(node.id);
                        }}
                    >
                        <MenuRow id="crop" label="Crop image" />
                        <MenuRow id="photo" label="Edit in Photo…" />
                        <AriaSeparator className="my-1 h-px bg-white/10" />
                        <MenuRow id="replace" label="Replace image…" />
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
        </div>
    );
}
