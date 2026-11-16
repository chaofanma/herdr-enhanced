// The Changes picker's right-click menu on a branch checked out in another worktree: "Go to its
// worktree" first (or, its folder gone, "Forget the missing worktrees…"); Fast-forward runs in that
// worktree (git merge --ff-only there), greyed while that worktree has changes; Delete… removes that
// worktree or detaches it, after one question that knows whether the branch is merged, then deletes
// the branch. The flows: wtbranch.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, realpathSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { state, mount, draw, byId, handler, settle, makeCx, load } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";
import { answer } from "./answers.mjs";

const WB = await load("wtbranch.js");
const sh = (cwd, ...a) => { try { return execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return `!${e.stdout ?? ""}${e.stderr ?? ""}`; } };
const cfg = (d) => { for (const [k, v] of [["user.name", "t"], ["user.email", "t@t"], ["core.hooksPath", "/dev/null"]]) sh(d, "config", k, v); };
const commit = (d, file, text, msg) => { writeFileSync(join(d, file), text); sh(d, "add", "-A"); sh(d, "commit", "-qm", msg); };

// lantern (main) with: side behind origin/side by 2, checked out in lantern-side; solo with a commit
// merged nowhere, in lantern-solo; lost, whose worktree's folder is gone; rb, being rebased in
// lantern-rb (stopped on a conflict).
function repos() {
  const base = realpathSync(tempDir("git-enhanced-wt-menu-")), A = join(base, "lantern"), O = join(base, "other");
  const at = { A, side: join(base, "lantern-side"), solo: join(base, "lantern-solo"), lost: join(base, "lantern-lost"), rb: join(base, "lantern-rb") };
  sh(base, "init", "-q", "--bare", "-b", "main", "origin.git");
  sh(base, "clone", "-q", "origin.git", "lantern"); cfg(A);
  commit(A, "f.txt", "one\n", "First"); sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  sh(A, "branch", "side"); sh(A, "push", "-q", "-u", "origin", "side");
  sh(base, "clone", "-q", "-b", "side", "origin.git", "other"); cfg(O);
  commit(O, "s.txt", "1\n", "S1"); commit(O, "s.txt", "2\n", "S2"); sh(O, "push", "-q");
  sh(A, "fetch", "-q");
  sh(A, "worktree", "add", "-q", at.side, "side");
  sh(A, "worktree", "add", "-q", "-b", "solo", at.solo); commit(at.solo, "o.txt", "o\n", "Solo");
  sh(A, "worktree", "add", "-q", "-b", "lost", at.lost); rmSync(at.lost, { recursive: true, force: true });
  sh(A, "worktree", "add", "-q", "-b", "rb", at.rb); commit(at.rb, "f.txt", "rb\n", "RB");
  commit(A, "f.txt", "main two\n", "Main two"); sh(at.rb, "rebase", "main");
  return { ...at, O };
}
// The right-click menu of branch `name` in the picker (its spec).
async function menuOf(view, name) {
  const page = view.part;
  page.openBranches(true, makeCx()); await settle();
  const tree = await draw(view), i = page.branches.findIndex((b) => b.name === name);
  assert.ok(i >= 0, `${name} listed`);
  handler(byId(tree, `branch-${i}`), "on_mouse_down")({}, makeCx());
  await settle();
  return state.overlays.at(-1).props.question;
}
const item = (spec, id) => spec.items.find((x) => x.id === id);

