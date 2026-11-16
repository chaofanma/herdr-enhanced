// branchops.js: upstream states (literal and real, a gone upstream), the clean-up (merged, gone,
// protected, current, checked out in a worktree), moving unpushed commits, merge and rebase
// options against real repositories, the previous branch, and fast-forwarding another branch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { repo, withRemote, cloneOf, runner, SHELLS } from "./gitenv.mjs";
import { tempDir } from "./tmp.mjs";

const B = await mod("branchops.js");
const W = await mod("worktrees.js");
const { runPlan, parseVersion } = await mod("gitplan.js");
const V = (s) => parseVersion(`git version ${s}`);

test("parseTracking on literal output: ahead, behind, both, gone, no upstream, a local upstream", () => {
  const row = (...f) => f.join("\0");
  const out = [
    row("refs/heads/main", "refs/remotes/origin/main", "", "=", "*"),
    row("refs/heads/a", "refs/remotes/origin/a", "[ahead 2, behind 3]", "<>", " "),
    row("refs/heads/b", "refs/remotes/origin/b", "[ahead 1]", ">", " "),
    row("refs/heads/c", "refs/remotes/origin/c", "[gone]", "", " "),
    row("refs/heads/d", "", "", "", " "),
    row("refs/heads/e", "refs/heads/main", "[behind 4]", "<", " "),
    "",
  ].join("\n");
  assert.deepEqual(B.parseTracking(out).map((b) => [b.name, b.upstream, b.ahead, b.behind, b.gone, b.current]), [
    ["main", "origin/main", 0, 0, false, true], ["a", "origin/a", 2, 3, false, false], ["b", "origin/b", 1, 0, false, false],
    ["c", "origin/c", 0, 0, true, false], ["d", null, 0, 0, false, false], ["e", "main", 0, 4, false, false],
  ]);
  assert.deepEqual(B.parseTracking(""), []);
  assert.deepEqual([...B.parseMerged("refs/heads/a\nrefs/heads/x/y\n")], ["a", "x/y"]);
});

