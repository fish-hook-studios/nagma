import { useEditor, editor } from "../engine/store";
import { Select } from "../components/select";
import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import { LOCKED, assetData, assetOf, fieldKindFor, fieldsOf, layerData, pageData, moveAssetToRow, presetFor, setLayerField, setTemplate, SIZE_PRESETS } from "./model";
import { resizeInPlace } from "./resize";
import type { FieldKind, LayerLocks } from "./types";

// Design mode's template controls (in the floating toolbar's menus, and above the full properties
// panel): for an asset, whether it's a template, its size and row; for a layer inside one, whether
// it's an editable field and what stays locked.

const card = "shrink-0 border-b border-l border-panel-border bg-panel px-3 py-3 text-[11px] text-ink";
const bareCard = "w-64 px-3 py-3 text-[11px] text-ink";
const field = "h-7 w-full rounded-md border border-panel-border bg-panel px-2 text-[11px] text-ink outline-none focus:border-brand-500";

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (on: boolean) => void; hint?: string }) {
    return (
        <label className="flex cursor-default items-start gap-2 py-0.5" title={hint}>
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-brand-500" />
            <span>{label}</span>
        </label>
    );
}

export function AssetCard({ asset, bare }: { asset: SceneNode; bare?: boolean }) {
    const doc = useEditor((s) => s.doc);
    const data = assetData(asset);
    if (!data) return null;
    const fields = fieldsOf(doc, asset.id);
    const preset = presetFor(data.preset);
    const sized = preset && preset.w === asset.w && preset.h === asset.h ? preset.id : "custom";
    const openAllText = () => {
        const texts: SceneNode[] = [];
        const visit = (id: string) => {
            const n = doc.nodes[id];
            if (!n) return;
            if (n.type === "text" && !layerData(n)) texts.push(n);
            for (const c of n.children) visit(c);
        };
        visit(asset.id);
        if (!texts.length) return editor.notify("Every text layer here is already a field.");
        editor.execute({
            type: "batch",
            commands: texts.map((n) => ({ type: "node.update" as const, id: n.id, patch: { campaign: { kind: "layer" as const, field: n.name, type: "text" as const, locks: { ...LOCKED, content: false } } } })),
        });
    };
    return (
        <section className={bare ? bareCard : card} aria-label="Asset">
            <div className="mb-2 font-semibold">Asset</div>
            <Check label="Use as a template" checked={Boolean(data.template)} onChange={(on) => setTemplate(asset.id, on)} hint="Templates are what bulk create and variants are made from." />
            <div className="mt-2 grid grid-cols-[52px_1fr] items-center gap-x-2 gap-y-1.5">
                <span className="text-ink-muted">Size</span>
                <Select aria-label="Asset size" value={sized} onChange={(e) => e.target.value !== "custom" && resizeInPlace(asset.id, e.target.value)} className={field}>
                    {SIZE_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>{`${p.label} ${p.w} × ${p.h}`}</option>
                    ))}
                    <option value="custom">{`Custom ${Math.round(asset.w)} × ${Math.round(asset.h)}`}</option>
                </Select>
                <span className="text-ink-muted">Row</span>
                <Select aria-label="Asset row" value={data.rowId} onChange={(e) => moveAssetToRow(asset.id, e.target.value)} className={field}>
                    {pageData(doc).rows.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                </Select>
            </div>
            <p className="mt-2 text-ink-subtle">
                {fields.length ? `${fields.length} field${fields.length === 1 ? "" : "s"}: ${fields.map((f) => layerData(f)?.field).join(", ")}.` : "No fields yet. Select a layer inside to open it up for editing."}
            </p>
            <button type="button" onClick={openAllText} className="mt-2 h-7 w-full rounded-md border border-panel-border hover:bg-panel-hover">
                Make all text editable
            </button>
            <button type="button" onClick={() => removeGuidelines(doc, asset)} title="Every layer becomes a field editors may change, move and recolour" className="mt-1.5 h-7 w-full rounded-md border border-panel-border hover:bg-panel-hover">
                Remove guidelines
            </button>
        </section>
    );
}

