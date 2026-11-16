// History with a commit of many files: the files are a virtual list, so a render builds only the rows
// on screen. Every row was built on every render, and with a commit of 400 files Herdr stopped the
// render ("This view could not be re-rendered … interrupted").
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, byId, lists, renderRows, handler, settle, makeCx } from "./render/load.mjs";

const N = 400;
function bigCommit() {
  return repo(({ write, git }) => {
    write("a.txt", "1\n"); git("add", "-A"); git("commit", "-qm", "First");
    for (let i = 0; i < N; i++) write(`src/m${String(i).padStart(3, "0")}.txt`, `${i}\n`);
    git("add", "-A"); git("commit", "-qm", "Many files");
  });
}

test("history: a commit's 400 files are a list of their own; a render builds only the rows asked for", async () => {
  const r = bigCommit();
  const view = await mount(r.dir, { palette: "theme", view: "history" });
  await settle();
  const head = r.git("rev-parse", "HEAD").trim();
  handler(lists(await draw(view)).find((l) => l.listId === "history-commits"), "on_item_click")(head, makeCx());
  await settle();
  const tree = await draw(view);
  const files = lists(tree).find((l) => l.listId === "history-files-list");
  assert.ok(files, "the files' list");
  assert.equal(files.count, N);
  assert.equal(byId(tree, "history-file-0"), null, "no row built with the page");
  const rows = renderRows(files, { start: 0, end: 12 });
  assert.equal(rows.length, 12);
  assert.equal(files.getKey(0), "src/m000.txt");
  // A click on a row is the list's: that file's diff.
  handler(files, "on_item_click")("src/m007.txt", makeCx());
  await settle();
  assert.equal(view.part.history.file, "src/m007.txt");
  // A right-click, its menu.
  const before = state.overlays.length;
  handler(lists(await draw(view)).find((l) => l.listId === "history-files-list"), "on_item_secondary_click")("src/m007.txt", {}, makeCx());
  await settle();
  assert.ok(state.overlays.length > before, "the file row's menu");
  assert.deepEqual(state.violations, []);
});
