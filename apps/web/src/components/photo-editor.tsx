import { FlipBackward, FlipForward, SearchSm, X } from "@untitledui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { type ParamSpec, type PhotoCommand, type PhotoDocument, type PhotoLayer, loadPhotoEngine, parseParams, photoCommands } from "../engines/photo-engine";
import { imageBlob, imageBytes, storeDataUrl, storeImage } from "../engine/image-store";
import { imagePaintAt, rgbaToPng } from "../engine/photo";
import { editor, useEditor } from "../engine/store";
import type { Paint } from "../engine/types";
import { IconButton } from "./icon-button";
import { Select } from "./select";

// Sections of the command list, in the order a photo editor shows them.
const SECTIONS: { title: string; match: (c: PhotoCommand) => boolean }[] = [
    { title: "Adjustments", match: (c) => c.menu[0] === "Image" && c.menu[1] === "Adjustments" },
    { title: "Filters", match: (c) => c.menu[0] === "Filter" },
    { title: "Image", match: (c) => c.menu[0] === "Image" && c.menu[1] !== "Adjustments" },
];

interface Active {
    command: PhotoCommand;
    params: ParamSpec[];
    values: Record<string, number | boolean | string>;
    previewing: boolean;
    error: string | null;
}

// A photo workspace powered by PhotoCraft: its layers, adjustments and filters run on the real
// engine (WebAssembly), with live previews. Saving puts the result back into the design.
export function PhotoEditor() {
    const target = useEditor((s) => s.photoEdit);
    const node = useEditor((s) => (target ? s.doc.nodes[target.nodeId] : undefined));
    const images = useEditor((s) => s.doc.images);
    const [doc, setDoc] = useState<PhotoDocument | null>(null);
    const [commands, setCommands] = useState<PhotoCommand[]>([]);
    const [layers, setLayers] = useState<PhotoLayer[]>([]);
    const [status, setStatus] = useState("Loading PhotoCraft…");
    const [query, setQuery] = useState("");
    const [active, setActive] = useState<Active | null>(null);
    const [busy, setBusy] = useState(false);
    const [version, setVersion] = useState(0);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const previewTimer = useRef<number | undefined>(undefined);
    const paint = target ? imagePaintAt(node, target.paintIndex) : null;

    // Open the image (or its original PSD) in the engine.
    useEffect(() => {
        if (!paint) return;
        let cancelled = false;
        let opened: PhotoDocument | null = null;
        (async () => {
            try {
                const engine = await loadPhotoEngine();
                // A PDF page opens as its picture; only layered originals (PSD) open as the source.
                const psd = paint.source !== undefined && paint.page === undefined;
                const sourceId = psd && paint.source && images[paint.source] ? paint.source : paint.id;
                const sourceUrl = images[sourceId];
                if (!sourceUrl) throw new Error("This image's data is missing.");
                const bytes = await imageBytes(images, sourceId);
                if (!bytes) throw new Error("This image's data is missing from this browser and the server.");
                const blob = await imageBlob(images, sourceId);
                const type = blob?.type ?? "";
                const name = psd ? "image.psd" : type.includes("webp") || sourceUrl.startsWith("data:image/webp") ? "image.webp" : type.includes("jpeg") || sourceUrl.startsWith("data:image/jpeg") ? "image.jpg" : "image.png";
                opened = new engine.PhotoDoc(name, bytes);
                if (cancelled) return opened.free();
                if (import.meta.env.DEV) Object.assign(window, { nagmaPhotoDoc: opened });
                setDoc(opened);
                setCommands(await photoCommands());
                setStatus("");
            } catch (error) {
                setStatus(`Couldn't open this image: ${error instanceof Error ? error.message : String(error)}`);
            }
        })();
        return () => {
            cancelled = true;
            opened?.free();
        };
        // Opened once per editing session; later changes to the design don't reload it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target?.nodeId, target?.paintIndex]);

    // Draw the engine's current render whenever it changes.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!doc || !canvas) return;
        const w = doc.width();
        const h = doc.height();
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        const rgba = doc.render();
        ctx?.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), w, h), 0, 0);
        setLayers(JSON.parse(doc.layers()) as PhotoLayer[]);
    }, [doc, version]);

    const sections = useMemo(() => {
        const q = query.trim().toLowerCase();
        return SECTIONS.map((section) => ({
            title: section.title,
            items: commands.filter((c) => section.match(c) && (!q || c.label.toLowerCase().includes(q) || c.menu.join(" ").toLowerCase().includes(q))),
        })).filter((s) => s.items.length);
    }, [commands, query]);

    if (!target || !node) return null;

    const close = () => {
        window.clearTimeout(previewTimer.current);
        editor.set({ photoEdit: null });
    };

    const run = (command: PhotoCommand, values: Record<string, unknown>) => {
        if (!doc) return false;
        try {
            doc.execute(command.id, JSON.stringify(values));
            setVersion((v) => v + 1);
            setStatus("");
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // Commands act on the active layer; explain the usual fix in plain words.
            const hint = /active layer is/.test(message) ? " Select a pixel layer on the left first." : "";
            setStatus(`${message.replace(/^command `[^`]+` is not available right now: /, "")}.${hint}`);
            return false;
        }
    };

    const choose = (command: PhotoCommand) => {
        cancelActive();
        const params = parseParams(command.params);
        // Commands without settings we can show run straight away with their defaults.
        if (params.length === 0) {
            setStatus("");
            run(command, {});
            return;
        }
        const values = Object.fromEntries(params.map((p) => [p.name, p.value]));
        const next: Active = { command, params, values, previewing: false, error: null };
        setActive(next);
        preview(next);
    };

    // Live preview: undo the last preview and run the command again with the new settings.
    const preview = (state: Active) => {
        window.clearTimeout(previewTimer.current);
        previewTimer.current = window.setTimeout(() => {
            if (!doc) return;
            if (state.previewing) doc.undo();
            const ok = run(state.command, state.values);
            setActive({ ...state, previewing: ok, error: ok ? null : state.error });
        }, 120);
    };

    const cancelActive = () => {
        window.clearTimeout(previewTimer.current);
        if (active?.previewing && doc) {
            doc.undo();
            setVersion((v) => v + 1);
        }
        setActive(null);
    };

    const save = async () => {
        if (!doc || !paint) return;
        setBusy(true);
        try {
            const png = await rgbaToPng(doc.render(), doc.width(), doc.height());
            const imageId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
            // Keep a layered PSD alongside, so the next edit starts from the layers, not a flat picture.
            const layered = layers.length > 1 || (Boolean(paint.source) && paint.page === undefined);
            const sourceId = layered ? `${imageId}-psd` : undefined;
            const commandsToRun: Parameters<typeof editor.execute>[0][] = [{ type: "image.add", id: imageId, data: await storeDataUrl(png) }];
            if (sourceId) commandsToRun.push({ type: "image.add", id: sourceId, data: await storeImage(new Blob([doc.export("psd") as BlobPart], { type: "image/vnd.adobe.photoshop" })) });
            const fills: Paint[] = node.fills.map((p, i) => (i === target.paintIndex && p.type === "image" ? { ...p, id: imageId, source: sourceId, page: undefined } : p));
            commandsToRun.push({ type: "node.update", id: node.id, patch: { fills } });
            editor.execute({ type: "batch", commands: commandsToRun });
            close();
            editor.notify("Photo saved to the design. Undo brings back the original.");
        } catch (error) {
            setStatus(`Couldn't save: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusy(false);
        }
    };

    const field = "h-7 min-w-0 rounded-md border border-transparent bg-field px-1.5 text-ink outline-none hover:border-panel-border focus:border-brand-500";

    return (
        <div className="fixed inset-0 z-40 flex flex-col bg-canvas text-ink" onKeyDown={(e) => e.stopPropagation()}>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-panel-border bg-panel px-3">
                <span className="font-semibold">Photo</span>
                <span className="truncate text-ink-muted">· {node.name}</span>
                <span className="ml-2 rounded bg-field px-1.5 py-0.5 text-[10px] text-ink-subtle">PhotoCraft engine</span>
                <div className="flex-1" />
                <IconButton
                    icon={FlipBackward}
                    label="Undo"
                    disabled={!doc || Boolean(active)}
                    onPress={() => {
                        if (doc?.undo()) setVersion((v) => v + 1);
                    }}
                />
                <IconButton
                    icon={FlipForward}
                    label="Redo"
                    disabled={!doc || Boolean(active)}
                    onPress={() => {
                        if (doc?.redo()) setVersion((v) => v + 1);
                    }}
                />
                <button type="button" onClick={close} className="ml-2 h-7 rounded-md px-3 text-ink-muted hover:bg-panel-hover hover:text-ink">
                    Cancel
                </button>
                <button
                    type="button"
                    disabled={!doc || busy || Boolean(active)}
                    onClick={() => void save()}
                    className="h-7 rounded-md bg-brand-500 px-3 font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                >
                    {busy ? "Saving…" : "Save to design"}
                </button>
            </header>
            <div className="flex min-h-0 flex-1">
                <aside className="w-52 shrink-0 overflow-y-auto border-r border-panel-border bg-panel p-2">
                    <div className="flex h-7 items-center px-1 font-semibold">Layers</div>
                    {layers.map((layer) => (
                        <button
                            key={layer.id}
                            type="button"
                            disabled={!doc || Boolean(active)}
                            onClick={() => {
                                // Select the layer in the engine; commands act on the active layer.
                                try {
                                    doc?.execute("layer.select", JSON.stringify({ layer: layer.id }));
                                    setStatus("");
                                    setVersion((v) => v + 1);
                                } catch (error) {
                                    setStatus(error instanceof Error ? error.message : String(error));
                                }
                            }}
                            className={`flex h-7 w-full items-center gap-2 rounded-md px-1 text-left ${layer.active ? "bg-brand-100" : "hover:bg-panel-hover"} ${layer.visible ? "" : "text-ink-subtle"}`}
                            style={{ paddingLeft: 4 + layer.depth * 12 }}
                        >
                            <span className="min-w-0 flex-1 truncate">{layer.name}</span>
                            <span className="shrink-0 text-[10px] text-ink-subtle">{layer.kind}</span>
                        </button>
                    ))}
                </aside>
                <main className="relative flex min-w-0 flex-1 items-center justify-center p-6">
                    <canvas
                        ref={canvasRef}
                        className="max-h-full max-w-full object-contain shadow-2xl"
                        style={{ background: "repeating-conic-gradient(#d0d0d4 0 25%, #fff 0 50%) 0 0 / 16px 16px" }}
                    />
                    {status && (
                        <div className="absolute inset-x-0 top-4 flex justify-center">
                            <div className="rounded-lg bg-tooltip px-3 py-2 text-[12px] text-white shadow-lg">{status}</div>
                        </div>
                    )}
                </main>
                <aside className="flex w-72 shrink-0 flex-col border-l border-panel-border bg-panel">
                    {active ? (
                        <div className="space-y-3 border-b border-panel-border p-3">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold">{active.command.label.replace(/…$/, "")}</h3>
                                <IconButton size="sm" icon={X} label="Cancel" onPress={cancelActive} />
                            </div>
                            {active.params.map((p) => (
                                <label key={p.name} className="block space-y-1">
                                    <span className="flex justify-between text-ink-muted">
                                        <span className="capitalize">{p.name.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                                        {p.kind === "number" && <span className="text-ink">{Number(active.values[p.name]).toFixed(p.step < 1 ? 1 : 0)}</span>}
                                    </span>
                                    {p.kind === "number" && (
                                        <input
                                            type="range"
                                            min={p.min}
                                            max={Math.min(p.max, p.min + Math.max(100, (p.value - p.min) * 4))}
                                            step={p.step}
                                            value={Number(active.values[p.name])}
                                            onChange={(e) => {
                                                const next = { ...active, values: { ...active.values, [p.name]: Number(e.target.value) } };
                                                setActive(next);
                                                preview(next);
                                            }}
                                            className="w-full accent-brand-500"
                                        />
                                    )}
                                    {p.kind === "bool" && (
                                        <input
                                            type="checkbox"
                                            checked={Boolean(active.values[p.name])}
                                            onChange={(e) => {
                                                const next = { ...active, values: { ...active.values, [p.name]: e.target.checked } };
                                                setActive(next);
                                                preview(next);
                                            }}
                                        />
                                    )}
                                    {p.kind === "choice" && (
                                        <Select
                                            value={String(active.values[p.name])}
                                            onChange={(e) => {
                                                const next = { ...active, values: { ...active.values, [p.name]: e.target.value } };
                                                setActive(next);
                                                preview(next);
                                            }}
                                            className={`${field} w-full`}
                                        >
                                            {p.options.map((o) => (
                                                <option key={o} value={o}>
                                                    {o}
                                                </option>
                                            ))}
                                        </Select>
                                    )}
                                </label>
                            ))}
                            {active.error && <p className="text-[11px] text-red-400">{active.error}</p>}
                            <div className="grid grid-cols-2 gap-1.5">
                                <button type="button" onClick={cancelActive} className="h-7 rounded-md border border-panel-border hover:bg-panel-hover">
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    disabled={!active.previewing}
                                    onClick={() => {
                                        window.clearTimeout(previewTimer.current);
                                        setActive(null);
                                    }}
                                    className="h-7 rounded-md bg-brand-500 font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="border-b border-panel-border p-2">
                            <label className="flex h-7 items-center gap-1.5 rounded-md bg-field px-2">
                                <SearchSm className="size-3.5 text-ink-subtle" />
                                <input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search adjustments and filters"
                                    className="min-w-0 flex-1 bg-transparent outline-none"
                                />
                            </label>
                        </div>
                    )}
                    <div className="min-h-0 flex-1 overflow-y-auto p-2">
                        {sections.map((section) => (
                            <section key={section.title} className="mb-3">
                                <div className="flex h-7 items-center px-1 font-semibold">{section.title}</div>
                                {section.items.map((c) => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        disabled={!doc}
                                        onClick={() => choose(c)}
                                        title={c.menu.join(" › ")}
                                        className={`flex h-7 w-full items-center justify-between gap-2 rounded-md px-2 text-left hover:bg-panel-hover ${active?.command.id === c.id ? "bg-brand-100" : ""}`}
                                    >
                                        <span className="min-w-0 truncate">{c.label}</span>
                                        {section.title === "Filters" && c.menu[1] && <span className="shrink-0 text-[10px] text-ink-subtle">{c.menu[1]}</span>}
                                    </button>
                                ))}
                            </section>
                        ))}
                    </div>
                </aside>
            </div>
        </div>
    );
}
