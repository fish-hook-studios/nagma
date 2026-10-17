import { ArrowUp, BookOpen01, ChevronDown, ChevronLeft, DotsHorizontal, MagicWand01, Plus, Stars01, Tool02, X } from "@untitledui/icons";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover } from "react-aria-components";
import { openAiSettings } from "../engine/ai-settings";
import { type AgentChat, deleteChat, getChats, newChat, sendToAgent, subscribeChats } from "../engine/agent";
import { editor, useEditor } from "../engine/store";
import { MenuRow } from "./left-sidebar";

// The Agents panel: a chat that works on the open file. Suggestions open into concrete asks.
const SUGGESTIONS: { icon: typeof Stars01; label: string; asks: string[] }[] = [
    { icon: MagicWand01, label: "Tidy and polish", asks: ["Tidy and polish this file", "Rename the generic layers", "Space the selection evenly"] },
    { icon: Stars01, label: "Generate designs", asks: ["Generate a login screen", "Generate a sign up screen", "Generate a settings screen", "Generate an empty state"] },
    { icon: Tool02, label: "Create plugins and shaders", asks: ["Open the Tools panel"] },
];

export function AgentPanel() {
    const chats = useSyncExternalStore(subscribeChats, getChats);
    const [chatId, setChatId] = useState<string | null>(null);
    const [listOpen, setListOpen] = useState(false);
    const chat = chats.find((c) => c.id === chatId) ?? null;
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState<string | null>(null);
    const [libraries, setLibraries] = useState(true);
    const selection = useEditor((s) => s.selection.length);
    const scroller = useRef<HTMLDivElement>(null);
    const where = useEditor((s) => (s.fileId ? "Shared" : "Drafts"));

    useEffect(() => {
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
    }, [chat?.messages.length]);

    const send = async (text: string) => {
        const t = text.trim();
        if (!t || busy) return;
        if (/open the tools panel/i.test(t)) {
            editor.setPrefs({ leftPanel: "tools", leftPanelOpen: true });
            return;
        }
        const id = chat?.id ?? newChat().id;
        setChatId(id);
        setDraft("");
        setBusy(true);
        try {
            await sendToAgent(id, t);
        } finally {
            setBusy(false);
        }
    };

    const field = "w-full resize-none bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-subtle";

    if (listOpen) {
        return (
            <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex h-10 shrink-0 items-center gap-1 px-3">
                    <span className="flex-1 text-[13px] font-semibold">Chats</span>
                    <AriaButton
                        aria-label="New chat"
                        onPress={() => {
                            setChatId(newChat().id);
                            setListOpen(false);
                        }}
                        className="flex size-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink"
                    >
                        <Plus className="size-4" />
                    </AriaButton>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2">
                    {chats.length === 0 && <p className="px-2 py-3 text-ink-muted">No chats yet.</p>}
                    {chats.map((c) => (
                        <div key={c.id} className="group flex h-9 items-center gap-2 rounded-md px-2 hover:bg-panel-hover">
                            <button
                                type="button"
                                onClick={() => {
                                    setChatId(c.id);
                                    setListOpen(false);
                                }}
                                className="min-w-0 flex-1 truncate text-left"
                            >
                                {c.title}
                            </button>
                            <AriaButton aria-label="Delete chat" onPress={() => deleteChat(c.id)} className="flex size-6 items-center justify-center rounded text-ink-subtle opacity-0 group-hover:opacity-100 hover:text-ink">
                                <X className="size-3.5" />
                            </AriaButton>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-start gap-1 px-3 pt-2">
                <AriaButton aria-label="All chats" onPress={() => setListOpen(true)} className="mt-0.5 flex size-6 items-center justify-center rounded text-ink-muted outline-none hover:text-ink">
                    <ChevronLeft className="size-4" />
                </AriaButton>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{chat?.title ?? "New chat"}</div>
                    <div className="text-ink-muted">{where}</div>
                </div>
                <span className="rounded border border-panel-border px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">AI</span>
                <AriaMenuTrigger>
                    <AriaButton aria-label="Chat actions" className="flex size-6 items-center justify-center rounded text-ink-muted outline-none hover:text-ink">
                        <DotsHorizontal className="size-4" />
                    </AriaButton>
                    <AriaPopover placement="bottom end" className="w-44 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                        <AriaMenu
                            className="outline-none"
                            onAction={(k) => {
                                if (String(k) === "new") setChatId(newChat().id);
                                if (String(k) === "delete" && chat) {
                                    deleteChat(chat.id);
                                    setChatId(null);
                                }
                            }}
                        >
                            <MenuRow id="new" label="New chat" />
                            <MenuRow id="delete" label="Delete chat" />
                        </AriaMenu>
                    </AriaPopover>
                </AriaMenuTrigger>
            </div>

            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                {!chat?.messages.length ? (
                    <div className="flex flex-col items-center pt-10">
                        <div className="flex size-11 items-center justify-center rounded-full bg-brand-100 text-brand-500">
                            <Stars01 className="size-5" />
                        </div>
                        <h2 className="mt-4 mb-5 text-[15px] font-semibold">What's next?</h2>
                        <div className="w-full space-y-2">
                            {SUGGESTIONS.map((s) => (
                                <div key={s.label} className="rounded-xl border border-panel-border">
                                    <button type="button" onClick={() => setOpen(open === s.label ? null : s.label)} className="flex h-11 w-full items-center gap-3 px-4 text-left text-[13px] hover:bg-panel-hover">
                                        <s.icon className="size-4 text-ink-muted" />
                                        <span className="flex-1">{s.label}</span>
                                        <ChevronDown className={`size-3.5 text-ink-muted transition-transform ${open === s.label ? "rotate-180" : ""}`} />
                                    </button>
                                    {open === s.label && (
                                        <div className="border-t border-panel-border p-1">
                                            {s.asks.map((a) => (
                                                <button key={a} type="button" onClick={() => void send(a)} className="flex h-8 w-full items-center rounded-md px-3 text-left text-ink-muted hover:bg-panel-hover hover:text-ink">
                                                    {a}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {chat.messages.map((m, i) => (
                            <div key={i} className={m.role === "user" ? "ml-8 rounded-xl bg-panel-hover px-3 py-2 text-[12px]" : "px-1 text-[12px]"}>
                                <div className="whitespace-pre-wrap">{m.text}</div>
                                {m.action === "ai-settings" && (
                                    <button type="button" onClick={openAiSettings} className="mt-1.5 rounded-md border border-panel-border px-2 py-1 text-[11.5px] font-medium hover:bg-panel-hover">
                                        Open AI settings
                                    </button>
                                )}
                                {m.applied && m.applied.length > 0 && (
                                    <ul className="mt-1.5 space-y-0.5 text-ink-muted">
                                        {m.applied.map((a) => (
                                            <li key={a}>✓ {a}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ))}
                        {busy && <div className="px-1 text-ink-muted">Working…</div>}
                    </div>
                )}
            </div>

            <div className="shrink-0 px-3 pb-3">
                <div className="rounded-2xl border border-panel-border">
                    {libraries && (
                        <div className="flex items-start gap-2 border-b border-panel-border px-3 py-2">
                            <BookOpen01 className="mt-0.5 size-4 text-ink-muted" />
                            <div className="flex-1">
                                <div className="text-[12px]">Use your components</div>
                                <button type="button" onClick={() => editor.setPrefs({ leftPanel: "assets", leftPanelOpen: true })} className="text-brand-500 hover:underline">
                                    Open Assets
                                </button>
                            </div>
                            <AriaButton aria-label="Dismiss" onPress={() => setLibraries(false)} className="flex size-6 items-center justify-center rounded text-ink-muted outline-none hover:text-ink">
                                <X className="size-3.5" />
                            </AriaButton>
                        </div>
                    )}
                    <div className="px-3 pt-3">
                        <textarea
                            value={draft}
                            rows={3}
                            placeholder={selection ? `Ask for changes to ${selection} selected layer${selection === 1 ? "" : "s"}` : "Ask for changes"}
                            aria-label="Ask the agent"
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    void send(draft);
                                }
                            }}
                            className={field}
                        />
                    </div>
                    <div className="flex items-center gap-1 px-2 pb-2">
                        <AriaButton aria-label="Attach the selection" onPress={() => setDraft((d) => (d ? d : selection ? "Tidy and polish the selection" : "Tidy and polish this file"))} className="flex size-8 items-center justify-center rounded-full text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <Plus className="size-4" />
                        </AriaButton>
                        <AriaButton aria-label="Open Assets" onPress={() => editor.setPrefs({ leftPanel: "assets", leftPanelOpen: true })} className="flex size-8 items-center justify-center rounded-full text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <BookOpen01 className="size-4" />
                        </AriaButton>
                        <div className="flex-1" />
                        <AriaButton aria-label="Send" isDisabled={!draft.trim() || busy} onPress={() => void send(draft)} className="flex size-8 items-center justify-center rounded-full bg-brand-500 text-white outline-none hover:bg-brand-600 disabled:bg-panel-hover disabled:text-ink-subtle">
                            <ArrowUp className="size-4" />
                        </AriaButton>
                    </div>
                </div>
            </div>
        </div>
    );
}

export type { AgentChat };
