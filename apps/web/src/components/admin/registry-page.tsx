import { Copy01, Download01, Plus } from "@untitledui/icons";
import { useState } from "react";
import { type AdminData, adminAction, longDate, registryVersion, relative, useAsync, useRun } from "../../engine/admin";
import { buildTokens, packageZip, saveBlob } from "../../engine/design-tokens";
import { getServerFiles, refreshServerFiles } from "../../engine/files";
import { serverManifest, serverManifests } from "../../engine/library-store";
import { Select } from "../select";
import { Button, Card, Dialog, EmptyState, ErrorText, field, FieldLabel, PageBody, PageTitle, TableHead, TableRow } from "./admin-ui";

// The token registry: publish the team library's variables and colour and text styles as a
// versioned package (tokens.json and tokens.css) that developers download into their code.
export function RegistryPage({ data }: { data: AdminData }) {
    const [publishing, setPublishing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const run = useRun(setError);
    const reg = data.registry;
    const download = (version: string) =>
        void run(async () => {
            const v = await registryVersion(data.team.id, version);
            const t = v.tokens as { json: unknown; css: string };
            saveBlob(packageZip(reg.name, v.version, t.json, t.css), `${reg.name.replace(/^@/, "").replace("/", "-")}-${v.version}.zip`);
        });

    if (reg.versions.length === 0)
        return (
            <>
                <PageTitle>npm registry</PageTitle>
                <div className="flex flex-col items-center px-6 pt-[33px] pb-12 text-center">
                    <RegistryArt />
                    <h2 className="mt-[40px] text-[13.5px] font-semibold">Use your design system in code</h2>
                    <p className="mt-[3px] text-[12px] leading-[18px] text-ink-muted">Publish the team library's variables and styles as a package of design tokens for developers.</p>
                    <Button variant="primary" className="mt-[10px] h-[23px]" onPress={() => setPublishing(true)}>
                        Get started
                    </Button>
                </div>
                {publishing && <PublishDialog data={data} onClose={() => setPublishing(false)} />}
            </>
        );

    const latest = reg.versions[0];
    const install = `npm install ${reg.name}@${latest?.version ?? "latest"}`;
    const cols = "100px minmax(0,1fr) 170px 150px 110px";
    return (
        <>
            <PageTitle
                extra={
                    <Button variant="primary" onPress={() => setPublishing(true)}>
                        <Plus className="size-4" /> Publish version
                    </Button>
                }
            >
                npm registry
            </PageTitle>
            <PageBody>
                <Card className="mb-5">
                    <div className="flex flex-wrap items-center gap-4 px-5 py-4">
                        <div className="min-w-0 flex-1">
                            <div className="font-mono text-[13px] font-semibold">{reg.name}</div>
                            <div className="mt-0.5 text-[12px] text-ink-muted">
                                Latest {latest?.version} · published {latest ? relative(latest.at).toLowerCase() : ""} from {latest?.source || "the team library"}
                            </div>
                        </div>
                        <code className="rounded-md bg-panel-hover px-2.5 py-1.5 font-mono text-[11.5px]">{install}</code>
                        <Button
                            onPress={() => {
                                void navigator.clipboard.writeText(install).catch(() => undefined);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 1500);
                            }}
                        >
                            <Copy01 className="size-3.5" /> {copied ? "Copied" : "Copy"}
                        </Button>
                    </div>
                    <p className="border-t border-panel-border px-5 py-2.5 text-[11.5px] text-ink-muted">Unzip a download and run npm install ./package, or publish it to your own registry under that name.</p>
                </Card>
                <ErrorText>{error}</ErrorText>
                <div>
                    <TableHead cols={cols}>
                        <span>Version</span>
                        <span>Notes</span>
                        <span>Contents</span>
                        <span>Published</span>
                        <span />
                    </TableHead>
                    {reg.versions.map((v) => (
                        <TableRow key={v.version} cols={cols}>
                            <span className="font-mono font-medium">{v.version}</span>
                            <span className="truncate text-ink-muted">{v.notes || "No notes"}</span>
                            <span className="text-ink-muted">
                                {v.counts.variables} variables, {v.counts.colors + v.counts.texts} styles
                            </span>
                            <span className="text-ink-muted" title={longDate(v.at)}>
                                {relative(v.at)}
                                {v.by ? ` by ${v.by.name}` : ""}
                            </span>
                            <Button variant="ghost" onPress={() => download(v.version)}>
                                <Download01 className="size-3.5" /> Download
                            </Button>
                        </TableRow>
                    ))}
                </div>
            </PageBody>
            {publishing && <PublishDialog data={data} onClose={() => setPublishing(false)} />}
        </>
    );
}

