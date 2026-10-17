// The product was called Migfa before it was Nagma. What was set up or handed out under the old
// name keeps working: MIGFA_* settings (read as NAGMA_* when those aren't set, with one deprecation
// line in the log), personal access tokens made with the old prefix and sent in the old header, Make
// apps built before the rename (their pages look for the old meta tag and send the old header), and
// custom-domain TXT records added with the old names. tools/rename-nagma.sh leaves this file as it is.

const OLD = "migfa";

export const LEGACY = {
    envPrefix: `${OLD.toUpperCase()}_`,
    tokenPrefix: `${OLD}_pat_`,
    tokenHeader: `x-${OLD}-token`,
    appTokenHeader: `x-${OLD}-app-token`,
    appTokenMeta: `${OLD}-app-token`,
    siteTxtHost: `_${OLD}`,
    siteTxtValue: `${OLD}-site-verification`,
};

/** Copies MIGFA_X to NAGMA_X where NAGMA_X isn't set. Returns the old names it read. */
export function adoptLegacyEnv(env = process.env, log = (line) => console.warn(line)) {
    const read = [];
    for (const key of Object.keys(env)) {
        if (!key.startsWith(LEGACY.envPrefix)) continue;
        const next = `NAGMA_${key.slice(LEGACY.envPrefix.length)}`;
        if (env[next] !== undefined) continue;
        env[next] = env[key];
        read.push(key);
    }
    if (read.length) log(`Deprecated: ${read.join(", ")} ${read.length === 1 ? "is" : "are"} read as ${read.map((k) => `NAGMA_${k.slice(LEGACY.envPrefix.length)}`).join(", ")}. Rename ${read.length === 1 ? "it" : "them"}; the old names will stop working in a later version.`);
    return read;
}

// On import, before the rest of the server reads its settings (server.mjs imports this first).
adoptLegacyEnv();
