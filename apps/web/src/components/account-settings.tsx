import { X } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { type Appearance, type SettingsTab, NOTICE_KINDS, closeAccountSettings, useSettingsTab, NOTICE_KIND_LABELS, type NotifyPrefs, appearance, avatarSrc, cancelEmailChange, changeEmail, deleteAccount, loadAccount, removeAvatar, saveAccount, setAppearance, transferInfo, uploadAvatar, useAccountView } from "../engine/account";
import { addAccount, changePassword, listSessions, setChatWebhook, setupHint, signOut, signOutOtherSessions, switchAccount, useAuth } from "../engine/auth";
import { refreshServerFiles } from "../engine/files";
import { askPushPermission, pushPermission } from "../engine/notifications";
import { editor } from "../engine/store";
import { Button, Dialog, ErrorText, FieldLabel, Tabs, Toggle, field } from "./admin/admin-ui";
import { AiTab } from "./ai-settings";
import { Avatar } from "./avatar";
import { PersonalTokens } from "./personal-tokens";
import { UnverifiedAccounts } from "./verify-email";
import { Select } from "./select";

// Settings for your account, from the account menu: name and picture, email and password,
// appearance, notifications by email and on the desktop, where you're signed in, the community
// profile, personal access tokens (Tokens), your own AI key (AI, also open signed out), accounts on
// this device, connected sign-in methods, and deleting the account.

// Rendered once by the app; shows the settings when something opens them.
export function AccountSettingsHost() {
    const tab = useSettingsTab();
    const signedIn = useAuth((s) => Boolean(s.user));
    // Signed out, only the AI tab (a key for this browser or this computer).
    if (!tab || (!signedIn && tab !== "ai")) return null;
    return <AccountSettings initial={tab} signedIn={signedIn} onClose={closeAccountSettings} />;
}

const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
const SECTION = "border-b border-panel-border py-4 last:border-0";
const ROW = "flex items-center gap-3 py-2";

