import { useRun } from "../engine/admin";
import { Announcement02, ChevronDown, DotsHorizontal, Grid01, Plus, PresentationChart01, StickerSquare } from "@untitledui/icons";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover } from "react-aria-components";
import { useAuth } from "../engine/auth";
import { createEmptyDocument, type FileKind, getServerFiles, KIND_LABELS, refreshServerFiles, subscribeServerFiles } from "../engine/files";
import { createBoardDocument } from "../board/model";
import { createCampaignDocument } from "../campaign/model";
import { createSlidesDocument } from "../slides/model";
import { editor } from "../engine/store";
import { closeTemplatePicker, createTeamTemplate, deleteTeamTemplate, loadTeamTemplates, startFromTemplate, type TeamTemplate, updateTeamTemplate, useTeamTemplates, useTemplatePicker } from "../engine/team-templates";
import type { Team } from "../engine/teams";
import type { NagmaDocument } from "../engine/types";
import { Button, Dialog, ErrorText, field, FieldLabel, SearchField } from "./admin/admin-ui";
import { HistoryButtons } from "./sidebar-account";
import { MenuRow } from "./left-sidebar";
import { Select } from "./select";

// Kinds a team template can be made of, with the colours Home uses for them.
const KINDS: { kind: FileKind; label: string; icon: typeof Grid01; tint: string }[] = [
    { kind: "design", label: "Design", icon: Grid01, tint: "text-brand-500" },
    { kind: "board", label: "Board", icon: StickerSquare, tint: "text-violet-500" },
    { kind: "slides", label: "Slides", icon: PresentationChart01, tint: "text-[#FF7237]" },
    { kind: "campaign", label: "Campaign", icon: Announcement02, tint: "text-amber-500" },
];

function blankDocument(kind: FileKind, name: string): NagmaDocument {
    if (kind === "board") return createBoardDocument(name);
    if (kind === "slides") return createSlidesDocument(name);
    if (kind === "campaign") return createCampaignDocument(name);
    return createEmptyDocument(name);
}

// Home's Resources: the team's own templates. Anyone who can edit makes one from a file; everyone on
// the team starts new files from them here or from Create in Home.
export function ResourcesPage({ team, canBack, canForward, onBack, onForward, onCommunity, projectId }: { team: Team | null; canBack: boolean; canForward: boolean; onBack: () => void; onForward: () => void; onCommunity: () => void; projectId?: string | null }) {
    const account = useAuth((s) => s.user);
    const templates = useTeamTemplates(team?.id ?? null);
    const [query, setQuery] = useState("");
    const [creating, setCreating] = useState<FileKind | null>(null);
    const [renaming, setRenaming] = useState<TeamTemplate | null>(null);
    const [error, setError] = useState<string | null>(null);
    const run = useRun(setError);
    useEffect(() => {
        if (team) void loadTeamTemplates(team.id).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, [team]);
    const canCreate = Boolean(account && team && team.role !== "view");
    const q = query.trim().toLowerCase();
    const shown = (templates ?? []).filter((t) => !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));

    return (
        <main className="flex min-w-0 flex-1 flex-col bg-panel">
            <header className="flex h-[44px] shrink-0 items-center gap-0.5 pr-[34px] pl-[22px]">
                <HistoryButtons canBack={canBack} canForward={canForward} onBack={onBack} onForward={onForward} />
                <span className="ml-[7px] truncate px-1.5 text-[13.5px] text-ink">Resources</span>
                <div className="flex-1" />
                <SearchField value={query} onChange={setQuery} placeholder="Search for internal resources" className="h-[32px] w-[393px] gap-[10px] px-[11px]" />
            </header>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-[43px] pr-[34px] pb-[108px] pl-[35px]">
                <ErrorText>{error}</ErrorText>
                {templates && templates.length > 0 ? (
                    <>
                        <div className="mb-4 flex h-12 items-center gap-3">
                            <h1 className="flex-1 text-[18px] font-semibold">Team templates</h1>
                            {canCreate && <CreateButton onCreate={setCreating} />}
                        </div>
                        {shown.length === 0 && <div className="py-16 text-center text-[12px] text-ink-muted">No templates match "{query.trim()}".</div>}
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-5">
                            {shown.map((t) => (
                                <TemplateCard
                                    key={t.id}
                                    template={t}
                                    canManage={team?.role === "admin" || t.createdBy?.id === account?.id}
                                    onUse={() => team && void run(() => startFromTemplate(team.id, t, projectId))}
                                    onRename={() => setRenaming(t)}
                                    onDelete={() => team && window.confirm(`Delete the template "${t.name}"? Files made from it stay.`) && void run(() => deleteTeamTemplate(team.id, t.id))}
                                />
                            ))}
                        </div>
                    </>
                ) : (
                    <div className="flex min-h-[460px] flex-1 flex-col items-center justify-center rounded-[16px] bg-field px-6 py-16 text-center">
                        <div className="mt-[10px]">
                            <FannedTemplates />
                        </div>
                        <h1 className="mt-[42px] text-[15px] font-semibold">Streamline your work with custom templates</h1>
                        <p className="mt-[12px] text-[12px] leading-[18px] text-ink-muted">Create templates to keep up with the team's unique rituals and workflows. Go on, your team will thank you.</p>
                        <div className="mt-[24px]">{canCreate ? <CreateButton onCreate={setCreating} /> : <p className="text-[12px] text-ink-muted">{!account ? "Sign in and join a team to make templates." : !team ? "Create a team from the workspace menu to make templates." : "Ask a team editor or admin to add templates."}</p>}</div>
                        <button type="button" onClick={onCommunity} className="mt-[17px] text-[12px] text-link hover:underline">
                            Browse resources from Community
                        </button>
                    </div>
                )}
            </div>
            {creating && team && <CreateTemplateDialog team={team} kind={creating} onClose={() => setCreating(null)} />}
            {renaming && team && <RenameTemplateDialog team={team} template={renaming} onClose={() => setRenaming(null)} />}
        </main>
    );
}

