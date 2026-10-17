import { ArrowUp, ChevronDown, ChevronRight, Copy01, Plus, Trash01, Users01, X } from "@untitledui/icons";
import { useMemo, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Modal as AriaModal, ModalOverlay as AriaModalOverlay, Popover as AriaPopover } from "react-aria-components";
import { MenuRow } from "../left-sidebar";
import { type AdminData, type AdminPerson, type Seat, adminAction, filesOf, money, relative, SEAT_LABELS, SEATS, useAsync, type UserGroup, useRun, SEAT_HINTS } from "../../engine/admin";
import { createInvite, inviteUrl, type TeamRole } from "../../engine/teams";
import { Avatar } from "../avatar";
import { Select } from "../select";
import { Button, CountBadge, Dialog, EmptyState, ErrorText, field, FieldLabel, FilterMenu, PageBody, PageTitle, RoleBadge, SeatIcon, SeatLabel, SearchField, TableHead, TableRow, Tabs } from "./admin-ui";

type ActiveFilter = "all" | "7" | "30" | "90" | "inactive";
const ACTIVE_OPTIONS: [ActiveFilter, string][] = [
    ["all", "All time"],
    ["7", "Last 7 days"],
    ["30", "Last 30 days"],
    ["90", "Last 90 days"],
    ["inactive", "Inactive for 90+ days"],
];
const COLS = "16px minmax(0,602fr) minmax(0,477fr) minmax(0,518fr) 16px";
const DAY = 24 * 60 * 60 * 1000;
const CHECK = "size-4 rounded-[3px] accent-brand-500";

export function PeoplePage({ data }: { data: AdminData }) {
    const [tab, setTab] = useState<"people" | "groups">("people");
    const [inviting, setInviting] = useState(false);
    const counts = data.billing.seats;
    return (
        <>
            <PageTitle
                extra={
                    <div className="flex items-center gap-[19px]">
                        <div className="flex items-center gap-[18px]" aria-label="Seats by type">
                            {SEATS.map((s) => (
                                <span key={s} title={`${SEAT_LABELS[s]} seats`} className="inline-flex items-center gap-[8px]">
                                    <CountBadge>{counts[s]}</CountBadge>
                                    <SeatIcon seat={s} tinted className="size-5" />
                                </span>
                            ))}
                        </div>
                        <Button variant="primary" className="h-[26px] gap-[5px]" onPress={() => setInviting(true)}>
                            <Plus className="size-4" /> Invite users
                        </Button>
                    </div>
                }
            >
                People
            </PageTitle>
            <PageBody>
                <Tabs
                    label="People"
                    value={tab}
                    onChange={setTab}
                    className="mb-[36px]"
                    tabs={[
                        ["people", "People"],
                        ["groups", "User groups"],
                    ]}
                />
                {tab === "people" ? <PeopleTab data={data} /> : <GroupsTab data={data} />}
            </PageBody>
            {inviting && <InviteDialog data={data} onClose={() => setInviting(false)} />}
        </>
    );
}

