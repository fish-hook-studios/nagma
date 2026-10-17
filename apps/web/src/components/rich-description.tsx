import { Link01, Plus, X } from "@untitledui/icons";
import { Fragment, useRef, useState } from "react";

// Descriptions of styles and components: light markdown (**bold**, _italic_, [links](https://…)
// and "- " lists), kept as the source plus a plain-text copy, and documentation links below.

export interface DescriptionValue {
    description?: string;
    descriptionMarkdown?: string;
    docLinks?: { label?: string; url: string }[];
}

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)\s]+\))/g;

// The markdown without its marks.
function plainText(markdown: string): string {
    return markdown
        .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
        .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
        .replace(/\*([^*]+)\*|_([^_]+)_/g, "$1$2");
}

const safeUrl = (url: string) => (/^(https?:|mailto:)/i.test(url) ? url : `https://${url}`);

function inline(text: string): React.ReactNode[] {
    return text.split(INLINE).map((part, i) => {
        if (/^\*\*.+\*\*$|^__.+__$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (/^\*.+\*$|^_.+_$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
        const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
        if (link)
            return (
                <a key={i} href={safeUrl(link[2] ?? "")} target="_blank" rel="noreferrer noopener" className="text-brand-500 hover:underline">
                    {link[1]}
                </a>
            );
        return <Fragment key={i}>{part}</Fragment>;
    });
}

export function MarkdownView({ value, className = "" }: { value: DescriptionValue; className?: string }) {
    const source = value.descriptionMarkdown ?? value.description ?? "";
    if (!source.trim() && !value.docLinks?.length) return null;
    const lines = source.split("\n");
    const blocks: React.ReactNode[] = [];
    let list: string[] = [];
    const flush = () => {
        if (!list.length) return;
        blocks.push(
            <ul key={`l${blocks.length}`} className="list-disc pl-4">
                {list.map((item, i) => (
                    <li key={i}>{inline(item)}</li>
                ))}
            </ul>,
        );
        list = [];
    };
    for (const line of lines) {
        const item = /^\s*[-*]\s+(.*)$/.exec(line);
        if (item) {
            list.push(item[1] ?? "");
            continue;
        }
        flush();
        blocks.push(<p key={`p${blocks.length}`}>{line ? inline(line) : " "}</p>);
    }
    flush();
    return (
        <div className={`space-y-0.5 text-ink-muted ${className}`}>
            {blocks}
            {value.docLinks?.map((l, i) => (
                <a key={`d${i}`} href={safeUrl(l.url)} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 truncate text-brand-500 hover:underline">
                    <Link01 className="size-3 shrink-0" />
                    {l.label || l.url}
                </a>
            ))}
        </div>
    );
}

// The editor: B, I and link buttons wrap the selected text; Preview shows it formatted.
export function DescriptionField({ value, onChange, label = "Description", className = "" }: { value: DescriptionValue; onChange: (patch: DescriptionValue) => void; label?: string; className?: string }) {
    const ref = useRef<HTMLTextAreaElement>(null);
    const [preview, setPreview] = useState(false);
    const [adding, setAdding] = useState(false);
    const [url, setUrl] = useState("");
    const source = value.descriptionMarkdown ?? value.description ?? "";
    const links = value.docLinks ?? [];
    const commit = (text: string) => {
        if (text === source) return;
        onChange({ descriptionMarkdown: text, description: plainText(text) });
    };
    const wrap = (before: string, after = before) => {
        const el = ref.current;
        if (!el) return;
        const { selectionStart: a, selectionEnd: b, value: text } = el;
        const next = text.slice(0, a) + before + text.slice(a, b) + after + text.slice(b);
        el.value = next;
        el.focus();
        el.setSelectionRange(a + before.length, b + before.length);
        commit(next);
    };
    const field = "w-full rounded-md border border-transparent bg-field px-1.5 text-ink outline-none hover:border-panel-border focus:border-brand-500";
    const tool = "flex h-5 min-w-5 items-center justify-center rounded px-1 text-ink-muted hover:bg-panel-hover hover:text-ink";
    return (
        <div className={`space-y-1 ${className}`}>
            <div className="flex items-center gap-0.5">
                <button type="button" title="Bold" aria-label="Bold" onClick={() => wrap("**")} className={`${tool} font-bold`}>
                    B
                </button>
                <button type="button" title="Italic" aria-label="Italic" onClick={() => wrap("_")} className={`${tool} italic`}>
                    I
                </button>
                <button type="button" title="Link" aria-label="Link" onClick={() => wrap("[", "](https://)")} className={tool}>
                    <Link01 className="size-3" />
                </button>
                <button type="button" title="Bulleted list" aria-label="Bulleted list" onClick={() => wrap("- ", "")} className={tool}>
                    •
                </button>
                <button type="button" aria-pressed={preview} onClick={() => setPreview(!preview)} className={`${tool} ml-auto ${preview ? "text-ink" : ""}`}>
                    {preview ? "Edit" : "Preview"}
                </button>
            </div>
            {preview ? (
                <MarkdownView value={{ descriptionMarkdown: source }} className="min-h-10 rounded-md bg-field px-1.5 py-1" />
            ) : (
                <textarea
                    ref={ref}
                    key={source}
                    defaultValue={source}
                    placeholder="Add a description"
                    aria-label={label}
                    rows={2}
                    onKeyDown={(e) => e.stopPropagation()}
                    onBlur={(e) => commit(e.target.value)}
                    className={`${field} resize-none py-1`}
                />
            )}
            {links.map((l, i) => (
                <div key={`${l.url}-${i}`} className="flex h-6 items-center gap-1.5">
                    <Link01 className="size-3 shrink-0 text-ink-muted" />
                    <a href={safeUrl(l.url)} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate text-brand-500 hover:underline">
                        {l.label || l.url}
                    </a>
                    <button type="button" aria-label="Remove link" onClick={() => onChange({ docLinks: links.filter((_, k) => k !== i) })} className="flex size-5 items-center justify-center rounded text-ink-subtle hover:text-ink">
                        <X className="size-3" />
                    </button>
                </div>
            ))}
            {adding ? (
                <form
                    className="flex gap-1"
                    onSubmit={(e) => {
                        e.preventDefault();
                        const v = url.trim();
                        if (v) onChange({ docLinks: [...links, { url: /^[a-z]+:/i.test(v) ? v : `https://${v}` }] });
                        setUrl("");
                        setAdding(false);
                    }}
                >
                    <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="https://" aria-label="Documentation link" className={`${field} h-6`} />
                    <button type="submit" className="h-6 rounded-md bg-brand-500 px-2 text-white">
                        Add
                    </button>
                </form>
            ) : (
                <button type="button" onClick={() => setAdding(true)} className="flex h-6 items-center gap-1 text-ink-muted hover:text-ink">
                    <Plus className="size-3" /> Add link
                </button>
            )}
        </div>
    );
}
