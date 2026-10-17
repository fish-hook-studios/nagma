// AI providers: one way to call a model whichever API answers it. A call names a provider
// ("anthropic" for Claude, "openai", or "compatible" for any server that speaks the OpenAI Chat
// Completions API, such as a local model), a key, a model and a base address; the request is the
// same shape for every provider: a system prompt, messages with text and pictures (written as
// Claude content blocks), optional tools, and an optional JSON schema for the answer.
//
// Claude-only features (extended thinking, web search and fetch, MCP connectors, refusal fallbacks,
// prompt caching) go in `request.anthropic` and are left out for the other providers; callers ask
// `supports(provider, feature)` to tell people what changes.
//
// Keys are only ever sent to the provider. Error messages never carry a key, even a masked one.

export const PROVIDERS = {
    anthropic: { label: "Claude", defaultModel: "claude-sonnet-5-5", base: () => process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com" },
    openai: { label: "OpenAI", defaultModel: "gpt-5", base: () => process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1" },
    compatible: { label: "OpenAI-compatible", defaultModel: "", base: () => "" },
};

// Image models: OpenAI's images API, or an endpoint that takes the same request.
export const IMAGE_PROVIDERS = {
    openai: { label: "OpenAI", defaultModel: "gpt-image-1", base: () => process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1" },
    compatible: { label: "Compatible endpoint", defaultModel: "", base: () => "" },
};

const CLAUDE_ONLY = new Set(["thinking", "web", "mcp", "fallbacks", "caching"]);
export const supports = (provider, feature) => provider === "anthropic" || !CLAUDE_ONLY.has(feature);

export class AiError extends Error {
    // `status` is what the route answers; `code` lets the app tell a rejected key from a busy model.
    constructor(message, status = 502, code = "ai-error") {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const trimBase = (url) => String(url ?? "").trim().replace(/\/+$/, "");
export function baseUrlOf(cfg) {
    if (cfg.provider === "compatible") return trimBase(cfg.baseUrl);
    return trimBase(PROVIDERS[cfg.provider]?.base() ?? "");
}
function imageBaseOf(cfg) {
    if (cfg.provider === "compatible") return trimBase(cfg.baseUrl);
    return trimBase(IMAGE_PROVIDERS.openai.base());
}

// Anything in a provider's message that could be a key (some echo a masked key back) goes.
export function scrub(text, key) {
    let out = String(text ?? "");
    if (key) out = out.split(key).join("[key]");
    return out.replace(/\b(sk|key|api|pk|rk)[-_][A-Za-z0-9*_.-]{6,}/gi, "[key]").slice(0, 300);
}

function withTimeout(signal, ms) {
    const timeout = AbortSignal.timeout(ms);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function send(url, init, key, ms = 120000) {
    let res;
    try {
        res = await fetch(url, { ...init, redirect: "manual", signal: withTimeout(init.signal, ms) });
    } catch (error) {
        if (init.signal?.aborted) throw new AiError("Stopped.", 499, "ai-aborted");
        throw new AiError(error?.name === "TimeoutError" ? "The model took too long to answer." : "The model can't be reached. Check the address and that it's running.", 502, "ai-unreachable");
    }
    if (res.ok) return res;
    const detail = await res.text().catch(() => "");
    let message = "";
    try {
        const data = JSON.parse(detail);
        message = data?.error?.message ?? data?.message ?? "";
    } catch {
        message = "";
    }
    if (res.status === 401 || res.status === 403) throw new AiError("The provider didn't accept this key.", 401, "ai-key-rejected");
    if (res.status === 429) throw new AiError("The model is busy or the key is over its limit. Try again in a moment.", 429, "ai-busy");
    if (res.status === 404) throw new AiError(message ? `The provider said: ${scrub(message, key)}` : "That model or address wasn't found.", 502, "ai-not-found");
    if (res.status >= 300 && res.status < 400) throw new AiError("The model's address redirects elsewhere. Use the final address.", 502, "ai-error");
    throw new AiError(message ? `The provider said: ${scrub(message, key)}` : `The model answered ${res.status}.`, 502, "ai-error");
}

// ---- Requests in each API's shape ----

const systemText = (system) => (Array.isArray(system) ? system.map((b) => b?.text ?? "").filter(Boolean).join("\n\n") : String(system ?? ""));
const toBlocks = (content) => (typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : []);

function anthropicBody(cfg, request, stream) {
    const extra = request.anthropic ?? {};
    const system = Array.isArray(request.system) ? request.system : request.system ? [{ type: "text", text: String(request.system) }] : undefined;
    const tools = [...(request.tools ?? []).map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })), ...(extra.tools ?? [])];
    const outputConfig = { ...(extra.output_config ?? {}), ...(request.json && !extra.tools?.length ? { format: { type: "json_schema", schema: request.json } } : {}) };
    return {
        model: cfg.model,
        max_tokens: request.maxTokens ?? 4096,
        ...(stream ? { stream: true } : {}),
        ...(system ? { system } : {}),
        messages: request.messages.map((m) => ({ role: m.role, content: toBlocks(m.content) })),
        ...(tools.length ? { tools } : {}),
        ...(request.toolChoice ? { tool_choice: { type: "tool", name: request.toolChoice } } : {}),
        ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
        ...(extra.thinking ? { thinking: extra.thinking } : {}),
        ...(extra.mcp_servers?.length ? { mcp_servers: extra.mcp_servers } : {}),
        ...(extra.fallbacks ? { fallbacks: extra.fallbacks } : {}),
    };
}
function anthropicHeaders(cfg, request) {
    const betas = request.anthropic?.betas ?? [];
    return { "x-api-key": cfg.key, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(betas.length ? { "anthropic-beta": betas.join(",") } : {}) };
}

function openaiContent(content) {
    const blocks = toBlocks(content);
    if (blocks.every((b) => b.type === "text")) return blocks.map((b) => b.text).join("\n\n");
    return blocks.flatMap((b) => {
        if (b.type === "text") return [{ type: "text", text: b.text }];
        if (b.type === "image" && b.source?.type === "base64") return [{ type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }];
        return [];
    });
}
function openaiBody(cfg, request, stream) {
    const system = systemText(request.system);
    const messages = [...(system ? [{ role: cfg.provider === "openai" ? "developer" : "system", content: system }] : []), ...request.messages.map((m) => ({ role: m.role, content: openaiContent(m.content) }))];
    const tools = (request.tools ?? []).map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } }));
    const max = request.maxTokens ?? 4096;
    return {
        model: cfg.model,
        messages,
        // OpenAI's own API counts reasoning in max_completion_tokens; servers that copy the API take max_tokens.
        ...(cfg.provider === "openai" ? { max_completion_tokens: max } : { max_tokens: max }),
        ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
        ...(tools.length ? { tools } : {}),
        ...(request.toolChoice ? { tool_choice: { type: "function", function: { name: request.toolChoice } } } : {}),
        // Structured output on OpenAI's API; other servers vary, so the answer is read from the text.
        ...(request.json && cfg.provider === "openai" ? { response_format: { type: "json_schema", json_schema: { name: "answer", schema: request.json, strict: true } } } : {}),
    };
}
const openaiHeaders = (cfg) => ({ "content-type": "application/json", ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}) });

