import { ChevronRight, InfoCircle } from "@untitledui/icons";
import { type ReactNode, useEffect, useState } from "react";
import { type AdminData, type SamlConfig, type TeamSettings, type Workspace, adminAction, loadSaml, longDate, useRun } from "../../engine/admin";
import { ssoInfo } from "../../engine/auth";
import { useTeams } from "../../engine/teams";
import { Select } from "../select";
import { AddCreditsDialog } from "./ai-credits-page";
import type { AdminPage } from "./admin-console";
import { Button, Dialog, ErrorText, field, FieldLabel, PageTitle, Toggle } from "./admin-ui";
import { PaymentNotice, PlanDialog } from "./billing-page";
import { SamlDialog } from "./saml-dialog";

type Open = "profile" | "plan" | "annual" | "credits" | "cancel" | "payment" | "invoice" | "tax" | "approval" | "digests" | "contacts" | "creditRequests" | "source" | null;

export function SettingsPage({ data, go }: { data: AdminData; go: (p: AdminPage) => void }) {
    const s = data.settings;
    const b = data.billing;
    const [open, setOpen] = useState<Open>(null);
    const [error, setError] = useState<string | null>(null);
    const [workspace, setWorkspace] = useState<Workspace | "new" | null>(null);
    const [saml, setSaml] = useState<SamlConfig | null>(null);
    const [samlOpen, setSamlOpen] = useState(false);
    const [oidc, setOidc] = useState<{ enabled: boolean; name: string } | null>(null);
    useEffect(() => {
        loadSaml(data.team.id).then(setSaml, () => setSaml(null));
        void ssoInfo().then(setOidc);
    }, [data.team.id]);
    const run = useRun(setError);
    const save = (settings: Partial<TeamSettings> & { teamName?: string }) => run(() => adminAction(data.team.id, "settings", { settings }));
    const close = () => setOpen(null);
    return (
        <>
            <PageTitle>Settings</PageTitle>
            <div className="mx-auto max-w-[712px] px-4 pt-[39px] pb-12">
                <ErrorText>{error}</ErrorText>
                <Group title="Community profile">
                    <Row title="Display name" description={`${s.displayName || data.team.name}${s.handle ? ` · @${s.handle}` : ""}. Choose how the team's name is displayed`} onOpen={() => setOpen("profile")} />
                </Group>
                <Group title="Plan">
                    <Row title="Upgrade your plan" description={`You're on the ${b.plan} plan`} action={<span className="flex h-[24px] items-center rounded-[5px] border border-panel-border px-2 text-[12px]">View plans</span>} onOpen={() => setOpen("plan")} />
                    <Row title="Add an annual plan" description={b.interval === "annual" ? "Billed yearly" : "Switch to yearly billing"} onOpen={() => setOpen("annual")} />
                    <Row title="Manage AI credits" description="Monthly credits for each seat type and the team" onOpen={() => setOpen("credits")} />
                    <Row title="Cancel plan" description={b.cancelAtPeriodEnd ? `Ends ${longDate(b.renewsAt)}` : `Renews ${longDate(b.renewsAt)}`} onOpen={() => setOpen("cancel")} />
                </Group>
                <Group title="Billing">
                    <Row title="Payment details" description="Handled outside the app" onOpen={() => setOpen("payment")} />
                    <Row title="Invoice details" description={s.invoiceDetails.company || "Company name and address on statements"} onOpen={() => setOpen("invoice")} />
                    <Row title="Tax ID (VAT/GST)" description={s.taxId || "Not added"} onOpen={() => setOpen("tax")} />
                    <Row title="Seat approval settings" description={s.seatApproval === "auto" ? "Seat requests are approved automatically" : "Admins approve seat requests"} onOpen={() => setOpen("approval")} />
                    <Row
                        title="Auto-approve seat digests"
                        description="Send admins a digest of the seats that were approved automatically."
                        action={
                            <span className="flex items-center gap-[2px] text-[12px] text-ink-muted">
                                <InfoCircle className="mr-[2px] size-3" />
                                {s.autoApproveDigests ? "Enabled" : "Disabled"}
                                <ChevronRight className="ml-[4px] size-4 text-ink" />
                            </span>
                        }
                        onOpen={() => setOpen("digests")}
                    />
                    <Row title="Billing contacts" description={s.billingContacts.length ? s.billingContacts.join(", ") : "Only admins"} onOpen={() => setOpen("contacts")} />
                    <Row title="AI credit requests" description={s.aiCreditRequests ? "Members can ask for more credits" : "Members can't ask for more credits"} onOpen={() => setOpen("creditRequests")} />
                </Group>
                <Group title="Resources">
                    <Row title="UI kits" description="Turn on the built-in UI kit libraries by default in design files" action={<Toggle label="UI kits" checked={s.uiKits} onChange={(v) => void save({ uiKits: v })} />} onOpen={() => void save({ uiKits: !s.uiKits })} />
                    <Row title="Source control app" description={s.sourceControl.provider ? `${s.sourceControl.provider}${s.sourceControl.organization ? ` · ${s.sourceControl.organization}` : ""}` : "Manage repository access"} onOpen={() => setOpen("source")} />
                </Group>
                <Group title="Products">
                    <Row title="Inspect" description="Let people with Full or Dev seats inspect designs and mark them ready for dev" action={<Toggle label="Inspect" checked={s.devMode} onChange={(v) => void save({ devMode: v })} />} onOpen={() => void save({ devMode: !s.devMode })} />
                    <Row title="Make" description="Let people generate apps and prototypes from prompts in Make files" action={<Toggle label="Make" checked={s.make} onChange={(v) => void save({ make: v })} />} onOpen={() => void save({ make: !s.make })} />
                    <Row title="Publishing sites" description="Let people publish Site files from the team's folders to the web" action={<Toggle label="Publishing sites" checked={s.sitesPublishing} onChange={(v) => void save({ sitesPublishing: v })} />} onOpen={() => void save({ sitesPublishing: !s.sitesPublishing })} />
                </Group>
                <Group title="Workspaces">
                    {data.workspaces.map((w) => (
                        <Row key={w.id} title={w.name} description={`${w.folders.length} ${w.folders.length === 1 ? "folder" : "folders"} · ${w.admins.length} ${w.admins.length === 1 ? "admin" : "admins"}${w.description ? ` · ${w.description}` : ""}`} onOpen={() => setWorkspace(w)} />
                    ))}
                    <Row title="Create a workspace" description="Group the team's folders with admins of their own, who manage access to them" onOpen={() => setWorkspace("new")} />
                </Group>
                <Group title="Single sign-on">
                    <Row
                        title="SAML single sign-on"
                        description={saml?.enabled ? `On for ${saml.domains.join(", ")}` : saml?.ssoUrl ? "Set up, turned off" : "Sign people in through your identity provider with SAML 2.0"}
                        onOpen={() => setSamlOpen(true)}
                    />
                    <Row
                        title="OpenID Connect"
                        description={oidc?.name ? `${oidc.name}, set up for this server by whoever runs it` : "Set up for the whole server by whoever runs it (NAGMA_OIDC_ISSUER, NAGMA_OIDC_CLIENT_ID, NAGMA_OIDC_CLIENT_SECRET)"}
                        action={<span className="text-[12px] text-ink-muted">{oidc?.name ? "On" : "Off"}</span>}
                        onOpen={() => undefined}
                    />
                </Group>
                <Group title="AI">
                    <Row title="Content training" description="Allow content from the team's files to be used to improve AI features. Off by default; nothing leaves this server unless it's turned on." action={<Toggle label="Content training" checked={s.contentTraining} onChange={(v) => void save({ contentTraining: v })} />} onOpen={() => void save({ contentTraining: !s.contentTraining })} />
                </Group>

                {samlOpen && <SamlDialog teamId={data.team.id} onClose={() => setSamlOpen(false)} onChange={setSaml} />}
                {workspace && <WorkspaceDialog data={data} workspace={workspace === "new" ? null : workspace} onClose={() => setWorkspace(null)} />}
                {open === "profile" && <ProfileDialog data={data} onClose={close} onSave={save} />}
                {(open === "plan" || open === "annual") && <PlanDialog data={data} onClose={close} focus={open === "annual" ? "annual" : undefined} />}
                {open === "credits" && <AddCreditsDialog data={data} onClose={close} />}
                {open === "payment" && <PaymentNotice onClose={close} />}
                {open === "cancel" && (
                    <Dialog
                        title={b.cancelAtPeriodEnd ? "Keep your plan" : "Cancel plan"}
                        description={b.cancelAtPeriodEnd ? `The plan is set to end on ${longDate(b.renewsAt)}. Keep it to renew as usual.` : `The ${b.plan} plan stays active until ${longDate(b.renewsAt)}, then no more statements are made. Files and people stay as they are.`}
                        onClose={close}
                        footer={
                            <>
                                <Button onPress={close}>Back</Button>
                                <Button variant={b.cancelAtPeriodEnd ? "primary" : "danger"} onPress={() => void run(() => adminAction(data.team.id, "billing", { cancelAtPeriodEnd: !b.cancelAtPeriodEnd })).then(close)}>
                                    {b.cancelAtPeriodEnd ? "Keep plan" : "Cancel plan"}
                                </Button>
                            </>
                        }
                    />
                )}
                {open === "invoice" && <InvoiceDetailsDialog data={data} onClose={close} onSave={save} />}
                {open === "tax" && <TextDialog title="Tax ID (VAT/GST)" label="Tax ID" value={s.taxId} placeholder="e.g. GB123456789" hint="Shown on statements." onClose={close} onSave={(v) => save({ taxId: v })} allowEmpty />}
                {open === "approval" && (
                    <ChoiceDialog
                        title="Seat approval settings"
                        value={s.seatApproval}
                        options={[
                            ["admins", "Admins approve seat requests", "Requests wait on the Dashboard until an admin approves or denies them."],
                            ["auto", "Approve seat requests automatically", "People get the seat they ask for straight away; it shows up on the next statement."],
                        ]}
                        onClose={close}
                        onSave={(v) => save({ seatApproval: v as TeamSettings["seatApproval"] })}
                    />
                )}
                {open === "digests" && <ToggleDialog title="Auto-approve seat digests" label="Send admins a digest of seats that were approved automatically" value={s.autoApproveDigests} onClose={close} onSave={(v) => save({ autoApproveDigests: v })} />}
                {open === "contacts" && <TextDialog title="Billing contacts" label="Emails" value={s.billingContacts.join(", ")} hint="Separate several with commas. They're listed on statements." onClose={close} onSave={(v) => save({ billingContacts: v.split(/[\s,;]+/).filter(Boolean) })} allowEmpty />}
                {open === "creditRequests" && <ToggleDialog title="AI credit requests" label="Let members ask admins for more AI credits" value={s.aiCreditRequests} onClose={close} onSave={(v) => save({ aiCreditRequests: v })} />}
                {open === "source" && <SourceDialog data={data} onClose={close} onSave={save} />}
                <div className="mt-8 text-center">
                    <button type="button" onClick={() => go("billing")} className="text-[12px] text-link hover:underline">
                        Go to Billing
                    </button>
                </div>
            </div>
        </>
    );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="mb-[37px]">
            <h2 className="mb-[21px] text-[16px] leading-[20px] font-medium">{title}</h2>
            <div className="overflow-hidden rounded-[10px] border border-card-border bg-panel py-1">{children}</div>
        </section>
    );
}

