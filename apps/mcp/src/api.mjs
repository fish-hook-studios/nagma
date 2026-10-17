// The Nagma sync server's read-only API (/v1), reached with a personal access token created under
// Account settings › Tokens. NAGMA_URL is the server (default http://localhost:8787); NAGMA_TOKEN is
// the token. Both come from the environment; the token is never logged.

export function client(env = process.env) {
    const base = String(env.NAGMA_URL ?? "http://localhost:8787").replace(/\/$/, "");
    const token = env.NAGMA_TOKEN ?? "";
    async function get(path) {
        if (!token) throw new Error("Set NAGMA_TOKEN to a personal access token (Account settings › Tokens).");
        const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
        return data;
    }
    return {
        base,
        me: () => get("/v1/me"),
        files: () => get("/v1/files"),
        file: (id, key) => get(`/v1/files/${id}${key ? `?key=${encodeURIComponent(key)}` : ""}`),
        nodes: (id, ids, depth, key) => get(`/v1/files/${id}/nodes?ids=${encodeURIComponent(ids.join(","))}${depth != null ? `&depth=${depth}` : ""}${key ? `&key=${encodeURIComponent(key)}` : ""}`),
        selection: (id) => get(`/v1/files/${id}/selection`),
    };
}

// A file id, or a Nagma link (…?file=<id>&node-id=<id>&key=<key>), as { file, node, key }.
export function parseTarget(fileOrLink, node) {
    const raw = String(fileOrLink ?? "").trim();
    if (/^https?:\/\//.test(raw)) {
        const url = new URL(raw);
        return { file: url.searchParams.get("file") ?? "", node: node ?? url.searchParams.get("node-id") ?? url.searchParams.get("focus") ?? null, key: url.searchParams.get("key") };
    }
    return { file: raw, node: node ?? null, key: null };
}
