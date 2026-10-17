import { startPresenting } from "./camera";
import { pageOf } from "./page";
import { editor } from "./store";

// A link made with "Copy link to flow" (?present=<frame id>) opens the file presenting that flow,
// once the file has loaded.
// A link copied with the UI hidden opens the player the same way.
export const presentLinkOptions = { hideUi: false };

export function watchPresentLink() {
    const params = new URLSearchParams(location.search);
    const id = params.get("present");
    presentLinkOptions.hideUi = params.get("hide-ui") === "1";
    if (!id) return;
    let done = false;
    const check = () => {
        if (done) return;
        const s = editor.get();
        const node = s.doc.nodes[id];
        if (!node) return;
        done = true;
        queueMicrotask(() => {
            unsubscribe();
            const page = pageOf(s.doc, node);
            if (page && page !== s.pageId) editor.set({ pageId: page, selection: [] });
            startPresenting(id);
            const url = new URL(location.href);
            url.searchParams.delete("present");
            url.searchParams.delete("hide-ui");
            history.replaceState(null, "", url);
        });
    };
    const unsubscribe = editor.subscribe(check);
    check();
}