test("changes: a branch checked out elsewhere: Go to its worktree first, and Fast-forward runs there, greyed while that worktree has changes", async () => {
  const at = repos(), view = await mount(at.A);
  let spec = await menuOf(view, "side");
  assert.deepEqual(spec.items.slice(0, 3).map((x) => x.id), ["worktree", "rename", "delete"]);
  assert.equal(item(spec, "worktree").label, "Go to its worktree");
  assert.equal(item(spec, "worktree").detail, `Checked out in ${at.side}`);
  assert.equal(item(spec, "ff").disabled, undefined);
  assert.equal(item(spec, "ff").detail, `in ${at.side} · 2 commits behind`);
  await answer({ pick: "ff" });
  assert.equal(sh(at.side, "rev-parse", "HEAD"), sh(at.A, "rev-parse", "origin/side"), "the branch moved, in that worktree");
  assert.equal(sh(at.side, "status", "--porcelain"), "", "its files and index with it");
  // Behind again, and that worktree has a change to a tracked file: greyed, and why.
  commit(at.O, "s.txt", "3\n", "S3"); sh(at.O, "push", "-q"); sh(at.A, "fetch", "-q");
  writeFileSync(join(at.side, "s.txt"), "local edit\n");
  spec = await menuOf(view, "side");
  assert.equal(item(spec, "ff").disabled, true);
  assert.equal(item(spec, "ff").detail, `${at.side} has uncommitted changes`);
  await answer({ pick: "worktree" });
  assert.deepEqual(state.runs.filter(([n]) => n.startsWith("space.")).at(-1), ["space.new", { folder: at.side }]);
  // Being rebased there: its worktree first, saying so.
  spec = await menuOf(view, "rb");
  assert.equal(item(spec, "worktree").detail, `Being rebased in ${at.rb}`);
  // git won't rename it either ("is being rebased at …"): greyed, saying why.
  assert.deepEqual([item(spec, "rename").disabled, item(spec, "rename").detail], [true, `Being rebased in ${at.rb}: finish or abort it there first`]);
  await answer({ cancel: true });
  // Its folder gone: forget the missing worktrees; Delete… waits for that.
  spec = await menuOf(view, "lost");
  assert.deepEqual([spec.items[0].id, spec.items[0].label, spec.items[0].detail], ["forget", "Forget the missing worktrees…", `${at.lost} is gone`]);
  assert.deepEqual([item(spec, "delete").disabled, item(spec, "delete").detail], [true, "Its worktree's folder is gone: forget it first"]);
  await answer({ pick: "forget" });
  const { spec: q } = await answer();
  assert.match(q.title, /^Forget the worktrees whose folders are gone/);
  assert.ok(!sh(at.A, "worktree", "list", "--porcelain").includes(at.lost), "forgotten");
  assert.deepEqual(state.violations, []);
});

test("changes: Delete… on a branch checked out elsewhere detaches or removes that worktree after one question, then deletes the branch", async () => {
  const at = repos(), view = await mount(at.A);
  // side (merged into its upstream): detach, then git branch -d.
  await menuOf(view, "side");
  let { spec } = await answer({ pick: "delete" });
  assert.equal(state.overlays.at(-1).props.question.title, `side is checked out in ${at.side}`);
  ({ spec } = await answer({ pick: "detach" }));
  ({ spec } = await answer());
  assert.equal(spec.title, `Detach the worktree at ${at.side} and delete side?`);
  assert.equal(spec.confirm, "Detach and delete");
  assert.match(spec.detail, /git checkout --detach there\)\. Then git branch -d side\. Its remote branch origin\/side stays\.$/);
  assert.equal(sh(at.side, "symbolic-ref", "-q", "HEAD").startsWith("!"), true, "detached");
  assert.equal(existsSync(join(at.side, "f.txt")), true, "its files stay");
  assert.equal(sh(at.A, "branch", "--list", "side"), "", "deleted");
  // solo (merged nowhere), with a space in its worktree: remove it, closing the space, then -D.
  state.spaces = [...state.spaces, { id: "s-solo", name: "solo", folder: at.solo, machine: null, tabs: [] }];
  state.runs.length = 0;
  await menuOf(view, "solo");
  await answer({ pick: "delete" });
  await answer({ pick: "remove" });
  ({ spec } = await answer());
  assert.equal(spec.title, `Remove the worktree at ${at.solo} and delete solo?`);
  assert.equal(spec.confirm, "Remove and delete anyway");
  assert.match(spec.detail, /^Its folder goes\. The space solo closes first, with its terminals\. Then git branch -D solo: it isn't merged/);
  assert.deepEqual(state.runs.filter(([n]) => n === "space.close"), [["space.close", { id: "s-solo", confirmed: true }]]);
  assert.equal(existsSync(at.solo), false, "its folder went");
  assert.equal(sh(at.A, "branch", "--list", "solo"), "", "deleted");
  // rb, being rebased there: detaching wouldn't free it.
  await menuOf(view, "rb");
  await answer({ pick: "delete" });
  const chooser = state.overlays.at(-1).props.question;
  assert.equal(chooser.title, `rb is being rebased in ${at.rb}`);
  assert.deepEqual([item(chooser, "detach").disabled, item(chooser, "detach").detail], [true, `Being rebased in ${at.rb}: finish or abort it there first`]);
  await answer({ cancel: true });
  assert.deepEqual(state.violations, []);
});

