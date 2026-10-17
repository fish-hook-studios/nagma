import { serverSyncBase } from "./servers";

// Where the sync server is: the server this device is connected to (engine/servers.ts), or This
// computer's: VITE_SYNC_URL if set; the separate dev server (port 8787) when running under Vite;
// otherwise the same address the editor was loaded from (the server hosts both).
export function syncBase(): string {
    return serverSyncBase();
}

// The sync server over HTTP (accounts, media uploads, the file list, teams).
export function httpBase(): string {
    return syncBase().replace(/^ws/, "http");
}
