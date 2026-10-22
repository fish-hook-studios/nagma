// What the popup's options keep: chrome.storage.sync for the choices, chrome.storage.local for the
// personal access token (it never leaves this browser's profile, and isn't synced).

export interface Settings {
    // The Nagma the capture goes to.
    address: string;
    // Hover, focus and press states as component variants.
    states: boolean;
    // Capture the page at several widths, and which: "Desktop 1280, Tablet 800, Phone 375".
    breakpointsOn: boolean;
    breakpoints: string;
    // Parts the page runs with script (tabs, carousels…) come in as Live frames that keep working.
    interactive: boolean;
    // Send the capture to the Nagma server at `address` (POST /captures with the token) instead of
    // handing it to a Nagma tab.
    viaServer: boolean;
    // The person said no to the debugger permission: states and widths use the fallbacks, and the
    // popup doesn't ask again unless asked to.
    debuggerDeclined: boolean;
}

export const ADDRESSES = ["https://api.nagma.app", "http://localhost:5310"];

export const DEFAULT_BREAKPOINTS = "Desktop 1280, Tablet 800, Phone 375";

export const DEFAULT_SETTINGS: Settings = {
    address: "https://api.nagma.app",
    states: false,
    breakpointsOn: false,
    breakpoints: DEFAULT_BREAKPOINTS,
    interactive: false,
    viaServer: false,
    debuggerDeclined: false,
};

export interface BreakpointSpec {
    label: string;
    width: number;
}

// "Desktop 1280, Tablet 800, Phone 375" → widest first. A bare width is named for itself; widths
// outside 240 to 3840 and repeats are left out; at most five.
export function parseBreakpoints(text: string): BreakpointSpec[] {
    const out: BreakpointSpec[] = [];
    for (const part of text.split(/[,;\n]+/)) {
        const m = /^\s*(.*?)\s*(\d{3,4})\s*(?:px)?\s*$/i.exec(part);
        if (!m) continue;
        const width = parseInt(m[2] as string, 10);
        if (width < 240 || width > 3840 || out.some((b) => b.width === width)) continue;
        const label = (m[1] ?? "").replace(/[:=]\s*$/, "").trim() || `${width}`;
        out.push({ label, width });
    }
    return out.sort((a, b) => b.width - a.width).slice(0, 5);
}

export async function loadSettings(): Promise<Settings> {
    const stored = (await chrome.storage.sync.get(DEFAULT_SETTINGS)) as Settings;
    return { ...DEFAULT_SETTINGS, ...stored };
}

export async function loadToken(): Promise<string> {
    const { token } = (await chrome.storage.local.get({ token: "" })) as { token: string };
    return token;
}