test("changes: from another worktree, a branch the main worktree has can't go with its worktree; a second question declined keeps the branch", async () => {
  const at = repos(), view = await mount(at.solo);
  // main is checked out in the main worktree: only detaching it is offered.
  await menuOf(view, "main");
  await answer({ pick: "delete" });
  const chooser = state.overlays.at(-1).props.question;
  assert.deepEqual([item(chooser, "remove").disabled, item(chooser, "remove").detail], [true, "The main worktree can't be removed"]);
  assert.equal(item(chooser, "detach").disabled, undefined);
  await answer({ cancel: true });
  // side: clean when asked, changed before the answer: asked again; declined, the worktree and the
  // branch stay.
  await menuOf(view, "side");
  await answer({ pick: "delete" });
  await answer({ pick: "remove" });
  let { spec } = await answer({ set: () => writeFileSync(join(at.side, "f.txt"), "edited\n") });
  assert.equal(spec.title, `Remove the worktree at ${at.side} and delete side?`);
  ({ spec } = await answer({ cancel: true }));
  assert.equal(spec.title, `Remove the worktree at ${at.side} anyway and delete side?`);
  assert.match(spec.detail, /^It changed since you were asked\. Its uncommitted changes and untracked files are deleted with the folder\. Then git branch /);
  assert.equal(existsSync(join(at.side, "f.txt")), true);
  assert.equal(sh(at.A, "branch", "--list", "side").trim(), "+ side", "still there, checked out in its worktree");
  assert.deepEqual(state.violations, []);
});

test("wtbranch: the questions say what goes: a lock, a rebase stopped there, ignored files, -d or -D", () => {
  const b = { name: "feat", upstream: "origin/feat" }, w = { path: "/r/wt", branch: "feat", locked: true, lockReason: "usb", doing: "rebase" };
  const q = WB.removeAndDeleteAsk(b, w, "~/wt", { ignored: [".env"], merged: false });
  assert.equal(q.title, "Remove the worktree at ~/wt anyway and delete feat?");
  assert.equal(q.confirm, "Remove and delete anyway");
  assert.equal(q.detail, "Its uncommitted changes and untracked files are deleted with the folder, and it was locked (usb). The rebase in progress there is abandoned. An ignored file goes with the folder too: .env. Then git branch -D feat: it isn't merged, so its commits that no other branch has would be only in the reflog, which git cleans up after a while. Its remote branch origin/feat stays.");
  const local = { name: "feat", upstream: "refs/heads/main" }, d = WB.detachAndDeleteAsk(local, { path: "/r/wt" }, "~/wt", null);
  assert.equal(d.detail, "It stays where it is, with its files and changes, on the same commit (git checkout --detach there). Then git branch -d feat; if git refuses, you're asked again.");
  assert.equal(d.confirm, "Detach and delete");
  // A label's menu in History: Check out goes there; Rename… waits for a bisect there.
  const items = WB.withWorktree([{ id: "checkout" }, { id: "rename" }, { id: "delete" }], { path: "/r/wt", branch: null, doing: "bisect" }, "~/wt");
  assert.deepEqual(items.map((x) => [x.id, x.disabled ?? false, x.detail ?? null]),
    [["worktree", false, "Being bisected in ~/wt"], ["rename", true, "Being bisected in ~/wt: finish or abort it there first"], ["delete", false, null]]);
});
