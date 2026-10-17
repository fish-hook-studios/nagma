import { useCollab } from "../engine/collab";
import { useEditor } from "../engine/store";
import { CommentsPanel } from "./comments-ui";
import { VersionHistoryPanel } from "./version-history";

// A board has no Design panel, but version history and the comments list still open on the right,
// as they do in a design file.
export function BoardSidePanel() {
    const history = useCollab((s) => s.historyOpen);
    const commenting = useEditor((s) => s.tool === "comment");
    if (history) return <VersionHistoryPanel />;
    if (commenting) return <CommentsPanel />;
    return null;
}
