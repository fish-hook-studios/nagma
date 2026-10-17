import { ArrowDown } from "@untitledui/icons";
import { useMemo, useState } from "react";
import { type AdminData, type Seat, adminAction, daysUntil, longDate, relative, SEAT_LABELS, SEATS, useRun, money } from "../../engine/admin";
import { Button, Card, Dialog, EmptyState, ErrorText, field, FieldLabel, FilterMenu, PageBody, PageTitle, ProgressBar, SeatIcon, SearchField, TableHead, TableRow } from "./admin-ui";
import { PersonName } from "./people-page";
import { SharedAiUsage } from "./shared-ai-usage";

const COLS = "minmax(0,502fr) minmax(0,366fr) minmax(0,294fr) minmax(0,494fr)";

// AI credits: one credit for each request to the agent, counted per person and reset each month.
export function AiCreditsPage({ data }: { data: AdminData }) {
    const [query, setQuery] = useState("");
    const [seat, setSeat] = useState<Seat | "all">("all");
    const [adding, setAdding] = useState(false);
    const ai = data.ai;
    const using = ai.using;
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return data.people
            .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
            .filter((p) => seat === "all" || p.seat === seat)
            .sort((a, b) => b.aiUsed - a.aiUsed || a.name.localeCompare(b.name));
    }, [data.people, query, seat]);
    return (
        <>
            <PageTitle
                extra={
                    <Button variant="primary" onPress={() => setAdding(true)}>
                        Add credits
                    </Button>
                }
            >
                AI credits
            </PageTitle>
            <PageBody>
                <SharedAiUsage teamId={data.team.id} />
                <h2 className="mb-[15px] text-[13px] leading-[30px] font-semibold">
                    Credit usage from {longDate(ai.periodStart)} to {longDate(ai.resetAt)}
                </h2>
                <div className="mb-[17px] grid grid-cols-1 gap-[24px] md:grid-cols-3">
                    <Stat label="People using AI credits" value={String(using)} hint="Credits are included with each seat" />
                    <Stat
                        label={
                            <>
                                People at <Dotted>seat credit limit</Dotted>
                            </>
                        }
                        value={`${ai.atLimit} / ${using}`}
                        muted={ai.atLimit === 0}
                        hint="Seat credits reset each month"
                    />
                    <Stat
                        label="Days until credit reset"
                        value={String(daysUntil(ai.resetAt))}
                        hint={
                            <>
                                Reset: <Dotted>{longDate(ai.resetAt).replace(/,? \d{4}$/, "")}</Dotted>
                            </>
                        }
                    />
                </div>
                <p className="mb-[17px] text-[12px] text-ink-muted">
                    Beyond seat credits: {ai.sources.overage.toLocaleString()} used this month, {ai.sources.fromPool.toLocaleString()} from team credits ({ai.sources.pool.toLocaleString()} a month)
                    {ai.sources.payg.enabled ? `, ${ai.sources.payg.used.toLocaleString()} pay as you go (${money(ai.sources.payg.cost, data.billing.currency)} of a ${ai.sources.payg.budget.toLocaleString()} credit budget)` : ", pay as you go off"}
                    {ai.daily ? `. Daily limit: ${ai.daily} per person.` : "."}
                </p>
                <div className="mb-[17px] flex flex-wrap items-center gap-2">
                    <SearchField value={query} onChange={setQuery} placeholder="Search people..." />
                    <div className="flex-1" />
                    <FilterMenu bare label="Seat type" value={seat} onChange={setSeat} options={[["all", "All seat types"], ...SEATS.map((s): [Seat, string] => [s, SEAT_LABELS[s]])]} />
                </div>
                <div>
                    <TableHead cols={COLS} inset="px-0">
                        <span>Name</span>
                        <span>Seat type</span>
                        <span className="inline-flex items-center gap-[6px]">
                            Seat credits <ArrowDown className="size-3.5" />
                        </span>
                        <span>Last activity</span>
                    </TableHead>
                    {shown.length === 0 && <EmptyState title="No one matches">Try a different search or seat type.</EmptyState>}
                    {shown.map((p) => (
                        <TableRow key={p.id} cols={COLS} inset="px-0">
                            <PersonName person={p} me={data.me} />
                            <span>{SEAT_LABELS[p.seat]}</span>
                            <div className="w-[96px]" title={`${p.aiUsed} / ${p.aiAllowance} used`}>
                                <ProgressBar value={p.aiUsed} max={p.aiAllowance} />
                            </div>
                            <span>{relative(p.lastActive)}</span>
                        </TableRow>
                    ))}
                </div>
            </PageBody>
            {adding && <AddCreditsDialog data={data} onClose={() => setAdding(false)} />}
        </>
    );
}

