// Frame size presets: the Frame tool's panel in the right sidebar and the frame header's dropdown.
// Sizes are the commonly published logical sizes of each device or format.
export interface FramePreset {
    name: string;
    w: number;
    h: number;
}

export const FRAME_PRESETS: { group: string; items: FramePreset[] }[] = [
    {
        group: "Phone",
        items: [
            { name: "iPhone 16 Pro Max", w: 440, h: 956 },
            { name: "iPhone 16 Pro", w: 402, h: 874 },
            { name: "iPhone 16 Plus", w: 430, h: 932 },
            { name: "iPhone 16", w: 393, h: 852 },
            { name: "iPhone 14 & 15 Pro Max", w: 430, h: 932 },
            { name: "iPhone 14 & 15 Pro", w: 393, h: 852 },
            { name: "iPhone 13 & 14", w: 390, h: 844 },
            { name: "iPhone 14 Plus", w: 428, h: 926 },
            { name: "iPhone 13 mini", w: 375, h: 812 },
            { name: "iPhone SE", w: 320, h: 568 },
            { name: "iPhone 8 Plus", w: 414, h: 736 },
            { name: "iPhone 8", w: 375, h: 667 },
            { name: "Android Small", w: 360, h: 640 },
            { name: "Android Large", w: 360, h: 800 },
        ],
    },
    {
        group: "Tablet",
        items: [
            { name: "Surface Pro 8", w: 1440, h: 960 },
            { name: "iPad mini 8.3", w: 744, h: 1133 },
            { name: "iPad Pro 11\"", w: 834, h: 1194 },
            { name: "iPad Pro 12.9\"", w: 1024, h: 1366 },
            { name: "Surface Pro 4", w: 1368, h: 912 },
        ],
    },
    {
        group: "Desktop",
        items: [
            { name: "MacBook Air", w: 1280, h: 832 },
            { name: "MacBook Pro 14\"", w: 1512, h: 982 },
            { name: "MacBook Pro 16\"", w: 1728, h: 1117 },
            { name: "Desktop", w: 1440, h: 1024 },
            { name: "Wireframe", w: 1440, h: 1024 },
            { name: "TV", w: 1280, h: 720 },
            { name: "iMac", w: 1280, h: 720 },
        ],
    },
    {
        group: "Presentation",
        items: [
            { name: "Slide 16:9", w: 1920, h: 1080 },
            { name: "Slide 4:3", w: 1024, h: 768 },
        ],
    },
    {
        group: "Watch",
        items: [
            { name: "Apple Watch 45mm", w: 198, h: 242 },
            { name: "Apple Watch 44mm", w: 184, h: 224 },
            { name: "Apple Watch 41mm", w: 176, h: 215 },
            { name: "Apple Watch 40mm", w: 162, h: 197 },
            { name: "Android", w: 384, h: 384 },
        ],
    },
    {
        group: "Paper",
        items: [
            { name: "A4", w: 595, h: 842 },
            { name: "A5", w: 420, h: 595 },
            { name: "A6", w: 298, h: 420 },
            { name: "Letter", w: 612, h: 792 },
            { name: "Tabloid", w: 792, h: 1224 },
        ],
    },
    {
        group: "Social Media",
        items: [
            { name: "Twitter post", w: 1200, h: 675 },
            { name: "Twitter header", w: 1500, h: 500 },
            { name: "Facebook post", w: 1200, h: 630 },
            { name: "Facebook cover", w: 820, h: 312 },
            { name: "Instagram post", w: 1080, h: 1080 },
            { name: "Instagram story", w: 1080, h: 1920 },
            { name: "Dribbble shot", w: 400, h: 300 },
            { name: "LinkedIn cover", w: 1584, h: 396 },
            { name: "YouTube thumbnail", w: 1280, h: 720 },
        ],
    },
    {
        group: "Community",
        items: [
            { name: "Plugin cover", w: 1920, h: 960 },
            { name: "Plugin icon", w: 128, h: 128 },
            { name: "File cover", w: 1920, h: 1080 },
            { name: "Profile banner", w: 1600, h: 400 },
        ],
    },
    {
        group: "Archive",
        items: [
            { name: "iPhone 11 Pro Max", w: 414, h: 896 },
            { name: "iPhone 11 Pro / X", w: 375, h: 812 },
            { name: "iPhone 11", w: 414, h: 896 },
            { name: "iPhone 12 mini", w: 360, h: 780 },
            { name: "iPhone 5", w: 320, h: 568 },
            { name: "Google Pixel 2", w: 411, h: 731 },
            { name: "Google Pixel 2 XL", w: 411, h: 823 },
            { name: "Android (older)", w: 360, h: 640 },
            { name: "iPad (older)", w: 768, h: 1024 },
            { name: "MacBook", w: 1152, h: 700 },
            { name: "Apple Watch 42mm", w: 156, h: 195 },
            { name: "Apple Watch 38mm", w: 136, h: 170 },
        ],
    },
];

// A click with the Frame tool makes a 100 × 100 frame the first time, then repeats the size of the
// last top-level frame made this session (drawn, or picked from the preset panel).
let lastSize: FramePreset | null = null;

export function lastFrameSize(): { w: number; h: number } {
    return lastSize ? { w: lastSize.w, h: lastSize.h } : { w: 100, h: 100 };
}

export function rememberFrameSize(w: number, h: number, name = "") {
    lastSize = { name, w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}
