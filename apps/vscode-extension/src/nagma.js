// The extension's Nagma calls, without the editor API (so they can be tested on their own): the
// read-only /v1 API with a personal access token, and Inspect code from the shared reader in apps/mcp.
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let designModule = null;
function design() {
    designModule ??= import(pathToFileURL(path.join(__dirname, "..", "..", "mcp", "src", "design.mjs")).href);
    return designModule;
}

function api(serverUrl, token) {
    const base = String(serverUrl || "http://localhost:8787").replace(/\/$/, "");
    async function get(p) {
        if (!token) throw new Error("Set a personal access token first (Nagma: Set personal access token).");
        const res = await fetch(`${base}${p}`, { headers: { authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
        return data;
    }
    return {
        files: async () => (await get("/v1/files")).files,
        file: (id, key) => get(`/v1/files/${id}${key ? `?key=${encodeURIComponent(key)}` : ""}`),
    };
}

// A Nagma link (…?file=<id>&node-id=<id>) or a bare file id.
function parseLink(link) {
    const raw = String(link || "").trim();
    if (!/^https?:\/\//.test(raw)) return { file: raw, node: null, key: null };
    const url = new URL(raw);
    return { file: url.searchParams.get("file") || "", node: url.searchParams.get("node-id") || url.searchParams.get("focus"), key: url.searchParams.get("key") };
}

// Inspect for a link: the layer's properties and its code, as a Markdown document.
async function inspect(serverUrl, token, link, language = "react") {
    const target = parseLink(link);
    if (!target.file) throw new Error("That isn't a Nagma link.");
    const data = await api(serverUrl, token).file(target.file, target.key);
    const doc = data.document;
    const id = target.node && doc.nodes[target.node] ? target.node : (doc.nodes[doc.roots[0]]?.children ?? [])[0];
    if (!id) throw new Error("The file has no layers.");
    const { codeFor, nodeDetails, outline } = await design();
    const node = doc.nodes[id];
    const fence = language === "react" ? "tsx" : language;
    return [
        `# ${node.name}`,
        `${data.name}, ${node.type}, ${Math.round(node.w)} × ${Math.round(node.h)}`,
        "",
        "## Code",
        "```" + fence,
        codeFor(doc, id, language).trimEnd(),
        "```",
        "",
        "## Properties",
        "```json",
        JSON.stringify(nodeDetails(doc, node), null, 2),
        "```",
        "",
        "## Layers",
        "```",
        outline(doc, id, 3),
        "```",
        "",
    ].join("\n");
}

module.exports = { api, parseLink, inspect };