test("the clean-up with real remotes: merged and gone branches; never main, develop, the current one, or one in a worktree", async () => {
  const me = withRemote("git-enhanced-branches-");
  const mk = (name, file) => { me.git("switch", "-q", "-c", name, "main"); if (file) me.commit(name, { [file]: `${name}\n` }); me.git("push", "-q", "-u", "origin", name); };
  mk("merged-gone", "m.txt"); mk("unmerged-gone", "u.txt"); mk("kept", "k.txt"); mk("develop", null); mk("in-worktree", null);
  me.git("switch", "-q", "main"); me.git("merge", "-q", "--ff-only", "merged-gone");
  me.git("switch", "-q", "-c", "current");
  for (const b of ["merged-gone", "unmerged-gone"]) me.origin.git("branch", "-D", b);
  me.git("fetch", "-q", "--prune");
  const wt = tempDir("git-enhanced-branches-wt-");
  me.git("worktree", "add", "-q", join(wt, "w"), "in-worktree");
  const branches = B.parseTracking((await me.h.git(B.TRACK_ARGS)).stdout);
  assert.deepEqual(branches.filter((b) => b.gone).map((b) => b.name), ["merged-gone", "unmerged-gone"]);
  const merged = B.parseMerged((await me.h.git(B.mergedArgs("main"))).stdout);
  const worktrees = W.parseWorktrees((await me.h.git(["worktree", "list", "--porcelain"])).stdout);
  const c = B.cleanupCandidates({ branches, merged, base: "main", worktrees });
  assert.deepEqual(c, [{ name: "merged-gone", merged: true, gone: true }, { name: "unmerged-gone", merged: false, gone: true }],
    "kept (not merged, upstream there), develop and in-worktree (merged, but protected / checked out), current and main are left out");
  assert.deepEqual(B.cleanupCandidates({ branches, merged, base: "main", worktrees, gone: false }).map((x) => x.name), ["merged-gone"]);
  const safe = B.cleanupPlan(c);
  assert.equal(safe.danger, false);
  me.git("switch", "-q", "main");
  for (const shell of SHELLS.slice(0, 1)) {
    const res = await runPlan(runner(me.dir, shell), safe);
    assert.deepEqual(B.parseDeleted(res.outputs[0]), [{ status: "deleted", name: "merged-gone" }, { status: "kept", name: "unmerged-gone" }]);
  }
  const force = B.cleanupPlan(c, { force: true });
  assert.equal(force.danger, true);
  assert.match(force.confirm, /^Delete 1 branch whose commits aren't merged \(unmerged-gone\)\? Their commits are then only in the reflog/);
  await runPlan(me.h, force);
  assert.equal(me.tryGit("rev-parse", "-q", "--verify", "refs/heads/unmerged-gone").status, 1);
  assert.equal(B.cleanupPlan([]).problem, "No branch to clean up");
  assert.equal(B.cleanupPlan([{ name: "x", merged: true }], { force: true }).problem, "Every branch here is merged: no forced delete is needed");
});

test("move unpushed commits to a new branch: staying on the branch, or going to the new one", async () => {
  for (const stay of [true, false]) {
    const me = withRemote("git-enhanced-branches-move-");
    const pushed = me.git("rev-parse", "HEAD").trim();
    me.commit("oops 1", { "a.txt": "a\n" }); const tip = me.commit("oops 2", { "b.txt": "b\n" });
    me.write("f.txt", "uncommitted\n");
    const p = B.moveCommitsPlan({ branch: "main", upstream: "origin/main", name: "feature", ahead: 2, stay });
    assert.match(p.confirm, /^Move the 2 commits of main that origin\/main doesn't have to a new branch feature\? main goes back to origin\/main;/);
    await runPlan(me.h, p);
    assert.equal(me.git("rev-parse", "main").trim(), pushed, "main is back on its upstream");
    assert.equal(me.git("rev-parse", "feature").trim(), tip, "the commits are on feature");
    assert.equal(me.git("branch", "--show-current").trim(), stay ? "main" : "feature");
    assert.equal(me.read("f.txt"), "uncommitted\n", "the uncommitted change stays");
    assert.equal(me.exists("a.txt"), !stay, stay ? "on main the files are the upstream's" : "on feature nothing changed");
  }
  assert.equal(B.moveCommitsPlan({ branch: "main", upstream: "origin/main", name: "x", ahead: 0 }).problem, "main has no commits that origin/main doesn't have");
  assert.equal(B.moveCommitsPlan({ branch: "main", ahead: 1, name: "x" }).problem, "main has no upstream to go back to");
});

test("merge options: --no-ff, --ff-only refused when diverged, --squash staged, --no-commit stops before committing", async () => {
  const fresh = () => {
    const r = repo("git-enhanced-branches-merge-");
    r.commit("one", { "f.txt": "1\n" });
    r.git("switch", "-q", "-c", "side"); r.commit("side", { "s.txt": "s\n" }); r.git("switch", "-q", "main");
    return r;
  };
  let r = fresh();
  await runPlan(r.h, B.mergePlan("side", { ff: "no-ff" }, { current: "main" }));
  assert.equal(r.git("log", "-1", "--format=%P").trim().split(" ").length, 2, "a merge commit where a fast-forward would do");
  r = fresh(); r.commit("main's own", { "m.txt": "m\n" });
  await assert.rejects(runPlan(r.h, B.mergePlan("side", { ff: "ff-only" }, { current: "main" })), /Not possible to fast-forward|fast-forward/i);
  r = fresh();
  const head = r.git("rev-parse", "HEAD").trim();
  await runPlan(r.h, B.mergePlan("side", { squash: true }, { current: "main" }));
  assert.equal(r.git("rev-parse", "HEAD").trim(), head, "no commit");
  assert.match(r.git("status", "--porcelain"), /^A  s\.txt$/m, "the changes are staged");
  r = fresh();
  const head2 = r.git("rev-parse", "HEAD").trim();
  await runPlan(r.h, B.mergePlan("side", { commit: false }, { current: "main" }));
  assert.equal(r.git("rev-parse", "HEAD").trim(), head2);
  assert.equal(r.tryGit("rev-parse", "-q", "--verify", "MERGE_HEAD").status, 0, "the merge waits for its commit");
  assert.deepEqual(B.mergeArgs("x", { commit: false }), ["-c", "core.editor=true", "merge", "--no-ff", "--no-commit", "--no-edit", "x"]);
  assert.deepEqual(B.mergeArgs("x", { message: "Merge x\n\nwhy" }), ["-c", "core.editor=true", "merge", "-m", "Merge x\n\nwhy", "x"]);
  assert.throws(() => B.mergeArgs("x", { squash: true, ff: "no-ff" }), /can't be --no-ff/);
  assert.match(B.mergePlan("x", { squash: true, ff: "no-ff" }, { current: "main" }).problem, /can't be --no-ff/);
  assert.equal(B.mergePlan("x", {}, {}).problem, "No branch is checked out");
});

test("rebase options: autosquash (plain on git 2.44+, interactive before), autostash, update-refs", async () => {
  const version = parseVersion(repo("git-enhanced-branches-v-").git("version"));
  for (const v of [version, V("2.40.0")]) {
    const r = repo("git-enhanced-branches-rebase-");
    r.commit("base", { "f.txt": "1\n" });
    r.git("switch", "-q", "-c", "feat");
    r.commit("add a", { "a.txt": "a\n" });
    const other = r.commit("other", { "o.txt": "o\n" });
    r.git("branch", "lower");
    r.commit("fixup! add a", { "a.txt": "a fixed\n" });
    r.git("switch", "-q", "main"); r.commit("main moves", { "m.txt": "m\n" }); r.git("switch", "-q", "feat");
    r.write("f.txt", "dirty\n");
    const args = B.rebaseArgs("main", { autosquash: true, autostash: true, updateRefs: v === version, version: v });
    assert.equal(args.includes("-i"), v !== version || !version || version.minor < 44, `interactive for ${v.major}.${v.minor}`);
    await runPlan(r.h, B.rebasePlan("main", { autosquash: true, autostash: true, updateRefs: v === version, version: v }, { branch: "feat" }));
    assert.deepEqual(r.git("log", "--format=%s", "main..feat").trim().split("\n"), ["other", "add a"], "the fixup went into its commit");
    assert.equal(r.git("show", "feat:a.txt"), "a fixed\n");
    assert.equal(r.read("f.txt"), "dirty\n", "autostash put the change back");
    if (v === version) {
      assert.notEqual(r.git("rev-parse", "lower").trim(), other, "update-refs moved the branch inside the rebased range along");
      assert.equal(r.git("log", "-1", "--format=%s", "lower").trim(), "other");
      assert.equal(r.tryGit("merge-base", "--is-ancestor", "lower", "feat").status, 0);
    } else assert.equal(r.git("rev-parse", "lower").trim(), other, "without it the branch stays");
  }
  assert.throws(() => B.rebaseArgs("main", { updateRefs: true, version: V("2.37.0") }), /2\.38/);
  assert.match(B.rebasePlan("main", { updateRefs: true, version: V("2.37.0") }, { branch: "x" }).problem, /2\.38/);
  assert.match(B.rebasePlan("main", {}, { branch: "x", upstream: "origin/x" }).confirm, /a push needs a force push/);
});

test("the previous branch (or commit), and fast-forwarding a branch that isn't checked out", async () => {
  const me = withRemote("git-enhanced-branches-prev-");
  const version = parseVersion(me.git("version"));
  me.git("switch", "-q", "-c", "other"); me.git("switch", "-q", "main");
  for (const shell of SHELLS) {
    const prev = B.parsePrevious((await runner(me.dir, shell).sh(B.PREVIOUS_SH)).stdout);
    assert.deepEqual(prev, { branch: "other", sha: me.git("rev-parse", "other").trim() }, shell);
  }
  await runPlan(me.h, B.previousPlan(B.parsePrevious((await me.h.sh(B.PREVIOUS_SH)).stdout), { version }));
  assert.equal(me.git("branch", "--show-current").trim(), "other");
  me.git("switch", "-q", "--detach", "HEAD"); me.git("switch", "-q", "main");
  const det = B.parsePrevious((await me.h.sh(B.PREVIOUS_SH)).stdout);
  assert.equal(det.branch, null);
  await runPlan(me.h, B.previousPlan(det, { version }));
  assert.equal(me.tryGit("symbolic-ref", "-q", "HEAD").status, 1, "back on the detached commit");
  assert.equal(B.parsePrevious(""), null);
  assert.equal(B.previousPlan(null).problem, "There is no previous branch");
  assert.deepEqual(B.previousPlan({ branch: "x", sha: "1".repeat(40) }, { version: V("2.20.0") }).steps[0].args, ["checkout", "x"]);
  // Fast-forward "other" (not checked out) to its upstream; refused when it isn't one.
  me.git("switch", "-q", "main");
  me.git("push", "-q", "-u", "origin", "other");
  const theirs = cloneOf(me.origin, "git-enhanced-branches-prev-theirs-");
  theirs.git("switch", "-q", "other"); theirs.commit("upstream moved", { "u.txt": "u\n" }); theirs.git("push", "-q", "origin", "other");
  me.git("fetch", "-q");
  const up = (await me.h.git(B.upstreamRefArgs("other"))).stdout.trim();
  assert.equal(up, "refs/remotes/origin/other");
  await runPlan(me.h, B.fastForwardPlan("other", up));
  assert.equal(me.git("rev-parse", "other").trim(), me.git("rev-parse", "origin/other").trim());
  me.git("switch", "-q", "other"); me.commit("local", { "l.txt": "l\n" }); me.git("switch", "-q", "main");
  theirs.commit("again", { "u2.txt": "u\n" }); theirs.git("push", "-q", "origin", "other"); me.git("fetch", "-q");
  await assert.rejects(runPlan(me.h, B.fastForwardPlan("other", up)), /non-fast-forward|rejected/);
  theirs.git("switch", "-q", "main"); theirs.commit("main moved", { "mm.txt": "m\n" }); theirs.git("push", "-q", "origin", "main"); me.git("fetch", "-q");
  await assert.rejects(runPlan(me.h, B.fastForwardPlan("main", (await me.h.git(B.upstreamRefArgs("main"))).stdout.trim())), /refusing to fetch into branch|checked out/);
  assert.equal(B.fastForwardPlan("x", "").problem, "x has no upstream");
});

test("a tag named like the branch: merge and rebase take the branch, not the tag", async () => {
  const r = repo("git-enhanced-branches-tagtoo-");
  r.commit("one", { "f.txt": "1\n" });
  r.git("tag", "side");
  r.git("switch", "-q", "-c", "side"); r.commit("side's own", { "s.txt": "s\n" }); r.git("switch", "-q", "main");
  r.commit("main's own", { "m.txt": "m\n" });
  const tagToo = r.tryGit(...B.tagTooArgs("side")).status === 0, noTag = r.tryGit(...B.tagTooArgs("main")).status === 0;
  assert.deepEqual([tagToo, noTag], [true, false]);
  assert.equal(B.mergeTarget("side", { tagToo }), "refs/heads/side");
  assert.equal(B.mergeTarget("side"), "side", "git's message names the branch when nothing else has its name");
  await runPlan(r.h, B.mergePlan("side", { ff: "no-ff" }, { current: "main", tagToo }));
  assert.equal(r.tryGit("merge-base", "--is-ancestor", "side", "HEAD").status, 0, "the branch's commit is merged");
  assert.equal(r.read("s.txt"), "s\n");
  r.git("reset", "-q", "--hard", "HEAD~1");
  await runPlan(r.h, B.rebasePlan("side", {}, { branch: "main" }));
  assert.equal(r.tryGit("merge-base", "--is-ancestor", "refs/heads/side", "HEAD").status, 0, "rebased onto the branch");
  assert.equal(r.read("s.txt"), "s\n");
});

test("Move my unpushed commits on git before 2.23: checkout -b, not switch -c", () => {
  const p = B.moveCommitsPlan({ branch: "main", upstream: "origin/main", name: "f", ahead: 1, version: V("2.22.0") });
  assert.deepEqual(p.steps[0].args, ["checkout", "-b", "f"]);
  assert.deepEqual(B.moveCommitsPlan({ branch: "main", upstream: "origin/main", name: "f", ahead: 1, version: V("2.23.0") }).steps[0].args, ["switch", "-c", "f"]);
});
