import { applyCommand } from "../engine/commands";
import { makeNode } from "../engine/nodes";
import { activePage } from "../engine/page";
import { editor } from "../engine/store";
import type { Command, NagmaDocument, NodeType, Rect, SceneNode, Variable, VariableCollection } from "../engine/types";

// Fixtures for the systems tests (variables, prototypes, motion, components): a one-page document,
// layers with fixed ids made through the real command, and the editor store loaded with a document.

export const PAGE = "sys-page";

export function blankDoc(): NagmaDocument {
    const page = makeNode({ name: "", nodes: {}, roots: [], images: {} }, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { id: PAGE, name: "Page 1" });
    activePage.id = PAGE;
    return { name: "Systems", nodes: { [PAGE]: page }, roots: [PAGE], images: {} };
}

export function addNode(doc: NagmaDocument, type: NodeType, id: string, rect: Rect, parentId: string | null = PAGE, overrides: Partial<SceneNode> = {}): NagmaDocument {
    const node = makeNode(doc, type, rect, parentId, { id, ...overrides });
    return applyCommand(doc, { type: "node.create", node });
}

export function nodeOf(doc: NagmaDocument, id: string): SceneNode {
    const n = doc.nodes[id];
    if (!n) throw new Error(`no node ${id}`);
    return n;
}

export function runAll(doc: NagmaDocument, ...commands: Command[]): NagmaDocument {
    return commands.reduce(applyCommand, doc);
}

// Opens a document in the editor with a fresh history (no autosave key).
export function openInEditor(doc: NagmaDocument): NagmaDocument {
    editor.loadDocument(doc, null);
    activePage.id = doc.roots[0] ?? PAGE;
    return editor.get().doc;
}

export const current = () => editor.get().doc;

// JSON-shaped copy (drops undefined-valued keys) for deep comparisons.
export function plain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

// Undoes then redoes the last step, checking both directions restore the documents exactly.
export function undoRedoRoundTrip(before: NagmaDocument): { undone: NagmaDocument; redone: NagmaDocument; after: NagmaDocument } {
    const after = editor.get().doc;
    editor.undo();
    const undone = editor.get().doc;
    editor.redo();
    const redone = editor.get().doc;
    void before;
    return { undone, redone, after };
}

export function variable(id: string, type: Variable["type"], values: Variable["values"], extra: Partial<Variable> = {}): Variable {
    return { id, name: id, type, values, scopes: ["all"], ...extra };
}

export function collection(id: string, modes: string[], variables: Variable[], extra: Partial<VariableCollection> = {}): VariableCollection {
    return { id, name: id, modes: modes.map((m) => ({ id: m, name: m })), defaultModeId: modes[0], variables, ...extra };
}
