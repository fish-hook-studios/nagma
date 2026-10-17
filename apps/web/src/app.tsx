import { useEffect } from "react";
import { CanvasView } from "./canvas/canvas-view";
import { ActionsPalette } from "./components/actions-palette";
import { ShortcutsPanel } from "./components/shortcuts-panel";
import { AuthModal, InviteModal, ResetPasswordModal } from "./components/auth";
import { ServerLinkPrompt, ServerPicker } from "./components/server-picker";
import { AccountSettingsHost } from "./components/account-settings";
import { useState } from "react";
import { NamePrompt } from "./components/collab-ui";
import { RenameDialog } from "./components/rename-dialog";
import { ErrorBoundary } from "./components/error-boundary";
import { ContextMenu } from "./components/context-menu";
import { DevStatusMenu } from "./components/dev-status";
import { RightPanel } from "./components/right-panel";
import { SaveVersionDialog } from "./components/version-history";
import { BranchDialogs } from "./components/branch-ui";
import { Home } from "./components/home";
import { TabBar } from "./components/tab-bar";
import { BoardEditor } from "./board/board-editor";
import { SlidesEditor } from "./slides/slides-editor";
import { DocumentEditor } from "./document/document-editor";
import { NewDocumentDialog } from "./document/new-document";
import { CampaignEditor } from "./campaign/campaign-editor";
import { SiteEditor } from "./site/site-editor";
import { MakeEditor } from "./make/make-editor";
import { MotionPill, SequencePill } from "./components/motion-pill";
import { MatchingPill } from "./components/matching-pill";
import { Timeline } from "./components/timeline";
import { VideoEditor } from "./components/video-editor";
import { fileMeta } from "./engine/files";
import { LeftSidebar } from "./components/left-sidebar";
import { PdfEditor } from "./components/pdf-editor";
import { PhotoEditor } from "./components/photo-editor";
import { PrototypePlayer } from "./components/prototype-player";
import { PrototypePreview } from "./components/prototype-preview";
import { Toolbar } from "./components/toolbar";
import { VectorBar } from "./components/vector-bar";
import { VectorExtras } from "./components/vector-extras";
import { FloatingBars } from "./components/floating-bars";
import { ImageBar } from "./components/image-bar";
import { VariablesView } from "./components/variables-view";
import { LibraryHost } from "./components/library-modals";
import { editor, useEditor } from "./engine/store";
import { usePrototypeView } from "./engine/prototype-view";
import { useShortcuts } from "./hooks/use-shortcuts";
import { AskTextDialog } from "./components/ask-text";
import { DevViews } from "./components/dev-view";
import { PluginHost } from "./components/plugins-ui";
import { MobileViewer, useMobileViewer } from "./components/mobile-viewer";
import { VerifyBanner } from "./components/verify-email";
import { MoveDraftsOffer } from "./components/move-drafts";
import "./engine/team-features";

