// Loads PhotoCraft's engine (WebAssembly, built from engines/photo-wasm) on first use, so opening
// Nagma doesn't pay for it until someone edits a photo or drops in a PSD.

export interface PhotoCommand {
    id: string;
    label: string;
    menu: string[];
    shortcut: string | null;
    params: string;
}

export interface PhotoLayer {
    id: number;
    active: boolean;
    name: string;
    kind: string;
    visible: boolean;
    opacity: number;
    depth: number;
}

export interface PhotoDocument {
    width(): number;
    height(): number;
    render(): Uint8Array;
    execute(id: string, params: string): string;
    undo(): boolean;
    redo(): boolean;
    export(nameOrExt: string): Uint8Array;
    layers(): string;
    free(): void;
}

interface PhotoModule {
    PhotoDoc: new (name: string, bytes: Uint8Array) => PhotoDocument;
    commands(): string;
}

let loading: Promise<PhotoModule> | null = null;

export function loadPhotoEngine(): Promise<PhotoModule> {
    loading ??= (async () => {
        const glue = await import("./photo/nagma_photo.js");
        await glue.default({ module_or_path: new URL("./photo/nagma_photo_bg.wasm", import.meta.url) });
        return glue as unknown as PhotoModule;
    })();
    return loading;
}

let commandCache: PhotoCommand[] | null = null;

export async function photoCommands(): Promise<PhotoCommand[]> {
    const engine = await loadPhotoEngine();
    commandCache ??= JSON.parse(engine.commands()) as PhotoCommand[];
    return commandCache;
}

export function isPhotoshopFile(name: string): boolean {
    return /\.(psd|psb)$/i.test(name);
}

// A parameter from PhotoCraft's compact description, e.g. {"radius":0.1..1000=1,"mode":"fast"|"best"="fast"}.
export type ParamSpec =
    | { name: string; kind: "number"; min: number; max: number; value: number; step: number }
    | { name: string; kind: "bool"; value: boolean }
    | { name: string; kind: "choice"; options: string[]; value: string };

// Reads the settings PhotoCraft describes for a command. Only the first {...} block counts (notes and
// extra parts follow it); fields that need richer editors (json, ids, paths) are left out, so the
// command uses its own defaults for them. Returns [] when there's nothing to show.
export function parseParams(spec: string): ParamSpec[] {
    const open = spec.indexOf("{");
    if (open < 0) return [];
    let depth = 0;
    let end = -1;
    let quoted = false;
    for (let i = open; i < spec.length; i++) {
        const ch = spec[i];
        if (ch === '"') quoted = !quoted;
        if (quoted) continue;
        if (ch === "{" || ch === "[") depth++;
        if (ch === "}" || ch === "]") depth--;
        if (depth === 0) {
            end = i;
            break;
        }
    }
    const body = spec.slice(open + 1, end < 0 ? spec.length : end);
    // Split into "key": value entries at top-level commas.
    const entries: string[] = [];
    let current = "";
    depth = 0;
    quoted = false;
    for (const ch of body) {
        if (ch === '"') quoted = !quoted;
        if (!quoted && (ch === "{" || ch === "[")) depth++;
        if (!quoted && (ch === "}" || ch === "]")) depth--;
        if (!quoted && depth === 0 && ch === ",") {
            entries.push(current);
            current = "";
        } else current += ch;
    }
    if (current.trim()) entries.push(current);

    const out: ParamSpec[] = [];
    for (const entry of entries) {
        const m = /^\s*"([^"]+)"\s*:\s*(.+?)\s*$/s.exec(entry);
        if (!m) continue;
        const name = m[1] ?? "";
        // Notes in brackets after a value, e.g. "=foreground (contents=color)", aren't part of it.
        const rest = (m[2] ?? "").replace(/\s*\(.*\)\s*$/s, "").trim();
        const num = /^(-?[\d.]+)\.\.(-?[\d.]+)(?:=(-?[\d.]+))?$/.exec(rest);
        if (num) {
            const min = Number(num[1]);
            const max = Number(num[2]);
            const value = num[3] !== undefined ? Number(num[3]) : Math.max(min, Math.min(max, 0));
            const step = [num[1], num[2], num[3]].some((v) => v?.includes(".")) ? 0.01 : 1;
            out.push({ name, kind: "number", min, max, value, step });
            continue;
        }
        const bool = /^bool(?:=(true|false))?$/.exec(rest) ?? /^(true|false)$/.exec(rest);
        if (bool) {
            out.push({ name, kind: "bool", value: (bool[1] ?? "false") === "true" });
            continue;
        }
        // Choices: "a"|"b"|"c"="b", or "a|b|c"="b".
        const choice = /^((?:"[^"]*"\|?)+)(?:="([^"]*)")?$/.exec(rest);
        if (choice) {
            const quotedOptions = [...(choice[1] ?? "").matchAll(/"([^"]*)"/g)].map((x) => x[1] ?? "");
            const options = quotedOptions.length === 1 && quotedOptions[0]?.includes("|") ? (quotedOptions[0] ?? "").split("|") : quotedOptions;
            if (options.every((o) => /^[A-Za-z][\w-]*$/.test(o))) {
                out.push({ name, kind: "choice", options, value: choice[2] && options.includes(choice[2]) ? choice[2] : (options[0] ?? "") });
            }
        }
    }
    return out;
}
