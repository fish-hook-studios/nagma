import { useEffect, useRef, useState } from "react";
import { type SamlConfig, importSamlMetadata, loadSaml, saveSaml, useRun } from "../../engine/admin";
import { Select } from "../select";
import { Button, Dialog, ErrorText, field, FieldLabel, Toggle } from "./admin-ui";

// Admin console › Settings › Single sign-on › SAML: the team's identity provider. Admins give the
// provider Nagma's details (entity ID, ACS URL, or the metadata file), then bring the provider's
// details in: its metadata XML (pasted or uploaded), a metadata URL the server fetches once, or the
// entity ID, sign-in URL and certificate typed in. Addresses on the listed domains sign in through it.
export function SamlDialog({ teamId, onClose, onChange }: { teamId: string; onClose: () => void; onChange?: (c: SamlConfig) => void }) {
    const [config, setConfig] = useState<SamlConfig | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [how, setHow] = useState<"xml" | "url" | "manual">("xml");
    const [xml, setXml] = useState("");
    const [metaUrl, setMetaUrl] = useState("");
    const [idpEntityId, setIdpEntityId] = useState("");
    const [ssoUrl, setSsoUrl] = useState("");
    const [binding, setBinding] = useState<"redirect" | "post">("redirect");
    const [cert, setCert] = useState("");
    const [domains, setDomains] = useState("");
    const [enabled, setEnabled] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const run = useRun(setError);

    const take = (c: SamlConfig) => {
        setConfig(c);
        setIdpEntityId(c.idpEntityId);
        setSsoUrl(c.ssoUrl);
        setBinding(c.binding);
        setCert(c.certs.map((x) => x.pem).join(""));
        setDomains(c.domains.join(", "));
        setEnabled(c.enabled);
        onChange?.(c);
    };
    useEffect(() => {
        loadSaml(teamId).then(take, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [teamId]);

    const copy = (label: string, text: string) => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(label));
    };
    const domainList = () => domains.split(/[\s,;]+/).map((d) => d.trim()).filter(Boolean);

    const importMetadata = () => run(async () => take(await importSamlMetadata(teamId, how === "url" ? { url: metaUrl.trim() } : { xml })));
    const save = () =>
        run(async () => {
            const update = how === "manual" ? { idpEntityId, ssoUrl, binding, certs: cert.trim() ? [cert] : [], source: "manual" as const } : {};
            take(await saveSaml(teamId, { ...update, domains: domainList(), enabled }));
        }).then((ok) => ok && onClose());

    return (
        <Dialog
            title="SAML single sign-on"
            description="People with an email on the team's domains sign in through your identity provider (Okta, Entra ID, Google Workspace, OneLogin, JumpCloud and others). Assertions must be signed."
            width={560}
            onClose={onClose}
            footer={
                <>
                    <Button onPress={onClose}>Cancel</Button>
                    <Button variant="primary" disabled={!config} onPress={() => void save()}>
                        Save
                    </Button>
                </>
            }
        >
            {!config ? (
                <p className="text-ink-muted">{error ?? "Loading…"}</p>
            ) : (
                <div className="space-y-4">
                    <section className="space-y-2 rounded-lg border border-panel-border p-3">
                        <div className="text-[11.5px] font-medium">1. Give your identity provider Nagma's details</div>
                        {(
                            [
                                ["Entity ID (audience)", config.sp.entityId],
                                ["ACS URL (reply URL)", config.sp.acsUrl],
                            ] as const
                        ).map(([label, value]) => (
                            <div key={label} className="flex items-center gap-2">
                                <span className="w-[130px] shrink-0 text-ink-muted">{label}</span>
                                <code className="min-w-0 flex-1 truncate rounded bg-field px-2 py-1 text-[11px]" title={value}>
                                    {value}
                                </code>
                                <Button variant="ghost" onPress={() => copy(label, value)}>
                                    {copied === label ? "Copied" : "Copy"}
                                </Button>
                            </div>
                        ))}
                        <div className="flex items-center gap-2 text-ink-muted">
                            NameID format: email address.
                            <a href={config.sp.metadataUrl} download="nagma-sp-metadata.xml" className="ml-auto font-medium text-brand-500 hover:underline">
                                Download SP metadata
                            </a>
                        </div>
                    </section>

                    <section className="space-y-2 rounded-lg border border-panel-border p-3">
                        <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 text-[11.5px] font-medium whitespace-nowrap">2. Add your identity provider</span>
                            <div className="w-[170px] shrink-0">
                                <Select aria-label="How to add the identity provider" value={how} onChange={(e) => setHow(e.target.value as typeof how)} className={field}>
                                    <option value="xml">Metadata XML</option>
                                    <option value="url">Metadata URL</option>
                                    <option value="manual">Enter details</option>
                                </Select>
                            </div>
                        </div>
                        {how === "xml" && (
                            <>
                                <textarea aria-label="Identity provider metadata XML" value={xml} onChange={(e) => setXml(e.target.value)} rows={4} placeholder="<EntityDescriptor …>" className={`${field} h-auto py-2 font-mono text-[11px]`} />
                                <div className="flex gap-2">
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        accept=".xml,application/xml,text/xml"
                                        className="hidden"
                                        onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            if (f) void f.text().then(setXml);
                                            e.target.value = "";
                                        }}
                                    />
                                    <Button onPress={() => fileRef.current?.click()}>Upload file…</Button>
                                    <div className="flex-1" />
                                    <Button variant="primary" disabled={!xml.trim()} onPress={() => void importMetadata()}>
                                        Import
                                    </Button>
                                </div>
                            </>
                        )}
                        {how === "url" && (
                            <div className="flex gap-2">
                                <input aria-label="Metadata URL" value={metaUrl} onChange={(e) => setMetaUrl(e.target.value)} placeholder="https://idp.example.com/metadata.xml" className={field} />
                                <Button variant="primary" disabled={!metaUrl.trim()} onPress={() => void importMetadata()}>
                                    Fetch
                                </Button>
                            </div>
                        )}
                        {how === "url" && <p className="text-[11px] text-ink-muted">The server fetches it once now; fetch again when your provider's certificate changes.</p>}
                        {how === "manual" && (
                            <div className="space-y-2">
                                <FieldLabel label="Identity provider entity ID (issuer)">
                                    <input value={idpEntityId} onChange={(e) => setIdpEntityId(e.target.value)} className={field} />
                                </FieldLabel>
                                <div className="grid grid-cols-[1fr_130px] gap-2">
                                    <FieldLabel label="Single sign-on URL">
                                        <input value={ssoUrl} onChange={(e) => setSsoUrl(e.target.value)} placeholder="https://" className={field} />
                                    </FieldLabel>
                                    <FieldLabel label="Binding">
                                        <Select aria-label="Binding" value={binding} onChange={(e) => setBinding(e.target.value as "redirect" | "post")} className={field}>
                                            <option value="redirect">HTTP-Redirect</option>
                                            <option value="post">HTTP-POST</option>
                                        </Select>
                                    </FieldLabel>
                                </div>
                                <FieldLabel label="Signing certificate (PEM)">
                                    <textarea value={cert} onChange={(e) => setCert(e.target.value)} rows={4} placeholder="-----BEGIN CERTIFICATE-----" className={`${field} h-auto py-2 font-mono text-[11px]`} />
                                </FieldLabel>
                            </div>
                        )}
                        {how !== "manual" && config.ssoUrl && (
                            <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1 text-[11px]">
                                <dt className="text-ink-muted">Issuer</dt>
                                <dd className="truncate">{config.idpEntityId || "—"}</dd>
                                <dt className="text-ink-muted">Sign-in URL</dt>
                                <dd className="truncate">{config.ssoUrl}</dd>
                            </dl>
                        )}
                        {config.certs.map((c) => (
                            <div key={c.fingerprint} className="rounded bg-field px-2 py-1.5 text-[11px]">
                                <div className="truncate">{c.subject}</div>
                                <div className="text-ink-muted">
                                    Expires {c.validTo} · SHA-256 {c.fingerprint.slice(0, 23)}…
                                </div>
                            </div>
                        ))}
                    </section>

                    <section className="space-y-2 rounded-lg border border-panel-border p-3">
                        <div className="text-[11.5px] font-medium">3. Choose who signs in this way</div>
                        <FieldLabel label="Email domains" hint="Comma separated, like acme.com, acme.co.uk. People who sign in join the team with view access; admins pick their roles and seats.">
                            <input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="acme.com" className={field} />
                        </FieldLabel>
                        <label className="flex items-center gap-3">
                            <span className="flex-1">Turn on SAML single sign-on</span>
                            <Toggle label="Turn on SAML single sign-on" checked={enabled} onChange={setEnabled} />
                        </label>
                    </section>
                    <ErrorText>{error}</ErrorText>
                </div>
            )}
        </Dialog>
    );
}
