#!/usr/bin/env bash
# Renames the product Migfa -> Nagma across the repo: file and folder names, then every text file
# (Migfa -> Nagma, migfa -> nagma, MIGFA -> NAGMA, which also covers MigfaDocument, data-migfa-*,
# MIGFA_* env vars, migfa:// and the rest). Safe to run again: a second run finds nothing to do.
#
#   tools/rename-nagma.sh [repo root]       (default: the git repo you're in)
#
# What it leaves alone, on purpose (the backward-compatibility readers and things outside the repo's
# control), so that `git grep -i migfa` afterwards lists only these:
#   - the files in PROTECTED below: they hold the old names so data, links and settings saved under
#     the old name keep working (storage keys, the desktop's old userData folder and migfa:// links,
#     MIGFA_* env vars, old access-token prefixes, clipboard formats, ...);
#   - any line containing the marker "legacy-name";
#   - the wasm import namespaces baked into the prebuilt engine binaries ("./migfa_<x>_bg.js" and the
#     pdf engine's snippet key in the JS glue): the binaries import from those names, and there's no
#     Rust toolchain here to rebuild them. Rebuilding with the renamed crates regenerates both sides;
#   - the GitHub repository URL (github.com/Ashhhwath/migfa) until the repository itself is renamed;
#   - fly.toml's app name and volume (renaming them would point deploys at a new, empty app/volume);
#   - binary files' contents (wasm, images): only their file names change.
# After the text pass it makes sure the desktop app still registers the legacy migfa:// scheme
# (apps/desktop/package.json, build.protocols) beside nagma://.
set -euo pipefail

ROOT="${1:-$(git rev-parse --show-toplevel)}"
cd "$ROOT"

OLD=migfa
NEW=nagma

PROTECTED=(
    tools/rename-nagma.sh
    apps/web/src/engine/legacy-names.ts
    apps/web/src/engine/legacy-names.test.ts
    apps/server/legacy-names.mjs
    apps/server/test/legacy-names.test.mjs
    apps/desktop/legacy.cjs
    apps/desktop/test/legacy.test.mjs
    apps/mcp/src/legacy-env.mjs
    apps/vscode-extension/src/legacy.js
)
is_protected() {
    local p
    for p in "${PROTECTED[@]}"; do [[ "$1" == "$p" ]] && return 0; done
    return 1
}

# ---- 1. File and folder names ------------------------------------------------------------------
renamed=0
while IFS= read -r f; do
    is_protected "$f" && continue
    [[ -e "$f" ]] || continue
    to=$(printf '%s' "$f" | sed -e "s/$OLD/$NEW/g" -e 's/Migfa/Nagma/g' -e 's/MIGFA/NAGMA/g')
    [[ "$to" == "$f" ]] && continue
    if [[ -e "$to" ]]; then
        echo "skip rename (target exists): $f -> $to" >&2
        continue
    fi
    mkdir -p "$(dirname "$to")"
    git mv "$f" "$to"
    renamed=$((renamed + 1))
    # Drop folders the move left empty.
    d=$(dirname "$f")
    while [[ "$d" != "." && -d "$d" && -z "$(ls -A "$d")" ]]; do rmdir "$d"; d=$(dirname "$d"); done
done < <(git ls-files | grep -i "$OLD" || true)
echo "renamed files: $renamed"

# ---- 2. Text ------------------------------------------------------------------------------------
excludes=()
for p in "${PROTECTED[@]}"; do excludes+=(":(exclude)$p"); done
files=()
while IFS= read -r f; do files+=("$f"); done < <(git grep -I -l -i "$OLD" -- . "${excludes[@]}" || true)
if ((${#files[@]})); then
    # Placeholders keep the things listed above; every other spelling of the name changes.
    perl -pi -e '
        next if /legacy-name/;
        s{(\./migfa_\w+_bg\.js)}{"\x{1}" . unpack("H*", $1) . "\x{2}"}ge;
        s{"(\./snippets/migfa-[\w-]+/inline\d+\.js)"(?=:\s*import\d)}{"\"\x{1}" . unpack("H*", $1) . "\x{2}\""}ge;
        s{(github\.com/Ashhhwath/migfa)}{"\x{1}" . unpack("H*", $1) . "\x{2}"}ge;
        if ($ARGV eq "fly.toml") { s{^(app = "migfa"|\s*source = "migfa_data")}{"\x{1}" . unpack("H*", $1) . "\x{2}"}e; }
        if ($ARGV eq "apps/desktop/package.json") { s{^(\s*"migfa"\s*)$}{"\x{1}" . unpack("H*", $1) . "\x{2}"}e; }
        s/MIGFA/NAGMA/g; s/Migfa/Nagma/g; s/migfa/nagma/g; s/MigFa/NagMa/g; s/MIGfa/NAGma/g;
        s{\x{1}([0-9a-f]+)\x{2}}{pack("H*", $1)}ge;
    ' "${files[@]}"
fi
echo "text files touched: ${#files[@]}"

# ---- 3. Legacy registrations that live in JSON (no comments there for the marker) ----------------
if [[ -f apps/desktop/package.json ]]; then
    node -e '
        const fs = require("fs");
        const file = "apps/desktop/package.json";
        const text = fs.readFileSync(file, "utf8");
        const pkg = JSON.parse(text);
        const protocols = pkg.build?.protocols;
        if (Array.isArray(protocols) && protocols[0]) {
            const schemes = protocols[0].schemes ?? [];
            const want = ["nagma", "mig" + "fa"];
            if (want.some((s) => !schemes.includes(s))) {
                protocols[0].schemes = [...new Set([...want, ...schemes])];
                fs.writeFileSync(file, JSON.stringify(pkg, null, 4) + "\n");
                console.log("desktop protocols:", protocols[0].schemes.join(", "));
            }
        }
    '
fi

# ---- 4. What is left -----------------------------------------------------------------------------
echo "--- remaining mentions (should be the backward-compatibility readers only):"
git grep -I -n -i "$OLD" -- . ':(exclude)tools/rename-nagma.sh' | cut -c1-200 || true
echo "--- binary files still carrying the old name inside (expected: the prebuilt wasm engines):"
git grep -l -i "$OLD" -- . | while IFS= read -r f; do git grep -I -q -i "$OLD" -- "$f" || echo "$f"; done
