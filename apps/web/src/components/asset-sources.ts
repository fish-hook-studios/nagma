import { useMemo } from "react";
import { createInstance, swapComponent } from "../engine/actions";
import { type AssetSource, assetEntries } from "../engine/asset-tree";
import { findVariant, variantProps } from "../engine/components";
import { importLibraryAssets, librarySource, useEnabledManifests } from "../engine/library";
import { editor, useEditor } from "../engine/store";
import type { NagmaDocument } from "../engine/types";
import type { SwapTarget } from "./instance-swap";

// Assets for pickers: this file's components first, then every library the file has enabled.

export function useAssetSources(): AssetSource[] {
    const doc = useEditor((s) => s.doc);
    const manifests = useEnabledManifests(doc);
    const local = useMemo<AssetSource>(() => ({ id: "local", name: "Local components", local: true, doc, entries: assetEntries(doc) }), [doc]);
    return useMemo(() => [local, ...manifests.map(librarySource)], [local, manifests]);
}

// Which source and asset an instance's component is (its set for variants). Components copied in
// from a library belong to that library.
export function currentAsset(doc: NagmaDocument, componentId: string | undefined): { sourceId: string; assetId: string } | null {
    const component = componentId ? doc.nodes[componentId] : undefined;
    if (!component) return null;
    const parent = doc.nodes[component.parentId ?? ""];
    const asset = parent?.type === "componentSet" ? parent : component;
    if (asset.libraryId && asset.libraryKey) return { sourceId: asset.libraryId, assetId: asset.libraryKey };
    return { sourceId: "local", assetId: asset.id };
}

// The component to use when an asset is picked for an instance: a set picks the variant closest
// to the instance's current variant values.
export function componentForAsset(doc: NagmaDocument, assetId: string, currentComponentId?: string): string | null {
    const asset = doc.nodes[assetId];
    if (!asset) return null;
    if (asset.type === "component") return asset.id;
    if (asset.type !== "componentSet") return null;
    const current = currentComponentId ? doc.nodes[currentComponentId] : undefined;
    const wanted = current ? variantProps(current.name) : {};
    return findVariant(doc, asset.id, wanted);
}

// This file's id for an asset from any source (library assets are copied in first).
export async function localAssetId(sourceId: string, assetId: string): Promise<string | null> {
    if (sourceId === "local") return assetId;
    try {
        const ids = await importLibraryAssets(sourceId, [assetId]);
        return ids.get(assetId) ?? null;
    } catch (error) {
        editor.notify(error instanceof Error ? error.message : "This library isn't available.");
        return null;
    }
}

export async function swapTo(instanceId: string, target: SwapTarget | { sourceId: string; assetId: string }) {
    const sourceId = "source" in target ? target.source.id : target.sourceId;
    const assetId = "source" in target ? target.entry.id : target.assetId;
    const local = await localAssetId(sourceId, assetId);
    if (!local) return;
    const { doc } = editor.get();
    const instance = doc.nodes[instanceId];
    if (!instance) return;
    const componentId = componentForAsset(doc, local, instance.componentId);
    if (componentId) swapComponent(instanceId, componentId);
}

// Places an instance of an asset from any source (at a canvas point, or mid-view).
export async function placeAsset(sourceId: string, assetId: string, at?: { x: number; y: number }) {
    const local = await localAssetId(sourceId, assetId);
    if (local) createInstance(local, at);
}

// Assets dragged from the Assets panel carry "lib:<library>:<asset>" (or a plain id for this file).
export function encodeAssetDrag(sourceId: string, assetId: string): string {
    return sourceId === "local" ? assetId : `lib:${sourceId}:${assetId}`;
}
export function decodeAssetDrag(data: string): { sourceId: string; assetId: string } {
    if (!data.startsWith("lib:")) return { sourceId: "local", assetId: data };
    const rest = data.slice(4);
    const at = rest.indexOf(":");
    return { sourceId: rest.slice(0, at), assetId: rest.slice(at + 1) };
}
