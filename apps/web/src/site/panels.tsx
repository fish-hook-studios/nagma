import { Database01, DotsHorizontal, File04, Globe02, Home03, Plus, SearchSm } from "@untitledui/icons";
import { nanoid } from "nanoid";
import { useMemo, useState } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator } from "react-aria-components";
import { type LayersTreeOptions, LayersPanel } from "../components/layers-panel";
import { MenuRow } from "../components/left-sidebar";
import { allComponents } from "../engine/components";
import { makeNode } from "../engine/nodes";
import { editor, useEditor } from "../engine/store";
import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import type { Collection, FieldType } from "./types";
import { addPage, applyTemplate, BLOCKS, insertBlock, insertCollectionList, TEMPLATES } from "./blocks";
import { PRIMARY_BP, addPageCommands, bpFrames, bpOfNode, collectionOf, collectionsOf, importCsv, insideList, libraryCommand, libraryPage, newCollection, pageData, pageOfNode, parseCsv, primaryOf, sitePages, slugify, uniquePath, webData } from "./model";
import { site, useSite } from "./state";

// The left panels: File (the site's pages, then the layers of the page on show), Insert (blocks,
// shared components) and CMS (collections).

const MENU = "w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";
const ICON = "flex size-6 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-brand-500";

function Header({ title, action }: { title: string; action?: React.ReactNode }) {
    return (
        <div className="flex h-9 shrink-0 items-center justify-between pr-2 pl-3">
            <span className="font-semibold">{title}</span>
            <div className="flex items-center">{action}</div>
        </div>
    );
}

// ---- Pages ----

function setHome(pageId: string) {
    const doc = editor.get().doc;
    const commands: Command[] = [];
    for (const page of sitePages(doc)) {
        const data = pageData(page);
        if (!data) continue;
        if (page.id === pageId) commands.push({ type: "node.update", id: page.id, patch: { site: { ...data, path: "/" } } });
        else if (data.path === "/") commands.push({ type: "node.update", id: page.id, patch: { site: { ...data, path: uniquePath(doc, `/${slugify(page.name)}`, page.id) } } });
    }
    editor.execute({ type: "batch", commands });
}

function deletePage(pageId: string) {
    const doc = editor.get().doc;
    if (sitePages(doc).length <= 1) return editor.notify("A site needs at least one page.");
    if (pageData(doc.nodes[pageId])?.path === "/") return editor.notify("Make another page the home page before deleting this one.");
    const next = sitePages(doc).find((p) => p.id !== pageId);
    if (next) editor.setPage(next.id);
    editor.execute({ type: "node.delete", ids: [pageId] });
}

function duplicatePage(pageId: string) {
    const doc = editor.get().doc;
    const page = doc.nodes[pageId];
    const data = pageData(page);
    if (!page || !data) return;
    const { commands, pageId: copyId } = addPageCommands(doc, `${page.name} copy`, { ...data, path: uniquePath(doc, `${data.path === "/" ? "/home" : data.path}-copy`) });
    editor.execute({ type: "batch", commands });
    // Copy the desktop layers; the other breakpoints follow.
    const after = editor.get().doc;
    const from = bpFrames(doc, pageId).desktop;
    const to = bpFrames(after, copyId).desktop;
    if (from && to) {
        const creates: Command[] = [];
        for (const child of from.children) {
            const copies = cloneLayers(doc, child, to.id, to.x - from.x, to.y - from.y);
            copies.forEach((node) => creates.push({ type: "node.create", node: { ...node, children: [] } }));
        }
        if (creates.length) {
            editor.execute({ type: "batch", commands: creates });
            editor.mergeLast();
        }
    }
    editor.setPage(copyId);
}

// Copies a desktop layer tree under another parent, dropping breakpoint and CMS links.
function cloneLayers(doc: NagmaDocument, id: string, parentId: string, dx: number, dy: number): SceneNode[] {
    const node = doc.nodes[id];
    if (!node) return [];
    const web = node.site && !("kind" in node.site && node.site.kind) ? node.site : undefined;
    if (web && "rep" in web && web.rep) return [];
    const copy: SceneNode = { ...node, id: nanoid(10), parentId, children: [], x: node.x + dx, y: node.y + dy };
    if (web) copy.site = { ...web, src: undefined, ov: undefined };
    const out: SceneNode[] = [copy];
    if (node.type === "instance") return out;
    for (const child of node.children) out.push(...cloneLayers(doc, child, copy.id, dx, dy));
    return out;
}

