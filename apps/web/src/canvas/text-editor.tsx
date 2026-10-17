import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { legacy } from "../engine/legacy-names";
import { editor, useEditor } from "../engine/store";
import { worldMatrix } from "../engine/transform";
import { type RichClip, materializeParagraphs, paragraphBounds, paragraphIndex, paragraphStyle, relativeTo, sliceRich, spliceText, styleAt, tidyParagraphs, wordAt } from "../engine/rich-text";
import { caretAt, indexAt, layoutText, rangeRects, verticalOffset } from "../engine/text-layout";
import { takeEditPoint, textSession, useTextSession } from "../engine/text-session";
import { indentParagraphs, setTextAlign, stepFontSize, stepFontWeight, toggleBold, toggleDecoration, toggleItalic, toggleList } from "../engine/text-actions";
import { openLinkEditor } from "../engine/text-link";
import { smartSymbolAt } from "../engine/smart-symbols";
import type { Command, SceneNode } from "../engine/types";

// Editing text in place: the canvas draws the layer as it changes, and this overlay
// adds the caret and selection, takes keyboard input through a hidden field, and keeps rich text
// (each character's style), lists and paragraphs right as you type, paste and delete.

const RICH_MIME = "application/x-nagma-text";
// What a copy from before the rename put on the clipboard (read too).
const OLD_RICH = new RegExp(`(?:data-nagma-text|${legacy.textDataAttr})="([^"]+)"`);

