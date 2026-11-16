// Opening files and folders in programs: the system's way (Finder / Explorer / xdg-open), or an "Open
// with" item from the panel's settings (herdr-enhanced.open-with, openwith.js), and which of those programs a
// machine has. In a space on another machine its terminal programs run there and the editors that open
// files over ssh run here (openwith.js remoteCommand); the system's way is for this computer only.
import { exec, run, shared, notify } from "herdr";
import { KEYS, settingsOf } from "./panelsettings.js";
import { itemsOf, detectScript, foundOf, commandFor, fits, menuItems, remoteMenuItems, remoteCommand } from "./openwith.js";
import { DETACH } from "./detach.js";
import { sh } from "./machine.js";
import { openSystem } from "./system.js";
import { asset } from "./id.js";

export const openSettings = () => settingsOf(KEYS.openWith, shared(KEYS.openWith));
// The person's items (or the default ones: Zed, Neovim, yazi, lazygit).
export const openItems = () => itemsOf(openSettings().items);

// Runs fn (it may return a promise): resolves true, or false after a notification titled `title` says
// what went wrong.
export function tryTo(title, fn) {
  const failed = e => { notify({ title, body: e instanceof Error ? e.message : String(e), level: "error" }); return false; };
  return Promise.resolve().then(fn).then(() => true, failed);
}

// Which programs a machine has (here: on null), as { cli: Set, app: Set }; empty when sh fails.
export async function detect(items, on = null) {
  const r = await sh(on, detectScript(items), [], { timeout: 15000 }).catch(() => null);
  return foundOf(r?.stdout);
}
// What a tree found: { here, there } (there: the space's machine; the same as here in a local space).
export async function detectFor(items, on) {
  const here = await detect(items, null);
  return { here, there: on ? await detect(items, on) : here };
}

// As plain arrays for an overlay's props, and back.
const plainSets = f => (f ? { cli: [...f.cli], app: [...f.app] } : null);
const sets = p => ({ cli: new Set(p?.cli ?? []), app: new Set(p?.app ?? []) });
export const foundProps = f => (f ? { here: plainSets(f.here), there: plainSets(f.there) } : null);
export const foundFrom = p => (p ? { here: sets(p.here), there: sets(p.there) } : null);

// `place`: { on, host } (host: the machine's ssh target, remote.js hostOf). The command an item runs for
// a target { path, dir, line?, folder, name }, or null when it can't run for this place.
function commandIn(item, found, target, place) {
  if (!found) return null;
  return place?.on ? remoteCommand(item, found, target, place.host) : commandFor(item, found.here, target);
}

// The menu's program items for a file (dir false) or folder.
export function programsFor(found, dir, place) {
  if (!found) return [];
  return place?.on ? remoteMenuItems(openItems(), found, dir, place.host) : menuItems(openItems(), found.here, dir);
}

// Runs an item for a target: an app item in the background (detach.js; in the target's folder here); a
// pane item in a terminal right of the focused pane (on the space's machine), in the target's folder,
// named after the target. Says why in a notification when it can't. Resolves whether it ran.
export function runItem(item, found, target, place) {
  const cmd = commandIn(item, found, target, place), title = `Cannot open in ${item.name}`;
  if (!cmd) return tryTo(title, () => { throw new Error(`${item.name} isn't available ${place?.on ? `for ${place.on}` : "here"}`); });
  if (cmd.kind === "pane") {
    run("terminal.open", { argv: cmd.argv, folder: target.folder, place: "right", name: target.name });
    return Promise.resolve(true);
  }
  return tryTo(title, async () => {
    const r = await exec("sh", ["-c", DETACH, "sh", ...cmd.argv], cmd.folder ? { cwd: cmd.folder } : {});
    if (r.code !== 0) throw new Error((r.stderr || "").trim().split("\n")[0] || `${cmd.argv[0]} exited with ${r.code}`);
  });
}

// The item a setting names ("system" or an item id) when it fits the target and can run for this
// place; else null.
export function chosen(choice, found, target, place) {
  if (!choice || choice === "system") return null;
  const item = openItems().find(i => i.id === choice);
  return item && item.enabled !== false && fits(item, target.dir) && commandIn(item, found, target, place) ? item : null;
}

// Opens a target the way a setting says (openSettings().double, .open or .line): its item, else the
// system's way here. On another machine there's no system way: resolves false when nothing could.
export function openBy(choice, found, target, place) {
  const item = chosen(choice, found, target, place);
  if (item) return runItem(item, found, target, place);
  if (place?.on) return Promise.resolve(false);
  return tryTo("Cannot open", () => openSystem(target.path));
}

// A menu icon for an item.
const ICONS = { zed: "square-pen", vscode: "square-pen", cursor: "square-pen", nvim: "file-text", vim: "file-text", yazi: "folder", lazygit: "git-branch", gitui: "git-branch", tig: "git-branch" };
export const iconOf = item => asset(`glyphs/${ICONS[item.id] ?? (item.kind === "app" ? "square-pen" : item.for === "folders" ? "folder" : item.for === "files" ? "file-text" : "terminal")}.svg`);
