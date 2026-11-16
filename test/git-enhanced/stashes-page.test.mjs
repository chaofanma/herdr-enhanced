// Stashes: the popover, a stash's changes in place of the diff, Apply / Pop / Drop (asks), the quick
// Stash and the Stash… dialog, a pop that stops on conflicts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { state, repo, mount, overlay, drawWith, renderNow, draw, byId, lists, renderRows, handler, press, texts, settle, makeCx } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

// Answers the last question: `set(part)` fills the form first; then Confirm, or (cancel) its close.
async function answerLast(set = () => {}, cancel = false) {
  await settle();
  const spec = state.overlays.at(-1);
  assert.ok(spec?.props?.question, "a question was asked");
  const { view: q, props } = overlay(spec);
  set(q.part);
  const tree = drawWith(q, props);
  if (cancel) await q.close(); else handler(byId(tree, "question-confirm"), "on_click")({}, makeCx());
  await settle();
  return { spec: spec.props.question, tree };
}

test("stashes: the list, the view, Apply, Drop (asks), Stash… choices, a pop that conflicts", async () => {
  const r = repo(({ write, git }) => {
    write("a.js", "const a = 1;\nconst b = 2;\n"); write("b.txt", "b\n"); git("add", "-A"); git("commit", "-qm", "init");
    write("a.js", "const a = 10;\nconst b = 2;\n"); write("new.txt", "untracked\n"); git("stash", "push", "-q", "-u", "-m", "first stash");
    write("b.txt", "bb\n"); git("stash", "push", "-q");
    write("b.txt", "working\n");
  });
  const { dir, git } = r;
  const view = await mount(dir, { palette: "theme" }), page = view.part;
  assert.equal(page.error, null);
  assert.deepEqual(page.stashes.map((s) => [s.ref, s.branch, s.wip, s.untracked]), [["stash@{0}", "main", true, false], ["stash@{1}", "main", false, true]]);
  assert.match(page.stashes[0].message, /^[0-9a-f]{7,} init$/);
  page.choosingStash = true;
  let tree = await draw(view);
  assert.deepEqual(texts(byId(tree, "stash-show-1")), ["first stash", `on main · ${page.stashes[1].age} · stash@{1}`]);
  assert.ok(byId(tree, "drop-1") && byId(tree, "apply-1") && byId(tree, "pop-1"));
  press(byId(tree, "stash-show-1"));
  assert.equal(page.choosingStash, false);
  await settle();
  tree = await draw(view);
  assert.ok(byId(tree, "changes-diff-box").calls.some(([m]) => m === "hidden"), "the diff gives way");
  assert.ok(texts(byId(tree, "stash-view")).includes("first stash"));
  const rowText = renderRows(lists(tree).find((l) => l.listId === "stash-diff")).flatMap((x) => texts(x));
  assert.ok(rowText.includes("a.js") && rowText.includes("new.txt"));
  assert.equal(page.stashShown.view.counts.files, 2);
  assert.deepEqual(state.violations, []);
  git("checkout", "-q", "--", "b.txt");
  page.refresh(makeCx("async")); await settle();
  press(byId(await draw(view), "stash-view-apply")); await settle();
  assert.equal(readFileSync(join(dir, "a.js"), "utf8"), "const a = 10;\nconst b = 2;\n");
  assert.equal(existsSync(join(dir, "new.txt")), true);
  assert.equal(page.stashes.length, 2, page.line);
  tree = await draw(view);
  assert.ok(byId(tree, "stash-view"), "the view stays after an apply");
  git("checkout", "-q", "--", "a.js"); git("clean", "-fq");
  press(byId(tree, "stash-view-drop"));
  const asked = await answerLast(() => {}, true);
  assert.match(asked.spec.title, /^Drop stash@\{1\}\?$/); assert.equal(asked.spec.danger, true);
  assert.equal(git("stash", "list").trim().split("\n").length, 2, "cancelled");
  press(byId(tree, "stash-view-drop"));
  await answerLast();
  assert.equal(git("stash", "list").trim().split("\n").length, 1, page.line);
  tree = await draw(view);
  assert.equal(byId(tree, "stash-view"), null, "the view closes with its stash");
  // Stash… : only the ticked files, with a message (a ticked untracked file goes too).
  writeFileSync(join(dir, "a.js"), "const a = 3;\nconst b = 2;\n"); writeFileSync(join(dir, "b.txt"), "changed\n"); writeFileSync(join(dir, "u2.txt"), "u\n");
  page.refresh(makeCx("async")); await settle();
  press(byId(await draw(view), "stash-with"));
  let { spec } = await answerLast((q) => { q.choice = "files"; q.files.set("a.js", true); q.files.set("u2.txt", true); q.input.set_value("just a.js"); });
  assert.deepEqual(spec.choices.options.map((o) => [o.id, Boolean(o.disabled)]), [["all", false], ["staged", true], ["files", false]]);
  assert.match(git("stash", "list"), /stash@\{0\}: On main: just a\.js/);
  assert.equal(readFileSync(join(dir, "a.js"), "utf8"), "const a = 1;\nconst b = 2;\n");
  assert.equal(readFileSync(join(dir, "b.txt"), "utf8"), "changed\n");
  assert.equal(existsSync(join(dir, "u2.txt")), false);
  // Only the staged changes (untracked files stay).
  git("add", "b.txt"); writeFileSync(join(dir, "c.txt"), "c\n");
  page.refresh(makeCx("async")); await settle();
  page.stashWith(makeCx());
  ({ spec } = await answerLast((q) => { q.choice = "staged"; }));
  assert.equal(spec.choices.options[1].disabled, false);
  assert.equal(git("stash", "show", "--name-only", "stash@{0}").trim(), "b.txt");
  assert.equal(existsSync(join(dir, "c.txt")), true);
  // Confirm is off while "only the selected files" has none ticked.
  page.stashWith(makeCx()); await settle();
  const { view: q } = overlay(state.overlays.at(-1));
  q.part.choice = "files"; q.part.files.forEach((_v, k) => q.part.files.set(k, false));
  assert.equal(q.part.value(), null);
  await q.close(); await settle();
  // The quick Stash: everything, new files too.
  page.refresh(makeCx("async")); await settle();
  press(byId(await draw(view), "stash")); await settle();
  assert.equal(git("status", "--porcelain"), "", page.line);
  git("stash", "pop", "-q");
  // A pop that conflicts says so in git's words; the stash stays.
  git("checkout", "-q", "--", "."); git("clean", "-fq");
  git("stash", "drop", "-q");
  writeFileSync(join(dir, "a.js"), "const a = 99;\nconst b = 2;\n"); git("commit", "-qam", "conflicting");
  page.refresh(makeCx("async")); await settle();
  const top = page.stashes[0];
  assert.equal(top.message, "just a.js");
  page.stashAction(top, "pop", makeCx()); await settle();
  assert.match(page.line ?? "", /^Stash pop stopped with conflicts: [\s\S]*CONFLICT/);
  assert.ok(page.stashes.some((s) => s.hash === top.hash));
  assert.ok([...page.dirty.values()].includes("UU"));
  // Another repository shown: the stash view goes with its own.
  page.showStash(page.stashes[0], makeCx()); await settle();
  const other = tempDir("git-enhanced-other-"); execFileSync("git", ["init", "-q"], { cwd: other });
  state.focused = { ...state.focused, cwd: other }; state.panes = [{ pane: "p1", cwd: other }];
  renderNow(view); await settle();
  assert.equal(byId(await draw(view), "stash-view"), null);
  assert.deepEqual(state.violations, []);
});
