// A branch checked out in another worktree, in the Changes page's branch picker: its second line says
// where ("Checked out in <folder>"), and a click goes to the space in that worktree (or opens one)
// instead of switching, which git refuses ("already used by worktree"). A worktree whose folder is
// gone keeps its branch until git forgets it: "· folder gone", and a click asks to forget it. The
// helpers: worktrees.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { state, mount, draw, byId, handler, texts, settle, makeCx, load, overlay, drawWith } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const W = await load("worktrees.js");
const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("worktrees: the branches checked out elsewhere, ~ for the home folder, and the space in a worktree", () => {
  const list = [
    { path: "/r/main", branch: "main" }, { path: "/r/side", branch: "side" }, { path: "/r/side/inner", branch: "inner" },
    { path: "/r/gone", branch: "gone", prunable: true }, { path: "/r/detached", branch: null, detached: true },
  ];
  const paths = (m) => [...m].map(([b, w]) => [b, w.path]);
  assert.deepEqual(paths(W.elsewhere(list, "/r/main")), [["side", "/r/side"], ["inner", "/r/side/inner"], ["gone", "/r/gone"]], "not this one, not a detached one; a gone one keeps its branch");
  assert.deepEqual(paths(W.elsewhere(list, "/r/side\n")), [["main", "/r/main"], ["inner", "/r/side/inner"], ["gone", "/r/gone"]]);
  assert.equal(W.whereWords(W.elsewhere(list, "/r/main").get("side"), "~/side"), "Checked out in ~/side");
  assert.equal(W.whereWords(W.elsewhere(list, "/r/main").get("gone"), "~/gone"), "Checked out in ~/gone · folder gone");
  assert.equal(W.tilde("/Users/x/.herdr/worktrees/r/side", "/Users/x/"), "~/.herdr/worktrees/r/side");
  assert.equal(W.tilde("/Users/xy/r", "/Users/x"), "/Users/xy/r", "only the home folder itself");
  assert.equal(W.tilde("/srv/r", null), "/srv/r");
  const spaceList = [
    { id: "inner", folder: "/r/side/inner/src", machine: null },
    { id: "far", folder: "/r/side", machine: "build-runner-eu-west-17" },
    { id: "moved", folder: "/elsewhere", machine: null, tabs: [{ id: "t9" }] },
  ];
  const paneList = [{ tab: "t9", cwd: "/r/side/src" }];
  assert.equal(W.spaceFor("/r/side", list, null, spaceList, paneList)?.id, "moved", "where its terminal is now, not in the worktree inside it");
  assert.equal(W.spaceFor("/r/side", list, "build-runner-eu-west-17", spaceList, paneList)?.id, "far", "on its machine");
  assert.equal(W.spaceFor("/r/side/inner", list, null, spaceList, paneList)?.id, "inner");
  assert.equal(W.spaceFor("/r/none", list, null, spaceList, paneList), undefined);
});

test("changes: the picker marks a branch checked out in another worktree, and a click goes there instead of switching", async () => {
  const base = realpathSync(tempDir("git-enhanced-branch-wt-")), A = join(base, "lantern"), side = join(base, "lantern-side");
  sh(base, "init", "-q", "-b", "main", "lantern");
  sh(A, "config", "user.name", "t"); sh(A, "config", "user.email", "t@t"); sh(A, "config", "core.hooksPath", "/dev/null");
  writeFileSync(join(A, "f.txt"), "one\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "First");
  sh(A, "branch", "side"); sh(A, "branch", "topic");
  sh(A, "worktree", "add", "-q", side, "side");
  const view = await mount(A), page = view.part;
  page.openBranches(true, makeCx()); await settle();
  let tree = await draw(view);
  const row = (name) => byId(tree, `branch-${page.branches.findIndex((b) => b.name === name)}`);
  assert.ok(texts(row("side")).includes(`Checked out in ${side}`), texts(row("side")).join(" | "));
  assert.ok(!texts(row("topic")).some((x) => x.startsWith("Checked out")), "a branch checked out nowhere");
  assert.ok(!texts(row("main")).some((x) => x.startsWith("Checked out")), "the one checked out here has its tick");
  // No space is in that worktree: a new one there; this worktree stays on main.
  state.runs.length = 0;
  handler(row("side"), "on_click")({}, makeCx()); await settle();
  assert.deepEqual(state.runs.filter(([n]) => n.startsWith("space.")), [["space.new", { folder: side }]]);
  assert.equal(sh(A, "rev-parse", "--abbrev-ref", "HEAD").trim(), "main", "no switch");
  assert.equal(page.choosingBranch, false, "the picker closes");
  // A space in it: that space.
  state.spaces = [...state.spaces, { id: "s2", folder: side, machine: null }];
  page.openBranches(true, makeCx()); await settle();
  tree = await draw(view); state.runs.length = 0;
  handler(row("side"), "on_click")({}, makeCx()); await settle();
  assert.deepEqual(state.runs.filter(([n]) => n.startsWith("space.")), [["space.select", { id: "s2" }]]);
  // A branch checked out nowhere still switches.
  page.openBranches(true, makeCx()); await settle();
  tree = await draw(view);
  handler(row("topic"), "on_click")({}, makeCx()); await settle();
  assert.equal(sh(A, "rev-parse", "--abbrev-ref", "HEAD").trim(), "topic");
  assert.deepEqual(state.violations, []);
});

test("changes: a branch whose worktree's folder is gone says so, and a click asks to forget the missing worktrees, then it switches", async () => {
  const base = realpathSync(tempDir("git-enhanced-branch-wt-gone-")), A = join(base, "lantern"), side = join(base, "lantern-side");
  sh(base, "init", "-q", "-b", "main", "lantern");
  sh(A, "config", "user.name", "t"); sh(A, "config", "user.email", "t@t"); sh(A, "config", "core.hooksPath", "/dev/null");
  writeFileSync(join(A, "f.txt"), "one\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "First");
  sh(A, "branch", "side"); sh(A, "worktree", "add", "-q", side, "side");
  rmSync(side, { recursive: true, force: true });
  const view = await mount(A), page = view.part;
  page.openBranches(true, makeCx()); await settle();
  let tree = await draw(view);
  const row = () => byId(tree, `branch-${page.branches.findIndex((b) => b.name === "side")}`);
  assert.ok(texts(row()).includes(`Checked out in ${side} · folder gone`), texts(row()).join(" | "));
  state.runs.length = 0;
  handler(row(), "on_click")({}, makeCx()); await settle();
  assert.deepEqual(state.runs.filter(([n]) => n.startsWith("space.")), [], "no space for a folder that is gone");
  const spec = state.overlays.at(-1);
  assert.match(spec?.props?.question?.title ?? "", /^Forget the worktrees whose folders are gone/);
  const { view: q, props } = overlay(spec);
  handler(byId(drawWith(q, props), "question-confirm"), "on_click")({}, makeCx());
  state.props = { palette: "theme" };
  await settle();
  assert.equal(sh(A, "worktree", "list", "--porcelain").includes(side), false, "forgotten");
  // Free now: a click switches.
  page.openBranches(true, makeCx()); await settle();
  tree = await draw(view);
  assert.ok(!texts(row()).some((x) => x.startsWith("Checked out")), texts(row()).join(" | "));
  handler(row(), "on_click")({}, makeCx()); await settle();
  assert.equal(sh(A, "rev-parse", "--abbrev-ref", "HEAD").trim(), "side");
  assert.deepEqual(state.violations, []);
});
