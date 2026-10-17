import { ChevronDown, PauseCircle, Plus, StopCircle, VolumeMax, VolumeX, X } from "@untitledui/icons";
import { useRef, useState } from "react";
import { board, useBoard } from "./state";
import { MAX_TIMER, TRACKS, addTime, formatTime, musicVolume, pauseTimer, resumeTimer, setMusicVolume, setTrack, startTimer, stopTimer, toggleMusic, useBoardTimer, useTimerSound } from "./timer";
import { VotingCard } from "./voting-ui";
import { useVoting, votingOpen } from "./voting";

// "Timer, music, and voting" at the top right: a pill showing the timer (or, while a vote runs,
// "Stamp your 3 favorites"), and a 240-wide panel under it with your volume, the timer card, the
// music card and the voting card stacked.

const DEFAULT_MS = 3 * 60 * 1000;

function RecordIcon() {
    return (
        <svg width="24" height="18" viewBox="0 0 24 18" aria-hidden="true">
            <circle cx="9" cy="9" r="8" fill="#1E1E1E" />
            <circle cx="9" cy="9" r="3.4" fill="#8C8C8C" />
            <circle cx="9" cy="9" r="0.9" fill="#1E1E1E" />
            <path d="M18 3.2 L19.2 6 L22 6.3 L19.9 8.2 L20.5 11 L18 9.6 L15.5 11 L16.1 8.2 L14 6.3 L16.8 6 Z" fill="#FFCD29" stroke="#E0A800" strokeWidth=".5" />
        </svg>
    );
}

export function MeetingsButton() {
    const open = useBoard((s) => s.meetings);
    const ref = useRef<HTMLButtonElement>(null);
    // At 00:00 the countdown shakes for everyone (and chimes); the music plays from here.
    const { timer, left } = useTimerSound(() => ref.current?.animate([{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }], { duration: 160, iterations: 6 }));
    const ended = Boolean(timer?.endsAt) && left === 0;
    const v = useVoting();
    if (v && votingOpen(v)) {
        return (
            <button ref={ref} type="button" aria-label="Timer, music, and voting" aria-expanded={Boolean(open)} onClick={() => board.set({ meetings: open ? null : "voting" })} className="flex h-8 items-center gap-1.5 rounded-[5px] bg-[#EFE6FD] px-2 text-[12px] text-[#7C3AED] outline-none hover:bg-[#E6D9FC]">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.2 L9.9 5.6 L14.6 6 L11 9.1 L12.1 13.7 L8 11.2 L3.9 13.7 L5 9.1 L1.4 6 L6.1 5.6 Z" fill="#FFCD29" stroke="#E0A800" strokeWidth=".6" /></svg>
                <span className="max-w-40 truncate">{v.prompt || `Stamp your ${v.limit} favorite${v.limit === 1 ? "" : "s"}`}</span>
            </button>
        );
    }
    const shown = timer ? left : DEFAULT_MS;
    return (
        <button
            ref={ref}
            type="button"
            aria-label="Timer, music, and voting"
            title="Timer, music, and voting"
            aria-expanded={Boolean(open)}
            onClick={() => board.set({ meetings: open ? null : "timer" })}
            className={`-ml-1 mr-1 flex h-8 w-[97px] items-center justify-center gap-1.5 rounded-[5px] border border-black/10 px-1.5 outline-none ${open ? "bg-[#EFE6FD]" : "hover:bg-black/5"} ${timer && !timer.endsAt ? "animate-pulse" : ""}`}
        >
            <RecordIcon />
            <span className={`text-[15px] font-light italic tabular-nums tracking-wide ${ended ? "text-[#F24822]" : timer?.endsAt ? "text-[#7C3AED]" : "text-black/40"}`}>{formatTime(shown)}</span>
        </button>
    );
}

function PlayRound({ label, onPress, disabled, playing }: { label: string; onPress: () => void; disabled?: boolean; playing?: boolean }) {
    return (
        <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onPress} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#9747FF] text-white outline-none ring-1 ring-[#9747FF]/30 hover:bg-[#8638E5] disabled:opacity-40">
            {playing ? (
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="2.6" height="9" rx=".6" fill="currentColor" /><rect x="7.4" y="1.5" width="2.6" height="9" rx=".6" fill="currentColor" /></svg>
            ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 1.8 L12 7 L3.5 12.2 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
            )}
        </button>
    );
}

