import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Person } from "../engine/comments";
import { MentionList } from "./mention-list";
import { matchPeople, recordMention, useMentionPeople } from "./mentions";
import { editor, useEditor } from "../engine/store";
import { apply, spaceMatrix } from "../engine/transform";
import type { SceneNode } from "../engine/types";
import { type TextFormat, addAdjacent, askLink, formatForKey, formatText, linkForKey, myName } from "./actions";
import { liveRoute, pointAlong } from "./connectors";
import { jamOf, textOn } from "./model";
import { cellBox, cellTextBox, shapeTextBox, stickyTextBox, textLayerFor } from "./paint";
import { cellLayer, pickCells, stepCell, styleCells } from "./table";
import { CODE_FONT, CODE_LINE, codeTextBox } from "./code";
import { board, useBoard } from "./state";

// Typing in a sticky, a shape, a connector's label or a table cell: a plain text field laid over
// the object (the canvas leaves that text out while it's open). The whole session is one undo step.

function boxFor(node: SceneNode, cell?: [number, number]) {
    const jam = node.jam;
    if (jam?.kind === "sticky") return stickyTextBox(node);
    if (jam?.kind === "shape") return shapeTextBox(node);
    if (jam?.kind === "code") return codeTextBox(node);
    if (jam?.kind === "table" && cell) return cellTextBox(cellBox(node, jam, cell[0], cell[1]));
    return null;
}

// The field's text with its line breaks, whether the browser kept them as characters, <br>s or
// one block per line (innerText doubles blank lines in that last case).
function plainText(root: Node): string {
    let out = "";
    const walk = (node: Node) => {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? "";
            else if (child.nodeName === "BR") out += "\n";
            else {
                const block = child.nodeName === "DIV" || child.nodeName === "P";
                if (block && out && !out.endsWith("\n")) out += "\n";
                walk(child);
            }
        }
    };
    walk(root);
    return out;
}

// Where the caret is, as a character offset into the field's text.
function caretOffset(root: HTMLElement): number {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return 0;
    const range = sel.getRangeAt(0).cloneRange();
    const before = document.createRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    const holder = document.createElement("div");
    holder.appendChild(before.cloneContents());
    return plainText(holder).length;
}

