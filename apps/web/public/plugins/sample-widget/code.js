// A sample widget: a counter with minus and plus buttons. Its count is synced state, kept on the
// widget's layer, so everyone looking at the file sees the same number.
const { widget } = nagma;
const { AutoLayout, Text, h, useSyncedState } = widget;

function Counter() {
    const [count, setCount] = useSyncedState("count", 0);
    const button = (label, delta) =>
        h(AutoLayout, { name: label === "+" ? "Plus" : "Minus", width: 32, height: 32, cornerRadius: 16, fill: "#6D4AFF", horizontalAlignItems: "center", verticalAlignItems: "center", onClick: () => setCount((c) => c + delta) }, h(Text, { fontSize: 18, fontWeight: 700, fill: "#FFFFFF" }, label));
    return h(
        AutoLayout,
        { name: "Counter", direction: "horizontal", spacing: 12, padding: 12, cornerRadius: 12, fill: "#FFFFFF", stroke: "#E4E4E7", verticalAlignItems: "center" },
        button("-", -1),
        h(Text, { name: "Count", fontSize: 20, fontWeight: 600, fill: "#111111" }, String(count)),
        button("+", 1),
    );
}

widget.register(Counter);
