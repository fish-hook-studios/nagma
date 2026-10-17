import { authHeaders } from "./auth";
import { httpBase } from "./server-url";

// Personal access tokens (Account settings › Tokens): read-only keys for tools outside the editor,
// such as the MCP server (apps/mcp) and the code-editor extension (apps/vscode-extension). The
// server shows a token once and keeps only its hash.

export interface PersonalToken {
    id: string;
    name: string;
    scopes: string[];
    hint: string;
    createdAt: number;
    lastUsed: number | null;
    expiresAt: number | null;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${httpBase()}${path}`, { ...init, headers: { "content-type": "application/json", ...authHeaders(), ...(init.headers ?? {}) } });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    return data;
}

export async function listTokens(): Promise<PersonalToken[]> {
    return (await call<{ tokens: PersonalToken[] }>("/account/tokens")).tokens;
}

export async function createToken(name: string, expiresInDays: number | null): Promise<{ token: string; record: PersonalToken }> {
    return call("/account/tokens", { method: "POST", body: JSON.stringify({ name, expiresInDays }) });
}

export async function revokeToken(id: string): Promise<void> {
    await call(`/account/tokens/${id}`, { method: "DELETE" });
}
