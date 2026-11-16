// The settings window's "Double-click a file opens with" row names the key that does the same in
// the tree: Shift+Enter opens a file in that program; Enter only previews it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, makeCx, settle, load, folder, at, draw, byId, press, text } from "./render/load.mjs";

const { default: Files } = await load("main.js");
const keyDown = (root, keystroke) => press(byId(root, "files-tree"), "on_key_down", { key: keystroke.split("-").pop(), keystroke, modifiers: {} });
const opened = () => state.execLog.filter(([cmd]) => cmd === "open").length;

test("in the tree Enter previews a file and Shift+Enter opens it; the settings window says Shift+Enter", async () => {
  state.shared.clear(); state.overlays.length = 0; state.execLog.length = 0; state.violations.length = 0; state.props = {};
  const dir = folder(["b.txt"]);
  at(dir);
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle();
  const root = () => draw(view);
  keyDown(root(), "down"); await settle();
  assert.equal(view.role.sel, "b.txt");
  keyDown(root(), "enter"); await settle();
  assert.equal(view.role.preview.file, "b.txt", "Enter previews it");
  assert.equal(opened(), 0, "Enter opens no program");
  keyDown(root(), "shift-enter"); await settle();
  assert.equal(opened(), 1, "Shift+Enter opens it in its program");

  state.props = { role: "settings", overlay: "o9", section: "open-with" };
  const settings = new Files();
  settings.init({}, makeCx("async"));
  await settle();
  const words = text(draw(settings));
  assert.ok(words.includes("Double-click a file opens with"), "the row is there");
  assert.ok(words.includes("Shift+Enter on a file too."), "it names Shift+Enter");
  assert.equal(words.includes("Double-click a file opens withEnter on a file too."), false, "not Enter");
  state.props = {};
});
