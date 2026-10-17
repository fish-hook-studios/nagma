// Devices a prototype can be shown in: the screen's size in points, and how its frame (bezel) looks.
// The player draws every bezel itself (canvas/device-frame.ts).

export type DeviceCategory = "phone" | "tablet" | "desktop" | "watch" | "presentation" | "custom";
export type BezelKind = "island" | "notch" | "home-button" | "punch-hole" | "tablet" | "tablet-home" | "laptop" | "monitor" | "watch" | "none";

export interface DeviceColor {
    name: string;
    // The body, and the edge highlight.
    body: string;
    edge: string;
}

export interface Device {
    id: string;
    name: string;
    category: DeviceCategory;
    width: number;
    height: number;
    bezel: BezelKind;
    colors: DeviceColor[];
}

const TITANIUM: DeviceColor[] = [
    { name: "Black titanium", body: "#2E2E30", edge: "#5B5B5E" },
    { name: "Natural titanium", body: "#BAB4A9", edge: "#E0DBD2" },
    { name: "White titanium", body: "#E4E2DD", edge: "#F7F6F2" },
    { name: "Desert titanium", body: "#BFA48F", edge: "#E1CDBC" },
];
const ALUMINIUM: DeviceColor[] = [
    { name: "Black", body: "#26272B", edge: "#4A4B50" },
    { name: "White", body: "#EDEDEB", edge: "#FFFFFF" },
    { name: "Pink", body: "#F2C6D6", edge: "#FBE3EB" },
    { name: "Teal", body: "#A7CFCB", edge: "#CDE6E3" },
    { name: "Ultramarine", body: "#7B87E0", edge: "#A8B1F0" },
];
const CLASSIC: DeviceColor[] = [
    { name: "Black", body: "#1D1D1F", edge: "#3A3A3D" },
    { name: "White", body: "#F2F2F0", edge: "#FFFFFF" },
    { name: "Red", body: "#C21F2C", edge: "#E04650" },
];
const ANDROID: DeviceColor[] = [
    { name: "Obsidian", body: "#1F2023", edge: "#424449" },
    { name: "Porcelain", body: "#ECE8E1", edge: "#FFFFFF" },
    { name: "Hazel", body: "#8C9184", edge: "#B4B8AC" },
];
const TABLET: DeviceColor[] = [
    { name: "Space gray", body: "#3B3C40", edge: "#62646A" },
    { name: "Silver", body: "#D9DADC", edge: "#F2F2F3" },
    { name: "Starlight", body: "#E8E0D2", edge: "#F7F2E9" },
];
const LAPTOP: DeviceColor[] = [
    { name: "Space black", body: "#2D2E31", edge: "#55575C" },
    { name: "Silver", body: "#C9CBCE", edge: "#E9EAEC" },
    { name: "Midnight", body: "#2B3240", edge: "#4D5668" },
];
const WATCH: DeviceColor[] = [
    { name: "Midnight", body: "#1F2229", edge: "#454A55" },
    { name: "Starlight", body: "#DCD3C4", edge: "#F1EBE0" },
    { name: "Silver", body: "#C7C9CC", edge: "#E8E9EB" },
];
const PLAIN: DeviceColor[] = [{ name: "Default", body: "#000000", edge: "#000000" }];

