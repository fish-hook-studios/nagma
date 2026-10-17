// Nagma's service worker: makes the app installable and lets the shell open without a network.
// Pages and the app's own files are fetched from the network first and kept as a fallback; requests
// to the sync server, other sites and anything but GET pass straight through.
const CACHE = "nagma-shell-v1";

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png"])).then(() => self.skipWaiting()));
});

// Older shell caches go (including the one from before the product's rename); other caches, such as
// the prototypes kept for offline use (engine/offline.ts), stay.
self.addEventListener("activate", (event) => {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && /-shell-v\d+$/.test(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== self.location.origin) return;
    if (/^\/(files|media|auth|teams|projects|v1|account|libraries|sites|apps|ai)(\/|$)/.test(url.pathname)) return;
    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response.ok && (request.mode === "navigate" || url.pathname.startsWith("/assets/"))) {
                    const copy = response.clone();
                    void caches.open(CACHE).then((cache) => cache.put(request.mode === "navigate" ? "/" : request, copy));
                }
                return response;
            })
            .catch(() => caches.match(request.mode === "navigate" ? "/" : request).then((hit) => hit ?? Response.error())),
    );
});
