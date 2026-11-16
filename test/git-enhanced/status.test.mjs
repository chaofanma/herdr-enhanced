import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";

const { sides, isStaged, sectionsOf, scopeFiles, rowKey } = await mod("status.js");
const { parseStatusZ, parseNumstatZ } = await mod("renames.js");

test("sides: what is staged and what isn't, per status code", () => {
  assert.deepEqual(sides("M "), { staged: "M", unstaged: null, untracked: false, conflict: false });
  assert.deepEqual(sides(" M"), { staged: null, unstaged: "M", untracked: false, conflict: false });
  assert.deepEqual(sides("MM"), { staged: "M", unstaged: "M", untracked: false, conflict: false });
  assert.deepEqual(sides("??"), { staged: null, unstaged: "A", untracked: true, conflict: false });
  for (const xy of ["UU", "AA", "DD", "AU", "UD"]) assert.deepEqual(sides(xy), { staged: null, unstaged: "U", untracked: false, conflict: true }, xy);
  assert.equal(sides("R ").staged, "R"); assert.equal(sides("C ").staged, "A"); assert.equal(sides("T ").staged, "M");
  assert.equal(sides(" D").unstaged, "D"); assert.equal(sides("A ").staged, "A");
  assert.equal(isStaged("MM"), true); assert.equal(isStaged("??"), false); assert.equal(isStaged("UU"), false);
});

test("sectionsOf: a file staged and edited again is in both, each with its own numbers; renames keep their old path", () => {
  const entries = parseStatusZ(["MM a.txt", "R  new.txt", "old.txt", " D gone.txt", "?? n.txt", "UU c.txt", ""].join("\0"));
  const staged = parseNumstatZ(["1\t0\ta.txt", "0\t0\t", "old.txt", "new.txt", ""].join("\0"));
  const unstaged = parseNumstatZ(["2\t1\ta.txt", "0\t3\tgone.txt", "-\t-\tc.txt", ""].join("\0"));
  const s = sectionsOf({ entries, staged, unstaged, lines: new Map([["n.txt", 4]]) });
  assert.deepEqual(s.map((g) => g.key), ["staged", "unstaged"]);
  assert.deepEqual(s[0].rows.map((r) => [r.f.path, r.letter, r.add, r.del, r.f.from]), [["a.txt", "M", 1, 0, null], ["new.txt", "R", 0, 0, "old.txt"]]);
  assert.deepEqual(s[1].rows.map((r) => [r.f.path, r.letter, r.add, r.del, r.f.fresh]), [["a.txt", "M", 2, 1, false], ["gone.txt", "D", 0, 3, false], ["n.txt", "A", 4, 0, true], ["c.txt", "U", 0, 0, false]]);
  assert.equal(s[1].rows[3].f.binary, true);
  assert.deepEqual(sectionsOf({ entries: [] }), [], "a clean tree: no sections");
});

test("sectionsOf: Committed holds a scope's files with nothing uncommitted", () => {
  const entries = parseStatusZ(" M a.txt\0");
  const committed = [{ path: "a.txt", from: null, status: "M", add: 9, del: 9, binary: false }, { path: "b.txt", from: null, status: "A", add: 3, del: 0, binary: false }];
  const s = sectionsOf({ entries, unstaged: new Map([["a.txt", { add: 1, del: 0, binary: false }]]), committed });
  assert.deepEqual(s.map((g) => [g.key, g.rows.map((r) => r.f.path)]), [["unstaged", ["a.txt"]], ["committed", ["b.txt"]]]);
  assert.equal(s[1].label, "Committed"); assert.equal(s[1].rows[0].add, 3);
});

test("scopeFiles: a diff's files with their numbers, and the untracked files as new ones", () => {
  const names = [{ status: "M", path: "a.txt", from: null }, { status: "R", path: "n.txt", from: "o.txt" }, { status: "C", path: "c.txt", from: "a.txt" }];
  const scope = new Map([["a.txt", { add: 2, del: 1, binary: false }]]);
  assert.deepEqual(scopeFiles({ names, scope, untracked: ["u.txt", "a.txt"], lines: new Map([["u.txt", 7]]) }).map((f) => [f.path, f.status, f.add, f.del, f.from, f.fresh]),
    [["a.txt", "M", 2, 1, null, false], ["n.txt", "R", 0, 0, "o.txt", false], ["c.txt", "A", 0, 0, "a.txt", false], ["u.txt", "A", 7, 0, null, true]]);
  assert.equal(rowKey("staged", "a b.txt"), "staged:a b.txt");
});
