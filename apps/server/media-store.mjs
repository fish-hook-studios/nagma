// Where media bytes live (images, video, audio, PDFs, fonts, attachments), behind one interface.
//
// - "local" (the default, and what the desktop app's bundled server uses): files in DATA_DIR/media,
//   streamed by the server.
// - "s3": any S3-compatible bucket (Cloudflare R2, Backblaze B2, MinIO, AWS S3). Browsers upload to
//   and download from the bucket directly with short-lived presigned addresses, so the bytes never
//   pass through this server. Presigning is AWS Signature Version 4, done here with node:crypto.
//
// Whatever the store, what the server knows about each asset (its type, size, the files it belongs
// to, who uploaded it, its SHA-256 when known, whether its upload finished) is kept on this server's
// disk beside the local bytes: DATA_DIR/media/<id>.meta.json. Access checks read that, never the
// bucket. Bookkeeping lives in folders whose names have a dot, which no media id can have:
// pending.d (direct uploads not yet completed), hashes.d (content hashes, per account, for
// dedupe), usage.d (media bytes per file).

import { createHash, createHmac } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

const MB = 1024 * 1024;
const num = (value, fallback) => {
    const n = Number(value);
    return value !== undefined && value !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
};

// ---- Settings ----

/** The media settings from the environment (see .env.example and docs/self-hosting.md). */
export function mediaConfig(env = process.env) {
    const kind = String(env.NAGMA_MEDIA_STORE ?? "local").trim().toLowerCase() || "local";
    if (kind !== "local" && kind !== "s3") throw new Error(`NAGMA_MEDIA_STORE must be "local" or "s3", not "${kind}".`);
    const s3 = s3Config(env);
    if (kind === "s3" && !s3) throw new Error("NAGMA_MEDIA_STORE=s3 needs NAGMA_S3_ENDPOINT, NAGMA_S3_BUCKET, NAGMA_S3_ACCESS_KEY and NAGMA_S3_SECRET_KEY.");
    return {
        kind,
        s3,
        maxBytes: Math.round(num(env.NAGMA_MEDIA_MAX_MB, 500) * MB),
        fileMaxBytes: Math.round(num(env.NAGMA_FILE_MEDIA_MAX_MB, 2048) * MB),
        uploadsPerHour: num(env.NAGMA_MEDIA_UPLOADS_PER_HOUR, 600),
        bytesPerHour: Math.round(num(env.NAGMA_MEDIA_MB_PER_HOUR, 5120) * MB),
        pendingMs: num(env.NAGMA_MEDIA_PENDING_HOURS, 24) * 60 * 60 * 1000,
        sweepMs: Math.max(200, num(env.NAGMA_MEDIA_GC_MINUTES, 60) * 60 * 1000),
        urlSeconds: Math.max(60, Math.round(num(env.NAGMA_MEDIA_URL_MINUTES, 10) * 60)),
    };
}

// The bucket settings, or null when they aren't all there.
export function s3Config(env = process.env) {
    const endpoint = String(env.NAGMA_S3_ENDPOINT ?? "").trim().replace(/\/+$/, "");
    const bucket = String(env.NAGMA_S3_BUCKET ?? "").trim();
    const accessKey = String(env.NAGMA_S3_ACCESS_KEY ?? "").trim();
    const secretKey = String(env.NAGMA_S3_SECRET_KEY ?? "").trim();
    if (!endpoint || !bucket || !accessKey || !secretKey) return null;
    const region = String(env.NAGMA_S3_REGION ?? "").trim() || (/r2\.cloudflarestorage\.com/.test(endpoint) ? "auto" : "us-east-1");
    let prefix = String(env.NAGMA_S3_PREFIX ?? "").trim().replace(/^\/+/, "");
    if (prefix && !prefix.endsWith("/")) prefix += "/";
    const publicUrl = String(env.NAGMA_S3_PUBLIC_URL ?? "").trim().replace(/\/+$/, "") || null;
    // Path style (https://endpoint/bucket/key) works with R2, B2, MinIO and AWS; 0 uses bucket.endpoint.
    const pathStyle = String(env.NAGMA_S3_PATH_STYLE ?? "1") !== "0";
    return { endpoint, region, bucket, accessKey, secretKey, prefix, publicUrl, pathStyle };
}

// ---- AWS Signature Version 4, query-string (presigned) form ----

// RFC 3986 encoding, as SigV4 wants it.
export const awsEncode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

