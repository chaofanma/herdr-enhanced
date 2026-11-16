import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { FETCH_TICK, fetchDue, fetchesItself, bareMessage } = await mod("prefs.js");

test("an automatic fetch is due at once, then every autoFetch minutes; never at 0", () => {
  assert.equal(fetchDue(0, undefined, 1000), false);
  assert.equal(fetchDue(5, undefined, 1000), true);
  assert.equal(fetchDue(5, 1000, 1000 + 5 * 60000 - 1), false);
  assert.equal(fetchDue(5, 1000, 1000 + 5 * 60000), true);
  assert.equal(fetchDue(-1, undefined, 1000), false);
  assert.ok(FETCH_TICK <= 60000, "looked at often enough for a one-minute setting");
});

test("only the panel copy fetches by itself", () => {
  assert.equal(fetchesItself({}), true);
  assert.equal(fetchesItself(null), true);
  assert.equal(fetchesItself({ review: true }), false);
  assert.equal(fetchesItself({ view: "history" }), false);
  assert.equal(fetchesItself({ overlay: "o1" }), false);
});

test("a message that is only the template is nothing to commit", () => {
  assert.equal(bareMessage("", ""), true);
  assert.equal(bareMessage("  \n", ""), true);
  assert.equal(bareMessage("feat: ", "feat: "), true);
  assert.equal(bareMessage("feat:", "feat: "), true);
  assert.equal(bareMessage("feat: add x", "feat: "), false);
  assert.equal(bareMessage("Fix", ""), false);
  assert.equal(bareMessage("x", "   "), false);
});
