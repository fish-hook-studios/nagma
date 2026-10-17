import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { registerCanvasPlugin } from "../canvas/canvas-plugins";
import { hitTest } from "../canvas/hit-test";
import { auth } from "../engine/auth";
import { worldToScreen } from "../engine/camera";
import { collab, roomListeners, sendMessage } from "../engine/collab";
import { editor, useEditor } from "../engine/store";
import { worldBounds } from "../engine/transform";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { myName } from "./actions";
import { board, useBoard } from "./state";
import { boardJam, boardJamCommand, setBoardJam } from "./timer";
import { reassert } from "../engine/reassert";
import type { JamData } from "./types";

// Voting sessions. Whoever starts one (the host) sets the votes each person has and, optionally,
// how long it runs. Everyone else gets an invitation to join or ignore it; joined, clicking an
// object stamps one of your votes on it (click your stamp again to take it back) until you're out
// of votes or say you're done. Votes stay private until the host ends the session for everyone
// (or its time runs out); then each object shows its total and the results list who voted for
// what. Votes are kept by person (account, or this browser for guests), with the name shown.
//
// In a shared file the votes aren't in the document while the session is open (everyone in the file
// could read them there): each ballot goes to the server, which keeps it until the session ends and
// then writes all of them into the document as the results. A board only in this browser keeps them
// in the document, as there's nobody else to hide them from.

export type Voting = NonNullable<Extract<JamData, { kind: "board" }>["voting"]>;

const LOCAL_KEY = "nagma.board.voter";

// Who you are for voting: your account (or the file's id for you), else this browser.
export function voterId(): string {
    const account = auth.get().user?.id;
    if (account) return account;
    const uid = collab.get().uid;
    if (uid) return uid;
    try {
        let id = localStorage.getItem(LOCAL_KEY);
        if (!id) {
            id = `l:${nanoid(12)}`;
            localStorage.setItem(LOCAL_KEY, id);
        }
        return id;
    } catch {
        return "l:local";
    }
}

export function voting(): Voting | null {
    return boardJam().voting ?? null;
}

// Ballots go to the server: the board is a shared file.
const viaServer = () => Boolean(collab.get().fileId);

// The ballot you want in each session, re-sent after a reconnect until the server has it.
const wanted = new Map<string, string[]>();

function sendBallot(session: string, votes: string[]) {
    wanted.set(session, votes);
    sendMessage({ type: "vote", session, votes });
}

roomListeners.add((m) => {
    if (m.type !== "ballot" && m.type !== "turnout") return;
    const session = typeof m.session === "string" ? m.session : null;
    if (!session) return;
    const before = board.get().ballot;
    const base = before?.session === session ? before : { session, votes: [], voted: 0 };
    if (m.type === "turnout") board.set({ ballot: { ...base, voted: Number(m.voted) || 0 } });
    else {
        const votes = Array.isArray(m.votes) ? m.votes.filter((x): x is string => typeof x === "string") : [];
        const want = wanted.get(session);
        // Just reconnected with a vote the server didn't get: send it again.
        if (want && want.join() !== votes.join() && !m.refused) sendMessage({ type: "vote", session, votes: want });
        else wanted.delete(session);
        board.set({ ballot: { ...base, votes: want && !m.refused ? want : votes, voted: typeof m.voted === "number" ? m.voted : base.voted } });
    }
    // The canvas redraws your stamps.
    collab.set({});
});

export function startVoting(limit = 3, prompt = "", minutes = 0) {
    const me = voterId();
    const id = nanoid(8);
    board.set({ ballot: null });
    setBoardJam({ voting: { id, open: true, limit, votes: {}, names: { [me]: myName() }, prompt: prompt.trim() || undefined, host: me, hostPeer: collab.get().myId, endsAt: minutes > 0 ? Date.now() + minutes * 60000 : null, done: [] } });
    board.set({ voteJoined: id, meetings: null });
    editor.notify(`Voting started: ${limit} vote${limit === 1 ? "" : "s"} each. Click objects to vote.`);
}

export function isHost(): boolean {
    const v = voting();
    return Boolean(v && (!v.host || v.host === voterId()));
}

// The host is in the file now (by their connection, or their account).
export function hostHere(v = voting()): boolean {
    if (!v) return false;
    if (isHost()) return true;
    const peers = Object.values(collab.get().peers);
    return Boolean((v.hostPeer && collab.get().peers[v.hostPeer]) || peers.some((p) => p.accountId && p.accountId === v.host));
}

// Who can end the session for everyone: the host, or anyone once the host has left (an untimed
// session otherwise stayed open for good, with nobody able to end or clear it).
export function canEndVoting(): boolean {
    return Boolean(voting()) && (isHost() || !hostHere());
}

