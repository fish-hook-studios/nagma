import { Check, Globe02, Laptop01, Server01, X } from "@untitledui/icons";
import { useEffect, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { FILE_LINK_PARAMS, connectToServer } from "../engine/auth";
import { connectToHosted } from "../engine/share-hosted";
import { DOC_LINKS, openDoc } from "../engine/onboarding";
import { type ServerInfo, checkServer, closeServerPicker, currentServer, currentServerLabel, defaultOrigin, forgetServer, hostedServer, linkedServer, localServerLabel, openServerPicker, rememberServer, useServerPickerOpen, useServers } from "../engine/servers";

// Where this device's shared files, teams and sites live: This computer (the server the app came
// with), Nagma's hosted server (free, run by the project; engine/servers.ts hostedServer), or a Nagma
// server someone runs for their team (docs/self-hosting.md). Switching reloads the page for that
// server (engine/auth.ts connectToServer).

const hostOf = (origin: string) => {
    try {
        return new URL(origin).host;
    } catch {
        return origin;
    }
};

function connect(info: ServerInfo | null) {
    if (info) rememberServer(info);
    closeServerPicker();
    connectToServer(info ? info.origin : null);
}

export function ServerPicker() {
    const open = useServerPickerOpen();
    return (
        <AriaModalOverlay isOpen={open} onOpenChange={(o) => !o && closeServerPicker()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
            <AriaModal className="w-[420px] rounded-xl border border-panel-border bg-panel-raised p-5 text-ink shadow-2xl outline-none">
                <AriaDialog className="outline-none" aria-label="Server">
                    <ServerList />
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

function ServerList() {
    const { servers: known, current } = useServers();
    const [adding, setAdding] = useState(false);
    const [hostedBusy, setHostedBusy] = useState(false);
    const [hostedError, setHostedError] = useState<string | null>(null);
    // Not listed twice when this page came from the hosted server itself.
    const hosted = hostedServer()?.origin === defaultOrigin() ? null : hostedServer();
    // The hosted server has its own row; the rest are servers of your own (or your team's).
    const servers = known.filter((s) => s.origin !== hosted?.origin);
    const pickHosted = async () => {
        if (current === hosted?.origin) return closeServerPicker();
        setHostedBusy(true);
        setHostedError(null);
        const failed = await connectToHosted();
        setHostedBusy(false);
        setHostedError(failed);
    };
    const hint = "block text-[11px] leading-snug text-ink-muted";
    const row = "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500";
    return (
        <div className="space-y-3" onKeyDown={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-[14px] font-semibold">Server</h2>
                    <p className="mt-1 text-[12px] text-ink-muted">Shared files, teams and sites live on a Nagma server. Drafts stay on this device whichever you use.</p>
                </div>
                <AriaButton aria-label="Close" onPress={closeServerPicker} className="rounded p-1 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                    <X className="size-4" />
                </AriaButton>
            </div>
            <div className="-mx-1 space-y-0.5" role="list" aria-label="Servers">
                <div role="listitem">
                    <button type="button" className={row} onClick={() => (current === null ? closeServerPicker() : connect(null))}>
                        <Laptop01 className="size-4 shrink-0 text-ink-muted" />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-medium">{localServerLabel()}</span>
                            <span className={hint}>{localServerLabel() === "This computer" ? "Only you. Files stay on this computer." : `The server this page came from, ${hostOf(defaultOrigin())}.`}</span>
                        </span>
                        {current === null && <Check className="size-4 shrink-0 text-brand-500" aria-label="In use" />}
                    </button>
                </div>
                {hosted && (
                    <div role="listitem">
                        <button type="button" className={row} disabled={hostedBusy} onClick={() => void pickHosted()}>
                            <Globe02 className="size-4 shrink-0 text-ink-muted" />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12px] font-medium">
                                    {hosted.name} (hosted), free
                                </span>
                                <span className={hint}>{hostedBusy ? "Connecting…" : "Share and collaborate with anyone. Needs an account."}</span>
                            </span>
                            {current === hosted.origin && <Check className="size-4 shrink-0 text-brand-500" aria-label="In use" />}
                        </button>
                    </div>
                )}
                {servers.map((s) => (
                    <div key={s.origin} role="listitem" className="group flex items-center">
                        <button type="button" className={row} onClick={() => (current === s.origin ? closeServerPicker() : connect(s))}>
                            <Server01 className="size-4 shrink-0 text-ink-muted" />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12px] font-medium">{s.name}</span>
                                <span className="block truncate text-[11px] text-ink-subtle">
                                    {hostOf(s.origin)}
                                    {s.version ? ` · version ${s.version}` : ""}
                                </span>
                            </span>
                            {current === s.origin && <Check className="size-4 shrink-0 text-brand-500" aria-label="In use" />}
                        </button>
                        {current !== s.origin && (
                            <AriaButton aria-label={`Forget ${s.name}`} onPress={() => forgetServer(s.origin)} className="ml-1 rounded p-1 text-ink-subtle opacity-0 outline-none group-hover:opacity-100 hover:bg-panel-hover hover:text-ink focus-visible:opacity-100">
                                <X className="size-3.5" />
                            </AriaButton>
                        )}
                    </div>
                ))}
            </div>
            {hostedError && <div className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{hostedError}</div>}
            {adding ? (
                <AddServer onCancel={() => setAdding(false)} />
            ) : (
                <div>
                    <button type="button" onClick={() => setAdding(true)} className="h-9 w-full rounded-md border border-panel-border text-[12px] font-medium hover:bg-panel-hover">
                        Add your own server…
                    </button>
                    <p className="mt-1.5 text-[11px] leading-snug text-ink-muted">
                        Your own server: run it yourself, for you or your team.{" "}
                        <button type="button" onClick={() => openDoc(DOC_LINKS.selfHost)} className="font-medium text-link hover:underline">
                            Self-hosting guide
                        </button>
                    </p>
                </div>
            )}
            <p className="text-[11px] leading-relaxed text-ink-subtle">Switching signs you in to that server's accounts.</p>
        </div>
    );
}

function AddServer({ onCancel }: { onCancel: () => void }) {
    const [address, setAddress] = useState("");
    const [found, setFound] = useState<ServerInfo | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const input = "h-9 w-full rounded-md border border-panel-border bg-field px-3 text-[12px] text-ink outline-none focus:border-brand-500";

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (found) return connect(found);
        setBusy(true);
        setError(null);
        try {
            setFound(await checkServer(address));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={(e) => void submit(e)} className="space-y-2 rounded-lg border border-panel-border p-3">
            <label className="block text-[11px] font-medium text-ink-muted" htmlFor="server-address">
                Server address
            </label>
            <input
                id="server-address"
                value={address}
                onChange={(e) => {
                    setAddress(e.target.value);
                    setFound(null);
                    setError(null);
                }}
                placeholder="https://nagma.example.com"
                aria-describedby="server-address-hint"
                autoFocus
                autoComplete="url"
                spellCheck={false}
                className={input}
            />
            <p id="server-address-hint" className="text-[11px] leading-snug text-ink-muted">
                The address of a Nagma server someone runs, like https://nagma.example.com.{" "}
                <button type="button" onClick={() => openDoc(DOC_LINKS.connect)} className="font-medium text-link hover:underline">
                    Where do I get one?
                </button>
            </p>
            {found && (
                <div className="flex items-center gap-2 rounded-md bg-field px-3 py-2 text-[12px]">
                    <Check className="size-4 shrink-0 text-emerald-500" />
                    <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{found.name}</span>
                        <span className="text-ink-subtle">
                            {" "}
                            · {hostOf(found.origin)}
                            {found.version ? ` · version ${found.version}` : ""}
                        </span>
                    </span>
                </div>
            )}
            {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div>}
            <div className="flex justify-end gap-2">
                <button type="button" onClick={onCancel} className="h-8 rounded-md px-3 text-[12px] text-ink-muted hover:bg-panel-hover hover:text-ink">
                    Cancel
                </button>
                <button type="submit" disabled={busy || !address.trim()} className="h-8 rounded-md bg-brand-500 px-3 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                    {busy ? "Checking…" : found ? `Connect to ${found.name}` : "Check server"}
                </button>
            </div>
        </form>
    );
}

// Next to the account on Home: which server you're on. Opens the picker.
export function ServerBadge() {
    useServers();
    const label = currentServerLabel();
    return (
        <AriaButton
            onPress={openServerPicker}
            aria-label={`Server: ${label}. Change server`}
            className="flex h-[20px] max-w-[84px] min-w-[26px] shrink-[6] items-center gap-1 rounded-full border border-panel-border px-2 text-[10.5px] text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500"
        >
            <span className={`size-1.5 shrink-0 rounded-full ${currentServer() ? "bg-emerald-500" : "bg-ink-subtle"}`} />
            <span className="truncate">{label}</span>
        </AriaButton>
    );
}

// A link to a file on another server (?server=…): offers to switch to it. Staying drops the link's
// file, which isn't on this server.
export function ServerLinkPrompt() {
    const [target] = useState(() => linkedServer());
    // This computer's server needs no check.
    const [info, setInfo] = useState<ServerInfo | null>(() => (target && target === defaultOrigin() ? { origin: target, name: localServerLabel(), version: null } : null));
    const [failed, setFailed] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    useEffect(() => {
        if (!target || target === defaultOrigin()) return;
        checkServer(target).then(setInfo, (e: unknown) => setFailed(e instanceof Error ? e.message : String(e)));
    }, [target]);
    if (!target || done || (!info && !failed)) return null;
    const stay = () => {
        const url = new URL(location.href);
        for (const k of FILE_LINK_PARAMS) url.searchParams.delete(k);
        history.replaceState(null, "", url);
        setDone(true);
    };
    const switchTo = () => {
        setDone(true);
        if (info && info.origin !== defaultOrigin()) {
            rememberServer(info);
            connectToServer(info.origin, { keepLink: true });
        } else connectToServer(null, { keepLink: true });
    };
    return (
        <AriaModalOverlay isOpen onOpenChange={(o) => !o && stay()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
            <AriaModal className="w-[400px] rounded-xl border border-panel-border bg-panel-raised p-5 text-ink shadow-2xl outline-none">
                <AriaDialog className="space-y-3 outline-none" aria-label="Switch server">
                    {info ? (
                        <>
                            <h2 className="text-[14px] font-semibold">Open this link on {info.name}?</h2>
                            <p className="text-[12px] leading-relaxed text-ink-muted">
                                The file is on {info.origin === defaultOrigin() ? "this computer's server" : `the server at ${hostOf(info.origin)}`}. You're using {currentServerLabel()}. Switching signs you in to that server's accounts; your drafts stay on this device.
                            </p>
                            <div className="flex justify-end gap-2">
                                <button type="button" onClick={stay} className="h-8 rounded-md px-3 text-[12px] text-ink-muted hover:bg-panel-hover hover:text-ink">
                                    Stay on {currentServerLabel()}
                                </button>
                                <button type="button" autoFocus onClick={switchTo} className="h-8 rounded-md bg-brand-500 px-3 text-[12px] font-semibold text-white hover:bg-brand-600">
                                    Switch to {info.name}
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <h2 className="text-[14px] font-semibold">This link is for another server</h2>
                            <p className="text-[12px] leading-relaxed text-ink-muted">{failed}</p>
                            <div className="flex justify-end">
                                <button type="button" autoFocus onClick={stay} className="h-8 rounded-md bg-brand-500 px-3 text-[12px] font-semibold text-white hover:bg-brand-600">
                                    OK
                                </button>
                            </div>
                        </>
                    )}
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}
