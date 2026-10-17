import { X } from "@untitledui/icons";
import { useEffect, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { CODE_LANGS } from "../engine/dev-code";
import { ACCESS_LABELS, type InspectAccess, type IntegrationsChange, type TeamIntegrations, getTeamIntegrations, updateTeamIntegrations } from "../engine/inspect-settings";
import { usePlugins } from "../engine/plugins";
import type { Team } from "../engine/teams";
import { Select } from "./select";

// A team's integrations and Inspect settings (opened from the team dialog). Admins connect Slack or
// Teams channels through incoming webhooks for Inspect status notices, and decide who may use
// Inspect, the code language it starts with, and which plugins may run there. Members can look.
export function TeamIntegrationsDialog({ team, onClose }: { team: Team; onClose: () => void }) {
    const [data, setData] = useState<TeamIntegrations | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [service, setService] = useState<"slack" | "teams">("slack");
    const [url, setUrl] = useState("");
    const [label, setLabel] = useState("");
    const [extra, setExtra] = useState("");
    const plugins = usePlugins((s) => s.plugins);
    useEffect(() => {
        void getTeamIntegrations(team.id).then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, [team.id]);
    const admin = Boolean(data?.admin);
    const change = async (body: IntegrationsChange, done?: string) => {
        setError(null);
        setNote(null);
        try {
            setData(await updateTeamIntegrations(team.id, body));
            if (done) setNote(done);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };
    const allow = data?.inspect.pluginAllowlist ?? null;
    const setAllow = (list: string[] | null) => void change({ inspect: { pluginAllowlist: list } });
    const field = "h-8 rounded-md border border-panel-border bg-field px-2 text-[12px] text-ink outline-none focus:border-brand-500 disabled:opacity-60";

    return (
        <AriaModalOverlay isOpen onOpenChange={(o) => !o && onClose()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-16">
            <AriaModal className="max-h-[80vh] w-[480px] overflow-y-auto rounded-xl border border-panel-border bg-panel-raised p-5 text-ink shadow-2xl outline-none">
                <AriaDialog className="space-y-5 outline-none" aria-label="Integrations and Inspect">
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-[14px] font-semibold">Integrations and Inspect</h2>
                            <p className="mt-1 text-[12px] text-ink-muted">{team.name}: {admin ? "these apply to every file in the team." : "only team admins can change these."}</p>
                        </div>
                        <AriaButton aria-label="Close" onPress={onClose} className="rounded p-1 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <X className="size-4" />
                        </AriaButton>
                    </div>
                    {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div>}
                    {note && <div className="rounded-md bg-brand-500/10 px-3 py-2 text-[11px] text-ink">{note}</div>}
                    {!data ? (
                        !error && <p className="text-[12px] text-ink-muted">Loading…</p>
                    ) : (
                        <>
                            <section className="space-y-2" aria-label="Status notifications">
                                <h3 className="text-[12px] font-semibold">Status notifications in Slack or Teams</h3>
                                <p className="text-[11px] text-ink-subtle">When someone marks a design ready for dev or completed with "Notify via Slack or Teams", a message goes to these channels. Create an incoming webhook in Slack or Teams and paste its address here; it is kept on the server and not shown again.</p>
                                {data.hooks.length === 0 && <p className="text-[11px] text-ink-muted">No channels connected.</p>}
                                {data.hooks.map((h) => (
                                    <div key={h.id} className="flex items-center gap-2 text-[12px]">
                                        <span className="w-12 text-[11px] text-ink-muted">{h.service === "teams" ? "Teams" : "Slack"}</span>
                                        <span className="min-w-0 flex-1 truncate">
                                            {h.label} <span className="text-ink-subtle">{h.host} …{h.hint}</span>
                                        </span>
                                        {admin && (
                                            <>
                                                <button type="button" onClick={() => void change({ testHook: h.id }, "Test message sent.")} className="h-7 rounded-md border border-panel-border px-2 text-[11px] hover:bg-panel-hover">
                                                    Test
                                                </button>
                                                <button type="button" onClick={() => void change({ removeHook: h.id })} className="h-7 rounded-md px-1.5 text-[11px] text-red-400 hover:bg-panel-hover">
                                                    Remove
                                                </button>
                                            </>
                                        )}
                                    </div>
                                ))}
                                {admin && (
                                    <form
                                        className="flex flex-wrap gap-2"
                                        onSubmit={(e) => {
                                            e.preventDefault();
                                            if (!url.trim()) return;
                                            void change({ addHook: { service, url: url.trim(), label: label.trim() } }, "Channel connected.").then(() => (setUrl(""), setLabel("")));
                                        }}
                                    >
                                        <Select aria-label="Service" value={service} onChange={(e) => setService(e.target.value as "slack" | "teams")} className={field}>
                                            <option value="slack">Slack</option>
                                            <option value="teams">Teams</option>
                                        </Select>
                                        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Channel name" aria-label="Channel name" className={`${field} w-32`} />
                                        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Incoming webhook address" aria-label="Incoming webhook address" className={`${field} min-w-0 flex-1`} />
                                        <button type="submit" disabled={!url.trim()} className="h-8 rounded-md bg-brand-500 px-3 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                                            Connect
                                        </button>
                                    </form>
                                )}
                            </section>
                            <section className="space-y-3 border-t border-panel-border pt-4" aria-label="Inspect settings">
                                <h3 className="text-[12px] font-semibold">Inspect</h3>
                                <label className="flex items-center justify-between gap-3 text-[12px]">
                                    <span>Who can use Inspect</span>
                                    <Select aria-label="Who can use Inspect" disabled={!admin} value={data.inspect.access} onChange={(e) => void change({ inspect: { access: e.target.value as InspectAccess } })} className={field}>
                                        {(Object.keys(ACCESS_LABELS) as InspectAccess[]).map((a) => (
                                            <option key={a} value={a}>
                                                {ACCESS_LABELS[a]}
                                            </option>
                                        ))}
                                    </Select>
                                </label>
                                <label className="flex items-center justify-between gap-3 text-[12px]">
                                    <span>Default code language</span>
                                    <Select aria-label="Default code language" disabled={!admin} value={data.inspect.defaultLanguage} onChange={(e) => void change({ inspect: { defaultLanguage: e.target.value } })} className={field}>
                                        {CODE_LANGS.map((l) => (
                                            <option key={l.id} value={l.id}>
                                                {l.platform}: {l.label}
                                            </option>
                                        ))}
                                    </Select>
                                </label>
                                <div className="space-y-1.5 text-[12px]">
                                    <label className="flex items-center gap-2">
                                        <input type="checkbox" disabled={!admin} checked={allow !== null} onChange={(e) => setAllow(e.target.checked ? plugins.map((p) => p.id) : null)} className="accent-brand-500" />
                                        <span>Only allow chosen plugins in Inspect</span>
                                    </label>
                                    {allow !== null && (
                                        <div className="space-y-1 pl-5">
                                            {[...new Set([...plugins.map((p) => p.id), ...allow])].map((id) => {
                                                const plugin = plugins.find((p) => p.id === id);
                                                return (
                                                    <label key={id} className="flex items-center gap-2 text-[11px]">
                                                        <input type="checkbox" disabled={!admin} checked={allow.includes(id)} onChange={(e) => setAllow(e.target.checked ? [...allow, id] : allow.filter((x) => x !== id))} className="accent-brand-500" />
                                                        <span>{plugin?.manifest.name ?? id}</span>
                                                        <span className="text-ink-subtle">{id}</span>
                                                    </label>
                                                );
                                            })}
                                            {admin && (
                                                <form
                                                    className="flex gap-2 pt-1"
                                                    onSubmit={(e) => {
                                                        e.preventDefault();
                                                        if (extra.trim()) setAllow([...allow.filter((x) => x !== extra.trim()), extra.trim()]);
                                                        setExtra("");
                                                    }}
                                                >
                                                    <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Plugin id" aria-label="Allow a plugin by id" className={`${field} h-7 min-w-0 flex-1 text-[11px]`} />
                                                    <button type="submit" className="h-7 rounded-md border border-panel-border px-2 text-[11px] hover:bg-panel-hover">
                                                        Allow
                                                    </button>
                                                </form>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </section>
                        </>
                    )}
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}