// The session is taking votes (open, and its time hasn't run out).
export function votingOpen(v = voting()): boolean {
    return Boolean(v?.open && (!v.endsAt || Date.now() < v.endsAt));
}

// You're voting: joined this session, and not done yet.
export function amVoting(): boolean {
    const v = voting();
    return Boolean(v && votingOpen(v) && board.get().voteJoined === v.id && !v.done?.includes(voterId()));
}

export function joinVoting() {
    const v = voting();
    if (!v) return;
    board.set({ voteJoined: v.id, voteIgnored: null });
    // Taking part undoes an earlier "I'm done".
    if (v.done?.includes(voterId())) {
        setBoardJam({ voting: { ...v, done: v.done.filter((d) => d !== voterId()) } });
        keepMine(v.id, { done: false });
    }
}

export function ignoreVoting() {
    const v = voting();
    if (v) board.set({ voteIgnored: v.id });
}

export function imDone() {
    const v = voting();
    if (!v) return;
    const me = voterId();
    setBoardJam({ voting: { ...v, done: [...(v.done ?? []).filter((d) => d !== me), me], names: { ...v.names, [me]: myName() } } });
    keepMine(v.id, { done: true });
    editor.notify("Your votes are in. Results show when the host ends voting.");
}

// The results: each voted object with its total and who voted for it, most votes first.
export function results(): { id: string; count: number; voters: string[] }[] {
    const v = voting();
    const by = new Map<string, { count: number; voters: string[] }>();
    const doc = editor.get().doc;
    for (const [who, ids] of Object.entries(v?.votes ?? {})) {
        const name = v?.names?.[who] ?? who;
        for (const id of ids) {
            if (!doc.nodes[id]) continue;
            const r = by.get(id) ?? { count: 0, voters: [] };
            r.count++;
            if (!r.voters.includes(name)) r.voters.push(name);
            by.set(id, r);
        }
    }
    return [...by.entries()].map(([id, r]) => ({ id, ...r })).sort((a, b) => b.count - a.count);
}

export function endVoting() {
    const v = voting();
    if (v) setBoardJam({ voting: { ...v, open: false, endsAt: null } });
}

export function clearVoting() {
    setBoardJam({ voting: null });
}

// Your votes on objects that still exist (votes on deleted ones don't use one up).
export function myVotes(): string[] {
    const doc = editor.get().doc;
    const v = voting();
    const ballot = board.get().ballot;
    const mine = v?.open && viaServer() ? (ballot && ballot.session === v.id ? ballot.votes : []) : (v?.votes[voterId()] ?? []);
    return mine.filter((id) => doc.nodes[id]);
}

// How many people have voted, and how many said they're done.
export function turnout(): { voted: number; done: number } {
    const v = voting();
    const ballot = board.get().ballot;
    const voted = v?.open && viaServer() ? (ballot && ballot.session === v.id ? ballot.voted : 0) : Object.values(v?.votes ?? {}).filter((ids) => ids.length).length;
    return { voted, done: v?.done?.length ?? 0 };
}

export function toggleVote(id: string) {
    const v = voting();
    if (!v || !votingOpen(v)) return;
    const me = voterId();
    // Votes on objects deleted since don't use up a vote (and can't be clicked to take back).
    const doc = editor.get().doc;
    const mine = myVotes().filter((voted) => doc.nodes[voted]);
    let next: string[];
    if (mine.includes(id)) {
        const at = mine.lastIndexOf(id);
        next = mine.filter((_, i) => i !== at);
    } else if (mine.length >= v.limit) {
        editor.notify("You've used all your votes. Click one of your votes to take it back.");
        return;
    } else next = [...mine, id];
    if (viaServer() && v.id) {
        // Shown at once; the server keeps it hidden from everyone else until the end.
        const ballot = board.get().ballot;
        board.set({ ballot: { session: v.id, votes: next, voted: ballot?.session === v.id ? ballot.voted : 0 } });
        sendBallot(v.id, next);
        if (v.names?.[me] !== myName()) setBoardJam({ voting: { ...v, names: { ...v.names, [me]: myName() } } });
        collab.set({});
        return;
    }
    setBoardJam({ voting: { ...v, votes: { ...v.votes, [me]: next }, names: { ...v.names, [me]: myName() } } });
    keepMine(v.id, { votes: next });
}

