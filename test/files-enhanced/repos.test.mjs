import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { KEEP, findArgs, reposOf, repoFor, branchOf, mergeRepos } = await mod("repos.js");
const { parseStatus } = await mod("gitstatus.js");

test("find's output: the repositories, shallowest first, at most 20, the root's own left out", () => {
  assert.deepEqual(reposOf("./.git\n./b/.git\n./a/.git\n./a/vendor/c/.git\n./node_modules/x/.git\n./d/.gitkeep\n"), ["a", "b", "a/vendor/c"]);
  assert.equal(reposOf(Array.from({ length: 30 }, (_, i) => `./r${String(i).padStart(2, "0")}/.git`).join("\n")).length, 20);
  assert.deepEqual(reposOf(""), []);
});

const DASH = existsSync("/bin/dash") ? "/bin/dash" : null;

test("findArgs: .git entries `depth` folders down, not into node_modules or .git, kept by KEEP", () => {
  assert.deepEqual(findArgs(1), [".", "-maxdepth", "2", "(", "-name", "node_modules", "-prune", ")", "-o", "(", "-name", ".git", "-prune", "-exec", "sh", "-c", KEEP, "sh", "{}", "+", ")"]);
  // POSIX sh only: no bash or perl in it.
  assert.doesNotMatch(KEEP, /\[\[|perl|bash|\$'|local |function /);
});

test("find runs and finds nested repositories and submodules (a .git file), not inside node_modules", () => {
  const d = tempDir("files-enhanced-test-repos-");
  for (const p of [".git", "a/.git", "a/sub", "b/deep/.git", "node_modules/x/.git", "c", "w"]) mkdirSync(join(d, p), { recursive: true });
  for (const g of [".git", "a/.git", "b/deep/.git", "node_modules/x/.git"]) writeFileSync(join(d, g, "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(d, "a/sub/.git"), "gitdir: ../.git/modules/sub\n");
  writeFileSync(join(d, "w/.git"), "gitdir: /r/.git/worktrees/w"); // a worktree's, no newline at its end
  // Not repositories: a .git folder with only GitKraken's gk/, .git files that don't start with "gitdir: ".
  mkdirSync(join(d, "gk/.git/gk"), { recursive: true }); writeFileSync(join(d, "gk/.git/gk/config"), "{}\n");
  mkdirSync(join(d, "n")); writeFileSync(join(d, "n/.git"), "notes\ngitdir: ../x\n");
  mkdirSync(join(d, "e")); writeFileSync(join(d, "e/.git"), "");
  const run = (depth, shell = "sh") => reposOf(execFileSync("find", findArgs(depth).map((a, i, all) => (a === "sh" && all[i - 1] === "-exec" ? shell : a)), { cwd: d, encoding: "utf8" }));
  assert.deepEqual(run(1), ["a", "w"]);
  assert.deepEqual(run(2), ["a", "w", "a/sub", "b/deep"]);
  assert.deepEqual(run(0), []);
  if (DASH) assert.deepEqual(run(2, DASH), run(2));
  // The root's own .git is printed (and left out by reposOf) only when it is one too.
  assert.equal(execFileSync("find", findArgs(0), { cwd: d, encoding: "utf8" }), "./.git\n");
});

test("KEEP prints only the repositories' .git entries, a line each, and exits 0", () => {
  const d = tempDir("files-enhanced-test-keep-");
  mkdirSync(join(d, "a/.git"), { recursive: true }); writeFileSync(join(d, "a/.git/HEAD"), "ref: refs/heads/main\n");
  mkdirSync(join(d, "b/.git/gk"), { recursive: true });
  mkdirSync(join(d, "c")); writeFileSync(join(d, "c/.git"), "gitdir: ../a/.git");
  mkdirSync(join(d, "d")); writeFileSync(join(d, "d/.git"), "nope\n");
  const paths = ["a", "b", "c", "d", "gone"].map(x => join(d, x, ".git"));
  for (const shell of ["sh", ...(DASH ? [DASH] : [])]) {
    // The last entry not kept: still exit 0.
    assert.equal(execFileSync(shell, ["-c", KEEP, "sh", ...paths], { encoding: "utf8" }), `${join(d, "a/.git")}\n${join(d, "c/.git")}\n`, shell);
  }
});

test("a path's repository is the deepest holding it", () => {
  const roots = ["a", "a/sub", "ab"];
  assert.equal(repoFor("a/x.js", roots), "a");
  assert.equal(repoFor("a/sub/y.js", roots), "a/sub");
  assert.equal(repoFor("a/sub", roots), "a/sub");
  assert.equal(repoFor("ab/z", roots), "ab");
  assert.equal(repoFor("top.txt", roots), "");
});

test("branches", () => {
  assert.equal(branchOf("## main...origin/main [ahead 1]\0 M a\0"), "main");
  assert.equal(branchOf("## feature/x\0"), "feature/x");
  assert.equal(branchOf("## HEAD (no branch)\0"), "detached");
  assert.equal(branchOf("## No commits yet on trunk\0"), "trunk");
  assert.equal(branchOf(" M a\0"), null);
});

test("each file's mark from its own repository; the outer one's line for a nested folder stays", () => {
  const z = (...e) => e.join("\0") + "\0";
  const own = parseStatus(z("## main", " M top.txt", "?? lib/", " M sub", "!! build/"), "/r", "/r");
  const lib = parseStatus(z("## dev", " M src/x.js", "?? new.txt", "!! dist/"), "/r/lib", "/r");
  const sub = parseStatus(z("## HEAD (no branch)", " D gone.c"), "/r/sub", "/r");
  const out = mergeRepos([{ root: "", ...own }, { root: "lib", ...lib }, { root: "sub", ...sub }]);
  assert.deepEqual(out.marks, { "top.txt": "M", "lib": "A", "sub": "M", "lib/src/x.js": "M", "lib/new.txt": "A", "sub/gone.c": "D", "dir:lib": "M", "dir:lib/src": "M", "dir:sub": "D" });
  assert.deepEqual([...out.ignored].sort(), ["build", "lib/dist"]);
  // A root that isn't a repository: only the nested ones.
  assert.deepEqual(mergeRepos([{ root: "lib", ...lib }]).marks, { "lib/src/x.js": "M", "lib/new.txt": "A", "dir:lib": "M", "dir:lib/src": "M" });
});