/**
 * A presigned address: anyone holding it may make that one request (method, object, signed headers)
 * until it expires. `base` is the bucket's base address (path style: endpoint/bucket), `key` the
 * object's key. Headers named in `headers` are signed and must be sent exactly as given.
 */
export function presignUrl({ method, base, key, region, accessKey, secretKey, expires = 600, headers = {}, query = {}, now = new Date() }) {
    const url = new URL(base);
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const day = amzDate.slice(0, 8);
    const scope = `${day}/${region}/s3/aws4_request`;
    const signed = { host: url.host };
    for (const [name, value] of Object.entries(headers)) signed[name.toLowerCase()] = String(value).trim();
    const names = Object.keys(signed).sort();
    const params = {
        ...query,
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": `${accessKey}/${scope}`,
        "X-Amz-Date": amzDate,
        "X-Amz-Expires": String(Math.max(1, Math.min(604800, Math.round(expires)))),
        "X-Amz-SignedHeaders": names.join(";"),
    };
    const canonicalQuery = Object.entries(params)
        .map(([k, v]) => [awsEncode(k), awsEncode(String(v))])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}=${v}`)
        .join("&");
    const path = `${url.pathname.replace(/\/+$/, "")}/${key}`.split("/").map(awsEncode).join("/");
    const canonical = [method, path, canonicalQuery, names.map((n) => `${n}:${signed[n]}\n`).join(""), names.join(";"), "UNSIGNED-PAYLOAD"].join("\n");
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), "s3"), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
    return `${url.protocol}//${url.host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// One HTTP request without buffering the body either way. `body`: a Buffer, a readable stream, or
// nothing. Answers { status, headers, stream }.
function send(method, address, { headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(address);
        const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(u, { method, headers }, (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, stream: res }));
        req.setTimeout(120_000, () => req.destroy(new Error("The object store didn't answer in time.")));
        req.on("error", reject);
        if (body && typeof body.pipe === "function") body.pipe(req);
        else req.end(body);
    });
}

async function drain(stream) {
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    return Buffer.concat(chunks);
}

/** A small client for one S3-compatible bucket. */
export function createS3Client(config) {
    const { endpoint, region, bucket, accessKey, secretKey, prefix, publicUrl, pathStyle } = config;
    const base = pathStyle ? `${endpoint}/${awsEncode(bucket)}` : (() => {
        const u = new URL(endpoint);
        return `${u.protocol}//${bucket}.${u.host}${u.pathname.replace(/\/+$/, "")}`;
    })();
    const objectKey = (key) => `${prefix}${key}`;
    const sign = (method, key, opts = {}) => presignUrl({ method, base, key: objectKey(key), region, accessKey, secretKey, ...opts });
    const fail = async (what, r) => {
        const text = (await drain(r.stream).catch(() => Buffer.alloc(0))).toString("utf8").slice(0, 300);
        return new Error(`Object store ${what} failed (${r.status})${text ? `: ${text.replace(/\s+/g, " ")}` : ""}`);
    };
    return {
        bucket,
        objectKey,
        /** A presigned PUT the browser uploads to; `type` is signed, so it must be sent as given. */
        presignPut(key, { type, expires = 600 }) {
            return { url: sign("PUT", key, { expires, headers: { "content-type": type } }), headers: { "content-type": type }, expires: Date.now() + expires * 1000 };
        },
        /** A presigned GET. `attachment` makes browsers download it rather than show it. */
        presignGet(key, { expires = 600, attachment = false } = {}) {
            const query = attachment ? { "response-content-disposition": "attachment" } : {};
            return { url: sign("GET", key, { expires, query }), expires: Date.now() + expires * 1000 };
        },
        /** The object's public address under NAGMA_S3_PUBLIC_URL, or null without one. */
        publicUrl(key) {
            return publicUrl ? `${publicUrl}/${objectKey(key).split("/").map(awsEncode).join("/")}` : null;
        },
        /** { size, type, etag } of an object, or null when it isn't there. */
        async head(key) {
            const r = await send("HEAD", sign("HEAD", key, { expires: 300 }));
            r.stream.resume();
            if (r.status === 404 || r.status === 403) return null;
            if (r.status >= 300) throw new Error(`Object store HEAD failed (${r.status}).`);
            return { size: Number(r.headers["content-length"] ?? 0), type: String(r.headers["content-type"] ?? "") || null, etag: String(r.headers.etag ?? "") || null };
        },
        /** Stores bytes (a Buffer, or a stream with its `size`). */
        async put(key, body, { type = "application/octet-stream", size } = {}) {
            const length = Buffer.isBuffer(body) ? body.length : size;
            const r = await send("PUT", sign("PUT", key, { expires: 3600, headers: { "content-type": type } }), { headers: { "content-type": type, "content-length": String(length) }, body });
            if (r.status >= 300) throw await fail("PUT", r);
            r.stream.resume();
        },
        /** A readable stream of the object, or null when it isn't there. */
        async get(key) {
            const r = await send("GET", sign("GET", key, { expires: 300 }));
            if (r.status === 404) return (r.stream.resume(), null);
            if (r.status >= 300) throw await fail("GET", r);
            return r.stream;
        },
        async remove(key) {
            const r = await send("DELETE", sign("DELETE", key, { expires: 300 }));
            r.stream.resume();
            if (r.status >= 300 && r.status !== 404) throw new Error(`Object store DELETE failed (${r.status}).`);
        },
    };
}

