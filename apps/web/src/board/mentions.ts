import { nanoid } from "nanoid";
import type { Person } from "../engine/comments";
import { myUid } from "../engine/comments";
import { useCollab } from "../engine/collab";
import { usePeople } from "../engine/people";
import { editor } from "../engine/store";
import type { SceneNode, TextSpan } from "../engine/types";
import { myName } from "./actions";
import { boardJam, setBoardJam } from "./timer";
import { userStorage } from "../engine/user-storage";

// @mentions in stickies, shapes and text on a board: picking someone while typing writes "@Name"
// and notes the mention on the board, so the person mentioned is told (now if they're here, or the
// next time they open the board). Mentions show in bold blue.

export interface BoardMention {
    id: string;
    // The person mentioned (their id and name), who mentioned them, in which object, and when.
    to: string;
    name: string;
    by: string;
    node: string;
    at: number;
}

const KEEP = 100;

export function recordMention(nodeId: string, person: Person) {
    const list = boardJam().mentions ?? [];
    const mention: BoardMention = { id: nanoid(8), to: person.uid, name: person.name, by: myName(), node: nodeId, at: Date.now() };
    setBoardJam({ mentions: [...list, mention].slice(-KEEP) });
}

// Bold blue ranges for the mentions written in a layer's text.
export function mentionSpans(node: SceneNode): TextSpan[] {
    const text = node.text ?? "";
    if (!text.includes("@")) return [];
    const names = new Set((boardJam().mentions ?? []).filter((m) => m.node === node.id).map((m) => m.name));
    const spans: TextSpan[] = [];
    for (const name of names) {
        const token = `@${name}`;
        for (let at = text.indexOf(token); at >= 0; at = text.indexOf(token, at + token.length)) spans.push({ start: at, end: at + token.length, fontWeight: 700, fills: [{ type: "solid", color: "#0C8CE9", opacity: 1, visible: true, blend: "normal" }] });
    }
    return spans.sort((a, b) => a.start - b.start);
}

// Tells you about mentions of you you haven't seen on this board.
const SEEN_KEY = "nagma.board.mentions.seen";
function seen(): Set<string> {
    try {
        return new Set(JSON.parse(userStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
    } catch {
        return new Set();
    }
}
let lastList: unknown = null;
editor.subscribe(() => {
    const s = editor.get();
    if (!s.doc.board) return;
    const list = boardJam().mentions;
    if (!list || list === lastList) return;
    lastList = list;
    const me = myUid();
    const mine = list.filter((m) => m.to === me || (m.to.startsWith("peer:") && m.name === myName()));
    const done = seen();
    const fresh = mine.filter((m) => !done.has(m.id) && m.by !== myName());
    if (!fresh.length) return;
    for (const m of fresh) done.add(m.id);
    try {
        userStorage.setItem(SEEN_KEY, JSON.stringify([...done].slice(-500)));
    } catch {
        // Seen again next time.
    }
    const last = fresh[fresh.length - 1] as BoardMention;
    const what = s.doc.nodes[last.node]?.jam?.kind ?? "text";
    editor.notify(fresh.length > 1 ? `You were mentioned ${fresh.length} times on this board` : `${last.by} mentioned you in a ${what === "sticky" ? "sticky note" : what === "shape" ? "shape" : "text"}`);
    if (s.doc.nodes[last.node]) editor.set({ selection: [last.node] });
});

// Everyone who can be mentioned here (yourself included, even in a file that isn't shared).
export function useMentionPeople(): Person[] {
    const people = usePeople();
    const me = useCollab((s) => s.me);
    const uid = myUid();
    return people.some((p) => p.uid === uid) ? people : [...people, { uid, name: me.name || myName(), color: me.color }];
}

export function matchPeople(people: Person[], query: string): Person[] {
    const q = query.toLowerCase();
    return people.filter((p) => p.name.toLowerCase().includes(q) || p.email?.toLowerCase().startsWith(q)).slice(0, 6);
}