function AccountSettings({ initial, signedIn, onClose }: { initial: SettingsTab; signedIn: boolean; onClose: () => void }) {
    const [tab, setTab] = useState<SettingsTab>(initial);
    const view = useAccountView();
    useEffect(() => {
        if (signedIn) void loadAccount();
    }, [signedIn]);
    const shown = signedIn ? tab : "ai";
    return (
        <AriaModalOverlay isOpen onOpenChange={(o) => !o && onClose()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 pt-[8vh] pb-8">
            <AriaModal className="w-[640px] max-w-full rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                <AriaDialog aria-label="Settings" className="outline-none">
                    <div className="flex items-center gap-3 border-b border-panel-border px-5 pt-3">
                        <Tabs
                            label="Settings"
                            value={shown}
                            onChange={setTab}
                            className="mb-3 ml-0"
                            tabs={
                                signedIn
                                    ? [
                                          ["account", "Account"],
                                          ["notifications", "Notifications"],
                                          ["security", "Security"],
                                          ["community", "Community"],
                                          ["tokens", "Tokens"],
                                          ["ai", "AI"],
                                      ]
                                    : [["ai", "AI"]]
                            }
                        />
                        <div className="flex-1" />
                        <AriaButton aria-label="Close" onPress={onClose} className="mb-3 rounded p-1 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <X className="size-4" />
                        </AriaButton>
                    </div>
                    <div className="max-h-[70vh] overflow-y-auto px-5 text-[12px]">
                        {shown === "ai" ? <AiTab />
                        : !view ? <p className="py-10 text-center text-ink-muted">Loading your settings…</p>
                        : tab === "account" ? <AccountTab onClose={onClose} />
                        : tab === "notifications" ? <NotificationsTab notify={view.notify} />
                        : tab === "security" ? <SecurityTab />
                        : tab === "tokens" ? <div className="py-4"><PersonalTokens /></div>
                        : <CommunityTab />}
                    </div>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

function AccountTab({ onClose }: { onClose: () => void }) {
    const view = useAccountView();
    const others = useAuth((s) => s.others);
    const [name, setName] = useState(view?.name ?? "");
    const [error, setError] = useState<string | null>(null);
    const [emailOpen, setEmailOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [look, setLook] = useState<Appearance>(appearance);
    const picker = useRef<HTMLInputElement>(null);
    if (!view) return null;
    const run = (p: Promise<unknown>) => void p.then(() => setError(null), (e: unknown) => setError(err(e)));
    return (
        <>
            <div className={`${SECTION} flex items-center gap-4`}>
                <Avatar name={view.name} color={view.color} size={56} single src={avatarSrc(view.avatar)} />
                <div className="flex flex-col gap-1.5">
                    <span className="flex gap-2">
                        <Button onPress={() => picker.current?.click()}>{view.avatar ? "Change photo" : "Upload photo"}</Button>
                        {view.avatar && (
                            <Button variant="ghost" onPress={() => run(removeAvatar())}>
                                Remove
                            </Button>
                        )}
                    </span>
                    <span className="text-[11px] text-ink-muted">PNG, JPG, WebP or GIF. It's cropped to a square.</span>
                </div>
                <input
                    ref={picker}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) run(uploadAvatar(file));
                    }}
                />
            </div>
            <div className={SECTION}>
                <FieldLabel label="Name">
                    <span className="flex gap-2">
                        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()} aria-label="Name" className={field} maxLength={60} />
                        <Button variant="primary" disabled={!name.trim() || name.trim() === view.name} onPress={() => run(saveAccount({ name: name.trim() }).then(() => editor.notify("Name saved.")))}>
                            Save
                        </Button>
                    </span>
                </FieldLabel>
                <div className={`${ROW} mt-3`}>
                    <span className="min-w-0 flex-1">
                        <span className="block text-[11.5px] font-medium">Email</span>
                        <span className="block truncate text-ink-muted">{view.email}</span>
                        {view.emailPending && (
                            <span className="mt-1 block text-[11px] text-ink-muted">
                                Waiting for you to confirm {view.emailPending} from the link we sent.{" "}
                                <button type="button" className="text-link hover:underline" onClick={() => run(cancelEmailChange())}>
                                    Cancel change
                                </button>
                            </span>
                        )}
                    </span>
                    <Button onPress={() => setEmailOpen(true)}>Change email</Button>
                </div>
            </div>
            <UnverifiedAccounts />
            <div className={SECTION}>
                <div className={ROW}>
                    <span className="flex-1">
                        <span className="block text-[11.5px] font-medium">Theme</span>
                        <span className="block text-ink-muted">How Nagma looks on this device</span>
                    </span>
                    <Select
                        aria-label="Theme"
                        value={look}
                        onChange={(e) => {
                            const next = e.target.value as Appearance;
                            setLook(next);
                            setAppearance(next);
                        }}
                        className="h-[25px] rounded-[5px] border border-panel-border px-2 text-[12px] outline-none"
                    >
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                        <option value="system">Match system</option>
                    </Select>
                </div>
            </div>
            <div className={SECTION}>
                <h3 className="mb-1 text-[11.5px] font-medium">Accounts on this device</h3>
                <div className={ROW}>
                    <Avatar name={view.name} color={view.color} size={24} single src={avatarSrc(view.avatar)} />
                    <span className="min-w-0 flex-1 truncate">
                        {view.name} <span className="text-ink-muted">{view.email}</span>
                    </span>
                    <span className="text-[11px] text-ink-muted">Current</span>
                </div>
                {others.map((o) => (
                    <div key={o.user.id} className={ROW}>
                        <Avatar name={o.user.name} color={o.user.color} size={24} single src={avatarSrc(o.user.avatar)} />
                        <span className="min-w-0 flex-1 truncate">
                            {o.user.name} <span className="text-ink-muted">{o.user.email}</span>
                        </span>
                        <Button
                            onPress={() => {
                                switchAccount(o.user.id);
                                void refreshServerFiles();
                                onClose();
                            }}
                        >
                            Switch
                        </Button>
                    </div>
                ))}
                <Button
                    className="mt-1"
                    onPress={() => {
                        onClose();
                        addAccount();
                    }}
                >
                    Add account
                </Button>
            </div>
            <div className={SECTION}>
                <h3 className="mb-1 text-[11.5px] font-medium">Connected accounts</h3>
                {view.connected.map((c) => (
                    <div key={c.id} className={ROW}>
                        <span className="min-w-0 flex-1">
                            <span className="block">{c.name}</span>
                            <span className="block truncate text-ink-muted">{c.detail}</span>
                        </span>
                        {c.removable && (
                            <Button variant="ghost" onPress={() => run(saveAccount({ disconnect: c.id }))}>
                                Disconnect
                            </Button>
                        )}
                    </div>
                ))}
            </div>
            <div className={SECTION}>
                <div className={ROW}>
                    <span className="flex-1">
                        <span className="block text-[11.5px] font-medium">Delete account</span>
                        <span className="block text-ink-muted">Your files go to someone you pick, or are deleted with the account.</span>
                    </span>
                    <Button variant="danger" onPress={() => setDeleting(true)}>
                        Delete account
                    </Button>
                </div>
            </div>
            <ErrorText>{error}</ErrorText>
            {emailOpen && <EmailDialog onClose={() => setEmailOpen(false)} />}
            {deleting && <DeleteDialog onClose={() => setDeleting(false)} onDone={onClose} />}
        </>
    );
}

