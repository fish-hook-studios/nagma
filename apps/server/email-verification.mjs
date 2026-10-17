// Email verification's pure parts: whether the server requires it, how tokens are kept, and how
// often a verification mail may be sent again. server.mjs holds the routes (/auth/verify…).
import { createHash } from "node:crypto";

// NAGMA_REQUIRE_VERIFIED_EMAIL=1 or 0 decides; unset, it's required when the server can deliver the
// link (SMTP, or the development mail file), so a local single-user setup isn't held back.
export function verifyRequired(env, canMail) {
    const v = String(env.NAGMA_REQUIRE_VERIFIED_EMAIL ?? "").trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(v)) return true;
    if (["0", "false", "no", "off"].includes(v)) return false;
    return Boolean(canMail);
}

// Tokens are kept only as their SHA-256.
export const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");

// At most one verification mail a minute and five an hour per account.
export const RESEND_LIMITS = [
    [60 * 1000, 1],
    [60 * 60 * 1000, 5],
];

// Seconds until another mail may go, given the times (oldest first) of the ones already sent.
export function resendWait(times, now = Date.now(), limits = RESEND_LIMITS) {
    let wait = 0;
    for (const [window, max] of limits) {
        const inside = times.filter((t) => now - t < window);
        if (inside.length >= max) wait = Math.max(wait, Math.ceil((inside[inside.length - max] + window - now) / 1000));
    }
    return wait;
}
