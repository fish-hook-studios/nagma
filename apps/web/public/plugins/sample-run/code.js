// A sample plugin that edits the file: "Create grid…" opens a window that asks for rows, columns and
// a colour, then draws the grid in a new frame; "Name layers by type" renames the selection.

if (nagma.command === "rename") {
    const selection = nagma.currentPage.selection;
    for (const node of selection) {
        node.name = node.type.charAt(0) + node.type.slice(1).toLowerCase().replace(/_/g, " ");
        // A relaunch button on the layer runs this command again from the Design panel.
        node.setRelaunchData({ rename: "Rename again after edits" });
        node.setSharedPluginData("nagma_samples", "renamedBy", "grid maker");
    }
    nagma.closePlugin(selection.length ? `Renamed ${selection.length} layer${selection.length === 1 ? "" : "s"}.` : "Select some layers first.");
} else {
    nagma.showUI(__html__, { width: 240, height: 210, title: "Grid maker" });
    nagma.ui.postMessage({ type: "selection", count: nagma.currentPage.selection.length });
    nagma.on("selectionchange", () => nagma.ui.postMessage({ type: "selection", count: nagma.currentPage.selection.length }));
    nagma.ui.onmessage = (msg) => {
        if (msg.type === "cancel") return nagma.closePlugin();
        if (msg.type !== "create") return;
        const size = 40;
        const gap = 8;
        const frame = nagma.createFrame();
        frame.name = `Grid ${msg.rows}×${msg.columns}`;
        frame.resize(msg.columns * (size + gap) + gap, msg.rows * (size + gap) + gap);
        for (let r = 0; r < msg.rows; r++) {
            for (let c = 0; c < msg.columns; c++) {
                const cell = nagma.createRectangle();
                cell.name = `Cell ${r + 1}.${c + 1}`;
                frame.appendChild(cell);
                cell.x = gap + c * (size + gap);
                cell.y = gap + r * (size + gap);
                cell.resize(size, size);
                cell.cornerRadius = 6;
                cell.fills = [nagma.util.solidPaint(msg.color)];
            }
        }
        frame.setPluginData("size", JSON.stringify({ rows: msg.rows, columns: msg.columns }));
        frame.setRelaunchData({ grid: `${msg.rows} by ${msg.columns} grid` });
        nagma.currentPage.selection = [frame];
        nagma.viewport.scrollAndZoomIntoView([frame]);
        console.log(`Created ${msg.rows * msg.columns} cells`);
        nagma.closePlugin(`Created a ${msg.rows}×${msg.columns} grid.`);
    };
}
