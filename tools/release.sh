#!/usr/bin/env bash
# Nagma: start a release. Sets the version in apps/web, apps/server and apps/desktop, commits that,
# tags it vX.Y.Z and prints the push command. It doesn't push: pushing the tag starts
# .github/workflows/release.yml, which builds the apps and publishes the GitHub Release.
#
#   bash tools/release.sh 0.2.0          # a release
#   bash tools/release.sh 0.3.0-beta.1   # a pre-release (anything with a hyphen)
#   bash tools/release.sh 0.2.0 --dry-run
#
# Guide: docs/releasing.md.

set -euo pipefail

usage() { echo "Usage: tools/release.sh <version> [--dry-run]   (version like 1.2.3 or 1.2.3-beta.1)"; }

VERSION=""
DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        -h|--help) usage; exit 0 ;;
        -*) echo "Unknown option: $arg" >&2; usage >&2; exit 2 ;;
        *) VERSION="${arg#v}" ;;
    esac
done
[ -n "$VERSION" ] || { usage >&2; exit 2; }
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    echo "error: \"$VERSION\" isn't a version like 1.2.3 or 1.2.3-beta.1" >&2
    exit 2
fi
TAG="v$VERSION"

cd "$(git rev-parse --show-toplevel)"
APPS=(apps/web apps/server apps/desktop)

[ -z "$(git status --porcelain)" ] || { echo "error: the working tree has changes; commit or stash them first." >&2; exit 1; }
! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "error: tag $TAG already exists." >&2; exit 1; }
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = main ] || echo "warning: releasing from $BRANCH, not main." >&2
bash tools/check-brand-names.sh

if [ "$DRY_RUN" = 1 ]; then
    for app in "${APPS[@]}"; do echo "would set $app/package.json version to $VERSION"; done
    echo "would commit \"Release $TAG\" and tag $TAG"
    exit 0
fi

# npm version updates package.json and the lock file's own entry, without its own commit or tag.
for app in "${APPS[@]}"; do
    (cd "$app" && npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null)
    git add "$app/package.json"
    [ -f "$app/package-lock.json" ] && git add "$app/package-lock.json"
done
git commit -q -m "Release $TAG"
git tag -a "$TAG" -m "Nagma $VERSION"

REMOTE="$(git remote | grep -x origin || git remote | head -n1 || true)"
echo "Committed \"Release $TAG\" and tagged $TAG. To publish it:"
echo
echo "  git push ${REMOTE:-origin} $BRANCH $TAG"
echo
echo "The Release workflow builds the installers and publishes the release (Actions tab)."
echo "To undo before pushing: git tag -d $TAG && git reset --hard HEAD~1"
