import type { NagmaDocument } from "../engine/types";

// Named colours a product shows in every colour picker (Slides: the colours of the slide's template).
export type PickerSwatches = (doc: NagmaDocument) => { title: string; colors: { name: string; color: string }[] } | null;

let source: PickerSwatches | null = null;

export function setPickerSwatches(next: PickerSwatches | null) {
    source = next;
}

export function pickerSwatches(): PickerSwatches | null {
    return source;
}
