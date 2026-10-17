// GET /image-proxy?url=…: fetches an image for a signed-in editor when their browser can't (layers
// pasted from another design tool carry short-lived signed links to their images). Only https
// links on the image hosts below are fetched; redirects are refused, the host is resolved to public
// addresses only (the address checked is the one connected to), and the answer must be an image of
// at most 50 MB. NAGMA_TEST_IMAGE_HOSTS ("host:port,…", tests only) adds plain-http hosts that may
// be local, so the suite can serve images from a mock.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { IMAGE_HOSTS } from "./interop-hosts.mjs";

export const IMAGE_PROXY_HOSTS = new Set(IMAGE_HOSTS);
export const MAX_PROXY_IMAGE = 50 * 1024 * 1024;
const TYPES = /^image\/(png|jpeg|gif|webp|avif)$/i;

const testHosts = () =>
    new Set(
        String(process.env.NAGMA_TEST_IMAGE_HOSTS ?? "")
            .split(",")
            .map((h) => h.trim().toLowerCase())
            .filter(Boolean),
    );

// The link to fetch, or null when it isn't one the proxy fetches.
export function allowedImageUrl(raw) {
    let url;
    try {
        url = new URL(String(raw ?? ""));
    } catch {
        return null;
    }
    if (url.username || url.password) return null;
    if (url.protocol === "https:" && (!url.port || url.port === "443") && IMAGE_PROXY_HOSTS.has(url.hostname.toLowerCase())) return { url, test: false };
    if (url.protocol === "http:" && testHosts().has(url.host.toLowerCase())) return { url, test: true };
    return null;
}

export function createImageProxy({ CORS, userFromReq, safeLookup }) {
    const fail = (res, code, error) => res.writeHead(code, { ...CORS, "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ error }));

    return async function serveImageProxy(req, res) {
        if (!userFromReq(req)) return fail(res, 401, "Sign in to load images.");
        const target = allowedImageUrl(new URL(req.url ?? "/", "http://local").searchParams.get("url"));
        if (!target) return fail(res, 400, "That image link can't be loaded.");
        const { url, test } = target;
        await new Promise((done) => {
            let settled = false;
            const finish = (fn) => {
                if (settled) return;
                settled = true;
                fn();
                done();
            };
            const options = { method: "GET", headers: { "user-agent": "NagmaImageProxy/1.0", accept: "image/*" }, timeout: 20000, ...(test ? {} : { lookup: safeLookup }) };
            const upstream = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, options, (up) => {
                const status = up.statusCode ?? 0;
                const type = String(up.headers["content-type"] ?? "").split(";")[0].trim();
                const length = Number(up.headers["content-length"] ?? 0);
                const refuse = (code, error) => {
                    up.destroy();
                    finish(() => fail(res, code, error));
                };
                // Redirects aren't followed: the link must answer with the image itself.
                if (status >= 300 && status < 400) return refuse(502, "The image link redirected.");
                if (status === 403 || status === 404 || status === 410) return refuse(410, "The image link has expired.");
                if (status < 200 || status >= 300) return refuse(502, `The image link answered ${status}.`);
                if (!TYPES.test(type)) return refuse(415, "That link isn't an image.");
                if (length > MAX_PROXY_IMAGE) return refuse(413, "That image is too large.");
                const chunks = [];
                let size = 0;
                up.on("data", (c) => {
                    size += c.length;
                    if (size > MAX_PROXY_IMAGE) return refuse(413, "That image is too large.");
                    chunks.push(c);
                });
                up.on("error", () => finish(() => fail(res, 502, "The image couldn't be loaded.")));
                up.on("end", () =>
                    finish(() => {
                        const body = Buffer.concat(chunks);
                        res.writeHead(200, { ...CORS, "content-type": type.toLowerCase(), "content-length": body.length, "cache-control": "private, max-age=600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" }).end(body);
                    }),
                );
            });
            upstream.on("timeout", () => upstream.destroy(new Error("Timed out")));
            upstream.on("error", () => finish(() => fail(res, 502, "The image couldn't be loaded.")));
            upstream.end();
        });
    };
}
