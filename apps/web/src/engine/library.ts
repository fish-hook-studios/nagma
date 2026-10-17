import { useSyncExternalStore } from "react";
import { hintMediaSource } from "./media";
import { auth } from "./auth";
import { type AssetEntry, type AssetSource, slashParts } from "./asset-tree";
import { reusableAssets } from "./components";
import { fileMeta } from "./files";
import { componentKey, imageKey, type LibraryComponentEntry, type LibraryItem, type LibraryManifest, type LibraryStyle, type LibrarySummary } from "./library-types";
import {
    deleteLocalItems,
    deleteLocalLibrary,
    localItems,
    localManifest,
    localManifests,
    publishToServer,
    saveLocalItems,
    saveLocalManifest,
    serverItems,
    serverManifest,
    serverManifests,
    unpublishFromServer,
} from "./library-store";
import { makeNode } from "./nodes";
import { swapComponent } from "./actions";
import { editor } from "./store";
import type { ColorStyle, Command, EffectStyle, LibraryLink, NagmaDocument, SceneNode, Styles, TextStyle, Variable, VariableCollection } from "./types";

// Libraries, the way the reference does them. A file publishes its components, styles and variables; other
// files enable the library and use them. Using a library component copies it (and whatever it
// depends on) onto the file's hidden internal page, keyed by the library and the component's id,
// so instances keep their link. When the library publishes again, files that use changed items
// are told and can review and accept the updates.

// ---- Hashing ----

function hash(text: string): string {
    // cyrb53: fast and well spread; good enough to spot changed content.
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---- What a file would publish ----

// The reference's rule for what a library leaves out: a component, component set, style or variable
// collection whose name starts with "." or "_", anything marked "Hide when publishing", and the
// variants of a hidden set. Hidden components still travel inside published components that use
// them (as dependencies), but subscribers can't insert them or find them in Assets.
export const isHiddenName = (name: string) => name.trim().startsWith(".") || name.trim().startsWith("_");

export function componentHidden(doc: NagmaDocument, node: SceneNode): boolean {
    if (isHiddenName(node.name) || node.hiddenFromPublishing) return true;
    const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    return Boolean(parent && parent.type === "componentSet" && componentHidden(doc, parent));
}

export function styleHidden(style: { name: string; hiddenFromPublishing?: boolean }): boolean {
    return Boolean(style.hiddenFromPublishing) || isHiddenName(style.name);
}

export interface HiddenItem {
    key: string;
    kind: "component" | "style" | "variables";
    id: string;
    name: string;
    // Hidden by its name (rename to publish) or by the Hide when publishing flag.
    reason: "name" | "flag" | "set";
    detail?: string;
}

// Hide when publishing / Show when publishing, as one undo step.
export function setHiddenFromPublishing(item: { kind: "component" | "style"; id: string }, hidden: boolean) {
    const { doc } = editor.get();
    if (item.kind === "component") {
        editor.execute({ type: "node.update", id: item.id, patch: { hiddenFromPublishing: hidden || undefined } });
        return;
    }
    const styles = doc.styles;
    if (!styles) return;
    const flip = <T extends { id: string; hiddenFromPublishing?: boolean }>(list: T[] | undefined): T[] | undefined => list?.map((st) => (st.id === item.id ? { ...st, hiddenFromPublishing: hidden || undefined } : st));
    editor.execute({ type: "styles.set", styles: { ...styles, colors: flip(styles.colors) ?? [], texts: flip(styles.texts) ?? [], effects: flip(styles.effects) } });
}

function internalPage(doc: NagmaDocument): SceneNode | undefined {
    for (const id of doc.roots) {
        const page = doc.nodes[id];
        if (page?.internal) return page;
    }
    return undefined;
}

function pageOfNode(doc: NagmaDocument, node: SceneNode): SceneNode | undefined {
    let current: SceneNode | undefined = node;
    while (current && current.type !== "page") current = current.parentId ? doc.nodes[current.parentId] : undefined;
    return current;
}

// The asset (set or standalone component) a component belongs to.
function assetRootOf(doc: NagmaDocument, id: string): string | null {
    const node = doc.nodes[id];
    if (!node || node.type !== "component") return null;
    const parent = doc.nodes[node.parentId ?? ""];
    return parent?.type === "componentSet" ? parent.id : node.id;
}

function subtree(doc: NagmaDocument, id: string): SceneNode[] {
    const out: SceneNode[] = [];
    const visit = (nodeId: string) => {
        const node = doc.nodes[nodeId];
        if (!node) return;
        out.push(node);
        node.children.forEach(visit);
    };
    visit(id);
    return out;
}

function componentRecord(doc: NagmaDocument, assetId: string): LibraryItem & { kind: "component" } {
    const nodes = subtree(doc, assetId);
    const deps = new Set<string>();
    const images = new Set<string>();
    const depOf = (id: unknown) => {
        if (typeof id !== "string") return;
        const root = assetRootOf(doc, id);
        if (root && root !== assetId) deps.add(root);
    };
    for (const node of nodes) {
        if (node.type === "instance") depOf(node.componentId);
        for (const value of Object.values(node.propValues ?? {})) depOf(value);
        for (const prop of node.componentProps ?? []) {
            if (prop.kind === "swap") depOf(prop.defaultValue);
            for (const p of prop.preferred ?? []) depOf(p);
        }
        for (const paint of [...node.fills, ...node.strokes]) if (paint.type === "image") images.add(paint.id);
    }
    return { kind: "component", nodes, deps: [...deps], images: [...images] };
}

function styleList(styles: Styles | undefined, hidden: HiddenItem[]): LibraryStyle[] {
    const out: LibraryStyle[] = [];
    const take = (kind: LibraryStyle["kind"], style: ColorStyle | TextStyle | EffectStyle) => {
        if (style.libraryId) return;
        if (styleHidden(style)) {
            hidden.push({ key: `s:${style.id}`, kind: "style", id: style.id, name: style.name, reason: style.hiddenFromPublishing ? "flag" : "name", detail: kind });
            return;
        }
        out.push({ kind, style, hash: hash(JSON.stringify(style)) } as LibraryStyle);
    };
    for (const style of styles?.colors ?? []) take("color", style);
    for (const style of styles?.texts ?? []) take("text", style);
    for (const style of styles?.effects ?? []) take("effect", style);
    return out;
}

// Collections named with "." or "_" stay out entirely; single variables can be hidden too.
function publishedCollections(doc: NagmaDocument, hidden: HiddenItem[]): VariableCollection[] {
    const out: VariableCollection[] = [];
    for (const c of doc.variables ?? []) {
        if (c.libraryId) continue;
        if (isHiddenName(c.name)) {
            hidden.push({ key: `v:${c.id}`, kind: "variables", id: c.id, name: c.name, reason: "name", detail: `${c.variables.length} variables` });
            continue;
        }
        out.push({ ...c, variables: c.variables.filter((v) => !v.hidden) });
    }
    return out;
}

export interface Snapshot {
    components: LibraryComponentEntry[];
    // Only built for components that changed (records are big).
    records: Map<string, LibraryItem & { kind: "component" }>;
    styles: LibraryStyle[];
    variables: VariableCollection[];
    variableHashes: Record<string, string>;
    // What this publish leaves out, and why.
    hidden: HiddenItem[];
}

// Walks the file's components (a few at a time, so the page stays responsive) and hashes each.
export async function snapshotFile(doc: NagmaDocument, onProgress?: (done: number, total: number) => void): Promise<Snapshot> {
    const internal = internalPage(doc);
    const assets = reusableAssets(doc);
    const components: LibraryComponentEntry[] = [];
    const records = new Map<string, LibraryItem & { kind: "component" }>();
    const pending = new Set<string>();
    const hidden: HiddenItem[] = [];
    for (const asset of assets) if (pageOfNode(doc, asset)?.id !== internal?.id || !internal) pending.add(asset.id);
    // Components on the internal page (from other libraries) travel only as dependencies.
    const queue = [...pending];
    const seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) {
        const id = queue[i] as string;
        const node = doc.nodes[id];
        if (!node) continue;
        const record = componentRecord(doc, id);
        records.set(id, record);
        for (const dep of record.deps) {
            if (seen.has(dep)) continue;
            seen.add(dep);
            queue.push(dep);
        }
        const page = pageOfNode(doc, node);
        let top: SceneNode | undefined = node.parentId ? doc.nodes[node.parentId] : undefined;
        let frame: SceneNode | undefined;
        while (top && top.type !== "page") {
            frame = top;
            top = top.parentId ? doc.nodes[top.parentId] : undefined;
        }
        const { folders } = slashParts(node.name);
        if (pending.has(id) && componentHidden(doc, node)) {
            const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
            const bySet = !isHiddenName(node.name) && !node.hiddenFromPublishing;
            // Variants of a hidden set are covered by the set's own row.
            if (!(bySet && parent?.type === "componentSet")) hidden.push({ key: `c:${id}`, kind: "component", id, name: node.name, reason: node.hiddenFromPublishing ? "flag" : "name", detail: node.type === "componentSet" ? "componentSet" : "component" });
        }
        components.push({
            id,
            type: node.type === "componentSet" ? "componentSet" : "component",
            name: node.name,
            path: [page?.name ?? "Page", ...(frame ? [frame.name] : []), ...folders],
            description: node.description ?? "",
            ...(node.docLinks?.length ? { docLinks: node.docLinks } : {}),
            ...(node.descriptionMarkdown ? { descriptionMarkdown: node.descriptionMarkdown } : {}),
            hash: hash(JSON.stringify(record.nodes)),
            ...(componentHidden(doc, node) || !pending.has(id) ? { hidden: true } : {}),
            w: node.w,
            h: node.h,
            ...(node.movedFrom ? { movedFrom: { libraryId: libraryIdFor(node.movedFrom.fileId) ?? node.movedFrom.fileId, key: node.movedFrom.key } } : {}),
        });
        if (i % 60 === 59) {
            onProgress?.(i + 1, queue.length);
            await tick();
        }
    }
    onProgress?.(queue.length, queue.length);
    const variables = publishedCollections(doc, hidden);
    const variableHashes = Object.fromEntries(variables.map((c) => [c.id, hash(JSON.stringify(c))]));
    const styles = styleList(doc.styles, hidden);
    return { components, records, styles, variables, variableHashes, hidden };
}

