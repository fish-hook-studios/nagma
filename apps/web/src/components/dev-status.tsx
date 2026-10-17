import { CheckCircle, Code02 } from "@untitledui/icons";
import { useRef, useState } from "react";
import { Menu as AriaMenu, MenuItem as AriaMenuItem, Popover as AriaPopover, Separator as AriaSeparator, Dialog as AriaDialog } from "react-aria-components";
import { DEV_COLORS } from "../canvas/dev-badges";
import { DEV_NOTIFY_OPTIONS, type DevNotifyChannel, devNotifyChannel, setDevNotifyChannel } from "../engine/dev-notify";
import { type DevStatus, DEV_STATUS_LABELS, devStatusOf, devStatusTargets, setDevStatus } from "../engine/dev-status";
import { openDevStatusMenu, setDevMenu, useDevMenu } from "./dev-status-state";
import { useEditor } from "../engine/store";
import { MenuRow } from "./left-sidebar";

export function DevStatusMenu() {
    const state = useDevMenu();
    const doc = useEditor((s) => s.doc);
    const anchor = useRef<HTMLDivElement>(null);
    const [channel, setChannel] = useState<DevNotifyChannel>(devNotifyChannel);
    if (!state) return null;
    const nodes = state.ids.map((id) => doc.nodes[id]).filter((n) => n !== undefined);
    if (!nodes.length) return null;
    const statuses = new Set(nodes.map((n) => devStatusOf(doc, n)));
    const status = statuses.size === 1 ? ([...statuses][0] ?? null) : null;
    const close = () => setDevMenu(null);
    return (
        <>
            <div ref={anchor} className="pointer-events-none fixed size-0" style={{ left: state.x, top: state.y }} />
            <AriaPopover triggerRef={anchor} isOpen onOpenChange={(open) => !open && close()} placement="bottom start" offset={4} className="w-60 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                {state.asking ? (
                    <ChangeNote
                        onCancel={close}
                        onDone={(note) => {
                            close();
                            setDevStatus(state.ids, "ready", note);
                        }}
                    />
                ) : (
                    <AriaMenu
                        aria-label="Dev status"
                        autoFocus="first"
                        className="outline-none"
                        onAction={(key) => {
                            const k = String(key);
                            if (k.startsWith("notify:")) {
                                const c = k.slice(7) as DevNotifyChannel;
                                setDevNotifyChannel(c);
                                setChannel(c);
                                return;
                            }
                            if (k === "ready") {
                                if (status === "changed") setDevMenu({ ...state, asking: true });
                                else {
                                    close();
                                    setDevStatus(state.ids, "ready");
                                }
                                return;
                            }
                            close();
                            if (k === "completed") setDevStatus(state.ids, "completed");
                            else if (k === "remove") setDevStatus(state.ids, null);
                        }}
                    >
                        {status && <MenuRow id="current" label={DEV_STATUS_LABELS[status]} checked />}
                        {status === "changed" && nodes[0]?.devStatusNote && <MenuRow id="note" label={`Last note: ${nodes[0].devStatusNote}`} />}
                        {status && <AriaSeparator className="my-1 h-px bg-white/10" />}
                        {status !== "ready" && <MenuRow id="ready" label={status === "changed" ? "Mark as ready for dev again…" : "Mark as ready for dev"} />}
                        {status === "ready" && <MenuRow id="completed" label="Mark as completed" />}
                        {status && <MenuRow id="remove" label="Remove status" />}
                        <AriaSeparator className="my-1 h-px bg-white/10" />
                        <AriaMenuItem id="section:notify" isDisabled textValue="Notifications" className="px-2 pt-1.5 pb-1 text-[10px] font-medium text-white/50 outline-none">
                            Notifications
                        </AriaMenuItem>
                        {DEV_NOTIFY_OPTIONS.map(([id, label]) => (
                            <MenuRow key={id} id={`notify:${id}`} label={label} checked={channel === id} />
                        ))}
                    </AriaMenu>
                )}
            </AriaPopover>
        </>
    );
}

function ChangeNote({ onCancel, onDone }: { onCancel: () => void; onDone: (note: string) => void }) {
    const [note, setNote] = useState("");
    return (
        <AriaDialog aria-label="What changed" className="space-y-2 p-2 outline-none">
            <div className="text-[11px] font-semibold">What changed?</div>
            <p className="text-[11px] text-white/60">Developers see this note with the design, and it is kept in version history.</p>
            <textarea
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" && !e.shiftKey && note.trim()) {
                        e.preventDefault();
                        onDone(note.trim());
                    }
                    if (e.key === "Escape") onCancel();
                }}
                rows={3}
                placeholder="Describe the change"
                aria-label="What changed"
                className="w-full resize-none rounded-md bg-white/10 px-2 py-1.5 text-[11px] text-white outline-none placeholder:text-white/40 focus:ring-1 focus:ring-brand-500"
            />
            <div className="flex justify-end gap-1">
                <button type="button" onClick={onCancel} className="h-6 rounded-md px-2 text-[11px] text-white/70 hover:bg-white/10">
                    Cancel
                </button>
                <button type="button" disabled={!note.trim()} onClick={() => onDone(note.trim())} className="h-6 rounded-md bg-brand-500 px-2 text-[11px] font-medium text-white disabled:opacity-40">
                    Mark as ready
                </button>
            </div>
        </AriaDialog>
    );
}

// The Design panel header for a frame or section: "Mark as ready for dev", or the status chip.
export function DevStatusButton({ ids }: { ids: string[] }) {
    const doc = useEditor((s) => s.doc);
    const targets = devStatusTargets(doc, ids);
    if (!targets.length || targets.length !== ids.length) return null;
    const statuses = new Set(targets.map((n) => devStatusOf(doc, n)));
    const status: DevStatus | null = statuses.size === 1 ? ([...statuses][0] ?? null) : null;
    const open = (e: React.MouseEvent<HTMLButtonElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (!status) setDevStatus(ids, "ready");
        else openDevStatusMenu(ids, r.left, r.bottom);
    };
    if (!status) {
        return (
            <button type="button" onClick={open} title="Mark as ready for dev" aria-label="Mark as ready for dev" className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                <Code02 className="size-3.5" />
            </button>
        );
    }
    const Icon = status === "completed" ? CheckCircle : Code02;
    return (
        <button type="button" onClick={open} className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-white" style={{ background: DEV_COLORS[status] }}>
            <Icon className="size-3" />
            {DEV_STATUS_LABELS[status]}
        </button>
    );
}