function Row({ title, description, action, onOpen }: { title: string; description: string; action?: ReactNode; onOpen: () => void }) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
            className="flex min-h-[56px] cursor-default items-center gap-3 py-[8px] pr-[13px] pl-[16px] outline-none hover:bg-panel-hover/60 focus-visible:bg-panel-hover"
        >
            <div className="min-w-0 flex-1 leading-[17px]">
                <div className="text-[12px] font-medium">{title}</div>
                <div className="text-[12px] text-ink-muted">{description}</div>
            </div>
            {action ?? <ChevronRight className="size-4 shrink-0 text-ink" />}
        </div>
    );
}

function SaveFooter({ onClose, onSave, disabled }: { onClose: () => void; onSave: () => void; disabled?: boolean }) {
    return (
        <>
            <Button onPress={onClose}>Cancel</Button>
            <Button variant="primary" disabled={disabled} onPress={onSave}>
                Save
            </Button>
        </>
    );
}

function TextDialog({ title, label, value, placeholder, hint, allowEmpty, onClose, onSave }: { title: string; label: string; value: string; placeholder?: string; hint?: string; allowEmpty?: boolean; onClose: () => void; onSave: (v: string) => Promise<boolean> }) {
    const [text, setText] = useState(value);
    return (
        <Dialog title={title} onClose={onClose} footer={<SaveFooter onClose={onClose} disabled={!allowEmpty && !text.trim()} onSave={() => void onSave(text.trim()).then((ok) => ok && onClose())} />}>
            <FieldLabel label={label} hint={hint}>
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} className={field} autoFocus />
            </FieldLabel>
        </Dialog>
    );
}

