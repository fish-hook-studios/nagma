// First: moves what this browser kept under the product's old name (engine/legacy-names.ts).
import "./engine/legacy-names";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./engine/edited-at";
import { openPageView } from "./engine/camera";
import * as authModule from "./engine/auth";
import * as collabModule from "./engine/collab";
import * as filesModule from "./engine/files";
import * as teamsModule from "./engine/teams";
import { rejoinShared } from "./engine/collab";
import { openLastFile } from "./engine/files";
import { editor, onPageOpened } from "./engine/store";
import { clearTextCache } from "./engine/text";
import { watchPresentLink } from "./engine/present-link";
import { openLinkInDesktopApp } from "./engine/desktop-links";
import "./engine/desktop";
import { beforeScopeChange, reloadOnScopeChange } from "./engine/user-storage";
import { docWritesSettled } from "./engine/doc-store";
import "./styles/globals.css";

// In the desktop app the top bar is the window's title bar: room for the window buttons, and it
// drags the window (apps/desktop).
const desktop = (window as unknown as { nagmaDesktop?: { platform: string; onFullScreen?: (listener: (on: boolean) => void) => void } }).nagmaDesktop;
if (desktop) document.documentElement.classList.add("desktop", `desktop-${desktop.platform}`);
// In full screen the window buttons are hidden, so the tab bar starts at the edge.
desktop?.onFullScreen?.((on) => document.documentElement.classList.toggle("desktop-full-screen", on));

// Drafts, tabs, recents and stars belong to the account signed in (engine/user-storage.ts). When it
// changes, the open file's last edits are written for the account being left, then the page starts
// over with the next account's.
beforeScopeChange(() => editor.flushSave());
reloadOnScopeChange(() => void docWritesSettled().then(() => location.reload()));

// Web fonts arrive after the first paint; re-measure and redraw text whenever one finishes loading.
document.fonts?.addEventListener("loadingdone", () => {
    clearTextCache();
    editor.refreshText();
});

// Start on the last file (or Home); a share link in the URL opens that file instead (engine/collab.ts).
// ?template=<id> makes a fresh file from that template (say, ?template=invest for the Vesta app).
const startParams = new URLSearchParams(location.search);
const templateId = startParams.get("template");
// ?sitePreview=<file id>: a site's Preview tab (site/preview.ts) instead of the editor.
const sitePreview = startParams.get("sitePreview");
if (sitePreview) {
    void import("./site/preview").then(({ runPreviewPage }) => runPreviewPage(startParams));
} else if (templateId) {
    void import("./engine/templates").then(({ TEMPLATES, fileFromTemplate }) => {
        const t = TEMPLATES.find((x) => x.id === templateId);
        if (t) {
            void filesModule.openFile(fileFromTemplate(t).id);
            const url = new URL(location.href);
            url.searchParams.delete("template");
            history.replaceState(null, "", url);
        } else void openLastFile(rejoinShared);
    });
} else if (!startParams.get("file")) void openLastFile(rejoinShared);

// Preferences › Open links in desktop app: hand a file link to the desktop app.
openLinkInDesktopApp();

// "Copy link to flow" links open presenting the flow.
watchPresentLink();

// A page shown for the first time opens zoomed to fit its contents.
onPageOpened(() => requestAnimationFrame(openPageView));

// Installable app (public/manifest.webmanifest): the service worker keeps the shell for offline
// starts. Not in development, where it would stand in the way of hot reloading, nor in the desktop app.
if (import.meta.env.PROD && !desktop && "serviceWorker" in navigator) {
    window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}

// Development only: lets tests and the console inspect editor state.
if (import.meta.env.DEV) Object.assign(window, { nagma: editor, nagmaCollab: collabModule, nagmaModules: { auth: authModule, collab: collabModule, files: filesModule, teams: teamsModule } });

const root = document.getElementById("root");
if (root && !sitePreview) {
    createRoot(root).render(
        <StrictMode>
            <App />
        </StrictMode>,
    );
}
