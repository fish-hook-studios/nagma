import { AlertTriangle, Copy01, DotsHorizontal, LinkExternal01, Plus, Trash01, Upload01, X } from "@untitledui/icons";
import { nanoid } from "nanoid";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { Select } from "../components/select";
import { useCollab } from "../engine/collab";
import { imageSrc, storeImage } from "../engine/image-store";
import { storeMedia, loadMedia } from "../engine/media";
import { editor, useEditor } from "../engine/store";
import type { Command } from "../engine/types";
import { collectionOf, collectionsOf, importCsv, itemTitle, libraryCommand, parseCsv, settingsOf, uniqueSlug } from "./model";
import { HostingSection } from "./hosting-section";
import { downloadSite, publishSite, publishStatus, sharedId, siteHostingApi, siteUrl, unpublishSite, type PublishStatus } from "./publish";
import { site, useSite } from "./state";
import type { Collection, CollectionField, CollectionItem, FieldType, SiteFont, SiteSettings } from "./types";

// The site's dialogs: settings, publishing, and a collection's fields and items.

const close = () => site.set({ dialog: null });
const INPUT = "h-8 w-full min-w-0 rounded-[6px] border border-panel-border bg-field px-2 text-[12px] text-ink outline-none focus:border-brand-500";
const PRIMARY = "h-8 rounded-[6px] bg-brand-500 px-3 text-[12px] font-semibold text-white outline-none hover:brightness-110 disabled:opacity-50";
const SECONDARY = "h-8 rounded-[6px] border border-panel-border px-3 text-[12px] text-ink outline-none hover:bg-panel-hover disabled:opacity-50";

function Shell({ title, width = 560, children, footer }: { title: string; width?: number; children: ReactNode; footer?: ReactNode }) {
    return (
        <AriaModalOverlay isOpen onOpenChange={(open) => !open && close()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-16">
            <AriaModal style={{ width }} className="max-h-[calc(100vh-96px)] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                <AriaDialog aria-label={title} className="flex max-h-[calc(100vh-96px)] flex-col outline-none">
                    <div className="flex h-11 shrink-0 items-center justify-between border-b border-panel-border px-4">
                        <h2 className="text-[13px] font-semibold">{title}</h2>
                        <button type="button" aria-label="Close" onClick={close} className="rounded p-1 text-ink-muted hover:bg-panel-hover">
                            <X className="size-4" />
                        </button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-[12px]">{children}</div>
                    {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-panel-border px-4 py-3">{footer}</div>}
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
    return (
        <label className="mb-3 block">
            <span className="mb-1 block font-medium">{label}</span>
            {children}
            {hint && <span className="mt-1 block text-[11px] leading-4 text-ink-muted">{hint}</span>}
        </label>
    );
}

function CodeWarning() {
    return (
        <div className="mb-3 flex gap-2 rounded-[8px] bg-amber-500/12 p-2.5 leading-4">
            <AlertTriangle className="mt-px size-4 shrink-0 text-amber-600" />
            <span>Code here is added to every published page exactly as written and runs for every visitor. Only people who can edit this file can change it. Only paste code you trust.</span>
        </div>
    );
}

function pickFile(accept: string): Promise<File | null> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept;
        input.onchange = () => resolve(input.files?.[0] ?? null);
        input.click();
    });
}

// Adds a picked image to the document and returns its id.
async function addImage(): Promise<{ id: string; command: Command } | null> {
    const file = await pickFile("image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/x-icon");
    if (!file) return null;
    const id = nanoid(12);
    return { id, command: { type: "image.add", id, data: await storeImage(file) } };
}

function ImagePick({ value, onPick, label }: { value: string | null; onPick: (id: string | null, command?: Command) => void; label: string }) {
    const src = useEditor((s) => (value ? imageSrc(s.doc.images, value) : null));
    return (
        <div className="flex items-center gap-2">
            <div className="flex size-12 items-center justify-center overflow-hidden rounded-[6px] border border-panel-border bg-field">{src ? <img src={src} alt="" className="size-full object-cover" /> : <span className="text-[10px] text-ink-subtle">None</span>}</div>
            <button
                type="button"
                className={SECONDARY}
                aria-label={`Upload ${label}`}
                onClick={() =>
                    void addImage().then((r) => {
                        if (r) onPick(r.id, r.command);
                    })
                }
            >
                <span className="flex items-center gap-1.5">
                    <Upload01 className="size-3.5" /> Upload
                </span>
            </button>
            {value && (
                <button type="button" className={SECONDARY} onClick={() => onPick(null)}>
                    Remove
                </button>
            )}
        </div>
    );
}

