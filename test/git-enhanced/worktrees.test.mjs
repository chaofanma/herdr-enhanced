// worktrees.js: `worktree list --porcelain` with and without -z (literal outputs: quoted lock
// reasons, prunable, detached, bare, odd paths), and real worktrees: added from a branch, a new
// branch, a commit and a remote branch, files copied in, locked, moved, removed (force only as a
// danger plan), pruned, and merged ones cleaned up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { realpathSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { repo, withRemote, runner, SHELLS } from "./gitenv.mjs";
import { tempDir } from "./tmp.mjs";

const W = await mod("worktrees.js");
const { runPlan, parseVersion } = await mod("gitplan.js");
const V = (s) => parseVersion(`git version ${s}`);
const SHA = "1".repeat(40), SHB = "2".repeat(40);

test("parseWorktrees: lines and a blank line, C-quoted lock reasons, prunable, detached, a bare main", () => {
  const out = [
    "worktree /srv/app.git", "bare", "",
    "worktree /home/me/app with space", `HEAD ${SHA}`, "branch refs/heads/feature/x", "locked \"on a usb\\ndrive\"", "",
    "worktree /home/me/gone", `HEAD ${SHB}`, "detached", "prunable gitdir file points to non-existent location", "",
    "worktree /home/me/plain", `HEAD ${SHB}`, "branch refs/heads/main", "locked", "",
  ].join("\n");
  const list = W.parseWorktrees(out);
  assert.deepEqual(list.map((w) => [w.path, w.main, w.bare, w.branch, w.detached, w.locked, w.lockReason, w.prunable]), [
    ["/srv/app.git", true, true, null, false, false, null, false],
    ["/home/me/app with space", false, false, "feature/x", false, true, "on a usb\ndrive", false],
    ["/home/me/gone", false, false, null, true, false, null, true],
    ["/home/me/plain", false, false, "main", false, true, null, false],
  ]);
  assert.equal(list[2].prunableReason, "gitdir file points to non-existent location");
  assert.deepEqual(W.parseWorktrees(""), []);
  assert.deepEqual(W.parseWorktrees("", { z: true }), []);
});

test("parseWorktrees -z: NUL fields, a path with a newline, raw reasons; listArgs by git version", () => {
  const z = [`worktree /home/me/a\nb`, `HEAD ${SHA}`, "branch refs/heads/main", "", `worktree /home/me/c`, `HEAD ${SHB}`, "detached", "locked why\nnot", ""].join("\0") + "\0";
  const list = W.parseWorktrees(z, { z: true });
  assert.deepEqual(list.map((w) => [w.path, w.main, w.branch, w.detached, w.lockReason]), [["/home/me/a\nb", true, "main", false, null], ["/home/me/c", false, null, true, "why\nnot"]]);
  assert.deepEqual(W.listArgs(V("2.36.0")), ["worktree", "list", "--porcelain", "-z"]);
  assert.deepEqual(W.listArgs(V("2.35.9")), ["worktree", "list", "--porcelain"]);
  assert.deepEqual(W.listArgs(null), ["worktree", "list", "--porcelain"]);
  assert.equal(W.listZ(V("2.40.1")), true);
  assert.deepEqual(W.currentOf(list, "/home/me/c\n")?.path, "/home/me/c");
  assert.equal(W.currentOf(list, "/elsewhere"), null);
});

test("the default folder: Herdr's own, <home>/.herdr/worktrees/<repository>/<branch, Herdr's slug>", () => {
  // Herdr's own worktree folder, with its slug rule (mods/worktree, rewrite.js slugOf).
  assert.equal(W.defaultPath("/home/me/app", "feature/login/v2", "/home/me"), "/home/me/.herdr/worktrees/app/feature-login-v2");
  assert.equal(W.defaultPath("/home/me/app/", "main", "/home/me/"), "/home/me/.herdr/worktrees/app/main");
  assert.equal(W.defaultPath("/app", "x", "/root"), "/root/.herdr/worktrees/app/x");
  assert.equal(W.defaultPath("/home/me/app", "1234567", "/home/me"), "/home/me/.herdr/worktrees/app/1234567");
  assert.equal(W.defaultPath("/home/me/app", "", "/home/me"), "/home/me/.herdr/worktrees/app/worktree");
  assert.equal(W.defaultPath("/home/me/app", "--fix: a/b c!", "/home/me"), "/home/me/.herdr/worktrees/app/fix-a-b-c");
});

