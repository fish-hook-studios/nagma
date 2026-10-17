// The product was called Migfa before it was Nagma: MIGFA_URL and MIGFA_TOKEN (and any other
// MIGFA_* setting) still work, read as NAGMA_* when those aren't set, with one line on stderr (stdout
// is the protocol). tools/rename-nagma.sh leaves this file as it is.
const OLD_PREFIX = "MIGFA_";

export function adoptLegacyEnv(env = process.env, log = (line) => console.error(line)) {
    const read = [];
    for (const key of Object.keys(env)) {
        if (!key.startsWith(OLD_PREFIX)) continue;
        const next = `NAGMA_${key.slice(OLD_PREFIX.length)}`;
        if (env[next] !== undefined) continue;
        env[next] = env[key];
        read.push(key);
    }
    if (read.length) log(`Deprecated: ${read.join(", ")} ${read.length === 1 ? "is" : "are"} read as NAGMA_*. Rename ${read.length === 1 ? "it" : "them"}.`);
    return read;
}

adoptLegacyEnv();
