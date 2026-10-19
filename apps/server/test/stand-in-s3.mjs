// A stand-in S3-compatible object store for tests (and for trying direct uploads in a browser):
// path-style buckets (/<bucket>/<key>), PUT / GET (with Range) / HEAD / DELETE, CORS preflights for
// the origins it's given, and AWS Signature Version 4 checks of presigned addresses: the signature
// is recomputed here from the request as it arrived (its own code, not the server's), and expired,
// tampered or unsigned requests are refused with 403 like S3 does. Objects are kept in memory;
// every request is kept in `requests` ({ method, path, key, bytes, status, origin }).
//
// Run alone: node apps/server/test/stand-in-s3.mjs --port 48901 --origin http://localhost:5300
// (access key "standin-key", secret "standin-secret", bucket "nagma"; it logs each request).
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

// Why a presigned request isn't valid, or null when it is.
function checkSignature(req, url, keys, now) {
    const q = url.searchParams;
    if (q.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256") return "AccessDenied: not a presigned request";
    const [accessKey, day, region, service, term] = String(q.get("X-Amz-Credential") ?? "").split("/");
    const secret = keys[accessKey];
    if (!secret) return "InvalidAccessKeyId";
    if (service !== "s3" || term !== "aws4_request") return "AuthorizationQueryParametersError";
    const amzDate = String(q.get("X-Amz-Date") ?? "");
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate);
    if (!m || amzDate.slice(0, 8) !== day) return "AuthorizationQueryParametersError: date";
    const signedAt = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const expires = Number(q.get("X-Amz-Expires"));
    if (!Number.isInteger(expires) || expires < 1 || expires > 604800) return "AuthorizationQueryParametersError: expires";
    if (now > signedAt + expires * 1000) return "AccessDenied: Request has expired";
    if (signedAt > now + 15 * 60 * 1000) return "AccessDenied: Request is not yet valid";
    const names = String(q.get("X-Amz-SignedHeaders") ?? "").split(";");
    if (!names.includes("host")) return "AccessDenied: host must be signed";
    const headerLines = names.map((n) => `${n}:${String(req.headers[n] ?? "").trim().replace(/\s+/g, " ")}\n`).join("");
    // The query as sent, minus the signature, re-encoded and sorted.
    const rawQuery = (req.url ?? "").split("?")[1] ?? "";
    const pairs = rawQuery
        .split("&")
        .filter(Boolean)
        .map((p) => p.split("=").map((s) => decodeURIComponent(s.replace(/\+/g, "%20"))))
        .filter(([k]) => k !== "X-Amz-Signature")
        .map(([k, v = ""]) => [enc(k), enc(v)])
        .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
    const canonical = [req.method, (req.url ?? "").split("?")[0], pairs.map(([k, v]) => `${k}=${v}`).join("&"), headerLines, names.join(";"), "UNSIGNED-PAYLOAD"].join("\n");
    const toSign = ["AWS4-HMAC-SHA256", amzDate, `${day}/${region}/s3/aws4_request`, createHash("sha256").update(canonical).digest("hex")].join("\n");
    const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), "s3"), "aws4_request");
    const expected = createHmac("sha256", key).update(toSign).digest("hex");
    return expected === q.get("X-Amz-Signature") ? null : "SignatureDoesNotMatch";
}

/**
 * Starts the stand-in. `origins`: browser origins allowed by its CORS rules ("*" for any).
 * `publicRead`: GETs without a signature are allowed (a public bucket / custom domain).
 * Returns { url, port, bucket, accessKey, secretKey, objects, requests, env(extra), stop() }.
 */
