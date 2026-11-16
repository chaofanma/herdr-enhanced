import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { BRANCH_FORMAT, remoteOf, parseBranchRefs, remoteTarget, branchMenu, notMerged, OPERATION_SH, operationOf, abortArgs, operationWords } = await mod("branches.js");

test("a remote-tracking ref's remote: the longest remote name it starts with", () => {
  assert.equal(remoteOf("origin/feature/x", ["origin"]), "origin");
  assert.equal(remoteOf("team/a/main", ["team", "team/a"]), "team/a");
  assert.equal(remoteOf("up/main", []), "up");
});

test("local and remote branches from for-each-ref", () => {
  const out = [
    "refs/heads/main\x1f2 days ago\x1f*\x1frefs/remotes/origin/main\x1f",
    "refs/remotes/origin/HEAD\x1f2 days ago\x1f \x1f\x1frefs/remotes/origin/main",
    "refs/remotes/origin/feature/x\x1f3 days ago\x1f \x1f\x1f",
    "refs/heads/topic\x1f5 days ago\x1f \x1f\x1f",
    "refs/remotes/origin/main\x1f2 days ago\x1f \x1f\x1f",
  ].join("\n") + "\n";
  const { local, remote } = parseBranchRefs(out, ["origin"]);
  assert.deepEqual(local, [{ name: "main", age: "2 days ago", current: true, upstream: "origin/main" }, { name: "topic", age: "5 days ago", current: false, upstream: null }]);
  assert.deepEqual(remote.map((r) => [r.name, r.remote, r.branch]), [["origin/feature/x", "origin", "feature/x"], ["origin/main", "origin", "main"]]);
});

test("a remote branch's click: the local branch tracking it, else one named like it, else a new tracking one", () => {
  const local = [{ name: "main", upstream: "origin/main" }, { name: "dev", upstream: null }, { name: "mine", upstream: "origin/theirs" }];
  assert.deepEqual(remoteTarget({ name: "origin/main", branch: "main" }, local), { local: "main" });
  assert.deepEqual(remoteTarget({ name: "origin/theirs", branch: "theirs" }, local), { local: "mine" });
  assert.deepEqual(remoteTarget({ name: "origin/dev", branch: "dev" }, local), { local: "dev" });
  assert.deepEqual(remoteTarget({ name: "origin/feature/x", branch: "feature/x" }, local), { track: "origin/feature/x" });
});

test("the branch menu", () => {
  assert.deepEqual(branchMenu({ name: "main", current: true }, "main").map((i) => i.id), ["rename"]);
  const other = branchMenu({ name: "topic", current: false }, "main");
  assert.deepEqual(other.map((i) => [i.id, i.label, Boolean(i.disabled)]), [["rename", "Rename…", false], ["delete", "Delete…", false], ["merge", "Merge into main…", false], ["rebase", "Rebase main onto it…", false]]);
  const detached = branchMenu({ name: "topic" }, null);
  assert.equal(detached.find((i) => i.id === "merge").disabled, true);
  assert.equal(detached.find((i) => i.id === "delete").disabled, undefined);
  assert.match(branchMenu({ name: "topic" }, "main", "rebase").find((i) => i.id === "merge").detail, /rebase is in progress/);
});

test("operations in progress and their words", () => {
  assert.equal(operationOf(""), null);
  assert.equal(operationOf("MERGE_HEAD\n"), "merge");
  assert.equal(operationOf("rebase-merge\n"), "rebase");
  assert.equal(operationOf("rebase-apply\nMERGE_HEAD\n"), "rebase");
  assert.equal(operationOf("CHERRY_PICK_HEAD\n"), "cherry-pick");
  assert.deepEqual(abortArgs("merge"), ["merge", "--abort"]);
  assert.equal(operationWords("merge", 2), "Merge stopped: 2 files conflict");
  assert.equal(operationWords("rebase", 1), "Rebase stopped: 1 file conflict");
  assert.equal(operationWords("cherry-pick", 0), "Cherry-pick in progress: no conflicts left");
  assert.equal(notMerged("error: the branch 'side' is not fully merged"), true);
  assert.equal(notMerged("error: branch 'x' not found"), false);
});

test("a stopped merge in a real repo, and the refs format", () => {
  const dir = tempDir("git-enhanced-branch-");
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main"); git("config", "user.name", "t"); git("config", "user.email", "t@t");
  writeFileSync(join(dir, "a"), "a\n"); git("add", "-A"); git("commit", "-qm", "a");
  git("switch", "-q", "-c", "side"); writeFileSync(join(dir, "a"), "side\n"); git("commit", "-qam", "side");
  git("switch", "-q", "main"); writeFileSync(join(dir, "a"), "main\n"); git("commit", "-qam", "main");
  const sh = () => spawnSync("sh", ["-c", OPERATION_SH], { cwd: dir, encoding: "utf8" }).stdout;
  assert.equal(operationOf(sh()), null);
  spawnSync("git", ["-c", "core.editor=true", "merge", "--no-edit", "side"], { cwd: dir });
  assert.equal(operationOf(sh()), "merge");
  git(...abortArgs("merge"));
  assert.equal(operationOf(sh()), null);
  const { local } = parseBranchRefs(git("for-each-ref", "--sort=-committerdate", BRANCH_FORMAT, "refs/heads", "refs/remotes"), []);
  assert.deepEqual(local.map((b) => [b.name, b.current]).sort(), [["main", true], ["side", false]]);
});

test("operationOf: a git am session (rebase-apply/applying) is am, not a rebase", () => {
  assert.equal(operationOf("rebase-apply\nrebase-apply/applying\n"), "am");
  assert.equal(operationOf("rebase-apply\n"), "rebase");
  assert.match(OPERATION_SH, /rebase-apply\/applying/);
});
