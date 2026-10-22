import {
    ChevronDown,
    ChevronRight,
    Clock,
    File06,
    Film01,
    FolderPlus,
    Cube01,
    File02,
    Grid01,
    LayoutAlt04,
    List,
    Pin02,
    Plus,
    PresentationChart01,
    Settings01,
    Star01,
    StickerSquare,
    Announcement02,
    Globe02,
    Stars02,
    Trash01,
    Users01,
} from "@untitledui/icons";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator } from "react-aria-components";
import { addAccount, auth, openSignIn, signOut, switchAccount, useAuth } from "../engine/auth";
import { join, useCollab } from "../engine/collab";
import { importAsNewFiles, pickImportFiles } from "../engine/images";
import { openNewDocument } from "../document/new-document";
import {
    type FileKind,
    type FileMeta,
    KIND_LABELS,
    createEmptyDocument,
    createFile,
    deleteForever,
    deleteServerForever,
    duplicateFile,
    duplicateServerFile,
    claimServerFile,
    leaveServerFile,
    getStarredFiles,
    renameServerFile,
    setFileFolder,
    starKey,
    subscribeStarredFiles,
    toggleStarFile,
    emptyLocalTrash,
    emptyServerTrash,
    getServerFiles,
    isServerOnline,
    listFiles,
    openFile,
    putServerMeta,
    refreshServerFiles,
    rememberShared,
    renameFile,
    restoreDefaultThumbnail,
    restoreFile,
    setFilePinned,
    subscribeFiles,
    subscribeServerFiles,
    trashFile,
} from "../engine/files";
import { editor, useEditor } from "../engine/store";
import { userStorage } from "../engine/user-storage";
import {
    type Team,
    createProject,
    createServerFile,
    createTeam,
    deleteProject,
    deleteProjectForever,
    duplicateProject,
    getStarred,
    moveDraftToProject,
    moveProject,
    moveToProject,
    projectOf,
    refreshTeams,
    renameProject,
    restoreProject,
    subscribeStarred,
    toggleStar,
    leaveTeam,
    updateFolderSharing,
    updateTeam,
    useTeams,
} from "../engine/teams";
import {
    type FolderItem,
    FOLDER_COLORS,
    allFolders,
    childFolders,
    createLocalFolder,
    deleteLocalFolderForever,
    duplicateLocalFolder,
    emptyLocalFolderTrash,
    folderColor,
    folderPath,
    folderSubtree,
    listLocalFolders,
    moveLocalFolder,
    renameLocalFolder,
    restoreLocalFolder,
    setLocalFolderColor,
    subscribeLocalFolders,
    trashLocalFolder,
} from "../engine/folders";
import { type Destination, type DropProps, Breadcrumbs, DRAG_TYPE, FolderCard, FolderMenuItems, FolderSolid, FolderTree, MoveDialog } from "./home-folders";
import { openCommentWhenLoaded } from "../engine/comments";
import type { Notice } from "../engine/notifications";
import { avatarSrc, openAccountSettings } from "../engine/account";
import { NotificationsButton } from "./home-notifications";
import { HomeSearchField, type SearchFieldHandle, SearchResultsPage, SkeletonGrid } from "./home-search";
import { RecommendedResources } from "./home-recommended";
import { CommunityPage } from "./community-page";
import { Button as PanelButton, Dialog as PanelDialog } from "./admin/admin-ui";
import { createBoardDocument } from "../board/model";
import { createSlidesDocument } from "../slides/model";
import { createCampaignDocument } from "../campaign/model";
import { createSiteDocument } from "../site/model";
import { createMakeDocument } from "../make/model";
import { Avatar } from "./collab-ui";
import { IconButton } from "./icon-button";
import { MenuRow } from "./left-sidebar";
import { HistoryButtons, SidebarAccount } from "./sidebar-account";
import { ProjectAccessDialog, TeamDialog } from "./team-dialog";
import { Select } from "./select";
import { AdminConsole } from "./admin/admin-console";
import { ResourcesPage, TemplatePickerHost } from "./resources-page";
import { openTemplatePicker } from "../engine/team-templates";
import { askText } from "./ask-text";
import { currentServer, openServerPicker, shareableUrl, withServer } from "../engine/servers";
import { openWelcome } from "../engine/onboarding";
import { ServerBadge } from "./server-picker";

// Where Home is looking: the same places a design tool's file browser has. A "folder" is one of
// your Drafts folders (in this browser); a "project" is a team folder on the server.
type Section =
    | { kind: "recents" }
    | { kind: "community"; profile?: string }
    | { kind: "search"; q: string }
    | { kind: "drafts" }
    | { kind: "folders" }
    | { kind: "resources" }
    | { kind: "trash" }
    | { kind: "admin" }
    | { kind: "folder"; id: string }
    | { kind: "project"; id: string };

