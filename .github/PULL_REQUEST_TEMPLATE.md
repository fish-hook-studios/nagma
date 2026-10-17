## What this changes

<!-- What the change does and why. Link the issue it closes: "Closes #123". -->

## How it was tested

<!-- The commands you ran and what you tried by hand (browser, desktop app, self-hosted stack). -->

## Checklist

- [ ] Tests added or updated for new behaviour
- [ ] `npx tsc --noEmit -p tsconfig.app.json`, `npx oxlint src` and `npx vitest run` pass in `apps/web` (if touched)
- [ ] `node --test apps/server/test/` and `node --test apps/desktop/test/` pass (if touched)
- [ ] `bash tools/check-brand-names.sh` passes: no other products' names
- [ ] Format readers and assets are clean-room: nothing copied from another design product (CONTRIBUTING.md)
- [ ] README or docs updated for user-facing changes
- [ ] Commits are signed off (`git commit -s`)
