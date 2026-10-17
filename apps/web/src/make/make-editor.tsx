import { ChevronDown, ChevronLeft, ChevronRight, Code02, Copy06, Database01, Globe02, Link01, List, MessageChatCircle, Type01, VolumeMax, CursorClick02, Edit05, Folder, MessageCircle01, Monitor04, Phone01, Play, Plus, RefreshCw01, Settings01, Sliders01, Tablet02, X } from "@untitledui/icons";
import { useEffect, useState, type FC, type SVGProps } from "react";
import { Button as AriaButton, Dialog, DialogTrigger, Switch as AriaSwitch, Header as AriaHeader, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator, Tooltip as AriaTooltip, TooltipTrigger as AriaTooltipTrigger } from "react-aria-components";
import { NamePrompt, ShareButton } from "../components/collab-ui";
import { ErrorBoundary } from "../components/error-boundary";
import { PresenceAvatars } from "../components/follow-ui";
import { MenuRow } from "../components/left-sidebar";
import { SaveVersionDialog, VersionHistoryPanel } from "../components/version-history";
import { useAuth } from "../engine/auth";
import { collab, useCollab } from "../engine/collab";
import { runAction } from "../engine/menu-actions";
import { publishToCommunity } from "../engine/community";
import { fileMeta } from "../engine/files";
import { editor, useEditor } from "../engine/store";
import { AttachDialog } from "./attach-dialog";
import { MakeDialogs } from "./dialogs";
import { postToPreview } from "./preview-bridge";
import { copyPreviewAsLayers } from "./layers";
import { PropertiesPanel } from "./properties-panel";
import { ChatPanel } from "./chat-panel";
import { CodePane } from "./code-pane";
import { MakeComments } from "./comments-panel";
import { makeData } from "./model";
import { PreviewPane } from "./preview-pane";
import { HostingSection } from "../site/hosting-section";
import { appHostingApi, appUrl, copyViewLink, openWithTicket, downloadCode, isViewOnlyPreview, openPreviewTab, publishApp, unpublishApp } from "./publish";
import { make, useMake, type Device, type MakeView } from "./state";

// The Make editor, laid out like a prompt-to-app builder: a 48 top bar across the whole window (the
// file over the chat; Browser │ Files; people, settings, run, Publish and Share), the chat on the
// left, and on the right the app as a live preview under a 40 browser bar (back, forward, reload,
// route; preview settings, draw, comment, Edit) or its files.

const DEVICES: { id: Device; label: string; icon: FC<SVGProps<SVGSVGElement>> }[] = [
    { id: "desktop", label: "Desktop", icon: Monitor04 },
    { id: "tablet", label: "Tablet", icon: Tablet02 },
    { id: "mobile", label: "Phone", icon: Phone01 },
];

