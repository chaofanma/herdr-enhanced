// The @@ rows' buttons (stage, unstage, revert one hunk) and the Review tab (side by side, changed
// words, Viewed files, its keys), against a temp repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, byId, lists, renderRows, handler, press, texts, walk, settle, makeCx, load, asOverlay } from "./render/load.mjs";
import { NAME } from "./mod.mjs";

const { KEY } = await load("id.js");
const { answer } = await load("question.js");
const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
function setup() {
  const r = repo(({ write, git }) => { write("f.txt", lines.join("\n") + "\n"); write("s.txt", "a\nb\n"); git("add", "-A"); git("commit", "-qm", "one"); });
  const edited = [...lines]; edited[1] = "line 2 changed"; edited[18] = "line 19 changed";
  r.write("f.txt", edited.join("\n") + "\n");
  r.write("s.txt", "a\nB\n"); r.git("add", "s.txt");
  r.write("new.txt", "fresh\n");
  return { r, edited };
}
// A press at x on the rows, then the list's click on `key`.
function click(tree, page, key, x) {
  const [list] = lists(tree).filter((l) => l.listId === "changes-diff");
  handler(byId(tree, "changes-diff-rows"), "on_mouse_down")({ local_position: { x, y: 5 } }, makeCx());
  handler(list, "on_item_click")(key, makeCx());
}
const question = async (value) => { await settle(); const q = state.overlays.at(-1)?.props?.question; assert.ok(q, "a question"); asOverlay(state.overlays.at(-1), () => answer(q.id, value)); await settle(); return q; };

test("hunk buttons: Stage and Revert… on an unstaged diff, Unstage on a staged one, none on a new file", async () => {
  const { r } = setup(), view = await mount(r.dir, { palette: "theme" }), page = view.part;
  page.pick("f.txt", "unstaged", makeCx()); await settle();
  assert.deepEqual(page.hunkActions().map((a) => a.id), ["stage", "revert"]);
  let tree = await draw(view);
  handler(byId(tree, "changes-diff-rows"), "on_size_change")({ width: 366, height: 400 }, makeCx());
  tree = await draw(view);
  const [list] = lists(tree).filter((l) => l.listId === "changes-diff");
  const rows = renderRows(list), first = page.diff.itemOf(page.diff.hunks[0]);
  assert.ok(texts(rows[first]).includes("Stage") && texts(rows[first]).includes("Revert…"));
  assert.deepEqual(state.violations, []);
  const g = page.diff.buttons(), right = page.diff.view() - g.pad;
  // The first button (Stage): the first hunk goes into the index, the second stays out.
  click(tree, page, `r:${page.diff.hunks[0]}`, right - g.width - g.gap - g.width / 2);
  assert.equal(page.busy, "stageHunk");
  await settle();
  const cached = r.git("diff", "--cached", "--", "f.txt");
  assert.match(cached, /\+line 2 changed/); assert.doesNotMatch(cached, /line 19/);
  assert.equal(page.composer, null, "a button press opens no comment box");
  // A press elsewhere on the @@ row opens the comment box on the hunk.
  tree = await draw(view);
  click(tree, page, `r:${page.diff.hunks[0]}`, 40);
  assert.ok(page.composer && page.composer.from !== null);
  page.closeBox(makeCx());
  // Revert… asks (the hunk shown), keeps a copy, then the hunk goes from the working tree.
  click(tree, page, `r:${page.diff.hunks[0]}`, right - g.width / 2);
  const q = await question({});
  assert.match(q.title, /Revert this hunk\?/); assert.match(q.detail, /@@ .*line 19 changed|@@ -/);
  assert.doesNotMatch(r.read("f.txt"), /line 19 changed/);
  assert.match(r.read("f.txt"), /line 2 changed/, "the staged hunk is left alone");
  page.pick("s.txt", "staged", makeCx()); await settle();
  assert.deepEqual(page.hunkActions().map((a) => a.id), ["unstage"]);
  page.pick("new.txt", "unstaged", makeCx()); await settle();
  assert.deepEqual(page.hunkActions(), []);
  assert.deepEqual(state.violations, []);
});

test("the Review tab: side by side, Viewed by hash (kept by staging, gone with an edit), keys", async () => {
  const { r, edited } = setup();
  state.shared.set(KEY.layout, "split");
  const view = await mount(r.dir, { palette: "theme", review: true, root: r.dir, on: null }), page = view.part;
  page.pick("f.txt", "unstaged", makeCx()); await settle();
  assert.equal(page.diff.sideBySide(), true);
  let tree = await draw(view);
  handler(byId(tree, "changes-diff-rows"), "on_size_change")({ width: 1200, height: 700 }, makeCx());
  tree = await draw(view);
  renderRows(lists(tree).find((l) => l.listId === "changes-diff"));
  assert.deepEqual(state.violations, []);
  assert.ok(page.hashes instanceof Map && page.hashes.has("f.txt") && page.hashes.has("new.txt"));
  const keys = handler(byId(tree, "changes"), "on_key_down"), key = (k) => { const cx = makeCx(); keys({ key: k, modifiers: {} }, cx); return cx.stopped; };
  assert.equal(page.currentHunk(), page.diff.hunks[0]);
  assert.equal(key("j"), true); assert.equal(page.hunkAt, 1);
  key("k"); assert.equal(page.hunkAt, 0);
  key("v"); assert.equal(page.isViewed("f.txt"), true);
  tree = await draw(view);
  const ids = []; walk(tree, (n) => { if (typeof n.id === "string" && n.id.startsWith("viewed-") && n.id.endsWith("f.txt")) ids.push(n.id); });
  assert.ok(ids.length && ids.every((i) => i.startsWith("viewed-on-")), "the box's id names its state");
  assert.ok(texts(byId(tree, "changes")).some((x) => /1 \/ 3 viewed/.test(x)));
  key("s"); await settle();
  assert.match(r.git("diff", "--cached", "--stat"), /f\.txt/);
  assert.equal(page.isViewed("f.txt"), true, "staging doesn't change the diff against HEAD");
  r.write("f.txt", edited.join("\n") + "\nmore\n");
  page.refresh(makeCx("async")); await settle();
  assert.equal(page.isViewed("f.txt"), false, "an edit un-views it");
  // n / p move through the files.
  const before = JSON.stringify(page.open);
  key("n"); await settle();
  assert.notEqual(JSON.stringify(page.open), before);
  key("p"); await settle();
  assert.equal(JSON.stringify(page.open), before);
  // Changed words are marked; a click on a side-by-side row opens the box on its new side.
  assert.ok(page.diff.words.size > 0);
  tree = await draw(view);
  const pair = page.diff.split.findIndex((s) => s.left != null && s.right != null && s.left !== s.right);
  click(tree, page, `s:${pair}`, 700);
  assert.ok(page.composer);
  assert.equal(page.diff.rows[page.composer.from].kind, "+");
  state.shared.delete(KEY.layout);
  assert.deepEqual(state.violations, []);
});

test("the panel's button opens the Review tab on its repository", async () => {
  const { r } = setup(), view = await mount(r.dir);
  press(byId(await draw(view), "open-review"));
  assert.deepEqual(state.runs.at(-1), ["tab.new", { name: "Review", mod: NAME, props: { review: true, root: r.dir, on: null } }]);
});
