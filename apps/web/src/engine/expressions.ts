// Expressions for conditional actions and "Set variable": arithmetic, comparisons, and/or/not,
// string joining and booleans over variables, as in the reference's prototype expressions.
//
// Stored as text. A variable is written {{variableId}} so renaming it never breaks the expression;
// the editor shows those as pills with the variable's name.
//
//   {{count}} + 1            {{name}} + " items"        {{count}} >= 3 and not {{done}}
//   "#FF0000"                ({{a}} - {{b}}) * 2 / 3    {{flag}} == true or {{mode}} != "dark"
//   VAR_MODE_LOOKUP("Theme") == "Dark"   (the current mode of a variable collection, by name or id)

export type Value = number | string | boolean;

type Token =
    | { kind: "num"; value: number }
    | { kind: "str"; value: string }
    | { kind: "bool"; value: boolean }
    | { kind: "var"; id: string }
    | { kind: "op"; value: string }
    | { kind: "func"; name: string }
    | { kind: "paren"; value: "(" | ")" };

export type Node =
    | { kind: "lit"; value: Value }
    | { kind: "var"; id: string }
    | { kind: "unary"; op: "-" | "not"; arg: Node }
    | { kind: "binary"; op: string; left: Node; right: Node }
    // VAR_MODE_LOOKUP(collection): the name of the collection's current mode.
    | { kind: "func"; name: "VAR_MODE_LOOKUP"; arg: Node };

// The functions an expression can call.
export const FUNCTIONS = ["VAR_MODE_LOOKUP"] as const;
// Lookups ask for a collection's mode with this prefix before the collection's id or name.
export const MODE_PREFIX = "mode:";

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };

const OPS = ["==", "!=", ">=", "<=", "&&", "||", ">", "<", "+", "-", "*", "/", "%", "!"];

export function tokenize(src: string): Token[] {
    const out: Token[] = [];
    let i = 0;
    while (i < src.length) {
        const ch = src[i] ?? "";
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        if (src.startsWith("{{", i)) {
            const end = src.indexOf("}}", i + 2);
            if (end < 0) throw new Error("Unclosed variable");
            out.push({ kind: "var", id: src.slice(i + 2, end).trim() });
            i = end + 2;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === "“") {
            const close = ch === "“" ? "”" : ch;
            let j = i + 1;
            let text = "";
            while (j < src.length && src[j] !== close) {
                if (src[j] === "\\" && j + 1 < src.length) {
                    // Escapes as literal() writes them (JSON): \n, \t, \uXXXX…; any other character as itself.
                    j++;
                    const e = src[j] ?? "";
                    const hex = e === "u" ? /^[0-9a-fA-F]{4}/.exec(src.slice(j + 1))?.[0] : undefined;
                    if (hex) {
                        text += String.fromCharCode(parseInt(hex, 16));
                        j += 5;
                        continue;
                    }
                    text += ESCAPES[e] ?? e;
                    j++;
                    continue;
                }
                text += src[j];
                j++;
            }
            if (j >= src.length) throw new Error("Unclosed text");
            out.push({ kind: "str", value: text });
            i = j + 1;
            continue;
        }
        if (ch === "#" && /^#[0-9a-fA-F]{3,8}\b/.test(src.slice(i))) {
            const m = /^#[0-9a-fA-F]{3,8}/.exec(src.slice(i))?.[0] ?? "#";
            out.push({ kind: "str", value: m.toUpperCase() });
            i += m.length;
            continue;
        }
        if (/[0-9.]/.test(ch)) {
            // With an exponent too, as numbers print when very small or large (1e-7, 2.5e+21).
            const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))?.[0];
            if (!m) throw new Error(`Unexpected ${ch}`);
            out.push({ kind: "num", value: Number(m) });
            i += m.length;
            continue;
        }
        if (ch === "(" || ch === ")") {
            out.push({ kind: "paren", value: ch });
            i++;
            continue;
        }
        const op = OPS.find((o) => src.startsWith(o, i));
        if (op) {
            out.push({ kind: "op", value: op });
            i += op.length;
            continue;
        }
        if (ch === "=") {
            // A single = reads as "equals".
            out.push({ kind: "op", value: "==" });
            i++;
            continue;
        }
        const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))?.[0];
        if (word) {
            const lower = word.toLowerCase();
            if (lower === "true" || lower === "false") out.push({ kind: "bool", value: lower === "true" });
            else if (lower === "and") out.push({ kind: "op", value: "&&" });
            else if (lower === "or") out.push({ kind: "op", value: "||" });
            else if (lower === "not") out.push({ kind: "op", value: "!" });
            else if (word.toUpperCase() === "VAR_MODE_LOOKUP") out.push({ kind: "func", name: "VAR_MODE_LOOKUP" });
            else throw new Error(`Unknown name ${word}`);
            i += word.length;
            continue;
        }
        throw new Error(`Unexpected ${ch}`);
    }
    return out;
}

