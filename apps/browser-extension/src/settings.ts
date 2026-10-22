// What the popup's options keep (chrome.storage.sync).

export interface Settings {
    // The Nagma the capture goes to.
    address: string;
    // Phase 2: hover and focus states as variants (not yet).
    states: boolean;
}

export const ADDRESSES = ["https://api.nagma.app", "http://localhost:5310"];

export const DEFAULT_SETTINGS: Settings = { address: "https://api.nagma.app", states: false };
