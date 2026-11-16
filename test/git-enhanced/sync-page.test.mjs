// Sync, force push with a lease and pushing every tag from the menu beside Push, against a real
// bare remote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { state, mount, draw, byId, press, settle, makeCx } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";
import { answer } from "./answers.mjs";

const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const cfg = (d) => { sh(d, "config", "user.name", "t"); sh(d, "config", "user.email", "t@t"); sh(d, "config", "core.hooksPath", "/dev/null"); };

test("the menu beside Push: Sync a diverged branch, force push with a lease (refused after a fetch nobody looked at), every tag, Publish", async () => {
  const base = tempDir("git-enhanced-sync-");
  sh(base, "init", "-q", "--bare", "-b", "main", "remote.git");
  sh(base, "clone", "-q", "remote.git", "a"); const A = join(base, "a"); cfg(A);
  writeFileSync(join(A, "f.txt"), "one\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "First"); sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  sh(base, "clone", "-q", "remote.git", "b"); const B = join(base, "b"); cfg(B);
  const remote = (ref = "main") => sh(join(base, "remote.git"), "rev-parse", ref).trim();
  writeFileSync(join(A, "a.txt"), "a\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "From A");
  writeFileSync(join(B, "b.txt"), "b\n"); sh(B, "add", "-A"); sh(B, "commit", "-qm", "From B"); sh(B, "push", "-q");
  sh(A, "fetch", "-q");
  const view = await mount(A, { palette: "theme" }), page = view.part;
  let tree = await draw(view);
  press(byId(tree, "push-menu"));
  let { spec } = await answer({ pick: "sync" });
  assert.deepEqual(spec.items.map((i) => [i.id, i.label]), [["sync", "Sync…"], ["force", "Force push (with lease)…"], ["tags", "Push every tag"]]);
  ({ spec } = await answer());
  assert.equal(spec.title, "Sync main with origin/main?");
  assert.equal(spec.detail, "It pulls (rebase), 1 commit known to come in, then pushes 1 commit. Your 1 unpushed commit is made again on top of origin/main, with new hashes; merge commits among them are kept.");
  assert.equal(sh(A, "log", "--format=%s", "-3").trim(), "From A\nFrom B\nFirst", page.line);
  assert.equal(remote(), sh(A, "rev-parse", "HEAD").trim());
  // Force push: the amended commit replaces the one pushed; the question names what goes.
  const was = remote();
  sh(A, "commit", "-q", "--amend", "-m", "From A, amended");
  page.refresh(makeCx("async")); await settle();
  page.pushMenu(makeCx());
  await answer({ pick: "force" });
  ({ spec } = await answer());
  assert.equal(spec.title, "Force push main to origin/main?");
  assert.equal(spec.detail, `It replaces origin/main (${was.slice(0, 7)}): 1 commit there that it doesn't have is lost for everyone. git refuses if it moved since, or if commits were fetched there that you never had in main.`);
  assert.equal(spec.danger, true);
  assert.equal(remote(), sh(A, "rev-parse", "HEAD").trim(), page.line);
  // Someone pushes; a fetch brings it in, but it was never in main: the force push refuses.
  sh(B, "fetch", "-q"); sh(B, "reset", "-q", "--hard", "origin/main"); writeFileSync(join(B, "c.txt"), "c\n"); sh(B, "add", "-A"); sh(B, "commit", "-qm", "From B again"); sh(B, "push", "-q");
  sh(A, "fetch", "-q"); sh(A, "commit", "-q", "--amend", "-m", "From A, again");
  const theirs = remote();
  page.refresh(makeCx("async")); await settle();
  page.pushMenu(makeCx()); await answer({ pick: "force" }); await answer();
  assert.match(page.line ?? "", /fetched but never in main/);
  assert.equal(remote(), theirs, "nothing replaced");
  // Push every tag.
  sh(A, "tag", "v1"); sh(A, "tag", "-a", "v2", "-m", "two");
  page.pushMenu(makeCx()); await answer({ pick: "tags" });
  assert.equal(remote("v1"), sh(A, "rev-parse", "v1").trim(), page.line);
  // A branch without an upstream: Publish.
  sh(A, "switch", "-q", "-c", "pub");
  page.refresh(makeCx("async")); await settle();
  page.pushMenu(makeCx());
  ({ spec } = await answer({ pick: "sync" }));
  assert.equal(spec.items[0].label, "Publish");
  assert.equal(spec.items[1].detail, "No upstream to replace");
  assert.equal(remote("pub"), sh(A, "rev-parse", "HEAD").trim(), page.line);
  assert.equal(sh(A, "rev-parse", "--abbrev-ref", "pub@{u}").trim(), "origin/pub");
  assert.deepEqual(state.violations, []);
});
