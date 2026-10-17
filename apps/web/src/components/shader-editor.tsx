import { useState } from "react";
import { shaderError } from "../canvas/shader-paint";
import { SHADER_PRESETS, parseUniforms, usesTime } from "../engine/shaders";
import type { ShaderUniform } from "../engine/types";
import { ColorSwatch } from "./color-picker";
import { NumberField } from "./number-field";
import { Select } from "./select";

// The shader popover's body, shared by shader fills and shader effects: a preset menu, the code
// (a monospace textarea; edits apply when it loses focus or on ⌘↵), the error line when the code
// does not compile, and one control per uniform the code declares.

export interface ShaderValue {
    code: string;
    uniforms: ShaderUniform[];
    preset?: string;
}

const field = "h-6 min-w-0 rounded-md border border-transparent bg-field px-1.5 text-ink outline-none hover:border-panel-border focus:border-brand-500";

export function ShaderEditor({ value, onChange, onPreview }: { value: ShaderValue; onChange: (next: ShaderValue) => void; onPreview?: (next: ShaderValue) => void }) {
    const [draft, setDraft] = useState(value.code);
    // A new code value from outside (undo, a preset) replaces the draft.
    const [seen, setSeen] = useState(value.code);
    if (seen !== value.code) {
        setSeen(value.code);
        setDraft(value.code);
    }
    const error = shaderError(value.code);
    const commitCode = () => {
        if (draft === value.code) return;
        onChange({ ...value, code: draft, uniforms: parseUniforms(draft, value.uniforms), preset: undefined });
    };
    const setUniform = (name: string, v: ShaderUniform["value"], preview = false) => {
        const next = { ...value, uniforms: value.uniforms.map((u) => (u.name === name ? { ...u, value: v } : u)) };
        if (preview && onPreview) onPreview(next);
        else onChange(next);
    };
    const presetId = SHADER_PRESETS.find((p) => p.code === value.code)?.id ?? value.preset ?? "";
    return (
        <div className="space-y-2">
            <Select
                aria-label="Shader preset"
                value={SHADER_PRESETS.some((p) => p.id === presetId) ? presetId : "custom"}
                onChange={(e) => {
                    const preset = SHADER_PRESETS.find((p) => p.id === e.target.value);
                    if (preset) onChange({ code: preset.code, uniforms: parseUniforms(preset.code), preset: preset.id });
                }}
                className={`${field} w-full`}
            >
                {!SHADER_PRESETS.some((p) => p.id === presetId) && <option value="custom">Custom</option>}
                {SHADER_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                        {p.name}
                    </option>
                ))}
            </Select>
            <textarea
                aria-label="Shader code"
                spellCheck={false}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitCode}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        commitCode();
                    }
                    if (e.key === "Tab") {
                        // Tab indents instead of leaving the editor.
                        e.preventDefault();
                        const el = e.currentTarget;
                        const { selectionStart: a, selectionEnd: b } = el;
                        const next = `${draft.slice(0, a)}    ${draft.slice(b)}`;
                        setDraft(next);
                        requestAnimationFrame(() => el.setSelectionRange(a + 4, a + 4));
                    }
                }}
                className={`h-40 w-full resize-y rounded-md border bg-field p-2 font-mono text-[10.5px] leading-[1.4] text-ink outline-none focus:border-brand-500 ${error ? "border-red-500/60" : "border-transparent"}`}
            />
            {error ? (
                <p className="rounded-md bg-red-500/10 px-2 py-1 font-mono text-[10px] leading-snug whitespace-pre-wrap text-red-500" role="alert">
                    {error}
                </p>
            ) : (
                <p className="text-[10px] text-ink-subtle">{usesTime(value.code) ? "Animates with iTime. " : ""}Uniforms get a control each; a comment after one sets its default, for example 0.5 [0, 2].</p>
            )}
            {value.uniforms.length > 0 && (
                <div className="space-y-1">
                    {value.uniforms.map((u) => (
                        <div key={u.name} className="grid grid-cols-[72px_1fr] items-center gap-2">
                            <span className="truncate text-ink-muted" title={u.name}>
                                {u.name}
                            </span>
                            {u.type === "color" ? (
                                <div className="flex h-6 items-center gap-2 rounded-md bg-field pr-2 pl-1">
                                    <ColorSwatch size={4} color={typeof u.value === "string" ? u.value : "#FFFFFF"} label={`${u.name} colour`} onChange={(c) => setUniform(u.name, c.toUpperCase())} onPreview={(c) => setUniform(u.name, c.toUpperCase(), true)} />
                                    <span className="truncate uppercase">{typeof u.value === "string" ? u.value.replace("#", "") : ""}</span>
                                </div>
                            ) : u.type === "vec2" ? (
                                <div className="grid grid-cols-2 gap-1">
                                    <NumberField label="X" step={0.01} value={Array.isArray(u.value) ? u.value[0] : 0} onCommit={(v) => setUniform(u.name, [v, Array.isArray(u.value) ? u.value[1] : 0])} />
                                    <NumberField label="Y" step={0.01} value={Array.isArray(u.value) ? u.value[1] : 0} onCommit={(v) => setUniform(u.name, [Array.isArray(u.value) ? u.value[0] : 0, v])} />
                                </div>
                            ) : (
                                <div className="flex items-center gap-1.5">
                                    <input
                                        type="range"
                                        aria-label={u.name}
                                        min={u.min ?? 0}
                                        max={u.max ?? 1}
                                        step={((u.max ?? 1) - (u.min ?? 0)) / 200}
                                        value={typeof u.value === "number" ? u.value : 0}
                                        onChange={(e) => setUniform(u.name, Number(e.target.value), true)}
                                        onPointerUp={(e) => setUniform(u.name, Number(e.currentTarget.value))}
                                        onKeyUp={(e) => setUniform(u.name, Number(e.currentTarget.value))}
                                        className="h-1 min-w-0 flex-1 accent-brand-500"
                                    />
                                    <div className="w-14 shrink-0">
                                        <NumberField label="" step={0.01} value={typeof u.value === "number" ? Math.round(u.value * 100) / 100 : 0} onCommit={(v) => setUniform(u.name, v)} />
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
