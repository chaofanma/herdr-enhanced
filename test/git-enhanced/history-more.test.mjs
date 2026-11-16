// The History page's ⋯: Worktrees… (open, lock, move, remove forced after one question when it has changes, forget
// the missing, clean up the merged), Remotes… (add, rename, push URL, remove), Reflog… (a branch at
// an entry, moving the branch there), every remote fetched, a remote's tags pruned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { state, mount, draw, byId, press, settle, makeCx } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";
import { answer } from "./answers.mjs";

const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const cfg = (d) => { sh(d, "config", "user.name", "t"); sh(d, "config", "user.email", "t@t"); sh(d, "config", "core.hooksPath", "/dev/null"); };
const commit = (d, file, text, msg) => { writeFileSync(join(d, file), text); sh(d, "add", "-A"); sh(d, "commit", "-qm", msg); };

function repos() {
  const base = tempDir("git-enhanced-hmore-");
  sh(base, "init", "-q", "--bare", "-b", "main", "remote.git");
  sh(base, "clone", "-q", "remote.git", "a"); const A = join(base, "a"); cfg(A);
  commit(A, "f.txt", "one\n", "First"); sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  sh(A, "remote", "set-head", "origin", "main");
  return { base, A };
}
// A worktree's path as git lists it (the temp folder's real path).
const spec_path = (base, name) => join(realpathSync(base), name);
async function more(view, pick) {
  press(byId(await draw(view), "history-more"));
  return answer({ pick });
}

test("⋯ → Worktrees…: open one as a space, lock it, remove it (forced after asking), forget a missing one, clean up a merged one", async () => {
  // (Its untracked file is known before the question: one question, which forces it.)
  const { base, A } = repos();
  sh(A, "worktree", "add", "-q", "-b", "feat", join(base, "wt-feat"));
  sh(A, "worktree", "add", "-q", "-b", "gone", join(base, "wt-gone"));
  sh(A, "worktree", "add", "-q", "-b", "done", join(base, "wt-done"));
  writeFileSync(join(base, "wt-feat", "dirty.txt"), "x\n");
  rmSync(join(base, "wt-gone"), { recursive: true, force: true });
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  let { spec } = await more(view, "worktrees");
  assert.deepEqual(spec.items.map((i) => i.id), ["worktrees", "remotes", "reflog", "fetch-all", "bisect", "prune-tags"]);
  ({ spec } = await answer({ pick: "wt-1" }));
  assert.equal(spec.items[0].label, "main (this one)");
  assert.deepEqual(spec.items.slice(1, 4).map((i) => i.label), ["done", "feat", "gone"]);
  assert.match(spec.items[3].detail, /folder gone/);
  await answer({ pick: "open" });
  assert.equal(state.runs.at(-1)[0], "space.new"); assert.match(state.runs.at(-1)[1].folder, /wt-done$/);
  // feat has an untracked file: Remove says so in its one question, and forces it.
  await more(view, "worktrees"); await answer({ pick: "wt-2" }); await answer({ pick: "remove" });
  ({ spec } = await answer());
  assert.match(spec.title, /^Remove the worktree at .*wt-feat anyway\?$/);
  assert.equal(spec.detail, "Its uncommitted changes and untracked files are deleted with the folder. Its branch feat stays.");
  assert.equal(existsSync(join(base, "wt-feat")), false, h.line);
  // Forget the missing one.
  await more(view, "worktrees"); await answer({ pick: "prune" });
  ({ spec } = await answer());
  assert.match(spec.title, /^Forget the worktrees whose folders are gone \(.*wt-gone\)\?$/);
  assert.doesNotMatch(sh(A, "worktree", "list"), /wt-gone/);
  // done is merged into main but has no commits of its own: listed unticked, ticked by hand, cleaned
  // up with its branch.
  await more(view, "worktrees"); await answer({ pick: "cleanup" });
  ({ spec } = await answer({ set: (q) => q.files.set(spec_path(base, "wt-done"), true) }));
  assert.equal(spec.title, "Clean up merged worktrees");
  assert.deepEqual(spec.files.items.map((i) => [i.label.split(" · ")[0], i.checked]), [["done (no commits of its own yet)", false]]);
  assert.doesNotMatch(sh(A, "worktree", "list"), /wt-done/, h.line);
  assert.equal(sh(A, "branch", "--list", "done").trim(), "");
  assert.deepEqual(state.violations, []);
});

