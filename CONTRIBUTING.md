# Contributing to Nagma

Thanks for helping. Nagma is an open-source, self-hostable design suite under the Mozilla Public License 2.0. This page covers setting up, testing, and the few rules every change has to follow.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go to the address in [SECURITY.md](SECURITY.md), not to public issues.

## Setting up

You need Node.js 22 and npm. Docker is only needed to try the self-hosted stack.

| Part | Folder | Start it |
|---|---|---|
| Editor (React 19, TypeScript, Vite) | `apps/web` | `cd apps/web && npm install && npm run dev -- --host` (http://localhost:5173) |
| Sync server (Node, no framework) | `apps/server` | `cd apps/server && npm install && npm run dev` |
| Desktop app (Electron) | `apps/desktop` | `cd apps/desktop && npm install && npm start` (builds the editor first) |
| MCP server | `apps/mcp` | see its `package.json` |
| VS Code extension | `apps/vscode-extension` | see its `package.json` |
| Self-hosting | `Dockerfile`, `docker-compose.yml`, `tools/install.sh` | [docs/self-hosting.md](docs/self-hosting.md) |

The WebAssembly engines in `apps/web/src/engines` are built from `engines/` and committed, so you don't need Rust unless you change an engine (see the Engines section of the README).

## Tests and checks

Run what your change touches before opening a pull request. CI (`.github/workflows/ci.yml`) runs all of it on every pull request to `main`.

```bash
# Editor
cd apps/web
npx tsc --noEmit -p tsconfig.app.json
npx tsc --noEmit -p tsconfig.test.json
npx oxlint src
npx vitest run

# Server and desktop (from the repository root)
node --test apps/server/test/
node --test apps/desktop/test/

# The brand-name guard (must pass)
bash tools/check-brand-names.sh
```

CI also builds the Docker image, starts the compose stack, waits for `/health` and signs up an account through the API. If you change the Dockerfile, `docker-compose.yml` or the scripts in `tools/`, try `docker compose up --build` and `bash tools/install.sh --dry-run` locally.

New behaviour comes with a test: vitest beside the code in `apps/web/src`, `node:test` files in `apps/server/test` and `apps/desktop/test`.

## Commits and pull requests

- One logical change per commit. The subject line says what changed in plain words, as a sentence fragment without a type prefix, for example `Desktop: updates from GitHub Releases, with a download link for unsigned Mac builds`. Add a body when the why isn't obvious.
- Sign off every commit (`git commit -s`). The `Signed-off-by:` line certifies the [Developer Certificate of Origin 1.1](https://developercertificate.org): that you wrote the change, or otherwise have the right to submit it under the project's licence.
- Keep pull requests focused, fill in the template, and say how you tested. User-facing changes update the README or the docs in the same pull request.
- Write in plain, concrete English in code comments, docs and the interface: say what a thing does, not how great it is.

## Two rules that keep Nagma clean

### No other products' names

Nagma imports other tools' files, but it never names the design suite whose files it reads, or its products, anywhere in the tracked files: code, comments, docs, tests, commit-visible strings. Refer to "the design file format", "the import", or the file extension (`.fig`, `.deck`). The only exceptions are the two interop modules that hold that format's protocol tokens (`apps/web/src/engine/interop-format.ts`, `apps/server/interop-hosts.mjs`).

`tools/check-brand-names.sh` (and `apps/web/src/no-brand-names.test.ts`) enforce this; CI fails when either finds a name.

### Clean-room format readers

Readers and writers for other tools' formats (`.fig`, `.deck`, `.sketch`, `.pptx`, `.psd`, `.idml` and the rest) are written for interoperability from public documentation and from inspecting files you are entitled to use. Never copy code, assets, icons, fonts, schemas or screenshots from another design product, or from a project whose licence doesn't allow it, and don't contribute anything you learned under an NDA or by breaking a licence's terms. If you aren't sure whether something counts, ask in the pull request before writing it.

Third-party code and assets that Nagma does ship are listed with their licences in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); add any new one there.

## Releases

Maintainers release with `tools/release.sh`; see [docs/releasing.md](docs/releasing.md).
