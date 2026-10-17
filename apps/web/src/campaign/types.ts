// What makes a document a campaign, kept on its layers so undo, sync, copies and version history
// carry it along like any other property.
//
// - The page holds the rows (one per template or variation set), the brand kit and the bulk data.
// - Each asset is a top-level frame with a size preset and the row it sits in.
// - Layers inside a template carry a field name and what editors may change about them.

export interface CampaignRow {
    id: string;
    name: string;
    // Rows made by bulk create remember their source, so running it again updates the assets.
    bulk?: BulkSource | null;
}

export interface BulkSource {
    templateId: string;
    // Header names, then one array of cells per data row.
    columns: string[];
    rows: string[][];
    // Field name → column name.
    mapping: Record<string, string>;
    // The column whose cells name the assets (and their exported files).
    nameColumn?: string | null;
}

export interface BrandColor {
    name: string;
    color: string;
}

export interface BrandTextStyle {
    name: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
}

export interface BrandKit {
    // The design library the kit was pulled from, if any.
    libraryId?: string | null;
    libraryName?: string | null;
    colors: BrandColor[];
    texts: BrandTextStyle[];
    // Logos: image ids in the document's images.
    logos: { id: string; name: string; imageId: string }[];
}

export interface LayerLocks {
    // Locked content: the text or image can't change. Locked position: it can't move or resize.
    // Locked style: its colours can't change.
    content: boolean;
    position: boolean;
    style: boolean;
}

export type FieldKind = "text" | "image" | "color";

export type CampaignData =
    | {
          kind: "page";
          rows: CampaignRow[];
          brand?: BrandKit | null;
          // Assets go out only once a reviewer has approved them.
          requireApproval?: boolean;
      }
    | {
          kind: "asset";
          preset: string;
          rowId: string;
          // A template is the asset other assets are made from (bulk create, Duplicate as variant).
          template?: boolean;
          // Assets made from a template: which one, and (bulk) which data row.
          sourceId?: string | null;
          bulkIndex?: number | null;
          // A template published to a team (its id there, and the version last published).
          published?: { id: string; teamId: string; version: number } | null;
          // An asset started from a team's template, and the version it came from.
          fromTemplate?: { id: string; teamId: string; version: number; name: string } | null;
      }
    | {
          kind: "layer";
          // The field's label in the Edit panel and the column it maps to in bulk create.
          field: string;
          type: FieldKind;
          locks: LayerLocks;
          // Colour choices limited to the brand palette.
          brandOnly?: boolean;
      };
