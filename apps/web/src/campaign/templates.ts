import { nanoid } from "nanoid";
import { useSyncExternalStore } from "react";
import { authHeaders } from "../engine/auth";
import { applyCommand } from "../engine/commands";
import { collab, currentLinkKey } from "../engine/collab";
import { imageDataUrl, preloadImages, storeDataUrl } from "../engine/image-store";
import { httpBase } from "../engine/server-url";
import { editor } from "../engine/store";
import type { Command, NagmaDocument, NodePatch, SceneNode } from "../engine/types";
import { renderAsset } from "./left-panel";
import { ASSET_GAP, assetData, campaignPage, createCommands, executeArranged, fieldValue, fieldValuePatch, fieldsOf, layerData, presetFor, rowsOf, starterNodes, type StarterLayout } from "./model";
import { resizedCopy } from "./resize";

// Templates beyond the file: a team's published templates (kept on the sync server, for anyone on
// the team to start from), publishing this file's templates there and taking them back, and
// Change layout, which rebuilds an asset in another template's layout with its content kept.

export interface TeamAssetTemplate {
    id: string;
    teamId: string;
    fileId: string;
    assetId: string;
    name: string;
    description: string;
    category: string;
    w: number;
    h: number;
    preset: string;
    thumb: string | null;
    version: number;
    publishedBy: { id: string; name: string } | null;
    publishedAt: number;
    updatedBy: { id: string; name: string } | null;
    updatedAt: number;
}

