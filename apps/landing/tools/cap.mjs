// Runs page code in the recorder's serve mode (record.cjs --serve 5319) and prints the result.
//   node apps/landing/tools/cap.mjs 'await page.ready(); return await page.rect("text=Drafts")'
//   node apps/landing/tools/cap.mjs @file.js        (the file's body is sent)
import { readFileSync } from "node:fs";
const arg = process.argv.slice(2).join(" ");
const body = arg.startsWith("@") ? readFileSync(arg.slice(1), "utf8") : arg;
const res = await fetch("http://127.0.0.1:5319/", { method: "POST", body });
const text = await res.text();
if (!res.ok) { console.error(text); process.exit(1); }
console.log(text);
