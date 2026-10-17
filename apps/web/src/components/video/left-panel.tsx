import { FolderPlus, Image01, LayersThree01, MusicNote01, Plus, SearchSm, Trash01, Type01, VideoRecorder } from "@untitledui/icons";
import { useEffect, useMemo, useState } from "react";
import { type EffectSpecInfo, effectCatalog } from "../../engines/motion-engine";
import { imageSrc } from "../../engine/image-store";
import { useEditor } from "../../engine/store";
import { addAdjustment, addEffect, addShape, addSolid, addTitle, applyMotionPreset, applyTransition, importFiles, insertMedia, pickMedia, removeMedia, renameMedia } from "../../engine/video/actions";
import { type VMedia, ROOT, compLength, projectOf } from "../../engine/video/model";
import { MOTION_PRESETS, SHAPES, TITLE_PRESETS, TRANSITIONS, usableEffects } from "../../engine/video/presets";
import { openComp, useImagesReady, useVideoUi, vui } from "../../engine/video/state";
import { IconButton } from "../icon-button";
import { FileHeader } from "../layers-panel";
import { Pill } from "./common";
import { shortTime } from "../../engine/video/format";
import { LIB_MIME, type LibraryDrag, MEDIA_MIME } from "./timeline";

// The left panel: the Project (media bin and sequences) and the Library (effects, transitions,
// titles, motion presets, shapes), under the file's name like the other editors.

export function LeftPanel() {
    const tab = useVideoUi((s) => s.leftTab);
    return (
        <aside className="flex h-full w-64 shrink-0 flex-col border-r border-panel-border bg-panel text-[11px]">
            <FileHeader onExport={() => vui.set({ exportOpen: true })} />
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-panel-border px-2">
                <Pill active={tab === "project"} onClick={() => vui.set({ leftTab: "project" })}>Project</Pill>
                <Pill active={tab === "library"} onClick={() => vui.set({ leftTab: "library" })}>Library</Pill>
            </div>
            {tab === "project" ? <ProjectPanel /> : <LibraryPanel />}
        </aside>
    );
}

// ---- Project ----

const KIND_ICON = { video: VideoRecorder, audio: MusicNote01, image: Image01 };