// ---- Changes since the last publish ----

export type ChangeKind = "component" | "style" | "variables";
export interface LibraryChange {
    key: string;
    kind: ChangeKind;
    id: string;
    name: string;
    status: "new" | "changed" | "removed";
    description: string;
    // For styles: which kind; for components: whether it's a set.
    detail?: string;
}

export function changesSince(previous: LibraryManifest | null, snap: Snapshot): LibraryChange[] {
    const out: LibraryChange[] = [];
    const prevComponents = new Map((previous?.components ?? []).map((c) => [c.id, c]));
    for (const c of snap.components) {
        if (c.hidden) continue;
        const before = prevComponents.get(c.id);
        if (!before || before.hidden) out.push({ key: `c:${c.id}`, kind: "component", id: c.id, name: c.name, status: "new", description: c.description, detail: c.type });
        else if (before.hash !== c.hash || before.name !== c.name || before.description !== c.description) out.push({ key: `c:${c.id}`, kind: "component", id: c.id, name: c.name, status: "changed", description: c.description, detail: c.type });
    }
    const current = new Set(snap.components.filter((c) => !c.hidden).map((c) => c.id));
    for (const c of previous?.components ?? []) if (!c.hidden && !current.has(c.id)) out.push({ key: `c:${c.id}`, kind: "component", id: c.id, name: c.name, status: "removed", description: c.description, detail: c.type });
    const prevStyles = new Map((previous?.styles ?? []).map((s) => [s.style.id, s]));
    for (const s of snap.styles) {
        const before = prevStyles.get(s.style.id);
        if (!before) out.push({ key: `s:${s.style.id}`, kind: "style", id: s.style.id, name: s.style.name, status: "new", description: s.style.description ?? "", detail: s.kind });
        else if (before.hash !== s.hash) out.push({ key: `s:${s.style.id}`, kind: "style", id: s.style.id, name: s.style.name, status: "changed", description: s.style.description ?? "", detail: s.kind });
    }
    const styleIds = new Set(snap.styles.map((s) => s.style.id));
    for (const s of previous?.styles ?? []) if (!styleIds.has(s.style.id)) out.push({ key: `s:${s.style.id}`, kind: "style", id: s.style.id, name: s.style.name, status: "removed", description: s.style.description ?? "", detail: s.kind });
    const prevVars = new Map((previous?.variables ?? []).map((c) => [c.id, c]));
    for (const c of snap.variables) {
        const before = prevVars.get(c.id);
        const count = `${c.variables.length} variable${c.variables.length === 1 ? "" : "s"}`;
        if (!before) out.push({ key: `v:${c.id}`, kind: "variables", id: c.id, name: c.name, status: "new", description: count });
        else if (previous?.variableHashes[c.id] !== snap.variableHashes[c.id]) out.push({ key: `v:${c.id}`, kind: "variables", id: c.id, name: c.name, status: "changed", description: count });
    }
    const varIds = new Set(snap.variables.map((c) => c.id));
    for (const c of previous?.variables ?? []) if (!varIds.has(c.id)) out.push({ key: `v:${c.id}`, kind: "variables", id: c.id, name: c.name, status: "removed", description: "" });
    return out;
}

// ---- Publishing ----

export function libraryIdFor(fileId: string | null): string | null {
    const meta = fileMeta(fileId);
    if (!meta) return null;
    return meta.shared ?? meta.id;
}