const OPENAI_STOP = { stop: "end_turn", length: "max_tokens", content_filter: "refusal", tool_calls: "tool_use", function_call: "tool_use" };

function requireReady(cfg) {
    if (!PROVIDERS[cfg.provider]) throw new AiError("Unknown AI provider.", 400, "ai-bad-provider");
    if (!baseUrlOf(cfg)) throw new AiError("Add the address of the model server.", 400, "ai-bad-address");
    if (!cfg.model) throw new AiError("Choose a model.", 400, "ai-no-model");
    if (!cfg.key && cfg.provider !== "compatible") throw new AiError("Add your AI key in Account settings to use this.", 412, "ai-key-needed");
}

// One answer, whole. Returns { text, toolCalls: [{ name, input }], usage: { input, output }, stop }.
export async function complete(cfg, request) {
    requireReady(cfg);
    const base = baseUrlOf(cfg);
    if (cfg.provider === "anthropic") {
        const res = await send(`${base}/v1/messages`, { method: "POST", headers: anthropicHeaders(cfg, request), body: JSON.stringify(anthropicBody(cfg, request, false)), signal: request.signal }, cfg.key, request.timeout);
        const data = await res.json().catch(() => ({}));
        const content = Array.isArray(data.content) ? data.content : [];
        const u = data.usage ?? {};
        return {
            text: content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
            toolCalls: content.filter((c) => c.type === "tool_use").map((c) => ({ name: c.name, input: c.input ?? {} })),
            usage: { input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0 },
            stop: data.stop_reason ?? "end_turn",
        };
    }
    const res = await send(`${base}/chat/completions`, { method: "POST", headers: openaiHeaders(cfg), body: JSON.stringify(openaiBody(cfg, request, false)), signal: request.signal }, cfg.key, request.timeout);
    const data = await res.json().catch(() => ({}));
    const choice = data.choices?.[0] ?? {};
    const message = choice.message ?? {};
    const toolCalls = (message.tool_calls ?? []).flatMap((c) => {
        try {
            return [{ name: c.function?.name, input: JSON.parse(c.function?.arguments || "{}") }];
        } catch {
            return [];
        }
    });
    return {
        text: typeof message.content === "string" ? message.content : Array.isArray(message.content) ? message.content.map((p) => p.text ?? "").join("") : "",
        toolCalls,
        usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
        stop: message.refusal ? "refusal" : (OPENAI_STOP[choice.finish_reason] ?? "end_turn"),
    };
}