test("copy choices: environment files ticked, folders not, builds and installs left out", () => {
  const ignored = [".env", ".env.local", "config/app.local", "node_modules/", "sub/node_modules/", "dist/", "logs/", "notes.txt"].join("\0") + "\0";
  assert.deepEqual(W.copyChoices(ignored, [".envrc", ".env"]), [
    { path: ".env", checked: true }, { path: ".env.local", checked: true }, { path: "config/app.local", checked: true },
    { path: "logs/", checked: false }, { path: "notes.txt", checked: false }, { path: ".envrc", checked: true },
  ]);
  assert.deepEqual(W.copyChoices(""), []);
});

test("real worktrees: from a branch, a new branch, a commit, a remote branch; both list forms; files copied in", async () => {
  const me = withRemote("git-enhanced-worktrees-");
  const version = parseVersion(me.git("version"));
  me.git("branch", "side");
  me.git("push", "-q", "origin", "HEAD:refs/heads/team/fix");
  me.git("fetch", "-q");
  me.write(".gitignore", ".env\nsecrets/\n"); me.commit("ignore");
  me.write(".env", "TOKEN=1\n"); me.write("secrets/key.txt", "k\n"); me.write("secrets/deep/x.txt", "x\n");
  const main = W.parseWorktrees((await me.h.git(W.listArgs(version))).stdout, { z: W.listZ(version) })[0];
  assert.equal(main.path, realpathSync(me.dir));
  const base = tempDir("git-enhanced-wt-place-");
  const at = (name) => join(base, name);
  const plans = [
    W.addPlan({ path: at("side wt"), branch: "side", copy: [".env", "secrets/", "nope.txt", "../escape", "/etc/passwd"], root: me.dir }),
    W.addPlan({ path: at("new"), newBranch: "feature/new", from: "main~1" }),
    W.addPlan({ path: at("det"), commit: "main~1", lock: true, reason: "keep" }),
    W.addPlan({ path: at("fix"), remoteBranch: "origin/team/fix", remote: "origin" }),
  ];
  const results = [];
  for (const p of plans) results.push(await runPlan(me.h, p));
  const copied = W.parseCopied(results[0].outputs[1]);
  assert.deepEqual(copied, [{ status: "copied", path: ".env" }, { status: "copied", path: "secrets" }, { status: "missing", path: "nope.txt" }, { status: "bad", path: "../escape" }, { status: "bad", path: "/etc/passwd" }]);
  const side = readFileSync(join(at("side wt"), "secrets/deep/x.txt"), "utf8");
  assert.equal(side, "x\n");
  for (const z of [false, true]) {
    const list = W.parseWorktrees((await me.h.git(["worktree", "list", "--porcelain", ...(z ? ["-z"] : [])])).stdout, { z });
    assert.deepEqual(list.map((w) => [w.path, w.branch, w.detached, w.locked, w.lockReason]), [
      [realpathSync(me.dir), "main", false, false, null],
      [realpathSync(at("det")), null, true, true, "keep"],
      [realpathSync(at("fix")), "team/fix", false, false, null],
      [realpathSync(at("new")), "feature/new", false, false, null],
      [realpathSync(at("side wt")), "side", false, false, null],
    ], `-z: ${z} (git lists the others by path)`);
  }
  assert.equal(me.git("-C", at("fix"), "rev-parse", "--abbrev-ref", "@{u}").trim(), "origin/team/fix", "tracking the remote branch");
  assert.equal(me.git("-C", at("new"), "rev-parse", "HEAD").trim(), me.git("rev-parse", "main~1").trim());
  // Copying again never overwrites.
  for (const shell of SHELLS) {
    const again = await runner(me.dir, shell).sh(W.COPY_SH, [me.dir, at("side wt"), ".env", "secrets"]);
    assert.deepEqual(W.parseCopied(again.stdout).map((c) => c.status), ["exists", "exists"], shell);
  }
  assert.equal(W.addPlan({ path: at("x") }).problem, "Choose a branch, a new branch's name or a commit");
  assert.equal(W.addPlan({ path: at("x"), branch: "side", copy: [".env"] }).problem, "Copying files needs the worktree they come from");
  assert.match(W.addPlan({ path: at("x"), remoteBranch: "origin/" }).problem, /isn't a branch of origin/);
  await assert.rejects(runPlan(me.h, W.addPlan({ path: at("again"), branch: "side" })), /already (checked out|used by worktree)/, "git refuses a branch checked out elsewhere");
});

test("remove (refused with changes, then by force as a danger plan), lock, move, prune", async () => {
  const r = repo("git-enhanced-worktrees-rm-");
  r.commit("one", { "f.txt": "1\n" });
  const base = tempDir("git-enhanced-wt-rm-");
  await runPlan(r.h, W.addPlan({ path: join(base, "a"), newBranch: "a" }));
  await runPlan(r.h, W.addPlan({ path: join(base, "b"), newBranch: "b" }));
  const list = async () => W.parseWorktrees((await r.h.git(["worktree", "list", "--porcelain", "-z"])).stdout, { z: true });
  let [main, a, b] = await list();
  assert.equal(W.removePlan(main).problem, "The main worktree can't be removed");
  writeFileSync(join(base, "a", "new.txt"), "untracked\n");
  await assert.rejects(runPlan(r.h, W.removePlan(a)), /modified or untracked files/);
  await runPlan(r.h, W.lockPlan(a.path, "why\nnot"));
  [, a] = await list();
  assert.deepEqual([a.locked, a.lockReason], [true, "why\nnot"]);
  const force = W.removePlan(a, { force: true });
  assert.equal(force.danger, true);
  assert.match(force.confirm, /^Remove the worktree at .*\/a anyway\? Its uncommitted changes and untracked files are deleted with the folder, and it was locked \(why\nnot\)\. Its branch a stays\.$/);
  assert.deepEqual(force.steps[0].args.slice(0, 4), ["worktree", "remove", "--force", "--force"]);
  assert.match(W.movePlan(a, join(base, "a2")).problem, /locked/);
  await runPlan(r.h, force);
  assert.equal(r.tryGit("rev-parse", "-q", "--verify", "refs/heads/a").status, 0, "its branch stays");
  await runPlan(r.h, W.movePlan(b, join(base, "b moved")));
  [, b] = await list();
  assert.equal(b.path, realpathSync(join(base, "b moved")));
  await runPlan(r.h, W.lockPlan(b.path));
  await runPlan(r.h, W.unlockPlan(b.path));
  assert.equal((await list())[1].locked, false);
  // A folder deleted by hand: prunable, and prune forgets it.
  rmSync(b.path, { recursive: true, force: true });
  [, b] = await list();
  assert.equal(b.prunable, true);
  const prune = W.prunePlan(await list());
  assert.match(prune.confirm, /^Forget the worktrees whose folders are gone \(.*b moved\)\? Their branches stay\./);
  await runPlan(r.h, prune);
  assert.equal((await list()).length, 1);
});

test("merged worktrees found and cleaned up with their branches; one with changes is kept", async () => {
  const r = repo("git-enhanced-worktrees-clean-");
  r.commit("one", { "f.txt": "1\n" });
  const base = tempDir("git-enhanced-wt-clean-");
  for (const n of ["done", "dirty", "open", "kept"]) await runPlan(r.h, W.addPlan({ path: join(base, n), newBranch: n }));
  r.git("-C", join(base, "open"), "commit", "-q", "--allow-empty", "-m", "not merged");
  r.git("-C", join(base, "done"), "commit", "-q", "--allow-empty", "-m", "merged");
  r.git("merge", "-q", "--ff-only", "done");
  writeFileSync(join(base, "dirty", "f.txt"), "changed\n");
  await runPlan(r.h, W.lockPlan(join(base, "kept")));
  const list = W.parseWorktrees((await r.h.git(["worktree", "list", "--porcelain"])).stdout);
  for (const shell of SHELLS) {
    const merged = await runner(r.dir, shell).sh(W.MERGED_SH, W.mergedArgs(list, "main"));
    const ws = W.mergedWorktrees(list, merged.stdout, { current: realpathSync(r.dir) });
    assert.deepEqual(ws.map((w) => w.branch).sort(), ["dirty", "done"], `${shell}: not open (unmerged), not kept (locked), not main`);
  }
  const ws = W.mergedWorktrees(list, (await r.h.sh(W.MERGED_SH, W.mergedArgs(list, "main"))).stdout);
  const p = W.cleanupPlan(ws);
  assert.match(p.confirm, /^Remove 2 worktrees and their branches\? Each is merged; one with uncommitted changes or ignored files is kept\.$/);
  const res = await runPlan(r.h, p);
  assert.deepEqual(W.parseCleanup(res.outputs[0]).map((c) => `${c.status} ${c.path.split("/").pop()}`).sort(), ["deleted done", "kept dirty", "removed done"]);
  assert.equal(r.tryGit("rev-parse", "-q", "--verify", "refs/heads/done").status, 1, "its branch went too");
  assert.equal(r.tryGit("rev-parse", "-q", "--verify", "refs/heads/dirty").status, 0);
  assert.equal(W.cleanupPlan([]).problem, "No worktree to clean up");
});

test("git worktree remove deletes ignored files: they're listed first, named in the question, and the clean-up keeps such a worktree", async () => {
  const r = repo("git-enhanced-worktrees-ignored-");
  r.commit("one", { "f.txt": "1\n", ".gitignore": "local.cfg\nbuild/\n" });
  const base = tempDir("git-enhanced-wt-ign-");
  for (const n of ["a", "b"]) await runPlan(r.h, W.addPlan({ path: join(base, n), newBranch: n }));
  writeFileSync(join(base, "a", "local.cfg"), "SECRET\n");
  const list = W.parseWorktrees((await r.h.git(["worktree", "list", "--porcelain"])).stdout), [, a, b] = list;
  const ign = (await r.h.git(W.ignoredArgs(a.path))).stdout.split("\0").filter(Boolean);
  assert.deepEqual(ign, ["local.cfg"]);
  assert.equal(W.removeQuestion(a, ign).detail, "Its folder goes; git refuses while it has uncommitted changes or untracked files. An ignored file goes with the folder too: local.cfg. Its branch a stays.");
  assert.match(W.removePlan(a, { force: true, ignored: ign }).confirm, /\. An ignored file goes with the folder too: local\.cfg\. Its branch a stays\.$/);
  assert.equal(W.namesOf(["x", "y", "z", "w", "v"]), "x, y, z and 2 more");
  // Fresh (head = the base's tip) and detached start unticked; ignored files are a note.
  const tip = r.git("rev-parse", "HEAD").trim();
  const choices = W.cleanupChoices([a, b, { ...b, path: "/d", branch: null, detached: true }], { baseHead: tip, ignored: new Map([[a.path, ign]]) });
  assert.deepEqual(choices.map((c) => [c.note, c.checked]), [["ignored files: local.cfg", false], ["no commits of its own yet", false], ["detached", false]]);
  for (const shell of SHELLS) {
    const res = await runner(r.dir, shell).sh(W.CLEANUP_SH, [a.path, "", b.path + "-none", ""]);
    assert.deepEqual(W.parseCleanup(res.stdout).map((c) => c.status), ["ignored", "kept"], shell);
  }
  assert.equal(readFileSync(join(base, "a", "local.cfg"), "utf8"), "SECRET\n", "kept with its secret");
});
