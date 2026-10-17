function initials(name: string) {
    return (
        name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase())
            .join("") || "?"
    );
}

function labelTextColor(hex: string): string {
    const n = parseInt(hex.replace("#", ""), 16);
    return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 186 ? "#1E1E1E" : "#FFFFFF";
}

// `single` shows just the first initial, as account avatars in the file browser and admin console do.
// `src` is the account's picture, when it has one (initials otherwise).
export function Avatar({ name, color, size = 24, ring, single, src }: { name: string; color: string; size?: number; ring?: boolean; single?: boolean; src?: string | null }) {
    if (src) return <img src={src} alt={name} title={name} width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size, boxShadow: ring ? `0 0 0 1.5px var(--color-panel), 0 0 0 3px ${color}` : undefined }} />;
    return (
        <span
            title={name}
            className={`flex shrink-0 items-center justify-center rounded-full ${single ? "font-medium" : "font-semibold"}`}
            // Initials on the user's colour; in a stack, a thin gap then a ring in the same colour, like the reference's avatars.
            style={{ background: color, color: labelTextColor(color), width: size, height: size, fontSize: size * (single ? 0.54 : 0.42), boxShadow: ring ? `0 0 0 1.5px var(--color-panel), 0 0 0 3px ${color}` : undefined }}
        >
            {single ? initials(name).slice(0, 1) : initials(name)}
        </span>
    );
}

