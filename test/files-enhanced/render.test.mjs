// Renders the mod with stubbed Herdr modules (render/stubs.mjs) against real temp folders: the
// strict render rules (no cx.notify() or setShared() while a view renders) hold when the folder changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, makeCx, settle, load, folder, at, draw } from "./render/load.mjs";

const { default: Files } = await load("main.js");

test("an open search follows the folder without notifying from render", async () => {
  const one = folder(["alpha.txt", "notes/guide.md"]), two = folder(["beta.txt", "src/guide.js"]);
  at(one);
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle(); draw(view);
  const tree = view.role;
  tree.openSearch(makeCx());                 // the search button or "/"
  tree.search.input.set_value("guide");      // typing
  await settle(); draw(view);
  assert.ok(tree.search.results.length > 0, "the first folder's search found something");

  at(two);                                   // the focused terminal moved to another folder
  assert.doesNotThrow(() => draw(view), "a render after the folder changed");
  await settle(); draw(view);
  assert.deepEqual(state.violations, []);
  assert.equal(tree.root, two);
  assert.ok(tree.search, "the search stays open");
  assert.ok(tree.search.results.length > 0 && JSON.stringify(tree.search.results).includes("guide.js"), "and looks in the new folder");
});
