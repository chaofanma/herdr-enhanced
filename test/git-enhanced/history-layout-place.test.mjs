// History's layout button (the commit beside the list or under it) at the right end of the commit's
// files row, "1 file +1 −0": it arranges the commit, so it is with the commit. It was in the top row
// beside Split, an icon much like it for a different thing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { repo, mount, draw, settle, walk, texts, lists, handler, makeCx } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const rowOf = (tree, id) => { let row = null; walk(tree, (d) => { if (!row && d.children?.some((c) => (id instanceof RegExp ? id.test(String(c?.$?.id)) : c?.$?.id === id))) row = d; }); return row; };
const ids = (d) => d.children.map((c) => c?.$?.id ?? c?.$?.popover ?? c?.$?.kind);
const LAYOUT = /^history-layout-(auto|side|stacked)/;

function twoCommits(dirty = false) {
  return repo(({ write, git }) => {
    write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one");
    write("a.txt", "one\ntwo\n"); git("add", "-A"); git("commit", "-qm", "two");
    if (dirty) write("a.txt", "one\ntwo\nthree\n");
  });
}
async function picked(view, key) {
  const h = view.part.history;
  await draw(view); await settle();
  handler(lists(await draw(view)).find((l) => l.listId === "history-commits"), "on_item_click")(key ?? h.commits[0].hash, makeCx()); await settle();
  return draw(view);
}

test("the layout button is at the right end of the commit's files row, not in the top row", async () => {
  const view = await mount(twoCommits().dir, { palette: "theme", view: "history" });
  const tree = await picked(view);
  const top = rowOf(tree, /^history-settings-/);
  assert.ok(top && !ids(top).some((k) => LAYOUT.test(k)), `the top row: ${ids(top).join(" ")}`);
  const row = rowOf(tree, LAYOUT);
  assert.ok(row, "the layout button");
  assert.deepEqual(texts({ $: row }), ["1 file", "+1", "−0"], "the files row");
  assert.match(ids(row).at(-1), LAYOUT, "at its right end");
});

test("the uncommitted changes' details have it at the right end of their files line", async () => {
  const view = await mount(twoCommits(true).dir, { palette: "theme", view: "history" });
  const tree = await picked(view, "uncommitted");
  const row = rowOf(tree, LAYOUT);
  assert.ok(row, "the layout button");
  assert.match(texts({ $: row }).join(""), /^1 file changed/);
  assert.match(ids(row).at(-1), LAYOUT);
});

test("the History tab has it there too", async () => {
  const r = twoCommits();
  const tab = await mount(tempDir("git-enhanced-layout-place-"), { palette: "theme", view: "history", root: r.dir, on: null });
  const tree = await picked(tab);
  const top = rowOf(tree, /^history-settings-/);
  assert.ok(!ids(top).some((k) => LAYOUT.test(k)), ids(top).join(" "));
  assert.deepEqual(texts({ $: rowOf(tree, LAYOUT) }), ["1 file", "+1", "−0"]);
});