export async function startStandInS3({ port = 0, bucket = "nagma", accessKey = "standin-key", secretKey = "standin-secret", origins = ["*"], publicRead = false, log = null } = {}) {
    const objects = new Map();
    const requests = [];
    const keys = { [accessKey]: secretKey };
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://local");
        const origin = req.headers.origin;
        const allowed = origin && (origins.includes("*") || origins.includes(origin));
        const cors = allowed ? { "access-control-allow-origin": origins.includes("*") ? "*" : origin, "access-control-expose-headers": "etag, content-length, content-range, accept-ranges", vary: "origin" } : {};
        const segments = url.pathname.split("/").slice(1);
        const key = segments.slice(1).map((s) => decodeURIComponent(s)).join("/");
        const entry = { method: req.method, path: url.pathname, key, bytes: 0, status: 0, origin: origin ?? null };
        requests.push(entry);
        const done = (status, headers = {}, body) => {
            entry.status = status;
            res.writeHead(status, { ...cors, ...headers }).end(body);
            log?.(`stand-in-s3 ${req.method} ${url.pathname} ${status}${entry.bytes ? ` (${entry.bytes} bytes received)` : ""}`);
        };
        const xml = (status, code) => done(status, { "content-type": "application/xml" }, `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code.split(":")[0]}</Code><Message>${code}</Message></Error>`);
        if (req.method === "OPTIONS") {
            const method = String(req.headers["access-control-request-method"] ?? "");
            if (!allowed || !["GET", "PUT", "HEAD"].includes(method)) return xml(403, "AccessForbidden: CORSResponse: This CORS request is not allowed");
            return done(200, { "access-control-allow-methods": "GET, PUT, HEAD", "access-control-allow-headers": String(req.headers["access-control-request-headers"] ?? "content-type"), "access-control-max-age": "3000" });
        }
        if (segments[0] !== bucket || !key) return xml(404, "NoSuchBucket");
        const chunks = [];
        req.on("data", (c) => {
            chunks.push(c);
            entry.bytes += c.length;
        });
        req.on("end", () => {
            const unsigned = !url.searchParams.has("X-Amz-Signature");
            if (!(unsigned && publicRead && (req.method === "GET" || req.method === "HEAD"))) {
                const why = checkSignature(req, url, keys, Date.now());
                if (why) return xml(403, why);
            }
            const obj = objects.get(key);
            if (req.method === "PUT") {
                const body = Buffer.concat(chunks);
                const etag = `"${createHash("md5").update(body).digest("hex")}"`;
                objects.set(key, { body, type: String(req.headers["content-type"] ?? "application/octet-stream"), etag, at: Date.now() });
                return done(200, { etag });
            }
            if (req.method === "DELETE") {
                objects.delete(key);
                return done(204);
            }
            if (req.method !== "GET" && req.method !== "HEAD") return xml(405, "MethodNotAllowed");
            if (!obj) return xml(404, "NoSuchKey");
            const headers = { "content-type": url.searchParams.get("response-content-type") ?? obj.type, etag: obj.etag, "accept-ranges": "bytes" };
            const disposition = url.searchParams.get("response-content-disposition");
            if (disposition) headers["content-disposition"] = disposition;
            const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
            if (range && (range[1] || range[2])) {
                const size = obj.body.length;
                let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
                let end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
                if (start >= size || start > end) return done(416, { "content-range": `bytes */${size}` });
                const part = obj.body.subarray(start, end + 1);
                return done(206, { ...headers, "content-length": String(part.length), "content-range": `bytes ${start}-${end}/${size}` }, req.method === "HEAD" ? undefined : part);
            }
            return done(200, { ...headers, "content-length": String(obj.body.length) }, req.method === "HEAD" ? undefined : obj.body);
        });
    });
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    const actual = server.address().port;
    const url = `http://127.0.0.1:${actual}`;
    return {
        url,
        port: actual,
        bucket,
        accessKey,
        secretKey,
        objects,
        requests,
        /** The server settings that point a Nagma server at this stand-in. */
        env(extra = {}) {
            return { NAGMA_MEDIA_STORE: "s3", NAGMA_S3_ENDPOINT: url, NAGMA_S3_REGION: "auto", NAGMA_S3_BUCKET: bucket, NAGMA_S3_ACCESS_KEY: accessKey, NAGMA_S3_SECRET_KEY: secretKey, ...extra };
        },
        stop: () => new Promise((resolve) => (server.closeAllConnections?.(), server.close(() => resolve()))),
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const arg = (name, fallback) => {
        const i = process.argv.indexOf(`--${name}`);
        return i > 0 ? process.argv[i + 1] : fallback;
    };
    const origins = process.argv.flatMap((a, i) => (process.argv[i - 1] === "--origin" ? [a] : []));
    const s = await startStandInS3({ port: Number(arg("port", 48901)), origins: origins.length ? origins : ["*"], publicRead: process.argv.includes("--public"), log: (line) => console.log(line) });
    console.log(`stand-in S3 on ${s.url} (bucket ${s.bucket}); server settings:\n${Object.entries(s.env()).map(([k, v]) => `${k}=${v}`).join("\n")}`);
}
