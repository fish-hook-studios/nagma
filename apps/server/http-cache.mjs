// Answers that a browser, or a CDN such as Cloudflare in front of the server, may keep: each carries
// an ETag (a hash of the body) and a Cache-Control, and a request whose If-None-Match names the
// same ETag gets an empty 304 instead of the body again. See docs/self-hosting.md, "Behind Cloudflare".
import { createHash } from "node:crypto";

export const etagOf = (body) => `"${createHash("sha1").update(body).digest("base64url")}"`;

// Whether the request's If-None-Match matches `etag` (a list, weak forms, or *).
export function notModified(req, etag) {
    const header = req.headers["if-none-match"];
    if (!header) return false;
    return String(header)
        .split(",")
        .map((t) => t.trim().replace(/^W\//, ""))
        .some((t) => t === etag || t === "*");
}

// Sends `body` with an ETag and `cacheControl`, or 304 when the client already has it.
export function sendCached(req, res, status, headers, body, cacheControl, etag = etagOf(body)) {
    const head = { ...headers, "cache-control": cacheControl, etag };
    if (status === 200 && notModified(req, etag)) {
        delete head["content-length"];
        return void res.writeHead(304, head).end();
    }
    res.writeHead(status, { ...head, "content-length": body.length });
    res.end(req.method === "HEAD" ? undefined : body);
}

// The visitor's address. Behind a proxy (NAGMA_TRUST_PROXY, or TRUST_PROXY), the address the
// nearest proxy saw: the last X-Forwarded-For entry (earlier entries come from the client and can be
// anything). NAGMA_TRUST_PROXY=cloudflare takes CF-Connecting-IP, which Cloudflare sets itself (only
// use it when the server can be reached through Cloudflare alone, or anyone could send that header).
export function clientAddress(req, env = process.env) {
    const trust = String(env.NAGMA_TRUST_PROXY ?? env.TRUST_PROXY ?? "").trim().toLowerCase();
    const direct = req.socket?.remoteAddress || "unknown";
    if (!trust || trust === "0" || trust === "false" || trust === "no") return direct;
    if (trust === "cloudflare") return String(req.headers["cf-connecting-ip"] ?? "").trim() || direct;
    const hops = String(req.headers["x-forwarded-for"] ?? "")
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean);
    return hops.at(-1) || direct;
}
