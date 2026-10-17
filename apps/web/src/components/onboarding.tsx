import { Key01, Laptop01, Server01, X } from "@untitledui/icons";
import { type ReactNode, useEffect } from "react";
import { Button as AriaButton, Dialog as AriaDialog, Heading, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { DOC_LINKS, type WelcomeChoice, chooseWelcome, markSeen, openDoc, showWelcomeOnce, useWelcomeOpen } from "../engine/onboarding";
import { openServerPicker } from "../engine/servers";
import { useEditor } from "../engine/store";
import { NagmaLogo } from "./nagma-logo";

// Get started: the first time Home shows on this device, three ways to begin. Help › Get started
// opens it again. What each card does is in engine/onboarding.ts.

const CARDS: { choice: WelcomeChoice; icon: ReactNode; title: string; body: string; doc: string }[] = [
    {
        choice: "local",
        icon: <Laptop01 className="size-5" />,
        title: "Use Nagma on this computer",
        body: "Free, no account needed. Your files stay on this device as drafts.",
        doc: DOC_LINKS.gettingStarted,
    },
    {
        choice: "server",
        icon: <Server01 className="size-5" />,
        title: "Connect to a server",
        body: "Work with your team on a Nagma server: your company's, or one you run in one command.",
        doc: DOC_LINKS.connect,
    },
    {
        choice: "ai",
        icon: <Key01 className="size-5" />,
        title: "Add an AI key",
        body: "AI features use your own key from the provider you choose. You pay them directly, if at all.",
        doc: DOC_LINKS.aiKeys,
    },
];

export function Onboarding() {
    const homeOpen = useEditor((s) => s.homeOpen);
    const open = useWelcomeOpen();
    useEffect(() => {
        if (homeOpen) showWelcomeOnce();
    }, [homeOpen]);
    return (
        <AriaModalOverlay isOpen={open} onOpenChange={(o) => !o && chooseWelcome("local")} isDismissable className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-16">
            <AriaModal className="w-[560px] max-w-full rounded-xl border border-panel-border bg-panel-raised p-6 text-ink shadow-2xl outline-none">
                <AriaDialog className="outline-none" aria-label="Get started with Nagma">
                    <div className="flex items-start gap-3">
                        <NagmaLogo size={32} />
                        <div className="min-w-0 flex-1">
                            <Heading slot="title" className="text-[16px] font-semibold">
                                Welcome to Nagma
                            </Heading>
                            <p className="mt-1 text-[12px] text-ink-muted">Everything works on this computer from the start. Connect to a server or add an AI key whenever you like: Get started is in the Help menu and the account menu.</p>
                        </div>
                        <AriaButton aria-label="Close" onPress={() => chooseWelcome("local")} className="rounded p-1 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500">
                            <X className="size-4" />
                        </AriaButton>
                    </div>
                    <ul className="mt-5 space-y-2" aria-label="Ways to start">
                        {CARDS.map((card, i) => (
                            <li key={card.choice} className="flex items-stretch gap-1 rounded-lg border border-panel-border has-[button:hover]:bg-panel-hover">
                                <AriaButton
                                    autoFocus={i === 0}
                                    onPress={() => chooseWelcome(card.choice)}
                                    className="flex min-w-0 flex-1 items-start gap-3 rounded-lg p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                                >
                                    <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ${i === 0 ? "bg-brand-500 text-white" : "bg-field text-ink"}`}>{card.icon}</span>
                                    <span className="min-w-0">
                                        <span className="block text-[13px] font-semibold">
                                            {card.title}
                                            {i === 0 && <span className="ml-2 rounded bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-medium text-brand-500">Default</span>}
                                        </span>
                                        <span className="mt-0.5 block text-[12px] text-ink-muted">{card.body}</span>
                                    </span>
                                </AriaButton>
                                <button type="button" onClick={() => openDoc(card.doc)} aria-label={`Learn more: ${card.title}`} className="shrink-0 self-center rounded-md px-3 py-2 text-[11px] font-medium text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand-500">
                                    Learn more
                                </button>
                            </li>
                        ))}
                    </ul>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

// In Share, for a file that's only on this device while This computer is the server
// (engine/onboarding.ts shouldNudgeShare): shown once, then Share reads as before.
export function ShareNeedsServer({ close }: { close: () => void }) {
    useEffect(() => markSeen("shareNeedsServer"), []);
    return (
        <div role="note" aria-label="Collaboration needs a server" className="rounded-md border border-brand-500/40 bg-brand-500/10 p-3 text-[12px] leading-relaxed">
            <p>Collaboration needs a server. Connect to one, or run your own in one command.</p>
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
