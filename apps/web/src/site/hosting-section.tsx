import { useEffect, useState } from "react";
import { Select } from "../components/select";
import { hostedUrls, type HostingApi, type SiteHosting } from "./publish";

// Where a site (or a Make app) is published, a name and a custom domain with the DNS records to
// add, and who can view it.

const INPUT = "h-8 w-full min-w-0 rounded-[6px] border border-panel-border bg-field px-2 text-[12px] text-ink outline-none focus:border-brand-500";
const SECONDARY = "h-8 shrink-0 rounded-[6px] border border-panel-border px-3 text-[12px] text-ink outline-none hover:bg-panel-hover disabled:opacity-50";

export function HostingSection({ api, canEdit, label = "site" }: { api: HostingApi; canEdit: boolean; label?: string }) {
    const [hosting, setHosting] = useState<SiteHosting | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [password, setPassword] = useState("");
    useEffect(() => {
        void api.load().then((h) => ("error" in h ? setError(h.error) : setHosting(h)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remounted (by key) for another file
    }, []);
    const run = async (call: Promise<SiteHosting | { error: string }>) => {
        setBusy(true);
        setError(null);
        const h = await call;
        setBusy(false);
        if ("error" in h) setError(h.error);
        else setHosting(h);
        return h;
    };
    if (!hosting) return error ? <p className="mb-3 text-ink-muted">{error}</p> : null;
    const urls = hostedUrls(hosting);
    return (
        <fieldset disabled={!canEdit || busy} className="mb-3 space-y-2.5 rounded-[8px] border border-panel-border p-3">
            <div>
                <div className="mb-1 font-semibold">Subdomain</div>
                <div className="flex items-center gap-1.5">
                    <input
                        key={hosting.slug ?? ""}
                        aria-label="Subdomain"
                        defaultValue={hosting.slug ?? ""}
                        placeholder="my-site"
                        className={`${INPUT} font-mono`}
                        onBlur={(e) => {
                            const input = e.target;
                            const slug = input.value.trim().toLowerCase();
                            // A refused name (bad characters, taken) puts the current one back in the field.
                            if (slug !== (hosting.slug ?? "")) void run(api.save({ slug: slug || null })).then((h) => "error" in h && (input.value = hosting.slug ?? ""));
                        }}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                    <span className="shrink-0 font-mono text-ink-muted">.{hosting.sitesDomain}</span>
                </div>
            </div>
            <div>
                <div className="mb-1 font-semibold">Custom domain</div>
                <div className="flex items-center gap-1.5">
                    <input
                        key={hosting.domain ?? ""}
                        aria-label="Custom domain"
                        defaultValue={hosting.domain ?? ""}
                        placeholder="www.example.com"
                        className={`${INPUT} font-mono`}
                        onBlur={(e) => {
                            const input = e.target;
                            const domain = input.value.trim();
                            if (domain.toLowerCase() !== (hosting.domain ?? "")) void run(api.save({ domain: domain || null })).then((h) => "error" in h && (input.value = hosting.domain ?? ""));
                        }}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                    {hosting.domain && (
                        <button type="button" className={SECONDARY} onClick={() => void run(api.verify())}>
                            Verify
                        </button>
                    )}
                </div>
                {hosting.domain && (
                    <div className="mt-2 space-y-1.5">
                        <p className={hosting.verified ? "text-emerald-600" : "text-ink-muted"} data-domain-status>
                            {hosting.verified ? `Verified. The ${label} answers at this domain once it's published.` : "Add these records at your domain's DNS provider, then press Verify. Changes can take a while to spread."}
                        </p>
                        <table className="w-full table-fixed text-left font-mono text-[10.5px]">
                            <thead className="text-ink-muted">
                                <tr>
                                    <th className="w-14 font-normal">Type</th>
                                    <th className="font-normal">Name</th>
                                    <th className="font-normal">Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {hosting.records.map((r) => (
                                    <tr key={r.type}>
                                        <td className="py-0.5">
                                            {r.type}
                                            {hosting.checks?.find((c) => c.type === r.type)?.ok ? " ✓" : ""}
                                        </td>
                                        <td className="truncate py-0.5 select-all" title={r.name}>{r.name}</td>
                                        <td className="truncate py-0.5 select-all" title={r.value}>{r.value}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <div>
                <div className="mb-1 font-semibold">Who can view</div>
                <Select
                    aria-label="Who can view the site"
                    value={hosting.access}
                    className={INPUT}
                    onChange={(e) => {
                        if (e.target.value === "public" || e.target.value === "team") void run(api.save({ access: e.target.value }));
                        else setHosting({ ...hosting, access: "password" });
                    }}
                >
                    <option value="public">Anyone with the address</option>
                    <option value="team">Only people signed in to this server</option>
                    <option value="password">Only people with the password</option>
                </Select>
                {hosting.access === "password" && (
                    <form
                        className="mt-1.5 flex items-center gap-1.5"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void run(api.save({ access: "password", password })).then(() => setPassword(""));
                        }}
                    >
                        <input type="password" aria-label="Site password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" className={INPUT} />
                        <button type="submit" className={SECONDARY} disabled={password.length < 4}>
                            Set password
                        </button>
                    </form>
                )}
            </div>
            {hosting.access === "team" && <p className="text-ink-muted">People signed in to this server open it with Open below; others see a sign-in notice.</p>}
            {urls.length > 0 && (
                <ul className="space-y-0.5">
                    {urls.map((u) => (
                        <li key={u.label} className="flex items-center gap-2">
                            <span className="w-24 shrink-0 text-ink-muted">{u.label}</span>
                            <a href={u.url} target="_blank" rel="noreferrer" className="truncate font-mono text-brand-500 hover:underline">
                                {u.url}
                            </a>
                        </li>
                    ))}
                </ul>
            )}
            {error && <p className="rounded-[6px] bg-rose-500/12 p-2 text-rose-600">{error}</p>}
        </fieldset>
    );
}

