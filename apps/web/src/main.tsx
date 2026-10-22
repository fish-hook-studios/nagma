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
import { resumePendingShare } from "./engine/share-hosted";
import { editor, onPageOpened } from "./engine/store";
import { clearTextCache } from "./engine/text";
import { watchPresentLink } from "./engine/present-link";
import { openLinkInDesktopApp } from "./engine/desktop-links";
import "./engine/desktop";
import { beforeScopeChange, reloadOnScopeChange } from "./engine/user-storage";
import { docWritesSettled } from "./engine/doc-store";
import { onMediaError } from "./engine/media";
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

// An upload the server refused (too large, a limit reached) says why.
onMediaError((message) => editor.notify(message));

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
} else if (startParams.get("new")) {
    // ?new=<kind> (the website's product buttons): Home opens and makes the file (components/home.tsx),
    // whatever was open last time, and the welcome cards stay out of the way.
    void import("./engine/onboarding").then(({ deferWelcome }) => deferWelcome());
    editor.set({ homeOpen: true });
} else if (!startParams.get("file")) {
    // Back from Share through Nagma (or another server): the file that was going there opens on it,
    // moved, with Share open (engine/share-hosted.ts). Otherwise the last file.
    void resumePendingShare().then((resumed) => (resumed ? undefined : openLastFile(rejoinShared)));
}

// ?settings=<tab> opens Settings on that tab (for example ?settings=stats, a server admin's usage
// page) once the signed-in account is known, so the tabs that need an account are there.
{
    const wanted = startParams.get("settings");
    const tabs = ["account", "notifications", "security", "community", "tokens", "ai", "stats"] as const;
    const tab = tabs.find((t) => t === wanted);
    if (tab) {
        const url = new URL(location.href);
        url.searchParams.delete("settings");
        history.replaceState(null, "", url);
        void import("./engine/account").then(({ openAccountSettings }) => {
            const open = () => openAccountSettings(tab);
            if (tab === "ai" || authModule.auth.get().user) return open();
            let done = false;
            const stop = authModule.auth.subscribe(() => {
                if (done || !authModule.auth.get().user) return;
                done = true;
                stop();
                open();
            });
            setTimeout(() => {
                if (done) return;
                done = true;
                stop();
                open();
            }, 4000);
        });
    }
}

// Nagma Capture (the browser extension) hands page captures to this window; each opens as a new file.
void import("./engine/capture-open").then(({ listenForCaptures }) => listenForCaptures());

// ?capture=<id>: a capture the extension sent to this server (POST /captures). It's fetched with the
// signed-in account (the one that sent it), opened as a new file, and the server's copy deleted.
// Signed out, it waits for sign-in (the sign-in dialog opens; signing in starts the page over, so
// the id waits in this tab's session storage) and then opens.
{
    const PENDING_CAPTURE = "nagma.capture.pending";
    const valid = (id: string | null): id is string => Boolean(id && /^[A-Za-z0-9_-]{16,32}$/.test(id));
    const fromUrl = startParams.get("capture");
    let captureId: string | null = valid(fromUrl) ? fromUrl : null;
    if (fromUrl !== null) {
        const url = new URL(location.href);
        url.searchParams.delete("capture");
        history.replaceState(null, "", url);
    }
    try {
        if (captureId) sessionStorage.setItem(PENDING_CAPTURE, captureId);
        else {
            const kept = sessionStorage.getItem(PENDING_CAPTURE);
            captureId = valid(kept) ? kept : null;
        }
    } catch {
        // Without session storage it opens if the person is signed in now.
    }
    if (captureId) {
        const id = captureId;
        const forget = () => {
            try {
                sessionStorage.removeItem(PENDING_CAPTURE);
            } catch {
                // Nothing kept.
            }
        };
        const fetchCapture = async () => {
            const { httpBase } = await import("./engine/server-url");
            const address = `${httpBase()}/captures/${id}`;
            const res = await fetch(address, { headers: authModule.authHeaders(), cache: "no-store" });
            if (res.status === 401) return "signed-out" as const;
            if (!res.ok) {
                forget();
                const data = (await res.json().catch(() => ({}))) as { error?: string };
                editor.notify(`Couldn't open the captured page: ${data.error ?? `the server answered ${res.status}`}`);
                return "done" as const;
            }
            const capture: unknown = await res.json();
            const { openCapture } = await import("./engine/capture-open");
            await openCapture(capture);
            forget();
            await fetch(address, { method: "DELETE", headers: authModule.authHeaders() }).catch(() => undefined);
            return "done" as const;
        };
        let busy = false;
        let finished = false;
        // A session the server refused isn't tried again; the next sign-in is.
        let refused: string | null = null;
        const attempt = async () => {
            if (busy || finished || !authModule.auth.get().user || authModule.token() === refused) return;
            busy = true;
            try {
                const result = await fetchCapture();
                if (result === "done") finished = true;
                else {
                    refused = authModule.token();
                    authModule.openSignIn();
                }
            } catch (error) {
                finished = true;
                forget();
                editor.notify(`Couldn't open the captured page: ${error instanceof Error ? error.message : String(error)}`);
            } finally {
                busy = false;
                if (finished) stop();
            }
        };
        // After the start (the last file opening), so the capture's new file is the one left open;
        // after a sign-in, once the page has had time to start over for the account.
        const signedIn = Boolean(authModule.auth.get().user);
        const stop = authModule.auth.subscribe(() => void setTimeout(() => void attempt(), signedIn ? 0 : 1500));
        if (signedIn) setTimeout(() => void attempt(), 300);
        else {
            editor.notify("Sign in with the account that captured the page to open it.");
            authModule.openSignIn();
        }
    }
}

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
