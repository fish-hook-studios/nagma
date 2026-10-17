import { editor } from "./store";

// Preferences › Open links in desktop app (in the browser): a file link opened here is handed to the
// desktop app through its nagma:// address, once per link, and the page stays as it was in case the
// app isn't installed.
export function openLinkInDesktopApp() {
    const desktop = (window as unknown as { nagmaDesktop?: unknown }).nagmaDesktop;
    if (desktop || !editor.get().prefs.openLinksInDesktop) return;
    const params = new URLSearchParams(location.search);
    if (!params.get("file") || params.get("view") === "browser") return;
    const key = `nagma.desktopLink.${location.search}`;
    try {
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
    } catch {
        // Without storage it may ask again; still fine.
    }
    location.href = `nagma://open?url=${encodeURIComponent(location.href)}`;
    editor.notify("Opening in the desktop app. Turn this off under Preferences › Open links in desktop app.");
}
