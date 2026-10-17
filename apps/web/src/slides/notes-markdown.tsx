// Presenter notes are plain text with a little markdown: **bold**, *italic*, ~~struck~~, and
// lines starting with "- " or "1. " as lists. This draws them formatted for presenter view.

function inline(text: string, key: string): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    const re = /(\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = re.exec(text))) {
        if (m.index > last) out.push(text.slice(last, m.index));
        const k = `${key}-${n++}`;
        if (m[2] !== undefined) out.push(<strong key={k}>{m[2]}</strong>);
        else if (m[3] !== undefined) out.push(<s key={k}>{m[3]}</s>);
        else out.push(<em key={k}>{m[4] ?? m[5]}</em>);
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

export function NotesMarkdown({ text }: { text: string }) {
    const blocks: React.ReactNode[] = [];
    const lines = text.split("\n");
    let i = 0;
    while (i < lines.length) {
        const line = lines[i] ?? "";
        const bullet = /^\s*[-*•]\s+/;
        const numbered = /^\s*\d+[.)]\s+/;
        if (bullet.test(line) || numbered.test(line)) {
            const ordered = numbered.test(line);
            const pattern = ordered ? numbered : bullet;
            const items: React.ReactNode[] = [];
            while (i < lines.length && pattern.test(lines[i] ?? "")) {
                items.push(<li key={i}>{inline((lines[i] ?? "").replace(pattern, ""), `l${i}`)}</li>);
                i++;
            }
            blocks.push(ordered ? <ol key={`b${i}`} className="list-decimal pl-6">{items}</ol> : <ul key={`b${i}`} className="list-disc pl-6">{items}</ul>);
            continue;
        }
        blocks.push(line.trim() ? <p key={`p${i}`}>{inline(line, `p${i}`)}</p> : <div key={`p${i}`} className="h-3" />);
        i++;
    }
    return <div className="space-y-1">{blocks}</div>;
}
