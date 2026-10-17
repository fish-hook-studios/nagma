import { describe as group, expect, it } from "vitest";
import { describe, evaluate, literal, parse, problem, references, test, tokenize, type Value } from "./expressions";

// Prototype expressions: tokenizer, parser, evaluator, the editor's problem text and summaries.

const vars: Record<string, Value> = {
    count: 3,
    zero: 0,
    name: "Ada",
    flag: true,
    off: false,
    dark: "Dark",
    neg: -4,
    "mode:Theme": "Dark",
    "mode:th1": "Dark",
    empty: "",
};
const lookup = (id: string) => vars[id];

group("tokenize", () => {
    it.each([
        ["1 + 2", ["num", "op", "num"]],
        ["{{count}}", ["var"]],
        ["{{ count }}", ["var"]],
        ['"text"', ["str"]],
        ["'text'", ["str"]],
        ["“curly”", ["str"]],
        ["#ff0000", ["str"]],
        ["true and false", ["bool", "op", "bool"]],
        ["TRUE OR not False", ["bool", "op", "op", "bool"]],
        ["a", null],
        ["1 >= 2 != 3 <= 4", ["num", "op", "num", "op", "num", "op", "num"]],
        ["VAR_MODE_LOOKUP(\"x\")", ["func", "paren", "str", "paren"]],
        ["var_mode_lookup(\"x\")", ["func", "paren", "str", "paren"]],
        ["{{unclosed", null],
        ['"unclosed', null],
        ["@", null],
        [".", null],
    ] as const)("%s", (src, kinds) => {
        if (kinds === null) expect(() => tokenize(src)).toThrow();
        else expect(tokenize(src).map((t) => t.kind)).toEqual(kinds);
    });

    it("trims variable ids and upper-cases hex colours", () => {
        expect(tokenize("{{  a b  }}")).toEqual([{ kind: "var", id: "a b" }]);
        expect(tokenize("#abc")).toEqual([{ kind: "str", value: "#ABC" }]);
    });

    it("reads a single = as equals", () => {
        expect(tokenize("1 = 1")).toEqual([
            { kind: "num", value: 1 },
            { kind: "op", value: "==" },
            { kind: "num", value: 1 },
        ]);
    });

    it("reads escapes inside text", () => {
        expect(tokenize('"a\\"b"')).toEqual([{ kind: "str", value: 'a"b' }]);
        expect(tokenize('"a\\\\b"')).toEqual([{ kind: "str", value: "a\\b" }]);
    });
});

group("evaluate (table)", () => {
    it.each<[string, Value | undefined]>([
        // arithmetic and precedence
        ["1 + 2 * 3", 7],
        ["(1 + 2) * 3", 9],
        ["10 - 4 - 3", 3],
        ["100 / 10 / 2", 5],
        ["7 % 4", 3],
        ["2 * 3 % 4", 2],
        ["-2 * 3", -6],
        ["2 - -3", 5],
        ["--2", 2],
        ["-(1 + 2)", -3],
        ["-{{neg}}", 4],
        [".5 + 1.5", 2],
        ["((((1))))", 1],
        // division by zero is 0, not Infinity or NaN
        ["1 / 0", 0],
        ["5 % 0", 0],
        ["{{count}} / {{zero}}", 0],
        // variables
        ["{{count}} + 1", 4],
        ["{{count}} * {{count}}", 9],
        ["{{flag}} + 1", 2],
        // string joining
        ['{{name}} + " items"', "Ada items"],
        ['"a" + 1 + 2', "a12"],
        ['1 + 2 + "a"', "3a"],
        ['"x" + 0.1 * 3', "x0.3"],
        ['"" + true', "true"],
        ["#ff0000", "#FF0000"],
        // comparisons
        ["{{count}} >= 3", true],
        ["{{count}} > 3", false],
        ["{{count}} < 3.5", true],
        ["{{count}} <= 2", false],
        ["{{count}} == 3", true],
        ['{{count}} == "3"', true],
        ["{{count}} != 3", false],
        ['{{dark}} == "dark"', true],
        ['{{dark}} != "Light"', true],
        ["{{flag}} == true", true],
        ['{{flag}} == "TRUE"', true],
        ["{{off}} = false", true],
        ['"abc" > 1', false],
        // boolean logic
        ["true and false", false],
        ["true && true", true],
        ["false or true", true],
        ["false || false", false],
        ["not true", false],
        ["!{{off}}", true],
        ["not {{count}} > 5", true],
        ["{{count}} >= 3 and not {{off}}", true],
        ["true or false and false", true],
        ["(true or false) and false", false],
        ['not ""', true],
        ['not "false"', true],
        ['not "no"', false],
        // short-circuit: the missing side is never read
        ["false and {{missing}}", false],
        ["true or {{missing}}", true],
        // VAR_MODE_LOOKUP
        ['VAR_MODE_LOOKUP("Theme")', "Dark"],
        ['VAR_MODE_LOOKUP("Theme") == "dark"', true],
        ['VAR_MODE_LOOKUP("th1") != "Light"', true],
        ['VAR_MODE_LOOKUP("Nope")', undefined],
        // unknown references and malformed input give undefined, never throw
        ["{{missing}}", undefined],
        ["{{missing}} + 1", undefined],
        ["1 +", undefined],
        ["(1 + 2", undefined],
        ["1 2", undefined],
        ["foo", undefined],
        ["1 < 2 < 3", undefined],
        ["", undefined],
        ["()", undefined],
        ["VAR_MODE_LOOKUP", undefined],
    ])("%s → %s", (src, expected) => {
        const v = evaluate(src, lookup);
        if (typeof expected === "number") expect(v).toBeCloseTo(expected, 10);
        else expect(v).toBe(expected);
    });
});