function ago(t: number): string {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? "" : "s"} ago`;
}

// View and sort are remembered in this browser, like the file browser's own settings.
const HOME_PREFS_KEY = "nagma.home.v1";
type HomePrefs = { view: "grid" | "list"; sort: "modified" | "created" | "name" };
function readHomePrefs(): HomePrefs {
    try {
        const p = JSON.parse(userStorage.getItem(HOME_PREFS_KEY) ?? "{}") as Partial<HomePrefs>;
        return { view: p.view === "list" ? "list" : "grid", sort: p.sort === "created" || p.sort === "name" ? p.sort : "modified" };
    } catch {
        return { view: "grid", sort: "modified" };
    }
}
function writeHomePrefs(p: HomePrefs) {
    try {
        userStorage.setItem(HOME_PREFS_KEY, JSON.stringify(p));
    } catch {
        // Not remembered this time.
    }
}

// Which sidebar folders are open, remembered in this browser.
const TREE_KEY = "nagma.home.tree.v1";
function readTree(): Set<string> {
    try {
        return new Set(JSON.parse(userStorage.getItem(TREE_KEY) ?? "null") ?? ["drafts"]) as Set<string>;
    } catch {
        return new Set(["drafts"]);
    }
}
function writeTree(s: Set<string>) {
    try {
        userStorage.setItem(TREE_KEY, JSON.stringify([...s]));
    } catch {
        // Not remembered this time.
    }
}

// A server file's link (with its edit key when you have one), as the share dialog would copy it.
function serverFileLink(sharedId: string, key: string | null | undefined): string {
    const url = shareableUrl();
    url.searchParams.set("file", sharedId);
    if (key) url.searchParams.set("key", key);
    return withServer(url).toString();
}

// The filter and sort dropdowns above the files.
const FILTER = "h-[24px] rounded-[5px] border border-panel-border px-2 text-[12px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500";

// Cards for files and folders: five across a wide window.
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-[32px]";


const KIND_ICONS: Record<FileKind, typeof Grid01> = { design: Grid01, docs: File06, video: Film01, board: StickerSquare, slides: PresentationChart01, campaign: Announcement02, site: Globe02, make: Stars02 };
const KIND_BADGE: Record<FileKind, string> = { design: "bg-brand-500", docs: "bg-emerald-500", video: "bg-rose-500", board: "bg-violet-500", slides: "bg-[#FF7237]", campaign: "bg-amber-500", site: "bg-indigo-500", make: "bg-fuchsia-500" };

// In the desktop app, Home's empty state says it has a server of its own and how to collaborate.
const inDesktopApp = typeof window !== "undefined" && Boolean((window as unknown as { nagmaDesktop?: unknown }).nagmaDesktop);

// Where Home was looking, so coming back from a file returns there (for this session).
let lastSection: Section = { kind: "recents" };

// Opens Home on Community (from an editor's "Browse more in Community").
export function openCommunity() {
    lastSection = { kind: "community" };
    editor.set({ homeOpen: true });
}

// Picked items: files by id, folders as "folder:<id>".
const folderKey = (id: string) => `folder:${id}`;
const isFolderKey = (k: string) => k.startsWith("folder:");
const err = (e: unknown) => editor.notify(e instanceof Error ? e.message : String(e));

export function Home() {
    const local = useSyncExternalStore(subscribeFiles, listFiles);
    const account = useAuth((s) => s.user);
    const otherAccounts = useAuth((s) => s.others);
    const serverFiles = useSyncExternalStore(subscribeServerFiles, getServerFiles);
    const online = useSyncExternalStore(subscribeServerFiles, isServerOnline);
    const starred = useSyncExternalStore(subscribeStarred, getStarred);
    const localFolders = useSyncExternalStore(subscribeLocalFolders, listLocalFolders);
    const teams = useTeams();
    const [teamId, setTeamId] = useState<string | null>(null);
    const [section, setSectionState] = useState<Section>(() => lastSection);
    const setSection = (next: Section) => {
        lastSection = next;
        setSectionState(next);
    };
    const [history, setHistory] = useState<{ back: Section[]; forward: Section[] }>({ back: [], forward: [] });
    // The search field (⌘/ focuses it).
    const searchRef = useRef<SearchFieldHandle>(null);
    // The file list has loaded once (skeleton cards until then).
    const [loaded, setLoaded] = useState(false);
    // Asking before files and folders go to the trash.
    const [confirmTrash, setConfirmTrash] = useState<string[] | null>(null);
    const [coloring, setColoring] = useState<FolderItem | null>(null);
    const [publishing, setPublishing] = useState<FileMeta | null>(null);
    const [view, setViewState] = useState<"grid" | "list">(() => readHomePrefs().view);
    const [kind, setKind] = useState<FileKind | "all">("all");
    const [sort, setSortState] = useState<"modified" | "created" | "name">(() => readHomePrefs().sort);
    const setView = (v: "grid" | "list") => (setViewState(v), writeHomePrefs({ view: v, sort }));
    const setSort = (v: "modified" | "created" | "name") => (setSortState(v), writeHomePrefs({ view, sort: v }));
    const starredFiles = useSyncExternalStore(subscribeStarredFiles, getStarredFiles);
    // Recents: everything you've opened, or only files other people shared with you.
    const [recentsTab, setRecentsTab] = useState<"all" | "shared" | "folders">("all");
    // Files and folders picked with ⌘-click, ⇧-click or a drag box, for moving or trashing together.
    const [picked, setPicked] = useState<string[]>([]);
    // The file or folder whose name is being edited (a picked-item key).
    const [renaming, setRenaming] = useState<string | null>(null);
    // "Move to…" is open for these items.
    const [moving, setMoving] = useState<string[] | null>(null);
    const [dropHover, setDropHover] = useState<string | null>(null);
    const [expanded, setExpandedState] = useState<Set<string>>(readTree);
    // Trash: files or folders, yours or anyone's, and its own order.
    const [trashTab, setTrashTab] = useState<"files" | "folders">("files");
    const [trashOwner, setTrashOwner] = useState<"you" | "anyone">("you");
    const [trashSort, setTrashSort] = useState<"trashed" | "modified" | "name">("trashed");
    const [starredOpen, setStarredOpen] = useState(true);
    const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [members, setMembers] = useState<Team | null>(null);
    const [access, setAccess] = useState<{ team: Team; project: Team["projects"][number] } | null>(null);
    const me = useCollab((s) => s.me);
    const currentId = useEditor((s) => s.fileId);

    useEffect(() => {
        void Promise.all([refreshServerFiles(), refreshTeams()]).finally(() => setLoaded(true));
    }, [account?.id]);

    const team = teams.find((t) => t.id === teamId) ?? teams[0] ?? null;
    const folders = useMemo(() => allFolders(localFolders, teams, account?.id ?? null), [localFolders, teams, account?.id]);
    const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
    const localFolderIds = useMemo(() => new Set(localFolders.map((f) => f.id)), [localFolders]);
    const teamName = (id: string | null) => (id ? (teams.find((t) => t.id === id)?.name ?? "Team") : "Drafts");

    const setExpanded = (next: Set<string>) => {
        setExpandedState(next);
        writeTree(next);
    };
    const toggleExpanded = (id: string) => {
        const next = new Set(treeExpanded);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpanded(next);
    };

    // Navigation with back and forward, like a browser.
    const go = (next: Section) => {
        setPicked([]);
        setRenaming(null);
        setHistory((h) => ({ back: [...h.back, section], forward: [] }));
        setSection(next);
    };
    const back = () => {
        const prev = history.back.at(-1);
        if (!prev) return;
        setHistory((h) => ({ back: h.back.slice(0, -1), forward: [section, ...h.forward] }));
        setSection(prev);
        setPicked([]);
    };
    const forward = () => {
        const next = history.forward[0];
        if (!next) return;
        setHistory((h) => ({ back: [...h.back, section], forward: h.forward.slice(1) }));
        setSection(next);
        setPicked([]);
    };
    const openFolder = (f: FolderItem) => {
        if (f.trashed) return;
        const open = [...folderPath(folders, f.parentId).map((x) => x.id), f.teamId ? `team:${f.teamId}` : "drafts"];
        if (!open.every((id) => expanded.has(id))) setExpanded(new Set([...expanded, ...open]));
        go(f.teamId ? { kind: "project", id: f.id } : { kind: "folder", id: f.id });
        if (f.teamId && f.teamId !== team?.id) setTeamId(f.teamId);
    };

    // Server files not opened here yet get entries of their own; opened ones are the local entry.
    const files = useMemo<FileMeta[]>(() => {
        const known = new Map(local.filter((f) => f.shared).map((f) => [f.shared as string, f]));
        const merged: FileMeta[] = local.map((f) => {
            const remote = f.shared ? serverFiles.find((s) => s.id === f.shared) : undefined;
            return remote
                ? { ...f, name: remote.name, kind: remote.kind ?? f.kind, thumb: remote.thumb ?? f.thumb, updatedAt: Math.max(f.updatedAt, remote.updatedAt), project: remote.project, owner: remote.owner?.name, role: remote.role, trashed: f.trashed || remote.trashed, trashedWith: f.trashedWith ?? remote.trashedWith ?? null, trashedAt: f.trashedAt ?? remote.trashedAt ?? null, ownerId: remote.owner?.id ?? null, trashedByMe: remote.trashedBy ? remote.trashedBy === account?.id : true, pinned: remote.pinned }
                : f;
        });
        for (const s of serverFiles) {
            if (known.has(s.id)) continue;
            merged.push({ id: `server:${s.id}`, name: s.name, kind: s.kind, createdAt: s.createdAt ?? s.updatedAt, updatedAt: s.updatedAt, thumb: s.thumb ?? undefined, trashed: s.trashed, trashedWith: s.trashedWith ?? null, shared: s.id, project: s.project, owner: s.owner?.name, ownerId: s.owner?.id ?? null, role: s.role, trashedAt: s.trashedAt ?? null, trashedByMe: s.trashedBy ? s.trashedBy === account?.id : true, pinned: s.pinned });
        }
        return merged;
    }, [local, serverFiles, account?.id]);
    const teamKeys = useMemo(() => new Map(serverFiles.map((f) => [f.id, f.keys])), [serverFiles]);
    // Server files someone else owns: "Shared with you".
    const sharedWithMe = useMemo(() => new Set(serverFiles.filter((f) => f.owner && f.owner.id !== account?.id).map((f) => f.id)), [serverFiles, account?.id]);

    // The folder a file sits in: its team folder, else its Drafts folder (if that still exists).
    const containerOf = (f: FileMeta): string | null => f.project ?? (f.folderId && localFolderIds.has(f.folderId) ? f.folderId : null);
    const filesIn = useMemo(() => {
        const map = new Map<string, FileMeta[]>();
        for (const f of files) {
            if (f.trashed) continue;
            const c = f.project ?? (f.folderId && localFolderIds.has(f.folderId) ? f.folderId : null);
            if (!c) continue;
            const list = map.get(c) ?? [];
            list.push(f);
            map.set(c, list);
        }
        return map;
    }, [files, localFolderIds]);
    // A folder was last modified when it or a file in it last changed.
    const modifiedOf = (f: FolderItem) => Math.max(f.updatedAt, ...(filesIn.get(f.id) ?? []).map((x) => x.updatedAt));
    const thumbsOf = (f: FolderItem): string[] => {
        const ids = [...folderSubtree(folders, f.id)].filter((id) => !folderById.get(id)?.trashed);
        return ids
            .flatMap((id) => filesIn.get(id) ?? [])
            .filter((x) => x.thumb)
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 3)
            .map((x) => x.thumb as string);
    };
    const locationOf = (f: FileMeta): string => {
        const c = containerOf(f);
        if (c) {
            const path = folderPath(folders, c);
            return [teamName(path[0]?.teamId ?? null), ...path.map((x) => x.name)].join(" / ");
        }
        return f.shared && sharedWithMe.has(f.shared) ? "Shared with you" : "Drafts";
    };
    const folderLocation = (f: FolderItem) => [teamName(f.teamId), ...folderPath(folders, f.parentId).map((x) => x.name)].join(" / ");

    const currentFolder = section.kind === "project" || section.kind === "folder" ? (folderById.get(section.id) ?? null) : null;
    const currentProject = section.kind === "project" ? projectOf(section.id) : null;
    const canAdd = currentFolder ? currentFolder.canEdit && !currentFolder.trashed : section.kind === "folders" ? Boolean(team && team.role !== "view") : true;

    // The folder you're in went to the trash (here or elsewhere): go up to the nearest live folder.
    useEffect(() => {
        if (!currentFolder?.trashed) return;
        const live = folderPath(folders, currentFolder.parentId)
            .reverse()
            .find((f) => !f.trashed);
        setSection(live ? (live.teamId ? { kind: "project", id: live.id } : { kind: "folder", id: live.id }) : currentFolder.teamId ? { kind: "folders" } : { kind: "drafts" });
    }, [currentFolder, folders]);

    // The sidebar tree is open down to the folder you're in.
    const wantOpen = currentFolder ? [...folderPath(folders, currentFolder.id).slice(0, -1).map((f) => f.id), currentFolder.teamId ? `team:${currentFolder.teamId}` : "drafts"] : [];
    const treeExpanded = wantOpen.every((id) => expanded.has(id)) ? expanded : new Set([...expanded, ...wantOpen]);

    const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, undefined, { numeric: true });
    const sortFiles = (a: FileMeta, b: FileMeta) => (sort === "name" ? byName(a, b) : sort === "created" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt);
    // Inside a folder, pinned files come first.
    const pinnedFirst = (a: FileMeta, b: FileMeta) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || sortFiles(a, b);
    const sortFolders = (a: FolderItem, b: FolderItem) => (sort === "name" ? byName(a, b) : sort === "created" ? b.createdAt - a.createdAt : modifiedOf(b) - modifiedOf(a));
    const searching = section.kind === "search";
    // Made by you: drafts in this browser, and server files you own.
    const mineFile = (f: FileMeta) => !f.shared || !f.ownerId || f.ownerId === account?.id;
    const trashedFolderIds = useMemo(() => new Set(folders.filter((f) => f.trashed).map((f) => f.id)), [folders]);

    const shown = (() => {
        // Search results have their own page (home-search.tsx).
        if (searching || section.kind === "folders") return [];
        if (section.kind === "trash") {
            if (trashTab === "folders") return [];
            return files
                .filter((f) => f.trashed && !(f.trashedWith && trashedFolderIds.has(f.trashedWith)))
                .filter((f) => trashOwner === "anyone" || mineFile(f))
                .filter((f) => kind === "all" || f.kind === kind)
                .sort((a, b) => (trashSort === "trashed" ? (b.trashedAt ?? 0) - (a.trashedAt ?? 0) : trashSort === "name" ? byName(a, b) : b.updatedAt - a.updatedAt));
        }
        return files
            .filter((f) => !f.trashed)
            .filter((f) => section.kind !== "recents" || recentsTab === "all" || (recentsTab === "shared" && f.shared && sharedWithMe.has(f.shared)))
            .filter((f) => section.kind !== "drafts" || (!f.project && !(f.folderId && localFolderIds.has(f.folderId))))
            .filter((f) => section.kind !== "folder" || (!f.project && f.folderId === section.id))
            .filter((f) => section.kind !== "project" || f.project === section.id)
            .filter((f) => kind === "all" || f.kind === kind)
            .sort(currentFolder ? pinnedFirst : sortFiles);
    })();
    const shownFolders = (() => {
        if (section.kind === "search") {
            const q = section.q.toLowerCase();
            return folders.filter((f) => !f.trashed && f.name.toLowerCase().includes(q)).sort(sortFolders);
        }
        if (section.kind === "trash")
            return trashTab === "files"
                ? []
                : folders
                      .filter((f) => f.trashed && f.trashedWith === f.id && (trashOwner === "anyone" || f.mine))
                      .sort((a, b) => (trashSort === "trashed" ? (b.trashedAt ?? 0) - (a.trashedAt ?? 0) : trashSort === "name" ? byName(a, b) : modifiedOf(b) - modifiedOf(a)));
        if (section.kind === "drafts") return childFolders(folders, null, null).sort(sortFolders);
        // Recents › Shared folders: team folders someone else made that you can open.
        if (section.kind === "recents" && recentsTab === "folders") return folders.filter((f) => !f.trashed && !f.mine).sort(sortFolders);
        if (section.kind === "folders") return team ? childFolders(folders, null, team.id).sort(sortFolders) : [];
        if (currentFolder) return childFolders(folders, currentFolder.id, currentFolder.teamId).sort(sortFolders);
        return [];
    })();
    const order = [...shownFolders.map((f) => folderKey(f.id)), ...shown.map((f) => f.id)];

    const open = (f: FileMeta) => {
        if (f.trashed) return;
        if (f.shared) {
            const key = teamKeys.get(f.shared)?.edit ?? f.key ?? null;
            const meta = rememberShared(f.shared, f.name, key, f.kind);
            editor.set({ fileId: meta.id, homeOpen: false, sequenceView: f.kind === "video" });
            join(f.shared, undefined, key);
            return;
        }
        void openFile(f.id);
    };

    const createIn = async (doc: Parameters<typeof createServerFile>[0], k: FileKind, name: string) => {
        if (currentProject && account) {
            try {
                const created = await createServerFile(doc, k, currentProject.project.id);
                const meta = rememberShared(created.id, name, created.keys.edit, k);
                editor.set({ fileId: meta.id, homeOpen: false, sequenceView: k === "video" });
                join(created.id, undefined, created.keys.edit);
                void refreshServerFiles();
            } catch (error) {
                err(error);
            }
            return;
        }
        const meta = createFile(k, doc, name);
        // Made inside a Drafts folder: it stays in that folder.
        if (section.kind === "folder" && currentFolder) setFileFolder(meta.id, currentFolder.id);
        await openFile(meta.id);
    };

    const create = (k: FileKind) => {
        const name = k === "docs" ? "Untitled document" : k === "video" ? "Untitled video" : "Untitled";
        if (k === "board") return void createIn(createBoardDocument(name), k, name);
        if (k === "slides") return void createIn(createSlidesDocument(name), k, name);
        if (k === "campaign") return void createIn(createCampaignDocument("Untitled campaign"), k, "Untitled campaign");
        if (k === "site") return void createIn(createSiteDocument("Untitled site"), k, "Untitled site");
        if (k === "make") return void createIn(createMakeDocument("Untitled app"), k, "Untitled app");
        // A Document is a PDF: start blank (size, pages) or from a PDF on this computer.
        if (k === "docs") return openNewDocument((doc, docName) => createIn(doc, k, docName));
        const doc = { ...createEmptyDocument(name), ...(k === "video" ? { sequence: { width: 1920, height: 1080, fps: 30, clips: [] } } : {}) };
        void createIn(doc, k, name);
    };

    // ?new=design|board|slides|campaign|site|make|video|document opens Home straight into a new file of
    // that kind (the website's "Explore" buttons), once, then drops the parameter from the address.
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const wanted = params.get("new");
        if (!wanted) return;
        const kinds: Record<string, FileKind> = { design: "design", board: "board", slides: "slides", campaign: "campaign", site: "site", sites: "site", make: "make", video: "video", document: "docs", docs: "docs" };
        const k = kinds[wanted.toLowerCase()];
        const url = new URL(location.href);
        url.searchParams.delete("new");
        window.history.replaceState(null, "", url);
        if (k) create(k);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // A new folder where you are (the top of Drafts from places without folders), named straight away.
    const makeFolder = async (parent: Destination, name: string): Promise<string | null> => {
        try {
            if (parent.teamId) return await createProject(parent.teamId, name, parent.folderId);
            return createLocalFolder(name, parent.folderId).id;
        } catch (error) {
            err(error);
            return null;
        }
    };
    const newFolder = async () => {
        const here: Destination = currentFolder ? { teamId: currentFolder.teamId, folderId: currentFolder.id } : section.kind === "folders" && team ? { teamId: team.id, folderId: null } : { teamId: null, folderId: null };
        if (!currentFolder && section.kind !== "folders" && section.kind !== "drafts") go({ kind: "drafts" });
        const id = await makeFolder(here, "Untitled folder");
        if (!id) return;
        setPicked([folderKey(id)]);
        setRenaming(folderKey(id));
    };

    // Moves files and folders into a folder (or the top of Drafts or a team). Folders stay in their
    // space; files go anywhere you can edit, except the top of a team, which holds folders only.
    const moveItems = async (keys: string[], dest: Destination) => {
        let moved = 0;
        const skipped: string[] = [];
        for (const key of keys) {
            try {
                if (isFolderKey(key)) {
                    const f = folderById.get(key.slice(7));
                    if (!f || f.trashed) continue;
                    if (f.teamId !== dest.teamId) {
                        skipped.push(`"${f.name}" stays in ${teamName(f.teamId)}: folders move within Drafts or within their team.`);
                        continue;
                    }
                    if (dest.folderId && folderSubtree(folders, f.id).has(dest.folderId)) {
                        skipped.push(`"${f.name}" can't go inside itself.`);
                        continue;
                    }
                    if ((f.parentId ?? null) === dest.folderId) continue;
                    if (f.teamId) await moveProject(f.id, dest.folderId);
                    else moveLocalFolder(f.id, dest.folderId);
                    moved += 1;
                    continue;
                }
                const f = files.find((x) => x.id === key);
                if (!f || f.trashed) continue;
                if (f.role === "view") {
                    skipped.push(`"${f.name}" is view only.`);
                    continue;
                }
                if (dest.teamId) {
                    if (!dest.folderId) {
                        skipped.push(`Files go in a folder, not at the top of ${teamName(dest.teamId)}.`);
                        continue;
                    }
                    if (f.project === dest.folderId) continue;
                    if (!account) {
                        skipped.push("Sign in to move files into team folders.");
                        continue;
                    }
                    if (f.shared) await moveToProject(f.shared, dest.folderId);
                    else await moveDraftToProject(f.id, f.kind, dest.folderId);
                    const entry = f.id.startsWith("server:") ? null : f.id;
                    if (entry) setFileFolder(entry, null);
                    moved += 1;
                    continue;
                }
                // Into Drafts: out of its team folder first (yours, on the server), then into the Drafts folder.
                if (!f.project && (containerOf(f) ?? null) === dest.folderId) continue;
                if (f.project && f.shared) await moveToProject(f.shared, null);
                const entry = f.id.startsWith("server:") && f.shared ? rememberShared(f.shared, f.name, teamKeys.get(f.shared)?.edit ?? f.key, f.kind).id : f.id;
                setFileFolder(entry, dest.folderId);
                moved += 1;
            } catch (error) {
                skipped.push(error instanceof Error ? error.message : String(error));
            }
        }
        const where = dest.folderId ? (folderById.get(dest.folderId)?.name ?? "the folder") : teamName(dest.teamId);
        if (moved) editor.notify(`Moved ${moved === 1 ? "1 item" : `${moved} items`} to ${where}.${skipped.length ? ` ${skipped[0]}` : ""}`);
        else if (skipped.length) editor.notify(skipped[0] ?? "");
        setPicked([]);
    };

    const duplicate = async (f: FileMeta) => {
        try {
            if (f.shared) {
                const made = await duplicateServerFile(f.shared);
                rememberShared(made.id, made.name, made.keys.edit, made.kind);
                editor.notify(`Duplicated as "${made.name}" in your drafts.`);
            } else {
                const copy = await duplicateFile(f.id);
                if (copy) {
                    if (f.folderId) setFileFolder(copy.id, f.folderId);
                    editor.notify(`Duplicated as "${copy.name}".`);
                }
            }
        } catch (error) {
            err(error);
        }
    };
    const rename = (f: FileMeta, name: string) => {
        if (f.shared) void renameServerFile(f.shared, name);
        if (!f.id.startsWith("server:")) renameFile(f.id, name);
    };
    const trash = (f: FileMeta) => {
        if (f.shared) void putServerMeta(f.shared, { trashed: true }).then(refreshServerFiles);
        if (!f.id.startsWith("server:")) trashFile(f.id);
    };
    const restore = (f: FileMeta) => {
        if (f.shared) void putServerMeta(f.shared, { trashed: false }).then(refreshServerFiles);
        if (!f.id.startsWith("server:")) {
            restoreFile(f.id);
            // Its Drafts folder went to the trash or is gone: it comes back at the top of Drafts.
            if (f.folderId && (!localFolderIds.has(f.folderId) || trashedFolderIds.has(f.folderId))) setFileFolder(f.id, null);
        }
    };
    const renameFolder = (f: FolderItem, name: string) => {
        if (f.teamId) void renameProject(f.id, name).catch(err);
        else renameLocalFolder(f.id, name);
    };
    const trashFolder = (f: FolderItem) => {
        if (f.teamId) void deleteProject(f.id).catch(err);
        else trashLocalFolder(f.id);
    };
    const folderAct = (f: FolderItem, key: string) => {
        if (key === "open") openFolder(f);
        else if (key === "star") toggleStar(f.id);
        else if (key === "rename") setRenaming(folderKey(f.id));
        else if (key === "move") setMoving([folderKey(f.id)]);
        else if (key === "duplicate") {
            if (f.teamId) void duplicateProject(f.id).then(() => editor.notify(`Duplicated "${f.name}".`), err);
            else void duplicateLocalFolder(f.id).then(() => editor.notify(`Duplicated "${f.name}".`), err);
        } else if (key === "access") {
            const p = projectOf(f.id);
            if (p) setAccess({ team: p.team, project: p.project });
        } else if (key === "delete") setConfirmTrash([folderKey(f.id)]);
        else if (key === "color") setColoring(f);
        else if (key === "restore") {
            if (f.teamId) void restoreProject(f.id).then(() => editor.notify(`Restored "${f.name}".`), err);
            else {
                restoreLocalFolder(f.id);
                editor.notify(`Restored "${f.name}".`);
            }
        } else if (key === "forever" && window.confirm(`Delete "${f.name}" and everything in it forever?`)) {
            if (f.teamId) void deleteProjectForever(f.id).catch(err);
            else deleteLocalFolderForever(f.id);
        }
    };
    // Moves files and folders to the trash (after the confirmation).
    const trashPicked = (keys: string[]) => {
        let n = 0;
        for (const k of keys) {
            if (isFolderKey(k)) {
                const f = folderById.get(k.slice(7));
                if (f && f.canEdit && !f.trashed) {
                    trashFolder(f);
                    n += 1;
                }
            } else {
                const f = files.find((x) => x.id === k);
                if (f && f.role !== "view" && !f.trashed) {
                    trash(f);
                    n += 1;
                }
            }
        }
        setPicked([]);
        if (n) editor.notify(`Moved ${n === 1 ? "1 item" : `${n} items`} to the trash.`);
    };
    // A file in the trash comes back as a copy in your drafts.
    const duplicateToDrafts = async (f: FileMeta) => {
        try {
            if (f.shared) {
                const made = await duplicateServerFile(f.shared);
                rememberShared(made.id, made.name, made.keys.edit, made.kind);
                await refreshServerFiles();
                editor.notify(`Duplicated "${f.name}" into your drafts.`);
            } else {
                const copy = await duplicateFile(f.id);
                if (copy) {
                    setFileFolder(copy.id, null);
                    editor.notify(`Duplicated "${f.name}" into your drafts.`);
                }
            }
        } catch (error) {
            err(error);
        }
    };
    const setPinned = (f: FileMeta, pinned: boolean) => {
        if (f.shared && f.project) void putServerMeta(f.shared, { pinned }).then(refreshServerFiles);
        else if (!f.id.startsWith("server:")) setFilePinned(f.id, pinned);
        editor.notify(pinned ? `Pinned "${f.name}" to the top of its folder.` : `Unpinned "${f.name}".`);
    };
    // The folder a file is in, opened (from Recents, search or Starred).
    const showInFolder = (f: FileMeta) => {
        const c = containerOf(f);
        const folder = c ? folderById.get(c) : null;
        if (folder) openFolder(folder);
        else go({ kind: "drafts" });
    };

    // ⌘-click toggles one; ⇧-click picks the run from the last picked item to this one.
    const pick = (key: string, event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
        if (!(event.metaKey || event.ctrlKey || event.shiftKey)) return false;
        if (event.shiftKey && picked.length) {
            const a = order.indexOf(picked[picked.length - 1] ?? "");
            const b = order.indexOf(key);
            if (a >= 0 && b >= 0) {
                setPicked(Array.from(new Set([...picked, ...order.slice(Math.min(a, b), Math.max(a, b) + 1)])));
                return true;
            }
        }
        setPicked(picked.includes(key) ? picked.filter((id) => id !== key) : [...picked, key]);
        return true;
    };

    // Dragging: the picked items when the dragged one is picked, else just it.
    const startDrag = (key: string, e: React.DragEvent) => {
        const keys = picked.includes(key) ? picked : [key];
        if (!picked.includes(key)) setPicked([key]);
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(keys));
        e.dataTransfer.effectAllowed = "move";
    };
    const dropProps = (dest: Destination): DropProps => {
        const id = `${dest.teamId ?? ""}:${dest.folderId ?? ""}`;
        return {
            onDragOver: (e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                if (dropHover !== id) setDropHover(id);
            },
            onDragLeave: (e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setDropHover((h) => (h === id ? null : h));
            },
            onDrop: (e) => {
                e.preventDefault();
                e.stopPropagation();
                setDropHover(null);
                let keys: string[] = [];
                try {
                    keys = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as string[];
                } catch {
                    return;
                }
                const into = keys.filter((k) => k !== (dest.folderId ? folderKey(dest.folderId) : ""));
                if (into.length) void moveItems(into, dest);
            },
            "data-drop-hover": dropHover === id,
        };
    };

    // Dragging a box over empty space picks what it touches (⌘ or ⇧ adds to what's picked).
    const startMarquee = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        if (target.closest("[data-pick],button,input,select,a,label,[role=tab],[role=menu],[role=dialog]")) return;
        const base = e.metaKey || e.ctrlKey || e.shiftKey ? picked : [];
        const x0 = e.clientX;
        const y0 = e.clientY;
        let moved = false;
        const move = (ev: PointerEvent) => {
            if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
            moved = true;
            setMarquee({ x0, y0, x1: ev.clientX, y1: ev.clientY });
            const [l, r, t, b] = [Math.min(x0, ev.clientX), Math.max(x0, ev.clientX), Math.min(y0, ev.clientY), Math.max(y0, ev.clientY)];
            const hits = [...(scrollRef.current?.querySelectorAll<HTMLElement>("[data-pick]") ?? [])]
                .filter((el) => {
                    const box = el.getBoundingClientRect();
                    return box.right > l && box.left < r && box.bottom > t && box.top < b;
                })
                .map((el) => el.dataset.pick as string);
            setPicked(Array.from(new Set([...base, ...hits])));
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            setMarquee(null);
            if (!moved) setPicked(base);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };

    // Keys on Home: Enter opens, F2 renames, ⌘⌫ deletes, ⌘A picks everything shown, Esc lets go.
    const onKey = useRef<(e: KeyboardEvent) => void>(() => undefined);
    const handleKey = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        // ⌘/ focuses search, from anywhere on Home.
        if (e.key === "/" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            searchRef.current?.focus();
            return;
        }
        if (e.defaultPrevented || renaming || moving || confirmTrash) return;
        if (target?.closest("input,textarea,select,[contenteditable=true],[role=dialog],[role=menu]")) return;
        const mod = e.metaKey || e.ctrlKey;
        const one = picked.length === 1 ? picked[0] : null;
        const handled = () => (e.preventDefault(), e.stopPropagation());
        if (e.key === "Enter" && one) {
            handled();
            if (isFolderKey(one)) {
                const f = folderById.get(one.slice(7));
                if (f) openFolder(f);
            } else {
                const f = files.find((x) => x.id === one);
                if (f) open(f);
            }
        } else if (e.key === "F2" && one) {
            handled();
            setRenaming(one);
        } else if ((e.key === "Backspace" || e.key === "Delete") && mod && picked.length && section.kind !== "trash") {
            handled();
            setConfirmTrash(picked);
        } else if (e.key.toLowerCase() === "a" && mod && order.length) {
            handled();
            setPicked(order);
        } else if (e.key === "Escape" && picked.length) {
            handled();
            setPicked([]);
        }
    };
    useEffect(() => {
        onKey.current = handleKey;
    });
    useEffect(() => {
        const listener = (e: KeyboardEvent) => onKey.current(e);
        window.addEventListener("keydown", listener, true);
        return () => window.removeEventListener("keydown", listener, true);
    }, []);

    const starredFileList = files.filter((f) => !f.trashed && starredFiles.includes(starKey(f)));
    const starredFolders = folders.filter((f) => !f.trashed && starred.includes(f.id));

    const same = (a: Section, b: Section) => a.kind === b.kind && ("id" in a ? a.id : "") === ("id" in b ? b.id : "");
    // Teams need an account on the sync server: signed out, the sign-in dialog opens first.
    const createTeamFlow = async () => {
        if (!account) return openSignIn();
        const name = await askText("Create a team", "", { placeholder: "Team name", confirm: "Create team", hint: "A team has shared folders, members with roles, and an admin console." });
        if (!name?.trim()) return;
        try {
            const t = await createTeam(name.trim());
            setTeamId(t.id);
            go({ kind: "folders" });
        } catch (error) {
            err(error);
        }
    };

    const nav = (target: Section, label: string, Icon: typeof Clock | typeof FolderSolid, extra?: React.ReactNode, drop?: DropProps, iconColor?: string) => (
        <button
            type="button"
            onClick={() => go(target)}
            {...(drop ?? {})}
            className={`group flex h-[28px] w-full items-center gap-[12px] rounded-[5px] pr-2 pl-[8px] text-left text-[11px] text-ink ${same(section, target) ? "bg-brand-100" : "hover:bg-panel-hover"} ${drop?.["data-drop-hover"] ? "bg-brand-100 ring-1 ring-brand-500" : ""}`}
        >
            {Icon === FolderSolid ? <FolderSolid className="size-4 shrink-0" style={{ color: iconColor ?? FOLDER_COLORS[0][0] }} /> : <Icon className="size-4 shrink-0" />}
            <span className="flex-1 truncate">{label}</span>
            {extra}
        </button>
    );

    const title =
        searching ? "Search results"
        : section.kind === "recents" ? "Recents"
        : section.kind === "community" ? "Community"
        : section.kind === "drafts" ? "Drafts"
        : section.kind === "folders" ? "All folders"
        : section.kind === "resources" ? "Resources"
        : section.kind === "trash" ? "Trash"
        : section.kind === "admin" ? "Admin"
        : (currentFolder?.name ?? "Folder");
    const crumb = currentFolder?.teamId ? teamName(currentFolder.teamId) : currentFolder ? "Drafts" : (team?.name ?? (account ? "Your workspace" : "This browser"));
    const fileSection = section.kind !== "community" && section.kind !== "folders" && section.kind !== "resources" && section.kind !== "admin";
    // Team folders can be shared by the people who can edit them (team admins always can).
    const canShareFolder = (f: FolderItem) => Boolean(f.teamId && !f.connectedFrom && (f.canEdit || teams.find((t) => t.id === f.teamId)?.role === "admin"));
    const treeOpen = (f: FolderItem) => openFolder(f);
    const treeDrag = (f: FolderItem, e: React.DragEvent) => startDrag(folderKey(f.id), e);
    const pickedFolders = picked.filter(isFolderKey).length;
    const pickedLabel = picked.length === 1 ? "1 item" : `${picked.length} items`;
    const movingFolders = (moving ?? []).filter(isFolderKey).map((k) => folderById.get(k.slice(7))).filter((f): f is FolderItem => Boolean(f));
    const here: Destination | null = currentFolder ? { teamId: currentFolder.teamId, folderId: currentFolder.id } : section.kind === "drafts" ? { teamId: null, folderId: null } : null;
    const openNotice = (n: Notice) => {
        // Team notices (invites, requests, seats) go to the team's folders or its admin console.
        if (!n.fileId) {
            const t = teams.find((x) => x.id === (n.teamId ?? n.teamRequest?.teamId));
            if (t) setTeamId(t.id);
            void refreshTeams();
            return go(n.teamRequest && t?.role === "admin" ? { kind: "admin" } : { kind: "folders" });
        }
        rememberShared(n.fileId, n.fileName, n.key, n.kind);
        if (n.threadId) openCommentWhenLoaded(n.threadId);
        open({ id: `server:${n.fileId}`, name: n.fileName, kind: n.kind, createdAt: n.at, updatedAt: n.at, shared: n.fileId, key: n.key });
    };

    const folderBlock = shownFolders.length > 0 ? (
        <div className="mb-6">
                            {(fileSection || searching) && <div className="mb-2 text-[11px] font-semibold text-ink-subtle">Folders</div>}
                            <div className={view === "grid" ? GRID : "flex flex-col"}>
                                {shownFolders.map((f) => {
                                    const key = folderKey(f.id);
                                    return (
                                        <FolderCard
                                            key={f.id}
                                            folder={f}
                                            view={view}
                                            files={(filesIn.get(f.id) ?? []).length}
                                            folders={childFolders(folders, f.id, f.teamId).length}
                                            thumbs={thumbsOf(f)}
                                            subtitle={f.trashed ? `Trashed${f.trashedByMe ? " by you" : ""}${f.trashedAt ? ` ${ago(f.trashedAt)}` : ""}` : `Updated ${ago(modifiedOf(f))}`}
                                            location={searching || section.kind === "trash" ? folderLocation(f) : undefined}
                                            picked={picked.includes(key)}
                                            renaming={renaming === key}
                                            starred={starred.includes(f.id)}
                                            canShare={canShareFolder(f)}
                                            dropProps={f.trashed || !f.canEdit ? null : dropProps({ teamId: f.teamId, folderId: f.id })}
                                            onOpen={(event) => {
                                                if (event && pick(key, event)) return;
                                                setPicked([]);
                                                openFolder(f);
                                            }}
                                            onAction={(k) => folderAct(f, k)}
                                            onRenameEnd={(name) => {
                                                setRenaming(null);
                                                if (name) renameFolder(f, name);
                                            }}
                                            onDragStart={(e) => startDrag(key, e)}
                                        />
                                    );
                                })}
                            </div>
                        </div>
    ) : null;

    // Admin takes over the whole of Home, sidebar included (components/admin).
    if (section.kind === "admin" && team) return <AdminConsole team={team} bell={<NotificationsButton signedIn={Boolean(account)} onOpen={openNotice} />} onExit={() => go({ kind: "recents" })} />;

    return (
        <div className="flex h-full w-full bg-canvas text-[11px] text-ink">
            {/* Sidebar */}
            <aside className="flex w-[241px] shrink-0 flex-col border-r border-panel-border bg-panel">
                <SidebarAccount
                    name={account?.name || me.name || "You"}
                    color={account?.color || me.color}
                    avatar={avatarSrc(account?.avatar)}
                    bell={<NotificationsButton signedIn={Boolean(account)} onOpen={openNotice} />}
                    server={<ServerBadge />}
                    onAction={(k) => {
                        if (k === "signin") openSignIn();
                        else if (k === "server") openServerPicker();
                        else if (k === "settings") openAccountSettings("account");
                        else if (k === "notifications") openAccountSettings("notifications");
                        else if (k === "signout") void signOut().then(refreshServerFiles);
                        else if (k === "add") addAccount();
                        else if (k.startsWith("switch:")) {
                            switchAccount(k.slice(7));
                            void refreshServerFiles();
                        }
                        else if (k === "start") openWelcome();
                        else if (k === "theme") editor.setPrefs({ theme: editor.get().prefs.theme === "dark" ? "light" : "dark" });
                    }}
                >
                    {account ? (
                        <>
                            <MenuRow id="email" label={account.email} />
                            {otherAccounts.map((o) => (
                                <MenuRow key={o.user.id} id={`switch:${o.user.id}`} label={`Switch to ${o.user.name} (${o.user.email})`} />
                            ))}
                            <AriaSeparator className="my-1 h-px bg-white/10" />
                            <MenuRow id="settings" label="Settings" />
                            <MenuRow id="notifications" label="Notification settings" />
                            <MenuRow id="theme" label="Switch theme" />
                            <MenuRow id="start" label="Get started" />
                            <AriaSeparator className="my-1 h-px bg-white/10" />
                            <MenuRow id="server" label="Server…" />
                            <MenuRow id="add" label="Add account" />
                            <MenuRow id="signout" label="Log out" />
                        </>
                    ) : (
                        <>
                            <MenuRow id="signin" label="Sign in or create an account" />
                            <MenuRow id="server" label="Server…" />
                            <MenuRow id="theme" label="Switch theme" />
                            <MenuRow id="start" label="Get started" />
                        </>
                    )}
                </SidebarAccount>
                <HomeSearchField ref={searchRef} files={files} signedIn={Boolean(account)} locationOf={locationOf} onOpen={open} onSubmit={(q) => go({ kind: "search", q })} onPerson={(p) => go({ kind: "community", profile: p.handle || p.id })} />
                <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                    <div className="flex flex-col gap-[4px] px-2">
                        {nav({ kind: "recents" }, "Recents", Clock)}
                        {nav({ kind: "community" }, "Community", Cube01)}
                    </div>
                    <div className="mt-[10px] mb-[9px] h-px bg-panel-border" />
                    <div className="flex flex-col gap-[4px] px-2">
                        <div className="flex h-[32px] items-center gap-1">
                            <AriaMenuTrigger>
                                <AriaButton className="flex min-w-0 items-center gap-[12px] rounded-[5px] py-1 pr-1.5 pl-[8px] outline-none hover:bg-panel-hover">
                                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[9px] font-medium text-white ring-1 ring-white/70">{(team?.name ?? "W").slice(0, 1).toUpperCase()}</span>
                                    <span className="max-w-[86px] truncate text-[13px] font-semibold">{team?.name ?? "Workspace"}</span>
                                    <ChevronDown className="size-2.5 shrink-0 text-ink" />
                                </AriaButton>
                                <AriaPopover placement="bottom start" offset={4} className="w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                                    <AriaMenu
                                        className="outline-none"
                                        onAction={async (key) => {
                                            const k = String(key);
                                            if (k === "new") void createTeamFlow();
                                            else setTeamId(k);
                                        }}
                                    >
                                        {teams.map((t) => (
                                            <MenuRow key={t.id} id={t.id} label={t.name} checked={t.id === team?.id} />
                                        ))}
                                        <MenuRow id="new" label="Create new team" icon={Plus} />
                                    </AriaMenu>
                                </AriaPopover>
                            </AriaMenuTrigger>
                            <span className="ml-auto rounded bg-badge px-1.5 py-px text-[11px] text-badge-ink">{team ? (team.plan ?? "Professional") : "Free"}</span>
                        </div>
                        {!team && (
                            <button type="button" onClick={() => void createTeamFlow()} className="group flex h-[28px] w-full items-center gap-[12px] rounded-[5px] pr-2 pl-[8px] text-left text-[11px] text-brand-500 hover:bg-panel-hover">
                                <Plus className="size-4 shrink-0" />
                                <span className="flex-1 truncate">Create team</span>
                            </button>
                        )}
                        {nav(
                            { kind: "drafts" },
                            "Drafts",
                            File02,
                            childFolders(folders, null, null).length > 0 ? (
                                <span
                                    role="button"
                                    tabIndex={-1}
                                    aria-label={treeExpanded.has("drafts") ? "Collapse Drafts folders" : "Expand Drafts folders"}
                                    onClick={(e) => (e.stopPropagation(), toggleExpanded("drafts"))}
                                    className="flex size-4 items-center justify-center rounded text-ink-subtle hover:text-ink"
                                >
                                    {treeExpanded.has("drafts") ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                                </span>
                            ) : undefined,
                            dropProps({ teamId: null, folderId: null }),
                        )}
                        {treeExpanded.has("drafts") && childFolders(folders, null, null).length > 0 && (
                            <div className="pl-3">
                                <FolderTree folders={folders} teamId={null} currentId={currentFolder?.id ?? null} expanded={treeExpanded} onToggle={toggleExpanded} onOpen={treeOpen} dropProps={dropProps} onDragStart={treeDrag} />
                            </div>
                        )}
                        {nav(
                            { kind: "folders" },
                            "All folders",
                            Grid01,
                            team && childFolders(folders, null, team.id).length > 0 ? (
                                <span
                                    role="button"
                                    tabIndex={-1}
                                    aria-label={treeExpanded.has(`team:${team.id}`) ? "Collapse team folders" : "Expand team folders"}
                                    onClick={(e) => (e.stopPropagation(), toggleExpanded(`team:${team.id}`))}
                                    className="flex size-4 items-center justify-center rounded text-ink-subtle opacity-0 group-hover:opacity-100 hover:text-ink"
                                >
                                    {treeExpanded.has(`team:${team.id}`) ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                                </span>
                            ) : undefined,
                            team ? dropProps({ teamId: team.id, folderId: null }) : undefined,
                        )}
                        {team && treeExpanded.has(`team:${team.id}`) && childFolders(folders, null, team.id).length > 0 && (
                            <div className="pl-3">
                                <FolderTree folders={folders} teamId={team.id} currentId={currentFolder?.id ?? null} expanded={treeExpanded} onToggle={toggleExpanded} onOpen={treeOpen} dropProps={dropProps} onDragStart={treeDrag} />
                            </div>
                        )}
                        {nav({ kind: "resources" }, "Resources", LayoutAlt04)}
                        {nav({ kind: "trash" }, "Trash", Trash01)}
                        {team && nav({ kind: "admin" }, "Admin", Settings01)}
                    </div>
                    <div className="mt-[10px] mb-[12px] h-px bg-panel-border" />
                    <div className="flex flex-col gap-[4px] px-2">
                        <button type="button" aria-expanded={starredOpen} onClick={() => setStarredOpen(!starredOpen)} className="-ml-2 mb-[2px] flex h-[24px] w-[calc(100%+8px)] items-center gap-[1px] rounded pl-[5px] text-[11px] font-semibold text-ink hover:bg-panel-hover">
                            {starredOpen ? <ChevronDown className="size-2.5 text-ink-muted" /> : <ChevronRight className="size-2.5 text-ink-muted" />} Starred
                        </button>
                        {starredOpen && starredFolders.length === 0 && starredFileList.length === 0 && <div className="px-[8px] py-1 text-[11px] text-ink-subtle">Star a file or folder to keep it here.</div>}
                        {starredOpen && starredFileList.map((f) => {
                            const Icon = KIND_ICONS[f.kind];
                            return (
                                <button key={f.id} type="button" onClick={() => open(f)} className="flex h-[28px] w-full items-center gap-[12px] rounded-[5px] pl-[8px] pr-2 text-left text-[11px] text-ink hover:bg-panel-hover">
                                    <Icon className="size-4 shrink-0" />
                                    <span className="flex-1 truncate">{f.name}</span>
                                </button>
                            );
                        })}
                        {starredOpen && starredFolders.map((f) => (
                            <div key={f.id} title={folderLocation(f)}>
                                {nav(f.teamId ? { kind: "project", id: f.id } : { kind: "folder", id: f.id }, f.name, FolderSolid, undefined, dropProps({ teamId: f.teamId, folderId: f.id }), folderColor(f))}
                            </div>
                        ))}
                    </div>
                </div>
            </aside>

            {/* Main */}
            {section.kind === "resources" && <ResourcesPage team={team} canBack={history.back.length > 0} canForward={history.forward.length > 0} onBack={back} onForward={forward} onCommunity={() => go({ kind: "community" })} />}
            {section.kind !== "resources" && <main className="flex min-w-0 flex-1 flex-col bg-panel">
                <header className="flex h-[48px] shrink-0 items-center gap-[1px] pr-[32px] pl-[19px]">
                    <HistoryButtons canBack={history.back.length > 0} canForward={history.forward.length > 0} onBack={back} onForward={forward} />
                    <div className="ml-[2px] flex min-w-0 flex-1 items-center overflow-hidden">
                        {currentFolder && !searching ? (
                            <Breadcrumbs
                                root={currentFolder.teamId ? { label: teamName(currentFolder.teamId), onPress: () => go({ kind: "folders" }), dest: { teamId: currentFolder.teamId, folderId: null } } : { label: "Drafts", onPress: () => go({ kind: "drafts" }), dest: { teamId: null, folderId: null } }}
                                folders={folders}
                                path={folderPath(folders, currentFolder.id)}
                                onGo={openFolder}
                                dropProps={dropProps}
                                last={
                                    <AriaMenuTrigger>
                                        <AriaButton className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-[13.5px] text-ink outline-none hover:bg-panel-hover">
                                            <span className="truncate">{currentFolder.name}</span> <ChevronDown className="size-3 shrink-0 text-ink-subtle" />
                                        </AriaButton>
                                        <AriaPopover placement="bottom start" offset={4} className="w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                                            <AriaMenu
                                                className="outline-none"
                                                aria-label="Folder actions"
                                                onAction={async (key) => {
                                                    const k = String(key);
                                                    if (k === "rename") {
                                                        const name = await askText("Folder name", currentFolder.name);
                                                        if (name?.trim()) renameFolder(currentFolder, name.trim());
                                                    } else folderAct(currentFolder, k);
                                                }}
                                            >
                                                <FolderMenuItems folder={currentFolder} starred={starred.includes(currentFolder.id)} canShare={canShareFolder(currentFolder)} />
                                            </AriaMenu>
                                        </AriaPopover>
                                    </AriaMenuTrigger>
                                }
                            />
                        ) : section.kind === "drafts" && !searching ? (
                            <button type="button" {...dropProps({ teamId: null, folderId: null })} className="rounded-md px-1.5 py-1 text-[13.5px]">
                                Drafts
                            </button>
                        ) : section.kind === "folders" && !searching ? null : (
                            <span className="truncate px-1.5 text-[13.5px]">{section.kind === "recents" || section.kind === "trash" || section.kind === "community" || searching ? title : crumb}</span>
                        )}
                    </div>
                    {section.kind === "folders" ? (
                        <>
                            <button type="button" disabled={!canAdd} onClick={() => void newFolder()} className="mr-[9px] flex h-[33px] items-center gap-1.5 rounded-md bg-button pr-[13px] pl-[11px] text-[12px] font-medium text-white outline-none hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:opacity-50">
                                <Plus className="size-4" /> Folder
                            </button>
                            {team && (
                                <button type="button" onClick={() => setMembers(team)} className="flex h-[33px] items-center rounded-md border border-panel-border px-3 text-[12px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                                    Share
                                </button>
                            )}
                        </>
                    ) : (
                        <>
                            {/* Quick create pills for the four main kinds of file; Campaign, Site, Document, Video and the rest are under More. */}
                            {(
                                [
                                    ["design", "Design"],
                                    ["board", "Board"],
                                    ["slides", "Slides"],
                                    ["make", "Make"],
                                ] as const
                            ).map(([k, label]) => {
                                const Icon = KIND_ICONS[k];
                                return (
                                    <button key={k} type="button" disabled={!canAdd} onClick={() => create(k)} className="mr-[8px] flex h-[32px] shrink-0 items-center gap-[8px] rounded-full bg-field pr-[16px] pl-[15px] text-[11px] text-ink outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50">
                                        <span className={`flex size-[18px] items-center justify-center rounded-[4px] ${KIND_BADGE[k]}`}>
                                            <Icon className="size-3 text-white" />
                                        </span>
                                        {label}
                                    </button>
                                );
                            })}
                            <AriaMenuTrigger>
                                <AriaButton isDisabled={!canAdd} className="flex h-[32px] shrink-0 items-center gap-[6px] rounded-full bg-field pr-[16px] pl-[15px] text-[11px] text-ink outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50">
                                    More <ChevronDown className="size-3" />
                                </AriaButton>
                                <AriaPopover placement="bottom end" offset={6} className="w-64 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                                    <AriaMenu
                                        className="outline-none"
                                        aria-label="Create"
                                        onAction={(key) => {
                                            const k = String(key);
                                            if (k === "import") return pickImportFiles();
                                            if (k === "folder") return void newFolder();
                                            if (k === "template") return team ? openTemplatePicker(team.id) : openSignIn();
                                            create(k as FileKind);
                                        }}
                                    >
                                        <MenuRow id="folder" label="New folder" icon={FolderPlus} />
                                        <AriaSeparator className="my-1 h-px bg-white/10" />
                                        <MenuRow id="design" label="Design file" icon={Grid01} />
                                        <MenuRow id="docs" label="Document" icon={File06} />
                                        <MenuRow id="video" label="Video" icon={Film01} />
                                        <MenuRow id="board" label="Board" icon={StickerSquare} />
                                        <MenuRow id="slides" label="Slides" icon={PresentationChart01} />
                                        <MenuRow id="campaign" label="Campaign" icon={Announcement02} />
                                        <MenuRow id="site" label="Site" icon={Globe02} />
                                        <MenuRow id="make" label="Make" icon={Stars02} />
                                        <MenuRow id="template" label="From a team template…" />
                                        <AriaSeparator className="my-1 h-px bg-white/10" />
                                        <MenuRow id="import" label="Import…" />
                                    </AriaMenu>
                                </AriaPopover>
                            </AriaMenuTrigger>
                        </>
                    )}
                    {currentProject && <IconButton size="sm" icon={Users01} label="Share folder (team members)" onPress={() => setMembers(currentProject.team)} />}
                    {currentFolder && <IconButton size="sm" icon={Star01} label={starred.includes(currentFolder.id) ? "Unstar folder" : "Star folder"} active={starred.includes(currentFolder.id)} onPress={() => toggleStar(currentFolder.id)} />}
                </header>

                <div
                    ref={scrollRef}
                    onPointerDown={startMarquee}
                    // Files from the desktop dropped on Home open the way Import… opens them.
                    onDragOver={(e) => {
                        if (!e.dataTransfer.types.includes("Files")) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(e) => {
                        const dropped = Array.from(e.dataTransfer.files);
                        if (!dropped.length) return;
                        e.preventDefault();
                        e.stopPropagation();
                        void importAsNewFiles(dropped);
                    }}
                    className="relative min-h-0 flex-1 overflow-y-auto px-[34px] pb-8 select-none"
                >
                    {/* Page title row (Community and search results have their own) */}
                    {section.kind === "recents" && !searching && <RecommendedResources signedIn={Boolean(account)} onOpen={open} onMore={() => go({ kind: "community" })} />}
                    {section.kind !== "community" && !searching && <div className={`flex items-center gap-[9px] ${section.kind === "folders" ? "pt-[29px] pb-[36px]" : "pt-[21px] pb-[22px]"}`}>
                        {section.kind === "folders" && !searching && team ? (
                            <div className="-ml-[3px] flex h-[42px] min-w-0 items-center">
                                <span className="flex size-[42px] shrink-0 items-center justify-center rounded-[10px] bg-[#146ebb] text-[24px] text-white">{team.name.slice(0, 1).toUpperCase()}</span>
                                <span className="ml-[21px] truncate text-[24px]">{team.name}</span>
                                <span className="ml-[13px] rounded-[5px] bg-badge px-2 py-[2px] text-[15px] text-badge-ink">{team.plan ?? "Professional"}</span>
                                <AriaMenuTrigger>
                                    <AriaButton aria-label="Team menu" className="ml-[6px] flex size-7 items-center justify-center rounded-md text-ink outline-none hover:bg-panel-hover">
                                        <ChevronDown className="size-4" />
                                    </AriaButton>
                                    <AriaPopover placement="bottom start" offset={4} className="w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                                        <AriaMenu
                                            className="outline-none"
                                            aria-label="Team menu"
                                            onAction={async (key) => {
                                                const k = String(key);
                                                if (k === "settings") go({ kind: "admin" });
                                                else if (k === "members") setMembers(team);
                                                else if (k === "rename") {
                                                    const name = await askText("Team name", team.name);
                                                    if (name?.trim()) void updateTeam(team.id, { name: name.trim() }).catch(err);
                                                } else if (k === "leave" && window.confirm(`Leave ${team.name}? You'll lose access to its folders.`)) {
                                                    void leaveTeam(team.id).then(() => (setTeamId(null), go({ kind: "drafts" })), err);
                                                }
                                            }}
                                        >
                                            {team.role === "admin" && <MenuRow id="settings" label="Team settings" />}
                                            <MenuRow id="members" label="Members" />
                                            {team.role === "admin" && <MenuRow id="rename" label="Rename" />}
                                            <AriaSeparator className="my-1 h-px bg-white/10" />
                                            <MenuRow id="leave" label="Leave team" />
                                        </AriaMenu>
                                    </AriaPopover>
                                </AriaMenuTrigger>
                            </div>
                        ) : section.kind === "trash" ? (
                            <div className="flex h-[24px] items-center gap-[5px]" role="tablist" aria-label="Trash">
                                {(
                                    [
                                        ["files", "Files"],
                                        ["folders", "Folders"],
                                    ] as const
                                ).map(([id, label]) => (
                                    <button key={id} type="button" role="tab" aria-selected={trashTab === id} onClick={() => (setTrashTab(id), setPicked([]))} className={`h-[24px] rounded-[5px] px-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${trashTab === id ? "bg-field font-medium text-ink" : "text-ink-muted hover:text-ink"}`}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        ) : section.kind === "recents" && !searching ? (
                            <div className="flex h-[24px] items-center gap-[5px]" role="tablist" aria-label="Recents">
                                {(
                                    [
                                        ["all", "Recently viewed"],
                                        ["shared", "Shared files"],
                                        ["folders", "Shared folders"],
                                    ] as const
                                ).map(([id, label]) => (
                                    <button key={id} type="button" role="tab" aria-selected={recentsTab === id} onClick={() => (setRecentsTab(id), setPicked([]))} className={`h-[24px] rounded-[5px] px-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${recentsTab === id ? "bg-field font-medium text-ink" : "text-ink-muted hover:text-ink"}`}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        ) : (section.kind === "drafts" || currentFolder) && !searching ? (
                            <span className="h-[24px]" />
                        ) : (
                            <h1 className="text-[18px] font-semibold">{title}</h1>
                        )}
                        <div className="flex-1" />
                        {section.kind === "trash" && (shown.length > 0 || shownFolders.length > 0) && (
                            <button
                                type="button"
                                onClick={() => {
                                    if (!window.confirm("Delete everything in the trash forever?")) return;
                                    const local = emptyLocalTrash() + emptyLocalFolderTrash();
                                    if (account)
                                        void emptyServerTrash()
                                            .then((n) => (editor.notify(`Trash emptied: ${local + n} item${local + n === 1 ? "" : "s"} deleted.`), refreshTeams()))
                                            .catch(err);
                                    else editor.notify(`Trash emptied: ${local} item${local === 1 ? "" : "s"} deleted.`);
                                }}
                                className="h-[24px] rounded-[5px] px-2 text-[12px] text-red-400 hover:bg-panel-hover"
                            >
                                Empty trash
                            </button>
                        )}
                        {section.kind === "trash" && (
                            <Select aria-label="Created by" value={trashOwner} onChange={(e) => setTrashOwner(e.target.value as "you" | "anyone")} className={`h-[24px] rounded-[5px] border px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${trashOwner === "you" ? "border-brand-500 bg-brand-100 text-link" : "border-panel-border text-ink"}`}>
                                <option value="you">Created by you</option>
                                <option value="anyone">Created by anyone</option>
                            </Select>
                        )}
                        {(fileSection || section.kind === "folders") && (
                            <>
                                {(fileSection || searching) && !(section.kind === "trash" && trashTab === "folders") && (
                                    <Select aria-label="File type" value={kind} onChange={(e) => setKind(e.target.value as FileKind | "all")} className={FILTER}>
                                        <option value="all">All files</option>
                                        <option value="design">Design files</option>
                                        <option value="docs">Documents</option>
                                        <option value="video">Videos</option>
                                        <option value="board">Boards</option>
                                        <option value="slides">Slides</option>
                                        <option value="campaign">Campaigns</option>
                                        <option value="site">Sites</option>
                                        <option value="make">Make files</option>
                                    </Select>
                                )}
                                {section.kind === "trash" ? (
                                    <Select aria-label="Sort" value={trashSort} onChange={(e) => setTrashSort(e.target.value as typeof trashSort)} className={FILTER}>
                                        <option value="trashed">Date trashed</option>
                                        <option value="modified">Last modified</option>
                                        <option value="name">Alphabetical</option>
                                    </Select>
                                ) : (
                                    <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={FILTER}>
                                        <option value="modified">Last modified</option>
                                        <option value="created">Date created</option>
                                        <option value="name">Alphabetical</option>
                                    </Select>
                                )}
                                <div className="ml-[2px] flex h-[24px] overflow-hidden rounded-[5px] bg-field" role="group" aria-label="View">
                                    {(
                                        [
                                            ["grid", "Grid view", Grid01],
                                            ["list", "List view", List],
                                        ] as const
                                    ).map(([id, label, Icon]) => (
                                        <button key={id} type="button" aria-label={label} title={label} aria-pressed={view === id} onClick={() => setView(id)} className={`flex w-[25px] items-center justify-center text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset ${view === id ? "rounded-[5px] border border-panel-border bg-panel" : "hover:bg-panel-hover"}`}>
                                            <Icon className="size-3.5" />
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>}
                    {!searching && section.kind === "folders" && !team && <div className="py-10 text-center text-ink-muted">{account ? "Create a team from the workspace menu on the left to get team folders." : "Sign in to create a team with folders."}</div>}
                    {!searching && section.kind === "folders" && team && shownFolders.length === 0 && <div className="py-10 text-center text-ink-muted">{canAdd ? "No folders yet. Use + Folder to make one." : "No folders you can see yet."}</div>}


                    {!searching && folderBlock}

                    {section.kind === "community" && <CommunityPage signedIn={Boolean(account)} profile={section.profile ?? null} onProfile={(who) => go(who ? { kind: "community", profile: who } : { kind: "community" })} onOpen={open} publishing={publishing} onPublished={() => setPublishing(null)} />}
                    {section.kind === "search" && <SearchResultsPage key={section.q} q={section.q} files={files} teams={teams} signedIn={Boolean(account)} locationOf={locationOf} onOpen={open} onPerson={(p) => go({ kind: "community", profile: p.handle || p.id })} view={view} folders={folderBlock} />}
                    {fileSection && !searching && !loaded && account && shown.length === 0 && <SkeletonGrid view={view} />}
                    {fileSection && !searching && (loaded || !account || shown.length > 0) && (
                        <>
                            {shownFolders.length > 0 && shown.length > 0 && <div className="mb-2 text-[11px] font-semibold text-ink-subtle">Files</div>}
                            {shown.length === 0 && shownFolders.length === 0 && (
                                <div className="mt-12 text-center text-ink-muted">
                                    {section.kind === "trash" ? "Nothing in the trash."
                                    : section.kind === "recents" && recentsTab === "shared" ? "Nothing shared with you yet. Files other people invite you to show up here."
                                    : section.kind === "recents" && recentsTab === "folders" ? "No shared folders yet. Team folders other people make show up here."
                                    : currentFolder ? "This folder is empty. Make a file with the buttons above, add a New folder, or drag files here."
                                    : online || !account ? "No files here yet. Make one with the buttons above." : "The sync server isn't reachable. Start it to see shared files."}
                                    {inDesktopApp && !currentServer() && section.kind === "recents" && recentsTab === "all" && (
                                        <p className="mx-auto mt-3 max-w-[420px] text-[12px] leading-relaxed text-ink-subtle">
                                            Nagma runs a server on this computer for your own files; connect to a server to collaborate.{" "}
                                            <button type="button" onClick={openServerPicker} className="text-brand-500 hover:underline">
                                                Connect to a server
                                            </button>
                                        </p>
                                    )}
                                </div>
                            )}
                            <div className={view === "grid" ? GRID : "flex flex-col"}>
                                {shown.map((f) => {
                                    const c = containerOf(f);
                                    const place = c && c !== currentFolder?.id ? (folderById.get(c)?.name ?? null) : null;
                                    return (
                                        <FileCard
                                            key={f.id}
                                            file={f}
                                            view={view}
                                            current={f.id === currentId}
                                            picked={picked.includes(f.id)}
                                            renaming={renaming === f.id}
                                            canMove={!f.trashed}
                                            starred={starredFiles.includes(starKey(f))}
                                            place={place}
                                            showLocation={false}
                                            more={{ showInFolder: Boolean(c && c !== currentFolder?.id), pinned: currentFolder && c === currentFolder.id && f.role !== "view" ? Boolean(f.pinned) : null, publish: Boolean(f.shared && f.role !== "view" && account), restoreThumb: Boolean(f.thumbFrame) }}
                                            onMore={(k) => {
                                                if (k === "show") showInFolder(f);
                                                else if (k === "pin" || k === "unpin") setPinned(f, k === "pin");
                                                else if (k === "publish") setPublishing(f);
                                                else if (k === "thumb") restoreDefaultThumbnail(f.id);
                                                else if (k === "drafts") void duplicateToDrafts(f);
                                            }}
                                            other={f.ownerId && f.ownerId !== account?.id ? (serverFiles.find((x) => x.id === f.shared)?.owner ?? null) : null}
                                            link={f.shared ? serverFileLink(f.shared, teamKeys.get(f.shared)?.edit ?? f.key) : null}
                                            onOpen={(event) => {
                                                if (event && pick(f.id, event)) return;
                                                setPicked([]);
                                                open(f);
                                            }}
                                            onMoveTo={() => setMoving([f.id])}
                                            onDuplicate={() => void duplicate(f)}
                                            serverActions={f.shared ? { claimable: Boolean(serverFiles.find((x) => x.id === f.shared)?.claimable), invited: Boolean(serverFiles.find((x) => x.id === f.shared)?.invited) } : null}
                                            onClaim={() => f.shared && void claimServerFile(f.shared).then(() => editor.notify(`"${f.name}" is yours now. Its links changed.`), err)}
                                            onLeave={() => f.shared && window.confirm(`Leave "${f.name}"? You'll need to be invited again to open it.`) && void leaveServerFile(f.shared).then(() => editor.notify(`You left "${f.name}".`), err)}
                                            onRenameStart={() => setRenaming(f.id)}
                                            onRenameEnd={(name) => {
                                                setRenaming(null);
                                                if (name) rename(f, name);
                                            }}
                                            onTrash={() => setConfirmTrash([f.id])}
                                            onRestore={() => restore(f)}
                                            onDragStart={(e) => startDrag(f.id, e)}
                                        />
                                    );
                                })}
                            </div>
                        </>
                    )}
                    {picked.length > 0 && (
                        <div className="sticky bottom-4 z-10 mx-auto mt-6 flex w-fit items-center gap-2 rounded-lg bg-tooltip py-1.5 pr-1.5 pl-3 text-[12px] text-white shadow-xl" data-pick-bar>
                            <span>{pickedLabel} selected</span>
                            {section.kind !== "trash" && (
                                <>
                                    <button type="button" onClick={() => setMoving(picked)} className="h-7 rounded-md bg-white/10 px-2.5 hover:bg-white/20">
                                        Move to…
                                    </button>
                                    <button type="button" onClick={() => setConfirmTrash(picked)} className="h-7 rounded-md bg-white/10 px-2.5 hover:bg-white/20">
                                        {pickedFolders ? "Delete" : "Move to trash"}
                                    </button>
                                </>
                            )}
                            <button type="button" onClick={() => setPicked([])} className="h-7 rounded-md px-2.5 text-white/70 hover:bg-white/10 hover:text-white">
                                Clear
                            </button>
                        </div>
                    )}
                    {marquee && (
                        <div
                            aria-hidden
                            className="pointer-events-none fixed z-20 rounded-sm border border-brand-500 bg-brand-500/10"
                            style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }}
                        />
                    )}
                </div>
            </main>}
            <TemplatePickerHost teams={teams} projectId={currentProject?.project.id ?? null} />
            {moving && (
                <MoveDialog
                    title={moving.length === 1 ? `Move "${isFolderKey(moving[0] ?? "") ? (folderById.get((moving[0] ?? "").slice(7))?.name ?? "folder") : (files.find((f) => f.id === moving[0])?.name ?? "file")}"` : `Move ${moving.length} items`}
                    folders={folders}
                    teams={teams}
                    signedIn={Boolean(account)}
                    movingFiles={moving.some((k) => !isFolderKey(k))}
                    folderSpace={movingFolders.length ? (movingFolders[0]?.teamId ?? null) : undefined}
                    excluded={new Set(movingFolders.flatMap((f) => [...folderSubtree(folders, f.id)]))}
                    initial={here}
                    onCreate={makeFolder}
                    onMove={(dest) => {
                        const keys = moving;
                        setMoving(null);
                        void moveItems(keys, dest);
                    }}
                    onClose={() => setMoving(null)}
                />
            )}
            {members && <TeamDialog team={teams.find((t) => t.id === members.id) ?? members} onClose={() => setMembers(null)} />}
            {access && <ProjectAccessDialog team={teams.find((t) => t.id === access.team.id) ?? access.team} project={access.project} onClose={() => setAccess(null)} />}
            {confirmTrash && (
                <PanelDialog
                    title={confirmTrash.length === 1 ? (isFolderKey(confirmTrash[0] ?? "") ? "Delete folder?" : "Move file to trash?") : `Move ${confirmTrash.length} items to trash?`}
                    description={
                        confirmTrash.length === 1 && isFolderKey(confirmTrash[0] ?? "")
                            ? `"${folderById.get((confirmTrash[0] ?? "").slice(7))?.name ?? "This folder"}" and everything in it go to the trash. Restore them from the trash for ${30} days.`
                            : confirmTrash.length === 1
                              ? `"${files.find((f) => f.id === confirmTrash[0])?.name ?? "This file"}" goes to the trash. Anyone it's shared with loses access until it's restored.`
                              : "They go to the trash. Restore them from the trash within 30 days."
                    }
                    onClose={() => setConfirmTrash(null)}
                    footer={
                        <>
                            <PanelButton onPress={() => setConfirmTrash(null)}>Cancel</PanelButton>
                            <PanelButton
                                variant="danger"
                                onPress={() => {
                                    const keys = confirmTrash;
                                    setConfirmTrash(null);
                                    trashPicked(keys);
                                }}
                            >
                                {confirmTrash.some(isFolderKey) ? "Delete" : "Move to trash"}
                            </PanelButton>
                        </>
                    }
                />
            )}
            {coloring && (
                <PanelDialog title={`Color for "${coloring.name}"`} onClose={() => setColoring(null)} width={320}>
                    <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Folder color">
                        {FOLDER_COLORS.map(([c, label]) => (
                            <button
                                key={c}
                                type="button"
                                role="radio"
                                aria-checked={folderColor(coloring) === c}
                                aria-label={label}
                                title={label}
                                onClick={() => {
                                    const value = c === FOLDER_COLORS[0][0] ? null : c;
                                    if (coloring.teamId) void updateFolderSharing(coloring.id, { color: value }).catch(err);
                                    else setLocalFolderColor(coloring.id, value);
                                    setColoring(null);
                                }}
                                className={`flex h-10 items-center justify-center rounded-md border outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500 ${folderColor(coloring) === c ? "border-brand-500" : "border-panel-border"}`}
                            >
                                <FolderSolid className="size-6" style={{ color: c }} />
                            </button>
                        ))}
                    </div>
                </PanelDialog>
            )}
        </div>
    );
}

function FileCard({
    file,
    view,
    current,
    picked,
    renaming,
    canMove,
    starred,
    place,
    showLocation,
    more,
    onMore,
    other,
    link,
    onOpen,
    onMoveTo,
    onDuplicate,
    serverActions,
    onClaim,
    onLeave,
    onRenameStart,
    onRenameEnd,
    onTrash,
    onRestore,
    onDragStart,
}: {
    file: FileMeta;
    view: "grid" | "list";
    current: boolean;
    picked: boolean;
    renaming: boolean;
    canMove: boolean;
    starred: boolean;
    // Where the file is, when that isn't where you're looking (the full path in search results).
    place: string | null;
    showLocation: boolean;
    // More actions for this card: show its folder, pin it (null: not pinnable here), publish, restore its thumbnail.
    more: { showInFolder: boolean; pinned: boolean | null; publish: boolean; restoreThumb: boolean };
    onMore: (key: string) => void;
    // Someone else's file: their avatar shows on the card.
    other: { name: string; color: string } | null;
    link: string | null;
    onOpen: (event?: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => void;
    onMoveTo: () => void;
    onDuplicate: () => void;
    serverActions: { claimable: boolean; invited: boolean } | null;
    onClaim: () => void;
    onLeave: () => void;
    onRenameStart: () => void;
    onRenameEnd: (name: string | null) => void;
    onTrash: () => void;
    onRestore: () => void;
    onDragStart: (e: React.DragEvent) => void;
}) {
    // Right-click opens the same menu as "…", at the pointer.
    const [contextAt, setContextAt] = useState<{ x: number; y: number } | null>(null);
    const anchor = useRef<HTMLSpanElement>(null);
    const nameField = useRef<HTMLInputElement>(null);
    // The menu hands focus back to its button as it closes, so the name field takes it a moment later.
    useEffect(() => {
        if (!renaming) return;
        const t = window.setTimeout(() => {
            nameField.current?.focus();
            nameField.current?.select();
        }, 60);
        return () => window.clearTimeout(t);
    }, [renaming]);
    const Icon = KIND_ICONS[file.kind];
    const canEdit = file.role !== "view";
    // Deleting for good is the owner's (or a folder admin's, which the server checks) for files on the server.
    const myId = auth.get().user?.id ?? null;
    const canDeleteForever = !file.shared || !file.ownerId || file.ownerId === myId || Boolean(file.project);
    const act = (k: string) => {
        if (k === "open") onOpen();
        else if (k === "tab" && link) window.open(link, "_blank");
        else if (k === "link" && link)
            void navigator.clipboard.writeText(link).then(
                () => editor.notify("Link copied."),
                () => editor.notify("The browser didn't allow copying."),
            );
        else if (k === "star") toggleStarFile(starKey(file));
        else if (k === "rename") onRenameStart();
        else if (k === "duplicate") onDuplicate();
        else if (k === "claim") onClaim();
        else if (k === "leave") onLeave();
        else if (k === "move") onMoveTo();
        else if (k === "trash") onTrash();
        else if (k === "restore") onRestore();
        else if (["show", "pin", "unpin", "publish", "thumb", "drafts"].includes(k)) onMore(k);
        else if (k === "delete" && window.confirm(`Delete "${file.name}" forever?`)) {
            if (!file.id.startsWith("server:")) deleteForever(file.id);
            if (file.shared) void deleteServerForever(file.shared).catch(err);
        }
    };
    const items = file.trashed ? (
        <>
            <MenuRow id="restore" label="Restore" />
            <MenuRow id="drafts" label="Duplicate to drafts" />
            {canDeleteForever && <MenuRow id="delete" label="Delete forever" />}
        </>
    ) : (
        <>
            <MenuRow id="open" label="Open" />
            {link && <MenuRow id="tab" label="Open in new tab" />}
            {link && <MenuRow id="link" label="Copy link" />}
            {more.showInFolder && <MenuRow id="show" label="Show in folder" />}
            <AriaSeparator className="my-1 h-px bg-white/10" />
            <MenuRow id="star" label={starred ? "Remove from starred" : "Add to starred"} />
            {more.pinned !== null && <MenuRow id={more.pinned ? "unpin" : "pin"} label={more.pinned ? "Unpin from folder" : "Pin to folder"} />}
            <AriaSeparator className="my-1 h-px bg-white/10" />
            {canEdit && <MenuRow id="rename" label="Rename" shortcut="F2" />}
            <MenuRow id="duplicate" label="Duplicate" />
            {canMove && canEdit && <MenuRow id="move" label="Move to…" />}
            {more.publish && <MenuRow id="publish" label="Publish to Community…" />}
            {more.restoreThumb && canEdit && <MenuRow id="thumb" label="Restore default thumbnail" />}
            {serverActions?.claimable && <MenuRow id="claim" label="Claim file" />}
            {serverActions?.invited && (
                <>
                    <AriaSeparator className="my-1 h-px bg-white/10" />
                    <MenuRow id="leave" label="Leave file" />
                </>
            )}
            {canEdit && (
                <>
                    <AriaSeparator className="my-1 h-px bg-white/10" />
                    <MenuRow id="trash" label="Move to trash" shortcut="⌘⌫" />
                </>
            )}
        </>
    );
    const menuClass = "w-60 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";
    const menu = (
        <AriaMenuTrigger>
            <AriaButton aria-label="File actions" className="flex size-6 items-center justify-center rounded text-ink-subtle outline-none hover:bg-panel-hover hover:text-ink">
                …
            </AriaButton>
            <AriaPopover placement="bottom end" offset={4} className={menuClass}>
                <AriaMenu className="outline-none" aria-label="File actions" onAction={(key) => act(String(key))}>
                    {items}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
    const context = (
        <>
            <span ref={anchor} aria-hidden className="pointer-events-none fixed size-0" style={contextAt ? { left: contextAt.x, top: contextAt.y } : { left: 0, top: 0 }} />
            <AriaPopover triggerRef={anchor} isOpen={Boolean(contextAt)} onOpenChange={(o) => !o && setContextAt(null)} placement="bottom start" offset={2} className={menuClass}>
                <AriaMenu
                    className="outline-none"
                    aria-label="File actions"
                    autoFocus="first"
                    onAction={(key) => {
                        setContextAt(null);
                        act(String(key));
                    }}
                >
                    {items}
                </AriaMenu>
            </AriaPopover>
        </>
    );
    const onContextMenu = (e: React.MouseEvent) => {
        if (renaming) return;
        e.preventDefault();
        setContextAt({ x: e.clientX, y: e.clientY });
    };
    const name = renaming ? (
        <input
            ref={nameField}
            autoFocus
            defaultValue={file.name}
            aria-label="File name"
            onBlur={(e) => {
                const v = e.target.value.trim();
                onRenameEnd(v && v !== file.name ? v : null);
            }}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") onRenameEnd(null);
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded border border-brand-500 bg-field px-1 py-0.5 font-medium text-ink outline-none"
        />
    ) : (
        <span className="flex items-center gap-1 truncate text-[12px] leading-[18px] font-medium">
            {file.pinned && more.pinned !== null && <Pin02 className="size-3 shrink-0 text-ink-muted" aria-label="Pinned" />}
            <span className="truncate">{file.name}</span>
            {starred && view === "list" && <Star01 className="size-3 shrink-0 fill-current text-amber-400" aria-label="Starred" />}
        </span>
    );
    const edited = file.trashed ? `Trashed${file.trashedByMe === false ? "" : " by you"}${file.trashedAt ? ` ${ago(file.trashedAt)}` : ""}` : `Edited ${ago(file.updatedAt)}`;
    const subtitle = place && !showLocation ? `${place} · ${edited}` : place && view === "grid" ? `${place} · ${edited}` : edited;
    const badge = (
        <span className={`flex size-4 shrink-0 items-center justify-center rounded ${KIND_BADGE[file.kind]}`} title={KIND_LABELS[file.kind]}>
            <Icon className="size-2.5 text-white" />
        </span>
    );
    const drag = { "data-pick": file.id, draggable: !renaming && !file.trashed && canEdit, onDragStart };
    if (view === "list") {
        return (
            <div
                {...drag}
                role="row"
                tabIndex={0}
                onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey) && onOpen(e)}
                onDoubleClick={() => onOpen()}
                onKeyDown={(e) => e.key === "Enter" && !renaming && (e.preventDefault(), onOpen())}
                onContextMenu={onContextMenu}
                aria-selected={picked}
                className={`flex h-10 items-center gap-3 border-b border-panel-border px-2 outline-none hover:bg-panel-hover focus-visible:bg-panel-hover ${picked ? "bg-brand-500/10" : ""} ${current ? "text-brand-500" : ""}`}
            >
                {badge}
                <div className="min-w-0 flex-1">{name}</div>
                {showLocation && <span className="w-48 truncate text-ink-muted" title={place ?? ""}>{place}</span>}
                <span className="w-28 text-ink-muted">{KIND_LABELS[file.kind]}</span>
                <span className="w-56 truncate text-ink-muted">{showLocation ? edited : subtitle}</span>
                <div onClick={(e) => e.stopPropagation()}>{menu}</div>
                {context}
            </div>
        );
    }
    return (
        <div
            {...drag}
            role="button"
            tabIndex={0}
            aria-pressed={picked}
            onClick={(e) => onOpen(e)}
            onContextMenu={onContextMenu}
            onKeyDown={(e) => e.key === "Enter" && !renaming && (e.preventDefault(), onOpen())}
            className={`group overflow-hidden rounded-[7px] border bg-panel outline-none hover:border-ink-subtle focus-visible:ring-2 focus-visible:ring-brand-500 ${picked ? "border-brand-500 ring-2 ring-brand-500" : current ? "border-brand-500" : "border-card-border"}`}
        >
            {/* The canvas picture sits on the canvas colour, whole. */}
            <div className="flex h-[191px] w-full items-center justify-center border-b border-card-border bg-canvas">
                {file.thumb ? <div className="size-full bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url(${file.thumb})` }} /> : <Icon className="size-8 text-ink/10" />}
            </div>
            <div className="flex h-[57px] items-center gap-[12px] pr-3 pl-[16px]">
                {badge}
                <div className="min-w-0 flex-1">
                    {name}
                    <div className="truncate text-[12px] leading-[18px] text-ink-muted" title={subtitle}>{subtitle}</div>
                </div>
                {other && (
                    <span title={`${other.name}'s file`}>
                        <Avatar name={other.name} color={other.color} size={22} single />
                    </span>
                )}
                <div onClick={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 focus-within:opacity-100">
                    {menu}
                    {context}
                </div>
            </div>
        </div>
    );
}
