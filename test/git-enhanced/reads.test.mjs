// The two scripts one look at a repository runs (reads.js), for real in temp repos, under the
// system's sh and under dash (a Linux machine's).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";

const { REPO_SH, parseRepo, TREE_SH, parseTree, records } = await mod("reads.js");
const SHELLS = ["sh", ...(existsSync("/bin/dash") ? ["/bin/dash"] : [])];
const tmp = () => tempDir("git-enhanced-reads-");
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const run = (shell, script, args, cwd) => spawnSync(shell, ["-c", script, "sh", ...args], { cwd, encoding: "utf8" });
const repo = () => {
  const d = tmp();
  git(d, "init", "-q", "-b", "main"); git(d, "config", "user.name", "t"); git(d, "config", "user.email", "t@t");
  return d;
};

test("records: names and values, NULs and newlines kept", () => {
  assert.deepEqual(records("\x1ea\none\n\x1eb\n\x1ec\nx\0y\0"), { a: "one\n", b: "", c: "x\0y\0" });
  assert.deepEqual(records(""), {});
});

for (const shell of SHELLS) {
  test(`REPO_SH (${shell}): a fresh repository, then a branch with an upstream, a base, a stash and a merge in progress`, () => {
    const d = repo();
    let r = run(shell, REPO_SH, [""], d);
    assert.equal(r.status, 0, r.stderr);
    let f = parseRepo(r.stdout);
    assert.deepEqual({ head: f.head, branch: f.branch, upstream: f.upstream, parent: f.parent, base: f.base, merge: f.merge, operation: f.operation, stashes: f.stashes },
      { head: null, branch: "main", upstream: null, parent: null, base: null, merge: null, operation: null, stashes: [] });
    writeFileSync(join(d, "a.txt"), "1\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "one");
    writeFileSync(join(d, "a.txt"), "2\n"); git(d, "commit", "-qam", "two");
    const origin = tmp(); git(origin, "init", "-q", "--bare");
    git(d, "remote", "add", "origin", origin); git(d, "push", "-q", "-u", "origin", "main");
    git(d, "switch", "-q", "-c", "feature");
    writeFileSync(join(d, "b.txt"), "b\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "three");
    git(d, "push", "-q", "-u", "origin", "feature");
    writeFileSync(join(d, "c.txt"), "c\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "four");
    writeFileSync(join(d, "a.txt"), "stashed\n"); git(d, "stash", "push", "-q", "-m", "wip");
    f = parseRepo(run(shell, REPO_SH, [""], d).stdout);
    assert.equal(f.branch, "feature"); assert.equal(f.upstream, "origin/feature");
    assert.equal(f.ahead, 1); assert.equal(f.behind, 0); assert.equal(f.remote, "origin");
    assert.equal(f.head, git(d, "rev-parse", "HEAD").trim()); assert.equal(f.parent, git(d, "rev-parse", "HEAD~1").trim());
    assert.equal(f.base, "main", "no origin/HEAD here: main");
    assert.equal(f.merge, git(d, "rev-parse", "main").trim());
    assert.equal(f.stashes.length, 1); assert.equal(f.stashes[0].message, "wip"); assert.equal(f.stashes[0].branch, "feature");
    // A base given (props.base) wins; a merge stopped on a conflict shows.
    assert.equal(parseRepo(run(shell, REPO_SH, ["origin/main"], d).stdout).base, "origin/main");
    git(d, "switch", "-q", "main"); writeFileSync(join(d, "c.txt"), "other\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "conflicting");
    spawnSync("git", ["merge", "-q", "feature"], { cwd: d });
    f = parseRepo(run(shell, REPO_SH, [""], d).stdout);
    assert.equal(f.operation, "merge");
    assert.equal(f.upstream, "origin/main"); assert.equal(f.ahead, 1);
    // Not a repository: exit 3.
    assert.equal(run(shell, REPO_SH, [""], tmp()).status, 3);
  });

  test(`TREE_SH (${shell}): status, staged and unstaged numbers, a scope's files; renames`, () => {
    const d = repo();
    writeFileSync(join(d, "a.txt"), "1\n2\n"); writeFileSync(join(d, "old.txt"), "x\ny\nz\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "one");
    const base = git(d, "rev-parse", "HEAD").trim();
    writeFileSync(join(d, "a.txt"), "1\n2\n3\n"); git(d, "add", "a.txt"); writeFileSync(join(d, "a.txt"), "0\n2\n3\n");
    git(d, "mv", "old.txt", "new name.txt");
    mkdirSync(join(d, "dir")); writeFileSync(join(d, "dir", "u.txt"), "u\n");
    let t = parseTree(run(shell, TREE_SH, ["", ""], d).stdout);
    assert.deepEqual(t.entries.map((e) => [e.xy, e.path, e.from]), [["MM", "a.txt", null], ["R ", "new name.txt", "old.txt"], ["??", "dir/u.txt", null]]);
    assert.deepEqual(t.staged.get("a.txt"), { add: 1, del: 0, binary: false, from: null });
    assert.equal(t.staged.get("new name.txt").from, "old.txt");
    assert.deepEqual(t.unstaged.get("a.txt"), { add: 1, del: 1, binary: false, from: null });
    assert.equal(t.scope, null); assert.equal(t.names, null);
    // A scope against a ref, and two snapshots (a commit: no working tree numbers).
    t = parseTree(run(shell, TREE_SH, [base, ""], d).stdout);
    assert.deepEqual(t.scope.get("a.txt"), { add: 2, del: 1, binary: false, from: null }, "HEAD against the working tree");
    assert.deepEqual(t.names.map((n) => [n.status, n.path]), [["M", "a.txt"], ["R", "new name.txt"]]);
    git(d, "commit", "-qam", "two");
    const two = git(d, "rev-parse", "HEAD").trim();
    t = parseTree(run(shell, TREE_SH, [base, two], d).stdout);
    assert.equal(t.staged, null); assert.equal(t.unstaged, null);
    assert.deepEqual(t.names.map((n) => n.path).sort(), ["a.txt", "new name.txt"]);
  });
}
