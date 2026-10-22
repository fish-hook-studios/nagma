import { AlertTriangle, Play, RefreshCcw01, Settings01 } from "@untitledui/icons";
import { LiveSections } from "../components/live-section";
import { useState, type ReactNode } from "react";
import { SelectionColors, SelectionPanel } from "../components/design-panel";
import { ExportSection } from "../components/export-section";
import { IconButton } from "../components/icon-button";
import { NumberField } from "../components/number-field";
import { HeaderSection, ROW, Section as PanelSection } from "../components/panel-section";
import { Select } from "../components/select";
import { editor, useEditor } from "../engine/store";
import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import { bpData, bpFrames, bpOfNode, pageOverflow, breakpointsOf, insideList, mirrorOf, PRIMARY_BP, collectionOf, collectionsOf, pageData, pageOfNode, primaryOf, sitePages, slugify, webData } from "./model";
import { site, useSite } from "./state";
import { resetOverridesCommand } from "./sync";
import type { AppearEffect, EmbedSettings, ScrollEffect, SiteLink, SiteNodeData, SiteOverflow, StateStyle, WebTag } from "./types";
import { makeSharedComponent } from "./components";
import { BreakpointsEditor } from "./breakpoints";

// The right panel: Design (where the layer sits in the site, its web settings, then the usual design
// properties) and Interactions (hover and press states, scroll effects). With nothing selected it
// shows the page's settings.

const INPUT = "h-7 w-full min-w-0 rounded-[5px] border border-transparent bg-field px-2 text-[11px] text-ink outline-none hover:border-panel-border focus:border-brand-500";
const LABEL = "w-[72px] shrink-0 text-ink-muted";

function Section({ title, action, children }: { title: ReactNode; action?: ReactNode; children?: ReactNode }) {
    return (
        <section className="border-b border-panel-border px-3 py-2.5">
            <div className="flex h-6 items-center justify-between">
                <h3 className="font-semibold">{title}</h3>
                <div className="flex items-center">{action}</div>
            </div>
            {children && <div className="mt-1.5 space-y-1.5">{children}</div>}
        </section>
    );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-center gap-2">
            <span className={LABEL}>{label}</span>
            <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
        </div>
    );
}

// The Interaction tab's sections, as the reference: a 24 title row inset 8, 41 tall when empty
// (its title muted), and rows of 24 fields 12 under the title with 16 below.
const SMALL = "h-6 w-full min-w-0 rounded-[5px] border border-transparent bg-field px-2 text-[11px] text-ink outline-none hover:border-panel-border focus:border-brand-500";

function ISection({ title, action, children }: { title: ReactNode; action?: ReactNode; children?: ReactNode }) {
    const body = Boolean(children) && !(Array.isArray(children) && children.every((c) => !c));
    return (
        <section className={`border-b border-panel-border pr-2 pl-4 ${body ? "pt-2 pb-4" : "py-2"}`}>
            <div className="flex h-6 items-center justify-between">
                <h3 className={body ? "font-semibold" : "text-ink-muted"}>{title}</h3>
                <div className="flex items-center">{action}</div>
            </div>
            {body && <div className="mt-3 space-y-2 pr-2">{children}</div>}
        </section>
    );
}

function IRow({ label, children }: { label: ReactNode; children: ReactNode }) {
    return (
        <div className="flex items-center gap-2">
            <span className="flex w-[59px] shrink-0 items-center gap-1.5 text-ink-muted">{label}</span>
            <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
        </div>
    );
}

function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
    return (
        <button type="button" aria-label={label} onClick={onPress} className="flex size-6 items-center justify-center rounded-[5px] text-[15px] hover:bg-panel-hover">
            +
        </button>
    );
}

function Text({ value, onCommit, placeholder, label, multiline }: { value: string; onCommit: (v: string) => void; placeholder?: string; label: string; multiline?: boolean }) {
    const commit = (v: string) => v !== value && onCommit(v);
    if (multiline)
        return <textarea key={value} aria-label={label} defaultValue={value} placeholder={placeholder} rows={3} className={`${INPUT} h-auto py-1.5`} onBlur={(e) => commit(e.target.value)} />;
    return <input key={value} aria-label={label} defaultValue={value} placeholder={placeholder} className={INPUT} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />;
}

function Num({ value, onCommit, label, step = 1, min, max, unit }: { value: number; onCommit: (v: number) => void; label: string; step?: number; min?: number; max?: number; unit?: string }) {
    return (
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-[5px] bg-field px-2">
            <input
                key={value}
                type="number"
                aria-label={label}
                defaultValue={value}
                step={step}
                min={min}
                max={max}
                className="w-full min-w-0 bg-transparent text-[11px] outline-none"
                onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v !== value) onCommit(v);
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            {unit && <span className="text-ink-subtle">{unit}</span>}
        </label>
    );
}

function Color({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }) {
    return (
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[5px] bg-field px-1.5">
            <input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(e) => onCommit(e.target.value)} className="size-4 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
            <input key={value} aria-label={`${label} hex`} defaultValue={value} className="w-full min-w-0 bg-transparent text-[11px] outline-none" onBlur={(e) => /^#[0-9a-f]{3,8}$/i.test(e.target.value) && onCommit(e.target.value)} />
        </label>
    );
}

// ---- Web settings live on the desktop layer, so every breakpoint shares them ----

function setWeb(doc: NagmaDocument, ids: string[], patch: (current: SiteNodeData, node: SceneNode) => Partial<SiteNodeData>) {
    const commands: Command[] = [];
    const done = new Set<string>();
    for (const id of ids) {
        const target = primaryOf(doc, id);
        if (done.has(target)) continue;
        done.add(target);
        const node = doc.nodes[target];
        if (!node || (node.site && "kind" in node.site && node.site.kind)) continue;
        const current = webData(node);
        commands.push({ type: "node.update", id: target, patch: { site: { ...current, ...patch(current, node) } } });
    }
    if (commands.length) editor.execute({ type: "batch", commands });
}

const TAGS: [WebTag, string][] = [
    ["auto", "Automatic"],
    ["section", "Section"],
    ["header", "Header"],
    ["nav", "Navigation"],
    ["main", "Main"],
    ["footer", "Footer"],
    ["article", "Article"],
    ["aside", "Aside"],
    ["div", "Box (div)"],
    ["h1", "Heading 1"],
    ["h2", "Heading 2"],
    ["h3", "Heading 3"],
    ["h4", "Heading 4"],
    ["p", "Paragraph"],
    ["span", "Inline text"],
    ["blockquote", "Quote"],
    ["button", "Button"],
    ["ul", "List"],
    ["li", "List item"],
    ["details", "Disclosure"],
    ["summary", "Disclosure title"],
];

const OVERRIDE_LABELS: Record<string, string> = {
    fills: "Fill",
    strokes: "Stroke",
    layout: "Auto layout",
    sizing: "Resizing",
    visible: "Visibility",
    w: "Width",
    h: "Height",
    x: "Position",
    y: "Position",
    fontSize: "Font size",
    fontWeight: "Font weight",
    lineHeight: "Line height",
    letterSpacing: "Letter spacing",
    textAlign: "Alignment",
    text: "Text",
    minH: "Min height",
    minW: "Min width",
    maxW: "Max width",
    maxH: "Max height",
    radius: "Corner radius",
    opacity: "Opacity",
    children: "Layer order",
    site: "Web settings",
    effects: "Effects",
    padding: "Padding",
};

