import { openSignIn, useAuth } from "../engine/auth";
import { ShareDialogContent } from "./share-dialog";
import { PresenceAvatars } from "./follow-ui";
import { useEffect, useRef, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Modal as AriaModal, ModalOverlay as AriaModalOverlay, Popover as AriaPopover } from "react-aria-components";
import { ChevronDown, Eye, Play, X } from "@untitledui/icons";
import { presentCurrent, previewCurrent } from "../hooks/use-shortcuts";
import { IconButton } from "./icon-button";
import { MenuRow } from "./left-sidebar";
import { closeGate, exitPreview, join, requestAccess, restoreVersion, setMyName, unlockLink, useCollab } from "../engine/collab";
import { editor } from "../engine/store";
import { AuthForm } from "./auth";
import { versionTitle, when } from "../engine/version-format";

export { Avatar } from "./avatar";

// Who's here: you and everyone else in the file (click to follow), plus the connection state.
export function PresenceBar({ chevron }: { chevron?: boolean } = {}) {
    return <PresenceAvatars chevron={chevron} />;
}

// Present ▷ with its options chevron: present the prototype, or preview it in a panel on the canvas.
export function PresentButton() {
    return (
        <div className="flex items-center">
            <IconButton icon={Play} label="Present" shortcut="⌥ ⌘ ↵" onPress={presentCurrent} />
            <AriaMenuTrigger>
                <AriaButton aria-label="Presentation options" className="flex h-8 w-4 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                    <ChevronDown className="size-3" />
                </AriaButton>
                <AriaPopover placement="bottom end" offset={4} className="w-48 rounded-[13px] bg-tooltip p-2 text-white shadow-xl outline-none">
                    <AriaMenu aria-label="Presentation options" className="outline-none" onAction={(k) => (k === "preview" ? previewCurrent() : presentCurrent())}>
                        <MenuRow id="present" label="Present" shortcut="⌥ ⌘ ↵" />
                        <MenuRow id="preview" label="Preview" shortcut="⇧ Space" />
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
        </div>
    );
}

// `size="lg"`: the design editor's 32pt Share (56 wide).
export function ShareButton({ label = "Share", className = "ml-1", size, tone }: { label?: string; className?: string; size?: "lg"; tone?: "dev" }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <AriaButton
                onPress={() => setOpen(true)}
                className={`${className} ${size === "lg" ? "h-8 min-w-14 rounded-[5px]" : "h-7 rounded-md"} ${tone === "dev" ? "bg-[#14AE5C] hover:!bg-[#109A50]" : "bg-brand-500"} px-3 text-[11px] font-semibold text-white outline-none hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1`}
            >
                {label}
            </AriaButton>
            <AriaModalOverlay
                isOpen={open}
                onOpenChange={setOpen}
                isDismissable
                className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[120px]"
            >
                <AriaModal className="w-[480px] max-w-[calc(100vw-32px)] text-ink outline-none">
                    <AriaDialog className="outline-none" aria-label="Share">
                        <ShareDialogContent stacked close={() => setOpen(false)} />
                    </AriaDialog>
                </AriaModal>
            </AriaModalOverlay>
        </>
    );
}