function PageRow({ page, active }: { page: SceneNode; active: boolean }) {
    const data = pageData(page);
    const readOnly = useEditor((s) => s.readOnly);
    const [editing, setEditing] = useState(false);
    if (!data) return null;
    const Icon = data.path === "/" ? Home03 : data.collectionId ? Database01 : File04;
    return (
        <div data-page-row={page.id} className={`group flex h-8 items-center gap-2 rounded-[6px] pr-1 pl-2 ${active ? "bg-brand-500/12 text-ink" : "hover:bg-panel-hover"}`}>
            <Icon className={`size-3.5 shrink-0 ${active ? "text-brand-500" : "text-ink-muted"}`} />
            {editing ? (
                <input
                    autoFocus
                    defaultValue={page.name}
                    aria-label="Page name"
                    className="h-6 min-w-0 flex-1 rounded border border-brand-500 bg-field px-1 text-[11.5px] outline-none"
                    onBlur={(e) => {
                        setEditing(false);
                        const name = e.target.value.trim();
                        if (name && name !== page.name) editor.execute({ type: "node.update", id: page.id, patch: { name } });
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setEditing(false);
                    }}
                />
            ) : (
                <button type="button" className="flex min-w-0 flex-1 flex-col items-start text-left outline-none" onClick={() => editor.setPage(page.id)} onDoubleClick={() => !readOnly && setEditing(true)}>
                    <span className="max-w-full truncate leading-4">{page.name}</span>
                    <span className="max-w-full truncate text-[10px] leading-3 text-ink-muted">{data.notFound ? "Missing pages" : data.collectionId ? `${data.path === "/" ? "" : data.path}/[item]` : data.path}</span>
                </button>
            )}
            {!readOnly && (
                <AriaMenuTrigger>
                    <AriaButton aria-label={`${page.name} options`} className={`${ICON} opacity-0 group-hover:opacity-100 data-[pressed]:opacity-100`}>
                        <DotsHorizontal className="size-3.5" />
                    </AriaButton>
                    <AriaPopover placement="bottom end" className={MENU}>
                        <AriaMenu
                            aria-label="Page options"
                            className="outline-none"
                            onAction={(key) => {
                                if (key === "rename") setEditing(true);
                                if (key === "settings") {
                                    editor.setPage(page.id);
                                    editor.set({ selection: [] });
                                    site.set({ rightTab: "design" });
                                }
                                if (key === "home") setHome(page.id);
                                if (key === "duplicate") duplicatePage(page.id);
                                if (key === "delete") deletePage(page.id);
                            }}
                        >
                            <MenuRow id="settings" label="Page settings…" />
                            <MenuRow id="rename" label="Rename" />
                            {data.path !== "/" && !data.notFound && !data.collectionId && <MenuRow id="home" label="Set as home page" />}
                            <MenuRow id="duplicate" label="Duplicate" />
                            <AriaSeparator className="my-1 h-px bg-white/10" />
                            <MenuRow id="delete" label="Delete page" />
                        </AriaMenu>
                    </AriaPopover>
                </AriaMenuTrigger>
            )}
        </div>
    );
}

