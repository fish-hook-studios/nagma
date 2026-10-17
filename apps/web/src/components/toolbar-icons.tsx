import { type SVGProps, useId } from "react";

// Icons the icon set doesn't have, drawn here: the toolbar's section, slice, text on path,
// eyedropper, actions and mode marks, and the three big Draw-mode tools.

type Props = SVGProps<SVGSVGElement>;
const base = (props: Props) => ({ viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, ...props });

// The Frame tool: two straight rules each way that run past each other, like crop marks.
export function FrameIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <path d="M7 3v14M13 3v14M3 7h14M3 13h14" />
        </svg>
    );
}

export function SectionIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <rect x="3" y="4" width="14" height="12" rx="2" />
            <path d="M3 8h14M7 4v4" />
        </svg>
    );
}

export function SliceIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <path d="M4 16 13.5 6.5l2.5 2.5L8 18H4z" />
            <path d="m13.5 6.5 1.5-1.5a1.8 1.8 0 0 1 2.5 2.5L16 9" />
        </svg>
    );
}

export function ScaleIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <rect x="3" y="7" width="10" height="10" rx="1.5" />
            <path d="M10 3h7v7M17 3l-5 5" />
        </svg>
    );
}

export function TextPathIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <path d="M6 5h8M10 5v8" />
            <path d="M3 16c2.5-2.5 4.5 2.5 7 0s4.5-2.5 7 0" />
        </svg>
    );
}

export function EyedropperIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <path d="m4 16 7-7M9 8l3 3" />
            <path d="M11 6.5 13.5 4a2 2 0 0 1 2.8 2.8L13.5 9" />
            <path d="M3.5 16.5 4 16" />
        </svg>
    );
}

export function AnnotationIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <rect x="4" y="3.5" width="13" height="11" rx="2" />
            <path d="M8 8h5M8 11h3" />
            <circle cx="4.5" cy="16" r="1.4" fill="currentColor" stroke="none" />
        </svg>
    );
}

export function ActionsIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <circle cx="6" cy="6" r="2.2" />
            <circle cx="14" cy="6" r="2.2" />
            <circle cx="6" cy="14" r="2.2" />
            <path d="M14 11.5v5M11.5 14h5" />
        </svg>
    );
}

export function DrawModeIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <path d="M3 12.5c1.4-2.6 2.7-4.5 3.9-4.5 1.9 0 1.1 5 3.1 5s2.2-6 4.2-6c1.2 0 1.6 1.6 2.8 3" />
        </svg>
    );
}

export function DesignModeIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <path d="M11 3.5H5A1.5 1.5 0 0 0 3.5 5v6a1.5 1.5 0 0 0 1.5 1.5h3" />
            <path d="M10 9l7 2.8-3 1.1-1.2 3.1z" fill="currentColor" />
        </svg>
    );
}

export function CommentIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <path d="M10 3.5a6.5 6.5 0 0 1 0 13H4.5l.9-2.4A6.5 6.5 0 0 1 10 3.5z" />
        </svg>
    );
}

// The Draw tools look like the things they are, standing tip up: a fountain pen, a paintbrush and a
// pencil, shaded as cylinders. The ink, paint and lead take the colour being drawn with.
type ToolProps = Props & { tint?: string };

export function DrawPenIcon({ tint = "#1E1E1E", ...props }: ToolProps) {
    const id = useId();
    return (
        <svg viewBox="0 0 28 56" {...props}>
            <defs>
                <linearGradient id={`${id}n`} x1="0" x2="1">
                    <stop offset="0" stopColor="#8D8D94" />
                    <stop offset="0.45" stopColor="#F4F4F6" />
                    <stop offset="1" stopColor="#7A7A82" />
                </linearGradient>
                <linearGradient id={`${id}b`} x1="0" x2="1">
                    <stop offset="0" stopColor="#1F1F23" />
                    <stop offset="0.35" stopColor="#5B5B63" />
                    <stop offset="0.6" stopColor="#3A3A41" />
                    <stop offset="1" stopColor="#18181B" />
                </linearGradient>
                <linearGradient id={`${id}g`} x1="0" x2="1">
                    <stop offset="0" stopColor="#8A6A2A" />
                    <stop offset="0.45" stopColor="#F3D88C" />
                    <stop offset="1" stopColor="#7A5C22" />
                </linearGradient>
            </defs>
            {/* Nib: a pointed shield with a slit and a breather hole. */}
            <path d="M14 3c1.8 3.4 5.6 9.5 6 15.5H8C8.4 12.5 12.2 6.4 14 3Z" fill={`url(#${id}n)`} />
            <path d="M14 3c.5 1 1.1 2.1 1.6 3.3H12.4C12.9 5.1 13.5 4 14 3Z" fill={tint} />
            <path d="M14 6.5v6.2" stroke="#2A2A2E" strokeWidth="0.8" strokeLinecap="round" />
            <circle cx="14" cy="13.6" r="1.1" fill="#2A2A2E" />
            {/* Grip section and barrel. */}
            <path d="M7.5 18.5h13l.8 5H6.7Z" fill="#26262A" />
            <rect x="6.2" y="23.5" width="15.6" height="2" fill={`url(#${id}g)`} />
            <rect x="6.2" y="25.5" width="15.6" height="31" rx="1" fill={`url(#${id}b)`} />
            <rect x="9" y="27" width="1.4" height="28" rx="0.7" fill="#FFFFFF" fillOpacity="0.18" />
        </svg>
    );
}