function PeopleTab({ data }: { data: AdminData }) {
    const [query, setQuery] = useState("");
    const [seat, setSeat] = useState<Seat | "all">("all");
    const [active, setActive] = useState<ActiveFilter>("all");
    const [picked, setPicked] = useState<string[]>([]);
    const [open, setOpen] = useState<string | null>(null);
    // A seat picked from the Seat type column, waiting for confirmation.
    const [seatChange, setSeatChange] = useState<{ person: AdminPerson; seat: Seat } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const run = useRun(setError);
    const [now] = useState(Date.now);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return data.people
            .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
            .filter((p) => seat === "all" || p.seat === seat)
            .filter((p) => {
                if (active === "all") return true;
                const since = p.lastActive ? now - p.lastActive : Infinity;
                return active === "inactive" ? since > 90 * DAY : since <= Number(active) * DAY;
            })
            .sort((a, b) => (a.id === data.me ? -1 : b.id === data.me ? 1 : a.name.localeCompare(b.name)));
    }, [data.people, data.me, query, seat, active, now]);
    const allPicked = shown.length > 0 && shown.every((p) => picked.includes(p.id));
    const person = data.people.find((p) => p.id === open) ?? null;

    return (
        <>
            <div className="mb-[12px] flex flex-wrap items-center gap-[9px] pr-[8px]">
                <SearchField value={query} onChange={setQuery} placeholder="Search people..." />
                <div className="flex-1" />
                <FilterMenu label="Seat type" value={seat} onChange={setSeat} options={[["all", "All seat types"], ...SEATS.map((s): [Seat, string] => [s, SEAT_LABELS[s]])]} />
                <FilterMenu label="Last active" value={active} onChange={setActive} options={ACTIVE_OPTIONS} />
            </div>
            {picked.length > 0 && (
                <div className="mb-3 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-[12px]">
                    <span className="font-medium">{picked.length} selected</span>
                    <div className="flex-1" />
                    <Select
                        aria-label="Change seat type"
                        value=""
                        onChange={(e) => void run(async () => {
                            for (const id of picked) await adminAction(data.team.id, "seat", { userId: id, seat: e.target.value });
                            setPicked([]);
                        })}
                        className="h-8 rounded-md border border-panel-border bg-panel px-2.5 text-[12px] text-ink"
                    >
                        <option value="" disabled>
                            Change seat type
                        </option>
                        {SEATS.map((s) => (
                            <option key={s} value={s}>
                                {SEAT_LABELS[s]}
                            </option>
                        ))}
                    </Select>
                    <Button
                        variant="danger"
                        disabled={picked.includes(data.me)}
                        onPress={() => {
                            if (!window.confirm(`Remove ${picked.length} ${picked.length === 1 ? "person" : "people"} from ${data.team.name}? Their drafts move to Content.`)) return;
                            void run(async () => {
                                for (const id of picked) await adminAction(data.team.id, "remove", { userId: id });
                                setPicked([]);
                            });
                        }}
                    >
                        Remove from team
                    </Button>
                    <Button variant="ghost" onPress={() => setPicked([])}>
                        Clear
                    </Button>
                </div>
            )}
            <ErrorText>{error}</ErrorText>
            <div>
                <TableHead cols={COLS}>
                    <input type="checkbox" aria-label="Select everyone shown" checked={allPicked} onChange={() => setPicked(allPicked ? [] : shown.map((p) => p.id))} className={CHECK} />
                    <span className="inline-flex items-center gap-[6px]">
                        Name <ArrowUp className="size-3.5" />
                    </span>
                    <span>Seat type</span>
                    <span>Last active</span>
                    <span />
                </TableHead>
                {shown.length === 0 && <EmptyState title="No one matches">Try a different search or filter.</EmptyState>}
                {shown.map((p) => (
                    <TableRow key={p.id} cols={COLS} onClick={() => setOpen(p.id)} label={`${p.name}, open details`}>
                        <input
                            type="checkbox"
                            aria-label={`Select ${p.name}`}
                            checked={picked.includes(p.id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => setPicked(picked.includes(p.id) ? picked.filter((x) => x !== p.id) : [...picked, p.id])}
                            className={`${CHECK} ${picked.includes(p.id) ? "" : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"}`}
                        />
                        <PersonName person={p} me={data.me} />
                        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                            <AriaMenuTrigger>
                                <AriaButton aria-label={`${p.name}'s seat: ${SEAT_LABELS[p.seat]}. Change seat`} className="-ml-1.5 flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                                    <SeatLabel seat={p.seat} />
                                    <ChevronDown className="size-3 text-ink-muted" />
                                </AriaButton>
                                <AriaPopover placement="bottom start" offset={4} className="w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                                    <AriaMenu className="outline-none" aria-label="Seat type" onAction={(k) => k !== p.seat && setSeatChange({ person: p, seat: k as Seat })}>
                                        {[...SEATS].reverse().map((s) => (
                                            <MenuRow key={s} id={s} label={`${SEAT_LABELS[s]} seat · ${money(data.billing.prices[s])}/mo`} checked={s === p.seat} />
                                        ))}
                                    </AriaMenu>
                                </AriaPopover>
                            </AriaMenuTrigger>
                        </span>
                        <span className="text-link">{relative(p.lastActive)}</span>
                        <ChevronRight className="size-4 text-ink-muted" />
                    </TableRow>
                ))}
            </div>
            {person && <PersonDrawer data={data} person={person} onClose={() => setOpen(null)} />}
            {seatChange && (
                <Dialog
                    title={`Change ${seatChange.person.name} to a ${SEAT_LABELS[seatChange.seat]} seat?`}
                    description={(() => {
                        const p = data.billing.prices;
                        const delta = p[seatChange.seat] - p[seatChange.person.seat];
                        const when = data.billing.interval === "annual" ? "billed at renewal" : "on the next statement";
                        return `${SEAT_HINTS[seatChange.seat]}. ${delta > 0 ? `This adds ${money(delta)} a month, ${when}.` : delta < 0 ? `This saves ${money(-delta)} a month from the next cycle.` : "The price stays the same."}`;
                    })()}
                    onClose={() => setSeatChange(null)}
                    footer={
                        <>
                            <Button onPress={() => setSeatChange(null)}>Cancel</Button>
                            <Button variant="primary" onPress={() => void run(() => adminAction(data.team.id, "seat", { userId: seatChange.person.id, seat: seatChange.seat })).then(() => setSeatChange(null))}>
                                Change seat
                            </Button>
                        </>
                    }
                />
            )}
        </>
    );
}

