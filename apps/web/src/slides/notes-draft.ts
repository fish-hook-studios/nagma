import { useState } from "react";
import { setNotes } from "./actions";

export interface NotesDraft {
    id: string | null;
    text: string;
    base: string;
    sent: string;
}

// The draft once the saved notes are `saved` (the same object when nothing changes).
export function syncDraft(draft: NotesDraft, slide: string | null, saved: string): NotesDraft {
    if (draft.id !== slide) return { id: slide, text: saved, base: saved, sent: saved };
    if (saved === draft.base) return draft;
    return saved === draft.sent ? { ...draft, base: saved } : { id: slide, text: saved, base: saved, sent: saved };
}

// The text in a presenter notes field. `base` is the saved notes the draft started from and `sent`
// what you last typed (saved a moment later). Another slide, or saved notes that aren't your own
// typing arriving (an undo, a collaborator, the same notes edited in the other notes field), show
// what's saved; otherwise the field kept stale text and wrote it back over the newer notes.
export function useNotesDraft(id: string | null | undefined, saved: string): { text: string; type: (text: string) => void; leave: (text: string) => void; replace: (text: string) => void } {
    const slide = id ?? null;
    const [draft, setDraft] = useState<NotesDraft>({ id: slide, text: saved, base: saved, sent: saved });
    const current = syncDraft(draft, slide, saved);
    if (current !== draft) setDraft(current);
    return {
        text: current.text,
        type: (text) => {
            setDraft({ ...current, text, sent: text });
            if (slide) setNotes(slide, text);
        },
        leave: (text) => {
            if (slide) setNotes(slide, text, true);
        },
        // Notes written for you (Start with a draft): saved already, shown as they are.
        replace: (text) => setDraft({ id: slide, text, base: text, sent: text }),
    };
}
