import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { mod, NAME } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { runnerOf, stashEntries, stashPatch, stashApplyEntry, stashDrop, stashPush, branchRefs, validBranchName, deleteBranch, mergeBranch, rebaseOnto, repoOperation, abortOperation,
  switchRemote, lastGitAction, undoGitAction, headCommit, undoLastCommit, keepDiscarded, discardedList, restorePlanOf, restoreDiscarded, applyPatch } = await mod("gitops.js");
const { DIFF, FLAGS, splitDiff, hunkPatch } = await mod("hunk.js");

// Herdr's exec, as node does it: { code, stdout, stderr }, never throwing for a failing program.
const exec = (cmd, args, { cwd } = {}) => new Promise((resolve) => execFile(cmd, args, { cwd, encoding: "utf8", maxBuffer: 8 << 20 }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr })));

function repo() {
  const dir = tempDir("git-enhanced-gitops-");
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main"); git("config", "user.name", "t"); git("config", "user.email", "t@t");
  const write = (p, s) => writeFileSync(join(dir, p), s), read = (p) => readFileSync(join(dir, p), "utf8");
  return { dir, git, write, read, h: runnerOf(exec, dir, null) };
}

test("stashes through the runner: the patch, apply, drop; a stash that moved is found by its hash", async () => {
  const { git, write, read, h } = repo();
  write("a.txt", "a\n"); git("add", "-A"); git("commit", "-qm", "init");
  write("a.txt", "a2\n"); write("u.txt", "u\n");
  await stashPush(h, { message: "first", mode: "all", untracked: true });
  write("a.txt", "a3\n"); git("stash", "push", "-q", "-m", "second");
  const [second, first] = await stashEntries(h);
  assert.deepEqual([first.message, first.ref, second.ref], ["first", "stash@{1}", "stash@{0}"]);
  const patch = await stashPatch(h, first.hash);
  assert.match(patch, /^diff --git a\/a\.txt b\/a\.txt/m);
  assert.match(patch, /^\+u$/m, "the untracked file is in it");
  await stashDrop(h, second.hash);
  assert.equal((await stashEntries(h))[0].hash, first.hash, "first is stash@{0} now, found by its hash");
  await stashApplyEntry(h, first.hash, false);
  assert.equal(read("a.txt"), "a2\n"); assert.equal(read("u.txt"), "u\n");
  await assert.rejects(stashDrop(h, second.hash), /gone/);
});

test("branches through the runner: refs, names, a merge that stops and its abort, a refused delete", async () => {
  const { git, write, read, h } = repo();
  write("f", "1\n"); git("add", "-A"); git("commit", "-qm", "one");
  git("switch", "-q", "-c", "side"); write("f", "side\n"); git("commit", "-qam", "side");
  git("switch", "-q", "main"); write("f", "main\n"); git("commit", "-qam", "main");
  const { local } = await branchRefs(h);
  assert.deepEqual(local.map((b) => b.name).sort(), ["main", "side"]);
  assert.equal(await validBranchName(h, "ok/name"), true);
  assert.equal(await validBranchName(h, "bad..name"), false);
  await assert.rejects(deleteBranch(h, "side", false), /not fully merged/);
  const r = await mergeBranch(h, "side");
  assert.match(r.stopped, /CONFLICT/);
  assert.equal(await repoOperation(h), "merge");
  await abortOperation(h, "merge");
  assert.equal(await repoOperation(h), null);
  assert.equal(read("f"), "main\n");
  const rb = await rebaseOnto(h, "side");
  assert.match(rb.stopped, /CONFLICT|could not apply/);
  await abortOperation(h, "rebase");
  write("f", "dirty\n");
  await assert.rejects(rebaseOnto(h, "side"), /unstaged changes|uncommitted|cannot rebase/i, "a refusal throws");
});

