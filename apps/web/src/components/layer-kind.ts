import { ArrowUpRight, Circle, Columns01, File04, Grid01, Hash02, Image01, Minus, PenTool01, Pencil01, Rows01, Square, Star01, Triangle, Type01, VideoRecorder } from "@untitledui/icons";
import type { SVGProps } from "react";
import type { NodeType, SceneNode } from "../engine/types";
import { BooleanIcon } from "./boolean-icons";
import { ComponentIcon, InstanceIcon } from "./component-icons";
import { GroupIcon } from "./group-icon";
import { ComponentSetIcon, MaskIcon } from "./layer-icons";
import { SectionIcon, SliceIcon, TextPathIcon } from "./toolbar-icons";

export type LayerIcon = React.FC<SVGProps<SVGSVGElement>>;

const BY_TYPE: Record<NodeType, LayerIcon> = {
    page: File04,
    frame: Hash02,
    component: ComponentIcon,
    componentSet: ComponentSetIcon,
    instance: InstanceIcon,
    group: GroupIcon,
    boolean: BooleanIcon,
    vector: PenTool01,
    rect: Square,
    ellipse: Circle,
    text: Type01,
};

// The icon a layer wears in the Layers panel, menus and search results: its kind, refined by what
// it is used for (masks, sections, slices, auto layout direction, images, video, lines and shapes).
export function layerIcon(node: SceneNode): LayerIcon {
    if (node.isMask) return MaskIcon;
    if (node.isSection) return SectionIcon;
    if (node.isSlice) return SliceIcon;
    if (node.type === "text" && node.pathId) return TextPathIcon;
    if (node.type === "frame" && node.layout) {
        if (node.layout.grid) return Grid01;
        return node.layout.direction === "horizontal" ? Columns01 : Rows01;
    }
    const image = node.fills.find((paint) => paint.type === "image");
    if (image && (node.type === "rect" || node.type === "frame" || node.type === "ellipse")) return image.type === "image" && image.video ? VideoRecorder : Image01;
    if (node.type === "vector") {
        if (node.name.startsWith("Arrow")) return ArrowUpRight;
        if (node.name.startsWith("Line")) return Minus;
        if (node.name.startsWith("Polygon")) return Triangle;
        if (node.name.startsWith("Star")) return Star01;
        if (node.name.startsWith("Pencil") || node.name.startsWith("Marker")) return Pencil01;
    }
    return BY_TYPE[node.type] ?? Square;
}

// Purple for components and instances, as on the canvas.
export function isReusable(node: SceneNode): boolean {
    return node.type === "component" || node.type === "componentSet" || node.type === "instance";
}
