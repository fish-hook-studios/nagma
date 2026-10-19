import { ChevronDown, ChevronRight, Code02, Cube01, DotsHorizontal, Folder, Globe02, Link01, Lock01, Users01, X } from "@untitledui/icons";
import { useEffect, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { authHeaders, refreshSession, useAuth } from "../engine/auth";
import { collab, currentLinkKey, httpBase, leave, requestAccess, resetLinks, setMyName, shareCurrent, shareLink, useCollab } from "../engine/collab";
import { isDesktop } from "../engine/desktop";
import { type LinkKind, copyLink, embedCode, fileLink } from "../engine/links";
import { editor, useEditor } from "../engine/store";
import { AuthForm } from "./auth";
import { Avatar } from "./avatar";
import { DarkMenu } from "./collab-menu";
import { PublishDialog } from "./community-page";
import { ShareNeedsServer } from "./onboarding";
import { shouldNudgeShare } from "../engine/onboarding";
import { awaitingVerification, currentShareStep, exportCopy, refusedUnverified, shareThroughHosted } from "../engine/share-hosted";
import { hostedServer, isLocalOnlyLink, openServerPicker } from "../engine/servers";
import { VerifyEmailMessage } from "./verify-email";

// Share, like the reference's dialog: invite by email with a role, "Who has access" (the link, the project's
// team, the owner and everyone invited), what each can do, and links to copy or embed.

type FileRole = "edit" | "view" | "prototype";
type LinkRole = FileRole | "none";
interface Person {
    id: string;
    name: string;
    email: string;
    color: string;
}
interface Access {
    owner: Person | null;
    members: (Person & { role: FileRole })[];
    invites: { email: string; role: FileRole }[];
    link: LinkRole;
    viewersCanExport?: boolean;
    you: FileRole | null;
    project: { id: string; name: string } | null;
    team: { id: string; name: string } | null;
    inherited: (Person & { role: FileRole })[];
    groups?: Group[];
    availableGroups?: Omit<Group, "role">[];
    password?: boolean;
    expires?: number | null;
    requests?: { id: string; role: FileRole; note: string; at: number; user: Person | null }[];
    myRequest?: { id: string; role: FileRole; status: "pending" | "approved" | "denied" } | null;
}
interface Group {
    id: string;
    name: string;
    team: string;
    count: number;
    role: FileRole;
}

const DAY = 24 * 60 * 60 * 1000;
const EXPIRY_CHOICES: { id: string; label: string; days: number | null }[] = [
    { id: "never", label: "Never", days: null },
    { id: "1", label: "In 1 day", days: 1 },
    { id: "7", label: "In 7 days", days: 7 },
    { id: "30", label: "In 30 days", days: 30 },
];
const dateLabel = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const ROLE_LABEL: Record<FileRole, string> = { edit: "can edit", view: "can view", prototype: "can view prototypes" };
const ROLES: FileRole[] = ["edit", "view", "prototype"];

function RoleSelect({ value, onChange, removable, label, disabled }: { value: FileRole; onChange: (role: FileRole | "remove") => void; removable?: boolean; label: string; disabled?: boolean }) {
    if (disabled) return <span className="shrink-0 text-[11px] text-ink-muted">{ROLE_LABEL[value]}</span>;
    return (
        <DarkMenu
            label={label}
            className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-ink-muted outline-none hover:bg-panel-hover hover:text-ink"
            width="w-48"
            trigger={
                <>
                    {ROLE_LABEL[value]}
                    <ChevronDown className="size-3" />
                </>
            }
            items={[...ROLES.map((r) => ({ id: r, label: ROLE_LABEL[r], checked: r === value })), ...(removable ? ["-" as const, { id: "remove", label: "Remove access" }] : [])]}
            onAction={(id) => onChange(id as FileRole | "remove")}
        />
    );
}

export function ShareDialogContent({ close, stacked }: { close: () => void; stacked?: boolean }) {
    const status = useCollab((s) => s.status);
    const me = useCollab((s) => s.me);
    const fileId = useCollab((s) => s.fileId);
    const role = useCollab((s) => s.role);
    const keys = useCollab((s) => s.keys);
    const docName = useEditor((s) => s.doc.name);
    const hasSelection = useEditor((s) => s.selection.length > 0);
    const selName = useEditor((s) => (s.selection.length === 1 ? (s.doc.nodes[s.selection[0] ?? ""]?.name ?? null) : null));
    const account = useAuth((s) => s.user);
    const [access, setAccess] = useState<Access | null>(null);
    const [emails, setEmails] = useState("");
    const [inviteRole, setInviteRole] = useState<FileRole>("edit");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
    const [embed, setEmbed] = useState(false);
    const [confirmReset, setConfirmReset] = useState(false);
    const [linkSettings, setLinkSettings] = useState(false);
    const [password, setPassword] = useState("");
    const [asked, setAsked] = useState(false);
    const [publishing, setPublishing] = useState(false);
    // The server refused a change because the account's email isn't verified yet.
    const [refused, setRefused] = useState(false);
    const shared = status !== "local";
    const step = currentShareStep(shared);
    const manage = role === "edit";
    // The first Share in a file only on this device, with This computer as the server: a note that
    // collaboration needs a server (once per device).
    const [nudge] = useState(() => shouldNudgeShare(status === "local"));

    const keyParam = () => {
        const key = currentLinkKey();
        return key ? `?key=${encodeURIComponent(key)}` : "";
    };
    const load = async () => {
        if (!fileId || !account) return;
        try {
            const res = await fetch(`${httpBase()}/files/${fileId}/access${keyParam()}`, { headers: authHeaders() });
            if (res.ok) {
                const data = (await res.json()) as Access;
                setAccess(data);
                collab.set({ access: { link: data.link, owner: data.owner?.id ?? null, project: data.project?.id ?? null, viewersCanExport: data.viewersCanExport !== false } });
            }
        } catch {
            // Offline: the people list just doesn't show.
        }
    };
    useEffect(() => {
        void load();
        // Reload when the file or the signed-in account changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fileId, account?.id, shared, role]);

    const change = async (body: Record<string, unknown>, done?: string) => {
        if (!fileId) return false;
        setBusy(true);
        setMessage(null);
        try {
            const res = await fetch(`${httpBase()}/files/${fileId}/access${keyParam()}`, { method: "PUT", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify(body) });
            const data = (await res.json()) as Access & { error?: string; code?: string };
            if (refusedUnverified(res.status, data)) {
                // The Verify your email message (with Resend) says why, rather than a plain error.
                setRefused(true);
                void refreshSession().catch(() => undefined);
                return false;
            }
            if (!res.ok) throw new Error(data.error ?? "The server refused that.");
            setAccess(data);
            collab.set({ access: { link: data.link, owner: data.owner?.id ?? null, project: data.project?.id ?? null, viewersCanExport: data.viewersCanExport !== false } });
            if (done) setMessage({ text: done });
            return true;
        } catch (err) {
            setMessage({ text: err instanceof Error ? err.message : String(err), error: true });
            return false;
        } finally {
            setBusy(false);
        }
    };

    const title = selName ? `Share to selection "${selName}"` : `Share ${docName || "this file"}`;
    // The header: the title, Copy link (once the file is on the server) and close.
    const header = (copy: boolean) => (
        <div className="flex h-[40px] shrink-0 items-center gap-1 border-b border-panel-border pr-[8px] pl-[16px]">
            <h2 className="min-w-0 flex-1 truncate text-[11px] font-semibold">{title}</h2>
            {copy && (
                <button type="button" onClick={() => void copyLink(selName ? "selection" : "file")} disabled={!keys && (access?.link ?? "none") !== "none"} className="flex h-6 shrink-0 items-center gap-[6px] rounded-[5px] px-1.5 text-[11px] text-link outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50">
                    <Link01 className="size-3.5" />
                    Copy link
                </button>
            )}
            <AriaButton aria-label="Close" onPress={close} className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                <X className="size-4" />
            </AriaButton>
        </div>
    );
    // In the editor the dialog is two stacked cards; hosts that draw their own card get one card with a rule.
    const cardClass = stacked ? "overflow-hidden rounded-[13px] border border-panel-border bg-panel-raised text-ink shadow-2xl" : "";
    const single = (body: React.ReactNode) => (
        <div className={cardClass}>
            {header(false)}
            {body}
        </div>
    );

    // This computer is the server: a link would carry this machine's address, which nobody elsewhere
    // can open. Share offers a server instead (engine/share-hosted.ts).
    if (step === "through-hosted" || step === "pick-server") return single(<ShareFromThisComputer close={close} hosted={step === "through-hosted"} nudge={nudge} />);

    if (!account) {
        return single(
                <div className="space-y-4 p-4">
                    {nudge && !shared && <ShareNeedsServer close={close} />}
                    <p className="text-[12px] leading-relaxed text-ink-muted">Sign in so this file has an owner, and so you can invite people by email.</p>
                    <AuthForm compact />
                    {shared && (
                        <p className="rounded-md bg-field p-3 text-[12px] text-ink-muted">
                            You're in this file through a link{role && role !== "edit" ? `, and you ${ROLE_LABEL[role]}` : ""}. Your name shows as {me.name || "Guest"}.
                        </p>
                    )}
                </div>,
        );
    }

    if (!shared) {
        return single(
                <div className="space-y-4 p-4">
                    {nudge && <ShareNeedsServer close={close} />}
                    <p className="text-[12px] leading-relaxed text-ink-muted">This file is only in this browser. Move it to your Nagma server, owned by you, then invite people or send a link.</p>
                    <AriaButton
                        onPress={() => {
                            setMyName(me.name);
                            shareCurrent();
                        }}
                        className="h-9 w-full rounded-md bg-brand-500 text-[12px] font-semibold text-white outline-none hover:bg-brand-600"
                    >
                        Move to the server and share
                    </AriaButton>
                </div>,
        );
    }

    const link: LinkRole = access?.link ?? "none";
    const anyone = link !== "none";
    const query = emails.trim().toLowerCase();
    const groupMatches = query && !query.includes("@") ? (access?.availableGroups ?? []).filter((g) => g.name.toLowerCase().includes(query) && !access?.groups?.some((x) => x.id === g.id)).slice(0, 5) : [];
    const decide = async (id: string, approve: boolean) => {
        if (!fileId) return;
        await fetch(`${httpBase()}/files/${fileId}/requests/${id}`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ approve }) }).catch(() => undefined);
        await load();
    };
    const roleText = "flex h-6 shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-[11px] text-ink outline-none hover:bg-panel-hover";
    const icon = (node: React.ReactNode) => <span className="flex size-4 shrink-0 items-center justify-center text-ink">{node}</span>;
    const sub = "block truncate text-[11px] leading-[14px] text-ink-subtle";
    // Links and actions past Copy link: the second card's More menu.
    // A server on this computer or its network: its links only open there (engine/servers.ts).
    const localOnly = Boolean(fileId) && isLocalOnlyLink(fileLink("file"));
    const moreItems = [
        ...(localOnly ? [{ id: "localLink", label: "Copy local link (same network only)" }, "-" as const] : []),
        { id: "selection", label: "Copy link to selection", disabled: !hasSelection },
        { id: "prototype", label: "Copy prototype link" },
        { id: "embed", label: embed ? "Hide embed code" : "Get embed code" },
        ...(isDesktop ? [] : [{ id: "desktop", label: "Open in the desktop app" }]),
        ...(manage && access ? ["-" as const, { id: "export", label: "Viewers can copy, share and export", checked: access.viewersCanExport !== false }] : []),
        ...(manage && keys ? ["-" as const, { id: "reset", label: "Reset links" }, { id: "leave", label: "Keep working on a copy in this browser" }] : []),
    ];
    const more = (id: string) => {
        if (id === "localLink") void copyLink(selName ? "selection" : "file", { allowLocal: true });
        else if (id === "embed") setEmbed((v) => !v);
        else if (id === "export") void change({ viewersCanExport: access?.viewersCanExport === false }, access?.viewersCanExport === false ? "People with view access can copy, share and export again." : "People with view access can no longer copy layers, export, save a copy or duplicate the file.");
        else if (id === "desktop") location.href = `nagma://open?url=${encodeURIComponent(shareLink(keys ? "edit" : "view"))}`;
        else if (id === "reset") setConfirmReset(true);
        else if (id === "leave") {
            leave();
            close();
            editor.notify("You're working on your own copy now.");
        } else void copyLink(id as LinkKind);
    };
    const actionRow = "flex h-[36px] w-full items-center gap-[12px] px-[16px] text-left text-[11px] text-ink outline-none hover:bg-panel-hover focus-visible:bg-panel-hover";
    const access1 = (
        <div className={cardClass}>
            {header(true)}
            <div className="pt-[16px] pb-[8px]">
                {manage && (
                    <form
                        className="relative mx-[16px] flex gap-[8px]"
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (!emails.trim()) return;
                            void change({ invite: { email: emails.trim(), role: inviteRole } }, "Invited. People without an account get access when they sign up with that email.").then((ok) => ok && setEmails(""));
                        }}
                    >
                        <div className="flex h-[32px] min-w-0 flex-1 items-center rounded-[5px] bg-field pr-1 focus-within:ring-1 focus-within:ring-brand-500">
                            <input value={emails} onChange={(e) => setEmails(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={access?.availableGroups?.length ? "Add emails or user groups to invite" : "Add comma separated emails to invite"} aria-label="Emails or groups to invite" className="h-full min-w-0 flex-1 bg-transparent px-[10px] text-[11px] text-ink outline-none placeholder:text-ink-subtle" />
                            {emails.trim() && <RoleSelect label="Invite role" value={inviteRole} onChange={(r) => r !== "remove" && setInviteRole(r)} />}
                        </div>
                        <button type="submit" disabled={busy || !emails.trim()} className="h-[32px] w-[54px] shrink-0 rounded-[5px] bg-brand-500 text-[11px] font-medium text-white hover:bg-brand-600 disabled:bg-ink-subtle/60 disabled:text-panel">
                            Invite
                        </button>
                        {groupMatches.length > 0 && (
                            <div role="listbox" aria-label="User groups" className="absolute top-[36px] left-0 z-10 w-72 rounded-lg bg-tooltip p-1 text-white shadow-xl">
                                {groupMatches.map((g) => (
                                    <button
                                        key={g.id}
                                        type="button"
                                        role="option"
                                        aria-selected={false}
                                        onClick={() => void change({ inviteGroup: { id: g.id, role: inviteRole } }, `Invited ${g.name}.`).then((ok) => ok && setEmails(""))}
                                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-white/10"
                                    >
                                        <Users01 className="size-3.5 shrink-0 text-white/70" />
                                        <span className="min-w-0 flex-1 truncate">{g.name}</span>
                                        <span className="shrink-0 text-[11px] text-white/50">
                                            {g.count} {g.count === 1 ? "person" : "people"} · {g.team}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </form>
                )}
                {manage && (access?.requests?.length ?? 0) > 0 && (
                    <div className="mx-[16px] mt-[12px] space-y-1 rounded-[5px] bg-field p-2">
                        <div className="px-1 text-[11px] font-semibold">Access requests</div>
                        {access?.requests?.map((r) => (
                            <div key={r.id} className="flex items-center gap-2 px-1 py-1">
                                <Avatar name={r.user?.name ?? "?"} color={r.user?.color ?? "#888888"} size={20} />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[11px]">
                                        {r.user?.name ?? "Someone"} <span className="text-ink-subtle">asks to {r.role === "edit" ? "edit" : "view"}</span>
                                    </span>
                                    {r.note && <span className={sub}>"{r.note}"</span>}
                                </span>
                                <button type="button" onClick={() => void decide(r.id, false)} className="h-6 rounded px-2 text-[11px] text-ink-muted hover:bg-panel-hover">
                                    Deny
                                </button>
                                <button type="button" onClick={() => void decide(r.id, true)} className="h-6 rounded bg-brand-500 px-2 text-[11px] font-semibold text-white hover:bg-brand-600">
                                    Approve
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                {!manage && role === "view" && (
                    <div className="mx-[16px] flex items-center gap-2 rounded-[5px] bg-field px-3 py-2">
                        <span className="min-w-0 flex-1 text-[11px] text-ink-muted">{asked || access?.myRequest?.status === "pending" ? "Edit access requested. The owner gets a notification." : "You can view this file."}</span>
                        {!asked && access?.myRequest?.status !== "pending" && (
                            <button
                                type="button"
                                onClick={() => fileId && void requestAccess(fileId, "edit").then((error) => (error ? setMessage({ text: error, error: true }) : setAsked(true)))}
                                className="h-6 shrink-0 rounded-[5px] border border-panel-border px-2 text-[11px] font-medium hover:bg-panel-hover"
                            >
                                Request edit access
                            </button>
                        )}
                    </div>
                )}
                {(refused || awaitingVerification(account)) && (
                    <div className="mx-[16px] mt-[12px]">
                        <VerifyEmailMessage inline refused={refused} />
                    </div>
                )}
                {message && <div className={`mx-[16px] mt-[12px] rounded-[5px] px-3 py-2 text-[11px] ${message.error ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-500"}`}>{message.text}</div>}
                <div className="mt-[12px] flex h-[28px] items-center px-[16px] text-[11px] font-medium text-ink">Who has access</div>
                <div className="max-h-72 overflow-y-auto">
                    <div className="flex min-h-[36px] items-center gap-[12px] px-[16px]">
                        {icon(anyone ? <Globe02 className="size-4" /> : <Lock01 className="size-4" />)}
                        <span className="min-w-0 flex-1">
                            {manage ? (
                                <DarkMenu
                                    label="Link access"
                                    className="flex max-w-full items-center gap-1 rounded text-[11px] text-ink outline-none hover:underline"
                                    placement="bottom start"
                                    width="w-64"
                                    trigger={
                                        <>
                                            {anyone ? "Anyone with the link" : "People invited to file"}
                                            <ChevronDown className="size-3" />
                                        </>
                                    }
                                    items={[
                                        { id: "anyone", label: "Anyone with the link", checked: anyone },
                                        { id: "invited", label: "Only people invited to this file", checked: !anyone },
                                    ]}
                                    onAction={(id) => void change({ link: id === "anyone" ? (anyone ? link : "view") : "none" })}
                                />
                            ) : (
                                <span className="block truncate text-[11px]">{anyone ? "Anyone with the link" : "People invited to file"}</span>
                            )}
                            {anyone && (
                                <span className={sub}>
                                    {[access?.password ? "Password protected" : "No sign-in needed", access?.expires ? `expires ${dateLabel(access.expires)}` : null].filter(Boolean).join(", ")}
                                    {manage && (
                                        <button type="button" onClick={() => setLinkSettings((v) => !v)} className="ml-1.5 text-link hover:underline">
                                            Link settings
                                        </button>
                                    )}
                                </span>
                            )}
                        </span>
                        {anyone ? <RoleSelect label="What people with the link can do" value={link as FileRole} disabled={!manage} onChange={(r) => r !== "remove" && void change({ link: r })} /> : <ChevronRight className="size-3 shrink-0 text-ink" />}
                    </div>
                    {anyone && manage && linkSettings && (
                        <div className="mx-[16px] mb-1 ml-[44px] space-y-2 rounded-[5px] bg-field p-2.5">
                            <div className="text-[11px] font-semibold">Password</div>
                            {access?.password ? (
                                <div className="flex items-center gap-2 text-[11px] text-ink-muted">
                                    <Lock01 className="size-3.5" />
                                    <span className="flex-1">People with the link enter a password to open it.</span>
                                    <button type="button" onClick={() => void change({ password: null }, "Password removed.")} className="h-6 rounded px-2 hover:bg-panel-hover">
                                        Remove
                                    </button>
                                </div>
                            ) : (
                                <form
                                    className="flex gap-2"
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        if (password.length < 4) return setMessage({ text: "Use a password of at least 4 characters.", error: true });
                                        void change({ password }, "Password set. People with the link need it to open the file.").then((ok) => ok && setPassword(""));
                                    }}
                                >
                                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Set a password" aria-label="Link password" autoComplete="new-password" className="h-6 min-w-0 flex-1 rounded-[5px] border border-panel-border bg-panel px-2 text-[11px] outline-none focus:border-brand-500" />
                                    <button type="submit" disabled={busy || !password} className="h-6 rounded-[5px] bg-brand-500 px-2.5 text-[11px] font-semibold text-white disabled:opacity-50">
                                        Save
                                    </button>
                                </form>
                            )}
                            <div className="text-[11px] font-semibold">Link expiration</div>
                            <div className="flex items-center gap-2">
                                <select
                                    aria-label="Link expires"
                                    value={access?.expires ? "date" : "never"}
                                    onChange={(e) => {
                                        const choice = EXPIRY_CHOICES.find((c) => c.id === e.target.value);
                                        if (choice) void change({ expires: choice.days === null ? null : Date.now() + choice.days * DAY });
                                    }}
                                    className="h-6 rounded-[5px] border border-panel-border bg-panel px-1.5 text-[11px] outline-none"
                                >
                                    {access?.expires && <option value="date">{dateLabel(access.expires)}</option>}
                                    {EXPIRY_CHOICES.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.label}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    type="date"
                                    aria-label="Expiry date"
                                    min={new Date(Date.now() + DAY).toISOString().slice(0, 10)}
                                    value={access?.expires ? new Date(access.expires).toISOString().slice(0, 10) : ""}
                                    onChange={(e) => e.target.value && void change({ expires: new Date(`${e.target.value}T23:59:59`).getTime() })}
                                    className="h-6 rounded-[5px] border border-panel-border bg-panel px-1.5 text-[11px] outline-none"
                                />
                            </div>
                            <p className="text-[11px] text-ink-subtle">After it expires, the link stops working for anyone who wasn't invited.</p>
                        </div>
                    )}
                    {access?.groups?.map((g) => (
                        <div key={g.id} className="flex min-h-[36px] items-center gap-[12px] px-[16px]">
                            {icon(<Users01 className="size-4" />)}
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[11px]">{g.name}</span>
                                <span className={sub}>
                                    {g.count} {g.count === 1 ? "person" : "people"} · {g.team}
                                </span>
                            </span>
                            <RoleSelect label={`${g.name}'s access`} value={g.role} disabled={!manage} removable onChange={(r) => void change(r === "remove" ? { removeGroup: g.id } : { groupRole: { id: g.id, role: r } })} />
                        </div>
                    ))}
                    {access?.project && (
                        <div className="flex min-h-[36px] items-center gap-[12px] px-[16px]" title={`${access.inherited.length} ${access.inherited.length === 1 ? "person" : "people"} through the folder`}>
                            {icon(<Folder className="size-4" />)}
                            <span className="min-w-0 flex-1 truncate text-[11px]">
                                People from {access.project.name}
                                {access.team ? ` (${access.team.name})` : ""}
                            </span>
                            <span className="shrink-0 text-[11px] text-ink">can access</span>
                        </div>
                    )}
                    {access?.owner && (
                        <div className="flex min-h-[36px] items-center gap-[12px] px-[16px]">
                            <Avatar name={access.owner.name} color={access.owner.color} size={16} />
                            <span className="min-w-0 flex-1 truncate text-[11px]">
                                {access.owner.name}
                                {access.owner.id === account.id ? " (you)" : ""} <span className="text-ink-subtle">{access.owner.email}</span>
                            </span>
                            <span className={`${roleText} hover:bg-transparent`}>owner</span>
                        </div>
                    )}
                    {access?.members.map((m) => (
                        <div key={m.id} className="flex min-h-[36px] items-center gap-[12px] px-[16px]">
                            <Avatar name={m.name} color={m.color} size={16} />
                            <span className="min-w-0 flex-1 truncate text-[11px]">
                                {m.name}
                                {m.id === account.id ? " (you)" : ""} <span className="text-ink-subtle">{m.email}</span>
                            </span>
                            <RoleSelect label={`${m.name}'s access`} value={m.role} disabled={!manage} removable onChange={(r) => void change(r === "remove" ? { remove: m.id } : { role: { userId: m.id, role: r } })} />
                        </div>
                    ))}
                    {access?.invites.map((i) => (
                        <div key={i.email} className="flex min-h-[36px] items-center gap-[12px] px-[16px]">
                            <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-dashed border-panel-border text-[9px] text-ink-subtle">@</span>
                            <span className="min-w-0 flex-1 truncate text-[11px]">
                                {i.email} <span className="text-ink-subtle">invited</span>
                            </span>
                            <RoleSelect label={`${i.email}'s access`} value={i.role} disabled={!manage} removable onChange={(r) => void change(r === "remove" ? { removeInvite: i.email } : { role: { email: i.email, role: r } })} />
                        </div>
                    ))}
                    {access?.inherited
                        .filter((p) => p.id !== access.owner?.id && !access.members.some((m) => m.id === p.id))
                        .map((p) => (
                            <div key={p.id} className="flex min-h-[36px] items-center gap-[12px] px-[16px]">
                                <Avatar name={p.name} color={p.color} size={16} />
                                <span className="min-w-0 flex-1 truncate text-[11px]">
                                    {p.name}
                                    {p.id === account.id ? " (you)" : ""} <span className="text-ink-subtle">{p.email}</span>
                                </span>
                                <span className="shrink-0 text-[11px] text-ink-muted" title="From the folder's team">
                                    {ROLE_LABEL[p.role]} · folder
                                </span>
                            </div>
                        ))}
                    {access && !access.owner && <p className="px-[16px] py-1 text-[11px] text-ink-subtle">This file was shared before accounts; {manage ? "changing access makes you its owner." : "it has no owner yet."}</p>}
                </div>
                {embed && (
                    <div className="mx-[16px] mt-[8px] space-y-1.5">
                        <div className="text-[11px] font-semibold">Embed code</div>
                        <textarea readOnly value={localOnly ? "" : embedCode()} placeholder={localOnly ? "Embeds need a link that works anywhere. This server is only on this network." : undefined} rows={3} onFocus={(e) => e.currentTarget.select()} aria-label="Embed code" className="w-full resize-none rounded-[5px] border border-panel-border bg-field p-2 font-mono text-[10.5px] text-ink-muted outline-none" />
                        <p className="text-[11px] text-ink-subtle">{anyone ? "The embed shows the file without the editor's panels." : "Only people invited can see the embed after signing in."}</p>
                    </div>
                )}
                {confirmReset && (
                    <div className="mx-[16px] mt-[8px] flex items-center gap-2 rounded-[5px] bg-field p-2 text-[11px]">
                        <span className="flex-1 text-ink-muted">Make new links? Anyone opening the current ones is turned away.</span>
                        <button type="button" onClick={() => setConfirmReset(false)} className="h-6 rounded px-2 text-ink-muted hover:bg-panel-hover">
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                resetLinks();
                                setConfirmReset(false);
                                setMessage({ text: "New links made. The old ones no longer work." });
                            }}
                            className="h-6 rounded bg-red-500 px-2 font-semibold text-white"
                        >
                            Reset links
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
    // The second card: Community and developer links, and More.
    const access2 = (
        <div className={stacked ? `${cardClass} py-[8px]` : "border-t border-panel-border py-[8px]"}>
            {manage && fileId && (
                <button type="button" onClick={() => setPublishing(true)} className={actionRow}>
                    {icon(<Cube01 className="size-4" />)}
                    <span className="min-w-0 flex-1 truncate">Publish to Community</span>
                    <ChevronRight className="size-3 shrink-0" />
                </button>
            )}
            <button type="button" onClick={() => void copyLink("dev")} className={actionRow}>
                {icon(<Code02 className="size-4" />)}
                <span className="min-w-0 flex-1 truncate">Copy inspect link</span>
            </button>
            <DarkMenu label="More links" className={`${actionRow} text-ink-muted`} placement="bottom start" width="w-64" trigger={<>{icon(<DotsHorizontal className="size-4" />)}<span className="min-w-0 flex-1 truncate">More</span></>} items={moreItems} onAction={more} />
            {publishing && fileId && <PublishDialog file={{ id: `server:${fileId}`, name: docName || "Untitled", kind: "design", createdAt: 0, updatedAt: 0, shared: fileId, key: keys?.edit ?? null }} onClose={() => setPublishing(false)} onDone={() => setPublishing(false)} />}
        </div>
    );
    return (
        <div className={stacked ? "flex flex-col gap-[10px]" : ""}>
            {access1}
            {access2}
        </div>
    );
}

// Share while This computer is the server. No link: one would carry this machine's own address.
// Share through Nagma moves the file to the hosted server (signing in or up there) and opens Share
// with a link that works anywhere; or use your own server; or export a copy to send.
function ShareFromThisComputer({ close, hosted, nudge }: { close: () => void; hosted: boolean; nudge: boolean }) {
    const fileId = useCollab((s) => s.fileId);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const server = hostedServer();
    const go = async () => {
        setBusy(true);
        setError(null);
        try {
            await shareThroughHosted();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setBusy(false);
        }
    };
    const secondary = "h-8 rounded-md border border-panel-border px-3 text-[11px] font-medium text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500";
    return (
        <div className="space-y-3 p-4" aria-label="Share from this computer" role="group">
            {nudge && <ShareNeedsServer close={close} />}
            <p className="text-[12px] leading-relaxed text-ink-muted">
                This file is only on this computer, so a link to it wouldn't open for anyone else.{" "}
                {hosted && server ? `Share it through ${server.name}, the free hosted server, to get a link that works anywhere.` : "Move it to a Nagma server to get a link that works anywhere."}
            </p>
            {hosted && server && (
                <>
                    <AriaButton onPress={() => void go()} isDisabled={busy} className="h-9 w-full rounded-md bg-brand-500 text-[12px] font-semibold text-white outline-none hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:opacity-60">
                        {busy ? `Connecting to ${server.name}…` : `Share through ${server.name}`}
                    </AriaButton>
                    <p className="text-[11px] leading-relaxed text-ink-subtle">You sign in or create a free account there. The file moves to {server.name} and Share opens with its link. The original stays on this computer.</p>
                </>
            )}
            {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div>}
            <div className="flex flex-wrap items-center gap-2">
                <AriaButton
                    onPress={() => {
                        close();
                        openServerPicker();
                    }}
                    className={hosted ? secondary : "h-8 rounded-md bg-brand-500 px-3 text-[11px] font-semibold text-white outline-none hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"}
                >
                    Use your own server…
                </AriaButton>
                <AriaButton onPress={exportCopy} className={secondary}>
                    Export a copy
                </AriaButton>
                <span className="flex-1" />
                {fileId && (
                    <DarkMenu
                        label="Local link"
                        className="flex size-8 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500"
                        placement="bottom end"
                        width="w-64"
                        trigger={<DotsHorizontal className="size-4" />}
                        items={[{ id: "local", label: "Copy local link (same network only)" }]}
                        onAction={() => void copyLink("file", { allowLocal: true })}
                    />
                )}
            </div>
        </div>
    );
}
