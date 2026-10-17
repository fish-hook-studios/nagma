// Smart symbols: common typographic substitutions made as you type (Preferences › Smart symbols, off
// by default). When the characters just typed complete one of these sequences, the sequence turns
// into its symbol.
export const SMART_SYMBOLS: [string, string][] = [
    ["(tm)", "™"],
    ["(TM)", "™"],
    ["(c)", "©"],
    ["(C)", "©"],
    ["(r)", "®"],
    ["(R)", "®"],
    ["...", "…"],
    ["<->", "↔"],
    ["->", "→"],
    ["<-", "←"],
    ["=>", "⇒"],
    ["!=", "≠"],
    ["<=", "≤"],
    [">=", "≥"],
    ["+-", "±"],
    ["1/2", "½"],
    ["1/4", "¼"],
    ["3/4", "¾"],
];

// The substitution for the text ending at `end`, if the last typed characters complete one: where it
// starts, how long the sequence is and the symbol.
export function smartSymbolAt(text: string, end: number): { start: number; length: number; symbol: string } | null {
    for (const [sequence, symbol] of SMART_SYMBOLS) {
        const start = end - sequence.length;
        if (start >= 0 && text.slice(start, end) === sequence) {
            // "1/2" only on its own, so dates and fractions like 11/25 stay as typed.
            if (/^\d/.test(sequence) && (/\d/.test(text[start - 1] ?? "") || /\d/.test(text[end] ?? ""))) continue;
            return { start, length: sequence.length, symbol };
        }
    }
    return null;
}
