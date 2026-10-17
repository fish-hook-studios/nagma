#!/usr/bin/env node
// Nagma MCP server: a Model Context Protocol server over stdio that lets coding agents read Nagma
// designs. It talks to a Nagma sync server's read-only API with a personal access token.
//
//   NAGMA_URL=http://localhost:8787 NAGMA_TOKEN=<token from Account settings › Tokens> node apps/mcp/src/server.mjs
//
// Messages are JSON-RPC 2.0, one per line, on stdin and stdout; logs go to stderr. Every tool is
// read-only: the token can't change files.
// First: settings under the product's old name are read as NAGMA_* (legacy-env.mjs).
import "./legacy-env.mjs";
import { createInterface } from "node:readline";
import { client, parseTarget } from "./api.mjs";
import { codeFor, fileSummary, nodeDetails, outline, svgFor, variablesFor } from "./design.mjs";

const PROTOCOL = "2025-06-18";
const SERVER = { name: "nagma", version: "0.1.0" };
const api = client();

const fileArg = { type: "string", description: "A file id, or a Nagma link to the file (a link to a layer selects that layer)." };
const nodeArg = { type: "string", description: "A layer id. Optional when the link names a layer." };

const TOOLS = [
    { name: "get_me", description: "Who the token belongs to.", inputSchema: { type: "object", properties: {} } },
    { name: "list_files", description: "The Nagma files the token's owner can open, newest first.", inputSchema: { type: "object", properties: { query: { type: "string", description: "Only files whose name contains this." } } } },
    { name: "get_file", description: "A file's pages, top-level frames, components and layer counts, with an outline of the first page.", inputSchema: { type: "object", properties: { file: fileArg, depth: { type: "number", description: "How deep the outline goes (default 2)." } }, required: ["file"] } },
    { name: "get_node", description: "A layer's properties (position, size, fills, strokes, auto layout, text, effects, variables, Code Connect) and an outline of what is inside it.", inputSchema: { type: "object", properties: { file: fileArg, node: nodeArg, depth: { type: "number", description: "How deep the outline goes (default 3)." } }, required: ["file"] } },
    { name: "get_selection", description: "What the token's owner has selected in the file in an open Nagma editor right now.", inputSchema: { type: "object", properties: { file: fileArg }, required: ["file"] } },
    { name: "get_code", description: "Code for a layer and its children: React (JSX with inline styles), HTML with a stylesheet, or CSS.", inputSchema: { type: "object", properties: { file: fileArg, node: nodeArg, language: { type: "string", enum: ["react", "html", "css"], description: "Default react." } }, required: ["file"] } },
    { name: "get_variables", description: "Variables (with their values per mode and code syntax) and styles: the ones a layer uses, or the whole file's.", inputSchema: { type: "object", properties: { file: fileArg, node: { type: "string", description: "A layer id; leave out for the whole file." } }, required: ["file"] } },
    { name: "get_screenshot", description: "A picture of a layer (or a page) as SVG.", inputSchema: { type: "object", properties: { file: fileArg, node: nodeArg }, required: ["file"] } },
];

const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });

async function loadDoc(args) {
    const target = parseTarget(args.file, args.node);
    if (!target.file) throw new Error("Give a file id or a Nagma link.");
    const data = await api.file(target.file, target.key);
    return { ...target, doc: data.document, name: data.name };
}

function needNode(doc, node) {
    const id = node ?? null;
    if (!id) throw new Error("Give a layer id (node), or a link to a layer.");
    if (!doc.nodes[id]) throw new Error(`No layer ${id} in this file.`);
    return id;
}

async function callTool(name, args = {}) {
    switch (name) {
        case "get_me":
            return text(await api.me());
        case "list_files": {
            const { files } = await api.files();
            const q = String(args.query ?? "").toLowerCase();
            return text(files.filter((f) => !q || f.name.toLowerCase().includes(q)).map((f) => ({ id: f.id, name: f.name, kind: f.kind, role: f.role, updatedAt: new Date(f.updatedAt).toISOString() })));
        }
        case "get_file": {
            const { doc } = await loadDoc(args);
            const summary = fileSummary(doc);
            const first = doc.roots?.[0];
            return text(`${JSON.stringify(summary, null, 2)}\n\nOutline of the first page:\n${first ? outline(doc, first, Number(args.depth ?? 2)) : "(empty)"}`);
        }
        case "get_node": {
            const { doc, node } = await loadDoc(args);
            const id = needNode(doc, node);
            return text(`${JSON.stringify(nodeDetails(doc, doc.nodes[id]), null, 2)}\n\nOutline:\n${outline(doc, id, Number(args.depth ?? 3))}`);
        }
        case "get_selection": {
            const target = parseTarget(args.file);
            const sel = await api.selection(target.file);
            if (!sel.open) return text("The file isn't open in a Nagma editor signed in as the token's owner.");
            if (!sel.selection.length) return text("Nothing is selected.");
            const out = sel.selection.map((id) => {
                const doc = { nodes: sel.nodes[id]?.nodes ?? {} };
                return { ...nodeDetails(doc, doc.nodes[id]), outline: outline(doc, id, 2) };
            });
            return text(out);
        }
        case "get_code": {
            const { doc, node } = await loadDoc(args);
            const id = needNode(doc, node);
            const language = ["react", "html", "css"].includes(args.language) ? args.language : "react";
            return text(codeFor(doc, id, language));
        }
        case "get_variables": {
            const { doc, node } = await loadDoc(args);
            if (node && !doc.nodes[node]) throw new Error(`No layer ${node} in this file.`);
            return text(variablesFor(doc, node ?? null));
        }
        case "get_screenshot": {
            const { doc, node } = await loadDoc(args);
            const id = node ?? doc.roots?.[0];
            if (!id || !doc.nodes[id]) throw new Error("No such layer.");
            const svg = svgFor(doc, id);
            return { content: [{ type: "image", data: Buffer.from(svg).toString("base64"), mimeType: "image/svg+xml" }, { type: "text", text: `SVG of "${doc.nodes[id].name}" (${svg.length} bytes).` }] };
        }
        default:
            throw Object.assign(new Error(`Unknown tool ${name}.`), { code: -32602 });
    }
}

function send(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(msg) {
    const { id, method, params } = msg;
    const reply = (result) => id !== undefined && send({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => id !== undefined && send({ jsonrpc: "2.0", id, error: { code, message } });
    try {
        switch (method) {
            case "initialize":
                return reply({ protocolVersion: params?.protocolVersion === "2024-11-05" ? "2024-11-05" : PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: "Read Nagma design files: list_files, then get_file, get_node, get_code, get_variables and get_screenshot with a file id or a Nagma link. Everything is read-only." });
            case "notifications/initialized":
            case "notifications/cancelled":
                return;
            case "ping":
                return reply({});
            case "tools/list":
                return reply({ tools: TOOLS });
            case "tools/call":
                try {
                    return reply(await callTool(params?.name, params?.arguments ?? {}));
                } catch (error) {
                    if (error?.code === -32602) return fail(-32602, error.message);
                    // Tool failures are results the model can read, not protocol errors.
                    return reply({ content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true });
                }
            default:
                return fail(-32601, `Method not found: ${method}`);
        }
    } catch (error) {
        fail(-32603, error instanceof Error ? error.message : String(error));
    }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
        msg = JSON.parse(line);
    } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        return;
    }
    void handle(msg);
});
rl.on("close", () => process.exit(0));
console.error(`Nagma MCP server ready (${api.base}).`);