// Publish: a 380-wide popover under the button. A 40 header, then Title, URL, Status and Issues on a
// 32 pitch, a 56 "Publish to Community" switch (the file's community publish, for a file on the
// server), a note, a full-width Publish (Update once live) with Unpublish beside it, and the app's
// address and domain under it once published.
function PublishButton() {
    const published = useEditor((s) => makeData(s.doc).published ?? null);
    const readOnly = useEditor((s) => s.readOnly);
    const name = useEditor((s) => s.doc.name);
    const signedIn = useAuth((s) => Boolean(s.user));
    const empty = useEditor((s) => Object.keys(makeData(s.doc).files).length === 0);
    const open = useMake((s) => s.publishOpen);
    // The file on the server, which the community publish copies (a local file has nothing to copy).
    const fileId = useEditor((s) => s.fileId);
    const serverFile = fileMeta(fileId);
    const [community, setCommunity] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const run = (task: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        void task()
            .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => setBusy(false));
    };
    const url = published ? appUrl(published.id) : null;
    const row = "flex h-8 items-center px-4";
    const label = "w-[110px] shrink-0 text-ink-muted";
    return (
        <DialogTrigger isOpen={open} onOpenChange={(o) => make.set({ publishOpen: o })}>
            <AriaButton className="ml-1 h-8 rounded-[5px] border border-panel-border px-2.5 text-[11px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500">{published ? "Published" : "Publish"}</AriaButton>
            <AriaPopover placement="bottom end" offset={6} className="max-h-[80vh] w-[380px] overflow-y-auto rounded-[13px] border border-panel-border bg-panel text-[11px] text-ink shadow-xl outline-none">
                <Dialog aria-label="Publish" className="outline-none">
                    {({ close }) => (
                        <>
                            <div className="flex h-[38px] items-center justify-between border-b border-panel-border pl-4 pr-2">
                                <span className="font-semibold">Publish</span>
                                <button type="button" aria-label="Close" onClick={close} className="flex size-6 items-center justify-center rounded-[5px] text-ink-muted hover:bg-panel-hover hover:text-ink">
                                    <X className="size-4" />
                                </button>
                            </div>
                            <div className="py-3">
                                <div className={row}>
                                    <span className={label}>Title</span>
                                    <span className="truncate">{name || "Untitled"}</span>
                                </div>
                                <div className={row}>
                                    <span className={label}>URL</span>
                                    {url ? (
                                        <span className="flex min-w-0 items-center gap-1">
                                            <a href={url} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); if (published) void openWithTicket(published.id, url); }} className="truncate font-mono text-[10.5px] text-brand-500 hover:underline">{url.replace(/^https?:\/\//, "")}</a>
                                            <button type="button" aria-label="Copy link" onClick={() => void navigator.clipboard.writeText(url).then(() => editor.notify("Link copied."))} className="flex size-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                                                <Copy06 className="size-3" />
                                            </button>
                                        </span>
                                    ) : (
                                        <span className="text-ink-muted">Given when you publish</span>
                                    )}
                                </div>
                                <div className={row}>
                                    <span className={label}>Status</span>
                                    <span className="rounded-[4px] bg-field px-1.5 leading-5">{busy ? "Publishing…" : published ? `Published ${new Date(published.at).toLocaleString()}` : "Not published"}</span>
                                </div>
                                <div className={row}>
                                    <span className={label}>Issues</span>
                                    <span className={error ? "text-red-500" : "text-ink-muted"}>{error ?? (empty ? "Nothing made yet" : "None found")}</span>
                                </div>
                            </div>
                            <AriaSwitch
                                isSelected={community && Boolean(serverFile?.shared)}
                                isDisabled={readOnly || !signedIn || !serverFile?.shared}
                                onChange={setCommunity}
                                className="group flex h-[57px] cursor-default items-center justify-between border-t border-panel-border px-4 outline-none data-[disabled]:opacity-50"
                            >
                                <span className="flex flex-col">
                                    <span className="font-semibold">Publish to Community</span>
                                    {!serverFile?.shared && <span className="text-ink-muted">Share the file first to publish it to the community.</span>}
                                </span>
                                <span className="flex h-4 w-7 items-center rounded-full bg-panel-border p-0.5 transition-colors group-data-[selected]:bg-brand-500">
                                    <span className="size-3 rounded-full bg-white transition-transform group-data-[selected]:translate-x-3" />
                                </span>
                            </AriaSwitch>
                            <div className="border-t border-panel-border px-4 pt-[15px] pb-4">
                                <p className="mb-3 leading-4 text-ink-muted">{readOnly ? "Only editors can publish this app." : !signedIn ? "Sign in to put the app on the web at its own address." : published ? "Your app is live. Publish again to update it with your latest changes." : "Put the app on the web at its own address. Anyone with the link can use it."}</p>
                                {!readOnly && (
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            disabled={busy || empty}
                                            onClick={() =>
                                                run(async () => {
                                                    await publishApp();
                                                    // With the community row on, a copy of the file goes to the community too.
                                                    if (community && serverFile?.shared) {
                                                        await publishToCommunity({ fileId: serverFile.shared, key: serverFile.key ?? null, name: name || "Untitled", description: "", tags: "", template: false });
                                                        editor.notify(`"${name || "Untitled"}" is published to the community.`);
                                                    }
                                                })
                                            }
                                            className="h-6 flex-1 rounded-[5px] bg-brand-500 text-[11px] text-white disabled:opacity-50">
                                            {busy ? "Publishing…" : !signedIn ? "Sign in to publish" : published ? "Update" : "Publish"}
                                        </button>
                                        {published && (
                                            <button type="button" disabled={busy} onClick={() => run(unpublishApp)} className="h-6 rounded-[5px] border border-panel-border px-2.5 text-ink hover:bg-panel-hover disabled:opacity-50">
                                                Unpublish
                                            </button>
                                        )}
                                    </div>
                                )}
                                {published && (
                                    <div className="mt-3">
                                        <HostingSection key={published.id} api={appHostingApi(published.id)} canEdit={!readOnly} label="app" />
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </Dialog>
            </AriaPopover>
        </DialogTrigger>
    );
}

// The top bar (48, the whole width): the file's name and menu with the AI badge over the chat;
// Browser │ Files and "+" (more for the app); then people, Settings, run in a new tab, Publish and
// Share.
function TopBar() {
    const view = useMake((s) => s.view);
    const side = useMake((s) => s.side);
    const history = useCollab((s) => s.historyOpen);
    const empty = useEditor((s) => Object.keys(makeData(s.doc).files).length === 0);
    const name = useEditor((s) => s.doc.name);
    const tab = (id: MakeView, label: string, Icon: FC<SVGProps<SVGSVGElement>>) => (
        <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => make.set({ view: id, picking: id === "code" ? false : make.get().picking })} className={`flex h-8 items-center gap-1.5 rounded-[5px] px-2 text-[13px] outline-none ${view === id ? "bg-panel-hover font-medium text-ink" : "text-ink-muted hover:text-ink"}`}>
            <Icon className="size-4" />
            {label}
        </button>
    );
    return (
        <div className="flex h-12 shrink-0 items-center border-b border-panel-border bg-panel">
            <div className="flex h-full w-[368px] shrink-0 items-center gap-1 border-r border-panel-border px-3">
                <AriaMenuTrigger>
                    <AriaButton aria-label="File" className="flex min-w-0 items-center gap-1.5 rounded-[5px] px-1 py-1 text-[13px] font-semibold text-ink outline-none hover:bg-panel-hover">
                        <span className="truncate">{name || "Untitled"}</span>
                        <ChevronDown className="size-3 shrink-0 text-ink-muted" />
                    </AriaButton>
                    <AriaPopover placement="bottom start" offset={6} className="w-60 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                        <AriaMenu
                            aria-label="File"
                            className="outline-none"
                            disabledKeys={empty ? ["download", "copyLayers", "viewLink"] : []}
                            onAction={(key) => {
                                if (key === "comments") {
                                    make.set({ side: side === "comments" ? null : "comments" });
                                    collab.set({ historyOpen: false });
                                } else if (key === "history") {
                                    collab.set({ historyOpen: !history });
                                    make.set({ side: null });
                                } else if (key === "library") make.set({ dialog: "library" });
                                else if (key === "viewLink") void copyViewLink();
                                else if (key === "download") downloadCode();
                                else if (key === "copyLayers") void copyPreviewAsLayers();
                                else runAction(String(key));
                            }}
                        >
                            <MenuRow id="comments" label={side === "comments" ? "Hide comments" : "Comments"} />
                            <MenuRow id="history" label={history ? "Hide version history" : "Version history"} />
                            <MenuRow id="saveVersion" label="Save to version history…" shortcut="⌥ ⌘ S" />
                            <MenuRow id="viewLink" label="Copy view-only preview link" />
                            <MenuRow id="download" label="Download code" />
                            <MenuRow id="copyLayers" label="Copy as design layers" />
                            <MenuRow id="library" label="Kits and templates…" />
                        </AriaMenu>
                    </AriaPopover>
                </AriaMenuTrigger>
                <div className="flex-1" />
                <span className="rounded-[4px] border border-panel-border px-1 text-[10px] leading-4 text-ink-muted">AI</span>
            </div>
            <div role="tablist" aria-label="View" className="ml-2 flex items-center gap-1">
                {tab("preview", "Browser", BrowserIcon)}
                {tab("code", "Files", Folder)}
            </div>
            <AriaMenuTrigger>
                <AriaButton aria-label="More" className="ml-1 flex size-8 items-center justify-center rounded-[5px] text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                    <Plus className="size-4" />
                </AriaButton>
                <AriaPopover placement="bottom start" offset={6} className="w-60 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                    <AriaMenu aria-label="More" className="outline-none" disabledKeys={empty ? ["copyLayers", "download"] : []} onAction={(key) => (key === "library" ? make.set({ dialog: "library" }) : key === "copyLayers" ? void copyPreviewAsLayers() : key === "download" ? downloadCode() : make.set({ attachOpen: true }))}>
                        <MenuRow id="frames" label="Attach frames from a design file…" />
                        <MenuRow id="library" label="Kits and templates…" />
                        <MenuRow id="copyLayers" label="Copy as design layers" />
                        <MenuRow id="download" label="Download code" />
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
            <div className="flex-1" />
            <div className="flex items-center gap-1 pr-2">
                <PresenceAvatars />
                <SettingsMenu />
                <TipButton icon={Play} label="Open in a new tab" disabled={empty} onPress={() => void openPreviewTab()} />
                <PublishButton />
                <ShareButton className="ml-1 h-8! w-[54px] rounded-[5px]! px-0! text-[11px]!" />
            </div>
        </div>
    );
}

function BrowserIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true" {...props}>
            <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4.2 4.2l2 2M9.8 9.8l2 2M11.8 4.2l-2 2M6.2 9.8l-2 2" />
        </svg>
    );
}

