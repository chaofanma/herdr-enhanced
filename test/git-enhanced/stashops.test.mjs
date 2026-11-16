// stashops.js against real repositories: keep-index, ignored files, apply and pop with the index,
// a branch from a stash, rename (by hash, under sh and dash), clear (danger), and a stash's diff
// against the working tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
import { repo, runner, SHELLS } from "./gitenv.mjs";

const S = await mod("stashops.js");
const { DIFF } = await mod("hunk.js");
const { STASH_FORMAT, parseStashList } = await mod("stashes.js");
const { runPlan } = await mod("gitplan.js");

const stashes = async (r) => parseStashList((await r.h.git(["stash", "list", STASH_FORMAT])).stdout);

test("the arguments, and the diff flags are the panel's", () => {
  assert.deepEqual(S.DIFF, DIFF);
  assert.deepEqual(S.stashArgs({ message: " wip ", keepIndex: true, untracked: true }), ["stash", "push", "--keep-index", "--include-untracked", "-m", "wip"]);
  assert.deepEqual(S.stashArgs({ ignored: true, untracked: true }), ["stash", "push", "--all"]);
  assert.deepEqual(S.applyArgs("stash@{1}"), ["stash", "apply", "--index", "stash@{1}"]);
  assert.deepEqual(S.applyArgs("stash@{0}", { pop: true, index: false }), ["stash", "pop", "stash@{0}"]);
  assert.deepEqual(S.diffArgs("stash@{0}", { reverse: true, names: true, paths: ["a b"] }), ["diff", ...DIFF, "-R", "--name-status", "-z", "-M", "stash@{0}", "--", "a b"]);
  assert.equal(S.stashPlan({}).confirm, undefined);
  assert.match(S.stashPlan({ ignored: true }).confirm, /\.env leave the folder/);
});

test("keep-index stashes only what isn't staged; --index brings the staged part back staged", async () => {
  const r = repo("git-enhanced-stashops-");
  r.commit("one", { "s.txt": "s\n", "u.txt": "u\n" });
  r.write("s.txt", "staged\n"); r.git("add", "s.txt"); r.write("u.txt", "unstaged\n");
  await runPlan(r.h, S.stashPlan({ keepIndex: true, message: "half" }));
  assert.equal(r.git("status", "--porcelain"), "M  s.txt\n", "the staged change stays, staged");
  assert.equal(r.read("u.txt"), "u\n");
  r.git("reset", "-q", "--hard");
  r.write("s.txt", "staged\n"); r.git("add", "s.txt"); r.write("u.txt", "unstaged\n");
  await runPlan(r.h, S.stashPlan({ message: "again" }));
  const [again] = await stashes(r);
  await runPlan(r.h, S.applyPlan(again.ref, { pop: true }));
  assert.equal(r.git("status", "--porcelain"), "M  s.txt\n M u.txt\n", "staged again, as it was");
  assert.deepEqual((await stashes(r)).map((x) => x.message), ["half"], "popped");
});

test("ignored files stashed with --all and back on pop; a branch from a stash", async () => {
  const r = repo("git-enhanced-stashops-ign-");
  r.commit("one", { ".gitignore": ".env\n", "f.txt": "1\n" });
  const base = r.git("rev-parse", "HEAD").trim();
  r.write(".env", "SECRET=1\n"); r.write("new.txt", "n\n"); r.write("f.txt", "changed\n");
  await runPlan(r.h, S.stashPlan({ ignored: true, message: "everything" }));
  assert.equal(r.exists(".env") || r.exists("new.txt"), false, "ignored and untracked files left the folder");
  r.commit("two", { "f.txt": "2\n", "g.txt": "g\n" });
  const [s] = await stashes(r);
  await runPlan(r.h, S.branchPlan(s.ref, "from-stash"));
  assert.equal(r.git("branch", "--show-current").trim(), "from-stash");
  assert.equal(r.git("rev-parse", "HEAD").trim(), base, "made where the stash was made");
  assert.equal(r.read(".env"), "SECRET=1\n");
  assert.equal(r.read("f.txt"), "changed\n");
  assert.equal((await stashes(r)).length, 0, "dropped once applied");
  assert.equal(S.branchPlan("stash@{0}", "").problem, "The new branch needs a name");
});

