// Request bodies are JSON objects. Anything else ("null", a number, an array, a string) is refused
// the same way as JSON that doesn't parse, so routes can read fields off the result without checks.
// An empty body is an empty object.
export function parseObject(buffer) {
    const value = JSON.parse(buffer.toString("utf8") || "{}");
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new SyntaxError("Expected a JSON object.");
    return value;
}
