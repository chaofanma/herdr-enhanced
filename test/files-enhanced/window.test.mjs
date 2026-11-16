// Files Enhanced in a window of its own (mod.open files-enhanced, cmd-alt-f in keys.json): a copy
// whose props are only { overlay } draws the tree, without its card, under a slim bar ("Files", ✕;
// no gear: the tree's own is the only one); the bar's controls and the tree stop their presses (else Herdr drags the window); ✕
// closes it. Menus and dialogs still go by their role.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, makeCx, settle, load, folder, at, draw, byId, press, walk } from "./render/load.mjs";

const { default: Files } = await load("main.js");
const { FilesWindow, isWindow } = await load("window.js");
const { Tree } = await load("tree.js");
const { Menu } = await load("menu.js");
const { Dialog } = await load("dialog.js");
const { SettingsWindow } = await load("settingsview.js");

async function open(dir, props) {
  at(dir); state.props = props;
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle();
  return { view, root: () => draw(view) };
}
const calls = (node, name) => node.$.calls.filter(([m]) => m === name);

test("a copy with only { overlay }: the tree without its card under the window's bar; one gear, the tree's; ✕", async () => {
  state.shared.clear(); state.violations.length = 0; state.overlays.length = 0; state.closed.length = 0;
  const dir = folder(["a.txt", "src/b.txt"]);
  const { view, root } = await open(dir, { overlay: "w2" });
  assert.ok(view.role instanceof FilesWindow);
  let tree = root();
  assert.ok(byId(tree, "fm-window-bar"));
  const files = byId(tree, "files");
  assert.ok(files, "the tree");
  assert.equal(calls(files, "border_1").length + calls(files, "rounded").length, 0, "no card: the window has a frame");
  assert.ok(byId(tree, "file-a.txt") && byId(tree, "file-src"), "the folder's rows");
  assert.equal(view.role.tree.offscreen(), false, "a window is on screen whatever the layout shows");
  for (const id of ["fm-window-close", "fm-window-body"]) {
    const cx = makeCx();
    for (const args of byId(tree, id).$.handlers.on_mouse_down) args.at(-1)({}, cx);
    assert.equal(cx.stopped, true, `${id} stops its press`);
  }
  assert.equal(byId(tree, "fm-window-bar").$.handlers.on_mouse_down, undefined, "the bar itself drags the window");
  // One gear in the window: the tree's own (the bar has none).
  assert.equal(byId(tree, "fm-window-settings"), null, "the bar has no gear");
  assert.equal([...walk(tree)].filter((n) => n.$.kind === "svg" && /settings\.svg$/.test(n.$.path)).length, 1, "one gear");
  assert.deepEqual(byId(tree, "fm-settings-open").$.handlers.tooltip, [["Settings"]]);
  press(byId(tree, "fm-settings-open"));
  assert.deepEqual(state.overlays.at(-1).props, { role: "settings", section: "files" });
  press(byId(tree, "fm-window-close"));
  assert.equal(state.closed.at(-1), "w2");
  assert.deepEqual(state.violations, []);
  state.props = {};
});

test("menus, dialogs and the shared parts still go by their role; the panel's copy is the tree", async () => {
  const dir = folder(["a.txt"]);
  assert.equal(isWindow({ overlay: "o1" }), true);
  assert.equal(isWindow({ overlay: "o1", role: "menu" }), false);
  assert.equal(isWindow({}), false);
  for (const [props, Part] of [[{ overlay: "o2", role: "menu", root: dir, on: null, rel: "a.txt", dir: false }, Menu], [{ overlay: "o3", role: "dialog", action: "newfile", root: dir, on: null, rel: "", dir: true }, Dialog],
    [{ overlay: "o4", role: "settings" }, SettingsWindow], [{}, Tree], [{ frame: "none" }, Tree]]) {
    const { view } = await open(dir, props);
    assert.ok(view.role instanceof Part, `${JSON.stringify(props)}: ${Part.name}`);
  }
  state.props = {};
});