export const DEVICES: Device[] = [
    { id: "iphone-16", name: "iPhone 16", category: "phone", width: 393, height: 852, bezel: "island", colors: ALUMINIUM },
    { id: "iphone-16-plus", name: "iPhone 16 Plus", category: "phone", width: 430, height: 932, bezel: "island", colors: ALUMINIUM },
    { id: "iphone-16-pro", name: "iPhone 16 Pro", category: "phone", width: 402, height: 874, bezel: "island", colors: TITANIUM },
    { id: "iphone-16-pro-max", name: "iPhone 16 Pro Max", category: "phone", width: 440, height: 956, bezel: "island", colors: TITANIUM },
    { id: "iphone-14", name: "iPhone 14", category: "phone", width: 390, height: 844, bezel: "notch", colors: CLASSIC },
    { id: "iphone-13-mini", name: "iPhone 13 mini", category: "phone", width: 375, height: 812, bezel: "notch", colors: CLASSIC },
    { id: "iphone-se", name: "iPhone SE", category: "phone", width: 375, height: 667, bezel: "home-button", colors: CLASSIC },
    { id: "pixel-9", name: "Google Pixel 9", category: "phone", width: 412, height: 923, bezel: "punch-hole", colors: ANDROID },
    { id: "galaxy-s24", name: "Samsung Galaxy S24", category: "phone", width: 384, height: 832, bezel: "punch-hole", colors: ANDROID },
    { id: "android-compact", name: "Android compact", category: "phone", width: 412, height: 917, bezel: "punch-hole", colors: ANDROID },
    { id: "android-medium", name: "Android medium", category: "phone", width: 700, height: 840, bezel: "punch-hole", colors: ANDROID },
    { id: "ipad-mini", name: "iPad mini", category: "tablet", width: 744, height: 1133, bezel: "tablet", colors: TABLET },
    { id: "ipad-air", name: "iPad Air 11\"", category: "tablet", width: 820, height: 1180, bezel: "tablet", colors: TABLET },
    { id: "ipad-pro-11", name: "iPad Pro 11\"", category: "tablet", width: 834, height: 1210, bezel: "tablet", colors: TABLET },
    { id: "ipad-pro-13", name: "iPad Pro 13\"", category: "tablet", width: 1032, height: 1376, bezel: "tablet", colors: TABLET },
    { id: "ipad", name: "iPad (classic)", category: "tablet", width: 768, height: 1024, bezel: "tablet-home", colors: TABLET },
    { id: "surface-pro", name: "Surface Pro", category: "tablet", width: 1440, height: 960, bezel: "tablet", colors: LAPTOP },
    { id: "macbook-air", name: "MacBook Air", category: "desktop", width: 1280, height: 832, bezel: "laptop", colors: LAPTOP },
    { id: "macbook-pro-14", name: "MacBook Pro 14\"", category: "desktop", width: 1512, height: 982, bezel: "laptop", colors: LAPTOP },
    { id: "macbook-pro-16", name: "MacBook Pro 16\"", category: "desktop", width: 1728, height: 1117, bezel: "laptop", colors: LAPTOP },
    { id: "imac", name: "iMac", category: "desktop", width: 1280, height: 720, bezel: "monitor", colors: [...LAPTOP.slice(1), { name: "Blue", body: "#4A6FB5", edge: "#7E9BD6" }] },
    { id: "desktop", name: "Desktop", category: "desktop", width: 1440, height: 1024, bezel: "monitor", colors: [LAPTOP[0] as DeviceColor] },
    { id: "watch-41", name: "Apple Watch 41mm", category: "watch", width: 176, height: 215, bezel: "watch", colors: WATCH },
    { id: "watch-45", name: "Apple Watch 45mm", category: "watch", width: 198, height: 242, bezel: "watch", colors: WATCH },
    { id: "watch-49", name: "Apple Watch Ultra", category: "watch", width: 205, height: 251, bezel: "watch", colors: WATCH },
    { id: "presentation", name: "Presentation", category: "presentation", width: 1920, height: 1080, bezel: "none", colors: PLAIN },
];

export const CATEGORY_LABELS: [DeviceCategory, string][] = [
    ["phone", "Phone"],
    ["tablet", "Tablet"],
    ["desktop", "Desktop"],
    ["watch", "Watch"],
    ["presentation", "Presentation"],
];

// The device whose screen is exactly this size (either way round), for frames made from a device
// preset: a prototype with no device chosen shows in it.
export function matchingDevice(w: number, h: number): Device | null {
    const W = Math.round(w);
    const H = Math.round(h);
    return DEVICES.find((d) => d.category !== "presentation" && ((d.width === W && d.height === H) || (d.width === H && d.height === W))) ?? null;
}

export function deviceById(id: string | undefined): Device | null {
    return DEVICES.find((d) => d.id === id) ?? null;
}

// The screen of the chosen device, in points (rotated when landscape), or null for none.
export function deviceScreen(setting: { id: string; landscape?: boolean; width?: number; height?: number } | undefined): { w: number; h: number; device: Device | null } | null {
    if (!setting || setting.id === "none") return null;
    if (setting.id === "custom") return { w: Math.max(1, setting.width ?? 1280), h: Math.max(1, setting.height ?? 800), device: null };
    const device = deviceById(setting.id);
    if (!device) return null;
    const rotate = setting.landscape && device.category !== "presentation" && device.bezel !== "laptop" && device.bezel !== "monitor" && device.bezel !== "watch";
    return rotate ? { w: device.height, h: device.width, device } : { w: device.width, h: device.height, device };
}

// Whether a device turns to landscape.
export function rotates(device: Device | null): boolean {
    return Boolean(device && (device.category === "phone" || device.category === "tablet"));
}
