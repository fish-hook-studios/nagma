#!/usr/bin/env bash
# Fails when a tracked file names the design suite whose files Nagma imports, or its products,
# outside the two interop modules that hold that format's protocol tokens. Same list as
# apps/web/src/no-brand-names.test.ts. The patterns use a character class (f[i]...) so this
# script doesn't match itself.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

EXCLUDE=(
    ':!apps/web/src/engine/interop-format.ts'
    ':!apps/server/interop-hosts.mjs'
    ':!*package-lock.json' ':!*pnpm-lock.yaml' ':!*yarn.lock' ':!*.wasm'
)

status=0
report() { if [ -n "$1" ]; then echo "$1"; status=1; fi; }

# Case-insensitive names and tokens.
report "$(git grep -nIiE 'f[i]gma|f[i]g-?jam|f[i]g-(kiwi|deck|buzz)|s[m]art animate|c[o]operTemplate' -- . "${EXCLUDE[@]}" || true)"
# The inspect mode's name (title case only; lowercase use for development builds is fine).
report "$(git grep -nIE 'D[e]v Mode' -- . "${EXCLUDE[@]}" || true)"
# The campaign product's name; `.buzz` and `|buzz` (the file extension) and the desktop app's
# file association line in apps/desktop/package.json are allowed.
report "$(git grep -nIiE '(^|[^.|[:alnum:]_])b[u]zz([^[:alnum:]_]|$)' -- . "${EXCLUDE[@]}" | grep -vE '"ext": "b[u]zz"' || true)"

if [ "$status" -ne 0 ]; then echo "check-brand-names: brand names found (see above)." >&2; fi
exit "$status"
