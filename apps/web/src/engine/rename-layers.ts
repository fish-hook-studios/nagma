// The Rename layers dialog's state and naming rules (the dialog itself is components/rename-dialog.tsx).
let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const renameDialog = {
    isOpen: () => open,
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

export function openRenameDialog() {
    open = true;
    emit();
}

export function closeRenameDialog() {
    open = false;
    emit();
}

// Tokens the "Rename to" field accepts: the current name, and a number counting up or down.
export const RENAME_TOKENS: { label: string; token: string }[] = [
    { label: "Current name", token: "$&" },
    { label: "Number ↑", token: "$nn" },
    { label: "Number ↓", token: "$NN" },
];

// Expands the tokens for one layer: its name, and its number counting up or down from `start`.
function expand(template: string, name: string, index: number, count: number, start: number): string {
    const up = start + index;
    const down = start + count - 1 - index;
    const width = String(start + count - 1).length;
    return template
        .replace(/\$nn/g, String(up).padStart(width, "0"))
        .replace(/\$NN/g, String(down).padStart(width, "0"))
        .replace(/\$n/g, String(up))
        .replace(/\$N/g, String(down))
        .replace(/\$&/g, () => name);
}

export function previewNames(names: string[], renameTo: string, match: string, regex: boolean, start: number): { from: string; to: string }[] {
    let matcher: RegExp | null = null;
    if (match) {
        try {
            matcher = regex ? new RegExp(match, "g") : new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
        } catch {
            matcher = null;
        }
    }
    return names.map((from, i) => {
        const replacement = expand(renameTo, from, i, names.length, start);
        if (match && !matcher) return { from, to: from };
        if (matcher) {
            matcher.lastIndex = 0;
            // The matched text stands in for the current name inside the replacement.
            const to = from.replace(matcher, (hit) => expand(renameTo, hit, i, names.length, start));
            return { from, to };
        }
        return { from, to: renameTo ? replacement : from };
    });
}

