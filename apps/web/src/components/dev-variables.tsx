import { Copy01 } from "@untitledui/icons";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Popover as AriaPopover } from "react-aria-components";
import { SCOPE_LABELS, collectionsOf, findVariable, isAlias, resolveVariable } from "../engine/variables";
import type { NagmaDocument, SceneNode, Variable, VariableValue } from "../engine/types";
import { copyText } from "../engine/dev-code";

// Inspect's variables: details for a bound variable (collection, value per mode with the alias
// chain, scopes, code syntax), the colours a layer uses, and suggestions of variables that hold the
// same value as a raw colour.

function chain(doc: NagmaDocument, value: VariableValue | undefined, depth = 0): string[] {
    if (!isAlias(value) || depth > 16) return [String(value ?? "")];
    const next = findVariable(doc, value.alias)?.variable;
    if (!next) return ["Missing variable"];
    const coll = findVariable(doc, next.id)?.collection;
    const mode = coll?.defaultModeId ?? coll?.modes[0]?.id ?? "";
    return [next.name, ...chain(doc, next.values[mode], depth + 1)];
}

function tokenNames(v: Variable): { web: string; ios: string; android: string } {
    const words = v.name.split(/[^a-z0-9]+/i).filter(Boolean);
    const camel = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]?.toUpperCase() + w.slice(1).toLowerCase())).join("");
    return {
        web: v.codeSyntax?.web?.trim() || `var(--${words.join("-").toLowerCase()})`,
        ios: v.codeSyntax?.ios?.trim() || camel,
        android: v.codeSyntax?.android?.trim() || words.join("_").toLowerCase(),
    };
}

