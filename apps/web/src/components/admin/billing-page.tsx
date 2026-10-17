import { ChevronDown, ChevronRight, CreditCard02, Receipt, Users01 } from "@untitledui/icons";
import { useState } from "react";
import { type AdminData, type BillingGroup, type Invoice, type Seat, adminAction, listInvoices, longDate, money, SEAT_LABELS, SEATS, shortDate, useAsync, useRun } from "../../engine/admin";
import { Select } from "../select";
import type { AdminPage } from "./admin-console";
import { Button, Card, CountBadge, Dialog, EmptyState, ErrorText, field, FieldLabel, LinkButton, PageBody, PageTitle, SeatIcon, TableHead, TableRow, Tabs } from "./admin-ui";

export function BillingPage({ data, go }: { data: AdminData; go: (p: AdminPage) => void }) {
    const [tab, setTab] = useState<"overview" | "invoices" | "groups">("overview");
    // Billing groups are a tab on plans that come with them; a Professional team gets the tab once it
    // has a group, and reaches it from the plan card's "Billing groups" row until then.
    const groupsTab = data.billing.plan !== "Professional" || (data.billing.groups?.length ?? 0) > 0 || tab === "groups";
    return (
        <>
            <PageTitle>Billing</PageTitle>
            <PageBody>
                <Tabs
                    label="Billing"
                    value={tab}
                    onChange={setTab}
                    tabs={groupsTab ? [["overview", "Overview"], ["invoices", "Invoices"], ["groups", "Billing groups"]] : [["overview", "Overview"], ["invoices", "Invoices"]]}
                />
                {tab === "overview" ? <Overview data={data} go={go} onGroups={groupsTab ? null : () => setTab("groups")} /> : tab === "invoices" ? <Invoices data={data} /> : <BillingGroups data={data} />}
            </PageBody>
        </>
    );
}

