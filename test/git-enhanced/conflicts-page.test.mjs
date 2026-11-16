// Conflicts in the Changes page: the bar (Continue, Skip…, Abort…, Ask an agent…), a conflicted
// file's menu and its conflict view, on a real merge and a real rebase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { state, repo, mount, draw, byId, press, texts, settle, makeCx, load } from "./render/load.mjs";
import { answer } from "./answers.mjs";

const sectionOf = (page, path) => page.sections().find((g) => g.rows.some((r) => r.f.path === path))?.key;

test("a merge that stopped: the bar, the agent, a file's conflict view, a side taken, Continue", async () => {
  const r = repo(({ write, git }) => {
    write("f.txt", "a\nb\nc\n"); write("g.txt", "g\n"); git("add", "-A"); git("commit", "-qm", "init");
    git("switch", "-q", "-c", "side"); write("f.txt", "a\nside\nc\n"); write("g.txt", "g side\n"); git("commit", "-qam", "side");
    git("switch", "-q", "main"); write("f.txt", "a\nmain\nc\n"); git("rm", "-q", "g.txt"); git("commit", "-qam", "main");
  });
  try { r.git("merge", "side"); } catch { /* stops on conflicts */ }
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  assert.equal(page.operation, "merge");
  assert.deepEqual(page.unmerged.map((u) => [u.path, u.xy, u.kind]), [["f.txt", "UU", "both modified"], ["g.txt", "DU", "deleted by us"]]);
  let tree = await draw(view);
  assert.deepEqual(texts(byId(tree, /^operation-words-/)), ["Merge stopped: 2 files conflict"]);
  assert.ok(byId(tree, /^operation-words-merge-0-2-/), "the id names the count its tooltip says");
  assert.ok(byId(tree, "conflict-continue-off") && !byId(tree, "conflict-continue"), "Continue waits for the conflicts");
  assert.equal(byId(tree, /^conflict-skip/), null, "a merge can't skip");
  // Ask an agent…: the send dialog with the prompt.
  press(byId(tree, "conflict-ask"));
  const send = state.overlays.at(-1).props;
  assert.equal(send.role, "send");
  assert.match(send.send.context, /^In the repository at .*:\n\nA git merge stopped on conflicts\. Merging side into main\./);
  assert.match(send.send.context, /- f\.txt \(both modified\)\n- g\.txt \(deleted by us\)/);
  // f.txt: its conflict view; theirs for the block, saved and marked resolved.
  assert.equal(page.open?.path, "f.txt", "the first file opens");
  tree = await draw(view);
  assert.ok(byId(tree, "conflict-view") && byId(tree, "changes-diff-box").calls.some(([m]) => m === "hidden"));
  assert.ok(texts(byId(tree, "conflict-0")).includes("main") && texts(byId(tree, "conflict-0")).includes("side"));
  assert.ok(byId(tree, "conflict-save-none"), "nothing chosen yet");
  press(byId(tree, "conflict-0-theirs"));
  tree = await draw(view);
  press(byId(tree, "conflict-save-resolved")); await settle();
  assert.equal(r.read("f.txt"), "a\nside\nc\n");
  assert.ok(!page.unmerged.some((u) => u.path === "f.txt"), page.line);
  // g.txt (deleted by us): its menu; take ours (deleted) asks what goes.
  page.fileMenu("g.txt", sectionOf(page, "g.txt"), makeCx());
  let { spec } = await answer({ pick: "ours" });
  assert.deepEqual(spec.items.map((i) => i.id), ["ours", "theirs", "delete", "resolved"]);
  ({ spec } = await answer());
  assert.equal(spec.title, `Take ${page.sideNames().ours} for g.txt?`, "the menu's name for the side");
  assert.equal(spec.title, "Take main for g.txt?");
  assert.equal(spec.detail, `It was deleted there: the file goes, with the changes of ${page.sideNames().theirs}.`);
  assert.equal(existsSync(join(r.dir, "g.txt")), false);
  tree = await draw(view);
  assert.deepEqual(texts(byId(tree, /^operation-words-/)), ["Merge stopped: no conflicts left"]);
  press(byId(tree, "conflict-continue")); await settle();
  assert.equal(r.git("log", "-1", "--format=%s").trim(), "Merge branch 'side'");
  assert.equal(page.operation, null);
  assert.deepEqual(state.violations, []);
});

