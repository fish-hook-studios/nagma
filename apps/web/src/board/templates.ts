import { viewCenter } from "../engine/actions";
import { makeNode } from "../engine/nodes";
import { solid } from "../engine/paint";
import { editor } from "../engine/store";
import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import { myName } from "./actions";
import { makeConnector, makeShapeNode, makeSticky, makeTable } from "./model";

// Board templates: ready-made layouts of sections, stickies, shapes and connectors, placed at the
// middle of the view as one undo step.

export interface BoardTemplate {
    id: string;
    name: string;
    description: string;
    category: "Brainstorming" | "Meetings" | "Diagramming" | "Strategy" | "Research";
    colors: string[];
    build: (doc: NagmaDocument, x: number, y: number, page: string) => SceneNode[];
}

function section(doc: NagmaDocument, name: string, x: number, y: number, w: number, h: number, color: string, page: string): SceneNode {
    return makeNode(doc, "frame", { x, y, w, h }, page, { name, isSection: true, clip: false, fills: [solid(color)], radius: 8 });
}

// Stickies inside a section (their coordinates are the section's).
function stickies(doc: NagmaDocument, parent: SceneNode, texts: string[], color: string): SceneNode[] {
    return texts.map((text, i) => ({ ...makeSticky(doc, 40 + (i % 3) * 260, 60 + Math.floor(i / 3) * 260, color, parent.id, myName()), text, name: text }));
}

