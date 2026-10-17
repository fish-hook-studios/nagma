import { Fragment } from "react";

// A flow's description with light formatting: **bold**, *italic*, `code`, [links](https://…) and
// bare links, and lines starting with "- " as a list. Built as elements, never as HTML.

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+)/g;

function inline(text: string, linkClass: string): React.ReactNode[] {
    return text.split(INLINE).map((part, i) => {
        if (!part) return null;
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-black/10 px-0.5 font-mono">{part.slice(1, -1)}</code>;
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
        const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
        if (link)
            return (
                <a key={i} href={link[2]} target="_blank" rel="noreferrer" className={linkClass}>
                    {link[1]}
                </a>
            );
        if (/^https?:\/\//.test(part))
            return (
                <a key={i} href={part} target="_blank" rel="noreferrer" className={linkClass}>
                    {part}
                </a>
            );
        return <Fragment key={i}>{part}</Fragment>;
    });
}

export function FlowDescription({ text, className = "", linkClass = "underline" }: { text: string; className?: string; linkClass?: string }) {
    const lines = text.split("\n");
    const blocks: React.ReactNode[] = [];
    let list: string[] = [];
    const flush = (key: number) => {
        if (!list.length) return;
        blocks.push(
            <ul key={`l${key}`} className="list-disc pl-4">
                {list.map((item, i) => (
                    <li key={i}>{inline(item, linkClass)}</li>
                ))}
            </ul>,
        );
        list = [];
    };
    lines.forEach((line, i) => {
        const item = /^\s*[-•]\s+(.*)$/.exec(line);
        if (item) list.push(item[1] as string);
        else {
            flush(i);
            if (line.trim()) blocks.push(<p key={i}>{inline(line, linkClass)}</p>);
        }
    });
    flush(lines.length);
    return <div className={className}>{blocks}</div>;
}