// The reference panel (240×594): 48 header, 48 volume, 168 timer, 162 music, 168 voting.
const section = "border-b border-black/10 px-4 pb-5 pt-4";

export function MeetingsPanel() {
    const tab = useBoard((s) => s.meetings);
    const [, setVol] = useState(musicVolume());
    if (!tab) return null;
    return (
        <div className="pointer-events-auto absolute right-3 top-[68px] z-20 max-h-[calc(100%-80px)] w-[240px] overflow-y-auto rounded-[13px] bg-white text-[#1E1E1E] shadow-[0_0_0.5px_rgba(0,0,0,0.18),0_1px_3px_rgba(0,0,0,0.1),0_5px_14px_rgba(0,0,0,0.1)]" role="dialog" aria-label="Timer, music, and voting">
            <div className="flex h-12 items-center justify-between border-b border-black/10 pl-4 pr-2">
                <span className="text-[13px] font-semibold">Timer, music, and voting</span>
                <button type="button" aria-label="Close" onClick={() => board.set({ meetings: null })} className="flex size-8 items-center justify-center rounded-[5px] hover:bg-black/5"><X className="size-4" /></button>
            </div>
            <div className="flex h-12 items-center gap-3 border-b border-black/10 px-4">
                <button type="button" aria-label={musicVolume() ? "Mute music for me" : "Unmute music for me"} onClick={() => { setMusicVolume(musicVolume() ? 0 : 1); setVol(musicVolume()); }} className="rounded p-0.5 hover:bg-black/5">
                    {musicVolume() ? <VolumeMax className="size-4" /> : <VolumeX className="size-4" />}
                </button>
                <input type="range" aria-label="Your music volume" min={0} max={100} value={Math.round(musicVolume() * 100)} onChange={(e) => { setMusicVolume(Number(e.target.value) / 100); setVol(musicVolume()); }} className="h-2 flex-1 accent-[#9747FF]" />
            </div>
            <TimerCard />
            <MusicCard />
            <div className="px-4 pb-4 pt-4">
                <VotingCard focus={tab === "voting"} />
            </div>
        </div>
    );
}

function TimerCard() {
    const { timer, left } = useBoardTimer();
    const running = Boolean(timer?.endsAt) && left > 0;
    const [draft, setDraft] = useState(DEFAULT_MS);
    const [presets, setPresets] = useState(false);
    // After 00:00 the timer reads 00:00 until you set a new time.
    const done = Boolean(timer) && left === 0;
    const [edited, setEdited] = useState(false);
    if (edited && !done) setEdited(false);
    const shown = timer && !(done && edited) ? left : draft;
    const editable = !timer || done;
    const set = (ms: number) => {
        setDraft(Math.max(0, Math.min(MAX_TIMER, ms)));
        if (done) setEdited(true);
    };
    const minutes = Math.floor(shown / 60000);
    const seconds = Math.floor((shown % 60000) / 1000);
    const field = (value: number, unit: "m" | "s") => (
        <input
            aria-label={unit === "m" ? "Minutes" : "Seconds"}
            inputMode="numeric"
            disabled={!editable}
            value={String(value).padStart(2, "0")}
            onChange={(e) => {
                const v = Math.min(unit === "m" ? 99 : 59, Number(e.target.value.replace(/[^0-9]/g, "").slice(-2)) || 0);
                set(unit === "m" ? v * 60000 + seconds * 1000 : minutes * 60000 + v * 1000);
            }}
            onKeyDown={(e) => {
                const step = (unit === "m" ? 60000 : 1000) * (e.shiftKey ? 5 : 1);
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    set(shown + (e.key === "ArrowUp" ? step : -step));
                } else if (e.key === "Enter" && shown > 0) startTimer(shown);
            }}
            className="w-[2.2ch] bg-transparent text-center outline-none disabled:text-[#1E1E1E] focus:rounded focus:bg-[#9747FF]/10"
        />
    );
    return (
        <div className={section}>
            <div className={`flex h-[88px] items-center justify-center rounded-lg bg-[#F5F5F5] text-[44px] font-light italic leading-none tabular-nums ${done && !edited ? "text-[#F24822]" : ""}`}>
                {field(minutes, "m")}
                <span className="pb-1">:</span>
                {field(seconds, "s")}
            </div>
            <div className="relative mt-[11px] flex items-center gap-1">
                <button type="button" onClick={() => (editable ? set(shown + 60000) : addTime(60 * 1000))} className="flex h-6 items-center gap-1 rounded-[5px] border border-black/10 px-2 text-[11px] hover:bg-black/5"><Plus className="size-3.5" />1 min</button>
                {editable && (
                    <button type="button" aria-label="Preset times" aria-expanded={presets} onClick={() => setPresets(!presets)} className="flex size-6 items-center justify-center rounded-[5px] hover:bg-black/5"><ChevronDown className="size-3.5" /></button>
                )}
                {presets && editable && (
                    <div className="absolute left-0 top-full z-10 mt-1 flex w-32 flex-col rounded-lg bg-[#1E1E1E] p-1 text-white shadow-xl">
                        {[1, 3, 5, 10].map((m) => (
                            <button key={m} type="button" onClick={() => { set(m * 60000); setPresets(false); }} className="h-6 rounded px-2 text-left text-[11px] hover:bg-[#9747FF]">{m} min</button>
                        ))}
                    </div>
                )}
                {timer && <button type="button" aria-label="Stop" title="Stop" onClick={stopTimer} className="ml-auto flex size-6 items-center justify-center rounded-[5px] hover:bg-black/5"><StopCircle className="size-4" /></button>}
                <span className={timer ? "ml-1" : "ml-auto"}>
                    {running ? (
                        <PlayRound label="Pause" playing onPress={pauseTimer} />
                    ) : (
                        <PlayRound label="Start" disabled={shown <= 0} onPress={() => (timer && left > 0 ? resumeTimer() : startTimer(shown))} />
                    )}
                </span>
            </div>
        </div>
    );
}

