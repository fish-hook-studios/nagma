import { useEffect, useRef, useState } from "react";
import type { AssetEntry, AssetSource } from "../engine/asset-tree";
import { preloadImages } from "../engine/image-store";
import { libraryPreviewDoc } from "../engine/library";
import { renderThumb } from "../engine/thumb";
import type { NagmaDocument } from "../engine/types";

// Small pictures of components for the Assets panel and the swap menu. Pictures are cached per
// document version (nodes object), so scrolling a long list doesn't redraw them.
const cache = new WeakMap<object, Map<string, string>>();

function assetThumb(doc: NagmaDocument, id: string, w = 160, h = 120): string | null {
    let byDoc = cache.get(doc.nodes);
    if (!byDoc) {
        byDoc = new Map();
        cache.set(doc.nodes, byDoc);
    }
    const key = `${id}@${w}x${h}`;
    const hit = byDoc.get(key);
    if (hit !== undefined) return hit || null;
    let url = "";
    try {
        url = renderThumb(doc, w, h, id);
    } catch {
        url = "";
    }
    byDoc.set(key, url);
    return url || null;
}

export function AssetThumb({ doc, id, className, w, h }: { doc: NagmaDocument; id: string; className?: string; w?: number; h?: number }) {
    // Drawn once the tile is on screen, so long lists stay quick.
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
    useEffect(() => {
        const el = ref.current;
        if (!el || visible) return;
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) {
                io.disconnect();
                setVisible(true);
            }
        });
        io.observe(el);
        return () => io.disconnect();
    }, [visible]);
    const url = visible ? assetThumb(doc, id, w, h) : null;
    return <div ref={ref} className={`bg-field bg-contain bg-center bg-no-repeat ${className ?? ""}`} style={{ backgroundImage: url ? `url(${url})` : undefined }} />;
}

// A library component's picture: its layers load (once) when the tile scrolls into view.
const libraryThumbs = new Map<string, string>();

export function LibraryThumb({ libraryId, assetId, hash, className, w = 160, h = 120 }: { libraryId: string; assetId: string; hash: string; className?: string; w?: number; h?: number }) {
    const key = `${libraryId}|${assetId}|${hash}|${w}x${h}`;
    const [, setMade] = useState(0);
    const url = libraryThumbs.get(key) || null;
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (libraryThumbs.has(key)) return;
        const el = ref.current;
        if (!el) return;
        let cancelled = false;
        const load = () => {
            void libraryPreviewDoc(libraryId, assetId, hash).then(async (doc) => {
                if (!doc || cancelled) return;
                await preloadImages(doc.images).catch(() => undefined);
                let made = "";
                try {
                    made = renderThumb(doc, w, h, assetId);
                } catch {
                    made = "";
                }
                libraryThumbs.set(key, made);
                if (!cancelled) setMade((n) => n + 1);
            });
        };
        if (typeof IntersectionObserver === "undefined") {
            load();
            return;
        }
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) {
                io.disconnect();
                load();
            }
        });
        io.observe(el);
        return () => {
            cancelled = true;
            io.disconnect();
        };
    }, [key, libraryId, assetId, hash, w, h]);
    return <div ref={ref} className={`bg-field bg-contain bg-center bg-no-repeat ${className ?? ""}`} style={{ backgroundImage: url ? `url(${url})` : undefined }} />;
}

// The picture for an asset entry, wherever it comes from.
export function EntryThumb({ source, entry, className, w, h }: { source: AssetSource; entry: AssetEntry; className?: string; w?: number; h?: number }) {
    return source.local ? <AssetThumb doc={source.doc} id={entry.id} className={className} w={w} h={h} /> : <LibraryThumb libraryId={source.id} assetId={entry.id} hash={entry.hash ?? ""} className={className} w={w} h={h} />;
}