export function PersonName({ person, me }: { person: Pick<AdminPerson, "id" | "name" | "email" | "color"> & { role?: TeamRole }; me: string }) {
    return (
        <div className="flex min-w-0 items-center gap-[9px]">
            <Avatar name={person.name} color={person.color} size={24} single />
            <div className="min-w-0 leading-[20px]">
                <div className="flex items-center gap-[6px]">
                    <span className="truncate">{person.name}</span>
                    {person.id === me && <span className="text-ink-muted">(You)</span>}
                    {person.role === "admin" && <RoleBadge tone="brand">Admin</RoleBadge>}
                    {person.role === "view" && <RoleBadge>Limited access</RoleBadge>}
                </div>
                <div className="truncate text-[12px] text-ink-muted">{person.email}</div>
            </div>
        </div>
    );
}

// A person's details from the right: seat, role, groups, AI usage, the files they own, and removal.
function PersonDrawer({ data, person, onClose }: { data: AdminData; person: AdminPerson; onClose: () => void }) {
    const [error, setError] = useState<string | null>(null);
    const run = useRun(setError);
    const files = useAsync(() => filesOf(data.team.id, person.id), `${data.team.id}:${person.id}`);
    const isMe = person.id === data.me;
    const prices = data.billing.prices;
    return (
        <AriaModalOverlay isOpen onOpenChange={(o) => !o && onClose()} isDismissable className="fixed inset-0 z-50 flex justify-end bg-black/30">
            <AriaModal className="h-full w-[380px] max-w-full overflow-y-auto border-l border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                <AriaDialog aria-label={`${person.name} details`} className="outline-none">
                    <div className="flex items-center justify-end px-4 pt-3">
                        <AriaButton aria-label="Close" onPress={onClose} className="rounded p-1 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <X className="size-4" />
                        </AriaButton>
                    </div>
                    <div className="flex flex-col items-center px-5 pb-5 text-center">
                        <Avatar name={person.name} color={person.color} size={56} />
                        <div className="mt-3 text-[15px] font-semibold">
                            {person.name} {isMe && <span className="font-normal text-ink-muted">(You)</span>}
                        </div>
                        <div className="text-[12px] text-ink-muted">{person.email}</div>
                        <div className="mt-1 text-[11.5px] text-ink-muted">Last active {relative(person.lastActive).toLowerCase()}</div>
                    </div>
                    <div className="space-y-4 border-t border-panel-border px-5 py-4 text-[12px]">
                        <FieldLabel label="Seat type" hint={SEAT_HINTS[person.seat]}>
                            <Select aria-label="Seat type" value={person.seat} onChange={(e) => void run(() => adminAction(data.team.id, "seat", { userId: person.id, seat: e.target.value }))} className={field}>
                                {SEATS.map((s) => (
                                    <option key={s} value={s}>
                                        {`${SEAT_LABELS[s]} seat · ${prices[s] ? `${money(prices[s], data.billing.currency)}/mo` : "Free"}`}
                                    </option>
                                ))}
                            </Select>
                        </FieldLabel>
                        <FieldLabel label="Role" hint={person.role === "admin" ? "Admins manage people, billing and settings." : person.role === "view" ? "Limited access: can view and comment in team folders." : "Members create and edit files in team folders."}>
                            <Select aria-label="Role" value={person.role} onChange={(e) => void run(() => adminAction(data.team.id, "role", { userId: person.id, role: e.target.value }))} className={field}>
                                <option value="admin">Admin</option>
                                <option value="edit">Member</option>
                                <option value="view">Limited access</option>
                            </Select>
                        </FieldLabel>
                        <div>
                            <div className="mb-1 text-[11.5px] font-medium">AI credits this month</div>
                            <div className="text-ink-muted">
                                {person.aiUsed} of {person.aiAllowance} seat credits used
                            </div>
                        </div>
                        <div>
                            <div className="mb-1 text-[11.5px] font-medium">User groups</div>
                            <div className="text-ink-muted">{person.groups.length ? data.groups.filter((g) => person.groups.includes(g.id)).map((g) => g.name).join(", ") : "Not in any group"}</div>
                        </div>
                        <div>
                            <div className="mb-1.5 text-[11.5px] font-medium">Files they own in team folders</div>
                            {!files.value && !files.error && <div className="text-ink-muted">Loading…</div>}
                            {files.error && <div className="text-ink-muted">{files.error}</div>}
                            {files.value?.length === 0 && <div className="text-ink-muted">None</div>}
                            <ul className="space-y-1">
                                {files.value?.slice(0, 12).map((f) => (
                                    <li key={f.id} className="flex items-center gap-2">
                                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                                        <span className="text-ink-subtle">{relative(f.updatedAt)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <ErrorText>{error}</ErrorText>
                    </div>
                    {!isMe && (
                        <div className="border-t border-panel-border px-5 py-4">
                            <Button
                                variant="danger"
                                onPress={() => {
                                    if (!window.confirm(`Remove ${person.name} from ${data.team.name}? Their drafts move to Content › Unassigned drafts.`)) return;
                                    void run(() => adminAction(data.team.id, "remove", { userId: person.id })).then((ok) => ok && onClose());
                                }}
                            >
                                <Trash01 className="size-3.5" /> Remove from team
                            </Button>
                        </div>
                    )}
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

function InviteDialog({ data, onClose }: { data: AdminData; onClose: () => void }) {
    const [emails, setEmails] = useState("");
    const [seat, setSeat] = useState<Seat>("full");
    const [role, setRole] = useState<TeamRole>("edit");
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [link, setLink] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const run = useRun(setError);
    const send = async () => {
        setBusy(true);
        setNote(null);
        await run(async () => {
            const res = await adminAction<AdminData & { missing: string[]; invalid?: string[]; already?: string[] }>(data.team.id, "invite", { emails, seat, role });
            const invalid = res.invalid ?? [];
            const already = res.already ?? [];
            const notes = [
                invalid.length ? `${invalid.join(", ")} ${invalid.length === 1 ? "isn't a valid email" : "aren't valid emails"}.` : "",
                res.missing.length ? `No account yet for ${res.missing.join(", ")}. Share an invite link with them instead; they join once they sign up.` : "",
                already.length ? `${already.join(", ")} ${already.length === 1 ? "is" : "are"} already on the team (change roles and seats in the list).` : "",
            ].filter(Boolean);
            if (invalid.length || res.missing.length) {
                setEmails([...invalid, ...res.missing].join(", "));
                setNote(notes.join(" "));
            } else if (already.length) {
                setEmails("");
                setNote(notes.join(" "));
            } else onClose();
        });
        setBusy(false);
    };
    return (
        <Dialog
            title={`Invite to ${data.team.name}`}
            description="People with an account on this server join right away with the seat and role you pick."
            onClose={onClose}
            footer={
                <>
                    <Button onPress={onClose}>Cancel</Button>
                    <Button variant="primary" disabled={busy || !emails.trim()} onPress={() => void send()}>
                        Send invites
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <FieldLabel label="Emails" hint="Separate several with commas.">
                    <textarea value={emails} onChange={(e) => setEmails(e.target.value)} rows={3} placeholder="name@company.com, another@company.com" className={`${field} h-auto py-2`} autoFocus />
                </FieldLabel>
                <div className="grid grid-cols-2 gap-3">
                    <FieldLabel label="Seat type">
                        <Select aria-label="Seat type" value={seat} onChange={(e) => setSeat(e.target.value as Seat)} className={field}>
                            {SEATS.map((s) => (
                                <option key={s} value={s}>
                                    {SEAT_LABELS[s]}
                                </option>
                            ))}
                        </Select>
                    </FieldLabel>
                    <FieldLabel label="Role">
                        <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as TeamRole)} className={field}>
                            <option value="admin">Admin</option>
                            <option value="edit">Member</option>
                            <option value="view">Limited access</option>
                        </Select>
                    </FieldLabel>
                </div>
                {note && <p className="rounded-md bg-amber-500/10 px-3 py-2 text-[11.5px] text-ink">{note}</p>}
                <div className="flex items-center gap-2 rounded-md border border-panel-border px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-ink-muted">{link ?? "Or share an invite link (joins as Member)"}</span>
                    <Button
                        onPress={() => void run(async () => {
                            const url = link ?? inviteUrl((await createInvite(data.team.id, role === "admin" ? "edit" : role)).token);
                            setLink(url);
                            await navigator.clipboard.writeText(url).catch(() => undefined);
                            setNote("Invite link copied.");
                        })}
                    >
                        <Copy01 className="size-3.5" /> {link ? "Copy" : "Create link"}
                    </Button>
                </div>
                <ErrorText>{error}</ErrorText>
            </div>
        </Dialog>
    );
}

function GroupsTab({ data }: { data: AdminData }) {
    const [editing, setEditing] = useState<UserGroup | "new" | null>(null);
    const [query, setQuery] = useState("");
    const shown = data.groups.filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase()));
    const cols = "minmax(0,1fr) 200px 20px";
    return (
        <>
            <div className="mb-4 flex items-center gap-2">
                <SearchField value={query} onChange={setQuery} placeholder="Search user groups..." />
                <div className="flex-1" />
                <Button variant="primary" onPress={() => setEditing("new")}>
                    <Plus className="size-3.5" /> Create group
                </Button>
            </div>
            <div>
                <TableHead cols={cols}>
                    <span>Name</span>
                    <span>Members</span>
                    <span />
                </TableHead>
                {shown.length === 0 && (
                    <EmptyState title={data.groups.length ? "No groups match" : "No user groups yet"}>
                        {data.groups.length ? "Try a different search." : "Group people by discipline or project to find and manage them together."}
                    </EmptyState>
                )}
                {shown.map((g) => {
                    const members = data.people.filter((p) => g.members.includes(p.id));
                    return (
                        <TableRow key={g.id} cols={cols} onClick={() => setEditing(g)} label={`${g.name}, edit group`}>
                            <span className="flex min-w-0 items-center gap-2.5">
                                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-panel-hover text-ink-muted">
                                    <Users01 className="size-4" />
                                </span>
                                <span className="truncate font-medium">{g.name}</span>
                            </span>
                            <span className="flex items-center gap-2">
                                <span className="flex -space-x-1.5">
                                    {members.slice(0, 5).map((p) => (
                                        <Avatar key={p.id} name={p.name} color={p.color} size={22} ring />
                                    ))}
                                </span>
                                <span className="text-ink-muted">{members.length}</span>
                            </span>
                            <ChevronRight className="size-4 text-ink-subtle" />
                        </TableRow>
                    );
                })}
            </div>
            {editing && <GroupDialog data={data} group={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
        </>
    );
}

function GroupDialog({ data, group, onClose }: { data: AdminData; group: UserGroup | null; onClose: () => void }) {
    const [name, setName] = useState(group?.name ?? "");
    const [members, setMembers] = useState<string[]>(group?.members ?? []);
    const [error, setError] = useState<string | null>(null);
    const run = useRun(setError);
    const save = () => void run(() => adminAction(data.team.id, "group", group ? { id: group.id, name, members } : { name, members })).then((ok) => ok && onClose());
    return (
        <Dialog
            title={group ? "Edit user group" : "Create user group"}
            onClose={onClose}
            footer={
                <>
                    {group && (
                        <Button variant="danger" className="mr-auto" onPress={() => void run(() => adminAction(data.team.id, "group", { id: group.id, delete: true })).then((ok) => ok && onClose())}>
                            Delete group
                        </Button>
                    )}
                    <Button onPress={onClose}>Cancel</Button>
                    <Button variant="primary" disabled={!name.trim()} onPress={save}>
                        {group ? "Save" : "Create group"}
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <FieldLabel label="Name">
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product designers" className={field} autoFocus />
                </FieldLabel>
                <div>
                    <div className="mb-1.5 text-[11.5px] font-medium">Members</div>
                    <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-panel-border p-1">
                        {data.people.map((p) => (
                            <label key={p.id} className="flex h-9 items-center gap-2.5 rounded px-2 hover:bg-panel-hover">
                                <input type="checkbox" checked={members.includes(p.id)} onChange={() => setMembers(members.includes(p.id) ? members.filter((x) => x !== p.id) : [...members, p.id])} className="accent-brand-500" />
                                <Avatar name={p.name} color={p.color} size={20} />
                                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                                <span className="truncate text-ink-muted">{p.email}</span>
                            </label>
                        ))}
                    </div>
                </div>
                <ErrorText>{error}</ErrorText>
            </div>
        </Dialog>
    );
}

