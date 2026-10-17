import { useEffect, useState } from "react";
import { onVerifyNotice, resendVerification, setupHint, unverifiedAccounts, useAuth, verifyAccountAsAdmin } from "../engine/auth";
import { editor } from "../engine/store";
import { Button } from "./admin/admin-ui";

// Email verification in the app: the banner an unverified account sees (with Resend), and the list a
// server admin uses to verify accounts by hand when the server can't send mail.

onVerifyNotice((text) => editor.notify(text));

const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Shown under the tab bar until the account's email is verified (when the server requires it).
export function VerifyBanner() {
    const user = useAuth((s) => s.user);
    const [status, setStatus] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    if (!user || user.emailVerified !== false || !user.verifyRequired) return null;
    const resend = async () => {
        setBusy(true);
        try {
            const r = await resendVerification();
            setStatus(r.verified ? "Your email is verified." : r.sent ? `Sent. Check ${user.email}.` : r.kept ? setupHint("Kept in the server's data/email-links.txt (NAGMA_DEV_MAIL_FILE=1).", "Sent.") : "The mail couldn't be sent. Try again later.");
        } catch (e) {
            setStatus(err(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <div role="status" aria-label="Verify your email" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-panel-border bg-amber-500/10 px-4 py-1.5 text-[12px] text-ink">
            <span className="font-semibold">Verify your email</span>
            {user.mailReady ? (
                <span className="text-ink-muted">
                    Open the link we sent to {user.email} to invite people, share, publish and join teams. Your drafts work meanwhile.
                </span>
            ) : (
                <span className="text-ink-muted">Email isn't set up on this server, so an admin needs to verify your account before you can invite people, share, publish or join teams.</span>
            )}
            <span className="flex-1" />
            {status && <span className="text-ink-muted">{status}</span>}
            {user.mailReady && (
                <button type="button" disabled={busy} onClick={() => void resend()} className="font-medium text-link hover:underline disabled:opacity-50">
                    Resend
                </button>
            )}
        </div>
    );
}

// Settings › Account, for server admins: accounts still waiting to verify their email.
export function UnverifiedAccounts() {
    const admin = useAuth((s) => Boolean(s.user?.serverAdmin));
    const [list, setList] = useState<{ id: string; name: string; email: string }[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (admin) void unverifiedAccounts().then(setList);
    }, [admin]);
    if (!admin || !list?.length) return null;
    return (
        <div className="border-b border-panel-border py-4 last:border-0">
            <span className="block text-[11.5px] font-medium">Accounts waiting to verify their email</span>
            <span className="block text-ink-muted">Verify someone you know owns their address (for example when this server can't send mail).</span>
            <ul className="mt-2 flex flex-col gap-1">
                {list.map((u) => (
                    <li key={u.id} className="flex items-center gap-3 py-1">
                        <span className="min-w-0 flex-1 truncate">
                            {u.name} <span className="text-ink-muted">{u.email}</span>
                        </span>
                        <Button
                            onPress={() =>
                                void verifyAccountAsAdmin(u.id).then(
                                    () => (setList((l) => (l ?? []).filter((x) => x.id !== u.id)), setError(null)),
                                    (e: unknown) => setError(err(e)),
                                )
                            }
                        >
                            Verify
                        </Button>
                    </li>
                ))}
            </ul>
            {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
        </div>
    );
}