// Which breakpoint the selection is on, and what it changed there.
function BreakpointSection({ nodes }: { nodes: SceneNode[] }) {
    const doc = useEditor((s) => s.doc);
    const first = nodes[0];
    const where = first ? bpOfNode(doc, first.id) : null;
    if (!where || !first) return null;
    const info = { label: where.frame.name };
    // The same layers on every breakpoint, to change them all at once.
    const page = where.frame.parentId ?? "";
    const everywhere = [...new Set(nodes.flatMap((n) => {
        const primaryId = primaryOf(doc, n.id);
        return breakpointsOf(doc, page).map((b) => mirrorOf(doc, primaryId, b.id)).filter((id): id is string => Boolean(id));
    }))];
    const selectAll = everywhere.length > nodes.length && (
        <button type="button" onClick={() => editor.set({ selection: everywhere })} className="ml-auto h-6 shrink-0 rounded-[5px] px-1.5 text-brand-500 hover:bg-panel-hover">
            Select on all breakpoints
        </button>
    );
    if (where.bp === PRIMARY_BP) {
        return (
            <div className="border-b border-panel-border bg-brand-500/8 px-3 py-2 text-[11px]">
                <div className="flex items-center gap-1.5">
                    <span className="rounded-[4px] bg-brand-500 px-1.5 py-px text-[10px] font-semibold text-white">Primary</span>
                    {selectAll}
                </div>
                <p className="mt-1 text-ink-muted">Changes here reach every other breakpoint unless it changes the same thing.</p>
            </div>
        );
    }
    const isRoot = first.id === where.frame.id;
    const ov = isRoot ? ((where.frame.site && "kind" in where.frame.site && where.frame.site.kind === "bp" ? where.frame.site.ov : []) ?? []) : (webData(first).ov ?? []);
    const own = !isRoot && primaryOf(doc, first.id) === first.id && !webData(first).rep;
    const labels = [...new Set(ov.map((k) => OVERRIDE_LABELS[k] ?? k))];
    const reset = () => {
        const commands = nodes.map((n) => resetOverridesCommand(editor.get().doc, n.id)).filter((c): c is Command => Boolean(c));
        if (commands.length) editor.execute({ type: "batch", commands });
    };
    return (
        <div className="border-b border-panel-border bg-amber-500/10 px-3 py-2 text-[11px]">
            <div className="flex items-center gap-1.5">
                <span className="rounded-[4px] bg-amber-500 px-1.5 py-px text-[10px] font-semibold text-white">{info.label}</span>
                <span className="text-ink-muted">{own ? `Only on ${info.label}.` : "Changes here reach narrower breakpoints only."}</span>
                {selectAll}
            </div>
            {labels.length > 0 && (
                <div className="mt-1.5 flex items-start gap-2">
                    <span className="flex-1 leading-4">
                        <span className="text-ink-muted">Changed here: </span>
                        {labels.join(", ")}
                    </span>
                    <button type="button" onClick={reset} className="flex h-6 shrink-0 items-center gap-1 rounded-[5px] border border-panel-border bg-panel px-1.5 hover:bg-panel-hover">
                        <RefreshCcw01 className="size-3" /> Reset all changes
                    </button>
                </div>
            )}
        </div>
    );
}

function LinkEditor({ nodes }: { nodes: SceneNode[] }) {
    const doc = useEditor((s) => s.doc);
    const node = nodes[0] as SceneNode;
    const web = webData(doc.nodes[primaryOf(doc, node.id)]);
    const link = web.link ?? null;
    const set = (next: SiteLink | null) => setWeb(doc, nodes.map((n) => n.id), () => ({ link: next }));
    const pages = sitePages(doc).filter((p) => !pageData(p)?.notFound && !pageData(p)?.collectionId);
    const inList = insideList(doc, node.id);
    const kind = link?.kind ?? "none";
    // Sections people can jump to: the top-level layers of each page's desktop frame.
    const sections = (pageId: string) => (bpFrames(doc, pageId).desktop?.children ?? []).map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    const page = pageOfNode(doc, node.id);
    const collection = inList ? collectionOf(doc, inList) : collectionOf(doc, pageData(page)?.collectionId);
    const linkFields = collection?.fields.filter((f) => f.type === "link") ?? [];
    return (
        <ISection
            title="Link"
            action={link ? <RemoveButton label="Link" onPress={() => set(null)} /> : <AddButton label="Add link" onPress={() => set(pages[0] ? { kind: "page", pageId: pages[0].id } : { kind: "url", url: "https://", newTab: true })} />}
        >
            {link && (
            <>
            <Row label="Goes to">
                <Select
                    aria-label="Link type"
                    value={kind}
                    className={INPUT}
                    onChange={(e) => {
                        const k = e.target.value;
                        if (k === "none") set(null);
                        else if (k === "page") set({ kind: "page", pageId: pages[0]?.id ?? "" });
                        else if (k === "section") set({ kind: "section", nodeId: sections(page?.id ?? "")[0]?.id ?? "" });
                        else if (k === "url") set({ kind: "url", url: "https://", newTab: true });
                        else if (k === "email") set({ kind: "email", email: "" });
                        else if (k === "item") set({ kind: "item" });
                        else if (k === "field") set({ kind: "field", field: linkFields[0]?.id ?? "" });
                    }}
                >
                    <option value="none">Nothing</option>
                    <option value="page">A page</option>
                    <option value="section">A section</option>
                    <option value="url">A web address</option>
                    <option value="email">An email address</option>
                    {collection && <option value="item">The item’s page</option>}
                    {linkFields.length > 0 && <option value="field">A link field</option>}
                </Select>
            </Row>
            {link?.kind === "page" && (
                <Row label="Page">
                    <Select aria-label="Page" value={link.pageId} className={INPUT} onChange={(e) => set({ kind: "page", pageId: e.target.value })}>
                        {pages.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name} ({pageData(p)?.path})
                            </option>
                        ))}
                    </Select>
                </Row>
            )}
            {link?.kind === "section" && (
                <Row label="Section">
                    <Select aria-label="Section" value={link.nodeId} className={INPUT} onChange={(e) => set({ kind: "section", nodeId: e.target.value })}>
                        {sitePages(doc).flatMap((p) =>
                            sections(p.id).map((s) => (
                                <option key={s.id} value={s.id}>
                                    {p.name}: {s.name}
                                </option>
                            )),
                        )}
                    </Select>
                </Row>
            )}
            {link?.kind === "url" && (
                <>
                    <Row label="Address">
                        <Text label="Web address" value={link.url} placeholder="https://example.com" onCommit={(url) => set({ ...link, url })} />
                    </Row>
                    <label className="flex items-center gap-2 pl-[80px]">
                        <input type="checkbox" checked={Boolean(link.newTab)} onChange={(e) => set({ ...link, newTab: e.target.checked })} /> Open in a new tab
                    </label>
                </>
            )}
            {link?.kind === "email" && (
                <Row label="Email">
                    <Text label="Email address" value={link.email} placeholder="hello@example.com" onCommit={(email) => set({ kind: "email", email })} />
                </Row>
            )}
            {link?.kind === "field" && (
                <Row label="Field">
                    <Select aria-label="Link field" value={link.field} className={INPUT} onChange={(e) => set({ kind: "field", field: e.target.value })}>
                        {linkFields.map((f) => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                    </Select>
                </Row>
            )}
            </>
            )}
        </ISection>
    );
}