export function VariableDetails({ doc, variableId }: { doc: NagmaDocument; variableId: string }) {
    const found = findVariable(doc, variableId);
    if (!found) return <p className="text-ink-muted">This variable is missing.</p>;
    const { variable, collection } = found;
    const tokens = tokenNames(variable);
    return (
        <div className="space-y-2.5">
            <div>
                <div className="font-semibold break-all">{variable.name}</div>
                <div className="text-ink-muted">
                    {collection.name}
                    {collection.libraryId ? " · from a library" : ""}
                </div>
            </div>
            {variable.description && <p className="whitespace-pre-wrap text-ink-muted">{variable.description}</p>}
            <div>
                <div className="mb-1 text-ink-muted">Values</div>
                {collection.modes.map((m) => {
                    const steps = chain(doc, variable.values[m.id]);
                    const last = steps[steps.length - 1] ?? "";
                    return (
                        <div key={m.id} className="flex min-h-6 items-center gap-2 py-0.5">
                            <span className="w-16 shrink-0 truncate text-ink-muted">{m.name}</span>
                            {variable.type === "color" && /^#/.test(last) && <span className="size-3.5 shrink-0 rounded border border-black/20" style={{ background: last }} />}
                            <span className="min-w-0 flex-1 break-all">{steps.join(" → ")}</span>
                        </div>
                    );
                })}
            </div>
            <div>
                <div className="mb-1 text-ink-muted">Scope</div>
                <div>{(variable.scopes?.length ? variable.scopes : ["all" as const]).map((s) => SCOPE_LABELS[s]).join(", ")}</div>
            </div>
            <div>
                <div className="mb-1 text-ink-muted">Code</div>
                {(["web", "ios", "android"] as const).map((p) => (
                    <button key={p} type="button" onClick={() => void copyText(tokens[p])} title="Click to copy" className="flex h-6 w-full items-center gap-2 rounded px-1 text-left hover:bg-panel-hover">
                        <span className="w-14 shrink-0 text-ink-muted">{p === "web" ? "Web" : p === "ios" ? "iOS" : "Android"}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px]">{tokens[p]}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

// A variable row that opens its details.
export function VariableChip({ doc, variableId, children }: { doc: NagmaDocument; variableId: string; children: React.ReactNode }) {
    return (
        <AriaDialogTrigger>
            <AriaButton className="flex h-6 min-w-0 flex-1 items-center gap-2 rounded px-1 text-left outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500">{children}</AriaButton>
            <AriaPopover placement="left top" offset={12} className="w-64 rounded-lg border border-panel-border bg-panel-raised p-3 text-[11px] text-ink shadow-xl outline-none">
                <AriaDialog aria-label="Variable details" className="outline-none">
                    <VariableDetails doc={doc} variableId={variableId} />
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

interface ColorUse {
    hex: string;
    opacity: number;
    variableId: string | null;
}

// The solid colours in the layer and everything inside it, each once.
function colorsIn(doc: NagmaDocument, node: SceneNode): ColorUse[] {
    const out = new Map<string, ColorUse>();
    const walk = (n: SceneNode, depth: number) => {
        if (!n.visible || depth > 40) return;
        for (const [list, key] of [
            [n.fills, "fill"],
            [n.strokes, "stroke"],
        ] as const) {
            list.forEach((p, i) => {
                if (!p.visible || p.type !== "solid") return;
                const variableId = n.boundVariables?.[`${key}:${i}`] ?? (i === 0 ? n.boundVariables?.[key] : undefined) ?? null;
                const k = variableId ?? `${p.color.toUpperCase()}/${p.opacity}`;
                if (!out.has(k)) out.set(k, { hex: p.color.toUpperCase(), opacity: p.opacity, variableId });
            });
        }
        for (const id of n.children) {
            const c = doc.nodes[id];
            if (c) walk(c, depth + 1);
        }
    };
    walk(node, 0);
    return [...out.values()].slice(0, 24);
}

// Colour variables whose value (in their default mode) is exactly this colour.
function suggestColorVariables(doc: NagmaDocument, hex: string): Variable[] {
    const want = hex.toUpperCase();
    const out: Variable[] = [];
    for (const c of collectionsOf(doc)) {
        for (const v of c.variables) {
            if (v.type !== "color" || v.hidden) continue;
            const r = resolveVariable(doc, v.id, null, { modes: {} });
            if (r && typeof r.value === "string" && r.value.toUpperCase() === want && r.opacity === 1) out.push(v);
        }
    }
    return out.slice(0, 3);
}

export function ColorsSection({ node, doc }: { node: SceneNode; doc: NagmaDocument }) {
    const colors = colorsIn(doc, node);
    if (!colors.length) return null;
    return (
        <div className="border-b border-panel-border px-3 py-2.5">
            <div className="mb-1.5 flex h-6 items-center font-semibold">Colours</div>
            {colors.map((c) => {
                const v = c.variableId ? findVariable(doc, c.variableId)?.variable : undefined;
                const suggested = v ? [] : suggestColorVariables(doc, c.hex);
                const value = `${c.hex}${c.opacity < 1 ? ` ${Math.round(c.opacity * 100)}%` : ""}`;
                return (
                    <div key={`${c.variableId ?? ""}${c.hex}${c.opacity}`}>
                        <div className="flex items-center gap-1">
                            {v && c.variableId ? (
                                <VariableChip doc={doc} variableId={c.variableId}>
                                    <span className="size-3.5 shrink-0 rounded border border-black/20" style={{ background: c.hex, opacity: c.opacity }} />
                                    <span className="min-w-0 flex-1 truncate">{v.name}</span>
                                    <span className="shrink-0 text-ink-muted">{value}</span>
                                </VariableChip>
                            ) : (
                                <button type="button" onClick={() => void copyText(c.hex)} title="Click to copy" className="flex h-6 min-w-0 flex-1 items-center gap-2 rounded px-1 text-left hover:bg-panel-hover">
                                    <span className="size-3.5 shrink-0 rounded border border-black/20" style={{ background: c.hex, opacity: c.opacity }} />
                                    <span className="min-w-0 flex-1 truncate">{value}</span>
                                    <Copy01 className="size-3 shrink-0 text-ink-subtle" />
                                </button>
                            )}
                        </div>
                        {suggested.map((s) => (
                            <button key={s.id} type="button" onClick={() => void copyText(tokenNames(s).web, `Copied ${s.name}.`)} title="A variable with this value. Click to copy its name." className="ml-6 flex h-5 items-center gap-1 rounded px-1 text-[10.5px] text-brand-500 hover:bg-panel-hover">
                                Suggested: {s.name}
                            </button>
                        ))}
                    </div>
                );
            })}
        </div>
    );
}
