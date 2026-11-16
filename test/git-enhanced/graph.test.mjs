import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { lanes, width, drawRow, LANE } = await mod("graph.js");

// Commits newest first: "M:B,D" is M with parents B and D.
const log = (spec) => spec.trim().split(/\s+/).map((s) => { const [hash, ps = ""] = s.split(":"); return { hash, parents: ps ? ps.split(",") : [], refs: [] }; });
// One line per row: the lanes above (ids), the dot's lane, the lanes below.
const shape = (commits, rows) => rows.map((r, i) => `${commits[i].hash}@${r.circle} ${r.input.map((n) => n.id).join("") || "-"} > ${r.output.map((n) => n.id).join("") || "-"}`);

test("a straight line stays in one lane", () => {
  const c = log("C:B B:A A");
  const rows = lanes(c);
  assert.deepEqual(shape(c, rows), ["C@0 - > B", "B@0 B > A", "A@0 A > -"]);
  assert.ok(rows.every((r) => r.color === rows[0].color));
  assert.deepEqual(rows.map(width), [2, 2, 2]);
});

test("a branch merged back: a second lane opens at the merge and ends at the fork", () => {
  const c = log("M:B,D D:C C:A B:A A");
  const rows = lanes(c);
  assert.deepEqual(shape(c, rows), [
    "M@0 - > BD",
    "D@1 BD > BC",
    "C@1 BC > BA",
    "B@0 BA > AA",
    "A@0 AA > -",
  ]);
  assert.equal(rows[0].kind, "merge");
  assert.notEqual(rows[0].output[0].color, rows[0].output[1].color, "the merged branch has its own color");
  // At the fork both lanes end in A's dot: the second one bends over.
  const fork = drawRow(c[4], rows[4], { height: 22 });
  assert.equal(fork.dot.x, LANE);
  assert.ok(fork.lines.some((l) => l.d[0][1] === 2 * LANE && l.d.some((s) => s[0] === "A")), "lane 1 bends into the dot");
  assert.ok(!fork.lines.some((l) => l.d.at(-1)[2] === 22 && l.d[0][2] === 11), "a root commit has no line below its dot");
  // The merge draws a line from its dot over to the second parent's lane.
  const merge = drawRow(c[0], rows[0], { height: 22 });
  assert.ok(merge.lines.some((l) => l.d[0][1] === LANE && l.d.at(-1)[1] === 2 * LANE && l.d.at(-1)[2] === 22), JSON.stringify(merge.lines));
});

test("branch tips that no lane waits for start lanes of their own (All branches)", () => {
  const c = log("X:P Y:P Z:Q P:Q Q");
  const rows = lanes(c);
  assert.deepEqual(shape(c, rows), [
    "X@0 - > P",
    "Y@1 P > PP",
    "Z@2 PP > PPQ",
    "P@0 PPQ > QQ",
    "Q@0 QQ > -",
  ]);
  // P's row: lane 1 (also waiting for P) bends into the dot; lane 2 (Q) moves left to lane 1.
  const p = drawRow(c[3], rows[3], { height: 30, cy: 12 });
  assert.equal(p.dot.y, 12);
  const moved = p.lines.find((l) => l.d[0][1] === 3 * LANE);
  assert.deepEqual(moved.d.at(-1), ["L", 2 * LANE, 30], "the Q lane ends one lane left, at the bottom");
});

test("an octopus merge opens a lane per parent and they all come back", () => {
  const c = log("O:A,B,C C:R B:R A:R R");
  const rows = lanes(c);
  assert.deepEqual(shape(c, rows), [
    "O@0 - > ABC",
    "C@2 ABC > ABR",
    "B@1 ABR > ARR",
    "A@0 ARR > RRR",
    "R@0 RRR > -",
  ]);
  const o = drawRow(c[0], rows[0]);
  assert.equal(o.lines.filter((l) => l.d[0][1] === LANE && l.d[0][2] === 11 && l.d.at(-1)[2] === 22).length, 3, "the first parent's line and two merge lines");
  assert.equal(new Set(rows[0].output.map((n) => n.color)).size, 3);
});

test("a root commit in the middle keeps the other lanes going", () => {
  const c = log("A:B C:D B D");
  const rows = lanes(c);
  assert.deepEqual(shape(c, rows), ["A@0 - > B", "C@1 B > BD", "B@0 BD > D", "D@0 D > -"]);
  const b = drawRow(c[2], rows[2]);
  assert.ok(b.lines.some((l) => l.d[0][1] === 2 * LANE && l.d.at(-1)[1] === LANE), "D's lane moves left past the ended one");
  assert.equal(rows[2].color, rows[1].input[0].color, "a root's dot keeps its lane's color");
});

test("parents outside the page leave lanes open at the bottom", () => {
  const c = log("A:B B:C");
  const rows = lanes(c);
  assert.deepEqual(shape(c, rows), ["A@0 - > B", "B@0 B > C"]);
});

test("fixed colors for the current branch and its upstream; others take turns after them", () => {
  const c = log("U:H H:A A");
  c[0].refs = [{ kind: "remote", name: "origin/main" }];
  c[1].refs = [{ kind: "branch", name: "main", current: true }];
  const fixed = (x) => (x.refs?.some((r) => r.current) ? 0 : x.refs?.some((r) => r.kind === "remote" && r.name === "origin/main") ? 1 : undefined);
  const rows = lanes(c, { colors: 4, reserved: 2, fixed, head: "H" });
  assert.equal(rows[0].color, 1);
  assert.equal(rows[1].color, 0);
  assert.equal(rows[1].kind, "head");
  const other = lanes(log("M:A,B B:A A"), { colors: 4, reserved: 2 });
  assert.ok(other[0].output.every((n) => n.color >= 2), JSON.stringify(other[0].output));
});

test("a long history stays one pass with bounded lanes", () => {
  const n = 3000, c = [];
  for (let i = 0; i < n; i++) c.push({ hash: `c${i}`, parents: i + 1 < n ? [`c${i + 1}`, ...(i % 10 === 0 && i + 5 < n ? [`c${i + 5}`] : [])] : [], refs: [] });
  const t = Date.now(), rows = lanes(c);
  assert.ok(Date.now() - t < 500);
  assert.ok(Math.max(...rows.map(width)) <= 4, String(Math.max(...rows.map(width))));
});
