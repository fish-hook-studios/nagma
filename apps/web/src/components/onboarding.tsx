import { X } from "@untitledui/icons";
import { useEffect } from "react";
import { Button as AriaButton, Dialog as AriaDialog, Heading, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { DOC_LINKS, chooseWelcome, markSeen, openDoc, showWelcomeOnce, useWelcomeOpen } from "../engine/onboarding";
import { hostedServer, openServerPicker } from "../engine/servers";
import { useEditor } from "../engine/store";
import { NagmaLogo } from "./nagma-logo";

// Welcome: the first time Home shows on this device, three panels that say how Nagma works. Nothing
// to decide: it closes with one button, and a server or an AI key can be added any time (Help ›
// Get started opens this again; engine/onboarding.ts keeps what has been seen).

const PANELS: { key: string; title: string; body: string; doc: string; art: () => React.JSX.Element }[] = [
    {
        key: "local",
        title: "It runs on your computer",
        body: "Open it and work. Files are drafts on this device, there is no account to make, and nothing is uploaded until you choose a server.",
        doc: DOC_LINKS.gettingStarted,
        art: LocalArt,
    },
    {
        key: "server",
        title: "Work together on any server",
        body: "Share and edit live with anyone on the free hosted server, your company's, or one you run with a single command.",
        doc: DOC_LINKS.connect,
        art: ServerArt,
    },
    {
        key: "ai",
        title: "AI with your own key",
        body: "Make and the AI features use a key from the provider you pick. It stays on this device and you pay them directly, if at all.",
        doc: DOC_LINKS.aiKeys,
        art: KeyArt,
    },
];

export function Onboarding() {
    const homeOpen = useEditor((s) => s.homeOpen);
    const open = useWelcomeOpen();
    const hosted = hostedServer();
    useEffect(() => {
        if (homeOpen) showWelcomeOnce();
    }, [homeOpen]);
    const close = () => chooseWelcome("local");
    return (
        <AriaModalOverlay isOpen={open} onOpenChange={(o) => !o && close()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-14">
            <AriaModal className="w-[760px] max-w-full rounded-2xl border border-panel-border bg-panel-raised p-6 text-ink shadow-2xl outline-none">
                <AriaDialog className="outline-none" aria-label="Welcome to Nagma">
                    <div className="flex items-start gap-3">
                        <NagmaLogo size={32} />
                        <div className="min-w-0 flex-1">
                            <Heading slot="title" className="text-[16px] font-semibold">
                                Welcome to Nagma
                            </Heading>
                            <p className="mt-1 text-[12px] text-ink-muted">Design, boards, slides, campaigns, sites, apps, video and documents in one app. Three things worth knowing before you start.</p>
                        </div>
                        <AriaButton aria-label="Close" onPress={close} className="rounded p-1 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500">
                            <X className="size-4" />
                        </AriaButton>
                    </div>
                    <ul className="mt-5 grid grid-cols-3 gap-3" aria-label="How Nagma works">
                        {PANELS.map((p) => {
                            const Art = p.art;
                            return (
                                <li key={p.key} className="flex flex-col rounded-xl border border-panel-border bg-panel">
                                    <div className="h-[132px] overflow-hidden rounded-t-xl" aria-hidden>
                                        <Art />
                                    </div>
                                    <div className="flex flex-1 flex-col p-3.5">
                                        <h3 className="text-[13px] font-semibold">{p.title}</h3>
                                        <p className="mt-1 flex-1 text-[12px] leading-relaxed text-ink-muted">{p.body}</p>
                                        <button type="button" onClick={() => openDoc(p.doc)} className="mt-2 self-start text-[11px] font-medium text-link hover:underline">
                                            Learn more
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    <div className="mt-5 flex items-center justify-between gap-3">
                        <p className="text-[11px] text-ink-muted">
                            Change your mind any time: {hosted ? `connect to ${hosted.name} or your own server` : "connect to a server"} from the account menu.{" "}
                            <button
                                type="button"
                                onClick={() => {
                                    close();
                                    openServerPicker();
                                }}
                                className="text-link hover:underline"
                            >
                                Choose a server now
                            </button>
                        </p>
                        <AriaButton autoFocus onPress={close} className="h-9 shrink-0 rounded-md bg-brand-500 px-5 text-[12px] font-semibold text-white outline-none hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1">
                            Got it
                        </AriaButton>
                    </div>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

// ---- The three pictures: flat shapes in the brand's colours, no text ----

const BRAND = { cream: "#F6F1E7", ink: "#141413", orange: "#EF7F42", pink: "#FC829A", green: "#4FAF78", mint: "#BFE6C8", yellow: "#F5C842", sky: "#8FC1F0", lilac: "#C9B8F2" };

// A laptop with a file on it: drafts stay on this device.
function LocalArt() {
    return (
        <svg viewBox="0 0 240 132" className="h-full w-full" style={{ background: BRAND.mint }}>
            <rect x="52" y="26" width="136" height="80" rx="8" fill={BRAND.ink} />
            <rect x="60" y="34" width="120" height="64" rx="4" fill={BRAND.cream} />
            <rect x="40" y="104" width="160" height="8" rx="4" fill={BRAND.ink} />
            <rect x="74" y="46" width="40" height="40" rx="5" fill={BRAND.orange} />
            <rect x="122" y="46" width="48" height="8" rx="4" fill={BRAND.ink} opacity=".85" />
            <rect x="122" y="60" width="36" height="6" rx="3" fill={BRAND.ink} opacity=".35" />
            <rect x="122" y="72" width="44" height="6" rx="3" fill={BRAND.ink} opacity=".35" />
            <circle cx="92" cy="66" r="9" fill={BRAND.cream} />
            <path d="M88 66l3 3 6-6" fill="none" stroke={BRAND.ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// Three cursors around one shape: live editing on a server.
function ServerArt() {
    const cursor = (x: number, y: number, color: string) => (
        <g transform={`translate(${x} ${y})`}>
            <path d="M0 0l14 6.5-6.3 1.6L5.2 15z" fill={color} stroke={BRAND.ink} strokeWidth="1.4" strokeLinejoin="round" />
            <rect x="11" y="12" width="26" height="12" rx="6" fill={color} stroke={BRAND.ink} strokeWidth="1.2" />
        </g>
    );
    return (
        <svg viewBox="0 0 240 132" className="h-full w-full" style={{ background: BRAND.sky }}>
            <rect x="70" y="30" width="100" height="72" rx="10" fill={BRAND.cream} stroke={BRAND.ink} strokeWidth="2" />
            <rect x="84" y="44" width="72" height="12" rx="6" fill={BRAND.yellow} />
            <rect x="84" y="64" width="46" height="8" rx="4" fill={BRAND.ink} opacity=".3" />
            <rect x="84" y="78" width="60" height="8" rx="4" fill={BRAND.ink} opacity=".3" />
            {cursor(42, 22, BRAND.pink)}
            {cursor(168, 14, BRAND.green)}
            {cursor(150, 92, BRAND.lilac)}
            <path d="M120 10c40-6 70 6 96 30" fill="none" stroke={BRAND.ink} strokeWidth="1.6" strokeDasharray="3 4" opacity=".5" />
            <path d="M20 118c40-24 90-30 150-18" fill="none" stroke={BRAND.ink} strokeWidth="1.6" strokeDasharray="3 4" opacity=".5" />
        </svg>
    );
}

// A key and a sparkle: AI with a key of your own.
function KeyArt() {
    return (
        <svg viewBox="0 0 240 132" className="h-full w-full" style={{ background: BRAND.yellow }}>
            <circle cx="90" cy="60" r="26" fill={BRAND.cream} stroke={BRAND.ink} strokeWidth="2.4" />
            <circle cx="90" cy="60" r="9" fill={BRAND.yellow} stroke={BRAND.ink} strokeWidth="2.4" />
            <path d="M114 60h66v14h-10v-8h-8v12h-10v-12h-8v8h-10v-8h-20z" fill={BRAND.ink} />
            <path d="M190 22c2 12 8 18 20 20-12 2-18 8-20 20-2-12-8-18-20-20 12-2 18-8 20-20z" fill={BRAND.orange} />
            <path d="M44 96c1.5 8 5 11.5 13 13-8 1.5-11.5 5-13 13-1.5-8-5-11.5-13-13 8-1.5 11.5-5 13-13z" fill={BRAND.pink} />
        </svg>
    );
}

// In Share, for a file that's only on this device while This computer is the server
// (engine/onboarding.ts shouldNudgeShare): shown once, then Share reads as before.
export function ShareNeedsServer({ close }: { close: () => void }) {
    useEffect(() => markSeen("shareNeedsServer"), []);
    return (
        <div role="note" aria-label="Collaboration needs a server" className="rounded-md border border-brand-500/40 bg-brand-500/10 p-3 text-[12px] leading-relaxed">
            <p>{hostedServer() ? `Collaboration needs a server. Use ${hostedServer()?.name ?? "Nagma"}'s free hosted server, connect to your own, or run one in one command.` : "Collaboration needs a server. Connect to one, or run your own in one command."}</p>
            <div className="mt-2 flex gap-2">
                <AriaButton
                    onPress={() => {
                        close();
                        openServerPicker();
                    }}
                    className="h-7 rounded-md bg-brand-500 px-3 text-[11px] font-semibold text-white outline-none hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
                >
                    Connect
                </AriaButton>
                <AriaButton onPress={() => openDoc(DOC_LINKS.connect)} className="h-7 rounded-md px-3 text-[11px] font-medium text-link outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                    Learn more
                </AriaButton>
            </div>
        </div>
    );
}
