// Branches with branchops.js: ↑ ↓ and "gone" in the picker, Clean up branches… (the safe way, then
// by force after asking), Back to the previous branch, Fast-forward, Merge into ▸ with options, and
// ⋯ → Move my unpushed commits to a new branch….
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { state, mount, draw, byId, handler, press, texts, settle, makeCx } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";
import { answer } from "./answers.mjs";

const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const cfg = (d) => { sh(d, "config", "user.name", "t"); sh(d, "config", "user.email", "t@t"); sh(d, "config", "core.hooksPath", "/dev/null"); };
const commit = (d, file, text, msg) => { writeFileSync(join(d, file), text); sh(d, "add", "-A"); sh(d, "commit", "-qm", msg); };

test("branches: tracking in the picker, clean-up, previous branch, fast-forward, squash merge, moving unpushed commits", async () => {
  const base = tempDir("git-enhanced-branchops-");
  sh(base, "init", "-q", "--bare", "-b", "main", "remote.git");
  sh(base, "clone", "-q", "remote.git", "a"); const A = join(base, "a"); cfg(A);
  commit(A, "f.txt", "one\n", "First"); sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  sh(base, "clone", "-q", "remote.git", "b"); const B = join(base, "b"); cfg(B);
  sh(A, "branch", "merged");
  sh(A, "switch", "-q", "-c", "wip"); commit(A, "w.txt", "w\n", "WIP"); sh(A, "push", "-q", "-u", "origin", "wip");
  sh(A, "switch", "-q", "-c", "behind", "main"); sh(A, "push", "-q", "-u", "origin", "behind");
  sh(A, "switch", "-q", "-c", "side", "main"); commit(A, "s.txt", "s\n", "Side");
  sh(A, "switch", "-q", "main");
  sh(B, "fetch", "-q"); sh(B, "push", "-q", "origin", "--delete", "wip");
  sh(B, "switch", "-q", "behind"); commit(B, "b.txt", "b\n", "Behind moved"); sh(B, "push", "-q");
  sh(A, "fetch", "-q", "--prune");
  const view = await mount(A, { palette: "theme" }), page = view.part;
  page.openBranches(true, makeCx()); await settle();
  let tree = await draw(view);
  const row = (name) => byId(tree, `branch-${page.branches.findIndex((b) => b.name === name)}`);
  assert.match(texts(row("wip")).join(" "), /origin\/wip · gone$/);
  assert.match(texts(row("behind")).join(" "), /origin\/behind ↓1$/);
  assert.deepEqual(state.violations, []);
  // Fast-forward behind (not checked out) from its menu.
  handler(row("behind"), "on_mouse_down")({}, makeCx());
  let { spec } = await answer({ pick: "ff" });
  assert.equal(spec.items.find((i) => i.id === "ff").label, "Fast-forward to origin/behind");
  assert.equal(sh(A, "rev-parse", "behind").trim(), sh(A, "rev-parse", "origin/behind").trim(), page.line);
  // Merge side into main ▸ squash: its changes staged, no commit.
  page.openBranches(true, makeCx()); await settle(); tree = await draw(view);
  handler(row("side"), "on_mouse_down")({}, makeCx());
  await answer({ pick: "merge-with" });
  await answer({ pick: "squash" });
  ({ spec } = await answer());
  assert.equal(spec.title, "Merge side into main: side's changes are staged on main, not committed: commit them yourself?");
  assert.equal(sh(A, "diff", "--cached", "--name-only").trim(), "s.txt", page.line);
  assert.equal(sh(A, "log", "-1", "--format=%s").trim(), "First");
  sh(A, "reset", "-q", "--hard");
  // The branch switched while the question was open: nothing is merged into the other one.
  page.openBranches(true, makeCx()); await settle(); tree = await draw(view);
  handler(row("side"), "on_mouse_down")({}, makeCx());
  await answer({ pick: "merge-with" });
  await answer({ pick: "no-ff" });
  const behindWas = sh(A, "rev-parse", "behind").trim();
  await answer({ set: () => sh(A, "switch", "-q", "behind") });
  assert.equal(page.line, "The branch changed while you were asked (now behind): nothing was done");
  assert.equal(sh(A, "rev-parse", "behind").trim(), behindWas);
  sh(A, "switch", "-q", "main");
  page.refresh(makeCx("async")); await settle();
  // Clean up: merged and gone ticked; wip isn't merged, so it goes only by force, asked again.
  page.refresh(makeCx("async")); await settle();
  page.openBranches(true, makeCx()); await settle(); tree = await draw(view);
  press(byId(tree, "branch-cleanup"));
  ({ spec } = await answer());
  assert.deepEqual(spec.files.items.map((f) => f.path).sort(), ["merged", "wip"]);
  ({ spec } = await answer());
  assert.equal(spec.title, "Delete 2 branches (merged, wip)?");
  ({ spec } = await answer());
  assert.equal(spec.title, "Delete 1 branch whose commits aren't merged (wip)?"); assert.equal(spec.danger, true);
  await settle();
  assert.deepEqual(sh(A, "branch", "--format=%(refname:short)").trim().split("\n").sort(), ["behind", "main", "side"], page.line);
  // Back to the previous branch.
  sh(A, "switch", "-q", "side"); sh(A, "switch", "-q", "main");
  page.previousBranch(makeCx()); await settle();
  assert.equal(sh(A, "branch", "--show-current").trim(), "side", page.line);
  sh(A, "switch", "-q", "main");
  // ⋯ → Move my unpushed commits to a new branch….
  commit(A, "m.txt", "m\n", "Unpushed");
  page.refresh(makeCx("async")); await settle();
  page.moreMenu(makeCx());
  ({ spec } = await answer({ pick: "move-commits" }));
  assert.match(spec.items.find((i) => i.id === "move-commits").detail, /^1 commit; main goes back to origin\/main$/);
  await answer({ set: (q) => q.input.set_value("moved") });
  ({ spec } = await answer());
  assert.equal(spec.title, "Move the 1 commit of main that origin/main doesn't have to a new branch moved?");
  assert.equal(sh(A, "branch", "--show-current").trim(), "moved", page.line);
  assert.equal(sh(A, "rev-parse", "main").trim(), sh(A, "rev-parse", "origin/main").trim());
  assert.equal(sh(A, "log", "-1", "--format=%s", "moved").trim(), "Unpushed");
  assert.deepEqual(state.violations, []);
});

test("a Changes flow that fails says why on the line under the diff", async () => {
  const base = tempDir("git-enhanced-flowerr-");
  sh(base, "init", "-q", "-b", "main", "a"); const A = join(base, "a"); cfg(A);
  commit(A, "f.txt", "one\n", "First");
  const view = await mount(A, { palette: "theme" }), page = view.part;
  page.facts = { ...page.facts, base: "no-such-base" };
  page.cleanupBranches(makeCx()); await settle();
  assert.match(page.line ?? "", /no-such-base|malformed|not a valid|unknown/i, "git's refusal is on the line");
  assert.deepEqual(state.violations, []);
});
