import { useEffect, useState } from "react";
import { type PersonalToken, createToken, listTokens, revokeToken } from "../engine/personal-tokens";
import { Select } from "./select";

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

// Account settings › Tokens: create a read-only personal access token (shown once, to copy), see
// when each was last used, and revoke them.
export function PersonalTokens() {
    const [tokens, setTokens] = useState<PersonalToken[] | null>(null);
    const [name, setName] = useState("");
    const [days, setDays] = useState("90");
    // The token just made (shown once) and its record, so revoking it hides it too.
    const [fresh, setFresh] = useState<string | null>(null);
    const [freshId, setFreshId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        void listTokens().then(setTokens, () => setTokens([]));
    }, []);
    const create = () => {
        if (!name.trim()) return;
        setError(null);
        void createToken(name.trim(), days === "never" ? null : Number(days)).then(
            ({ token, record }) => {
                setFresh(token);
                setFreshId(record.id);
                setCopied(false);
                setName("");
                setTokens((list) => [...(list ?? []), record]);
            },
            (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
        );
    };
    const field = "h-7 rounded-md border border-panel-border bg-field px-2 text-[11px] text-ink outline-none focus:border-brand-500";
    return (
        <div className="space-y-2" aria-label="Tokens" onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}>
            <span className="block text-[12px]">Tokens</span>
            <span className="block text-[11px] text-ink-subtle">Personal access tokens let the MCP server and the code-editor extension read the files you can open. They can't edit anything.</span>
            {fresh && (
                <div className="space-y-1.5 rounded-md bg-brand-500/10 p-2">
                    <span className="block text-[11px]">Copy this token now. It won't be shown again.</span>
                    <span className="flex gap-2">
                        <input readOnly value={fresh} onFocus={(e) => e.currentTarget.select()} aria-label="New token" className={`${field} min-w-0 flex-1 font-mono`} />
                        <button
                            type="button"
                            onClick={() => void navigator.clipboard.writeText(fresh).then(() => setCopied(true), () => undefined)}
                            className="h-7 rounded-md border border-panel-border px-2 text-[11px] hover:bg-panel-hover"
                        >
                            {copied ? "Copied" : "Copy"}
                        </button>
                    </span>
                </div>
            )}
            {/* Enter creates; keys stay out of the editor shortcuts. */}
            <div className="flex gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), create())} placeholder="Token name" aria-label="Token name" className={`${field} min-w-0 flex-1`} />
                <Select aria-label="Expires" value={days} onChange={(e) => setDays(e.target.value)} className={field}>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
                    <option value="never">No expiry</option>
                </Select>
                <button type="button" onClick={create} disabled={!name.trim()} className="h-7 rounded-md border border-panel-border px-2 text-[11px] hover:bg-panel-hover disabled:opacity-50">
                    Create
                </button>
            </div>
            {error && <span className="block text-[11px] text-red-400">{error}</span>}
            {tokens?.map((t) => (
                <div key={t.id} className="flex items-center gap-2 text-[11px]">
                    <span className="min-w-0 flex-1 truncate">
                        {t.name} <span className="text-ink-subtle">…{t.hint}, read only</span>
                        <span className="block text-ink-subtle">
                            {t.lastUsed ? `Last used ${day(t.lastUsed)}` : "Never used"}
                            {t.expiresAt ? `, expires ${day(t.expiresAt)}` : ""}
                        </span>
                    </span>
                    <button type="button" onClick={() =>
                            void revokeToken(t.id).then(() => {
                                setTokens((list) => (list ?? []).filter((x) => x.id !== t.id));
                                if (freshId === t.id) setFresh(null);
                            })
                        } className="h-7 rounded-md px-1.5 text-red-400 hover:bg-panel-hover">
                        Revoke
                    </button>
                </div>
            ))}
        </div>
    );
}