function ToggleDialog({ title, label, value, onClose, onSave }: { title: string; label: string; value: boolean; onClose: () => void; onSave: (v: boolean) => Promise<boolean> }) {
    const [on, setOn] = useState(value);
    return (
        <Dialog title={title} onClose={onClose} footer={<SaveFooter onClose={onClose} onSave={() => void onSave(on).then((ok) => ok && onClose())} />}>
            <label className="flex items-center gap-3">
                <span className="flex-1">{label}</span>
                <Toggle label={label} checked={on} onChange={setOn} />
            </label>
        </Dialog>
    );
}

function ChoiceDialog({ title, value, options, onClose, onSave }: { title: string; value: string; options: [string, string, string][]; onClose: () => void; onSave: (v: string) => Promise<boolean> }) {
    const [pick, setPick] = useState(value);
    return (
        <Dialog title={title} onClose={onClose} footer={<SaveFooter onClose={onClose} onSave={() => void onSave(pick).then((ok) => ok && onClose())} />}>
            <div className="space-y-2" role="radiogroup" aria-label={title}>
                {options.map(([id, label, hint]) => (
                    <label key={id} className={`flex gap-2.5 rounded-lg border px-3 py-2.5 ${pick === id ? "border-brand-500 bg-brand-50" : "border-panel-border"}`}>
                        <input type="radio" name={title} checked={pick === id} onChange={() => setPick(id)} className="mt-0.5 accent-brand-500" />
                        <span>
                            <span className="block font-medium">{label}</span>
                            <span className="block text-ink-muted">{hint}</span>
                        </span>
                    </label>
                ))}
            </div>
        </Dialog>
    );
}