test("⋯ → Worktrees…: removing one names its ignored files; the clean-up keeps such a one, starts a fresh or detached one unticked", async () => {
  const { base, A } = repos();
  commit(A, ".gitignore", "local.cfg\nbuild/\n", "Ignore");
  sh(A, "push", "-q", "origin", "HEAD:main");
  for (const n of ["secret", "held", "own", "late"]) sh(A, "worktree", "add", "-q", "-b", n, join(base, `wt-${n}`));
  sh(A, "worktree", "add", "-q", "--detach", join(base, "wt-old"), "HEAD~1");
  writeFileSync(join(base, "wt-secret", "local.cfg"), "SECRET\n");
  writeFileSync(join(base, "wt-held", "local.cfg"), "SECRET\n");
  mkdirSync(join(base, "wt-held", "build")); writeFileSync(join(base, "wt-held", "build", "x.o"), "o\n");
  sh(join(base, "wt-own"), "commit", "-q", "--allow-empty", "-m", "own");
  sh(A, "merge", "-q", "--ff-only", "own");
  commit(A, "g.txt", "g\n", "After own");
  sh(A, "push", "-q", "origin", "HEAD:main");
  sh(A, "worktree", "add", "-q", "-b", "fresh", join(base, "wt-fresh"));
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  // Remove secret: the question says local.cfg goes with the folder; cancelled, it stays.
  await more(view, "worktrees");
  let { spec } = await answer({ pick: "wt-6" });
  assert.equal(spec.items[6].label, "secret");
  await answer({ pick: "remove" });
  ({ spec } = await answer({ cancel: true }));
  assert.match(spec.detail, /An ignored file goes with the folder too: local\.cfg\./);
  assert.equal(existsSync(join(base, "wt-secret", "local.cfg")), true);
  // Clean up: held and secret (ignored files) aren't offered and are named; fresh (the base's tip)
  // and old (detached) start unticked; own and late (merged, older than the tip) ticked. late gets
  // an ignored file while the question is open: the script keeps it.
  await more(view, "worktrees"); await answer({ pick: "cleanup" });
  ({ spec } = await answer({ set: () => writeFileSync(join(base, "wt-late", "local.cfg"), "late\n") }));
  assert.equal(spec.danger, true);
  assert.match(spec.detail, /Kept, as their ignored files would go with them: held \(build\/, local\.cfg\), secret \(local\.cfg\)\.$/);
  assert.deepEqual(spec.files.items.map((i) => [i.label.split(" · ")[0], i.checked]),
    [["fresh (no commits of its own yet)", false], ["late", true], ["detached at " + sh(A, "rev-parse", "--short=7", "HEAD~3").trim() + " (detached)", false], ["own", true]]);
  assert.match(h.line ?? "", /^Kept, as they now hold ignored files: .*wt-late$/);
  const list = sh(A, "worktree", "list");
  assert.doesNotMatch(list, /wt-own/, h.line);
  for (const n of ["fresh", "old", "held", "secret", "late"]) assert.match(list, new RegExp(`wt-${n}`));
  assert.equal(existsSync(join(base, "wt-held", "local.cfg")), true);
  assert.deepEqual(state.violations, []);
});

test("⋯ → Worktrees… and Remotes… past a menu's 12 rows: a dialog that scrolls lists every one", async () => {
  const { base, A } = repos();
  for (let i = 0; i < 13; i++) sh(A, "worktree", "add", "-q", "-b", `w${String(i).padStart(2, "0")}`, join(base, `wt-${String(i).padStart(2, "0")}`));
  for (let i = 0; i < 13; i++) sh(A, "remote", "add", `r${String(i).padStart(2, "0")}`, join(base, "remote.git"));
  const view = await mount(A, { palette: "theme", view: "history" });
  await more(view, "worktrees");
  let { spec } = await answer({ entry: 13 });
  assert.equal(spec.title, "Worktrees · 14");
  assert.equal(spec.entries.length, 16, "14 worktrees, Forget…, Clean up…");
  assert.equal(spec.entries[13].title, "w12");
  ({ spec } = await answer({ cancel: true }));
  assert.equal(spec.title, "w12", "the last worktree's menu");
  await more(view, "remotes");
  ({ spec } = await answer({ cancel: true }));
  assert.equal(spec.title, "Remotes · 14");
  assert.deepEqual([spec.entries.length, spec.confirm], [14, "Add a remote…"]);
  await more(view, "remotes");
  await answer();
  ({ spec } = await answer({ cancel: true }));
  assert.equal(spec.title, "Add a remote");
  assert.deepEqual(state.violations, []);
});

