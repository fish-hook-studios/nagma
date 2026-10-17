import { expandGroups } from "./nodes";
import type { Command, NagmaDocument, SceneNode } from "./types";

// Groups have no transform of their own (their box always wraps their children), so turning or
// mirroring a group turns or mirrors every layer inside it about the group's centre.

const normal = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

// The rotation shown for a group: its layers' shared rotation (0 when they differ).
export function groupRotation(doc: NagmaDocument, group: SceneNode): number {
    const leaves = expandGroups(doc, [group.id]).map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    const first = leaves[0]?.rotation ?? 0;
    return leaves.every((n) => Math.abs(n.rotation - first) < 0.01) ? first : 0;
}

export function rotateGroup(doc: NagmaDocument, group: SceneNode, delta: number): Command[] {
    if (!delta) return [];
    const cx = group.x + group.w / 2;
    const cy = group.y + group.h / 2;
    const rad = (delta * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return expandGroups(doc, [group.id]).flatMap((id): Command[] => {
        const leaf = doc.nodes[id];
        if (!leaf) return [];
        const lx = leaf.x + leaf.w / 2 - cx;
        const ly = leaf.y + leaf.h / 2 - cy;
        const nx = cx + lx * cos - ly * sin;
        const ny = cy + lx * sin + ly * cos;
        return [{ type: "node.update", id, patch: { x: nx - leaf.w / 2, y: ny - leaf.h / 2, rotation: normal(leaf.rotation + delta) } }];
    });
}

export function flipGroup(doc: NagmaDocument, group: SceneNode, axis: "x" | "y"): Command[] {
    const cx = group.x + group.w / 2;
    const cy = group.y + group.h / 2;
    return expandGroups(doc, [group.id]).flatMap((id): Command[] => {
        const leaf = doc.nodes[id];
        if (!leaf) return [];
        // Mirroring a turned layer turns it the other way.
        const patch =
            axis === "x"
                ? { x: 2 * cx - (leaf.x + leaf.w / 2) - leaf.w / 2, flipX: !leaf.flipX, rotation: normal(-leaf.rotation) }
                : { y: 2 * cy - (leaf.y + leaf.h / 2) - leaf.h / 2, flipY: !leaf.flipY, rotation: normal(-leaf.rotation) };
        return [{ type: "node.update", id, patch }];
    });
}
