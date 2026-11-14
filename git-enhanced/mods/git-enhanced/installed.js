// Which of the panel's two mods are installed. Each works alone; what links one to the other (the
// settings window's sections, the menus' cross links) shows only when the other is there: a folder
// with a main.js in Herdr's mods folder, by the other's own name. Checked with fs.exists and kept
// (for this mod's copies); a copy checks again when it opens the settings window, and on its own
// timer. This mod is always installed, whatever its folder is called (`PART` in id.js says which of
// the two it is). Shared: the same file in both mods (shared/, tools/copy-shared.mjs).
import * as fs from "fs/promises";
import { appHome } from "herdr";
import { PART } from "./id.js";

/** The two mods by part, as their folders are named. */
export const MODS = { files: "files-enhanced", changes: "git-enhanced" };

const seen = new Map();   // part -> whether its folder was there at the last check

/** Whether `part` ("files" or "changes") is installed, as the last check found; this mod always is. */
export const installed = (part) => part === PART || seen.get(part) === true;

/** Looks again; resolves with whether anything changed since the last look. Never from a render
 *  before an await: call it from init, a timer or a click. */
export async function checkInstalled() {
  let changed = false;
  for (const [part, id] of Object.entries(MODS)) {
    if (part === PART) continue;
    const now = await fs.exists(`${appHome()}/mods/${id}/main.js`).catch(() => false);
    if (seen.get(part) !== now) { seen.set(part, now); changed = true; }
  }
  return changed;
}