export function App() {
    useShortcuts();
    const toast = useEditor((s) => s.toast);
    const toastAction = useEditor((s) => s.toastAction);
    const uiHidden = useEditor((s) => s.uiHidden);
    const uiMinimized = useEditor((s) => s.uiMinimized);
    const hasSelection = useEditor((s) => s.selection.length > 0);
    const theme = useEditor((s) => s.prefs.theme);
    const variablesOpen = useEditor((s) => s.prefs.leftPanel === "variables" && s.prefs.leftPanelOpen);
    const chrome = !uiHidden;
    const presentingId = useEditor((s) => s.presentingId);
    // A file's prototype tab: its player stays mounted (hidden) while the file's tab shows, so
    // switching back finds it where it was.
    const fileId = useEditor((s) => s.fileId);
    const protoView = usePrototypeView();
    const stored = protoView.starts[fileId ?? ""];
    const protoStart = useEditor((s) => {
        const id = s.presentingId ? (stored && s.doc.nodes[stored] ? stored : s.presentingId) : fileId ? stored : undefined;
        return id && s.doc.nodes[id] ? id : null;
    });
    const photoEdit = useEditor((s) => s.photoEdit !== null);
    const pdfEdit = useEditor((s) => s.pdfEdit !== null);
    const mode = useEditor((s) => s.mode);
    const homeOpen = useEditor((s) => s.homeOpen);
    const [link] = useState(() => {
        const params = new URLSearchParams(location.search);
        return { invite: params.get("invite"), reset: params.get("reset") };
    });
    const [linkDone, setLinkDone] = useState(false);
    const clearLink = () => {
        setLinkDone(true);
        const url = new URL(location.href);
        url.searchParams.delete("invite");
        url.searchParams.delete("reset");
        history.replaceState(null, "", url);
    };
    const sequence = useEditor((s) => s.sequenceView && fileMeta(s.fileId)?.kind === "video");
    const boardOpen = useEditor((s) => Boolean(s.doc.board));
    const slidesOpen = useEditor((s) => Boolean(s.doc.slides));
    const pdfOpen = useEditor((s) => Boolean(s.doc.pdf));
    const campaignOpen = useEditor((s) => Boolean(s.doc.campaign));
    const siteOpen = useEditor((s) => Boolean(s.doc.site));
    const makeOpen = useEditor((s) => Boolean(s.doc.make));
    // Phone-width screens get the touch viewer for design files opened from a link.
    const mobileView = useMobileViewer() && Boolean(fileId) && !pdfOpen && !sequence && !slidesOpen && !siteOpen && !makeOpen && !campaignOpen && !boardOpen;

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
    }, [theme]);
    const focusRings = useEditor((s) => s.prefs.alwaysFocusRings);
    const reduceMotion = useEditor((s) => s.prefs.reduceMotion);
    useEffect(() => {
        document.documentElement.dataset.focusRings = focusRings ? "always" : "auto";
        document.documentElement.dataset.reduceMotion = String(reduceMotion);
    }, [focusRings, reduceMotion]);

    return (
        <div className="flex h-full w-full flex-col">
            {chrome && !mobileView && <TabBar />}
            <VerifyBanner />
            <MoveDraftsOffer />
            {homeOpen && !presentingId ? (
                <ErrorBoundary name="home">
                    <Home />
                </ErrorBoundary>
            ) : mobileView ? (
                <ErrorBoundary name="viewer">
                    <MobileViewer />
                </ErrorBoundary>
            ) : pdfOpen && !presentingId ? (
                <ErrorBoundary name="document">
                    <DocumentEditor />
                </ErrorBoundary>
            ) : sequence && !presentingId ? (
                <ErrorBoundary name="video editor">
                    <VideoEditor />
                </ErrorBoundary>
            ) : slidesOpen ? (
                <ErrorBoundary name="slides">
                    <SlidesEditor />
                </ErrorBoundary>
            ) : siteOpen && !presentingId ? (
                <ErrorBoundary name="site">
                    <SiteEditor />
                </ErrorBoundary>
            ) : makeOpen ? (
                <ErrorBoundary name="make">
                    <MakeEditor />
                </ErrorBoundary>
            ) : campaignOpen && !presentingId ? (
                <ErrorBoundary name="campaign">
                    <CampaignEditor />
                </ErrorBoundary>
            ) : boardOpen && !presentingId ? (
                <ErrorBoundary name="board">
                    <BoardEditor />
                </ErrorBoundary>
            ) : (
        <div className="relative flex min-h-0 w-full flex-1">
            {/* Motion mode docks the timeline full width under the left panel and the canvas; the right panel stays full height. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 w-full flex-1">
            {chrome && (
                <ErrorBoundary name="layers panel">
                    {!uiMinimized && <LeftSidebar />}
                </ErrorBoundary>
            )}
            {chrome && mode === "design" && (
                <ErrorBoundary name="prototype preview">
                    <PrototypePreview />
                </ErrorBoundary>
            )}
            <main className="relative flex min-w-0 flex-1 flex-col">
                <div className="relative min-h-0 flex-1">
                    <ErrorBoundary name="canvas">
                        <CanvasView />
                    </ErrorBoundary>
                    {chrome && <DevViews />}
                    {chrome && variablesOpen && (
                        <ErrorBoundary name="variables">
                            <VariablesView onClose={() => editor.setPrefs({ leftPanel: "layers" })} />
                        </ErrorBoundary>
                    )}
                    {chrome && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-2">
                            {mode === "design" && <MotionPill />}
                            {mode === "design" && <MatchingPill />}
                            <SequencePill />
                            <VectorBar />
                            <FloatingBars />
                            <ImageBar />
                            <Toolbar />
                        </div>
                    )}
                </div>
                <LibraryHost />
                {toast && (
                    <div role="status" className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center">
                        <div className="flex items-center gap-3 rounded-lg bg-tooltip px-3 py-2 text-[12px] text-white shadow-lg">
                            {toast}
                            {toastAction && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        editor.set({ toast: null, toastAction: null });
                                        toastAction.run();
                                    }}
                                    className="pointer-events-auto font-semibold text-[#7CC4FF] hover:underline"
                                >
                                    {toastAction.label}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </main>
            </div>
            {chrome && mode === "motion" && (
                <ErrorBoundary name="timeline">
                    <Timeline />
                </ErrorBoundary>
            )}
            </div>
            {chrome && !variablesOpen && (!uiMinimized || hasSelection) && (
                <ErrorBoundary name="properties panel">
                    <RightPanel />
                </ErrorBoundary>
            )}
            <ContextMenu />
            <DevStatusMenu />
            <VectorExtras />
            <ActionsPalette />
            <PluginHost />
            <ShortcutsPanel />
            <NamePrompt />
            <RenameDialog />
            <SaveVersionDialog />
            <BranchDialogs />
            {photoEdit && (
                <ErrorBoundary name="photo editor">
                    <PhotoEditor />
                </ErrorBoundary>
            )}
            {pdfEdit && (
                <ErrorBoundary name="PDF organizer">
                    <PdfEditor />
                </ErrorBoundary>
            )}
            {protoStart && !slidesOpen && (
                <ErrorBoundary name="prototype player">
                    <PrototypePlayer key={`${fileId}:${protoView.run}:${protoStart}`} startId={protoStart} active={presentingId !== null} />
                </ErrorBoundary>
            )}
        </div>
            )}
            <NewDocumentDialog />
            <AuthModal />
            <ServerPicker />
            <ServerLinkPrompt />
            <AccountSettingsHost />
            <AskTextDialog />
            {!linkDone && link.reset && <ResetPasswordModal token={link.reset} onDone={clearLink} />}
            {!linkDone && link.invite && <InviteModal token={link.invite} onDone={clearLink} />}
        </div>
    );
}
