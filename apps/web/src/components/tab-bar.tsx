import { Announcement02, File06, Film01, Globe02, Grid01, Home01, Plus, PresentationChart01, Stars02, StickerSquare, X } from "@untitledui/icons";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover } from "react-aria-components";
import type { FileKind } from "../engine/files";
import { MenuRow } from "./left-sidebar";
import { activateTab, closeTab, createFile, fileMeta, getTabs, openFile, openHome, subscribeTabs } from "../engine/files";
import { protoFileOf, protoTabId } from "../engine/prototype-view";
import { useEditor } from "../engine/store";
import { openNewDocument } from "../document/new-document";

const KIND_ICONS: Record<FileKind, typeof Grid01> = { design: Grid01, docs: File06, video: Film01, board: StickerSquare, slides: PresentationChart01, campaign: Announcement02, site: Globe02, make: Stars02 };

// A name that starts with an emoji shows that emoji as the tab's icon (and the page's favicon).
function leadingEmoji(name: string): string | null {
    const m = /^\s*(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*|\p{Regional_Indicator}{2})/u.exec(name);
    return m?.[1] ?? null;
}

function useEmojiFavicon(name: string | null) {
    useEffect(() => {
        const emoji = name ? leadingEmoji(name) : null;
        let link = document.querySelector<HTMLLinkElement>("link[rel~='icon'][data-emoji]");
        if (!emoji) {
            link?.remove();
            return;
        }
        if (!link) {
            link = document.createElement("link");
            link.rel = "icon";
            link.dataset.emoji = "";
            document.head.append(link);
        }
        link.href = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${emoji}</text></svg>`)}`;
    }, [name]);
}

// The strip across the top: a Home tab and the open files, like a design tool's tabs. A file's
// prototype (Present) has a tab of its own, labelled like the file's.
export function TabBar() {
    const homeOpen = useEditor((s) => s.homeOpen);
    const fileId = useEditor((s) => s.fileId);
    const name = useEditor((s) => s.doc.name);
    const presenting = useEditor((s) => s.presentingId !== null);
    const shown = homeOpen || !fileId ? null : presenting ? protoTabId(fileId) : fileId;
    const tabs = useSyncExternalStore(subscribeTabs, getTabs);
    useEmojiFavicon(homeOpen || !fileId ? null : name);
    // Tabs share the strip, shrinking to fit (about 70 wide at 25 tabs in a wide window), then the
    // strip scrolls sideways below 48: the window never grows past its edge, and the open tab is
    // scrolled into view.
    const strip = useRef<HTMLDivElement>(null);
    useEffect(() => {
        strip.current?.querySelector<HTMLElement>("[data-current-tab]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [shown, tabs.length]);
    return (
        <div data-titlebar className="flex h-[38px] min-w-0 shrink-0 items-center border-b border-panel-border bg-panel text-[11px] text-ink">
            <button type="button" aria-label="Home" onClick={openHome} className={`flex h-full w-10 shrink-0 items-center justify-center border-r border-panel-border outline-none ${homeOpen ? "bg-canvas text-ink" : "text-ink-muted hover:text-ink"}`}>
                <Home01 className="size-3.5" />
            </button>
            <div ref={strip} className="flex h-full min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" onWheel={(e) => {
                // A mouse wheel scrolls the strip sideways.
                if (e.deltaY && !e.deltaX) e.currentTarget.scrollLeft += e.deltaY;
            }}>
            {tabs.map((id) => {
                const file = protoFileOf(id) ?? id;
                const m = fileMeta(file);
                const label = file === fileId ? name : (m?.name ?? "Untitled");
                const kind = m?.kind === "slides" ? "presentation" : "prototype";
                const emoji = leadingEmoji(label);
                const Icon = KIND_ICONS[m?.kind ?? "design"];
                return (
                    <div key={id} data-current-tab={id === shown ? "" : undefined} className={`group flex h-full min-w-12 shrink grow-0 basis-60 items-center gap-1.5 border-r border-panel-border pr-1.5 pl-3 outline-none ${id === shown ? "bg-canvas" : "text-ink-muted"}`}>
                        {emoji ? <span aria-hidden className="text-[12px] leading-none">{emoji}</span> : <Icon aria-hidden className="size-3 shrink-0 text-ink-subtle" />}
                        <button type="button" aria-label={id === file ? undefined : `${label} ${kind}`} onClick={() => void activateTab(id)} className="min-w-0 flex-1 overflow-hidden text-left whitespace-nowrap outline-none [mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)]">
                            {emoji ? label.trimStart().slice(emoji.length).trimStart() || label : label}
                        </button>
                        <button type="button" aria-label={`Close ${label}${id === file ? "" : ` ${kind}`}`} onClick={() => closeTab(id)} className={`flex size-6 shrink-0 items-center justify-center rounded text-ink-subtle group-hover:opacity-100 hover:bg-panel-hover hover:text-ink focus-visible:opacity-100 ${id === shown ? "opacity-100" : "opacity-0"}`}>
                            <X className="size-3" />
                        </button>
                    </div>
                );
            })}
            </div>
            <AriaMenuTrigger>
                <AriaButton aria-label="New file" className="flex h-full w-10 shrink-0 items-center justify-center border-l border-panel-border text-ink-subtle outline-none hover:text-ink">
                    <Plus className="size-3.5" />
                </AriaButton>
                <AriaPopover placement="bottom start" offset={2} className="w-48 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                    <AriaMenu aria-label="New file" className="outline-none" onAction={(key) => (String(key) === "docs" ? openNewDocument() : void openFile(createFile(String(key) as FileKind, undefined, String(key) === "video" ? "Untitled video" : undefined).id))}>
                        <MenuRow id="design" label="Design file" icon={Grid01} />
                        <MenuRow id="video" label="Video" icon={Film01} />
                        <MenuRow id="board" label="Board" icon={StickerSquare} />
                        <MenuRow id="slides" label="Slides" icon={PresentationChart01} />
                        <MenuRow id="campaign" label="Campaign" icon={Announcement02} />
                        <MenuRow id="site" label="Site" icon={Globe02} />
                        <MenuRow id="make" label="Make" icon={Stars02} />
                        <MenuRow id="docs" label="Document" icon={File06} />
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
        </div>
    );
}
