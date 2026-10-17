import { CropBar } from "./crop-bar";
import { PlaceBar } from "./place-bar";
import { SelectionBar } from "./selection-bar";

// Bars that float over the toolbar: crop mode, placing files, and Draw mode's selection actions.
export function FloatingBars() {
    return (
        <>
            <CropBar />
            <PlaceBar />
            <SelectionBar />
        </>
    );
}
