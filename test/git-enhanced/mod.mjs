// Where the mod is: the one folder with a main.js under <entry>/mods/, where <entry> is this test
// folder's name (test/git-enhanced/ tests git-enhanced/mods/<mod>/). Tests import the mod's
// modules through mod(), so renaming the mod is its folder and its id.js, nothing here.
import { readdirSync, existsSync, realpathSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../..");
const mods = join(repo, basename(here), "mods");
const found = readdirSync(mods).filter((d) => existsSync(join(mods, d, "main.js")));
if (found.length !== 1) throw new Error(`expected one mod under ${mods}, found ${found.join(", ") || "none"}`);

export const NAME = found[0];
// The mod's folder, its real path (/tmp is /private/tmp on macOS; one URL per module).
export const MOD = realpathSync(join(mods, NAME));
export const REPO = repo;
// A module of the mod, e.g. await mod("hunk.js").
export const mod = (rel) => import(pathToFileURL(join(MOD, rel)).href);