test("⋯ → Remotes…, Reflog…, Fetch every remote, prune tags", async () => {
  const { base, A } = repos();
  sh(base, "init", "-q", "--bare", "-b", "main", "fork.git");
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  // Add a remote called -fork: named after "--", fetched.
  await more(view, "remotes");
  await answer({ pick: "add" });
  await answer({ set: (q) => q.input.set_value("-fork") });
  await answer({ set: (q) => q.input.set_value(join(base, "fork.git")) });
  assert.equal(sh(A, "remote", "get-url", "--", "-fork").trim(), join(base, "fork.git"), h.line);
  // Its push URL, then removed (asks what goes).
  await more(view, "remotes");
  let { spec } = await answer({ pick: "r-0" });
  assert.deepEqual(spec.items.map((i) => i.label), ["-fork", "origin", "Add a remote…"]);
  await answer({ pick: "set-push-url" });
  await answer({ set: (q) => q.input.set_value("/nowhere.git") });
  assert.equal(sh(A, "remote", "get-url", "--push", "--", "-fork").trim(), "/nowhere.git");
  await more(view, "remotes"); await answer({ pick: "r-0" }); await answer({ pick: "remove" });
  ({ spec } = await answer());
  assert.equal(spec.title, "Remove remote -fork?");
  assert.equal(sh(A, "remote").trim(), "origin");
  // Reflog: a branch at an entry, then main moved there (reset --keep, asked).
  commit(A, "g.txt", "g\n", "Second");
  const first = sh(A, "rev-parse", "HEAD~1").trim();
  h.reload(makeCx("async")); await settle();
  await more(view, "reflog");
  ({ spec } = await answer({ entry: 1 }));
  assert.equal(spec.entries[1].title, `${first.slice(0, 7)} · First`);
  ({ spec } = await answer({ pick: "branch" }));
  assert.deepEqual(spec.items.map((i) => [i.id, Boolean(i.disabled)]), [["branch", false], ["reset", false], ["detach", false], ["copy", false]]);
  await answer({ set: (q) => q.input.set_value("back-then") });
  assert.equal(sh(A, "rev-parse", "back-then").trim(), first, h.line);
  writeFileSync(join(A, "g.txt"), "g, edited\n");
  await more(view, "reflog"); await answer({ entry: 1 }); await answer({ pick: "reset" });
  ({ spec } = await answer());
  assert.equal(spec.title, "Move main to " + first.slice(0, 7) + " “First”?"); assert.equal(spec.danger, true);
  assert.match(h.line ?? "", /g\.txt|not uptodate|would be overwritten|local changes/i, "reset --keep refuses to overwrite the edit");
  assert.notEqual(sh(A, "rev-parse", "main").trim(), first);
  sh(A, "checkout", "-q", "--", "g.txt");
  // Another branch checked out while the question was open: it isn't moved, and neither is main.
  const at = (sha) => state.overlays.at(-1).props.question.entries.findIndex((e) => e.title.startsWith(sha.slice(0, 7)));
  const resetTo = async (sha, set) => { await more(view, "reflog"); await answer({ entry: at(sha) }); await answer({ pick: "reset" }); return answer({ set }); };
  await resetTo(first, () => sh(A, "switch", "-q", "-c", "elsewhere"));
  assert.equal(h.line, "The branch changed while you were asked (now elsewhere): nothing was done");
  assert.notEqual(sh(A, "rev-parse", "elsewhere").trim(), first);
  sh(A, "switch", "-q", "main");
  // main got a commit while asked: refused too (it would leave the branch unnamed).
  h.reload(makeCx("async")); await settle();
  await resetTo(first, () => commit(A, "late.txt", "l\n", "Late"));
  assert.match(h.line ?? "", /^main moved while you were asked \(now main at [0-9a-f]{7}\): nothing was done$/);
  sh(A, "reset", "-q", "--hard", "HEAD~1");
  h.reload(makeCx("async")); await settle();
  await resetTo(first);
  assert.equal(sh(A, "rev-parse", "main").trim(), first, h.line);
  // Fetch every remote; prune origin's tags (asked).
  sh(A, "tag", "local-only");
  await more(view, "fetch-all");
  assert.equal(h.line, null, h.line);
  await more(view, "prune-tags");
  ({ spec } = await answer());
  assert.equal(spec.title, "Fetch origin and delete the local tags it doesn't have?");
  assert.equal(sh(A, "tag").trim(), "", h.line);
  assert.deepEqual(state.violations, []);
});
