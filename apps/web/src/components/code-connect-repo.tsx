import { X } from "@untitledui/icons";
import { useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { type Match, connectMatches, findCodeComponents, hasSessionToken, matchComponents, parseRepo, setSessionToken, withProps } from "../engine/code-connect-repo";
import { editor } from "../engine/store";

// Connect a repository: find the code components in a GitHub repository, match them to this file's
// components by name, review the snippets and connect them.
export function CodeConnectRepoDialog({ onClose }: { onClose: () => void }) {
    const [repo, setRepo] = useState("");
    const [token, setToken] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [found, setFound] = useState<{ files: number; matches: Match[] } | null>(null);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const field = "h-8 w-full rounded-md border border-panel-border bg-field px-2 text-[12px] text-ink outline-none focus:border-brand-500";
    const search = async () => {
        const ref = parseRepo(repo);
        if (!ref) return setError("Enter owner/repository or a github.com address.");
        if (token.trim()) setSessionToken(token);
        setBusy(true);
        setError(null);
        try {
            const code = await findCodeComponents(ref);
            const doc = editor.get().doc;
            const matches = await withProps(ref, doc, matchComponents(doc, code));
            setFound({ files: code.length, matches });
            setPicked(new Set(matches.map((m) => m.componentId)));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <AriaModalOverlay isOpen onOpenChange={(o) => !o && onClose()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-16">
            <AriaModal className="max-h-[80vh] w-[480px] overflow-y-auto rounded-xl border border-panel-border bg-panel-raised p-5 text-[12px] text-ink shadow-2xl outline-none">
                <AriaDialog className="space-y-4 outline-none" aria-label="Connect a repository">
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-[14px] font-semibold">Connect a repository</h2>
                            <p className="mt-1 text-ink-muted">Match this file's components to the components in a GitHub repository. Inspect then shows their code for every instance.</p>
                        </div>
                        <AriaButton aria-label="Close" onPress={onClose} className="rounded p-1 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <X className="size-4" />
                        </AriaButton>
                    </div>
                    <form
                        className="space-y-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void search();
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                    >
                        <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repository, or a github.com address with a folder" aria-label="Repository" className={field} />
                        <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" placeholder={hasSessionToken() ? "Token set for this session" : "GitHub token (optional, kept for this session only)"} aria-label="GitHub token" className={field} />
                        <p className="text-[11px] text-ink-subtle">Without a token, the server's own GitHub token is used if it has one.</p>
                        <button type="submit" disabled={busy || !repo.trim()} className="h-8 rounded-md bg-brand-500 px-3 font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                            {busy ? "Reading the repository…" : "Find components"}
                        </button>
                    </form>
                    {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div>}
                    {found && (
                        <div className="space-y-2 border-t border-panel-border pt-3">
                            <p className="text-ink-muted">
                                {found.files} code component{found.files === 1 ? "" : "s"} found, {found.matches.length} matching this file's components.
                            </p>
                            {found.matches.map((m) => (
                                <label key={m.componentId} className="flex items-start gap-2 rounded-md p-1.5 hover:bg-panel-hover">
                                    <input type="checkbox" checked={picked.has(m.componentId)} onChange={(e) => setPicked((s) => (e.target.checked ? new Set([...s, m.componentId]) : new Set([...s].filter((x) => x !== m.componentId))))} className="mt-0.5 accent-brand-500" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block font-medium">{m.componentName}</span>
                                        <span className="block truncate text-[11px] text-ink-subtle">{m.code.file}</span>
                                        <code className="mt-1 block truncate rounded bg-field px-1.5 py-1 font-mono text-[10.5px]">{m.snippet}</code>
                                    </span>
                                </label>
                            ))}
                            <div className="flex justify-end">
                                <button
                                    type="button"
                                    disabled={!picked.size}
                                    onClick={() => {
                                        connectMatches(found.matches.filter((m) => picked.has(m.componentId)));
                                        onClose();
                                    }}
                                    className="h-8 rounded-md bg-brand-500 px-3 font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                                >
                                    Connect {picked.size}
                                </button>
                            </div>
                        </div>
                    )}
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}
