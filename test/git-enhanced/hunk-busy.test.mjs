// A hunk's buttons while a git action runs: they wait as every control that waits does (faded to
// 0.7), and a press, or the key, says why nothing happened instead of nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, byId, lists, renderRows, handler, walk, settle, makeCx } from "./render/load.mjs";

const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
async function open() {
  const r = repo(({ write, git }) => { write("f.txt", lines.join("\n") + "\n"); git("add", "-A"); git("commit", "-qm", "one"); });
  const edited = [...lines]; edited[1] = "line 2 changed";
  r.write("f.txt", edited.join("\n") + "\n");
  // The only changed file: the page opens its diff by itself (a pick of it would close it).
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  await settle();
  assert.deepEqual(page.open, { path: "f.txt", section: "unstaged" });
  let tree = await draw(view);
  handler(byId(tree, "changes-diff-rows"), "on_size_change")({ width: 366, height: 400 }, makeCx());
  tree = await draw(view);
  return { r, view, page, tree };
}
// The @@ row's buttons as drawn: { label, faded } for each.
function buttons(tree, page) {
  const [list] = lists(tree).filter((l) => l.listId === "changes-diff");
  const row = renderRows(list)[page.diff.itemOf(page.diff.hunks[0])], out = [];
  walk(row, (n) => {
    const words = (n.children ?? []).filter((c) => typeof c === "string");
    if (n.calls.some(([m]) => m === "absolute") && words.length) out.push({ label: words.join(""), faded: n.calls.findLast(([m]) => m === "opacity")?.[1][0] ?? 1 });
  });
  return out;
}
// A press at x on the rows, then the list's click on the hunk's @@ row.
function press(tree, page, x) {
  const [list] = lists(tree).filter((l) => l.listId === "changes-diff");
  handler(byId(tree, "changes-diff-rows"), "on_mouse_down")({ local_position: { x, y: 5 } }, makeCx());
  handler(list, "on_item_click")(`r:${page.diff.hunks[0]}`, makeCx());
}

test("hunk buttons: while another git action runs they wait, faded as every control that waits", async () => {
  const { view, page, tree } = await open();
  assert.deepEqual(buttons(tree, page), [{ label: "Stage", faded: 1 }, { label: "Revert…", faded: 1 }], "idle");
  page.busy = "fetch";
  assert.deepEqual(buttons(await draw(view), page), [{ label: "Stage", faded: 0.7 }, { label: "Revert…", faded: 0.7 }], "while a fetch runs");
  // While its own Stage runs: the one that runs says … (both wait).
  page.busy = "stageHunk"; page.busyHunk = page.diff.hunks[0];
  assert.deepEqual(buttons(await draw(view), page), [{ label: "…", faded: 0.7 }, { label: "Revert…", faded: 0.7 }], "while its Stage runs");
  page.busy = null; page.busyHunk = null;
  assert.deepEqual(state.violations, []);
});

test("hunk buttons: pressed, or asked by key, while a git action runs, they say Busy instead of nothing", async () => {
  const { r, page, tree } = await open();
  const g = page.diff.buttons(), right = page.diff.view() - g.pad, busy = "Busy (Fetching): try again once it's done";
  page.busy = "fetch";
  press(tree, page, right - g.width - g.gap - g.width / 2);
  assert.equal(page.line, busy, "Stage");
  page.line = null;
  press(tree, page, right - g.width / 2);
  assert.equal(page.line, busy, "Revert…");
  assert.equal(state.overlays.filter((o) => o.props?.question).length, 0, "Revert… asked nothing");
  page.line = null;
  page.hunk("stage", page.diff.hunks[0], makeCx());
  assert.equal(page.line, busy, "the s key's way in");
  await settle();
  assert.equal(r.git("diff", "--cached").trim(), "", "nothing staged");
  assert.match(r.git("diff"), /\+line 2 changed/, "nothing reverted");
  page.busy = null;
  assert.deepEqual(state.violations, []);
});
