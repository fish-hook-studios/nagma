import { Heart, RefreshCw01, Users01, X } from "@untitledui/icons";
import { useEffect, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { type CommunityEntry, browseCommunity } from "../engine/community";
import type { FileMeta } from "../engine/files";
import { TEMPLATES, fileFromTemplate, type Template } from "../engine/templates";
import { userStorage } from "../engine/user-storage";

// "Recommended resources from Community" across the top of Recents: three popular files from the
// community and a fourth tile that opens it. Refresh shows the next few; the close button hides the
// banner in this browser. As in the reference it always shows: when the community has fewer than
// three files (or you're signed out), Nagma's built-in starter files fill the row.
const HIDDEN_KEY = "nagma.home.recommended.hidden";
const PER_PAGE = 3;

function readHidden(): boolean {
    try {
        return userStorage.getItem(HIDDEN_KEY) === "1";
    } catch {
        return false;
    }
}

const count = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n));

export function RecommendedResources({ signedIn, onOpen, onMore }: { signedIn: boolean; onOpen: (f: FileMeta) => void; onMore: () => void }) {
    const [hidden, setHidden] = useState(readHidden);
    const [entries, setEntries] = useState<CommunityEntry[]>([]);
    const [page, setPage] = useState(0);
    useEffect(() => {
        if (!signedIn || hidden) return;
        let alive = true;
        browseCommunity({ sort: "popular" }).then(
            (list) => alive && setEntries(list),
            () => alive && setEntries([]),
        );
        return () => {
            alive = false;
        };
    }, [signedIn, hidden]);
    if (hidden) return null;
    const builtIn = TEMPLATES.filter((t) => t.id !== "blank");
    const items: ({ community: CommunityEntry } | { template: Template })[] = [...(signedIn ? entries : []).map((community) => ({ community })), ...builtIn.slice(0, Math.max(0, PER_PAGE - (signedIn ? entries.length : 0))).map((template) => ({ template }))];
    const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
    const start = (page % pages) * PER_PAGE;
    const shown = items.slice(start, start + PER_PAGE);
    const nextItem = items[(start + PER_PAGE) % items.length];
    const next = nextItem && "community" in nextItem ? nextItem.community : null;
    const hide = () => {
        setHidden(true);
        try {
            userStorage.setItem(HIDDEN_KEY, "1");
        } catch {
            // Shown again next time.
        }
    };
    const open = (e: CommunityEntry) => onOpen({ id: `server:${e.fileId}`, name: e.name, kind: e.kind, createdAt: e.publishedAt, updatedAt: e.updatedAt, thumb: e.thumb ?? undefined, shared: e.fileId, key: e.viewKey, role: "view" });
    const icon = "flex size-6 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500";
    return (
        <section aria-label="Recommended resources from Community" className="mt-[18px] mb-[15px] rounded-[12px] bg-field pt-[14px] pb-[19px]">
            <div className="flex h-[24px] items-center gap-[8px] pr-[15px] pl-[24px]">
                <h2 className="flex-1 truncate text-[13px] font-semibold">Recommended resources from Community</h2>
                {pages > 1 && (
                    <AriaButton aria-label="Show other resources" onPress={() => setPage((p) => p + 1)} className={icon}>
                        <RefreshCw01 className="size-3.5" />
                    </AriaButton>
                )}
                <AriaButton aria-label="Hide recommended resources" onPress={hide} className={icon}>
                    <X className="size-4" />
                </AriaButton>
            </div>
            <div className="mt-[18px] grid grid-cols-4 gap-[24px] px-[24px]">
                {shown.map((item) => {
                    if ("template" in item) {
                        const t = item.template;
                        return (
                            <button key={`t:${t.id}`} type="button" onClick={() => onOpen(fileFromTemplate(t))} className="group flex min-w-0 flex-col self-start rounded-[6px] text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                                <span className="block aspect-video w-full rounded-[6px] border border-card-border group-hover:brightness-105" style={{ background: t.preview }} />
                                <span className="mt-[10px] block truncate text-[11px] leading-[16px] font-medium">{t.name}</span>
                                <span className="truncate text-[11px] leading-[16px] text-ink-muted">by Nagma · Starter file</span>
                            </button>
                        );
                    }
                    const e = item.community;
                    return (
                    <button key={e.id} type="button" onClick={() => open(e)} className="group flex min-w-0 flex-col self-start rounded-[6px] text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                        <span className="block aspect-video w-full rounded-[6px] border border-card-border bg-panel bg-cover bg-center group-hover:brightness-105" style={e.thumb ? { backgroundImage: `url(${e.thumb})` } : undefined} />
                        <span className="mt-[10px] block truncate text-[11px] leading-[16px] font-medium">{e.name}</span>
                        <span className="flex items-center gap-[4px] truncate text-[11px] leading-[16px] text-ink-muted">
                            <span className="truncate">by {e.by.handle ? `@${e.by.handle}` : e.by.name}</span>
                            <span aria-hidden>·</span>
                            <Heart className="size-3 shrink-0" aria-label="Likes" /> {count(e.likes)}
                            <span aria-hidden>·</span>
                            <Users01 className="size-3 shrink-0" aria-label="Duplicates" /> {count(e.duplicates)}
                        </span>
                    </button>
                    );
                })}
                {Array.from({ length: PER_PAGE - shown.length }, (_, i) => (
                    <span key={`gap${i}`} aria-hidden />
                ))}
                <button type="button" onClick={onMore} className="group flex min-w-0 flex-col self-start rounded-[6px] text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                    <span className="block aspect-video w-full rounded-[6px] border border-card-border bg-panel bg-cover bg-center opacity-80 group-hover:opacity-100" style={next?.thumb ? { backgroundImage: `url(${next.thumb})` } : undefined} />
                    <span className="mt-[10px] block text-[11px] leading-[16px] font-medium text-link group-hover:underline">See more resources</span>
                </button>
            </div>
        </section>
    );
}
