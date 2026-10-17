import { AlertCircle, AlertTriangle, ChevronDown, DotsHorizontal, Plus } from "@untitledui/icons";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator, SubmenuTrigger as AriaSubmenuTrigger } from "react-aria-components";
import { addVariant, detachInstance, goToMainComponent, renameVariantValue, setVariant } from "../engine/actions";
import {
    addToSlot,
    clearSlot,
    combineAsVariants,
    convertToSlot,
    createMultipleComponents,
    exposedInInstance,
    instanceOverrides,
    owningComponent,
    propHost,
    pushOverridesToMain,
    resetAllOverrides,
    resetOverrideKeys,
    resetPropValue,
    resetSlot,
    slotInfo,
    slotsInInstance,
    variantConflicts,
} from "../engine/component-actions";
import { assetName, isFrameLike, propsOf, setProperties, variantProps } from "../engine/components";
import { editor, useEditor } from "../engine/store";
import { enabledLibraries } from "../engine/library";
import type { SceneNode } from "../engine/types";
import { componentForAsset, currentAsset, localAssetId, swapTo, useAssetSources } from "./asset-sources";
import { ComponentIcon, InstanceIcon } from "./component-icons";
import { CreatePropertyMenu, DescriptionEditor, DescriptionView, InstancePropValues, PropBinding, PropertiesList } from "./component-props";
import { editProp } from "./component-ui";
import { IconButton } from "./icon-button";
import { SECTION, Section } from "./panel-section";
import { SwapMenu } from "./instance-swap";
import { MenuRow } from "./left-sidebar";
import { Select } from "./select";

// The component parts of the Design panel: component, component set and instance sections,
// component properties, nested instances, slots and the instance swap menu.

const purple = (icon: React.ReactNode, text: string) => (
    <span className="flex items-center gap-1.5 text-[#B67CFF]">
        {icon} {text}
    </span>
);
const select = "h-6 min-w-0 rounded-md border border-transparent bg-field px-1.5 text-ink outline-none hover:border-panel-border focus:border-brand-500";