// The blue split button: "+ Create" picks a file for a design template; the chevron picks the kind.
function CreateButton({ onCreate }: { onCreate: (k: FileKind) => void }) {
    return (
        <div className="inline-flex h-[33px] overflow-hidden rounded-md bg-button text-[12px] font-medium text-white">
            <AriaButton onPress={() => onCreate("design")} className="flex items-center gap-[12px] pr-[9px] pl-[10px] outline-none hover:bg-brand-600 focus-visible:bg-brand-600">
                <Plus className="size-4" /> Create
            </AriaButton>
            <AriaMenuTrigger>
                <AriaButton aria-label="Create a template of another kind" className="flex items-center pr-[10px] pl-[6px] outline-none hover:bg-brand-600 focus-visible:bg-brand-600">
                    <ChevronDown className="size-4" />
                </AriaButton>
                <AriaPopover placement="bottom end" offset={6} className="w-52 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                    <AriaMenu className="outline-none" onAction={(k) => onCreate(String(k) as FileKind)}>
                        {KINDS.map((k) => (
                            <MenuRow key={k.kind} id={k.kind} label={`${k.label} template`} icon={k.icon} />
                        ))}
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
        </div>
    );
}

function TemplateCard({ template, canManage, onUse, onRename, onDelete }: { template: TeamTemplate; canManage: boolean; onUse: () => void; onRename: () => void; onDelete: () => void }) {
    const kind = KINDS.find((k) => k.kind === template.kind) ?? KINDS[0]!;
    const Icon = kind.icon;
    return (
        <div className="group relative rounded-lg border border-panel-border bg-panel hover:border-ink-subtle">
            <button type="button" onClick={onUse} aria-label={`New file from ${template.name}`} className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                <div className="flex aspect-[16/10] items-center justify-center overflow-hidden rounded-t-lg bg-canvas">
                    {template.thumb ? <img src={template.thumb} alt="" className="h-full w-full object-cover" /> : <Icon className={`size-8 ${kind.tint}`} />}
                </div>
                <div className="flex items-center gap-2 px-3 py-2.5">
                    <Icon className={`size-3.5 shrink-0 ${kind.tint}`} />
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium">{template.name}</div>
                        <div className="truncate text-[11px] text-ink-muted">{template.description || `${KIND_LABELS[template.kind] ?? "File"} template${template.createdBy ? ` by ${template.createdBy.name}` : ""}`}</div>
                    </div>
                </div>
            </button>
            {canManage && (
                <AriaMenuTrigger>
                    <AriaButton aria-label={`${template.name} options`} className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md bg-panel/90 text-ink-muted opacity-0 shadow outline-none group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 data-[pressed]:opacity-100">
                        <DotsHorizontal className="size-4" />
                    </AriaButton>
                    <AriaPopover placement="bottom end" offset={4} className="w-44 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                        <AriaMenu className="outline-none" onAction={(k) => (k === "use" ? onUse() : k === "rename" ? onRename() : onDelete())}>
                            <MenuRow id="use" label="New file from template" />
                            <MenuRow id="rename" label="Rename…" />
                            <MenuRow id="delete" label="Delete template" />
                        </AriaMenu>
                    </AriaPopover>
                </AriaMenuTrigger>
            )}
        </div>
    );
}

