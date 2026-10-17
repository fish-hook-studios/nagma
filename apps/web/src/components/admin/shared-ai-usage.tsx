import { useEffect, useState } from "react";
import { type SharedUsage, loadSharedUsage, roughTokens } from "../../engine/ai-settings";
import { Card } from "./admin-ui";

// The AI page's shared key section: whether the server has one (ANTHROPIC_API_KEY, turned off with
// NAGMA_SHARED_AI=0), and how much the team's members used it today and over two weeks. People with
// their own key (Account settings › AI) don't use it.
export function SharedAiUsage({ teamId }: { teamId: string }) {
    const [usage, setUsage] = useState<SharedUsage | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        let live = true;
        loadSharedUsage(teamId).then(
            (u) => live && setUsage(u),
            (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
        );
        return () => {
            live = false;
        };
    }, [teamId]);
    if (error) return null;
    if (!usage) return null;
    const today = usage.days.at(-1) ?? { requests: 0, tokens: 0 };
    const total = usage.days.reduce((n, d) => ({ requests: n.requests + d.requests, tokens: n.tokens + d.tokens }), { requests: 0, tokens: 0 });
    const peak = Math.max(1, ...usage.days.map((d) => d.requests));
    return (
        <section aria-label="Shared AI key" className="mb-[24px]">
            <h2 className="mb-[8px] text-[13px] leading-[30px] font-semibold">Shared AI key</h2>
            <p className="mb-[12px] text-[12px] text-ink-muted">
                {usage.enabled
                    ? `This server has a shared ${usage.model ?? "Claude"} key. People without a key of their own use it; everyone can add their own in Account settings › AI.`
                    : usage.configured
                      ? "The server's shared key is turned off, so everyone uses their own key from Account settings › AI."
                      : "This server has no shared key, so everyone uses their own key from Account settings › AI."}
            </p>
            {(usage.enabled || total.requests > 0) && (
                <Card>
                    <div className="flex flex-wrap items-end gap-[32px] px-[16px] py-[14px]">
                        <div>
                            <div className="text-[12px] text-ink-muted">Today</div>
                            <div className="text-[20px] font-medium tabular-nums">
                                {today.requests} request{today.requests === 1 ? "" : "s"}, ~{roughTokens(today.tokens)} tokens
                            </div>
                        </div>
                        <div>
                            <div className="text-[12px] text-ink-muted">Last 14 days</div>
                            <div className="text-[20px] font-medium tabular-nums">
                                {total.requests} requests, ~{roughTokens(total.tokens)} tokens
                            </div>
                        </div>
                        <div className="flex h-[36px] flex-1 items-end gap-[3px]" aria-hidden>
                            {usage.days.map((d) => (
                                <span key={d.day} title={`${d.day}: ${d.requests} requests`} className="w-[10px] rounded-t-[2px] bg-brand-500" style={{ height: `${Math.max(2, (d.requests / peak) * 36)}px`, opacity: d.requests ? 1 : 0.25 }} />
                            ))}
                        </div>
                    </div>
                    {usage.people.length > 0 && (
                        <div className="border-t border-panel-border px-[16px] py-[10px] text-[12px]">
                            <div className="mb-[4px] text-ink-muted">Today by person</div>
                            {usage.people.map((p) => (
                                <div key={p.id} className="flex justify-between py-[2px]">
                                    <span>{p.name}</span>
                                    <span className="tabular-nums text-ink-muted">
                                        {p.requests} requests, ~{roughTokens(p.tokens)} tokens
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            )}
        </section>
    );
}
