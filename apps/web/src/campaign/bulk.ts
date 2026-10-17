import { nanoid } from "nanoid";
import { storeImage } from "../engine/image-store";
import { editor } from "../engine/store";
import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import { ASSET_GAP, applyValuesCommands, assetData, campaignPage, copyAsset, createCommands, executeArranged, fieldValuePatch, fieldsOf, layerData, pageData, pageDataCommand, rowsOf } from "./model";
import type { BulkSource, CampaignRow } from "./types";

// Bulk create: a spreadsheet's rows become assets made from a template, one per row, each field
// filled from the column mapped to it. The row remembers its data so running it again updates.

export interface Table {
    columns: string[];
    rows: string[][];
}

// CSV or TSV text (tabs win when the first line has any), with quoted cells and line breaks in them.
export function parseDelimited(text: string): Table {
    const clean = text.replace(/^﻿/, "");
    const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
    const sep = firstLine.includes("\t") ? "\t" : firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
    const out: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (quoted) {
            if (ch === '"' && clean[i + 1] === '"') {
                cell += '"';
                i++;
            } else if (ch === '"') quoted = false;
            else cell += ch;
            continue;
        }
        if (ch === '"' && cell === "") quoted = true;
        else if (ch === sep) {
            row.push(cell);
            cell = "";
        } else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && clean[i + 1] === "\n") i++;
            row.push(cell);
            out.push(row);
            row = [];
            cell = "";
        } else cell += ch;
    }
    if (cell !== "" || row.length) {
        row.push(cell);
        out.push(row);
    }
    return toTable(out);
}

function toTable(grid: string[][]): Table {
    const rows = grid.filter((r) => r.some((c) => c.trim() !== ""));
    const header = (rows[0] ?? []).map((c, i) => c.trim() || `Column ${i + 1}`);
    const width = Math.max(header.length, ...rows.map((r) => r.length));
    const columns = Array.from({ length: width }, (_, i) => header[i] ?? `Column ${i + 1}`);
    return { columns, rows: rows.slice(1).map((r) => columns.map((_, i) => (r[i] ?? "").trim())) };
}

