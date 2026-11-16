// commitsel.js: the selection (click, ⌘-click, shift-click either way, ⌘⇧, after a reload), and
// cherry-picking and reverting several real commits in the right order, merges, what holds a commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
import { withRemote } from "./gitenv.mjs";

const C = await mod("commitsel.js");
const { runPlan } = await mod("gitplan.js");
const ORDER = ["e", "d", "c", "b", "a"]; // newest first, as the History page lists them

test("the selection: click, toggle, ranges either way, adding a range, select all, a reload", () => {
  let s = C.click(C.NONE, "d");
  assert.deepEqual(s, { selected: ["d"], anchor: "d" });
  s = C.toggle(s, "b");
  assert.deepEqual(C.inOrder(s, ORDER), ["d", "b"]);
  assert.deepEqual(C.oldestFirst(s, ORDER), ["b", "d"]);
  s = C.toggle(s, "d");
  assert.deepEqual(s, { selected: ["b"], anchor: "d" }, "toggled out; the range starts there");
  s = C.click(C.NONE, "b");
  assert.deepEqual(C.extend(s, "e", ORDER).selected, ["e", "d", "c", "b"], "upwards");
  assert.deepEqual(C.extend(C.click(C.NONE, "e"), "c", ORDER).selected, ["e", "d", "c"], "downwards");
  const two = C.extend(C.toggle(C.click(C.NONE, "a"), "d"), "e", ORDER, { add: true });
  assert.deepEqual(C.inOrder(two, ORDER), ["e", "d", "a"], "⌘⇧ adds the range to what was selected");
  assert.deepEqual(C.extend(C.NONE, "c", ORDER), { selected: ["c"], anchor: "c" }, "no anchor: a click");
  assert.deepEqual(C.extend(s, "zz", ORDER), s, "a hash not shown: nothing changes");
  assert.deepEqual(C.selectAll(ORDER), { selected: ORDER, anchor: "e" });
  assert.deepEqual(C.clear(), { selected: [], anchor: null });
  assert.deepEqual(C.prune({ selected: ["e", "x", "a"], anchor: "x" }, ORDER), { selected: ["e", "a"], anchor: null });
  assert.equal(C.isSelected(two, "d"), true);
  assert.equal(C.isSelected(two, "b"), false);
});

// main with one commit; side with three on top of it (s1, s2, s3), each a file.
function sided() {
  const r = withRemote("git-enhanced-select-");
  r.git("switch", "-q", "-c", "side");
  const hashes = ["s1", "s2", "s3"].map((s) => r.commit(s, { [`${s}.txt`]: `${s}\n`, "log.txt": `${s}\n` }));
  r.git("switch", "-q", "main");
  const order = r.git("log", "--format=%H", "main..side").trim().split("\n");
  const commits = order.map((h) => ({ hash: h, parents: r.git("log", "-1", "--format=%P", h).trim().split(" ") }));
  return { r, hashes, order, commits };
}

test("cherry-pick several: oldest first, with -x; into the index without committing", async () => {
  const { r, hashes: [s1, , s3], order, commits } = sided();
  const sel = C.toggle(C.click(C.NONE, s3), s1);
  const picked = commits.filter((c) => C.isSelected(sel, c.hash));
  const p = C.cherryPickPlan(picked, order, { x: true }, { current: "main" });
  assert.deepEqual(p.steps[0].args.slice(-2), [s1, s3], "oldest first");
  assert.equal(p.confirm, "Cherry-pick 2 commits onto main, oldest first, each message saying where it came from?");
  // s3 changes log.txt that s2 changed too: picking s1 then s3 conflicts on it.
  const res = await runPlan(r.h, p);
  assert.match(res.stopped, /CONFLICT|could not apply/i);
  r.git("cherry-pick", "--abort");
  const p2 = C.cherryPickPlan(commits.filter((c) => c.hash !== s3), order, { x: true }, { current: "main" });
  await runPlan(r.h, p2);
  assert.deepEqual(r.git("log", "--format=%s", "-2").trim().split("\n"), ["s2", "s1"]);
  assert.match(r.git("log", "-1", "--format=%B"), /\(cherry picked from commit [0-9a-f]{40}\)/);
  r.git("reset", "-q", "--hard", "origin/main");
  await runPlan(r.h, C.cherryPickPlan([{ hash: s1, parents: ["x"] }], order, { noCommit: true }));
  assert.equal(r.git("log", "-1", "--format=%s").trim(), "one", "no commit made");
  assert.match(r.git("status", "--porcelain"), /^A  s1\.txt$/m);
  assert.equal(C.cherryPickPlan([], order).problem, "No commit is selected");
});

