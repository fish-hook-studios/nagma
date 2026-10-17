import { useEffect, useState } from "react";
import { applyCharStyle } from "../engine/text-session";
import type { Person } from "../engine/comments";
import { spliceText } from "../engine/rich-text";
import { editor, useEditor } from "../engine/store";
import { textSession, useTextSession } from "../engine/text-session";
import { worldBounds } from "../engine/transform";
import { worldToScreen } from "../engine/camera";
import { matchPeople, recordMention, useMentionPeople } from "./mentions";

// The list of people to @mention while typing on a board, under the text being typed.

export function MentionList({ people, active, x, y, onPick }: { people: Person[]; active: number; x: number; y: number; onPick: (p: Person) => void }) {
    if (!people.length) return null;
    return (
        <div role="listbox" aria-label="Mention someone" className="absolute z-30 w-56 rounded-lg bg-[#1E1E1E] p-1 text-[12px] text-white shadow-xl" style={{ left: x, top: y }} onPointerDown={(e) => e.preventDefault()}>
            {people.map((p, i) => (
                <button key={p.uid} type="button" role="option" aria-selected={i === active} onClick={() => onPick(p)} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${i === active ? "bg-[#9747FF]" : "hover:bg-white/10"}`}>
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: p.color }}>{p.name.slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.email && <span className="truncate text-white/50">{p.email}</span>}
                </button>
            ))}
        </div>
    );
}

// Mentions in text layers (typed with the design text editor): the list follows "@" before the
// caret, and the arrows, Return, Tab and Esc work it while it's open.
export function TextLayerMentions() {
    const session = useTextSession();
    const editingId = useEditor((s) => s.editingTextId);
    const node = useEditor((s) => (editingId ? s.doc.nodes[editingId] : undefined));
    const camera = useEditor((s) => s.camera);
    const doc = useEditor((s) => s.doc);
    const people = useMentionPeople();
    const [active, setActive] = useState(0);
    const [closedAt, setClosedAt] = useState<number | null>(null);
    const text = node?.text ?? "";
    const focus = session?.nodeId === node?.id ? (session?.focus ?? 0) : 0;
    const match = node && session && session.anchor === session.focus ? /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, focus)) : null;
    const start = match ? focus - (match[2]?.length ?? 0) - 1 : -1;
    const list = match && closedAt !== start ? matchPeople(people, match[2] ?? "") : [];
    const pick = (p: Person) => {
        if (!node) return;
        const token = `@${p.name}`;
        const rich = spliceText(node, start, focus, `${token} `);
        editor.execute({ type: "node.update", id: node.id, patch: { text: rich.text, spans: rich.spans, ...(rich.paragraphs ? { paragraphs: rich.paragraphs } : {}) } });
        textSession.patch({ anchor: start, focus: start + token.length });
        const fresh = editor.get().doc.nodes[node.id];
        if (fresh) applyCharStyle([fresh], { fontWeight: 700, fills: [{ type: "solid", color: "#0C8CE9", opacity: 1, visible: true, blend: "normal" }] });
        textSession.patch({ anchor: start + token.length + 1, focus: start + token.length + 1, typing: null });
        recordMention(node.id, p);
        setActive(0);
    };
    useEffect(() => {
        if (!list.length) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") setActive((a) => (a + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
            else if (e.key === "Enter" || e.key === "Tab") pick(list[Math.min(active, list.length - 1)] as Person);
            else if (e.key === "Escape") setClosedAt(start);
            else return;
            e.preventDefault();
            e.stopPropagation();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    });
    if (!node || !doc.board || !list.length) return null;
    const box = worldBounds(doc, node);
    const at = worldToScreen(camera, box.x, box.y + box.h);
    return <MentionList people={list} active={Math.min(active, list.length - 1)} x={at.x} y={at.y + 6} onPick={pick} />;
}
