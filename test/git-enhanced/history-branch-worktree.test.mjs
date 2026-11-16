// History and a branch checked out in another worktree. Its branch menu (which history it shows)
// says where such a branch is checked out, read when the menu opens (checking a branch out there moves
// no ref here), and a click still shows that branch's history. A label's menu (historyacts.js
// refFlow): Go to its worktree instead of Check out, which git refuses, and Delete… removes or
// detaches that worktree first (wtbranch.js); a remote branch whose local branch is checked out there
// goes to that worktree too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, realpathSync, existsSync } from "node:fs";
import { join } from "node:path";
import { state, mount, draw, byId, handler, press, texts, walk, settle, makeCx } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";
import { answer } from "./answers.mjs";

const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const cfg = (d) => { for (const [k, v] of [["user.name", "t"], ["user.email", "t@t"], ["core.hooksPath", "/dev/null"]]) sh(d, "config", k, v); };
const commit = (d, file, text, msg) => { writeFileSync(join(d, file), text); sh(d, "add", "-A"); sh(d, "commit", "-qm", msg); };

// lantern (main, pushed) with side (pushed, tracking origin/side) checked out in lantern-side, and
// lonely checked out nowhere.
function repos() {
  const base = realpathSync(tempDir("git-enhanced-hist-wt-")), A = join(base, "lantern"), side = join(base, "lantern-side");
  sh(base, "init", "-q", "--bare", "-b", "main", "origin.git");
  sh(base, "clone", "-q", "origin.git", "lantern"); cfg(A);
  commit(A, "f.txt", "one\n", "First"); sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  sh(A, "switch", "-qc", "side"); commit(A, "s.txt", "s\n", "Side work"); sh(A, "push", "-q", "-u", "origin", "side");
  sh(A, "switch", "-qc", "lonely", "main"); commit(A, "l.txt", "l\n", "Lonely"); sh(A, "switch", "-q", "main");
  sh(A, "worktree", "add", "-q", side, "side");
  return { A, side };
}
const popover = (tree, id) => { let hit = null; walk(tree, (n) => { if (n.popover === id) hit ??= n; }); return hit; };
const words = (d) => texts({ $: d }).filter((w) => w.trim());

test("History's branch menu says where a branch is checked out in another worktree, and a click still shows its history", async () => {
  const { A, side } = repos();
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  handler(popover(await draw(view), "history-branches"), "on_open_change")(true, makeCx()); await settle();
  const tree = await draw(view), row = (name) => byId(tree, `history-branch-${h.branchNames.indexOf(name)}`);
  assert.deepEqual(words(row("side")), ["side", `Checked out in ${side}`]);
  assert.deepEqual(words(row("main")), ["main", "checked out"]);
  assert.deepEqual(words(row("lonely")), ["lonely"]);
  state.runs.length = 0;
  press(row("side")); await settle();
  assert.match(h.query, /branch:side/);
  assert.ok(h.commits.some((c) => c.subject === "Side work"));
  assert.deepEqual(state.runs.filter(([n]) => n.startsWith("space.")), [], "it shows the history, it doesn't go there");
  assert.deepEqual(state.violations, []);
});

test("History's label menu: Go to its worktree instead of Check out, also from its remote branch; Delete… detaches that worktree first", async () => {
  const { A, side } = repos();
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  const menuOf = async (ref) => { h.refMenu(ref, makeCx()); await settle(); return state.overlays.at(-1).props.question; };
  let menu = await menuOf({ kind: "branch", name: "side", current: false });
  assert.deepEqual(menu.items.map((x) => x.id), ["worktree", "merge", "rebase", "push", "upstream", "rename", "delete"]);
  assert.deepEqual([menu.items[0].label, menu.items[0].detail], ["Go to its worktree", `Checked out in ${side}`]);
  state.runs.length = 0;
  await answer({ pick: "worktree" });
  assert.deepEqual(state.runs.filter(([n]) => n.startsWith("space.")), [["space.new", { folder: side }]]);
  // origin/side: its local branch side is checked out there.
  menu = await menuOf({ kind: "remote", name: "origin/side", current: false });
  assert.deepEqual(menu.items.map((x) => x.id), ["worktree", "fetch", "delete-remote"]);
  assert.deepEqual([menu.items[0].label, menu.items[0].detail], ["Go to side's worktree", `Checked out in ${side}`]);
  await answer({ cancel: true });
  // lonely, checked out nowhere: Check out as before.
  menu = await menuOf({ kind: "branch", name: "lonely", current: false });
  assert.equal(menu.items[0].id, "checkout");
  await answer({ cancel: true });
  // Delete… on side: detach that worktree, then git branch -d (side is merged into origin/side).
  await menuOf({ kind: "branch", name: "side", current: false });
  await answer({ pick: "delete" });
  await answer({ pick: "detach" });
  const { spec } = await answer();
  assert.equal(spec.title, `Detach the worktree at ${side} and delete side?`);
  assert.equal(sh(A, "branch", "--list", "side"), "", "deleted");
  assert.equal(existsSync(join(side, "s.txt")), true, "its folder stays");
  assert.deepEqual(state.violations, []);
});

test("changes: a remote branch whose local branch is checked out in another worktree says so, and a click goes there", async () => {
  const { A, side } = repos();
  const view = await mount(A), page = view.part;
  page.openBranches(true, makeCx()); await settle();
  const tree = await draw(view), i = page.remoteBranches.findIndex((rb) => rb.name === "origin/side");
  assert.ok(i >= 0);
  assert.ok(words(byId(tree, `remote-branch-${i}`)).some((x) => x.endsWith(`· local side · Checked out in ${side}`)), words(byId(tree, `remote-branch-${i}`)).join(" | "));
  state.runs.length = 0;
  handler(byId(tree, `remote-branch-${i}`), "on_click")({}, makeCx()); await settle();
  assert.deepEqual(state.runs.filter(([n]) => n.startsWith("space.")), [["space.new", { folder: side }]]);
  assert.equal(sh(A, "rev-parse", "--abbrev-ref", "HEAD").trim(), "main", "no switch");
  assert.deepEqual(state.violations, []);
});
