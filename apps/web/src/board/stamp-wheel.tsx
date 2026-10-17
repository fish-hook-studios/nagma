import { MessageCircle01, Plus, X } from "@untitledui/icons";
import { useState } from "react";
import { screenToWorld } from "../engine/camera";
import { useCollab } from "../engine/collab";
import { openCursorChat } from "../engine/follow";
import { editor } from "../engine/store";
import { STAMPS, STAMP_EMOJI, sameStamp, stampLook } from "./model";
import { board, useBoard } from "./state";
import { pickStamp, sendEmote } from "./stamps";
import type { StampPick } from "./types";

// The stamp wheel (E, or the toolbar's stamp button): the preset stamps in a ring with the ones
// used lately in the middle, "+" for any emoji, and a face stamp for each person in the file. Click
// one to stamp with it; ⇧click sends it as a reaction burst at the pointer instead. The chat
// button starts a cursor chat message.

const R = 87;

function Face({ pick, size = 36 }: { pick: StampPick; size?: number }) {
    const look = stampLook(pick);
    const emoji = pick.kind !== "face" && /\p{Extended_Pictographic}/u.test(look.glyph);
    return (
        <span className="flex items-center justify-center rounded-full border-2 border-white font-extrabold text-white shadow" style={{ width: size, height: size, background: look.color, fontSize: emoji ? size * 0.52 : size * 0.4 }}>
            {look.glyph}
        </span>
    );
}

