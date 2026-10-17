import { X } from "@untitledui/icons";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { Select } from "../components/select";
import { listFiles, loadFileDocument } from "../engine/files";
import { editor, useEditor } from "../engine/store";
import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import { addUploadedImages, guessMapping, parseDelimited, previewRows, readTableFile, runBulk, type ImagePool, type Table } from "./bulk";
import { exportCampaign, isMoving, isVideoFormat, type AssetExportChoice, type CampaignFormat, type ColorProfile } from "./export";
import { AssetThumb } from "./left-panel";
import { RequestReviewForm, unapproved, useReviews } from "./reviews";
import { PublishTemplates } from "./template-library";
import { SIZE_PRESETS, addBlankAsset, addStarterTemplate, assetOf, assetsOf, fieldsOf, importFramesAsTemplates, inRow, layerData, pageData, presetFor, templatesOf } from "./model";
import { resizeAsset } from "./resize";
import { campaign, useCampaign } from "./state";

// The campaign's dialogs: adding assets and templates, importing frames from a design file as
// templates, bulk create from a spreadsheet, Resize to…, and Export.

const input = "h-7 rounded-md border border-panel-border bg-panel px-2 text-[11.5px] text-ink outline-none focus:border-brand-500";
const primary = "h-8 rounded-md bg-brand-500 px-3 text-[12px] font-semibold text-white outline-none hover:bg-brand-600 disabled:opacity-40";
const secondary = "h-8 rounded-md border border-panel-border px-3 text-[12px] text-ink outline-none hover:bg-panel-hover disabled:opacity-40";
const close = () => campaign.set({ dialog: null });