// The list a layer sits in (as part of the list's template), if any.
function EmbedEditor({ nodes, embed }: { nodes: SceneNode[]; embed: EmbedSettings }) {
    const doc = useEditor((s) => s.doc);
    const set = (next: EmbedSettings) => setWeb(doc, nodes.map((n) => n.id), () => ({ embed: next }));
    if (embed.kind === "video")
        return (
            <Section title="Video">
                <Row label="Address">
                    <Text label="Video address" value={embed.url} placeholder="A video page or file address" onCommit={(url) => set({ ...embed, url })} />
                </Row>
                <label className="flex items-center gap-2 pl-[80px]">
                    <input type="checkbox" checked={Boolean(embed.autoplay)} onChange={(e) => set({ ...embed, autoplay: e.target.checked })} /> Play muted on load
                </label>
            </Section>
        );
    if (embed.kind === "map")
        return (
            <Section title="Map">
                <Row label="Place">
                    <Text label="Place" value={embed.query} placeholder="An address or a place" onCommit={(query) => set({ ...embed, query })} />
                </Row>
                <Row label="Zoom">
                    <Num label="Map zoom" value={embed.zoom ?? 14} min={1} max={20} onCommit={(zoom) => set({ ...embed, zoom })} />
                </Row>
            </Section>
        );
    return (
        <Section title="Code">
            <div className="flex gap-1.5 rounded-[6px] bg-amber-500/12 p-2 leading-4 text-ink">
                <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-600" />
                <span>This code goes into the published page as it is. Only add code you trust: it runs for everyone who visits the site.</span>
            </div>
            <textarea
                key={embed.code}
                aria-label="Embed code"
                defaultValue={embed.code}
                spellCheck={false}
                rows={8}
                className="w-full rounded-[5px] border border-panel-border bg-field p-2 font-mono text-[10.5px] text-ink outline-none focus:border-brand-500"
                onBlur={(e) => e.target.value !== embed.code && set({ kind: "code", code: e.target.value })}
            />
        </Section>
    );
}

function WebSection({ nodes }: { nodes: SceneNode[] }) {
    const doc = useEditor((s) => s.doc);
    const readOnly = useEditor((s) => s.readOnly);
    const node = nodes[0] as SceneNode;
    const primary = doc.nodes[primaryOf(doc, node.id)] ?? node;
    const web = webData(primary);
    const ids = nodes.map((n) => n.id);
    const where = bpOfNode(doc, node.id);
    const isFrame = primary.type === "frame" || primary.type === "instance" || primary.type === "component";
    const listCollection = insideList(doc, node.id);
    const page = pageOfNode(doc, node.id);
    const bindCollection = collectionOf(doc, listCollection ?? pageData(page)?.collectionId ?? null);
    const bindable = bindCollection?.fields.filter((f) => (primary.type === "text" ? f.type !== "image" : f.type === "image")) ?? [];
    const topLevel = where && primary.parentId === bpFrames(doc, page?.id ?? "").desktop?.id;
    if (where?.frame.id === node.id || primary.type === "page") return null;
    return (
        <>
            {/* A Live frame: its props and code (breakpoint copies follow the primary). */}
            {primary.type === "live" && nodes.length === 1 && <LiveSections node={primary} />}
            {/* The element (Tag), alt text and link are in the Interaction tab, as the reference. */}
            {(isFrame || (bindCollection && bindable.length > 0 && (primary.type === "text" || primary.type === "rect"))) && (
            <Section title="Web">
                {isFrame && (
                    <Row label="Anchor">
                        <Text label="Anchor name" value={web.anchor ?? ""} placeholder={slugify(primary.name)} onCommit={(anchor) => setWeb(doc, ids, () => ({ anchor: anchor.trim() ? slugify(anchor) : null }))} />
                    </Row>
                )}
                {bindCollection && bindable.length > 0 && (primary.type === "text" || primary.type === "rect") && (
                    <Row label="CMS field">
                        <Select aria-label="Bound field" value={web.bind?.field ?? ""} className={INPUT} onChange={(e) => setWeb(doc, ids, () => ({ bind: e.target.value ? { field: e.target.value } : null }))}>
                            <option value="">Not connected</option>
                            {bindable.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {bindCollection.name}: {f.name}
                                </option>
                            ))}
                            {primary.type === "text" && <option value="slug">{bindCollection.name}: Slug</option>}
                        </Select>
                    </Row>
                )}
                {topLevel && primary.type === "frame" && !readOnly && (
                    <button type="button" onClick={() => makeSharedComponent(primary.id)} className="mt-1 h-7 w-full rounded-[5px] border border-panel-border hover:bg-panel-hover">
                        Make a shared component
                    </button>
                )}
            </Section>
            )}
            {web.list && <ListEditor nodes={nodes} />}
            {web.form && (
                <Section title="Form">
                    <Row label="Sends to">
                        <Text label="Form address" value={web.form.action ?? ""} placeholder="Show a message only" onCommit={(action) => setWeb(doc, ids, (c) => ({ form: { success: c.form?.success ?? "Thanks!", action: action.trim() || null } }))} />
                    </Row>
                    <Row label="Message">
                        <Text label="Thank-you message" value={web.form.success} onCommit={(success) => setWeb(doc, ids, (c) => ({ form: { action: c.form?.action ?? null, success } }))} />
                    </Row>
                </Section>
            )}
            {web.field && (
                <Section title="Form field">
                    <Row label="Name">
                        <Text label="Field name" value={web.field.name} onCommit={(name) => setWeb(doc, ids, (c) => ({ field: { ...(c.field ?? { type: "text", name }), name: slugify(name) } }))} />
                    </Row>
                    <Row label="Type">
                        <Select aria-label="Field type" value={web.field.type} className={INPUT} onChange={(e) => setWeb(doc, ids, (c) => ({ field: { ...(c.field ?? { name: "field", type: "text" }), type: e.target.value as "text" } }))}>
                            <option value="text">Text</option>
                            <option value="email">Email</option>
                            <option value="tel">Phone</option>
                            <option value="number">Number</option>
                            <option value="textarea">Long text</option>
                            <option value="checkbox">Checkbox</option>
                            <option value="select">Dropdown</option>
                        </Select>
                    </Row>
                    {web.field.type === "select" && (
                        <Row label="Options">
                            <Text label="Options" value={(web.field.options ?? []).join(", ")} placeholder="One, Two, Three" onCommit={(v) => setWeb(doc, ids, (c) => ({ field: { ...(c.field ?? { name: "field", type: "select" }), options: v.split(",").map((o) => o.trim()).filter(Boolean) } }))} />
                        </Row>
                    )}
                    <label className="flex items-center gap-2 pl-[80px]">
                        <input type="checkbox" checked={Boolean(web.field.required)} onChange={(e) => setWeb(doc, ids, (c) => ({ field: { ...(c.field ?? { name: "field", type: "text" }), required: e.target.checked } }))} /> Required
                    </label>
                </Section>
            )}
            {web.embed && <EmbedEditor nodes={nodes} embed={web.embed} />}
            {isFrame && !web.form && !web.field && !web.embed && !web.list && !readOnly && (
                <Section title="Make it">
                    <div className="grid grid-cols-2 gap-1">
                        <button type="button" className="h-7 rounded-[5px] border border-panel-border hover:bg-panel-hover" onClick={() => setWeb(doc, ids, () => ({ form: { action: null, success: "Thanks!" } }))}>
                            A form
                        </button>
                        <button type="button" className="h-7 rounded-[5px] border border-panel-border hover:bg-panel-hover" onClick={() => setWeb(doc, ids, (_, n) => ({ field: { name: slugify(n.name), type: "text" } }))}>
                            A form field
                        </button>
                        <button type="button" className="h-7 rounded-[5px] border border-panel-border hover:bg-panel-hover" onClick={() => setWeb(doc, ids, (c) => ({ submit: !c.submit }))}>
                            {web.submit ? "Not a submit button" : "A submit button"}
                        </button>
                        {collectionsOf(doc).length > 0 && (
                            <button type="button" className="h-7 rounded-[5px] border border-panel-border hover:bg-panel-hover" onClick={() => setWeb(doc, ids, () => ({ list: { collectionId: collectionsOf(doc)[0]?.id ?? "", limit: null } }))}>
                                A collection list
                            </button>
                        )}
                    </div>
                </Section>
            )}
        </>
    );
}