// Text with a dotted underline: a term that has more to it.
function Dotted({ children }: { children: React.ReactNode }) {
    return <span className="underline decoration-dotted decoration-ink-muted underline-offset-[3px]">{children}</span>;
}

function Stat({ label, value, hint, muted }: { label: React.ReactNode; value: string; hint?: React.ReactNode; muted?: boolean }) {
    return (
        <Card>
            <div className="flex h-[116px] flex-col px-[16px] pt-[17px]">
                <div className="text-[13px] leading-[20px]">{label}</div>
                <div className={`mt-[15px] text-[24px] leading-[28px] font-medium tabular-nums ${muted ? "text-ink-muted" : ""}`}>{value}</div>
                {hint && <div className="mt-[13px] text-[12px] text-ink-muted">{hint}</div>}
            </div>
        </Card>
    );
}

export function AddCreditsDialog({ data, onClose }: { data: AdminData; onClose: () => void }) {
    const [allowance, setAllowance] = useState<Record<Seat, string>>(() => Object.fromEntries(SEATS.map((s) => [s, String(data.ai.allowance[s])])) as Record<Seat, string>);
    const [extra, setExtra] = useState(String(data.ai.extraCredits));
    const [pool, setPool] = useState(String(data.ai.pool));
    const [daily, setDaily] = useState(String(data.ai.daily));
    const [payg, setPayg] = useState(data.ai.sources.payg.enabled);
    const [budget, setBudget] = useState(String(data.ai.sources.payg.budget));
    const [error, setError] = useState<string | null>(null);
    const run = useRun(setError);
    return (
        <Dialog
            title="Add credits"
            description="Each seat's monthly credits, the team's monthly credit subscription, a pay-as-you-go budget for when those run out, and a daily limit per person. One request to the agent uses one credit."
            onClose={onClose}
            width={460}
            footer={
                <>
                    <Button onPress={onClose}>Cancel</Button>
                    <Button
                        variant="primary"
                        onPress={() => void run(() => adminAction(data.team.id, "ai", { allowance: Object.fromEntries(SEATS.map((s) => [s, Number(allowance[s]) || 0])), extraCredits: Number(extra) || 0, pool: Number(pool) || 0, daily: Number(daily) || 0, payg: { enabled: payg, budget: Number(budget) || 0, price: data.ai.sources.payg.price } })).then((ok) => ok && onClose())}
                    >
                        Save
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                    {SEATS.map((s) => (
                        <label key={s} className="space-y-1">
                            <span className="flex items-center gap-1 text-[11px] text-ink-muted">
                                <SeatIcon seat={s} className="size-3" /> {SEAT_LABELS[s]}
                            </span>
                            <input type="number" min={0} aria-label={`${SEAT_LABELS[s]} seat credits`} value={allowance[s]} onChange={(e) => setAllowance({ ...allowance, [s]: e.target.value })} className={field} />
                        </label>
                    ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <FieldLabel label="Credit subscription" hint="Team credits each month.">
                        <input type="number" min={0} value={pool} onChange={(e) => setPool(e.target.value)} className={field} />
                    </FieldLabel>
                    <FieldLabel label="Extra credits" hint="Bought on top, each month.">
                        <input type="number" min={0} value={extra} onChange={(e) => setExtra(e.target.value)} className={field} />
                    </FieldLabel>
                </div>
                <label className="flex items-center gap-2">
                    <input type="checkbox" checked={payg} onChange={(e) => setPayg(e.target.checked)} className="accent-brand-500" />
                    Pay as you go once seat and team credits run out
                </label>
                {payg && (
                    <FieldLabel label="Monthly pay-as-you-go budget (credits)" hint={`Recorded at ${money(data.ai.sources.payg.price, data.billing.currency)} a credit on the next statement.`}>
                        <input type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} className={field} />
                    </FieldLabel>
                )}
                <FieldLabel label="Daily limit per person" hint="0 for no limit.">
                    <input type="number" min={0} value={daily} onChange={(e) => setDaily(e.target.value)} className={field} />
                </FieldLabel>
                <ErrorText>{error}</ErrorText>
            </div>
        </Dialog>
    );
}
