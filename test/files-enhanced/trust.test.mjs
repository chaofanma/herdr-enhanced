// Files' git marks from the repositories below the root (repotrust.js, gittrust.js): one whose own
// git config has a setting beyond the usual ones gives no marks and shows "Not read" with Read it on
// its folder's row; Read it trusts it (by its config's fingerprint) and the marks come; a changed
// config asks again. The repository the root is in is always read. Every git the tree runs carries
// SAFE_ARGS (no fsmonitor, no hooks).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { state, makeCx, settle, load, folder, at, draw, byId, text, press } from "./render/load.mjs";

const { default: Files } = await load("main.js");
const { SAFE_ARGS } = await load("gittrust.js");
const { TRUSTED, checks } = await load("repotrust.js");

const git = (dir, ...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, stdio: "pipe" });
async function open(dir) {
  at(dir);
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle();
  return { view, tree: view.role, root: () => draw(view) };
}
const tipOf = (node) => node?.$.handlers.tooltip?.at(-1)?.[0];
const withSafe = (a) => a.join("\0").includes(SAFE_ARGS.join("\0"));

test("a repository below the root with a setting beyond the usual ones: no marks, Not read and Read it on its row; trusted, its marks; a changed config asks again", async () => {
  state.shared.clear(); checks.clear(); state.violations.length = 0;
  const dir = folder(["a/x.txt", "b/y.txt"]);
  for (const r of ["a", "b"]) { git(`${dir}/${r}`, "-c", "init.defaultBranch=main", "init", "-q"); git(`${dir}/${r}`, "add", "."); git(`${dir}/${r}`, "commit", "-qm", "x"); }
  git(`${dir}/b`, "config", "filter.secret.clean", "cat");
  writeFileSync(`${dir}/a/x.txt`, "changed"); writeFileSync(`${dir}/b/y.txt`, "changed");
  state.execLog.length = 0;
  const { tree, root } = await open(dir);
  root(); await settle();
  assert.equal(tree.marks["a/x.txt"], "M");
  assert.equal(tree.marks["b/y.txt"], undefined, "b isn't read");
  assert.equal(tree.marks["dir:b"], undefined);
  assert.deepEqual([...tree.repos.keys()], ["a"], "no branch badge for b");
  let bar = byId(root(), "repo-b-not-read");
  assert.ok(bar, "Not read on b's row"); assert.match(text(bar), /Not read/);
  assert.match(tipOf(bar), /filter\.secret\.clean/);
  assert.ok(byId(root(), "repo-b-read-it"));
  assert.ok(!byId(root(), "repo-a-not-read"));
  assert.deepEqual(state.execLog.filter(([c, , cwd]) => c === "git" && cwd === `${dir}/b`), [], "no git ran in b");
  const gits = state.execLog.filter(([c]) => c === "git");
  assert.ok(gits.length > 0 && gits.every(([, a]) => withSafe(a)), "every git with SAFE_ARGS");
  // Read it: trusted, read.
  press(byId(root(), "repo-b-read-it")); await settle(); root(); await settle();
  assert.equal(state.shared.get(TRUSTED)?.[`:${dir}/b`], checks.get(`${dir}/b`).fingerprint);
  assert.equal(tree.marks["b/y.txt"], "M");
  assert.deepEqual([...tree.repos.keys()].sort(), ["a", "b"]);
  assert.ok(!byId(root(), "repo-b-not-read"));
  // Its config changes: asked again (once the check is looked at again: 30 s, here at once).
  git(`${dir}/b`, "config", "filter.other.clean", "cat");
  checks.clear(); tree.refresh(makeCx()); await settle(); root(); await settle();
  assert.equal(tree.marks["b/y.txt"], undefined);
  bar = byId(root(), "repo-b-not-read");
  assert.ok(bar); assert.match(tipOf(bar), /filter\.other\.clean/);
  assert.deepEqual(state.violations, []);
});

test("the repository the root is in is read whatever its config", async () => {
  state.shared.clear(); checks.clear();
  const dir = folder(["x.txt"]);
  git(dir, "-c", "init.defaultBranch=main", "init", "-q"); git(dir, "add", "."); git(dir, "commit", "-qm", "x");
  git(dir, "config", "filter.secret.clean", "cat");
  writeFileSync(`${dir}/x.txt`, "changed");
  const { tree, root } = await open(dir);
  root(); await settle();
  assert.equal(tree.marks["x.txt"], "M");
  assert.ok(!byId(root(), /-not-read$/));
});
