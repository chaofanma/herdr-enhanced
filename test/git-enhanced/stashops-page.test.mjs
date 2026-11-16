// Stashes with stashops.js: Stash… keeping what is staged or with ignored files (asks), a stash's ⋯
// (apply staged as it was, branch from it, rename, compare with the working tree) and Drop all….
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { state, repo, mount, draw, byId, press, texts, settle, makeCx } from "./render/load.mjs";
import { answer } from "./answers.mjs";

test("stash keeping the staged part, with ignored files (asked), apply as staged, rename, branch, compare, drop all", async () => {
  const r = repo(({ write, git }) => {
    write(".gitignore", ".env\n"); write("a.txt", "a\n"); write("b.txt", "b\n"); git("add", "-A"); git("commit", "-qm", "init");
    write("a.txt", "a staged\n"); git("add", "a.txt"); write("b.txt", "b work\n");
  });
  const { git } = r;
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  // Keep staged changes: a.txt stays staged and in the file; b.txt's change is stashed.
  page.stashWith(makeCx());
  let { spec } = await answer({ set: (q) => { q.checks.keep = true; } });
  assert.deepEqual(spec.checks.map((c) => [c.id, c.only ?? null]), [["untracked", ["all", "files"]], ["keep", ["all"]], ["ignored", ["all"]]]);
  assert.equal(r.read("a.txt"), "a staged\n"); assert.equal(r.read("b.txt"), "b\n");
  assert.equal(git("diff", "--cached", "--name-only").trim(), "a.txt", page.line);
  assert.equal(git("stash", "list").trim().split("\n").length, 1);
  // With ignored files: asked what leaves the folder.
  r.write(".env", "SECRET=1\n");
  page.refresh(makeCx("async")); await settle();
  page.stashWith(makeCx());
  await answer({ set: (q) => { q.checks.ignored = true; } });
  ({ spec } = await answer());
  assert.equal(spec.title, "Stash them?");
  assert.equal(spec.detail, "The changes are stashed, with every untracked and ignored file: build output, installed packages and files such as .env leave the folder until the stash is applied.");
  assert.equal(existsSync(join(r.dir, ".env")), false, page.line);
  // Apply (staged as it was): a.txt staged again.
  await settle();
  const top = page.stashes[0];
  page.stashMore(top, makeCx());
  await answer({ pick: "apply-index" });
  assert.equal(r.read(".env"), "SECRET=1\n");
  assert.equal(git("diff", "--cached", "--name-only").trim(), "a.txt", page.line);
  git("reset", "-q", "--hard"); git("clean", "-fqx", "-e", ".gitignore");
  // Rename the older stash: found by its hash, it becomes stash@{0}.
  page.refresh(makeCx("async")); await settle();
  const older = page.stashes[1];
  page.stashMore(older, makeCx());
  await answer({ pick: "rename" });
  await answer({ set: (q) => q.input.set_value("b's work") });
  assert.match(git("stash", "list", "--format=%gs").split("\n")[0], /b's work$/, page.line);
  assert.equal(git("rev-parse", "stash@{0}").trim(), older.hash);
  // Compare with working tree: the read-only scope at the stash.
  page.stashMore(page.stashes[0], makeCx());
  await answer({ pick: "compare" }); await settle();
  assert.equal(page.scope, "ref"); assert.equal(page.scopeTarget, older.hash);
  assert.ok(page.files.some((f) => f.path === "b.txt"));
  page.setScope("work", makeCx()); await settle();
  // Branch from it: a name, then the stash applied there and dropped.
  page.stashMore(page.stashes[0], makeCx());
  await answer({ pick: "branch" });
  ({ spec } = await answer({ set: (q) => q.input.set_value("from-stash") }));
  assert.equal(spec.detail, "A new branch where stash@{0} was made, switch to it and apply the stash there. The stash is dropped once it applies.");
  assert.equal(git("branch", "--show-current").trim(), "from-stash", page.line);
  assert.equal(r.read("b.txt"), "b work\n");
  assert.equal(git("stash", "list").trim().split("\n").length, 1);
  // Drop all…: asks.
  git("stash", "push", "-q", "-m", "one more");
  page.refresh(makeCx("async")); await settle();
  page.choosingStash = true;
  const tree = await draw(view);
  assert.deepEqual(texts(byId(tree, "stash-clear")), ["Drop all 2…"]);
  press(byId(tree, "stash-clear"));
  ({ spec } = await answer());
  assert.equal(spec.title, "Drop all 2 stashes?"); assert.equal(spec.danger, true);
  assert.equal(git("stash", "list").trim(), "", page.line);
  assert.deepEqual(state.violations, []);
});