function Shell({ title, width = 560, children, footer }: { title: string; width?: number; children: ReactNode; footer?: ReactNode }) {
    return (
        <AriaModalOverlay isOpen onOpenChange={(open) => !open && close()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-16">
            <AriaModal style={{ width }} className="max-h-[calc(100vh-96px)] overflow-hidden rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                <AriaDialog aria-label={title} className="flex max-h-[calc(100vh-96px)] flex-col outline-none">
                    <div className="flex h-11 shrink-0 items-center justify-between border-b border-panel-border px-4">
                        <h2 className="text-[13px] font-semibold">{title}</h2>
                        <button type="button" aria-label="Close" onClick={close} className="rounded p-1 text-ink-muted hover:bg-panel-hover">
                            <X className="size-4" />
                        </button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-[11.5px]">{children}</div>
                    {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-panel-border px-4 py-3">{footer}</div>}
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

function RowPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
    const rows = useEditor((s) => pageData(s.doc).rows);
    return (
        <Select aria-label="Row" value={value} onChange={(e) => onChange(e.target.value)} className={`${input} w-48`}>
            {rows.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
            ))}
            <option value="new">New row</option>
        </Select>
    );
}


function AddDialog({ rowId: initialRow }: { rowId?: string }) {
    const rows = useEditor((s) => pageData(s.doc).rows);
    const [rowId, setRowId] = useState(initialRow ?? rows[rows.length - 1]?.id ?? "new");
    const [preset, setPreset] = useState("square");
    const [custom, setCustom] = useState({ w: 1000, h: 1000 });
    const [busy, setBusy] = useState(false);
    const size = preset === "custom" ? custom : presetFor(preset);
    return (
        <Shell
            title="Add to campaign"
            footer={
                <>
                    <button type="button" className={secondary} onClick={() => campaign.set({ dialog: { kind: "import" } })}>From a design file…</button>
                    <button type="button" className={secondary} onClick={() => (void inRow(rowId, (row) => addBlankAsset(preset, row, preset === "custom" ? custom : undefined)), close())}>Blank asset</button>
                    <button
                        type="button"
                        className={primary}
                        disabled={busy || preset === "custom"}
                        onClick={() => {
                            setBusy(true);
                            void inRow(rowId, (row) => addStarterTemplate(row, preset)).finally(() => {
                                setBusy(false);
                                close();
                            });
                        }}
                    >
                        Starter template
                    </button>
                </>
            }
        >
            <div className="mb-3 flex items-center gap-2">
                <span className="w-10 text-ink-muted">Row</span>
                <RowPicker value={rowId} onChange={setRowId} />
            </div>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Size">
                {SIZE_PRESETS.map((p) => {
                    const k = 56 / Math.max(p.w, p.h);
                    return (
                        <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} onClick={() => setPreset(p.id)} className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 ${preset === p.id ? "border-brand-500 bg-brand-100/40" : "border-panel-border hover:bg-panel-hover"}`}>
                            <span className="flex h-14 items-center">
                                <span className="rounded-sm border border-ink-subtle bg-canvas" style={{ width: p.w * k, height: p.h * k }} />
                            </span>
                            <span className="font-medium">{p.label}</span>
                            <span className="text-ink-subtle">{p.w} × {p.h}</span>
                        </button>
                    );
                })}
                <button type="button" role="radio" aria-checked={preset === "custom"} onClick={() => setPreset("custom")} className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border p-2 ${preset === "custom" ? "border-brand-500 bg-brand-100/40" : "border-panel-border hover:bg-panel-hover"}`}>
                    <span className="font-medium">Custom</span>
                    <span className="flex items-center gap-1">
                        <input aria-label="Width" type="number" min={16} max={8000} value={custom.w} onChange={(e) => setCustom({ ...custom, w: Math.max(16, Number(e.target.value) || 16) })} className={`${input} w-16`} />
                        ×
                        <input aria-label="Height" type="number" min={16} max={8000} value={custom.h} onChange={(e) => setCustom({ ...custom, h: Math.max(16, Number(e.target.value) || 16) })} className={`${input} w-16`} />
                    </span>
                </button>
            </div>
            <p className="mt-3 text-ink-subtle">
                {size ? `${size.w} × ${size.h}. ` : ""}The starter template has a photo, headline, subhead, logo and button, with the photo, text and button colour open to editors and the rest locked.
            </p>
        </Shell>
    );
}

function ImportDialog() {
    const files = useMemo(() => listFiles().filter((f) => f.kind === "design" && !f.trashed && !f.shared), []);
    const [fileId, setFileId] = useState(files[0]?.id ?? "");
    const [source, setSource] = useState<NagmaDocument | null>(null);
    const [chosen, setChosen] = useState<Set<string>>(new Set());
    const rows = useEditor((s) => pageData(s.doc).rows);
    const [rowId, setRowId] = useState(rows[rows.length - 1]?.id ?? "new");
    useEffect(() => {
        let live = true;
        if (fileId) void loadFileDocument(fileId).then((doc) => live && setSource(doc));
        return () => {
            live = false;
        };
    }, [fileId]);
    const frames: SceneNode[] = source
        ? source.roots.flatMap((pid) => (source.nodes[pid]?.internal ? [] : (source.nodes[pid]?.children ?? []).map((id) => source.nodes[id]).filter((n): n is SceneNode => Boolean(n && (n.type === "frame" || n.type === "component") && !n.isSection))))
        : [];
    return (
        <Shell
            title="Templates from a design file"
            footer={
                <button
                    type="button"
                    className={primary}
                    disabled={!source || !chosen.size}
                    onClick={() => {
                        if (!source) return;
                        let n = 0;
                        void inRow(rowId, (row) => (n = importFramesAsTemplates(source, [...chosen], row) ?? 0));
                        editor.notify(`Added ${n} template${n === 1 ? "" : "s"}. Their text and images are editable; lock what should stay in Design mode.`);
                        close();
                    }}
                >
                    Add {chosen.size || ""} as templates
                </button>
            }
        >
            {files.length === 0 ? (
                <p className="text-ink-muted">No design files in this browser yet.</p>
            ) : (
                <>
                    <div className="mb-3 flex items-center gap-2">
                        <span className="w-10 text-ink-muted">File</span>
                        <Select aria-label="Design file" value={fileId} onChange={(e) => (setSource(null), setChosen(new Set()), setFileId(e.target.value))} className={`${input} w-64`}>
                            {files.map((f) => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </Select>
                        <span className="ml-2 text-ink-muted">Row</span>
                        <RowPicker value={rowId} onChange={setRowId} />
                    </div>
                    {!source ? <p className="text-ink-muted">Loading…</p> : frames.length === 0 ? <p className="text-ink-muted">That file has no frames.</p> : null}
                    <div className="grid max-h-80 grid-cols-2 gap-1 overflow-y-auto">
                        {frames.map((f) => (
                            <label key={f.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-panel-hover">
                                <input
                                    type="checkbox"
                                    checked={chosen.has(f.id)}
                                    onChange={(e) => {
                                        const next = new Set(chosen);
                                        if (e.target.checked) next.add(f.id);
                                        else next.delete(f.id);
                                        setChosen(next);
                                    }}
                                    className="accent-brand-500"
                                />
                                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                                <span className="text-ink-subtle">{Math.round(f.w)} × {Math.round(f.h)}</span>
                            </label>
                        ))}
                    </div>
                </>
            )}
        </Shell>
    );
}

function BulkDialog({ templateId: initialTemplate, rowId }: { templateId?: string; rowId?: string }) {
    const doc = useEditor((s) => s.doc);
    const templates = templatesOf(doc);
    const existing = rowId ? pageData(doc).rows.find((r) => r.id === rowId)?.bulk : null;
    const [templateId, setTemplateId] = useState(existing?.templateId ?? initialTemplate ?? templates[0]?.id ?? "");
    const [text, setText] = useState("");
    const [table, setTable] = useState<Table | null>(existing ? { columns: existing.columns, rows: existing.rows } : null);
    const [mapping, setMapping] = useState<Record<string, string>>(existing?.mapping ?? {});
    const [nameColumn, setNameColumn] = useState<string>(existing?.nameColumn ?? "");
    const [rowName, setRowName] = useState("");
    const [pool] = useState<ImagePool>(() => new Map());
    const [pending, setPending] = useState<Command[]>([]);
    const [imageNames, setImageNames] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fields = fieldsOf(doc, templateId).flatMap((n) => {
        const d = layerData(n);
        return d ? [d] : [];
    });
    const fieldNames = fields.map((f) => f.field);
    const fieldKey = fieldNames.join("|");
    const adopt = (next: Table) => {
        setTable(next);
        setMapping(guessMapping(fieldNames, next.columns));
        setNameColumn(next.columns[0] ?? "");
    };
    // A different template keeps the data but guesses the mapping again.
    useEffect(() => {
        if (table && !existing) setMapping(guessMapping(fieldKey.split("|"), table.columns));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fieldKey]);
    const loadFile = () => {
        const el = document.createElement("input");
        el.type = "file";
        el.accept = ".csv,.tsv,.txt,.xlsx";
        el.onchange = () => {
            const file = el.files?.[0];
            if (!file) return;
            setError(null);
            void readTableFile(file)
                .then((t) => {
                    adopt(t);
                    setRowName(file.name.replace(/\.[^.]+$/, ""));
                })
                .catch((e) => setError(e instanceof Error ? e.message : String(e)));
        };
        el.click();
    };
    const loadImages = () => {
        const el = document.createElement("input");
        el.type = "file";
        el.accept = "image/*";
        el.multiple = true;
        el.onchange = () => {
            const files = [...(el.files ?? [])];
            const more: Command[] = [];
            void addUploadedImages(files, pool, more).then(() => {
                setPending((p) => [...p, ...more]);
                setImageNames((n) => [...n, ...files.map((f) => f.name)]);
            });
        };
        el.click();
    };
    const source = table && templateId ? { templateId, columns: table.columns, rows: table.rows, mapping, nameColumn: nameColumn || null } : null;
    const preview = source ? previewRows(source, fieldNames) : [];
    const mapped = fieldNames.filter((f) => mapping[f]).length;
    const run = () => {
        if (!source) return;
        setBusy(true);
        setError(null);
        void runBulk(source, { rowId: rowId ?? null, rowName, extraImages: pending, pool })
            .then((r) => {
                const parts = [r.created && `created ${r.created}`, r.updated && `updated ${r.updated}`, r.removed && `removed ${r.removed}`].filter(Boolean).join(", ");
                editor.notify(`Bulk create: ${parts || "nothing changed"}.${r.failedImages.length ? ` ${r.failedImages.length} image${r.failedImages.length === 1 ? "" : "s"} couldn't be found.` : ""}`);
                close();
            })
            .catch((e) => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => setBusy(false));
    };
    return (
        <Shell
            title={existing ? "Update from data" : "Bulk create"}
            width={720}
            footer={
                <>
                    {error && <span className="mr-auto text-[11.5px] text-red-500">{error}</span>}
                    <button type="button" className={primary} disabled={!source || !source.rows.length || !mapped || busy} onClick={run}>
                        {busy ? "Working…" : existing ? `Update ${source?.rows.length ?? 0} assets` : `Create ${source?.rows.length ?? 0} assets`}
                    </button>
                </>
            }
        >
            {templates.length === 0 ? (
                <p className="text-ink-muted">Bulk create makes assets from a template. Add a template first (Add asset or template, then Starter template or From a design file).</p>
            ) : (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="w-16 text-ink-muted">Template</span>
                        <Select aria-label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={`${input} w-64`}>
                            {templates.map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </Select>
                        {!existing && (
                            <>
                                <span className="ml-2 text-ink-muted">New row</span>
                                <input aria-label="New row name" placeholder="Row name" value={rowName} onChange={(e) => setRowName(e.target.value)} className={`${input} w-40`} />
                            </>
                        )}
                    </div>
                    <div>
                        <div className="mb-1 flex items-center gap-2">
                            <span className="font-semibold">Data</span>
                            <span className="text-ink-subtle">Paste CSV or tab-separated rows (first row is the header), or load a .csv or .xlsx file.</span>
                        </div>
                        <textarea
                            aria-label="Paste data"
                            value={text}
                            placeholder={"Headline,Subhead,Photo\nSpring sale,20% off everything,https://…/photo.jpg"}
                            onChange={(e) => {
                                setText(e.target.value);
                                if (e.target.value.trim()) adopt(parseDelimited(e.target.value));
                            }}
                            rows={4}
                            className="w-full rounded-md border border-panel-border bg-canvas px-2 py-1.5 font-mono text-[11px] text-ink outline-none focus:border-brand-500"
                        />
                        <div className="mt-1.5 flex items-center gap-2">
                            <button type="button" className={secondary} onClick={loadFile}>Load file…</button>
                            <button type="button" className={secondary} onClick={loadImages}>Add images…</button>
                            <span className="text-ink-subtle">
                                {table ? `${table.rows.length} rows, ${table.columns.length} columns.` : ""} {imageNames.length ? `${imageNames.length} images ready (matched by file name).` : "Image cells can be URLs or names of images you add."}
                            </span>
                        </div>
                    </div>
                    {table && (
                        <div>
                            <div className="mb-1 font-semibold">Map columns to fields</div>
                            <div className="grid grid-cols-[140px_1fr] items-center gap-x-3 gap-y-1.5">
                                {fields.map((f) => (
                                    <div key={f.field} className="contents">
                                        <span className="truncate">{f.field} <span className="text-ink-subtle">({f.type === "color" ? "colour" : f.type})</span></span>
                                        <Select aria-label={`Column for ${f.field}`} value={mapping[f.field] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.field]: e.target.value })} className={`${input} w-56`}>
                                            <option value="">Not mapped (keep template)</option>
                                            {table.columns.map((c) => (
                                                <option key={c} value={c}>{c}</option>
                                            ))}
                                        </Select>
                                    </div>
                                ))}
                                <span className="text-ink-muted">Asset names from</span>
                                <Select aria-label="Name column" value={nameColumn} onChange={(e) => setNameColumn(e.target.value)} className={`${input} w-56`}>
                                    <option value="">Numbered</option>
                                    {table.columns.map((c) => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </Select>
                            </div>
                        </div>
                    )}
                    {table && preview.length > 0 && (
                        <div>
                            <div className="mb-1 font-semibold">Preview <span className="font-normal text-ink-subtle">{preview.length < table.rows.length ? `first ${preview.length} of ${table.rows.length}` : ""}</span></div>
                            <div className="overflow-x-auto rounded-md border border-panel-border">
                                <table className="w-full text-left text-[11px]" aria-label="Mapping preview">
                                    <thead>
                                        <tr className="bg-panel-hover">
                                            <th className="px-2 py-1 font-medium">#</th>
                                            {fieldNames.map((f) => (
                                                <th key={f} className="px-2 py-1 font-medium">{f}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {preview.map((cells, i) => (
                                            <tr key={i} className="border-t border-panel-border">
                                                <td className="px-2 py-1 text-ink-subtle">{i + 1}</td>
                                                {cells.map((c, j) => (
                                                    <td key={j} className={`max-w-40 truncate px-2 py-1 ${mapping[fieldNames[j] ?? ""] ? "" : "text-ink-subtle"}`}>{mapping[fieldNames[j] ?? ""] ? c || "(empty, keeps template)" : "template"}</td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </Shell>
    );
}

function ResizeDialog({ assetId }: { assetId: string }) {
    const asset = useEditor((s) => s.doc.nodes[assetId]);
    const [chosen, setChosen] = useState<Set<string>>(new Set());
    const [custom, setCustom] = useState({ on: false, w: 1000, h: 500 });
    if (!asset) return null;
    const options = SIZE_PRESETS.filter((p) => p.w !== asset.w || p.h !== asset.h);
    const count = chosen.size + (custom.on ? 1 : 0);
    return (
        <Shell
            title={`Resize ${asset.name} to…`}
            width={460}
            footer={
                <button
                    type="button"
                    className={primary}
                    disabled={!count}
                    onClick={() => {
                        const targets = options.filter((p) => chosen.has(p.id)).map((p) => ({ presetId: p.id, w: p.w, h: p.h }));
                        if (custom.on) targets.push({ presetId: "custom", w: custom.w, h: custom.h });
                        resizeAsset(assetId, targets);
                        editor.notify(`Made ${targets.length} resized cop${targets.length === 1 ? "y" : "ies"}.`);
                        close();
                    }}
                >
                    Create {count || ""} {count === 1 ? "copy" : "copies"}
                </button>
            }
        >
            <p className="mb-3 text-ink-muted">Copies go next to this asset in its row. Layers reflow with the template's auto layout and constraints; type and spacing scale with the shorter side.</p>
            <div className="space-y-0.5">
                {options.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-panel-hover">
                        <input
                            type="checkbox"
                            aria-label={p.label}
                            checked={chosen.has(p.id)}
                            onChange={(e) => {
                                const next = new Set(chosen);
                                if (e.target.checked) next.add(p.id);
                                else next.delete(p.id);
                                setChosen(next);
                            }}
                            className="accent-brand-500"
                        />
                        <span className="flex-1">{p.label}</span>
                        <span className="text-ink-subtle">{p.w} × {p.h}</span>
                    </label>
                ))}
                <label className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-panel-hover">
                    <input type="checkbox" aria-label="Custom size" checked={custom.on} onChange={(e) => setCustom({ ...custom, on: e.target.checked })} className="accent-brand-500" />
                    <span className="flex-1">Custom</span>
                    <input aria-label="Custom width" type="number" value={custom.w} onChange={(e) => setCustom({ ...custom, on: true, w: Math.max(16, Number(e.target.value) || 16) })} className={`${input} w-16`} />×
                    <input aria-label="Custom height" type="number" value={custom.h} onChange={(e) => setCustom({ ...custom, on: true, h: Math.max(16, Number(e.target.value) || 16) })} className={`${input} w-16`} />
                </label>
            </div>
        </Shell>
    );
}

const FORMATS: { id: CampaignFormat; label: string }[] = [
    { id: "png", label: "PNG" },
    { id: "jpg", label: "JPG" },
    { id: "pdf", label: "PDF" },
    { id: "mp4", label: "MP4 (video)" },
    { id: "webm", label: "WebM (video)" },
];

// File type and size for every asset (the defaults) or for one asset picked under the preview.
const FIELD_LABEL = "mb-2 block h-4 text-[11px] leading-4 font-medium text-ink";
const OUTLINED = "h-6 w-full rounded-[5px] border border-panel-border bg-transparent px-2 text-[11px] text-ink";
function ExportChoice({ value, onChange, moving, label }: { value: AssetExportChoice; onChange: (next: AssetExportChoice) => void; moving: boolean; label: string }) {
    return (
        <>
            <div>
                <span className={FIELD_LABEL}>File type</span>
                <Select aria-label={`${label} format`} value={value.format} onChange={(e) => onChange({ ...value, format: e.target.value as CampaignFormat })} className={OUTLINED}>
                    {FORMATS.map((f) => (
                        <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                </Select>
            </div>
            <div className="mt-3">
                <span className={FIELD_LABEL}>Size</span>
                <Select aria-label={`${label} size`} value={String(value.scale)} onChange={(e) => onChange({ ...value, scale: Number(e.target.value) })} className={OUTLINED}>
                    {[0.5, 1, 1.5, 2, 3, 4].map((s) => (
                        <option key={s} value={String(s)}>{s}x</option>
                    ))}
                </Select>
            </div>
            {isVideoFormat(value.format) && !moving && <p className="mt-2 text-[11px] text-ink-subtle">Without a video or motion in it, this goes out as a PNG.</p>}
        </>
    );
}

// Export: a 685×501 dialog in the middle of the window. A preview of the asset on the left (with
// the other assets in a strip under it when there are several, each pickable for its own settings);
// File type, Size and Color profile on the right; Export at the bottom right.
function ExportDialog({ ids, all: everything }: { ids?: string[]; all?: boolean }) {
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    useReviews();
    const selected = [...new Set((ids ?? selection).map((id) => assetOf(doc, id)?.id).filter((id): id is string => Boolean(id)))];
    const all = assetsOf(doc).map((a) => a.id);
    const [scope, setScope] = useState<"selected" | "all">(selected.length && !everything ? "selected" : "all");
    const [defaults, setDefaults] = useState<AssetExportChoice>({ format: "png", scale: 1 });
    const [overrides, setOverrides] = useState<Record<string, AssetExportChoice>>({});
    const [focus, setFocus] = useState<string | null>(null);
    const [profile, setProfile] = useState<ColorProfile>("document");
    const [own, setOwn] = useState(true);
    const [progress, setProgress] = useState<string | null>(null);
    const chosen = scope === "selected" ? selected : all;
    const blocked = new Set(unapproved(doc, chosen));
    const going = chosen.filter((id) => !blocked.has(id));
    const withSettings = chosen.filter((id) => doc.nodes[id]?.exportSettings?.length).length;
    const focused = focus && chosen.includes(focus) ? doc.nodes[focus] : undefined;
    const shown = focused ?? (chosen[0] ? doc.nodes[chosen[0]] : undefined);
    const several = chosen.length > 1;
    const run = () => {
        setProgress("Starting…");
        void exportCampaign(editor.get().doc, { ids: going, format: defaults.format, scale: defaults.scale, colorProfile: profile, useAssetSettings: own, overrides }, (done, total) => setProgress(`Rendering ${done} of ${total}…`))
            .then((r) => {
                editor.notify(r.files || r.videos ? `Exported ${r.files} file${r.files === 1 ? "" : "s"}${r.files > 1 ? " as a zip" : ""}${r.videos ? `, ${r.videos} of them video` : ""}.` : "Nothing to export.");
                close();
            })
            .catch((e) => setProgress(`Export failed: ${e instanceof Error ? e.message : String(e)}`));
    };
    const tile = (on: boolean) => `relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-panel outline-none ${on ? "ring-2 ring-brand-500" : "ring-1 ring-panel-border hover:ring-ink-subtle"}`;
    return (
        <AriaModalOverlay isOpen onOpenChange={(open) => !open && close()} isDismissable className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <AriaModal className="flex h-[501px] max-h-[calc(100vh-32px)] w-[685px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[13px] bg-panel-raised text-ink shadow-[0_0_0_0.5px_rgba(0,0,0,0.4),0_10px_32px_rgba(0,0,0,0.4)] outline-none">
                <AriaDialog aria-label="Export" className="flex min-h-0 w-full flex-col outline-none">
                    <div className="flex h-10 shrink-0 items-center justify-between border-b border-panel-border pr-2 pl-4">
                        <h2 className="text-[13px] font-semibold">Export</h2>
                        <button type="button" aria-label="Close" onClick={close} className="flex size-6 items-center justify-center rounded-[5px] text-ink hover:bg-panel-hover">
                            <X className="size-4" />
                        </button>
                    </div>
                    <div className="flex min-h-0 flex-1">
                        <div aria-label="Preview" className="relative flex min-w-0 flex-1 flex-col bg-field">
                            <div className="flex min-h-0 flex-1 items-center justify-center p-4">{shown ? <AssetThumb key={shown.id} id={shown.id} width={385} height={several ? 320 : 385} className="max-h-full max-w-full" /> : <span className="text-[11px] text-ink-muted">Nothing to export.</span>}</div>
                            {several && (
                                <div role="listbox" aria-label="Assets to export" className="flex shrink-0 gap-2 overflow-x-auto px-4 pt-1 pb-4">
                                    <button type="button" role="option" aria-selected={focus === null} title="Every asset" onClick={() => setFocus(null)} className={`${tile(focus === null)} text-[10px] text-ink`}>
                                        All
                                    </button>
                                    {chosen.map((id) => {
                                        const node = doc.nodes[id];
                                        if (!node) return null;
                                        return (
                                            <button key={id} type="button" role="option" aria-selected={focus === id} title={`${node.name}${blocked.has(id) ? " (not approved)" : overrides[id] ? ` (${overrides[id].format.toUpperCase()} ${overrides[id].scale}x)` : ""}`} onClick={() => setFocus(id)} className={`${tile(focus === id)} ${blocked.has(id) ? "opacity-40" : ""}`}>
                                                <AssetThumb id={id} width={36} height={36} />
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="flex w-[268px] shrink-0 flex-col overflow-y-auto border-l border-panel-border pt-4 pr-3 pb-4 pl-4">
                            {focused && (
                                <div className="mb-3 flex h-4 items-center justify-between text-[11px]">
                                    <span className="truncate font-semibold">{focused.name}</span>
                                    {overrides[focused.id] && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = { ...overrides };
                                                delete next[focused.id];
                                                setOverrides(next);
                                            }}
                                            className="shrink-0 text-brand-500 hover:underline"
                                        >
                                            Use the defaults
                                        </button>
                                    )}
                                </div>
                            )}
                            {focused ? (
                                <ExportChoice label={focused.name} value={overrides[focused.id] ?? defaults} moving={isMoving(doc, focused.id)} onChange={(next) => setOverrides({ ...overrides, [focused.id]: next })} />
                            ) : (
                                <ExportChoice label="Export" value={defaults} moving={chosen.some((id) => isMoving(doc, id))} onChange={setDefaults} />
                            )}
                            <div className="mt-3">
                                <span className={FIELD_LABEL}>Color profile</span>
                                <Select aria-label="Colour profile" value={profile} onChange={(e) => setProfile(e.target.value as ColorProfile)} className={OUTLINED}>
                                    <option value="document">Same as the file</option>
                                    <option value="srgb">sRGB</option>
                                    <option value="p3">Display P3</option>
                                </Select>
                            </div>
                            {/* Which assets go, and each asset's own settings: below the reference's three fields. */}
                            {(selected.length > 0 && selected.length < all.length) || all.length > 1 ? (
                                <div className="mt-3">
                                    <span className={FIELD_LABEL}>Assets</span>
                                    <Select aria-label="Which assets" value={scope} onChange={(e) => setScope(e.target.value as "selected" | "all")} className={OUTLINED}>
                                        {selected.length > 0 && <option value="selected">{`Selected (${selected.length})`}</option>}
                                        <option value="all">{`All (${all.length})`}</option>
                                    </Select>
                                </div>
                            ) : null}
                            {focused ? (
                                <button
                                    type="button"
                                    className="mt-3 h-6 rounded-[5px] border border-panel-border px-2 text-[11px] text-ink outline-none hover:bg-panel-hover disabled:opacity-40"
                                    disabled={isVideoFormat((overrides[focused.id] ?? defaults).format)}
                                    onClick={() => {
                                        const c = overrides[focused.id] ?? defaults;
                                        if (isVideoFormat(c.format)) return;
                                        editor.execute({ type: "node.update", id: focused.id, patch: { exportSettings: [{ format: c.format as "png" | "jpg" | "pdf", scale: c.scale, suffix: "", contentsOnly: true, colorProfile: profile }] } });
                                        editor.notify(`Saved as ${focused.name}'s own export settings.`);
                                    }}
                                >
                                    Save as this asset's settings
                                </button>
                            ) : (
                                withSettings > 0 && (
                                    <label className="mt-3 flex items-center gap-2 text-[11px]">
                                        <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} className="accent-brand-500" />
                                        Use each asset's own export settings ({withSettings})
                                    </label>
                                )
                            )}
                            {several && <p className="mt-auto pt-3 text-[11px] text-ink-subtle">Several files download as one zip with a folder per row. Pick an asset under the preview to give it its own file type and size.</p>}
                        </div>
                    </div>
                    <div className="flex h-10 shrink-0 items-center justify-end gap-2 border-t border-panel-border pr-2 pl-4 text-[11px]">
                        {progress ? <span className="mr-auto truncate text-ink-muted">{progress}</span> : blocked.size > 0 && <span className="mr-auto truncate text-ink-muted">{blocked.size} asset{blocked.size === 1 ? " isn't" : "s aren't"} approved yet and stay{blocked.size === 1 ? "s" : ""} out.</span>}
                        <button type="button" className="h-6 rounded-[5px] bg-brand-500 px-2 text-[11px] font-medium text-white outline-none hover:bg-brand-600 disabled:opacity-40" disabled={!going.length || (progress !== null && !progress.startsWith("Export failed"))} onClick={run}>
                            {going.length === 1 ? "Export asset" : `Export ${going.length} assets`}
                        </button>
                    </div>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

function ReviewDialog({ ids }: { ids: string[] }) {
    const doc = useEditor((s) => s.doc);
    const names = ids.map((id) => doc.nodes[id]?.name).filter(Boolean);
    return (
        <Shell title="Request review" width={460}>
            <p className="mb-3 text-ink-muted">{names.length === 1 ? `Ask people to approve "${names[0]}".` : `Ask people to approve ${names.length} assets.`} They'll find it in their notifications and the Reviews panel.</p>
            <RequestReviewForm ids={ids} onDone={close} />
        </Shell>
    );
}

export function CampaignDialogs() {
    const dialog = useCampaign((s) => s.dialog);
    if (!dialog) return null;
    switch (dialog.kind) {
        case "add":
            return <AddDialog rowId={dialog.rowId} />;
        case "import":
            return <ImportDialog />;
        case "bulk":
            return <BulkDialog templateId={dialog.templateId} rowId={dialog.rowId} />;
        case "resize":
            return <ResizeDialog assetId={dialog.assetId} />;
        case "export":
            return <ExportDialog ids={dialog.ids} all={dialog.all} />;
        case "review":
            return <ReviewDialog ids={dialog.ids} />;
        case "publish":
            return (
                <Shell title="Publish templates" width={560}>
                    <PublishTemplates onDone={close} />
                </Shell>
            );
    }
}