group("test (conditions)", () => {
    it.each<[string | null | undefined, boolean]>([
        [null, false],
        [undefined, false],
        ["", false],
        ["   ", false],
        ["{{flag}}", true],
        ["{{off}}", false],
        ["{{count}}", true],
        ["{{zero}}", false],
        ["{{empty}}", false],
        ["{{missing}}", false],
        ["{{count}} == 3", true],
        ["oops (", false],
    ])("%s → %s", (src, expected) => {
        expect(test(src, lookup)).toBe(expected);
    });
});

group("problem", () => {
    it.each<[string, string | null]>([
        ["", null],
        ["   ", null],
        ["{{a}} + 1", null],
        ["1 +", "Expression ends too soon"],
        ["(1 + 2", "Missing )"],
        ["1 2", "Unexpected text after the expression"],
        ["{{a", "Unclosed variable"],
        ['"abc', "Unclosed text"],
        ["foo", "Unknown name foo"],
        ["@", "Unexpected @"],
        ["VAR_MODE_LOOKUP 1", "VAR_MODE_LOOKUP needs ( )"],
        [")", "Unexpected operator"],
    ])("%s", (src, expected) => {
        expect(() => problem(src)).not.toThrow();
        expect(problem(src)).toBe(expected);
    });
});

group("parse", () => {
    it("builds a tree with the usual precedence", () => {
        expect(parse("1 + 2 * 3")).toEqual({
            kind: "binary",
            op: "+",
            left: { kind: "lit", value: 1 },
            right: { kind: "binary", op: "*", left: { kind: "lit", value: 2 }, right: { kind: "lit", value: 3 } },
        });
        expect(parse("not {{a}} and {{b}}")).toEqual({
            kind: "binary",
            op: "&&",
            left: { kind: "unary", op: "not", arg: { kind: "var", id: "a" } },
            right: { kind: "var", id: "b" },
        });
    });

    it("throws on empty input", () => {
        expect(() => parse("")).toThrow("Empty expression");
    });
});

group("references, describe, literal", () => {
    it("lists every variable id, trimmed, in order", () => {
        expect(references("{{ a }} + {{b}} * {{a}}")).toEqual(["a", "b", "a"]);
        expect(references("1 + 2")).toEqual([]);
    });

    it("describes with variable names and words for operators", () => {
        const names: Record<string, string> = { a: "Count", b: "Done" };
        expect(describe("{{a}} >= 3 && {{b}} || !{{b}}", (id) => names[id] ?? id)).toBe("Count >= 3 and Done or !Done");
        expect(describe('VAR_MODE_LOOKUP("Theme") == "Dark"', (id) => id)).toBe('mode of ("Theme") == "Dark"');
    });

    it.each<[Value, string]>([
        [3, "3"],
        [-2.5, "-2.5"],
        [true, "true"],
        ["#abcdef", "#ABCDEF"],
        ["hello", '"hello"'],
    ])("literal(%s)", (value, text) => {
        expect(literal(value)).toBe(text);
    });

    // Regression: literals with control characters or exponents didn't read back as the same value.
    it.each<Value>([0, 42, -7, 0.5, 1e-7, 2.5e21, true, false, "plain", 'quote " inside', "back\\slash", "line\nbreak", "tab\there", "bell\u0007", "#FF0000", "émoji ✓"])("literal(%j) evaluates back to the same value", (value) => {
        expect(evaluate(literal(value), () => undefined)).toBe(value);
    });
});
