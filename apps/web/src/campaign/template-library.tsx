import { Plus, SearchSm, Upload01 } from "@untitledui/icons";
import { useEffect, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { Select } from "../components/select";
import { openSignIn, useAuth } from "../engine/auth";
import { refreshTeams, useTeams } from "../engine/teams";
import { editor, useEditor } from "../engine/store";
import { showAsset } from "./actions";
import { AssetThumb, BrandKit, PanelShell } from "./left-panel";
import { SIZE_GROUPS, SIZE_PRESETS, STARTER_LAYOUTS, addBlankAsset, addRow, addStarterTemplate, asOneStep, assetData, presetFor, rowsOf, setTemplate, templatesOf, type SizeGroup, type StarterLayout } from "./model";
import { campaign } from "./state";
import { addTeamTemplate, loadTeamAssetTemplates, publishTemplate, serverFile, starterPicture, unpublishTemplate, useTeamAssetTemplates, type TeamAssetTemplate } from "./templates";

// The Templates panel: Starter (the built-in layouts, in any size) and Your team (templates the
// team published), searched and sorted by category, with New blank asset, New template and Add
// all; then the templates in this file with their publishing state, and the brand kit.

const TILE = "flex flex-col overflow-hidden rounded-md bg-field text-left outline-none hover:ring-1 hover:ring-brand-500 focus-visible:ring-1 focus-visible:ring-brand-500 disabled:opacity-50";

export function StarterPicture({ layout, w, h }: { layout: StarterLayout; w: number; h: number }) {
    const [url, setUrl] = useState("");
    useEffect(() => {
        let live = true;
        void starterPicture(layout, w, h).then((u) => live && setUrl(u));
        return () => {
            live = false;
        };
    }, [layout, w, h]);
    return <span className="flex aspect-[4/3] w-full items-center justify-center bg-canvas">{url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" draggable={false} /> : null}</span>;
}

function lastRow(): string {
    return rowsOf(editor.get().doc).at(-1)?.row.id || addRow();
}

function StarterTab({ query }: { query: string }) {
    const readOnly = useEditor((s) => s.readOnly);
    const [group, setGroup] = useState<SizeGroup | "all">("all");
    const [size, setSize] = useState("square");
    const [busy, setBusy] = useState<string | null>(null);
    const preset = presetFor(size) ?? SIZE_PRESETS[0];
    const sizes = SIZE_PRESETS.filter((p) => group === "all" || p.group === group);
    const q = query.trim().toLowerCase();
    const layouts = STARTER_LAYOUTS.filter((l) => !q || `${l.label} ${l.about}`.toLowerCase().includes(q));
    const add = (layout: StarterLayout) => {
        setBusy(layout);
        void addStarterTemplate(lastRow(), size, layout).finally(() => setBusy(null));
    };
    return (
        <>
            <div className="grid grid-cols-[60px_1fr] items-center gap-x-2 gap-y-2 px-4 pb-3 text-[11px]">
                <span className="text-ink-muted">Category</span>
                <Select aria-label="Category" value={group} onChange={(e) => setGroup(e.target.value as SizeGroup | "all")} className="h-6 w-full rounded-[5px] border border-panel-border bg-panel px-1.5 text-ink outline-none">
                    <option value="all">All sizes</option>
                    {SIZE_GROUPS.map((g) => (
                        <option key={g} value={g}>{g}</option>
                    ))}
                </Select>
                <span className="text-ink-muted">Size</span>
                <Select aria-label="Template size" value={sizes.some((p) => p.id === size) ? size : (sizes[0]?.id ?? size)} onChange={(e) => setSize(e.target.value)} className="h-6 w-full rounded-[5px] border border-panel-border bg-panel px-1.5 text-ink outline-none">
                    {sizes.map((p) => (
                        <option key={p.id} value={p.id}>{`${p.label} ${p.w}x${p.h}`}</option>
                    ))}
                </Select>
            </div>
            {!readOnly && (
                <div className="grid grid-cols-2 gap-2 px-4 pb-3">
                    <button type="button" onClick={() => addBlankAsset(size, lastRow())} className="flex h-6 items-center justify-center gap-1 rounded-[5px] border border-panel-border text-[11px] text-ink hover:bg-panel-hover">
                        <Plus className="size-3" /> Blank asset
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            addBlankAsset(size, lastRow());
                            const id = editor.get().selection[0];
                            if (id) setTemplate(id, true);
                        }}
                        className="flex h-6 items-center justify-center gap-1 rounded-[5px] border border-panel-border text-[11px] text-ink hover:bg-panel-hover"
                    >
                        <Plus className="size-3" /> New template
                    </button>
                </div>
            )}
            <div className="grid grid-cols-2 gap-2 px-4">
                {layouts.map((l) => (
                    <button key={l.id} type="button" disabled={readOnly || busy !== null} title={l.about} onClick={() => add(l.id)} className={TILE}>
                        <StarterPicture layout={l.id} w={preset?.w ?? 1080} h={preset?.h ?? 1080} />
                        <span className="truncate px-1.5 py-1 text-[10.5px] text-ink">{busy === l.id ? "Adding…" : l.label}</span>
                    </button>
                ))}
            </div>
            {layouts.length === 0 && <p className="px-4 text-[11px] text-ink-subtle">No templates match.</p>}
            {!readOnly && layouts.length > 1 && (
                <div className="px-4 pt-2">
                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                            setBusy("all");
                            void (async () => {
                                await asOneStep(async () => {
                                    for (const l of layouts) await addStarterTemplate(lastRow(), size, l.id);
                                });
                            })().finally(() => setBusy(null));
                        }}
                        className="h-6 w-full rounded-[5px] border border-panel-border text-[11px] text-ink hover:bg-panel-hover disabled:opacity-50"
                    >
                        {busy === "all" ? "Adding…" : `Add all ${layouts.length} templates`}
                    </button>
                </div>
            )}
        </>
    );
}