function PublishDialog({ data, onClose }: { data: AdminData; onClose: () => void }) {
    // Libraries published from this team's files.
    const libs = useAsync(async () => {
        await refreshServerFiles();
        const inTeam = new Set(getServerFiles().filter((f) => f.team === data.team.id).map((f) => f.id));
        return (await serverManifests()).filter((m) => inTeam.has(m.id));
    }, data.team.id);
    const [source, setSource] = useState("");
    const [name, setName] = useState(data.registry.name);
    const [bump, setBump] = useState<"patch" | "minor" | "major">("minor");
    const [notes, setNotes] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const run = useRun(setError);
    const chosen = source || libs.value?.[0]?.id || "";
    const first = data.registry.versions.length === 0;
    const publish = async () => {
        setBusy(true);
        await run(async () => {
            const manifest = await serverManifest(chosen);
            if (!manifest) throw new Error("That library couldn't be loaded.");
            const built = buildTokens(manifest);
            if (built.counts.variables + built.counts.colors + built.counts.texts === 0) throw new Error("That library has no variables or colour or text styles to publish.");
            await adminAction(data.team.id, "registry", { name, bump, notes, source: manifest.name, counts: built.counts, tokens: { json: built.tokens, css: built.css } });
            onClose();
        });
        setBusy(false);
    };
    return (
        <Dialog
            title={first ? "Set up your package" : "Publish a new version"}
            description="Tokens come from a library published from one of the team's files."
            onClose={onClose}
            width={480}
            footer={
                <>
                    <Button onPress={onClose}>Cancel</Button>
                    <Button variant="primary" disabled={busy || !chosen} onPress={() => void publish()}>
                        Publish
                    </Button>
                </>
            }
        >
            {!libs.value && !libs.error && <p className="text-ink-muted">Looking for team libraries…</p>}
            {libs.value?.length === 0 && <EmptyState title="No team library yet">Open a design file in one of the team's folders and publish it as a library from the Assets panel, then come back here.</EmptyState>}
            {libs.value && libs.value.length > 0 && (
                <div className="space-y-3">
                    <FieldLabel label="Library">
                        <Select aria-label="Library" value={chosen} onChange={(e) => setSource(e.target.value)} className={field}>
                            {libs.value.map((l) => (
                                <option key={l.id} value={l.id}>
                                    {`${l.name} (${l.counts.variables} variables, ${l.counts.styles} styles)`}
                                </option>
                            ))}
                        </Select>
                    </FieldLabel>
                    <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-3">
                        <FieldLabel label="Package name" hint="Lowercase, like @team/tokens.">
                            <input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} className={`${field} font-mono`} />
                        </FieldLabel>
                        {!first && (
                            <FieldLabel label="Version">
                                <Select aria-label="Version" value={bump} onChange={(e) => setBump(e.target.value as typeof bump)} className={field}>
                                    <option value="patch">Patch</option>
                                    <option value="minor">Minor</option>
                                    <option value="major">Major</option>
                                </Select>
                            </FieldLabel>
                        )}
                    </div>
                    <FieldLabel label="Release notes">
                        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="What changed" className={`${field} h-auto py-2`} />
                    </FieldLabel>
                </div>
            )}
            <ErrorText>{error ?? libs.error}</ErrorText>
        </Dialog>
    );
}

// A package box with token swatches spilling out of it.
function RegistryArt() {
    // A white disc with a faint orbit: the package in the middle, tokens (type, colour, code,
    // components) circling it.
    const sat = (x: number, y: number, glyph: React.ReactNode) => (
        <g transform={`translate(${x} ${y})`}>
            <circle r="16" fill="white" filter="url(#reg-sat)" />
            <g stroke="#0D99FF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
                {glyph}
            </g>
        </g>
    );
    return (
        <svg width="212" height="212" viewBox="-2 -2 212 212" fill="none" aria-hidden>
            <defs>
                <filter id="reg-sat" x="-50%" y="-50%" width="200%" height="200%">
                    <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000" floodOpacity="0.18" />
                </filter>
            </defs>
            <circle cx="104" cy="104" r="104" fill="white" />
            <circle cx="104" cy="104" r="68" stroke="#EDEDED" strokeWidth="1.5" />
            <circle cx="104" cy="104" r="25" fill="white" filter="url(#reg-sat)" />
            <path d="M104 92v24M92 104h24" stroke="#333" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M98 98c3 3 9 3 12 0M98 110c3-3 9-3 12 0" stroke="#333" strokeWidth="1.5" strokeLinecap="round" transform="rotate(45 104 104)" />
            {sat(161, 17, <path d="M0-6l5.2 3v6L0 6l-5.2-3v-6ZM0-2.2A2.2 2.2 0 1 1 0 2.2 2.2 2.2 0 0 1 0-2.2Z" />)}
            {sat(63, 51, <text x="-7" y="5" fontSize="13" fontFamily="Inter, system-ui, sans-serif" fill="#0D99FF" stroke="none">Aa</text>)}
            {sat(152, 151, <path d="M-2.5-4.5-6.5 0l4 4.5M2.5-4.5l4 4.5-4 4.5" />)}
            {sat(46, 186, <path d="M0-6.5 3 -3.5 0-.5-3-3.5ZM0 .5l3 3-3 3-3-3ZM-3.5-3l3 3-3 3-3-3ZM3.5-3l3 3-3 3-3-3Z" />)}
        </svg>
    );
}
