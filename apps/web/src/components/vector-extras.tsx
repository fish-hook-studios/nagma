import { useVectorShortcuts } from "../hooks/use-vector-shortcuts";
import { ExportModal } from "./export-modal";
import { PathOpsDialog } from "./path-ops-dialog";

// The vector, draw, image and export tools' keys and dialogs, mounted once by the app.
export function VectorExtras() {
    useVectorShortcuts();
    return (
        <>
            <ExportModal />
            <PathOpsDialog />
        </>
    );
}
