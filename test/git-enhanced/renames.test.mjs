import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { parseStatusZ, parseNumstatZ, parseNameStatusZ, fromLabel, contentHeader, pathsOf } = await mod("renames.js");

function repo() {
  const dir = tempDir("git-enhanced-rename-");
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main"); git("config", "user.name", "t"); git("config", "user.email", "t@t");
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  writeFileSync(join(dir, "old.txt"), lines.join("\n") + "\n"); writeFileSync(join(dir, "keep.txt"), "k\n");
  git("add", "-A"); git("commit", "-qm", "init");
  return { dir, git, lines, write: (p, s) => writeFileSync(join(dir, p), s), read: (p) => readFileSync(join(dir, p), "utf8") };
}

test("git's -z outputs with a rename in them", () => {
  const { git, lines, write } = repo();
  git("mv", "old.txt", "new.txt");
  const staged = [...lines]; staged[4] = "line 5 changed"; write("new.txt", staged.join("\n") + "\n"); git("add", "new.txt");
  const more = [...staged]; more[24] = "line 25 changed"; write("new.txt", more.join("\n") + "\n");
  write("u.txt", "u\n");
  assert.deepEqual(parseStatusZ(git("status", "--porcelain=v1", "-z", "--renames", "--untracked-files=all")), [
    { xy: "RM", path: "new.txt", from: "old.txt" }, { xy: "??", path: "u.txt", from: null }]);
  assert.deepEqual([...parseNumstatZ(git("diff", "--cached", "--numstat", "-z", "-M"))], [["new.txt", { add: 1, del: 1, binary: false, from: "old.txt" }]]);
  assert.deepEqual([...parseNumstatZ(git("diff", "--numstat", "-z", "-M"))], [["new.txt", { add: 1, del: 1, binary: false, from: null }]]);
  assert.deepEqual(parseNameStatusZ(git("diff", "HEAD", "--name-status", "-z", "-M")), [{ status: "R", from: "old.txt", path: "new.txt" }]);
  // A rename in the working tree (intent-to-add): R second.
  git("reset", "-q"); git("add", "-N", "new.txt");
  assert.deepEqual(parseStatusZ(git("status", "--porcelain=v1", "-z", "--renames")).filter((e) => e.path !== "u.txt"), [{ xy: " R", path: "new.txt", from: "old.txt" }]);
  assert.deepEqual(parseNameStatusZ("M\0a b.txt\0A\0tab\there\0D\0gone\0"), [{ status: "M", path: "a b.txt", from: null }, { status: "A", path: "tab\there", from: null }, { status: "D", path: "gone", from: null }]);
  assert.deepEqual([...parseNumstatZ("-\t-\timg.png\0")], [["img.png", { add: 0, del: 0, binary: true, from: null }]]);
});

test("the old name in the list, and the paths an action names", () => {
  assert.equal(fromLabel("src/old.js", "src/new.js"), "old.js");
  assert.equal(fromLabel("lib/old.js", "src/new.js"), "lib/old.js");
  assert.equal(fromLabel("old.js", "new.js"), "old.js");
  assert.deepEqual(pathsOf("new", "old"), ["old", "new"]);
  assert.deepEqual(pathsOf("same", null), ["same"]);
});

test("a hunk of a staged rename unstages its content and keeps the rename", () => {
  const { git, lines, write } = repo();
  git("mv", "old.txt", "new.txt");
  const changed = [...lines]; changed[4] = "line 5 changed"; changed[24] = "line 25 changed"; write("new.txt", changed.join("\n") + "\n"); git("add", "new.txt");
  const diff = git("diff", "--cached", "-M", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--", "old.txt", "new.txt").replace(/\n$/, "").split("\n");
  const first = diff.findIndex((l) => l.startsWith("@@")), header = diff.slice(0, first);
  assert.ok(header.includes("rename from old.txt"));
  const plain = contentHeader(header, "new.txt");
  assert.deepEqual(plain, ["diff --git a/new.txt b/new.txt", "--- a/new.txt", "+++ b/new.txt"]);
  let end = first + 1; while (end < diff.length && !diff[end].startsWith("@@")) end++;
  const patch = [...plain, ...diff.slice(first, end)].join("\n") + "\n";
  const r = spawnSync("git", ["apply", "--cached", "-R", "--whitespace=nowarn"], { cwd: git("rev-parse", "--show-toplevel").trim(), input: patch, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(parseStatusZ(git("status", "--porcelain=v1", "-z", "--renames")), [{ xy: "RM", path: "new.txt", from: "old.txt" }], "still a rename");
  assert.equal(git("show", ":new.txt").split("\n")[4], "line 5", "that hunk unstaged");
  assert.equal(git("show", ":new.txt").split("\n")[24], "line 25 changed", "the other one not");
  assert.equal(contentHeader(["diff --git a/x b/x", "--- a/x", "+++ b/x"], "x").length, 3, "other headers as they are");
  assert.equal(contentHeader(["diff --git a/o b/\"n\\tx\"", "rename from o", "rename to \"n\\tx\""], "n\tx"), null, "a path git would quote: no patches");
});

test("stage, unstage, revert a rename as its two paths", () => {
  const { git, read } = repo();
  git("mv", "old.txt", "new.txt");
  git("--literal-pathspecs", "restore", "--staged", "--", ...pathsOf("new.txt", "old.txt"));
  assert.deepEqual(parseStatusZ(git("status", "--porcelain=v1", "-z", "--renames", "--untracked-files=all")).map((e) => `${e.xy} ${e.path}`), [" D old.txt", "?? new.txt"]);
  git("--literal-pathspecs", "add", "-A", "--", ...pathsOf("new.txt", "old.txt"));
  assert.deepEqual(parseStatusZ(git("status", "--porcelain=v1", "-z", "--renames")), [{ xy: "R ", path: "new.txt", from: "old.txt" }]);
  git("--literal-pathspecs", "restore", "--source=HEAD", "--staged", "--worktree", "--", ...pathsOf("new.txt", "old.txt"));
  assert.equal(git("status", "--porcelain=v1"), "");
  assert.match(read("old.txt"), /^line 1\n/);
});