function Overview({ data, go, onGroups }: { data: AdminData; go: (p: AdminPage) => void; onGroups: (() => void) | null }) {
    const b = data.billing;
    const [dialog, setDialog] = useState<"seats" | "plan" | "upcoming" | null>(null);
    const [howOpen, setHowOpen] = useState(false);
    const [seatsOpen, setSeatsOpen] = useState(false);
    const cycle = b.interval === "annual" ? "annual" : "monthly";
    const adjustments = b.adjustments.reduce((n, a) => n + a.amount, 0);
    return (
        <div className="grid grid-cols-1 items-start gap-[24px] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card>
                <div className="flex h-[82px] flex-col justify-center gap-[4px] border-b border-rule px-[17px]">
                    <div className="text-[15px] font-medium">Your {b.plan} plan</div>
                    <div className="text-[13px] text-ink-muted">
                        {b.cancelAtPeriodEnd ? "Ends" : "Renews"} {longDate(b.renewsAt)} ·{" "}
                        <LinkButton onPress={() => setDialog("plan")}>View plans</LinkButton>
                    </div>
                </div>
                <div className="divide-y divide-rule px-[17px]">
                    <BillingRow
                        icon={
                            <button type="button" aria-expanded={seatsOpen} aria-label={seatsOpen ? "Hide seats by type" : "Show seats by type"} onClick={() => setSeatsOpen(!seatsOpen)} className="flex size-5 items-center justify-center rounded text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                                <ChevronRight className={`size-4 transition-transform ${seatsOpen ? "rotate-90" : ""}`} />
                            </button>
                        }
                        title={
                            <>
                                {b.interval === "annual" ? "Annual" : "Monthly"} seats <CountBadge>{b.seatsPurchased}</CountBadge>
                            </>
                        }
                        detail={`${b.available} available${b.pendingSeats ? ` · ${b.pendingSeats.count} from ${longDate(b.pendingSeats.at)}` : ""}`}
                        action={<Button onPress={() => setDialog("seats")}>Manage</Button>}
                    >
                        {seatsOpen && (
                            <div className="mt-3 space-y-2" aria-label="Seats by type">
                                {SEATS.map((s) => (
                                    <div key={s} className="flex items-center gap-3 text-[12px]">
                                        <SeatIcon seat={s} tinted className="size-4" />
                                        <span className="flex-1">{SEAT_LABELS[s]}</span>
                                        <span className="w-16 text-right text-ink-muted tabular-nums">{b.seats[s]}</span>
                                        <span className="w-32 text-right tabular-nums">{b.prices[s] ? `${money(b.prices[s], b.currency)} / seat` : "Free"}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </BillingRow>
                    <BillingRow
                        icon={<AiCreditsSparkle className="size-4" />}
                        title="AI credits"
                        detail={b.extraCredits ? `${b.extraCredits.toLocaleString()} extra team credits each month` : "No paid credits purchased"}
                        action={<Button onPress={() => go("ai")}>View usage</Button>}
                    />
                    {onGroups && <BillingRow icon={<Users01 className="size-4" />} title="Billing groups" detail="Group people to see what their seats cost" action={<Button onPress={onGroups}>Set up</Button>} />}
                </div>
            </Card>
            <Card>
                <div className="flex h-[82px] flex-col justify-center gap-[4px] border-b border-rule px-[17px]">
                    <div className="text-[15px] font-semibold tabular-nums">{money(b.nextInvoice.amount, b.currency)}</div>
                    <div className="text-[13px] text-ink-muted">
                        Next {cycle} invoice due {longDate(b.nextInvoice.due)}
                    </div>
                </div>
                <div className="px-[17px] pt-[12px] pb-[17px] text-[13px]">
                    <div className="flex h-[39px] items-center justify-between">
                        <span>Billing adjustments</span>
                        <span className="tabular-nums">{money(adjustments, b.currency)}</span>
                    </div>
                    <div className="flex h-[39px] items-center justify-between">
                        <span>{b.interval === "annual" ? "Annual" : "Monthly"} costs</span>
                        <span className="tabular-nums">{money(b.cycleCost, b.currency)}</span>
                    </div>
                    <Button className="mt-[10px] w-full" onPress={() => setDialog("upcoming")}>
                        View invoice
                    </Button>
                </div>
                <div className="mx-[17px] border-t border-rule">
                    <button type="button" aria-expanded={howOpen} onClick={() => setHowOpen(!howOpen)} className="flex h-[50px] items-center gap-1 text-left text-[11.5px] text-ink-muted outline-none hover:text-ink focus-visible:text-ink">
                        How am I billed?
                        <ChevronDown className={`size-2.5 transition-transform ${howOpen ? "rotate-180" : ""}`} />
                    </button>
                    {howOpen && (
                        <div className="space-y-2 pb-4 text-[12px] leading-[18px] text-ink-muted">
                            <p>Each Full, Dev and Collab seat is billed at its price every {b.interval === "annual" ? "year" : "month"} on the renewal date. View seats are free.</p>
                            <p>Seats you add during a cycle show up as billing adjustments on the next statement, for the part of the cycle that was left.</p>
                            <p>Statements are worked out here from your seats; payment itself happens outside the app.</p>
                        </div>
                    )}
                </div>
            </Card>
            {dialog === "seats" && <ManageSeatsDialog data={data} onClose={() => setDialog(null)} />}
            {dialog === "plan" && <PlanDialog data={data} onClose={() => setDialog(null)} />}
            {dialog === "upcoming" && (
                <InvoiceDialog
                    data={data}
                    invoice={{ id: "upcoming", number: "Upcoming", start: b.periodEnd, end: b.periodEnd, issuedAt: b.nextInvoice.due, plan: b.plan, interval: b.interval, lines: b.lines, adjustments: b.adjustments, total: b.nextInvoice.amount, currency: b.currency }}
                    onClose={() => setDialog(null)}
                />
            )}
        </div>
    );
}

function BillingRow({ icon, title, detail, action, children }: { icon: React.ReactNode; title: React.ReactNode; detail: string; action: React.ReactNode; children?: React.ReactNode }) {
    return (
        <div className="flex min-h-[90px] items-start gap-[5px] py-[21px] pl-[8px]">
            <span className="mt-[2px] flex size-5 shrink-0 items-center justify-center">{icon}</span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-[9px]">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[13px] leading-[24px] font-medium">{title}</div>
                        <div className="text-[13px] leading-[24px] text-ink-muted">{detail}</div>
                    </div>
                    {action}
                </div>
                {children}
            </div>
        </div>
    );
}

// The four-point sparkle beside AI credits.
function AiCreditsSparkle({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" className={className} aria-hidden>
            <path d="M10 2.5c.6 3.9 2.6 5.9 6.5 6.5v.1c-3.9.6-5.9 2.6-6.5 6.5h-.1c-.6-3.9-2.6-5.9-6.5-6.5V9c3.9-.6 5.9-2.6 6.5-6.5Z" />
        </svg>
    );
}

function Invoices({ data }: { data: AdminData }) {
    const list = useAsync(() => listInvoices(data.team.id), `${data.team.id}:${data.billing.startedAt}:${data.billing.interval}`);
    const [open, setOpen] = useState<Invoice | null>(null);
    const cols = "120px 110px minmax(0,1fr) 110px 20px";
    return (
        <>
            <div>
                <TableHead cols={cols}>
                    <span>Date</span>
                    <span>Number</span>
                    <span>Period</span>
                    <span className="text-right">Amount</span>
                    <span />
                </TableHead>
                {list.error && <EmptyState title="Couldn't load invoices">{list.error}</EmptyState>}
                {list.value?.length === 0 && <EmptyState title="No invoices yet">Statements appear at the start of each billing cycle.</EmptyState>}
                {list.value?.map((inv) => (
                    <TableRow key={inv.id} cols={cols} onClick={() => setOpen(inv)} label={`Invoice ${inv.number}`}>
                        <span>{shortDate(inv.issuedAt)}</span>
                        <span className="flex items-center gap-1.5 text-ink-muted">
                            <Receipt className="size-3.5" /> {inv.number}
                        </span>
                        <span className="truncate text-ink-muted">
                            {longDate(inv.start)} to {longDate(inv.end)}
                        </span>
                        <span className="text-right tabular-nums">{money(inv.total, inv.currency)}</span>
                        <ChevronRight className="size-4 text-ink-subtle" />
                    </TableRow>
                ))}
            </div>
            <p className="mt-3 text-[11.5px] text-ink-muted">Statements are generated from the team's seats each cycle. They are records only; nothing is charged by the app.</p>
            {open && <InvoiceDialog data={data} invoice={open} onClose={() => setOpen(null)} />}
        </>
    );
}

function InvoiceDialog({ data, invoice, onClose }: { data: AdminData; invoice: Invoice; onClose: () => void }) {
    const s = data.settings;
    const upcoming = invoice.id === "upcoming";
    return (
        <Dialog title={upcoming ? "Upcoming invoice" : `Invoice ${invoice.number}`} description={upcoming ? `Due ${longDate(invoice.issuedAt)}` : `${longDate(invoice.start)} to ${longDate(invoice.end)}`} onClose={onClose} width={520}>
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-[11.5px]">
                    <div>
                        <div className="font-medium">Billed to</div>
                        <div className="text-ink-muted">{s.invoiceDetails.company || data.team.name}</div>
                        {s.invoiceDetails.address && <div className="whitespace-pre-line text-ink-muted">{s.invoiceDetails.address}</div>}
                        {s.taxId && <div className="text-ink-muted">Tax ID {s.taxId}</div>}
                    </div>
                    <div>
                        <div className="font-medium">Plan</div>
                        <div className="text-ink-muted">
                            {invoice.plan}, billed {invoice.interval === "annual" ? "yearly" : "monthly"}
                        </div>
                    </div>
                </div>
                <div className="rounded-lg border border-panel-border">
                    {invoice.lines.map((l) => (
                        <div key={l.label} className="flex items-center gap-3 border-b border-panel-border px-3 py-2 last:border-b-0">
                            <span className="flex-1">{l.label}</span>
                            <span className="text-ink-muted tabular-nums">
                                {l.qty} × {money(l.unit, invoice.currency)}
                            </span>
                            <span className="w-24 text-right tabular-nums">{money(l.amount, invoice.currency)}</span>
                        </div>
                    ))}
                    {invoice.adjustments.map((a) => (
                        <div key={`${a.at}`} className="flex items-center gap-3 border-t border-panel-border px-3 py-2">
                            <span className="flex-1">
                                Adjustment: {a.label} on {shortDate(a.at)}
                            </span>
                            <span className="w-24 text-right tabular-nums">{money(a.amount, invoice.currency)}</span>
                        </div>
                    ))}
                    <div className="flex items-center gap-3 border-t border-panel-border bg-panel-hover/50 px-3 py-2 font-semibold">
                        <span className="flex-1">Total</span>
                        <span className="tabular-nums">{money(invoice.total, invoice.currency)}</span>
                    </div>
                </div>
                {s.invoiceDetails.note && <p className="text-[11.5px] text-ink-muted">{s.invoiceDetails.note}</p>}
            </div>
        </Dialog>
    );
}

export function PaymentNotice({ onClose }: { onClose: () => void }) {
    return (
        <Dialog title="Payment details" onClose={onClose}>
            <div className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-panel-hover text-ink-muted">
                    <CreditCard02 className="size-4.5" />
                </span>
                <p className="leading-[18px] text-ink-muted">This Nagma server doesn't take payments or store card details. Billing is handled outside the app by whoever runs it; the plan, seats and prices here are kept so statements match what you're billed.</p>
            </div>
        </Dialog>
    );
}

export function ManageSeatsDialog({ data, onClose }: { data: AdminData; onClose: () => void }) {
    const b = data.billing;
    const [count, setCount] = useState(String(b.seatsPurchased));
    const [error, setError] = useState<string | null>(null);
    const run = useRun(setError);
    const next = Math.max(b.assigned, Math.round(Number(count) || 0));
    const diff = next - b.seatsPurchased;
    const per = b.prices.full * (b.interval === "annual" ? 12 : 1);
    return (
        <Dialog
            title="Manage seats"
            description={`${b.assigned} paid ${b.assigned === 1 ? "seat is" : "seats are"} assigned. You can't go below that; change people's seats in People first.`}
            onClose={onClose}
            footer={
                <>
                    <Button onPress={onClose}>Cancel</Button>
                    <Button variant="primary" disabled={diff === 0} onPress={() => void run(() => adminAction(data.team.id, "billing", { seatsPurchased: next })).then((ok) => ok && onClose())}>
                        Save
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <FieldLabel label="Paid seats" hint={`View seats are free and don't count here. ${b.seats.view} ${b.seats.view === 1 ? "person has" : "people have"} one.`}>
                    <input type="number" min={b.assigned} value={count} onChange={(e) => setCount(e.target.value)} className={field} />
                </FieldLabel>
                <div className="rounded-md bg-panel-hover/60 px-3 py-2 text-[11.5px] text-ink-muted">
                    {diff === 0
                        ? "No change."
                        : diff > 0
                          ? `Adds ${diff} seat${diff === 1 ? "" : "s"}: ${money(diff * per, b.currency)} more each cycle, ${b.interval === "annual" ? "prorated and billed at renewal" : "prorated on the next statement"}.`
                          : b.interval === "annual"
                            ? `Removes ${-diff} available seat${diff === -1 ? "" : "s"} at renewal on ${longDate(b.renewsAt)}: annual seats stay paid for until then.`
                            : `Removes ${-diff} available seat${diff === -1 ? "" : "s"}: ${money(-diff * per, b.currency)} less each cycle.`}
                </div>
                <ErrorText>{error}</ErrorText>
            </div>
        </Dialog>
    );
}

// Plan name, billing cycle, renewal day and seat prices: set by admins to match how the team is billed.
export function PlanDialog({ data, onClose, focus }: { data: AdminData; onClose: () => void; focus?: "annual" }) {
    const b = data.billing;
    const [plan, setPlan] = useState(b.plan);
    const [interval, setCycle] = useState(focus === "annual" ? "annual" : b.interval);
    const [currency, setCurrency] = useState(b.currency);
    const [day, setDay] = useState(String(new Date(b.startedAt).getDate()));
    const [prices, setPrices] = useState<Record<Seat, string>>({ full: String(b.prices.full), dev: String(b.prices.dev), collab: String(b.prices.collab), view: String(b.prices.view) });
    const [error, setError] = useState<string | null>(null);
    const run = useRun(setError);
    const save = () =>
        void run(() =>
            adminAction(data.team.id, "billing", {
                plan,
                interval,
                currency,
                prices: Object.fromEntries(SEATS.map((s) => [s, Number(prices[s]) || 0])),
                ...(Number(day) !== new Date(b.startedAt).getDate() ? { renewalDay: Number(day) } : {}),
            }),
        ).then((ok) => ok && onClose());
    return (
        <Dialog
            title="Plans"
            description="Match the plan to how your team is billed. Statements use these prices."
            onClose={onClose}
            width={480}
            footer={
                <>
                    <Button onPress={onClose}>Cancel</Button>
                    <Button variant="primary" onPress={save}>
                        Save plan
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <FieldLabel label="Plan">
                        <Select aria-label="Plan" value={plan} onChange={(e) => setPlan(e.target.value)} className={field}>
                            <option value="Starter">Starter</option>
                            <option value="Professional">Professional</option>
                            <option value="Organization">Organization</option>
                            <option value="Enterprise">Enterprise</option>
                        </Select>
                    </FieldLabel>
                    <FieldLabel label="Billing cycle">
                        <Select aria-label="Billing cycle" value={interval} onChange={(e) => setCycle(e.target.value as "monthly" | "annual")} className={field}>
                            <option value="monthly">Monthly</option>
                            <option value="annual">Annual</option>
                        </Select>
                    </FieldLabel>
                    <FieldLabel label="Currency">
                        <Select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={field}>
                            {["USD", "EUR", "GBP", "INR", "JPY", "CAD", "AUD"].map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </Select>
                    </FieldLabel>
                    <FieldLabel label="Renewal day of the month">
                        <input type="number" min={1} max={28} value={day} onChange={(e) => setDay(e.target.value)} className={field} />
                    </FieldLabel>
                </div>
                <div>
                    <div className="mb-1.5 text-[11.5px] font-medium">Price per seat each month</div>
                    <div className="grid grid-cols-4 gap-2">
                        {SEATS.map((s) => (
                            <label key={s} className="space-y-1">
                                <span className="flex items-center gap-1 text-[11px] text-ink-muted">
                                    <SeatIcon seat={s} className="size-3" /> {SEAT_LABELS[s]}
                                </span>
                                <input type="number" min={0} step="0.01" aria-label={`${SEAT_LABELS[s]} seat price`} value={prices[s]} onChange={(e) => setPrices({ ...prices, [s]: e.target.value })} className={field} />
                            </label>
                        ))}
                    </div>
                </div>
                <ErrorText>{error}</ErrorText>
            </div>
        </Dialog>
    );
}

// Billing groups: people grouped for cost reporting (a department, a client), each with a manager.
// A person is in one group at most; the cost is what their seats add to each cycle.
function BillingGroups({ data }: { data: AdminData }) {
    const groups = data.billing.groups ?? [];
    const [editing, setEditing] = useState<BillingGroup | "new" | null>(null);
    const ungrouped = data.people.filter((p) => !groups.some((g) => g.members.includes(p.id)));
    const cols = "minmax(0,1fr) 160px 160px 120px";
    return (
        <div>
            <div className="mb-3 flex items-center">
                <p className="flex-1 text-[12px] text-ink-muted">Group people to see what their seats cost each {data.billing.interval === "annual" ? "year" : "month"}. Statements stay one per team.</p>
                <Button variant="primary" onPress={() => setEditing("new")}>
                    Create billing group
                </Button>
            </div>
            <TableHead cols={cols}>
                <span>Group</span>
                <span>People</span>
                <span>Manager</span>
                <span className="text-right">Cost per cycle</span>
            </TableHead>
            {groups.length === 0 && <EmptyState title="No billing groups yet">Everyone's seats are billed to the team as a whole.</EmptyState>}
            {groups.map((g) => (
                <TableRow key={g.id} cols={cols} onClick={() => setEditing(g)} label={`Edit ${g.name}`}>
                    <span className="truncate font-medium">{g.name}</span>
                    <span className="text-ink-muted">{g.members.length}</span>
                    <span className="truncate text-ink-muted">{data.people.find((p) => p.id === g.manager)?.name ?? "None"}</span>
                    <span className="text-right tabular-nums">{money(g.cost, data.billing.currency)}</span>
                </TableRow>
            ))}
            {groups.length > 0 && <p className="mt-3 text-[12px] text-ink-muted">{ungrouped.length} {ungrouped.length === 1 ? "person isn't" : "people aren't"} in a billing group.</p>}
            {editing && <BillingGroupDialog data={data} group={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
        </div>
    );
}

function BillingGroupDialog({ data, group, onClose }: { data: AdminData; group: BillingGroup | null; onClose: () => void }) {
    const [name, setName] = useState(group?.name ?? "");
    const [members, setMembers] = useState<string[]>(group?.members ?? []);
    const [manager, setManager] = useState(group?.manager ?? "");
    const [error, setError] = useState<string | null>(null);
    const run = useRun(setError);
    return (
        <Dialog
            title={group ? group.name : "Create billing group"}
            width={460}
            onClose={onClose}
            footer={
                <>
                    {group && (
                        <Button variant="danger" onPress={() => void run(() => adminAction(data.team.id, "billingGroup", { id: group.id, delete: true })).then((ok) => ok && onClose())}>
                            Delete
                        </Button>
                    )}
                    <div className="flex-1" />
                    <Button onPress={onClose}>Cancel</Button>
                    <Button variant="primary" disabled={!name.trim()} onPress={() => void run(() => adminAction(data.team.id, "billingGroup", { id: group?.id, name: name.trim(), members, manager: manager || null })).then((ok) => ok && onClose())}>
                        Save
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <FieldLabel label="Name">
                    <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
                </FieldLabel>
                <FieldLabel label="Manager" hint="Gets the group's cost on statements.">
                    <Select aria-label="Manager" value={manager} onChange={(e) => setManager(e.target.value)} className={field}>
                        <option value="">None</option>
                        {data.people.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                            </option>
                        ))}
                    </Select>
                </FieldLabel>
                <div>
                    <span className="mb-1.5 block text-[11.5px] font-medium">People</span>
                    <div className="max-h-44 space-y-1 overflow-y-auto">
                        {data.people.map((p) => {
                            const other = (data.billing.groups ?? []).find((g) => g.id !== group?.id && g.members.includes(p.id));
                            return (
                                <label key={p.id} className="flex items-center gap-2">
                                    <input type="checkbox" checked={members.includes(p.id)} onChange={() => setMembers(members.includes(p.id) ? members.filter((x) => x !== p.id) : [...members, p.id])} className="accent-brand-500" />
                                    {p.name} <span className="text-ink-muted">{SEAT_LABELS[p.seat]}</span>
                                    {other && <span className="text-[11px] text-ink-subtle">moves from {other.name}</span>}
                                </label>
                            );
                        })}
                    </div>
                </div>
                <ErrorText>{error}</ErrorText>
            </div>
        </Dialog>
    );
}

