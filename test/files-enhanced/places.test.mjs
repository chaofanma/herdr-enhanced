// The tree's everyday parts: places remembered, the header's buttons, the background's menu, drops,
// keys that open dialogs or programs, pins and the folder above.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { state, makeCx, settle, load, folder, at, draw, byId, allById, press, text } from "./render/load.mjs";
import { NAME } from "./mod.mjs";

const { default: Files } = await load("main.js");

async function open(dir) {
  at(dir);
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle();
  return { view, tree: view.role, root: () => draw(view) };
}
const shownRows = root => allById(root, /^file-/).map(n => n.$.id.slice(5));
const keyDown = (root, keystroke) => press(byId(root, "files-tree"), "on_key_down", { key: keystroke.split("-").pop(), keystroke, modifiers: {} });

test("a place keeps its open folders, preview and selection for when it shows again", async () => {
  state.shared.clear();
  const one = folder(["src/a.js", "b.txt"]), two = folder(["c.txt"]);
  const { tree, root } = await open(one);
  press(byId(root(), "file-src")); await settle();
  press(byId(root(), "file-src/a.js")); await settle();
  at(two); root(); await settle(); root();
  assert.equal(tree.root, two);
  assert.deepEqual(shownRows(root()), ["c.txt"]);
  assert.equal(tree.preview.file, null);
  at(one); root(); await settle(); root(); await settle();
  assert.deepEqual(shownRows(root()), ["src", "src/a.js", "b.txt"]);
  assert.equal(tree.preview.file, "src/a.js"); assert.equal(tree.sel, "src/a.js");
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});

test("the header: new file, new folder, collapse all, the folder's menu; the background's menu", async () => {
  state.shared.clear(); state.overlays.length = 0;
  const dir = folder(["src/a.js", "lib/b.js"]);
  const { tree, root } = await open(dir);
  press(byId(root(), "fm-newfile"));
  assert.deepEqual([state.overlays.at(-1).mod, state.overlays.at(-1).kind, state.overlays.at(-1).props.role, state.overlays.at(-1).props.action], [NAME, "dialog", "dialog", "newfile"]);
  press(byId(root(), "fm-newfolder"));
  assert.equal(state.overlays.at(-1).props.action, "newfolder");
  press(byId(root(), "file-src")); await settle(); press(byId(root(), "file-lib")); await settle();
  assert.equal(shownRows(root()).length, 4);
  press(byId(root(), "fm-collapse"));
  assert.deepEqual(shownRows(root()), ["lib", "src"]);
  assert.equal(text(byId(root(), "fm-more")), "⋯");
  press(byId(root(), "fm-more"));
  assert.deepEqual([state.overlays.at(-1).props.role, state.overlays.at(-1).props.background, state.overlays.at(-1).props.rel], ["menu", true, ""]);
  press(byId(root(), "files-tree"), "on_mouse_down", { button: "right", modifiers: {} });
  assert.equal(state.overlays.at(-1).props.background, true);
  const { items } = await load("menu.js");
  const labels = items(state.overlays.at(-1).props).map(x => x?.label ?? null);
  assert.ok(labels.includes("New file…") && !labels.includes("Rename…") && !labels.includes("Delete"), labels.join());
  assert.equal(tree.root, dir);
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});

test("drops from Finder: copied in with Finder's names, the first selected", async () => {
  state.shared.clear();
  const dir = folder(["docs/a.txt"]), outside = folder(["a.txt", "pics/p.png"]);
  const { tree, root } = await open(dir);
  press(byId(root(), "file-docs"), "on_drop", { paths: [join(outside, "a.txt"), join(outside, "pics")] });
  await settle(); root(); await settle(); root();
  assert.deepEqual(readdirSync(join(dir, "docs")).sort(), ["a 2.txt", "a.txt", "pics"]);
  assert.equal(tree.sel, "docs/a 2.txt");
  press(byId(root(), "files-tree"), "on_drop", { paths: [join(outside, "a.txt")] });
  await settle();
  assert.ok(readdirSync(dir).includes("a.txt"), "on the background: into the root");
});

test("keys: F2 renames, Shift+Enter opens in its program, → and ← open and close", async () => {
  state.shared.clear(); state.overlays.length = 0; state.execLog.length = 0;
  const dir = folder(["src/a.js", "b.txt"]);
  const { tree, root } = await open(dir);
  keyDown(root(), "down");
  assert.equal(tree.sel, "src");
  keyDown(root(), "right"); await settle();
  assert.ok(tree.folders.has("src"));
  keyDown(root(), "down"); await settle();
  assert.equal(tree.sel, "src/a.js"); assert.equal(tree.preview.file, "src/a.js");
  keyDown(root(), "f2");
  assert.deepEqual([state.overlays.at(-1).props.action, state.overlays.at(-1).props.rel], ["rename", "src/a.js"]);
  keyDown(root(), "shift-enter"); await settle();
  assert.deepEqual(state.execLog.at(-1).slice(0, 2), ["open", [`${dir}/src/a.js`]], "the system's way (not run in tests)");
  keyDown(root(), "left");
  assert.equal(tree.sel, "src");
  keyDown(root(), "left");
  assert.equal(tree.folders.has("src"), false);
  keyDown(root(), "escape");
  assert.equal(tree.preview.file, null);
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});

test("pins: the pin holds the folder, ‹ pins the folder above with this one open, a gone pin unpins", async () => {
  state.shared.clear();
  const top = folder(["proj/src/a.js", "other.txt"]), proj = join(top, "proj"), elsewhere = folder(["x.txt"]);
  const { tree, root } = await open(proj);
  press(byId(root(), "fm-pin-off"));
  assert.deepEqual(state.shared.get(`${NAME}.pins`), { s1: { path: proj, on: null } });
  at(elsewhere); root(); await settle(); root();
  assert.equal(tree.root, proj, "pinned: the terminal moved, the tree didn't");
  press(byId(root(), "fm-up")); root(); await settle(); root(); await settle();
  assert.equal(tree.root, top);
  assert.ok(tree.folders.has("proj"), "the folder it came from is open");
  assert.deepEqual(shownRows(root()), ["proj/src", "other.txt"], "(proj holds only src: one compact row)");
  assert.ok(state.shared.get(`${NAME}.recent`).some(x => x.path === proj), "recent roots");
  rmSync(top, { recursive: true });
  tree.refresh(makeCx()); await settle(); root(); await settle();
  assert.equal(state.shared.get(`${NAME}.pins`).s1, undefined, "gone: unpinned");
  root(); await settle(); root();
  assert.equal(tree.root, elsewhere);
  assert.match(text(root()), /Unpinned .* it no longer exists/);
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});
