import type { VersionMeta } from "./collab";

// "Today, 3:40 PM" / "Oct 12, 3:40 PM", as version history lists them.
export function when(ms: number) {
    const date = new Date(ms);
    const today = new Date();
    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (date.toDateString() === today.toDateString()) return `Today, ${time}`;
    const yesterday = new Date(today.getTime() - 86400000);
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
    return `${date.toLocaleDateString([], { month: "short", day: "numeric", ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) })}, ${time}`;
}

export function versionTitle(v: VersionMeta): string {
    return v.name ?? v.label ?? (v.auto ? "Autosave" : "Saved version");
}
