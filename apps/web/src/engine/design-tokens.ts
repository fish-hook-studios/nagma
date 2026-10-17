import { strToU8, zipSync } from "fflate";
import type { LibraryManifest } from "./library-types";
import type { Variable, VariableCollection, VariableValue } from "./types";

// A published library's variables and colour and text styles as design tokens: a tokens.json in the
// common $type/$value shape and the same values as CSS custom properties, packed as a package.

export interface TokenSet {
    $description: string;
    collections: Record<string, { modes: string[]; tokens: Record<string, { $type: string; $value: unknown; modes?: Record<string, unknown> }> }>;
    styles: { colors: Record<string, { $type: "color"; $value: string }>; typography: Record<string, { $type: "typography"; $value: Record<string, unknown> }> };
}

const kebab = (s: string) =>
    s
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/[^A-Za-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "token";
const path = (name: string) => name.split("/").map((p) => p.trim()).filter(Boolean).join(".");
const cssName = (collection: string, name: string) => `--${kebab(collection)}-${name.split("/").map(kebab).join("-")}`;
const TYPES: Record<Variable["type"], string> = { color: "color", number: "number", string: "string", boolean: "boolean", easing: "cubicBezier", timing: "duration" };

function refOf(all: Map<string, { collection: VariableCollection; variable: Variable }>, id: string) {
    const hit = all.get(id);
    return hit ? { token: `{${path(hit.collection.name)}.${path(hit.variable.name)}}`, css: `var(${cssName(hit.collection.name, hit.variable.name)})` } : null;
}

function jsonValue(all: Map<string, { collection: VariableCollection; variable: Variable }>, v: VariableValue | undefined): unknown {
    if (v && typeof v === "object" && "alias" in v) return refOf(all, v.alias)?.token ?? null;
    return v ?? null;
}

function cssValue(all: Map<string, { collection: VariableCollection; variable: Variable }>, variable: Variable, v: VariableValue | undefined): string | null {
    if (v === undefined || v === null) return null;
    if (typeof v === "object" && "alias" in v) return refOf(all, v.alias)?.css ?? null;
    if (variable.type === "number") return `${v}`;
    if (variable.type === "string") return JSON.stringify(String(v));
    if (variable.type === "boolean") return v ? "1" : "0";
    return String(v);
}

export function buildTokens(manifest: LibraryManifest): { tokens: TokenSet; css: string; counts: { colors: number; texts: number; variables: number } } {
    const all = new Map<string, { collection: VariableCollection; variable: Variable }>();
    for (const c of manifest.variables) for (const v of c.variables) all.set(v.id, { collection: c, variable: v });
    const tokens: TokenSet = { $description: `Design tokens from ${manifest.name}, version ${manifest.version}`, collections: {}, styles: { colors: {}, typography: {} } };
    const root: string[] = [];
    const modeBlocks: string[] = [];
    let variables = 0;
    for (const c of manifest.variables) {
        const defaultMode = c.defaultModeId ?? c.modes[0]?.id ?? "";
        const out: TokenSet["collections"][string] = { modes: c.modes.map((m) => m.name), tokens: {} };
        for (const v of c.variables) {
            variables++;
            const modes = c.modes.length > 1 ? Object.fromEntries(c.modes.map((m) => [m.name, jsonValue(all, v.values[m.id])])) : undefined;
            out.tokens[path(v.name)] = { $type: TYPES[v.type], $value: jsonValue(all, v.values[defaultMode]), ...(modes ? { modes } : {}) };
            const value = cssValue(all, v, v.values[defaultMode]);
            if (value !== null) root.push(`    ${v.codeSyntax?.web?.startsWith("--") ? v.codeSyntax.web : cssName(c.name, v.name)}: ${value};`);
        }
        for (const m of c.modes) {
            if (m.id === defaultMode) continue;
            const lines = c.variables.map((v) => {
                const value = cssValue(all, v, v.values[m.id]);
                return value === null ? null : `    ${cssName(c.name, v.name)}: ${value};`;
            });
            const kept = lines.filter((l): l is string => Boolean(l));
            if (kept.length) modeBlocks.push(`[data-${kebab(c.name)}="${kebab(m.name)}"] {\n${kept.join("\n")}\n}`);
        }
        tokens.collections[c.name] = out;
    }
    let colors = 0;
    let texts = 0;
    for (const s of manifest.styles) {
        if (s.kind === "color" && s.style.paint.type === "solid") {
            colors++;
            tokens.styles.colors[path(s.style.name)] = { $type: "color", $value: s.style.paint.color };
            root.push(`    --color-${s.style.name.split("/").map(kebab).join("-")}: ${s.style.paint.color};`);
        } else if (s.kind === "text") {
            texts++;
            const t = s.style;
            tokens.styles.typography[path(t.name)] = { $type: "typography", $value: { fontFamily: t.fontFamily, fontSize: t.fontSize, fontWeight: t.fontWeight, fontStyle: t.italic ? "italic" : "normal", lineHeight: t.lineHeight, letterSpacing: t.letterSpacing } };
            const base = `--text-${t.name.split("/").map(kebab).join("-")}`;
            root.push(`    ${base}-font-family: ${JSON.stringify(t.fontFamily)};`, `    ${base}-font-size: ${t.fontSize}px;`, `    ${base}-font-weight: ${t.fontWeight};`);
            if (t.lineHeight !== null) root.push(`    ${base}-line-height: ${t.lineHeight}px;`);
        }
    }
    const css = [`/* ${tokens.$description} */`, `:root {\n${root.join("\n")}\n}`, ...modeBlocks].join("\n\n") + "\n";
    return { tokens, css, counts: { colors, texts, variables } };
}

// The package as a zip: package.json, tokens.json, tokens.css and a short README.
export function packageZip(name: string, version: string, tokens: unknown, css: string): Blob {
    const pkg = { name, version, description: "Design tokens published from Nagma", main: "tokens.json", style: "tokens.css", files: ["tokens.json", "tokens.css"], license: "UNLICENSED" };
    const readme = `# ${name}\n\nDesign tokens published from Nagma.\n\n- \`tokens.json\`: every variable and style as $type/$value tokens.\n- \`tokens.css\`: the same values as CSS custom properties.\n\n\`\`\`css\n@import "${name}/tokens.css";\n\`\`\`\n`;
    const zip = zipSync({
        [`package/package.json`]: strToU8(`${JSON.stringify(pkg, null, 2)}\n`),
        [`package/tokens.json`]: strToU8(`${JSON.stringify(tokens, null, 2)}\n`),
        [`package/tokens.css`]: strToU8(css),
        [`package/README.md`]: strToU8(readme),
    });
    return new Blob([zip as BlobPart], { type: "application/zip" });
}

export function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