test("revert several newest first; a merge commit needs its mainline", async () => {
  const { r, hashes: [s1, s2, s3], order, commits } = sided();
  r.git("merge", "-q", "--no-ff", "--no-edit", "side");
  const p = C.revertPlan(commits, order, {}, { current: "main" });
  assert.deepEqual(p.steps[0].args.slice(-3), [s3, s2, s1], "newest first");
  assert.match(p.confirm, /^Revert 3 commits on main, newest first\? New commits undo them; history isn't rewritten\.$/);
  await runPlan(r.h, p);
  assert.deepEqual(r.git("log", "--format=%s", "-3").trim().split("\n").map((s) => s.replace(/^Revert "(.*)"$/, "$1")), ["s1", "s2", "s3"]);
  assert.equal(r.exists("s1.txt") || r.exists("s3.txt"), false);
  // The merge commit itself: refused without a mainline, reverted with -m 1.
  const merge = r.git("rev-parse", "HEAD~3").trim(), parents = r.git("log", "-1", "--format=%P", merge).trim().split(" ");
  assert.match(C.revertPlan([{ hash: merge, parents }], [merge]).problem, /is a merge commit: revert it against one of its parents/);
  r.git("reset", "-q", "--hard", merge);
  await runPlan(r.h, C.revertPlan([{ hash: merge, parents }], [merge], { mainline: 1 }, { current: "main" }));
  assert.equal(r.exists("s2.txt"), false, "the merge is undone");
  assert.match(C.revertPlan([{ hash: s1 }], [s1], { noCommit: true }).confirm, /put in the index, not committed/);
});

test("which branches, remote branches and tags hold a commit", async () => {
  const { r, hashes: [s1, , s3] } = sided();
  r.git("push", "-q", "origin", "side");
  r.git("fetch", "-q");
  r.git("tag", "v1", s1);
  r.git("branch", "other", s3);
  const holds = C.parseContains((await r.h.git(C.containsArgs(s1))).stdout);
  assert.deepEqual(holds, { branches: ["other", "side"], remotes: ["origin/side"], tags: ["v1"] });
  const first = C.parseContains((await r.h.git(C.containsArgs(r.git("rev-parse", "main").trim()))).stdout);
  assert.deepEqual(first.remotes, ["origin/main", "origin/side"], "origin/HEAD, a symbolic ref, left out");
  assert.deepEqual(C.parseContains(""), { branches: [], remotes: [], tags: [] });
});

test("-m with a plain commit among merges: refused on git before 2.21, which rejects it; fine after", async () => {
  const { parseVersion } = await mod("gitplan.js");
  const commits = [{ hash: "a", parents: ["x", "y"] }, { hash: "b", parents: ["a"] }];
  const old = parseVersion("git version 2.20.1"), now = parseVersion("git version 2.21.0");
  for (const fn of [C.cherryPickPlan, C.revertPlan]) {
    assert.match(fn(commits, ["b", "a"], { mainline: 1 }, { version: old }).problem, /git 2\.21 or newer/);
    assert.equal(fn(commits, ["b", "a"], { mainline: 1 }, { version: now }).problem, undefined);
    assert.equal(fn([commits[0]], ["a"], { mainline: 1 }, { version: old }).problem, undefined, "merges alone are fine");
  }
});
