import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { editLine, HINT } = await mod("editline.js");

test("no line while nothing is being edited", () => {
  assert.equal(editLine(null), null);
  assert.equal(editLine(undefined), null);
});

test("right after Edit, a quiet hint to click into the text", () => {
  assert.deepEqual(editLine({ original: "a", dirty: false }), { text: HINT, warn: false });
  assert.equal(HINT, "Click the text to start typing");
});

test("the hint goes once the editor has had the keys, and stays gone", () => {
  assert.equal(editLine({ original: "a", dirty: false, focused: true }), null);
  assert.equal(editLine({ original: "a", dirty: true, focused: true }), null);
});

test("warnings win over the hint, in their old order", () => {
  assert.deepEqual(editLine({ conflict: true, warn: true, error: "x" }), { text: "Changed on disk", warn: true });
  assert.deepEqual(editLine({ warn: true, error: "x" }), { text: "Unsaved changes — press again to discard", warn: true });
  assert.deepEqual(editLine({ error: "EACCES: permission denied" }), { text: "EACCES: permission denied", warn: true });
  assert.deepEqual(editLine({ error: "x", focused: true }), { text: "x", warn: true });
});
