import { setupHint } from "../engine/auth";
import { openCommunity } from "../components/home";
import { ChevronDown, Circle, Image03, ImagePlus, Maximize02, Minus, ArrowRight, PuzzlePiece01, RefreshCw01, Scissors01, SearchSm, Square, Star01, Table, Triangle, Type01, Upload01, LayoutGrid01, Download01, Edit05 } from "@untitledui/icons";
import { useEffect, useMemo, useState, type FC, type ReactNode, type SVGProps } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover } from "react-aria-components";
import { MenuRow } from "../components/left-sidebar";
import { loadPlugins, pickPluginManifest, pluginCommands, runPlugin, runsIn, usePlugins } from "../engine/plugins";
import { ensureFont } from "../engine/fonts";
import { imageSrc, preloadImages } from "../engine/image-store";
import { editor, useEditor } from "../engine/store";
import { fitAssets, openBulk } from "./actions";
import { FONT_PAIRS, MADE_PICTURES, addFontPair, addImageData, addImageFile, addMadePicture, addObject, addShape, addText, drawPicture, makeBrandPicture, pickFiles, targetAsset, textPresets, type InsertObject, type InsertShape } from "./inserts";
import { LogoTile, PanelShell } from "./left-panel";
import { assetOf, brandOf, layerData, setLayerField, tidyGrid } from "./model";
import { removeBackground } from "./remove-background";
import { campaign } from "./state";
import { AddLibraryMenu, CampaignLibraries } from "./libraries";
import { addVideoFile, placeVideoPaint } from "./video";
import type { ImagePaint } from "../engine/types";
import { isVideoFile } from "../engines/video-engine";
import { type Providers, type StockPhoto, ImageKeyNeeded, generateImage, providers, searchStock, stockFile } from "../engine/media-providers";
import { KEY_NEEDED, onAiChange, openAiSettings } from "../engine/ai-settings";

// The rail's add panels: Text (a text box, styles and font pairings), Media (pictures to drop in,
// made or uploaded), Inserts (objects, shapes and the brand libraries) and Plugins (the campaign's
// tools, from background removal to bulk create).

const SECONDARY = "flex h-6 w-full items-center justify-center gap-1.5 rounded-[5px] border border-panel-border text-[11px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500 disabled:opacity-40";
const TILE = "rounded-[5px] bg-field outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500";

// The Text panel's four styles, as the tiles show them (the product's own type, not the preset's).
const TEXT_TILES: Record<string, { size: number; weight: number }> = {
    title: { size: 21, weight: 700 },
    headline: { size: 17.5, weight: 600 },
    subheadline: { size: 13, weight: 700 },
    body: { size: 13.5, weight: 400 },
};

