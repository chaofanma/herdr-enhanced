// The ⋯ menu by Commit: Undo last commit, Undo last git action…, Recently discarded… (the copies kept
// before every revert), Settings…, and a revert that can't keep a copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { state, mount, overlay, drawWith, draw, byId, handler, press, settle, makeCx } from "./render/load.mjs";
import { NAME } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";

const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const cfg = (d) => { sh(d, "config", "user.name", "t"); sh(d, "config", "user.email", "t@t"); sh(d, "config", "core.hooksPath", "/dev/null"); };
// Answers the last question: a menu's item (`pick`), an entry's button (`entry`), Confirm, or a cancel.
async function answerLast({ cancel = false, pick = null, entry = null } = {}) {
  await settle();
  const spec = state.overlays.at(-1);
  assert.ok(spec?.props?.question, "a question was asked");
  const { view: q, props } = overlay(spec);
  const tree = drawWith(q, props);
  state.props = props;
  if (cancel) await q.close();
  else handler(byId(tree, pick ? `menu-${pick}` : entry !== null ? `question-entry-button-${entry}` : "question-confirm"), "on_click")({}, makeCx());
  state.props = { palette: "theme" };
  await settle();
  return { spec: spec.props.question, tree };
}
const more = async (view, pick) => { press(byId(await draw(view), "commit-more")); return answerLast({ pick }); };