function TeamTab({ query }: { query: string }) {
    const user = useAuth((s) => s.user);
    const teams = useTeams();
    const readOnly = useEditor((s) => s.readOnly);
    const [teamId, setTeamId] = useState<string | null>(null);
    const [category, setCategory] = useState("all");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const team = teams.find((t) => t.id === teamId) ?? teams[0] ?? null;
    const list = useTeamAssetTemplates(team?.id ?? null);
    useEffect(() => {
        if (user) void refreshTeams();
    }, [user]);
    useEffect(() => {
        if (!team) return;
        loadTeamAssetTemplates(team.id)
            .then(() => setError(null))
            .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, [team?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    if (!user) {
        return (
            <p className="px-4 text-[11px] text-ink-muted">
                <button type="button" onClick={openSignIn} className="text-brand-500 hover:underline">
                    Sign in
                </button>{" "}
                to see your team's templates.
            </p>
        );
    }
    if (!teams.length) return <p className="px-4 text-[11px] text-ink-muted">You're not on a team yet. Teams publish templates for everyone on them to start from.</p>;
    const categories = [...new Set((list ?? []).map((t) => t.category).filter(Boolean))];
    const q = query.trim().toLowerCase();
    const shown = (list ?? []).filter((t) => (category === "all" || t.category === category) && (!q || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q)));
    const add = (t: TeamAssetTemplate) => {
        setBusy(t.id);
        addTeamTemplate(t, lastRow())
            .catch((e) => editor.notify(e instanceof Error ? e.message : String(e)))
            .finally(() => setBusy(null));
    };
    return (
        <>
            <div className="grid grid-cols-[60px_1fr] items-center gap-x-2 gap-y-2 px-4 pb-3 text-[11px]">
                {teams.length > 1 && (
                    <>
                        <span className="text-ink-muted">Team</span>
                        <Select aria-label="Team" value={team?.id ?? ""} onChange={(e) => setTeamId(e.target.value)} className="h-6 w-full rounded-[5px] border border-panel-border bg-panel px-1.5 text-ink outline-none">
                            {teams.map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </Select>
                    </>
                )}
                <span className="text-ink-muted">Category</span>
                <Select aria-label="Team template category" value={category} onChange={(e) => setCategory(e.target.value)} className="h-6 w-full rounded-[5px] border border-panel-border bg-panel px-1.5 text-ink outline-none">
                    <option value="all">All</option>
                    {categories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                    ))}
                </Select>
            </div>
            {error && <p className="px-4 text-[11px] text-red-500">{error}</p>}
            {list === null && !error && <p className="px-4 text-[11px] text-ink-subtle">Loading…</p>}
            {list && shown.length === 0 && <p className="px-4 text-[11px] text-ink-subtle">{list.length ? "No templates match." : `Nothing published to ${team?.name ?? "the team"} yet. Publish this file's templates from the list below.`}</p>}
            <div className="grid grid-cols-2 gap-2 px-4">
                {shown.map((t) => (
                    <button key={t.id} type="button" disabled={readOnly || busy !== null} title={t.description || t.name} onClick={() => add(t)} className={TILE}>
                        <span className="flex aspect-[4/3] w-full items-center justify-center bg-canvas">{t.thumb ? <img src={t.thumb} alt="" className="max-h-full max-w-full object-contain" draggable={false} /> : null}</span>
                        <span className="truncate px-1.5 pt-1 text-[10.5px] text-ink">{busy === t.id ? "Adding…" : t.name}</span>
                        <span className="truncate px-1.5 pb-1 text-[9.5px] text-ink-subtle">{[t.category, `v${t.version}`].filter(Boolean).join(" · ")}</span>
                    </button>
                ))}
            </div>
            {!readOnly && shown.length > 1 && (
                <div className="px-4 pt-2">
                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                            setBusy("all");
                            void (async () => {
                                await asOneStep(async () => {
                                    for (const t of shown) await addTeamTemplate(t, lastRow());
                                });
                            })()
                                .catch((e) => editor.notify(e instanceof Error ? e.message : String(e)))
                                .finally(() => setBusy(null));
                        }}
                        className="h-6 w-full rounded-[5px] border border-panel-border text-[11px] text-ink hover:bg-panel-hover disabled:opacity-50"
                    >
                        {busy === "all" ? "Adding…" : `Add all ${shown.length} templates`}
                    </button>
                </div>
            )}
        </>
    );
}

