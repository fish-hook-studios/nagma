import { X } from "@untitledui/icons";
import { useEffect, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { useAuth } from "../engine/auth";
import { type Invite, type Project, type ProjectAccess, type Team, type TeamRole, createInvite, deleteTeam, inviteUrl, listInvites, revokeInvite, setProjectAccess, updateFolderSharing, updateTeam } from "../engine/teams";
import { Avatar } from "./collab-ui";
import { Select } from "./select";
import { askText } from "./ask-text";
import { TeamIntegrationsDialog } from "./team-integrations";

const ROLE_LABELS: Record<TeamRole, string> = { admin: "Admin", edit: "Can edit", view: "Can view" };

// A team's members: invite by email with a role, change roles, remove people, rename or delete the team.
export function TeamDialog({ team, onClose }: { team: Team; onClose: () => void }) {
    const me = useAuth((s) => s.user);
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<TeamRole>("edit");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [invites, setInvites] = useState<Invite[]>([]);
    const [linkRole, setLinkRole] = useState<TeamRole>("edit");
    const [copied, setCopied] = useState<string | null>(null);
    const [integrations, setIntegrations] = useState(false);
    const admin = team.role === "admin";
    useEffect(() => {
        if (admin) void listInvites(team.id).then(setInvites).catch(() => setInvites([]));
    }, [team.id, admin]);
    const copy = async (token: string) => {
        try {
            await navigator.clipboard.writeText(inviteUrl(token));
            setCopied(token);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            // The link is selectable in the field.
        }
    };
    const input = "h-9 w-full rounded-md border border-panel-border bg-field px-3 text-[12px] text-ink outline-none focus:border-brand-500";
    const select = "h-9 rounded-md border border-panel-border bg-field px-2 text-[12px] text-ink outline-none focus:border-brand-500";

    const run = async (body: Parameters<typeof updateTeam>[1]) => {
        setBusy(true);
        setError(null);
        try {
            await updateTeam(team.id, body);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <AriaModalOverlay isOpen onOpenChange={(o) => !o && onClose()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
            <AriaModal className="w-[440px] rounded-xl border border-panel-border bg-panel-raised p-5 text-ink shadow-2xl outline-none">
                <AriaDialog className="space-y-4 outline-none" aria-label="Team members">
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-[14px] font-semibold">{team.name}</h2>
                            <p className="mt-1 text-[12px] text-ink-muted">Members see every project in the team. Admins manage members and projects.</p>
                        </div>
                        <AriaButton aria-label="Close" onPress={onClose} className="rounded p-1 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <X className="size-4" />
                        </AriaButton>
                    </div>
                    {admin && (
                        <form
                            className="flex gap-2"
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (!email.trim()) return;
                                void run({ invite: { email: email.trim(), role } }).then(() => setEmail(""));
                            }}
                        >
                            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Invite by email" aria-label="Invite by email" type="email" className={input} />
                            <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as TeamRole)} className={select}>
                                <option value="admin">Admin</option>
                                <option value="edit">Can edit</option>
                                <option value="view">Can view</option>
                            </Select>
                            <button type="submit" disabled={busy} className="h-9 shrink-0 rounded-md bg-brand-500 px-3 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                                Invite
                            </button>
                        </form>
                    )}
                    {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div>}
                    <div className="space-y-2">
                        {team.members.map((m) => (
                            <div key={m.id} className="flex items-center gap-2">
                                <Avatar name={m.name} color={m.color} />
                                <span className="flex-1 truncate text-[12px]">
                                    {m.name}
                                    {m.id === me?.id ? " (you)" : ""} <span className="text-ink-subtle">{m.email}</span>
                                </span>
                                {admin && m.id !== me?.id ? (
                                    <Select aria-label={`${m.name}'s role`} value={m.role} onChange={(e) => (e.target.value === "remove" ? void run({ remove: m.id }) : void run({ role: { userId: m.id, role: e.target.value as TeamRole } }))} className="h-7 rounded-md bg-field px-1.5 text-[11px] text-ink outline-none">
                                        <option value="admin">Admin</option>
                                        <option value="edit">Can edit</option>
                                        <option value="view">Can view</option>
                                        <option value="remove">Remove</option>
                                    </Select>
                                ) : (
                                    <span className="text-[11px] text-ink-muted">{ROLE_LABELS[m.role]}</span>
                                )}
                            </div>
                        ))}
                    </div>
                    {admin && (
                        <div className="space-y-2 rounded-md border border-panel-border p-3">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[12px] font-medium">Invite links</span>
                                <div className="flex items-center gap-1.5">
                                    <Select aria-label="Link role" value={linkRole} onChange={(e) => setLinkRole(e.target.value as TeamRole)} className="h-7 rounded-md bg-field px-1.5 text-[11px] text-ink outline-none">
                                        <option value="edit">Can edit</option>
                                        <option value="view">Can view</option>
                                    </Select>
                                    <button
                                        type="button"
                                        onClick={() => void createInvite(team.id, linkRole).then((i) => setInvites([i, ...invites])).catch((e) => setError(String(e.message ?? e)))}
                                        className="h-7 rounded-md bg-brand-500 px-2.5 text-[11px] font-semibold text-white hover:bg-brand-600"
                                    >
                                        New link
                                    </button>
                                </div>
                            </div>
                            {invites.length === 0 && <p className="text-[11px] text-ink-subtle">Anyone who opens an invite link joins the team with that role, after signing in.</p>}
                            {invites.map((i) => (
                                <div key={i.token} className="flex items-center gap-2">
                                    <input readOnly value={inviteUrl(i.token)} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" className="h-7 min-w-0 flex-1 rounded-md bg-field px-2 text-[11px] text-ink-muted outline-none" />
                                    <span className="w-14 text-[11px] text-ink-muted">{i.role === "view" ? "Can view" : "Can edit"}</span>
                                    <button type="button" onClick={() => void copy(i.token)} className="h-7 rounded-md border border-panel-border px-2 text-[11px] hover:bg-panel-hover">
                                        {copied === i.token ? "Copied" : "Copy"}
                                    </button>
                                    <button type="button" aria-label="Revoke invite link" onClick={() => void revokeInvite(team.id, i.token).then(() => setInvites(invites.filter((x) => x.token !== i.token)))} className="h-7 rounded-md px-1.5 text-[11px] text-red-400 hover:bg-panel-hover">
                                        Revoke
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <button type="button" onClick={() => setIntegrations(true)} className="text-[11px] text-ink-muted hover:text-ink hover:underline">
                        Integrations and Inspect settings…
                    </button>
                    {integrations && <TeamIntegrationsDialog team={team} onClose={() => setIntegrations(false)} />}
                    {admin && (
                        <div className="flex items-center justify-between border-t border-panel-border pt-3">
                            <button
                                type="button"
                                onClick={async () => {
                                    const name = await askText("Team name", team.name);
                                    if (name?.trim()) void run({ name: name.trim() });
                                }}
                                className="text-[11px] text-ink-muted hover:text-ink hover:underline"
                            >
                                Rename team
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (window.confirm(`Delete the team "${team.name}" and its projects? Files stay on the server.`)) void deleteTeam(team.id).then(onClose);
                                }}
                                className="text-[11px] text-red-400 hover:underline"
                            >
                                Delete team
                            </button>
                        </div>
                    )}
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}


// Sharing a folder: who has access (everyone on the team by their roles, or only people invited),
// inviting people by email (teammates get a role here; anyone else becomes a guest of the folder),
// and each person's access. Editors of the folder can share it; team admins can always edit.
export function ProjectAccessDialog({ team, project, onClose }: { team: Team; project: Project; onClose: () => void }) {
    const me = useAuth((s) => s.user);
    const [error, setError] = useState<string | null>(null);
    const [emails, setEmails] = useState("");
    const [inviteRole, setInviteRole] = useState<"edit" | "view">("edit");
    const [busy, setBusy] = useState(false);
    const current = team.projects.find((p) => p.id === project.id) ?? project;
    const canShare = team.role === "admin" || current.role === "admin" || current.role === "edit";
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
    const set = (userId: string, value: string) => {
        setError(null);
        void setProjectAccess(project.id, userId, value === "" ? null : (value as ProjectAccess)).catch(fail);
    };
    const share = (body: Parameters<typeof updateFolderSharing>[1]) => {
        setError(null);
        return updateFolderSharing(project.id, body).catch(fail);
    };
    const invited = current.audience === "invited";
    const roleOf = (m: Team["members"][number]) => {
        const override = current.members?.[m.id];
        if (m.role === "admin") return "Admin";
        if (override) return override === "none" ? "No access" : ROLE_LABELS[override];
        return invited ? "No access" : ROLE_LABELS[m.role];
    };
    const select = "h-7 rounded-md bg-field px-1.5 text-[11px] text-ink outline-none";
    return (
        <AriaModalOverlay isOpen onOpenChange={(o) => !o && onClose()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
            <AriaModal className="w-[480px] rounded-xl border border-panel-border bg-panel-raised p-5 text-ink shadow-2xl outline-none">
                <AriaDialog className="space-y-4 outline-none" aria-label={`Share ${project.name}`}>
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-[14px] font-semibold">Share {project.name}</h2>
                            <p className="mt-1 text-[12px] text-ink-muted">Everyone invited can open the files in this folder and the folders inside it.</p>
                        </div>
                        <AriaButton aria-label="Close" onPress={onClose} className="rounded p-1 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <X className="size-4" />
                        </AriaButton>
                    </div>
                    {canShare && (
                        <form
                            className="flex gap-2"
                            onKeyDown={(e) => e.stopPropagation()}
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (!emails.trim()) return;
                                setBusy(true);
                                void share({ invite: { emails, role: inviteRole } }).then(() => setEmails("")).finally(() => setBusy(false));
                            }}
                        >
                            <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="Add emails, separated by commas" aria-label="Emails to invite" className="h-8 min-w-0 flex-1 rounded-md border border-panel-border bg-field px-2.5 text-[12px] outline-none focus:border-brand-500" />
                            <Select aria-label="Role for people invited" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "edit" | "view")} className={select}>
                                <option value="edit">Can edit</option>
                                <option value="view">Can view</option>
                            </Select>
                            <button type="submit" disabled={busy || !emails.trim()} className="h-8 rounded-md bg-brand-500 px-3 text-[12px] font-medium text-white hover:bg-brand-600 disabled:opacity-50">
                                Invite
                            </button>
                        </form>
                    )}
                    <div className="flex items-center gap-2 rounded-md bg-field px-3 py-2 text-[12px]">
                        <span className="flex-1">Who has access</span>
                        {canShare ? (
                            <Select aria-label="Who has access" value={invited ? "invited" : "team"} onChange={(e) => void share({ audience: e.target.value as "team" | "invited" })} className={select}>
                                <option value="team">Everyone at {team.name}</option>
                                <option value="invited">Only people invited</option>
                            </Select>
                        ) : (
                            <span className="text-ink-muted">{invited ? "Only people invited" : `Everyone at ${team.name}`}</span>
                        )}
                    </div>
                    {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div>}
                    <div className="max-h-[320px] space-y-2 overflow-y-auto">
                        {team.members.map((m) => (
                            <div key={m.id} className="flex items-center gap-2">
                                <Avatar name={m.name} color={m.color} />
                                <span className="flex-1 truncate text-[12px]">
                                    {m.name}
                                    {m.id === me?.id ? " (you)" : ""} <span className="text-ink-subtle">{ROLE_LABELS[m.role]} on the team</span>
                                </span>
                                {m.role !== "admin" && canShare ? (
                                    <Select aria-label={`${m.name}'s folder access`} value={current.members?.[m.id] ?? ""} onChange={(e) => set(m.id, e.target.value)} className={select}>
                                        <option value="">{invited ? "Not invited" : `Team role (${ROLE_LABELS[m.role]})`}</option>
                                        <option value="edit">Can edit</option>
                                        <option value="view">Can view</option>
                                        <option value="none">No access</option>
                                    </Select>
                                ) : (
                                    <span className="text-[11px] text-ink-muted">{roleOf(m)}</span>
                                )}
                            </div>
                        ))}
                        {(current.guests ?? []).map((g) => (
                            <div key={g.id} className="flex items-center gap-2">
                                <Avatar name={g.name} color={g.color} />
                                <span className="flex-1 truncate text-[12px]">
                                    {g.name} <span className="text-ink-subtle">Guest · {g.email}</span>
                                </span>
                                {canShare ? (
                                    <Select aria-label={`${g.name}'s folder access`} value={g.role} onChange={(e) => void share({ guest: { userId: g.id, role: e.target.value === "remove" ? null : (e.target.value as "edit" | "view") } })} className={select}>
                                        <option value="edit">Can edit</option>
                                        <option value="view">Can view</option>
                                        <option value="remove">Remove</option>
                                    </Select>
                                ) : (
                                    <span className="text-[11px] text-ink-muted">{ROLE_LABELS[g.role]}</span>
                                )}
                            </div>
                        ))}
                        {(current.invites ?? []).map((i) => (
                            <div key={i.email} className="flex items-center gap-2">
                                <span className="flex size-6 items-center justify-center rounded-full bg-field text-[11px] text-ink-muted">@</span>
                                <span className="flex-1 truncate text-[12px]">
                                    {i.email} <span className="text-ink-subtle">Invited, no account yet</span>
                                </span>
                                {canShare && (
                                    <Select aria-label={`${i.email}'s folder access`} value={i.role} onChange={(e) => void share({ guest: { email: i.email, role: e.target.value === "remove" ? null : (e.target.value as "edit" | "view") } })} className={select}>
                                        <option value="edit">Can edit</option>
                                        <option value="view">Can view</option>
                                        <option value="remove">Remove</option>
                                    </Select>
                                )}
                            </div>
                        ))}
                    </div>
                    {(current.connections ?? []).length > 0 && <p className="text-[11px] text-ink-muted">Also connected to {(current.connections ?? []).map((c) => `${c.name} (${ROLE_LABELS[c.role]})`).join(", ")}. Team admins change connections in the admin console.</p>}
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}
