import { randomUUID } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";

// Writes a file whole: a temp file of its own, renamed over the old one, so a crash never leaves
// half a file. Writes to one path go one at a time and in order, so two saves of the same file
// can't move each other's temp file away (the second rename used to fail with ENOENT, an unhandled
// rejection that stopped the server) or land older data over newer.
const queues = new Map();

export function writeAtomic(path, data, options) {
    const before = queues.get(path) ?? Promise.resolve();
    const next = before
        .catch(() => undefined)
        .then(async () => {
            const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
            try {
                await writeFile(tmp, data, options);
                await rename(tmp, path);
            } catch (error) {
                await unlink(tmp).catch(() => undefined);
                throw error;
            }
        });
    queues.set(path, next);
    next.then(
        () => queues.get(path) === next && queues.delete(path),
        () => queues.get(path) === next && queues.delete(path),
    );
    return next;
}

// For saves made from a timer, where nobody waits on the result: a failed save is logged (the data
// stays in memory and the next save tries again) instead of ending the process.
export function saveLater(path, data, options) {
    writeAtomic(path, data, options).catch((error) => console.error(`Couldn't save ${path}: ${error?.message ?? error}`));
}
