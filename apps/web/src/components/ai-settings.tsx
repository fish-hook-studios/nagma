import { useEffect, useState } from "react";
import { type AiProvider, type AiSettingsView, type ImageProvider, PROVIDER_LABELS, loadAiSettings, refreshAiModels, removeAiImage, removeAiText, roughTokens, saveAiImage, saveAiText, testAi, useAiSettings } from "../engine/ai-settings";
import { editor } from "../engine/store";
import { Button, ErrorText, FieldLabel, field } from "./admin/admin-ui";
import { Select } from "./select";

// Account settings › AI: your own provider and key for every AI feature (the agent, Make, board and
// campaign AI, slide drafts), a model, a test call, an image model, and today's usage.

const SECTION = "border-b border-panel-border py-4 last:border-0";
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
const KEY_HINT: Record<AiProvider, string> = { anthropic: "sk-ant-…", openai: "sk-…", compatible: "API key, if the server needs one" };

function where(view: AiSettingsView): string {
    if (view.scope === "browser") return "Stored in this browser only. It goes with each AI request through this server, which doesn't keep it. Anyone using this browser can use it; sign in to keep it with your account instead.";
    if (view.scope === "device") return "Encrypted and kept by Nagma on this computer. It's never shown again after you save it.";
    return "Encrypted and kept with your account on this server. It's never shown again after you save it.";
}

export function AiTab() {
    const view = useAiSettings();
    useEffect(() => void loadAiSettings(), []);
    if (!view) return <p className="py-10 text-center text-ink-muted">Loading your AI settings…</p>;
    return (
        <div onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}>
            <TextModel key={`${view.scope}:${view.text?.provider ?? ""}:${view.text?.savedAt ?? ""}`} view={view} />
            <ImageModel key={`image:${view.scope}:${view.image?.provider ?? ""}`} view={view} />
            <Usage view={view} />
        </div>
    );
}

function TextModel({ view }: { view: AiSettingsView }) {
    const saved = view.text;
    const [provider, setProvider] = useState<AiProvider>(saved?.provider ?? "anthropic");
    const [key, setKey] = useState("");
    const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "");
    const [customModel, setCustomModel] = useState("");
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
    const same = saved?.provider === provider;
    const keySet = same && saved.keySet;
    const canSave = !busy && (provider === "compatible" ? baseUrl.trim().length > 0 : key.trim().length > 0 || keySet);
    const run = async (label: string, fn: () => Promise<unknown>) => {
        setBusy(label);
        setError(null);
        setResult(null);
        try {
            await fn();
        } catch (e) {
            setError(err(e));
        } finally {
            setBusy(null);
        }
    };
    const save = (model?: string) =>
        run("save", async () => {
            const next = await saveAiText({ provider, key: key.trim() || undefined, baseUrl: provider === "compatible" ? baseUrl.trim() : undefined, model });
            setKey("");
            editor.notify(`Saved. ${PROVIDER_LABELS[provider]} answered the test call with ${next.text?.model ?? "the model"}.`);
        });
    return (
        <div className={`${SECTION} space-y-3`}>
            <div>
                <h3 className="text-[11.5px] font-medium">Your AI provider</h3>
                <p className="mt-1 text-ink-muted">AI features run on your own key, billed by your provider. {where(view)}</p>
            </div>
            <FieldLabel label="Provider">
                <Select aria-label="Provider" value={provider} onChange={(e) => (setProvider(e.target.value as AiProvider), setError(null), setResult(null))} className={field}>
                    <option value="anthropic">Claude</option>
                    <option value="openai">OpenAI</option>
                    <option value="compatible">OpenAI-compatible (local or self-hosted)</option>
                </Select>
            </FieldLabel>
            {provider === "compatible" && (
                <FieldLabel label="Server address" hint={view.privateUrls ? "The address its OpenAI-style API answers on, such as http://localhost:11434/v1 for a local model." : "A public https address. Local models work in the desktop app."}>
                    <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" aria-label="Server address" spellCheck={false} autoComplete="off" className={field} />
                </FieldLabel>
            )}
            <FieldLabel label="API key">
                <span className="flex items-center gap-2">
                    <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={keySet ? `Key set, ends in ••••${saved.keyEnd}` : KEY_HINT[provider]} aria-label="API key" autoComplete="off" spellCheck={false} className={field} />
                    {keySet && (
                        <Button variant="danger" disabled={Boolean(busy)} onPress={() => void run("remove", async () => (await removeAiText(), editor.notify("Key removed.")))}>
                            Remove
                        </Button>
                    )}
                </span>
            </FieldLabel>
            {keySet && <p className="text-[11px] text-ink-muted">Key set, ends in ••••{saved.keyEnd}. Paste a new key to replace it.</p>}
            <div className="flex items-center gap-2">
                <Button variant="primary" disabled={!canSave} onPress={() => void save()}>
                    {busy === "save" ? "Testing…" : "Save and test"}
                </Button>
                {saved && same && (
                    <Button
                        disabled={Boolean(busy)}
                        onPress={() =>
                            void run("test", async () => {
                                const r = await testAi();
                                setResult(r.ok ? { ok: true, text: `Works. ${r.model ?? "The model"} answered in ${r.ms ?? 0} ms.` } : { ok: false, text: `Test failed: ${r.error ?? "no answer"}` });
                            })
                        }
                    >
                        {busy === "test" ? "Testing…" : "Test"}
                    </Button>
                )}
            </div>
            {result && <p className={`text-[11.5px] ${result.ok ? "text-green-600" : "text-red-500"}`}>{result.text}</p>}
            <ErrorText>{error}</ErrorText>
            {saved && same && (
                <FieldLabel label="Model" hint={saved.models.length ? "Models your key can use, from the provider." : "Type the model's name as the server knows it."}>
                    <span className="flex items-center gap-2">
                        {saved.models.length ? (
                            <Select aria-label="Model" value={saved.model} disabled={Boolean(busy)} onChange={(e) => e.target.value !== saved.model && void save(e.target.value)} className={field}>
                                {(saved.models.some((m) => m.id === saved.model) ? saved.models : [{ id: saved.model, label: saved.model }, ...saved.models]).map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.label}
                                    </option>
                                ))}
                            </Select>
                        ) : (
                            <>
                                <input value={customModel || saved.model} onChange={(e) => setCustomModel(e.target.value)} aria-label="Model" spellCheck={false} className={field} />
                                <Button disabled={Boolean(busy) || !customModel.trim() || customModel === saved.model} onPress={() => void save(customModel.trim())}>
                                    Use
                                </Button>
                            </>
                        )}
                        <Button variant="ghost" disabled={Boolean(busy)} onPress={() => void run("models", () => refreshAiModels())}>
                            {busy === "models" ? "Loading…" : "Refresh list"}
                        </Button>
                    </span>
                </FieldLabel>
            )}
            {!saved && <p className="text-[11px] text-ink-muted">{view.shared.text ? `Until you add a key, AI features use this server's shared ${view.shared.provider ?? "Claude"} key.` : "AI features are off until you add a key."}</p>}
        </div>
    );
}

