import { ArrowDown, DotsHorizontal } from "@untitledui/icons";
import { useEffect, useState } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover } from "react-aria-components";
import { type AdminData, type UnassignedDrafts, adminAction, loadAdmin, longDate, useRun } from "../../engine/admin";
import { refreshServerFiles } from "../../engine/files";
import { useTeams } from "../../engine/teams";
import { MenuRow } from "../left-sidebar";
import { Select } from "../select";
import { Banner, Button, Dialog, EmptyState, ErrorText, field, FieldLabel, PageBody, PageTitle, SearchField, TableHead, TableRow, Tabs } from "./admin-ui";
import { PersonName } from "./people-page";

const COLS = "16px minmax(0,705fr) minmax(0,405fr) minmax(0,450fr) 28px";

export function ContentPage({ data }: { data: AdminData }) {
    const [tab, setTab] = useState<"drafts" | "folders">("drafts");
    const [query, setQuery] = useState("");
    const [moving, setMoving] = useState<UnassignedDrafts | null>(null);
    const [error, setError] = useState<string | null>(null);
    const run = useRun(setError);
    const q = query.trim().toLowerCase();
    const shown = data.unassigned.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    return (
        <>
            <PageTitle>Content</PageTitle>
            <PageBody>
                <Tabs
                    label="Content"
                    value={tab}
                    onChange={setTab}
                    className="mb-[21px]"
                    tabs={[
                        ["drafts", "Unassigned drafts"],
                        ["folders", "Connected folders"],
                    ]}
                />
                {tab === "drafts" ? (
                    <>
                        <div className="mb-[10px] border-y border-rule py-[12px]">
                            <SearchField value={query} onChange={setQuery} placeholder="Search unassigned drafts..." />
                        </div>
                        <Banner>
                            <span className="font-semibold">These drafts belonged to users who were removed from {data.team.name}</span>
                            <span className="ml-2">You can delete these drafts or move them so other team members can find them more easily. Moved drafts belong to you and take the access of the folder you pick.</span>
                        </Banner>
                        <ErrorText>{error}</ErrorText>
                        <div>
                            <TableHead cols={COLS} border="border-b">
                                <span />
                                <span>Name</span>
                                <span>Files</span>
                                <span className="inline-flex items-center gap-[6px]">
                                    Removed <ArrowDown className="size-3.5" />
                                </span>
                                <span />
                            </TableHead>
                            {shown.length === 0 && <EmptyState title={data.unassigned.length ? "Nothing matches that search" : "No unassigned drafts"} />}
                            {shown.map((u) => (
                                <TableRow key={u.id} cols={COLS}>
                                    <span />
                                    <PersonName person={{ id: u.userId, name: u.name, email: u.email, color: u.color }} me={data.me} />
                                    <span className="tabular-nums">{u.files}</span>
                                    <span className="text-ink-muted">{longDate(u.removedAt)}</span>
                                    <AriaMenuTrigger>
                                        <AriaButton aria-label={`Actions for ${u.name}'s drafts`} className="flex size-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500">
                                            <DotsHorizontal className="size-4" />
                                        </AriaButton>
                                        <AriaPopover placement="bottom end" offset={4} className="w-48 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                                            <AriaMenu
                                                className="outline-none"
                                                onAction={(k) => {
                                                    if (k === "move") setMoving(u);
                                                    else if (window.confirm(`Delete ${u.files} ${u.files === 1 ? "draft" : "drafts"} from ${u.name} forever?`)) void run(() => adminAction(data.team.id, "drafts", { id: u.id, action: "delete" }));
                                                }}
                                            >
                                                <MenuRow id="move" label="Move to folder…" />
                                                <MenuRow id="delete" label="Delete drafts" />
                                            </AriaMenu>
                                        </AriaPopover>
                                    </AriaMenuTrigger>
                                </TableRow>
                            ))}
                        </div>
                    </>
                ) : (
                    <ConnectedFolders data={data} />
                )}
            </PageBody>
            {moving && <MoveDialog data={data} entry={moving} onClose={() => setMoving(null)} />}
        </>
    );
}

function MoveDialog({ data, entry, onClose }: { data: AdminData; entry: UnassignedDrafts; onClose: () => void }) {
    const team = useTeams().find((t) => t.id === data.team.id);
    const projects = (team?.projects ?? []).filter((p) => !p.trashed);
    const [project, setProject] = useState(projects[0]?.id ?? "");
    const [error, setError] = useState<string | null>(null);
    const run = useRun(setError);
    return (
        <Dialog
            title={`Move ${entry.name}'s drafts`}
            description={`${entry.files} ${entry.files === 1 ? "file moves" : "files move"} into the folder you pick, owned by you.`}
            onClose={onClose}
            footer={
                <>
                    <Button onPress={onClose}>Cancel</Button>
                    <Button variant="primary" disabled={!project} onPress={() => void run(() => adminAction(data.team.id, "drafts", { id: entry.id, action: "move", project })).then((ok) => ok && (void refreshServerFiles(), onClose()))}>
                        Move
                    </Button>
                </>
            }
        >
            {projects.length ? (
                <FieldLabel label="Folder">
                    <Select aria-label="Folder" value={project} onChange={(e) => setProject(e.target.value)} className={field}>
                        {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                            </option>
                        ))}
                    </Select>
                </FieldLabel>
            ) : (
                <p className="text-ink-muted">The team has no folders yet. Create one from All folders first.</p>
            )}
            <ErrorText>{error}</ErrorText>
        </Dialog>
    );
}

