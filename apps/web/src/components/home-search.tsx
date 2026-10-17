import { Clock, SearchSm, X } from "@untitledui/icons";
import { type ReactNode, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { avatarSrc } from "../engine/account";
import { type FileKind, type FileMeta, KIND_LABELS } from "../engine/files";
import { RESOURCE_TYPES, type SearchPerson, type SearchResults, type SearchSort, clearRecentSearches, hitsFrom, recentSearches, rememberSearch, searchServer } from "../engine/search";
import type { Team } from "../engine/teams";
import { Avatar } from "./avatar";
import { Select } from "./select";

// Search on Home: the field in the sidebar (⌘/ focuses it) with a preview under it as you type
// (recent searches and recent files while it's empty; the top files and people once there's a
// query), and the full results page with filters by resource type, creator and location, people,
// and sorting by relevance, last modified or name. The server searches file names, page names and
// the text inside files you can open; drafts kept only in this browser are matched by name here.

export interface SearchFieldHandle {
    focus: () => void;
}

export const HomeSearchField = forwardRef<SearchFieldHandle, { files: FileMeta[]; signedIn: boolean; locationOf: (f: FileMeta) => string; onOpen: (f: FileMeta) => void; onSubmit: (q: string) => void; onPerson: (p: SearchPerson) => void }>(function HomeSearchField({ files, signedIn, locationOf, onOpen, onSubmit, onPerson }, ref) {
    const input = useRef<HTMLInputElement>(null);
    const box = useRef<HTMLDivElement>(null);
    const [q, setQ] = useState("");
    const [open, setOpen] = useState(false);
    // The server's answer, with the query it answers: an answer to an earlier query isn't shown for
    // this one (it listed files that don't match), and while it's on its way the list says so.
    const [res, setRes] = useState<{ q: string; r: SearchResults } | null>(null);
    const [recent, setRecent] = useState(recentSearches);
    useImperativeHandle(ref, () => ({ focus: () => (input.current?.focus(), input.current?.select()) }), []);
    useEffect(() => {
        if (!q.trim() || !signedIn) return;
        const abort = new AbortController();
        const asked = q.trim();
        const t = window.setTimeout(() => void searchServer({ q: asked, limit: 6 }, abort.signal).then((r) => r && setRes({ q: asked, r })), 150);
        return () => (window.clearTimeout(t), abort.abort());
    }, [q, signedIn]);
    // Closes when focus or a click goes anywhere else.
    useEffect(() => {
        if (!open) return;
        const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
        window.addEventListener("pointerdown", away, true);
        return () => window.removeEventListener("pointerdown", away, true);
    }, [open]);
    const submit = (text: string) => {
        if (!text.trim()) return;
        rememberSearch(text);
        setRecent(recentSearches());
        setOpen(false);
        input.current?.blur();
        onSubmit(text.trim());
    };
    const live = q.trim() && signedIn && res?.q === q.trim() ? res.r : null;
    const pending = Boolean(q.trim() && signedIn && !live);
    const hits = q.trim() ? hitsFrom(live, q, files, locationOf).slice(0, 6) : [];
    const recentFiles = files.filter((f) => !f.trashed).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
    const pick = (f: FileMeta) => {
        if (q.trim()) rememberSearch(q);
        setOpen(false);
        setQ("");
        onOpen(f);
    };
    const row = "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[12px] text-ink outline-none hover:bg-panel-hover focus-visible:bg-panel-hover";
    const moveFocus = (e: React.KeyboardEvent, dir: 1 | -1) => {
        const items = [...(box.current?.querySelectorAll<HTMLElement>("[data-search-item]") ?? [])];
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = items[at + dir] ?? (dir === 1 ? items[0] : null);
        e.preventDefault();
        if (next) next.focus();
        else input.current?.focus();
    };
    return (
        <div ref={box} className="relative mx-2 mb-[10px] shrink-0" onKeyDown={(e) => (e.key === "ArrowDown" ? moveFocus(e, 1) : e.key === "ArrowUp" ? moveFocus(e, -1) : e.key === "Escape" ? (setOpen(false), input.current?.blur()) : undefined)}>
            <label className="flex h-[32px] items-center gap-3 rounded-[5px] bg-field px-2 text-[11px] text-ink-muted focus-within:ring-1 focus-within:ring-brand-500">
                <SearchSm className="size-4 shrink-0" />
                <input
                    ref={input}
                    value={q}
                    onChange={(e) => (setQ(e.target.value), setOpen(true))}
                    onFocus={() => (setRecent(recentSearches()), setOpen(true))}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), submit(q))}
                    placeholder="Search"
                    aria-label="Search files, people and text"
                    aria-expanded={open}
                    aria-controls="home-search-preview"
                    role="combobox"
                    className="w-full bg-transparent text-ink outline-none placeholder:text-ink-subtle"
                />
                {q && (
                    <button type="button" aria-label="Clear search" onClick={() => (setQ(""), input.current?.focus())} className="rounded p-0.5 text-ink-subtle hover:text-ink">
                        <X className="size-3" />
                    </button>
                )}
                {!q && <kbd className="font-sans text-[10.5px] text-ink-subtle">⌘/</kbd>}
            </label>
            {open && (
                <div id="home-search-preview" role="listbox" aria-label="Search preview" className="absolute top-[37px] right-0 left-0 z-30 max-h-[420px] overflow-y-auto rounded-lg border border-panel-border bg-panel-raised p-1 shadow-2xl">
                    {!q.trim() ? (
                        <>
                            {recent.length > 0 && (
                                <>
                                    <div className="flex items-center px-2 pt-1 pb-0.5 text-[11px] font-semibold text-ink-subtle">
                                        <span className="flex-1">Recent searches</span>
                                        <button type="button" onClick={() => (clearRecentSearches(), setRecent([]))} className="font-normal hover:text-ink">
                                            Clear
                                        </button>
                                    </div>
                                    {recent.map((r) => (
                                        <button key={r} type="button" data-search-item onClick={() => (setQ(r), submit(r))} className={row}>
                                            <Clock className="size-3.5 shrink-0 text-ink-subtle" />
                                            <span className="truncate">{r}</span>
                                        </button>
                                    ))}
                                </>
                            )}
                            <div className="px-2 pt-1.5 pb-0.5 text-[11px] font-semibold text-ink-subtle">Recent files</div>
                            {recentFiles.length === 0 && <p className="px-2 py-1 text-[12px] text-ink-muted">No files yet.</p>}
                            {recentFiles.map((f) => (
                                <button key={f.id} type="button" data-search-item onClick={() => pick(f)} className={row}>
                                    <span className="size-6 shrink-0 rounded border border-card-border bg-canvas bg-contain bg-center bg-no-repeat" style={f.thumb ? { backgroundImage: `url(${f.thumb})` } : undefined} />
                                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                                </button>
                            ))}
                        </>
                    ) : (
                        <>
                            {hits.length > 0 && <div className="px-2 pt-1 pb-0.5 text-[11px] font-semibold text-ink-subtle">Files</div>}
                            {hits.map((h) => (
                                <button key={h.file.id} type="button" data-search-item onClick={() => pick(h.file)} className={`${row} h-auto py-1.5`}>
                                    <span className="size-7 shrink-0 rounded border border-card-border bg-canvas bg-contain bg-center bg-no-repeat" style={h.file.thumb ? { backgroundImage: `url(${h.file.thumb})` } : undefined} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate">{h.file.name}</span>
                                        <span className="block truncate text-[11px] text-ink-muted">{h.match ? `${h.match.type === "page" ? "Page" : "Text"}: ${h.match.text}` : h.location}</span>
                                    </span>
                                </button>
                            ))}
                            {(live?.people ?? []).slice(0, 3).length > 0 && <div className="px-2 pt-1.5 pb-0.5 text-[11px] font-semibold text-ink-subtle">People</div>}
                            {(live?.people ?? []).slice(0, 3).map((p) => (
                                <button key={p.id} type="button" data-search-item onClick={() => (setOpen(false), onPerson(p))} className={row}>
                                    <Avatar name={p.name} color={p.color} size={20} single src={avatarSrc(p.avatar)} />
                                    <span className="min-w-0 flex-1 truncate">
                                        {p.name} <span className="text-ink-muted">{p.email}</span>
                                    </span>
                                </button>
                            ))}
                            {hits.length === 0 && !(live?.people ?? []).length && <p className="px-2 py-1.5 text-[12px] text-ink-muted">{pending ? "Searching…" : "No quick matches. Press Enter to search everything."}</p>}
                            <button type="button" data-search-item onClick={() => submit(q)} className={`${row} mt-1 border-t border-panel-border text-link`}>
                                <SearchSm className="size-3.5 shrink-0" />
                                See all results for "{q.trim()}"
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
});

const FILTER = "h-[24px] rounded-[5px] border border-panel-border px-2 text-[12px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500";
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-x-[34px] gap-y-[35px]";

// The full results page.
// `folders` are the folders whose names match, drawn by Home above the files.
export function SearchResultsPage({ q, files, teams, signedIn, locationOf, onOpen, onPerson, view, folders }: { q: string; files: FileMeta[]; teams: Team[]; signedIn: boolean; locationOf: (f: FileMeta) => string; onOpen: (f: FileMeta) => void; onPerson: (p: SearchPerson) => void; view: "grid" | "list"; folders?: ReactNode }) {
    const [tab, setTab] = useState<"files" | "people">("files");
    const [type, setType] = useState<FileKind | "all">("all");
    const [creator, setCreator] = useState("all");
    const [location, setLocation] = useState("all");
    const [sort, setSort] = useState<SearchSort>("relevance");
    const [res, setRes] = useState<SearchResults | null>(null);
    // What the results were asked for, so changing a filter shows the loading state until they arrive.
    const asked = `${q}|${type}|${creator}|${location}|${sort}`;
    const [answered, setAnswered] = useState<string | null>(null);
    const loading = signedIn && answered !== asked;
    useEffect(() => {
        if (!signedIn) return;
        const abort = new AbortController();
        void searchServer({ q, type, creator, location, sort, limit: 200 }, abort.signal).then((r) => {
            setRes(r);
            setAnswered(`${q}|${type}|${creator}|${location}|${sort}`);
        });
        return () => abort.abort();
    }, [q, type, creator, location, sort, signedIn]);
    const hits = hitsFrom(signedIn ? res : null, q, files, locationOf, { type, location, creator });
    if (sort === "name") hits.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
    if (sort === "modified") hits.sort((a, b) => b.file.updatedAt - a.file.updatedAt);
    const people = res?.people ?? [];
    const creators = res?.creators ?? [];
    return (
        <div>
            <div className="flex items-center gap-[9px] pt-[26px] pb-[18px]">
                <h1 className="min-w-0 flex-1 truncate text-[18px] font-semibold">Results for "{q}"</h1>
            </div>
            <div className="mb-[18px] flex flex-wrap items-center gap-[9px]">
                <div role="tablist" aria-label="Results" className="-ml-[7px] flex gap-[5px]">
                    {(
                        [
                            ["files", `Files${res ? ` ${hits.length}` : ""}`],
                            ["people", `People${res ? ` ${people.length}` : ""}`],
                        ] as const
                    ).map(([id, label]) => (
                        <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`h-[25px] rounded-[5px] px-2 text-[12px] outline-none ${tab === id ? "bg-field font-medium text-ink" : "text-ink-muted hover:text-ink"}`}>
                            {label}
                        </button>
                    ))}
                </div>
                <div className="flex-1" />
                {tab === "files" && (
                    <>
                        <Select aria-label="Resource type" value={type} onChange={(e) => setType(e.target.value as FileKind | "all")} className={FILTER}>
                            <option value="all">All types</option>
                            {RESOURCE_TYPES.map(([k, label]) => (
                                <option key={k} value={k}>
                                    {label}
                                </option>
                            ))}
                        </Select>
                        <Select aria-label="Creator" value={creator} onChange={(e) => setCreator(e.target.value)} className={FILTER}>
                            <option value="all">Any creator</option>
                            {creators.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </Select>
                        <Select aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} className={FILTER}>
                            <option value="all">Anywhere</option>
                            <option value="drafts">Drafts</option>
                            {teams.map((t) => (
                                <optgroup key={t.id} label={t.name}>
                                    <option value={`team:${t.id}`}>All of {t.name}</option>
                                    {t.projects
                                        .filter((p) => !p.trashed)
                                        .map((p) => (
                                            <option key={p.id} value={`folder:${p.id}`}>
                                                {p.name}
                                            </option>
                                        ))}
                                </optgroup>
                            ))}
                        </Select>
                        <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SearchSort)} className={FILTER}>
                            <option value="relevance">Relevance</option>
                            <option value="modified">Last modified</option>
                            <option value="name">Name</option>
                        </Select>
                    </>
                )}
            </div>
            {tab === "files" && folders && type === "all" && location === "all" && creator === "all" && folders}
            {tab === "files" ? (
                loading && !res ? (
                    <SkeletonGrid view={view} />
                ) : hits.length === 0 ? (
                    <div className="mt-12 text-center text-ink-muted">{`Nothing matches "${q}"${type !== "all" || creator !== "all" || location !== "all" ? " with these filters" : ""}.`}</div>
                ) : (
                    <div className={view === "grid" ? GRID : "flex flex-col"}>
                        {hits.map((h) =>
                            view === "grid" ? (
                                <button key={h.file.id} type="button" onClick={() => onOpen(h.file)} className="group overflow-hidden rounded-[7px] border border-card-border bg-panel text-left outline-none hover:border-ink-subtle focus-visible:ring-2 focus-visible:ring-brand-500">
                                    <div className="flex h-[172px] w-full items-center justify-center border-b border-card-border bg-canvas bg-contain bg-center bg-no-repeat" style={h.file.thumb ? { backgroundImage: `url(${h.file.thumb})` } : undefined} />
                                    <div className="flex h-[61px] flex-col justify-center pr-3 pl-[17px]">
                                        <span className="truncate text-[12px] leading-[19px] font-medium">{h.file.name}</span>
                                        <span className="truncate text-[12px] leading-[19px] text-ink-muted">{h.match ? `${h.match.type === "page" ? "Page" : "Text"}: ${h.match.text}` : `${h.location} · ${KIND_LABELS[h.file.kind]}`}</span>
                                    </div>
                                </button>
                            ) : (
                                <button key={h.file.id} type="button" onClick={() => onOpen(h.file)} className="flex h-10 items-center gap-3 border-b border-panel-border px-2 text-left outline-none hover:bg-panel-hover focus-visible:bg-panel-hover">
                                    <span className="min-w-0 flex-1 truncate font-medium">{h.file.name}</span>
                                    <span className="w-56 truncate text-ink-muted">{h.match ? `${h.match.type === "page" ? "Page" : "Text"}: ${h.match.text}` : ""}</span>
                                    <span className="w-48 truncate text-ink-muted">{h.location}</span>
                                    <span className="w-28 text-ink-muted">{KIND_LABELS[h.file.kind]}</span>
                                    <span className="w-32 truncate text-ink-muted">{h.owner?.name ?? "You"}</span>
                                </button>
                            ),
                        )}
                    </div>
                )
            ) : people.length === 0 ? (
                <div className="mt-12 text-center text-ink-muted">{signedIn ? `Nobody matches "${q}".` : "Sign in to search for people."}</div>
            ) : (
                <div className="flex flex-col">
                    {people.map((p) => (
                        <button key={p.id} type="button" onClick={() => onPerson(p)} className="flex h-12 items-center gap-3 border-b border-panel-border px-2 text-left outline-none hover:bg-panel-hover">
                            <Avatar name={p.name} color={p.color} size={28} single src={avatarSrc(p.avatar)} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12px] font-medium">{p.name}</span>
                                <span className="block truncate text-[11.5px] text-ink-muted">
                                    {p.email}
                                    {p.handle ? ` · @${p.handle}` : ""}
                                </span>
                            </span>
                            <span className="text-[11.5px] text-ink-muted">View profile</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// Grey cards in the shape of what's loading.
export function SkeletonGrid({ view, count = 8 }: { view: "grid" | "list"; count?: number }) {
    if (view === "list")
        return (
            <div className="flex flex-col" aria-busy aria-label="Loading">
                {Array.from({ length: count }, (_, i) => (
                    <div key={i} className="flex h-10 items-center gap-3 border-b border-panel-border px-2">
                        <span className="size-4 animate-pulse rounded bg-field" />
                        <span className="h-3 w-48 animate-pulse rounded bg-field" />
                    </div>
                ))}
            </div>
        );
    return (
        <div className={GRID} aria-busy aria-label="Loading">
            {Array.from({ length: count }, (_, i) => (
                <div key={i} className="overflow-hidden rounded-[7px] border border-card-border">
                    <div className="h-[172px] animate-pulse bg-field" />
                    <div className="flex h-[61px] flex-col justify-center gap-2 pl-[17px]">
                        <span className="h-3 w-32 animate-pulse rounded bg-field" />
                        <span className="h-3 w-20 animate-pulse rounded bg-field" />
                    </div>
                </div>
            ))}
        </div>
    );
}