function PagesSection() {
    const pages = useEditor((s) => sitePages(s.doc));
    const pageId = useEditor((s) => s.pageId);
    const library = useEditor((s) => libraryPage(s.doc));
    const collections = useEditor((s) => collectionsOf(s.doc));
    const readOnly = useEditor((s) => s.readOnly);
    return (
        <section className="max-h-[46%] shrink-0 overflow-y-auto px-2 pb-2">
            <Header
                title="Webpages"
                action={
                    !readOnly && (
                        <AriaMenuTrigger>
                            <AriaButton aria-label="Add page" className={ICON}>
                                <Plus className="size-3.5" />
                            </AriaButton>
                            <AriaPopover placement="bottom end" className={MENU}>
                                <AriaMenu
                                    aria-label="Add page"
                                    className="outline-none"
                                    onAction={(key) => {
                                        const k = String(key);
                                        if (k === "blank") addPage("blank");
                                        else if (k === "404") addPage("notFound");
                                        else if (k.startsWith("item:")) addPage({ collectionId: k.slice(5) });
                                    }}
                                >
                                    <MenuRow id="blank" label="Blank page" />
                                    <MenuRow id="404" label="Page not found (404)" />
                                    {collections.length > 0 && <AriaSeparator className="my-1 h-px bg-white/10" />}
                                    {collections.map((c) => (
                                        <MenuRow key={c.id} id={`item:${c.id}`} label={`Item page for ${c.name}`} />
                                    ))}
                                </AriaMenu>
                            </AriaPopover>
                        </AriaMenuTrigger>
                    )
                }
            />
            {pages.map((p) => (
                <PageRow key={p.id} page={p} active={p.id === pageId} />
            ))}
            {library && (
                <button type="button" onClick={() => editor.setPage(library.id)} className={`mt-1 flex h-7 w-full items-center gap-2 rounded-[6px] px-2 text-left ${library.id === pageId ? "bg-brand-500/12" : "hover:bg-panel-hover"}`}>
                    <Globe02 className="size-3.5 text-ink-muted" />
                    <span className="flex-1">Components</span>
                    <span className="text-[10px] text-ink-muted">Shared</span>
                </button>
            )}
        </section>
    );
}

// Webpages, then the layers of the page on show (the file's name and Publish… sit above, in the
// panel's head).
// As the reference's layers list: the webpage as a row with its breakpoint frames under it (Desktop
// tagged Primary), and each frame's layers grouped as FIXED (fixed and sticky) and SCROLLS.
export function FilePanel() {
    const doc = useEditor((s) => s.doc);
    const pageId = useEditor((s) => s.pageId);
    const selected = useSite((s) => s.pageSelected);
    const page = doc.nodes[pageId];
    const data = pageData(page);
    const tree: LayersTreeOptions | undefined = data
        ? {
              pageRow: {
                  label: data.notFound ? page?.name ?? "Page" : data.path === "/" ? page?.name ?? "Home" : data.path,
                  icon: <File04 className="size-3.5 shrink-0 text-ink-subtle" />,
                  selected,
                  onSelect: () => {
                      editor.set({ selection: [], editingTextId: null });
                      site.set({ pageSelected: true });
                  },
              },
              groupOf: (node, parent) => {
                  if (bpOfNode(doc, parent.id)?.frame.id !== parent.id) return null;
                  return node.scrollPosition === "fixed" || node.scrollPosition === "sticky" ? "Fixed" : "Scrolls";
              },
              groupOrder: ["Fixed", "Scrolls"],
              // Desktop, Tablet, Mobile: the breakpoints from the widest down.
              topOrder: (nodes) => [...nodes].sort((a, b) => (bpOfNode(doc, a.id) && bpOfNode(doc, b.id) ? b.w - a.w : 0)),
              badge: (node) => (bpOfNode(doc, node.id)?.frame.id === node.id && bpOfNode(doc, node.id)?.bp === PRIMARY_BP ? "Primary" : null),
          }
        : undefined;
    return (
        <>
            <PagesSection />
            <div className="flex min-h-0 flex-1 flex-col border-t border-panel-border [&>section:first-child]:hidden [&>section]:border-t-0">
                <LayersPanel tree={tree} />
            </div>
        </>
    );
}

// ---- Insert ----

