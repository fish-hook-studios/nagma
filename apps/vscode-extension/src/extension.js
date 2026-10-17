// Nagma for the code editor: a Files view of the Nagma files your token can read, and Inspect code
// for any Nagma link. The token (a read-only personal access token from Account settings › Tokens)
// is kept in the editor's secret storage, or read from NAGMA_TOKEN.
const vscode = require("vscode");
const { api, inspect } = require("./nagma");
const legacy = require("./legacy");

const SECRET = "nagma.token";

function settings() {
    // Settings saved before the product's rename are read too (legacy.js).
    return { serverUrl: legacy.setting(vscode, "serverUrl"), language: legacy.setting(vscode, "codeLanguage") || "react" };
}

async function tokenOf(context) {
    return (await context.secrets.get(SECRET)) || process.env.NAGMA_TOKEN || legacy.legacyToken();
}

class FilesView {
    constructor(context) {
        this.context = context;
        this.changed = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.changed.event;
    }
    refresh() {
        this.changed.fire();
    }
    getTreeItem(item) {
        return item;
    }
    async getChildren() {
        const token = await tokenOf(this.context);
        if (!token) {
            const item = new vscode.TreeItem("Set a personal access token…");
            item.command = { command: "nagma.setToken", title: "Set token" };
            return [item];
        }
        try {
            const files = await api(settings().serverUrl, token).files();
            return files.map((f) => {
                const item = new vscode.TreeItem(f.name);
                item.description = `${f.kind}, ${f.role === "edit" ? "can edit" : "can view"}`;
                item.tooltip = new Date(f.updatedAt).toLocaleString();
                item.iconPath = new vscode.ThemeIcon("file-media");
                item.command = { command: "nagma.inspectLink", title: "Inspect", arguments: [f.id] };
                return item;
            });
        } catch (error) {
            return [new vscode.TreeItem(`Couldn't load files: ${error.message}`)];
        }
    }
}

async function showInspect(context, link) {
    const target = link || (await vscode.window.showInputBox({ prompt: "Paste a Nagma link to a layer (or a file id)", placeHolder: "https://…/?file=…&node-id=…", ignoreFocusOut: true }));
    if (!target) return;
    try {
        const { serverUrl, language } = settings();
        const markdown = await inspect(serverUrl, await tokenOf(context), target, language);
        const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: markdown });
        await vscode.window.showTextDocument(doc, { preview: true });
    } catch (error) {
        vscode.window.showErrorMessage(`Nagma: ${error.message}`);
    }
}

function activate(context) {
    const view = new FilesView(context);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("nagma.files", view),
        vscode.commands.registerCommand("nagma.setToken", async () => {
            const value = await vscode.window.showInputBox({ prompt: "Personal access token from Nagma (Account settings › Tokens)", password: true, ignoreFocusOut: true });
            if (!value) return;
            await context.secrets.store(SECRET, value.trim());
            view.refresh();
            vscode.window.showInformationMessage("Nagma: token saved.");
        }),
        vscode.commands.registerCommand("nagma.clearToken", async () => {
            await context.secrets.delete(SECRET);
            view.refresh();
        }),
        vscode.commands.registerCommand("nagma.refresh", () => view.refresh()),
        vscode.commands.registerCommand("nagma.listFiles", async () => {
            try {
                const files = await api(settings().serverUrl, await tokenOf(context)).files();
                const pick = await vscode.window.showQuickPick(
                    files.map((f) => ({ label: f.name, description: f.kind, detail: f.id })),
                    { placeHolder: "Nagma files" },
                );
                if (pick) await showInspect(context, pick.detail);
            } catch (error) {
                vscode.window.showErrorMessage(`Nagma: ${error.message}`);
            }
        }),
        vscode.commands.registerCommand("nagma.inspectLink", (link) => showInspect(context, typeof link === "string" ? link : undefined)),
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
