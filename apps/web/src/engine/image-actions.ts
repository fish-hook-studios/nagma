import { readImage } from "./images";
import { firstImagePaint } from "./photo";
import { editor } from "./store";
import type { ImagePaint } from "./types";

// Image layer actions shared by the Design panel's image header and the image bar on the canvas.

// Asks for an image file and hands back its id once it is in the document.
export function pickImageFile(done: (id: string) => void) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const image = await readImage(file);
        if (!image) {
            editor.notify(`Couldn't open ${file.name} as an image.`);
            return;
        }
        editor.execute({ type: "image.add", id: image.id, data: image.data });
        done(image.id);
    };
    input.click();
}

// Swaps the picture in a layer's top image fill, keeping how it is placed (one undo step with the upload).
export function replaceImage(nodeId: string) {
    pickImageFile((id) => {
        const node = editor.get().doc.nodes[nodeId];
        const index = firstImagePaint(node);
        if (!node || index < 0) return;
        const fills = node.fills.map((p, i) => (i === index && p.type === "image" ? ({ ...p, id, original: undefined, adjust: undefined } satisfies ImagePaint) : p));
        editor.execute({ type: "node.update", id: nodeId, patch: { fills } });
        editor.mergeLast();
    });
}
