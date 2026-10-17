import { Trash01, X } from "@untitledui/icons";
import { useEffect, useState, type ReactNode } from "react";
import { Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { editor, useEditor } from "../engine/store";
import { hasConnectorToken, setConnectorToken } from "./generate";
import { makeData, updateMake } from "./model";
import { hasGitHubToken, listLibrary, publishToLibrary, pushToGitHub, removeLibraryItem, setBackend, setGitHubToken, startFromLibraryItem, type LibraryItem } from "./publish";
import { make, useMake } from "./state";

// Make's dialogs: GitHub (create a repository or push to one), Settings (the model, web search,
// MCP connectors, the backend) and Kits and templates (publish this file as one, or start from one).

const INPUT = "h-8 w-full min-w-0 rounded-md border border-panel-border bg-field px-2 text-[12px] text-ink outline-none focus:border-brand-500";
const PRIMARY = "h-8 rounded-md bg-brand-500 px-3 text-[12px] font-semibold text-white disabled:opacity-50";
const SECONDARY = "h-8 rounded-md border border-panel-border px-3 text-[12px] text-ink hover:bg-panel-hover disabled:opacity-50";

function Shell({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
    return (
        <AriaModalOverlay isOpen isDismissable onOpenChange={(open) => !open && make.set({ dialog: null })} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <AriaModal className="w-[480px] max-w-[94vw] rounded-xl border border-panel-border bg-panel text-[12px] text-ink shadow-2xl outline-none">
                <AriaDialog aria-label={title} className="outline-none">
                    <header className="flex h-12 items-center border-b border-panel-border px-4">
                        <h2 className="flex-1 text-[13px] font-semibold">{title}</h2>
                        <button type="button" aria-label="Close" onClick={() => make.set({ dialog: null })} className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                            <X className="size-4" />
                        </button>
                    </header>
                    <div className="max-h-[70vh] space-y-3 overflow-y-auto p-4">{children}</div>
                    {footer && <footer className="flex items-center justify-end gap-2 border-t border-panel-border px-4 py-3">{footer}</footer>}
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

function GitHubDialog() {
    const last = useEditor((s) => makeData(s.doc).github ?? null);
    const name = useEditor((s) => s.doc.name);
    const serverToken = useMake((s) => Boolean(s.ai?.github));
    const [repo, setRepo] = useState(last?.repo ?? (name || "my-app").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, ""));
    const [create, setCreate] = useState(!last);
    const [priv, setPriv] = useState(true);
    const [message, setMessage] = useState("Update from Make");
    const [token, setToken] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<{ repo: string; url: string } | null>(null);
    const needsToken = !serverToken && !hasGitHubToken();
    const push = () => {
        if (token.trim()) setGitHubToken(token);
        setBusy(true);
        setError(null);
        void pushToGitHub(repo.trim(), { create, private: priv, message })
            .then((r) => setDone(r))
            .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => setBusy(false));
    };
    return (
        <Shell
            title="Push to GitHub"
            footer={
                <>
                    <button type="button" className={SECONDARY} onClick={() => make.set({ dialog: null })}>
                        Close
                    </button>
                    <button type="button" className={PRIMARY} disabled={busy || !repo.trim() || (needsToken && !token.trim())} onClick={push}>
                        {busy ? "Pushing…" : create ? "Create repository and push" : "Push"}
                    </button>
                </>
            }
        >
            <p className="leading-relaxed text-ink-muted">Every file of the project goes into one commit on the repository's default branch.</p>
            <label className="block space-y-1">
                <span className="font-medium">Repository</span>
                <input aria-label="Repository" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="my-app or owner/my-app" className={`${INPUT} font-mono`} />
            </label>
            <div className="flex gap-4">
                <label className="flex items-center gap-1.5">
                    <input type="radio" checked={create} onChange={() => setCreate(true)} /> Create a new repository
                </label>
                <label className="flex items-center gap-1.5">
                    <input type="radio" checked={!create} onChange={() => setCreate(false)} /> Push to an existing one
                </label>
            </div>
            {create && (
                <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Private
                </label>
            )}
            <label className="block space-y-1">
                <span className="font-medium">Commit message</span>
                <input aria-label="Commit message" value={message} onChange={(e) => setMessage(e.target.value)} className={INPUT} />
            </label>
            {!serverToken && (
                <label className="block space-y-1">
                    <span className="font-medium">GitHub token</span>
                    <input type="password" aria-label="GitHub token" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={hasGitHubToken() ? "Using the token you added this session" : "A token with repository access"} className={`${INPUT} font-mono`} />
                    <span className="block text-[11px] leading-relaxed text-ink-muted">Kept only while this tab is open and sent only to GitHub, through your server.</span>
                </label>
            )}
            {last && !done && (
                <p className="text-ink-muted">
                    Last pushed to{" "}
                    <a href={last.url} target="_blank" rel="noreferrer" className="text-brand-500 hover:underline">
                        {last.repo}
                    </a>{" "}
                    {new Date(last.at).toLocaleString()}.
                </p>
            )}
            {done && (
                <p className="rounded-md bg-emerald-500/12 p-2" role="status">
                    Pushed to{" "}
                    <a href={done.url} target="_blank" rel="noreferrer" className="font-semibold text-brand-500 hover:underline">
                        {done.repo}
                    </a>
                    .
                </p>
            )}
            {error && <p className="rounded-md bg-red-500/12 p-2 text-red-600">{error}</p>}
        </Shell>
    );
}

function SettingsDialog() {
    const data = useEditor((s) => makeData(s.doc));
    const ai = useMake((s) => s.ai);
    const [name, setName] = useState("");
    const [url, setUrl] = useState("");
    const [token, setToken] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [, bump] = useState(0);
    const connectors = data.connectors ?? [];
    const addConnector = () => {
        const clean = name.trim().replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 40);
        if (!clean || !/^https:\/\//.test(url.trim())) return setError("Give the connector a name and an https address.");
        if (connectors.some((c) => c.name === clean)) return setError("A connector already has that name.");
        updateMake((d) => ({ ...d, connectors: [...(d.connectors ?? []), { name: clean, url: url.trim() }] }));
        if (token.trim()) setConnectorToken(clean, token.trim());
        setName("");
        setUrl("");
        setToken("");
        setError(null);
    };
    return (
        <Shell title="Make settings" footer={<button type="button" className={PRIMARY} onClick={() => make.set({ dialog: null })}>Done</button>}>
            <section className="space-y-1.5">
                <h3 className="font-semibold">Model</h3>
                <select aria-label="Model" value={data.model ?? ""} disabled={!ai?.models?.length} onChange={(e) => updateMake((d) => ({ ...d, model: e.target.value || null }))} className={INPUT}>
                    <option value="">Default{ai?.model ? ` (${ai.models?.find((m) => m.id === ai.model)?.label ?? ai.model})` : ""}</option>
                    {(ai?.models ?? []).map((m) => (
                        <option key={m.id} value={m.id}>
                            {m.label}
                        </option>
                    ))}
                </select>
            </section>
            <section className="space-y-1.5">
                <h3 className="font-semibold">Web</h3>
                <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={Boolean(data.web)} onChange={(e) => updateMake((d) => ({ ...d, web: e.target.checked }))} /> Let the model search the web and read pages you link to
                </label>
            </section>
            <section className="space-y-1.5">
                <h3 className="font-semibold">Backend</h3>
                <label className="flex items-center gap-1.5">
                    <input
                        type="checkbox"
                        checked={Boolean(data.backend)}
                        onChange={(e) =>
                            void setBackend(e.target.checked)
                                .then(() => setError(null))
                                .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
                        }
                    />{" "}
                    Store data on the server (adds src/lib/backend.ts)
                </label>
                <p className="text-[11px] leading-relaxed text-ink-muted">The app keeps lists, posts and sign-ups between visits, for everyone who uses it. Up to 2 MB.</p>
            </section>
            <section className="space-y-1.5">
                <h3 className="font-semibold">MCP connectors</h3>
                {connectors.map((c) => (
                    <div key={c.name} className="flex items-center gap-2 rounded-md border border-panel-border px-2 py-1.5">
                        <span className="font-medium">{c.name}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-muted">{c.url}</span>
                        <span className="text-[11px] text-ink-subtle">{hasConnectorToken(c.name) ? "Token added" : "No token"}</span>
                        <button
                            type="button"
                            aria-label={`Remove ${c.name}`}
                            onClick={() => {
                                setConnectorToken(c.name, "");
                                updateMake((d) => ({ ...d, connectors: (d.connectors ?? []).filter((x) => x.name !== c.name) }));
                                bump((n) => n + 1);
                            }}
                            className="flex size-6 items-center justify-center rounded text-ink-subtle hover:text-red-500"
                        >
                            <Trash01 className="size-3.5" />
                        </button>
                    </div>
                ))}
                <div className="grid grid-cols-2 gap-1.5">
                    <input aria-label="Connector name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={INPUT} />
                    <input aria-label="Connector address" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/mcp" className={`${INPUT} font-mono`} />
                    <input type="password" aria-label="Connector token" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token (optional)" className={`${INPUT} col-span-2 font-mono`} />
                </div>
                <button type="button" className={SECONDARY} onClick={addConnector}>
                    Add connector
                </button>
                <p className="text-[11px] leading-relaxed text-ink-muted">The model can use the connector's tools while it builds. Tokens stay in this tab's memory.</p>
            </section>
            {error && <p className="rounded-md bg-red-500/12 p-2 text-red-600">{error}</p>}
        </Shell>
    );
}

function LibraryDialog() {
    const docName = useEditor((s) => s.doc.name);
    const current = useEditor((s) => makeData(s.doc).libraryItem ?? null);
    const readOnly = useEditor((s) => s.readOnly);
    const [items, setItems] = useState<LibraryItem[] | null>(null);
    const [kind, setKind] = useState<"kit" | "template">(current?.kind ?? "kit");
    const [name, setName] = useState(docName || "");
    const [description, setDescription] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const refresh = () => void listLibrary().then(setItems);
    useEffect(refresh, []);
    const run = (task: () => Promise<unknown>, after?: () => void) => {
        setBusy(true);
        setError(null);
        void task()
            .then(() => {
                refresh();
                after?.();
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => setBusy(false));
    };
    return (
        <Shell title="Kits and templates">
            <section className="space-y-1.5">
                <h3 className="font-semibold">Start from one</h3>
                {items === null && <p className="text-ink-muted">Loading…</p>}
                {items?.length === 0 && <p className="text-ink-muted">Nothing published on this server yet.</p>}
                {items?.map((i) => (
                    <div key={i.id} className="flex items-center gap-2 rounded-md border border-panel-border px-2 py-1.5">
                        <span className="rounded bg-field px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-muted">{i.kind}</span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{i.name}</span>
                            <span className="block truncate text-[11px] text-ink-muted">{i.description || `${i.files} files`} · {i.by}</span>
                        </span>
                        {!readOnly && (
                            <button type="button" className={SECONDARY} disabled={busy} onClick={() => run(() => startFromLibraryItem(i.id), () => make.set({ dialog: null }))}>
                                {i.kind === "kit" ? "Add" : "Use"}
                            </button>
                        )}
                        {i.mine && (
                            <button type="button" aria-label={`Remove ${i.name}`} disabled={busy} onClick={() => run(() => removeLibraryItem(i.id))} className="flex size-7 items-center justify-center rounded text-ink-subtle hover:text-red-500">
                                <Trash01 className="size-3.5" />
                            </button>
                        )}
                    </div>
                ))}
            </section>
            {!readOnly && (
                <section className="space-y-1.5 border-t border-panel-border pt-3">
                    <h3 className="font-semibold">{current ? "Update what this file published" : "Publish this file"}</h3>
                    <div className="flex gap-4">
                        <label className="flex items-center gap-1.5">
                            <input type="radio" checked={kind === "kit"} onChange={() => setKind("kit")} /> Kit: components, styles and guidelines
                        </label>
                        <label className="flex items-center gap-1.5">
                            <input type="radio" checked={kind === "template"} onChange={() => setKind("template")} /> Template: the whole app
                        </label>
                    </div>
                    <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={INPUT} />
                    <input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it's for" className={INPUT} />
                    <button type="button" className={PRIMARY} disabled={busy || !name.trim()} onClick={() => run(() => publishToLibrary(kind, name.trim(), description.trim()), () => editor.notify(kind === "kit" ? "Kit published." : "Template published."))}>
                        {current?.kind === kind ? "Update" : "Publish"}
                    </button>
                </section>
            )}
            {error && <p className="rounded-md bg-red-500/12 p-2 text-red-600">{error}</p>}
        </Shell>
    );
}

export function MakeDialogs() {
    const dialog = useMake((s) => s.dialog);
    if (dialog === "github") return <GitHubDialog />;
    if (dialog === "settings") return <SettingsDialog />;
    if (dialog === "library") return <LibraryDialog />;
    return null;
}