export function DrawBrushIcon({ tint = "#1E1E1E", ...props }: ToolProps) {
    const id = useId();
    return (
        <svg viewBox="0 0 28 56" {...props}>
            <defs>
                <linearGradient id={`${id}h`} x1="0" x2="1">
                    <stop offset="0" stopColor="#5A3A22" />
                    <stop offset="0.4" stopColor="#C8925E" />
                    <stop offset="0.65" stopColor="#9C6B40" />
                    <stop offset="1" stopColor="#4A2F1B" />
                </linearGradient>
                <linearGradient id={`${id}f`} x1="0" x2="1">
                    <stop offset="0" stopColor="#7E7E86" />
                    <stop offset="0.45" stopColor="#F0F0F3" />
                    <stop offset="1" stopColor="#6E6E76" />
                </linearGradient>
                <linearGradient id={`${id}b`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor={tint} />
                    <stop offset="0.45" stopColor={tint} />
                    <stop offset="0.75" stopColor="#D9C7A6" />
                    <stop offset="1" stopColor="#B59C74" />
                </linearGradient>
            </defs>
            {/* Bristles: a soft flame dipped in paint. */}
            <path d="M14 2.5c2.2 3 5.6 7.5 5.6 12.5 0 2-.4 3.4-.9 4.5H9.3c-.5-1.1-.9-2.5-.9-4.5C8.4 10 11.8 5.5 14 2.5Z" fill={`url(#${id}b)`} />
            <path d="M12.2 8.5c-.8 2.2-1.2 5-.9 10.5" stroke="#000000" strokeOpacity="0.18" strokeWidth="0.7" fill="none" />
            <path d="M15.8 9c.7 2.4 1 5.3.7 10" stroke="#FFFFFF" strokeOpacity="0.2" strokeWidth="0.7" fill="none" />
            {/* Ferrule with crimps, then the wooden handle. */}
            <path d="M8.6 19.5h10.8l.8 9H7.8Z" fill={`url(#${id}f)`} />
            <path d="M8 24h12M7.9 26h12.2" stroke="#55555C" strokeWidth="0.6" />
            <path d="M7.8 28.5h12.4l-.8 28H8.6Z" fill={`url(#${id}h)`} />
            <rect x="10" y="30" width="1.3" height="25" rx="0.65" fill="#FFFFFF" fillOpacity="0.18" />
        </svg>
    );
}

export function DrawPencilIcon({ tint = "#1E1E1E", ...props }: ToolProps) {
    const id = useId();
    return (
        <svg viewBox="0 0 28 56" {...props}>
            <defs>
                <linearGradient id={`${id}w`} x1="0" x2="1">
                    <stop offset="0" stopColor="#B88D5E" />
                    <stop offset="0.5" stopColor="#F2D6AE" />
                    <stop offset="1" stopColor="#A57A4C" />
                </linearGradient>
            </defs>
            {/* Sharpened wood and the lead. */}
            <path d="M14 3 21 19H7Z" fill={`url(#${id}w)`} />
            <path d="M14 3 16.6 9H11.4Z" fill={tint} />
            <path d="M7 19c1.2-.9 2.3-.9 3.5 0s2.3.9 3.5 0 2.3-.9 3.5 0 2.3.9 3.5 0" fill="none" stroke="#9C7448" strokeWidth="0.6" />
            {/* A hexagonal body: three facets in light, mid and shade. */}
            <path d="M7 19.4h4.7v37.1H7Z" fill="#B9B9C0" />
            <path d="M11.7 19.4h4.6v37.1h-4.6Z" fill="#F2F2F5" />
            <path d="M16.3 19.4H21v37.1h-4.7Z" fill="#8E8E96" />
            <path d="M11.7 19.4v37.1M16.3 19.4v37.1" stroke="#000000" strokeOpacity="0.12" strokeWidth="0.5" />
        </svg>
    );
}

// Motion mode: a keyframe diamond inside a rounded square.
export function MotionModeIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <path d="M12.5 5 17.5 10 12.5 15 7.5 10z" />
            <path d="M2.5 8h3M2.5 12h3M4 10h2" />
        </svg>
    );
}

// The timeline's auto-keyframe toggle: a diamond with a dot in it.
export function AutoKeyIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <path d="M10 3.5 16.5 10 10 16.5 3.5 10z" />
            <circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none" />
        </svg>
    );
}

// Collapse or expand the timeline: a panel with its bottom bar.
export function TimelinePanelIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <rect x="3" y="4" width="14" height="12" rx="2" />
            <path d="M3 12h14" />
        </svg>
    );
}

// Playback modes: once (an arrow to a stop) and ping-pong (arrows both ways).
export function PlayOnceIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <path d="M3.5 10h10M10.5 6.5 14 10l-3.5 3.5M16.5 5.5v9" />
        </svg>
    );
}

export function PingPongIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <path d="M4 7.5h12M13 4.5l3 3-3 3M16 12.5H4M7 9.5l-3 3 3 3" />
        </svg>
    );
}

export function PauseIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <path d="M7 4.5v11M13 4.5v11" />
        </svg>
    );
}

export function PlayIcon(props: Props) {
    return (
        <svg {...base(props)}>
            <path d="M6 4.2v11.6a.5.5 0 0 0 .76.43l9.3-5.8a.5.5 0 0 0 0-.86l-9.3-5.8A.5.5 0 0 0 6 4.2z" />
        </svg>
    );
}