export const BOARD_TEMPLATES: BoardTemplate[] = [
    {
        id: "brainstorm",
        name: "Brainstorm",
        category: "Brainstorming",
        description: "A topic in the middle and room for ideas around it.",
        colors: ["#FFE299", "#A8DAFF"],
        build(doc, x, y, page) {
            const s = section(doc, "Brainstorm", x - 420, y - 320, 840, 640, "#FFF4D1", page);
            const topic = { ...makeShapeNode(doc, "circle", { x: 320, y: 220, w: 200, h: 200 }, "#C2E5FF", s.id), text: "Topic" };
            const ideas = [
                [40, 40], [600, 40], [40, 380], [600, 380],
            ].map(([sx, sy], i) => ({ ...makeSticky(doc, sx ?? 0, sy ?? 0, "#FFE299", s.id, myName()), w: 200, h: 200, text: `Idea ${i + 1}` }));
            return [s, topic, ...ideas];
        },
    },
    {
        id: "retro",
        name: "Retrospective",
        category: "Meetings",
        description: "What went well, what could be better, and what to do next.",
        colors: ["#B3EFBD", "#FFB8A8", "#D3BDFF"],
        build(doc, x, y, page) {
            const cols: [string, string, string][] = [
                ["What went well", "#DDF5E3", "#B3EFBD"],
                ["What could be better", "#FFE2DE", "#FFB8A8"],
                ["Action items", "#EEE3FF", "#D3BDFF"],
            ];
            const out: SceneNode[] = [];
            cols.forEach(([name, bg, note], i) => {
                const s = section(doc, name, x - 900 + i * 600, y - 320, 560, 640, bg, page);
                out.push(s, ...stickies(doc, s, ["Add a note"], note).map((n) => ({ ...n, x: 40, y: 60 })));
            });
            return out;
        },
    },
    {
        id: "kanban",
        name: "Kanban",
        category: "Strategy",
        description: "To do, doing and done columns with a few cards.",
        colors: ["#E6E6E6", "#FFD3A8", "#B3EFBD"],
        build(doc, x, y, page) {
            const cols: [string, string][] = [["To do", "#F2F2F2"], ["Doing", "#FFEBD6"], ["Done", "#DDF5E3"]];
            const out: SceneNode[] = [];
            cols.forEach(([name, bg], i) => {
                const s = section(doc, name, x - 690 + i * 460, y - 360, 420, 720, bg, page);
                out.push(s);
                const cards = i === 0 ? ["Task one", "Task two"] : i === 1 ? ["Task three"] : [];
                cards.forEach((text, k) => out.push({ ...makeSticky(doc, 40, 60 + k * 230, i === 0 ? "#FFFFFF" : i === 1 ? "#FFD3A8" : "#B3EFBD", s.id, myName()), w: 340, h: 200, text, name: text }));
            });
            return out;
        },
    },
    {
        id: "flowchart",
        name: "Flowchart",
        category: "Diagramming",
        description: "Start, a decision and two outcomes, joined up.",
        colors: ["#C2E5FF", "#FFF1C2"],
        build(doc, x, y, page) {
            const start = { ...makeShapeNode(doc, "rounded", { x: x - 100, y: y - 320, w: 200, h: 80 }, "#C2E5FF", page), text: "Start" };
            const decide = { ...makeShapeNode(doc, "diamond", { x: x - 100, y: y - 160, w: 200, h: 160 }, "#FFF1C2", page), text: "Decision?" };
            const yes = { ...makeShapeNode(doc, "square", { x: x - 340, y: y + 100, w: 200, h: 100 }, "#CFF7D3", page), text: "Yes" };
            const no = { ...makeShapeNode(doc, "square", { x: x + 140, y: y + 100, w: 200, h: 100 }, "#FFC7C2", page), text: "No" };
            const link = (a: SceneNode, b: SceneNode, from: "bottom" | "left" | "right", to: "top") => makeConnector(doc, { id: a.id, side: from, x: 0, y: 0 }, { id: b.id, side: to, x: 0, y: 0 }, "elbow", "#1E1E1E", page);
            return [start, decide, yes, no, link(start, decide, "bottom", "top"), link(decide, yes, "left", "top"), link(decide, no, "right", "top")];
        },
    },
    {
        id: "mindmap",
        name: "Mind map",
        category: "Brainstorming",
        description: "A central topic with branches; ⌘ Enter adds a child, ⌘ ⇧ Enter a sibling.",
        colors: ["#E4CCFF", "#C2E5FF", "#CDF4D3"],
        build(doc, x, y, page) {
            const root = { ...makeShapeNode(doc, "rounded", { x: x - 120, y: y - 50, w: 240, h: 100 }, "#E4CCFF", page), text: "Central topic", fontSize: 24 };
            const out: SceneNode[] = [root];
            const branches: [string, number, number, string][] = [["Idea", 280, -170, "#C2E5FF"], ["Idea", 280, 70, "#CDF4D3"], ["Idea", -520, -170, "#FFE0C2"], ["Idea", -520, 70, "#FFC2EC"]];
            for (const [text, dx, dy, color] of branches) {
                const b = { ...makeShapeNode(doc, "rounded", { x: x + dx, y: y + dy, w: 240, h: 100 }, color, page), text };
                const right = dx > 0;
                const line = makeConnector(doc, { id: root.id, side: right ? "right" : "left", x: 0, y: 0 }, { id: b.id, side: right ? "left" : "right", x: 0, y: 0 }, "curved", "#757575", page, { start: "none", end: "none" });
                out.push(b, line.jam?.kind === "connector" ? { ...line, jam: { ...line.jam, mind: true } } : line);
            }
            return out;
        },
    },
    {
        id: "meeting",
        name: "Weekly meeting",
        category: "Meetings",
        description: "Agenda, notes and action items for a recurring meeting.",
        colors: ["#C2E5FF", "#FFECBD", "#CDF4D3"],
        build(doc, x, y, page) {
            const cols: [string, string, string, string[]][] = [
                ["Agenda", "#E1F2FF", "#A8DAFF", ["Updates", "Discussion"]],
                ["Notes", "#FFF6DE", "#FFE299", ["Add a note"]],
                ["Action items", "#E6F9E9", "#B3EFBD", ["Owner: task"]],
            ];
            const out: SceneNode[] = [];
            cols.forEach(([name, bg, note, items], i) => {
                const s = section(doc, name, x - 900 + i * 600, y - 340, 560, 680, bg, page);
                out.push(s, ...items.map((text, k) => ({ ...makeSticky(doc, 40, 60 + k * 260, note, s.id, myName()), w: 480, text, name: text, jam: { kind: "sticky" as const, author: myName(), showAuthor: true, wide: true } })));
            });
            return out;
        },
    },
    {
        id: "swot",
        name: "SWOT analysis",
        category: "Strategy",
        description: "Strengths, weaknesses, opportunities and threats.",
        colors: ["#CDF4D3", "#FFCDC2", "#C2E5FF", "#FFECBD"],
        build(doc, x, y, page) {
            const quads: [string, string, string][] = [["Strengths", "#E6F9E9", "#B3EFBD"], ["Weaknesses", "#FFE6E1", "#FFB8A8"], ["Opportunities", "#E1F2FF", "#A8DAFF"], ["Threats", "#FFF6DE", "#FFE299"]];
            const out: SceneNode[] = [];
            quads.forEach(([name, bg, note], i) => {
                const s = section(doc, name, x - 620 + (i % 2) * 640, y - 460 + Math.floor(i / 2) * 480, 600, 440, bg, page);
                out.push(s, { ...makeSticky(doc, 40, 60, note, s.id, myName()), text: "Add a note", name: "Add a note" });
            });
            return out;
        },
    },
    {
        id: "proscons",
        name: "Pros and cons",
        category: "Strategy",
        description: "Two columns to weigh up a decision.",
        colors: ["#CDF4D3", "#FFCDC2"],
        build(doc, x, y, page) {
            const out: SceneNode[] = [];
            ([["Pros", "#E6F9E9", "#B3EFBD"], ["Cons", "#FFE6E1", "#FFB8A8"]] as const).forEach(([name, bg, note], i) => {
                const s = section(doc, name, x - 600 + i * 620, y - 360, 580, 720, bg, page);
                out.push(s, { ...makeSticky(doc, 40, 60, note, s.id, myName()), text: "Add a point", name: "Add a point" });
            });
            return out;
        },
    },
    {
        id: "journey",
        name: "User journey",
        category: "Research",
        description: "Stages across, with what people do, think and feel in each.",
        colors: ["#E6E6E6", "#C2E5FF"],
        build(doc, x, y, page) {
            const s = section(doc, "User journey", x - 560, y - 220, 1120, 440, "#F2F2F2", page);
            const cells = [
                ["", "Discover", "Try", "Buy", "Use"],
                ["Doing", "", "", "", ""],
                ["Thinking", "", "", "", ""],
                ["Feeling", "", "", "", ""],
            ];
            const table = { ...makeTable(doc, 40, 60, s.id, 5, 4, cells), w: 1040, h: 340 };
            return [s, table];
        },
    },
];

