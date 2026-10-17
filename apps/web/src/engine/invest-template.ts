import { setKeyframe } from "./animation";
import { applyCommand } from "./commands";
import { makeNode } from "./nodes";
import { solid } from "./paint";
import { navigateAction } from "./prototype";
import type { Interaction, NagmaDocument, NodeType, Rect, SceneNode, Transition, VectorPath } from "./types";

// "Vesta", a ten-screen money investing app: a prototype with smart-animate transitions between
// screens that share layer names, and Motion-tab keyframes on the splash, home and success screens.

const BG = "#0B0F19";
const CARD = "#151B2B";
const CARD_2 = "#1C2438";
const ACCENT = "#5B6CFF";
const GREEN = "#22C55E";
const RED = "#EF4444";
const INK = "#FFFFFF";
const MUTED = "#9AA4B2";
const LINE = "#232B3E";

const W = 390;
const H = 844;
const GAP = 60;

const smart = (direction: Transition["direction"] = "left"): Transition => ({ type: "smart", direction, duration: 420, easing: "ease-in-out" });
const push = (direction: Transition["direction"] = "left"): Transition => ({ type: "push", direction, duration: 320, easing: "ease-out" });

export function createInvestDocument(): NagmaDocument {
    let doc: NagmaDocument = { name: "Vesta investing app", nodes: {}, roots: [], images: {} };

    // Layer coordinates are absolute in the document (frames don't offset their children), so
    // rects here are written relative to the parent and shifted by the parent's position.
    const add = (type: NodeType, rect: Rect, parentId: string | null, overrides: Partial<SceneNode> = {}) => {
        const parent = parentId ? doc.nodes[parentId] : undefined;
        const placed = parent && parent.type !== "page" ? { ...rect, x: rect.x + parent.x, y: rect.y + parent.y } : rect;
        const node = makeNode(doc, type, placed, parentId, overrides);
        doc = applyCommand(doc, { type: "node.create", node });
        return node.id;
    };
    const update = (id: string, patch: Partial<SceneNode>) => {
        doc = applyCommand(doc, { type: "node.update", id, patch });
    };
    const text = (parent: string, rect: Rect, value: string, opts: Partial<SceneNode> = {}) =>
        add("text", rect, parent, { name: opts.name ?? value.slice(0, 24), text: value, fills: [solid(INK)], fontSize: 16, fontWeight: 500, ...opts });
    const link = (id: string, target: string, transition: Transition, trigger: Interaction["trigger"] = "click", delay = 800) => {
        const node = doc.nodes[id];
        if (!node) return;
        update(id, { interactions: [...(node.interactions ?? []), { trigger, delay, actions: [{ ...navigateAction(target), transition }] }] });
    };

    const page = add("page", { x: 0, y: 0, w: 1, h: 1 }, null, { name: "Vesta" });
    const screenAt = (i: number, name: string) => add("frame", { x: i * (W + GAP), y: 0, w: W, h: H }, page, { name, fills: [solid(BG)], clip: true });

    // Screens first, so links can point at them.
    const splash = screenAt(0, "01 Splash");
    const signIn = screenAt(1, "02 Sign in");
    const home = screenAt(2, "03 Home");
    const portfolio = screenAt(3, "04 Portfolio");
    const stock = screenAt(4, "05 Stock");
    const buy = screenAt(5, "06 Buy");
    const confirm = screenAt(6, "07 Confirm");
    const success = screenAt(7, "08 Success");
    const activity = screenAt(8, "09 Activity");
    const profile = screenAt(9, "10 Profile");
    update(splash, { flowStart: true });

    // Shared pieces.
    const statusBar = (screen: string) => {
        text(screen, { x: 24, y: 16, w: 60, h: 20 }, "9:41", { name: "Time", fontSize: 15, fontWeight: 600 });
        add("rect", { x: 326, y: 20, w: 40, h: 12 }, screen, { name: "Battery", fills: [solid(INK)], radius: 3 });
    };
    const tabBar = (screen: string, active: "Home" | "Activity" | "Profile") => {
        const bar = add("frame", { x: 0, y: H - 84, w: W, h: 84 }, screen, { name: "Tab bar", fills: [solid(CARD)], clip: false });
        add("rect", { x: 0, y: 0, w: W, h: 1 }, bar, { name: "Divider", fills: [solid(LINE)] });
        const items: ["Home" | "Activity" | "Profile", number, string][] = [
            ["Home", 42, home],
            ["Activity", 165, activity],
            ["Profile", 288, profile],
        ];
        for (const [label, x, target] of items) {
            const on = label === active;
            const hit = add("frame", { x: x - 18, y: 10, w: 96, h: 60 }, bar, { name: `Tab ${label}`, fills: [], clip: false });
            add("ellipse", { x: 36, y: 6, w: 24, h: 24 }, hit, { name: `${label} icon`, fills: [solid(on ? ACCENT : MUTED)] });
            text(hit, { x: 18, y: 36, w: 60, h: 18 }, label, { name: `${label} label`, fontSize: 12, textAlign: "center", fills: [solid(on ? INK : MUTED)], sizing: { h: "fixed", v: "hug" } });
            if (!on) link(hit, target, { type: "dissolve", direction: "left", duration: 200, easing: "ease-out" });
        }
    };
    const button = (screen: string, y: number, label: string, color = ACCENT, name = "Primary button") => {
        const b = add("frame", { x: 24, y, w: W - 48, h: 56 }, screen, { name, fills: [solid(color)], radius: 16, clip: false });
        text(b, { x: 0, y: 17, w: W - 48, h: 22 }, label, { name: "Button label", fontSize: 17, fontWeight: 600, textAlign: "center", sizing: { h: "fixed", v: "hug" } });
        return b;
    };
    const backButton = (screen: string, target: string) => {
        const b = add("frame", { x: 16, y: 56, w: 40, h: 40 }, screen, { name: "Back", fills: [solid(CARD)], radius: 20, clip: false });
        text(b, { x: 0, y: 9, w: 40, h: 22 }, "‹", { name: "Back glyph", fontSize: 22, textAlign: "center", sizing: { h: "fixed", v: "hug" } });
        link(b, target, smart("right"));
        return b;
    };
    const linePath = (points: [number, number][], w: number, h: number): VectorPath => ({
        w,
        h,
        subpaths: [{ closed: false, points: points.map(([x, y]) => ({ x, y, in: null, out: null })) }],
    });
    const chart = (parent: string, rect: Rect, name: string, color = GREEN) => {
        const pts: [number, number][] = [
            [0, rect.h * 0.7],
            [rect.w * 0.15, rect.h * 0.55],
            [rect.w * 0.3, rect.h * 0.62],
            [rect.w * 0.45, rect.h * 0.35],
            [rect.w * 0.6, rect.h * 0.42],
            [rect.w * 0.75, rect.h * 0.2],
            [rect.w * 0.9, rect.h * 0.28],
            [rect.w, rect.h * 0.1],
        ];
        return add("vector", rect, parent, { name, fills: [], strokes: [solid(color)], strokeWidth: 3, strokeAlign: "center", strokeCap: "round", strokeJoin: "round", path: linePath(pts, rect.w, rect.h) });
    };
    const holding = (parent: string, y: number, ticker: string, company: string, price: string, change: string, up: boolean, target?: string) => {
        const row = add("frame", { x: 24, y, w: W - 48, h: 64 }, parent, { name: `Holding ${ticker}`, fills: [solid(CARD)], radius: 14, clip: false });
        add("ellipse", { x: 14, y: 14, w: 36, h: 36 }, row, { name: `${ticker} logo`, fills: [solid(CARD_2)] });
        text(row, { x: 22, y: 24, w: 24, h: 16 }, ticker.slice(0, 1), { name: `${ticker} letter`, fontSize: 14, fontWeight: 700, fills: [solid(ACCENT)] });
        text(row, { x: 62, y: 13, w: 120, h: 20 }, ticker, { name: `${ticker} ticker`, fontSize: 15, fontWeight: 600 });
        text(row, { x: 62, y: 35, w: 160, h: 16 }, company, { name: `${ticker} company`, fontSize: 12, fills: [solid(MUTED)] });
        text(row, { x: 220, y: 13, w: 110, h: 20 }, price, { name: `${ticker} price`, fontSize: 15, fontWeight: 600, textAlign: "right", sizing: { h: "fixed", v: "hug" } });
        text(row, { x: 220, y: 35, w: 110, h: 16 }, change, { name: `${ticker} change`, fontSize: 12, textAlign: "right", fills: [solid(up ? GREEN : RED)], sizing: { h: "fixed", v: "hug" } });
        if (target) link(row, target, smart("left"));
        return row;
    };

    // 01 Splash: the logo grows in and the tagline fades in (Motion keyframes), then auto-advances.
    {
        const logo = add("ellipse", { x: 155, y: 330, w: 80, h: 80 }, splash, { name: "Logo", fills: [solid(ACCENT)] });
        add("rect", { x: 183, y: 352, w: 24, h: 36 }, splash, { name: "Logo mark", fills: [solid(INK)], radius: 6, rotation: -20 });
        const title = text(splash, { x: 0, y: 440, w: W, h: 40 }, "Vesta", { name: "Brand", fontSize: 34, fontWeight: 800, textAlign: "center", sizing: { h: "fixed", v: "hug" } });
        const tag = text(splash, { x: 0, y: 488, w: W, h: 22 }, "Invest a little. Grow a lot.", { name: "Tagline", fontSize: 16, textAlign: "center", fills: [solid(MUTED)], sizing: { h: "fixed", v: "hug" } });
        const cta = button(splash, 720, "Get started");
        let n = doc.nodes[logo] as SceneNode;
        doc = applyCommand(doc, setKeyframe(n, "w", 0, 8, "ease-out"));
        n = doc.nodes[logo] as SceneNode;
        doc = applyCommand(doc, setKeyframe(n, "w", 600, 80, "ease-out"));
        n = doc.nodes[logo] as SceneNode;
        doc = applyCommand(doc, setKeyframe(n, "h", 0, 8, "ease-out"));
        n = doc.nodes[logo] as SceneNode;
        doc = applyCommand(doc, setKeyframe(n, "h", 600, 80, "ease-out"));
        n = doc.nodes[logo] as SceneNode;
        doc = applyCommand(doc, setKeyframe(n, "x", 0, 191, "ease-out"));
        n = doc.nodes[logo] as SceneNode;
        doc = applyCommand(doc, setKeyframe(n, "x", 600, 155, "ease-out"));
        n = doc.nodes[logo] as SceneNode;
        doc = applyCommand(doc, setKeyframe(n, "y", 0, 366, "ease-out"));
        n = doc.nodes[logo] as SceneNode;
        doc = applyCommand(doc, setKeyframe(n, "y", 600, 330, "ease-out"));
        for (const id of [title, tag, cta]) {
            let t = doc.nodes[id] as SceneNode;
            doc = applyCommand(doc, setKeyframe(t, "opacity", 0, 0, "ease-out"));
            t = doc.nodes[id] as SceneNode;
            doc = applyCommand(doc, setKeyframe(t, "opacity", id === cta ? 1100 : 500, 0, "ease-out"));
            t = doc.nodes[id] as SceneNode;
            doc = applyCommand(doc, setKeyframe(t, "opacity", id === cta ? 1500 : 900, 1, "ease-out"));
        }
        update(splash, { animation: { tracks: {}, duration: 1600 } });
        link(cta, signIn, push("left"));
    }

    // 02 Sign in.
    {
        statusBar(signIn);
        text(signIn, { x: 24, y: 120, w: 340, h: 40 }, "Welcome back", { name: "Heading", fontSize: 30, fontWeight: 700 });
        text(signIn, { x: 24, y: 166, w: 340, h: 22 }, "Sign in to your account", { name: "Subheading", fontSize: 15, fills: [solid(MUTED)] });
        for (const [i, [label, value]] of [["Email", "ava@example.com"], ["Password", "••••••••"]].entries()) {
            const y = 240 + i * 84;
            text(signIn, { x: 24, y, w: 200, h: 16 }, label as string, { name: `${label} label`, fontSize: 12, fills: [solid(MUTED)] });
            const field = add("frame", { x: 24, y: y + 22, w: W - 48, h: 52 }, signIn, { name: `${label} field`, fills: [solid(CARD)], radius: 14, strokes: [solid(LINE)], strokeWidth: 1, clip: false });
            text(field, { x: 16, y: 16, w: 280, h: 20 }, value as string, { name: `${label} value`, fontSize: 15 });
        }
        text(signIn, { x: 24, y: 420, w: 200, h: 18 }, "Forgot password?", { name: "Forgot", fontSize: 13, fills: [solid(ACCENT)] });
        const cta = button(signIn, 480, "Sign in");
        link(cta, home, push("left"));
        text(signIn, { x: 0, y: 560, w: W, h: 18 }, "New here? Create an account", { name: "Create account", fontSize: 13, textAlign: "center", fills: [solid(MUTED)], sizing: { h: "fixed", v: "hug" } });
    }

    // 03 Home: balance card, mini chart, holdings. The card and chart smart-animate into 04.
    {
        statusBar(home);
        text(home, { x: 24, y: 64, w: 200, h: 18 }, "Good morning", { name: "Greeting", fontSize: 13, fills: [solid(MUTED)] });
        text(home, { x: 24, y: 86, w: 200, h: 28 }, "Ava Chen", { name: "User name", fontSize: 22, fontWeight: 700 });
        add("ellipse", { x: 326, y: 72, w: 40, h: 40 }, home, { name: "Avatar", fills: [solid(ACCENT)] });
        const card = add("frame", { x: 24, y: 136, w: W - 48, h: 180 }, home, { name: "Balance card", fills: [solid(ACCENT)], radius: 24, clip: true });
        add("ellipse", { x: 220, y: -60, w: 220, h: 220 }, card, { name: "Card glow", fills: [solid("#7C8AFF")], opacity: 0.5 });
        text(card, { x: 20, y: 20, w: 200, h: 16 }, "Total balance", { name: "Balance label", fontSize: 13, fills: [solid("#DCE0FF")] });
        const amount = text(card, { x: 20, y: 42, w: 260, h: 40 }, "$24,580.32", { name: "Balance amount", fontSize: 32, fontWeight: 800 });
        text(card, { x: 20, y: 90, w: 200, h: 18 }, "+$1,240.10 (5.3%) today", { name: "Balance change", fontSize: 13, fills: [solid("#C8F7D6")] });
        const mini = chart(card, { x: 20, y: 118, w: 302, h: 44 }, "Portfolio chart", INK);
        link(card, portfolio, smart("left"));
        text(home, { x: 24, y: 340, w: 200, h: 22 }, "Your holdings", { name: "Holdings title", fontSize: 17, fontWeight: 600 });
        text(home, { x: 290, y: 342, w: 76, h: 18 }, "See all", { name: "See all", fontSize: 13, fills: [solid(ACCENT)], textAlign: "right", sizing: { h: "fixed", v: "hug" } });
        holding(home, 372, "AAPL", "Apple", "$189.40", "+1.2%", true, stock);
        holding(home, 446, "NVDA", "NVIDIA", "$912.10", "+3.8%", true);
        holding(home, 520, "TSLA", "Tesla", "$172.60", "-0.9%", false);
        holding(home, 594, "VOO", "Vanguard S&P 500", "$478.22", "+0.4%", true);
        tabBar(home, "Home");
        // Motion: the amount counts up through opacity and the chart draws in by width.
        let a = doc.nodes[amount] as SceneNode;
        doc = applyCommand(doc, setKeyframe(a, "opacity", 0, 0, "ease-out"));
        a = doc.nodes[amount] as SceneNode;
        doc = applyCommand(doc, setKeyframe(a, "opacity", 500, 1, "ease-out"));
        let m = doc.nodes[mini] as SceneNode;
        doc = applyCommand(doc, setKeyframe(m, "w", 0, 1, "ease-out"));
        m = doc.nodes[mini] as SceneNode;
        doc = applyCommand(doc, setKeyframe(m, "w", 900, 302, "ease-out"));
        update(home, { animation: { tracks: {}, duration: 1000 } });
    }

    // 04 Portfolio: the same card, taller, with a big chart (match animate from Home).
    {
        statusBar(portfolio);
        backButton(portfolio, home);
        text(portfolio, { x: 72, y: 65, w: 200, h: 24 }, "Portfolio", { name: "Title", fontSize: 18, fontWeight: 600 });
        const card = add("frame", { x: 16, y: 112, w: W - 32, h: 380 }, portfolio, { name: "Balance card", fills: [solid(ACCENT)], radius: 28, clip: true });
        add("ellipse", { x: 160, y: -120, w: 360, h: 360 }, card, { name: "Card glow", fills: [solid("#7C8AFF")], opacity: 0.5 });
        text(card, { x: 24, y: 24, w: 200, h: 16 }, "Total balance", { name: "Balance label", fontSize: 13, fills: [solid("#DCE0FF")] });
        text(card, { x: 24, y: 46, w: 300, h: 48 }, "$24,580.32", { name: "Balance amount", fontSize: 40, fontWeight: 800 });
        text(card, { x: 24, y: 100, w: 200, h: 18 }, "+$1,240.10 (5.3%) today", { name: "Balance change", fontSize: 13, fills: [solid("#C8F7D6")] });
        chart(card, { x: 24, y: 150, w: 310, h: 200 }, "Portfolio chart", INK);
        const ranges = add("frame", { x: 24, y: 512, w: W - 48, h: 40 }, portfolio, { name: "Ranges", fills: [solid(CARD)], radius: 12, clip: false });
        for (const [i, r] of ["1D", "1W", "1M", "1Y", "All"].entries()) {
            const on = i === 2;
            const pill = add("frame", { x: 4 + i * 67, y: 4, w: 63, h: 32 }, ranges, { name: `Range ${r}`, fills: on ? [solid(ACCENT)] : [], radius: 10, clip: false });
            text(pill, { x: 0, y: 8, w: 63, h: 16 }, r, { name: `${r} label`, fontSize: 13, fontWeight: 600, textAlign: "center", fills: [solid(on ? INK : MUTED)], sizing: { h: "fixed", v: "hug" } });
        }
        text(portfolio, { x: 24, y: 576, w: 200, h: 22 }, "Allocation", { name: "Allocation title", fontSize: 17, fontWeight: 600 });
        for (const [i, [label, pct, color]] of [["Stocks", "62%", ACCENT], ["ETFs", "28%", GREEN], ["Cash", "10%", MUTED]].entries()) {
            const y = 612 + i * 40;
            add("ellipse", { x: 24, y: y + 4, w: 12, h: 12 }, portfolio, { name: `${label} dot`, fills: [solid(color as string)] });
            text(portfolio, { x: 46, y, w: 160, h: 20 }, label as string, { name: `${label} label`, fontSize: 15 });
            text(portfolio, { x: 266, y, w: 100, h: 20 }, pct as string, { name: `${label} pct`, fontSize: 15, fontWeight: 600, textAlign: "right", sizing: { h: "fixed", v: "hug" } });
        }
        tabBar(portfolio, "Home");
    }

    // 05 Stock detail.
    {
        statusBar(stock);
        backButton(stock, home);
        add("ellipse", { x: 24, y: 120, w: 48, h: 48 }, stock, { name: "AAPL logo", fills: [solid(CARD_2)] });
        text(stock, { x: 84, y: 122, w: 200, h: 24 }, "Apple", { name: "Company", fontSize: 20, fontWeight: 700 });
        text(stock, { x: 84, y: 148, w: 200, h: 18 }, "AAPL · NASDAQ", { name: "Ticker", fontSize: 13, fills: [solid(MUTED)] });
        text(stock, { x: 24, y: 196, w: 260, h: 44 }, "$189.40", { name: "Price", fontSize: 36, fontWeight: 800 });
        text(stock, { x: 24, y: 246, w: 260, h: 18 }, "+$2.26 (1.2%) today", { name: "Price change", fontSize: 13, fills: [solid(GREEN)] });
        chart(stock, { x: 24, y: 290, w: W - 48, h: 180 }, "Stock chart", GREEN);
        text(stock, { x: 24, y: 500, w: 200, h: 22 }, "About", { name: "About title", fontSize: 17, fontWeight: 600 });
        text(stock, { x: 24, y: 530, w: W - 48, h: 60 }, "Apple designs, manufactures and markets smartphones, personal computers, tablets, wearables and accessories.", { name: "About body", fontSize: 14, fills: [solid(MUTED)], sizing: { h: "fixed", v: "hug" } });
        for (const [i, [k, v]] of [["Market cap", "$2.9T"], ["P/E", "29.4"], ["Dividend", "0.5%"]].entries()) {
            const x = 24 + i * 116;
            const stat = add("frame", { x, y: 612, w: 110, h: 60 }, stock, { name: `Stat ${k}`, fills: [solid(CARD)], radius: 12, clip: false });
            text(stat, { x: 12, y: 10, w: 90, h: 16 }, k as string, { name: `${k} label`, fontSize: 11, fills: [solid(MUTED)] });
            text(stat, { x: 12, y: 30, w: 90, h: 20 }, v as string, { name: `${k} value`, fontSize: 15, fontWeight: 600 });
        }
        const buyBtn = button(stock, 760, "Buy", GREEN, "Buy button");
        link(buyBtn, buy, smart("up"));
    }

    // 06 Buy: amount and keypad. The Buy button smart-animates from the stock screen.
    {
        statusBar(buy);
        backButton(buy, stock);
        text(buy, { x: 72, y: 65, w: 200, h: 24 }, "Buy Apple", { name: "Title", fontSize: 18, fontWeight: 600 });
        text(buy, { x: 0, y: 150, w: W, h: 16 }, "Amount", { name: "Amount label", fontSize: 13, textAlign: "center", fills: [solid(MUTED)], sizing: { h: "fixed", v: "hug" } });
        text(buy, { x: 0, y: 176, w: W, h: 56 }, "$500", { name: "Amount", fontSize: 48, fontWeight: 800, textAlign: "center", sizing: { h: "fixed", v: "hug" } });
        text(buy, { x: 0, y: 240, w: W, h: 18 }, "≈ 2.64 shares at $189.40", { name: "Shares", fontSize: 13, textAlign: "center", fills: [solid(MUTED)], sizing: { h: "fixed", v: "hug" } });
        const quick = add("frame", { x: 24, y: 284, w: W - 48, h: 40 }, buy, { name: "Quick amounts", fills: [], clip: false });
        for (const [i, q] of ["$100", "$250", "$500", "$1,000"].entries()) {
            const on = i === 2;
            const pill = add("frame", { x: i * 86, y: 0, w: 78, h: 40 }, quick, { name: `Quick ${q}`, fills: [solid(on ? ACCENT : CARD)], radius: 12, clip: false });
            text(pill, { x: 0, y: 11, w: 78, h: 18 }, q, { name: `${q} label`, fontSize: 14, fontWeight: 600, textAlign: "center", sizing: { h: "fixed", v: "hug" } });
        }
        const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];
        const pad = add("frame", { x: 24, y: 352, w: W - 48, h: 300 }, buy, { name: "Keypad", fills: [], clip: false });
        keys.forEach((k, i) => {
            const col = i % 3;
            const row = Math.floor(i / 3);
            const key = add("frame", { x: col * 118, y: row * 76, w: 106, h: 64 }, pad, { name: `Key ${k}`, fills: [solid(CARD)], radius: 14, clip: false });
            text(key, { x: 0, y: 20, w: 106, h: 24 }, k, { name: `${k} glyph`, fontSize: 20, fontWeight: 600, textAlign: "center", sizing: { h: "fixed", v: "hug" } });
        });
        const next = button(buy, 760, "Review order", GREEN, "Buy button");
        link(next, confirm, smart("left"));
    }

    // 07 Confirm.
    {
        statusBar(confirm);
        backButton(confirm, buy);
        text(confirm, { x: 72, y: 65, w: 200, h: 24 }, "Review order", { name: "Title", fontSize: 18, fontWeight: 600 });
        const card = add("frame", { x: 24, y: 128, w: W - 48, h: 300 }, confirm, { name: "Order card", fills: [solid(CARD)], radius: 20, clip: false });
        const rows: [string, string][] = [["Stock", "Apple (AAPL)"], ["Amount", "$500.00"], ["Shares", "2.64"], ["Price", "$189.40"], ["Fee", "$0.00"], ["Total", "$500.00"]];
        rows.forEach(([k, v], i) => {
            const y = 20 + i * 46;
            text(card, { x: 20, y, w: 140, h: 20 }, k, { name: `${k} label`, fontSize: 14, fills: [solid(i === rows.length - 1 ? INK : MUTED)], fontWeight: i === rows.length - 1 ? 600 : 400 });
            text(card, { x: 160, y, w: 162, h: 20 }, v, { name: `${k} value`, fontSize: 14, fontWeight: 600, textAlign: "right", sizing: { h: "fixed", v: "hug" } });
            if (i < rows.length - 1) add("rect", { x: 20, y: y + 32, w: 302, h: 1 }, card, { name: "Row line", fills: [solid(LINE)] });
        });
        text(confirm, { x: 24, y: 452, w: W - 48, h: 40 }, "Market orders fill at the best available price. Settlement takes two business days.", { name: "Disclaimer", fontSize: 12, fills: [solid(MUTED)], sizing: { h: "fixed", v: "hug" } });
        const slideTrack = add("frame", { x: 24, y: 680, w: W - 48, h: 60 }, confirm, { name: "Slide to confirm", fills: [solid(CARD)], radius: 30, clip: false });
        const knob = add("ellipse", { x: 4, y: 4, w: 52, h: 52 }, slideTrack, { name: "Knob", fills: [solid(GREEN)] });
        text(slideTrack, { x: 0, y: 20, w: W - 48, h: 20 }, "Slide to confirm  ›", { name: "Slide label", fontSize: 15, fontWeight: 600, textAlign: "center", fills: [solid(MUTED)], sizing: { h: "fixed", v: "hug" } });
        link(slideTrack, success, smart("left"));
        void knob;
        const cancel = button(confirm, 760, "Cancel", CARD, "Cancel button");
        link(cancel, stock, smart("right"));
    }

    // 08 Success: the check mark pops in (Motion keyframes), then onward.
    {
        statusBar(success);
        const ring = add("ellipse", { x: 135, y: 250, w: 120, h: 120 }, success, { name: "Success ring", fills: [solid(GREEN)], opacity: 0.2 });
        const dot = add("ellipse", { x: 155, y: 270, w: 80, h: 80 }, success, { name: "Success dot", fills: [solid(GREEN)] });
        add("vector", { x: 175, y: 296, w: 40, h: 28 }, success, { name: "Check", fills: [], strokes: [solid(INK)], strokeWidth: 5, strokeAlign: "center", strokeCap: "round", strokeJoin: "round", path: linePath([[0, 14], [14, 28], [40, 0]], 40, 28) });
        text(success, { x: 0, y: 410, w: W, h: 34 }, "Order placed", { name: "Heading", fontSize: 28, fontWeight: 700, textAlign: "center", sizing: { h: "fixed", v: "hug" } });
        text(success, { x: 40, y: 456, w: W - 80, h: 44 }, "You bought 2.64 shares of Apple for $500.00. We'll notify you when it fills.", { name: "Body", fontSize: 15, textAlign: "center", fills: [solid(MUTED)], sizing: { h: "fixed", v: "hug" } });
        const confetti = [
            [60, 180, ACCENT],
            [320, 160, GREEN],
            [90, 420, RED],
            [300, 400, ACCENT],
            [200, 120, GREEN],
        ] as const;
        confetti.forEach(([x, y, c], i) => {
            const id = add("rect", { x, y, w: 10, h: 10 }, success, { name: `Confetti ${i + 1}`, fills: [solid(c)], radius: 2, rotation: 20 * i });
            let n = doc.nodes[id] as SceneNode;
            doc = applyCommand(doc, setKeyframe(n, "y", 0, y - 80, "ease-out"));
            n = doc.nodes[id] as SceneNode;
            doc = applyCommand(doc, setKeyframe(n, "y", 1200, y + 40, "ease-in"));
            n = doc.nodes[id] as SceneNode;
            doc = applyCommand(doc, setKeyframe(n, "opacity", 0, 0, "linear"));
            n = doc.nodes[id] as SceneNode;
            doc = applyCommand(doc, setKeyframe(n, "opacity", 300, 1, "linear"));
            n = doc.nodes[id] as SceneNode;
            doc = applyCommand(doc, setKeyframe(n, "opacity", 1200, 0, "linear"));
        });
        const ox = (doc.nodes[success] as SceneNode).x;
        for (const [id, size, at] of [
            [ring, 120, { x: ox + 135, y: 250 }],
            [dot, 80, { x: ox + 155, y: 270 }],
        ] as const) {
            let n = doc.nodes[id] as SceneNode;
            doc = applyCommand(doc, setKeyframe(n, "w", 0, 0, "ease-out"));
            n = doc.nodes[id] as SceneNode;
            doc = applyCommand(doc, setKeyframe(n, "w", 500, size, "ease-out"));
            n = doc.nodes[id] as SceneNode;
            doc = applyCommand(doc, setKeyframe(n, "h", 0, 0, "ease-out"));
            n = doc.nodes[id] as SceneNode;
            doc = applyCommand(doc, setKeyframe(n, "h", 500, size, "ease-out"));
            n = doc.nodes[id] as SceneNode;
            doc = applyCommand(doc, setKeyframe(n, "x", 0, at.x + size / 2, "ease-out"));
            n = doc.nodes[id] as SceneNode;
            doc = applyCommand(doc, setKeyframe(n, "x", 500, at.x, "ease-out"));
            n = doc.nodes[id] as SceneNode;
            doc = applyCommand(doc, setKeyframe(n, "y", 0, at.y + size / 2, "ease-out"));
            n = doc.nodes[id] as SceneNode;
            doc = applyCommand(doc, setKeyframe(n, "y", 500, at.y, "ease-out"));
        }
        update(success, { animation: { tracks: {}, duration: 1400 } });
        const done = button(success, 700, "View activity", ACCENT, "Primary button");
        link(done, activity, push("left"));
        const back = button(success, 764, "Back to home", CARD, "Secondary button");
        link(back, home, { type: "dissolve", direction: "left", duration: 250, easing: "ease-out" });
    }

    // 09 Activity.
    {
        statusBar(activity);
        text(activity, { x: 24, y: 64, w: 200, h: 30 }, "Activity", { name: "Title", fontSize: 24, fontWeight: 700 });
        const filters = add("frame", { x: 24, y: 112, w: W - 48, h: 36 }, activity, { name: "Filters", fills: [], clip: false });
        for (const [i, f] of ["All", "Buys", "Sells", "Dividends"].entries()) {
            const on = i === 0;
            const pill = add("frame", { x: i * 86, y: 0, w: 78, h: 36 }, filters, { name: `Filter ${f}`, fills: [solid(on ? ACCENT : CARD)], radius: 18, clip: false });
            text(pill, { x: 0, y: 9, w: 78, h: 18 }, f, { name: `${f} label`, fontSize: 13, fontWeight: 600, textAlign: "center", fills: [solid(on ? INK : MUTED)], sizing: { h: "fixed", v: "hug" } });
        }
        const items: [string, string, string, boolean][] = [
            ["Bought AAPL", "Today · 2.64 shares", "-$500.00", false],
            ["Dividend VOO", "Yesterday", "+$12.40", true],
            ["Bought NVDA", "Mon · 0.5 shares", "-$456.05", false],
            ["Sold TSLA", "Sun · 3 shares", "+$517.80", true],
            ["Deposit", "Fri · Chase ••42", "+$1,000.00", true],
            ["Bought VOO", "Thu · 1 share", "-$478.22", false],
        ];
        text(activity, { x: 24, y: 168, w: 200, h: 18 }, "This week", { name: "Section", fontSize: 13, fills: [solid(MUTED)] });
        items.forEach(([t, sub, amt, up], i) => {
            const y = 196 + i * 72;
            const row = add("frame", { x: 24, y, w: W - 48, h: 64 }, activity, { name: `Activity ${i + 1}`, fills: [solid(CARD)], radius: 14, clip: false });
            add("ellipse", { x: 14, y: 14, w: 36, h: 36 }, row, { name: "Icon", fills: [solid(up ? "#14532D" : CARD_2)] });
            text(row, { x: 62, y: 13, w: 150, h: 20 }, t, { name: "Title", fontSize: 15, fontWeight: 600 });
            text(row, { x: 62, y: 35, w: 180, h: 16 }, sub, { name: "Subtitle", fontSize: 12, fills: [solid(MUTED)] });
            text(row, { x: 220, y: 22, w: 110, h: 20 }, amt, { name: "Amount", fontSize: 15, fontWeight: 600, textAlign: "right", fills: [solid(up ? GREEN : INK)], sizing: { h: "fixed", v: "hug" } });
        });
        tabBar(activity, "Activity");
    }

    // 10 Profile.
    {
        statusBar(profile);
        text(profile, { x: 24, y: 64, w: 200, h: 30 }, "Profile", { name: "Title", fontSize: 24, fontWeight: 700 });
        add("ellipse", { x: 24, y: 120, w: 72, h: 72 }, profile, { name: "Avatar", fills: [solid(ACCENT)] });
        text(profile, { x: 112, y: 130, w: 220, h: 24 }, "Ava Chen", { name: "User name", fontSize: 20, fontWeight: 700 });
        text(profile, { x: 112, y: 158, w: 220, h: 18 }, "ava@example.com", { name: "Email", fontSize: 13, fills: [solid(MUTED)] });
        const groups: [string, string[]][] = [
            ["Account", ["Personal details", "Linked bank", "Tax documents"]],
            ["Preferences", ["Notifications", "Appearance", "Security"]],
        ];
        let y = 224;
        for (const [title, rows] of groups) {
            text(profile, { x: 24, y, w: 200, h: 18 }, title, { name: `${title} section`, fontSize: 13, fills: [solid(MUTED)] });
            y += 26;
            const card = add("frame", { x: 24, y, w: W - 48, h: rows.length * 52 }, profile, { name: `${title} card`, fills: [solid(CARD)], radius: 16, clip: true });
            rows.forEach((r, i) => {
                text(card, { x: 16, y: 16 + i * 52, w: 240, h: 20 }, r, { name: r, fontSize: 15 });
                text(card, { x: 300, y: 14 + i * 52, w: 24, h: 22 }, "›", { name: `${r} chevron`, fontSize: 18, fills: [solid(MUTED)] });
                if (i < rows.length - 1) add("rect", { x: 16, y: 51 + i * 52, w: W - 80, h: 1 }, card, { name: "Row line", fills: [solid(LINE)] });
            });
            y += rows.length * 52 + 24;
        }
        const out = button(profile, y + 8, "Sign out", CARD, "Sign out button");
        link(out, signIn, push("right"));
        tabBar(profile, "Profile");
    }

    return doc;
}
