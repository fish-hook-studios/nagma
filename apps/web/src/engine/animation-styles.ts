import { nanoid } from "nanoid";
import { editor } from "./store";
import { stylesOf } from "./styles";
import type { AnimationStyle, Command, Interaction, NagmaDocument, PrototypeAction, Transition } from "./types";

// Animation styles: a saved transition (animation type, direction, easing and duration) that
// prototype interactions follow by id. Editing a style updates every transition that follows it;
// detaching keeps the values and forgets the link.

export function animationStyles(doc: NagmaDocument): AnimationStyle[] {
    return stylesOf(doc).animations ?? [];
}

// The transition without its link, as stored in a style.
function bare(t: Transition): Transition {
    const { styleId: _style, ...rest } = t;
    return rest;
}

// Rewrites every transition in the file that follows `styleId` (actions inside conditionals too).
function followerCommands(doc: NagmaDocument, styleId: string, next: (t: Transition) => Transition): Command[] {
    const mapActions = (actions: PrototypeAction[]): [PrototypeAction[], boolean] => {
        let changed = false;
        const out = actions.map((a) => {
            let action = a;
            if (a.transition?.styleId === styleId) {
                action = { ...action, transition: next(a.transition) };
                changed = true;
            }
            if (a.blocks) {
                const blocks = a.blocks.map((b) => {
                    const [inner, c] = mapActions(b.actions);
                    if (c) changed = true;
                    return c ? { ...b, actions: inner } : b;
                });
                action = { ...action, blocks };
            }
            return action;
        });
        return [out, changed];
    };
    return Object.values(doc.nodes).flatMap((node): Command[] => {
        if (!node.interactions?.length) return [];
        let changed = false;
        const interactions = node.interactions.map((i): Interaction => {
            let out = i;
            if (i.transition?.styleId === styleId) {
                out = { ...out, transition: next(i.transition) };
                changed = true;
            }
            if (i.actions) {
                const [actions, c] = mapActions(i.actions);
                if (c) {
                    out = { ...out, actions };
                    changed = true;
                }
            }
            return out;
        });
        return changed ? [{ type: "node.update", id: node.id, patch: { interactions } }] : [];
    });
}

function setAnimations(doc: NagmaDocument, animations: AnimationStyle[], extra: Command[] = []) {
    editor.execute({ type: "batch", commands: [{ type: "styles.set", styles: { ...stylesOf(doc), animations } }, ...extra] });
}

export function createAnimationStyle(name: string, transition: Transition): AnimationStyle {
    const { doc } = editor.get();
    const list = animationStyles(doc);
    const style: AnimationStyle = { id: nanoid(8), name: name.trim() || `Animation ${list.length + 1}`, transition: bare(transition) };
    setAnimations(doc, [...list, style]);
    return style;
}

// A transition that follows the style (its values, and the link).
export function followStyle(style: AnimationStyle): Transition {
    return { ...style.transition, styleId: style.id };
}

export function updateAnimationStyle(id: string, patch: Partial<Omit<AnimationStyle, "id">>) {
    const { doc } = editor.get();
    const list = animationStyles(doc);
    const style = list.find((s) => s.id === id);
    if (!style) return;
    const next: AnimationStyle = { ...style, ...patch, ...(patch.transition ? { transition: bare(patch.transition) } : {}) };
    const extra = patch.transition ? followerCommands(doc, id, () => followStyle(next)) : [];
    setAnimations(
        doc,
        list.map((s) => (s.id === id ? next : s)),
        extra,
    );
}

// Deleting a style leaves its followers with the values they had.
export function deleteAnimationStyle(id: string) {
    const { doc } = editor.get();
    setAnimations(
        doc,
        animationStyles(doc).filter((s) => s.id !== id),
        followerCommands(doc, id, (t) => bare(t)),
    );
}

export function duplicateAnimationStyle(id: string) {
    const { doc } = editor.get();
    const list = animationStyles(doc);
    const style = list.find((s) => s.id === id);
    if (!style) return;
    const at = list.indexOf(style);
    const copy: AnimationStyle = { ...style, id: nanoid(8), name: `${style.name} copy` };
    setAnimations(doc, [...list.slice(0, at + 1), copy, ...list.slice(at + 1)]);
}

// "Ease out, 300ms" and the like, for lists.
export function describeTransition(t: Transition): string {
    const kind = t.type === "smart" ? "Match animate" : t.type.charAt(0).toUpperCase() + t.type.slice(1).replace(/-/g, " ");
    return t.type === "instant" ? "Instant" : `${kind}, ${t.easing.replace(/-/g, " ")}, ${t.duration}ms`;
}