export const TEMPLATE_CATEGORIES = ["All", "Brainstorming", "Meetings", "Diagramming", "Strategy", "Research"] as const;

// Templates lay out what goes in their sections from each section's corner; layers keep world
// coordinates, so those children move by their section's position (they landed near the board's
// origin, outside their sections).
export function placeInSections(nodes: SceneNode[]): SceneNode[] {
    const made = new Map(nodes.map((n) => [n.id, n]));
    return nodes.map((n) => {
        const parent = n.parentId ? made.get(n.parentId) : undefined;
        return parent?.isSection ? { ...n, x: n.x + parent.x, y: n.y + parent.y } : n;
    });
}

// Places a template in the middle of the view, or filling a section (`into`).
export function insertTemplate(template: BoardTemplate, into?: string) {
    const s = editor.get();
    const host = into ? s.doc.nodes[into] : undefined;
    const parent = host?.isSection ? host.id : s.pageId;
    const c = host?.isSection ? { x: host.x + host.w / 2, y: host.y + host.h / 2 + 20 } : viewCenter();
    const nodes = placeInSections(template.build(s.doc, c.x, c.y, parent));
    const commands: Command[] = nodes.map((node) => ({ type: "node.create", node }));
    editor.execute({ type: "batch", commands });
    const top = nodes.filter((n) => n.parentId === parent).map((n) => n.id);
    editor.set({ selection: top });
}
