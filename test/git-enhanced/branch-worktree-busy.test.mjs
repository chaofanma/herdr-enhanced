// A branch that a rebase or a bisect in another worktree started from: `git worktree list` says only
// "detached" for that worktree, but git keeps the branch to it (it won't switch to it here or delete
// it). Read with BUSY_SH (worktrees.js readWorktrees), the picker says "Being rebased in <folder>" and
// a click goes to that worktree's space, where it can be finished.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { state, mount, draw, byId, handler, texts, settle, makeCx, load } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const W = await load("worktrees.js");
const sh = (cwd, ...a) => { try { return execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return e.stdout ?? ""; } };

// lantern with: side being rebased in lantern-rb (stopped on a conflict), bis being bisected in
// lantern-bs (on a commit between), plain checked out in lantern-plain.
function repos() {
  const base = realpathSync(tempDir("git-enhanced-branch-wt-busy-")), A = join(base, "lantern");
  const at = { A, rb: join(base, "lantern-rb"), bs: join(base, "lantern-bs"), plain: join(base, "lantern-plain") };
  sh(base, "init", "-q", "-b", "main", "lantern");
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@t"], ["core.hooksPath", "/dev/null"]]) sh(A, "config", k, v);
  const commit = (dir, text, msg) => { writeFileSync(join(dir, "f.txt"), text); sh(dir, "commit", "-qam", msg); };
  writeFileSync(join(A, "f.txt"), "1\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "one");
  sh(A, "branch", "side"); sh(A, "branch", "plain");
  sh(A, "switch", "-q", "-c", "bis"); for (const n of ["2", "3", "4", "5"]) commit(A, `${n}\n`, `bis ${n}`);
  sh(A, "switch", "-q", "main"); commit(A, "main\n", "main two");
  sh(A, "worktree", "add", "-q", at.rb, "side"); commit(at.rb, "side\n", "side two"); sh(at.rb, "rebase", "main");
  sh(A, "worktree", "add", "-q", at.bs, "bis"); sh(at.bs, "bisect", "start"); sh(at.bs, "bisect", "bad"); sh(at.bs, "bisect", "good", "HEAD~3");
  sh(A, "worktree", "add", "-q", at.plain, "plain");
  return at;
}

test("worktrees: BUSY_SH finds the branch a rebase or a bisect in a detached worktree started from", async () => {
  const at = repos();
  const porcelain = sh(at.A, "worktree", "list", "--porcelain");
  assert.ok(!porcelain.includes("branch refs/heads/side") && !porcelain.includes("branch refs/heads/bis"), "git lists both as detached");
  const run = (args) => ({ code: 0, stdout: execFileSync("git", args, { cwd: at.A, encoding: "utf8" }) });
  const shell = async (script, args) => ({ code: 0, stdout: execFileSync("sh", ["-c", script, "sh", ...args], { cwd: at.A, encoding: "utf8" }) });
  const list = await W.readWorktrees({ git: run, sh: shell }, null);
  const of = (p) => list.find((w) => w.path === p);
  assert.deepEqual([of(at.rb).branch, of(at.rb).doing], ["side", "rebase"]);
  assert.deepEqual([of(at.bs).branch, of(at.bs).doing], ["bis", "bisect"]);
  assert.deepEqual([of(at.plain).branch, of(at.plain).doing], ["plain", undefined]);
  const m = W.elsewhere(list, at.A);
  assert.equal(W.whereWords(m.get("side"), "~/lantern-rb"), "Being rebased in ~/lantern-rb");
  assert.equal(W.whereWords(m.get("bis"), "~/lantern-bs"), "Being bisected in ~/lantern-bs");
  assert.equal(W.whereWords(m.get("plain"), "~/lantern-plain"), "Checked out in ~/lantern-plain");
  // A rebase of a detached HEAD and a bisect started on a commit have no branch.
  assert.deepEqual(W.parseBusy(`rebase\x1f/x\x1fdetached HEAD\nbisect\x1f/y\x1f${"ab".repeat(20)}\nrebase\x1f/z\x1frefs/heads/a/b\n`), [{ doing: "rebase", path: "/z", branch: "a/b" }]);
  // Nothing detached: the list alone (no sh).
  let asked = 0;
  const one = await W.readWorktrees({ git: () => ({ code: 0, stdout: "worktree /a\nHEAD 1\nbranch refs/heads/main\n\n" }), sh: async () => { asked++; return { code: 0, stdout: "" }; } }, null);
  assert.equal(one.length, 1); assert.equal(asked, 0);
});

test("changes: the picker says a branch is being rebased in another worktree, and a click goes there instead of switching", async () => {
  const at = repos(), view = await mount(at.A), page = view.part;
  page.openBranches(true, makeCx()); await settle();
  const tree = await draw(view), row = (name) => byId(tree, `branch-${page.branches.findIndex((b) => b.name === name)}`);
  assert.ok(texts(row("side")).includes(`Being rebased in ${at.rb}`), texts(row("side")).join(" | "));
  assert.ok(texts(row("bis")).includes(`Being bisected in ${at.bs}`), texts(row("bis")).join(" | "));
  state.runs.length = 0;
  handler(row("side"), "on_click")({}, makeCx()); await settle();
  assert.deepEqual(state.runs.filter(([n]) => n.startsWith("space.")), [["space.new", { folder: at.rb }]]);
  assert.equal(sh(at.A, "rev-parse", "--abbrev-ref", "HEAD").trim(), "main", "no switch");
  assert.deepEqual(state.violations, []);
});