// Your votes and "I'm done" stay in the session even when someone else's write lands on top of
// yours at the same moment (engine/reassert.ts).
const mine = new Map<string, { votes?: string[]; done?: boolean }>();
function keepMine(session: string | undefined, change: { votes?: string[]; done?: boolean }) {
    if (!session) return;
    const me = voterId();
    const want = { ...mine.get(session), ...change };
    mine.set(session, want);
    const sessionOf = (doc: NagmaDocument) => {
        const page = doc.nodes[doc.roots[0] ?? ""];
        const v = page?.jam?.kind === "board" ? page.jam.voting : null;
        return v && v.id === session ? v : null;
    };
    reassert(`board-vote:${session}`, {
        alive: (doc) => Boolean(sessionOf(doc)?.open),
        restore: (doc) => {
            const v = sessionOf(doc);
            if (!v || !votingOpen(v)) return null;
            const votesOk = !want.votes || (v.votes[me] ?? []).join() === want.votes.join();
            const doneOk = want.done === undefined || Boolean(v.done?.includes(me)) === want.done;
            if (votesOk && doneOk) return null;
            const done = (v.done ?? []).filter((d) => d !== me);
            return boardJamCommand(doc, () => ({
                voting: { ...v, votes: want.votes ? { ...v.votes, [me]: want.votes } : v.votes, done: want.done === undefined ? v.done : want.done ? [...done, me] : done, names: { ...v.names, [me]: myName() } },
            }));
        },
    });
}

function tally(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const ids of Object.values(voting()?.votes ?? {})) for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
}

// What a vote lands on: the object under the pointer (not the page, a section's background or a connector).
function votable(node: SceneNode | null): SceneNode | null {
    if (!node || node.type === "page" || node.isSection || node.jam?.kind === "connector" || node.jam?.kind === "stamp") return null;
    return node;
}

// When the host's time runs out, the host's board ends the session for everyone.
window.setInterval(() => {
    const v = voting();
    if (v?.open && v.endsAt && Date.now() >= v.endsAt && canEndVoting() && !editor.get().readOnly) endVoting();
}, 1000);

function stamp(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, label?: string) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.2)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.beginPath();
    ctx.arc(x, y, r - 2, 0, Math.PI * 2);
    ctx.fillStyle = "#9747FF";
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (label) {
        ctx.font = `700 ${Math.round(r)}px Inter, system-ui, sans-serif`;
        ctx.fillText(label, x, y + 0.5);
    } else {
        // A tick.
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(x - r * 0.35, y);
        ctx.lineTo(x - r * 0.08, y + r * 0.3);
        ctx.lineTo(x + r * 0.4, y - r * 0.3);
        ctx.stroke();
    }
    ctx.restore();
}

registerCanvasPlugin({
    name: "board-voting",
    down(p) {
        const s = editor.get();
        if (!s.doc.board || !amVoting() || s.tool !== "move" || board.get().tool || p.button !== 0) return false;
        const node = votable(hitTest(s.doc, p.world.x, p.world.y));
        if (!node) return false;
        toggleVote(node.id);
        return true;
    },
    hover(p) {
        const s = editor.get();
        if (!s.doc.board || !amVoting() || board.get().tool) return undefined;
        return votable(hitTest(s.doc, p.world.x, p.world.y)) ? "copy" : undefined;
    },
    overlay(ctx, camera) {
        const s = editor.get();
        const v = voting();
        if (!s.doc.board || !v) return;
        const open = votingOpen(v);
        if (open) {
            // Your own votes as stamps along the object's top edge; others' stay hidden until the end.
            const mine = myVotes();
            const seen = new Map<string, number>();
            for (const id of mine) {
                const node = s.doc.nodes[id];
                if (!node) continue;
                const i = seen.get(id) ?? 0;
                seen.set(id, i + 1);
                const box = worldBounds(s.doc, node);
                const at = worldToScreen(camera, box.x + box.w, box.y);
                stamp(ctx, at.x - 14 - i * 22, at.y + 14, 10);
            }
            return;
        }
        for (const [id, count] of tally()) {
            const node = s.doc.nodes[id];
            if (!node) continue;
            const box = worldBounds(s.doc, node);
            const at = worldToScreen(camera, box.x + box.w, box.y);
            stamp(ctx, at.x, at.y, 15, String(count));
        }
    },
});

// The session, for components (it ticks each second while a time limit counts down).
export function useVoting(): Voting | null {
    // Ticks each second so a session with a time limit shows its countdown and closes on time.
    const [, setTick] = useState(0);
    const v = useEditor((s) => {
        const page = s.doc.nodes[s.doc.roots[0] ?? ""];
        return page?.jam?.kind === "board" ? (page.jam.voting ?? null) : null;
    });
    useBoard((s) => s.voteJoined);
    useBoard((s) => s.ballot);
    useEffect(() => {
        if (!v?.endsAt) return;
        const t = window.setInterval(() => setTick((n) => n + 1), 1000);
        return () => window.clearInterval(t);
    }, [v?.endsAt]);
    return v;
}

