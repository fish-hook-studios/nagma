import { useEffect, useState } from "react";
import { authHeaders } from "./auth";
import { collab, currentLinkKey, useCollab } from "./collab";
import type { Person } from "./comments";
import { httpBase } from "./server-url";

// Everyone who can be @mentioned in a file: people with access (owner, invited, the project's team),
// whoever is here now, and anyone who has commented.

let cache: { fileId: string; people: Person[] } | null = null;

async function fetchPeople(fileId: string): Promise<Person[]> {
    try {
        const key = currentLinkKey();
        const res = await fetch(`${httpBase()}/files/${fileId}/people${key ? `?key=${encodeURIComponent(key)}` : ""}`, { headers: authHeaders() });
        if (!res.ok) return [];
        const list = (await res.json()) as { id: string; name: string; color: string; email?: string; group?: boolean; count?: number }[];
        return list.map((p) => ({ uid: p.id, name: p.name, color: p.color, email: p.email, group: p.group, count: p.count }));
    } catch {
        return [];
    }
}

export function usePeople(): Person[] {
    const fileId = useCollab((s) => (s.status === "live" ? s.fileId : null));
    const peers = useCollab((s) => s.peers);
    const comments = useCollab((s) => s.comments);
    const me = useCollab((s) => s.me);
    const [server, setServer] = useState<Person[]>(cache && cache.fileId === fileId ? cache.people : []);
    useEffect(() => {
        if (!fileId) return;
        let live = true;
        void fetchPeople(fileId).then((people) => {
            cache = { fileId, people };
            if (live) setServer(people);
        });
        return () => {
            live = false;
        };
    }, [fileId]);
    const out = new Map<string, Person>();
    for (const p of server) out.set(p.uid, p);
    for (const p of Object.values(peers)) {
        const uid = (p as { accountId?: string }).accountId ?? `peer:${p.userId}`;
        if (!out.has(uid) && p.name) out.set(uid, { uid, name: p.name, color: p.color });
    }
    for (const c of comments) {
        for (const m of [c, ...c.replies]) if (m.author.uid && !out.has(m.author.uid)) out.set(m.author.uid, { uid: m.author.uid, name: m.author.name, color: m.author.color });
    }
    // @everyone reaches everyone with access (the server adds @team and user groups when there are any).
    if (!out.has("group:everyone")) out.set("group:everyone", { uid: "group:everyone", name: "everyone", color: "#9747FF", group: true, count: [...out.values()].filter((p) => !p.group).length });
    const myUid = collab.get().uid ?? collab.get().accountId;
    if (myUid && !out.has(myUid)) out.set(myUid, { uid: myUid, name: me.name || "You", color: me.color });
    return [...out.values()].sort((a, b) => Number(Boolean(a.group)) - Number(Boolean(b.group)) || a.name.localeCompare(b.name));
}