// Server-sent events from a response body: { event, data } for each.
async function* events(body) {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of body) {
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
        let at;
        while ((at = buffer.indexOf("\n\n")) >= 0) {
            const raw = buffer.slice(0, at);
            buffer = buffer.slice(at + 2);
            const event = /^event:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? null;
            const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
            if (data) yield { event, data };
        }
    }
}

// A streamed answer, as events: { type: "text", text }, { type: "thinking", text }, { type: "tool",
// name } (a server tool the model is using), then { type: "done", stop, usage }.
export async function* stream(cfg, request) {
    requireReady(cfg);
    const base = baseUrlOf(cfg);
    const anthropic = cfg.provider === "anthropic";
    const res = anthropic
        ? await send(`${base}/v1/messages`, { method: "POST", headers: anthropicHeaders(cfg, request), body: JSON.stringify(anthropicBody(cfg, request, true)), signal: request.signal }, cfg.key, request.timeout ?? 15 * 60 * 1000)
        : await send(`${base}/chat/completions`, { method: "POST", headers: openaiHeaders(cfg), body: JSON.stringify(openaiBody(cfg, request, true)), signal: request.signal }, cfg.key, request.timeout ?? 15 * 60 * 1000);
    if (!res.body) throw new AiError("The model sent nothing back.", 502);
    const usage = { input: 0, output: 0 };
    let stop = null;
    for await (const { data } of events(res.body)) {
        if (data === "[DONE]") break;
        let e;
        try {
            e = JSON.parse(data);
        } catch {
            continue;
        }
        if (anthropic) {
            if (e.type === "error") throw new AiError(scrub(e.error?.message ?? "The model stopped with an error.", cfg.key), 502);
            if (e.type === "message_start") {
                const u = e.message?.usage ?? {};
                usage.input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
            }
            if (e.type === "content_block_start" && e.content_block?.type === "text") yield { type: "block" };
            if (e.type === "content_block_start" && (e.content_block?.type === "server_tool_use" || e.content_block?.type === "mcp_tool_use")) yield { type: "tool", name: String(e.content_block.name ?? "") };
            if (e.type === "content_block_delta" && e.delta?.type === "text_delta") yield { type: "text", text: e.delta.text ?? "" };
            if (e.type === "content_block_delta" && e.delta?.type === "thinking_delta") yield { type: "thinking", text: e.delta.thinking ?? "" };
            if (e.type === "message_delta") {
                if (e.delta?.stop_reason) stop = e.delta.stop_reason;
                if (e.usage?.output_tokens) usage.output = e.usage.output_tokens;
            }
        } else {
            if (e.error) throw new AiError(scrub(e.error?.message ?? "The model stopped with an error.", cfg.key), 502);
            const choice = e.choices?.[0];
            const delta = choice?.delta ?? {};
            if (typeof delta.reasoning_content === "string" && delta.reasoning_content) yield { type: "thinking", text: delta.reasoning_content };
            if (typeof delta.content === "string" && delta.content) yield { type: "text", text: delta.content };
            if (delta.refusal) stop = "refusal";
            if (choice?.finish_reason) stop = stop ?? OPENAI_STOP[choice.finish_reason] ?? "end_turn";
            if (e.usage) {
                usage.input = e.usage.prompt_tokens ?? usage.input;
                usage.output = e.usage.completion_tokens ?? usage.output;
            }
        }
    }
    yield { type: "done", stop: stop ?? "end_turn", usage };
}