export function StampWheel() {
    const at = useBoard((s) => s.wheel);
    const recent = useBoard((s) => s.stampRecent);
    const current = useBoard((s) => s.stamp);
    const peers = useCollab((s) => s.peers);
    const me = useCollab((s) => s.me);
    const [more, setMore] = useState(false);
    if (!at) return null;
    const close = () => {
        setMore(false);
        board.set({ wheel: null });
    };
    const choose = (pick: StampPick, shift: boolean) => {
        if (shift) {
            // A reaction where the wheel was opened.
            const canvas = document.querySelector("[data-board] canvas")?.getBoundingClientRect();
            const main = document.querySelector("[data-board]")?.getBoundingClientRect();
            const world = screenToWorld(editor.get().camera, at.x - ((canvas?.left ?? 0) - (main?.left ?? 0)), at.y - ((canvas?.top ?? 0) - (main?.top ?? 0)));
            sendEmote(pick, world);
            close();
            return;
        }
        pickStamp(pick);
        setMore(false);
    };
    const faces: StampPick[] = [{ kind: "face" as const, face: { name: me.name || "You", color: me.color } }, ...Object.values(peers).map((p) => ({ kind: "face" as const, face: { name: p.name, color: p.color } }))].filter((f, i, all) => all.findIndex((g) => g.face?.name === f.face?.name) === i);
    const ring = [...STAMPS.filter((s) => s.kind !== "emoji" && s.kind !== "face").map((s) => ({ kind: s.kind }) as StampPick)];
    const left = Math.max(R + 16, Math.min(at.x, window.innerWidth - R - 16));
    // Low enough room for the Faces row under the ring (to R + 62) above the bottom toolbar (76px).
    const top = Math.max(R + 40, Math.min(at.y, window.innerHeight - R - 150));
    return (
        <div className="pointer-events-auto fixed inset-0 z-30" onPointerDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }}>
            <div
                role="dialog"
                aria-label="Stamps"
                className="absolute"
                style={{ left, top }}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.key === "Escape" && close()}
            >
                <div className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/95 shadow-[0_2px_18px_rgba(0,0,0,0.2)]" style={{ width: R * 2 + 56, height: R * 2 + 56 }} />
                {ring.map((pick, i) => {
                    const a = -Math.PI / 2 + (i * 2 * Math.PI) / ring.length;
                    const look = stampLook(pick);
                    return (
                        <button
                            key={pick.kind}
                            type="button"
                            aria-label={look.label}
                            title={`${look.label} (⇧ click to react)`}
                            onClick={(e) => choose(pick, e.shiftKey)}
                            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-125 ${sameStamp(current, pick) ? "ring-2 ring-[#9747FF] ring-offset-1" : ""}`}
                            style={{ left: Math.cos(a) * R, top: Math.sin(a) * R }}
                        >
                            <Face pick={pick} />
                        </button>
                    );
                })}
                {/* The middle: recent stamps, and more emoji. */}
                <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1">
                    <div className="flex gap-1">
                        {recent.map((pick) => (
                            <button key={`${pick.kind}${pick.glyph ?? ""}${pick.face?.name ?? ""}`} type="button" aria-label={`Recent: ${stampLook(pick).label}`} title={stampLook(pick).label} onClick={(e) => choose(pick, e.shiftKey)} className="rounded-full hover:scale-110">
                                <Face pick={pick} size={28} />
                            </button>
                        ))}
                    </div>
                    <div className="flex gap-1">
                        <button type="button" aria-label="More emoji" title="More emoji" aria-expanded={more} onClick={() => setMore(!more)} className="flex size-7 items-center justify-center rounded-full bg-black/10 text-[#1E1E1E] hover:bg-black/15"><Plus className="size-4" /></button>
                        <button type="button" aria-label="Cursor chat (/)" title="Cursor chat (/)" onClick={() => { close(); openCursorChat(); }} className="flex size-7 items-center justify-center rounded-full bg-black/10 text-[#1E1E1E] hover:bg-black/15"><MessageCircle01 className="size-4" /></button>
                    </div>
                </div>
                {/* Faces of everyone here, under the wheel. */}
                <div className="absolute flex -translate-x-1/2 items-center gap-1 rounded-full bg-white px-2 py-1 shadow-[0_2px_10px_rgba(0,0,0,0.16)]" style={{ top: R + 36 }}>
                    <span className="px-1 text-[10.5px] font-semibold text-black/50">Faces</span>
                    {faces.map((pick) => (
                        <button key={pick.face?.name} type="button" aria-label={`Face: ${pick.face?.name}`} title={pick.face?.name} onClick={(e) => choose(pick, e.shiftKey)} className="rounded-full hover:scale-110">
                            <Face pick={pick} size={26} />
                        </button>
                    ))}
                    <button type="button" aria-label="Plus one" title="Plus one" onClick={(e) => choose({ kind: "plus-one" }, e.shiftKey)} className="rounded-full hover:scale-110">
                        <Face pick={{ kind: "plus-one" }} size={26} />
                    </button>
                </div>
                {more && (
                    <div className="absolute w-72 -translate-x-1/2 rounded-xl bg-white p-2 text-[#1E1E1E] shadow-[0_2px_18px_rgba(0,0,0,0.2)]" style={{ bottom: R + 40 }}>
                        <div className="mb-1 flex items-center justify-between px-1">
                            <span className="text-[12px] font-semibold">Emoji</span>
                            <button type="button" aria-label="Close emoji" onClick={() => setMore(false)} className="rounded p-0.5 hover:bg-black/5"><X className="size-3.5" /></button>
                        </div>
                        <div className="max-h-56 space-y-2 overflow-y-auto">
                            {STAMP_EMOJI.map((g) => (
                                <section key={g.group}>
                                    <h3 className="px-1 text-[10.5px] font-semibold uppercase tracking-wide text-black/45">{g.group}</h3>
                                    <div className="grid grid-cols-8">
                                        {g.emoji.map((e) => (
                                            <button key={e} type="button" aria-label={`Stamp ${e}`} onClick={(ev) => choose({ kind: "emoji", glyph: e }, ev.shiftKey)} className="flex aspect-square items-center justify-center rounded-md text-[20px] hover:bg-black/5">{e}</button>
                                        ))}
                                    </div>
                                </section>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
