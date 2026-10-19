// Moves media between this server's disk and its S3-compatible bucket (media-store.mjs).
//
//   node apps/server/media-migrate.mjs --to s3      copies every asset on disk to the bucket
//   node apps/server/media-migrate.mjs --to local   copies every asset in the bucket to disk
//
// Options: --remove deletes each source copy once the destination has it (checked by size);
// --dry-run only lists what would be copied. It reads the same settings as the server (DATA_DIR and
// the NAGMA_S3_* variables; NAGMA_MEDIA_STORE doesn't matter here) and can run while the server
// does: the server reads each asset wherever it is. It's safe to stop and run again: an asset
// already in place is skipped, and each asset's record changes only after its copy is complete.
import "./legacy-names.mjs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createMediaStore } from "./media-store.mjs";

export async function migrateMedia({ to, dataDir, env = process.env, remove = false, dryRun = false, log = (line) => console.log(line) }) {
    if (to !== "s3" && to !== "local") throw new Error('Say where to: --to s3 or --to local.');
    const store = await createMediaStore({ dir: join(dataDir, "media"), env: { ...env, NAGMA_MEDIA_STORE: "local" }, log });
    if (!store.s3) throw new Error("Set NAGMA_S3_ENDPOINT, NAGMA_S3_BUCKET, NAGMA_S3_ACCESS_KEY and NAGMA_S3_SECRET_KEY first.");
    const ids = (await store.ids()).sort();
    const done = new Set();
    const counts = { copied: 0, skipped: 0, missing: 0, failed: 0, bytes: 0 };
    let n = 0;
    for (const id of ids) {
        n++;
        const meta = await store.readMeta(id);
        if (!meta || meta.pending) continue;
        const key = store.objectOf(id, meta);
        const tag = `[${n}/${ids.length}] ${id}${key !== id ? ` (same bytes as ${key})` : ""}`;
        try {
            const localSize = await stat(store.localPath(key)).then((s) => s.size, () => null);
            if (to === "s3") {
                if (meta.store === "s3") {
                    counts.skipped++;
                    // Moved on an earlier run without --remove: the disk copy goes now.
                    if (remove && !dryRun && localSize !== null && (await store.s3.head(key))?.size === localSize) await store.removeLocal(key);
                    continue;
                }
                if (!done.has(key)) {
                    const there = await store.s3.head(key);
                    if (there && localSize !== null && there.size === localSize) log(`${tag}: already in the bucket`);
                    else if (localSize === null) {
                        if (!there) {
                            counts.missing++;
                            log(`${tag}: not on disk and not in the bucket; left as it is`);
                            continue;
                        }
                    } else if (dryRun) log(`${tag}: would copy ${store.mb(localSize)} MB`);
                    else {
                        await store.uploadLocalToS3(key, meta.type ?? "application/octet-stream");
                        const check = await store.s3.head(key);
                        if (!check || check.size !== localSize) throw new Error(`the bucket has ${check ? check.size : "no"} bytes, the disk ${localSize}`);
                        counts.copied++;
                        counts.bytes += localSize;
                        log(`${tag}: copied ${store.mb(localSize)} MB`);
                    }
                    done.add(key);
                }
                if (dryRun) continue;
                // Read again: the server may have added a file to it meanwhile.
                const fresh = (await store.readMeta(id)) ?? meta;
                await store.writeMeta(id, { ...fresh, store: "s3" });
                if (remove && localSize !== null) await store.removeLocal(key);
            } else {
                if (meta.store !== "s3" && localSize !== null) {
                    counts.skipped++;
                    if (remove && !dryRun && !done.has(key) && (await store.s3.head(key))?.size === localSize) await store.s3.remove(key);
                    done.add(key);
                    continue;
                }
                if (!done.has(key)) {
                    const there = await store.s3.head(key);
                    if (localSize !== null && there && localSize === there.size) log(`${tag}: already on disk`);
                    else if (!there) {
                        counts.missing++;
                        log(`${tag}: not in the bucket${localSize === null ? " and not on disk" : ""}; left as it is`);
                        continue;
                    } else if (dryRun) log(`${tag}: would copy ${store.mb(there.size)} MB`);
                    else {
                        await store.downloadS3ToLocal(key);
                        const size = await stat(store.localPath(key)).then((s) => s.size, () => null);
                        if (size !== there.size) throw new Error(`the disk has ${size ?? "no"} bytes, the bucket ${there.size}`);
                        counts.copied++;
                        counts.bytes += size;
                        log(`${tag}: copied ${store.mb(size)} MB`);
                    }
                    done.add(key);
                }
                if (dryRun) continue;
                const fresh = { ...((await store.readMeta(id)) ?? meta) };
                delete fresh.store;
                await store.writeMeta(id, fresh);
                if (remove) await store.s3.remove(key);
            }
        } catch (error) {
            counts.failed++;
            log(`${tag}: failed (${error.message}); run again to retry`);
        }
    }
    log(`Done: ${counts.copied} copied (${store.mb(counts.bytes)} MB), ${counts.skipped} already ${to === "s3" ? "in the bucket" : "on disk"}, ${counts.missing} missing, ${counts.failed} failed.`);
    return counts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const i = process.argv.indexOf("--to");
    const to = i > 0 ? process.argv[i + 1] : undefined;
    const withSlash = (dir) => (dir.endsWith("/") ? dir : `${dir}/`);
    const dataDir = withSlash(process.env.DATA_DIR ?? new URL("./data/", import.meta.url).pathname);
    try {
        const counts = await migrateMedia({ to, dataDir, remove: process.argv.includes("--remove"), dryRun: process.argv.includes("--dry-run") });
        process.exitCode = counts.failed ? 1 : 0;
    } catch (error) {
        console.error(error.message);
        process.exitCode = 2;
    }
}