export function BoardTextEditor() {
    const editing = useBoard((s) => s.editing);
    const node = useEditor((s) => (editing ? s.doc.nodes[editing.id] : undefined));
    const camera = useEditor((s) => s.camera);
    const doc = useEditor((s) => s.doc);
    const ref = useRef<HTMLDivElement>(null);
    const started = useRef<{ id: string; steps: number } | null>(null);
    const people = useMentionPeople();
    const [mention, setMention] = useState<{ start: number; caret: number; query: string } | null>(null);
    const [mentionActive, setMentionActive] = useState(0);

    const cellKey = editing?.cell?.join(",") ?? "";
    const initial = (() => {
        if (!node) return "";
        const table = jamOf(node, "table");
        if (table && editing?.cell) return table.cells[editing.cell[0]]?.[editing.cell[1]] ?? "";
        return node.text ?? "";
    })();

    // Put the text in and the caret at its end when editing starts.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || !editing) return;
        el.innerText = initial;
        const caretToEnd = () => {
            el.focus({ preventScroll: true });
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        };
        caretToEnd();
        // Typing on a selected layer already wrote its first key: the rest joins that step.
        started.current = { id: editing.id, steps: editing.typed ? 1 : 0 };
        // A sticky or shape dropped by a click starts editing during the press; the press then
        // focuses the canvas, so take the focus back once it has finished.
        const later = window.setTimeout(() => {
            if (document.activeElement !== el && el.isConnected) caretToEnd();
        }, 0);
        return () => window.clearTimeout(later);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editing?.id, cellKey]);

    // Selecting something else ends typing.
    const selected = useEditor((s) => (editing ? s.selection.includes(editing.id) : false));
    useEffect(() => {
        if (editing && (!selected || !node)) board.set({ editing: null });
    }, [editing, selected, node]);

    if (!editing || !node) return null;

    // "@" and a few letters before the caret: the people to mention.
    const mentionQuery = () => {
        const el = ref.current;
        if (!el || editing.cell || node.jam?.kind === "code") return null;
        const caret = caretOffset(el);
        const m = /(^|\s)@([^\s@]{0,30})$/.exec(plainText(el).slice(0, caret));
        return m ? { start: caret - (m[2]?.length ?? 0) - 1, caret, query: m[2] ?? "" } : null;
    };
    const mentionMatches = mention ? matchPeople(people, mention.query) : [];
    const pickMention = (p: Person) => {
        const el = ref.current;
        if (!el || !mention) return;
        const text = plainText(el);
        const token = `@${p.name} `;
        const next = text.slice(0, mention.start) + token + text.slice(mention.caret);
        el.innerText = next;
        // The caret goes after the mention.
        const range = document.createRange();
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let left = mention.start + token.length;
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
            const len = t.textContent?.length ?? 0;
            if (left <= len) {
                range.setStart(t, left);
                break;
            }
            left -= len;
        }
        range.collapse(true);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
        write(next);
        recordMention(node.id, p);
        setMention(null);
    };

    const write = (text: string) => {
        const current = editor.get().doc.nodes[editing.id];
        if (!current) return;
        const table = jamOf(current, "table");
        const patch: Partial<SceneNode> = table && editing.cell
            ? { jam: { ...table, cells: table.cells.map((row, r) => (r === editing.cell?.[0] ? row.map((c, k) => (k === editing.cell?.[1] ? text : c)) : row)) } }
            : { text, name: current.jam?.kind === "sticky" || current.jam?.kind === "shape" ? (text.split("\n")[0]?.slice(0, 40) || current.name) : current.name };
        // "- ", "* " or "+ " at the start makes a bulleted list, "1. " or "1) " a numbered one.
        if (!(table && editing.cell) && !current.list && "text" in patch) {
            const md = /^([-*+•]|1[.)]) /.exec(text);
            if (md) {
                patch.text = text.slice(md[0].length);
                patch.list = md[1]?.startsWith("1") ? "number" : "bullet";
                const el = ref.current;
                if (el) {
                    el.innerText = patch.text;
                    const range = document.createRange();
                    range.selectNodeContents(el);
                    range.collapse(false);
                    window.getSelection()?.removeAllRanges();
                    window.getSelection()?.addRange(range);
                }
            }
        }
        // Clearing someone else's sticky makes it yours.
        if (!text && current.jam?.kind === "sticky" && current.jam.author !== myName()) patch.jam = { ...current.jam, author: myName() };
        editor.execute({ type: "node.update", id: editing.id, patch });
        // One undo step for the whole edit.
        if (started.current && started.current.steps++ > 0) editor.mergeLast();
    };

    const finish = () => board.set({ editing: null });

    // Where the field goes, in screen space.
    const m = new DOMMatrix().translate(camera.x, camera.y).scale(camera.zoom).multiply(spaceMatrix(doc, node.parentId));
    let box = boxFor(node, editing.cell);
    let align: "left" | "center" | "right" = node.textAlign === "center" ? "center" : node.textAlign === "right" ? "right" : "left";
    let middle = node.textAlignV === "middle";
    if (node.jam?.kind === "connector") {
        const route = liveRoute(doc, node);
        const mid = route ? pointAlong(route, node.jam.labelAt ?? 0.5) : { x: node.x, y: node.y };
        const local = apply(spaceMatrix(doc, node.parentId).inverse(), mid.x, mid.y);
        box = { x: local.x - 120, y: local.y - 14, w: 240, h: 28 };
        align = "center";
        middle = true;
    }
    if (!box) return null;
    const at = m.transformPoint(new DOMPoint(box.x, box.y));
    const layer = textLayerFor({ ...node, text: node.text || "M" });
    const code = node.jam?.kind === "code";
    const tableJam = jamOf(node, "table");
    // A cell's own look (font, size, weight, colour, alignment).
    const cellLook = tableJam && editing.cell ? cellLayer(node, tableJam, editing.cell[0], editing.cell[1], box, "") : null;
    if (cellLook) align = cellLook.textAlign === "center" ? "center" : cellLook.textAlign === "right" ? "right" : "left";
    const size = code ? CODE_FONT : cellLook ? (cellLook.fontSize ?? 14) : (layer?.fontSize ?? node.fontSize ?? 16);
    const fill = node.fills.find((p) => p.visible && p.type === "solid");
    const cellFill = cellLook?.fills[0];
    const color = code ? "#E6E6E6" : cellFill && cellFill.type === "solid" ? cellFill.color : node.jam && "textColor" in node.jam && node.jam.textColor ? node.jam.textColor : fill && fill.type === "solid" && node.jam?.kind !== "table" ? textOn(fill.color) : "#1E1E1E";
    return (
        <>
            <div
                className="absolute z-20"
                style={{ left: at.x, top: at.y, width: box.w, height: box.h, transform: `scale(${camera.zoom})`, transformOrigin: "0 0", display: "flex", alignItems: middle ? "center" : "flex-start" }}
                onPointerDown={(e) => e.stopPropagation()}
            >
                <div
                    ref={ref}
                    role="textbox"
                    aria-label="Text"
                    aria-multiline="true"
                    contentEditable="plaintext-only"
                    suppressContentEditableWarning
                    spellCheck={false}
                    onInput={(e) => {
                        write(plainText(e.currentTarget as HTMLDivElement).replace(/\n$/, ""));
                        setMention(mentionQuery());
                        setMentionActive(0);
                    }}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        // The mention list takes the arrows, Return, Tab and Esc while it's open.
                        if (mention && mentionMatches.length && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
                            e.preventDefault();
                            if (e.key === "Escape") setMention(null);
                            else if (e.key === "ArrowDown" || e.key === "ArrowUp") setMentionActive((a) => (a + (e.key === "ArrowDown" ? 1 : mentionMatches.length - 1)) % mentionMatches.length);
                            else pickMention(mentionMatches[Math.min(mentionActive, mentionMatches.length - 1)] as Person);
                            return;
                        }
                        const table = jamOf(node, "table");
                        // Moving between cells: Tab and ⇧Tab, and the arrows at the edges of the text.
                        const go = (dir: Parameters<typeof stepCell>[3]) => {
                            if (!table || !editing.cell) return false;
                            const next = stepCell(table, editing.cell[0], editing.cell[1], dir);
                            if (!next) return false;
                            e.preventDefault();
                            board.set({ editing: { id: node.id, cell: next } });
                            pickCells(node.id, next[0], next[1]);
                            return true;
                        };
                        if (e.key === "Escape") {
                            e.preventDefault();
                            finish();
                            // A cell stays picked after typing in it.
                            if (table && editing.cell) pickCells(node.id, editing.cell[0], editing.cell[1]);
                        } else if (table && editing.cell && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.startsWith("Arrow")) {
                            const caret = caretOffset(e.currentTarget as HTMLDivElement);
                            const text = plainText(e.currentTarget as HTMLDivElement);
                            const dir = e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : e.key === "ArrowLeft" ? "left" : "right";
                            const atEdge = dir === "left" ? caret === 0 : dir === "right" ? caret >= text.length : dir === "up" ? !text.slice(0, caret).includes("\n") : !text.slice(caret).includes("\n");
                            if (atEdge) go(dir);
                        } else if (linkForKey(e) && !editing.cell) {
                            e.preventDefault();
                            void askLink([node.id]);
                        } else if (formatForKey(e) && editing.cell && table) {
                            // ⌘B and ⌘⇧X on a cell change its own look.
                            e.preventDefault();
                            const style = table.styles?.[editing.cell[0]]?.[editing.cell[1]];
                            const block = { top: editing.cell[0], left: editing.cell[1], bottom: editing.cell[0], right: editing.cell[1] };
                            if (formatForKey(e) === "bold") styleCells(node.id, block, { bold: !(style?.bold ?? editing.cell[0] === 0) });
                            else if (formatForKey(e) === "strike") styleCells(node.id, block, { strike: !style?.strike || undefined });
                        } else if (formatForKey(e) && !editing.cell) {
                            e.preventDefault();
                            formatText([node.id], formatForKey(e) as TextFormat);
                        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && (node.jam?.kind === "sticky" || node.jam?.kind === "shape" || node.jam?.kind === "code")) {
                            e.preventDefault();
                            addAdjacent(node.id, "right");
                        } else if (e.key === "Tab" && node.jam?.kind === "code") {
                            // Tab indents code by two spaces.
                            e.preventDefault();
                            document.execCommand("insertText", false, "  ");
                        } else if (e.key === "Tab" && editing.cell) {
                            e.preventDefault();
                            go(e.shiftKey ? "prev" : "next");
                        } else if (e.key === "Tab" && node.list) {
                            // Tab and ⇧Tab indent and outdent the list item the caret is in.
                            e.preventDefault();
                            const text = plainText(e.currentTarget as HTMLDivElement);
                            const index = text.slice(0, caretOffset(e.currentTarget as HTMLDivElement)).split("\n").length - 1;
                            const count = text.split("\n").length;
                            const paragraphs = Array.from({ length: count }, (_, i) => node.paragraphs?.[i] ?? { list: node.list, level: 1 });
                            const level = Math.max(1, Math.min(5, (paragraphs[index]?.level ?? 1) + (e.shiftKey ? -1 : 1)));
                            paragraphs[index] = { list: node.list, level };
                            editor.execute({ type: "node.update", id: node.id, patch: { paragraphs } });
                        }
                    }}
                    className="w-full outline-none"
                    style={{
                        fontFamily: `"${cellLook?.fontFamily ?? node.fontFamily ?? "Inter"}", Inter, sans-serif`,
                        fontSize: size,
                        fontWeight: cellLook ? cellLook.fontWeight : (node.fontWeight ?? 400),
                        lineHeight: code ? `${CODE_LINE}px` : 1.2,
                        textAlign: align,
                        color,
                        textDecoration: node.decoration === "strikethrough" ? "line-through" : node.decoration === "underline" ? "underline" : undefined,
                        whiteSpace: code ? "pre" : "pre-wrap",
                        overflowWrap: code ? undefined : "break-word",
                        caretColor: color,
                        maxHeight: code ? undefined : box.h,
                        overflow: code ? "visible" : "hidden",
                    }}
                />
            </div>
            {mention && <MentionList people={mentionMatches} active={Math.min(mentionActive, Math.max(0, mentionMatches.length - 1))} x={at.x} y={at.y + box.h * camera.zoom + 6} onPick={pickMention} />}
        </>
    );
}