const CONNECT_COLS = "minmax(0,520fr) minmax(0,400fr) minmax(0,260fr) minmax(0,300fr) 96px";

// Connected folders: folders shared between teams on this server. Folders of other teams connected to
// this one are open to its members (with the role the connection gives); this team's folders can be
// connected to other teams. Either side's admins can disconnect.
function ConnectedFolders({ data }: { data: AdminData }) {
    const c = data.connected;
    const [query, setQuery] = useState("");
    const [connecting, setConnecting] = useState(false);
    // Other teams and their connections change elsewhere: fetched fresh when the tab opens.
    useEffect(() => void loadAdmin(data.team.id), [data.team.id]);
    const [error, setError] = useState<string | null>(null);
    const run = useRun(setError);
    const q = query.trim().toLowerCase();
    const rows = [...c.incoming.map((x) => ({ ...x, way: "in" as const })), ...c.outgoing.map((x) => ({ ...x, way: "out" as const }))].filter((x) => !q || x.name.toLowerCase().includes(q) || x.team.name.toLowerCase().includes(q) || x.owner.name.toLowerCase().includes(q));
    return (
        <>
            <div className="mb-[10px] flex items-center gap-2 border-y border-rule py-[12px]">
                <SearchField value={query} onChange={setQuery} placeholder="Search connected folders..." />
                <div className="flex-1" />
                <Button variant="primary" disabled={!c.folders.length || !c.teams.length} onPress={() => setConnecting(true)}>
                    Connect a folder
                </Button>
            </div>
            <Banner>
                <span className="font-semibold">Folders shared between teams</span>
                <span className="ml-2">Members of a connected team can open the files in the folder with the role you pick. Disconnecting takes that access away; files stay where they are.</span>
            </Banner>
            <ErrorText>{error}</ErrorText>
            <TableHead cols={CONNECT_COLS} border="border-b">
                <span>Folder</span>
                <span>Shared with</span>
                <span>Access</span>
                <span>Connected</span>
                <span />
            </TableHead>
            {rows.length === 0 && <EmptyState title={c.incoming.length + c.outgoing.length ? "Nothing matches that search" : "No connected folders"}>Connect one of {data.team.name}'s folders to another team to work on it together.</EmptyState>}
            {rows.map((r) => (
                <TableRow key={`${r.projectId}:${r.team.id}`} cols={CONNECT_COLS}>
                    <span className="min-w-0">
                        <span className="block truncate">{r.name}</span>
                        <span className="block truncate text-[12px] text-ink-muted">{r.way === "in" ? `From ${r.owner.name}` : `${data.team.name} folder`}</span>
                    </span>
                    <span className="truncate">{r.way === "in" ? data.team.name : r.team.name}</span>
                    <span className="text-ink-muted">{r.role === "edit" ? "Can edit" : "Can view"}</span>
                    <span className="text-ink-muted">{r.connectedAt ? longDate(r.connectedAt) : "Earlier"}</span>
                    <Button variant="ghost" onPress={() => window.confirm(`Disconnect "${r.name}" from ${r.team.name}?`) && void run(() => adminAction(data.team.id, "disconnect", { projectId: r.projectId, teamId: r.team.id }))}>
                        Disconnect
                    </Button>
                </TableRow>
            ))}
            {connecting && <ConnectDialog data={data} onClose={() => setConnecting(false)} />}
        </>
    );
}

function ConnectDialog({ data, onClose }: { data: AdminData; onClose: () => void }) {
    const c = data.connected;
    const [project, setProject] = useState(c.folders[0]?.id ?? "");
    const [team, setTeam] = useState(c.teams[0]?.id ?? "");
    const [role, setRole] = useState<"edit" | "view">("view");
    const [error, setError] = useState<string | null>(null);
    const run = useRun(setError);
    return (
        <Dialog
            title="Connect a folder"
            description="The team you pick gets access to the folder and everything in it."
            onClose={onClose}
            footer={
                <>
                    <Button onPress={onClose}>Cancel</Button>
                    <Button variant="primary" disabled={!project || !team} onPress={() => void run(() => adminAction(data.team.id, "connect", { projectId: project, teamId: team, role })).then((ok) => ok && onClose())}>
                        Connect
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <FieldLabel label="Folder">
                    <Select aria-label="Folder" value={project} onChange={(e) => setProject(e.target.value)} className={field}>
                        {c.folders.map((f) => (
                            <option key={f.id} value={f.id}>
                                {f.name}
                            </option>
                        ))}
                    </Select>
                </FieldLabel>
                <FieldLabel label="Team">
                    <Select aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)} className={field}>
                        {c.teams.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name}
                            </option>
                        ))}
                    </Select>
                </FieldLabel>
                <FieldLabel label="Access">
                    <Select aria-label="Access" value={role} onChange={(e) => setRole(e.target.value as "edit" | "view")} className={field}>
                        <option value="view">Can view</option>
                        <option value="edit">Can edit</option>
                    </Select>
                </FieldLabel>
                <ErrorText>{error}</ErrorText>
            </div>
        </Dialog>
    );
}

