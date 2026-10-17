import { Minus, Plus } from "@untitledui/icons";
import { useState } from "react";
import { useEditor } from "../engine/store";
import { board, useBoard } from "./state";
import { amVoting, canEndVoting, clearVoting, useVoting, endVoting, ignoreVoting, imDone, isHost, joinVoting, myVotes, results, startVoting, turnout, votingOpen } from "./voting";
import type { Voting } from "./voting";

// Voting on screen: the voting card in the Timer, music, and voting panel (setup, the running vote
// with I'm done and End for all confirmed inline, the results), the pill showing the vote while it
// runs (meetings.tsx), and the invitation others get to join or ignore it.

function timeLeft(v: Voting): string | null {
    if (!v.endsAt) return null;
    const s = Math.max(0, Math.ceil((v.endsAt - Date.now()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const DURATIONS = [0, 1, 3, 5, 10];

function VoteArt() {
    return (
        <div className="flex h-[97px] w-full items-center justify-center overflow-hidden rounded-lg bg-[#F5F5F5]" aria-hidden="true">
            <svg width="190" height="96" viewBox="0 0 190 96">
                <path d="M30 30 Q34 14 52 18 L104 22 Q112 24 110 34 L104 96 L22 96 Q18 60 30 30 Z" fill="#FFE07A" />
                <path d="M30 30 Q46 40 56 26" fill="none" stroke="#E8C24E" strokeWidth="1.5" />
                <path d="M150 20 C142 8 124 14 132 30 L146 44 L160 30 C168 14 150 8 150 20 Z" fill="#F07C7C" stroke="#fff" strokeWidth="2" />
                <text x="112" y="70" fontSize="30" fontWeight="800" fill="#9747FF" stroke="#fff" strokeWidth="1.5" fontStyle="italic">+1</text>
                <path d="M150 86 L150 66 Q150 58 158 60 L162 66 L172 66 Q178 68 176 74 L172 86 Z" fill="#2F9E44" stroke="#fff" strokeWidth="2" />
            </svg>
        </div>
    );
}

// The voting card at the bottom of the timer, music, and voting panel: set up a vote (a title,
// votes per person, an optional time limit, Start), follow it while it runs (votes are stamps; I'm
// done; End for all, confirmed inline), then the results.
export function VotingCard({ focus }: { focus?: boolean }) {
    const v = useVoting();
    const nodes = useEditor((s) => s.doc.nodes);
    const confirming = useBoard((s) => s.voteEndConfirm);
    const [prompt, setPrompt] = useState("");
    const [limit, setLimit] = useState(3);
    const [minutes, setMinutes] = useState(0);
    // The card starts as the picture and New vote; New vote (or opening the panel for voting) shows
    // the setup.
    const [setup, setSetup] = useState(Boolean(focus));
    const btn = "h-8 rounded-[5px] text-[13px]";
    if (v && votingOpen(v)) {
        if (confirming) {
            return (
                <div className="space-y-3 pt-2 text-[12px]" role="alertdialog" aria-label="End voting">
                    <p className="text-[12px] font-semibold">Is everyone done?</p>
                    <p className="leading-[18px]">This will end the voting session for everyone. Results will be tallied up and revealed right away.</p>
                    <div className="flex gap-2 pt-2">
                        <button type="button" onClick={() => board.set({ voteEndConfirm: false })} className={`${btn} flex-1 border border-black/15 hover:bg-black/5`}>Go back</button>
                        <button type="button" autoFocus onClick={() => { endVoting(); board.set({ voteEndConfirm: false, meetings: "voting" }); }} className={`${btn} flex-1 bg-[#9747FF] text-white hover:bg-[#8638E5]`}>End vote</button>
                    </div>
                </div>
            );
        }
        const left = v.limit - myVotes().length;
        const { voted, done } = turnout();
        const joined = board.get().voteJoined === v.id;
        return (
            <div className="space-y-3 pt-2 text-[12px]">
                <p className="text-[13px] font-semibold">{v.prompt || `Stamp your ${v.limit} favorite${v.limit === 1 ? "" : "s"}`}</p>
                <p className="px-2 text-black/50">{voted ? `${voted} voted · ${done} done` : "No one’s voted"}{timeLeft(v) ? ` · ${timeLeft(v)} left` : ""}</p>
                {joined && amVoting() && (
                    <div className="flex items-center justify-between rounded-[5px] bg-[#F5F5F5] px-2 py-1.5">
                        <span>{left} of {v.limit} vote{v.limit === 1 ? "" : "s"} left</span>
                        <button type="button" onClick={imDone} className="h-6 rounded-[5px] px-2 font-medium text-[#7C3AED] hover:bg-black/5">I’m done</button>
                    </div>
                )}
                {joined && !amVoting() && <p className="px-2 text-black/50">You’re done.</p>}
                {!joined && <button type="button" onClick={joinVoting} className={`${btn} w-full bg-[#9747FF] text-white hover:bg-[#8638E5]`}>Join voting</button>}
                {canEndVoting() && <button type="button" onClick={() => board.set({ voteEndConfirm: true })} className={`${btn} mt-6 w-full border border-black/15 hover:bg-black/5`}>End for all</button>}
            </div>
        );
    }
    if (v) {
        const rows = results();
        const total = rows.reduce((a, r) => a + r.count, 0);
        return (
            <div className="space-y-3 text-[12px]">
                <p className="text-[13px] font-semibold">Results{v.prompt ? `: ${v.prompt}` : ""}</p>
                <p className="text-black/50">{total ? `${total} vote${total === 1 ? "" : "s"} from ${turnout().voted} ${turnout().voted === 1 ? "person" : "people"}` : "No one voted"}</p>
                {rows.length > 0 && (
                    <ol className="max-h-56 space-y-1.5 overflow-y-auto">
                        {rows.map((r, i) => (
                            <li key={r.id} className="flex items-start gap-2">
                                <span className="w-4 pt-1 text-right text-[11px] text-black/40">{i + 1}</span>
                                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#9747FF] text-[11px] font-bold text-white">{r.count}</span>
                                <span className="min-w-0">
                                    <span className="block truncate font-medium">{nodes[r.id]?.text || nodes[r.id]?.name || "Deleted object"}</span>
                                    <span className="block truncate text-black/50">{r.voters.join(", ")}</span>
                                </span>
                            </li>
                        ))}
                    </ol>
                )}
                <button type="button" onClick={clearVoting} className={`${btn} w-full border border-black/15 hover:bg-black/5`}>Delete results</button>
            </div>
        );
    }
    if (!setup && !focus) {
        return (
            <div className="flex flex-col items-center gap-[15px]">
                <VoteArt />
                <button type="button" onClick={() => setSetup(true)} className="h-6 rounded-[5px] bg-[#9747FF] px-2 text-[11px] text-white hover:bg-[#8638E5]">New vote</button>
            </div>
        );
    }
    return (
        <form
            className="space-y-4 text-[12px]"
            onSubmit={(e) => {
                e.preventDefault();
                startVoting(limit, prompt, minutes);
                board.set({ meetings: "voting" });
                setPrompt("");
            }}
        >
            <VoteArt />
            <input aria-label="Voting prompt" autoFocus={focus} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={`Stamp your ${limit} favorite${limit === 1 ? "" : "s"}`} className="h-8 w-full rounded-[5px] bg-[#F5F5F5] px-2 text-[12px] outline-none placeholder:text-black/40 focus:ring-2 focus:ring-[#9747FF]" />
            <div className="flex items-center gap-2">
                <button type="button" aria-label="Fewer votes" disabled={limit <= 1} onClick={() => setLimit(limit - 1)} className="flex size-6 items-center justify-center rounded-[5px] hover:bg-black/5 disabled:opacity-30"><Minus className="size-4" /></button>
                <span className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-[#F5F5F5] tabular-nums">{limit}</span>
                <button type="button" aria-label="More votes" disabled={limit >= 99} onClick={() => setLimit(limit + 1)} className="flex size-6 items-center justify-center rounded-[5px] hover:bg-black/5 disabled:opacity-30"><Plus className="size-4" /></button>
                <button type="submit" className="ml-auto h-8 w-[104px] rounded-[5px] bg-[#9747FF] text-[13px] text-white hover:bg-[#8638E5]">Start</button>
            </div>
            <label className="flex items-center justify-between text-black/50">
                Time limit
                <select aria-label="Time limit" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="rounded-[5px] bg-transparent text-[11px] text-[#1E1E1E] outline-none">
                    {DURATIONS.map((m) => <option key={m} value={m}>{m ? `${m} min` : "None"}</option>)}
                </select>
            </label>
        </form>
    );
}

// The invitation to a session someone else started.
export function VotingInvite() {
    const v = useVoting();
    const ignored = useBoard((s) => s.voteIgnored);
    const joined = useBoard((s) => s.voteJoined);
    if (!v || !votingOpen(v) || !v.id || joined === v.id || ignored === v.id || isHost()) return null;
    const host = (v.host && v.names?.[v.host]) || "Someone";
    return (
        <div role="alertdialog" aria-label="Voting invitation" className="pointer-events-auto w-72 rounded-xl bg-[#1E1E1E] p-3 text-[12px] text-white shadow-xl">
            <p className="font-semibold">{host} started a voting session</p>
            <p className="mt-0.5 text-white/70">{v.prompt || "Vote on objects in this board"} · {v.limit} vote{v.limit === 1 ? "" : "s"} each</p>
            <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={ignoreVoting} className="h-7 rounded-md px-3 hover:bg-white/10">Ignore</button>
                <button type="button" onClick={joinVoting} className="h-7 rounded-md bg-[#9747FF] px-3 font-semibold hover:bg-[#8638E5]">Join</button>
            </div>
        </div>
    );
}
