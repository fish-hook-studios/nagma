import { strToU8, zipSync } from "fflate";
import { PREVIEW_RUNTIME } from "./runtime";

// Runs a Make project in the browser without a build server. Each source file is transformed on
// its own (TypeScript and JSX, by sucrase) into an ES module; local imports are rewritten to
// "@app/<path>" names that an import map points at the modules, and npm packages are mapped to a
// CDN that serves them as ES modules. The preview inlines every module as a data URL; a published
// app gets them as separate files.

export const REACT_VERSION = "19.2.0";
const CDN = "https://esm.sh";
const TAILWIND = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.11/dist/index.global.js";

type Sucrase = typeof import("sucrase");
let sucrase: Promise<Sucrase> | null = null;
export const loadCompiler = () => (sucrase ??= import("sucrase"));

const CODE = /\.(tsx|ts|jsx|js|mjs)$/;
const EXTS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json", ".css"];

function dirname(path: string) {
    const at = path.lastIndexOf("/");
    return at < 0 ? "" : path.slice(0, at);
}

function joinPath(base: string, rel: string): string {
    const out: string[] = base ? base.split("/") : [];
    for (const part of rel.split("/")) {
        if (part === "" || part === ".") continue;
        if (part === "..") out.pop();
        else out.push(part);
    }
    return out.join("/");
}

// A local import's file: as written, with an extension added, or a folder's index.
export function resolveLocal(from: string, spec: string, files: Record<string, string>): string | null {
    let base: string;
    if (spec.startsWith("@/")) base = joinPath("src", spec.slice(2));
    else if (spec.startsWith("/")) base = joinPath("", spec.slice(1));
    else if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") base = joinPath(dirname(from), spec);
    else return null;
    if (base in files) return base;
    for (const ext of EXTS) if (base + ext in files) return base + ext;
    // "./Button.js" written for a Button.tsx file.
    const bare = base.replace(/\.(js|jsx|mjs)$/, "");
    if (bare !== base) for (const ext of [".tsx", ".ts"]) if (bare + ext in files) return bare + ext;
    for (const ext of [".tsx", ".ts", ".jsx", ".js"]) if (`${base}/index${ext}` in files) return `${base}/index${ext}`;
    return null;
}

const isLocal = (spec: string) => spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/");
export const packageName = (spec: string) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : (spec.split("/")[0] ?? spec));

function dependencies(files: Record<string, string>): Record<string, string> {
    try {
        const pkg = JSON.parse(files["package.json"] ?? "{}") as { dependencies?: Record<string, string> };
        return pkg.dependencies ?? {};
    } catch {
        return {};
    }
}

