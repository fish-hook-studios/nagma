// Sending a capture through a Nagma server instead of a Nagma tab: POST <address>/captures with the
// capture JSON and the person's personal access token (made in Nagma's Settings › Tokens). The
// server keeps it and answers with the address that opens it: 201 { id, url }.

export const MAX_UPLOAD = 60 * 1024 * 1024;

export class SendError extends Error {
    readonly status: number | null;
    constructor(message: string, status: number | null = null) {
        super(message);
        this.status = status;
    }
}

export interface Sent {
    id: string;
    url: string;
}

export async function sendThroughServer(body: string, address: string, token: string, fetcher: typeof fetch = fetch): Promise<Sent> {
    const base = address.replace(/\/+$/, "");
    if (!token.trim()) throw new SendError("Add a personal access token in Options first (Nagma › Settings › Tokens).");
    if (new Blob([body]).size > MAX_UPLOAD) throw new SendError("This capture is over 60 MB, more than the server takes. Download it instead and open the file in Nagma.", 413);
    let res: Response;
    try {
        res = await fetcher(`${base}/captures`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.trim()}` },
            body,
            credentials: "omit",
        });
    } catch {
        throw new SendError(`Couldn't reach ${base}. Check the address in Options.`);
    }
    if (res.status === 401 || res.status === 403) throw new SendError("The server didn't accept the token. Make a new one in Nagma › Settings › Tokens and paste it in Options.", res.status);
    if (res.status === 413) throw new SendError("The server says this capture is too large. Download it instead and open the file in Nagma.", 413);
    if (res.status === 404) throw new SendError(`${base} doesn't take captures yet. Is it up to date?`, 404);
    if (res.status !== 201 && res.status !== 200) throw new SendError(`The server answered ${res.status}. Try again, or download the capture.`, res.status);
    let data: Partial<Sent>;
    try {
        data = (await res.json()) as Partial<Sent>;
    } catch {
        throw new SendError("The server's answer wasn't readable.", res.status);
    }
    if (!data.id || typeof data.id !== "string") throw new SendError("The server's answer had no capture in it.", res.status);
    // The server names the address; one on another origin than the server's isn't followed.
    let url = typeof data.url === "string" && data.url ? data.url : `${base}/?capture=${encodeURIComponent(data.id)}`;
    try {
        if (new URL(url, base).origin !== new URL(base).origin) url = `${base}/?capture=${encodeURIComponent(data.id)}`;
        else url = new URL(url, base).href;
    } catch {
        url = `${base}/?capture=${encodeURIComponent(data.id)}`;
    }
    return { id: data.id, url };
}
