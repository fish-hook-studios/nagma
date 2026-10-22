import { X } from "@untitledui/icons";
import { useEffect, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { changePassword, closeSignIn, confirmSignUp, isPendingSignUp, listSessions, requestReset, resendSignUpCode, resetPassword, setChatWebhook, setEmailDigests, signIn, signOutOtherSessions, signUp, ssoInfo, startSso, useAuth } from "../engine/auth";
import { acceptInvite, lookupInvite } from "../engine/teams";
import { editor } from "../engine/store";
import { currentServerLabel, openServerPicker } from "../engine/servers";
import { pendingShareHere } from "../engine/share-hosted";

// Sign in or create an account on the sync server.
export function AuthModal() {
    const open = useAuth((s) => s.open);
    // Share through Nagma brought you here: the file moves once you're signed in (engine/share-hosted.ts).
    const pending = open ? pendingShareHere() : null;
    return (
        <AriaModalOverlay isOpen={open} onOpenChange={(o) => !o && closeSignIn()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
            <AriaModal className="w-[380px] rounded-xl border border-panel-border bg-panel-raised p-5 text-ink shadow-2xl outline-none">
                <AriaDialog className="outline-none" aria-label="Sign in">
                    <AuthForm onDone={closeSignIn} initialMode={pending ? "up" : "in"} intro={pending ? `Sign in or create a free account on ${pending.serverName} to share "${pending.name}". It moves here once you're in.` : undefined} />
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

export function AuthForm({ onDone, compact, intro, initialMode = "in" }: { onDone?: () => void; compact?: boolean; intro?: string; initialMode?: "in" | "up" }) {
    const [mode, setMode] = useState<"in" | "up" | "forgot" | "sso" | "code">(initialMode);
    const adding = useAuth((s) => s.adding);
    const [sent, setSent] = useState<{ mailConfigured: boolean; devMailFile: boolean } | null>(null);
    // Sign-up with a code: the address the code went to, the code typed, and how the code was delivered.
    const [code, setCode] = useState("");
    const [codeTo, setCodeTo] = useState<{ email: string; kept: boolean; mailConfigured: boolean } | null>(null);
    const [resendIn, setResendIn] = useState(0);
    useEffect(() => {
        if (!resendIn) return;
        const id = setTimeout(() => setResendIn((n) => n - 1), 1000);
        return () => clearTimeout(id);
    }, [resendIn]);
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [sso, setSso] = useState<{ enabled: boolean; name: string } | null>(null);
    useEffect(() => {
        void ssoInfo().then(setSso);
    }, []);
    const input = "h-9 w-full rounded-md border border-panel-border bg-field px-3 text-[12px] text-ink outline-none focus:border-brand-500";

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            if (mode === "forgot") {
                setSent(await requestReset(email.trim()));
                return;
            }
            if (mode === "sso") {
                await startSso(email.trim());
                return;
            }
            if (mode === "code") {
                await confirmSignUp(codeTo?.email ?? email.trim(), code);
            } else if (mode === "up") {
                const r = await signUp(name.trim(), email.trim(), password);
                if (isPendingSignUp(r)) {
                    // No account yet: the code from the mail makes it.
                    setCodeTo({ email: r.email, kept: r.verification.kept, mailConfigured: r.verification.mailConfigured });
                    setCode("");
                    setResendIn(60);
                    setMode("code");
                    return;
                }
            } else await signIn(email.trim(), password);
            onDone?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={(e) => void submit(e)} className="space-y-3" onKeyDown={(e) => e.stopPropagation()}>
            {!compact && (
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-[14px] font-semibold">{mode === "code" ? "Check your email" : mode === "up" ? "Create your account" : mode === "forgot" ? "Reset your password" : mode === "sso" ? "Sign in with SSO" : adding ? "Add an account" : "Sign in"}</h2>
                        {intro ? <p className="mt-1 text-[12px] text-ink">{intro}</p> : <p className="mt-1 text-[12px] text-ink-muted">Accounts live on your Nagma server. They own files and get invited to others.</p>}
                        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-muted">
                            <span className="min-w-0 truncate">
                                Server: <span className="font-medium text-ink">{currentServerLabel()}</span>
                            </span>
                            <button
                                type="button"
                                onClick={() => {
                                    onDone?.();
                                    openServerPicker();
                                }}
                                className="shrink-0 text-brand-500 hover:underline"
                            >
                                Change
                            </button>
                        </p>
                    </div>
                    {onDone && (
                        <AriaButton aria-label="Close" onPress={onDone} className="rounded p-1 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <X className="size-4" />
                        </AriaButton>
                    )}
                </div>
            )}
            {mode !== "forgot" && mode !== "sso" && mode !== "code" && sso?.enabled && (
                <>
                    <button type="button" onClick={() => (setMode("sso"), setError(null))} className="h-9 w-full rounded-md border border-panel-border text-[12px] font-medium hover:bg-panel-hover">
                        Sign in with SSO{sso.name ? ` (${sso.name})` : ""}
                    </button>
                    <div className="flex items-center gap-2 text-[11px] text-ink-subtle">
                        <span className="h-px flex-1 bg-panel-border" />
                        or
                        <span className="h-px flex-1 bg-panel-border" />
                    </div>
                </>
            )}
            {mode === "sso" && <p className="text-[12px] text-ink-muted">Enter your work email. Your organization's identity provider signs you in.</p>}
            {mode !== "forgot" && mode !== "sso" && mode !== "code" && (
                <div className="grid grid-cols-2 gap-0.5 rounded-md bg-field p-0.5">
                    {(["in", "up"] as const).map((m) => (
                        <button key={m} type="button" onClick={() => setMode(m)} className={`h-7 rounded text-[11px] font-medium ${mode === m ? "bg-panel text-ink shadow-sm" : "text-ink-subtle hover:text-ink"}`}>
                            {m === "in" ? "Sign in" : "Create account"}
                        </button>
                    ))}
                </div>
            )}
            {mode === "code" && codeTo ? (
                <>
                    <p className="rounded-md bg-field p-3 text-[12px] leading-relaxed text-ink-muted">
                        {codeTo.mailConfigured ? (
                            <>
                                We sent a six-digit code to <span className="font-medium text-ink">{codeTo.email}</span>. Enter it to finish creating your account. No account exists until you do.
                            </>
                        ) : codeTo.kept ? (
                            <>
                                Mail isn't set up on this server, so the code for <span className="font-medium text-ink">{codeTo.email}</span> was written to <code>data/email-links.txt</code> on the server.
                            </>
                        ) : (
                            "Mail isn't set up on this server, so the code couldn't be sent. Ask an admin of this Nagma server to set up mail."
                        )}
                    </p>
                    <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit code" aria-label="Code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required autoFocus className={`${input} text-center text-[16px] tracking-[.3em]`} />
                    {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div>}
                    <button type="submit" disabled={busy || code.length !== 6} className="h-9 w-full rounded-md bg-brand-500 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                        {busy ? "One moment…" : "Verify and create account"}
                    </button>
                </>
            ) : mode === "forgot" && sent ? (
                <p className="rounded-md bg-field p-3 text-[12px] leading-relaxed text-ink-muted">
                    {sent.mailConfigured ? (
                        "If there's an account for that email, we've sent it a reset link. It works for an hour."
                    ) : sent.devMailFile ? (
                        <>
                            Mail isn't set up on this server. If there's an account for that email, its reset link was written to <code>data/reset-links.txt</code> on the server; it works for an hour.
                        </>
                    ) : (
                        "Email isn't configured on this server, so reset links can't be sent. Ask an admin of this Nagma server to reset your password or set up mail."
                    )}
                </p>
            ) : (
                <>
                    {mode === "up" && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Name" autoComplete="name" required className={input} />}
                    <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Email" type="email" autoComplete="email" required className={input} />
                    {mode !== "forgot" && mode !== "sso" && (
                        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" aria-label="Password" type="password" autoComplete={mode === "up" ? "new-password" : "current-password"} minLength={8} required className={input} />
                    )}
                    {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div>}
                    <button type="submit" disabled={busy} className="h-9 w-full rounded-md bg-brand-500 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                        {busy ? "One moment…" : mode === "up" ? "Create account" : mode === "forgot" ? "Send reset link" : mode === "sso" ? "Continue" : "Sign in"}
                    </button>
                </>
            )}
            <div className="flex justify-between text-[11px]">
                {mode === "code" ? (
                    <>
                        <button type="button" onClick={() => { setMode("up"); setCodeTo(null); setError(null); }} className="text-ink-muted hover:text-ink hover:underline">
                            Wrong email? Go back
                        </button>
                        <button
                            type="button"
                            disabled={resendIn > 0 || busy}
                            onClick={() => {
                                setError(null);
                                void resendSignUpCode(codeTo?.email ?? email.trim())
                                    .then((v) => { setCodeTo((c) => (c ? { ...c, kept: v.kept, mailConfigured: v.mailConfigured } : c)); setResendIn(60); })
                                    .catch((err) => setError(err instanceof Error ? err.message : String(err)));
                            }}
                            className="text-ink-muted hover:text-ink hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-60"
                        >
                            {resendIn > 0 ? `Send a new code in ${resendIn}s` : "Send a new code"}
                        </button>
                    </>
                ) : mode === "forgot" || mode === "sso" ? (
                    <button type="button" onClick={() => { setMode("in"); setSent(null); setError(null); }} className="text-ink-muted hover:text-ink hover:underline">
                        Back to sign in
                    </button>
                ) : (
                    <button type="button" onClick={() => setMode("forgot")} className="text-ink-muted hover:text-ink hover:underline">
                        Forgot password?
                    </button>
                )}
            </div>
        </form>
    );
}

// Opened from a reset link (?reset=…): choose a new password, then you're signed in.
export function ResetPasswordModal({ token, onDone }: { token: string; onDone: () => void }) {
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const input = "h-9 w-full rounded-md border border-panel-border bg-field px-3 text-[12px] text-ink outline-none focus:border-brand-500";
    return (
        <AriaModalOverlay isOpen onOpenChange={(o) => !o && onDone()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
            <AriaModal className="w-[380px] rounded-xl border border-panel-border bg-panel-raised p-5 text-ink shadow-2xl outline-none">
                <AriaDialog className="outline-none" aria-label="Set a new password">
                    <form
                        className="space-y-3"
                        onKeyDown={(e) => e.stopPropagation()}
                        onSubmit={async (e) => {
                            e.preventDefault();
                            setBusy(true);
                            setError(null);
                            try {
                                await resetPassword(token, password);
                                onDone();
                            } catch (err) {
                                setError(err instanceof Error ? err.message : String(err));
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        <h2 className="text-[14px] font-semibold">Set a new password</h2>
                        <p className="text-[12px] text-ink-muted">Other sessions of your account are signed out when you do.</p>
                        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" aria-label="New password" type="password" autoComplete="new-password" minLength={8} required autoFocus className={input} />
                        {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div>}
                        <button type="submit" disabled={busy} className="h-9 w-full rounded-md bg-brand-500 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                            {busy ? "One moment…" : "Save password and sign in"}
                        </button>
                    </form>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

// Signed in: change the password with the current one.
export function ChangePasswordForm({ onDone }: { onDone: () => void }) {
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const input = "h-9 w-full rounded-md border border-panel-border bg-field px-3 text-[12px] text-ink outline-none focus:border-brand-500";
    return (
        <form
            className="space-y-3"
            onKeyDown={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                try {
                    await changePassword(current, next);
                    onDone();
                } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                } finally {
                    setBusy(false);
                }
            }}
        >
            <h2 className="text-[14px] font-semibold">Change password</h2>
            <input value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" aria-label="Current password" type="password" autoComplete="current-password" required className={input} />
            <input value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password" aria-label="New password" type="password" autoComplete="new-password" minLength={8} required className={input} />
            {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div>}
            <button type="submit" disabled={busy} className="h-9 w-full rounded-md bg-brand-500 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                {busy ? "One moment…" : "Save new password"}
            </button>
            <EmailPrefs />
        </form>
    );
}

// Comment notifications by email (a digest every 30 minutes of what you haven't read), and in Slack
// or Teams through an incoming webhook of your own; and the places this account is signed in.
function EmailPrefs() {
    const on = useAuth((s) => s.user?.prefs?.emailDigests !== false);
    const hooked = useAuth((s) => Boolean(s.user?.prefs?.chatWebhook));
    const [hook, setHook] = useState("");
    const [note, setNote] = useState<string | null>(null);
    const [sessions, setSessions] = useState<number | null>(null);
    useEffect(() => {
        void listSessions().then((l) => setSessions(l.length));
    }, []);
    return (
        <div className="space-y-3 border-t border-panel-border pt-3">
            <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" checked={on} onChange={(e) => void setEmailDigests(e.target.checked).catch(() => undefined)} className="mt-0.5 accent-brand-500" />
                <span>
                    <span className="block text-[12px]">Email me about comments</span>
                    <span className="block text-[11px] text-ink-subtle">A digest every 30 minutes of mentions and replies you haven't read.</span>
                </span>
            </label>
            <div className="space-y-1.5">
                <span className="block text-[12px]">Slack or Teams</span>
                {hooked ? (
                    <span className="flex items-center gap-2 text-[11px] text-ink-subtle">
                        <span className="flex-1">Digests also go to your webhook.</span>
                        <button type="button" onClick={() => void setChatWebhook("").then(() => setNote(null))} className="h-6 rounded px-2 hover:bg-panel-hover">
                            Turn off
                        </button>
                    </span>
                ) : (
                    <span className="flex gap-2">
                        <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="Incoming webhook address" aria-label="Slack or Teams incoming webhook" className="h-7 min-w-0 flex-1 rounded-md border border-panel-border bg-field px-2 text-[11px] outline-none focus:border-brand-500" />
                        <button type="button" disabled={!hook.trim()} onClick={() => void setChatWebhook(hook.trim()).then(() => (setHook(""), setNote("Digests will be posted there too.")), (err: unknown) => setNote(err instanceof Error ? err.message : String(err)))} className="h-7 rounded-md border border-panel-border px-2 text-[11px] hover:bg-panel-hover disabled:opacity-50">
                            Connect
                        </button>
                    </span>
                )}
                {note && <span className="block text-[11px] text-ink-muted">{note}</span>}
            </div>
            {sessions !== null && (
                <span className="flex items-center gap-2 text-[12px]">
                    <span className="flex-1">
                        Signed in on {sessions} {sessions === 1 ? "device" : "devices"}
                        <span className="block text-[11px] text-ink-subtle">Sessions end after 30 days without use.</span>
                    </span>
                    {sessions > 1 && (
                        <button type="button" onClick={() => void signOutOtherSessions().then(() => setSessions(1))} className="h-7 rounded-md border border-panel-border px-2 text-[11px] hover:bg-panel-hover">
                            Sign out of the others
                        </button>
                    )}
                </span>
            )}
        </div>
    );
}

// Opened from a team invite link (?invite=…): shows the team, then joins it once you're signed in.
export function InviteModal({ token, onDone }: { token: string; onDone: () => void }) {
    const user = useAuth((s) => s.user);
    const [info, setInfo] = useState<{ team: string; role: string; members: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        lookupInvite(token).then(setInfo).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, [token]);
    const join = async () => {
        setBusy(true);
        try {
            const team = await acceptInvite(token);
            editor.notify(`You're in ${team.name}.`);
            editor.set({ homeOpen: true });
            onDone();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <AriaModalOverlay isOpen onOpenChange={(o) => !o && onDone()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
            <AriaModal className="w-[400px] rounded-xl border border-panel-border bg-panel-raised p-5 text-ink shadow-2xl outline-none">
                <AriaDialog className="space-y-3 outline-none" aria-label="Team invite">
                    <h2 className="text-[14px] font-semibold">{info ? `Join ${info.team}` : "Team invite"}</h2>
                    {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div>}
                    {info && (
                        <p className="text-[12px] text-ink-muted">
                            You've been invited to join {info.team} ({info.members} {info.members === 1 ? "member" : "members"}) with {info.role === "view" ? "view" : "edit"} access.
                        </p>
                    )}
                    {info && !user && (
                        <>
                            <p className="text-[12px] text-ink-muted">Sign in or create an account to join.</p>
                            <AuthForm compact />
                        </>
                    )}
                    {info && user && (
                        <button type="button" disabled={busy} onClick={() => void join()} className="h-9 w-full rounded-md bg-brand-500 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                            {busy ? "Joining…" : `Join as ${user.name}`}
                        </button>
                    )}
                    {!info && !error && <p className="text-[12px] text-ink-muted">Checking the invite…</p>}
                    {error && (
                        <button type="button" onClick={onDone} className="text-[11px] text-ink-muted hover:underline">
                            Close
                        </button>
                    )}
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}
