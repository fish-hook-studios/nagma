// These are the tokens of a third-party design file format that Nagma reads for import: the
// container headers of its design, slides, campaign and whiteboard files, the markers its clipboard
// wraps copied layers in, and field names inside its documents. They are protocol constants, kept
// verbatim so imported files and pasted layers keep working; this is the only place they are spelled.

// The 8-byte container header of each kind of imported file (a shorter name is padded).
export const FORMAT_MAGIC = {
    design: "fig-kiwi",
    deck: "fig-deck",
    campaign: "fig-buzz",
    board: "fig-jam",
} as const;

// The markers around the base64 layer buffer and the JSON note (image links) in copied HTML.
export const CLIPBOARD_MARKERS = {
    buffer: { open: "(figma)", close: "(/figma)" },
    meta: { open: "(figmeta)", close: "(/figmeta)" },
} as const;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const between = (m: { open: string; close: string }) => new RegExp(`${escape(m.open)}([A-Za-z0-9+/=\\s]+?)${escape(m.close)}`);

// The base64 payload between each pair of markers.
export const CLIPBOARD_BUFFER_PATTERN = between(CLIPBOARD_MARKERS.buffer);
export const CLIPBOARD_META_PATTERN = between(CLIPBOARD_MARKERS.meta);

// The field on a campaign asset that names its size preset.
export const TEMPLATE_DATA_FIELD = "cooperTemplateData";

// The host the copied layers' signed image links point at (the sync server's image proxy keeps
// its own copy of this list in apps/server/interop-hosts.mjs).
export const IMAGE_HOSTS = ["s3-alpha-sig.figma.com"] as const;
