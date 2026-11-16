import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { WHOLE, CONTEXTS, diffArgs, contextWords, nonDefault } = await mod("diffopts.js");

test("the diff's arguments from the settings", () => {
  assert.deepEqual(diffArgs({}), [], "the defaults: git's own");
  assert.deepEqual(diffArgs({ whitespace: true }), ["-w"]);
  assert.deepEqual(diffArgs({ context: 10 }), ["-U10"]);
  assert.deepEqual(diffArgs({ context: "file", whitespace: true }), ["-w", `-U${WHOLE}`]);
  assert.deepEqual(diffArgs({ context: 3 }, 20), ["-U23"], "opened gaps add context");
  assert.deepEqual(diffArgs({ context: "file" }, 20), [`-U${WHOLE}`]);
  assert.deepEqual(CONTEXTS.map((c) => c.value), [3, 10, "file"]);
});

test("the lines of context in words; ± marks them when they aren't git's 3 (whitespace is a button of its own)", () => {
  assert.equal(contextWords({}), "3");
  assert.equal(contextWords({ context: 10 }), "10");
  assert.equal(contextWords({ whitespace: true, context: "file" }), "the whole file");
  assert.equal(nonDefault({}), false);
  assert.equal(nonDefault({ context: 10 }), true);
  assert.equal(nonDefault({ whitespace: true }), false);
});

test("gap rows between hunks, and the patch's own indexes", async () => {
  const { withGaps, withoutGaps, isGap, revealed, GAP, MORE } = await mod("diffopts.js");
  const diff = ["@@ -5,3 +5,3 @@", " a", "-b", "+B", " c", "@@ -40,2 +40,3 @@", " x", "+y", " z", "@@ -43 +44 @@", "-p", "+q"];
  const { lines, gaps } = withGaps(diff);
  assert.deepEqual(lines.filter(isGap), [`${GAP}4 lines`, `${GAP}32 lines`, `${GAP}1 line`]);
  assert.deepEqual([...gaps], [[0, { from: 1, to: 4, top: true }], [6, { from: 8, to: 39, top: false }], [11, { from: 43, to: 43, top: false }]]);
  assert.equal(lines[withGaps(diff).lines.indexOf("@@ -40,2 +40,3 @@")], "@@ -40,2 +40,3 @@");
  for (const [i, line] of lines.entries()) if (!isGap(line)) assert.equal(diff[withoutGaps(lines, i)], line, `row ${i}`);
  assert.equal(revealed(gaps.get(0)), 4, "the top gap shows its last line first");
  assert.equal(revealed(gaps.get(6)), 8);
  assert.deepEqual(withGaps(["@@ -1,3 +1,3 @@", " a"]).lines, ["@@ -1,3 +1,3 @@", " a"], "a file whose change starts at line 1: no gap");
  assert.deepEqual(withGaps(["@@ -0,0 +1,2 @@", "+a", "+b"]).gaps.size, 0, "a new file: none");
  assert.equal(isGap(" ⋯ not a gap"), false);
  assert.equal(MORE, 20);
});