export function parse(src: string): Node {
    const tokens = tokenize(src);
    let pos = 0;
    const peek = () => tokens[pos];
    const isOp = (...ops: string[]) => {
        const t = peek();
        return t?.kind === "op" && ops.includes(t.value);
    };
    const take = () => tokens[pos++];
    const or = (): Node => {
        let left = and();
        while (isOp("||")) {
            take();
            left = { kind: "binary", op: "||", left, right: and() };
        }
        return left;
    };
    const and = (): Node => {
        let left = not();
        while (isOp("&&")) {
            take();
            left = { kind: "binary", op: "&&", left, right: not() };
        }
        return left;
    };
    const not = (): Node => {
        if (isOp("!")) {
            take();
            return { kind: "unary", op: "not", arg: not() };
        }
        return compare();
    };
    const compare = (): Node => {
        const left = add();
        if (isOp("==", "!=", ">", "<", ">=", "<=")) {
            const op = (take() as { value: string }).value;
            return { kind: "binary", op, left, right: add() };
        }
        return left;
    };
    const add = (): Node => {
        let left = mul();
        while (isOp("+", "-")) {
            const op = (take() as { value: string }).value;
            left = { kind: "binary", op, left, right: mul() };
        }
        return left;
    };
    const mul = (): Node => {
        let left = unary();
        while (isOp("*", "/", "%")) {
            const op = (take() as { value: string }).value;
            left = { kind: "binary", op, left, right: unary() };
        }
        return left;
    };
    const unary = (): Node => {
        if (isOp("-")) {
            take();
            return { kind: "unary", op: "-", arg: unary() };
        }
        if (isOp("!")) {
            take();
            return { kind: "unary", op: "not", arg: unary() };
        }
        return primary();
    };
    const primary = (): Node => {
        const t = take();
        if (!t) throw new Error("Expression ends too soon");
        if (t.kind === "num" || t.kind === "str" || t.kind === "bool") return { kind: "lit", value: t.value };
        if (t.kind === "var") return { kind: "var", id: t.id };
        if (t.kind === "func") {
            const open = take();
            if (open?.kind !== "paren" || open.value !== "(") throw new Error(`${t.name} needs ( )`);
            const arg = or();
            const close = take();
            if (close?.kind !== "paren" || close.value !== ")") throw new Error("Missing )");
            return { kind: "func", name: "VAR_MODE_LOOKUP", arg };
        }
        if (t.kind === "paren" && t.value === "(") {
            const inner = or();
            const close = take();
            if (close?.kind !== "paren" || close.value !== ")") throw new Error("Missing )");
            return inner;
        }
        throw new Error("Unexpected operator");
    };
    if (!tokens.length) throw new Error("Empty expression");
    const tree = or();
    if (pos < tokens.length) throw new Error("Unexpected text after the expression");
    return tree;
}

function truthy(v: Value): boolean {
    if (typeof v === "string") return v !== "" && v.toLowerCase() !== "false";
    return Boolean(v);
}

