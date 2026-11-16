// History's branch menu: one button that says which history it shows (the current branch with its
// upstream, All branches, or one branch), its menu offering the three, and HEAD its own button. There
// was an All branches button beside Branch ▾ that did nothing while a branch was picked, lit all the
// same. And a log that took long in a repository without git's commit-graph (every page reads the
// whole history then): a line offers to write it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { mount, draw, byId, handler, press, texts, walk, settle, makeCx } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const cfg = (d) => { sh(d, "config", "user.name", "Tess"); sh(d, "config", "user.email", "tess@x"); sh(d, "config", "core.hooksPath", "/dev/null"); };
const commit = (dir, file, text, msg) => { writeFileSync(join(dir, file), text); sh(dir, "add", "-A"); sh(dir, "commit", "-qm", msg); return sh(dir, "rev-parse", "HEAD").trim(); };
function repos() {
  const base = tempDir("git-enhanced-hbranch-");
  sh(base, "init", "-q", "--bare", "-b", "main", "remote.git");
  sh(base, "clone", "-q", "remote.git", "a"); const A = join(base, "a"); cfg(A);
  const first = commit(A, "f.txt", "one\n", "First");
  sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  commit(A, "g.txt", "g\n", "Second");
  sh(A, "switch", "-qc", "lonely", first); commit(A, "l.txt", "l\n", "Lonely branch"); sh(A, "switch", "-q", "main");
  return { A };
}
const popover = (tree, id) => { let hit = null; walk(tree, (n) => { if (n.popover === id) hit ??= n; }); return hit; };
// The branch button's words, then ▾ when it ends with Herdr's chevron (the drop-down's mark).
const label = (tree) => {
  const d = byId(tree, "history-branch");
  let mark = false;
  walk({ $: d }, (x) => { if (x.kind === "svg" && x.path === "mods/workspace-chrome/chevron-down.svg") mark = true; });
  return texts({ $: d }).join("") + (mark ? " ▾" : "");
};
// Whether a row shows the check icon (the mark of the one in use).
const ticked = (d) => { let hit = false; walk({ $: d }, (x) => { if (x.kind === "svg" && /check\.svg$/.test(x.path)) hit = true; }); return hit; };

test("one branch menu: its button says what History shows; Current branch, All branches and each branch; HEAD its own button", async () => {
  const { A } = repos();
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  let tree = await draw(view);
  assert.equal(byId(tree, /^history-all-/), null, "no All branches button of its own");
  assert.ok(byId(tree, "history-head"), "HEAD stays");
  assert.equal(label(tree), "main ▾", "the current branch");
  const menu = async () => { handler(popover(await draw(view), "history-branches"), "on_open_change")(true, makeCx()); return draw(view); };
  tree = await menu();
  assert.deepEqual(texts({ $: byId(tree, "history-branch-head") }).filter((w) => w.trim()), ["Current branch", "main and origin/main"]);
  assert.ok(ticked(byId(tree, "history-branch-head")) && !ticked(byId(tree, "history-branch-all")), "Current branch ticked");
  assert.deepEqual(texts({ $: byId(tree, "history-branch-all") }).filter((w) => w.trim()), ["All branches", "Every branch, remote branch and tag"]);
  // All branches: every branch's commits; the button says so.
  press(byId(tree, "history-branch-all")); await settle();
  assert.equal(h.all, true);
  assert.ok(h.commits.some((c) => c.subject === "Lonely branch"));
  tree = await draw(view);
  assert.equal(label(tree), "All branches ▾");
  // One branch: only it (All branches off: the branch is what shows).
  tree = await menu();
  assert.ok(ticked(byId(tree, "history-branch-all")) && !ticked(byId(tree, "history-branch-head")), "All branches ticked");
  press(byId(tree, `history-branch-${h.branchNames.indexOf("lonely")}`)); await settle();
  assert.equal(h.all, false);
  assert.equal(h.search.value(), "branch:lonely");
  assert.deepEqual(h.commits.map((c) => c.subject), ["Lonely branch", "First"]);
  assert.equal(label(await draw(view)), "lonely ▾");
  // Back to the current branch.
  tree = await menu();
  press(byId(tree, "history-branch-head")); await settle();
  assert.equal(h.all, false);
  assert.equal(h.search.value(), "");
  assert.ok(!h.commits.some((c) => c.subject === "Lonely branch"));
  assert.equal(label(await draw(view)), "main ▾");
});

test("a slow log without git's commit-graph: a line offers Write it (git commit-graph write); written, the line is gone", async () => {
  const { A } = repos();
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  let tree = await draw(view);
  assert.equal(byId(tree, "history-slow"), null, "a small repository's log is quick: no line");
  h.slowLog = 0; h.reload(makeCx("async")); await settle();
  tree = await draw(view);
  const line = byId(tree, "history-slow");
  assert.ok(line, "the line");
  assert.match(texts({ $: line }).join(" "), /commit-graph/);
  press(byId(tree, "history-slow-write")); await settle();
  const path = sh(A, "rev-parse", "--git-path", "objects/info/commit-graph").trim();
  assert.ok(existsSync(isAbsolute(path) ? path : join(A, path)), "git's commit-graph written");
  tree = await draw(view);
  assert.equal(byId(tree, "history-slow"), null, "gone once written");
  assert.equal(h.line, null, h.line);
  // × hides it for this repository while it stays without one.
  const { A: B } = repos();
  const other = await mount(B, { palette: "theme", view: "history" }), o = other.part.history;
  o.slowLog = 0; o.reload(makeCx("async")); await settle();
  press(byId(await draw(other), "history-slow-close"));
  o.reload(makeCx("async")); await settle();
  assert.equal(byId(await draw(other), "history-slow"), null, "dismissed");
});