// The last published version of this file (if any).
export async function publishedManifest(fileId: string | null): Promise<LibraryManifest | null> {
    const id = libraryIdFor(fileId);
    if (!id) return null;
    const meta = fileMeta(fileId);
    const [local, remote] = await Promise.all([localManifest(id), meta?.shared ? serverManifest(id) : Promise.resolve(null)]);
    if (local && remote) return local.version >= remote.version ? local : remote;
    return local ?? remote;
}

export interface PublishProgress {
    phase: "checking" | "saving" | "uploading" | "done";
    done: number;
    total: number;
}

// Publishes the chosen changes. Unchosen changes keep their last published state.
export async function publishLibrary(doc: NagmaDocument, fileId: string, snap: Snapshot, previous: LibraryManifest | null, chosen: Set<string>, description: string, onProgress?: (p: PublishProgress) => void): Promise<LibraryManifest> {
    const id = libraryIdFor(fileId);
    const meta = fileMeta(fileId);
    if (!id || !meta) throw new Error("Save the file first.");
    const prevComponents = new Map((previous?.components ?? []).map((c) => [c.id, c]));
    const changes = changesSince(previous, snap);
    const statusOf = new Map(changes.map((c) => [c.key, c]));
    const take = (key: string) => !statusOf.has(key) || chosen.has(key);

    // Components: chosen changes go out; unchosen ones stay as they were (or stay unpublished).
    const components: LibraryComponentEntry[] = [];
    for (const c of snap.components) {
        if (c.hidden || take(`c:${c.id}`)) components.push(c);
        else {
            const before = prevComponents.get(c.id);
            if (before) components.push(before);
        }
    }
    for (const c of previous?.components ?? []) {
        const change = statusOf.get(`c:${c.id}`);
        if (change?.status === "removed" && !chosen.has(change.key)) components.push(c);
    }
    // Records for every component whose content is new to the published set.
    const writes: [string, LibraryItem][] = [];
    const images = new Set<string>();
    for (const c of components) {
        const before = prevComponents.get(c.id);
        const record = snap.records.get(c.id);
        if (!record || (before && before.hash === c.hash)) continue;
        writes.push([componentKey(c.id), record]);
        for (const img of record.images) images.add(img);
    }
    for (const img of images) if (doc.images[img]) writes.push([imageKey(img), { kind: "image", data: doc.images[img] as string }]);
    const kept = new Set(components.map((c) => c.id));
    const removed = (previous?.components ?? []).filter((c) => !kept.has(c.id)).map((c) => componentKey(c.id));

    const prevStyles = new Map((previous?.styles ?? []).map((s) => [s.style.id, s]));
    const styles: LibraryStyle[] = [];
    for (const s of snap.styles) {
        if (take(`s:${s.style.id}`)) styles.push(s);
        else if (prevStyles.has(s.style.id)) styles.push(prevStyles.get(s.style.id) as LibraryStyle);
    }
    for (const s of previous?.styles ?? []) {
        const change = statusOf.get(`s:${s.style.id}`);
        if (change?.status === "removed" && !chosen.has(change.key)) styles.push(s);
    }
    const prevVars = new Map((previous?.variables ?? []).map((c) => [c.id, c]));
    const variables: VariableCollection[] = [];
    const variableHashes: Record<string, string> = {};
    for (const c of snap.variables) {
        if (take(`v:${c.id}`)) {
            variables.push(c);
            variableHashes[c.id] = snap.variableHashes[c.id] as string;
        } else if (prevVars.has(c.id)) {
            variables.push(prevVars.get(c.id) as VariableCollection);
            variableHashes[c.id] = previous?.variableHashes[c.id] ?? "";
        }
    }
    for (const c of previous?.variables ?? []) {
        const change = statusOf.get(`v:${c.id}`);
        if (change?.status === "removed" && !chosen.has(change.key)) {
            variables.push(c);
            variableHashes[c.id] = previous?.variableHashes[c.id] ?? "";
        }
    }

    const version = Math.max(Date.now(), (previous?.version ?? 0) + 1);
    const published = changes.filter((c) => chosen.has(c.key)).length;
    const manifest: LibraryManifest = {
        id,
        name: meta.name,
        fileId: meta.shared ?? meta.id,
        version,
        publishedAt: Date.now(),
        publishedBy: auth.get().user?.name,
        counts: { components: components.filter((c) => !c.hidden).length, styles: styles.length, variables: variables.reduce((n, c) => n + c.variables.length, 0) },
        description: description.trim(),
        components,
        styles,
        variables,
        variableHashes,
        history: [{ version, at: Date.now(), description: description.trim(), changes: published }, ...(previous?.history ?? [])].slice(0, 50),
    };
    onProgress?.({ phase: "saving", done: 0, total: writes.length });
    await saveLocalItems(id, writes, (n) => onProgress?.({ phase: "saving", done: n, total: writes.length }));
    await deleteLocalItems(id, removed);
    if (meta.shared) {
        onProgress?.({ phase: "uploading", done: 0, total: writes.length });
        // A first publish to the server sends everything (the server may have nothing yet).
        const remote = await serverManifest(id);
        const all = remote
            ? writes
            : [
                  ...components.flatMap((c): [string, LibraryItem][] => {
                      const r = snap.records.get(c.id);
                      return r ? [[componentKey(c.id), r]] : [];
                  }),
                  ...writes.filter(([k]) => k.startsWith("i:")),
              ];
        await publishToServer({ ...manifest, server: true }, all, removed, (n) => onProgress?.({ phase: "uploading", done: n, total: all.length }));
    }
    await saveLocalManifest(manifest);
    manifestCache.set(id, manifest);
    onProgress?.({ phase: "done", done: 1, total: 1 });
    emit();
    void refreshLibraries();
    return manifest;
}

export async function unpublishLibrary(fileId: string) {
    const id = libraryIdFor(fileId);
    if (!id) return;
    await deleteLocalLibrary(id);
    if (fileMeta(fileId)?.shared) await unpublishFromServer(id);
    manifestCache.delete(id);
    summaries = summaries.filter((s) => s.id !== id);
    emit();
}

// ---- Available libraries ----

let summaries: LibrarySummary[] = [];
const manifestCache = new Map<string, LibraryManifest>();
const listeners = new Set<() => void>();
let version = 0;
function emit() {
    version++;
    for (const l of listeners) l();
}