test("undo: the last commit (asks when pushed), the last git action (marked, so the next goes further), a refusal", async () => {
  const base = tempDir("git-enhanced-undo-");
  sh(base, "init", "-q", "--bare", "-b", "main", "remote.git");
  sh(base, "clone", "-q", "remote.git", "a"); const A = join(base, "a"); cfg(A);
  const write = (p, s) => writeFileSync(join(A, p), s);
  write("f.txt", "one\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "First"); sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  const subject = () => sh(A, "log", "-1", "--format=%s").trim();
  const view = await mount(A, { palette: "theme" }), page = view.part;
  assert.ok(byId(await draw(view), "commit-more"));
  write("f.txt", "two\n"); sh(A, "commit", "-qam", "Second\n\nWith a body.");
  page.refresh(makeCx("async")); await settle();
  let { spec } = await more(view, "undo-commit");
  assert.deepEqual(spec.items.map((i) => i.id), ["undo-commit", "undo-action", "move-commits", "copy-patch", "apply-patch", "discarded", "settings"]);
  assert.equal(subject(), "First", page.line);
  assert.equal(sh(A, "status", "--porcelain").trim(), "M  f.txt");
  assert.equal(page.input.value(), "Second\n\nWith a body.", "its message back in the box");
  page.input.set_value("");
  sh(A, "commit", "-qm", "Second again"); sh(A, "push", "-q");
  page.refresh(makeCx("async")); await settle();
  await more(view, "undo-commit");
  ({ spec } = await answerLast({ cancel: true }));
  assert.match(spec.detail, /already on origin\/main: afterwards main and origin\/main differ/);
  assert.equal(subject(), "Second again", "cancelled");
  await more(view, "undo-commit"); await answerLast();
  assert.equal(subject(), "First");
  sh(A, "commit", "-qm", "Second again");
  sh(A, "switch", "-q", "-c", "side");
  page.refresh(makeCx("async")); await settle();
  await more(view, "undo-action");
  ({ spec } = await answerLast());
  assert.equal(spec.title, "Undo: switch from main to side?");
  assert.equal(sh(A, "branch", "--show-current").trim(), "main", page.line);
  await more(view, "undo-action");
  ({ spec } = await answerLast());
  assert.equal(spec.title, "Undo: commit “Second again”?");
  assert.match(spec.detail, /git reset --soft/);
  assert.equal(subject(), "First");
  sh(A, "commit", "-qm", "Third");
  write("f.txt", "three\n"); sh(A, "commit", "-qam", "Fourth"); sh(A, "reset", "-q", "--hard", "HEAD~1"); write("f.txt", "dirty\n");
  page.refresh(makeCx("async")); await settle();
  await more(view, "undo-action");
  ({ spec } = await answerLast());
  assert.equal(spec.title, "Undo: reset to HEAD~1?");
  assert.match(page.line ?? "", /^Undo refused: error: Entry 'f.txt' not uptodate/);
  // The branch's first commit: asks, then there are no commits; its files stay, staged.
  const C = tempDir("git-enhanced-undo-first-"); sh(C, "init", "-q", "-b", "main"); cfg(C);
  writeFileSync(join(C, "x.txt"), "x\n"); sh(C, "add", "-A"); sh(C, "commit", "-qm", "Root");
  const first = await mount(C, { palette: "theme" });
  await more(first, "undo-commit");
  ({ spec } = await answerLast());
  assert.match(spec.detail, /first commit: undoing it leaves main with no commits/);
  assert.equal(execFileSync("sh", ["-c", "git rev-parse -q --verify HEAD || echo none"], { cwd: C, encoding: "utf8" }).trim(), "none");
  assert.equal(sh(C, "status", "--porcelain").trim(), "A  x.txt");
  assert.equal(first.part.input.value(), "Root");
  assert.deepEqual(state.violations, []);
});

test("Recently discarded: every revert keeps a copy (a file, a new file, a hunk, all); Restore… puts it back; no copy: asked again", async () => {
  const A = tempDir("git-enhanced-discard-"); sh(A, "init", "-q", "-b", "main"); cfg(A);
  const read = (p) => readFileSync(join(A, p), "utf8"), write = (p, s) => writeFileSync(join(A, p), s);
  write("f.txt", "two\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "First");
  write("f.txt", "work in progress\n"); write("n.txt", "new file\n");
  const view = await mount(A, { palette: "theme" }), page = view.part;
  page.fileMenu("f.txt", "unstaged", makeCx()); await answerLast({ pick: "revert" }); await answerLast();
  assert.equal(read("f.txt"), "two\n");
  page.fileMenu("n.txt", "unstaged", makeCx()); await answerLast({ pick: "revert" }); await answerLast();
  assert.equal(existsSync(join(A, "n.txt")), false);
  write("f.txt", "edited again\n");
  page.refresh(makeCx("async")); await settle();
  await more(view, "discarded");
  let { spec } = await answerLast({ entry: 1 });
  assert.deepEqual(spec.entries.map((e) => e.title), ["Delete n.txt", "Revert f.txt"]);
  assert.match(spec.entries[1].detail, /^just now · 1 file: f\.txt$/);
  ({ spec } = await answerLast());
  assert.equal(spec.title, "Restore “Revert f.txt”?"); assert.deepEqual(spec.lines, ["overwrites  f.txt"]);
  assert.equal(read("f.txt"), "work in progress\n", page.line);
  await more(view, "discarded");
  ({ spec } = await answerLast({ entry: 1 }));
  assert.equal(spec.entries[0].title, "Before restoring “Revert f.txt”", "what a restore overwrote is kept too");
  await answerLast();
  assert.equal(read("n.txt"), "new file\n");
  sh(A, "checkout", "-q", "--", "."); sh(A, "clean", "-fq");
  write("f.txt", "two\nmore\n");
  page.refresh(makeCx("async")); await settle();
  if (page.open?.path !== "f.txt") { page.pick("f.txt", "unstaged", makeCx()); await settle(); }
  page.hunk("revert", page.diff.hunks[0], makeCx()); await answerLast();
  assert.equal(read("f.txt"), "two\n");
  write("f.txt", "all of it\n"); write("z.txt", "z\n");
  page.refresh(makeCx("async")); await settle();
  press(byId(await draw(view), "revert-all")); await answerLast();
  assert.equal(existsSync(join(A, "z.txt")), false);
  const kept = sh(A, "for-each-ref", "--sort=-refname", "--format=%(subject)", `refs/${NAME}/discarded/`).trim().split("\n");
  assert.deepEqual(kept.slice(0, 2), ["Revert all", "Revert a hunk of f.txt"]);
  // git can't keep a copy: asked again; only "without a copy" reverts.
  write("f.txt", "uncopied\n");
  page.refresh(makeCx("async")); await settle();
  state.execHook = (cmd, args) => (cmd === "sh" && /discarded/.test(args[1] ?? "") && /write-tree/.test(args[1] ?? "") ? { code: 1, stdout: "", stderr: "fatal: no space left\n" } : null);
  page.fileMenu("f.txt", "unstaged", makeCx()); await answerLast({ pick: "revert" }); await answerLast();
  assert.equal(read("f.txt"), "uncopied\n", "not reverted yet");
  ({ spec } = await answerLast({ cancel: true }));
  assert.equal(spec.title, "No copy could be kept"); assert.match(spec.detail, /fatal: no space left/);
  assert.equal(read("f.txt"), "uncopied\n", "cancelled: still there");
  page.fileMenu("f.txt", "unstaged", makeCx()); await answerLast({ pick: "revert" }); await answerLast();
  ({ spec } = await answerLast());
  assert.equal(spec.confirm, "Revert without a copy");
  assert.equal(read("f.txt"), "two\n");
  state.execHook = null;
  assert.deepEqual(state.violations, []);
});

test("⋯ by Commit: its tooltip names what its menu holds", async () => {
  const base = tempDir("git-enhanced-undo-tip-");
  sh(base, "init", "-q", "-b", "main", "a"); const A = join(base, "a"); cfg(A);
  writeFileSync(join(A, "f.txt"), "1\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "one");
  const view = await mount(A, { palette: "theme" });
  const more = byId(await draw(view), "commit-more");
  const tip = more.calls.find(([m]) => m === "tooltip")?.[1]?.[0];
  assert.equal(tip, "Undo the last commit or git action, move unpushed commits to a new branch, copy or apply a patch, recently discarded changes, settings");
  press(more);
  const { answer } = await import("./answers.mjs");
  const { spec } = await answer({ cancel: true });
  assert.deepEqual(spec.items.map((i) => i.id).filter((id) => ["move-commits", "copy-patch", "apply-patch", "discarded", "settings"].includes(id)).length >= 4, true);
  assert.deepEqual(state.violations, []);
});
