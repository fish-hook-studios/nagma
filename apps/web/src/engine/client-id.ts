import { nanoid } from "nanoid";

// This browser's stable id: guests keep their comments, reactions and read state across visits.
const CLIENT_KEY = "nagma.client.v1";
let clientId = "";
try {
    clientId = localStorage.getItem(CLIENT_KEY) ?? "";
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(clientId)) {
        clientId = nanoid(16);
        localStorage.setItem(CLIENT_KEY, clientId);
    }
} catch {
    clientId = nanoid(16);
}

export function browserId(): string {
    return clientId;
}
