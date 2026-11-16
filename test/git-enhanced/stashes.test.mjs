import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { STASH_FORMAT, stashSubject, parseStashList, stashPushArgs, gitSays } = await mod("stashes.js");

test("a stash's subject: branch, message, and whether git named it", () => {
  assert.deepEqual(stashSubject("On main: my message"), { branch: "main", message: "my message", wip: false });
  assert.deepEqual(stashSubject("WIP on feature/x: 1a2b3c4 Fix: the thing"), { branch: "feature/x", message: "1a2b3c4 Fix: the thing", wip: true });
  assert.deepEqual(stashSubject("WIP on (no branch): 1a2b3c4 s"), { branch: null, message: "1a2b3c4 s", wip: true });
  assert.deepEqual(stashSubject("On main: a: b"), { branch: "main", message: "a: b", wip: false });
  assert.deepEqual(stashSubject("autostash"), { branch: null, message: "autostash", wip: false });
});

test("git stash list in STASH_FORMAT", () => {
  const out = "stash@{0}\x1fabc\x1fp1 p2 p3\x1f2 minutes ago\x1fOn main: one\nstash@{1}\x1fdef\x1fp1 p2\x1f3 days ago\x1fWIP on dev: 1234567 two\n";
  const list = parseStashList(out);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { ref: "stash@{0}", hash: "abc", parents: ["p1", "p2", "p3"], age: "2 minutes ago", branch: "main", message: "one", wip: false, untracked: true });
  assert.equal(list[1].untracked, false);
  assert.equal(list[1].branch, "dev");
  assert.deepEqual(parseStashList(""), []);
});

test("stash push arguments", () => {
  assert.deepEqual(stashPushArgs({}), ["stash", "push", "--include-untracked"]);
  assert.deepEqual(stashPushArgs({ message: "  wip  ", untracked: false }), ["stash", "push", "-m", "wip"]);
  assert.deepEqual(stashPushArgs({ mode: "staged", untracked: true }), ["stash", "push", "--staged"]);
  assert.deepEqual(stashPushArgs({ mode: "files", paths: ["a*.txt", "d/b"], untracked: true }), ["stash", "push", "--include-untracked", "--", ":(literal)a*.txt", ":(literal)d/b"]);
});

test("git's words when a stash stops", () => {
  const conflict = { stdout: "Auto-merging f.txt\nCONFLICT (content): Merge conflict in f.txt\nOn branch main\nUnmerged paths:\n  (use \"git restore --staged <file>...\" to unstage)\n\tboth modified:   f.txt\n", stderr: "The stash entry is kept in case you need it again.\n" };
  assert.equal(gitSays(conflict), "The stash entry is kept in case you need it again.\nCONFLICT (content): Merge conflict in f.txt");
  const refused = { stdout: "On branch main\nChanges not staged for commit:\n\tmodified:   f.txt\n", stderr: "error: Your local changes to the following files would be overwritten by merge:\n\tf.txt\n\tg.txt\nPlease commit your changes or stash them before you merge.\nAborting\n" };
  assert.equal(gitSays(refused), "error: Your local changes to the following files would be overwritten by merge:\nf.txt\ng.txt");
  assert.equal(gitSays({ stderr: "hint: x\nsomething odd\n" }), "something odd");
  assert.equal(gitSays({}), "");
});

test("the arguments stash what they say, in a real repo", () => {
  const dir = tempDir("git-enhanced-stash-");
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main"); git("config", "user.name", "t"); git("config", "user.email", "t@t");
  writeFileSync(join(dir, "a*.txt"), "1\n"); writeFileSync(join(dir, "aX.txt"), "1\n"); writeFileSync(join(dir, "s.txt"), "1\n2\n3\n4\n5\n6\n7\n8\n");
  git("add", "-A"); git("commit", "-qm", "init");
  writeFileSync(join(dir, "a*.txt"), "2\n"); writeFileSync(join(dir, "aX.txt"), "2\n"); writeFileSync(join(dir, "new.txt"), "n\n");
  git(...stashPushArgs({ mode: "files", paths: ["a*.txt", "new.txt"], message: "two files" }));
  assert.equal(readFileSync(join(dir, "a*.txt"), "utf8"), "1\n", "stashed");
  assert.equal(readFileSync(join(dir, "aX.txt"), "utf8"), "2\n", "a glob would have taken it; the literal path doesn't");
  assert.equal(existsSync(join(dir, "new.txt")), false, "the untracked file went too");
  writeFileSync(join(dir, "s.txt"), "ONE\n2\n3\n4\n5\n6\n7\n8\n"); git("add", "s.txt"); writeFileSync(join(dir, "s.txt"), "ONE\n2\n3\n4\n5\n6\n7\nEIGHT\n");
  git(...stashPushArgs({ mode: "staged", message: "staged only" }));
  assert.equal(readFileSync(join(dir, "s.txt"), "utf8"), "1\n2\n3\n4\n5\n6\n7\nEIGHT\n", "the staged line went, the unstaged one stays");
  const list = parseStashList(git("stash", "list", STASH_FORMAT));
  assert.deepEqual(list.map((s) => s.message), ["staged only", "two files"]);
  assert.equal(list[1].untracked, true);
  assert.equal(list[0].branch, "main");
});
