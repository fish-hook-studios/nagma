// Make files: a prompt-to-app project. The document's only page carries the project (its files,
// the chat that made them and a snapshot of the files after each answer), so versions, sharing and
// undo work the way they do for every other file.

// Something attached to a prompt: a picture (pasted, dropped or picked) or a frame from a design
// file, pictured and described for the model.
export interface MakeAttachment {
    id: string;
    kind: "image" | "frame";
    name: string;
    // The picture, as a document image id (doc.images).
    image: string;
    // Frames: the design file it came from and its layers as structured data.
    fileName?: string;
    description?: string;
    // Frames: the frame's size, for the offline converter's layout.
    w?: number;
    h?: number;
    // Frames: the converted static app's files, made when it was attached (no model needed).
    offline?: Record<string, string>;
}

export interface MakeTurn {
    id: string;
    role: "user" | "assistant";
    text: string;
    at: number;
    author?: string;
    // Prompts: what came with them.
    attachments?: MakeAttachment[];
    // Prompts made with an element selected in the preview: where it is in the code.
    element?: string;
    // Answers: the files they added or changed and removed, and every file's content after them
    // (path to blob key), for "Restore this version".
    changed?: string[];
    removed?: string[];
    snapshot?: Record<string, string>;
    // Answers made without the model (a frame converted as it is), restores and errors.
    offline?: boolean;
    restoredFrom?: string;
    error?: boolean;
    // Plan mode: the steps the model proposes, and whether the person approved them (the build that
    // followed is the next turns).
    plan?: string[];
    planState?: "proposed" | "approved" | "dismissed";
    // The model that answered, when one was picked.
    model?: string;
}

// An MCP server the model may use while building (its token, if any, stays in this browser tab's
// memory and goes only with the request).
export interface MakeConnector {
    name: string;
    url: string;
}

export interface MakeData {
    kind: "project";
    // The project's files now, by path.
    files: Record<string, string>;
    // File contents the turn snapshots point at, by content key (shared between turns).
    blobs: Record<string, string>;
    turns: MakeTurn[];
    // The design system the prompts include: a library's variables and styles as CSS variables and
    // its components' descriptions.
    libraryId?: string | null;
    // The app published from this file, and when.
    published?: { id: string; at: number } | null;
    // The app's id for publishing, made once (files that live in a browser have no server id).
    appId?: string;
    // The built-in backend is on (src/lib/backend.ts talks to this server's store for the app).
    backend?: boolean;
    // Settings for prompts: the model picked, web search, MCP connectors.
    model?: string | null;
    web?: boolean;
    connectors?: MakeConnector[];
    // GitHub: the repository last pushed to.
    github?: { repo: string; url: string; at: number } | null;
    // The kit or template this file was published as, to update it.
    libraryItem?: { id: string; kind: "kit" | "template" } | null;
}

// What the preview reports about the element picked in Point and edit.
export interface PickedElement {
    // Computed styles the properties panel starts from (all optional: older previews don't send them).
    style?: Record<string, string>;
    // "path:line" in the project's source.
    src: string;
    tag: string;
    text: string;
    html: string;
    color: string;
    background: string;
    classes: string;
}
