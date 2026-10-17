import { useEffect, useRef, useState } from "react";
import { ChevronDown, Headphones01, Microphone01, MicrophoneOff01, PhoneHangUp } from "@untitledui/icons";
import { joinAudio, leaveAudio, toggleCaptions, toggleMute, useSpeaking } from "../engine/audio";
import { Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Popover as AriaPopover, Button as AriaButton } from "react-aria-components";
import { worldToScreen } from "../engine/camera";
import { discardUnsynced, myCursor, retrySync, useCollab } from "../engine/collab";
import { timeAgo } from "../engine/comments";
import { answerSpotlightAsk, askToSpotlight, closeCursorChat, declineSpotlight, follow, joinSpotlightNow, sendChat, setChat, setSpotlight, stopFollowing } from "../engine/follow";
import { useEditor } from "../engine/store";
import { Avatar } from "./avatar";

function textOn(hex: string): string {
    const n = parseInt(hex.replace("#", ""), 16);
    return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 186 ? "#1E1E1E" : "#FFFFFF";
}

// A coloured frame round the canvas while you follow someone (or spotlight yourself).
export function FollowFrame() {
    const following = useCollab((s) => (s.following ? s.peers[s.following] : undefined));
    const spotlight = useCollab((s) => s.spotlight);
    const me = useCollab((s) => s.me);
    const presenting = useEditor((s) => s.presentingId !== null);
    if (presenting || (!following && !spotlight)) return null;
    const color = following ? following.color : me.color;
    const label = following ? (following.spotlight ? `${following.name || "Guest"} is spotlighting` : `Following ${following.name || "Guest"}`) : "You're spotlighting";
    return (
        <div className="pointer-events-none absolute inset-0 z-20" style={{ boxShadow: `inset 0 0 0 3px ${color}` }}>
            <div data-follow-ui className="pointer-events-auto absolute top-0 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-b-md px-2.5 py-1 text-[11px] font-medium shadow" style={{ background: color, color: textOn(color) }}>
                {label}
                <button type="button" onClick={() => (following ? stopFollowing() : setSpotlight(false))} className="rounded px-1.5 py-0.5 underline-offset-2 hover:underline">
                    {following ? "Stop following" : "Stop"}
                </button>
            </div>
        </div>
    );
}

// Cursor chat: your message box at your cursor, and everyone else's messages at theirs.
export function CursorChat() {
    const open = useCollab((s) => s.chatOpen);
    const me = useCollab((s) => s.me);
    const peers = useCollab((s) => s.peers);
    const camera = useEditor((s) => s.camera);
    const pageId = useEditor((s) => s.pageId);
    const cursor = myCursor();
    const at = cursor ? worldToScreen(camera, cursor.x, cursor.y) : null;
    return (
        <>
            {Object.values(peers)
                .filter((p) => p.chat && p.cursor && p.pageId === pageId)
                .map((p) => {
                    const q = worldToScreen(camera, p.cursor?.x ?? 0, p.cursor?.y ?? 0);
                    return (
                        <div key={p.userId} className="pointer-events-none absolute max-w-60 rounded-2xl rounded-tl-sm px-3 py-1.5 text-[12px] leading-snug shadow-lg [overflow-wrap:anywhere]" style={{ left: q.x + 14, top: q.y + 40, background: p.color, color: textOn(p.color) }}>
                            {p.chat}
                        </div>
                    );
                })}
            {open && at && <ChatInput at={at} color={me.color} />}
        </>
    );
}

function ChatInput({ at, color }: { at: { x: number; y: number }; color: string }) {
    const [text, setText] = useState("");
    const [sent, setSent] = useState<string | null>(null);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        const t = window.setTimeout(() => input.current?.focus(), 20);
        return () => window.clearTimeout(t);
    }, []);
    return (
        <div className="pointer-events-auto absolute flex max-w-72 flex-col gap-1 rounded-2xl rounded-tl-sm px-3 py-1.5 shadow-lg" style={{ left: at.x + 14, top: at.y + 16, background: color, color: textOn(color) }} onPointerDown={(e) => e.stopPropagation()}>
            {sent && <span className="text-[12px] opacity-70">{sent}</span>}
            <input
                ref={input}
                value={text}
                maxLength={200}
                aria-label="Cursor chat"
                placeholder={sent ? "" : "Say something"}
                onChange={(e) => {
                    setText(e.target.value);
                    setChat(e.target.value);
                }}
                onBlur={closeCursorChat}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") closeCursorChat();
                    if (e.key === "Enter" && text.trim()) {
                        sendChat(text.trim());
                        setSent(text.trim());
                        setText("");
                    }
                }}
                className="w-52 bg-transparent text-[12px] outline-none placeholder:text-current placeholder:opacity-60"
            />
        </div>
    );
}

