// Staging single lines: the comment box's rows staged, unstaged and discarded (asks, keeps a copy),
// through the page with real git.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, byId, press, texts, settle, makeCx } from "./render/load.mjs";
import { answer } from "./answers.mjs";

const rowOf = (page, kind, text) => page.diff.rows.findIndex((r) => r.kind === kind && r.text === text);

test("lines: Stage lines and Unstage lines take only the selected rows; Discard… asks and keeps a copy", async () => {
  const r = repo(({ write, git }) => {
    write("f.txt", "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n"); git("add", "-A"); git("commit", "-qm", "init");
    write("f.txt", "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nK\n");
  });
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  assert.deepEqual(page.open, { path: "f.txt", section: "unstaged" });
  // From the context row above to +B: the -b and +B lines (the change at the end isn't in it).
  const plusB = rowOf(page, "+", "B");
  assert.ok(plusB > 0, JSON.stringify(page.diff.rows.map((x) => [x.kind, x.text])));
  page.clickRow(plusB - 2, makeCx()); page.clickRow(plusB, makeCx());
  let tree = await draw(view);
  assert.deepEqual(texts(byId(tree, "comment-lines")), ["2 changed lines", "Stage lines", "Discard…"]);
  press(byId(tree, "lines-stage")); await settle();
  assert.equal(page.composer, null);
  assert.equal(r.git("diff", "--cached", "--no-color", "-U0").split("\n").filter((l) => /^[-+][^-+]/.test(l)).join("|"), "-b|+B", page.line);
  // The staged diff: Unstage lines.
  page.pick("f.txt", "staged", makeCx()); await settle();
  page.clickRow(rowOf(page, "-", "b"), makeCx()); page.clickRow(rowOf(page, "+", "B"), makeCx());
  tree = await draw(view);
  assert.deepEqual(texts(byId(tree, "comment-lines")), ["2 changed lines", "Unstage lines"]);
  press(byId(tree, "lines-unstage")); await settle();
  assert.equal(r.git("diff", "--cached").trim(), "", page.line);
  // Discard the last line's change: asked, a copy kept, the other change stays.
  page.pick("f.txt", "unstaged", makeCx()); await settle();
  if (page.open?.section !== "unstaged") { page.pick("f.txt", "unstaged", makeCx()); await settle(); }
  page.clickRow(rowOf(page, "-", "k"), makeCx()); page.clickRow(rowOf(page, "+", "K"), makeCx());
  press(byId(await draw(view), "lines-discard"));
  const { spec } = await answer();
  assert.equal(spec.title, "Discard 2 lines of f.txt?");
  assert.deepEqual(spec.lines, ["-k", "+K"], "the question shows the lines");
  assert.match(spec.detail, /^The selected changes are taken out of the file; they aren't staged anywhere\. A copy is kept/);
  assert.equal(r.read("f.txt"), "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nk\n", page.line);
  assert.match(r.git("for-each-ref", "--format=%(refname)", "refs/git-enhanced/discarded/"), /discarded/);
  assert.deepEqual(state.violations, []);
});

test("lines: a comment typed in the box stays through Stage lines; a cancelled Discard… keeps the rows selected", async () => {
  const r = repo(({ write, git }) => {
    write("f.txt", "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n"); git("add", "-A"); git("commit", "-qm", "init");
    write("f.txt", "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nK\n");
  });
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  // Discard… cancelled: the box and its rows are still there.
  page.clickRow(rowOf(page, "-", "k"), makeCx()); page.clickRow(rowOf(page, "+", "K"), makeCx());
  const box = page.composer;
  press(byId(await draw(view), "lines-discard"));
  await answer({ cancel: true });
  assert.equal(page.composer, box);
  assert.deepEqual(texts(byId(await draw(view), "comment-lines")), ["2 changed lines", "Stage lines", "Discard…"]);
  // A comment typed, then Stage lines: staged, and the comment is still in the box.
  page.noteBox.set_value("why k became K"); page.noteText = "why k became K";
  press(byId(await draw(view), "lines-stage")); await settle();
  assert.match(r.git("diff", "--cached", "--no-color"), /^\+K$/m, page.line);
  assert.ok(page.composer, "the box stays while it holds a comment");
  assert.equal(page.noteBox.value(), "why k became K");
  assert.deepEqual(state.violations, []);
});

test("lines: once the diff is read again with other rows there, the box's lines refuse instead of taking other lines", async () => {
  const r = repo(({ write, git }) => {
    write("f.txt", "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n"); git("add", "-A"); git("commit", "-qm", "init");
    write("f.txt", "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nK\n");
  });
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  page.clickRow(rowOf(page, "-", "k"), makeCx()); page.clickRow(rowOf(page, "+", "K"), makeCx());
  assert.deepEqual(texts(byId(await draw(view), "comment-lines")), ["2 changed lines", "Stage lines", "Discard…"]);
  // The file changes above them: the diff is read again, and its rows move.
  r.write("f.txt", "a\nB\nc\nC2\nd\ne\nf\ng\nh\ni\nj\nK\n");
  page.refresh(makeCx("async"), true); await settle();
  assert.deepEqual(texts(byId(await draw(view), "comment-lines")), ["The diff changed since these rows were selected: select them again"]);
  page.lineAction("discard", makeCx()); await settle();
  assert.equal(r.read("f.txt"), "a\nB\nc\nC2\nd\ne\nf\ng\nh\ni\nj\nK\n", "nothing discarded");
  assert.deepEqual(state.violations, []);
});

test("lines: while a git action runs the line buttons wait and say why; an action asked for then says Busy instead of nothing", async () => {
  const r = repo(({ write, git }) => {
    write("f.txt", "a\nb\nc\n"); git("add", "-A"); git("commit", "-qm", "init");
    write("f.txt", "a\nB\nc\n");
  });
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  page.clickRow(rowOf(page, "-", "b"), makeCx()); page.clickRow(rowOf(page, "+", "B"), makeCx());
  page.busy = "fetch";
  const tree = await draw(view);
  assert.ok(byId(tree, "lines-stage-busy") && !byId(tree, "lines-stage"), "off while busy, its id says so");
  page.lineAction("stage", makeCx());
  assert.equal(page.line, "Busy (Fetching): try again once it's done");
  page.stageRow("f.txt", "unstaged", makeCx());
  assert.equal(page.line, "Busy (Fetching): try again once it's done");
  assert.equal(r.git("diff", "--cached").trim(), "", "nothing staged");
  page.busy = null;
  assert.deepEqual(state.violations, []);
});

test("lines: Discard…'s question shows a line with a tab as the diff draws it (spaces to the next multiple of four columns)", async () => {
  const r = repo(({ write, git }) => {
    write("m.c", "#define A\t1\nint\tx;\n"); git("add", "-A"); git("commit", "-qm", "init");
    write("m.c", "#define A\t2\nint\tx;\n");
  });
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  if (page.open?.path !== "m.c") { page.pick("m.c", "unstaged", makeCx()); await settle(); }
  page.clickRow(rowOf(page, "-", "#define A\t1"), makeCx()); page.clickRow(rowOf(page, "+", "#define A\t2"), makeCx());
  press(byId(await draw(view), "lines-discard"));
  const { spec, tree } = await answer({ cancel: true });
  assert.deepEqual(spec.lines, ["-#define A   1", "+#define A   2"], "after the sign, as in the diff");
  assert.deepEqual(texts(byId(tree, "question-lines")), ["-#define A   1", "+#define A   2"]);
  assert.equal(r.read("m.c"), "#define A\t2\nint\tx;\n", "cancelled: nothing discarded");
  assert.deepEqual(state.violations, []);
});