function num(v: Value): number {
    if (typeof v === "boolean") return v ? 1 : 0;
    return typeof v === "number" ? v : Number(v);
}

function equal(a: Value, b: Value): boolean {
    if (typeof a === typeof b) return typeof a === "string" ? a.toLowerCase() === (b as string).toLowerCase() : a === b;
    // Mixed kinds compare as text ("3" == 3, "true" == true).
    return String(a).toLowerCase() === String(b).toLowerCase();
}

export function evaluateNode(node: Node, lookup: (id: string) => Value | undefined): Value {
    switch (node.kind) {
        case "lit":
            return node.value;
        case "var": {
            const v = lookup(node.id);
            if (v === undefined) throw new Error("Missing variable");
            return v;
        }
        case "unary": {
            const v = evaluateNode(node.arg, lookup);
            return node.op === "-" ? -num(v) : !truthy(v);
        }
        case "func": {
            const v = lookup(`${MODE_PREFIX}${String(evaluateNode(node.arg, lookup))}`);
            if (v === undefined) throw new Error("No such collection");
            return v;
        }
        case "binary": {
            if (node.op === "&&") return truthy(evaluateNode(node.left, lookup)) && truthy(evaluateNode(node.right, lookup));
            if (node.op === "||") return truthy(evaluateNode(node.left, lookup)) || truthy(evaluateNode(node.right, lookup));
            const a = evaluateNode(node.left, lookup);
            const b = evaluateNode(node.right, lookup);
            switch (node.op) {
                case "+":
                    if (typeof a === "string" || typeof b === "string") return `${fmt(a)}${fmt(b)}`;
                    return num(a) + num(b);
                case "-":
                    return num(a) - num(b);
                case "*":
                    return num(a) * num(b);
                case "/":
                    return num(b) === 0 ? 0 : num(a) / num(b);
                case "%":
                    return num(b) === 0 ? 0 : num(a) % num(b);
                case "==":
                    return equal(a, b);
                case "!=":
                    return !equal(a, b);
                case ">":
                    return num(a) > num(b);
                case "<":
                    return num(a) < num(b);
                case ">=":
                    return num(a) >= num(b);
                case "<=":
                    return num(a) <= num(b);
            }
            throw new Error(`Unknown operator ${node.op}`);
        }
    }
}

// Numbers print without float noise when joined into text.
function fmt(v: Value): string {
    if (typeof v === "number") return String(Math.round(v * 1e6) / 1e6);
    return String(v);
}

// The value of an expression, or undefined when it can't be worked out.
export function evaluate(src: string, lookup: (id: string) => Value | undefined): Value | undefined {
    try {
        return evaluateNode(parse(src), lookup);
    } catch {
        return undefined;
    }
}

export function test(src: string | null | undefined, lookup: (id: string) => Value | undefined): boolean {
    if (!src || !src.trim()) return false;
    const v = evaluate(src, lookup);
    return v === undefined ? false : truthy(v);
}

// The problem with an expression, for the editor (null when it reads fine).
export function problem(src: string): string | null {
    if (!src.trim()) return null;
    try {
        parse(src);
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : "Can't read this expression";
    }
}

// Variable ids an expression refers to.
export function references(src: string): string[] {
    return [...src.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => (m[1] ?? "").trim());
}

// A literal for a value: numbers as they are, text quoted, colours as #hex, booleans as words.
export function literal(v: Value): string {
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v.toUpperCase();
    return JSON.stringify(v);
}

// Readable text for summaries: {{id}} becomes the variable's name.
export function describe(src: string, nameOf: (id: string) => string): string {
    return src
        .replace(/\{\{([^}]+)\}\}/g, (_, id: string) => nameOf(id.trim()))
        .replace(/&&/g, "and")
        .replace(/\|\|/g, "or")
        .replace(/VAR_MODE_LOOKUP\s*\(/gi, "mode of (");
}