// ---- The store ----

// Types that would run as a page if opened directly: served as downloads from the bucket.
const ACTIVE_TYPES = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml|text\/javascript|application\/javascript)\b/i;
export const validMediaType = (type) => typeof type === "string" && type.length <= 100 && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+_-]*(;.*)?$/i.test(type);
export const validSha256 = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

/**
 * The media store. `dir` is DATA_DIR/media. The answer's `kind` says where new uploads go; reads
 * find each asset where it is (an s3 server still serves what's on its disk, and a local server
 * still serves what's in a configured bucket), so a migration can run while the server does.
 */
export async function createMediaStore({ dir, env = process.env, log = (line) => console.log(line) }) {
    const config = mediaConfig(env);
    const s3 = config.s3 ? createS3Client(config.s3) : null;
    const PENDING = join(dir, "pending.d");
    const HASHES = join(dir, "hashes.d");
    const USAGE = join(dir, "usage.d");
    for (const d of [dir, PENDING, HASHES, USAGE]) await mkdir(d, { recursive: true });

    const localPath = (key) => join(dir, key);
    const metaPath = (id) => join(dir, `${id}.meta.json`);
    const objectOf = (id, meta) => meta?.object ?? id;
    const exists = (p) => stat(p).then((s) => s.isFile(), () => false);

    async function readMeta(id) {
        try {
            return JSON.parse(await readFile(metaPath(id), "utf8"));
        } catch {
            return null;
        }
    }
    async function writeMeta(id, meta) {
        const tmp = `${metaPath(id)}.${process.pid}.tmp`;
        await writeFile(tmp, JSON.stringify(meta));
        await rename(tmp, metaPath(id));
    }

    // Where an asset's bytes are: "s3", "local", or null.
    async function locate(id, meta) {
        const key = objectOf(id, meta);
        if (meta?.store === "s3" && s3) return "s3";
        if (await exists(localPath(key))) return "local";
        return s3 ? "s3" : null;
    }

    // A short-lived address the bytes can be read from without headers (s3 only), or the public
    // one when `publicOk` and NAGMA_S3_PUBLIC_URL is set.
    function readUrl(id, meta, { publicOk = false } = {}) {
        const key = objectOf(id, meta);
        const attachment = ACTIVE_TYPES.test(String(meta?.type ?? ""));
        const pub = publicOk && !attachment ? s3.publicUrl(key) : null;
        if (pub) return { url: pub, expires: Date.now() + config.urlSeconds * 1000, public: true };
        return s3.presignGet(key, { expires: config.urlSeconds, attachment });
    }

    async function writeLocal(key, bytes) {
        const tmp = `${localPath(key)}.tmp`;
        await writeFile(tmp, bytes);
        await rename(tmp, localPath(key));
    }

    // ---- Direct uploads not completed in time are removed ----
    const markPending = (id) => writeFile(join(PENDING, id), String(Date.now()));
    const clearPending = (id) => unlink(join(PENDING, id)).catch(() => undefined);
    async function sweepPending(now = Date.now()) {
        let removed = 0;
        for (const id of await readdir(PENDING).catch(() => [])) {
            const at = Number(await readFile(join(PENDING, id), "utf8").catch(() => "0"));
            if (now - at < config.pendingMs) continue;
            const meta = await readMeta(id);
            if (meta?.pending) {
                if (s3) await s3.remove(objectOf(id, meta)).catch((error) => log(`media: couldn't remove an unfinished upload ${id}: ${error.message}`));
                await unlink(metaPath(id)).catch(() => undefined);
                removed++;
            }
            await clearPending(id);
        }
        if (removed) log(`media: removed ${removed} upload${removed === 1 ? "" : "s"} never completed`);
        return removed;
    }

    // ---- Content hashes, per account: the same bytes from the same person are stored once ----
    // Only the uploader's own earlier uploads are matched. A hash the browser reports for a direct
    // upload isn't checked against the bytes, so matching across accounts could hand someone else's
    // object to a claimed hash.
    const hashPath = (userId, sha) => join(HASHES, createHash("sha256").update(`${userId}:${sha}`).digest("hex"));
    const hashLookup = (userId, sha) => (validSha256(sha) ? readFile(hashPath(userId, sha), "utf8").then((s) => s.trim() || null, () => null) : Promise.resolve(null));
    const hashRecord = (userId, sha, id) => (validSha256(sha) ? writeFile(hashPath(userId, sha), id).catch(() => undefined) : Promise.resolve());

    // ---- Media bytes per file ----
    const usage = new Map();
    let usageWrites = Promise.resolve();
    async function fileUsage(fid) {
        if (usage.has(fid)) return usage.get(fid);
        const n = Number(JSON.parse(await readFile(join(USAGE, `${fid}.json`), "utf8").catch(() => "{}")).bytes ?? 0) || 0;
        usage.set(fid, n);
        return n;
    }
    async function addFileUsage(fid, bytes) {
        const next = (await fileUsage(fid)) + bytes;
        usage.set(fid, next);
        usageWrites = usageWrites.then(() => writeFile(join(USAGE, `${fid}.json`), JSON.stringify({ bytes: usage.get(fid) })).catch(() => undefined));
        await usageWrites;
    }

    // ---- Uploads per account per hour ----
    const recent = new Map();
    function rateWindow(userId, now) {
        const list = (recent.get(userId) ?? []).filter((e) => now - e.at < 60 * 60 * 1000);
        recent.set(userId, list);
        return list;
    }
    /** null when `bytes` more may go up now, else { message, retryAfter } (seconds). */
    function rateCheck(userId, bytes, now = Date.now()) {
        const list = rateWindow(userId, now);
        const total = list.reduce((s, e) => s + e.bytes, 0);
        if (list.length + 1 <= config.uploadsPerHour && total + bytes <= config.bytesPerHour) return null;
        // When enough of the window has passed for this one to fit.
        let wait = 60 * 60 * 1000;
        let count = list.length + 1;
        let sum = total + bytes;
        for (const e of list) {
            count--;
            sum -= e.bytes;
            if (count <= config.uploadsPerHour && sum <= config.bytesPerHour) {
                wait = e.at + 60 * 60 * 1000 - now;
                break;
            }
        }
        const minutes = Math.max(1, Math.ceil(wait / 60000));
        const what = list.length + 1 > config.uploadsPerHour ? `${config.uploadsPerHour} uploads` : `${Math.round(config.bytesPerHour / MB)} MB`;
        return { message: `You've reached this server's upload limit (${what} an hour). Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, retryAfter: Math.ceil(wait / 1000) };
    }
    function rateNote(userId, bytes, now = Date.now()) {
        rateWindow(userId, now).push({ at: now, bytes });
    }
    setInterval(() => {
        const now = Date.now();
        for (const [k] of recent) if (!rateWindow(k, now).length) recent.delete(k);
    }, 10 * 60 * 1000).unref();

    return {
        kind: config.kind,
        config,
        s3,
        dir,
        localPath,
        objectOf,
        readMeta,
        writeMeta,
        locate,
        readUrl,
        writeLocal,
        markPending,
        clearPending,
        sweepPending,
        hashLookup,
        hashRecord,
        fileUsage,
        addFileUsage,
        rateCheck,
        rateNote,
        /** Every asset id with a metadata record. */
        async ids() {
            return (await readdir(dir)).filter((n) => n.endsWith(".meta.json")).map((n) => n.slice(0, -".meta.json".length));
        },
        /** Copies a local file to the bucket (streamed). */
        async uploadLocalToS3(key, type) {
            const info = await stat(localPath(key));
            await s3.put(key, createReadStream(localPath(key)), { type, size: info.size });
            return info.size;
        },
        /** Copies an object from the bucket to the local folder; false when it isn't there. */
        async downloadS3ToLocal(key) {
            const body = await s3.get(key);
            if (!body) return false;
            const tmp = `${localPath(key)}.tmp`;
            await pipeline(body, createWriteStream(tmp));
            await rename(tmp, localPath(key));
            return true;
        },
        removeLocal: (key) => rm(localPath(key), { force: true }),
        mb: (bytes) => Math.round((bytes / MB) * 10) / 10,
    };
}
