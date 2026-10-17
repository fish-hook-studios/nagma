import { editor } from "../engine/store";
import { buildSite } from "./html";
import { BREAKPOINTS, breakpointsOf, pageData } from "./model";
import { site } from "./state";

// Preview: the site as real HTML and CSS in a new tab, before publishing. The tab holds a small
// shell (pages, breakpoint widths) around a sandboxed frame, so the site's own code (code embeds,
// custom code) runs in an origin of its own and can't reach the editor. Links between pages are
// passed up to the shell, which swaps the page. While the tab is open it follows your edits (the
// editor sends the rebuilt pages over a broadcast channel).

let win: Window | null = null;
let unsubscribe: (() => void) | null = null;
let timer: number | undefined;

const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => (c === "\u2028" ? "\\u2028" : "\\u2029"));

function shell(title: string, pages: { path: string; title: string; html: string }[], start: string, width: string, channel: string, bps: { id: string; label: string; width: number }[]): string {
    const widths = [...bps.map((b) => ({ id: b.id, label: b.label, w: b.width })), { id: "full", label: "Full width", w: 0 }];
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Preview: ${title.replace(/[<&]/g, "")}</title>
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#1c1c1e;font:12px/1.4 Inter,system-ui,sans-serif;color:#f2f2f2}
header{height:44px;display:flex;align-items:center;gap:10px;padding:0 12px;background:#262628;border-bottom:1px solid #333}
.name{font-weight:600;margin-right:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
select,button{font:inherit;color:inherit;background:#333336;border:1px solid #3d3d40;border-radius:6px;height:28px;padding:0 8px}
button{cursor:pointer}button[aria-pressed=true]{background:#4f46e5;border-color:#4f46e5}
.seg{display:flex;gap:4px}.tag{margin-left:auto;color:#a1a1a6;white-space:nowrap}
main{position:absolute;inset:44px 0 0 0;overflow:auto;display:flex;justify-content:center;padding:16px}
main.full{padding:0}
iframe{border:0;background:#fff;height:100%;box-shadow:0 8px 40px rgba(0,0,0,.45);border-radius:6px;transition:width .2s ease}
main.full iframe{border-radius:0;box-shadow:none}
</style></head><body>
<header><span class="name"></span><select id="page" aria-label="Page"></select><div class="seg" role="group" aria-label="Width"></div><span class="tag">Preview. Not published.</span></header>
<main><iframe id="view" title="Site preview" sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"></iframe></main>
<script>
var PAGES=${json(pages)},WIDTHS=${json(widths)},current=${json(start)},width=${json(width)},pendingAnchor=null,visited=[];
var frame=document.getElementById("view"),select=document.getElementById("page"),seg=document.querySelector(".seg"),main=document.querySelector("main");
document.querySelector(".name").textContent=${json(title)};
function fill(){select.innerHTML="";PAGES.forEach(function(p){var o=document.createElement("option");o.value=p.path;o.textContent=p.title+" ("+p.path+")";select.appendChild(o);});select.value=current;}
function show(path,keep){var p=PAGES.find(function(x){return x.path===path;})||PAGES.find(function(x){return x.path==="/404";})||PAGES[0];if(!p)return;current=p.path;select.value=current;frame.srcdoc=p.html;}
function size(id){width=id;var w=WIDTHS.find(function(x){return x.id===id;});main.className=w&&w.w?"":"full";frame.style.width=w&&w.w?w.w+"px":"100%";[].forEach.call(seg.children,function(b){b.setAttribute("aria-pressed",String(b.dataset.id===id));});}
WIDTHS.forEach(function(w){var b=document.createElement("button");b.type="button";b.dataset.id=w.id;b.textContent=w.w?w.label+" "+w.w:w.label;b.onclick=function(){size(w.id);};seg.appendChild(b);});
select.onchange=function(){show(select.value);};
window.addEventListener("message",function(e){var m=e.data||{};
  if(e.source===frame.contentWindow){
    if(m.type==="site-preview-nav"&&typeof m.to==="string"){var parts=m.to.split("#");pendingAnchor=parts[1]||null;visited.push(current);show(parts[0]||"/");}
    if(m.type==="site-preview-back"&&visited.length){show(visited.pop());}
    if(m.type==="site-preview-ready"&&pendingAnchor){frame.contentWindow.postMessage({type:"site-preview-scroll",anchor:pendingAnchor},"*");pendingAnchor=null;}
    return;
  }
});
try{var bc=new BroadcastChannel(${json(channel)});bc.onmessage=function(e){var m=e.data||{};if(m.type==="pages"&&Array.isArray(m.pages)){PAGES=m.pages;fill();show(current);}};bc.postMessage({type:"hello"});}catch(err){}
fill();size(width);show(current);
</script></body></html>`;
}

const channelName = (fileId: string) => `nagma-site-preview:${fileId}`;

async function builtPages() {
    const build = await buildSite(editor.get().doc, "preview");
    return build.pages.map((p) => ({ path: p.path, title: p.title, html: p.html }));
}

// Preview opens in a new tab of the app (?sitePreview=<file id>). The editor answers that tab over a
// broadcast channel with the built pages, and sends them again as you edit.
export function openPreview() {
    const s = editor.get();
    const fileId = s.fileId;
    if (!fileId) return;
    serve(fileId);
    const page = pageData(s.doc.nodes[s.pageId]);
    const view = site.get().view;
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("sitePreview", fileId);
    url.searchParams.set("page", page?.notFound ? "/404" : (page?.path ?? "/"));
    url.searchParams.set("width", view === "all" ? "desktop" : view);
    url.searchParams.set("bps", JSON.stringify(breakpointsOf(s.doc, s.pageId).map((b) => ({ id: b.id, label: b.label, width: b.width }))));
    previewUrl = url.toString();
    win = window.open(previewUrl, `nagma-site-preview-${fileId}`);
    if (!win) editor.notify("Allow pop-ups for this page to open the preview in a new tab.");
}

export let previewUrl: string | null = null;

let served: { fileId: string; channel: BroadcastChannel } | null = null;

// Answers preview tabs for the open file, and keeps them up to date.
function serve(fileId: string) {
    if (served?.fileId === fileId) return;
    served?.channel.close();
    unsubscribe?.();
    const channel = new BroadcastChannel(channelName(fileId));
    served = { fileId, channel };
    let listening = false;
    channel.onmessage = (e: MessageEvent<{ type?: string }>) => {
        if (e.data?.type !== "hello" || editor.get().fileId !== fileId) return;
        listening = true;
        void builtPages().then((pages) => channel.postMessage({ type: "pages", pages }));
    };
    let last = editor.get().doc;
    unsubscribe = editor.subscribe(() => {
        const doc = editor.get().doc;
        if (doc === last || !listening || editor.get().fileId !== fileId) return;
        last = doc;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void builtPages().then((pages) => channel.postMessage({ type: "pages", pages })), 900);
    });
}

// The preview tab itself: asks the editor for the pages (or, with no editor open, builds them from
// the copy of the file kept in this browser), then shows them.
export async function runPreviewPage(params: URLSearchParams) {
    const fileId = params.get("sitePreview") ?? "";
    const start = params.get("page") ?? "/";
    const width = params.get("width") ?? "desktop";
    document.title = "Preview";
    document.body.style.background = "#1c1c1e";
    const channel = new BroadcastChannel(channelName(fileId));
    const pages = await new Promise<{ path: string; title: string; html: string }[] | null>((resolve) => {
        const timeout = window.setTimeout(() => resolve(null), 2500);
        channel.onmessage = (e: MessageEvent<{ type?: string; pages?: { path: string; title: string; html: string }[] }>) => {
            if (e.data?.type === "pages" && e.data.pages) {
                window.clearTimeout(timeout);
                resolve(e.data.pages);
            }
        };
        channel.postMessage({ type: "hello" });
    });
    channel.close();
    let list = pages;
    let name = "Site";
    let bps: { id: string; label: string; width: number }[] = BREAKPOINTS;
    if (!list) {
        const { loadDoc } = await import("../engine/doc-store");
        const doc = await loadDoc(`nagma.file.${fileId}`);
        if (!doc?.site) {
            document.body.innerHTML = '<p style="color:#aaa;font:14px system-ui;padding:40px">Open the site in the editor, then preview it again.</p>';
            return;
        }
        name = doc.name;
        const home = doc.roots.find((id) => pageData(doc.nodes[id])?.path === "/");
        if (home) bps = breakpointsOf(doc, home);
        const build = await buildSite(doc, "preview");
        list = build.pages.map((p) => ({ path: p.path, title: p.title, html: p.html }));
    }
    const fromUrl = params.get("bps");
    if (fromUrl) {
        try {
            const parsed = JSON.parse(fromUrl) as { id: string; label: string; width: number }[];
            if (Array.isArray(parsed) && parsed.every((b) => typeof b.id === "string" && typeof b.label === "string" && Number.isFinite(b.width))) bps = parsed.slice(0, 12);
        } catch {
            // The defaults.
        }
    }
    const html = shell(name, list, list.some((p) => p.path === start) ? start : (list[0]?.path ?? "/"), width, channelName(fileId), bps);
    document.open();
    document.write(html);
    document.close();
}
