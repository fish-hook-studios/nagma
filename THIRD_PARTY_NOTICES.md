# Third-party notices

Nagma is licensed under the Mozilla Public License 2.0 (see `LICENSE`). It ships with the following
third-party work, each under its own licence. Licence texts are in the packages themselves (under
`node_modules` after install) or beside the files named below.

## Fonts (SIL Open Font License 1.1)

- Source Sans 3 and Source Serif 4: Copyright 2010-2024 Adobe, with Reserved Font Name "Source".
  `apps/web/public/fonts/`, licence in `OFL-SourceSans3.txt` and `OFL-SourceSerif4.txt`.

## Web app (`apps/web`)

| Package | Licence |
| --- | --- |
| react, react-dom | MIT |
| react-aria-components | Apache-2.0 |
| tailwindcss, @tailwindcss/vite | MIT |
| @untitledui/icons | MIT |
| fflate | MIT |
| fzstd | MIT |
| jspdf, svg2pdf.js | MIT |
| kiwi-schema | MIT |
| nanoid | MIT |
| sucrase | MIT |

## Sync server (`apps/server`)

| Package | Licence |
| --- | --- |
| ws | MIT |
| @node-saml/node-saml | MIT |
| @xmldom/xmldom | MIT |
| xpath | MIT |

## Desktop app (`apps/desktop`)

| Package | Licence |
| --- | --- |
| electron | MIT |
| electron-builder | MIT |
| electron-updater | MIT |

## Engines (`engines/`, prebuilt into `apps/web/src/engines/`)

The photo, PDF, layout, motion and video engines are Rust crates licensed MIT OR Apache-2.0. Their
sources are the git submodules under `engines/`; keep their LICENSE and NOTICE files when
redistributing.

## File formats

Importing `.fig`, `.deck`, `.buzz`, `.jam`, `.sketch`, `.pptx`, `.psd` and `.idml` files is done by
clean-room readers written from publicly documented or openly reverse-engineered formats, for
interoperability. The only tokens of a third-party format in the source are the container headers,
clipboard markers and image host kept in `apps/web/src/engine/interop-format.ts` and
`apps/server/interop-hosts.mjs`. No code, assets or icons of any other product are included.

## Development-only dependencies

Build and test tooling (Vite, TypeScript, Vitest, oxlint, jsdom and the rest in each
`package.json`'s `devDependencies`) is MIT or similarly licensed and is not shipped with the app.