// Remove guidelines: nothing on the asset stays locked; every layer is a field with no locks.
function removeGuidelines(doc: NagmaDocument, asset: SceneNode) {
    const commands: Command[] = [];
    const visit = (id: string) => {
        const n = doc.nodes[id];
        if (!n) return;
        const data = layerData(n);
        const free = { content: false, position: false, style: false };
        commands.push({ type: "node.update", id: n.id, patch: { campaign: data ? { ...data, locks: free, brandOnly: false } : { kind: "layer", field: n.name, type: fieldKindFor(n), locks: free } } });
        for (const c of n.children) visit(c);
    };
    for (const c of asset.children) visit(c);
    if (!commands.length) return;
    editor.execute({ type: "batch", commands });
    editor.notify(`Guidelines removed: ${commands.length} layer${commands.length === 1 ? " is" : "s are"} open to editors.`);
}

const KIND_LABEL: Record<FieldKind, string> = { text: "Text", image: "Image", color: "Colour" };

export function LayerCard({ node, bare }: { node: SceneNode; bare?: boolean }) {
    const data = layerData(node);
    const setLocks = (patch: Partial<LayerLocks>) => data && setLayerField(node.id, { locks: { ...data.locks, ...patch } });
    return (
        <section className={bare ? bareCard : card} aria-label="Template field">
            <div className="mb-2 flex items-center justify-between font-semibold">
                Template field
                <label className="flex items-center gap-1.5 font-normal">
                    <input type="checkbox" aria-label="Editable field" checked={Boolean(data)} onChange={(e) => setLayerField(node.id, e.target.checked ? {} : null)} className="accent-brand-500" />
                    Editable
                </label>
            </div>
            {!data && <p className="text-ink-subtle">Locked: editors can't change this layer. Turn on Editable to make it a field.</p>}
            {data && (
                <div className="space-y-2">
                    <div className="grid grid-cols-[52px_1fr] items-center gap-x-2 gap-y-1.5">
                        <span className="text-ink-muted">Name</span>
                        <input
                            aria-label="Field name"
                            key={node.id}
                            defaultValue={data.field}
                            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== data.field && setLayerField(node.id, { field: e.target.value.trim() })}
                            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                            className={field}
                        />
                        <span className="text-ink-muted">Type</span>
                        <Select aria-label="Field type" value={data.type} onChange={(e) => setLayerField(node.id, { type: e.target.value as FieldKind })} className={field}>
                            {(["text", "image", "color"] as FieldKind[]).map((k) => (
                                <option key={k} value={k} disabled={k === "text" && node.type !== "text"}>{KIND_LABEL[k]}{k === fieldKindFor(node) ? " (suggested)" : ""}</option>
                            ))}
                        </Select>
                    </div>
                    <div>
                        <div className="mb-0.5 text-ink-muted">Lock</div>
                        <Check label={data.type === "image" ? "Image (no swapping)" : data.type === "text" ? "Text content" : "Content"} checked={data.locks.content} onChange={(on) => setLocks({ content: on })} />
                        <Check label="Position and size" checked={data.locks.position} onChange={(on) => setLocks({ position: on })} />
                        <Check label="Style (colours)" checked={data.locks.style} onChange={(on) => setLocks({ style: on })} />
                    </div>
                    {!data.locks.style && <Check label="Colours from the brand palette only" checked={Boolean(data.brandOnly)} onChange={(on) => setLayerField(node.id, { brandOnly: on })} />}
                </div>
            )}
        </section>
    );
}

export function TemplateCard() {
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    if (selection.length !== 1) return null;
    const node = doc.nodes[selection[0] ?? ""];
    if (!node) return null;
    if (assetData(node)) return <AssetCard asset={node} />;
    if (assetOf(doc, node.id)) return <LayerCard node={node} />;
    return null;
}
