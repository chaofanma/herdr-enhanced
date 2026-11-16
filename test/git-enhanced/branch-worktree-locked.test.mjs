// A locked worktree whose folder is gone (its disk isn't connected, say): git doesn't call it prunable
// (the lock keeps it, and its branch), so `git worktree prune` leaves it. Its branch in the Changes
// picker says "· folder gone, locked"; a click, or its menu's first item, asks to forget that one
// even so (git worktree remove -f -f), naming the lock; Delete… and Fast-forward wait for that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { state, mount, draw, byId, handler, texts, settle, makeCx, load } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";
import { answer } from "./answers.mjs";

const W = await load("worktrees.js");
const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function repo() {
  const base = realpathSync(tempDir("git-enhanced-wt-locked-")), A = join(base, "lantern"), usb = join(base, "lantern-usb");
  sh(base, "init", "-q", "-b", "main", "lantern");
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@t"], ["core.hooksPath", "/dev/null"]]) sh(A, "config", k, v);
  writeFileSync(join(A, "f.txt"), "one\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "First");
  sh(A, "worktree", "add", "-q", "-b", "usb", usb);
  sh(A, "worktree", "lock", "--reason", "on a usb disk", usb);
  rmSync(usb, { recursive: true, force: true });
  return { A, usb };
}

test("worktrees: a locked worktree whose folder is gone is read as missing, and forgetting it names the lock", async () => {
  const { A, usb } = repo();
  const h = { git: async (args) => { try { return { code: 0, stdout: sh(A, ...args) }; } catch (e) { return { code: e.status ?? 1, stdout: e.stdout ?? "" }; } },
    sh: async (script, args) => ({ code: 0, stdout: execFileSync("sh", ["-c", script, "sh", ...args], { cwd: A, encoding: "utf8" }) }) };
  const list = await W.readWorktrees(h, "2.53.0"), w = list.find((x) => x.path === usb);
  assert.deepEqual([w.locked, w.prunable, w.missing], [true, false, true]);
  assert.equal(list.find((x) => x.path === A).missing, undefined);
  assert.equal(W.whereWords(w, "~/usb"), "Checked out in ~/usb · folder gone, locked");
  const p = W.forgetPlan(w);
  assert.deepEqual(p.steps.map((s) => s.args), [["worktree", "remove", "--force", "--force", "--", usb]]);
  assert.equal(p.confirm, `Forget the worktree at ${usb}? It is locked (on a usb disk) and its folder isn't there: git forgets it even so (git worktree remove -f -f). On a disk that isn't connected, the folder stays there, no longer a worktree. Its branch usb stays, free to check out elsewhere.`);
});

test("changes: its branch says the folder is gone and it is locked; a click forgets it after asking, and its menu waits for that", async () => {
  const { A, usb } = repo(), view = await mount(A), page = view.part;
  page.openBranches(true, makeCx()); await settle();
  let tree = await draw(view);
  const i = page.branches.findIndex((b) => b.name === "usb");
  assert.ok(texts(byId(tree, `branch-${i}`)).includes(`Checked out in ${usb} · folder gone, locked`), texts(byId(tree, `branch-${i}`)).join(" | "));
  // Its menu: forget it first; Delete… waits.
  handler(byId(tree, `branch-${i}`), "on_mouse_down")({}, makeCx()); await settle();
  const menu = state.overlays.at(-1).props.question;
  assert.deepEqual([menu.items[0].id, menu.items[0].label, menu.items[0].detail], ["forget", "Forget its worktree…", `${usb} is gone; it is locked (on a usb disk)`]);
  const del = menu.items.find((x) => x.id === "delete");
  assert.deepEqual([del.disabled, del.detail], [true, "Its worktree's folder is gone: forget it first"]);
  await answer({ cancel: true });
  // A click: the question, then git forgets it; the branch stays.
  page.openBranches(true, makeCx()); await settle();
  tree = await draw(view);
  state.runs.length = 0;
  handler(byId(tree, `branch-${page.branches.findIndex((b) => b.name === "usb")}`), "on_click")({}, makeCx());
  const { spec } = await answer();
  assert.equal(spec.title, `Forget the worktree at ${usb}?`);
  assert.equal(spec.confirm, "Forget it");
  assert.deepEqual(state.runs.filter(([n]) => n.startsWith("space.")), [], "no space opened in a folder that isn't there");
  assert.ok(!sh(A, "worktree", "list", "--porcelain").includes(usb), "forgotten");
  assert.equal(sh(A, "branch", "--list", "usb").trim(), "usb");
  assert.deepEqual(state.violations, []);
});
