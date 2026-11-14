import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { clickSelect, inOrder, commonFolder, outermost } = await mod("selection.js");

const order = ["a", "b", "b/x", "b/y", "c", "d"];
const cmd = { platform: true }, shift = { shift: true };
const step = (state, path, mods) => clickSelect(state, path, mods, order);
const list = s => inOrder(s.set, order);

test("a plain click selects one row", () => {
  const s = step({ cursor: "a", anchor: "a", set: ["a", "c"] }, "b/x", {});
  assert.deepEqual(s, { cursor: "b/x", anchor: "b/x", set: new Set(["b/x"]) });
});

test("⌘ toggles, starting from the row that was selected", () => {
  let s = step({ cursor: "a" }, "c", cmd);
  assert.deepEqual(list(s), ["a", "c"]);
  s = step(s, "b/y", cmd);
  assert.deepEqual(list(s), ["a", "b/y", "c"]);
  s = step(s, "a", cmd);
  assert.deepEqual(list(s), ["b/y", "c"]);
  assert.equal(s.cursor, "a");
  assert.deepEqual(list(step({ cursor: null }, "d", cmd)), ["d"]);
});

test("Shift selects from the anchor in the order shown, and keeps the anchor", () => {
  let s = step({ cursor: "b", anchor: "b", set: [] }, "c", shift);
  assert.deepEqual(list(s), ["b", "b/x", "b/y", "c"]);
  s = step(s, "a", shift);
  assert.deepEqual(list(s), ["a", "b"]);
  assert.equal(s.anchor, "b");
  // After a ⌘-click the anchor is that row.
  s = step(step({ cursor: "a" }, "c", cmd), "d", shift);
  assert.deepEqual(list(s), ["c", "d"]);
  // ⌘⇧ adds the range.
  s = step(step({ cursor: "a" }, "b/y", cmd), "d", { shift: true, platform: true });
  assert.deepEqual(list(s), ["a", "b/y", "c", "d"]);
  // An anchor no longer shown: just this row.
  assert.deepEqual(list(step({ cursor: "gone", anchor: "gone" }, "c", shift)), ["c"]);
});

test("rows no longer shown drop out", () => {
  assert.deepEqual(inOrder(new Set(["d", "zz", "a"]), order), ["a", "d"]);
});

test("the common folder and the outermost paths", () => {
  assert.equal(commonFolder(["src/a/x.js", "src/a/y.js"]), "src/a");
  assert.equal(commonFolder(["src/a/x.js", "src/b/y.js"]), "src");
  assert.equal(commonFolder(["src/a", "src/b"]), "src");
  assert.equal(commonFolder(["a.txt", "src/b.txt"]), "");
  assert.equal(commonFolder(["src"]), "");
  assert.equal(commonFolder([]), "");
  assert.deepEqual(outermost(["b/x", "a", "b", "b/y/z", "c/d"]), ["a", "b", "c/d"]);
  assert.deepEqual(outermost(["ab", "a", "a/b"]), ["ab", "a"]);
});
