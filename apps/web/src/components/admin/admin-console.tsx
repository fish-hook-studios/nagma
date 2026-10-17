import { CheckCircle, ChevronLeft, CurrencyDollarCircle, Folder, InfoCircle, User01, X } from "@untitledui/icons";
import { type FC, type ReactNode, type SVGProps, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { avatarSrc, openAccountSettings } from "../../engine/account";
import { type AdminData, type MemberData, useAdmin } from "../../engine/admin";
import { openSignIn, signOut, useAuth } from "../../engine/auth";
import { useCollab } from "../../engine/collab";
import { refreshServerFiles } from "../../engine/files";
import { editor } from "../../engine/store";
import type { Team } from "../../engine/teams";
import { HistoryButtons, SidebarAccount } from "../sidebar-account";
import { MenuRow } from "../left-sidebar";
import { AiCreditsPage } from "./ai-credits-page";
import { AiCreditsIcon, RegistryIcon, SettingsIcon } from "./admin-icons";
import { BillingPage } from "./billing-page";
import { ContentPage } from "./content-page";
import { DashboardPage } from "./dashboard-page";
import { MemberNotice } from "./member-notice";
import { PeoplePage } from "./people-page";
import { RegistryPage } from "./registry-page";
import { SettingsPage } from "./settings-page";
import { userStorage } from "../../engine/user-storage";

export type AdminPage = "dashboard" | "people" | "billing" | "ai" | "content" | "registry" | "settings";

const PAGES: [AdminPage, string, FC<SVGProps<SVGSVGElement>>][] = [
    ["dashboard", "Dashboard", CheckCircle],
    ["people", "People", User01],
    ["billing", "Billing", CurrencyDollarCircle],
    ["ai", "AI credits", AiCreditsIcon],
    ["content", "Content", Folder],
    ["registry", "npm registry", RegistryIcon],
    ["settings", "Settings", SettingsIcon],
];

// Announcements across the top of the console; each one stays dismissed in this browser.
const ANNOUNCEMENT = { id: "seats-2026-10", text: "Seat types are here: give people Full, Dev, Collab or free View seats from People, and see what each one costs in Billing." };
const DISMISSED_KEY = "nagma.admin.dismissed";
function readDismissed(): string[] {
    try {
        return JSON.parse(userStorage.getItem(DISMISSED_KEY) ?? "[]") as string[];
    } catch {
        return [];
    }
}

// The team admin console: it takes over Home's sidebar with its own pages. Admins manage seats,
// billing, AI credits, content, the token registry and settings; other members see their own seat
// and can send requests to the admins.
export function AdminConsole({ team, bell, onExit }: { team: Team; bell: ReactNode; onExit: () => void }) {
    const account = useAuth((s) => s.user);
    const me = useCollab((s) => s.me);
    const [page, setPage] = useState<AdminPage>("dashboard");
    const [history, setHistory] = useState<{ back: AdminPage[]; forward: AdminPage[] }>({ back: [], forward: [] });
    const [dismissed, setDismissed] = useState<string[]>(readDismissed);
    const { data, error } = useAdmin(team.id);

    const go = (next: AdminPage) => {
        if (next === page) return;
        setHistory((h) => ({ back: [...h.back, page], forward: [] }));
        setPage(next);
    };
    const back = () => {
        const prev = history.back.at(-1);
        if (!prev) return;
        setHistory((h) => ({ back: h.back.slice(0, -1), forward: [page, ...h.forward] }));
        setPage(prev);
    };
    const forward = () => {
        const next = history.forward[0];
        if (!next) return;
        setHistory((h) => ({ back: [...h.back, page], forward: h.forward.slice(1) }));
        setPage(next);
    };
    const dismiss = (id: string) => {
        const next = [...dismissed, id];
        setDismissed(next);
        try {
            userStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
        } catch {
            // Shown again next time.
        }
    };
    const name = data?.team.name ?? team.name;
    const pending = data?.isAdmin ? data.requests.filter((r) => r.status === "pending").length : 0;

    return (
        <div className="flex h-full w-full bg-panel text-[11px] text-ink">
            <aside className="flex w-[241px] shrink-0 flex-col border-r border-panel-border bg-panel">
                <SidebarAccount
                    divided
                    name={account?.name || me.name || "You"}
                    color={account?.color || me.color}
                    avatar={avatarSrc(account?.avatar)}
                    bell={bell}
                    onAction={(k) => {
                        if (k === "signin") openSignIn();
                        else if (k === "files") onExit();
                        else if (k === "settings") openAccountSettings("account");
                        else if (k === "signout") void signOut().then(refreshServerFiles).then(onExit);
                        else if (k === "theme") editor.setPrefs({ theme: editor.get().prefs.theme === "dark" ? "light" : "dark" });
                    }}
                >
                    {account ? <MenuRow id="email" label={account.email} /> : <MenuRow id="signin" label="Sign in or create an account" />}
                    <MenuRow id="files" label="Back to files" />
                    {account && <MenuRow id="settings" label="Settings" />}
                    <MenuRow id="theme" label="Switch theme" />
                    {account && <MenuRow id="signout" label="Log out" />}
                </SidebarAccount>
                <div className="flex h-[40px] shrink-0 items-center gap-[10px] pr-3 pl-[12px]">
                    <AriaButton aria-label="Back to files" onPress={onExit} className="flex size-[22px] items-center justify-center rounded-md text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                        <ChevronLeft className="size-4" />
                    </AriaButton>
                    <span className="truncate text-[13px] font-medium">{name} admin</span>
                </div>
                <nav aria-label="Admin" className="mt-[2px] flex min-h-0 flex-1 flex-col gap-[4px] overflow-y-auto px-2 pb-2">
                    {data?.isAdmin !== false && PAGES.map(([id, label, Icon]) => (
                        <button
                            key={id}
                            type="button"
                            aria-current={page === id ? "page" : undefined}
                            onClick={() => go(id)}
                            className={`flex h-[28px] w-full shrink-0 items-center gap-[12px] rounded-[5px] pr-2 pl-[8px] text-left text-[11px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${page === id ? "bg-brand-100" : "hover:bg-panel-hover"}`}
                        >
                            <Icon className="size-4 shrink-0" />
                            <span className="flex-1 truncate">{label}</span>
                            {id === "dashboard" && pending > 0 && <span className="rounded-full bg-brand-500 px-1.5 text-[10px] font-semibold text-white">{pending}</span>}
                        </button>
                    ))}
                </nav>
            </aside>

            <main className="flex min-w-0 flex-1 flex-col">
                {data?.isAdmin && !dismissed.includes(ANNOUNCEMENT.id) && (
                    <div className="flex h-[40px] shrink-0 items-center gap-[9px] bg-brand-100 pr-[9px] pl-[13px] text-[12px]">
                        <InfoCircle className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{ANNOUNCEMENT.text}</span>
                        <AriaButton aria-label="Dismiss" onPress={() => dismiss(ANNOUNCEMENT.id)} className="flex size-6 items-center justify-center rounded-md outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand-500">
                            <X className="size-4" />
                        </AriaButton>
                    </div>
                )}
                <header className="flex h-[48px] shrink-0 items-center gap-[1px] pl-[19px]">
                    <HistoryButtons canBack={history.back.length > 0} canForward={history.forward.length > 0} onBack={back} onForward={forward} />
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {!data && !error && <div className="py-16 text-center text-[12px] text-ink-muted">Loading…</div>}
                    {!data && error && <div className="py-16 text-center text-[12px] text-ink-muted">{error}</div>}
                    {data && !data.isAdmin && <MemberNotice data={data as MemberData} onExit={onExit} />}
                    {data?.isAdmin && <AdminPageView page={page} data={data} go={go} onExit={onExit} />}
                </div>
            </main>
        </div>
    );
}

function AdminPageView({ page, data, go, onExit }: { page: AdminPage; data: AdminData; go: (p: AdminPage) => void; onExit: () => void }) {
    switch (page) {
        case "dashboard":
            return <DashboardPage data={data} go={go} onExit={onExit} />;
        case "people":
            return <PeoplePage data={data} />;
        case "billing":
            return <BillingPage data={data} go={go} />;
        case "ai":
            return <AiCreditsPage data={data} />;
        case "content":
            return <ContentPage data={data} />;
        case "registry":
            return <RegistryPage data={data} />;
        case "settings":
            return <SettingsPage data={data} go={go} />;
    }
}