interface TemplatePayload {
    nodes: SceneNode[];
    images: Record<string, string>;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const key = currentLinkKey();
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${httpBase()}${path}${key ? `${sep}key=${encodeURIComponent(key)}` : ""}`, { ...init, headers: { "content-type": "application/json", ...authHeaders(), ...(init.headers ?? {}) } });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    return data;
}

// ---- The team's templates, as the Templates panel lists them ----

const lists = new Map<string, TeamAssetTemplate[]>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
    version++;
    for (const l of listeners) l();
};

export async function loadTeamAssetTemplates(teamId: string): Promise<TeamAssetTemplate[]> {
    const list = await api<TeamAssetTemplate[]>(`/asset-templates?team=${encodeURIComponent(teamId)}`);
    lists.set(teamId, list);
    emit();
    return list;
}

export function useTeamAssetTemplates(teamId: string | null): TeamAssetTemplate[] | null {
    useSyncExternalStore(
        (l) => (listeners.add(l), () => void listeners.delete(l)),
        () => version,
    );
    return teamId ? (lists.get(teamId) ?? null) : null;
}

const payloads = new Map<string, Promise<TeamAssetTemplate & { payload: TemplatePayload }>>();
function fullTemplate(t: TeamAssetTemplate) {
    const key = `${t.id}@${t.version}`;
    let p = payloads.get(key);
    if (!p) {
        p = api<TeamAssetTemplate & { payload: TemplatePayload }>(`/asset-templates/${t.id}`);
        payloads.set(key, p);
        p.catch(() => payloads.delete(key));
    }
    return p;
}

// ---- Publishing ----

// The asset's layers and the images they use (as data URLs), as a template carries them.
async function payloadOf(doc: NagmaDocument, assetId: string): Promise<TemplatePayload> {
    const nodes: SceneNode[] = [];
    const used = new Set<string>();
    const visit = (id: string) => {
        const n = doc.nodes[id];
        if (!n) return;
        nodes.push(n);
        for (const p of [...n.fills, ...n.strokes]) if (p.type === "image" && !p.video) used.add(p.id);
        for (const c of n.children) visit(c);
    };
    visit(assetId);
    const images: Record<string, string> = {};
    for (const id of used) {
        const data = await imageDataUrl(doc.images, id);
        if (data) images[id] = data;
    }
    return { nodes, images };
}

export function serverFile(): string | null {
    const s = collab.get();
    return s.status === "live" ? s.fileId : null;
}

// Publishes a template asset to a team, or updates it there when it's already published.
export async function publishTemplate(assetId: string, teamId: string, details: { name: string; description: string; category: string }) {
    const doc = editor.get().doc;
    const asset = doc.nodes[assetId];
    const data = assetData(asset);
    const fileId = serverFile();
    if (!asset || !data) throw new Error("That asset is gone.");
    if (!fileId) throw new Error("Move this campaign to the server before publishing its templates.");
    await preloadImages(doc.images);
    const id = data.published && data.published.teamId === teamId ? data.published.id : nanoid(16);
    const record = await api<TeamAssetTemplate>(`/asset-templates/${id}`, {
        method: "PUT",
        body: JSON.stringify({ teamId, fileId, assetId, ...details, w: asset.w, h: asset.h, preset: data.preset, thumb: renderAsset(doc, assetId, 320, 240), payload: await payloadOf(doc, assetId) }),
    });
    const now = editor.get().doc.nodes[assetId];
    const nowData = assetData(now);
    if (nowData) editor.execute({ type: "node.update", id: assetId, patch: { campaign: { ...nowData, template: true, published: { id: record.id, teamId, version: record.version } } } });
    void loadTeamAssetTemplates(teamId).catch(() => undefined);
    return record;
}

export async function unpublishTemplate(assetId: string) {
    const doc = editor.get().doc;
    const data = assetData(doc.nodes[assetId]);
    if (!data?.published) return;
    await api(`/asset-templates/${data.published.id}`, { method: "DELETE" });
    const teamId = data.published.teamId;
    editor.execute({ type: "node.update", id: assetId, patch: { campaign: { ...data, published: null } } });
    void loadTeamAssetTemplates(teamId).catch(() => undefined);
}

// ---- Bringing layers in ----

// Fresh copies of a template's layers with their root at (x, y) under `parentId`; the root's id
// can be given (Change layout keeps the asset's own).
function cloneLayers(nodes: SceneNode[], at: { x: number; y: number }, parentId: string, rootId = nanoid(10)): SceneNode[] {
    const root = nodes[0];
    if (!root) return [];
    const ids = new Map<string, string>(nodes.map((n, i) => [n.id, i === 0 ? rootId : nanoid(10)]));
    const dx = at.x - root.x;
    const dy = at.y - root.y;
    return nodes.map((n, i) => ({
        ...n,
        id: ids.get(n.id) as string,
        parentId: i === 0 ? parentId : (ids.get(n.parentId ?? "") ?? parentId),
        children: n.children.map((c) => ids.get(c)).filter((c): c is string => Boolean(c)),
        x: n.x + dx,
        y: n.y + dy,
    }));
}

// The images a template brings, stored in this browser and added to the file, under fresh ids.
async function imageCommands(images: Record<string, string>, nodes: SceneNode[]): Promise<{ commands: Command[]; nodes: SceneNode[] }> {
    const map = new Map<string, string>();
    const commands: Command[] = [];
    for (const [id, data] of Object.entries(images)) {
        const fresh = nanoid(12);
        map.set(id, fresh);
        commands.push({ type: "image.add", id: fresh, data: await storeDataUrl(data) });
    }
    const swap = (n: SceneNode): SceneNode => ({ ...n, fills: n.fills.map((p) => (p.type === "image" && map.has(p.id) ? { ...p, id: map.get(p.id) as string } : p)), strokes: n.strokes.map((p) => (p.type === "image" && map.has(p.id) ? { ...p, id: map.get(p.id) as string } : p)) });
    return { commands, nodes: nodes.map(swap) };
}

// Adds a team template to a row as a new template asset.
export async function addTeamTemplate(t: TeamAssetTemplate, rowId: string) {
    const full = await fullTemplate(t);
    const doc = editor.get().doc;
    const page = campaignPage(doc);
    if (!page) return;
    const view = rowsOf(doc).find((v) => v.row.id === rowId);
    const last = view?.assets.at(-1);
    const at = last ? { x: last.x + last.w + ASSET_GAP, y: last.y } : { x: 100000, y: 100000 };
    const { commands, nodes } = await imageCommands(full.payload.images, cloneLayers(full.payload.nodes, at, page.id));
    const root = nodes[0];
    if (!root) return;
    const data = assetData(root);
    root.campaign = { kind: "asset", preset: presetFor(t.preset) ? t.preset : (data?.preset ?? "custom"), rowId, template: true, sourceId: null, bulkIndex: null, published: null, fromTemplate: { id: t.id, teamId: t.teamId, version: t.version, name: t.name } };
    executeArranged([...commands, ...createCommands(nodes)], [root.id]);
}

// ---- Change layout ----

export type LayoutSource = { kind: "starter"; layout: StarterLayout } | { kind: "file"; assetId: string } | { kind: "team"; template: TeamAssetTemplate };

const SKIP_ROOT = new Set(["id", "type", "parentId", "children", "name", "campaign", "x", "y", "w", "h", "exportSettings", "comments", "variableModes"]);

// Rebuilds an asset in another layout: its layers are replaced by the layout's (fitted to the
// asset's size), and every field the two share keeps the asset's text, image or colour.
export async function applyLayout(assetId: string, source: LayoutSource) {
    const doc = editor.get().doc;
    const asset = doc.nodes[assetId];
    const data = assetData(asset);
    if (!asset || !data) return;
    // What the asset says now, by field name.
    const values: Record<string, string> = {};
    for (const n of fieldsOf(doc, assetId)) {
        const d = layerData(n);
        if (d && !(d.field in values)) values[d.field] = fieldValue(n, d.type);
    }
    let layers: SceneNode[];
    let extra: Command[] = [];
    if (source.kind === "starter") {
        const built = await starterNodes(doc, source.layout, asset.w, asset.h, { x: asset.x, y: asset.y }, asset.parentId ?? "", data);
        layers = cloneLayers(built.nodes, { x: asset.x, y: asset.y }, asset.parentId ?? "", assetId);
        extra = built.images;
    } else if (source.kind === "file") {
        const nodes: SceneNode[] = [];
        const visit = (id: string) => {
            const n = doc.nodes[id];
            if (!n) return;
            nodes.push(n);
            for (const c of n.children) visit(c);
        };
        visit(source.assetId);
        layers = cloneLayers(nodes, { x: asset.x, y: asset.y }, asset.parentId ?? "", assetId);
    } else {
        const full = await fullTemplate(source.template);
        const brought = await imageCommands(full.payload.images, cloneLayers(full.payload.nodes, { x: asset.x, y: asset.y }, asset.parentId ?? "", assetId));
        layers = brought.nodes;
        extra = brought.commands;
    }
    const root = layers[0];
    if (!root) return;
    const fitted = root.w === asset.w && root.h === asset.h ? layers : resizedCopy(layers, asset.w, asset.h);
    const [newRoot, ...children] = fitted;
    if (!newRoot) return;
    const filled = children.map((n) => {
        const d = layerData(n);
        const value = d ? values[d.field] : undefined;
        if (!d || value === undefined || value === "") return n;
        const patch = fieldValuePatch(n, d.type, value);
        return patch ? { ...n, ...patch } : n;
    });
    const patch: NodePatch = Object.fromEntries(Object.entries(newRoot).filter(([k]) => !SKIP_ROOT.has(k)));
    editor.execute({
        type: "batch",
        commands: [
            ...extra,
            ...(asset.children.length ? [{ type: "node.delete" as const, ids: [...asset.children] }] : []),
            { type: "node.update", id: assetId, patch: { ...patch, layout: newRoot.layout ?? null } as NodePatch },
            ...createCommands(filled),
        ],
    });
    editor.set({ selection: [assetId] });
}

// Pictures of the starter layouts at a size, for the Browse tab (drawn once per size).
const starterPictures = new Map<string, Promise<string>>();
export function starterPicture(layout: StarterLayout, w: number, h: number): Promise<string> {
    const key = `${layout}:${w}x${h}`;
    let p = starterPictures.get(key);
    if (!p) {
        p = (async () => {
            const doc = editor.get().doc;
            const page = campaignPage(doc);
            const built = await starterNodes(doc, layout, w, h, { x: 0, y: 0 }, page?.id ?? "", { kind: "asset", preset: "custom", rowId: "" });
            const images: Record<string, string> = { ...doc.images };
            for (const c of built.images) if (c.type === "image.add") images[c.id] = c.data;
            // Made through the commands, so auto layout places the layers as it will on the canvas.
            const scratch = applyCommand({ ...doc, images }, { type: "batch", commands: createCommands(built.nodes) });
            await preloadImages(images);
            // Pictures decode a moment after they load.
            await new Promise((resolve) => setTimeout(resolve, 800));
            return renderAsset(scratch, built.nodes[0]?.id ?? "", 240, 180);
        })();
        starterPictures.set(key, p);
    }
    return p;
}
