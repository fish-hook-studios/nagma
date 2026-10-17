// Mail over SMTP, configured by NAGMA_SMTP_URL (smtp://user:pass@host:587 upgrades with STARTTLS
// when offered; smtps://user:pass@host:465 is TLS from the start). The sender is NAGMA_MAIL_FROM, or
// the SMTP user. Without a URL nothing is sent and one line says so. Logs name only the domain of an
// address, never the whole address.
import { randomBytes } from "node:crypto";
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { hostname } from "node:os";

export const domainOf = (address) => `…@${String(address).split("@")[1] ?? "?"}`;

export function mailConfigured() {
    return Boolean(process.env.NAGMA_SMTP_URL);
}

// Development only: with NAGMA_DEV_MAIL_FILE=1, links that couldn't be mailed (password resets, email
// confirmations) are appended to a file in the data folder for whoever runs the server. Off by
// default: then nothing is written and the log names only the address's domain.
export const devMailFile = () => process.env.NAGMA_DEV_MAIL_FILE === "1";

export async function keepUnsentLink(dataDir, file, line, to) {
    if (!devMailFile()) {
        console.log(`mail skipped (${domainOf(to)}): link not kept (set NAGMA_SMTP_URL to send mail)`);
        return false;
    }
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    console.log(`link for ${domainOf(to)} written to data/${file} (NAGMA_DEV_MAIL_FILE=1)`);
    await writeFile(join(dataDir, file), line, { flag: "a", mode: 0o600 }).catch(() => undefined);
    return true;
}

// One SMTP conversation: a line reader plus "send this, expect that code".
function session(socket) {
    let buffer = "";
    let waiting = null;
    let failed = null;
    const lines = [];
    const onData = (chunk) => {
        buffer += chunk.toString("utf8");
        let i;
        while ((i = buffer.indexOf("\r\n")) >= 0) {
            lines.push(buffer.slice(0, i));
            buffer = buffer.slice(i + 2);
        }
        if (waiting) waiting();
    };
    const onError = (e) => {
        failed = e;
        if (waiting) waiting();
    };
    socket.on("data", onData);
    socket.on("error", onError);
    // A full reply: lines until one whose fourth character is a space ("250 OK" ends "250-…" runs).
    const reply = () =>
        new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("SMTP timed out")), 20_000);
            const check = () => {
                if (failed) return (clearTimeout(timer), reject(failed));
                const end = lines.findIndex((l) => /^\d{3}( |$)/.test(l));
                if (end < 0) return;
                const got = lines.splice(0, end + 1);
                waiting = null;
                clearTimeout(timer);
                resolve({ code: Number(got[end].slice(0, 3)), lines: got });
            };
            waiting = check;
            check();
        });
    const command = async (text, ok) => {
        if (text !== null) socket.write(`${text}\r\n`);
        const r = await reply();
        if (!ok.includes(r.code)) throw new Error(`SMTP ${r.code} after ${text === null ? "connect" : text.split(" ")[0]}`);
        return r;
    };
    return { command, detach: () => (socket.off("data", onData), socket.off("error", onError)) };
}

const open = (secure, host, port, socket) =>
    new Promise((resolve, reject) => {
        const s = secure ? tlsConnect({ host, port, servername: host, socket }) : netConnect({ host, port });
        s.once(secure ? "secureConnect" : "connect", () => resolve(s));
        s.once("error", reject);
    });

// Headers and a dot-stuffed plain text body.
function message(from, to, subject, text) {
    const encode = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`);
    const body = Buffer.from(text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
    return [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${encode(subject)}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${randomBytes(12).toString("hex")}@${from.split("@")[1]?.replace(/>.*/, "") ?? "nagma"}>`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        body,
    ].join("\r\n");
}

export async function sendMail(to, subject, text) {
    const raw = process.env.NAGMA_SMTP_URL;
    if (!raw) {
        console.log(`mail skipped (${domainOf(to)}): no NAGMA_SMTP_URL`);
        return false;
    }
    let socket;
    try {
        const url = new URL(raw);
        const secure = url.protocol === "smtps:";
        const host = url.hostname;
        const port = Number(url.port || (secure ? 465 : 587));
        const user = decodeURIComponent(url.username);
        const pass = decodeURIComponent(url.password);
        const from = process.env.NAGMA_MAIL_FROM || user;
        if (!from.includes("@")) throw new Error("set NAGMA_MAIL_FROM");
        socket = await open(secure, host, port);
        let s = session(socket);
        await s.command(null, [220]);
        const me = hostname() || "nagma";
        let hello = await s.command(`EHLO ${me}`, [250]);
        if (!secure && hello.lines.some((l) => /STARTTLS/i.test(l))) {
            await s.command("STARTTLS", [220]);
            s.detach();
            socket = await open(true, host, port, socket);
            s = session(socket);
            hello = await s.command(`EHLO ${me}`, [250]);
        }
        if (user) {
            const auth = hello.lines.find((l) => /AUTH/i.test(l)) ?? "";
            if (/PLAIN/i.test(auth) || !/LOGIN/i.test(auth)) await s.command(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString("base64")}`, [235]);
            else {
                await s.command("AUTH LOGIN", [334]);
                await s.command(Buffer.from(user).toString("base64"), [334]);
                await s.command(Buffer.from(pass).toString("base64"), [235]);
            }
        }
        const bare = (a) => /<([^>]+)>/.exec(a)?.[1] ?? a;
        await s.command(`MAIL FROM:<${bare(from)}>`, [250]);
        await s.command(`RCPT TO:<${to}>`, [250, 251]);
        await s.command("DATA", [354]);
        const data = message(from, to, subject, text).replace(/^\./gm, "..");
        await s.command(`${data}\r\n.`, [250]);
        await s.command("QUIT", [221]).catch(() => undefined);
        return true;
    } catch (error) {
        console.warn(`mail to ${domainOf(to)} failed: ${error?.message ?? error}`);
        return false;
    } finally {
        socket?.destroy();
    }
}
