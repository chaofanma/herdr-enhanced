#!/usr/bin/env node
// The herdr-enhanced/ gallery entry, one install for both mods: Herdr's own layout ("main") with its
// own tab bar (herdr-enhanced/mods/tabs-enhanced: Herdr's with a History button, the entry's own, not
// made here) and Files Enhanced and Git Enhanced as its panel's pages (Files, Changes, History),
// and its preview (herdr-enhanced/layouts/herdr-enhanced.json and .svg, written by hand), and the
// mods it needs, copied here from their own entries
// (files-enhanced/mods/files-enhanced/, git-enhanced/mods/git-enhanced/). Change the mods in
// their own entries only, then run this; tools/check-copies.sh checks the copies.
//   node tools/make-entry.mjs
import { cpSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
export const COPIES = [["files-enhanced/mods/files-enhanced", "herdr-enhanced/mods/files-enhanced"], ["git-enhanced/mods/git-enhanced", "herdr-enhanced/mods/git-enhanced"]];

for (const [from, to] of COPIES) {
  if (!existsSync(join(repo, from, "main.js"))) { console.error(`no mod in ${from}`); process.exit(1); }
  rmSync(join(repo, to), { recursive: true, force: true });
  cpSync(join(repo, from), join(repo, to), { recursive: true });
  console.log(`${to}/ from ${from}/`);
}