// The avatar stack: click someone to follow them; your own avatar opens Spotlight and the viewer list.
// `chevron` adds a small arrow after your avatar (the slides editor's header), opening the same menu.
export function PresenceAvatars({ chevron }: { chevron?: boolean } = {}) {
    const status = useCollab((s) => s.status);
    const me = useCollab((s) => s.me);
    const peers = useCollab((s) => s.peers);
    const following = useCollab((s) => s.following);
    const spotlight = useCollab((s) => s.spotlight);
    const viewers = useCollab((s) => s.viewers);
    const uid = useCollab((s) => s.uid);
    const others = Object.values(peers);
    const live = status === "live";
    return (
        <div className="flex min-w-0 items-center gap-1.5" data-follow-ui>
            <div className="flex -space-x-1.5">
                <AriaDialogTrigger>
                    <AriaButton aria-label="Your menu" className={`flex items-center outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-full`}>
                        <Avatar name={me.name || "You"} color={me.color} ring={!chevron} />
                        {/* The design header's avatar: no ring, and a 24pt round chevron joined to it. */}
                        {chevron && (
                            <span className="-ml-0.5 flex size-6 items-center justify-center rounded-full bg-panel-hover text-ink-muted">
                                <ChevronDown className="size-3" />
                            </span>
                        )}
                    </AriaButton>
                    <AriaPopover placement="bottom end" offset={6} className="w-64 rounded-lg bg-tooltip p-1 text-[11px] text-white shadow-xl outline-none">
                        <AriaDialog aria-label="People in this file" className="outline-none" data-follow-ui>
                            {({ close }) => (
                                <div>
                                    <div className="flex items-center gap-2 px-2 py-1.5">
                                        <Avatar name={me.name || "You"} color={me.color} size={20} />
                                        <span className="flex-1 truncate font-semibold">{me.name || "You"} (you)</span>
                                    </div>
                                    {live && (
                                        <button type="button" onClick={() => (setSpotlight(!spotlight), close())} className="flex h-7 w-full items-center rounded px-2 text-left hover:bg-brand-500">
                                            {spotlight ? "Stop spotlighting" : "Spotlight me"}
                                        </button>
                                    )}
                                    {live && others.length > 0 && (
                                        <>
                                            <div className="my-1 h-px bg-white/10" />
                                            <div className="px-2 pt-1 pb-1 text-[10px] text-white/50">In this file</div>
                                            {others.map((p) => (
                                                <div key={p.userId} className="group flex h-8 items-center rounded hover:bg-brand-500">
                                                    <button type="button" onClick={() => (follow(following === p.userId ? null : p.userId), close())} className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left">
                                                        <Avatar name={p.name || "Guest"} color={p.color} size={18} />
                                                        <span className="min-w-0 flex-1 truncate">{p.name || "Guest"}</span>
                                                        <span className="text-white/60 group-hover:hidden">{following === p.userId ? "Following" : p.spotlight ? "Spotlighting" : p.mode === "dev" ? "Inspect" : "Follow"}</span>
                                                    </button>
                                                    {!p.spotlight && (
                                                        <button type="button" onClick={() => (askToSpotlight(p.userId), close())} className="mr-1 hidden h-6 shrink-0 rounded bg-white/15 px-1.5 text-[10px] group-hover:block hover:bg-white/25">
                                                            Ask to spotlight
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </>
                                    )}
                                    {live && viewers.filter((v) => v.uid !== uid).length > 0 && (
                                        <>
                                            <div className="my-1 h-px bg-white/10" />
                                            <div className="px-2 pt-1 pb-1 text-[10px] text-white/50">Viewers</div>
                                            <div className="max-h-48 overflow-y-auto">
                                                {viewers
                                                    .filter((v) => v.uid !== uid)
                                                    .map((v) => (
                                                        <div key={v.uid} className="flex h-7 items-center gap-2 px-2">
                                                            <Avatar name={v.name || "Guest"} color={v.color} size={16} />
                                                            <span className="min-w-0 flex-1 truncate">{v.name || "Guest"}</span>
                                                            <span className="text-white/50">{others.some((p) => p.name === v.name) ? "Here now" : timeAgo(v.at)}</span>
                                                        </div>
                                                    ))}
                                            </div>
                                        </>
                                    )}
                                    {!live && <p className="px-2 py-1.5 text-white/60">Share this file to see who's here, follow them and spotlight.</p>}
                                </div>
                            )}
                        </AriaDialog>
                    </AriaPopover>
                </AriaDialogTrigger>
                {others.slice(0, 4).map((p) => (
                    <button
                        key={p.userId}
                        type="button"
                        title={following === p.userId ? `Stop following ${p.name}` : `Follow ${p.name || "Guest"}`}
                        aria-label={following === p.userId ? `Stop following ${p.name}` : `Follow ${p.name || "Guest"}`}
                        onClick={() => follow(following === p.userId ? null : p.userId)}
                        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                        <Avatar name={p.name || "Guest"} color={p.color} ring />
                    </button>
                ))}
                {others.length > 4 && <span className="flex size-6 items-center justify-center rounded-full bg-field text-[10px] font-semibold ring-2 ring-panel">+{others.length - 4}</span>}
            </div>
            {status !== "local" && <span title={status === "live" ? "Connected" : status === "connecting" ? "Connecting" : "Reconnecting"} className={`size-1.5 shrink-0 rounded-full ${status === "live" ? "bg-emerald-400" : "animate-pulse bg-amber-400"}`} />}
            <AudioControls />
            <UnsyncedButton />
            <SpotlightPrompts />
            <Captions />
        </div>
    );
}

// Audio: join the file's call; in it, mute, captions and leave. Avatars of people in the call
// light up while they speak.
function AudioControls() {
    const status = useCollab((s) => s.status);
    const audio = useCollab((s) => s.audio);
    const peers = useCollab((s) => s.peers);
    const me = useCollab((s) => s.me);
    const speaking = useSpeaking();
    if (status !== "live") return null;
    const inCall = Object.values(peers).filter((p) => p.audio);
    const btn = "flex size-6 shrink-0 items-center justify-center rounded-md outline-none hover:bg-panel-hover";
    if (!audio.on)
        return (
            <button type="button" title={inCall.length ? `Join audio (${inCall.length} talking)` : "Start audio"} aria-label={inCall.length ? `Join audio, ${inCall.length} in the call` : "Start audio"} onClick={() => void joinAudio()} className={`${btn} relative text-ink-muted hover:text-ink`}>
                <Headphones01 className="size-4" />
                {inCall.length > 0 && <span className="absolute -top-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-emerald-500 text-[8px] font-bold text-white">{inCall.length}</span>}
            </button>
        );
    return (
        <span className="flex items-center gap-0.5 rounded-md bg-emerald-500/10 px-0.5">
            <span className="flex -space-x-1 px-1" aria-label="In the call">
                {[{ id: "me", name: "You", color: me.color }, ...inCall.map((p) => ({ id: p.userId, name: p.name || "Guest", color: p.color }))].slice(0, 5).map((p) => (
                    <span key={p.id} title={p.name} className={`rounded-full ${speaking[p.id] ? "ring-2 ring-emerald-400" : ""}`}>
                        <Avatar name={p.name} color={p.color} size={16} />
                    </span>
                ))}
            </span>
            <button type="button" title={audio.muted ? "Unmute" : "Mute"} aria-label={audio.muted ? "Unmute" : "Mute"} onClick={toggleMute} className={`${btn} ${audio.muted ? "text-red-400" : "text-ink"}`}>
                {audio.muted ? <MicrophoneOff01 className="size-3.5" /> : <Microphone01 className="size-3.5" />}
            </button>
            <button type="button" title={audio.captions ? "Hide captions" : "Show captions"} aria-label={audio.captions ? "Hide captions" : "Show captions"} aria-pressed={audio.captions} onClick={toggleCaptions} className={`${btn} text-[9px] font-bold ${audio.captions ? "text-brand-500" : "text-ink-muted"}`}>
                CC
            </button>
            <button type="button" title="Leave audio" aria-label="Leave audio" onClick={() => void leaveAudio()} className={`${btn} text-red-400`}>
                <PhoneHangUp className="size-3.5" />
            </button>
        </span>
    );
}

// Live captions from the people in the call, over the bottom of the canvas.
function Captions() {
    const audio = useCollab((s) => s.audio);
    const peers = useCollab((s) => s.peers);
    const mine = useCollab((s) => s.caption);
    const me = useCollab((s) => s.me);
    if (!audio.on || !audio.captions) return null;
    const lines = [...Object.values(peers).filter((p) => p.audio && p.caption).map((p) => ({ id: p.userId, name: p.name || "Guest", color: p.color, text: p.caption ?? "" })), ...(mine ? [{ id: "me", name: me.name || "You", color: me.color, text: mine }] : [])];
    if (!lines.length) return null;
    return (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-40 flex w-[560px] max-w-[80vw] -translate-x-1/2 flex-col gap-1" aria-live="polite">
            {lines.map((l) => (
                <div key={l.id} className="rounded-md bg-black/75 px-3 py-1.5 text-[13px] text-white">
                    <b style={{ color: l.color }}>{l.name}</b> {l.text}
                </div>
            ))}
        </div>
    );
}

// Offline with changes the server hasn't got: a count that opens what can be done about them.
function UnsyncedButton() {
    const status = useCollab((s) => s.status);
    const unsynced = useCollab((s) => s.unsynced);
    if (status === "live" || status === "local" || unsynced === 0) return null;
    return (
        <AriaDialogTrigger>
            <AriaButton className="flex h-6 shrink-0 items-center rounded-md bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-500 outline-none hover:bg-amber-500/25">{unsynced} unsynced</AriaButton>
            <AriaPopover placement="bottom end" offset={6} className="w-72 rounded-lg border border-panel-border bg-panel-raised p-3 text-[12px] text-ink shadow-xl outline-none">
                <AriaDialog aria-label="Unsynced changes" className="space-y-2 outline-none">
                    {({ close }) => (
                        <>
                            <div className="font-semibold">Unsynced changes</div>
                            <p className="text-[11px] text-ink-muted">
                                {unsynced} change{unsynced === 1 ? " is" : "s are"} saved in this browser and sync when the server can be reached again. They're kept for 30 days, even if you close the file.
                            </p>
                            <div className="flex justify-end gap-2 pt-1">
                                <button type="button" onClick={() => window.confirm(`Discard ${unsynced} unsynced change${unsynced === 1 ? "" : "s"}? They can't be brought back.`) && (discardUnsynced(), close())} className="h-7 rounded-md px-2 text-[11px] text-red-400 hover:bg-panel-hover">
                                    Discard changes
                                </button>
                                <button type="button" onClick={() => (retrySync(), close())} className="h-7 rounded-md bg-brand-500 px-2.5 text-[11px] font-semibold text-white hover:bg-brand-600">
                                    Try again now
                                </button>
                            </div>
                        </>
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

// Spotlight prompts at the top of the window: a countdown before following someone's spotlight
// (with "Not now"), and someone asking you to spotlight.
function SpotlightPrompts() {
    const prompt = useCollab((s) => s.spotlightPrompt);
    const asked = useCollab((s) => s.askedToSpotlight);
    const [now, setNow] = useState(0);
    useEffect(() => {
        if (!prompt) return;
        const t = window.setInterval(() => setNow(Date.now()), 250);
        return () => window.clearInterval(t);
    }, [prompt]);
    if (!prompt && !asked) return null;
    const left = prompt ? Math.min(3, Math.max(1, Math.ceil((prompt.until - (now || prompt.until - 3000)) / 1000))) : 0;
    const toast = "pointer-events-auto flex items-center gap-2 rounded-lg bg-tooltip py-1.5 pr-1.5 pl-2.5 text-[12px] text-white shadow-xl";
    return (
        <div className="pointer-events-none fixed top-12 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" data-follow-ui>
            {prompt && (
                <div className={toast} role="status">
                    <Avatar name={prompt.name} color={prompt.color} size={18} />
                    <span>
                        {prompt.name} is spotlighting. Following in {left}…
                    </span>
                    <button type="button" onClick={declineSpotlight} className="h-6 rounded-md bg-white/10 px-2 hover:bg-white/20">
                        Not now
                    </button>
                    <button type="button" onClick={joinSpotlightNow} className="h-6 rounded-md bg-brand-500 px-2 font-semibold hover:bg-brand-600">
                        Follow
                    </button>
                </div>
            )}
            {asked && (
                <div className={toast} role="alert">
                    <Avatar name={asked.name} color={asked.color} size={18} />
                    <span>{asked.name} asked you to spotlight</span>
                    <button type="button" onClick={() => answerSpotlightAsk(false)} className="h-6 rounded-md bg-white/10 px-2 hover:bg-white/20">
                        Not now
                    </button>
                    <button type="button" onClick={() => answerSpotlightAsk(true)} className="h-6 rounded-md bg-brand-500 px-2 font-semibold hover:bg-brand-600">
                        Spotlight me
                    </button>
                </div>
            )}
        </div>
    );
}
