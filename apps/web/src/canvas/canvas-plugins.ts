import type { Camera, SceneNode } from "../engine/types";

// Extra canvas interactions (crop mode, polygon and star handles, width points, the eraser, the
// points bounding box, placing images...) plug in here, so the main canvas view only forwards
// pointer events and draws their overlays. The first plugin that claims a press gets the drag.

export interface PluginPointer {
    // Canvas-local screen position and the matching world position.
    screen: { x: number; y: number };
    world: { x: number; y: number };
    shiftKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    button: number;
}

export interface CanvasPlugin {
    name: string;
    // A press: return true to take it (later moves and the release come to this plugin).
    down?(p: PluginPointer): boolean;
    move?(p: PluginPointer): void;
    up?(p: PluginPointer): void;
    // No drag in progress: a cursor to show, or undefined to leave it to the canvas.
    hover?(p: PluginPointer): string | undefined;
    dblclick?(p: PluginPointer): boolean;
    // Drawn over the scene in screen space (CSS pixels).
    overlay?(ctx: CanvasRenderingContext2D, camera: Camera): void;
    // A frame whose name label this plugin draws itself (in its overlay), so the canvas skips its own.
    ownsLabel?(node: SceneNode): boolean;
}

const plugins: CanvasPlugin[] = [];
let active: CanvasPlugin | null = null;

// `first` puts a plugin ahead of the others (a product's own buttons drawn over the canvas).
export function registerCanvasPlugin(plugin: CanvasPlugin, first = false) {
    const at = plugins.findIndex((p) => p.name === plugin.name);
    if (at >= 0) plugins[at] = plugin;
    else if (first) plugins.unshift(plugin);
    else plugins.push(plugin);
}

// Whether a plugin draws this frame's label, so the canvas leaves it out.
export function pluginOwnsLabel(node: SceneNode): boolean {
    return plugins.some((p) => p.ownsLabel?.(node));
}

export function pluginDown(p: PluginPointer): boolean {
    for (const plugin of plugins) {
        if (plugin.down?.(p)) {
            active = plugin;
            return true;
        }
    }
    return false;
}

// True when a plugin owns the pointer (dragging) or wants the hover cursor.
export function pluginMove(p: PluginPointer, setCursor: (cursor: string | null) => void): boolean {
    if (active) {
        active.move?.(p);
        return true;
    }
    for (const plugin of plugins) {
        const cursor = plugin.hover?.(p);
        if (cursor !== undefined) {
            setCursor(cursor);
            return true;
        }
    }
    return false;
}

export function pluginUp(p: PluginPointer): boolean {
    const plugin = active;
    active = null;
    if (!plugin) return false;
    plugin.up?.(p);
    return true;
}

export function pluginDoubleClick(p: PluginPointer): boolean {
    return plugins.some((plugin) => plugin.dblclick?.(p));
}

export function pluginActive(): boolean {
    return active !== null;
}

export function drawPluginOverlays(ctx: CanvasRenderingContext2D, camera: Camera) {
    const dpr = window.devicePixelRatio || 1;
    for (const plugin of plugins) {
        if (!plugin.overlay) continue;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        try {
            plugin.overlay(ctx, camera);
        } catch (error) {
            console.error(`Canvas overlay ${plugin.name} failed`, error);
        }
        ctx.restore();
    }
}

// Shared drawing helpers for handles.
export const HANDLE_BLUE = "#0D99FF";

export function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r = 4, fill = "#FFFFFF", stroke = HANDLE_BLUE) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = stroke;
    ctx.stroke();
}

export function drawSquare(ctx: CanvasRenderingContext2D, x: number, y: number, size = 7, fill = "#FFFFFF", stroke = HANDLE_BLUE) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    ctx.strokeRect(x - size / 2 + 0.5, y - size / 2 + 0.5, size - 1, size - 1);
}

export function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
    ctx.font = "500 11px Inter, system-ui, sans-serif";
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = HANDLE_BLUE;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y, w, 18, 3);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 9.5);
    ctx.textAlign = "start";
}

export function canvasPlugins(): readonly CanvasPlugin[] {
    return plugins;
}
