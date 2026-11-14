// The render stubs' layout checks (layoutlint.mjs), on hand-made trees.
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutProblems } from "./layoutlint.mjs";

// An element as the stubs record it: kind, id, the calls made on it ([name, args]), children.
const el = (kind, calls = [], children = [], id = null) => ({ $: { kind, id, calls: calls.map((c) => (Array.isArray(c) ? c : [c, []])), children } });
const list = (calls = ["size_full"]) => el("vlist", calls);

test("(a) a scroll area needs h, size_full, h_full, or flex_1 with min_h(0); a max_h alone is reported", () => {
  const scroll = (...calls) => layoutProblems(el("v_flex", [], [el("v_flex", [...calls, "overflow_y_scrollbar"], [], "s")]));
  assert.deepEqual(scroll(["max_h", [360]]), ["layout: s scrolls with only a max_h (it never scrolls in Herdr)"]);
  assert.deepEqual(scroll(), ["layout: s scrolls with no height of its own (it never scrolls in Herdr)"]);
  assert.deepEqual(scroll("flex_1"), ["layout: s scrolls with no height of its own (it never scrolls in Herdr)"], "flex_1 without min_h(0)");
  assert.deepEqual(scroll("flex_1", ["min_h", [44]]), ["layout: s scrolls with no height of its own (it never scrolls in Herdr)"], "a min_h other than 0");
  for (const ok of [[["h", [200]]], [["size", [90]]], ["size_full"], ["h_full"], ["flex_1", ["min_h", [0]]], [["h", [120]], ["max_h", [360]]]]) assert.deepEqual(scroll(...ok), [], JSON.stringify(ok));
  // Without the bar, and both ways, too; overflow_hidden isn't a scroll area.
  assert.equal(layoutProblems(el("div", ["overflow_y_scroll"])).length, 1);
  assert.equal(layoutProblems(el("div", ["overflow_scroll"])).length, 1);
  assert.deepEqual(layoutProblems(el("div", ["overflow_hidden"])), []);
});

test("(b) an h_flex holding a virtual list in a child stretches it, or the child is h_full or size_full", () => {
  const deep = () => el("div", ["flex_1", ["min_h", [0]]], [el("v_flex", ["size_full"], [el("div", ["flex_1"], [list()])])], "box");
  assert.deepEqual(layoutProblems(el("h_flex", ["flex_1"], [deep()])), ["layout: box holds a virtual list in an h_flex (no id) that doesn't stretch it: the list is 0 px tall"]);
  assert.deepEqual(layoutProblems(el("h_flex", ["flex_1", "items_stretch"], [deep()])), []);
  assert.deepEqual(layoutProblems(el("h_flex", [], [el("div", ["w", "h_full"], [list()], "side")])), []);
  assert.deepEqual(layoutProblems(el("h_flex", [], [el("div", ["size_full"], [list()])])), []);
  assert.deepEqual(layoutProblems(el("h_flex", [], [el("div", [["h", [400]]], [list()])])), [], "a height of its own");
  assert.deepEqual(layoutProblems(el("h_flex", [], [list(["size_full"])])), [], "the list itself, filling");
  assert.equal(layoutProblems(el("h_flex", [], [list([])])).length, 1, "the list itself, sized by nothing");
  // A v_flex stretches across by itself; an h_flex without a list in it is fine.
  assert.deepEqual(layoutProblems(el("v_flex", [], [deep()])), []);
  assert.deepEqual(layoutProblems(el("h_flex", [], [el("div", [], [el("div")])])), []);
});

test("(c) an open popover's button has no tooltip (it would show over the menu)", () => {
  const pop = (open, button) => ({ $: { kind: "popover", popover: "menu", id: null, calls: [["open", [open]]], children: [button], triggerEl: button } });
  const tipped = el("h_flex", [["tooltip", ["Which history"]]], [el("div")], "box");
  assert.deepEqual(layoutProblems(el("v_flex", [], [pop(true, tipped)])), ["layout: box, the button of the open menu menu, has a tooltip (it covers the menu)"]);
  assert.deepEqual(layoutProblems(el("v_flex", [], [pop(false, tipped)])), [], "closed: the tooltip helps");
  const deep = el("div", [], [el("div", [["tooltip", ["x"]]], [], "inner")], "box");
  assert.equal(layoutProblems(el("v_flex", [], [pop(true, deep)])).length, 1, "anywhere in the button");
  assert.deepEqual(layoutProblems(el("v_flex", [], [pop(true, el("h_flex", [], [], "box"))])), []);
});

test("(a) flex_1 gives a scroll area a height only in a column that has one, up the tree", () => {
  const box = () => el("div", ["flex_1", ["min_h", [0]], "overflow_y_scrollbar"], [], "box");
  const msg = (k) => `layout: box scrolls with flex_1 in ${k}, a column as tall as its content: it comes out 0 px tall`;
  assert.deepEqual(layoutProblems(el("v_flex", ["size_full"], [el("v_flex", [], [box()], "body")])), [msg("body")], "a column sized by its content");
  assert.deepEqual(layoutProblems(el("v_flex", ["size_full"], [el("v_flex", ["flex_1", ["min_h", [0]]], [box()], "body")])), [], "flex_1 up to a sized column");
  assert.deepEqual(layoutProblems(el("div", ["size_full"], [el("v_flex", [], [el("v_flex", ["flex_1"], [box()], "body")], "mid")])), [msg("mid")], "flex_1 up to an unsized column");
  assert.deepEqual(layoutProblems(el("v_flex", [["h", [300]]], [box()])), [], "in a column with a height");
  assert.deepEqual(layoutProblems(el("h_flex", [], [box()])), [], "in a row: not told (rule b looks at lists)");
  assert.deepEqual(layoutProblems(el("v_flex", ["flex_1"], [box()])), [], "the chain reaches the root: its host sizes it");
});
