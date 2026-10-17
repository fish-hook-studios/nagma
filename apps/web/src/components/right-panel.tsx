import { useCollab } from "../engine/collab";
import { useEditor } from "../engine/store";
import { VersionHistoryPanel } from "./version-history";
import { CommentsPanel } from "./comments-ui";
import { DesignPanel } from "./design-panel";
import { DevPanel } from "./dev-panel";
import { PresenceBar, PresentButton, ShareButton } from "./collab-ui";
import { FramePresetsPanel } from "./frame-presets-panel";

// The right sidebar: Comments while the Comment tool is on, frame presets while the Frame tool is
// on, the Inspect panel, or Design/Prototype.
export function RightPanel() {
    return (
        <div data-region="right" className="contents">
            <RightPanelBody />
        </div>
    );
}

function RightPanelBody() {
    const mode = useEditor((s) => s.mode);
    const tool = useEditor((s) => s.tool);
    const readOnly = useEditor((s) => s.readOnly);
    const history = useCollab((s) => s.historyOpen);
    if (history) return <VersionHistoryPanel presence />;
    if (tool === "comment") return <CommentsPanel presence />;
    if (tool === "frame" && !readOnly && mode !== "dev") return <FramePresetsPanel />;
    if (mode === "dev") {
        // Inspect: 320 wide, with the same people / Present / Share row as Design (Share in green).
        return (
            <aside data-right-panel="" className="flex h-full w-80 shrink-0 flex-col border-l border-panel-border bg-panel text-[11px]">
                <header className="flex h-12 shrink-0 items-center gap-1 px-2">
                    <PresenceBar chevron />
                    <div className="flex-1" />
                    <PresentButton />
                    <ShareButton size="lg" tone="dev" className="" />
                </header>
                <div className="min-h-0 flex-1">
                    <DevPanel />
                </div>
            </aside>
        );
    }
    return <DesignPanel />;
}
