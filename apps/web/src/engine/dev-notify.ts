import { collab, sendMessage } from "./collab";
import type { DevStatus } from "./dev-status";
import { DEV_STATUS_LABELS } from "./dev-status";
import { inspectSettings } from "./inspect-settings";
import { editor } from "./store";
import { userStorage } from "./user-storage";

// Inspect status notifications: when a design is marked ready for dev or completed, the file's
// collaborators hear about it. How you are told is a per-browser preference (the dropdown on the
// status toggle): by email (the sync server mails the people with access), by a desktop
// notification, in the Slack or Teams channels the file's team connected (Team › Integrations and
// Inspect), or not at all. The server keeps a record for the Home bell either way.

export type DevNotifyChannel = "email" | "desktop" | "chat" | "none";

export const DEV_NOTIFY_OPTIONS: [DevNotifyChannel, string][] = [
    ["email", "Notify via email"],
    ["desktop", "Notify via desktop"],
    ["chat", "Notify via Slack or Teams"],
    ["none", "Don't notify"],
];

const KEY = "nagma.devNotify.v1";

export function devNotifyChannel(): DevNotifyChannel {
    try {
        const v = userStorage.getItem(KEY);
        return v === "email" || v === "none" || v === "chat" ? v : "desktop";
    } catch {
        return "desktop";
    }
}

export function setDevNotifyChannel(channel: DevNotifyChannel) {
    try {
        userStorage.setItem(KEY, channel);
    } catch {
        // The choice lasts for the session without storage.
    }
    if (channel === "desktop" && typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission().catch(() => undefined);
}

// The sentence everyone reads: who marked what, and the note if there was one.
export function devStatusMessage(by: string, names: string[], status: DevStatus, note?: string): string {
    const what = names.length === 1 ? `"${names[0]}"` : `${names.length} designs`;
    return `${by} marked ${what} ${DEV_STATUS_LABELS[status].toLowerCase()}${note ? `: ${note}` : "."}`;
}

// Tells the collaborators (through the server) and, with the desktop channel, this browser.
export function notifyDevStatus(ids: string[], names: string[], status: DevStatus, note?: string) {
    if (!names.length) return;
    const channel = devNotifyChannel();
    const me = collab.get().me;
    const by = me.name || "Someone";
    const text = devStatusMessage(by, names, status, note);
    if (channel === "desktop" && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
            new Notification(DEV_STATUS_LABELS[status], { body: text, tag: `nagma-dev-${ids.join(",")}` });
        } catch {
            // Some browsers only allow notifications from a worker; the toast already said it.
        }
    }
    if (channel === "chat" && !inspectSettings.get().chat) editor.notify("This file's team hasn't connected Slack or Teams yet. Team admins can add a channel under Integrations and Inspect.");
    if (collab.get().fileId) sendMessage({ type: "dev.status", ids, names, status, note: note ?? null, notify: channel, text });
}