// Make a template from one of your files (or blank) of the chosen kind.
function CreateTemplateDialog({ team, kind: initialKind, onClose }: { team: Team; kind: FileKind; onClose: () => void }) {
    const serverFiles = useSyncExternalStore(subscribeServerFiles, getServerFiles);
    useEffect(() => void refreshServerFiles(), []);
    const [kind, setKind] = useState<FileKind>(initialKind);
    const files = useMemo(() => serverFiles.filter((f) => !f.trashed && f.kind === kind && (!f.team || f.team === team.id)), [serverFiles, kind, team.id]);
    const [source, setSource] = useState<string>("");
    const chosen = source && (source === "blank" || files.some((f) => f.id === source)) ? source : (files[0]?.id ?? "blank");
    const file = files.find((f) => f.id === chosen);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const run = useRun(setError);
    const label = KINDS.find((k) => k.kind === kind)?.label ?? "Design";
    const create = async () => {
        setBusy(true);
        const title = name.trim() || (file ? file.name : `${label} template`);
        const ok = await run(() => (file ? createTeamTemplate(team.id, { fileId: file.id, key: file.keys?.edit ?? null, name: title, description }) : createTeamTemplate(team.id, { doc: blankDocument(kind, title), kind, name: title, description })));
        setBusy(false);
        if (ok) {
            editor.notify(`Template "${title}" added to ${team.name}.`);
            onClose();
        }
    };
    return (
        <Dialog
            title="Create a template"
            description={`A copy of the file becomes a template everyone on ${team.name} can start from. Later changes to the file don't change the template.`}
            onClose={onClose}
            width={460}
            footer={
                <>
                    <Button onPress={onClose}>Cancel</Button>
                    <Button variant="primary" disabled={busy} onPress={() => void create()}>
                        Create template
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <FieldLabel label="Kind">
                        <Select aria-label="Kind" value={kind} onChange={(e) => (setKind(e.target.value as FileKind), setSource(""))} className={field}>
                            {KINDS.map((k) => (
                                <option key={k.kind} value={k.kind}>
                                    {k.label}
                                </option>
                            ))}
                        </Select>
                    </FieldLabel>
                    <FieldLabel label="From">
                        <Select aria-label="From file" value={chosen} onChange={(e) => setSource(e.target.value)} className={field}>
                            {files.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.name}
                                </option>
                            ))}
                            <option value="blank">{`Blank ${label.toLowerCase()}`}</option>
                        </Select>
                    </FieldLabel>
                </div>
                {files.length === 0 && <p className="text-[11.5px] text-ink-muted">None of your synced {label.toLowerCase()} files are available, so this starts blank. Files in your drafts or the team's folders can be used.</p>}
                <FieldLabel label="Name">
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder={file?.name ?? `${label} template`} className={field} autoFocus />
                </FieldLabel>
                <FieldLabel label="Description">
                    <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When to use it" className={field} />
                </FieldLabel>
                <ErrorText>{error}</ErrorText>
            </div>
        </Dialog>
    );
}