test("a rebase that stopped: commit 1 of 2, Skip asks and goes on, Abort asks and goes back", async () => {
  const r = repo(({ write, git }) => {
    write("f.txt", "a\n"); git("add", "-A"); git("commit", "-qm", "init");
    git("switch", "-q", "-c", "topic"); write("f.txt", "topic\n"); git("commit", "-qam", "t1"); write("t.txt", "t\n"); git("add", "-A"); git("commit", "-qm", "t2");
    write("t.txt", "t2\n"); git("commit", "-qam", "t3");
    git("switch", "-q", "main"); write("f.txt", "main\n"); write("t.txt", "main t\n"); git("add", "-A"); git("commit", "-qm", "m"); git("switch", "-q", "topic");
  });
  const before = r.git("rev-parse", "HEAD").trim(), t1 = r.git("rev-parse", "HEAD~2").trim();
  try { r.git("rebase", "main"); } catch { /* stops */ }
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  assert.equal(page.operation, "rebase");
  let tree = await draw(view);
  assert.deepEqual(texts(byId(tree, /^operation-words-/)), ["Rebase stopped (commit 1 of 3): 1 file conflict"]);
  assert.match(page.sideNames().theirs, new RegExp(`^Your commit ${t1.slice(0, 7)} from topic$`));
  press(byId(tree, "conflict-skip"));
  const { spec } = await answer();
  assert.equal(spec.title, "Skip it?");
  assert.equal(spec.detail, `Commit ${t1.slice(0, 7)} is left out of the rebased branch (it stays in the reflog), and the conflicts resolved for it so far are lost.`);
  assert.equal(spec.danger, true);
  await settle();
  assert.equal(page.operation, "rebase", "the next commit stops too");
  assert.match(page.line ?? "", /^Rebase stopped at the next commit: /);
  tree = await draw(view);
  assert.match(texts(byId(tree, /^operation-words-/))[0], /^Rebase stopped \(commit 2 of 3\)/);
  press(byId(tree, "operation-abort"));
  const a = await answer();
  assert.equal(a.spec.title, "Abort the rebase?");
  assert.equal(page.operation, null);
  assert.equal(r.git("rev-parse", "HEAD").trim(), before);
  assert.deepEqual(state.violations, []);
});

test("Skip in a cherry-pick on an old git: off, with why", async () => {
  const { skipProblem } = await load("conflictui.js");
  assert.equal(skipProblem("cherry-pick", { major: 2, minor: 20, patch: 0 }), "Skipping in a cherry-pick needs git 2.23 or newer");
  assert.equal(skipProblem("rebase", { major: 2, minor: 20, patch: 0 }), null);
});

test("Continue asks when a staged file still has conflict markers; Mark as resolved counts the blocks of a file too big to read", async () => {
  const big = "x".repeat(80) + "\n";
  const r = repo(({ write, git }) => {
    write("f.txt", "a\nb\nc\n"); write("big.txt", big.repeat(14000) + "end\n"); write("fixture.txt", "<<<<<<< a\n=======\n>>>>>>> b\n");
    git("add", "-A"); git("commit", "-qm", "init");
    git("switch", "-q", "-c", "side"); write("f.txt", "a\nside\nc\n"); write("big.txt", big.repeat(14000) + "side\n"); git("commit", "-qam", "side");
    git("switch", "-q", "main"); write("f.txt", "a\nmain\nc\n"); write("big.txt", big.repeat(14000) + "main\n"); git("commit", "-qam", "main");
  });
  try { r.git("merge", "side"); } catch { /* stops on conflicts */ }
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  // big.txt is past 1 MiB: Mark as resolved still finds its block (grep there) and asks.
  page.fileMenu("big.txt", sectionOf(page, "big.txt"), makeCx());
  await answer({ pick: "resolved" });
  let { spec } = await answer({ cancel: true });
  assert.equal(spec.title, "big.txt still has 1 conflict block");
  assert.ok(page.unmerged.some((u) => u.path === "big.txt"));
  // Both staged by hand with their markers (fixture.txt has markers from before: not asked about).
  r.git("add", "f.txt", "big.txt");
  page.refresh(makeCx("async"), true); await settle();
  let tree = await draw(view);
  press(byId(tree, "conflict-continue"));
  ({ spec } = await answer({ cancel: true }));
  assert.equal(spec.title, "2 files still have conflict markers: big.txt, f.txt. Continue anyway?");
  assert.equal(spec.danger, true);
  assert.equal(page.operation, "merge", "cancelled: nothing went on");
  // Fixed by hand: Continue goes on without asking.
  r.write("f.txt", "a\nboth\nc\n"); r.write("big.txt", big.repeat(14000) + "both\n"); r.git("add", "f.txt", "big.txt");
  page.refresh(makeCx("async"), true); await settle();
  tree = await draw(view);
  press(byId(tree, "conflict-continue")); await settle();
  assert.equal(page.operation, null, page.line);
  assert.deepEqual(state.violations, []);
});

