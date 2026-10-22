import { useEffect, useState } from "react";
import { type UsageReport, usageReport } from "../engine/auth";

// Settings › Stats, for server admins: how this server is used, counted on the server and nowhere
// else. App loads and the distinct devices behind them (hashed under a salt drawn fresh each day),
// sign-ups, verifications, files made, the most people editing at once; and what is happening now.
// Nothing runs in anyone's browser for this, so the website's "no trackers" stays true.

const SECTION = "border-b border-panel-border py-4 last:border-0";
const n = (v: number) => v.toLocaleString();
const sum = (days: UsageReport["days"], key: keyof UsageReport["days"][number]) => days.reduce((t, d) => t + (typeof d[key] === "number" ? (d[key] as number) : 0), 0);

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="min-w-0 rounded-md border border-panel-border px-3 py-2">
            <span className="block text-[18px] font-semibold tabular-nums">{value}</span>
            <span className="block text-[11px] font-medium">{label}</span>
            {hint && <span className="block text-[10.5px] text-ink-muted">{hint}</span>}
        </div>
    );
}

export function StatsTab() {
    const [report, setReport] = useState<UsageReport | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        let live = true;
        const load = () => void usageReport().then((r) => live && setReport(r), (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
        load();
        const timer = setInterval(load, 30_000);
        return () => {
            live = false;
            clearInterval(timer);
        };
    }, []);
    if (error) return <p className="py-10 text-center text-red-500">{error}</p>;
    if (!report) return <p className="py-10 text-center text-ink-muted">Counting…</p>;
    const today = report.days.find((d) => d.day === report.today) ?? { day: report.today, loads: 0, devices: 0, signups: 0, verified: 0, files: 0, peakEditors: 0, peakConnections: 0 };
    const week = report.days.slice(-7);
    const rows = [...report.days].reverse().slice(0, 30);
    return (
        <div>
            <div className={SECTION}>
                <span className="block text-[11.5px] font-medium">Right now</span>
                <div className="mt-2 grid grid-cols-4 gap-2">
                    <Figure label="Editing" value={n(report.now.editors)} hint="people with edit rights in a file" />
                    <Figure label="In files" value={n(report.now.joined)} hint="everyone, viewers included" />
                    <Figure label="Open files" value={n(report.now.rooms)} />
                    <Figure label="Connections" value={n(report.now.connections)} />
                </div>
            </div>
            <div className={SECTION}>
                <span className="block text-[11.5px] font-medium">Today, {report.today}</span>
                <div className="mt-2 grid grid-cols-4 gap-2">
                    <Figure label="Devices" value={n(today.devices)} hint="distinct address and browser" />
                    <Figure label="App loads" value={n(today.loads)} hint="the page served to a browser" />
                    <Figure label="Sign-ups" value={n(today.signups)} hint={`${n(today.verified)} verified`} />
                    <Figure label="Files made" value={n(today.files)} hint={`peak ${n(today.peakEditors)} editing at once`} />
                </div>
            </div>
            <div className={SECTION}>
                <span className="block text-[11.5px] font-medium">Last 7 days</span>
                <div className="mt-2 grid grid-cols-4 gap-2">
                    <Figure label="Devices" value={n(sum(week, "devices"))} hint="device-days, not distinct people" />
                    <Figure label="App loads" value={n(sum(week, "loads"))} />
                    <Figure label="Sign-ups" value={n(sum(week, "signups"))} hint={`${n(sum(week, "verified"))} verified`} />
                    <Figure label="Files made" value={n(sum(week, "files"))} />
                </div>
            </div>
            <div className={SECTION}>
                <span className="block text-[11.5px] font-medium">On this server</span>
                <div className="mt-2 grid grid-cols-4 gap-2">
                    <Figure label="Accounts" value={n(report.totals.accounts)} hint={`${n(report.totals.verifiedAccounts)} verified`} />
                    <Figure label="Files" value={n(report.totals.files)} />
                    <Figure label="Teams" value={n(report.totals.teams)} />
                    <Figure label="Counting since" value={report.since} />
                </div>
            </div>
            <div className={SECTION}>
                <span className="block text-[11.5px] font-medium">Day by day</span>
                <table className="mt-2 w-full text-[11px] tabular-nums">
                    <thead className="text-ink-muted">
                        <tr className="text-left">
                            <th className="py-1 font-medium">Day</th>
                            <th className="py-1 text-right font-medium">Devices</th>
                            <th className="py-1 text-right font-medium">Loads</th>
                            <th className="py-1 text-right font-medium">Sign-ups</th>
                            <th className="py-1 text-right font-medium">Verified</th>
                            <th className="py-1 text-right font-medium">Files</th>
                            <th className="py-1 text-right font-medium">Peak editing</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((d) => (
                            <tr key={d.day} className="border-t border-panel-border">
                                <td className="py-1">{d.day}</td>
                                <td className="py-1 text-right">{n(d.devices)}</td>
                                <td className="py-1 text-right">{n(d.loads)}</td>
                                <td className="py-1 text-right">{n(d.signups)}</td>
                                <td className="py-1 text-right">{n(d.verified)}</td>
                                <td className="py-1 text-right">{n(d.files)}</td>
                                <td className="py-1 text-right">{n(d.peakEditors)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="mt-2 text-[10.5px] text-ink-muted">Counted on the server as it serves the app. No script runs in anyone's browser, no address is stored: each day draws a fresh salt and keeps only hashes, dropped the next day. People on their own computers or other servers are not counted at all.</p>
            </div>
        </div>
    );
}