function TemplateList({ pageId, guard }: { pageId: string; guard: (run: () => void) => () => void }) {
    const categories = [...new Set(TEMPLATES.map((t) => t.category))];
    return (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <p className="mb-3 leading-relaxed text-ink-muted">Start a page from a template. Its blocks are added to the page on show; CMS templates also make a collection and its item page.</p>
            {categories.map((cat) => (
                <div key={cat} className="mb-3">
                    <div className="mb-1.5 text-[10.5px] font-semibold tracking-wide text-ink-muted uppercase">{cat}</div>
                    {TEMPLATES.filter((t) => t.category === cat).map((t) => (
                        <AriaButton key={t.id} onPress={guard(() => void applyTemplate(t, pageId))} className="mb-1.5 flex w-full flex-col items-start rounded-[8px] border border-panel-border bg-canvas p-2.5 text-left outline-none hover:border-brand-500 focus-visible:ring-1 focus-visible:ring-brand-500">
                            <span className="font-semibold">{t.name}</span>
                            <span className="text-[10.5px] text-ink-muted">{t.about}</span>
                        </AriaButton>
                    ))}
                </div>
            ))}
        </div>
    );
}

export function InsertPanel() {
    const [query, setQuery] = useState("");
    const tab = useSite((s) => s.insertTab);
    const pageId = useEditor((s) => s.pageId);
    const onLibrary = useEditor((s) => !pageData(s.doc.nodes[s.pageId]));
    const docNow = useEditor((s) => s.doc);
    const components = useMemo(() => allComponents(docNow), [docNow]);
    const collections = useEditor((s) => collectionsOf(s.doc));
    const q = query.trim().toLowerCase();
    const shown = BLOCKS.filter((b) => !q || `${b.name} ${b.category} ${b.about}`.toLowerCase().includes(q));
    const categories = [...new Set(shown.map((b) => b.category))];
    const guard = (run: () => void) => () => {
        if (onLibrary) return editor.notify("Open a page to insert blocks into it.");
        run();
    };
    return (
        <>
            <Header title="Insert" />
            <div role="tablist" aria-label="Insert" className="mx-3 mb-2 flex gap-0.5 rounded-[7px] bg-field p-[3px]">
                {(["blocks", "templates"] as const).map((t) => (
                    <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => site.set({ insertTab: t })} className={`h-[22px] flex-1 rounded-[5px] font-medium capitalize ${tab === t ? "bg-panel text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}>
                        {t}
                    </button>
                ))}
            </div>
            {tab === "templates" ? <TemplateList pageId={pageId} guard={guard} /> : <>
            <div className="px-3 pb-2">
                <label className="flex h-7 items-center gap-1.5 rounded-[6px] bg-field px-2">
                    <SearchSm className="size-3.5 text-ink-muted" />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search blocks" aria-label="Search blocks" className="min-w-0 flex-1 bg-transparent outline-none" />
                </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                {categories.map((cat) => (
                    <div key={cat} className="mb-3">
                        <div className="mb-1.5 text-[10.5px] font-semibold tracking-wide text-ink-muted uppercase">{cat}</div>
                        <div className="grid grid-cols-2 gap-1.5">
                            {shown
                                .filter((b) => b.category === cat)
                                .map((b) => (
                                    <button key={b.id} type="button" data-block={b.id} onClick={guard(() => void insertBlock(b, pageId))} className="flex min-h-[64px] flex-col items-start rounded-[8px] border border-panel-border bg-canvas p-2 text-left outline-none hover:border-brand-500 focus-visible:ring-1 focus-visible:ring-brand-500">
                                        <BlockSketch id={b.id} />
                                        <span className="mt-1.5 font-semibold leading-4">{b.name}</span>
                                        <span className="text-[10px] leading-3.5 text-ink-muted">{b.about}</span>
                                    </button>
                                ))}
                        </div>
                    </div>
                ))}
                {(!q || "cms collection list".includes(q)) && (
                    <div className="mb-3">
                        <div className="mb-1.5 text-[10.5px] font-semibold tracking-wide text-ink-muted uppercase">CMS</div>
                        <button type="button" data-block="cms-list" onClick={guard(() => void insertCollectionList(pageId, collections[0]?.id))} className="flex w-full flex-col items-start rounded-[8px] border border-panel-border bg-canvas p-2 text-left outline-none hover:border-brand-500">
                            <span className="font-semibold">Collection list</span>
                            <span className="text-[10px] text-ink-muted">{collections.length ? `Cards for each item in ${collections[0]?.name}` : "Makes a sample collection to start from"}</span>
                        </button>
                    </div>
                )}
                {components.length > 0 && (
                    <div>
                        <div className="mb-1.5 text-[10.5px] font-semibold tracking-wide text-ink-muted uppercase">Shared components</div>
                        {components.map((c) => (
                            <button key={c.id} type="button" onClick={guard(() => insertInstance(c.id, pageId))} className="mb-1 flex h-8 w-full items-center gap-2 rounded-[6px] border border-panel-border bg-canvas px-2 text-left hover:border-brand-500">
                                <span className="size-2 rotate-45 rounded-[1px] bg-violet-500" />
                                <span className="truncate">{c.name}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
            </>}
        </>
    );
}

// A tiny drawing of the block, so the list is quick to scan.
function BlockSketch({ id }: { id: string }) {
    const bar = "rounded-[1px] bg-ink-subtle/60";
    const box = "flex h-7 w-full items-center gap-0.5 overflow-hidden rounded-[4px] bg-panel p-1";
    switch (id) {
        case "nav":
            return (
                <div className={`${box} justify-between`}>
                    <span className={`${bar} h-1.5 w-4`} />
                    <span className="flex gap-0.5">
                        <span className={`${bar} h-1 w-2`} />
                        <span className={`${bar} h-1 w-2`} />
                        <span className={`${bar} h-1 w-2`} />
                    </span>
                    <span className="h-2 w-3 rounded-[1px] bg-brand-500" />
                </div>
            );
        case "features":
        case "testimonials":
        case "pricing":
        case "gallery":
            return (
                <div className={box}>
                    {[0, 1, 2].map((i) => (
                        <span key={i} className={`h-full flex-1 rounded-[2px] ${id === "gallery" ? "bg-brand-500/40" : "bg-ink-subtle/40"}`} />
                    ))}
                </div>
            );
        case "footer":
            return (
                <div className={`${box} bg-ink! items-end`}>
                    <span className="h-1 w-3 rounded-[1px] bg-white/60" />
                    <span className="h-1 w-2 rounded-[1px] bg-white/40" />
                </div>
            );
        default:
            return (
                <div className={`${box} flex-col justify-center`}>
                    <span className={`${bar} h-1.5 w-8`} />
                    <span className={`${bar} h-1 w-5`} />
                </div>
            );
    }
}

function insertInstance(componentId: string, pageId: string) {
    const doc = editor.get().doc;
    const component = doc.nodes[componentId];
    const desktop = bpFrames(doc, pageId).desktop;
    if (!component || !desktop) return;
    const node = makeNode(doc, "instance", { x: desktop.x, y: desktop.y + desktop.h, w: component.w, h: component.h }, desktop.id, {
        name: component.name,
        componentId,
        fills: [],
        overrides: ["sizing"],
        sizing: { h: "fill", v: component.sizing.v === "fill" ? "hug" : component.sizing.v },
    });
    // Navigation goes at the top, everything else at the end.
    const top = /nav|header/i.test(component.name);
    editor.execute({ type: "node.create", node, index: top ? 0 : desktop.children.length });
    editor.set({ selection: [node.id] });
}

// ---- CMS ----

// Connect: the selected layers inside a collection list or an item page, and the fields they can
// show. Choosing a field connects the layer; the canvas then shows the first item's value.
function ConnectSection() {
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    const readOnly = useEditor((s) => s.readOnly);
    const first = selection[0];
    if (!first) return <p className="mb-3 rounded-[6px] bg-field p-2 leading-relaxed text-ink-muted">Connect: select a text or picture layer inside a collection list or an item page to show a field in it.</p>;
    const primaryId = primaryOf(doc, first);
    const node = doc.nodes[primaryId];
    const page = pageOfNode(doc, first);
    const collection = collectionOf(doc, insideList(doc, first) ?? pageData(page)?.collectionId ?? null);
    if (!node || !collection) return <p className="mb-3 rounded-[6px] bg-field p-2 leading-relaxed text-ink-muted">Connect: the selected layer isn’t in a collection list or an item page.</p>;
    const isText = node.type === "text";
    const fields = collection.fields.filter((f) => (isText ? f.type !== "image" : f.type === "image"));
    const bound = webData(node).bind?.field ?? null;
    const set = (field: string | null) => {
        const commands: Command[] = selection.map((id) => primaryOf(doc, id)).filter((id, i, all) => all.indexOf(id) === i).map((id) => ({ type: "node.update" as const, id, patch: { site: { ...webData(doc.nodes[id]), bind: field ? { field } : null } } }));
        editor.execute({ type: "batch", commands });
    };
    return (
        <div className="mb-3 rounded-[8px] border border-brand-500/40 bg-brand-500/5 p-2.5" aria-label="Connect">
            <div className="mb-1 font-semibold">Connect {node.name}</div>
            <div className="mb-1.5 text-[10.5px] text-ink-muted">{collection.name} fields that fit a {isText ? "text" : "picture"} layer</div>
            {fields.length === 0 && <p className="text-ink-muted">No {isText ? "text" : "image"} fields yet.</p>}
            {[...fields, ...(isText ? [{ id: "slug", name: "Slug" }] : [])].map((f) => (
                <button key={f.id} type="button" disabled={readOnly} aria-pressed={bound === f.id} onClick={() => set(bound === f.id ? null : f.id)} className={`mb-1 flex h-7 w-full items-center justify-between rounded-[5px] border px-2 text-left ${bound === f.id ? "border-brand-500 bg-brand-500/10 text-brand-500" : "border-panel-border bg-panel hover:bg-panel-hover"}`}>
                    <span>{f.name}</span>
                    <span className="text-[10px]">{bound === f.id ? "Connected" : "Connect"}</span>
                </button>
            ))}
        </div>
    );
}

function importCsvCollection() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv,text/tab-separated-values";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file || file.size > 5 * 1024 * 1024) return file && editor.notify("That CSV is larger than 5 MB.");
        const empty = { ...newCollection(file.name.replace(/\.[^.]+$/, "") || "Imported"), fields: [] };
        const { collection, added } = importCsv(empty, parseCsv(await file.text()));
        if (!added) return editor.notify("No rows found. The first row should name the columns.");
        const doc = editor.get().doc;
        const command = libraryCommand(doc, { collections: [...collectionsOf(doc), collection] });
        if (command) editor.execute(command);
        editor.notify(`Imported ${added} ${added === 1 ? "item" : "items"} into ${collection.name}.`);
    };
    input.click();
}

function createCollection(template?: CmsTemplate) {
    const doc = editor.get().doc;
    const collections = collectionsOf(doc);
    const collection = template ? templateCollection(template) : newCollection(`Collection ${collections.length + 1}`);
    const command = libraryCommand(doc, { collections: [...collections, collection] });
    if (command) editor.execute(command);
    site.set({ dialog: { kind: "collection", id: collection.id } });
}

// Starting points for a collection: its name and fields (the first is the item's title).
type CmsTemplate = { name: string; fields: [string, FieldType][]; sketch: string };
const CMS_TEMPLATES: CmsTemplate[] = [
    { name: "Blog Articles", fields: [["Title", "text"], ["Summary", "text"], ["Body", "richtext"], ["Cover", "image"], ["Author", "text"], ["Published", "date"]], sketch: "article" },
    { name: "Case Studies", fields: [["Title", "text"], ["Client", "text"], ["Summary", "text"], ["Story", "richtext"], ["Hero image", "image"], ["Link", "link"]], sketch: "case" },
    { name: "Events", fields: [["Title", "text"], ["Date", "date"], ["Location", "text"], ["Description", "richtext"], ["Image", "image"], ["Tickets", "link"]], sketch: "event" },
    { name: "Job Listings", fields: [["Title", "text"], ["Team", "text"], ["Location", "text"], ["Description", "richtext"], ["Apply", "link"]], sketch: "job" },
];

function templateCollection(t: CmsTemplate): Collection {
    const base = newCollection(t.name);
    return { ...base, fields: t.fields.map(([name, type]) => ({ id: nanoid(6), name, type })) };
}

// The left panel in the CMS: Collections with "+", an Edit │ Connect switch (Connect needs a
// collection), the collections list, and in Connect the fields of the selected layer.
export function CmsPanel() {
    const collections = useEditor((s) => collectionsOf(s.doc));
    const readOnly = useEditor((s) => s.readOnly);
    const mode = useSite((s) => s.cmsMode);
    const connect = mode === "connect" && collections.length > 0;
    return (
        <>
            <div className="flex h-10 shrink-0 items-center justify-between pr-2 pl-4">
                <span className="font-semibold">Collections</span>
                {!readOnly && (
                    <AriaButton aria-label="New collection" onPress={() => createCollection()} className={ICON}>
                        <Plus className="size-3.5" />
                    </AriaButton>
                )}
            </div>
            <div role="radiogroup" aria-label="CMS mode" className="mx-3 mb-2 flex h-6 rounded-[5px] bg-field p-px">
                {(["edit", "connect"] as const).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={(m === "connect") === connect} disabled={m === "connect" && !collections.length} onClick={() => site.set({ cmsMode: m })} className={`flex-1 rounded-[4px] text-[11px] capitalize disabled:opacity-40 ${(m === "connect") === connect ? "bg-panel text-ink shadow-sm ring-1 ring-panel-border" : "text-ink-muted hover:text-ink"}`}>
                        {m}
                    </button>
                ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                {connect ? (
                    <ConnectSection />
                ) : (
                    collections.map((c) => (
                        <button key={c.id} type="button" onClick={() => site.set({ dialog: { kind: "collection", id: c.id } })} className="flex h-8 w-full items-center gap-2 rounded-[5px] px-1.5 text-left hover:bg-panel-hover">
                            <Database01 className="size-3.5 text-ink-muted" />
                            <span className="flex-1 truncate">{c.name}</span>
                            <span className="text-[10.5px] text-ink-muted">{c.items.length}</span>
                        </button>
                    ))
                )}
            </div>
        </>
    );
}

function TemplateSketch({ kind }: { kind: string }) {
    return (
        <span className="flex h-[118px] w-full flex-col overflow-hidden rounded-[6px] bg-white p-2.5 text-left text-[7px] leading-[9px] text-[#1E1E1E]">
            {kind === "article" && (
                <>
                    <span className="mb-1 h-10 rounded-[3px] bg-[#E6E6E6]" />
                    <span className="font-semibold">How we grew a garden on the roof</span>
                    <span className="mt-0.5 text-[#757575]">A short read about soil, sun and patience.</span>
                </>
            )}
            {kind === "case" && (
                <>
                    <span className="text-[#757575]">Client story</span>
                    <span className="mt-0.5 text-[10px] font-semibold leading-3">A faster checkout for a local bakery</span>
                    <span className="mt-1.5 h-10 rounded-[3px] bg-[#E6E6E6]" />
                </>
            )}
            {kind === "event" && (
                <span className="m-auto text-center">
                    <span className="block text-[#757575]">March 17 · 9:30</span>
                    <span className="block text-[10px] font-semibold leading-3">Coffee and a talk on community solar</span>
                    <span className="mx-auto mt-1 block h-1.5 w-5 rounded-sm bg-[#1E1E1E]" />
                </span>
            )}
            {kind === "job" && (
                <>
                    <span className="flex items-center justify-between font-semibold"><span>Senior Product Designer</span><span className="h-1.5 w-4 rounded-sm bg-[#1E1E1E]" /></span>
                    <span className="mt-0.5 text-[#757575]">Remote · Full time</span>
                    <span className="mt-1 text-[#757575]">Help shape the tools our customers use every day, from first sketch to launch.</span>
                </>
            )}
        </span>
    );
}

// The CMS view in place of the canvas: with no collections, "Create your site's CMS", Create new,
// Import CSV and four starting templates; then each collection as a card (edit items, insert a list,
// its item page).
export function CmsView() {
    const collections = useEditor((s) => collectionsOf(s.doc));
    const pages = useEditor((s) => sitePages(s.doc));
    const pageId = useEditor((s) => s.pageId);
    const readOnly = useEditor((s) => s.readOnly);
    const card = "h-6 rounded-[5px] border border-panel-border bg-panel px-2 outline-none hover:bg-panel-hover";
    return (
        <div className="min-h-0 flex-1 overflow-y-auto">
            {collections.length === 0 ? (
                <div className="mx-auto flex max-w-[960px] flex-col items-center px-8 pt-[200px] pb-10 text-center">
                    <h2 className="text-[24px] font-semibold leading-8 text-ink">Create your site’s CMS</h2>
                    <p className="mt-2 max-w-[270px] text-[11px] leading-4 text-ink-muted">Manage all of your site content in one place. Start with a template, or make your own.</p>
                    {!readOnly && (
                        <div className="mt-6 flex gap-2">
                            <AriaButton onPress={() => createCollection()} className="flex h-6 items-center gap-1 rounded-[5px] bg-brand-500 px-2 text-[11px] text-white outline-none hover:brightness-110">
                                <Plus className="size-3.5" /> Create new
                            </AriaButton>
                            <AriaButton onPress={importCsvCollection} className="flex h-6 items-center gap-1 rounded-[5px] border border-panel-border px-2 text-[11px] text-ink outline-none hover:bg-panel-hover">
                                Import CSV
                            </AriaButton>
                        </div>
                    )}
                    <div className="mt-6 grid w-full grid-cols-4 gap-6">
                        {CMS_TEMPLATES.map((t) => (
                            <AriaButton key={t.name} isDisabled={readOnly} onPress={() => createCollection(t)} className="flex flex-col items-center gap-4 outline-none">
                                <span className="flex w-full rounded-xl border border-panel-border bg-panel px-4 pt-4 hover:border-brand-500">
                                    <TemplateSketch kind={t.sketch} />
                                </span>
                                <span className="text-[11px] font-semibold text-ink">{t.name}</span>
                            </AriaButton>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="mx-auto grid max-w-[960px] grid-cols-3 gap-4 p-8">
                    {collections.map((c) => {
                        const itemPage = pages.find((p) => pageData(p)?.collectionId === c.id);
                        return (
                            <div key={c.id} className="rounded-[8px] border border-panel-border bg-panel p-3">
                                <div className="flex items-center gap-2">
                                    <Database01 className="size-3.5 text-brand-500" />
                                    <span className="flex-1 truncate font-semibold">{c.name}</span>
                                    <span className="text-ink-muted">
                                        {c.items.length} {c.items.length === 1 ? "item" : "items"}
                                    </span>
                                </div>
                                <div className="mt-1 text-[10.5px] text-ink-muted">{c.fields.map((f) => f.name).join(", ")}</div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                    <AriaButton onPress={() => site.set({ dialog: { kind: "collection", id: c.id } })} className={card}>
                                        {readOnly ? "View items" : "Edit items"}
                                    </AriaButton>
                                    {!readOnly && (
                                        <AriaButton onPress={() => (pageData(editor.get().doc.nodes[pageId]) ? (void insertCollectionList(pageId, c.id), site.set({ panel: "file" })) : editor.notify("Open a page to insert the list into."))} className={card}>
                                            Insert list
                                        </AriaButton>
                                    )}
                                    {itemPage ? (
                                        <AriaButton onPress={() => (editor.setPage(itemPage.id), site.set({ panel: "file" }))} className={card}>
                                            Item page
                                        </AriaButton>
                                    ) : (
                                        !readOnly && (
                                            <AriaButton onPress={() => addPage({ collectionId: c.id })} className={card}>
                                                Make item page
                                            </AriaButton>
                                        )
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {!readOnly && (
                        <div className="col-span-3 flex gap-2">
                            <AriaButton onPress={() => createCollection()} className="flex h-6 items-center gap-1 rounded-[5px] bg-brand-500 px-2 text-[11px] text-white outline-none hover:brightness-110">
                                <Plus className="size-3.5" /> New collection
                            </AriaButton>
                            <AriaButton onPress={importCsvCollection} className="flex h-6 items-center gap-1 rounded-[5px] border border-panel-border px-2 text-[11px] text-ink outline-none hover:bg-panel-hover">
                                Import CSV
                            </AriaButton>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