// The instance's name opens the swap menu (and so does the chevron next to it).
export function InstanceSwapButton({ node }: { node: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    const sources = useAssetSources();
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label="Swap instance" className="-ml-1 flex max-w-[170px] items-center gap-1 rounded-md px-1 text-left font-semibold text-ink outline-none hover:bg-panel-hover">
                <span className="truncate">{assetName(doc, node.componentId)}</span>
                <ChevronDown className="mr-1 size-3 shrink-0 text-ink-subtle" />
            </AriaButton>
            <AriaPopover placement="left top" offset={12} className="rounded-lg border border-panel-border bg-panel-raised text-ink shadow-xl outline-none">
                <AriaDialog className="outline-none" aria-label="Swap instance">
                    {({ close }) => (
                        <SwapMenu
                            sources={sources}
                            current={currentAsset(doc, node.componentId)}
                            onPick={(target) => {
                                void swapTo(node.id, target);
                                close();
                            }}
                        />
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

function VariantSelects({ instance }: { instance: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    const component = instance.componentId ? doc.nodes[instance.componentId] : undefined;
    const set = component?.parentId ? doc.nodes[component.parentId] : undefined;
    if (!component || set?.type !== "componentSet") return null;
    const current = variantProps(component.name);
    return (
        <>
            {setProperties(doc, set.id).map(([key, values]) => (
                <label key={key} className="grid grid-cols-[88px_88px] items-center gap-2">
                    <span className="truncate text-ink-muted">{key}</span>
                    <Select aria-label={key} value={current[key] ?? ""} onChange={(event) => setVariant(instance.id, key, event.target.value)} className={`${select} border-panel-border bg-transparent`}>
                        {values.map((value) => (
                            <option key={value} value={value}>
                                {value}
                            </option>
                        ))}
                    </Select>
                </label>
            ))}
        </>
    );
}

function Conflicts({ setId, variantId }: { setId: string; variantId?: string }) {
    const doc = useEditor((s) => s.doc);
    const groups = variantConflicts(doc, setId).filter((g) => !variantId || g.includes(variantId));
    if (!groups.length) return null;
    return (
        <div className="flex gap-2 rounded-md bg-amber-500/10 p-2 text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0 space-y-0.5">
                <div>{variantId ? "This variant has the same property values as another variant." : "Some variants have the same property values. Instances can't pick between them."}</div>
                {groups.map((g) => (
                    <button key={g.join()} type="button" onClick={() => editor.set({ selection: g })} className="block truncate text-left underline-offset-2 hover:underline">
                        {doc.nodes[g[0] ?? ""]?.name} ({g.length})
                    </button>
                ))}
            </div>
        </div>
    );
}

// Variants whose names aren't "Property=Value" pairs: instances can't offer them as choices.
function InvalidNames({ setId }: { setId: string }) {
    const doc = useEditor((s) => s.doc);
    const set = doc.nodes[setId];
    const invalid = (set?.children ?? []).filter((id) => {
        const child = doc.nodes[id];
        return child?.type === "component" && child.name.split(",").some((part) => !/^[^=]+=[^=]*$/.test(part.trim()));
    });
    if (!invalid.length) return null;
    return (
        <div className="rounded-[5px] bg-field px-2.5 pt-2 pb-[9px] leading-4">
            <AlertCircle className="size-4 text-ink" />
            <p className="mt-[7px] text-ink">Some layers have invalid names. Prop=Value, Prop=Value, …</p>
            <button type="button" onClick={() => editor.set({ selection: invalid })} className="mt-1.5 block text-left text-brand-300 hover:underline">
                Select invalid variants
            </button>
        </div>
    );
}

// Component and instance actions, shown above Position.
export function ComponentSection({ nodes, actions }: { nodes: SceneNode[]; actions?: React.ReactNode }) {
    const doc = useEditor((s) => s.doc);
    const node = nodes.length === 1 ? nodes[0] : undefined;

    // Several layers: create multiple components, or combine components as variants.
    if (nodes.length > 1) {
        const allComponents = nodes.every((n) => n.type === "component" && doc.nodes[n.parentId ?? ""]?.type !== "componentSet");
        const canCreate = nodes.every((n) => !n.sourceId && n.type !== "component" && n.type !== "componentSet" && n.type !== "instance");
        const instances = nodes.filter((n) => n.type === "instance" && !n.sourceId);
        if (!allComponents && !canCreate && instances.length !== nodes.length) return null;
        return (
            <Section title={purple(<ComponentIcon className="size-3.5" />, allComponents ? `${nodes.length} components` : instances.length === nodes.length ? `${nodes.length} instances` : "Components")}>
                {allComponents && (
                    <button type="button" onClick={() => combineAsVariants(nodes.map((n) => n.id))} className="h-6 w-full rounded-md border border-panel-border hover:bg-panel-hover">
                        Combine as variants
                    </button>
                )}
                {canCreate && (
                    <button type="button" onClick={() => createMultipleComponents(nodes.map((n) => n.id))} className="h-6 w-full rounded-md border border-panel-border hover:bg-panel-hover">
                        Create multiple components
                    </button>
                )}
                {instances.length === nodes.length && (
                    <button type="button" onClick={() => resetAllOverrides(instances.map((n) => n.id))} className="h-6 w-full rounded-md border border-panel-border hover:bg-panel-hover">
                        Reset all changes
                    </button>
                )}
            </Section>
        );
    }
    if (!node) return null;

    if (node.type === "componentSet") {
        const lastVariant = [...node.children].reverse().find((id) => doc.nodes[id]?.type === "component");
        return (
            // As in the reference: the Properties block (its "+" also adds a variant), then the warning
            // cards. The set's description is edited from the header's More menu.
            <Section title="Properties" className="[&>[data-section-body]]:pt-1.5 [&>[data-section-body]]:pb-[18px] [&>div:first-child]:h-[22px]" action={<CreatePropertyMenu host={node} onAddVariant={() => lastVariant && addVariant(lastVariant)} />}>
                <PropertiesList host={node} bare />
                <InvalidNames setId={node.id} />
                <Conflicts setId={node.id} />
            </Section>
        );
    }

    if (node.type === "component") {
        const set = doc.nodes[node.parentId ?? ""];
        const inSet = set?.type === "componentSet";
        return (
            <Section title={purple(<ComponentIcon className="size-3.5" />, inSet ? "Variant" : "Component")} action={!inSet ? <IconButton size="sm" icon={Plus} label="Add variant" onPress={() => addVariant(node.id)} /> : undefined}>
                {inSet ? (
                    <>
                        {Object.entries(variantProps(node.name)).map(([key, value]) => (
                            <label key={key} className="flex items-center gap-2">
                                <span className="w-20 shrink-0 truncate text-ink-muted">{key}</span>
                                <input
                                    defaultValue={value}
                                    key={`${node.id}-${key}-${value}`}
                                    aria-label={`${key} value`}
                                    onBlur={(event) => {
                                        const next = event.target.value.trim();
                                        if (next && next !== value) renameVariantValue(node.id, key, next);
                                    }}
                                    onKeyDown={(event) => {
                                        event.stopPropagation();
                                        if (event.key === "Enter") event.currentTarget.blur();
                                    }}
                                    className={`${select} flex-1`}
                                />
                            </label>
                        ))}
                        <Conflicts setId={set.id} variantId={node.id} />
                        <DescriptionEditor node={node} />
                    </>
                ) : (
                    <>
                        <DescriptionEditor node={node} />
                        <PropertiesList host={node} component={node} />
                    </>
                )}
            </Section>
        );
    }

    if (node.type === "instance") return <InstanceSection node={node} actions={actions} />;

    // A slot inside an instance: add, reset or empty its contents.
    const slot = slotInfo(doc, node);
    if (slot) return <SlotSection slot={node} info={slot} />;

    if (node.sourceId) {
        return (
            <Section title={purple(<InstanceIcon className="size-3.5" />, "Inside an instance")}>
                {Boolean(node.overrides?.length) && (
                    <button type="button" onClick={() => resetOverrideKeys(node.id, node.overrides ?? [])} className="h-6 w-full rounded-md border border-panel-border hover:bg-panel-hover">
                        Reset changes
                    </button>
                )}
            </Section>
        );
    }

    // A frame inside a main component: make it a slot, or show the slot it is.
    const host = propHost(doc, node);
    if (host && isFrameLike(node)) {
        const slotProp = node.propBindings?.slot ? (host.componentProps ?? []).find((p) => p.id === node.propBindings?.slot) : undefined;
        return (
            <Section title={slotProp ? purple(<SlotIcon />, "Slot") : "Slot"} action={<PropBinding node={node} field="slot" />}>
                {slotProp ? (
                    <button type="button" onClick={() => editProp({ hostId: host.id, propId: slotProp.id, kind: "slot" })} className="flex h-6 w-full items-center gap-2 rounded-md bg-field px-2 text-left hover:bg-panel-hover">
                        <span className="min-w-0 flex-1 truncate">{slotProp.name}</span>
                        <span className="text-ink-subtle">Edit property</span>
                    </button>
                ) : (
                    <button type="button" onClick={() => convertToSlot(node.id)} className="flex h-6 w-full items-center justify-center gap-1.5 rounded-md border border-panel-border hover:bg-panel-hover">
                        Convert to slot <span className="text-ink-subtle">⇧ ⌘ S</span>
                    </button>
                )}
            </Section>
        );
    }
    return null;
}

function SlotIcon() {
    return (
        <svg viewBox="0 0 14 14" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.2 1.6" aria-hidden="true">
            <rect x="1.5" y="1.5" width="11" height="11" rx="2" />
        </svg>
    );
}

// An instance's header block, in place of the selection header: the component's name (it opens the
// swap menu), where it comes from, then its properties, as in the reference (109pt with one
// property). `actions` are the selection header's buttons.
function InstanceSection({ node, actions }: { node: SceneNode; actions?: React.ReactNode }) {
    const doc = useEditor((s) => s.doc);
    const component = node.componentId ? doc.nodes[node.componentId] : undefined;
    const set = component?.parentId ? doc.nodes[component.parentId] : undefined;
    const main = set?.type === "componentSet" ? set : component;
    const nestedInMain = !node.sourceId && owningComponent(doc, node.parentId ? doc.nodes[node.parentId] : undefined);
    const overrides = instanceOverrides(doc, node.id);
    const props = propsOf(doc, component);
    const modifiedProps = props.filter((p) => node.propValues && p.id in node.propValues);
    const exposed = node.sourceId ? [] : exposedInInstance(doc, node.id);
    const slots = node.sourceId ? [] : slotsInInstance(doc, node.id);
    const act = (key: React.Key) => {
        const k = String(key);
        if (k === "main") goToMainComponent();
        else if (k === "push") pushOverridesToMain(node.id);
        else if (k === "reset") resetAllOverrides([node.id]);
        else if (k === "detach") detachInstance();
        else if (k.startsWith("reset:")) resetOverrideKeys(node.id, k.slice(6).split(","));
        else if (k.startsWith("prop:")) resetPropValue(node.id, k.slice(5));
    };
    const anything = overrides.length > 0 || modifiedProps.length > 0;
    const menu = "w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";
    const library = component?.libraryId ? (enabledLibraries(doc).find((l) => l.id === component.libraryId)?.name ?? "From a library") : null;
    return (
        <section className={`${SECTION} pt-1 pb-4`}>
            <div className="flex h-10 items-center justify-between gap-1">
                <h3 className="min-w-0">
                    <InstanceSwapButton node={node} />
                </h3>
                <span className="flex shrink-0 items-center gap-1">
                    {actions}
                    {nestedInMain && <PropBinding node={node} field="swap" />}
                    <AriaMenuTrigger>
                        <AriaButton aria-label="More actions" className="flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <DotsHorizontal className="size-3.5" />
                        </AriaButton>
                        <AriaPopover placement="bottom end" className={menu}>
                            <AriaMenu className="outline-none" onAction={act} disabledKeys={[...(anything ? [] : ["reset", "push", "specific"]), ...(component?.libraryId || node.sourceId ? ["push"] : [])]} aria-label="Instance actions">
                                <MenuRow id="main" label="Go to main component" />
                                <MenuRow id="push" label="Push changes to main component" />
                                <AriaSubmenuTrigger>
                                    <MenuRow id="specific" label="Reset specific changes" shortcut="›" />
                                    <AriaPopover offset={-4} className={menu}>
                                        <AriaMenu className="outline-none" onAction={act} aria-label="Reset specific changes">
                                            {overrides.map((o) => (
                                                <MenuRow key={o.label} id={`reset:${o.keys.join(",")}`} label={`Reset ${o.label.toLowerCase()}`} />
                                            ))}
                                            {modifiedProps.map((p) => (
                                                <MenuRow key={p.id} id={`prop:${p.id}`} label={`Reset ${p.name} property`} />
                                            ))}
                                        </AriaMenu>
                                    </AriaPopover>
                                </AriaSubmenuTrigger>
                                <AriaSeparator className="my-1 h-px bg-white/10" />
                                <MenuRow id="detach" label="Detach instance" shortcut="⌥ ⌘ B" />
                                <MenuRow id="reset" label="Reset all changes" />
                            </AriaMenu>
                        </AriaPopover>
                    </AriaMenuTrigger>
                </span>
            </div>
            <div className="flex h-3.5 items-center gap-1.5 text-ink-muted">
                {library ?? "From this file"}
                <ComponentIcon className="size-3 text-ink-subtle" />
            </div>
            <div className="mt-2.5 space-y-2 empty:hidden">
            <DescriptionView node={main} />
            <VariantSelects instance={node} />
            {component && <InstancePropValues instance={node} component={component} />}
            {exposed.map((nested) => {
                const nestedComponent = nested.componentId ? doc.nodes[nested.componentId] : undefined;
                return (
                    <div key={nested.id} className="space-y-1.5 border-l-2 border-[#9747FF]/40 pl-2">
                        <button type="button" onClick={() => editor.set({ selection: [nested.id] })} className="flex items-center gap-1 text-[#B67CFF] hover:underline">
                            <InstanceIcon className="size-3" /> {nested.name}
                        </button>
                        <VariantSelects instance={nested} />
                        {nestedComponent && <InstancePropValues instance={nested} component={nestedComponent} nested />}
                    </div>
                );
            })}
            {slots.map((s) => {
                const info = slotInfo(doc, s);
                return info ? <SlotRow key={s.id} slot={s} info={info} /> : null;
            })}
            </div>
        </section>
    );
}

// A slot on an instance: its property, how many layers it holds against the limits, and actions.
function SlotRow({ slot, info }: { slot: SceneNode; info: NonNullable<ReturnType<typeof slotInfo>> }) {
    const count = slot.children.length;
    const { prop } = info;
    const low = prop.minItems != null && count < prop.minItems;
    const high = prop.maxItems != null && count > prop.maxItems;
    const modified = slot.overrides?.includes("children");
    return (
        <div className="space-y-1">
            <div className="flex h-6 items-center gap-1.5">
                <span className="text-[#B67CFF]">
                    <SlotIcon />
                </span>
                <button type="button" onClick={() => editor.set({ selection: [slot.id] })} className="min-w-0 flex-1 truncate text-left hover:underline">
                    {prop.name}
                </button>
                {modified && <span className="rounded bg-panel-hover px-1 text-[10px] text-ink-muted">Modified</span>}
                <AddToSlot slot={slot} info={info} />
            </div>
            {(prop.minItems != null || prop.maxItems != null) && (
                <div className={`flex items-center gap-1 text-[11px] ${low || high ? "text-amber-300" : "text-emerald-400"}`}>
                    {low || high ? <AlertTriangle className="size-3" /> : "✓"} Limits: {count} layer{count === 1 ? "" : "s"}
                    {prop.minItems != null ? `, min ${prop.minItems}` : ""}
                    {prop.maxItems != null ? `, max ${prop.maxItems}` : ""}
                </div>
            )}
        </div>
    );
}

function AddToSlot({ slot, info }: { slot: SceneNode; info: NonNullable<ReturnType<typeof slotInfo>> }) {
    const doc = useEditor((s) => s.doc);
    const sources = useAssetSources();
    const preferred = (info.prop.preferred ?? []).map((id) => currentAsset(doc, doc.nodes[id]?.type === "componentSet" ? doc.nodes[id]?.children[0] : id)).filter((x): x is { sourceId: string; assetId: string } => Boolean(x));
    const shown = info.prop.onlyPreferred && preferred.length ? sources.map((s) => ({ ...s, entries: s.entries.filter((e) => preferred.some((p) => p.sourceId === s.id && p.assetId === e.id)) })).filter((s) => s.entries.length) : sources;
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label="Add instances" className="flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                <Plus className="size-3.5" />
            </AriaButton>
            <AriaPopover placement="left top" offset={12} className="rounded-lg border border-panel-border bg-panel-raised text-ink shadow-xl outline-none">
                <AriaDialog className="outline-none" aria-label="Add instances">
                    {({ close }) => (
                        <div>
                            <SwapMenu
                                title="Add instances"
                                sources={shown}
                                current={null}
                                preferred={preferred}
                                onPick={async (t) => {
                                    close();
                                    const local = await localAssetId(t.source.id, t.entry.id);
                                    const id = local ? componentForAsset(editor.get().doc, local) : null;
                                    if (id) addToSlot(slot.id, id);
                                }}
                            />
                            <div className="flex gap-1 border-t border-panel-border p-1">
                                <button type="button" onClick={() => (resetSlot(slot.id), close())} className="h-6 flex-1 rounded-md hover:bg-panel-hover">
                                    Reset slot
                                </button>
                                <button type="button" onClick={() => (clearSlot(slot.id), close())} className="h-6 flex-1 rounded-md hover:bg-panel-hover">
                                    Delete contents
                                </button>
                            </div>
                        </div>
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

function SlotSection({ slot, info }: { slot: SceneNode; info: NonNullable<ReturnType<typeof slotInfo>> }) {
    return (
        <Section
            title={purple(<SlotIcon />, info.prop.name)}
            action={
                <AriaMenuTrigger>
                    <AriaButton aria-label="More actions" className="flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                        <DotsHorizontal className="size-3.5" />
                    </AriaButton>
                    <AriaPopover placement="bottom end" className="w-48 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                        <AriaMenu className="outline-none" aria-label="Slot actions" onAction={(k) => (String(k) === "reset" ? resetSlot(slot.id) : clearSlot(slot.id))}>
                            <MenuRow id="reset" label="Reset slot" />
                            <MenuRow id="clear" label="Delete contents" />
                        </AriaMenu>
                    </AriaPopover>
                </AriaMenuTrigger>
            }
        >
            <SlotRow slot={slot} info={info} />
            {info.prop.description && <p className="text-ink-muted">{info.prop.description}</p>}
        </Section>
    );
}
