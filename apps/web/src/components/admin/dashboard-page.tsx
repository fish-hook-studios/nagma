import { CheckCircle, Eye, SlashCircle01, User01, XClose } from "@untitledui/icons";
import { useState } from "react";
import { type AdminData, type AdminRequest, adminAction, SEAT_LABELS, shortDate, relative, useRun } from "../../engine/admin";
import { Avatar } from "../avatar";
import type { AdminPage } from "./admin-console";
import { DashedCircleIcon } from "./admin-icons";
import { Button, Card, CountBadge, ErrorText, LinkButton } from "./admin-ui";
import { ManageSeatsDialog } from "./billing-page";

const REQUEST_TEXT: Record<AdminRequest["kind"], (r: AdminRequest) => string> = {
    seat: (r) => `asked for a ${SEAT_LABELS[r.seat]} seat`,
    credits: () => "asked for more AI credits",
    access: () => "asked for access",
};

export function DashboardPage({ data, go, onExit }: { data: AdminData; go: (p: AdminPage) => void; onExit: () => void }) {
    const [seatsOpen, setSeatsOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const run = useRun(setError);
    const pending = data.requests.filter((r) => r.status === "pending");
    const b = data.billing;
    const using = data.ai.using;
    const outOf = data.ai.atLimit;
    return (
        <div className="px-[32px] pb-12">
            <div className="mt-[8px] mb-[24px] flex h-[32px] items-center gap-[16px]">
                <span className="flex size-[32px] shrink-0 items-center justify-center rounded-full bg-[#0d6ec4] text-[19px] text-white">{data.team.name.slice(0, 1).toUpperCase()}</span>
                <h1 className="truncate text-[24px] font-semibold tracking-[-0.01em]">{data.team.name} admin</h1>
            </div>
            <div className="grid grid-cols-1 items-start gap-[24px] lg:grid-cols-[minmax(0,1fr)_347px]">
                <Card className="flex min-h-[178px] flex-col" title={<>Requests <CountBadge>{pending.length}</CountBadge></>}>
                    {pending.length === 0 ? (
                        <div className="mx-[9px] mb-[9px] -mt-[1px] flex min-h-[77px] flex-1 flex-col items-center justify-center gap-[7px] rounded-[6px] border border-dashed border-card-border text-center text-[12px]">
                            <div>You're all caught up!</div>
                            <LinkButton onPress={onExit}>Back to files</LinkButton>
                        </div>
                    ) : (
                        <ul className="divide-y divide-rule border-t border-rule">
                            {pending.map((r) => (
                                <li key={r.id} className="flex items-center gap-3 px-[17px] py-3 text-[12px]">
                                    <Avatar name={r.user?.name ?? "Someone"} color={r.user?.color ?? "#888888"} size={24} single />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate">
                                            <span className="font-medium">{r.user?.name ?? "Someone"}</span> {REQUEST_TEXT[r.kind](r)}
                                        </div>
                                        <div className="truncate text-ink-muted">
                                            {relative(r.at)}
                                            {r.note && <> · "{r.note}"</>}
                                        </div>
                                    </div>
                                    <Button variant="ghost" onPress={() => void run(() => adminAction(data.team.id, "decide", { id: r.id, approve: false }))}>
                                        <XClose className="size-3.5" /> Deny
                                    </Button>
                                    <Button variant="primary" onPress={() => void run(() => adminAction(data.team.id, "decide", { id: r.id, approve: true }))}>
                                        <CheckCircle className="size-3.5" /> Approve
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {error && (
                        <div className="px-[17px] pb-3">
                            <ErrorText>{error}</ErrorText>
                        </div>
                    )}
                </Card>
                <div className="space-y-[24px]">
                    <Card title={<>Total seats <CountBadge>{b.seatsPurchased + b.seats.view}</CountBadge></>} action={<Button onPress={() => setSeatsOpen(true)}>Manage</Button>}>
                        <ul className="-mt-[8px] pr-[16px] pb-[8px] pl-[20px] text-[13px]">
                            <StatRow icon={<CheckCircle className="size-4" />} label="Assigned seats" value={b.assigned} />
                            <StatRow icon={<DashedCircleIcon className="size-4" />} label="Available seats" value={b.available} />
                            <StatRow icon={<Eye className="size-4" />} label="View seats (free)" value={b.seats.view} />
                        </ul>
                    </Card>
                    <Card title="AI credit usage" action={<Button onPress={() => go("ai")}>View</Button>}>
                        <ul className="-mt-[8px] pr-[16px] pb-[4px] pl-[20px] text-[13px]">
                            <li className="flex h-[40px] items-center gap-[12px]">
                                <User01 className="size-4 text-ink-muted" />
                                {using} {using === 1 ? "person" : "people"} using AI credits
                            </li>
                            <li className="flex h-[40px] items-center gap-[12px]">
                                <SlashCircle01 className="size-4 text-ink-muted" />
                                {outOf} {outOf === 1 ? "person" : "people"} out of seat credits
                            </li>
                        </ul>
                        <div className="flex h-[40px] items-center gap-[5px] border-t border-rule px-[16px] text-[12px] text-ink-muted">
                            Reset: <span className="text-ink underline decoration-dashed decoration-ink-subtle underline-offset-[3px]">{shortDate(data.ai.resetAt)}</span>
                        </div>
                    </Card>
                </div>
            </div>
            {seatsOpen && <ManageSeatsDialog data={data} onClose={() => setSeatsOpen(false)} />}
        </div>
    );
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
    return (
        <li className="flex h-[40px] items-center gap-[12px]">
            <span className="text-ink-muted">{icon}</span>
            <span className="flex-1">{label}</span>
            <span className="tabular-nums">{value}</span>
        </li>
    );
}