// ---- Settings ----

function SettingsDialog({ tab: initial }: { tab?: "general" | "seo" | "fonts" | "code" }) {
    const settings = useEditor((s) => settingsOf(s.doc));
    const readOnly = useEditor((s) => s.readOnly);
    const [tab, setTab] = useState(initial ?? "general");
    const set = (patch: Partial<SiteSettings>, extra?: Command) => {
        const command = libraryCommand(editor.get().doc, { settings: { ...settingsOf(editor.get().doc), ...patch } });
        if (!command) return;
        editor.execute(extra ? { type: "batch", commands: [extra, command] } : command);
    };
    const text = (key: keyof SiteSettings, multiline = false, placeholder = "") =>
        multiline ? (
            <textarea key={String(settings[key])} defaultValue={String(settings[key] ?? "")} placeholder={placeholder} rows={key === "description" ? 3 : 6} spellCheck={key === "description"} className={`${INPUT} h-auto py-1.5 ${key === "description" ? "" : "font-mono text-[11px]"}`} onBlur={(e) => e.target.value !== settings[key] && set({ [key]: e.target.value })} />
        ) : (
            <input key={String(settings[key])} defaultValue={String(settings[key] ?? "")} placeholder={placeholder} className={INPUT} onBlur={(e) => e.target.value !== settings[key] && set({ [key]: e.target.value })} />
        );
    const tabs = [
        ["general", "General"],
        ["seo", "Search and sharing"],
        ["fonts", "Fonts"],
        ["code", "Custom code"],
    ] as const;
    return (
        <Shell title="Site settings" width={640}>
            <div className="-mt-1 mb-4 flex gap-1 border-b border-panel-border">
                {tabs.map(([id, label]) => (
                    <button key={id} type="button" onClick={() => setTab(id)} className={`-mb-px h-8 border-b-2 px-2 font-medium ${tab === id ? "border-brand-500 text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}>
                        {label}
                    </button>
                ))}
            </div>
            <fieldset disabled={readOnly} className="m-0 border-0 p-0">
                {tab === "general" && (
                    <>
                        <Field label="Site title" hint="Shown in browser tabs after each page’s own title.">
                            {text("title", false, "My site")}
                        </Field>
                        <Field label="Language" hint="A language code, like en, fr or pt-BR.">
                            {text("lang", false, "en")}
                        </Field>
                        <Field label="Favicon" hint="The small picture in browser tabs. A square image of 48 by 48 or larger.">
                            <ImagePick label="favicon" value={settings.favicon} onPick={(favicon, command) => set({ favicon }, command)} />
                        </Field>
                        <Field label="Page transition" hint="How one page gives way to the next when people follow a link.">
                            <Select aria-label="Page transition" value={settings.transition} className={INPUT} onChange={(e) => set({ transition: e.target.value as SiteSettings["transition"] })}>
                                <option value="none">None</option>
                                <option value="fade">Fade</option>
                                <option value="slide">Slide up</option>
                                <option value="zoom">Zoom</option>
                            </Select>
                        </Field>
                    </>
                )}
                {tab === "seo" && (
                    <>
                        <Field label="Description" hint="What search engines and link previews show. Pages can set their own.">
                            {text("description", true, "A short summary of the site")}
                        </Field>
                        <Field label="Social image" hint="Shown when the site is shared. 1200 by 630 works well.">
                            <ImagePick label="social image" value={settings.socialImage} onPick={(socialImage, command) => set({ socialImage }, command)} />
                        </Field>
                        <label className="flex items-center gap-2">
                            <input type="checkbox" checked={settings.noindex} onChange={(e) => set({ noindex: e.target.checked })} /> Keep the whole site out of search engines
                        </label>
                    </>
                )}
                {tab === "fonts" && <FontsTab settings={settings} set={set} />}
                {tab === "code" && (
                    <>
                        <CodeWarning />
                        <Field label="Analytics" hint="Paste the snippet your analytics service gives you. It goes in every page’s head.">
                            {text("analytics", true, "<script>…</script>")}
                        </Field>
                        <Field label="Head code" hint="Added at the end of each page’s head: meta tags, styles, scripts.">
                            {text("headCode", true, "<style>…</style>")}
                        </Field>
                        <Field label="Body code" hint="Added at the end of each page’s body.">
                            {text("bodyCode", true, "<script>…</script>")}
                        </Field>
                    </>
                )}
            </fieldset>
        </Shell>
    );
}

const FONT_FORMATS: Record<string, SiteFont["format"]> = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };

function FontsTab({ settings, set }: { settings: SiteSettings; set: (patch: Partial<SiteSettings>) => void }) {
    const upload = async () => {
        const file = await pickFile(".woff2,.woff,.ttf,.otf");
        if (!file) return;
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        const format = FONT_FORMATS[ext];
        if (!format) return editor.notify("Use a .woff2, .woff, .ttf or .otf font file.");
        const media = nanoid(14);
        await storeMedia(media, file);
        const family = file.name
            .replace(/\.[^.]+$/, "")
            .replace(/[-_](regular|bold|italic|medium|light|semibold|black|thin)$/i, "")
            .replace(/[-_]+/g, " ")
            .trim();
        const weight = /bold/i.test(file.name) ? 700 : /semibold/i.test(file.name) ? 600 : /medium/i.test(file.name) ? 500 : /light/i.test(file.name) ? 300 : 400;
        set({ fonts: [...settings.fonts, { id: nanoid(8), family, media, format, weight, italic: /italic/i.test(file.name) }] });
        await registerFont({ id: "", family, media, weight, italic: /italic/i.test(file.name) });
    };
    return (
        <>
            <label className="mb-4 flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={settings.webFonts} onChange={(e) => set({ webFonts: e.target.checked })} />
                <span>
                    Load the fonts used in the design from the web font service
                    <span className="block text-[11px] text-ink-muted">Turn off if the site should never contact another server for fonts. Text then falls back to the visitor’s own fonts unless you upload them below.</span>
                </span>
            </label>
            <div className="mb-2 font-medium">Uploaded fonts</div>
            {settings.fonts.length === 0 && <p className="mb-2 text-ink-muted">None yet. Upload a font file to use a typeface the web font service doesn’t have, and pick it in the text properties.</p>}
            {settings.fonts.map((f) => (
                <div key={f.id} className="mb-1.5 flex items-center gap-2 rounded-[6px] border border-panel-border px-2 py-1.5">
                    <input
                        defaultValue={f.family}
                        aria-label="Font family name"
                        className={`${INPUT} h-7 flex-1`}
                        onBlur={(e) => e.target.value.trim() && e.target.value !== f.family && set({ fonts: settings.fonts.map((x) => (x.id === f.id ? { ...x, family: e.target.value.trim() } : x)) })}
                    />
                    <span className="text-ink-muted">
                        {f.weight ?? 400}
                        {f.italic ? " italic" : ""}
                    </span>
                    <button type="button" aria-label={`Remove ${f.family}`} className="rounded p-1 text-ink-muted hover:bg-panel-hover" onClick={() => set({ fonts: settings.fonts.filter((x) => x.id !== f.id) })}>
                        <Trash01 className="size-3.5" />
                    </button>
                </div>
            ))}
            <button type="button" className={`${SECONDARY} mt-1`} onClick={() => void upload()}>
                <span className="flex items-center gap-1.5">
                    <Upload01 className="size-3.5" /> Upload a font
                </span>
            </button>
        </>
    );
}

// Uploaded fonts are installed in the editor too, so the canvas sets text in them.
const registered = new Set<string>();
async function registerFont(font: SiteFont) {
    if (!font.media || registered.has(font.media)) return;
    registered.add(font.media);
    const blob = await loadMedia(font.media);
    if (!blob) return;
    try {
        const face = new FontFace(font.family, await blob.arrayBuffer(), { weight: String(font.weight ?? 400), style: font.italic ? "italic" : "normal" });
        await face.load();
        document.fonts.add(face);
        editor.refreshText();
    } catch {
        registered.delete(font.media);
    }
}

function useSiteFonts() {
    const fonts = useEditor((s) => settingsOf(s.doc).fonts);
    useEffect(() => {
        for (const f of fonts) void registerFont(f);
    }, [fonts]);
}

// ---- Publish ----

function ago(at: number): string {
    const s = Math.round((Date.now() - at) / 1000);
    if (s < 45) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
    return new Date(at).toLocaleString();
}

let publishedDoc: unknown = null;

// Publishing: a 380-wide popover at the canvas's top left (from Publish… in the left panel). A 40pt
// header, then Site title, Site URL, Status and Issues on a 32pt pitch, a note, and a full-width
// Publish. Unpublishing, downloading the site and its address and domain are under More options.
function PublishDialog() {
    const readOnly = useEditor((s) => s.readOnly);
    const role = useCollab((s) => s.role);
    const fileId = useCollab((s) => (s.status !== "local" ? s.fileId : null));
    const changed = useEditor((s) => publishedDoc !== null && s.doc !== publishedDoc);
    const title = useEditor((s) => settingsOf(s.doc).title);
    const name = useEditor((s) => s.doc.name);
    const [status, setStatus] = useState<PublishStatus | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [copied, setCopied] = useState(false);
    const [more, setMore] = useState(false);
    const [at, setAt] = useState<{ left: number; top: number } | null>(null);
    const ref = useRef<HTMLDivElement>(null);
    const canPublish = !readOnly && (!role || role === "edit");
    useEffect(() => {
        if (fileId) void publishStatus(fileId).then(setStatus);
    }, [fileId]);
    // Anchored to the canvas: 7pt in from its left edge, 11pt down.
    useLayoutEffect(() => {
        const place = () => {
            const box = document.querySelector("[data-site-canvas]")?.getBoundingClientRect();
            setAt(box ? { left: box.left + 7, top: box.top + 11 } : { left: 64, top: 48 });
        };
        place();
        window.addEventListener("resize", place);
        return () => window.removeEventListener("resize", place);
    }, []);
    useEffect(() => {
        const away = (e: PointerEvent) => {
            const target = e.target as Element | null;
            if (ref.current?.contains(target) || target?.closest("[role=menu], [role=listbox], [role=dialog][aria-modal]")) return;
            close();
        };
        const key = (e: KeyboardEvent) => e.key === "Escape" && close();
        window.addEventListener("pointerdown", away, true);
        window.addEventListener("keydown", key);
        return () => {
            window.removeEventListener("pointerdown", away, true);
            window.removeEventListener("keydown", key);
        };
    }, []);
    const publish = async () => {
        setError(null);
        setBusy("Publishing…");
        const result = await publishSite((t) => setBusy(t));
        setBusy(null);
        if (!result.ok) return setError(result.error);
        publishedDoc = editor.get().doc;
        setStatus(result.status);
        setWarnings(result.warnings);
    };
    const unpublish = async () => {
        const id = sharedId();
        if (!id) return;
        setBusy("Taking the site down…");
        if (await unpublishSite(id)) setStatus(await publishStatus(id));
        setBusy(null);
    };
    const setTitle = (value: string) => {
        if (value === title) return;
        const command = libraryCommand(editor.get().doc, { settings: { ...settingsOf(editor.get().doc), title: value } });
        if (command) editor.execute(command);
    };
    const url = fileId ? siteUrl(fileId) : null;
    const live = Boolean(status?.published && url);
    const row = "flex h-8 items-center px-4";
    const label = "w-[132px] shrink-0 text-ink-muted";
    if (!at) return null;
    return (
        <div ref={ref} role="dialog" aria-label="Publish site" className="fixed z-50 w-[380px] overflow-hidden rounded-[13px] bg-panel-raised ring-1 ring-panel-border text-[11px] text-ink shadow-2xl" style={at}>
            <div className="flex h-10 items-center justify-between border-b border-panel-border pl-4 pr-2">
                <h2 className="flex-1 text-[11px] font-semibold">Publish site</h2>
                <button type="button" aria-label="More options" title="More options" aria-expanded={more} onClick={() => setMore(!more)} className={`flex size-6 items-center justify-center rounded-[5px] text-ink-muted hover:bg-panel-hover hover:text-ink ${more ? "bg-panel-hover" : ""}`}>
                    <DotsHorizontal className="size-4" />
                </button>
                <button type="button" aria-label="Close" onClick={close} className="flex size-6 items-center justify-center rounded-[5px] text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <X className="size-4" />
                </button>
            </div>
            <div className="py-3">
                <div className={row}>
                    <span className={label}>Site title</span>
                    <input key={title} aria-label="Site title" defaultValue={title} placeholder={name || "Untitled"} disabled={!canPublish} onBlur={(e) => setTitle(e.target.value.trim())} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className="h-6 w-[185px] min-w-0 rounded-[5px] bg-field px-2 text-[11px] outline-none placeholder:text-ink-subtle focus:ring-1 focus:ring-brand-500" />
                </div>
                <div className={row}>
                    <span className={label}>Site URL</span>
                    {live && url ? (
                        <span className="flex min-w-0 items-center gap-1">
                            <a href={url} target="_blank" rel="noreferrer" className="truncate text-ink hover:underline" aria-label="Open the site">{url.replace(/^https?:\/\//, "")}</a>
                            <button
                                type="button"
                                aria-label="Copy address"
                                title={copied ? "Copied" : "Copy address"}
                                className="flex size-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink"
                                onClick={() => {
                                    void navigator.clipboard?.writeText(url);
                                    setCopied(true);
                                    setTimeout(() => setCopied(false), 1500);
                                }}
                            >
                                <Copy01 className="size-3" />
                            </button>
                        </span>
                    ) : (
                        <span className="text-ink-muted">Given when you publish</span>
                    )}
                </div>
                <div className={row}>
                    <span className={label}>Status</span>
                    <span className="flex h-5 items-center gap-1.5 rounded-[4px] bg-field px-1.5" data-publish-status>
                        {live && <span className={`size-1.5 rounded-full ${changed ? "bg-amber-500" : "bg-emerald-500"}`} />}
                        {busy ?? (live ? (changed ? "Published, with changes since" : `Published${status?.publishedAt ? ` ${ago(status.publishedAt)}` : ""}`) : "Not published")}
                    </span>
                </div>
                <div className={row}>
                    <span className={label}>Issues</span>
                    <span className={error || warnings.length ? "text-amber-600" : "text-ink-muted"}>{error ? "Couldn’t publish" : warnings.length ? `${warnings.length} to look at` : "None found"}</span>
                </div>
            </div>
            {(error || warnings.length > 0) && (
                <div className="space-y-1.5 px-4 pb-2">
                    {error && <p className="rounded-[5px] bg-rose-500/12 p-2 text-rose-600">{error}</p>}
                    {warnings.map((w) => (
                        <p key={w} className="rounded-[5px] bg-amber-500/12 p-2">
                            {w}
                        </p>
                    ))}
                </div>
            )}
            <div className="border-t border-panel-border px-4 pt-4 pb-[15px]">
                <p className="mb-3 leading-4 text-ink-muted">
                    {!canPublish ? "Only people who can edit this file can publish it. You can still preview it or download it." : !fileId ? "This file is only on this computer. Publishing saves it to your team’s server first, like sharing it." : "Publishing makes the site a website on your team’s server that anyone on the network can open. Publish again to show your changes."}
                </p>
                <button type="button" className="h-6 w-full rounded-[5px] bg-brand-500 text-[11px] text-white outline-none hover:brightness-110 disabled:opacity-50" disabled={!canPublish || Boolean(busy)} onClick={() => void publish()}>
                    {busy ?? (live ? "Publish changes" : "Publish")}
                </button>
                {more && (
                    <div className="mt-3 space-y-2">
                        <div className="flex gap-1.5">
                            <button type="button" className={`${SECONDARY} h-6 text-[11px]`} onClick={() => void downloadSite()}>
                                Download site (.zip)
                            </button>
                            {live && canPublish && (
                                <button type="button" className={`${SECONDARY} h-6 text-[11px]`} disabled={Boolean(busy)} onClick={() => void unpublish()}>
                                    Unpublish
                                </button>
                            )}
                            {live && url && (
                                <a href={url} target="_blank" rel="noreferrer" aria-label="Open the site" className={`${SECONDARY} flex h-6 items-center text-[11px]`}>
                                    <LinkExternal01 className="size-3.5" />
                                </a>
                            )}
                        </div>
                        {live && status?.publishedAt && (
                            <p className="text-ink-muted">
                                Last published {ago(status.publishedAt)}
                                {status.by ? ` by ${status.by}` : ""}. {status.pages} {status.pages === 1 ? "page" : "pages"}, {Math.max(1, Math.round(status.bytes / 1024))} KB.
                            </p>
                        )}
                        {fileId && status && <HostingSection key={`${fileId}:${status.publishedAt ?? 0}`} api={siteHostingApi(fileId)} canEdit={canPublish} />}
                    </div>
                )}
            </div>
        </div>
    );
}

// ---- Collections ----

const FIELD_TYPES: [FieldType, string][] = [
    ["text", "Text"],
    ["richtext", "Rich text"],
    ["image", "Image"],
    ["link", "Link"],
    ["date", "Date"],
    ["number", "Number"],
];

function saveCollection(next: Collection, extra: Command[] = []) {
    const doc = editor.get().doc;
    const command = libraryCommand(doc, { collections: collectionsOf(doc).map((c) => (c.id === next.id ? next : c)) });
    if (command) editor.execute(extra.length ? { type: "batch", commands: [...extra, command] } : command);
}

// Picks a CSV file and adds its rows to a collection.
function pickCsv(collection: Collection) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv,text/tab-separated-values";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) return editor.notify("That CSV is larger than 5 MB.");
        const rows = parseCsv(await file.text());
        const current = collectionOf(editor.get().doc, collection.id) ?? collection;
        const { collection: next, added } = importCsv(current, rows);
        if (!added) return editor.notify("No rows found. The first row should name the columns.");
        saveCollection(next);
        editor.notify(`Imported ${added} ${added === 1 ? "item" : "items"} from ${file.name}.`);
    };
    input.click();
}

// Rich text: bold, italic, links, lists and subheadings, kept as simple HTML.
function RichCell({ value, label, onCommit }: { value: string; label: string; onCommit: (html: string) => void }) {
    const run = (command: string, arg?: string) => document.execCommand(command, false, arg);
    const tool = "h-5 min-w-5 rounded px-1 text-[10.5px] text-ink-muted hover:bg-panel-hover hover:text-ink";
    return (
        <div className="group rounded border border-transparent focus-within:border-brand-500 focus-within:bg-field">
            <div className="hidden gap-0.5 px-0.5 pt-0.5 group-focus-within:flex" onMouseDown={(e) => e.preventDefault()}>
                <button type="button" aria-label="Bold" className={`${tool} font-bold`} onClick={() => run("bold")}>B</button>
                <button type="button" aria-label="Italic" className={`${tool} italic`} onClick={() => run("italic")}>I</button>
                <button type="button" aria-label="Subheading" className={tool} onClick={() => run("formatBlock", "h3")}>H</button>
                <button type="button" aria-label="Bulleted list" className={tool} onClick={() => run("insertUnorderedList")}>•</button>
                <button
                    type="button"
                    aria-label="Link"
                    className={tool}
                    onClick={() => {
                        const url = window.prompt("Link address", "https://");
                        if (url && /^(https?:|mailto:|\/)/i.test(url)) run("createLink", url);
                    }}
                >
                    ↗
                </button>
            </div>
            <div
                key={value}
                role="textbox"
                aria-multiline="true"
                aria-label={label}
                contentEditable
                suppressContentEditableWarning
                className="min-h-8 px-1 py-1 outline-none [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_a]:text-brand-500 [&_a]:underline"
                dangerouslySetInnerHTML={{ __html: cleanRich(value) }}
                onBlur={(e) => {
                    const html = cleanRich(e.currentTarget.innerHTML);
                    if (html !== cleanRich(value)) onCommit(html);
                }}
            />
        </div>
    );
}

// Keeps only the formatting rich text fields allow (the site output cleans it again).
function cleanRich(html: string): string {
    const allowed = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "A", "H2", "H3", "H4", "BLOCKQUOTE", "CODE", "DIV"]);
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const walk = (node: Node): string => {
        if (node.nodeType === 3) return esc(node.textContent ?? "");
        if (node.nodeType !== 1) return "";
        const el = node as Element;
        const inner = [...el.childNodes].map(walk).join("");
        if (!allowed.has(el.tagName)) return inner;
        const tag = el.tagName === "DIV" ? "p" : el.tagName.toLowerCase();
        if (tag === "br") return "<br>";
        if (tag === "a") {
            const href = el.getAttribute("href") ?? "";
            return /^(https?:|mailto:|\/)/i.test(href) ? `<a href="${esc(href).replace(/"/g, "&quot;")}">${inner}</a>` : inner;
        }
        return `<${tag}>${inner}</${tag}>`;
    };
    return [...(doc.body.firstElementChild?.childNodes ?? [])].map(walk).join("");
}

function ImageCell({ collection, item, field }: { collection: Collection; item: CollectionItem; field: CollectionField }) {
    const value = item.values[field.id] ?? null;
    const src = useEditor((s) => (value ? imageSrc(s.doc.images, value) : null));
    return (
        <button
            type="button"
            aria-label={`Change ${field.name} of ${itemTitle(collection, item)}`}
            className="flex h-8 w-14 items-center justify-center overflow-hidden rounded-[5px] border border-panel-border bg-field"
            onClick={() =>
                void addImage().then((r) => {
                    if (!r) return;
                    saveCollection({ ...collection, items: collection.items.map((i) => (i.id === item.id ? { ...i, values: { ...i.values, [field.id]: r.id } } : i)) }, [r.command]);
                })
            }
        >
            {src ? <img src={src} alt="" className="size-full object-cover" /> : <Upload01 className="size-3.5 text-ink-muted" />}
        </button>
    );
}

function CollectionDialog({ id }: { id: string }) {
    const collection = useEditor((s) => collectionOf(s.doc, id));
    const readOnly = useEditor((s) => s.readOnly);
    if (!collection) return null;
    const setItem = (itemId: string, patch: Partial<CollectionItem>) => saveCollection({ ...collection, items: collection.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) });
    const setValue = (item: CollectionItem, fieldId: string, value: string) => {
        if ((item.values[fieldId] ?? "") === value) return;
        const values = { ...item.values, [fieldId]: value };
        // A new item's address follows its title until it's set by hand.
        const titleField = collection.fields[0]?.id;
        const slug = fieldId === titleField && /^untitled(-\d+)?$/.test(item.slug) ? uniqueSlug(collection, value, item.id) : item.slug;
        setItem(item.id, { values, slug });
    };
    const addItem = () => {
        const item: CollectionItem = { id: nanoid(8), slug: uniqueSlug(collection, "untitled"), values: collection.fields[0] ? { [collection.fields[0].id]: "Untitled" } : {} };
        saveCollection({ ...collection, items: [...collection.items, item] });
    };
    const addField = () => saveCollection({ ...collection, fields: [...collection.fields, { id: nanoid(6), name: `Field ${collection.fields.length + 1}`, type: "text" }] });
    const removeCollection = () => {
        const doc = editor.get().doc;
        const command = libraryCommand(doc, { collections: collectionsOf(doc).filter((c) => c.id !== id) });
        if (command) editor.execute(command);
        close();
    };
    return (
        <Shell
            title={collection.name}
            width={Math.min(1040, 260 + collection.fields.length * 170)}
            footer={
                !readOnly && (
                    <>
                        <button type="button" className={`${SECONDARY} mr-auto text-rose-600!`} onClick={removeCollection}>
                            Delete collection
                        </button>
                        <button type="button" className={SECONDARY} onClick={() => pickCsv(collection)}>
                            Import CSV
                        </button>
                        <button type="button" className={SECONDARY} onClick={addField}>
                            Add field
                        </button>
                        <button type="button" className={PRIMARY} onClick={addItem}>
                            <span className="flex items-center gap-1">
                                <Plus className="size-3.5" /> New item
                            </span>
                        </button>
                    </>
                )
            }
        >
            <fieldset disabled={readOnly} className="m-0 border-0 p-0">
                <Field label="Collection name">
                    <input key={collection.name} aria-label="Collection name" defaultValue={collection.name} className={INPUT} onBlur={(e) => e.target.value.trim() && e.target.value !== collection.name && saveCollection({ ...collection, name: e.target.value.trim() })} />
                </Field>
                <div className="overflow-x-auto rounded-[8px] border border-panel-border">
                    <table className="w-full border-collapse text-left text-[11.5px]">
                        <thead>
                            <tr className="bg-field">
                                {collection.fields.map((f, i) => (
                                    <th key={f.id} className="min-w-[150px] border-b border-panel-border p-1.5 align-top font-normal">
                                        <input
                                            key={f.name}
                                            aria-label={`Field ${i + 1} name`}
                                            defaultValue={f.name}
                                            className="h-6 w-full rounded bg-transparent px-1 font-semibold outline-none focus:bg-panel"
                                            onBlur={(e) => e.target.value.trim() && e.target.value !== f.name && saveCollection({ ...collection, fields: collection.fields.map((x) => (x.id === f.id ? { ...x, name: e.target.value.trim() } : x)) })}
                                        />
                                        <div className="mt-0.5 flex items-center gap-1">
                                            {i === 0 ? (
                                                <span className="px-1 text-[10.5px] text-ink-muted">Title</span>
                                            ) : (
                                                <>
                                                    <select aria-label={`${f.name} type`} value={f.type} className="h-5 rounded bg-transparent text-[10.5px] text-ink-muted outline-none" onChange={(e) => saveCollection({ ...collection, fields: collection.fields.map((x) => (x.id === f.id ? { ...x, type: e.target.value as FieldType } : x)) })}>
                                                        {FIELD_TYPES.map(([t, label]) => (
                                                            <option key={t} value={t}>
                                                                {label}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <button type="button" aria-label={`Remove field ${f.name}`} className="ml-auto rounded p-0.5 text-ink-subtle hover:text-ink" onClick={() => saveCollection({ ...collection, fields: collection.fields.filter((x) => x.id !== f.id) })}>
                                                        <X className="size-3" />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </th>
                                ))}
                                <th className="min-w-[130px] border-b border-panel-border p-1.5 align-top font-semibold">
                                    Slug<div className="text-[10.5px] font-normal text-ink-muted">The item’s address</div>
                                </th>
                                <th className="w-8 border-b border-panel-border" />
                            </tr>
                        </thead>
                        <tbody>
                            {collection.items.map((item) => (
                                <tr key={item.id} className="border-b border-panel-border last:border-b-0" data-item={item.slug}>
                                    {collection.fields.map((f) => (
                                        <td key={f.id} className="p-1 align-top">
                                            {f.type === "image" ? (
                                                <ImageCell collection={collection} item={item} field={f} />
                                            ) : f.type === "richtext" ? (
                                                <RichCell value={item.values[f.id] ?? ""} label={`${f.name} of ${itemTitle(collection, item)}`} onCommit={(html) => setValue(item, f.id, html)} />
                                            ) : (
                                                <input
                                                    key={item.values[f.id]}
                                                    type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                                                    aria-label={`${f.name} of ${itemTitle(collection, item)}`}
                                                    defaultValue={item.values[f.id] ?? ""}
                                                    placeholder={f.type === "link" ? "https://" : ""}
                                                    className="h-8 w-full rounded border border-transparent bg-transparent px-1 outline-none focus:border-brand-500 focus:bg-field"
                                                    onBlur={(e) => setValue(item, f.id, e.target.value)}
                                                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                                                />
                                            )}
                                        </td>
                                    ))}
                                    <td className="p-1 align-top">
                                        <input key={item.slug} aria-label={`Slug of ${itemTitle(collection, item)}`} defaultValue={item.slug} className="h-8 w-full rounded border border-transparent bg-transparent px-1 font-mono text-[11px] text-ink-muted outline-none focus:border-brand-500 focus:bg-field" onBlur={(e) => e.target.value !== item.slug && setItem(item.id, { slug: uniqueSlug(collection, e.target.value, item.id) })} />
                                    </td>
                                    <td className="p-1 align-top">
                                        <button type="button" aria-label={`Delete ${itemTitle(collection, item)}`} className="mt-1 rounded p-1 text-ink-subtle hover:bg-panel-hover hover:text-ink" onClick={() => saveCollection({ ...collection, items: collection.items.filter((i) => i.id !== item.id) })}>
                                            <Trash01 className="size-3.5" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {collection.items.length === 0 && (
                                <tr>
                                    <td colSpan={collection.fields.length + 2} className="p-4 text-center text-ink-muted">
                                        No items yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </fieldset>
        </Shell>
    );
}

export function SiteDialogs() {
    const dialog = useSite((s) => s.dialog);
    useSiteFonts();
    if (!dialog) return null;
    if (dialog.kind === "settings") return <SettingsDialog tab={dialog.tab} />;
    if (dialog.kind === "publish") return <PublishDialog />;
    if (dialog.kind === "collection") return <CollectionDialog id={dialog.id} />;
    return null;
}