function ProfileDialog({ data, onClose, onSave }: { data: AdminData; onClose: () => void; onSave: (s: Partial<TeamSettings> & { teamName?: string }) => Promise<boolean> }) {
    const [teamName, setTeamName] = useState(data.team.name);
    const [name, setName] = useState(data.settings.displayName || data.team.name);
    const [handle, setHandle] = useState(data.settings.handle);
    return (
        <Dialog title="Display name" description="The team's name inside Nagma, and how it appears on files it publishes to the community." onClose={onClose} footer={<SaveFooter onClose={onClose} onSave={() => void onSave({ displayName: name.trim(), handle: handle.trim(), ...(teamName.trim() ? { teamName: teamName.trim() } : {}) }).then((ok) => ok && onClose())} />}>
            <div className="space-y-3">
                <FieldLabel label="Team name">
                    <input value={teamName} onChange={(e) => setTeamName(e.target.value)} className={field} />
                </FieldLabel>
                <FieldLabel label="Display name">
                    <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
                </FieldLabel>
                <FieldLabel label="Handle" hint="Letters, numbers, dashes and underscores.">
                    <div className="flex items-center gap-1">
                        <span className="text-ink-muted">@</span>
                        <input value={handle} onChange={(e) => setHandle(e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} className={field} />
                    </div>
                </FieldLabel>
            </div>
        </Dialog>
    );
}

function InvoiceDetailsDialog({ data, onClose, onSave }: { data: AdminData; onClose: () => void; onSave: (s: Partial<TeamSettings>) => Promise<boolean> }) {
    const [d, setD] = useState(data.settings.invoiceDetails);
    return (
        <Dialog title="Invoice details" description="Printed on every statement." onClose={onClose} footer={<SaveFooter onClose={onClose} onSave={() => void onSave({ invoiceDetails: d }).then((ok) => ok && onClose())} />}>
            <div className="space-y-3">
                <FieldLabel label="Company name">
                    <input value={d.company} onChange={(e) => setD({ ...d, company: e.target.value })} className={field} autoFocus />
                </FieldLabel>
                <FieldLabel label="Address">
                    <textarea value={d.address} onChange={(e) => setD({ ...d, address: e.target.value })} rows={3} className={`${field} h-auto py-2`} />
                </FieldLabel>
                <FieldLabel label="Note" hint="A purchase order number or anything else your finance team needs.">
                    <input value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} className={field} />
                </FieldLabel>
            </div>
        </Dialog>
    );
}

