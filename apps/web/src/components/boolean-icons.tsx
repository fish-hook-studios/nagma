import type { SVGProps } from "react";

// Two overlapping squares, with the area each operation keeps filled in.
function Base({ keep, ...props }: SVGProps<SVGSVGElement> & { keep: "union" | "subtract" | "intersect" | "exclude" | "none" }) {
    const a = "M3 3h11v11H3z";
    const b = "M10 10h11v11H10z";
    return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
            {keep === "union" && <path d={`${a} ${b}`} fill="currentColor" fillRule="nonzero" opacity="0.35" />}
            {keep === "subtract" && <path d="M3 3h11v7h-4v4H3z" fill="currentColor" opacity="0.35" />}
            {keep === "intersect" && <path d="M10 10h4v4h-4z" fill="currentColor" opacity="0.6" />}
            {keep === "exclude" && <path d={`${a} ${b}`} fill="currentColor" fillRule="evenodd" opacity="0.35" />}
            <path d={a} stroke="currentColor" strokeWidth="1.6" />
            <path d={b} stroke="currentColor" strokeWidth="1.6" />
        </svg>
    );
}

export const BooleanIcon = (props: SVGProps<SVGSVGElement>) => <Base keep="none" {...props} />;
export const UnionIcon = (props: SVGProps<SVGSVGElement>) => <Base keep="union" {...props} />;
export const SubtractIcon = (props: SVGProps<SVGSVGElement>) => <Base keep="subtract" {...props} />;
export const IntersectIcon = (props: SVGProps<SVGSVGElement>) => <Base keep="intersect" {...props} />;
export const ExcludeIcon = (props: SVGProps<SVGSVGElement>) => <Base keep="exclude" {...props} />;