function TipButton({ icon: Icon, label, active, disabled, onPress }: { icon: FC<SVGProps<SVGSVGElement>>; label: string; active?: boolean; disabled?: boolean; onPress: () => void }) {
    return (
        <AriaTooltipTrigger delay={400} closeDelay={0}>
            <AriaButton aria-label={label} aria-pressed={active} isDisabled={disabled} onPress={onPress} className={`flex size-8 items-center justify-center rounded-[5px] outline-none focus-visible:ring-1 focus-visible:ring-brand-500 disabled:opacity-35 ${active ? "bg-brand-500/20 text-ink" : "text-ink hover:bg-panel-hover"}`}>
                <Icon className="size-4" />
            </AriaButton>
            <AriaTooltip offset={8} className="rounded-[5px] bg-tooltip px-2 py-1 text-[11px] text-white shadow-lg">
                {label}
            </AriaTooltip>
        </AriaTooltipTrigger>
    );
}

// Settings, a menu under the gear: General (model and web), Domains (where the app is published),
// Fonts, Chat preferences, Audio, then Integrations (GitHub, the app's backend, connectors).
// Fonts and Audio are listed but not available yet.
function SettingsMenu() {
    return (
        <AriaMenuTrigger>
            <AriaTooltipTrigger delay={400} closeDelay={0}>
                <AriaButton aria-label="Settings" className="flex size-8 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover data-[pressed]:bg-brand-500/20 focus-visible:ring-1 focus-visible:ring-brand-500">
                    <Settings01 className="size-4" />
                </AriaButton>
                <AriaTooltip offset={8} className="rounded-[5px] bg-tooltip px-2 py-1 text-[11px] text-white shadow-lg">
                    Settings
                </AriaTooltip>
            </AriaTooltipTrigger>
            <AriaPopover placement="bottom end" offset={6} className="w-[200px] rounded-[13px] bg-tooltip p-2 text-white shadow-xl outline-none">
                <AriaMenu
                    aria-label="Settings"
                    className="outline-none"
                    disabledKeys={["fonts", "audio"]}
                    onAction={(key) => {
                        if (key === "github") make.set({ dialog: "github" });
                        else if (key === "domains") make.set({ publishOpen: true });
                        else make.set({ dialog: "settings" });
                    }}
                >
                    <MenuRow id="general" label="General" icon={List} />
                    <MenuRow id="domains" label="Domains" icon={Globe02} />
                    <MenuRow id="fonts" label="Fonts" icon={Type01} />
                    <MenuRow id="chat" label="Chat preferences" icon={MessageChatCircle} />
                    <MenuRow id="audio" label="Audio" icon={VolumeMax} />
                    <AriaSeparator className="my-1 h-px bg-white/10" />
                    <AriaHeader className="px-2 py-1 text-[11px] text-white/50">Integrations</AriaHeader>
                    <MenuRow id="github" label="GitHub" icon={Code02} />
                    <MenuRow id="backend" label="Backend" icon={Database01} />
                    <MenuRow id="connectors" label="Connectors" icon={Link01} />
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

// The browser bar (40) over the preview: back, forward, reload, the route; then Preview settings,
// draw, comment and Edit (pick elements).
function BrowserBar() {
    const picking = useMake((s) => s.picking);
    const drawing = useMake((s) => s.drawing);
    const commenting = useMake((s) => s.commenting);
    const empty = useEditor((s) => Object.keys(makeData(s.doc).files).length === 0);
    return (
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-panel-border bg-panel px-2">
            <TipButton icon={ChevronLeft} label="Back" disabled={empty} onPress={() => postToPreview({ mk: 1, type: "nav", dir: -1 })} />
            <TipButton icon={ChevronRight} label="Forward" disabled={empty} onPress={() => postToPreview({ mk: 1, type: "nav", dir: 1 })} />
            <TipButton icon={RefreshCw01} label="Reload" disabled={empty} onPress={() => make.set({ reload: make.get().reload + 1, error: null })} />
            <span className="ml-1 flex items-center gap-1.5 text-[12px] text-ink">
                <Sliders01 className="size-4 text-ink-muted" />/
            </span>
            <div className="flex-1" />
            <PreviewSettings />
            <TipButton icon={Edit05} label="Draw on the preview" active={drawing} disabled={empty} onPress={() => make.set({ drawing: !drawing, picking: false, commenting: false })} />
            <TipButton icon={MessageCircle01} label="Comment on the preview (F6 with the keyboard)" active={commenting} disabled={empty} onPress={() => make.set({ commenting: !commenting, picking: false, drawing: false })} />
            <AriaButton aria-label="Edit: pick elements (⇧ click for more)" aria-pressed={picking} isDisabled={empty} onPress={() => make.set({ picking: !picking, drawing: false, commenting: false })} className={`flex h-8 items-center gap-1.5 rounded-[5px] px-2 text-[12px] outline-none disabled:opacity-35 ${picking ? "bg-brand-500/20 text-ink" : "text-ink hover:bg-panel-hover"}`}>
                <CursorClick02 className="size-4" />
                Edit
            </AriaButton>
        </div>
    );
}

// Preview settings: desktop, tablet or phone, the device, its frame colour and the background.
function PreviewSettings() {
    const device = useMake((s) => s.device);
    const frame = useMake((s) => s.frameColor);
    const bg = useMake((s) => s.previewBg);
    const row = "flex h-8 items-center justify-between px-4";
    const select = "h-6 w-[124px] rounded-[5px] border border-panel-border bg-transparent px-1.5 text-[12px] text-ink outline-none";
    return (
        <DialogTrigger>
            <AriaButton aria-label="Preview options" className="flex size-8 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover data-[pressed]:bg-brand-500/20">
                <Monitor04 className="size-4" />
            </AriaButton>
            <AriaPopover placement="bottom end" offset={6} className="w-[240px] rounded-[13px] border border-panel-border bg-panel text-[12px] text-ink shadow-xl outline-none">
                <Dialog aria-label="Preview settings" className="outline-none">
                    {({ close }) => (
                        <>
                            <div className="flex h-10 items-center justify-between border-b border-panel-border pl-4 pr-2">
                                <span className="font-semibold">Preview settings</span>
                                <button type="button" aria-label="Close" onClick={close} className="flex size-6 items-center justify-center rounded-[5px] text-ink-muted hover:bg-panel-hover hover:text-ink">
                                    <X className="size-4" />
                                </button>
                            </div>
                            <div className="px-4 pt-[11px]">
                                <div role="radiogroup" aria-label="Device" className="flex h-6 rounded-[5px] bg-field p-px">
                                    {DEVICES.map((d) => (
                                        <button key={d.id} type="button" role="radio" aria-checked={device === d.id} aria-label={d.label} onClick={() => make.set({ device: d.id })} className={`flex flex-1 items-center justify-center rounded-[4px] ${device === d.id ? "bg-panel shadow-sm ring-1 ring-panel-border" : "text-ink-muted hover:text-ink"}`}>
                                            <d.icon className="size-3.5" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <label className={`${row} mt-1`}>
                                <span className="text-ink-muted">Device</span>
                                <select aria-label="Device size" value={device} onChange={(e) => make.set({ device: e.target.value as Device })} className={select}>
                                    <option value="desktop">Full width</option>
                                    <option value="tablet">Tablet 768</option>
                                    <option value="mobile">Phone 375</option>
                                </select>
                            </label>
                            <label className={row}>
                                <span className="text-ink-muted">Color</span>
                                <select aria-label="Frame colour" value={frame} disabled={device === "desktop"} onChange={(e) => make.set({ frameColor: e.target.value as typeof frame })} className={`${select} disabled:opacity-50`}>
                                    <option value="none">No frame</option>
                                    <option value="graphite">Graphite</option>
                                    <option value="silver">Silver</option>
                                    <option value="lavender">Lavender</option>
                                </select>
                            </label>
                            <label className={`${row} mb-2`}>
                                <span className="text-ink-muted">Background</span>
                                <span className="flex h-6 w-[124px] items-center gap-1.5 rounded-[5px] bg-field px-1.5">
                                    <input type="color" aria-label="Background" value={bg ?? "#383838"} onChange={(e) => make.set({ previewBg: e.target.value.toUpperCase() })} className="size-4 cursor-pointer rounded-[3px] border-0 bg-transparent p-0" />
                                    <span className="font-mono text-[11px]">{(bg ?? "#383838").slice(1)}</span>
                                    {bg && (
                                        <button type="button" aria-label="Use the theme's background" onClick={() => make.set({ previewBg: null })} className="ml-auto text-ink-muted hover:text-ink">
                                            <X className="size-3" />
                                        </button>
                                    )}
                                </span>
                            </label>
                        </>
                    )}
                </Dialog>
            </AriaPopover>
        </DialogTrigger>
    );
}

function Toast() {
    const toast = useEditor((s) => s.toast);
    if (!toast) return null;
    return (
        <div role="status" className="pointer-events-none absolute inset-x-0 bottom-6 z-40 flex justify-center">
            <div className="rounded-lg bg-tooltip px-3 py-2 text-[12px] text-white shadow-lg">{toast}</div>
        </div>
    );
}

export function MakeEditor() {
    const view = useMake((s) => s.view);
    const side = useMake((s) => s.side);
    const picks = useMake((s) => s.picks.length);
    const history = useCollab((s) => s.historyOpen);
    const fileId = useEditor((s) => s.fileId);
    // Another file: Point and edit, the picked element and the prompt being written start afresh.
    const viewOnly = isViewOnlyPreview();
    useEffect(() => {
        make.set({ picked: null, picks: [], staged: {}, picking: false, drawing: false, commenting: false, queue: [], openFile: null, error: null, attachments: [], prompt: "" });
    }, [fileId]);
    // The view-only preview link: the app alone, full screen.
    if (viewOnly)
        return (
            <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
                <ErrorBoundary name="Make preview">
                    <PreviewPane />
                </ErrorBoundary>
                <span className="pointer-events-none absolute right-3 bottom-3 rounded-md bg-tooltip/80 px-2 py-1 text-[11px] text-white">View only</span>
            </div>
        );
    return (
        <div className="relative flex min-h-0 w-full flex-1 flex-col">
            <TopBar />
            <div className="flex min-h-0 flex-1">
                <ErrorBoundary name="Make chat">
                    <ChatPanel />
                </ErrorBoundary>
                <main className="flex min-w-0 flex-1 flex-col">
                    {view === "preview" && <BrowserBar />}
                    <ErrorBoundary name="Make preview">{view === "code" ? <CodePane /> : <PreviewPane />}</ErrorBoundary>
                </main>
                {history ? <VersionHistoryPanel /> : side === "comments" ? <MakeComments /> : picks && view === "preview" ? <PropertiesPanel /> : null}
            </div>
            <AttachDialog />
            <MakeDialogs />
            <SaveVersionDialog />
            <NamePrompt />
            <Toast />
        </div>
    );
}
