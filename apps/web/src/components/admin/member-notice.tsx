import { Lock01 } from "@untitledui/icons";
import { useState } from "react";
import { type MemberData, type Seat, adminAction, relative, SEAT_LABELS, SEATS, shortDate, useRun, SEAT_HINTS } from "../../engine/admin";
import { Select } from "../select";
import { Button, Card, ErrorText, field, FieldLabel, LinkButton, ProgressBar, SeatLabel } from "./admin-ui";

// What someone who isn't a team admin sees in the console: who the admins are, their own seat and
// AI credits, and a way to ask for a different seat, more credits or access.
export function MemberNotice({ data, onExit }: { data: MemberData; onExit: () => void }) {
    const [kind, setKind] = useState<"seat" | "credits" | "access">("seat");
    const [seat, setSeat] = useState<Seat>("full");
    const [note, setNote] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);
    const run = useRun(setError);
    const pending = data.requests.filter((r) => r.status === "pending");
    return (
        <div className="mx-auto max-w-[560px] px-4 pt-6 pb-12">
            <div className="mb-6 flex flex-col items-center text-center">
                <span className="flex size-11 items-center justify-center rounded-xl bg-panel-hover text-ink-muted">
                    <Lock01 className="size-5" />
                </span>
                <h1 className="mt-3 text-[20px] font-semibold">Only admins can manage {data.team.name}</h1>
                <p className="mt-1.5 text-[12.5px] text-ink-muted">
                    Ask {data.admins.length ? data.admins.map((a) => a.name).join(", ") : "an admin"} to change seats, billing or settings. You can send them a request below.
                </p>
                <LinkButton className="mt-2 text-[12px]" onPress={onExit}>
                    Back to files
                </LinkButton>
            </div>
            <Card title="Your seat" className="mb-4">
                <div className="space-y-3 px-4 pt-1 pb-4 text-[12px]">
                    <div className="flex items-center gap-2">
                        <SeatLabel seat={data.seat} />
                        <span className="text-ink-muted">· {SEAT_HINTS[data.seat]}</span>
                    </div>
                    <div>
                        <div className="mb-1 flex justify-between text-ink-muted">
                            <span>AI credits used</span>
                            <span className="tabular-nums">
                                {data.aiUsed} / {data.aiAllowance} · resets {shortDate(data.resetAt)}
                            </span>
                        </div>
                        <ProgressBar value={data.aiUsed} max={data.aiAllowance} />
                    </div>
                </div>
            </Card>
            <Card title="Send a request">
                <div className="space-y-3 px-4 pt-1 pb-4 text-[12px]">
                    <div className="grid grid-cols-2 gap-3">
                        <FieldLabel label="I'd like">
                            <Select aria-label="Request" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={field}>
                                <option value="seat">A different seat</option>
                                <option value="credits">More AI credits</option>
                                <option value="access">Access to a folder</option>
                            </Select>
                        </FieldLabel>
                        {kind === "seat" && (
                            <FieldLabel label="Seat">
                                <Select aria-label="Seat" value={seat} onChange={(e) => setSeat(e.target.value as Seat)} className={field}>
                                    {SEATS.map((s) => (
                                        <option key={s} value={s}>
                                            {SEAT_LABELS[s]}
                                        </option>
                                    ))}
                                </Select>
                            </FieldLabel>
                        )}
                    </div>
                    <FieldLabel label="Note for the admins">
                        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you need it for" className={field} />
                    </FieldLabel>
                    <div className="flex items-center gap-3">
                        <Button
                            variant="primary"
                            onPress={() =>
                                void run(() => adminAction(data.team.id, "requests", { kind, seat, note })).then((ok) => {
                                    if (!ok) return;
                                    setSent(true);
                                    setNote("");
                                })
                            }
                        >
                            Send request
                        </Button>
                        {sent && <span className="text-ink-muted">Sent. Admins see it on their Dashboard.</span>}
                    </div>
                    <ErrorText>{error}</ErrorText>
                    {data.requests.length > 0 && (
                        <ul className="space-y-1 border-t border-panel-border pt-3">
                            {data.requests
                                .slice()
                                .reverse()
                                .map((r) => (
                                    <li key={r.id} className="flex justify-between text-ink-muted">
                                        <span>{r.kind === "seat" ? `${SEAT_LABELS[r.seat]} seat` : r.kind === "credits" ? "More AI credits" : "Access"}</span>
                                        <span>
                                            {r.status === "pending" ? "Waiting" : r.status === "approved" ? "Approved" : "Denied"} · {relative(r.at)}
                                        </span>
                                    </li>
                                ))}
                        </ul>
                    )}
                    {pending.length > 0 && <p className="text-ink-muted">You have a request waiting for an admin.</p>}
                </div>
            </Card>
        </div>
    );
}
