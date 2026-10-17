import { Copy01, MessageTextSquare01 } from "@untitledui/icons";
import { editor } from "../engine/store";
import type { Rect } from "./model";
import { docView, edit, me, styleFor, textLayer } from "./state";
import { rangeText } from "./text";

// Over selected text: copy it, or mark it up (highlight, underline, strike through, redact, or a
// note on it).

export function copySelection(): boolean {
    const sel = docView.get().textSel;
    const layer = sel ? textLayer(sel.page) : null;
    if (!sel || !layer) return false;
    const text = rangeText(layer, sel.from, sel.to);
    void navigator.clipboard?.writeText(text).then(
        () => editor.notify("Copied."),
        () => editor.notify("Couldn't reach the clipboard."),
    );
    return true;
}

function Mark({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
    return (
        <button type="button" aria-label={label} title={label} onClick={onPress} className="flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-white/90 hover:bg-white/15">
            {children}
        </button>
    );
}

export function SelectionBar({ page, rects, zoom }: { page: number; rects: Rect[]; zoom: number }) {
    const last = rects[rects.length - 1];
    if (!last) return null;
    const markup = (kind: string) => {
        const style = styleFor(kind);
        edit({ op: "annotate", page, kind, rects, author: me(), ...(kind === "redact" ? {} : { color: style.color, opacity: style.opacity }) }, { textSel: null });
    };
    const note = () => {
        const first = rects[0];
        if (!first) return;
        const style = styleFor("highlight");
        if (edit({ op: "annotate", page, kind: "highlight", rects, author: me(), color: style.color, opacity: style.opacity }, { textSel: null })) {
            const made = docView.get().info?.comments.filter((c) => c.page === page && c.subtype === "Highlight").pop();
            if (made) docView.set({ selected: { page, index: made.index } });
        }
    };
    return (
        <div
            role="toolbar"
            aria-label="Selected text"
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-20 flex items-center gap-0.5 rounded-lg bg-tooltip p-1 text-[11px] shadow-xl"
            style={{ left: last[0] * zoom, top: last[3] * zoom + 6 }}
        >
            <Mark label="Copy" onPress={() => copySelection()}>
                <Copy01 className="size-3.5" />
            </Mark>
            <Mark label="Highlight" onPress={() => markup("highlight")}>
                <span className="rounded-sm bg-[#FFD000] px-1 font-semibold text-black">H</span>
            </Mark>
            <Mark label="Underline" onPress={() => markup("underline")}>
                <span className="font-semibold underline decoration-2">U</span>
            </Mark>
            <Mark label="Strikethrough" onPress={() => markup("strikeout")}>
                <span className="font-semibold line-through decoration-2">S</span>
            </Mark>
            <Mark label="Comment on this text" onPress={note}>
                <MessageTextSquare01 className="size-3.5" />
            </Mark>
            <Mark label="Mark for redaction" onPress={() => markup("redact")}>
                <span className="inline-block h-3 w-4 rounded-[1px] bg-black ring-1 ring-white/60" />
            </Mark>
        </div>
    );
}