function ListEditor({ nodes }: { nodes: SceneNode[] }) {
    const doc = useEditor((s) => s.doc);
    const primary = doc.nodes[primaryOf(doc, nodes[0]?.id ?? "")];
    const list = webData(primary).list;
    if (!list || !primary) return null;
    const ids = [primary.id];
    return (
        <Section title="Collection list">
            <Row label="Collection">
                <Select aria-label="Collection" value={list.collectionId} className={INPUT} onChange={(e) => setWeb(doc, ids, () => ({ list: { ...list, collectionId: e.target.value } }))}>
                    {collectionsOf(doc).map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </Select>
            </Row>
            <Row label="Show">
                <Num label="Items to show (0 for all)" value={list.limit ?? 0} min={0} onCommit={(limit) => setWeb(doc, ids, () => ({ list: { ...list, limit: limit > 0 ? limit : null } }))} />
                <span className="text-ink-muted">items (0: all)</span>
            </Row>
            <p className="leading-4 text-ink-muted">The first layer inside is the template for every item. Connect its layers to fields under Web.</p>
            <button type="button" className="h-7 w-full rounded-[5px] border border-panel-border hover:bg-panel-hover" onClick={() => site.set({ dialog: { kind: "collection", id: list.collectionId } })}>
                Edit items
            </button>
        </Section>
    );
}

// ---- Interactions ----

const DEFAULT_APPEAR: AppearEffect = { kind: "appear", trigger: "in-view", opacity: 0, x: 0, y: 40, scale: 1, rotate: 0, duration: 600, delay: 0, easing: "ease-out", once: true };

function StateEditor({ title, value, onChange, about }: { title: string; value: StateStyle | null | undefined; onChange: (v: StateStyle | null) => void; about: string }) {
    return (
        <Section
            title={title}
            action={
                <button type="button" onClick={() => onChange(value ? null : { opacity: null, scale: title === "Press" ? 0.97 : 1.02, y: null, duration: 150 })} className="h-6 rounded-[5px] px-1.5 text-brand-500 hover:bg-panel-hover">
                    {value ? "Remove" : "Add"}
                </button>
            }
        >
            {!value && <p className="leading-4 text-ink-muted">{about}</p>}
            {value && (
                <>
                    <Row label="Fill">
                        {value.fill ? <Color label={`${title} fill`} value={value.fill} onCommit={(fill) => onChange({ ...value, fill })} /> : <button type="button" className="h-7 flex-1 rounded-[5px] border border-dashed border-panel-border text-ink-muted hover:bg-panel-hover" onClick={() => onChange({ ...value, fill: "#4338CA" })}>Set fill</button>}
                        {value.fill && <button type="button" aria-label="Remove fill" className="px-1 text-ink-muted hover:text-ink" onClick={() => onChange({ ...value, fill: null })}>×</button>}
                    </Row>
                    <Row label="Text color">
                        {value.textColor ? <Color label={`${title} text colour`} value={value.textColor} onCommit={(textColor) => onChange({ ...value, textColor })} /> : <button type="button" className="h-7 flex-1 rounded-[5px] border border-dashed border-panel-border text-ink-muted hover:bg-panel-hover" onClick={() => onChange({ ...value, textColor: "#101828" })}>Set colour</button>}
                        {value.textColor && <button type="button" aria-label="Remove text colour" className="px-1 text-ink-muted hover:text-ink" onClick={() => onChange({ ...value, textColor: null })}>×</button>}
                    </Row>
                    <Row label="Scale">
                        <Num label={`${title} scale`} value={value.scale ?? 1} step={0.01} min={0.5} max={2} onCommit={(scale) => onChange({ ...value, scale })} />
                        <Num label={`${title} move up or down`} value={value.y ?? 0} unit="px" onCommit={(y) => onChange({ ...value, y })} />
                    </Row>
                    <Row label="Opacity">
                        <Num label={`${title} opacity`} value={Math.round((value.opacity ?? 1) * 100)} min={0} max={100} unit="%" onCommit={(o) => onChange({ ...value, opacity: o >= 100 ? null : o / 100 })} />
                        <Num label={`${title} duration`} value={value.duration ?? 150} min={0} max={2000} unit="ms" onCommit={(duration) => onChange({ ...value, duration })} />
                    </Row>
                    <label className="flex items-center gap-2 pl-[80px]">
                        <input type="checkbox" checked={Boolean(value.shadow)} onChange={(e) => onChange({ ...value, shadow: e.target.checked })} /> Lift with a shadow
                    </label>
                </>
            )}
        </Section>
    );
}

function EffectEditor({ doc, pageId, self, value, onChange }: { doc: NagmaDocument; pageId: string; self: string; value: ScrollEffect | null | undefined; onChange: (v: ScrollEffect | null) => void }) {
    const kind = value?.kind ?? "none";
    const title = kind === "appear" ? "Reveal" : kind === "parallax" ? "Scroll parallax" : "Scroll transform";
    return (
        <Section title={title} action={<RemoveButton label={title} onPress={() => onChange(null)} />}>
            <Row label="Effect">
                <Select
                    aria-label="Scroll effect"
                    value={kind}
                    className={INPUT}
                    onChange={(e) => {
                        const k = e.target.value;
                        if (k === "none") onChange(null);
                        if (k === "appear") onChange(DEFAULT_APPEAR);
                        if (k === "parallax") onChange({ kind: "parallax", speed: 0.3 });
                        if (k === "scroll") onChange({ kind: "scroll", from: { opacity: 0.2, x: 0, y: 60, scale: 0.92, rotate: 0 }, to: { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 } });
                    }}
                >
                    <option value="none">None</option>
                    <option value="appear">Reveal</option>
                    <option value="parallax">Scroll parallax</option>
                    <option value="scroll">Scroll transform</option>
                </Select>
            </Row>
            {value?.kind === "appear" && (
                <>
                    <Row label="Starts">
                        <Select aria-label="Appear trigger" value={value.trigger} className={INPUT} onChange={(e) => onChange({ ...value, trigger: e.target.value as "load" })}>
                            <option value="in-view">When it scrolls into view</option>
                            <option value="load">When the page loads</option>
                            <option value="layer">While another layer is in view</option>
                        </Select>
                    </Row>
                    {value.trigger === "layer" && (
                        <Row label="Layer">
                            <TriggerTarget doc={doc} pageId={pageId} value={value.target} except={self} onChange={(target) => onChange({ ...value, target })} />
                        </Row>
                    )}
                    <Row label="From">
                        <Num label="Start opacity" value={Math.round(value.opacity * 100)} min={0} max={100} unit="%" onCommit={(o) => onChange({ ...value, opacity: o / 100 })} />
                        <Num label="Start scale" value={value.scale} step={0.05} min={0.1} max={3} unit="×" onCommit={(scale) => onChange({ ...value, scale })} />
                    </Row>
                    <Row label="Offset">
                        <Num label="Start offset X" value={value.x} unit="x" onCommit={(x) => onChange({ ...value, x })} />
                        <Num label="Start offset Y" value={value.y} unit="y" onCommit={(y) => onChange({ ...value, y })} />
                    </Row>
                    <Row label="Rotate">
                        <Num label="Start rotation" value={value.rotate} unit="°" onCommit={(rotate) => onChange({ ...value, rotate })} />
                        <Num label="Delay" value={value.delay} min={0} unit="ms" onCommit={(delay) => onChange({ ...value, delay })} />
                    </Row>
                    <Row label="Timing">
                        <Num label="Duration" value={value.duration} min={50} max={5000} unit="ms" onCommit={(duration) => onChange({ ...value, duration })} />
                        <Select aria-label="Easing" value={value.easing} className={INPUT} onChange={(e) => onChange({ ...value, easing: e.target.value as "ease" })}>
                            <option value="ease-out">Ease out</option>
                            <option value="ease">Ease</option>
                            <option value="ease-in-out">Ease in and out</option>
                            <option value="spring">Spring</option>
                            <option value="linear">Linear</option>
                        </Select>
                    </Row>
                    <label className="flex items-center gap-2 pl-[80px]">
                        <input type="checkbox" checked={value.once} onChange={(e) => onChange({ ...value, once: e.target.checked })} /> Play only once
                    </label>
                </>
            )}
            {value?.kind === "parallax" && (
                <Row label="Speed">
                    <Num label="Parallax speed" value={Math.round(value.speed * 100)} min={-100} max={100} unit="%" onCommit={(s) => onChange({ ...value, speed: s / 100 })} />
                </Row>
            )}
            {value?.kind === "scroll" && (
                <>
                    <Row label="Follows">
                        <Select aria-label="Scroll transform trigger" value={value.trigger ?? "self"} className={INPUT} onChange={(e) => onChange({ ...value, trigger: e.target.value as "self" })}>
                            <option value="self">This layer in view</option>
                            <option value="page">Scrolling the page</option>
                            <option value="layer">Another layer in view</option>
                        </Select>
                    </Row>
                    {value.trigger === "layer" && (
                        <Row label="Layer">
                            <TriggerTarget doc={doc} pageId={pageId} value={value.target} except={self} onChange={(target) => onChange({ ...value, target })} />
                        </Row>
                    )}
                    {(["from", "to"] as const).map((end) => (
                        <div key={end} className="space-y-1.5">
                            <div className="text-ink-muted">{value.trigger === "page" ? (end === "from" ? "At the top of the page" : "At the bottom of the page") : end === "from" ? "As it enters the window" : "As it leaves the window"}</div>
                            <Row label="Opacity">
                                <Num label={`${end} opacity`} value={Math.round(value[end].opacity * 100)} min={0} max={100} unit="%" onCommit={(o) => onChange({ ...value, [end]: { ...value[end], opacity: o / 100 } })} />
                                <Num label={`${end} scale`} value={value[end].scale} step={0.05} unit="×" onCommit={(scale) => onChange({ ...value, [end]: { ...value[end], scale } })} />
                            </Row>
                            <Row label="Move">
                                <Num label={`${end} x`} value={value[end].x} unit="x" onCommit={(x) => onChange({ ...value, [end]: { ...value[end], x } })} />
                                <Num label={`${end} y`} value={value[end].y} unit="y" onCommit={(y) => onChange({ ...value, [end]: { ...value[end], y } })} />
                                <Num label={`${end} rotation`} value={value[end].rotate} unit="°" onCommit={(rotate) => onChange({ ...value, [end]: { ...value[end], rotate } })} />
                            </Row>
                        </div>
                    ))}
                </>
            )}
            {kind !== "none" && <p className="leading-4 text-ink-muted">Plays in Preview and on the published site. People who ask for less motion see the layer without it.</p>}
        </Section>
    );
}

// Layers on the page another interaction can point at (Scroll to, other layer in view), indented.
function pageLayers(doc: NagmaDocument, pageId: string, except?: string): { id: string; label: string }[] {
    const out: { id: string; label: string }[] = [];
    const walk = (id: string, depth: number) => {
        const node = doc.nodes[id];
        if (!node || webData(node).rep || depth > 5) return;
        if (depth > 0 && id !== except) out.push({ id, label: `${"\u00a0\u00a0".repeat(depth - 1)}${node.name}` });
        if (node.type !== "instance") node.children.forEach((c) => walk(c, depth + 1));
    };
    const desktop = bpFrames(doc, pageId).desktop;
    if (desktop) walk(desktop.id, 0);
    return out;
}

// Layers that can follow the pointer as a cursor: main components first, then the page's layers.
function cursorLayers(doc: NagmaDocument, pageId: string): { id: string; label: string }[] {
    const components = Object.values(doc.nodes).filter((n) => n.type === "component" && doc.nodes[n.parentId ?? ""]?.type !== "componentSet").map((n) => ({ id: n.id, label: `Component: ${n.name}` }));
    return [...components, ...pageLayers(doc, pageId)];
}

type InteractionKind = "change-to" | "back" | "scroll-to" | "hover" | "press" | "appear" | "parallax" | "scroll" | "cursor" | "marquee" | "lightbox";
// The add-interaction menu: one line each with an icon, in two groups (actions; effects). Change to
// shows for instances of a component with variants, Lightbox for picture layers; Conditional, Set
// variable and Play are listed but not available yet.
type MenuEntry = { kind: InteractionKind | "conditional" | "set-variable" | "play"; label: string; about: string; icon: string; group: 0 | 1; soon?: boolean };
const INTERACTIONS: MenuEntry[] = [
    { kind: "back", label: "Back", about: "Go to the previous page", icon: "M9.5 3.5 5 8l4.5 4.5", group: 0 },
    { kind: "scroll-to", label: "Scroll to", about: "Bring another layer into view", icon: "M8 2.5v9M4.5 8 8 11.5 11.5 8M3 13.5h10", group: 0 },
    { kind: "conditional", label: "Conditional", about: "Not available yet", icon: "M3 8h4l2-4h4M7 8l2 4h4", group: 0, soon: true },
    { kind: "set-variable", label: "Set variable", about: "Not available yet", icon: "M5 3.5C3.5 5.5 3.5 10.5 5 12.5M11 3.5c1.5 2 1.5 7 0 9M6.5 6l3 4M9.5 6l-3 4", group: 0, soon: true },
    { kind: "change-to", label: "Change to", about: "Swap this instance to another variant", icon: "M3 5.5h8.5L9.5 3.5M13 10.5H4.5l2 2", group: 0 },
    { kind: "hover", label: "Hover effect", about: "Change the layer while the pointer is over it", icon: "M5 2.5v8l2.2-2 1.6 3.5 1.5-.7-1.6-3.4H12Z", group: 1 },
    { kind: "press", label: "Press effect", about: "Change the layer while it is pressed", icon: "M8 3.5v3M4.8 4.8l2 2M11.2 4.8l-2 2M6.5 9.5h3v4h-3Z", group: 1 },
    { kind: "appear", label: "Reveal", about: "Animate in on load or when in view", icon: "M2.5 8s2-4 5.5-4 5.5 4 5.5 4-2 4-5.5 4-5.5-4-5.5-4ZM8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z", group: 1 },
    { kind: "parallax", label: "Scroll parallax", about: "Move slower or faster than the page", icon: "M3 3.5h10M3 8h6M3 12.5h10M12 6.5v3", group: 1 },
    { kind: "scroll", label: "Scroll transform", about: "Tie the look to scrolling", icon: "M3.5 3.5h6v6h-6ZM9.5 6.5h3v6h-6v-3", group: 1 },
    { kind: "cursor", label: "Custom cursor", about: "A custom cursor over the layer", icon: "M4 2.5 12.5 6l-3.7 1.3L7.5 11 4 2.5Z", group: 1 },
    { kind: "marquee", label: "Marquee", about: "Scroll the content in a loop", icon: "M2.5 5.5h11M2.5 10.5h11M5 8h6", group: 1 },
    { kind: "lightbox", label: "Lightbox", about: "Open the picture full screen", icon: "M2.5 2.5h4M2.5 2.5v4M13.5 13.5h-4M13.5 13.5v-4M13.5 2.5h-4M13.5 2.5v4M2.5 13.5h4M2.5 13.5v-4", group: 1 },
    { kind: "play", label: "Play", about: "Not available yet", icon: "M5 3.5v9l7-4.5Z", group: 1, soon: true },
];

function has(web: SiteNodeData, kind: InteractionKind): boolean {
    if (kind === "hover") return Boolean(web.hover);
    if (kind === "press") return Boolean(web.press);
    if (kind === "cursor") return Boolean(web.cursor);
    if (kind === "marquee") return Boolean(web.marquee);
    if (kind === "appear" || kind === "parallax" || kind === "scroll") return web.effect?.kind === kind;
    return web.action?.kind === kind;
}

function RemoveButton({ label, onPress }: { label: string; onPress: () => void }) {
    return (
        <button type="button" aria-label={`Remove ${label}`} onClick={onPress} className="flex size-6 items-center justify-center rounded-[5px] text-[14px] text-ink-muted hover:bg-panel-hover hover:text-ink">
            −
        </button>
    );
}

function AddInteraction({ web, node, onAdd, only }: { web: SiteNodeData; node: SceneNode; onAdd: (kind: InteractionKind) => void; only?: InteractionKind[] }) {
    const [open, setOpen] = useState(false);
    const doc = useEditor((s) => s.doc);
    const variants = variantsOf(doc, node);
    return (
        <div className="relative">
            <button type="button" aria-label="Add interaction" aria-expanded={open} onClick={() => setOpen(!open)} className="flex size-6 items-center justify-center rounded-[5px] text-[15px] hover:bg-panel-hover">
                +
            </button>
            {open && (
                <div role="menu" aria-label="Add interaction" className="absolute top-7 right-0 z-30 w-[200px] rounded-[13px] bg-[#1E1E1E] p-2 text-white shadow-xl">
                    {INTERACTIONS.filter((i) => !only || only.includes(i.kind as InteractionKind)).filter((i) => !(i.kind === "change-to" && variants.length < 2) && !(i.kind === "lightbox" && !node.fills.some((f) => f.type === "image"))).map((i, n, list) => {
                        const kind = i.kind as InteractionKind;
                        const taken = !i.soon && has(web, kind);
                        return (
                            <div key={i.kind}>
                                {n > 0 && list[n - 1]?.group !== i.group && <div className="my-2 h-px bg-white/10" />}
                                <button
                                    type="button"
                                    role="menuitem"
                                    title={i.about}
                                    disabled={taken || i.soon}
                                    onClick={() => {
                                        setOpen(false);
                                        onAdd(kind);
                                    }}
                                    className="flex h-6 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[11px] enabled:hover:bg-brand-500 disabled:opacity-40"
                                >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={i.icon} /></svg>
                                    <span className="flex-1">{i.label}</span>
                                    {i.kind === "play" && <span className="text-white/60">›</span>}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// The other variants of an instance's component set.
function variantsOf(doc: NagmaDocument, node: SceneNode): SceneNode[] {
    if (node.type !== "instance" || !node.componentId) return [];
    const component = doc.nodes[node.componentId];
    const set = component?.parentId ? doc.nodes[component.parentId] : undefined;
    if (set?.type !== "componentSet") return [];
    return set.children.map((id) => doc.nodes[id]).filter((n): n is SceneNode => n?.type === "component");
}

function TriggerTarget({ doc, pageId, value, except, onChange }: { doc: NagmaDocument; pageId: string; value: string | null | undefined; except: string; onChange: (id: string) => void }) {
    return (
        <Select aria-label="Other layer" value={value ?? ""} className={INPUT} onChange={(e) => onChange(e.target.value)}>
            <option value="">Choose a layer…</option>
            {pageLayers(doc, pageId, except).map((l) => (
                <option key={l.id} value={l.id}>
                    {l.label}
                </option>
            ))}
        </Select>
    );
}

function InteractionsTab({ nodes }: { nodes: SceneNode[] }) {
    const doc = useEditor((s) => s.doc);
    const pageId = useEditor((s) => s.pageId);
    const node = nodes[0];
    if (!node)
        return (
            <div className="space-y-2 px-4 py-3 leading-relaxed text-ink-muted">
                <p>Select one or more layers (⇧ click to add more) to give them interactions.</p>
                <button type="button" className="h-6 rounded-[5px] border border-panel-border px-2 text-ink hover:bg-panel-hover" onClick={() => site.set({ dialog: { kind: "settings", tab: "general" } })}>
                    Page transition…
                </button>
            </div>
        );
    const primary = doc.nodes[primaryOf(doc, node.id)] ?? node;
    const web = webData(primary);
    const ids = nodes.map((n) => n.id);
    // A breakpoint frame is the page itself: a custom cursor and its scroll behaviour.
    const pageFrame = bpOfNode(doc, node.id)?.frame.id === node.id;
    const set = (patch: Partial<SiteNodeData>) => setWeb(doc, ids, () => patch);
    const variants = variantsOf(doc, primary);
    const add = (kind: InteractionKind) => {
        if (kind === "hover") set({ hover: { opacity: null, scale: 1.02, y: null, duration: 150 } });
        if (kind === "press") set({ press: { opacity: null, scale: 0.97, y: null, duration: 150 } });
        if (kind === "appear") set({ effect: DEFAULT_APPEAR });
        if (kind === "parallax") set({ effect: { kind: "parallax", speed: 0.3 } });
        if (kind === "scroll") set({ effect: { kind: "scroll", trigger: "self", from: { opacity: 0.2, x: 0, y: 60, scale: 0.92, rotate: 0 }, to: { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 } } });
        if (kind === "cursor") set({ cursor: { kind: "system", cursor: "pointer" } });
        if (kind === "marquee") set({ marquee: { speed: 60, direction: "left", pauseOnHover: true } });
        if (kind === "back") set({ action: { kind: "back" } });
        if (kind === "lightbox") set({ action: { kind: "lightbox" } });
        if (kind === "scroll-to") set({ action: { kind: "scroll-to", nodeId: "", offset: 0, smooth: true } });
        if (kind === "change-to") set({ action: { kind: "change-to", trigger: "click", variantId: variants.find((v) => v.id !== primary.componentId)?.id ?? "", duration: 200 } });
    };
    const action = web.action;
    const codable = primary.type === "frame" || primary.type === "instance" || primary.type === "component";
    return (
        <>
            {!pageFrame && (
                <section className="border-b border-panel-border px-4 py-4">
                    <button
                        type="button"
                        disabled={!codable}
                        title={codable ? "Write the layer's HTML, CSS and script (it shows in Preview and on the published site)" : "Frames can be made interactive with code"}
                        onClick={() => {
                            if (web.embed?.kind !== "code") set({ embed: { kind: "code", code: "" } });
                            site.set({ rightTab: "design" });
                        }}
                        className="h-6 w-full rounded-[5px] border border-panel-border hover:bg-panel-hover disabled:opacity-50"
                    >
                        {web.embed?.kind === "code" ? "Edit code" : "Make interactive with code"}
                    </button>
                </section>
            )}
            {!pageFrame && <LinkEditor nodes={nodes} />}
            <ISection title={nodes.length > 1 ? `Interactions (${nodes.length} layers)` : "Interactions"} action={<AddInteraction web={web} node={primary} onAdd={add} only={pageFrame ? ["cursor"] : undefined} />} />
            {action?.kind === "change-to" && (
                <Section title="Change to" action={<RemoveButton label="Change to" onPress={() => set({ action: null })} />}>
                    <Row label="Variant">
                        <Select aria-label="Variant to change to" value={action.variantId} className={INPUT} onChange={(e) => set({ action: { ...action, variantId: e.target.value } })}>
                            {variants.map((v) => (
                                <option key={v.id} value={v.id} disabled={v.id === primary.componentId}>
                                    {v.name}
                                </option>
                            ))}
                        </Select>
                    </Row>
                    <Row label="Trigger">
                        <Select aria-label="Change to trigger" value={action.trigger} className={INPUT} onChange={(e) => set({ action: { ...action, trigger: e.target.value as "click" } })}>
                            <option value="click">On click (again to change back)</option>
                            <option value="hover">While hovering</option>
                            <option value="press">While pressing</option>
                        </Select>
                    </Row>
                    <Row label="Duration">
                        <Num label="Change duration" value={action.duration ?? 200} min={0} max={2000} unit="ms" onCommit={(duration) => set({ action: { ...action, duration } })} />
                    </Row>
                </Section>
            )}
            {action?.kind === "back" && (
                <Section title="Back" action={<RemoveButton label="Back" onPress={() => set({ action: null })} />}>
                    <p className="leading-4 text-ink-muted">On click, goes to the page visited before this one.</p>
                </Section>
            )}
            {action?.kind === "scroll-to" && (
                <Section title="Scroll to" action={<RemoveButton label="Scroll to" onPress={() => set({ action: null })} />}>
                    <Row label="Layer">
                        <TriggerTarget doc={doc} pageId={pageId} value={action.nodeId} except={primary.id} onChange={(nodeId) => set({ action: { ...action, nodeId } })} />
                    </Row>
                    <Row label="Offset">
                        <Num label="Scroll offset" value={action.offset} unit="px" onCommit={(offset) => set({ action: { ...action, offset } })} />
                    </Row>
                    <label className="flex items-center gap-2 pl-[80px]">
                        <input type="checkbox" checked={action.smooth} onChange={(e) => set({ action: { ...action, smooth: e.target.checked } })} /> Animate
                    </label>
                </Section>
            )}
            {action?.kind === "lightbox" && (
                <Section title="Lightbox" action={<RemoveButton label="Lightbox" onPress={() => set({ action: null })} />}>
                    <p className="leading-4 text-ink-muted">On click, the picture opens full screen. Esc or a click closes it.</p>
                </Section>
            )}
            {web.hover && <StateEditor title="Hover" about="" value={web.hover} onChange={(hover) => set({ hover })} />}
            {web.press && <StateEditor title="Press" about="" value={web.press} onChange={(press) => set({ press })} />}
            {web.effect && <EffectEditor doc={doc} pageId={pageId} self={primary.id} value={web.effect} onChange={(effect) => set({ effect })} />}
            {web.cursor && (
                <Section title="Cursor" action={<RemoveButton label="Cursor" onPress={() => set({ cursor: null })} />}>
                    <Row label="Show">
                        <Select aria-label="Cursor kind" value={web.cursor.kind} className={INPUT} onChange={(e) => set({ cursor: e.target.value === "layer" ? { kind: "layer", nodeId: "", hotspot: "center", smoothing: 0.4 } : { kind: "system", cursor: "pointer" } })}>
                            <option value="system">A standard cursor</option>
                            <option value="layer">A layer that follows the pointer</option>
                        </Select>
                    </Row>
                    {web.cursor.kind === "system" ? (
                        <Row label="Cursor">
                            <Select aria-label="Cursor" value={web.cursor.cursor} className={INPUT} onChange={(e) => set({ cursor: { kind: "system", cursor: e.target.value as "pointer" } })}>
                                {(["pointer", "grab", "crosshair", "text", "zoom-in", "help", "move", "not-allowed", "none"] as const).map((c) => (
                                    <option key={c} value={c}>
                                        {c === "none" ? "Hidden" : c.replace("-", " ")}
                                    </option>
                                ))}
                            </Select>
                        </Row>
                    ) : (
                        (() => {
                            const cursor = web.cursor;
                            return (
                                <>
                                    <Row label="Layer">
                                        <Select aria-label="Cursor layer" value={cursor.nodeId} className={INPUT} onChange={(e) => set({ cursor: { ...cursor, nodeId: e.target.value } })}>
                                            <option value="">Choose a layer…</option>
                                            {cursorLayers(doc, pageId)
                                                .filter((l) => l.id !== primary.id)
                                                .map((l) => (
                                                    <option key={l.id} value={l.id}>
                                                        {l.label}
                                                    </option>
                                                ))}
                                        </Select>
                                    </Row>
                                    <Row label="Hotspot">
                                        <Select aria-label="Cursor hotspot" value={cursor.hotspot} className={INPUT} onChange={(e) => set({ cursor: { ...cursor, hotspot: e.target.value as "center" } })}>
                                            <option value="center">Centre</option>
                                            <option value="top-left">Top left</option>
                                        </Select>
                                    </Row>
                                    <Row label="Smoothing">
                                        <Num label="Cursor smoothing" value={Math.round(cursor.smoothing * 100)} min={0} max={95} unit="%" onCommit={(v) => set({ cursor: { ...cursor, smoothing: v / 100 } })} />
                                    </Row>
                                </>
                            );
                        })()
                    )}
                </Section>
            )}
            {web.marquee && (
                <Section title="Marquee" action={<RemoveButton label="Marquee" onPress={() => set({ marquee: null })} />}>
                    <Row label="Direction">
                        <Select aria-label="Marquee direction" value={web.marquee.direction} className={INPUT} onChange={(e) => web.marquee && set({ marquee: { ...web.marquee, direction: e.target.value as "left" } })}>
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                            <option value="up">Up</option>
                            <option value="down">Down</option>
                        </Select>
                    </Row>
                    <Row label="Speed">
                        <Num label="Marquee speed" value={web.marquee.speed} min={1} max={2000} unit="px/s" onCommit={(speed) => web.marquee && set({ marquee: { ...web.marquee, speed } })} />
                    </Row>
                    <label className="flex items-center gap-2 pl-[80px]">
                        <input type="checkbox" checked={web.marquee.pauseOnHover} onChange={(e) => web.marquee && set({ marquee: { ...web.marquee, pauseOnHover: e.target.checked } })} /> Pause on hover
                    </label>
                    <p className="leading-4 text-ink-muted">The layer's content repeats to fill the loop. Use it on a frame with auto layout.</p>
                </Section>
            )}
            <ScrollBehavior nodes={nodes} root={pageFrame} />
            {!pageFrame && <Accessibility nodes={nodes} />}
        </>
    );
}

// How the layer's content overflows it (the page itself scrolls down by itself; it can also scroll
// sideways).
function ScrollBehavior({ nodes, root }: { nodes: SceneNode[]; root: boolean }) {
    const doc = useEditor((s) => s.doc);
    const node = nodes[0] as SceneNode;
    const primary = doc.nodes[primaryOf(doc, node.id)] ?? node;
    const web = webData(primary);
    // A breakpoint frame is the page: its overflow lives in the breakpoint data (Both directions on
    // new pages; pages from before scroll down only).
    const value = root ? pageOverflow(doc, node.id) : (web.overflow ?? (primary.clip ? "hidden" : "visible"));
    const options: [SiteOverflow, string][] = root
        ? [["y", "Vertical"], ["both", "Both directions"]]
        : [["visible", "Visible"], ["hidden", "Hidden"], ["y", "Vertical"], ["x", "Horizontal"], ["both", "Both directions"]];
    const change = (overflow: SiteOverflow) => {
        if (!root) return setWeb(doc, nodes.map((n) => n.id), () => ({ overflow }));
        const data = bpData(primary);
        if (data && (overflow === "y" || overflow === "both")) editor.execute({ type: "node.update", id: primary.id, patch: { site: { ...data, overflow } } });
    };
    return (
        <ISection title="Scroll behavior">
            <IRow label="Overflow">
                <Select aria-label="Overflow" value={value} className={SMALL} onChange={(e) => change(e.target.value as SiteOverflow)}>
                    {options.map(([id, label]) => (
                        <option key={id} value={id}>
                            {label}
                        </option>
                    ))}
                </Select>
            </IRow>
        </ISection>
    );
}

// The element the layer is written as, and a picture's alt text.
function Accessibility({ nodes }: { nodes: SceneNode[] }) {
    const doc = useEditor((s) => s.doc);
    const node = nodes[0] as SceneNode;
    const primary = doc.nodes[primaryOf(doc, node.id)] ?? node;
    const web = webData(primary);
    const ids = nodes.map((n) => n.id);
    const picture = (primary.type === "rect" || primary.type === "ellipse") && primary.fills.some((f) => f.type === "image");
    return (
        <ISection title="Accessibility">
            <IRow label={<><TagIcon /> Tag</>}>
                <Select aria-label="HTML element" value={web.tag ?? "auto"} className={SMALL} onChange={(e) => setWeb(doc, ids, () => ({ tag: e.target.value as WebTag }))}>
                    {TAGS.map(([id, label]) => (
                        <option key={id} value={id}>
                            {label}
                        </option>
                    ))}
                </Select>
            </IRow>
            {picture && (
                <IRow label="Alt text">
                    <Text label="Alt text" value={primary.altText ?? ""} placeholder="Describe the image" onCommit={(altText) => editor.execute({ type: "node.update", id: primary.id, patch: { altText } })} />
                </IRow>
            )}
        </ISection>
    );
}

function TagIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 4.5h8.5L13.5 8l-3 3.5H2l3-3.5z" />
        </svg>
    );
}

// The webpage itself selected: its header (page settings and preview), its position on the canvas
// (the breakpoint frames move together), the colours used on it and Export, as the reference. The
// page's name, address, search settings and breakpoints open from the header's settings button.
function WebpagePanel() {
    const doc = useEditor((s) => s.doc);
    const pageId = useEditor((s) => s.pageId);
    const [settings, setSettings] = useState(false);
    const frames = Object.values(bpFrames(doc, pageId)).filter((f): f is SceneNode => Boolean(f));
    const desktop = bpFrames(doc, pageId).desktop;
    if (!frames.length) return <PageSettings />;
    const x = Math.min(...frames.map((f) => f.x));
    const y = Math.min(...frames.map((f) => f.y));
    const move = (dx: number, dy: number) => (dx || dy) && editor.execute({ type: "node.move", ids: frames.map((f) => f.id), dx, dy });
    return (
        <>
            <HeaderSection
                title="Webpage"
                action={
                    <div className="flex items-center gap-1">
                        <IconButton size="sm" icon={Settings01} label="Page settings" active={settings} onPress={() => setSettings(!settings)} />
                        <IconButton size="sm" icon={Play} label="Preview" onPress={() => site.set({ inlinePreview: true })} />
                    </div>
                }
            />
            {settings ? (
                <PageSettings />
            ) : (
                <>
                    <PanelSection title="Position">
                        <div className={ROW}>
                            <NumberField label="X" value={Math.round(x * 100) / 100} onCommit={(v) => move(v - x, 0)} />
                            <NumberField label="Y" value={Math.round(y * 100) / 100} onCommit={(v) => move(0, v - y)} />
                        </div>
                    </PanelSection>
                    <SelectionColors nodes={frames} />
                    {desktop && <ExportSection nodes={[desktop]} />}
                </>
            )}
        </>
    );
}

// ---- Page settings (nothing selected) ----

function PageSettings() {
    const doc = useEditor((s) => s.doc);
    const pageId = useEditor((s) => s.pageId);
    const readOnly = useEditor((s) => s.readOnly);
    const page = doc.nodes[pageId];
    const data = pageData(page);
    if (!page) return null;
    if (!data) return <p className="px-3 py-3 leading-relaxed text-ink-muted">Main components shared by the site’s pages live here. Edit one and every page that uses it changes.</p>;
    const set = (patch: Partial<typeof data>) => editor.execute({ type: "node.update", id: page.id, patch: { site: { ...data, ...patch } } });
    const collection = collectionOf(doc, data.collectionId);
    return (
        <fieldset disabled={readOnly} className="m-0 border-0 p-0">
            <Section title="Page">
                <Row label="Name">
                    <Text label="Page name" value={page.name} onCommit={(name) => name.trim() && editor.execute({ type: "node.update", id: page.id, patch: { name: name.trim() } })} />
                </Row>
                {!data.notFound && (
                    <Row label="Address">
                        <Text label="Page address" value={data.path} onCommit={(path) => set({ path: uniquePathSafe(doc, path, page.id) })} />
                    </Row>
                )}
                {collection && (
                    <>
                        <p className="leading-4 text-ink-muted">
                            One page per item of {collection.name}, at {data.path === "/" ? "" : data.path}/item-slug.
                        </p>
                        <Row label="Showing">
                            <Select aria-label="Item shown while editing" value={data.previewItem ?? collection.items[0]?.id ?? ""} className={INPUT} onChange={(e) => set({ previewItem: e.target.value })}>
                                {collection.items.map((i) => (
                                    <option key={i.id} value={i.id}>{i.slug}</option>
                                ))}
                            </Select>
                        </Row>
                    </>
                )}
            </Section>
            <Section title="Search and sharing">
                <Row label="Title">
                    <Text label="Page title" value={data.title ?? ""} placeholder={page.name} onCommit={(title) => set({ title })} />
                </Row>
                <Row label="Description">
                    <Text label="Page description" multiline value={data.description ?? ""} placeholder="The site’s description" onCommit={(description) => set({ description })} />
                </Row>
                <label className="flex items-center gap-2 pl-[80px]">
                    <input type="checkbox" checked={Boolean(data.noindex)} onChange={(e) => set({ noindex: e.target.checked })} /> Hide from search engines
                </label>
            </Section>
            <Section title="Breakpoints">
                <BreakpointsEditor pageId={page.id} />
            </Section>
        </fieldset>
    );
}

function uniquePathSafe(doc: NagmaDocument, path: string, pageId: string): string {
    const taken = new Set(sitePages(doc).filter((p) => p.id !== pageId).map((p) => pageData(p)?.path));
    let next = `/${path
        .split("/")
        .map((p) => slugify(p))
        .filter((p) => p && p !== "item")
        .join("/")}`;
    let n = 2;
    const base = next;
    while (taken.has(next)) next = `${base === "/" ? "/page" : base}-${n++}`;
    return next;
}

// `top`: the people, preview and Share row; `zoom`: the zoom and view menu at the end of the tabs.
export function SiteInspector({ top, zoom }: { top?: ReactNode; zoom?: ReactNode }) {
    const selection = useEditor((s) => s.selection);
    const doc = useEditor((s) => s.doc);
    const readOnly = useEditor((s) => s.readOnly);
    const tab = useSite((s) => s.rightTab);
    const pageSelected = useSite((s) => s.pageSelected);
    const nodes = selection.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    return (
        <aside data-right-panel="" className="flex h-full w-60 shrink-0 flex-col border-l border-panel-border bg-panel text-[11px] text-ink">
            {top}
            <div className="flex h-10 shrink-0 items-center gap-1 border-b border-panel-border px-2">
                {(["design", "interactions"] as const).map((key) => (
                    <button key={key} type="button" aria-pressed={tab === key} onClick={() => site.set({ rightTab: key })} className={`h-6 rounded-[5px] px-2 font-semibold ${tab === key ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}>
                        {key === "design" ? "Design" : "Interaction"}
                    </button>
                ))}
                <div className="flex-1" />
                {zoom}
            </div>
            <fieldset disabled={readOnly} className="m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0">
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {tab === "interactions" ? (
                        <InteractionsTab nodes={nodes} />
                    ) : nodes.length === 0 ? (
                        pageSelected ? <WebpagePanel /> : <PageSettings />
                    ) : (
                        <>
                            <BreakpointSection nodes={nodes} />
                            <WebSection nodes={nodes} />
                            <SelectionPanel nodes={nodes} />
                        </>
                    )}
                </div>
            </fieldset>
        </aside>
    );
}