function ImageModel({ view }: { view: AiSettingsView }) {
    const saved = view.image;
    const [provider, setProvider] = useState<ImageProvider | "none">(saved?.provider ?? "none");
    const [key, setKey] = useState("");
    const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "");
    const [model, setModel] = useState(saved?.model ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const reuse = provider === "openai" && view.text?.provider === "openai" && view.text.keySet;
    const keySet = saved?.provider === provider && saved.keySet;
    const changed = provider !== (saved?.provider ?? "none") || key.trim() !== "" || baseUrl !== (saved?.baseUrl ?? "") || model !== (saved?.model ?? "");
    const ready = provider === "none" || (provider === "compatible" ? baseUrl.trim() !== "" : key.trim() !== "" || keySet || reuse);
    const canSave = !busy && changed && ready;
    const run = (fn: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        void fn()
            .then(() => setKey(""))
            .catch((e: unknown) => setError(err(e)))
            .finally(() => setBusy(false));
    };
    return (
        <div className={`${SECTION} space-y-3`}>
            <div>
                <h3 className="text-[11.5px] font-medium">Image generation</h3>
                <p className="mt-1 text-ink-muted">For Edit with prompt on images and generated pictures in campaigns. {view.shared.image ? "Without one, this server's image model is used." : ""}</p>
            </div>
            <FieldLabel label="Image provider">
                <Select aria-label="Image provider" value={provider} onChange={(e) => (setProvider(e.target.value as ImageProvider | "none"), setModel(""), setError(null))} className={field}>
                    <option value="none">None</option>
                    <option value="openai">OpenAI images</option>
                    <option value="compatible">Compatible endpoint</option>
                </Select>
            </FieldLabel>
            {provider !== "none" && (
                <>
                    {provider === "compatible" && (
                        <FieldLabel label="Address" hint="Its OpenAI-style API, with /images/generations under it.">
                            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://images.example.com/v1" aria-label="Image server address" spellCheck={false} autoComplete="off" className={field} />
                        </FieldLabel>
                    )}
                    <FieldLabel label="API key" hint={reuse ? "Leave empty to use your OpenAI key from above." : undefined}>
                        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={keySet ? `Key set, ends in ••••${saved.keyEnd}` : reuse ? "Your OpenAI key from above" : "API key"} aria-label="Image API key" autoComplete="off" spellCheck={false} className={field} />
                    </FieldLabel>
                    <FieldLabel label="Model">
                        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={view.imageProviders.find((p) => p.id === provider)?.defaultModel || "Model name"} aria-label="Image model" spellCheck={false} className={field} />
                    </FieldLabel>
                </>
            )}
            <div className="flex items-center gap-2">
                <Button variant="primary" disabled={!canSave} onPress={() => run(async () => (await saveAiImage({ provider, key: key.trim() || undefined, baseUrl: baseUrl.trim() || undefined, model: model.trim() || undefined }), editor.notify(provider === "none" ? "Image generation turned off." : "Image model saved.")))}>
                    {busy ? "Saving…" : "Save"}
                </Button>
                {saved && (
                    <Button variant="danger" disabled={busy} onPress={() => run(async () => (await removeAiImage(), setProvider("none"), editor.notify("Image model removed.")))}>
                        Remove
                    </Button>
                )}
            </div>
            <ErrorText>{error}</ErrorText>
        </div>
    );
}

function Usage({ view }: { view: AiSettingsView }) {
    const u = view.usage;
    return (
        <div className={`${SECTION} space-y-2`}>
            <h3 className="text-[11.5px] font-medium">Usage</h3>
            <p aria-label="Usage today">
                Today: {u.requests} request{u.requests === 1 ? "" : "s"}, ~{roughTokens(u.tokens)} tokens
                {u.shared ? ` (${u.shared.requests} on the server's shared key)` : ""}
            </p>
            <p className="text-[11px] text-ink-muted">Your provider bills requests to your key; Nagma counts them here only so you can see them. Up to {view.perMinute} AI requests a minute.</p>
            <p className="text-[11px] text-ink-muted">With OpenAI or a compatible server, Make can't search the web or use connectors and doesn't show its thinking. Everything else works the same.</p>
        </div>
    );
}
