// Shared helpers for the product-logic tests (fig import, campaign, sites, slides, board).
// (DOMMatrix and DOMPoint for jsdom come from src/test/dommatrix.ts, loaded by setup.ts.)

import { expect } from "vitest";
import type { NagmaDocument } from "../engine/types";

// Every parent/child link in a document agrees both ways, every child exists, roots have no parent.
export function expectConsistentTree(doc: NagmaDocument) {
    const problems: string[] = [];
    for (const id of doc.roots) {
        const n = doc.nodes[id];
        if (!n) problems.push(`root ${id} missing`);
        else if (n.parentId) problems.push(`root ${id} has parent ${n.parentId}`);
    }
    for (const [id, n] of Object.entries(doc.nodes)) {
        if (n.id !== id) problems.push(`${id} keyed under a different id ${n.id}`);
        if (n.parentId) {
            const p = doc.nodes[n.parentId];
            if (!p) problems.push(`${id} parent ${n.parentId} missing`);
            else if (!p.children.includes(id)) problems.push(`${id} not in parent ${n.parentId}'s children`);
        } else if (!doc.roots.includes(id)) problems.push(`${id} has no parent and is not a root`);
        const seen = new Set<string>();
        for (const c of n.children) {
            if (seen.has(c)) problems.push(`${id} lists child ${c} twice`);
            seen.add(c);
            const child = doc.nodes[c];
            if (!child) problems.push(`${id} child ${c} missing`);
            else if (child.parentId !== id) problems.push(`${id} child ${c} points at parent ${child.parentId}`);
        }
    }
    expect(problems).toEqual([]);
}

// No geometry field is NaN or infinite.
export function expectFiniteGeometry(doc: NagmaDocument) {
    const bad: string[] = [];
    for (const n of Object.values(doc.nodes)) {
        for (const k of ["x", "y", "w", "h", "rotation"] as const) {
            const v = (n as unknown as Record<string, unknown>)[k];
            if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) bad.push(`${n.id} (${n.name}) ${k}=${String(v)}`);
        }
        for (const sp of (n as { subpaths?: { points: { x: number; y: number }[] }[] }).subpaths ?? []) for (const p of sp.points) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) bad.push(`${n.id} path point ${p.x},${p.y}`);
    }
    expect(bad).toEqual([]);
}