// A file that turned you away: enter its link password, or ask its owner for access.
function AccessGateDialog() {
    const gate = useCollab((s) => s.gate);
    const account = useAuth((s) => s.user);
    const [password, setPassword] = useState("");
    const [note, setNote] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // Signing in from the gate tries the file again (once per account).
    const retried = useRef<string | null>(null);
    useEffect(() => {
        if (!gate || !account || gate.signedIn || retried.current === `${gate.fileId}:${account.id}`) return;
        retried.current = `${gate.fileId}:${account.id}`;
        join(gate.fileId, undefined, gate.key);
    }, [account, gate]);
    if (!gate) return null;
    const home = () => {
        closeGate();
        editor.set({ homeOpen: true });
    };
    const title = gate.reason === "password" ? "This file is password protected" : gate.reason === "expired" ? "This link has expired" : gate.reason === "sign-in" ? "Sign in to share this file" : gate.requested ? "Request sent" : "You need access";
    const canAsk = gate.reason !== "password" && gate.reason !== "sign-in" && gate.signedIn;
    return (
        <AriaModalOverlay isOpen className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-32">
            <AriaModal className="w-[380px] rounded-xl border border-panel-border bg-panel-raised p-5 text-ink shadow-2xl outline-none">
                <AriaDialog className="space-y-3 outline-none" aria-label={title}>
                    <h2 className="text-[14px] font-semibold">{title}</h2>
                    {gate.reason === "password" && (
                        <form
                            className="space-y-3"
                            onSubmit={(e) => {
                                e.preventDefault();
                                setBusy(true);
                                void unlockLink(password).then((err) => {
                                    setBusy(false);
                                    setError(err);
                                });
                            }}
                        >
                            <p className="text-[12px] text-ink-muted">Enter the password the file's owner gave you.</p>
                            <input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" autoComplete="current-password" className="h-9 w-full rounded-md border border-panel-border bg-field px-3 text-[12px] outline-none focus:border-brand-500" />
                            <button type="submit" disabled={busy || !password} className="h-9 w-full rounded-md bg-brand-500 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                                Continue
                            </button>
                        </form>
                    )}
                    {gate.reason === "expired" && <p className="text-[12px] text-ink-muted">{gate.signedIn ? "Ask the owner for access, or for a new link." : "Ask the file's owner for a new link, or sign in to ask for access."}</p>}
                    {gate.reason === "no-access" && !gate.requested && <p className="text-[12px] text-ink-muted">{gate.signedIn ? "Ask the owner for access. They get a notification and an email." : "Sign in with the account the file was shared with, or sign in to ask for access."}</p>}
                    {gate.requested && <p className="text-[12px] text-ink-muted">The owner gets a notification. You'll get one when they answer.</p>}
                    {gate.reason === "sign-in" && <p className="text-[12px] text-ink-muted">Files on this server have owners. Sign in to move this one to the server.</p>}
                    {!gate.signedIn && !account && gate.reason !== "password" && <AuthForm compact />}
                    {canAsk && !gate.requested && (
                        <form
                            className="space-y-2"
                            onSubmit={(e) => {
                                e.preventDefault();
                                setBusy(true);
                                void requestAccess(gate.fileId, "view", note.trim()).then((err) => {
                                    setBusy(false);
                                    setError(err);
                                });
                            }}
                        >
                            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add a note (optional)" aria-label="Note to the owner" className="w-full resize-none rounded-md border border-panel-border bg-field p-2 text-[12px] outline-none focus:border-brand-500" />
                            <button type="submit" disabled={busy} className="h-9 w-full rounded-md bg-brand-500 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                                Request access
                            </button>
                        </form>
                    )}
                    {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</p>}
                    <button type="button" onClick={home} className="h-8 w-full rounded-md text-[12px] text-ink-muted hover:bg-panel-hover">
                        Go to Home
                    </button>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

// People who open a shared link pick a name first, so others know whose cursor is whose.
export function NamePrompt() {
    return (
        <>
            <AccessGateDialog />
            <NameDialog />
        </>
    );
}

function NameDialog() {
    const status = useCollab((s) => s.status);
    const me = useCollab((s) => s.me);
    const [name, setName] = useState("");
    const account = useAuth((s) => s.user);
    const open = status !== "local" && !me.name && !account;
    return (
        <AriaModalOverlay isOpen={open} className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-32">
            <AriaModal className="w-[360px] rounded-xl border border-panel-border bg-panel-raised p-5 text-ink shadow-2xl outline-none">
                <AriaDialog className="space-y-3 outline-none" aria-label="Your name">
                    <h2 className="text-[14px] font-semibold">Join this file</h2>
                    <p className="text-[12px] text-ink-muted">Your name shows next to your cursor and on your comments.</p>
                    <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            setMyName(name);
                        }}
                    >
                        <input
                            autoFocus
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Your name"
                            className="h-9 min-w-0 flex-1 rounded-md border border-panel-border bg-field px-3 text-[12px] outline-none focus:border-brand-500"
                        />
                        <button type="submit" className="h-9 rounded-md bg-brand-500 px-4 text-[12px] font-semibold text-white hover:bg-brand-600">
                            Join
                        </button>
                    </form>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

// Explains a version preview at the top of the canvas (view access has ViewOnlyBanner above the toolbar).
export function ModeBanner() {
    const previewing = useCollab((s) => s.previewing);
    const versions = useCollab((s) => s.versions);
    const role = useCollab((s) => s.role);
    if (previewing) {
        const meta = versions.find((v) => v.id === previewing.id);
        const label = meta ? (meta.name ?? `${versionTitle(meta)}, ${when(meta.createdAt)}`) : "Past version";
        return (
            <div className="pointer-events-auto absolute inset-x-0 top-6 z-10 flex justify-center">
                <div className="flex items-center gap-3 rounded-lg bg-tooltip py-1.5 pr-1.5 pl-3 text-[12px] text-white shadow-lg">
                    <span>
                        Viewing <b>{label}</b>
                    </span>
                    {role === "edit" && (
                        <button type="button" onClick={() => restoreVersion()} className="h-7 rounded-md bg-brand-500 px-3 font-semibold hover:bg-brand-600">
                            Restore this version
                        </button>
                    )}
                    <button type="button" onClick={exitPreview} className="h-7 rounded-md bg-white/10 px-3 hover:bg-white/20">
                        Edit current version
                    </button>
                </div>
            </div>
        );
    }
    return null;
}

// View access: a 40pt banner the width of the toolbar, just above it, with Ask to edit and a close
// button (closed for this file until it's opened again). Comments still work (C).
export function ViewOnlyBanner() {
    const role = useCollab((s) => s.role);
    const status = useCollab((s) => s.status);
    const fileId = useCollab((s) => s.fileId);
    const previewing = useCollab((s) => s.previewing);
    const account = useAuth((s) => s.user);
    const [closed, setClosed] = useState<string | null>(null);
    const [asked, setAsked] = useState<string | null>(null);
    if (!(role === "view" || role === "prototype") || status === "local" || previewing || !fileId || closed === fileId) return null;
    const ask = () => {
        if (!account) return openSignIn();
        void requestAccess(fileId, "edit").then((error) => (error ? editor.notify(error) : (setAsked(fileId), editor.notify("Edit access requested. The owner gets a notification."))));
    };
    return (
        <div role="status" className="pointer-events-auto mb-[4px] flex h-10 min-w-0 items-center gap-[12px] self-stretch rounded-[13px] bg-brand-100 pr-[8px] pl-[12px] text-[13px] text-link shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
            <Eye className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">You can only view and comment on this file.</span>
            {asked === fileId ? (
                <span className="shrink-0 text-[11px]">Edit access requested</span>
            ) : (
                <AriaButton onPress={ask} className="flex h-6 w-[73px] shrink-0 items-center justify-center rounded-[5px] bg-brand-500 text-[11px] font-medium text-white outline-none hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-white">
                    Ask to edit
                </AriaButton>
            )}
            <AriaButton aria-label="Close" onPress={() => setClosed(fileId)} className="-ml-[4px] flex size-6 shrink-0 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand-500">
                <X className="size-4" />
            </AriaButton>
        </div>
    );
}