export function TemplatesPanel() {
    const doc = useEditor((s) => s.doc);
    const readOnly = useEditor((s) => s.readOnly);
    const templates = templatesOf(doc);
    const [tab, setTab] = useState<"starter" | "team">("starter");
    const [query, setQuery] = useState("");
    const heading = "px-4 pt-4 pb-2 text-[11px] font-semibold text-ink";
    const tabClass = (on: boolean) => `h-[22px] min-w-0 flex-1 truncate rounded-[4px] px-2 text-[11px] outline-none ${on ? "bg-panel text-ink ring-1 ring-panel-border" : "text-ink-muted hover:text-ink"}`;
    return (
        <PanelShell
            title="Templates"
            search={
                <>
                    <div className="shrink-0 px-4 pb-3">
                        <label className="flex h-6 items-center gap-1.5 rounded-[5px] border border-transparent bg-field px-2 focus-within:border-brand-500">
                            <SearchSm className="size-3.5 shrink-0 text-ink-muted" />
                            <input aria-label="Search templates" placeholder="Search templates" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-subtle" />
                        </label>
                    </div>
                    <div role="tablist" aria-label="Template source" className="mx-4 mb-4 flex h-6 items-center rounded-[5px] bg-field p-px">
                        <button type="button" role="tab" aria-selected={tab === "starter"} onClick={() => setTab("starter")} className={tabClass(tab === "starter")}>
                            Starter
                        </button>
                        <button type="button" role="tab" aria-selected={tab === "team"} onClick={() => setTab("team")} className={tabClass(tab === "team")}>
                            Your team
                        </button>
                    </div>
                </>
            }
        >
            {tab === "starter" ? <StarterTab query={query} /> : <TeamTab query={query} />}
            {!readOnly && (
                <div className="px-4 pt-2">
                    <button type="button" onClick={() => campaign.set({ dialog: { kind: "import" } })} className="flex h-6 w-full items-center justify-center gap-1.5 rounded-[5px] border border-panel-border text-[11px] text-ink outline-none hover:bg-panel-hover">
                        <Upload01 className="size-3.5" /> From a design file…
                    </button>
                </div>
            )}
            <div className={`${heading} flex items-center justify-between`}>
                In this file
                {!readOnly && templates.length > 0 && (
                    <AriaButton onPress={() => campaign.set({ dialog: { kind: "publish" } })} className="rounded px-1 text-[11px] font-normal text-brand-500 outline-none hover:underline">
                        Publish…
                    </AriaButton>
                )}
            </div>
            {templates.length === 0 && <p className="px-4 text-[11px] text-ink-subtle">No templates yet. Pick one above, or turn an asset into one from its toolbar.</p>}
            <div className="space-y-1 px-2">
                {templates.map((t) => {
                    const data = assetData(t);
                    return (
                        <button key={t.id} type="button" onClick={() => showAsset(t.id)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500">
                            <AssetThumb id={t.id} width={48} height={36} className="shrink-0 rounded-[3px] bg-canvas" />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[11px] text-ink">{t.name}</span>
                                <span className="block truncate text-[10px] text-ink-muted">
                                    {data?.published ? `Published v${data.published.version}` : data?.fromTemplate ? `From ${data.fromTemplate.name}` : `${presetFor(data?.preset)?.label ?? "Custom"} ${Math.round(t.w)}x${Math.round(t.h)}`}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>
            <BrandKit />
        </PanelShell>
    );
}

// ---- Publishing: review and select the file's templates, set their details, publish ----

export function PublishTemplates({ onDone }: { onDone: () => void }) {
    const doc = useEditor((s) => s.doc);
    const user = useAuth((s) => s.user);
    const teams = useTeams().filter((t) => t.role === "admin" || t.role === "edit");
    const templates = templatesOf(doc);
    const [step, setStep] = useState<"select" | "details">("select");
    // Templates started from a team's template begin unticked: publishing them as they are would
    // put a second copy of that template on the team.
    const [chosen, setChosen] = useState<Set<string>>(() => new Set(templates.filter((t) => assetData(t)?.published || !assetData(t)?.fromTemplate).map((t) => t.id)));
    const [teamId, setTeamId] = useState<string>("");
    const [details, setDetails] = useState<Record<string, { name: string; description: string; category: string }>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (user) void refreshTeams();
    }, [user]);
    const team = teams.find((t) => t.id === teamId) ?? teams[0];
    // What the team has now: an update starts from the published name, category and description.
    const onTeam = useTeamAssetTemplates(team?.id ?? null);
    useEffect(() => {
        if (team?.id) void loadTeamAssetTemplates(team.id).catch(() => undefined);
    }, [team?.id]);
    const input = "h-7 w-full rounded-md border border-panel-border bg-panel px-2 text-[11.5px] text-ink outline-none focus:border-brand-500";
    if (!user) {
        return (
            <p className="text-ink-muted">
                <button type="button" onClick={openSignIn} className="text-brand-500 hover:underline">
                    Sign in
                </button>{" "}
                to publish templates to your team.
            </p>
        );
    }
    if (!serverFile()) return <p className="text-ink-muted">Templates are published from the sync server: share or move this campaign there first.</p>;
    if (!teams.length) return <p className="text-ink-muted">You need to be an editor on a team to publish templates to it.</p>;
    if (!templates.length) return <p className="text-ink-muted">This file has no templates yet. Turn an asset into one from its toolbar first.</p>;
    const detailFor = (id: string) => {
        if (details[id]) return details[id];
        const published = assetData(doc.nodes[id])?.published;
        const record = published && published.teamId === team?.id ? onTeam?.find((t) => t.id === published.id) : undefined;
        if (record) return { name: record.name, description: record.description, category: record.category };
        return { name: doc.nodes[id]?.name ?? "Template", description: "", category: presetFor(assetData(doc.nodes[id])?.preset)?.group ?? "" };
    };
    const run = async () => {
        if (!team) return;
        setError(null);
        let n = 0;
        for (const id of chosen) {
            setBusy(`Publishing ${++n} of ${chosen.size}…`);
            await publishTemplate(id, team.id, detailFor(id));
        }
        editor.notify(`Published ${chosen.size} template${chosen.size === 1 ? "" : "s"} to ${team.name}.`);
        onDone();
    };
    if (step === "select") {
        return (
            <div className="space-y-3">
                <div className="font-semibold">Review and select</div>
                <div className="max-h-80 space-y-0.5 overflow-y-auto">
                    {templates.map((t) => {
                        const data = assetData(t);
                        return (
                            <label key={t.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-panel-hover">
                                <input
                                    type="checkbox"
                                    checked={chosen.has(t.id)}
                                    onChange={(e) => {
                                        const next = new Set(chosen);
                                        if (e.target.checked) next.add(t.id);
                                        else next.delete(t.id);
                                        setChosen(next);
                                    }}
                                    className="accent-brand-500"
                                />
                                <AssetThumb id={t.id} width={48} height={36} className="shrink-0 rounded bg-canvas" />
                                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                                <span className="text-ink-subtle">{data?.published ? `Published v${data.published.version}, will update` : "New"}</span>
                                {data?.published && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            void unpublishTemplate(t.id)
                                                .then(() => editor.notify(`Unpublished ${t.name}.`))
                                                .catch((err) => setError(err instanceof Error ? err.message : String(err)));
                                        }}
                                        className="text-brand-500 hover:underline"
                                    >
                                        Unpublish
                                    </button>
                                )}
                            </label>
                        );
                    })}
                </div>
                {error && <p className="text-red-500">{error}</p>}
                <div className="flex justify-end">
                    <button type="button" disabled={!chosen.size} onClick={() => setStep("details")} className="h-8 rounded-md bg-brand-500 px-3 text-[12px] font-semibold text-white outline-none hover:bg-brand-600 disabled:opacity-40">
                        Next: set details
                    </button>
                </div>
            </div>
        );
    }
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <span className="font-semibold">Set details</span>
                <span className="ml-auto text-ink-muted">Team</span>
                <Select aria-label="Publish to team" value={team?.id ?? ""} onChange={(e) => setTeamId(e.target.value)} className="h-7 w-48 rounded-md border border-panel-border bg-panel px-2 text-[11.5px] text-ink outline-none">
                    {teams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                </Select>
            </div>
            <div className="max-h-96 space-y-3 overflow-y-auto">
                {[...chosen].map((id) => {
                    const d = detailFor(id);
                    const set = (patch: Partial<typeof d>) => setDetails({ ...details, [id]: { ...d, ...patch } });
                    return (
                        <div key={id} className="flex gap-3 rounded-md border border-panel-border p-2">
                            <AssetThumb id={id} width={72} height={56} className="shrink-0 rounded bg-canvas" />
                            <div className="grid min-w-0 flex-1 grid-cols-[70px_1fr] items-center gap-x-2 gap-y-1.5">
                                <span className="text-ink-muted">Name</span>
                                <input aria-label="Template name" value={d.name} onChange={(e) => set({ name: e.target.value })} className={input} />
                                <span className="text-ink-muted">Category</span>
                                <input aria-label="Template category" value={d.category} onChange={(e) => set({ category: e.target.value })} placeholder="Social, Ads, Print…" className={input} />
                                <span className="text-ink-muted">Description</span>
                                <input aria-label="Template description" value={d.description} onChange={(e) => set({ description: e.target.value })} className={input} />
                            </div>
                        </div>
                    );
                })}
            </div>
            {error && <p className="text-red-500">{error}</p>}
            <div className="flex items-center justify-end gap-2">
                {busy && <span className="mr-auto text-ink-muted">{busy}</span>}
                <button type="button" onClick={() => setStep("select")} className="h-8 rounded-md border border-panel-border px-3 text-[12px] text-ink outline-none hover:bg-panel-hover">
                    Back
                </button>
                <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                        void run()
                            .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                            .finally(() => setBusy(null))
                    }
                    className="h-8 rounded-md bg-brand-500 px-3 text-[12px] font-semibold text-white outline-none hover:bg-brand-600 disabled:opacity-40"
                >
                    Publish to {team?.name ?? "team"}
                </button>
            </div>
        </div>
    );
}