test("a git am whose patch didn't apply (no conflicts, nothing staged): the bar says so, Continue is off, Skip goes on", async () => {
  const r = repo(({ write, git }) => {
    write("f.txt", "1\n"); git("add", "-A"); git("commit", "-qm", "init");
    write("f.txt", "2\n"); git("commit", "-qam", "two");
  });
  const patch = r.git("format-patch", "-1", "--stdout");
  r.git("reset", "-q", "--hard", "HEAD~1"); r.write("f.txt", "other\n"); r.git("commit", "-qam", "other");
  r.write("p.mbox", patch);
  try { r.git("am", "p.mbox"); } catch { /* the patch doesn't apply */ }
  r.git("clean", "-qf", "p.mbox");
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  assert.equal(page.operation, "am");
  let tree = await draw(view);
  assert.deepEqual(texts(byId(tree, /^operation-words-/)), ["git am stopped (patch 1 of 1): the patch didn't apply"]);
  assert.ok(byId(tree, "conflict-continue-nothing") && !byId(tree, "conflict-continue"), "Continue would refuse");
  press(byId(tree, "conflict-skip"));
  await answer();
  assert.equal(page.operation, null, page.line);
  assert.equal(r.git("log", "-1", "--format=%s").trim(), "other");
  assert.deepEqual(state.violations, []);
});

test("the conflict view refuses to save a file that isn't UTF-8 (its bytes would change)", async () => {
  const latin = Buffer.from("caf\xe9\n", "latin1");
  const r = repo(({ write, git }) => {
    write("f.txt", Buffer.concat([latin, Buffer.from("a\n")])); git("add", "-A"); git("commit", "-qm", "init");
    git("switch", "-q", "-c", "side"); write("f.txt", Buffer.concat([latin, Buffer.from("side\n")])); git("commit", "-qam", "side");
    git("switch", "-q", "main"); write("f.txt", Buffer.concat([latin, Buffer.from("main\n")])); git("commit", "-qam", "main");
  });
  try { r.git("merge", "side"); } catch { /* stops on conflicts */ }
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  let tree = await draw(view);
  press(byId(tree, "conflict-0-theirs"));
  tree = await draw(view);
  press(byId(tree, "conflict-save-resolved")); await settle();
  assert.match(page.line ?? "", /isn't UTF-8 text/);
  assert.ok(readFileSync(join(r.dir, "f.txt")).includes(0xe9), "its bytes are as they were");
  assert.ok(page.unmerged.some((u) => u.path === "f.txt"));
  assert.deepEqual(state.violations, []);
});

test("the conflict view draws a tab in a side's lines as the diff does (spaces to the next multiple of four columns); saving writes the tab", async () => {
  const r = repo(({ write, git }) => {
    write("m.c", "#define A\t1\n"); git("add", "-A"); git("commit", "-qm", "init");
    git("switch", "-q", "-c", "side"); write("m.c", "#define A\t2\n"); git("commit", "-qam", "side");
    git("switch", "-q", "main"); write("m.c", "#define A\t3\n"); git("commit", "-qam", "main");
  });
  try { r.git("merge", "side"); } catch { /* stops on conflicts */ }
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  assert.equal(page.open?.path, "m.c");
  let tree = await draw(view);
  const drawn = texts(byId(tree, "conflict-0"));
  assert.ok(drawn.includes("#define A   3") && drawn.includes("#define A   2"), JSON.stringify(drawn));
  assert.ok(!drawn.some((x) => x.includes("\t")), "no tab drawn");
  press(byId(tree, "conflict-0-theirs"));
  tree = await draw(view);
  press(byId(tree, "conflict-save-resolved")); await settle();
  assert.equal(r.read("m.c"), "#define A\t2\n", "the file keeps its tab");
  assert.deepEqual(state.violations, []);
});
