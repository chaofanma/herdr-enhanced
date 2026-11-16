import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { DISCARDED, KEEP, snapshotArgs, discardOf, LIST_SH, parseDiscarded, CHECK_SH, restorePlan, restoreSteps, ago } = await mod("discarded.js");

function repo() {
  const dir = tempDir("git-enhanced-discard-");
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main"); git("config", "user.name", "t"); git("config", "user.email", "t@t");
  const write = (p, s) => writeFileSync(join(dir, p), s), read = (p) => readFileSync(join(dir, p), "utf8");
  const sh = (args) => { const r = spawnSync("sh", args, { cwd: dir, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  return { dir, git, write, read, sh };
}

test("what each revert keeps", () => {
  assert.deepEqual(discardOf({ revertFile: { root: "/r", on: null, path: "a.js", xy: " M" } }), { root: "/r", on: null, mode: "paths", paths: ["a.js"], message: "Revert a.js" });
  assert.deepEqual(discardOf({ revertFile: { root: "/r", on: "vps", path: "n.txt", xy: "??" } }).message, "Delete n.txt");
  assert.deepEqual(discardOf({ revertFile: { root: "/r", path: "new.js", from: "old.js", xy: "R " } }).paths, ["old.js", "new.js"]);
  assert.deepEqual(discardOf({ revertHunk: { root: "/r", path: "a.js" } }).message, "Revert a hunk of a.js");
  assert.deepEqual(discardOf({ revertAll: { root: "/r", on: null } }).mode, "all");
  assert.equal(discardOf({ menu: {} }), null);
});

test("a snapshot keeps the files, never the person's index; restore brings them back", () => {
  const { dir, git, write, read, sh } = repo();
  write("a.txt", "a\n"); write("d.txt", "d\n"); write("k.txt", "k\n"); git("add", "-A"); git("commit", "-qm", "init");
  write("a.txt", "a changed\n"); write("u.txt", "untracked\n"); git("rm", "-q", "d.txt"); write("n.txt", "new\n"); git("add", "n.txt");
  write("k.txt", "k staged\n"); git("add", "k.txt"); write("k.txt", "k staged, then more\n");
  const index = git("ls-files", "-s"), status = git("status", "--porcelain");
  const ref = `${DISCARDED}1000`;
  const commit = sh(snapshotArgs({ mode: "paths", ref, message: "Revert some", paths: ["a.txt", "u.txt", "d.txt", "n.txt", "k.txt", "gone.txt"] })).trim();
  assert.equal(git("ls-files", "-s"), index, "the index is as it was");
  assert.equal(git("status", "--porcelain"), status);
  assert.equal(git("rev-parse", ref).trim(), commit);
  assert.equal(git("log", "-1", "--format=%s", commit).trim(), "Revert some");
  assert.equal(git("rev-parse", `${commit}^1`).trim(), git("rev-parse", "HEAD").trim(), "first parent: HEAD");
  assert.equal(git("show", `${commit}^2:k.txt`), "k staged\n", "second parent: the index as it was");
  assert.equal(git("show", `${commit}:k.txt`), "k staged, then more\n", "the files as they were");
  // The list: its files against HEAD.
  let [d] = parseDiscarded(sh(["-c", LIST_SH]));
  assert.equal(d.ref, ref); assert.equal(d.at, 1000); assert.equal(d.what, "Revert some");
  assert.deepEqual(d.files.map((f) => `${f.status} ${f.path}`).sort(), ["A n.txt", "A u.txt", "D d.txt", "M a.txt", "M k.txt"]);
  // Revert all of it, then ask what a restore would do, then restore.
  git("reset", "-q", "--hard"); git("clean", "-fq");
  write("a.txt", "a, changed again\n"); write("d.txt", "d is back\n");
  const plan = restorePlan(sh(["-c", CHECK_SH, "sh", commit, ...d.files.map((f) => f.path)]));
  assert.deepEqual(Object.fromEntries(plan.map((p) => [p.path, p.action])), { "a.txt": "overwrite", "d.txt": "delete", "k.txt": "overwrite", "n.txt": "recreate", "u.txt": "recreate" });
  const { take, drop } = restoreSteps(plan);
  git("--literal-pathspecs", "restore", `--source=${commit}`, "--worktree", "--", ...take);
  execFileSync("rm", ["-f", "--", ...drop], { cwd: dir });
  assert.equal(read("a.txt"), "a changed\n"); assert.equal(read("u.txt"), "untracked\n"); assert.equal(read("n.txt"), "new\n"); assert.equal(read("k.txt"), "k staged, then more\n");
  assert.equal(existsSync(join(dir, "d.txt")), false);
  assert.deepEqual(restorePlan(sh(["-c", CHECK_SH, "sh", commit, ...d.files.map((f) => f.path)])).map((p) => p.action), ["same", "same", "same", "same", "same"]);
});

test("revert all's snapshot, a repo without commits, a conflict, odd names", () => {
  const { git, write, sh } = repo();
  write("odd name*.txt", "1\n"); write("tab\there.txt", "t\n");
  // No commit yet: the snapshot has no parent.
  const first = sh(snapshotArgs({ mode: "all", ref: `${DISCARDED}1`, message: "Revert all" })).trim();
  let [d] = parseDiscarded(sh(["-c", LIST_SH]));
  assert.equal(d.commit, first);
  assert.deepEqual(d.files.map((f) => f.path).sort(), ["odd name*.txt", "tab\there.txt"]);
  git("add", "-A"); git("commit", "-qm", "init");
  // A conflict: the index can't be written as a tree, the snapshot is still made.
  git("switch", "-q", "-c", "side"); write("odd name*.txt", "side\n"); git("commit", "-qam", "side");
  git("switch", "-q", "main"); write("odd name*.txt", "main\n"); git("commit", "-qam", "main");
  spawnSync("git", ["merge", "-q", "side"], { cwd: git("rev-parse", "--show-toplevel").trim() });
  assert.match(git("status", "--porcelain"), /^UU /m);
  const c = sh(snapshotArgs({ mode: "all", ref: `${DISCARDED}2`, message: "Revert all" })).trim();
  assert.match(git("show", `${c}:odd name*.txt`), /<<<<<<<|=======/);
  assert.equal(git("rev-list", "--parents", "-n", "1", c).trim().split(" ").length, 2, "HEAD only: the index had conflicts");
  assert.match(git("status", "--porcelain"), /^UU /m, "the conflict is untouched");
});

test("only the newest 50 snapshots stay", () => {
  const { git, write, sh } = repo();
  write("a", "1\n"); git("add", "-A"); git("commit", "-qm", "init"); write("a", "2\n");
  const tree = git("rev-parse", "HEAD").trim();
  for (let i = 0; i < KEEP + 3; i++) git("update-ref", `${DISCARDED}${1000 + i}`, tree);
  sh(snapshotArgs({ mode: "paths", ref: `${DISCARDED}2000`, message: "Revert a", paths: ["a"] }));
  const refs = git("for-each-ref", "--format=%(refname)", DISCARDED).trim().split("\n");
  assert.equal(refs.length, KEEP);
  assert.ok(refs.includes(`${DISCARDED}2000`));
  assert.ok(!refs.includes(`${DISCARDED}1000`) && !refs.includes(`${DISCARDED}1003`) && refs.includes(`${DISCARDED}1004`));
});

test("how long ago", () => {
  const now = 10_000_000_000;
  assert.equal(ago(now - 10_000, now), "just now");
  assert.equal(ago(now - 5 * 60_000, now), "5 min ago");
  assert.equal(ago(now - 3 * 3600_000, now), "3 h ago");
  assert.equal(ago(now - 86400_000, now), "1 day ago");
  assert.equal(ago(now - 3 * 86400_000, now), "3 days ago");
});

test("Revert all's copy has an edit made in the same second as the last add, of the same size (racy git)", () => {
  const { dir, git, write, sh } = repo();
  write("e.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one");
  const t = Math.floor(Date.now() / 1000) - 100;
  write("e.txt", "two\n"); utimesSync(join(dir, "e.txt"), t, t); git("add", "e.txt");
  write("e.txt", "six\n"); utimesSync(join(dir, "e.txt"), t, t); utimesSync(join(dir, ".git", "index"), t, t);
  assert.match(git("--no-optional-locks", "status", "--porcelain"), /^MM e.txt/m);
  const commit = sh(snapshotArgs({ mode: "all", ref: `${DISCARDED}2000`, message: "Revert all" })).trim();
  assert.equal(git("show", `${commit}:e.txt`), "six\n", "the copy holds the file as it is, so a restore brings the edit back");
});