// The models a key can use, newest first where the provider says. Chat models only for OpenAI.
export async function listModels(cfg) {
    const base = baseUrlOf(cfg);
    if (!base) throw new AiError("Add the address of the model server.", 400, "ai-bad-address");
    if (cfg.provider === "anthropic") {
        const res = await send(`${base}/v1/models?limit=100`, { method: "GET", headers: anthropicHeaders(cfg, {}) }, cfg.key, 15000);
        const data = await res.json().catch(() => ({}));
        return (data.data ?? []).map((m) => ({ id: String(m.id), label: String(m.display_name ?? m.id) })).filter((m) => m.id);
    }
    const res = await send(`${base}/models`, { method: "GET", headers: openaiHeaders(cfg) }, cfg.key, 15000);
    const data = await res.json().catch(() => ({}));
    const list = (data.data ?? []).map((m) => ({ id: String(m.id), label: String(m.id), created: Number(m.created) || 0 })).filter((m) => m.id);
    const chat = cfg.provider === "openai" ? list.filter((m) => /^(gpt-|o\d|chatgpt-)/.test(m.id) && !/(audio|realtime|transcribe|tts|image|embedding|search|instruct)/.test(m.id)) : list;
    return chat.sort((a, b) => b.created - a.created).map(({ id, label }) => ({ id, label }));
}

// One tiny call: does the key (and model) answer?
export async function testKey(cfg) {
    const started = Date.now();
    const out = await complete(cfg, { messages: [{ role: "user", content: "Reply with the word OK." }], maxTokens: 16, timeout: 30000 });
    return { ok: true, ms: Date.now() - started, usage: out.usage };
}

// A picture from a prompt, as a data URL. The endpoint takes { model, prompt, n, size } and answers
// { data: [{ b64_json | url }] } (OpenAI's images API).
export async function generateImage(cfg, { prompt, size }) {
    const base = imageBaseOf(cfg);
    const endpoint = cfg.endpoint ?? (base ? `${base}/images/generations` : "");
    if (!endpoint) throw new AiError("Add the address of the image model.", 400, "ai-bad-address");
    const res = await send(endpoint, { method: "POST", headers: openaiHeaders(cfg), body: JSON.stringify({ prompt, n: 1, size, ...(cfg.model ? { model: cfg.model } : {}) }) }, cfg.key, 180000);
    const data = await res.json().catch(() => ({}));
    const first = data?.data?.[0] ?? {};
    if (first.b64_json) return `data:image/png;base64,${first.b64_json}`;
    if (typeof first.url === "string" && /^https:\/\//.test(first.url)) {
        const img = await fetch(first.url, { signal: AbortSignal.timeout(60000) });
        const type = img.headers.get("content-type") ?? "image/png";
        if (!img.ok || !type.startsWith("image/")) throw new AiError("The image model's picture couldn't be fetched.", 502);
        return `data:${type};base64,${Buffer.from(await img.arrayBuffer()).toString("base64")}`;
    }
    throw new AiError("The image model didn't send a picture.", 502);
}
