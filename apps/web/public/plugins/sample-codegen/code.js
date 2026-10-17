// A sample codegen plugin: Inspect shows its languages in the Code section's language list and
// asks it for code whenever a layer is selected.

const camel = (prop) => prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const component = (name) => name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^[a-z]/, (c) => c.toUpperCase()) || "Layer";

function hex(paint) {
    const to = (v) => Math.round(v * 255).toString(16).padStart(2, "0").toUpperCase();
    return `0x${to(paint.opacity ?? 1)}${to(paint.color.r)}${to(paint.color.g)}${to(paint.color.b)}`;
}

async function react(node) {
    const css = await node.getCSSAsync();
    const style = Object.entries(css)
        .map(([k, v]) => `    ${camel(k)}: ${JSON.stringify(v)},`)
        .join("\n");
    const name = component(node.name);
    const body = node.type === "TEXT" ? node.characters : (node.children ?? []).map((c) => `<${component(c.name)} />`).join("\n      ");
    return [
        { title: `${name}.jsx`, language: "JAVASCRIPT", code: `export function ${name}() {\n  return (\n    <div style={styles.root}>\n      ${body}\n    </div>\n  );\n}\n\nconst styles = {\n  root: {\n${style}\n  },\n};` },
    ];
}

function flutter(node) {
    const fill = node.fills.find((p) => p.type === "SOLID" && p.visible);
    const lines = [`Container(`, `  width: ${node.width},`, `  height: ${node.height},`];
    if (fill || node.cornerRadius) {
        lines.push(`  decoration: BoxDecoration(`);
        if (fill) lines.push(`    color: Color(${hex(fill)}),`);
        if (typeof node.cornerRadius === "number" && node.cornerRadius) lines.push(`    borderRadius: BorderRadius.circular(${node.cornerRadius}),`);
        lines.push(`  ),`);
    }
    if (node.type === "TEXT") lines.push(`  child: Text(${JSON.stringify(node.characters)}, style: TextStyle(fontSize: ${node.fontSize})),`);
    lines.push(`)`);
    return [{ title: "Widget", language: "DART", code: lines.join("\n") }];
}

nagma.codegen.on("generate", async ({ node, language }) => {
    console.log(`Generating ${language} for ${node.name}`);
    return language === "flutter" ? flutter(node) : react(node);
});