export function subscribeLibraries(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function summaryOf(m: LibraryManifest | LibrarySummary): LibrarySummary {
    return { id: m.id, name: m.name, fileId: m.fileId, version: m.version, publishedAt: m.publishedAt, publishedBy: m.publishedBy, counts: m.counts, server: m.server };
}

export async function refreshLibraries(): Promise<LibrarySummary[]> {
    const [local, remote] = await Promise.all([localManifests(), serverManifests()]);
    const byId = new Map<string, LibrarySummary>();
    for (const m of local) {
        byId.set(m.id, summaryOf(m));
        if ((manifestCache.get(m.id)?.version ?? 0) < m.version) manifestCache.set(m.id, m);
    }
    for (const m of remote) {
        const known = byId.get(m.id);
        if (!known || known.version < m.version) byId.set(m.id, { ...summaryOf(m), server: true });
    }
    summaries = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    emit();
    return summaries;
}

export function librarySummaries(): LibrarySummary[] {
    return summaries;
}

// The newest manifest of a library, from memory, this browser or the server.
export async function loadManifest(id: string, fresh = false): Promise<LibraryManifest | null> {
    const cached = manifestCache.get(id);
    const summary = summaries.find((s) => s.id === id);
    if (cached && !fresh && (!summary || summary.version <= cached.version)) return cached;
    const [local, remote] = await Promise.all([localManifest(id), serverManifest(id)]);
    const best = local && remote ? (local.version >= remote.version ? local : remote) : (local ?? remote);
    if (best) {
        const changed = manifestCache.get(id)?.version !== best.version;
        manifestCache.set(id, best);
        // Keep a copy here, so the library works offline too.
        if (remote && best === remote && (!local || local.version < remote.version)) void saveLocalManifest(remote).catch(() => undefined);
        if (changed) emit();
    }
    return best ?? null;
}

export function cachedManifest(id: string): LibraryManifest | null {
    return manifestCache.get(id) ?? null;
}

async function loadItems(libraryId: string, keys: string[]): Promise<Map<string, LibraryItem>> {
    const found = await localItems(libraryId, keys);
    const missing = keys.filter((k) => !found.has(k));
    if (missing.length) {
        const remote = await serverItems(libraryId, missing);
        if (remote.size) void saveLocalItems(libraryId, [...remote.entries()]).catch(() => undefined);
        for (const [k, v] of remote) found.set(k, v);
    }
    return found;
}

// A component and everything it depends on, as one small document (for previews).
const previewDocs = new Map<string, Promise<NagmaDocument | null>>();
export function libraryPreviewDoc(libraryId: string, assetId: string, hashKey: string): Promise<NagmaDocument | null> {
    const key = `${libraryId}|${assetId}|${hashKey}`;
    let p = previewDocs.get(key);
    if (!p) {
        p = (async () => {
            const records = await loadClosure(libraryId, [assetId]);
            const root = records.get(assetId);
            if (!root) return null;
            const nodes: Record<string, SceneNode> = {};
            for (const record of records.values()) for (const node of record.nodes) nodes[node.id] = node;
            const page: SceneNode = { ...makeNode({ name: "", nodes: {}, roots: [], images: {} }, "page", { x: 0, y: 0, w: 1, h: 1 }, null), id: "preview-page", children: [assetId] };
            nodes[page.id] = page;
            nodes[assetId] = { ...(nodes[assetId] as SceneNode), parentId: page.id };
            const imageIds = [...records.values()].flatMap((r) => r.images);
            const imageItems = await loadItems(libraryId, imageIds.map(imageKey));
            const images: Record<string, string> = {};
            for (const id of imageIds) {
                const item = imageItems.get(imageKey(id));
                if (item?.kind === "image") {
                    images[id] = item.data;
                    if (item.data.startsWith("media:")) hintMediaSource(item.data.slice(6), libraryId);
                }
            }
            return { name: "", nodes, roots: [page.id], images };
        })();
        previewDocs.set(key, p);
    }
    return p;
}

// The records for some assets plus everything they depend on.
async function loadClosure(libraryId: string, assetIds: string[]): Promise<Map<string, LibraryItem & { kind: "component" }>> {
    const out = new Map<string, LibraryItem & { kind: "component" }>();
    let wanted = [...new Set(assetIds)];
    while (wanted.length) {
        const got = await loadItems(libraryId, wanted.map(componentKey));
        const next: string[] = [];
        for (const id of wanted) {
            const item = got.get(componentKey(id));
            if (item?.kind !== "component") continue;
            out.set(id, item);
            for (const dep of item.deps) if (!out.has(dep) && !wanted.includes(dep)) next.push(dep);
        }
        wanted = [...new Set(next)];
    }
    return out;
}

// ---- Using libraries in this file ----

// Ids from a library get the library's prefix in this file, segment by segment, so mirrored
// layers ("instance;source") still line up after the copy.
export function libPrefix(libraryId: string): string {
    return `${libraryId}~`;
}
function mapId(libraryId: string, id: string): string {
    const p = libPrefix(libraryId);
    return id
        .split(";")
        .map((part) => p + part)
        .join(";");
}

export function enabledLibraries(doc: NagmaDocument): LibraryLink[] {
    return internalPage(doc)?.libraries ?? [];
}

// Creates the internal page when it's missing (as a command list to run).
function ensureInternalPage(doc: NagmaDocument): { id: string; commands: Command[] } {
    const page = internalPage(doc);
    if (page) return { id: page.id, commands: [] };
    const node = makeNode(doc, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { name: "Internal Only Canvas", internal: true, libraries: [] });
    return { id: node.id, commands: [{ type: "node.create", node }] };
}

function setLinks(doc: NagmaDocument, pageId: string, links: LibraryLink[], extra: Command[] = []): Command[] {
    void doc;
    return [...extra, { type: "node.update", id: pageId, patch: { libraries: links } }];
}

export function setLibraryEnabled(summary: LibrarySummary, on: boolean) {
    const { doc } = editor.get();
    const { id: pageId, commands } = ensureInternalPage(doc);
    const links = enabledLibraries(doc);
    const next = on ? (links.some((l) => l.id === summary.id) ? links : [...links, { id: summary.id, name: summary.name, version: summary.version, items: {} }]) : links.filter((l) => l.id !== summary.id);
    editor.execute({ type: "batch", commands: setLinks(doc, pageId, next, commands) });
    if (on) void loadManifest(summary.id);
}

// The manifests of the enabled libraries (loaded in the background; re-renders when they land).
export function useEnabledManifests(doc: NagmaDocument): LibraryManifest[] {
    useSyncExternalStore(subscribeLibraries, () => version);
    const out: LibraryManifest[] = [];
    for (const link of enabledLibraries(doc)) {
        const m = manifestCache.get(link.id);
        if (m) out.push(m);
        else void loadManifest(link.id);
    }
    return out;
}

export function useLibrarySummaries(): LibrarySummary[] {
    useSyncExternalStore(subscribeLibraries, () => version);
    return summaries;
}

// Library components as asset entries for pickers (hidden ones left out).
const sourceCache = new WeakMap<LibraryManifest, AssetSource>();
const EMPTY_DOC: NagmaDocument = { name: "", nodes: {}, roots: [], images: {} };
export function librarySource(manifest: LibraryManifest): AssetSource {
    const hit = sourceCache.get(manifest);
    if (hit) return hit;
    const entries: AssetEntry[] = manifest.components
        .filter((c) => !c.hidden)
        .map((c) => {
            const { leaf } = slashParts(c.name);
            const node = { id: c.id, type: c.type, name: c.name, description: c.description, descriptionMarkdown: c.descriptionMarkdown, docLinks: c.docLinks, w: c.w, h: c.h, children: [], parentId: null } as unknown as SceneNode;
            return { id: c.id, node, name: leaf, path: c.path, description: c.description, hash: c.hash };
        });
    const source: AssetSource = { id: manifest.id, name: manifest.name, local: false, doc: EMPTY_DOC, entries };
    sourceCache.set(manifest, source);
    return source;
}

// Copies library components into this file (with what they depend on, and the styles and
// variables they use) unless the same version is already here. Returns this file's id for each.
export async function importLibraryAssets(libraryId: string, assetIds: string[], force = false): Promise<Map<string, string>> {
    const manifest = await loadManifest(libraryId);
    if (!manifest) throw new Error("This library isn't available.");
    const records = await loadClosure(libraryId, assetIds);
    const { doc } = editor.get();
    const { id: pageId, commands } = ensureInternalPage(doc);
    const links = enabledLibraries(doc);
    const link: LibraryLink = links.find((l) => l.id === libraryId) ?? { id: libraryId, name: manifest.name, version: manifest.version, items: {} };
    const items = { ...(link.items ?? {}) };
    const hashOf = new Map(manifest.components.map((c) => [c.id, c.hash]));
    const result = new Map<string, string>();
    const styleIds = new Set<string>();
    const variableIds = new Set<string>();
    const collectionIds = new Set<string>();
    const images = new Set<string>();
    for (const [assetId, record] of records) {
        const mapped = mapId(libraryId, assetId);
        result.set(assetId, mapped);
        const present = doc.nodes[mapped];
        const same = present && items[componentKey(assetId)] === hashOf.get(assetId);
        if (same && !force) continue;
        if (present) commands.push({ type: "node.delete", ids: [mapped] });
        for (const node of record.nodes) {
            const copy = mapNode(libraryId, node, assetId === node.id ? pageId : null);
            if (node.id === assetId) Object.assign(copy, { libraryId, libraryKey: assetId });
            commands.push({ type: "node.create", node: copy });
            for (const key of ["fillStyleId", "strokeStyleId", "textStyleId", "effectStyleId"] as const) if (node[key]) styleIds.add(node[key] as string);
            for (const v of Object.values(node.boundVariables ?? {})) variableIds.add(v);
            for (const c of Object.keys(node.variableModes ?? {})) collectionIds.add(c);
        }
        for (const img of record.images) images.add(img);
        items[componentKey(assetId)] = hashOf.get(assetId) ?? "";
    }
    // Images the components show.
    const missingImages = [...images].filter((id) => !doc.images[id]);
    if (missingImages.length) {
        const got = await loadItems(libraryId, missingImages.map(imageKey));
        for (const id of missingImages) {
            const item = got.get(imageKey(id));
            if (item?.kind !== "image") continue;
            if (item.data.startsWith("media:")) hintMediaSource(item.data.slice(6), libraryId);
            commands.push({ type: "image.add", id, data: item.data });
        }
    }
    const { styles, stylesChanged } = withLibraryStyles(doc, manifest, styleIds, items);
    if (stylesChanged) commands.unshift({ type: "styles.set", styles });
    for (const c of manifest.variables) if (c.variables.some((v) => variableIds.has(v.id))) collectionIds.add(c.id);
    const vars = withLibraryVariables(doc, manifest, collectionIds, items);
    if (vars.changed) commands.unshift({ type: "variables.set", variables: vars.collections });
    const nextLinks = links.some((l) => l.id === libraryId) ? links.map((l) => (l.id === libraryId ? { ...l, items } : l)) : [...links, { ...link, items }];
    commands.push({ type: "node.update", id: pageId, patch: { libraries: nextLinks } });
    editor.execute({ type: "batch", commands });
    return result;
}

function mapNode(libraryId: string, node: SceneNode, parent: string | null): SceneNode {
    const m = (id: string) => mapId(libraryId, id);
    const copy: SceneNode = {
        ...node,
        id: m(node.id),
        parentId: parent ?? (node.parentId ? m(node.parentId) : null),
        children: node.children.map(m),
    };
    if (node.componentId) copy.componentId = m(node.componentId);
    if (node.sourceId) copy.sourceId = m(node.sourceId);
    if (node.propValues) copy.propValues = Object.fromEntries(Object.entries(node.propValues).map(([k, v]) => [k, typeof v === "string" && /[A-Za-z0-9]/.test(v) && isNodeIdLike(v) ? m(v) : v]));
    if (node.componentProps) copy.componentProps = node.componentProps.map((p) => ({ ...p, ...(p.kind === "swap" && typeof p.defaultValue === "string" && p.defaultValue ? { defaultValue: m(p.defaultValue) } : {}), ...(p.preferred ? { preferred: p.preferred.map(m) } : {}), ...(p.defaultVariable ? { defaultVariable: m(p.defaultVariable) } : {}) }));
    for (const key of ["fillStyleId", "strokeStyleId", "textStyleId", "effectStyleId"] as const) if (node[key]) copy[key] = m(node[key] as string);
    if (node.boundVariables) copy.boundVariables = Object.fromEntries(Object.entries(node.boundVariables).map(([k, v]) => [k, m(v)]));
    if (node.variableModes) copy.variableModes = Object.fromEntries(Object.entries(node.variableModes).map(([k, v]) => [m(k), v]));
    delete copy.libraries;
    delete copy.internal;
    return copy;
}

// Property values that name a component (swap values) look like ids, not like text people typed.
function isNodeIdLike(v: string): boolean {
    return !/\s/.test(v) && v.length >= 6 && v.length <= 80;
}

function mapStyle<T extends ColorStyle | TextStyle | EffectStyle>(libraryId: string, style: T): T {
    const copy = { ...style, id: mapId(libraryId, style.id), libraryId, libraryKey: style.id } as T;
    if ("variableId" in copy && copy.variableId) (copy as ColorStyle).variableId = mapId(libraryId, copy.variableId);
    return copy;
}

// Adds (or refreshes) library styles in this file's styles.
function withLibraryStyles(doc: NagmaDocument, manifest: LibraryManifest, ids: Set<string>, items: Record<string, string>, force = false): { styles: Styles; stylesChanged: boolean } {
    const base: Styles = doc.styles ?? { colors: [], texts: [] };
    let colors = base.colors;
    let texts = base.texts;
    let effects = base.effects ?? [];
    let changed = false;
    for (const entry of manifest.styles) {
        if (!ids.has(entry.style.id)) continue;
        const mapped = mapId(manifest.id, entry.style.id);
        const key = `s:${entry.style.id}`;
        const present = [...colors, ...texts, ...effects].some((s) => s.id === mapped);
        if (present && items[key] === entry.hash && !force) continue;
        items[key] = entry.hash;
        changed = true;
        if (entry.kind === "color") {
            const s = mapStyle(manifest.id, entry.style);
            colors = present ? colors.map((c) => (c.id === mapped ? s : c)) : [...colors, s];
        } else if (entry.kind === "text") {
            const s = mapStyle(manifest.id, entry.style);
            texts = present ? texts.map((c) => (c.id === mapped ? s : c)) : [...texts, s];
        } else {
            const s = mapStyle(manifest.id, entry.style);
            effects = present ? effects.map((c) => (c.id === mapped ? s : c)) : [...effects, s];
        }
    }
    return { styles: { ...base, colors, texts, effects }, stylesChanged: changed };
}

function mapCollection(libraryId: string, c: VariableCollection): VariableCollection {
    const m = (id: string) => mapId(libraryId, id);
    return {
        ...c,
        id: m(c.id),
        libraryId,
        variables: c.variables.map((v): Variable => ({
            ...v,
            id: m(v.id),
            libraryKey: v.id,
            values: Object.fromEntries(Object.entries(v.values).map(([mode, value]) => [mode, typeof value === "object" && value && "alias" in value ? { ...value, alias: m(value.alias) } : value])),
        })),
    };
}

function withLibraryVariables(doc: NagmaDocument, manifest: LibraryManifest, ids: Set<string>, items: Record<string, string>, force = false): { collections: VariableCollection[]; changed: boolean } {
    let collections = doc.variables ?? [];
    let changed = false;
    // Aliases can point into other collections of the same library: bring those along.
    const wanted = new Set(ids);
    let grew = true;
    while (grew) {
        grew = false;
        for (const c of manifest.variables) {
            if (!wanted.has(c.id)) continue;
            for (const v of c.variables)
                for (const value of Object.values(v.values))
                    if (typeof value === "object" && value && "alias" in value) {
                        const owner = manifest.variables.find((o) => o.variables.some((x) => x.id === value.alias));
                        if (owner && !wanted.has(owner.id)) {
                            wanted.add(owner.id);
                            grew = true;
                        }
                    }
        }
    }
    for (const c of manifest.variables) {
        if (!wanted.has(c.id)) continue;
        const key = `v:${c.id}`;
        const mapped = mapCollection(manifest.id, c);
        const present = collections.some((x) => x.id === mapped.id);
        if (present && items[key] === manifest.variableHashes[c.id] && !force) continue;
        items[key] = manifest.variableHashes[c.id] ?? "";
        changed = true;
        collections = present ? collections.map((x) => (x.id === mapped.id ? mapped : x)) : [...collections, mapped];
    }
    return { collections, changed };
}

// Brings library styles into the file (to apply them); returns their ids here.
export async function importLibraryStyles(libraryId: string, styleIds: string[]): Promise<string[]> {
    const manifest = await loadManifest(libraryId);
    if (!manifest) return [];
    const { doc } = editor.get();
    const { id: pageId, commands } = ensureInternalPage(doc);
    const links = enabledLibraries(doc);
    const link = links.find((l) => l.id === libraryId) ?? { id: libraryId, name: manifest.name, version: manifest.version, items: {} };
    const items = { ...(link.items ?? {}) };
    const { styles, stylesChanged } = withLibraryStyles(doc, manifest, new Set(styleIds), items);
    // Colour styles backed by a variable bring the variable's collection.
    const vars = new Set<string>();
    for (const s of manifest.styles) if (styleIds.includes(s.style.id) && s.kind === "color" && s.style.variableId) vars.add(s.style.variableId);
    const collectionIds = new Set(manifest.variables.filter((c) => c.variables.some((v) => vars.has(v.id))).map((c) => c.id));
    const v = withLibraryVariables(doc, manifest, collectionIds, items);
    if (stylesChanged || v.changed) {
        if (stylesChanged) commands.push({ type: "styles.set", styles });
        if (v.changed) commands.push({ type: "variables.set", variables: v.collections });
        const nextLinks = links.some((l) => l.id === libraryId) ? links.map((l) => (l.id === libraryId ? { ...l, items } : l)) : [...links, { ...link, items }];
        commands.push({ type: "node.update", id: pageId, patch: { libraries: nextLinks } });
        editor.execute({ type: "batch", commands });
    }
    return styleIds.map((id) => mapId(libraryId, id));
}

// Brings a library variable's collection into the file (to bind it); returns its id here.
export async function importLibraryVariable(libraryId: string, variableId: string): Promise<string | null> {
    const manifest = await loadManifest(libraryId);
    if (!manifest) return null;
    const owner = manifest.variables.find((c) => c.variables.some((v) => v.id === variableId));
    if (!owner) return null;
    const { doc } = editor.get();
    const { id: pageId, commands } = ensureInternalPage(doc);
    const links = enabledLibraries(doc);
    const link = links.find((l) => l.id === libraryId) ?? { id: libraryId, name: manifest.name, version: manifest.version, items: {} };
    const items = { ...(link.items ?? {}) };
    const v = withLibraryVariables(doc, manifest, new Set([owner.id]), items);
    if (v.changed) {
        commands.push({ type: "variables.set", variables: v.collections });
        const nextLinks = links.some((l) => l.id === libraryId) ? links.map((l) => (l.id === libraryId ? { ...l, items } : l)) : [...links, { ...link, items }];
        commands.push({ type: "node.update", id: pageId, patch: { libraries: nextLinks } });
        editor.execute({ type: "batch", commands });
    }
    return mapId(libraryId, variableId);
}

// ---- Updates ----

export interface LibraryUpdate {
    key: string;
    libraryId: string;
    libraryName: string;
    kind: ChangeKind;
    // The item's id in the library.
    id: string;
    name: string;
    // For styles: before (this file's copy) and after (the library's).
    before?: ColorStyle | TextStyle | EffectStyle;
    after?: LibraryStyle;
    beforeCollection?: VariableCollection;
    afterCollection?: VariableCollection;
    hash: string;
    removed?: boolean;
    // The component moved to another library: the one it came from, and its copy in this file.
    moved?: { fromLibrary: string; fromName: string; localId: string };
}

// What this file uses from its libraries that has changed since it last took an update.
export async function findUpdates(doc: NagmaDocument, fresh = false): Promise<LibraryUpdate[]> {
    const out: LibraryUpdate[] = [];
    for (const link of enabledLibraries(doc)) {
        const manifest = await loadManifest(link.id, fresh);
        if (!manifest || manifest.version <= link.version) continue;
        const items = link.items ?? {};
        for (const c of manifest.components) {
            const key = componentKey(c.id);
            if (items[key] === undefined || items[key] === c.hash) continue;
            out.push({ key: `${link.id}|${key}`, libraryId: link.id, libraryName: manifest.name, kind: "component", id: c.id, name: c.name, hash: c.hash });
        }
        const styleMap = new Map([...(doc.styles?.colors ?? []), ...(doc.styles?.texts ?? []), ...(doc.styles?.effects ?? [])].map((s) => [s.id, s]));
        for (const s of manifest.styles) {
            const key = `s:${s.style.id}`;
            if (items[key] === undefined || items[key] === s.hash) continue;
            out.push({ key: `${link.id}|${key}`, libraryId: link.id, libraryName: manifest.name, kind: "style", id: s.style.id, name: s.style.name, before: styleMap.get(mapId(link.id, s.style.id)), after: s, hash: s.hash });
        }
        for (const c of manifest.variables) {
            const key = `v:${c.id}`;
            if (items[key] === undefined || items[key] === manifest.variableHashes[c.id]) continue;
            out.push({ key: `${link.id}|${key}`, libraryId: link.id, libraryName: manifest.name, kind: "variables", id: c.id, name: c.name, beforeCollection: (doc.variables ?? []).find((x) => x.id === mapId(link.id, c.id)), afterCollection: mapCollection(link.id, c), hash: manifest.variableHashes[c.id] ?? "" });
        }
    }
    out.push(...(await movedComponents(doc, fresh)));
    return out;
}

// Components this file uses that their library no longer has because they moved to another
// library (cut from one library file and pasted into another, both published).
async function movedComponents(doc: NagmaDocument, fresh: boolean): Promise<LibraryUpdate[]> {
    const out: LibraryUpdate[] = [];
    const gone: { node: SceneNode; from: LibraryManifest }[] = [];
    for (const link of enabledLibraries(doc)) {
        const manifest = await loadManifest(link.id, fresh);
        if (!manifest) continue;
        const have = new Set(manifest.components.map((c) => c.id));
        for (const node of Object.values(doc.nodes)) if (node.libraryId === link.id && node.libraryKey && !have.has(node.libraryKey) && (node.type === "component" || node.type === "componentSet")) gone.push({ node, from: manifest });
    }
    if (!gone.length) return out;
    if (!summaries.length) await refreshLibraries().catch(() => undefined);
    for (const s of summaries) {
        const manifest = await loadManifest(s.id);
        if (!manifest) continue;
        for (const c of manifest.components) {
            if (!c.movedFrom) continue;
            const hit = gone.find((g) => g.from.id === c.movedFrom?.libraryId && g.node.libraryKey === c.movedFrom.key);
            if (hit) out.push({ key: `${manifest.id}|moved:${hit.node.id}`, libraryId: manifest.id, libraryName: manifest.name, kind: "component", id: c.id, name: c.name, hash: c.hash, moved: { fromLibrary: hit.from.id, fromName: hit.from.name, localId: hit.node.id } });
        }
    }
    return out;
}

// Points every instance of one local component (or its variants, by name) at another.
function repointInstances(fromId: string, toId: string): number {
    let n = 0;
    const doc = editor.get().doc;
    const from = doc.nodes[fromId];
    const to = doc.nodes[toId];
    if (!from || !to) return 0;
    const variants = new Map<string, string>();
    if (from.type === "componentSet" && to.type === "componentSet") for (const v of from.children) {
        const name = doc.nodes[v]?.name;
        const match = to.children.find((c) => doc.nodes[c]?.name === name) ?? to.children[0];
        if (match) variants.set(v, match);
    }
    for (const node of Object.values(doc.nodes)) {
        if (node.type !== "instance" || !node.componentId) continue;
        const target = node.componentId === fromId ? toId : variants.get(node.componentId);
        if (!target) continue;
        swapComponent(node.id, target);
        n += 1;
    }
    return n;
}

// Swap library: every component and style this file uses from one library switches to the one with
// the same name in another (the other library is turned on). Returns what was swapped.
export async function swapLibrary(fromId: string, toId: string): Promise<{ components: number; instances: number; styles: number; missing: string[] }> {
    const [from, to] = await Promise.all([loadManifest(fromId), loadManifest(toId)]);
    if (!from || !to) throw new Error("That library isn't available.");
    const summary = summaries.find((s) => s.id === toId);
    if (summary && !enabledLibraries(editor.get().doc).some((l) => l.id === toId)) setLibraryEnabled(summary, true);
    const byName = new Map(to.components.map((c) => [c.name, c.id]));
    const local = Object.values(editor.get().doc.nodes).filter((n) => n.libraryId === fromId && (n.type === "component" || n.type === "componentSet") && !(n.parentId && editor.get().doc.nodes[n.parentId]?.type === "componentSet"));
    const pairs = local.map((n) => [n, byName.get(n.name)] as const);
    const missing = pairs.filter(([, id]) => !id).map(([n]) => n.name);
    const wanted = pairs.filter(([, id]) => id).map(([, id]) => id as string);
    const mapped = wanted.length ? await importLibraryAssets(toId, wanted) : new Map<string, string>();
    let instances = 0;
    for (const [n, id] of pairs) {
        const target = id ? mapped.get(id) : undefined;
        if (target) instances += repointInstances(n.id, target);
    }
    // Styles: layers using a style from the old library take the same-named one from the new.
    const doc = editor.get().doc;
    const all = [...(doc.styles?.colors ?? []), ...(doc.styles?.texts ?? []), ...(doc.styles?.effects ?? [])];
    const prefix = libPrefix(fromId);
    const oldStyles = all.filter((st) => st.id.startsWith(prefix));
    const newByName = new Map(to.styles.map((st) => [`${st.kind}:${st.style.name}`, st.style.id]));
    const kindOf = (id: string) => (doc.styles?.colors.some((x) => x.id === id) ? "color" : doc.styles?.texts.some((x) => x.id === id) ? "text" : "effect");
    const wantStyles = oldStyles.map((st) => newByName.get(`${kindOf(st.id)}:${st.name}`)).filter((x): x is string => Boolean(x));
    let styles = 0;
    if (wantStyles.length) {
        await importLibraryStyles(toId, wantStyles);
        const after = editor.get().doc;
        const swap = new Map<string, string>();
        for (const st of oldStyles) {
            const id = newByName.get(`${kindOf(st.id)}:${st.name}`);
            if (id) swap.set(st.id, mapId(toId, id));
        }
        const commands: Command[] = [];
        for (const node of Object.values(after.nodes)) {
            const patch: Partial<SceneNode> = {};
            for (const key of ["fillStyleId", "strokeStyleId", "textStyleId", "effectStyleId"] as const) {
                const next = node[key] ? swap.get(node[key] as string) : undefined;
                if (next) patch[key] = next;
            }
            if (Object.keys(patch).length) commands.push({ type: "node.update", id: node.id, patch });
        }
        if (commands.length) {
            editor.execute({ type: "batch", commands });
            // The layers now on the new styles take their values.
            const restyled = editor.get().doc;
            const values = restyleLayers(restyled, restyled.styles ?? { colors: [], texts: [] }, new Set(swap.values()));
            if (values.length) {
                editor.execute({ type: "batch", commands: values });
                editor.mergeLast();
            }
            styles = swap.size;
        }
    }
    return { components: mapped.size, instances, styles, missing };
}

// Takes library updates into this file. Layers using an updated style follow it.
export async function acceptUpdates(updates: LibraryUpdate[]): Promise<void> {
    const byLibrary = new Map<string, LibraryUpdate[]>();
    for (const u of updates) byLibrary.set(u.libraryId, [...(byLibrary.get(u.libraryId) ?? []), u]);
    for (const [libraryId, list] of byLibrary) {
        // Components that moved here from another library: brought in, and their instances follow.
        const moved = list.filter((u) => u.moved);
        if (moved.length) {
            const summary = summaries.find((s) => s.id === libraryId);
            if (summary && !enabledLibraries(editor.get().doc).some((l) => l.id === libraryId)) setLibraryEnabled(summary, true);
            const mapped = await importLibraryAssets(libraryId, moved.map((u) => u.id));
            for (const u of moved) {
                const target = mapped.get(u.id);
                if (target && u.moved) repointInstances(u.moved.localId, target);
            }
        }
        const components = list.filter((u) => u.kind === "component" && !u.moved).map((u) => u.id);
        if (components.length) await importLibraryAssets(libraryId, components, true);
        const manifest = await loadManifest(libraryId);
        if (!manifest) continue;
        const { doc } = editor.get();
        const { id: pageId, commands } = ensureInternalPage(doc);
        const links = enabledLibraries(doc);
        const link = links.find((l) => l.id === libraryId);
        if (!link) continue;
        const items = { ...(link.items ?? {}) };
        const styleIds = new Set(list.filter((u) => u.kind === "style").map((u) => u.id));
        if (styleIds.size) {
            const { styles, stylesChanged } = withLibraryStyles(doc, manifest, styleIds, items, true);
            if (stylesChanged) {
                commands.push({ type: "styles.set", styles });
                commands.push(...restyleLayers(doc, styles, new Set([...styleIds].map((id) => mapId(libraryId, id)))));
            }
        }
        const collectionIds = new Set(list.filter((u) => u.kind === "variables").map((u) => u.id));
        if (collectionIds.size) {
            const v = withLibraryVariables(doc, manifest, collectionIds, items, true);
            if (v.changed) commands.push({ type: "variables.set", variables: v.collections });
        }
        // The link moves to the new version once nothing used is left behind.
        const after = { ...link, items };
        const stillBehind = (await findUpdates({ ...doc, nodes: { ...doc.nodes, [pageId]: { ...(doc.nodes[pageId] as SceneNode), libraries: links.map((l) => (l.id === libraryId ? after : l)) } } })).some((u) => u.libraryId === libraryId && !list.some((x) => x.key === u.key));
        const nextLinks = links.map((l) => (l.id === libraryId ? { ...after, version: stillBehind ? l.version : manifest.version, name: manifest.name } : l));
        commands.push({ type: "node.update", id: pageId, patch: { libraries: nextLinks } });
        editor.execute({ type: "batch", commands });
    }
    updatesState = { ...updatesState, updates: updatesState.updates.filter((u) => !updates.some((x) => x.key === u.key)) };
    emitUpdates();
}

// Layers that follow updated styles take their new values.
function restyleLayers(doc: NagmaDocument, styles: Styles, ids: Set<string>): Command[] {
    const commands: Command[] = [];
    const colors = new Map(styles.colors.map((s) => [s.id, s]));
    const texts = new Map(styles.texts.map((s) => [s.id, s]));
    const effects = new Map((styles.effects ?? []).map((s) => [s.id, s]));
    for (const node of Object.values(doc.nodes)) {
        const patch: Partial<SceneNode> = {};
        if (node.fillStyleId && ids.has(node.fillStyleId)) {
            const s = colors.get(node.fillStyleId);
            if (s) patch.fills = [s.paint];
        }
        if (node.strokeStyleId && ids.has(node.strokeStyleId)) {
            const s = colors.get(node.strokeStyleId);
            if (s) patch.strokes = [s.paint];
        }
        if (node.textStyleId && ids.has(node.textStyleId)) {
            const s = texts.get(node.textStyleId);
            if (s) Object.assign(patch, { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, italic: s.italic, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing });
        }
        if (node.effectStyleId && ids.has(node.effectStyleId)) {
            const s = effects.get(node.effectStyleId);
            if (s) Object.assign(patch, s.effects ? { effects: s.effects, shadow: null, blur: 0 } : { shadow: s.shadow, blur: s.blur });
        }
        if (Object.keys(patch).length) commands.push({ type: "node.update", id: node.id, patch });
    }
    return commands;
}

// ---- Update notifications ----

interface UpdatesState {
    updates: LibraryUpdate[];
    // The newest library version the person dismissed the banner for (per file).
    dismissed: string | null;
    reviewOpen: boolean;
}
let updatesState: UpdatesState = { updates: [], dismissed: null, reviewOpen: false };
const updateListeners = new Set<() => void>();
function emitUpdates() {
    for (const l of updateListeners) l();
}
export function useLibraryUpdates(): UpdatesState {
    return useSyncExternalStore(
        (l) => {
            updateListeners.add(l);
            return () => updateListeners.delete(l);
        },
        () => updatesState,
    );
}
export function openReview(open = true) {
    updatesState = { ...updatesState, reviewOpen: open };
    emitUpdates();
}
export function dismissUpdates() {
    updatesState = { ...updatesState, dismissed: updatesState.updates.map((u) => `${u.key}@${u.hash}`).join(",") };
    emitUpdates();
}
export function updatesSignature(list: LibraryUpdate[]): string {
    return list.map((u) => `${u.key}@${u.hash}`).join(",");
}

let checking = false;
export async function checkForUpdates(fresh = true) {
    if (checking) return;
    const { doc, homeOpen } = editor.get();
    if (homeOpen || !enabledLibraries(doc).length) {
        if (updatesState.updates.length) {
            updatesState = { ...updatesState, updates: [] };
            emitUpdates();
        }
        return;
    }
    checking = true;
    try {
        if (fresh) await refreshLibraries();
        const updates = await findUpdates(editor.get().doc, fresh);
        if (updatesSignature(updates) !== updatesSignature(updatesState.updates)) {
            updatesState = { ...updatesState, updates };
            emitUpdates();
        }
    } finally {
        checking = false;
    }
}

// Checks when a file opens, when a library is published from this browser, and every minute.
let lastFile: string | null = null;
editor.subscribe(() => {
    const { fileId } = editor.get();
    if (fileId !== lastFile) {
        lastFile = fileId;
        updatesState = { updates: [], dismissed: null, reviewOpen: false };
        emitUpdates();
        setTimeout(() => void checkForUpdates(), 600);
    }
});
subscribeLibraries(() => {
    setTimeout(() => void checkForUpdates(false), 0);
});
if (typeof window !== "undefined" && typeof window.setInterval === "function") window.setInterval(() => void checkForUpdates(), 60_000);

export function internalPageOf(doc: NagmaDocument): SceneNode | undefined {
    return internalPage(doc);
}
