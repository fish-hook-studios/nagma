// What makes a layer a whiteboard object. The layer itself is an ordinary rect, ellipse or vector
// (so selection, moving, resizing, undo, sync and export keep working); this says how the board
// draws and edits it on top of that.

// The four type looks a sticky, shape or connector label can use.
export type JamFont = "simple" | "bookish" | "technical" | "scribbled";

export type ShapeKind =
    | "square"
    | "rounded"
    | "circle"
    | "ellipse"
    | "diamond"
    | "triangle"
    | "triangle-down"
    | "pentagon"
    | "hexagon"
    | "octagon"
    | "plus"
    | "star"
    | "arrow-left"
    | "arrow-right"
    | "chevron"
    | "speech"
    | "parallelogram"
    | "parallelogram-left"
    | "cylinder-h"
    | "file"
    | "documents"
    | "shield"
    | "trapezoid"
    | "cylinder"
    | "document"
    | "folder"
    | "predefined"
    | "manual-input"
    | "off-page"
    | "display"
    | "internal-storage"
    | "summing"
    | "or"
    | "cloud"
    | "user"
    | "mobile"
    | "desktop"
    | "server"
    | "email"
    | "security"
    | "location"
    | "terminal"
    | "web"
    | "payment"
    | "instant"
    | "package"
    | "chat"
    | "activity"
    | "storage"
    | "send"
    | "wallet"
    | "archive"
    | "authentication"
    | "computer"
    | "frontend"
    | "service"
    | "settings"
    | "file-icon"
    | "analytics"
    | "cloud-compute"
    | "cloud-storage"
    | "cloud-database"
    | "cloud-function"
    | "cloud-queue"
    | "cloud-cdn"
    | "cloud-balancer"
    | "cloud-network"
    | "cloud-container"
    | "cloud-gateway"
    | "cloud-cache"
    | "cloud-monitor";

export type ConnectorLine = "elbow" | "curved" | "straight";
// End caps, including the six entity-relationship (crow's foot) ends.
export type ConnectorCap = "none" | "arrow" | "line-arrow" | "triangle" | "diamond" | "circle" | "erd-one" | "erd-many" | "erd-only-one" | "erd-zero-or-one" | "erd-one-or-many" | "erd-zero-or-many";
export type Side = "top" | "right" | "bottom" | "left";

// One end of a connector: attached to a layer (on a side, at its centre, or at a point given as a
// fraction of the layer's box when placed with ⌘), or loose at a world point.
export interface ConnectorEnd {
    id: string | null;
    side: Side | null;
    at?: { u: number; v: number } | null;
    // Aimed at the layer's centre: the line stops where it meets the layer's edge.
    center?: boolean;
    x: number;
    y: number;
}

// The preset stamps, any emoji ("emoji", with its glyph) and a collaborator's face ("face").
export type StampKind = "thumbs-up" | "thumbs-down" | "heart" | "plus-one" | "star" | "question" | "check" | "fire" | "laugh" | "party" | "emoji" | "face";
// A stamp to place: a preset, an emoji, or someone's face (their name and colour).
export interface StampPick {
    kind: StampKind;
    glyph?: string;
    face?: { name: string; color: string };
}

// A table cell's own text look (unset parts follow the table).
export interface CellStyle {
    font?: JamFont;
    color?: string;
    size?: number;
    bold?: boolean;
    strike?: boolean;
    align?: "left" | "center" | "right";
    link?: string;
}

export type WashiPattern = "dots" | "stripes" | "grid" | "waves" | "hearts" | "checks" | "stars" | "plain" | "custom";

export interface BoardTimer {
    // Milliseconds set, and either when it ends (running) or how much is left (paused).
    total: number;
    endsAt: number | null;
    left: number;
    music: boolean;
    // Which of the music tracks plays (the same one for everyone).
    track?: string;
}

export type JamData =
    | { kind: "sticky"; author?: string; showAuthor?: boolean; font?: JamFont; textColor?: string; wide?: boolean; baseH?: number }
    | { kind: "shape"; shape: ShapeKind; font?: JamFont; textColor?: string }
    // A connector; its label sits `labelAt` of the way along (half way when unset), on a plate of
    // the line's colour when `labelBg` is on. An elbowed line whose segments were dragged keeps its
    // own path: `coords` are the world positions of its inner segments in turn, the first running
    // along `axis` from the start. `radius` rounds an elbow's corners (12 when unset). `mind` marks a
    // mind map's branch line.
    | { kind: "connector"; start: ConnectorEnd; end: ConnectorEnd; line: ConnectorLine; startCap: ConnectorCap; endCap: ConnectorCap; dashed?: boolean; font?: JamFont; labelAt?: number; labelBg?: boolean; mid?: number; bend?: number; coords?: number[]; axis?: "h" | "v"; radius?: number; mind?: boolean }
    // A stamp, optionally stuck to the object it was dropped on (at a point given as a fraction of its box).
    | { kind: "stamp"; stamp: StampKind; glyph?: string; face?: { name: string; color: string }; author?: string; on?: string; at?: { u: number; v: number } }
    // A table: column and row shares of its size, each cell's text, cell background colours, each
    // cell's own text look, and merged blocks (the top-left cell of each holds its text).
    | { kind: "table"; cols: number[]; rows: number[]; cells: string[][]; header?: string; fills?: (string | null)[][]; styles?: (CellStyle | null)[][]; merges?: { r: number; c: number; rs: number; cs: number }[] }
    // Washi tape: a preset pattern, or an uploaded image repeated along the strip.
    | { kind: "washi"; pattern: WashiPattern; color: string; image?: string }
    // A doodle; highlights stick to the object they were drawn over, like stamps.
    | { kind: "draw"; tool: "marker" | "highlighter"; on?: string; at?: { u: number; v: number } }
    // A link preview: the address, the page's details once looked up, and how it shows (a card
    // across or down, or minimized to a line). Embeddable addresses carry the embed's address.
    | { kind: "link"; url: string; title?: string; description?: string; site?: string; image?: string; display?: "vertical" | "minimized"; embed?: string; embedKind?: "video" | "map" | "audio" | "file" }
    // A sticker: a big emoji placed on the board.
    | { kind: "sticker"; glyph: string; author?: string }
    // A built-in widget: a poll (votes by person id), a checklist or a counter.
    | { kind: "widget"; widget: "poll" | "checklist" | "counter"; title: string; items: { id: string; text: string; done?: boolean; votes?: string[] }[]; count?: number }
    // A code block and its language for highlighting.
    | { kind: "code"; lang: string }
    // A section's board state: its contents hidden (and which of them were showing).
    | { kind: "section"; hidden?: boolean; shown?: string[]; lockBg?: boolean }
    // The board's page: the shared timer and the voting session (votes by person id, with the
    // names to show, who started it, when it ends, and who said they're done).
    | { kind: "board"; mentions?: { id: string; to: string; name: string; by: string; node: string; at: number }[]; timer?: BoardTimer | null; voting?: { id?: string; open: boolean; limit: number; votes: Record<string, string[]>; names?: Record<string, string>; prompt?: string; host?: string; hostPeer?: string | null; endsAt?: number | null; done?: string[] } | null };

export type JamKind = JamData["kind"];