function utf8Base64(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

const TAILWIND_AT = /@import\s+["']tailwindcss[^"']*["'][^;]*;|@tailwind\s+[a-z-]+\s*;/g;
const usesTailwindRules = (css: string) => /@theme|@apply|@utility|@custom-variant|@plugin|@import\s+["']tailwindcss/.test(css);

function cssModule(path: string, css: string): string {
    const kind = usesTailwindRules(css) ? "text/tailwindcss" : "text/css";
    const body = kind === "text/tailwindcss" ? css.replace(/@import\s+["']tailwindcss[^"']*["'][^;]*;/g, "") : css.replace(TAILWIND_AT, "");
    return `const s=document.querySelector('style[data-mk=${JSON.stringify(path)}]')||document.createElement("style");s.setAttribute("data-mk",${JSON.stringify(path)});s.setAttribute("type",${JSON.stringify(kind)});s.textContent=${JSON.stringify(body)};document.head.appendChild(s);export default ${JSON.stringify(body)};`;
}

const ASSET_TYPES: Record<string, string> = { svg: "image/svg+xml", txt: "text/plain", md: "text/markdown" };

export interface CompiledProject {
    // Module name ("@app/src/App.tsx") to code.
    modules: Map<string, string>;
    entry: string;
    // Specifier to CDN URL, for npm packages.
    packages: Record<string, string>;
    errors: string[];
    // The page around the app: index.html's head and body without its module scripts.
    head: string;
    body: string;
    // Stylesheets nothing imports (the design system's) are added to the page.
    extraCss: string[];
}

// The entry module: index.html's module script, or a usual main file, or a made-up one around App.
function findEntry(files: Record<string, string>): { entry: string; head: string; body: string; synthetic?: string } {
    let head = '<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>App</title>';
    let body = '<div id="root"></div>';
    let fromHtml: string | null = null;
    const html = files["index.html"];
    if (html) {
        const parsed = new DOMParser().parseFromString(html, "text/html");
        for (const script of [...parsed.querySelectorAll("script")]) {
            const src = script.getAttribute("src");
            if (script.type === "module" && src && !/^https?:/.test(src)) {
                fromHtml ??= resolveLocal("index.html", src.startsWith("/") || src.startsWith(".") ? src : `./${src}`, files);
                script.remove();
            } else if (script.type === "module" && !src) script.remove();
        }
        head = parsed.head.innerHTML;
        body = parsed.body.innerHTML || body;
    }
    const entry = fromHtml ?? ["src/main.tsx", "src/main.jsx", "src/index.tsx", "src/main.ts", "src/index.jsx", "main.tsx", "index.tsx"].find((p) => p in files);
    if (entry) return { entry, head, body };
    const app = ["src/App.tsx", "src/App.jsx", "App.tsx"].find((p) => p in files);
    const synthetic = app ? `import { createRoot } from "react-dom/client";\nimport App from "./${app.replace(/^src\//, "").replace(/\.(tsx|jsx)$/, "")}";\ncreateRoot(document.getElementById("root")!).render(<App />);\n` : `document.getElementById("root")!.textContent = "Nothing to show yet.";\n`;
    return { entry: "src/__entry.tsx", head, body, synthetic };
}

export async function compileProject(source: Record<string, string>, options: { dev: boolean }): Promise<CompiledProject> {
    const { transform } = await loadCompiler();
    const found = findEntry(source);
    const files = found.synthetic ? { ...source, [found.entry]: found.synthetic } : source;
    const deps = dependencies(files);
    const modules = new Map<string, string>();
    const packages: Record<string, string> = {};
    const errors: string[] = [];
    const imported = new Set<string>();
    const rewrite = (from: string, code: string) =>
        code.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bexport\s*\*\s*from\s*)(["'])([^"'\n]+)\2/g, (whole, lead: string, quote: string, spec: string) => {
            if (/^(https?:|data:|blob:)/.test(spec)) return whole;
            if (isLocal(spec)) {
                const target = resolveLocal(from, spec, files);
                if (!target) {
                    errors.push(`${from}: can't find "${spec}".`);
                    return whole;
                }
                imported.add(target);
                return `${lead}${quote}@app/${target}${quote}`;
            }
            const name = packageName(spec);
            if (name !== "react" && name !== "react-dom") {
                const version = deps[name];
                const sub = spec.slice(name.length);
                packages[spec] = `${CDN}/${name}${version ? `@${encodeURIComponent(version).replace(/%5E/g, "^")}` : ""}${sub}?external=react,react-dom`;
            }
            return whole;
        });
    for (const [path, text] of Object.entries(files)) {
        try {
            if (CODE.test(path)) {
                const transforms: ("typescript" | "jsx")[] = path.endsWith(".ts") ? ["typescript"] : path.endsWith(".tsx") ? ["typescript", "jsx"] : ["jsx"];
                const out = transform(text, { transforms, jsxRuntime: "automatic", production: !options.dev, filePath: path, preserveDynamicImport: true });
                modules.set(`@app/${path}`, rewrite(path, out.code));
            } else if (path.endsWith(".css")) modules.set(`@app/${path}`, cssModule(path, text));
            else if (path.endsWith(".json") && path !== "package.json" && !path.startsWith("tsconfig")) modules.set(`@app/${path}`, `export default ${text.trim() || "null"};`);
            else {
                const ext = path.split(".").pop() ?? "";
                const type = ASSET_TYPES[ext];
                if (type) modules.set(`@app/${path}`, `export default ${JSON.stringify(`data:${type};charset=utf-8,${encodeURIComponent(text)}`)};`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${path}: ${message}`);
        }
    }
    // The design system's stylesheet is part of every page even when nothing imports it.
    const extraCss = ["src/design-system.css"].filter((p) => p in files && !imported.has(p)).map((p) => files[p] ?? "");
    return { modules, entry: `@app/${found.entry}`, packages, errors, head: found.head, body: found.body, extraCss };
}

function reactImports(dev: boolean, devRuntime: string | null): Record<string, string> {
    const v = REACT_VERSION;
    return {
        react: `${CDN}/react@${v}`,
        "react/jsx-runtime": `${CDN}/react@${v}/jsx-runtime`,
        ...(dev && devRuntime ? { "react/jsx-dev-runtime": devRuntime } : { "react/jsx-dev-runtime": `${CDN}/react@${v}/jsx-dev-runtime` }),
        "react-dom": `${CDN}/react-dom@${v}?external=react`,
        "react-dom/client": `${CDN}/react-dom@${v}/client?external=react,react-dom`,
    };
}

// In the preview, host elements carry their source line, so Point and edit can find them.
const DEV_RUNTIME = `import * as R from "react/jsx-runtime";
export const Fragment = R.Fragment;
export function jsxDEV(type, props, key, isStatic, source) {
  if (typeof type === "string" && source && props) props = Object.assign({}, props, { "data-mk-src": source.fileName + ":" + source.lineNumber });
  return isStatic ? R.jsxs(type, props, key) : R.jsx(type, props, key);
}`;

const dataUrl = (code: string) => `data:text/javascript;base64,${utf8Base64(code)}`;
const escapeScript = (text: string) => text.replace(/<\/script/gi, "<\\/script");

function page(head: string, body: string, importMap: Record<string, string>, entryScript: string, runtime: string | null, extraCss: string[]): string {
    return `<!doctype html>
<html>
<head>
${head}
<script type="importmap">${escapeScript(JSON.stringify({ imports: importMap }))}</script>
${runtime ? `<script>${escapeScript(runtime)}</script>` : ""}
<script async src="${TAILWIND}"></script>
${extraCss.map((css) => `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`).join("\n")}
</head>
<body>
${body}
<script type="module">${escapeScript(entryScript)}</script>
</body>
</html>`;
}

// The preview's whole page, with every module inlined.
export async function previewHtml(files: Record<string, string>): Promise<{ html: string; errors: string[] }> {
    const project = await compileProject(files, { dev: true });
    const map: Record<string, string> = { ...reactImports(true, dataUrl(DEV_RUNTIME)), ...project.packages };
    for (const [name, code] of project.modules) map[name] = dataUrl(code);
    const entry = `import(${JSON.stringify(project.entry)}).then(()=>window.__mkReady&&window.__mkReady(),(e)=>window.__mkFail&&window.__mkFail(e));`;
    return { html: page(project.head, project.body, map, entry, PREVIEW_RUNTIME, project.extraCss), errors: project.errors };
}

// A published app's files: index.html with an import map of relative module files.
export async function buildStatic(files: Record<string, string>): Promise<{ files: { path: string; content: string }[]; errors: string[] }> {
    const project = await compileProject(files, { dev: false });
    const map: Record<string, string> = { ...reactImports(false, null), ...project.packages };
    const out: { path: string; content: string }[] = [];
    for (const [name, code] of project.modules) {
        const path = `assets/${name.slice("@app/".length)}.js`;
        map[name] = `./${path}`;
        out.push({ path, content: code });
    }
    const entry = `import ${JSON.stringify(project.entry)};`;
    out.unshift({ path: "index.html", content: page(project.head, project.body, map, entry, null, project.extraCss) });
    return { files: out, errors: project.errors };
}

// The project as a zip that runs with a usual dev setup (the build files it's missing are added).
export function projectZip(name: string, files: Record<string, string>): Blob {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
    const all: Record<string, string> = { ...files };
    let pkg: { name?: string; private?: boolean; type?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
    try {
        pkg = JSON.parse(files["package.json"] ?? "{}") as typeof pkg;
    } catch {
        pkg = {};
    }
    pkg = {
        name: pkg.name ?? slug,
        private: true,
        type: "module",
        ...pkg,
        scripts: { dev: "vite", build: "tsc --noEmit && vite build", preview: "vite preview", ...pkg.scripts },
        dependencies: { react: `^${REACT_VERSION}`, "react-dom": `^${REACT_VERSION}`, ...pkg.dependencies },
        devDependencies: { "@types/react": "^19.2.0", "@types/react-dom": "^19.2.0", "@vitejs/plugin-react": "^5.0.0", "@tailwindcss/vite": "^4.1.11", tailwindcss: "^4.1.11", typescript: "~5.9.2", vite: "^7.1.0", ...pkg.devDependencies },
    };
    all["package.json"] = `${JSON.stringify(pkg, null, 2)}\n`;
    all["vite.config.ts"] ??= `import tailwindcss from "@tailwindcss/vite";\nimport react from "@vitejs/plugin-react";\nimport { defineConfig } from "vite";\nimport { fileURLToPath } from "node:url";\n\nexport default defineConfig({\n    plugins: [react(), tailwindcss()],\n    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },\n});\n`;
    all["tsconfig.json"] ??= `${JSON.stringify({ compilerOptions: { target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"], module: "ESNext", moduleResolution: "bundler", jsx: "react-jsx", strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, paths: { "@/*": ["./src/*"] } }, include: ["src"] }, null, 2)}\n`;
    all["index.html"] ??= `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${name}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`;
    // Tailwind classes work in the preview without setup; in the download, the stylesheet that pulls Tailwind in.
    if (!Object.values(all).some((t) => /@import\s+["']tailwindcss/.test(t))) all["src/tailwind.css"] = `@import "tailwindcss";\n`;
    const main = ["src/main.tsx", "src/main.jsx"].find((p) => p in all);
    if (main && all["src/tailwind.css"] && !/tailwind\.css/.test(all[main] ?? "")) all[main] = `import "./tailwind.css";\n${all[main]}`;
    if (main && all["src/design-system.css"] && !/design-system\.css/.test(all[main] ?? "")) all[main] = `import "./design-system.css";\n${all[main]}`;
    all["README.md"] ??= `# ${name}\n\nMade with Nagma Make.\n\n\`\`\`\nnpm install\nnpm run dev\n\`\`\`\n`;
    const entries: Record<string, Uint8Array> = {};
    for (const [path, text] of Object.entries(all)) entries[`${slug}/${path}`] = strToU8(text);
    return new Blob([zipSync(entries, { level: 6 }) as Uint8Array<ArrayBuffer>], { type: "application/zip" });
}