test("rename: found by its hash, stored again with the new message, the old entry dropped; clear; the diff against the working tree", async () => {
  for (const shell of SHELLS) {
    const r = repo("git-enhanced-stashops-rename-");
    r.commit("one", { "f.txt": "1\n" });
    for (const m of ["oldest", "middle", "newest"]) { r.write("f.txt", `${m}\n`); r.git("stash", "push", "-q", "-m", m); }
    const before = await stashes(r), middle = before.find((x) => x.message === "middle");
    await runPlan(runner(r.dir, shell), S.renamePlan(middle, "renamed: with “quotes” and $HOME"));
    const after = await stashes(r);
    assert.deepEqual(after.map((x) => [x.message, x.hash]), [["renamed: with “quotes” and $HOME", middle.hash], ["newest", before[0].hash], ["oldest", before[2].hash]], shell);
    await assert.rejects(runPlan(runner(r.dir, shell), S.renamePlan({ hash: "1".repeat(40), ref: "stash@{9}" }, "x")), /That stash is gone/);
    assert.equal(S.renamePlan(middle, " ").problem, "A stash's name can't be empty");
    // The working tree against a stash.
    r.write("f.txt", "now\n");
    const d = await r.h.git(S.diffArgs(after[0].ref));
    assert.match(d.stdout, /^-middle$/m); assert.match(d.stdout, /^\+now$/m);
    const names = await r.h.git(S.diffArgs(after[0].ref, { names: true }));
    assert.equal(names.stdout, "M\0f.txt\0");
    const clear = S.clearPlan(after);
    assert.equal(clear.danger, true);
    assert.equal(clear.confirm, "Drop all 3 stashes? None of them can be applied after this.");
    await runPlan(r.h, clear);
    assert.deepEqual(await stashes(r), []);
    assert.equal(S.clearPlan([]).problem, "There are no stashes");
    assert.equal(S.clearPlan([after[0]]).confirm, "Drop the only stash? None of them can be applied after this.");
  }
});

test("a stash picked by number is checked by its hash first: apply, branch and clear refuse once the stashes moved", async () => {
  for (const shell of SHELLS) {
    const r = repo("git-enhanced-stashops-moved-"), h = runner(r.dir, shell);
    r.commit("one", { "f.txt": "1\n" });
    for (const m of ["older", "newer"]) { r.write("f.txt", `${m}\n`); r.git("stash", "push", "-q", "-m", m); }
    const listed = await stashes(r), older = listed[1];
    r.write("f.txt", "third\n"); r.git("stash", "push", "-q", "-m", "third");
    await assert.rejects(runPlan(h, S.applyPlan(older, { index: true })), /The stashes changed since they were listed \(stash@\{1\} is another one now\): nothing was done/, shell);
    await assert.rejects(runPlan(h, S.branchPlan(older, "b")), /stash@\{1\} is another one now/, shell);
    assert.equal(r.tryGit("rev-parse", "-q", "--verify", "refs/heads/b").status, 1, "no branch made");
    await assert.rejects(runPlan(h, S.clearPlan(listed)), /The stashes changed since they were listed \(now 3\): nothing was dropped/, shell);
    assert.equal((await stashes(r)).length, 3, "none dropped");
    const now = await stashes(r);
    await runPlan(h, S.applyPlan(now[2], { index: true }));
    assert.equal(r.read("f.txt"), "older\n", shell);
    r.git("checkout", "-q", "--", "f.txt");
    await runPlan(h, S.clearPlan(now));
    assert.deepEqual(await stashes(r), []);
  }
});