function RenameTemplateDialog({ team, template, onClose }: { team: Team; template: TeamTemplate; onClose: () => void }) {
    const [name, setName] = useState(template.name);
    const [description, setDescription] = useState(template.description);
    const [error, setError] = useState<string | null>(null);
    const run = useRun(setError);
    return (
        <Dialog
            title="Edit template"
            onClose={onClose}
            footer={
                <>
                    <Button onPress={onClose}>Cancel</Button>
                    <Button variant="primary" disabled={!name.trim()} onPress={() => void run(() => updateTeamTemplate(team.id, template.id, { name, description })).then((ok) => ok && onClose())}>
                        Save
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <FieldLabel label="Name">
                    <input value={name} onChange={(e) => setName(e.target.value)} className={field} autoFocus />
                </FieldLabel>
                <FieldLabel label="Description">
                    <input value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
                </FieldLabel>
                <ErrorText>{error}</ErrorText>
            </div>
        </Dialog>
    );
}

// Create › From a team template in Home: pick one and a new file opens.
export function TemplatePickerHost({ teams, projectId }: { teams: Team[]; projectId?: string | null }) {
    const teamId = useTemplatePicker();
    const templates = useTeamTemplates(teamId);
    const [error, setError] = useState<string | null>(null);
    const run = useRun(setError);
    useEffect(() => {
        if (teamId) void loadTeamTemplates(teamId).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, [teamId]);
    if (!teamId) return null;
    const team = teams.find((t) => t.id === teamId);
    return (
        <Dialog title="New file from a team template" description={team ? `Templates shared in ${team.name}.` : undefined} onClose={closeTemplatePicker} width={560}>
            {!templates && !error && <p className="text-ink-muted">Loading…</p>}
            {templates?.length === 0 && <p className="text-ink-muted">The team has no templates yet. Make one from Resources in the sidebar.</p>}
            <div className="grid max-h-[50vh] grid-cols-3 gap-3 overflow-y-auto">
                {templates?.map((t) => {
                    const kind = KINDS.find((k) => k.kind === t.kind) ?? KINDS[0]!;
                    const Icon = kind.icon;
                    return (
                        <button key={t.id} type="button" onClick={() => void run(() => startFromTemplate(teamId, t, projectId)).then((ok) => ok && closeTemplatePicker())} className="overflow-hidden rounded-lg border border-panel-border text-left outline-none hover:border-ink-subtle focus-visible:ring-2 focus-visible:ring-brand-500">
                            <div className="flex aspect-[16/10] items-center justify-center bg-canvas">{t.thumb ? <img src={t.thumb} alt="" className="h-full w-full object-cover" /> : <Icon className={`size-6 ${kind.tint}`} />}</div>
                            <div className="truncate px-2.5 py-2 text-[12px] font-medium">{t.name}</div>
                        </button>
                    );
                })}
            </div>
            <ErrorText>{error}</ErrorText>
        </Dialog>
    );
}

// Three template cards fanned out, the front one with a layout sketched on it.
function FannedTemplates() {
    // Three template covers fanned out, each a coloured cover over a dark strip with its kind.
    const card = (title: string[], tag: string, fill: string, icon: string, transform: string) => (
        <g transform={transform} filter="url(#fan-shadow)">
            <rect width="222" height="196" rx="10" fill="#2C2C2C" />
            <path d="M0 10a10 10 0 0 1 10-10h202a10 10 0 0 1 10 10v124H0z" fill={fill} />
            {title.map((line, i) => (
                <text key={line} x="22" y={44 + i * 22} fontFamily="Georgia, 'Times New Roman', serif" fontSize="21" fill="#3B2A22">
                    {line}
                </text>
            ))}
            <text x="22" y={52 + title.length * 22} fontFamily="Georgia, 'Times New Roman', serif" fontSize="9" letterSpacing="0.6" fill="#6B5244">
                {tag}
            </text>
            <rect x="16" y="152" width="16" height="16" rx="4" fill={icon} />
            <rect x="20" y="156" width="8" height="8" rx="1.5" stroke="white" strokeWidth="1.4" fill="none" />
            <rect x="42" y="152" width="76" height="6" rx="3" fill="#4A4A4A" />
            <rect x="42" y="163" width="46" height="6" rx="3" fill="#4A4A4A" />
        </g>
    );
    return (
        <svg width="440" height="260" viewBox="0 0 440 260" fill="none" aria-hidden>
            <defs>
                <filter id="fan-shadow" x="-20%" y="-20%" width="140%" height="150%">
                    <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#000" floodOpacity="0.35" />
                </filter>
            </defs>
            {card(["Onboarding", "Guide"], "PRODUCT DESIGN", "#F9C8A6", "#F24E1E", "translate(4 52) rotate(-14)")}
            {card(["Conference", "Event", "template"], "", "#F7CBF4", "#E53DBA", "translate(96 34) rotate(-6)")}
            {card(["Design team", "weekly progress"], "PRODUCT DESIGN TEAM", "#F9C8A6", "#F24E1E", "translate(198 50) rotate(5)")}
        </svg>
    );
}
