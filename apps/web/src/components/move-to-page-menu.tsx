import { Menu as AriaMenu, Popover as AriaPopover, SubmenuTrigger as AriaSubmenuTrigger } from "react-aria-components";
import { moveTargets, moveToPage } from "../engine/pages";
import { editor, useEditor } from "../engine/store";
import { MenuRow } from "./left-sidebar";

// "Move to page ▸": the other pages of the file; the selection lands there at the same coordinates.
export function MoveToPageSubmenu({ menuClass }: { menuClass: string }) {
    const doc = useEditor((s) => s.doc);
    const pageId = useEditor((s) => s.pageId);
    const pages = moveTargets(doc, pageId);
    return (
        <AriaSubmenuTrigger>
            <MenuRow id="moveToPage" label="Move to page" shortcut="›" />
            <AriaPopover offset={-4} className={`${menuClass} max-h-[60vh] overflow-y-auto`}>
                <AriaMenu
                    aria-label="Move to page"
                    className="outline-none"
                    disabledKeys={pages.length ? [] : ["none"]}
                    onAction={(key) => {
                        editor.set({ contextMenu: null });
                        if (key !== "none") moveToPage(String(key));
                    }}
                >
                    {pages.length ? pages.map((page) => <MenuRow key={page.id} id={page.id} label={page.name} />) : <MenuRow id="none" label="No other pages" />}
                </AriaMenu>
            </AriaPopover>
        </AriaSubmenuTrigger>
    );
}