function Search({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
    return (
        <div className="shrink-0 px-4 pb-3">
            <label className="flex h-6 items-center gap-1.5 rounded-[5px] border border-transparent bg-field px-2 focus-within:border-brand-500">
                <SearchSm className="size-3.5 shrink-0 text-ink-muted" />
                <input aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-subtle" />
            </label>
        </div>
    );
}

function Heading({ children, action }: { children: ReactNode; action?: ReactNode }) {
    return (
        <div className="flex h-10 items-center justify-between px-4 pt-2 text-[11px] font-semibold text-ink">
            {children}
            {action}
        </div>
    );
}

// Loads a family before a sample shows it, so the tile isn't drawn in a fallback face.
function useFontsReady(families: string[]) {
    const [, bump] = useState(0);
    const key = families.join("|");
    useEffect(() => {
        for (const f of key.split("|")) ensureFont(f, () => bump((n) => n + 1));
    }, [key]);
}

export function TextPanel() {
    const doc = useEditor((s) => s.doc);
    const presets = textPresets(doc);
    useFontsReady([...new Set(FONT_PAIRS.map((p) => p.heading))]);
    return (
        <PanelShell
            title="Text"
            search={
                <div className="mt-1 mr-4 ml-[15px] border-b border-panel-border pb-4">
                    <AriaButton className={SECONDARY} onPress={() => addText()}>
                        <Type01 className="size-4" /> Add text box
                    </AriaButton>
                </div>
            }
        >
            <div className="mt-4 space-y-2 pr-4 pl-[15px]" aria-label="Text styles">
                {presets.map((p) => {
                    const tile = TEXT_TILES[p.id] ?? TEXT_TILES.body;
                    const label = p.id === "body" ? "Add body text" : `Add a ${p.label.toLowerCase()}`;
                    return (
                        <AriaButton key={p.id} aria-label={label} onPress={() => addText(p)} className={`${TILE} flex h-[46px] w-full items-center px-[18px] text-left text-ink`}>
                            <span className="truncate" style={{ fontWeight: tile?.weight, fontSize: tile?.size }}>{label}</span>
                        </AriaButton>
                    );
                })}
            </div>
            <Heading>Font combinations</Heading>
            <div className="grid grid-cols-2 gap-2 px-4 pb-4">
                {FONT_PAIRS.map((p) => (
                    <AriaButton key={p.id} aria-label={`Add ${p.sample} in ${p.heading} with ${p.body}`} onPress={() => addFontPair(p)} className={`${TILE} flex aspect-square flex-col items-center justify-center gap-0.5 overflow-hidden px-1.5 text-center`}>
                        <span
                            className="max-w-full leading-none"
                            style={{ fontFamily: `"${p.heading}", system-ui, sans-serif`, fontWeight: p.headingWeight, fontSize: p.size * 1.28, fontStyle: p.italic ? "italic" : "normal", textTransform: p.upper ? "uppercase" : "none", color: p.color, letterSpacing: p.upper ? "0.02em" : undefined }}
                        >
                            {p.sample}
                        </span>
                        {p.sub && (
                            <span className="max-w-full leading-tight" style={{ fontFamily: `"${p.body}", system-ui, sans-serif`, fontSize: (p.subSize ?? 7) * 1.28, fontWeight: p.subWeight ?? 400, textTransform: p.subUpper ? "uppercase" : "none", color: p.color, letterSpacing: p.subUpper ? "0.04em" : undefined }}>
                                {p.sub}
                            </span>
                        )}
                    </AriaButton>
                ))}
            </div>
        </PanelShell>
    );
}

// ---- Media ----

interface MediaItem {
    key: string;
    name: string;
    url: string;
    w: number;
    h: number;
    add: () => void;
    video?: boolean;
}

// The videos already in the file, by their poster image: adding one places the same video again.
function useDocVideos(): Map<string, ImagePaint> {
    const nodes = useEditor((s) => s.doc.nodes);
    return useMemo(() => {
        const out = new Map<string, ImagePaint>();
        for (const n of Object.values(nodes)) for (const p of n.fills) if (p.type === "image" && p.video && !out.has(p.id)) out.set(p.id, p);
        return out;
    }, [nodes]);
}

function useDocImages(): MediaItem[] {
    const images = useEditor((s) => s.doc.images);
    const [urls, setUrls] = useState<Record<string, string>>({});
    const ids = Object.keys(images).join("|");
    useEffect(() => {
        let live = true;
        void preloadImages(images).then(() => {
            if (!live) return;
            const next: Record<string, string> = {};
            for (const id of Object.keys(images)) next[id] = imageSrc(images, id) ?? "";
            setUrls(next);
        });
        return () => {
            live = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ids]);
    const videos = useDocVideos();
    return Object.keys(images)
        .filter((id) => urls[id])
        .map((id, i) => {
            const video = videos.get(id);
            if (video?.video) {
                const v = video.video;
                return { key: id, name: v.name, url: urls[id] as string, w: v.width || 16, h: v.height || 9, video: true, add: () => void placeVideoPaint(video) };
            }
            return { key: id, name: `In this file ${i + 1}`, url: urls[id] as string, w: 4, h: 3, add: () => void addImageData(images[id] as string, "Image") };
        });
}

// Two columns of tiles, each going under the shorter one.
function masonry<T extends { w: number; h: number }>(items: T[]): T[][] {
    const cols: T[][] = [[], []];
    const heights = [0, 0];
    for (const item of items) {
        const c = (heights[0] ?? 0) <= (heights[1] ?? 0) ? 0 : 1;
        cols[c]?.push(item);
        heights[c] = (heights[c] ?? 0) + item.h / item.w;
    }
    return cols;
}

export function MediaPanel() {
    const [query, setQuery] = useState("");
    const [available, setAvailable] = useState<Providers | null>(null);
    const [stock, setStock] = useState<{ q: string; photos: StockPhoto[]; error: string | null } | null>(null);
    const [placing, setPlacing] = useState<string | null>(null);
    const [prompt, setPrompt] = useState<string | null>(null);
    const [size, setSize] = useState<"1024x1024" | "1536x1024" | "1024x1536">("1024x1024");
    const [generating, setGenerating] = useState(false);
    const [genError, setGenError] = useState<string | null>(null);
    useEffect(() => {
        const check = () => void providers().then(setAvailable);
        check();
        return onAiChange(check);
    }, []);
    // Stock photos for what's typed (or a starting set), once a provider is connected.
    useEffect(() => {
        if (!available?.stock) return;
        const abort = new AbortController();
        const q = query.trim() || "texture";
        const t = window.setTimeout(
            () =>
                void searchStock(q, 1, abort.signal).then(
                    (photos) => setStock({ q, photos, error: null }),
                    (e: unknown) => !abort.signal.aborted && setStock({ q, photos: [], error: e instanceof Error ? e.message : String(e) }),
                ),
            250,
        );
        return () => (window.clearTimeout(t), abort.abort());
    }, [query, available?.stock]);
    const placeStock = (p: StockPhoto) => {
        setPlacing(p.id);
        void stockFile(p)
            .then((file) => addImageFile(file))
            .catch((e: unknown) => editor.notify(e instanceof Error ? e.message : String(e)))
            .finally(() => setPlacing(null));
    };
    const generate = () => {
        if (!prompt?.trim()) return;
        setGenerating(true);
        setGenError(null);
        void generateImage(prompt.trim(), size)
            .then((data) => addImageData(data, prompt.trim().slice(0, 60), size === "1536x1024" ? { w: 3, h: 2 } : size === "1024x1536" ? { w: 2, h: 3 } : { w: 1, h: 1 }))
            .then(() => setPrompt(null))
            .catch((e: unknown) => (e instanceof ImageKeyNeeded ? setAvailable((a) => (a ? { ...a, image: false, imageKeyNeeded: true } : a)) : setGenError(e instanceof Error ? e.message : String(e))))
            .finally(() => setGenerating(false));
    };
    const own = useDocImages();
    const made = useMemo(() => MADE_PICTURES.map((p) => ({ key: p.id, name: p.name, url: drawPicture(p, 0.4), w: p.w, h: p.h, add: () => void addMadePicture(p) })), []);
    const q = query.trim().toLowerCase();
    const items = [...own, ...made].filter((m) => !q || m.name.toLowerCase().includes(q));
    const cols = masonry<MediaItem>(items);
    const photos = stock?.photos ?? [];
    return (
        <PanelShell
            title="Media"
            search={<Search placeholder="Search images" value={query} onChange={setQuery} />}
            footer={
                <div className="space-y-1.5 px-4 py-2.5">
                    {prompt !== null && (
                        <div className="space-y-1.5" onKeyDown={(e) => e.stopPropagation()}>
                            {available?.image ? (
                                <>
                                    <textarea autoFocus value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="Describe the image" aria-label="Describe the image" className="w-full resize-none rounded-[5px] border border-panel-border bg-field px-2 py-1.5 text-[11px] text-ink outline-none focus:border-brand-500" />
                                    <div className="flex gap-1.5">
                                        <select aria-label="Shape" value={size} onChange={(e) => setSize(e.target.value as typeof size)} className="h-[22px] flex-1 rounded-[5px] border border-panel-border bg-field px-1 text-[11px] text-ink outline-none">
                                            <option value="1024x1024">Square</option>
                                            <option value="1536x1024">Landscape</option>
                                            <option value="1024x1536">Portrait</option>
                                        </select>
                                        <AriaButton isDisabled={generating || !prompt.trim()} onPress={generate} className="h-[22px] rounded-[5px] bg-brand-500 px-2 text-[11px] font-medium text-white outline-none hover:bg-brand-600 disabled:opacity-50">
                                            {generating ? "Making…" : "Generate"}
                                        </AriaButton>
                                    </div>
                                    {genError && <p className="text-[11px] text-red-500">{genError}</p>}
                                </>
                            ) : (
                                <div className="space-y-1.5 rounded-[5px] bg-field px-2 py-1.5 text-[11px] text-ink-muted">
                                    <p>
                                        <b className="font-medium text-ink">{KEY_NEEDED}</b> Image generation uses an image model with your own key, such as OpenAI images. Until then, Make a brand picture draws one in the brand kit's colours.
                                    </p>
                                    <AriaButton className={SECONDARY} onPress={openAiSettings}>
                                        Open AI settings
                                    </AriaButton>
                                </div>
                            )}
                            <AriaButton className={SECONDARY} onPress={() => void makeBrandPicture()}>
                                <ImagePlus className="size-3.5" /> Make a brand picture
                            </AriaButton>
                        </div>
                    )}
                    {prompt === null && (
                        <AriaButton className={SECONDARY} onPress={() => setPrompt("")}>
                            <ImagePlus className="size-3.5" /> Make an image
                        </AriaButton>
                    )}
                    <AriaButton className={SECONDARY} onPress={() => pickFiles("image/*,video/*", (files) => files.forEach((f) => void (isVideoFile(f) ? addVideoFile(f) : addImageFile(f))), true)}>
                        <Upload01 className="size-3.5" /> Upload image or video
                    </AriaButton>
                </div>
            }
        >
            {items.length === 0 && <p className="px-4 text-[11px] text-ink-subtle">No pictures in this file match.</p>}
            <div className="flex gap-1.5 px-4 pb-3" aria-label="Pictures">
                {cols.map((col, i) => (
                    <div key={i} className="flex min-w-0 flex-1 flex-col gap-1.5">
                        {col.map((m) => (
                            <AriaButton key={m.key} aria-label={`Add ${m.name}`} onPress={m.add} className={`${TILE} relative overflow-hidden p-0`}>
                                <img src={m.url} alt="" className="block w-full object-cover" style={{ aspectRatio: `${m.w} / ${m.h}` }} draggable={false} />
                                {m.video && (
                                    <span aria-hidden="true" className="absolute right-1 bottom-1 flex size-4 items-center justify-center rounded-full bg-black/60 text-white">
                                        <svg viewBox="0 0 8 8" className="size-2" fill="currentColor"><path d="M2 1v6l5-3z" /></svg>
                                    </span>
                                )}
                            </AriaButton>
                        ))}
                    </div>
                ))}
            </div>
            <div className="px-4 pt-1 pb-1.5 text-[11px] font-medium text-ink">Stock photos</div>
            {available && !available.stock && (
                <p className="mx-4 mb-3 rounded-[5px] bg-field px-2 py-1.5 text-[11px] text-ink-muted">
                    <b className="font-medium text-ink">Stock photos aren't set up on this server yet.</b> {setupHint("Set NAGMA_STOCK_KEY on the server (Unsplash, or Pexels with NAGMA_STOCK_PROVIDER=pexels).", "Ask whoever runs it to connect a photo provider.")}
                </p>
            )}
            {stock?.error && <p className="px-4 pb-2 text-[11px] text-red-500">{stock.error}</p>}
            {available?.stock && stock && !stock.error && photos.length === 0 && <p className="px-4 pb-2 text-[11px] text-ink-subtle">No stock photos for "{stock.q}".</p>}
            {photos.length > 0 && (
                <>
                    <div className="flex gap-1.5 px-4 pb-1.5" aria-label="Stock photos">
                        {masonry(photos).map((col, i) => (
                            <div key={i} className="flex min-w-0 flex-1 flex-col gap-1.5">
                                {col.map((p) => (
                                    <AriaButton key={p.id} aria-label={`Add ${p.alt || "photo"} by ${p.author}`} isDisabled={placing === p.id} onPress={() => placeStock(p)} className={`${TILE} group relative overflow-hidden p-0`}>
                                        <img src={p.preview} alt={p.alt} className="block w-full object-cover" style={{ aspectRatio: `${p.w} / ${p.h}`, background: p.color ?? undefined }} draggable={false} />
                                        <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-left text-[9.5px] text-white opacity-0 group-hover:opacity-100">{placing === p.id ? "Adding…" : p.author}</span>
                                    </AriaButton>
                                ))}
                            </div>
                        ))}
                    </div>
                    <p className="px-4 pb-3 text-[10.5px] text-ink-subtle">
                        Photos from{" "}
                        <a href={photos[0]?.sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                            {photos[0]?.source}
                        </a>
                        . Each photo's layer is named after its photographer.
                    </p>
                </>
            )}
        </PanelShell>
    );
}

// ---- Inserts ----

const OBJECTS: { id: InsertObject; label: string; preview: ReactNode }[] = [
    { id: "button", label: "Button", preview: <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[8px] font-semibold text-white">Shop now</span> },
    { id: "badge", label: "Badge", preview: <span className="rounded bg-[#F7C948] px-1.5 py-0.5 text-[8px] font-bold text-black">New</span> },
    { id: "rating", label: "Rating", preview: <span className="text-[10px] tracking-tight text-[#F7C948]">★★★★★</span> },
    { id: "quote", label: "Quote card", preview: <span className="rounded bg-white px-1.5 py-1 text-[7px] text-black">“Loved it.”</span> },
    { id: "divider", label: "Divider", preview: <span className="h-px w-10 bg-ink-muted" /> },
    { id: "avatar", label: "Avatar", preview: <span className="size-6 rounded-full border-2 border-white bg-[#F2643D]" /> },
];

const SHAPES: { id: InsertShape; label: string; icon: FC<SVGProps<SVGSVGElement>> }[] = [
    { id: "rect", label: "Rectangle", icon: Square },
    { id: "rounded", label: "Rounded rectangle", icon: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><rect x="3" y="5" width="18" height="14" rx="5" /></svg> },
    { id: "ellipse", label: "Ellipse", icon: Circle },
    { id: "polygon", label: "Triangle", icon: Triangle },
    { id: "star", label: "Star", icon: Star01 },
    { id: "line", label: "Line", icon: Minus },
    { id: "arrow", label: "Arrow", icon: ArrowRight },
];

export function InsertsPanel() {
    const [tab, setTab] = useState<"objects" | "shapes">("objects");
    const [query, setQuery] = useState("");
    const doc = useEditor((s) => s.doc);
    const readOnly = useEditor((s) => s.readOnly);
    const brand = brandOf(doc);
    const q = query.trim().toLowerCase();
    const objects = OBJECTS.filter((o) => !q || o.label.toLowerCase().includes(q));
    const shapes = SHAPES.filter((o) => !q || o.label.toLowerCase().includes(q));
    const logos = brand.logos.filter((l) => !q || l.name.toLowerCase().includes(q) || "logo".includes(q));
    const tabClass = (on: boolean) => `h-[22px] min-w-0 flex-1 truncate rounded-[4px] px-2 text-[11px] outline-none ${on ? "bg-panel text-ink ring-1 ring-panel-border" : "text-ink-muted hover:text-ink"}`;
    return (
        <PanelShell title="Inserts" search={<Search placeholder="Search shapes and libraries" value={query} onChange={setQuery} />}>
            <div role="tablist" aria-label="Insert kind" className="mx-4 mb-3 flex h-6 items-center rounded-[5px] bg-field p-px">
                <button type="button" role="tab" aria-selected={tab === "objects"} onClick={() => setTab("objects")} className={tabClass(tab === "objects")}>Objects</button>
                <button type="button" role="tab" aria-selected={tab === "shapes"} onClick={() => setTab("shapes")} className={tabClass(tab === "shapes")}>Shapes</button>
            </div>
            <div className="border-b border-panel-border pb-3">
                {tab === "objects" ? (
                    <>
                        <div className="px-4 pt-1 pb-1.5 text-[11px] text-ink-muted">Objects</div>
                        <div className="grid grid-cols-3 gap-2 px-4">
                            {objects.map((o) => (
                                <AriaButton key={o.id} aria-label={`Add ${o.label}`} isDisabled={readOnly} onPress={() => addObject(o.id)} className={`${TILE} flex aspect-square flex-col items-center justify-center gap-1.5`}>
                                    <span className="flex h-6 items-center">{o.preview}</span>
                                    <span className="text-[9.5px] text-ink-muted">{o.label}</span>
                                </AriaButton>
                            ))}
                        </div>
                        {logos.length > 0 && (
                            <>
                                <div className="px-4 pt-3 pb-1.5 text-[11px] text-ink-muted">Logos</div>
                                <div className="grid grid-cols-3 gap-2 px-4">
                                    {logos.map((l) => (
                                        <LogoTile key={l.id} imageId={l.imageId} name={l.name} />
                                    ))}
                                </div>
                            </>
                        )}
                    </>
                ) : (
                    <div className="grid grid-cols-3 gap-2 px-4 pt-1">
                        {shapes.map(({ id, label, icon: Icon }) => (
                            <AriaButton key={id} aria-label={`Add ${label}`} isDisabled={readOnly} onPress={() => addShape(id)} className={`${TILE} flex aspect-square flex-col items-center justify-center gap-1 text-ink-muted hover:text-ink`}>
                                <Icon className="size-5" />
                                <span className="text-[9.5px]">{label}</span>
                            </AriaButton>
                        ))}
                    </div>
                )}
                {(tab === "objects" ? objects.length : shapes.length) === 0 && <p className="px-4 pt-1 text-[11px] text-ink-subtle">Nothing matches.</p>}
            </div>
            <Heading action={!readOnly ? <AddLibraryMenu /> : undefined}>Libraries</Heading>
            <CampaignLibraries query={q} />
        </PanelShell>
    );
}

// ---- Plugins: the campaign's built-in tools ----

interface Tool {
    id: string;
    name: string;
    about: string;
    kind: "image" | "layout" | "data" | "export";
    icon: FC<SVGProps<SVGSVGElement>>;
    run: () => void;
}

function selectedImageLayer() {
    const s = editor.get();
    const node = s.doc.nodes[s.selection[0] ?? ""];
    return node && node.fills.some((p) => p.type === "image") ? node : null;
}

const TOOLS: Tool[] = [
    {
        id: "remove-bg",
        name: "Remove background",
        about: "Cut the backdrop out of the selected picture.",
        kind: "image",
        icon: Scissors01,
        run: () => {
            const node = selectedImageLayer();
            if (!node) return editor.notify("Select a picture first.");
            void removeBackground(node.id)
                .then((ok) => editor.notify(ok ? "Background removed." : "Couldn't read that image."))
                .catch((e) => editor.notify(`Couldn't remove the background: ${e instanceof Error ? e.message : String(e)}`));
        },
    },
    { id: "make-image", name: "Make an image", about: "A new picture in the brand kit's colours.", kind: "image", icon: Image03, run: () => void makeBrandPicture() },
    {
        id: "resize",
        name: "Resize to sizes",
        about: "Copies of the asset in other sizes, reflowed.",
        kind: "layout",
        icon: Maximize02,
        run: () => {
            const asset = targetAsset();
            if (asset) campaign.set({ dialog: { kind: "resize", assetId: asset.id } });
        },
    },
    { id: "tidy", name: "Tidy asset grid", about: "Line every asset up in its row.", kind: "layout", icon: LayoutGrid01, run: () => (tidyGrid(), fitAssets()) },
    {
        id: "open-text",
        name: "Make text editable",
        about: "Open every text layer on the asset up to editors.",
        kind: "layout",
        icon: Edit05,
        run: () => {
            const asset = targetAsset();
            if (!asset) return;
            const doc = editor.get().doc;
            const visit = (id: string): string[] => {
                const n = doc.nodes[id];
                if (!n) return [];
                return [...(n.type === "text" && !layerData(n) && assetOf(doc, n.id) ? [n.id] : []), ...n.children.flatMap(visit)];
            };
            const ids = asset.children.flatMap(visit);
            for (const id of ids) setLayerField(id, {});
            editor.notify(ids.length ? `${ids.length} text layer${ids.length === 1 ? "" : "s"} opened up.` : "Every text layer here is already a field.");
        },
    },
    { id: "bulk", name: "Bulk create from data", about: "Assets from a spreadsheet's rows.", kind: "data", icon: Table, run: openBulk },
    { id: "update", name: "Update from data", about: "Run a row's spreadsheet again.", kind: "data", icon: RefreshCw01, run: () => campaign.set({ panel: "bulk" }) },
    { id: "export", name: "Export all", about: "Every asset as files in a zip.", kind: "export", icon: Download01, run: () => campaign.set({ dialog: { kind: "export", all: true } }) },
];

const KINDS: { id: "all" | Tool["kind"]; label: string }[] = [
    { id: "all", label: "All" },
    { id: "image", label: "Images" },
    { id: "layout", label: "Layout" },
    { id: "data", label: "Data" },
    { id: "export", label: "Export" },
];

// Plugins installed in this browser that run in the design editor; they run on the campaign the
// same way (their window opens over the canvas). Import adds one from its manifest.
function InstalledPlugins({ query }: { query: string }) {
    const loaded = usePlugins((s) => s.loaded);
    const plugins = usePlugins((s) => s.plugins).filter((p) => runsIn(p, "design") && (!query || p.manifest.name.toLowerCase().includes(query)));
    const readOnly = useEditor((s) => s.readOnly);
    useEffect(() => {
        if (!loaded) void loadPlugins();
    }, [loaded]);
    return (
        <>
            <Heading action={!readOnly ? <AriaButton onPress={pickPluginManifest} className="rounded px-1 text-[11px] font-normal text-brand-500 outline-none hover:underline">Import…</AriaButton> : undefined}>Installed</Heading>
            {plugins.length === 0 && <p className="px-4 pb-2 text-[11px] text-ink-subtle">{loaded ? "No plugins yet. Import one from its manifest." : "Loading…"}</p>}
            <div className="space-y-0.5 px-[5px] pb-2">
                {plugins.map((p) => {
                    const commands = pluginCommands(p);
                    const run = (command = "") => runPlugin(p.id, command);
                    return commands.length > 1 ? (
                        <AriaMenuTrigger key={p.id}>
                            <AriaButton isDisabled={readOnly} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500">
                                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-field text-ink-muted">
                                    <PuzzlePiece01 className="size-3.5" />
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{p.manifest.name}</span>
                                <ChevronDown className="size-3 text-ink-muted" />
                            </AriaButton>
                            <AriaPopover placement="bottom start" offset={4} className="w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                                <AriaMenu aria-label={p.manifest.name} className="outline-none" onAction={(key) => run(String(key))}>
                                    {commands.map((c) => (
                                        <MenuRow key={c.command} id={c.command} label={c.label} />
                                    ))}
                                </AriaMenu>
                            </AriaPopover>
                        </AriaMenuTrigger>
                    ) : (
                        <AriaButton key={p.id} isDisabled={readOnly} onPress={() => run(commands[0]?.command ?? "")} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-field text-ink-muted">
                                <PuzzlePiece01 className="size-3.5" />
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{p.manifest.name}</span>
                        </AriaButton>
                    );
                })}
            </div>
        </>
    );
}

export function PluginsPanel() {
    const [query, setQuery] = useState("");
    const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("all");
    const q = query.trim().toLowerCase();
    const tools = TOOLS.filter((t) => (kind === "all" || t.kind === kind) && (!q || `${t.name} ${t.about}`.toLowerCase().includes(q)));
    return (
        <PanelShell
            title="Plugins"
            search={<Search placeholder="Search all plugins" value={query} onChange={setQuery} />}
            footer={
                <AriaButton onPress={openCommunity} className="flex h-9 w-full items-center gap-1.5 px-4 text-[11px] text-brand-500 outline-none hover:underline">
                    <PuzzlePiece01 className="size-3.5" /> Browse more in Community
                </AriaButton>
            }
        >
            <div className="px-4 pb-2">
                <AriaMenuTrigger>
                    <AriaButton aria-label="Plugin kind" className="flex h-5 items-center gap-1 rounded-[5px] bg-field px-1.5 text-[11px] text-ink outline-none hover:bg-panel-hover">
                        {KINDS.find((k) => k.id === kind)?.label} <ChevronDown className="size-3 text-ink-muted" />
                    </AriaButton>
                    <AriaPopover placement="bottom start" offset={4} className="w-40 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                        <AriaMenu aria-label="Plugin kind" className="outline-none" onAction={(k) => setKind(k as typeof kind)}>
                            {KINDS.map((k) => (
                                <MenuRow key={k.id} id={k.id} label={k.label} checked={kind === k.id} />
                            ))}
                        </AriaMenu>
                    </AriaPopover>
                </AriaMenuTrigger>
            </div>
            <InstalledPlugins query={q} />
            <div className="px-4 pt-1 pb-1 text-[11px] font-semibold text-ink">Campaign tools</div>
            <div className="space-y-0.5 px-[5px] pb-3">
                {tools.map((t) => (
                    <AriaButton key={t.id} onPress={t.run} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-field text-ink-muted">
                            <t.icon className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] text-ink">{t.name}</span>
                            <span className="block truncate text-[10px] text-ink-muted">{t.about}</span>
                        </span>
                    </AriaButton>
                ))}
                {tools.length === 0 && <p className="px-1.5 text-[11px] text-ink-subtle">No plugins match.</p>}
            </div>
        </PanelShell>
    );
}
