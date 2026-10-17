import { useState } from "react";
import { Dialog as AriaDialog, Heading, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { guestDraftsToOffer, keepGuestDrafts, moveGuestDrafts } from "../engine/guest-drafts";
import { editor } from "../engine/store";
import { Button } from "./admin/admin-ui";

// After signing in: drafts made in this browser while signed out can move into the account, once.
export function MoveDraftsOffer() {
    const [count, setCount] = useState(() => guestDraftsToOffer().length);
    const [busy, setBusy] = useState(false);
    if (!count) return null;
    const keep = () => {
        keepGuestDrafts();
        setCount(0);
    };
    const move = async () => {
        setBusy(true);
        try {
            const moved = await moveGuestDrafts();
            editor.notify(`Moved ${moved} draft${moved === 1 ? "" : "s"} into this account.`);
        } catch {
            editor.notify("The drafts couldn't be moved. They're still there when you sign out.");
        } finally {
            setBusy(false);
            setCount(0);
        }
    };
    const drafts = `${count} local draft${count === 1 ? "" : "s"}`;
    return (
        <AriaModalOverlay isOpen onOpenChange={(o) => !o && !busy && keep()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
            <AriaModal className="w-[400px] max-w-[calc(100vw-32px)] rounded-xl border border-panel-border bg-panel-raised p-5 text-ink shadow-2xl outline-none">
                <AriaDialog className="outline-none" aria-label="Move your local drafts">
                    <Heading slot="title" className="text-[14px] font-semibold">
                        Move your {drafts} into this account?
                    </Heading>
                    <p className="mt-2 text-[12px] text-ink-muted">
                        {count === 1 ? "It was" : "They were"} made in this browser while you were signed out. Moved, {count === 1 ? "it" : "they"} show under this account's Drafts. Otherwise {count === 1 ? "it stays" : "they stay"} with signed-out use in this browser.
                    </p>
                    <div className="mt-4 flex justify-end gap-2">
                        <Button disabled={busy} onPress={keep}>
                            Keep signed out
                        </Button>
                        <Button variant="primary" disabled={busy} onPress={() => void move()}>
                            Move {drafts}
                        </Button>
                    </div>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}
