import type { ColorStyle, EffectStyle, SceneNode, TextStyle, VariableCollection } from "./types";

// What a published library holds. The manifest lists every item with a hash of its content; the
// layers of each component (and each image) are separate records, loaded only when used.

export interface LibraryComponentEntry {
    // The component's (or component set's) id in the library file.
    id: string;
    type: "component" | "componentSet";
    name: string;
    // Page, frame and "/" folders, for grouping in pickers.
    path: string[];
    description: string;
    descriptionMarkdown?: string;
    docLinks?: { label?: string; url: string }[];
    hash: string;
    // Components named with a leading "." or "_" are hidden from publishing: they only travel
    // along with the components that use them.
    hidden?: boolean;
    w: number;
    h: number;
    // Moved here from another library: that library and the component's id there.
    movedFrom?: { libraryId: string; key: string };
}

export type LibraryStyle = { kind: "color"; style: ColorStyle; hash: string } | { kind: "text"; style: TextStyle; hash: string } | { kind: "effect"; style: EffectStyle; hash: string };

export interface LibrarySummary {
    id: string;
    name: string;
    // The file it was published from (a local file id, or the sync server's file id).
    fileId: string;
    version: number;
    publishedAt: number;
    publishedBy?: string;
    counts: { components: number; styles: number; variables: number };
    // Where this listing came from.
    server?: boolean;
}

export interface LibraryManifest extends LibrarySummary {
    description?: string;
    components: LibraryComponentEntry[];
    styles: LibraryStyle[];
    // Published collections (variables marked "hide from publishing" left out).
    variables: VariableCollection[];
    variableHashes: Record<string, string>;
    // Earlier publishes, newest first: what changed and the note left with it.
    history?: { version: number; at: number; description: string; changes: number }[];
}

export type LibraryItem =
    | {
          kind: "component";
          // The component (or set) first, then everything inside it.
          nodes: SceneNode[];
          // Other components its instances use (component or set ids), published or hidden.
          deps: string[];
          images: string[];
      }
    | { kind: "image"; data: string };

export const componentKey = (id: string) => `c:${id}`;
export const imageKey = (id: string) => `i:${id}`;
