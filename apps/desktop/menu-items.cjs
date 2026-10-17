// A menu item for one of the editor's actions (the File, Edit, View… menus the open file sends).
//
// Shortcuts without ⌘ or ⌃ (Esc, ⌫, V, R…) are only shown: the page answers those keys itself.
// `registerAccelerator: false` keeps them out of the accelerator table on Windows and Linux, but
// macOS ignores it and still sets the item's key equivalent, so a key the page leaves unconsumed
// (Escape after it stepped the selection up to the parent, or Escape in a text field) reaches the
// menu too and runs the item a second time (Edit > Select none then cleared the parent). An item
// like that runs only when it is chosen from the menu, never from its key.
function fileItem(entry, run) {
    if (entry === "-") return { type: "separator" };
    if (entry.sub) return { label: entry.sub, submenu: entry.items.map((e) => fileItem(e, run)) };
    return {
        label: entry.label,
        accelerator: entry.accelerator,
        ...(entry.hint ? { registerAccelerator: false } : {}),
        enabled: entry.enabled,
        ...(entry.checked !== undefined ? { type: "checkbox", checked: entry.checked } : {}),
        click: (_item, win, event) => {
            if (entry.hint && event?.triggeredByAccelerator) return;
            run(win, entry.id);
        },
    };
}

module.exports = { fileItem };
