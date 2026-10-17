import { ArrowLeft, Copy01, Heart, SearchSm } from "@untitledui/icons";
import { useEffect, useState } from "react";
import { avatarSrc } from "../engine/account";
import { type CommunityEntry, type CommunityProfile, browseCommunity, communityProfile, duplicateCommunityFile, publishToCommunity, toggleLike, unpublish } from "../engine/community";
import { type FileMeta, KIND_LABELS, getServerFiles, rememberShared, refreshServerFiles } from "../engine/files";
import { RESOURCE_TYPES } from "../engine/search";
import { editor } from "../engine/store";
import { Button, Dialog, ErrorText, FieldLabel, field } from "./admin/admin-ui";
import { Avatar } from "./avatar";
import { SkeletonGrid } from "./home-search";
import { Select } from "./select";

// The Community page: files and templates people on this server publish, to browse, search, like,
// open (view only) and duplicate into your drafts; people's profiles with what they've published;
// and publishing one of your own files.

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-x-[34px] gap-y-[35px]";
const FILTER = "h-[24px] rounded-[5px] border border-panel-border px-2 text-[12px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500";
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function CommunityPage({ signedIn, profile, onProfile, onOpen, publishing, onPublished }: { signedIn: boolean; profile: string | null; onProfile: (who: string | null) => void; onOpen: (f: FileMeta) => void; publishing: FileMeta | null; onPublished: () => void }) {
    const [q, setQ] = useState("");
    const [kind, setKind] = useState("all");
    const [sort, setSort] = useState<"popular" | "recent">("popular");
    const [list, setList] = useState<CommunityEntry[] | null>(null);
    const [person, setPerson] = useState<CommunityProfile | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [detail, setDetail] = useState<CommunityEntry | null>(null);
    const [publishOpen, setPublishOpen] = useState(false);
    const [version, setVersion] = useState(0);
    const reload = () => setVersion((v) => v + 1);
    useEffect(() => {
        if (!signedIn) return;
        let alive = true;
        const t = window.setTimeout(() => {
            if (profile)
                void communityProfile(profile).then(
                    (p) => alive && (setPerson(p), setError(null)),
                    (e: unknown) => alive && setError(err(e)),
                );
            else
                void browseCommunity({ q, kind, sort }).then(
                    (l) => alive && (setList(l), setError(null)),
                    (e: unknown) => alive && setError(err(e)),
                );
        }, 120);
        return () => ((alive = false), window.clearTimeout(t));
    }, [signedIn, q, kind, sort, profile, version]);
    const entries = profile ? (person?.files ?? null) : list;
    const update = (e: CommunityEntry) => {
        setList((l) => l?.map((x) => (x.id === e.id ? e : x)) ?? l);
        setPerson((p) => (p ? { ...p, files: p.files.map((x) => (x.id === e.id ? e : x)) } : p));
        setDetail((d) => (d?.id === e.id ? e : d));
    };
    const like = (e: CommunityEntry) => void toggleLike(e.id).then(update, (x: unknown) => editor.notify(err(x)));
    const duplicate = (e: CommunityEntry) =>
        void duplicateCommunityFile(e.id).then(
            (made) => {
                rememberShared(made.id, made.name, made.keys.edit, made.kind);
                void refreshServerFiles();
                editor.notify(`Duplicated "${made.name}" into your drafts.`);
                update({ ...e, duplicates: e.duplicates + 1 });
            },
            (x: unknown) => editor.notify(err(x)),
        );
    const open = (e: CommunityEntry) => onOpen({ id: `server:${e.fileId}`, name: e.name, kind: e.kind, createdAt: e.publishedAt, updatedAt: e.updatedAt, thumb: e.thumb ?? undefined, shared: e.fileId, key: e.viewKey, role: "view" });
    if (!signedIn) return <div className="mt-16 text-center text-ink-muted">Sign in to browse what people on this server publish to the community.</div>;
    return (
        <div>
            {profile ? (
                <div className="flex items-start gap-4 pt-[26px] pb-[24px]">
                    <button type="button" aria-label="Back to the community" onClick={() => onProfile(null)} className="mt-1 flex size-7 items-center justify-center rounded-md text-ink outline-none hover:bg-panel-hover">
                        <ArrowLeft className="size-4" />
                    </button>
                    {person && (
                        <>
                            <Avatar name={person.name} color={person.color} size={56} single src={avatarSrc(person.avatar)} />
                            <div className="min-w-0 flex-1">
                                <h1 className="text-[20px] font-semibold">{person.name}</h1>
                                <p className="text-[12px] text-ink-muted">
                                    {person.handle ? `@${person.handle} · ` : ""}
                                    {person.files.length} published · {person.likes} {person.likes === 1 ? "like" : "likes"}
                                </p>
                                {person.bio && <p className="mt-2 max-w-[560px] text-[12.5px]">{person.bio}</p>}
                            </div>
                        </>
                    )}
                </div>
            ) : (
                <div className="flex flex-wrap items-center gap-[9px] pt-[26px] pb-[24px]">
                    <h1 className="text-[18px] font-semibold">Community</h1>
                    <label className="ml-4 flex h-[28px] w-[240px] items-center gap-2 rounded-md bg-field px-2 text-[12px] focus-within:ring-1 focus-within:ring-brand-500">
                        <SearchSm className="size-3.5 shrink-0 text-ink-muted" />
                        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search files, templates and people" aria-label="Search the community" className="w-full bg-transparent outline-none placeholder:text-ink-subtle" />
                    </label>
                    <div className="flex-1" />
                    <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} className={FILTER}>
                        <option value="all">All resources</option>
                        <option value="templates">Templates</option>
                        {RESOURCE_TYPES.map(([k, label]) => (
                            <option key={k} value={k}>
                                {label}
                            </option>
                        ))}
                    </Select>
                    <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as "popular" | "recent")} className={FILTER}>
                        <option value="popular">Popular</option>
                        <option value="recent">Recent</option>
                    </Select>
                    <button type="button" onClick={() => setPublishOpen(true)} className="flex h-[24px] items-center rounded-[5px] bg-button px-2.5 text-[12px] font-medium text-white hover:bg-brand-600">
                        Publish…
                    </button>
                </div>
            )}
            <ErrorText>{error}</ErrorText>
            {!entries ? (
                <SkeletonGrid view="grid" count={6} />
            ) : entries.length === 0 ? (
                <div className="mt-12 text-center text-ink-muted">{profile ? "Nothing published yet." : q ? `Nothing in the community matches "${q}".` : "Nothing published yet. Publish a file or template for everyone on this server to find."}</div>
            ) : (
                <div className={GRID}>
                    {entries.map((e) => (
                        <div key={e.id} className="group overflow-hidden rounded-[7px] border border-card-border bg-panel hover:border-ink-subtle">
                            <button type="button" onClick={() => setDetail(e)} className="block h-[172px] w-full border-b border-card-border bg-canvas bg-contain bg-center bg-no-repeat outline-none focus-visible:ring-2 focus-visible:ring-brand-500" style={e.thumb ? { backgroundImage: `url(${e.thumb})` } : undefined} aria-label={`About ${e.name}`} />
                            <div className="flex h-[61px] items-center gap-3 pr-3 pl-[17px]">
                                <button type="button" onClick={() => onProfile(e.by.handle || e.by.id)} title={`${e.by.name}'s profile`}>
                                    <Avatar name={e.by.name} color={e.by.color} size={22} single src={avatarSrc(e.by.avatar)} />
                                </button>
                                <button type="button" onClick={() => setDetail(e)} className="min-w-0 flex-1 text-left">
                                    <span className="block truncate text-[12px] leading-[19px] font-medium">{e.name}</span>
                                    <span className="block truncate text-[12px] leading-[19px] text-ink-muted">
                                        {e.by.name}
                                        {e.template ? " · Template" : ` · ${KIND_LABELS[e.kind]}`}
                                    </span>
                                </button>
                                <button type="button" aria-pressed={e.liked} aria-label={e.liked ? "Unlike" : "Like"} onClick={() => like(e)} className={`flex items-center gap-1 rounded px-1 text-[11.5px] hover:bg-panel-hover ${e.liked ? "text-[#f24822]" : "text-ink-muted"}`}>
                                    <Heart className={`size-3.5 ${e.liked ? "fill-current" : ""}`} />
                                    {e.likes}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {detail && (
                <Dialog
                    title={detail.name}
                    description={`${detail.template ? "Template" : KIND_LABELS[detail.kind]} by ${detail.by.name}${detail.team ? ` (${detail.team.name})` : ""} · published ${new Date(detail.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}
                    width={520}
                    onClose={() => setDetail(null)}
                    footer={
                        <>
                            {detail.mine && (
                                <Button variant="danger" onPress={() => void unpublish(detail.id).then(() => (setDetail(null), reload(), editor.notify(`"${detail.name}" was unpublished.`)), (x: unknown) => editor.notify(err(x)))}>
                                    Unpublish
                                </Button>
                            )}
                            <div className="flex-1" />
                            <Button onPress={() => (setDetail(null), open(detail))}>Open</Button>
                            <Button variant="primary" onPress={() => duplicate(detail)}>
                                <Copy01 className="size-3.5" /> {detail.template ? "Use template" : "Duplicate"}
                            </Button>
                        </>
                    }
                >
                    {detail.thumb && <div className="mb-3 h-[220px] rounded-md border border-card-border bg-canvas bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url(${detail.thumb})` }} />}
                    {detail.description && <p className="mb-3 whitespace-pre-wrap">{detail.description}</p>}
                    {detail.tags.length > 0 && (
                        <div className="mb-3 flex flex-wrap gap-1">
                            {detail.tags.map((t) => (
                                <button key={t} type="button" onClick={() => (setDetail(null), onProfile(null), setQ(t))} className="rounded bg-field px-1.5 py-0.5 text-[11px] text-ink-muted hover:text-ink">
                                    {t}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="flex items-center gap-3 text-ink-muted">
                        <button type="button" onClick={() => like(detail)} className={`flex items-center gap-1 ${detail.liked ? "text-[#f24822]" : ""}`}>
                            <Heart className={`size-3.5 ${detail.liked ? "fill-current" : ""}`} /> {detail.likes} {detail.likes === 1 ? "like" : "likes"}
                        </button>
                        <span>{detail.duplicates} {detail.duplicates === 1 ? "duplicate" : "duplicates"}</span>
                        <button type="button" onClick={() => (setDetail(null), onProfile(detail.by.handle || detail.by.id))} className="ml-auto text-link hover:underline">
                            {detail.by.name}'s profile
                        </button>
                    </div>
                </Dialog>
            )}
            {(publishOpen || publishing) && (
                <PublishDialog
                    file={publishing}
                    onClose={() => {
                        setPublishOpen(false);
                        onPublished();
                    }}
                    onDone={() => {
                        setPublishOpen(false);
                        onPublished();
                        reload();
                    }}
                />
            )}
        </div>
    );
}

// Publishing a file you can edit (on the server) to the community, as a file or a template.
export function PublishDialog({ file, onClose, onDone }: { file: FileMeta | null; onClose: () => void; onDone: () => void }) {
    const editable = getServerFiles().filter((f) => f.role === "edit" && !f.trashed);
    const [fileId, setFileId] = useState(file?.shared ?? editable[0]?.id ?? "");
    const chosen = editable.find((f) => f.id === fileId);
    const [name, setName] = useState(file?.name ?? chosen?.name ?? "");
    const [description, setDescription] = useState("");
    const [tags, setTags] = useState("");
    const [template, setTemplate] = useState(false);
    const [error, setError] = useState<string | null>(null);
    return (
        <Dialog
            title="Publish to Community"
            description="A copy is published for everyone on this server to open, like and duplicate. Later edits stay private until you publish again."
            width={480}
            onClose={onClose}
            footer={
                <>
                    <Button onPress={onClose}>Cancel</Button>
                    <Button
                        variant="primary"
                        disabled={!fileId || !name.trim()}
                        onPress={() =>
                            void publishToCommunity({ fileId, key: chosen?.keys?.edit ?? file?.key ?? null, name: name.trim(), description, tags, template }).then(
                                (e) => (editor.notify(`"${e.name}" is published to the community.`), onDone()),
                                (x: unknown) => setError(err(x)),
                            )
                        }
                    >
                        Publish
                    </Button>
                </>
            }
        >
            <div className="space-y-3" onKeyDown={(e) => e.stopPropagation()}>
                {file?.shared ? null : editable.length ? (
                    <FieldLabel label="File">
                        <Select
                            aria-label="File"
                            value={fileId}
                            onChange={(e) => {
                                setFileId(e.target.value);
                                setName(editable.find((f) => f.id === e.target.value)?.name ?? "");
                            }}
                            className={field}
                        >
                            {editable.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.name}
                                </option>
                            ))}
                        </Select>
                    </FieldLabel>
                ) : (
                    <p className="text-ink-muted">Only files on the server can be published. Move a draft into a team folder or share it first.</p>
                )}
                <FieldLabel label="Name">
                    <input value={name} onChange={(e) => setName(e.target.value)} className={field} maxLength={120} />
                </FieldLabel>
                <FieldLabel label="Description">
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={600} className={`${field} h-auto py-2`} />
                </FieldLabel>
                <FieldLabel label="Tags" hint="Separate with commas, up to 8.">
                    <input value={tags} onChange={(e) => setTags(e.target.value)} className={field} />
                </FieldLabel>
                <label className="flex items-center gap-2">
                    <input type="checkbox" checked={template} onChange={(e) => setTemplate(e.target.checked)} className="accent-brand-500" />
                    Publish as a template (people start new files from it)
                </label>
                <ErrorText>{error}</ErrorText>
            </div>
        </Dialog>
    );
}