export function TextEditor({ nodeId }: { nodeId: string }) {
    const node = useEditor((s) => s.doc.nodes[nodeId]);
    const camera = useEditor((s) => s.camera);
    const spellCheck = useEditor((s) => s.prefs.spellCheck);
    const doc = useEditor((s) => s.doc);
    const session = useTextSession();
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const done = useRef(false);
    const goalX = useRef<number | null>(null);
    const lastTyping = useRef(0);
    const original = useRef<{ text: string; name: string } | null>(null);
    const drag = useRef<{ anchor: number; mode: "char" | "word" | "paragraph" } | null>(null);
    const startPoint = useRef<{ x: number; y: number } | null>(null);
    const [composing, setComposing] = useState(false);

    const finish = () => {
        if (done.current) return;
        done.current = true;
        const n = editor.get().doc.nodes[nodeId];
        textSession.set(null);
        editor.set({ editingTextId: null });
        if (n && (n.text ?? "").trim() === "") editor.execute({ type: "node.delete", ids: [nodeId] });
    };
    const finishRef = useRef(finish);
    useLayoutEffect(() => {
        finishRef.current = finish;
    });

    // Start: select everything (Enter or a new layer), or the word where the double-click was.
    useLayoutEffect(() => {
        const n = editor.get().doc.nodes[nodeId];
        if (!n) return;
        done.current = false;
        original.current = { text: n.text ?? "", name: n.name };
        const length = (n.text ?? "").length;
        let anchor = 0;
        let focus = length;
        // (Effects run twice in development; the double-click point is only there the first time.)
        const pendingPoint = takeEditPoint() ?? startPoint.current;
        startPoint.current = pendingPoint;
        if (pendingPoint) {
            const layout = layoutText(n);
            const local = worldMatrix(editor.get().doc, n).inverse().transformPoint(new DOMPoint(pendingPoint.x, pendingPoint.y));
            const at = indexAt(layout, local.x - n.x, local.y - n.y - verticalOffset(n, layout));
            const [a, b] = wordAt(n.text ?? "", at);
            anchor = a;
            focus = b;
        }
        textSession.set({ nodeId, anchor, focus, typing: null });
        inputRef.current?.focus({ preventScroll: true });
        return () => {
            if (textSession.get()?.nodeId === nodeId) textSession.set(null);
        };
    }, [nodeId]);

    // A click on the canvas outside the text ends editing; clicks in the panels don't.
    useEffect(() => {
        const onDown = (event: PointerEvent) => {
            const box = boxRef.current;
            const canvas = box?.parentElement;
            const target = event.target as Node | null;
            if (!box || !canvas || !target) return;
            if (canvas.contains(target) && !box.contains(target)) finishRef.current();
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape" && document.activeElement === document.body) finishRef.current();
        };
        // After a panel field is done (Enter or a click away), typing goes back to the text.
        const onFocusOut = (event: FocusEvent) => {
            if (event.relatedTarget) return;
            window.setTimeout(() => {
                if (document.activeElement === document.body) inputRef.current?.focus({ preventScroll: true });
            });
        };
        window.addEventListener("pointerdown", onDown, true);
        window.addEventListener("keydown", onKey);
        document.addEventListener("focusout", onFocusOut);
        return () => {
            window.removeEventListener("pointerdown", onDown, true);
            window.removeEventListener("keydown", onKey);
            document.removeEventListener("focusout", onFocusOut);
        };
    }, [nodeId]);

    // The hidden field takes the keyboard once the session (and so the field) exists.
    const live = Boolean(session && session.nodeId === nodeId);
    useEffect(() => {
        if (live) inputRef.current?.focus({ preventScroll: true });
    }, [live]);

    // Selecting something else (in the Layers panel, say) ends editing.
    const selected = useEditor((s) => s.selection.includes(nodeId));
    useEffect(() => {
        if (!selected) finishRef.current();
    }, [selected]);

    const layout = useMemo(() => (node ? layoutText(node) : null), [node]);
    if (!node || !layout || !session || session.nodeId !== nodeId) return null;
    const text = node.text ?? "";
    const start = Math.min(session.anchor, session.focus);
    const end = Math.max(session.anchor, session.focus);
    const offsetY = verticalOffset(node, layout);
    const m = new DOMMatrix().translate(camera.x, camera.y).scale(camera.zoom).multiply(worldMatrix(doc, node));

    const current = () => editor.get().doc.nodes[nodeId] as SceneNode | undefined;
    const select = (anchor: number, focus: number = anchor, keepGoal = false) => {
        if (!keepGoal) goalX.current = null;
        const s = textSession.get();
        const same = s && anchor === focus && s.anchor === anchor && s.focus === focus;
        textSession.patch({ anchor, focus, typing: same ? s.typing : null });
    };

    // Writes text, spans and paragraphs; bursts of typing fold into one undo step.
    const write = (patch: Partial<SceneNode>, typing: boolean) => {
        const n = current();
        if (!n) return;
        const firstLine = (patch.text ?? n.text ?? "").split(/[\n\u2028]/)[0]?.slice(0, 40) || "Text";
        const o = original.current;
        // A layer named after its text keeps following it.
        const autoName = o && (o.name === o.text || o.name === "Text" || o.text === "");
        const command: Command = { type: "node.update", id: nodeId, patch: { ...patch, ...(autoName && patch.text !== undefined ? { name: firstLine } : {}) } };
        const now = Date.now();
        const before = editor.get().past.length;
        editor.execute(command);
        if (typing && now - lastTyping.current < 1500 && editor.get().past.length > before) editor.mergeLast();
        lastTyping.current = typing ? now : 0;
    };

    const paragraphsPatch = (rich: { paragraphs?: SceneNode["paragraphs"] }) => ("paragraphs" in rich ? { paragraphs: rich.paragraphs ?? [] } : {});

    // Replaces the selection with text (and, when pasted from Nagma, its styles and list settings).
    const insert = (value: string, clip?: RichClip) => {
        const n = current();
        const s = textSession.get();
        if (!n || !s) return;
        const a = Math.min(s.anchor, s.focus);
        const b = Math.max(s.anchor, s.focus);
        const styles = clip ? relativeTo(n, clip.styles) : undefined;
        let next = spliceText(n, a, b, value, { styles, typing: s.typing, paragraphs: clip?.paragraphs });
        let caret = a + value.length;
        // Markdown: "- " or "* " at the start of a paragraph makes a bullet, "1. " or "1) " a number,
        // once the space after the marker is typed.
        if (!clip && value.includes(" ")) {
            const [ps] = paragraphBounds(next.text, a);
            const head = /^([-*] |1[.)] )/.exec(next.text.slice(ps, ps + 3));
            const spaceAt = head ? ps + (head[1]?.length ?? 0) - 1 : -1;
            const para = paragraphIndex(next.text, a);
            const probe = { ...n, ...next } as SceneNode;
            if (head && spaceAt >= a && spaceAt < a + value.length && !paragraphStyle(probe, para).list) {
                const kind = head[1]?.startsWith("1") ? "number" : "bullet";
                const markerLength = head[1]?.length ?? 0;
                const cut = spliceText(probe, ps, ps + markerLength, "");
                const list = materializeParagraphs({ ...probe, ...cut } as SceneNode);
                list[para] = { list: kind, level: Math.max(1, list[para]?.level ?? 1) };
                next = { ...cut, paragraphs: tidyParagraphs(list) };
                caret -= markerLength;
            }
        }
        // Smart symbols (an opt-in preference): "->" becomes an arrow, "(c)" a copyright sign and so on.
        if (!clip && value.length === 1 && editor.get().prefs.smartSymbols) {
            const hit = smartSymbolAt(next.text, caret);
            if (hit) {
                const probe = { ...n, ...next } as SceneNode;
                next = { ...next, ...spliceText(probe, hit.start, hit.start + hit.length, hit.symbol, { typing: s.typing }) };
                caret = hit.start + hit.symbol.length;
            }
        }
        write({ text: next.text, spans: next.spans, ...paragraphsPatch(next) }, value.length <= 2 && !clip);
        textSession.patch({ anchor: caret, focus: caret, typing: s.typing });
    };

    const remove = (a: number, b: number) => {
        const n = current();
        if (!n || b <= a) return;
        const rich = spliceText(n, a, b, "");
        write({ text: rich.text, spans: rich.spans, ...paragraphsPatch(rich) }, true);
        select(a);
    };

    const setParagraph = (index: number, patch: { list?: "bullet" | "number" | null; level?: number }) => {
        const n = current();
        if (!n) return;
        const list = materializeParagraphs(n);
        list[index] = { ...list[index], ...patch };
        write({ paragraphs: tidyParagraphs(list) ?? [] }, false);
    };

    // Moves within the text: by character, word, line, or to the ends.
    const lineOf = (index: number) => caretAt(layout, index);
    const vertical = (index: number, dir: 1 | -1) => {
        const here = lineOf(index);
        if (!here) return index;
        const x = goalX.current ?? here.x;
        goalX.current = x;
        const target = layout.lines[here.lineIndex + dir];
        if (!target) return dir < 0 ? 0 : text.length;
        return indexAt(layout, x, target.top + target.height / 2);
    };
    const wordLeft = (i: number) => {
        let j = i;
        while (j > 0 && /\s/.test(text[j - 1] ?? "")) j--;
        while (j > 0 && !/\s/.test(text[j - 1] ?? "")) j--;
        return j;
    };
    const wordRight = (i: number) => {
        let j = i;
        while (j < text.length && /\s/.test(text[j] ?? "")) j++;
        while (j < text.length && !/\s/.test(text[j] ?? "")) j++;
        return j;
    };
    const lineStart = (i: number) => lineOf(i)?.line.start ?? 0;
    const lineEnd = (i: number) => {
        const line = lineOf(i)?.line;
        if (!line) return text.length;
        return line.hard ? line.end : Math.max(line.start, line.end - (/\s/.test(text[line.end - 1] ?? "") ? 1 : 0));
    };
    // A surrogate pair counts as one character.
    const prevChar = (i: number) => (i >= 2 && /[\uDC00-\uDFFF]/.test(text[i - 1] ?? "") ? i - 2 : Math.max(0, i - 1));
    const nextChar = (i: number) => (/[\uD800-\uDBFF]/.test(text[i] ?? "") ? Math.min(text.length, i + 2) : Math.min(text.length, i + 1));

    const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        event.stopPropagation();
        if (composing || event.nativeEvent.isComposing) return;
        const meta = event.metaKey || event.ctrlKey;
        const { key, shiftKey: shift, altKey: alt } = event;
        const code = event.nativeEvent.code;
        const s = textSession.get();
        if (!s) return;
        const handled = () => event.preventDefault();
        const move = (to: number, keepGoal = false) => {
            handled();
            if (shift) select(s.anchor, to, keepGoal);
            else select(to, to, keepGoal);
        };
        if (key === "Escape") return void (handled(), finish());
        if (meta && !alt && code === "KeyZ") {
            handled();
            if (shift) editor.redo();
            else editor.undo();
            if (editor.get().doc.nodes[nodeId]) {
                editor.set({ editingTextId: nodeId, selection: [nodeId] });
                const length = (editor.get().doc.nodes[nodeId]?.text ?? "").length;
                select(Math.min(s.anchor, length), Math.min(s.focus, length));
            }
            return;
        }
        if (meta && code === "KeyA") return void (handled(), select(0, text.length));
        if (meta && !shift && !alt && code === "KeyB") return void (handled(), toggleBold());
        if (meta && !shift && !alt && code === "KeyI") return void (handled(), toggleItalic());
        if (meta && !shift && !alt && code === "KeyU") return void (handled(), toggleDecoration("underline"));
        if (meta && shift && code === "KeyX") return void (handled(), toggleDecoration("strikethrough"));
        if (meta && (code === "KeyK" || (shift && code === "KeyU"))) return void (handled(), openLinkEditor());
        if (meta && shift && code === "Digit8") return void (handled(), toggleList("bullet"));
        if (meta && shift && code === "Digit7") return void (handled(), toggleList("number"));
        if (meta && !alt && (code === "BracketRight" || code === "BracketLeft")) return void (handled(), indentParagraphs(code === "BracketRight" ? 1 : -1));
        if (meta && shift && !alt && (code === "Comma" || code === "Period")) return void (handled(), stepFontSize(code === "Period" ? 1 : -1));
        if (meta && alt && (code === "Comma" || code === "Period")) return void (handled(), stepFontWeight(code === "Period" ? 1 : -1));
        if (meta && alt && code === "KeyL") return void (handled(), setTextAlign("left"));
        if (meta && alt && code === "KeyT") return void (handled(), setTextAlign("center"));
        if (meta && alt && code === "KeyR") return void (handled(), setTextAlign("right"));
        const a = Math.min(s.anchor, s.focus);
        const b = Math.max(s.anchor, s.focus);
        switch (key) {
            case "ArrowLeft":
                if (!shift && a !== b) return move(a);
                return move(meta ? lineStart(s.focus) : alt ? wordLeft(s.focus) : prevChar(s.focus));
            case "ArrowRight":
                if (!shift && a !== b) return move(b);
                return move(meta ? lineEnd(s.focus) : alt ? wordRight(s.focus) : nextChar(s.focus));
            case "ArrowUp":
                return move(meta ? 0 : alt ? paragraphBounds(text, Math.max(0, s.focus - 1))[0] : vertical(s.focus, -1), !meta && !alt);
            case "ArrowDown":
                return move(meta ? text.length : alt ? paragraphBounds(text, s.focus)[1] : vertical(s.focus, 1), !meta && !alt);
            case "Home":
                return move(meta ? 0 : lineStart(s.focus));
            case "End":
                return move(meta ? text.length : lineEnd(s.focus));
            case "Backspace": {
                handled();
                if (a !== b) return remove(a, b);
                // At the start of a list item the marker goes first, keeping the indentation.
                const para = paragraphIndex(text, a);
                const [ps] = paragraphBounds(text, a);
                const p = paragraphStyle(node, para);
                if (a === ps && p.list) return setParagraph(para, { list: null, level: p.level });
                if (a === ps && p.level > 0) return setParagraph(para, { level: p.level - 1 });
                if (a === 0) return;
                return remove(meta ? lineStart(a) : alt ? wordLeft(a) : prevChar(a), a);
            }
            case "Delete":
                handled();
                if (a !== b) return remove(a, b);
                return remove(a, alt ? wordRight(a) : nextChar(a));
            case "Enter": {
                handled();
                if (meta) return finish();
                if (shift) return insert("\u2028");
                // Return on an empty list item steps it out a level, then out of the list.
                const para = paragraphIndex(text, a);
                const [ps, pe] = paragraphBounds(text, a);
                const p = paragraphStyle(node, para);
                if (a === b && ps === pe && p.list) {
                    if (p.level > 1) return setParagraph(para, { level: p.level - 1 });
                    return setParagraph(para, { list: null, level: 0 });
                }
                return insert("\n");
            }
            case "Tab": {
                handled();
                let inList = false;
                for (let i = paragraphIndex(text, a); i <= paragraphIndex(text, b); i++) if (paragraphStyle(node, i).list) inList = true;
                if (inList || shift) return indentParagraphs(shift ? -1 : 1);
                return insert("\t");
            }
        }
    };

    const onInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
        if (composing) return;
        const value = event.currentTarget.value;
        event.currentTarget.value = "";
        if (value) insert(value.replace(/\r\n?/g, "\n"));
    };

    const copy = (event: React.ClipboardEvent, cut: boolean) => {
        event.preventDefault();
        event.stopPropagation();
        if (start === end) return;
        const clip = sliceRich(node, start, end);
        event.clipboardData.setData("text/plain", clip.text.replace(/\u2028/g, "\n"));
        event.clipboardData.setData(RICH_MIME, JSON.stringify(clip));
        // Other apps (and other Nagma tabs) get the styles in the HTML flavour.
        event.clipboardData.setData("text/html", `<span data-nagma-text="${encodeURIComponent(JSON.stringify(clip))}">${escapeHtml(clip.text)}</span>`);
        if (cut) remove(start, end);
    };

    const paste = (event: React.ClipboardEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const data = event.clipboardData;
        let clip: RichClip | undefined;
        const raw = data.getData(RICH_MIME) || data.getData(legacy.textMime) || decodeURIComponent(OLD_RICH.exec(data.getData("text/html"))?.[1] ?? "");
        if (raw) {
            try {
                clip = JSON.parse(raw) as RichClip;
            } catch {
                clip = undefined;
            }
        }
        const plain = clip?.text ?? data.getData("text/plain").replace(/\r\n?/g, "\n");
        if (plain) insert(plain, clip);
    };

    // Pointer: click places the caret, shift-click extends, double-click selects a word and
    // triple-click the paragraph; dragging selects.
    const pointIndex = (event: React.PointerEvent) => {
        const box = boxRef.current;
        if (!box) return 0;
        const inverse = new DOMMatrix(getComputedStyle(box).transform).inverse();
        const parent = box.parentElement?.getBoundingClientRect();
        const p = inverse.transformPoint(new DOMPoint(event.clientX - (parent?.left ?? 0), event.clientY - (parent?.top ?? 0)));
        return indexAt(layout, p.x, p.y - offsetY);
    };
    const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        event.stopPropagation();
        if (event.button !== 0) return;
        event.preventDefault();
        inputRef.current?.focus({ preventScroll: true });
        const at = pointIndex(event);
        const s = textSession.get();
        if (event.detail >= 3) {
            const [a, b] = paragraphBounds(text, at);
            select(a, b);
            drag.current = { anchor: a, mode: "paragraph" };
        } else if (event.detail === 2) {
            const [a, b] = wordAt(text, at);
            select(a, b);
            drag.current = { anchor: a, mode: "word" };
        } else if (event.shiftKey && s) {
            select(s.anchor, at);
            drag.current = { anchor: s.anchor, mode: "char" };
        } else {
            select(at);
            drag.current = { anchor: at, mode: "char" };
        }
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (!d) return;
        const at = pointIndex(event);
        if (d.mode === "word") {
            const [a, b] = wordAt(text, at);
            select(at < d.anchor ? Math.max(d.anchor, wordAt(text, d.anchor)[1]) : d.anchor, at < d.anchor ? a : b);
        } else if (d.mode === "paragraph") {
            const [a, b] = paragraphBounds(text, at);
            select(at < d.anchor ? paragraphBounds(text, d.anchor)[1] : d.anchor, at < d.anchor ? a : b);
        } else select(d.anchor, at);
    };

    const caret = start === end ? caretAt(layout, session.focus) : null;
    const caretStyle = styleAt(node, Math.max(0, session.focus - 1));
    const caretHeight = caret ? caret.line.height : caretStyle.fontSize * 1.2;
    const rects = rangeRects(layout, start, end);
    const height = Math.max(node.h, layout.height + offsetY);

    return (
        <div
            ref={boxRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onDoubleClick={(e) => e.stopPropagation()}
            className="absolute cursor-text"
            style={{
                left: 0,
                top: 0,
                width: node.w,
                height,
                transformOrigin: "0 0",
                transform: `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f}) translate(${node.x}px, ${node.y}px)`,
                outline: `${1 / camera.zoom}px solid var(--color-brand-500, #0d99ff)`,
            }}
        >
            {rects.map((r, i) => (
                <div key={i} className="pointer-events-none absolute" style={{ left: r.x, top: r.y + offsetY, width: r.w, height: r.h, background: "rgba(13, 153, 255, 0.3)" }} />
            ))}
            {/* The caret blinks, and shows solid right after it moves (a new element restarts the animation). */}
            <style>{"@keyframes nagma-caret { 0%, 50% { opacity: 1 } 50.01%, 100% { opacity: 0 } }"}</style>
            {caret && !composing && (
                <div
                    key={`${session.anchor}:${session.focus}:${text.length}`}
                    className="pointer-events-none absolute"
                    style={{ left: caret.x, top: caret.line.top + offsetY, width: Math.max(1, 1.5 / camera.zoom), height: caretHeight, background: "var(--color-brand-500, #0d99ff)", animation: "nagma-caret 1.06s 0.5s infinite" }}
                />
            )}
            <textarea
                ref={inputRef}
                aria-label="Text"
                spellCheck={spellCheck}
                autoCapitalize="off"
                autoCorrect="off"
                onKeyDown={onKeyDown}
                onInput={onInput}
                onCopy={(e) => copy(e, false)}
                onCut={(e) => copy(e, true)}
                onPaste={paste}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={(e) => {
                    setComposing(false);
                    const value = e.currentTarget.value;
                    e.currentTarget.value = "";
                    if (value) insert(value);
                }}
                className="absolute resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
                style={{
                    left: caret?.x ?? 0,
                    top: (caret?.line.top ?? 0) + offsetY,
                    width: composing ? 400 : 1,
                    height: caretHeight,
                    opacity: composing ? 1 : 0,
                    font: `${caretStyle.italic ? "italic " : ""}${caretStyle.fontWeight} ${caretStyle.fontSize}px "${caretStyle.fontFamily}", system-ui, sans-serif`,
                    caretColor: "transparent",
                    whiteSpace: "pre",
                }}
            />
        </div>
    );
}

function escapeHtml(text: string) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}
