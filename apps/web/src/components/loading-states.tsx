import { useEffect, useState } from "react";
import { useCollab } from "../engine/collab";

// Loading feedback on the canvas: a spinner while a shared file is first opening (until the server
// sends it), and a small badge while web fonts are still loading (text re-measures when they land).
export function LoadingStates() {
    const opening = useCollab((s) => s.status === "connecting" && Boolean(s.fileId) && !s.gate);
    const [fonts, setFonts] = useState(() => typeof document !== "undefined" && document.fonts?.status === "loading");
    useEffect(() => {
        const set = document.fonts;
        if (!set) return;
        const on = () => setFonts(true);
        const off = () => setFonts(set.status === "loading");
        set.addEventListener("loading", on);
        set.addEventListener("loadingdone", off);
        set.addEventListener("loadingerror", off);
        return () => {
            set.removeEventListener("loading", on);
            set.removeEventListener("loadingdone", off);
            set.removeEventListener("loadingerror", off);
        };
    }, []);
    return (
        <>
            {opening && (
                <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="flex items-center gap-2 rounded-lg bg-tooltip px-3 py-2 text-[12px] text-white shadow-lg">
                        <span className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Opening file…
                    </div>
                </div>
            )}
            {fonts && (
                <div role="status" className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md bg-tooltip px-2 py-1 text-[11px] text-white/85 shadow">
                    <span className="size-2.5 animate-spin rounded-full border-[1.5px] border-white/30 border-t-white" />
                    Loading fonts
                </div>
            )}
        </>
    );
}
