import { CheckDone01, FlipBackward, FlipForward, LayoutAlt04, LayoutGrid01, PlusCircle, PuzzlePiece01, Rows03, Table, Type01, Image03 } from "@untitledui/icons";
import type { FC, SVGProps } from "react";
import {
    Button as AriaButton,
    Menu as AriaMenu,
    MenuTrigger as AriaMenuTrigger,
    Popover as AriaPopover,
    Separator as AriaSeparator,
    Tooltip as AriaTooltip,
    TooltipTrigger as AriaTooltipTrigger,
} from "react-aria-components";
import { MenuRow } from "../components/left-sidebar";
import { createFile, openFile } from "../engine/files";
import { ACTION_BY_ID, actionLabel, runAction } from "../engine/menu-actions";
import { editor, useEditor } from "../engine/store";
import { useAuth } from "../engine/auth";
import { openPanel, setView } from "./actions";
import { useReviews } from "./reviews";
import { tidyGrid } from "./model";
import { useCampaign, type RailPanel } from "./state";

// The narrow rail down the left edge: the main menu, the asset and grid views, the panels that
// add things (Templates, Text, Media, Inserts, Plugins), Bulk edit, and Undo and Redo at the foot.

const MENU_CLASS = "w-60 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";
const MENU_ITEMS = ["home", "campaignNew", "-", "undo", "redo", "-", "campaignTidy", "-", "saveVersion", "history", "duplicateFile", "-", "shortcuts", "actions"];
const OWN_ITEMS: Record<string, { label: string; run: () => void }> = {
    campaignNew: { label: "New campaign", run: () => void openFile(createFile("campaign").id) },
    campaignTidy: { label: "Tidy asset grid", run: tidyGrid },
};

// The app's mark in one colour, as the rail shows it.
function Mark(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <path d="M3.5 12.5v-9l4.5 4.5 4.5-4.5v9" />
        </svg>
    );
}

// The rail's tooltips: a 24pt dark label to the right, with a caret pointing back at the button.
const TIP = "relative flex h-6 items-center rounded-[5px] bg-tooltip px-2 text-[11px] text-white shadow-lg ring-1 ring-[#363636]";
function TipCaret() {
    return <span aria-hidden="true" className="absolute top-1/2 -left-[5px] -translate-y-1/2 border-y-[5px] border-r-[5px] border-y-transparent border-r-tooltip" />;
}

