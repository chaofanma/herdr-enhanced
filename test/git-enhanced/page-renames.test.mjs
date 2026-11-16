// Renames: one row "old → new", and staging, unstaging, reverting, hunks, stashing and the scopes keep
// both paths right.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { state, repo, mount, overlay, drawWith, draw, byId, handler, press, texts, settle, makeCx, load, asOverlay } from "./render/load.mjs";
import { NAME } from "./mod.mjs";

const { answer } = await load("question.js");
const question = async (value) => { await settle(); const q = state.overlays.at(-1)?.props?.question; assert.ok(q, "a question"); asOverlay(state.overlays.at(-1), () => answer(q.id, value)); await settle(); return q; };

test("renames: listed once as R with its old path; hunks unstage the content only; both paths stage, unstage, revert, stash", async () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  const r = repo(({ write, git }) => { write("old.txt", lines.join("\n") + "\n"); write("keep.txt", "k\n"); git("add", "-A"); git("commit", "-qm", "init"); });
  r.git("mv", "old.txt", "new.txt");
  const staged = [...lines]; staged[4] = "line 5 changed"; staged[24] = "line 25 changed"; r.write("new.txt", staged.join("\n") + "\n"); r.git("add", "new.txt");
  const status = () => r.git("status", "--porcelain=v1").split("\n").filter(Boolean);
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  assert.equal(page.error, null);
  assert.deepEqual(page.files.map((f) => [f.path, f.status, f.from]), [["new.txt", "R", "old.txt"]], "one file; no old.txt deleted");
  assert.deepEqual(page.sections().map((g) => [g.key, g.rows.map((x) => [x.f.path, x.letter, x.add, x.del])]), [["staged", [["new.txt", "R", 2, 2]]]]);
  let tree = await draw(view);
  assert.ok(texts(byId(tree, "file-staged-new.txt")).includes("old.txt → "));
  if (page.open?.path !== "new.txt") { page.pick("new.txt", "staged", makeCx()); await settle(); }
  assert.deepEqual(page.hunkActions().map((a) => a.id), ["unstage"]);
  assert.ok(page.diff.rows.some((x) => x.kind === "+" && x.text === "line 5 changed"));
  assert.ok(!page.patch.header.some((l) => l.startsWith("rename")), "the patch names new.txt on both sides");
  page.hunk("unstage", page.diff.hunks[0], makeCx()); await settle();
  assert.deepEqual(status(), ["RM old.txt -> new.txt"], page.line);
  assert.equal(r.git("show", ":new.txt").split("\n")[4], "line 5");
  page.pick("new.txt", "unstaged", makeCx()); await settle();
  assert.deepEqual(page.hunkActions().map((a) => a.id), ["stage", "revert"]);
  // Unstage the file: both paths; an intent-to-add rename stages back as one.
  page.stageRow("new.txt", "staged", makeCx()); await settle();
  assert.deepEqual(status(), [" D old.txt", "?? new.txt"], page.line);
  r.git("add", "-N", "new.txt");
  page.refresh(makeCx("async")); await settle();
  assert.deepEqual(page.sections().flatMap((g) => g.rows.map((x) => [x.f.path, x.f.from])), [["new.txt", "old.txt"]]);
  page.stageRow("new.txt", "unstaged", makeCx()); await settle();
  assert.deepEqual(status(), ["R  old.txt -> new.txt"], page.line);
  // Revert from the file menu: it says it takes back the rename; both paths go back; the copy has the new file.
  page.fileMenu("new.txt", "staged", makeCx());
  await question("revert");
  const q = await question({});
  assert.match(q.detail, /takes back the rename of old\.txt to new\.txt/);
  assert.deepEqual(status(), []);
  assert.ok(existsSync(join(r.dir, "old.txt")) && !existsSync(join(r.dir, "new.txt")));
  const copy = r.git("for-each-ref", "--sort=-refname", "--count=1", "--format=%(objectname)", `refs/${NAME}/discarded/`).trim();
  assert.equal(r.git("show", `${copy}:new.txt`).split("\n")[4], "line 5 changed");
  // A committed rename in the Last commit scope: paired by -M; a whole-file comment says it was renamed.
  r.git("mv", "old.txt", "moved.txt"); r.write("moved.txt", staged.join("\n") + "\n"); r.git("add", "-A"); r.git("commit", "-qm", "move");
  r.write("keep.txt", "k2\n");
  page.refresh(makeCx("async")); await settle();
  page.setScope("last", makeCx()); await settle();
  const moved = page.files.find((f) => f.path === "moved.txt");
  assert.deepEqual([moved.status, moved.from], ["R", "old.txt"]);
  page.pick("moved.txt", "committed", makeCx()); await settle();
  assert.ok(page.diff.rows.some((x) => x.kind === "+" && x.text === "line 25 changed"));
  assert.equal(page.describe("moved.txt"), "renamed from old.txt, +2 −2");
  // Stash only the selected files: a ticked rename takes its old path along; pop --index brings it back.
  page.setScope("work", makeCx()); await settle();
  r.git("mv", "moved.txt", "again.txt");
  page.refresh(makeCx("async")); await settle();
  page.stashWith(makeCx()); await settle();
  const spec = state.overlays.at(-1);
  const { view: dialog, props } = overlay(spec);
  dialog.part.choice = "files"; dialog.part.files.forEach((_v, k) => dialog.part.files.set(k, k === "again.txt"));
  handler(byId(drawWith(dialog, props), "question-confirm"), "on_click")({}, makeCx()); await settle();
  assert.deepEqual(status(), [" M keep.txt"], `the rename went into the stash: ${page.line}`);
  assert.ok(existsSync(join(r.dir, "moved.txt")) && !existsSync(join(r.dir, "again.txt")));
  assert.match(r.git("stash", "show", "--name-status", "-M", "stash@{0}"), /^R\d*\tmoved\.txt\tagain\.txt$/m);
  r.git("stash", "pop", "-q", "--index");
  assert.deepEqual(status(), ["R  moved.txt -> again.txt", " M keep.txt"]);
  assert.deepEqual(state.violations, []);
});
