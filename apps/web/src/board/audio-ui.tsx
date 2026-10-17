import { Headphones01, Microphone01, MicrophoneOff01 } from "@untitledui/icons";
import { useState } from "react";
import { joinAudio, leaveAudio, toggleCaptions, toggleMute, useSpeaking } from "../engine/audio";
import { useCollab } from "../engine/collab";

// Audio chat in the top right of a shared board: join, mute, captions and who's in the call, and the
// captions under the board while someone talks. The call itself is the file's (engine/audio.ts).

const pillButton = "flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] outline-none hover:bg-black/5";

export function AudioButton() {
    const joined = useCollab((s) => s.audio.on);
    const muted = useCollab((s) => s.audio.muted);
    const captions = useCollab((s) => s.audio.captions);
    const myName = useCollab((s) => s.me.name);
    const peers = useCollab((s) => s.peers);
    const speaking = useSpeaking();
    const live = useCollab((s) => s.status === "live");
    // Everyone in the call, you first (keyed "me", as the speaking levels are).
    const members: Record<string, string> = { me: myName, ...Object.fromEntries(Object.values(peers).filter((p) => p.audio).map((p) => [p.userId, p.name])) };
    const [open, setOpen] = useState(false);
    // Audio is for shared boards: the button shows once the board is live (or you're in a call).
    if (!live && !joined) return null;
    return (
        <span className="relative flex">
            <button type="button" aria-label="Audio" title={live ? "Audio" : "Audio works in shared boards"} aria-expanded={open} onClick={() => setOpen(!open)} className={`${pillButton} ${joined ? "text-[#14AE5C]" : ""}`}>
                <Headphones01 className="size-4" />
                {joined && Object.keys(members).length}
            </button>
            {open && (
                <div className="absolute right-0 top-full z-30 mt-2 w-60 rounded-xl bg-white p-3 text-[12px] text-[#1E1E1E] shadow-[0_2px_14px_rgba(0,0,0,0.16)]" role="dialog" aria-label="Audio">
                    {!joined ? (
                        <>
                            <p className="mb-2 text-black/60">{live ? "Talk with everyone in this board." : "Share this board to talk with others in it."}</p>
                            <button type="button" disabled={!live} onClick={() => void joinAudio()} className="h-8 w-full rounded-lg bg-[#14AE5C] font-semibold text-white hover:bg-[#0F9950] disabled:opacity-40">Join audio</button>
                        </>
                    ) : (
                        <div className="space-y-2">
                            <ul className="space-y-1">
                                {Object.entries(members).map(([id, name]) => (
                                    <li key={id} className="flex items-center gap-2">
                                        <span className={`size-2 rounded-full ${speaking[id] ? "bg-[#14AE5C]" : "bg-black/20"}`} />
                                        <span className="truncate">{name}</span>
                                    </li>
                                ))}
                            </ul>
                            <div className="flex gap-1">
                                <button type="button" aria-pressed={muted} onClick={toggleMute} className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-black/5 hover:bg-black/10">{muted ? <MicrophoneOff01 className="size-4" /> : <Microphone01 className="size-4" />}{muted ? "Unmute" : "Mute"}</button>
                                <button type="button" aria-pressed={captions} onClick={toggleCaptions} className={`h-8 flex-1 rounded-lg ${captions ? "bg-[#9747FF] text-white" : "bg-black/5 hover:bg-black/10"}`}>Captions</button>
                            </div>
                            <button type="button" onClick={() => void leaveAudio()} className="h-8 w-full rounded-lg bg-[#F24822] font-semibold text-white hover:bg-[#DC3412]">Leave audio</button>
                        </div>
                    )}
                </div>
            )}
        </span>
    );
}

export function Captions() {
    // Each person's live caption travels with their presence and clears itself after a pause.
    const peers = useCollab((s) => s.peers);
    const recent = Object.values(peers).filter((p) => p.audio && p.caption);
    if (!recent.length) return null;
    return (
        <div className="pointer-events-none flex max-w-xl flex-col items-center gap-1" aria-live="polite">
            {recent.map((p) => (
                <p key={p.userId} className="rounded-lg bg-black/80 px-3 py-1.5 text-[13px] text-white">
                    <span className="font-semibold">{p.name}: </span>
                    {p.caption}
                </p>
            ))}
        </div>
    );
}