function SourceDialog({ data, onClose, onSave }: { data: AdminData; onClose: () => void; onSave: (s: Partial<TeamSettings>) => Promise<boolean> }) {
    const [sc, setSc] = useState(data.settings.sourceControl);
    return (
        <Dialog title="Source control app" description="Which repositories the team links files and dev handoff to." onClose={onClose} footer={<SaveFooter onClose={onClose} onSave={() => void onSave({ sourceControl: sc }).then((ok) => ok && onClose())} />}>
            <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <FieldLabel label="Git host">
                        <input value={sc.provider} onChange={(e) => setSc({ ...sc, provider: e.target.value })} placeholder="git.company.com" className={field} autoFocus />
                    </FieldLabel>
                    <FieldLabel label="Organization">
                        <input value={sc.organization} onChange={(e) => setSc({ ...sc, organization: e.target.value })} placeholder="acme" className={field} />
                    </FieldLabel>
                </div>
                <FieldLabel label="Repositories" hint="One per line or comma separated, like acme/web.">
                    <textarea value={sc.repositories} onChange={(e) => setSc({ ...sc, repositories: e.target.value })} rows={3} className={`${field} h-auto py-2 font-mono`} />
                </FieldLabel>
                <FieldLabel label="Who can link repositories">
                    <Select aria-label="Who can link repositories" value={sc.access} onChange={(e) => setSc({ ...sc, access: e.target.value as "admins" | "everyone" })} className={field}>
                        <option value="admins">Admins only</option>
                        <option value="everyone">Everyone on the team</option>
                    </Select>
                </FieldLabel>
            </div>
        </Dialog>
    );
}

// A workspace: some of the team's folders, with admins who manage access to them (they get admin
// access to those folders without being team admins).
function WorkspaceDialog({ data, workspace, onClose }: { data: AdminData; workspace: Workspace | null; onClose: () => void }) {
    const folders = (useTeams().find((t) => t.id === data.team.id)?.projects ?? []).filter((p) => !p.trashed && !p.parentId && !p.connectedFrom);
    const [name, setName] = useState(workspace?.name ?? "");
    const [description, setDescription] = useState(workspace?.description ?? "");
    const [picked, setPicked] = useState<string[]>(workspace?.folders ?? []);
    const [admins, setAdmins] = useState<string[]>(workspace?.admins ?? []);
    const [error, setError] = useState<string | null>(null);
    const run = useRun(setError);
    const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
    return (
        <Dialog
            title={workspace ? workspace.name : "Create a workspace"}
            width={480}
            onClose={onClose}
            footer={
                <>
                    {workspace && (
                        <Button variant="danger" onPress={() => window.confirm(`Delete the workspace "${workspace.name}"? Its folders stay as they are.`) && void run(() => adminAction(data.team.id, "workspace", { id: workspace.id, delete: true })).then((ok) => ok && onClose())}>
                            Delete
                        </Button>
                    )}
                    <div className="flex-1" />
                    <Button onPress={onClose}>Cancel</Button>
                    <Button variant="primary" disabled={!name.trim()} onPress={() => void run(() => adminAction(data.team.id, "workspace", { id: workspace?.id, name: name.trim(), description, folders: picked, admins })).then((ok) => ok && onClose())}>
                        Save
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <FieldLabel label="Name">
                    <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
                </FieldLabel>
                <FieldLabel label="Description">
                    <input value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
                </FieldLabel>
                <div>
                    <span className="mb-1.5 block text-[11.5px] font-medium">Folders</span>
                    <div className="max-h-36 space-y-1 overflow-y-auto">
                        {folders.length === 0 && <p className="text-ink-muted">The team has no folders yet.</p>}
                        {folders.map((f) => (
                            <label key={f.id} className="flex items-center gap-2">
                                <input type="checkbox" checked={picked.includes(f.id)} onChange={() => setPicked(toggle(picked, f.id))} className="accent-brand-500" />
                                {f.name}
                            </label>
                        ))}
                    </div>
                </div>
                <div>
                    <span className="mb-1.5 block text-[11.5px] font-medium">Workspace admins</span>
                    <div className="max-h-36 space-y-1 overflow-y-auto">
                        {data.people
                            .filter((p) => p.role !== "admin")
                            .map((p) => (
                                <label key={p.id} className="flex items-center gap-2">
                                    <input type="checkbox" checked={admins.includes(p.id)} onChange={() => setAdmins(toggle(admins, p.id))} className="accent-brand-500" />
                                    {p.name} <span className="text-ink-muted">{p.email}</span>
                                </label>
                            ))}
                    </div>
                    <p className="mt-1 text-[11px] text-ink-muted">Team admins already manage every folder.</p>
                </div>
                <ErrorText>{error}</ErrorText>
            </div>
        </Dialog>
    );
}