function EmailDialog({ onClose }: { onClose: () => void }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ sent: boolean; mailConfigured: boolean; kept: boolean } | null>(null);
    const sent = result ? result.sent : null;
    return (
        <Dialog
            title="Change email"
            description={
                !result ? "Enter your current password and the new email. We send a link there; the change happens when you open it."
                : result.sent ? `We sent a link to ${email}. Open it within a day to finish.`
                : result.kept ? `Mail isn't set up on this server, so the link to confirm ${email} was written to the server's data folder (email-links.txt) for whoever runs it.`
                : result.mailConfigured ? `The link to confirm ${email} couldn't be sent. Try again later, or ask an admin to check the server's mail settings.`
                : `Email isn't configured on this server, so the link to confirm ${email} couldn't be sent. ${setupHint("Set up mail (NAGMA_SMTP_URL), then try again.", "Ask whoever runs the server to set up mail, then try again.")}`
            }
            onClose={onClose}
            footer={
                sent === null ? (
                    <>
                        <Button onPress={onClose}>Cancel</Button>
                        <Button variant="primary" disabled={!email.trim() || !password} onPress={() => void changeEmail(email.trim(), password).then(setResult, (e: unknown) => setError(err(e)))}>
                            Send link
                        </Button>
                    </>
                ) : (
                    <Button variant="primary" onPress={onClose}>
                        Done
                    </Button>
                )
            }
        >
            {sent === null && (
                <div className="space-y-3" onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}>
                    <FieldLabel label="New email">
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} autoComplete="email" />
                    </FieldLabel>
                    <FieldLabel label="Current password">
                        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} autoComplete="current-password" />
                    </FieldLabel>
                    <ErrorText>{error}</ErrorText>
                </div>
            )}
        </Dialog>
    );
}

function DeleteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
    const [info, setInfo] = useState<Awaited<ReturnType<typeof transferInfo>> | null>(null);
    const [heir, setHeir] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        void transferInfo().then(setInfo, (e: unknown) => setError(err(e)));
    }, []);
    return (
        <Dialog
            title="Delete your account?"
            description="This can't be undone. You're signed out everywhere, taken off your teams, and anything you published to the community is removed."
            onClose={onClose}
            footer={
                <>
                    <Button onPress={onClose}>Cancel</Button>
                    <Button
                        variant="danger"
                        disabled={!password || !info || info.blocking.length > 0}
                        onPress={() =>
                            void deleteAccount(password, heir || null).then(
                                () => {
                                    onDone();
                                    void signOut().then(refreshServerFiles);
                                    editor.notify("Your account was deleted.");
                                },
                                (e: unknown) => setError(err(e)),
                            )
                        }
                    >
                        Delete account
                    </Button>
                </>
            }
        >
            <div className="space-y-3" onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}>
                {info?.blocking.length ? <p className="text-red-500">Make someone else an admin of {info.blocking.join(", ")} first.</p> : null}
                {info && info.owned > 0 && (
                    <FieldLabel label={`Your ${info.owned} ${info.owned === 1 ? "file" : "files"} on the server`} hint={heir ? "They become theirs, with the same access as now." : "They're deleted with the account."}>
                        <Select aria-label="Transfer files to" value={heir} onChange={(e) => setHeir(e.target.value)} className={field}>
                            <option value="">Delete my files</option>
                            {info.people.map((p) => (
                                <option key={p.id} value={p.id}>
                                    Transfer to {p.name} ({p.email})
                                </option>
                            ))}
                        </Select>
                    </FieldLabel>
                )}
                <FieldLabel label="Current password">
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} autoComplete="current-password" />
                </FieldLabel>
                <ErrorText>{error}</ErrorText>
            </div>
        </Dialog>
    );
}

function NotificationsTab({ notify }: { notify: NotifyPrefs }) {
    const [permission, setPermission] = useState(pushPermission);
    const hooked = useAuth((s) => Boolean(s.user?.prefs?.chatWebhook));
    const [hook, setHook] = useState("");
    const [error, setError] = useState<string | null>(null);
    const set = (kind: (typeof NOTICE_KINDS)[number], channel: "email" | "desktop", on: boolean) => void saveAccount({ notify: { [kind]: { ...notify[kind], [channel]: on } } }).catch((e: unknown) => setError(err(e)));
    return (
        <>
            <div className={SECTION}>
                <div className={ROW}>
                    <span className="flex-1">
                        <span className="block text-[11.5px] font-medium">Desktop notifications</span>
                        <span className="block text-ink-muted">
                            {permission === "app" ? "The desktop app shows them through your system's notifications."
                            : permission === "granted" ? "This browser shows them while Nagma is open."
                            : permission === "denied" ? "This browser blocks them. Allow notifications for this site in the browser's settings."
                            : permission === "unsupported" ? "This browser can't show notifications."
                            : "Get a notification on this computer when something needs you."}
                        </span>
                    </span>
                    {permission === "default" && (
                        <Button variant="primary" onPress={() => void askPushPermission().then(setPermission)}>
                            Turn on
                        </Button>
                    )}
                </div>
            </div>
            <div className={SECTION}>
                <div className="grid grid-cols-[1fr_64px_64px] items-center gap-y-1 text-[11px] font-medium text-ink-muted">
                    <span />
                    <span className="text-center">Email</span>
                    <span className="text-center">Desktop</span>
                </div>
                {NOTICE_KINDS.map((k) => (
                    <div key={k} className="grid grid-cols-[1fr_64px_64px] items-center py-2">
                        <span>
                            <span className="block">{NOTICE_KIND_LABELS[k][0]}</span>
                            <span className="block text-[11px] text-ink-muted">{NOTICE_KIND_LABELS[k][1]}</span>
                        </span>
                        <span className="flex justify-center">
                            <Toggle label={`${NOTICE_KIND_LABELS[k][0]} by email`} checked={notify[k].email} onChange={(v) => set(k, "email", v)} />
                        </span>
                        <span className="flex justify-center">
                            <Toggle label={`${NOTICE_KIND_LABELS[k][0]} on the desktop`} checked={notify[k].desktop} onChange={(v) => set(k, "desktop", v)} />
                        </span>
                    </div>
                ))}
                <p className="mt-1 text-[11px] text-ink-muted">Comment and mention emails come as a digest every 30 minutes of what you haven't read.</p>
            </div>
            <div className={SECTION}>
                <span className="block text-[11.5px] font-medium">Slack or Teams</span>
                {hooked ? (
                    <div className={ROW}>
                        <span className="flex-1 text-ink-muted">Comment digests also go to your webhook.</span>
                        <Button variant="ghost" onPress={() => void setChatWebhook("").catch((e: unknown) => setError(err(e)))}>
                            Turn off
                        </Button>
                    </div>
                ) : (
                    <div className={ROW} onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}>
                        <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="Incoming webhook address" aria-label="Slack or Teams incoming webhook" className={field} />
                        <Button disabled={!hook.trim()} onPress={() => void setChatWebhook(hook.trim()).then(() => (setHook(""), void loadAccount()), (e: unknown) => setError(err(e)))}>
                            Connect
                        </Button>
                    </div>
                )}
            </div>
            <ErrorText>{error}</ErrorText>
        </>
    );
}

