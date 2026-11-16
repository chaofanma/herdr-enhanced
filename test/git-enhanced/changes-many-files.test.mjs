// The Changes page with hundreds of changed files: each section shows its first ROWS_AT_ONCE rows, then
// a row "Show 100 more · N left" (a render builds every row shown, and Herdr stops a render that runs
// too long). An open file is always shown, and a new repository starts again at ROWS_AT_ONCE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, byId, allById, handler, textOf, settle, makeCx, load, at } from "./render/load.mjs";

const { ROWS_AT_ONCE, listHeight } = await load("filelist.js");
const pad = (i) => String(i).padStart(3, "0");
const staged = (i) => `src/m${pad(i)}.txt`, unstaged = (i) => `old/u${pad(i)}.txt`;

// `s` new files staged, `u` committed files changed and not staged.
function many(s, u) {
  return repo(({ write, git }) => {
    write("base.txt", "1\n");
    for (let i = 0; i < u; i++) write(unstaged(i), "a\n");
    git("add", "-A"); git("commit", "-qm", "base");
    for (let i = 0; i < s; i++) write(staged(i), `${i}\n`);
    git("add", "-A");
    for (let i = 0; i < u; i++) write(unstaged(i), "b\n");
  });
}
const rowsOf = (tree, section) => allById(tree, new RegExp(`^file-${section}-`));
const words = (node) => (node ? textOf({ $: node }) : null);

test("changes: each section shows its first 100 rows, then Show 100 more · N left; a click shows 100 more, the last the rest", async () => {
  assert.equal(ROWS_AT_ONCE, 100);
  const r = many(250, 120), view = await mount(r.dir);
  let tree = await draw(view);
  assert.equal(rowsOf(tree, "staged").length, 100);
  assert.equal(rowsOf(tree, "unstaged").length, 100);
  assert.ok(byId(tree, `file-staged-${staged(99)}`) && !byId(tree, `file-staged-${staged(100)}`), "the first 100, in order");
  assert.equal(words(byId(tree, "more-staged")), "Show 100 more · 150 left");
  assert.equal(words(byId(tree, "more-unstaged")), "Show 20 more");
  handler(byId(tree, "more-staged"), "on_click")({}, makeCx());
  tree = await draw(view);
  assert.equal(rowsOf(tree, "staged").length, 200);
  assert.equal(words(byId(tree, "more-staged")), "Show 50 more");
  assert.equal(rowsOf(tree, "unstaged").length, 100, "the other section keeps its own count");
  handler(byId(tree, "more-staged"), "on_click")({}, makeCx());
  tree = await draw(view);
  assert.equal(rowsOf(tree, "staged").length, 250);
  assert.equal(byId(tree, "more-staged"), null, "nothing more to show");
  // The section's header still counts every file.
  assert.ok(words(byId(tree, "section-staged")).includes("250"), words(byId(tree, "section-staged")));
  assert.deepEqual(state.violations, []);
});

test("changes: a file opened below the rows shown is shown, and stays so after it closes; a new repository starts at 100", async () => {
  const r = many(250, 0), view = await mount(r.dir), page = view.part;
  await draw(view);
  page.pick(staged(180), "staged", makeCx()); await settle();
  let tree = await draw(view);
  assert.ok(byId(tree, `file-staged-${staged(180)}`), "the open file's row");
  assert.equal(rowsOf(tree, "staged").length, 181);
  assert.equal(words(byId(tree, "more-staged")), "Show 69 more");
  page.pick(staged(180), "staged", makeCx()); await settle();
  tree = await draw(view);
  assert.equal(page.open, null, "closed");
  assert.equal(rowsOf(tree, "staged").length, 181, "the list doesn't jump back up");
  // Another repository: its own list, from the top.
  const other = many(150, 0);
  at(other.dir); await draw(view); await settle();
  tree = await draw(view);
  assert.equal(page.root, other.dir);
  assert.equal(rowsOf(tree, "staged").length, 100);
  assert.equal(words(byId(tree, "more-staged")), "Show 50 more");
  assert.deepEqual(state.violations, []);
});

test("changes: the list's height counts the rows shown and the Show more row, not the rows past it", () => {
  const rows = (n) => ({ key: "staged", rows: Array.from({ length: n }, (_, i) => ({ f: { path: String(i) } })) });
  const big = 1e6, row = listHeight([rows(2)], big) - listHeight([rows(1)], big);
  assert.equal(listHeight([rows(250)], big), listHeight([rows(100)], big) + 150 * row, "without `shown`: every row");
  assert.equal(listHeight([rows(250)], big, () => 100), listHeight([rows(101)], big), "100 rows and the Show more row");
  assert.equal(listHeight([rows(80)], big, () => 100), listHeight([rows(80)], big), "fewer rows than shown: no Show more row");
});