function MusicCard() {
    const { timer } = useBoardTimer();
    const playing = Boolean(timer?.music);
    const track = timer?.track ?? "calm";
    return (
        <div className={section}>
            <div className="flex h-[83px] items-center justify-between rounded-lg bg-[#F5F5F5] pr-5">
                <svg width="104" height="96" viewBox="0 0 104 96" aria-hidden="true" className="-ml-1.5">
                    <circle cx="44" cy="48" r="46" fill="#111" />
                    {[40, 34, 28].map((r) => <circle key={r} cx="44" cy="48" r={r} fill="none" stroke="#333" strokeWidth=".8" />)}
                    <circle cx="44" cy="48" r="20" fill="#8C8C8C" />
                    <path d="M33 52 Q38 42 47 44 L52 38 L54 44 Q50 54 40 54 Z" fill="none" stroke="#111" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M96 4 V34 L86 48" fill="none" stroke="#D0D0D0" strokeWidth="3" strokeLinecap="round" />
                    <rect x="80" y="44" width="10" height="7" rx="2" fill="#E6E6E6" transform="rotate(-50 85 47)" />
                </svg>
                <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
                    {Array.from({ length: 49 }, (_, i) => {
                        const x = (i % 7) * 5 + 3;
                        const y = Math.floor(i / 7) * 5 + 3;
                        return Math.hypot(x - 18, y - 18) < 16 ? <circle key={i} cx={x} cy={y} r="1.2" fill="#555" /> : null;
                    })}
                </svg>
            </div>
            <div className="mt-2.5 flex items-center gap-2">
                <label className="relative flex h-6 min-w-0 flex-1 items-center rounded-[5px] border border-black/10">
                    <select aria-label="Music track" value={track} disabled={!timer} onChange={(e) => setTrack(e.target.value)} className="h-full w-full appearance-none bg-transparent pl-2 pr-6 text-[11px] outline-none disabled:opacity-60">
                        {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-1.5 size-3" />
                </label>
                {playing ? (
                    <button type="button" aria-label="Stop music" title="Stop music" onClick={toggleMusic} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#9747FF] text-white hover:bg-[#8638E5]"><PauseCircle className="size-5" /></button>
                ) : (
                    <PlayRound label={timer ? "Play music" : "Music plays while the timer runs"} disabled={!timer} onPress={toggleMusic} />
                )}
            </div>
        </div>
    );
}