function ProjectPanel() {
    const doc = useEditor((s) => s.doc);
    useImagesReady();
    const project = projectOf(doc);
    const selection = useVideoUi((s) => s.mediaSelection);
    const importing = useVideoUi((s) => s.importing);
    const compId = useVideoUi((s) => s.compId);
    const [query, setQuery] = useState("");
    const [dragOver, setDragOver] = useState(false);
    const [renaming, setRenaming] = useState<string | null>(null);
    const media = project.media.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));
    const pick = (e: React.MouseEvent, id: string) => {
        if (e.shiftKey || e.metaKey) vui.set({ mediaSelection: selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id] });
        else vui.set({ mediaSelection: [id] });
    };
    return (
        <div
            className={`flex min-h-0 flex-1 flex-col ${dragOver ? "bg-brand-500/5 ring-2 ring-brand-500 ring-inset" : ""}`}
            onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                setDragOver(false);
                const files = Array.from(e.dataTransfer.files);
                if (!files.length) return;
                e.preventDefault();
                void importFiles(files);
            }}
        >
            <div className="flex shrink-0 items-center gap-1 px-2 py-2">
                <button type="button" onClick={() => pickMedia()} className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-500 font-semibold text-white hover:bg-brand-600">
                    <FolderPlus className="size-3.5" /> Import media
                </button>
                <IconButton size="sm" icon={Type01} label="New title" shortcut="T" onPress={() => addTitle()} />
                <IconButton size="sm" icon={ColorMatteIcon} label="New color matte" onPress={() => addSolid()} />
                <IconButton size="sm" icon={AdjustIcon} label="New adjustment layer" onPress={() => addAdjustment()} />
            </div>
            <label className="mx-2 mb-2 flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-field px-2 text-ink-muted">
                <SearchSm className="size-3.5" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search media" aria-label="Search media" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-subtle" />
            </label>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {importing > 0 && <div className="mb-2 rounded-md bg-brand-500/10 px-2 py-1.5 text-brand-500">Importing {importing} file{importing === 1 ? "" : "s"}…</div>}
                {project.media.length === 0 && importing === 0 && (
                    <button type="button" onClick={() => pickMedia()} className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-panel-border px-3 py-6 text-center text-ink-muted hover:border-brand-500 hover:text-ink">
                        <FolderPlus className="size-5" />
                        <span className="font-medium text-ink">Drop video, sound and images here</span>
                        <span>or click to choose files</span>
                    </button>
                )}
                <div className="grid grid-cols-2 gap-2">
                    {media.map((m) => (
                        <MediaCard
                            key={m.id}
                            media={m}
                            poster={m.poster ? imageSrc(doc.images, m.poster) : null}
                            selected={selection.includes(m.id)}
                            renaming={renaming === m.id}
                            onRename={(name) => {
                                setRenaming(null);
                                if (name && name !== m.name) renameMedia(m.id, name);
                            }}
                            onPick={(e) => pick(e, m.id)}
                            onStartRename={() => setRenaming(m.id)}
                            dragIds={selection.includes(m.id) ? selection : [m.id]}
                        />
                    ))}
                </div>
                {selection.length > 0 && (
                    <div className="mt-2 flex gap-1">
                        <button type="button" onClick={() => insertMedia(selection)} className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-panel-border hover:bg-panel-hover">
                            <Plus className="size-3" /> Add at playhead
                        </button>
                        <button type="button" aria-label="Remove from project" title="Remove from project (and its clips)" onClick={() => removeMedia(selection)} className="flex size-7 items-center justify-center rounded-md border border-panel-border text-ink-muted hover:bg-panel-hover hover:text-ink">
                            <Trash01 className="size-3.5" />
                        </button>
                    </div>
                )}
                <h3 className="mt-4 mb-1.5 font-semibold">Sequences</h3>
                <div className="space-y-0.5">
                    {[project.root, ...project.comps].map((c) => (
                        <button key={c.id} type="button" onClick={() => openComp(c.id)} className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left ${compId === c.id ? "bg-brand-500/15 text-ink" : "text-ink-muted hover:bg-panel-hover hover:text-ink"}`}>
                            <LayersThree01 className="size-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{c.id === ROOT ? "Sequence" : c.name}</span>
                            <span className="text-[10px] text-ink-subtle tabular-nums">{shortTime(compLength(c))}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

function MediaCard({ media, poster, selected, renaming, onRename, onPick, onStartRename, dragIds }: { media: VMedia; poster: string | null; selected: boolean; renaming: boolean; onRename: (name: string) => void; onPick: (e: React.MouseEvent) => void; onStartRename: () => void; dragIds: string[] }) {
    const Icon = KIND_ICON[media.kind];
    return (
        <div
            draggable={!renaming}
            onDragStart={(e) => {
                e.dataTransfer.setData(MEDIA_MIME, JSON.stringify(dragIds));
                e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={onPick}
            onDoubleClick={() => insertMedia([media.id])}
            title={`${media.name}\nDouble-click to add at the playhead, or drag to the timeline.`}
            data-media-id={media.id}
            className={`group cursor-grab overflow-hidden rounded-md border ${selected ? "border-brand-500 ring-1 ring-brand-500" : "border-panel-border hover:border-ink-subtle"}`}
        >
            <div className="relative aspect-video bg-black/60">
                {poster ? <img src={poster} alt="" draggable={false} className="size-full object-cover" /> : media.kind === "audio" ? <MiniWave peaks={media.peaks} /> : null}
                <span className="absolute top-1 left-1 flex size-4 items-center justify-center rounded bg-black/60 text-white">
                    <Icon className="size-2.5" />
                </span>
                {media.seconds > 0 && <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[9px] text-white tabular-nums">{shortTime(media.seconds)}</span>}
            </div>
            {renaming ? (
                <input autoFocus defaultValue={media.name} aria-label="Media name" onBlur={(e) => onRename(e.target.value.trim())} onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") onRename(media.name);
                }} className="w-full bg-field px-1.5 py-1 text-[10px] text-ink outline-none" />
            ) : (
                <div className="truncate px-1.5 py-1 text-[10px]" onDoubleClick={(e) => {
                    e.stopPropagation();
                    onStartRename();
                }}>
                    {media.name}
                </div>
            )}
        </div>
    );
}

function MiniWave({ peaks }: { peaks?: number[] }) {
    const d = useMemo(() => {
        const p = peaks ?? [];
        const n = 60;
        let path = "";
        for (let i = 0; i < n; i++) {
            const v = p[Math.floor((i / n) * p.length)] ?? 0;
            const h = Math.max(1, v * 40);
            path += `M${i * 2 + 1},${25 - h / 2}v${h}`;
        }
        return path;
    }, [peaks]);
    return (
        <svg viewBox="0 0 120 50" className="size-full" preserveAspectRatio="none" aria-hidden>
            <path d={d} stroke="#34D399" strokeWidth="1.2" />
        </svg>
    );
}

// ---- Library ----

function LibraryPanel() {
    const tab = useVideoUi((s) => s.libraryTab);
    const [query, setQuery] = useState("");
    const tabs: [typeof tab, string][] = [
        ["effects", "Effects"],
        ["transitions", "Transitions"],
        ["titles", "Titles"],
        ["motion", "Motion"],
        ["shapes", "Shapes"],
    ];
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap gap-0.5 px-2 pt-2">
                {tabs.map(([id, label]) => (
                    <Pill key={id} active={tab === id} onClick={() => vui.set({ libraryTab: id })}>
                        {label}
                    </Pill>
                ))}
            </div>
            <label className="m-2 flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-field px-2 text-ink-muted">
                <SearchSm className="size-3.5" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={`Search ${tab}`} aria-label="Search the library" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-subtle" />
            </label>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {tab === "effects" && <EffectsLibrary query={query} />}
                {tab === "transitions" && (
                    <Grouped
                        items={TRANSITIONS.filter((t) => t.label.toLowerCase().includes(query.toLowerCase())).map((t) => ({ id: t.id, label: t.label, group: t.group }))}
                        drag={(id) => ({ type: "transition", id })}
                        onUse={(id) => applyTransition(id as "dissolve")}
                        hint="Drag onto the start or end of a clip, or double-click for the cut nearest the playhead."
                    />
                )}
                {tab === "titles" && (
                    <Grouped items={TITLE_PRESETS.filter((t) => t.label.toLowerCase().includes(query.toLowerCase())).map((t) => ({ id: t.id, label: t.label, group: "Title styles" }))} drag={(id) => ({ type: "title", id })} onUse={(id) => addTitle(id)} hint="Double-click to add at the playhead, or drag to a track." />
                )}
                {tab === "motion" && (
                    <Grouped
                        items={MOTION_PRESETS.filter((t) => t.label.toLowerCase().includes(query.toLowerCase())).map((t) => ({ id: t.id, label: t.label, group: t.group === "In" ? "Animate in" : t.group === "Out" ? "Animate out" : t.group === "Loop" ? "Loops" : "Camera moves" }))}
                        drag={(id) => ({ type: "motion", id })}
                        onUse={(id) => applyMotionPreset(id)}
                        hint="Keyframes written onto the selected clip. Double-click, or drag onto a clip."
                    />
                )}
                {tab === "shapes" && <Grouped items={SHAPES.map((s) => ({ id: s.id, label: s.label, group: "Shapes" }))} drag={(id) => ({ type: "shape", id })} onUse={(id) => addShape(id as "rect")} hint="Shape layers you can animate. Double-click to add at the playhead." />}
            </div>
        </div>
    );
}

function Grouped({ items, drag, onUse, hint }: { items: { id: string; label: string; group: string }[]; drag: (id: string) => LibraryDrag; onUse: (id: string) => void; hint: string }) {
    const groups = [...new Set(items.map((i) => i.group))];
    return (
        <>
            <p className="mb-2 text-ink-subtle">{hint}</p>
            {groups.map((g) => (
                <div key={g} className="mb-2">
                    <h4 className="mb-1 text-[10px] font-semibold tracking-wide text-ink-subtle uppercase">{g}</h4>
                    {items.filter((i) => i.group === g).map((i) => <LibraryRow key={i.id} label={i.label} drag={drag(i.id)} onUse={() => onUse(i.id)} />)}
                </div>
            ))}
        </>
    );
}

function LibraryRow({ label, drag, onUse }: { label: string; drag: LibraryDrag; onUse: () => void }) {
    return (
        <div
            role="button"
            tabIndex={0}
            draggable
            onDragStart={(e) => {
                e.dataTransfer.setData(LIB_MIME, JSON.stringify(drag));
                e.dataTransfer.effectAllowed = "copy";
            }}
            onDoubleClick={onUse}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.stopPropagation();
                    onUse();
                }
            }}
            data-library-item={`${drag.type}:${drag.id}`}
            className="flex h-7 cursor-grab items-center gap-2 rounded-md px-2 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500"
        >
            <span className="size-1.5 shrink-0 rounded-full bg-brand-500/70" />
            <span className="truncate">{label}</span>
        </div>
    );
}

function EffectsLibrary({ query }: { query: string }) {
    const [list, setList] = useState<EffectSpecInfo[] | null>(null);
    const [open, setOpen] = useState<Set<string>>(new Set(["Blur & Sharpen", "Color Correction", "Stylize"]));
    useEffect(() => {
        let live = true;
        void effectCatalog()
            .then((l) => live && setList(usableEffects(l)))
            .catch(() => live && setList([]));
        return () => {
            live = false;
        };
    }, []);
    if (!list) return <p className="text-ink-muted">Loading effects…</p>;
    const q = query.toLowerCase();
    const shown = list.filter((e) => e.name.toLowerCase().includes(q));
    const cats = [...new Set(shown.map((e) => e.category))];
    return (
        <>
            <p className="mb-2 text-ink-subtle">{list.length} effects. Drag onto a clip, or double-click to add to the selected clips.</p>
            {cats.map((cat) => {
                const expanded = q.length > 0 || open.has(cat);
                return (
                    <div key={cat} className="mb-1">
                        <button type="button" onClick={() => setOpen((o) => {
                            const n = new Set(o);
                            if (n.has(cat)) n.delete(cat);
                            else n.add(cat);
                            return n;
                        })} className="flex h-6 w-full items-center gap-1 text-left text-[10px] font-semibold tracking-wide text-ink-subtle uppercase hover:text-ink">
                            <span className={`inline-block transition-transform ${expanded ? "rotate-90" : ""}`}>›</span> {cat === "Color Correction" ? "Color" : cat} <span className="font-normal">({shown.filter((e) => e.category === cat).length})</span>
                        </button>
                        {expanded && shown.filter((e) => e.category === cat).map((e) => <LibraryRow key={e.id} label={e.name} drag={{ type: "effect", id: e.id }} onUse={() => void addEffect(e.id)} />)}
                    </div>
                );
            })}
        </>
    );
}

function ColorMatteIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <path d="M2 10l3.5-3 3 2.5L11 7l3 3" strokeLinejoin="round" />
        </svg>
    );
}

function AdjustIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 2.5v11A5.5 5.5 0 008 2.5z" fill="currentColor" />
        </svg>
    );
}
