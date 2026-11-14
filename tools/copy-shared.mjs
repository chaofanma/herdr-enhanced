#!/usr/bin/env node
// Copies the panel's shared modules (every shared/*.js: the settings and Open with logic, the tab
// header, the settings window and its controls, …) unchanged into every mod of this repository (each
// <entry>/mods/<mod>/ with a main.js, but the layout entry's tab bar, a copy of Herdr's that uses none
// of them): a mod can't import from another mod's folder. A shared module
// may import the other shared modules and its mod's ./id.js (ID, PART: each mod has its own). Change
// them in shared/ only, then run this; tools/check-shared.sh checks the copies.
//   node tools/copy-shared.mjs
import { readdirSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const shared = join(repo, "shared");
const modules = readdirSync(shared).filter(f => f.endsWith(".js")).sort();
const without = new Set([join("herdr-enhanced", "mods", "tabs-enhanced")]);
const mods = readdirSync(repo, { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(join(repo, e.name, "mods")))
  .flatMap(e => readdirSync(join(repo, e.name, "mods")).filter(m => existsSync(join(repo, e.name, "mods", m, "main.js"))).map(m => join(e.name, "mods", m)))
  .filter(m => !without.has(m));
if (!mods.length) { console.error("no mods found"); process.exit(1); }
for (const m of mods) {
  for (const f of modules) copyFileSync(join(shared, f), join(repo, m, f));
  console.log(`${m}/: ${modules.join(", ")}`);
}
