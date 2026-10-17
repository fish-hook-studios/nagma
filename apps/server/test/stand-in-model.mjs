// A stand-in model server for tests: answers the Claude Messages API (/v1/messages, /v1/models)
// and the OpenAI API (/v1/chat/completions, /v1/models, /v1/images/generations), streamed or not,
// with canned answers. Only the keys it was given are accepted; every request is kept in `requests`
// (method, path, headers, body) so tests can see what reached the provider.
import { createServer } from "node:http";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const MAKE_ANSWER = JSON.stringify({ message: "Made a counter.", files: [{ path: "src/App.tsx", content: "export default function App() { return <button>Count</button>; }" }], deleted: [] });

export async function startStandIn({ claudeKeys = [], openaiKeys = [], openKeys = false } = {}) {
    const requests = [];
    const server = createServer((req, res) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let body = null;
            try {
                body = text ? JSON.parse(text) : null;
            } catch {
                body = null;
            }
            const url = new URL(req.url ?? "/", "http://local");
            requests.push({ method: req.method, path: url.pathname, headers: req.headers, body });
            const json = (status, data) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data));
            const sse = (list) => {
                res.writeHead(200, { "content-type": "text/event-stream" });
                for (const [event, data] of list) res.write(`${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
                res.end();
            };
            const prompt = JSON.stringify(body?.messages ?? "");
            const isMake = prompt.includes("Request:") && JSON.stringify(body?.system ?? body?.messages?.[0] ?? "").includes("Nagma Make");

            // ---- Claude ----
            if (url.pathname.startsWith("/v1/messages") || (url.pathname === "/v1/models" && req.headers["x-api-key"] !== undefined)) {
                if (!claudeKeys.includes(req.headers["x-api-key"])) return json(401, { type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${req.headers["x-api-key"]}` } });
                if (url.pathname === "/v1/models") return json(200, { data: [{ id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" }, { id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5" }], has_more: false });
                if (body?.stream) {
                    const answer = isMake ? MAKE_ANSWER : "Streamed hello.";
                    return sse([
                        ["message_start", { type: "message_start", message: { usage: { input_tokens: 120, output_tokens: 1 } } }],
                        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }],
                        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Planning a small counter app for this request." } }],
                        ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
                        ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: answer.slice(0, 20) } }],
                        ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: answer.slice(20) } }],
                        ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 80 } }],
                        ["message_stop", { type: "message_stop" }],
                    ]);
                }
                const usage = { input_tokens: 40, output_tokens: 12 };
                if (body?.tool_choice?.name === "apply") {
                    const id = /\\"id\\":\\"([^"\\]+)\\"/.exec(prompt)?.[1] ?? "node1";
                    return json(200, { content: [{ type: "tool_use", id: "tu1", name: "apply", input: { reply: "Made it blue (Claude).", commands: [{ type: "node.update", id, patch: { fills: [{ type: "solid", color: "#0000FF", opacity: 1, visible: true, blend: "normal" }] } }, { type: "bogus" }] } }], stop_reason: "tool_use", usage });
                }
                return json(200, { content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", usage });
            }

            // ---- OpenAI and compatible ----
            const auth = String(req.headers.authorization ?? "");
            const key = auth.startsWith("Bearer ") ? auth.slice(7) : "";
            if (!openKeys && !openaiKeys.includes(key)) return json(401, { error: { message: `Incorrect API key provided: ${key.slice(0, 3)}****${key.slice(-4)}`, type: "invalid_request_error" } });
            if (url.pathname === "/v1/models") return json(200, { object: "list", data: [{ id: "gpt-5", created: 3 }, { id: "gpt-5-mini", created: 2 }, { id: "text-embedding-3-large", created: 1 }, { id: "local-llama", created: 0 }] });
            if (url.pathname === "/v1/images/generations") return json(200, { data: [{ b64_json: PNG }] });
            if (url.pathname === "/v1/chat/completions") {
                if (body?.stream) {
                    const answer = isMake ? MAKE_ANSWER : "Streamed hello.";
                    return sse([
                        [null, { choices: [{ index: 0, delta: { role: "assistant", content: answer.slice(0, 15) } }] }],
                        [null, { choices: [{ index: 0, delta: { content: answer.slice(15) } }] }],
                        [null, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }],
                        [null, { choices: [], usage: { prompt_tokens: 150, completion_tokens: 90 } }],
                        [null, "[DONE]"],
                    ]);
                }
                const usage = { prompt_tokens: 30, completion_tokens: 9 };
                if (body?.tool_choice?.function?.name === "apply") {
                    const id = /\\"id\\":\\"([^"\\]+)\\"/.exec(JSON.stringify(body.messages.at(-1)))?.[1] ?? "node1";
                    return json(200, { choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "apply", arguments: JSON.stringify({ reply: "Made it red (OpenAI).", commands: [{ type: "node.update", id, patch: { opacity: 0.5 } }] }) } }] } }], usage });
                }
                return json(200, { choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "OK" } }], usage });
            }
            json(404, { error: { message: "Not found" } });
        });
    });
    await new Promise((r) => server.listen(Number(process.env.STAND_IN_PORT ?? 0), "127.0.0.1", r));
    const { port } = server.address();
    return { url: `http://127.0.0.1:${port}`, port, requests, close: () => new Promise((r) => server.close(r)) };
}

// Run directly (node stand-in-model.mjs): keys from STAND_IN_CLAUDE_KEYS / STAND_IN_OPENAI_KEYS.
if (import.meta.url === `file://${process.argv[1]}`) {
    const s = await startStandIn({ claudeKeys: (process.env.STAND_IN_CLAUDE_KEYS ?? "").split(","), openaiKeys: (process.env.STAND_IN_OPENAI_KEYS ?? "").split(",") });
    console.log(`stand-in model server on ${s.url}`);
}
