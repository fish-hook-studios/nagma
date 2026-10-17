# Releasing Nagma

A release is a git tag `vX.Y.Z`. Pushing it starts `.github/workflows/release.yml`, which builds the desktop app for macOS, Windows and Linux and publishes a GitHub Release with the installers and the update files the installed apps read.

## Cutting a release

```bash
git switch main && git pull
bash tools/release.sh 0.2.0            # or 0.3.0-beta.1 for a pre-release
# prints the push command, for example:
git push origin main v0.2.0
```

`tools/release.sh` checks that the working tree is clean, the tag is new and the brand-name guard passes; sets the version in `apps/web`, `apps/server` and `apps/desktop` (`package.json` and the lock file); commits `Release vX.Y.Z`; and makes an annotated tag. It never pushes. `--dry-run` shows what it would do. To undo before pushing: `git tag -d vX.Y.Z && git reset --hard HEAD~1`.

A version with a hyphen (`v0.3.0-beta.1`) becomes a GitHub pre-release: only desktop apps with Preferences › Get Beta Updates switched on update to it, and `releases/latest` keeps pointing at the newest full release.

Without a tag, a maintainer can also start the workflow from **Actions › Release › Run workflow** with a version. GitHub creates the tag `v<version>` at the chosen branch's commit when the release is published. Tick **dry run** to build the installers without publishing anything (they are kept as workflow artifacts for a week), which is the way to try a signing setup.

## What the workflow does

1. **Version**: reads the version from the tag (or the input), checks it looks like `1.2.3` or `1.2.3-beta.1`, and decides whether it is a pre-release.
2. **Web app**: builds `apps/web` once and hands `dist/` to the desktop jobs.
3. **Desktop**, one job per system, in parallel:
   - macOS (`macos-latest`): `.dmg` and `.zip` for Apple silicon (arm64) and Intel (x64)
   - Windows (`windows-latest`): one NSIS installer for x64 and arm64, and a portable x64 `.exe`
   - Linux (`ubuntu-latest`): `.AppImage` and `.deb` for x64

   Each job writes the version into `apps/desktop/package.json` and `apps/server/package.json` for that build only (nothing is committed), passes on whichever signing secrets exist, and runs electron-builder with `--publish never`. The targets live in `apps/desktop/package.json` (`build.mac`, `build.win`, `build.linux`); signing and the update feed in `apps/desktop/electron-builder.config.cjs`.
4. **GitHub Release**: one release for the tag (not a draft), with generated release notes, the installers, their `.blockmap` files and electron-updater's `latest*.yml` / `beta*.yml` / `alpha*.yml`.

## Updates

Installed desktop apps check the newest GitHub Release of `fish-hook-studios/nagma` (electron-updater's GitHub provider) at launch and every six hours, download the update in the background and offer Restart to Update. `apps/desktop/update-feed.cjs` decides the feed:

- `NAGMA_UPDATE_URL` (when building: the build remembers it in `build-flags.json`; or when running) or Preferences › Update Feed points the app at a folder of your own instead (electron-updater's generic provider). Building with `NAGMA_UPDATE_URL` set writes the update files for that folder; upload them with the installers.
- `NAGMA_NO_UPDATES=1` when building makes a build that never updates itself (for custom or managed builds); at run time it switches updates off too.

macOS installs updates only into signed builds. An unsigned Mac build doesn't download: it says "Nagma X is available" and its Download button and menu item open the release page. Windows and Linux builds update themselves signed or not (Windows SmartScreen may warn about an unsigned installer).

The GitHub provider needs the repository to be public: while it is private, update checks fail quietly (the menu's Check for Updates… says it couldn't check).

## Signing secrets

Add these under **Settings › Secrets and variables › Actions** (repository or organisation secrets). Each is optional: a build whose secrets are missing is simply unsigned. Never commit certificates or passwords.

| Secret | Used for |
|---|---|
| `CSC_LINK` | macOS: the Developer ID Application certificate, as a base64-encoded `.p12` |
| `CSC_KEY_PASSWORD` | macOS: that certificate's password |
| `APPLE_ID` | macOS notarisation: the Apple ID of the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS notarisation: an app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | macOS notarisation: the team ID |
| `WIN_CSC_LINK` | Windows: the code-signing certificate, as a base64-encoded `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | Windows: that certificate's password |

Notarisation runs only when all three `APPLE_*` secrets are set and the build is signed. The Apple certificate is passed only to the macOS job. `GITHUB_TOKEN` is provided by Actions; the publish job asks for `contents: write`.

To make the base64 value: `base64 -i certificate.p12 | pbcopy` on macOS, or `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))` in PowerShell.

## Repository settings

- **Actions** enabled, with **Settings › Actions › General › Workflow permissions** allowing the workflow's `contents: write` request (the default "read" setting is fine: the publish job asks for write itself, unless an organisation policy forbids it).
- A **branch protection rule** (or ruleset) for `main` requiring the CI checks, and a **tag rule** limiting who can create `v*` tags, since a tag publishes a release.
- The `@fish-hook-studios/maintainers` team named in `.github/CODEOWNERS`.
- **Private vulnerability reporting** (Settings › Code security) for SECURITY.md, and **Discussions** if you want questions out of the issue tracker.

## After a release

- Check the release page: every platform's files, and `latest.yml`, `latest-mac.yml`, `latest-linux.yml`.
- Self-hosted servers update with `git pull && docker compose up -d --build` (docs/self-hosting.md); the server's `/health` reports the new version.
- If a release is broken, mark it as a pre-release or delete it on GitHub: installed apps then see the previous release as the newest. Then fix and release a new patch version; never reuse a version number.