test("switching to a remote branch: a new tracking branch, then the same one again", async () => {
  const base = tempDir("git-enhanced-gitops-remote-"), sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  sh(base, "init", "-q", "--bare", "-b", "main", "r.git"); sh(base, "clone", "-q", "r.git", "a");
  const a = join(base, "a"); sh(a, "config", "user.name", "t"); sh(a, "config", "user.email", "t@t");
  writeFileSync(join(a, "f"), "1\n"); sh(a, "add", "-A"); sh(a, "commit", "-qm", "one"); sh(a, "push", "-q", "origin", "HEAD:main", "HEAD:feature/x");
  sh(a, "fetch", "-q");
  const h = runnerOf(exec, a, null);
  let { local, remote } = await branchRefs(h);
  const rb = remote.find((r) => r.name === "origin/feature/x");
  await switchRemote(h, rb, local);
  assert.equal(sh(a, "branch", "--show-current").trim(), "feature/x");
  assert.equal(sh(a, "rev-parse", "--abbrev-ref", "@{u}").trim(), "origin/feature/x");
  sh(a, "switch", "-q", "main");
  ({ local } = await branchRefs(h));
  await switchRemote(h, rb, local);
  assert.equal(sh(a, "branch", "--show-current").trim(), "feature/x");
});

test("undo through the runner: the last commit, then the last action (marked)", async () => {
  const { git, write, h } = repo();
  write("f", "1\n"); git("add", "-A"); git("commit", "-qm", "one");
  write("f", "2\n"); git("commit", "-qam", "two");
  const c = await headCommit(h);
  assert.equal(c.subject, "two"); assert.equal(c.parents.length, 1); assert.equal(c.pushed, false); assert.equal(c.message, "two");
  await undoLastCommit(h, false);
  assert.equal(git("log", "-1", "--format=%s").trim(), "one");
  assert.equal(git("status", "--porcelain").trim(), "M  f");
  assert.ok(git("reflog", "-1", "--format=%gs").startsWith(`[${NAME} undo]`));
  git("commit", "-qm", "two again"); git("switch", "-q", "-c", "side");
  const a = await lastGitAction(h);
  assert.equal(a.kind, "checkout");
  await undoGitAction(h, a);
  assert.equal(git("branch", "--show-current").trim(), "main");
  const first = await lastGitAction(h);
  assert.equal(first.subject, "commit: two again");
  // The first commit of a branch: update-ref -d HEAD.
  const r2 = repo();
  r2.write("x", "x\n"); r2.git("add", "-A"); r2.git("commit", "-qm", "root");
  const root = await headCommit(r2.h);
  assert.equal(root.parents.length, 0);
  await undoLastCommit(r2.h, true);
  assert.equal(r2.git("status", "--porcelain").trim(), "A  x");
});

test("a copy kept, listed and restored through the runner", async () => {
  const { git, write, read, dir, h } = repo();
  write("a.txt", "a\n"); git("add", "-A"); git("commit", "-qm", "init");
  write("a.txt", "work\n"); write("n.txt", "new\n");
  await keepDiscarded(h, { mode: "paths", paths: ["a.txt", "n.txt"], message: "Revert a.txt" });
  git("checkout", "-q", "--", "a.txt"); execFileSync("rm", [join(dir, "n.txt")]);
  write("a.txt", "since\n");
  const [d] = await discardedList(h);
  assert.equal(d.what, "Revert a.txt");
  const plan = await restorePlanOf(h, d.commit, d.files.map((f) => f.path));
  assert.deepEqual(plan.map((p) => `${p.action} ${p.path}`), ["overwrite a.txt", "recreate n.txt"]);
  await restoreDiscarded(h, d.commit, plan, "“Revert a.txt”");
  assert.equal(read("a.txt"), "work\n"); assert.equal(read("n.txt"), "new\n");
  const [before] = await discardedList(h);
  assert.equal(before.what, "Before restoring “Revert a.txt”", "what the restore overwrote is kept too");
  assert.ok(existsSync(join(dir, "n.txt")));
});

