import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";

const C = await mod("comments.js");
const rows = [
  { kind: "@", text: "@@ -10,3 +10,4 @@" },
  { kind: " ", number: 10, old: 10, text: "const a = 1;" },
  { kind: "-", number: 11, text: "const b = 2;" },
  { kind: "+", number: 11, text: "const b = 3;" },
  { kind: "+", number: 12, text: "const c = 4;" },
  { kind: "", text: "\\ No newline at end of file" },
];

test("quotes and spans in the new file's numbers; removed lines marked", () => {
  assert.deepEqual(C.quoteOf(rows, 1, 4), ["10   const a = 1;", " - - const b = 2;", "11 + const b = 3;", "12 + const c = 4;"]);
  assert.deepEqual(C.quoteOf(rows, 0, 0), ["@@ -10,3 +10,4 @@"]);
  assert.equal(C.spanOf(rows, 1, 4), "lines 10–12");
  assert.equal(C.spanOf(rows, 3, 3), "line 11");
  assert.equal(C.spanOf(rows, 2, 2), "a removed line");
  assert.equal(C.spanOf(rows, 0, 0), "this hunk");
});

test("a comment finds its rows again after the diff is read anew, or keeps its quote", () => {
  const c = C.makeComment({ rows, path: "a.js", from: 4, to: 3, text: "Why 3?", now: 1000, id: "c1" });
  assert.deepEqual(c.start, { kind: "+", number: 11, text: "const b = 3;" });
  assert.deepEqual(c.end, { kind: "+", number: 12, text: "const c = 4;" });
  assert.equal(c.span, "lines 11–12");
  assert.deepEqual(C.placeOf(rows, c), { from: 3, to: 4 });
  // Two lines added above: the same rows, two numbers further down.
  const moved = rows.map((r) => (r.number ? { ...r, number: r.number + 2 } : r));
  assert.deepEqual(C.placeOf([{ kind: "+", number: 1, text: "x" }, ...moved], c), { from: 4, to: 5 });
  // The lines are gone: no place; the quote stays for the message.
  assert.equal(C.placeOf([rows[0], rows[1]], c), null);
  assert.deepEqual(c.quote, ["11 + const b = 3;", "12 + const c = 4;"]);
  const file = C.makeComment({ rows, path: "a.js", text: "Rename this file", id: "c2" });
  assert.equal(file.start, null); assert.equal(C.placeOf(rows, file), null);
});

test("drafts per repository and scope; an empty list leaves no key; old keys go", () => {
  const k = C.draftKey(null, "/r", "work");
  assert.equal(k, ":/r:work"); assert.equal(C.draftKey("vps", "/r", "commit:abc"), "vps:/r:commit:abc");
  let map = C.withDrafts(undefined, k, [{ id: "c1", path: "a", text: "x" }]);
  assert.deepEqual(C.draftsOf(map, k).map((c) => c.id), ["c1"]);
  map = C.withDrafts(map, k, []);
  assert.deepEqual(map, {});
  assert.deepEqual(C.draftsOf({ [k]: [{ id: 3 }, null, { id: "ok", path: "p" }] }, k).map((c) => c.id), ["ok"], "junk is dropped");
  let many = {};
  for (let i = 0; i < 5; i++) many = C.withDrafts(many, `k${i}`, [{ id: "c", path: "p" }], 3);
  assert.deepEqual(Object.keys(many), ["k2", "k3", "k4"]);
});

test("the messages: a review of several comments, a question about lines, about a whole diff", () => {
  const a = C.makeComment({ rows, path: "a.js", from: 3, to: 3, text: "Why 3?", id: "c1" });
  const b = C.makeComment({ rows, path: "b.js", text: "Split this file", id: "c2" });
  const m = C.reviewMessage({ where: "/r (on vps)", scope: "the uncommitted changes", comments: [a, b] });
  assert.equal(m, 'Review of /r (on vps): the uncommitted changes. 2 comments. Line numbers are the new file\'s; "-" marks a removed line.\n\n'
    + "### a.js, line 11\n```\n11 + const b = 3;\n```\nComment: Why 3?\n\n### b.js (the whole file)\nComment: Split this file");
  assert.match(C.askLinesMessage({ where: "/r/a.js", view: "unstaged changes", rows, from: 1, to: 2 }), /^In \/r\/a\.js, line 10 of the diff \(unstaged changes; .*\n\n```\n10   const a = 1;\n - - const b = 2;\n```$/);
  const all = C.askDiffMessage({ where: "/r/a.js", view: "staged changes", rows, max: 2 });
  assert.match(all, /^The diff of \/r\/a\.js \(staged changes\):\n\n```\n@@ -10,3 \+10,4 @@\n10   const a = 1;\n```\n\(4 more rows not shown\)$/);
});
