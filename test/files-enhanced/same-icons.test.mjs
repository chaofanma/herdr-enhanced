// One meaning, one icon, the same in Files Enhanced as on the Changes and History pages and in
// Herdr's own tab bar: each test here is one of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, load, settle, makeCx, folder, at, draw, byId, walk } from "./render/load.mjs";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { items } = await load("menu.js");
const caps = { shell: true, zip: true, trash: "finder", write: true, os: "macos" };
const file = { root: "/r", on: null, rel: "src/a.js", dir: false, found: null, caps, links: true, repo: { root: "/r", path: "src/a.js" }, mark: "M" };
const iconOf = (p, label) => items(p).find((x) => x?.label === label)?.icon;
const GLYPHS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "files-enhanced", "mods", "files-enhanced", "glyphs");

test("History: File history and Folder history have the clock, as History's button on the tab bar and its tab", () => {
  const clock = "mods/workspace-chrome/clock.svg";
  assert.equal(iconOf(file, "File history"), clock);
  assert.equal(iconOf({ ...file, rel: "src", dir: true, repo: { root: "/r", path: "src" } }, "Folder history"), clock);
});

// Files' header drawn on a folder: its root.
async function header() {
  const { default: Files } = await load("main.js");
  state.shared.clear(); state.overlays.length = 0; state.violations.length = 0; state.props = {};
  at(folder(["a.txt"]));
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle();
  return draw(view);
}
const svgOf = (n) => [...walk(n)].find((x) => x.$.kind === "svg")?.$.path;

test("Changes: the Changed files button and Show changes have Herdr's changes icon, as the tab bar's Changes button", async () => {
  const changes = "mods/changes/changes.svg";
  assert.equal(iconOf(file, "Show changes"), changes);
  assert.equal(svgOf(byId(await header(), "fm-changes-off")), changes);
});

test("The file clipboard and Delete: each has an icon of its own; x stays a close (as in Herdr's menus), and layers isn't a copy", async () => {
  const { setClipboard } = await load("clipboard.js");
  state.shared.clear();
  setClipboard("copy", ["/r/b.txt"], null);
  const want = { "Cut": "scissors", "Copy": "copy", "Paste": "clipboard-paste", "Duplicate": "copy-plus", "Copy path": "copy", "Copy relative path": "copy", "Copy name": "copy", "Delete": "trash" };
  for (const [label, icon] of Object.entries(want)) assert.equal(iconOf(file, label), icon, label);
  const several = { ...file, batch: [{ rel: "src/a.js", dir: false }, { rel: "src/b.js", dir: false }] };
  for (const [label, icon] of Object.entries({ "Cut": "scissors", "Copy": "copy", "Copy paths": "copy", "Delete 2 items…": "trash" })) assert.equal(iconOf(several, label), icon, `several: ${label}`);
  assert.equal(iconOf({ ...file, caps: { ...caps, trash: null }, on: "box" }, "Delete permanently"), "trash");
  const used = [file, several, { ...file, rel: "src", dir: true }, { ...file, rel: "", background: true }].flatMap((p) => items(p)).filter(Boolean).map((x) => x.icon);
  assert.deepEqual(used.filter((i) => i === "x" || i === "layers"), [], "x or layers in a menu");
  for (const icon of new Set(used.filter((i) => !i.includes("/")))) assert.ok(existsSync(join(GLYPHS, `${icon}.svg`)), `glyphs/${icon}.svg`);
  state.shared.clear();
});
