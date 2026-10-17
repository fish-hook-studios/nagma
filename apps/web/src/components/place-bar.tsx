import { viewCenter } from "../engine/actions";
import { cancelPlace, placeAll } from "../engine/place";
import { useVectorUi } from "../engine/vector-ui";

// While images wait to be placed: how many, Place all (a grid in the middle of the view) and Cancel.
export function PlaceBar() {
    const count = useVectorUi((s) => s.place.length);
    if (!count) return null;
    return (
        <div className="pointer-events-auto flex h-10 items-center gap-1 rounded-xl bg-tooltip px-1.5 text-[11.5px] text-white shadow-xl">
            <span className="px-2 whitespace-nowrap text-white/70" title="Click to place, drag to size, or click a shape to fill it">
                {count} {count === 1 ? "file" : "files"} to place
            </span>
            <button type="button" onClick={() => void placeAll(viewCenter())} className="flex h-7 items-center rounded-md bg-brand-500 px-2.5 whitespace-nowrap font-medium text-white outline-none hover:bg-brand-600">
                Place all
            </button>
            <button type="button" onClick={cancelPlace} className="flex h-7 items-center rounded-md px-2 text-white/85 outline-none hover:bg-white/10">
                Cancel
            </button>
        </div>
    );
}