export function MainMenu() {
    const s = useEditor((state) => state);
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label="Main menu" className="flex size-8 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500">
                <Mark className="size-4" />
            </AriaButton>
            <AriaPopover placement="right top" offset={6} className={MENU_CLASS}>
                <AriaMenu aria-label="Main menu" className="outline-none" onAction={(key) => (OWN_ITEMS[String(key)]?.run ?? (() => runAction(String(key))))()}>
                    {MENU_ITEMS.map((id, i) => {
                        if (id === "-") return <AriaSeparator key={`sep-${i}`} className="my-1 h-px bg-white/10" />;
                        const own = OWN_ITEMS[id];
                        if (own) return <MenuRow key={id} id={id} label={own.label} />;
                        const action = ACTION_BY_ID.get(id);
                        return action ? <MenuRow key={id} id={id} label={actionLabel(action, s)} shortcut={action.shortcut} /> : null;
                    })}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

function RailButton({ icon: Icon, label, active, onPress, disabled, shortcut }: { icon: FC<SVGProps<SVGSVGElement>>; label: string; active?: boolean; onPress: () => void; disabled?: boolean; shortcut?: string }) {
    return (
        <AriaTooltipTrigger delay={400} closeDelay={0}>
            <AriaButton
                aria-label={label}
                aria-pressed={active}
                isDisabled={disabled}
                onPress={onPress}
                className={`flex size-8 items-center justify-center rounded-[5px] outline-none focus-visible:ring-1 focus-visible:ring-brand-500 disabled:opacity-35 ${active ? "bg-brand-100 text-brand-300" : "text-ink hover:bg-panel-hover"}`}
            >
                <Icon className="size-4" />
            </AriaButton>
            <AriaTooltip placement="right" offset={9} className={TIP}>
                <TipCaret />
                {label}
                {shortcut && <span className="ml-2 text-white/50">{shortcut}</span>}
            </AriaTooltip>
        </AriaTooltipTrigger>
    );
}

// The asset and grid views, a pair in one well.
function ViewButton({ icon: Icon, label, active, onPress }: { icon: FC<SVGProps<SVGSVGElement>>; label: string; active: boolean; onPress: () => void }) {
    return (
        <AriaTooltipTrigger delay={400} closeDelay={0}>
            <AriaButton aria-label={label} aria-pressed={active} onPress={onPress} className={`flex size-8 items-center justify-center rounded-[5px] outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${active ? "bg-panel text-ink ring-1 ring-panel-border ring-inset" : "text-ink hover:bg-panel-hover"}`}>
                <Icon className="size-4" />
            </AriaButton>
            <AriaTooltip placement="right" offset={9} className={TIP}>
                <TipCaret />
                {label}
            </AriaTooltip>
        </AriaTooltipTrigger>
    );
}

function Rule() {
    return <span className="h-px w-4 shrink-0 bg-panel-border" />;
}

const PANELS: { id: RailPanel; label: string; icon: FC<SVGProps<SVGSVGElement>> }[] = [
    { id: "templates", label: "Templates", icon: LayoutAlt04 },
    { id: "text", label: "Text", icon: Type01 },
    { id: "media", label: "Media", icon: Image03 },
    { id: "inserts", label: "Inserts", icon: PlusCircle },
    { id: "plugins", label: "Plugins", icon: PuzzlePiece01 },
];

// Reviews, with a dot while something waits for your review.
function ReviewsButton({ active }: { active: boolean }) {
    const user = useAuth((s) => s.user);
    const waiting = Object.values(useReviews()).some((r) => user && r.status !== "approved" && r.reviewers.some((p) => p.id === user.id) && !r.decisions[user.id]);
    return (
        <span className="relative">
            <RailButton icon={CheckDone01} label="Reviews" active={active} onPress={() => openPanel("reviews")} />
            {waiting && <span aria-label="Waiting for your review" className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-brand-500" />}
        </span>
    );
}

export function Rail() {
    const panel = useCampaign((s) => s.panel);
    const view = useCampaign((s) => s.view);
    const mode = useCampaign((s) => s.mode);
    const readOnly = useEditor((s) => s.readOnly);
    const canUndo = useEditor((s) => s.past.length > 0);
    const canRedo = useEditor((s) => s.future.length > 0);
    // Design mode keeps the panels that add whole things; Text and Media come with the product's own mode.
    const shown = PANELS.filter((p) => mode !== "design" || (p.id !== "text" && p.id !== "media") || panel === p.id);
    return (
        <nav aria-label="Campaign tools" className="flex h-full w-[50px] shrink-0 flex-col items-center border-r border-panel-border bg-panel pt-[5px] pb-[13px]">
            <MainMenu />
            <div className="h-[11px]" />
            <Rule />
            <div className="h-3" />
            <div className="flex flex-col overflow-hidden rounded-[5px] bg-field">
                <ViewButton icon={Rows03} label="Asset view" active={view === "asset" && panel !== "bulk"} onPress={() => setView("asset")} />
                <ViewButton icon={LayoutGrid01} label="Grid view" active={view === "grid" && panel !== "bulk"} onPress={() => setView("grid")} />
            </div>
            <div className="h-4" />
            <div className="flex flex-col gap-2">
                {shown.map((p) => (
                    <RailButton key={p.id} icon={p.icon} label={p.label} active={panel === p.id} disabled={readOnly && p.id !== "templates"} onPress={() => openPanel(p.id)} />
                ))}
            </div>
            <div className="h-3" />
            <Rule />
            <div className="h-3" />
            <RailButton icon={Table} label="Bulk edit" active={panel === "bulk"} disabled={readOnly} onPress={() => openPanel("bulk")} />
            <div className="h-2" />
            <ReviewsButton active={panel === "reviews"} />
            <div className="flex-1" />
            <div className="flex flex-col gap-1.5">
                <RailButton icon={FlipBackward} label="Undo" shortcut="⌘ Z" disabled={!canUndo || readOnly} onPress={() => editor.undo()} />
                <RailButton icon={FlipForward} label="Redo" shortcut="⇧ ⌘ Z" disabled={!canRedo || readOnly} onPress={() => editor.redo()} />
            </div>
        </nav>
    );
}