// The first sheet of an .xlsx workbook: unzipped with fflate, cells read from the sheet XML with
// shared strings resolved. Formulas show their cached values.
export async function parseXlsx(bytes: Uint8Array): Promise<Table> {
    const { unzipSync, strFromU8 } = await import("fflate");
    const files = unzipSync(bytes, { filter: (f) => f.name.startsWith("xl/") });
    const xml = (name: string) => (files[name] ? new DOMParser().parseFromString(strFromU8(files[name] as Uint8Array), "application/xml") : null);
    const shared = xml("xl/sharedStrings.xml");
    const strings = shared ? Array.from(shared.getElementsByTagName("si")).map((si) => Array.from(si.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("")) : [];
    // The first sheet in workbook order.
    const workbook = xml("xl/workbook.xml");
    const rels = xml("xl/_rels/workbook.xml.rels");
    let sheetPath = "xl/worksheets/sheet1.xml";
    const first = workbook?.getElementsByTagName("sheet")[0];
    const rid = first?.getAttribute("r:id") ?? first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    if (rid && rels) {
        const rel = Array.from(rels.getElementsByTagName("Relationship")).find((r) => r.getAttribute("Id") === rid);
        const target = rel?.getAttribute("Target");
        if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    }
    const sheet = xml(sheetPath) ?? xml("xl/worksheets/sheet1.xml");
    if (!sheet) throw new Error("No worksheet in that file.");
    const grid: string[][] = [];
    for (const row of Array.from(sheet.getElementsByTagName("row"))) {
        const index = Number(row.getAttribute("r") ?? grid.length + 1) - 1;
        const cells: string[] = [];
        for (const c of Array.from(row.getElementsByTagName("c"))) {
            const ref = c.getAttribute("r") ?? "";
            const col = columnIndex(ref.replace(/\d+/g, "")) ?? cells.length;
            const type = c.getAttribute("t");
            const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
            let value = v;
            if (type === "s") value = strings[Number(v)] ?? "";
            else if (type === "inlineStr") value = Array.from(c.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("");
            else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
            cells[col] = value;
        }
        grid[index] = Array.from(cells, (c) => c ?? "");
    }
    return toTable(Array.from(grid, (r) => r ?? []));
}

function columnIndex(letters: string): number | null {
    if (!letters) return null;
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

export async function readTableFile(file: File): Promise<Table> {
    if (/\.xlsx$/i.test(file.name)) return parseXlsx(new Uint8Array(await file.arrayBuffer()));
    return parseDelimited(await file.text());
}

// A column per field, guessed from matching names.
export function guessMapping(fields: string[], columns: string[]): Record<string, string> {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const out: Record<string, string> = {};
    for (const field of fields) {
        const match = columns.find((c) => norm(c) === norm(field)) ?? columns.find((c) => norm(c).includes(norm(field)) || norm(field).includes(norm(c)));
        if (match) out[field] = match;
    }
    return out;
}

// Images for image fields: uploaded files by name (with or without extension), or URLs fetched now.
export type ImagePool = Map<string, string>;

export async function addUploadedImages(files: File[], pool: ImagePool, pending: Command[]) {
    for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const id = nanoid(12);
        pending.push({ type: "image.add", id, data: await storeImage(file) });
        pool.set(file.name.toLowerCase(), id);
        pool.set(file.name.replace(/\.[^.]+$/, "").toLowerCase(), id);
    }
}

async function resolveImage(value: string, pool: ImagePool, pending: Command[], failed: string[]): Promise<string | null> {
    const key = value.trim().toLowerCase();
    if (!key) return null;
    const known = pool.get(key) ?? pool.get(key.replace(/\.[^.]+$/, ""));
    if (known) return known;
    if (/^(https?:|data:)/i.test(value.trim())) {
        try {
            const res = await fetch(value.trim());
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            if (!blob.type.startsWith("image/")) throw new Error("not an image");
            const id = nanoid(12);
            pending.push({ type: "image.add", id, data: await storeImage(blob) });
            pool.set(key, id);
            return id;
        } catch {
            failed.push(value);
            return null;
        }
    }
    failed.push(value);
    return null;
}

// The values for one data row, by field name (image fields resolved to image ids).
async function valuesFor(doc: NagmaDocument, templateId: string, source: BulkSource, index: number, pool: ImagePool, pending: Command[], failed: string[]): Promise<Record<string, string>> {
    const row = source.rows[index] ?? [];
    const values: Record<string, string> = {};
    for (const node of fieldsOf(doc, templateId)) {
        const data = layerData(node);
        if (!data) continue;
        const column = source.mapping[data.field];
        if (!column) continue;
        const cell = row[source.columns.indexOf(column)] ?? "";
        if (data.type === "image") {
            const id = await resolveImage(cell, pool, pending, failed);
            if (id) values[data.field] = id;
        } else values[data.field] = cell;
    }
    return values;
}

function assetName(source: BulkSource, index: number, fallback: string): string {
    const col = source.nameColumn ? source.columns.indexOf(source.nameColumn) : -1;
    const cell = col >= 0 ? source.rows[index]?.[col]?.trim() : "";
    return cell || `${fallback} ${index + 1}`;
}

export interface BulkResult {
    created: number;
    updated: number;
    removed: number;
    failedImages: string[];
}

// Makes (or, for an existing bulk row, updates) one asset per data row.
export async function runBulk(source: BulkSource, options: { rowId?: string | null; rowName?: string; extraImages?: Command[]; pool?: ImagePool }): Promise<BulkResult> {
    const doc = editor.get().doc;
    const template = doc.nodes[source.templateId];
    const page = campaignPage(doc);
    if (!template || !page) throw new Error("The template is gone.");
    const pool = options.pool ?? new Map();
    const pending: Command[] = [...(options.extraImages ?? [])];
    const failed: string[] = [];
    const rows = pageData(doc).rows;
    let rowId = options.rowId ?? null;
    let nextRows: CampaignRow[];
    if (rowId && rows.some((r) => r.id === rowId)) nextRows = rows.map((r) => (r.id === rowId ? { ...r, bulk: source } : r));
    else {
        rowId = nanoid(8);
        nextRows = [...rows, { id: rowId, name: options.rowName?.trim() || `${template.name} × ${source.rows.length}`, bulk: source }];
    }
    const existing = new Map<number, SceneNode>();
    for (const view of rowsOf(doc)) {
        if (view.row.id !== rowId) continue;
        for (const asset of view.assets) {
            const index = assetData(asset)?.bulkIndex;
            if (typeof index === "number") existing.set(index, asset);
        }
    }
    const commands: Command[] = [];
    const created: string[] = [];
    let updated = 0;
    let x = 200000;
    for (let i = 0; i < source.rows.length; i++) {
        const values = await valuesFor(doc, template.id, source, i, pool, pending, failed);
        const name = assetName(source, i, template.name);
        const current = existing.get(i);
        if (current) {
            const changes = applyValuesCommands(doc, current.id, values);
            if (current.name !== name) changes.push({ type: "node.update", id: current.id, patch: { name } });
            if (changes.length) updated++;
            commands.push(...changes);
            existing.delete(i);
            continue;
        }
        const copies = copyAsset(doc, template.id, { x, y: 200000 }, { rowId, sourceId: template.id, bulkIndex: i }, name);
        x += template.w + ASSET_GAP;
        const root = copies[0];
        if (!root) continue;
        created.push(root.id);
        commands.push(...createCommands(withValues(copies, values)));
    }
    // Data rows that went away take their assets with them.
    const removed = [...existing.values()].map((a) => a.id);
    if (removed.length) commands.push({ type: "node.delete", ids: removed });
    const data = pageDataCommand(doc, { rows: nextRows });
    executeArranged([...pending, ...(data ? [data] : []), ...commands], created.length ? created : undefined);
    return { created: created.length, updated, removed: removed.length, failedImages: failed };
}

// Fresh copies with their fields filled in, before they're created.
function withValues(copies: SceneNode[], values: Record<string, string>): SceneNode[] {
    return copies.map((node) => {
        const data = layerData(node);
        const value = data ? values[data.field] : undefined;
        if (!data || value === undefined || value === "") return node;
        const patch = fieldValuePatch(node, data.type, value);
        return patch ? { ...node, ...patch } : node;
    });
}

// A preview of the first rows' values, by field.
export function previewRows(source: BulkSource, fields: string[], limit = 5): string[][] {
    return source.rows.slice(0, limit).map((row) => fields.map((f) => {
        const col = source.mapping[f];
        return col ? (row[source.columns.indexOf(col)] ?? "") : "";
    }));
}
