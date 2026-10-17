import { NotesLayer } from "./annotations-ui";
import { BranchPill } from "./branch-ui";
import { CommentLayer } from "./comments-ui";
import { CursorChat, FollowFrame } from "./follow-ui";
import { FrameQuickAdd } from "./frame-presets-panel";
import { LabelRename } from "./label-rename";
import { LoadingStates } from "./loading-states";

// Collaboration layers drawn over the canvas: comment pins and threads, the branch label, cursor chat, and the frame shown while following someone.
export function CanvasOverlays() {
    return (
        <>
            <NotesLayer />
            <CommentLayer />
            <BranchPill />
            <CursorChat />
            <FollowFrame />
            <FrameQuickAdd />
            <LabelRename />
            <LoadingStates />
        </>
    );
}