function SecurityTab() {
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [sessions, setSessions] = useState<Awaited<ReturnType<typeof listSessions>>>([]);
    const reload = () => void listSessions().then(setSessions);
    useEffect(reload, []);
    const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return (
        <>
            <form
                className={`${SECTION} space-y-3`}
                onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}
                onSubmit={(e) => {
                    e.preventDefault();
                    void changePassword(current, next).then(
                        () => (setCurrent(""), setNext(""), setError(null), editor.notify("Password changed.")),
                        (x: unknown) => setError(err(x)),
                    );
                }}
            >
                <h3 className="text-[11.5px] font-medium">Change password</h3>
                <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" aria-label="Current password" autoComplete="current-password" required className={field} />
                <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (8 characters or more)" aria-label="New password" autoComplete="new-password" minLength={8} required className={field} />
                <Button type="submit" variant="primary" disabled={!current || next.length < 8}>
                    Save new password
                </Button>
                <ErrorText>{error}</ErrorText>
            </form>
            <div className={SECTION}>
                <div className="mb-1 flex items-center">
                    <h3 className="flex-1 text-[11.5px] font-medium">Where you're signed in</h3>
                    {sessions.length > 1 && <Button onPress={() => void signOutOtherSessions().then(reload)}>Sign out of other sessions</Button>}
                </div>
                {sessions.map((s, i) => (
                    <div key={i} className={ROW}>
                        <span className="flex-1">
                            <span className="block">{s.current ? "This device" : "Another device"}</span>
                            <span className="block text-[11px] text-ink-muted">
                                Signed in {when(s.createdAt)} · last used {when(s.lastUsed)}
                            </span>
                        </span>
                        <span className="text-[11px] text-ink-muted">Ends {when(s.expiresAt)}</span>
                    </div>
                ))}
                <p className="text-[11px] text-ink-muted">Sessions end after 30 days without use.</p>
            </div>
        </>
    );
}

function CommunityTab() {
    const view = useAccountView();
    const [handle, setHandle] = useState(view?.profile.handle ?? "");
    const [bio, setBio] = useState(view?.profile.bio ?? "");
    const [error, setError] = useState<string | null>(null);
    if (!view) return null;
    const changed = handle !== view.profile.handle || bio !== view.profile.bio;
    return (
        <div className={`${SECTION} space-y-3`} onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}>
            <p className="text-ink-muted">Your profile on the Community page, where people on this server see what you publish.</p>
            <FieldLabel label="Handle" hint="Letters, numbers, dashes and underscores.">
                <span className="flex items-center gap-1">
                    <span className="text-ink-muted">@</span>
                    <input value={handle} onChange={(e) => setHandle(e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} aria-label="Handle" maxLength={30} className={field} />
                </span>
            </FieldLabel>
            <FieldLabel label="Bio" hint={`${bio.length}/280`}>
                <textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, 280))} aria-label="Bio" rows={3} className={`${field} h-auto py-2`} />
            </FieldLabel>
            <Button variant="primary" disabled={!changed} onPress={() => void saveAccount({ profile: { handle, bio } }).then(() => (setError(null), editor.notify("Profile saved.")), (e: unknown) => setError(err(e)))}>
                Save profile
            </Button>
            <ErrorText>{error}</ErrorText>
        </div>
    );
}
