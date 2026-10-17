// `node --test apps/server/test/` runs this folder as one test file: it loads every *.test.mjs
// beside it, in name order. (`node --test 'apps/server/test/*.test.mjs'` runs them as separate files.)
import { readdirSync } from "node:fs";

const here = new URL("./", import.meta.url);
for (const name of readdirSync(here).filter((n) => n.endsWith(".test.mjs")).sort()) await import(new URL(name, here).href);