test("applyPatch: a hunk bigger than one argument may be (128 KiB) travels in base64 pieces", async () => {
  const { git, write, read, h } = repo();
  const lines = Array.from({ length: 4000 }, (_, i) => `line ${i} ${"x".repeat(40)}`);
  write("big.txt", lines.join("\n") + "\n"); git("add", "-A"); git("commit", "-qm", "one");
  write("big.txt", lines.map((l) => l.toUpperCase()).join("\n") + "\n");
  const d = splitDiff(git("diff", ...DIFF, "--", "big.txt")), patch = hunkPatch(d.header, d.lines, 0);
  assert.ok(patch.length > 300000, `${patch.length} bytes`);
  await applyPatch(h, patch, FLAGS.stage);
  assert.equal(git("diff", "--cached", "--stat").includes("big.txt"), true);
  assert.equal(git("diff", "--stat"), "", "the whole change is staged");
  await applyPatch(h, patch, FLAGS.unstage);
  assert.equal(git("diff", "--cached"), "");
  await assert.rejects(applyPatch(h, patch.replace("LINE 1 ", "LINE ONE "), FLAGS.revert), /patch|apply|error/i);
  assert.equal(read("big.txt").startsWith("LINE 0"), true, "a patch that doesn't apply changes nothing");
});

test("the working tree's actions: delete a new file, revert all, stage and unstage all, commit, amend, push and publish", async () => {
  const { git, write, read, dir, h } = repo();
  const { deleteNew, revertEverything, stageEverything, unstageEverything, commitStaged, pushBranch, fetchRemote, pullFastForward, switchBranch, lastMessage, headPushed } = await mod("gitops.js");
  write("a.txt", "a\n"); git("add", "-A"); git("commit", "-qm", "one");
  write("u.txt", "u\n"); write("s.txt", "s\n"); git("add", "s.txt");
  await deleteNew(h, "u.txt", true); await deleteNew(h, "s.txt", false);
  assert.equal(existsSync(join(dir, "u.txt")) || existsSync(join(dir, "s.txt")), false);
  write("a.txt", "changed\n"); write("n.txt", "n\n"); git("add", "n.txt"); write("x.txt", "x\n");
  await revertEverything(h);
  assert.equal(git("status", "--porcelain"), ""); assert.equal(read("a.txt"), "a\n");
  write("a.txt", "b\n"); write("d.txt", "d\n");
  await stageEverything(h);
  assert.equal(git("status", "--porcelain"), "M  a.txt\nA  d.txt\n");
  await unstageEverything(h, true);
  assert.equal(git("status", "--porcelain"), " M a.txt\n?? d.txt\n");
  // A message of several lines, quotes and a leading dash goes as a file.
  const message = "-Fix \"quotes\" and $HOME\n\nA body line.";
  await commitStaged(h, { message, stageAll: true });
  assert.equal(await lastMessage(h), message);
  assert.equal(git("status", "--porcelain"), "");
  write("a.txt", "c\n"); git("add", "a.txt");
  await commitStaged(h, { message: "Amended", amend: true });
  assert.equal(git("rev-list", "--count", "HEAD").trim(), "2", "amend rewrote the last commit");
  assert.equal(await lastMessage(h), "Amended");
  // Publish (no upstream yet), then push; fetch and a fast-forward pull.
  const origin = tempDir("git-enhanced-origin-"); execFileSync("git", ["init", "-q", "--bare", origin]);
  git("remote", "add", "origin", origin);
  await pushBranch(h, { upstream: null, remote: "origin" });
  assert.equal(git("rev-parse", "--abbrev-ref", "@{u}").trim(), "origin/main");
  assert.equal(await headPushed(h), true);
  write("a.txt", "d\n"); git("commit", "-qam", "three");
  assert.equal(await headPushed(h), false);
  await pushBranch(h, { upstream: "origin/main", remote: "origin" });
  assert.equal(git("rev-parse", "origin/main").trim(), git("rev-parse", "HEAD").trim());
  await fetchRemote(h); await pullFastForward(h);
  await switchBranch(h, "side", true);
  assert.equal(git("branch", "--show-current").trim(), "side");
  await assert.rejects(switchBranch(h, "no-such-branch"), /invalid reference|no-such-branch/);
});
