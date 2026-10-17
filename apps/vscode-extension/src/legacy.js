// The product was called Migfa before it was Nagma. Settings saved under the old section
// ("migfa.serverUrl", "migfa.codeLanguage") and the MIGFA_TOKEN variable are still read when the new
// ones aren't set. tools/rename-nagma.sh leaves this file as it is.
const OLD = "migfa";

// A value someone set (in any scope) under `section`, or undefined; defaults don't count.
function userValue(vscode, section, key) {
    const info = vscode.workspace.getConfiguration(section).inspect(key);
    if (!info) return undefined;
    return info.workspaceFolderValue ?? info.workspaceValue ?? info.globalValue;
}

/** The setting under the new section, else under the old one, else the default. */
function setting(vscode, key) {
    return userValue(vscode, "nagma", key) ?? userValue(vscode, OLD, key) ?? vscode.workspace.getConfiguration("nagma").get(key);
}

const legacyToken = () => process.env[`${OLD.toUpperCase()}_TOKEN`] || "";

module.exports = { setting, legacyToken };
