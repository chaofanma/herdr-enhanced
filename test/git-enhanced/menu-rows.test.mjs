// A menu row with one line is a one-line row: 26 px, its words in the middle. The branch menu's
// branches and the author menu's Anyone had a blank second line to be as tall as the rows with two,
// so their name sat at the top of 36 px.
import { test } from "node:test";
import assert from "node:assert/strict";
import { repo, mount, draw, byId, walk, texts, handler, settle, makeCx } from "./render/load.mjs";

const popover = (tree, id) => { let hit = null; walk(tree, (n) => { if (n.popover === id) hit ??= n; }); return hit; };
const call = (d, m) => d.calls.find(([k]) => k === m)?.[1]?.[0];
const said = (d) => texts({ $: d }).map((w) => w.trim()).filter(Boolean);
// The card's height: its rows', 1 px apart, 5 px padding and a 1 px border (ui.js listCard).
const cardOf = (tree, id) => { let hit = null; walk({ $: popover(tree, id) }, (n) => { if (!hit && n.calls?.some(([m]) => m === "overflow_y_scrollbar")) hit = n; }); return hit; };
const rowsOf = (card) => card.children.map((c) => c.$).filter((d) => d && call(d, "h"));
// A row's height with its margins (the rule between groups: 1 px and 3 above and below).
const tall = (d) => call(d, "h") + 2 * (call(d, "my") ?? 0);

async function history() {
  const r = repo(({ write, git }) => {
    write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one");
    git("branch", "topic"); git("branch", "other");
    write("a.txt", "two\n"); git("add", "-A"); git("commit", "-qm", "two");
  });
  const view = await mount(r.dir, { palette: "theme", view: "history" });
  await draw(view); await settle();
  return view;
}
async function opened(view, id) {
  handler(popover(await draw(view), id), "on_open_change")(true, makeCx());
  return draw(view);
}

test("the branch menu: a branch's row is one line, 26 px; the checked-out one says so on a second line; the card fits them", async () => {
  const view = await history(), h = view.part.history;
  const tree = await opened(view, "history-branches");
  const names = h.branchNames;
  assert.ok(names.includes("topic") && names.includes("main"), names.join(" "));
  const row = (name) => byId(tree, `history-branch-${names.indexOf(name)}`);
  assert.deepEqual([call(row("topic"), "h"), said(row("topic"))], [26, ["topic"]]);
  assert.deepEqual([call(row("main"), "h"), said(row("main"))], [36, ["main", "checked out"]]);
  const card = cardOf(tree, "history-branches"), rows = rowsOf(card);
  assert.equal(call(card, "h"), 12 + rows.reduce((n, d) => n + tall(d), 0) + rows.length - 1, "as tall as its rows");
});

test("the author menu: Anyone is one line, 26 px; a person's row has their count under the name", async () => {
  const view = await history();
  const tree = await opened(view, "history-authors");
  const any = byId(tree, "history-author-any"), person = byId(tree, "history-author-0");
  assert.deepEqual([call(any, "h"), said(any)], [26, ["Anyone"]]);
  assert.equal(call(person, "h"), 36);
  const card = cardOf(tree, "history-authors"), rows = rowsOf(card);
  assert.equal(call(card, "h"), 12 + rows.reduce((n, d) => n + tall(d), 0) + rows.length - 1);
});
