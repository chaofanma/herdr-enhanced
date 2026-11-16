// The git operations in Herdr's own layout (main) with our two blocks: the panel's Changes block
// has its own Changes | History switch and the layout no History page (block.js), so History's ⋯
// (Reflog…, Worktrees…, bisect), Open this version and what a History action that stops leaves for
// Changes live in that one block, Blame line N and the conflict view in its Changes page. Each
// works there as on a page of its own, the block staying on the page it was used from.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { state, repo, mount, draw, byId, lists, handler, press, texts, settle, makeCx, overlay, drawWith, load } from "./render/load.mjs";
import { NAME } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
import { answer } from "./answers.mjs";

const { takers } = await load("reveal.js");
const { HistoryPage } = await load("historypage.js");
const files = { id: "files", type: "block", content: { mod: "files-enhanced" } };
const changes = { id: "changes", type: "block", content: { mod: NAME, props: { palette: "theme" } } };
// Herdr's main layout with our two blocks: no header of ours, no History page.
const MAIN = { id: "root", type: "row", children: [{ id: "main", type: "block", content: { tab: "active" } },
  { id: "panel", type: "column", hidden: true, children: [{ id: "panel-body", type: "stack", active: "changes", children: [files, changes] }] }] };

beforeEach(() => { takers.clear(); state.shared.clear(); state.layout = MAIN; for (const k of ["runs", "overlays", "violations"]) state[k].length = 0; });

// The block's copy in `dir`, switched to History: { view, h } (h: its History).
async function blockHistory(dir) {
  const view = await mount(dir, { palette: "theme" });
  assert.ok(view.block, "the Changes block with its switch");
  press(byId(await draw(view), "block-tab-history")); await settle();
  await draw(view); await settle();
  assert.ok(view.block.pages.history instanceof HistoryPage);
  return { view, h: view.block.history() };
}
const commitList = async (view) => lists(await draw(view)).find((l) => l.listId === "history-commits");
// Clicks `id` in the overlay opened last (a commit's menu or its question), as Herdr would.
async function inOverlay(id) {
  await settle();
  const o = overlay(state.overlays.at(-1)), tree = drawWith(o.view, o.props), saved = state.props;
  state.props = o.props;
  try { handler(byId(tree, id), "on_click")({}, makeCx()); } finally { state.props = saved; }
  await settle();
}

test("bisect from the block's History: started from the selected commit, marked to the first bad one, Show it selects it there", async () => {
  const r = repo(({ write, git }) => {
    for (let i = 1; i <= 8; i++) { write("n.txt", `${i <= 5 ? "ok" : "broken"} ${i}\n`); git("add", "-A"); git("commit", "-qm", `C${i}`); if (i === 1) git("tag", "v1"); }
  });
  const [bad, , firstBad] = r.git("rev-list", "HEAD").trim().split("\n");
  const { view, h } = await blockHistory(r.dir);
  handler(await commitList(view), "on_item_click")(bad, makeCx()); await settle();
  press(byId(await draw(view), "history-more"));
  await answer({ pick: "bisect" });
  const { spec } = await answer();
  assert.equal(spec.input.value, "v1", "the tag before it, asked as on a page of its own");
  await answer();
  for (let n = 0; n < 6 && !h.bisect?.first; n++) {
    const tree = await draw(view);
    assert.ok(byId(tree, "bisect-bar"), "the bar in the block's History");
    press(byId(tree, r.read("n.txt").startsWith("broken") ? "bisect-bad" : "bisect-good")); await settle();
  }
  assert.equal(h.bisect?.first, firstBad, h.line);
  press(byId(await draw(view), "bisect-show")); await settle();
  assert.equal(h.selected, firstBad);
  assert.equal(view.block.page, "history");
  press(byId(await draw(view), "bisect-reset")); await settle();
  assert.equal(h.bisect, null);
  assert.deepEqual(state.violations, []);
  await view.close(makeCx("async"));
});

test("History's ⋯ in the block: Reflog… makes a branch at an entry, Worktrees… opens one as a space", async () => {
  const r = repo(({ write, git }) => { write("f.txt", "1\n"); git("add", "-A"); git("commit", "-qm", "one"); write("f.txt", "2\n"); git("commit", "-qam", "two"); });
  const one = r.git("rev-parse", "HEAD~1").trim();
  r.git("worktree", "add", "-q", "-b", "side", join(tempDir("git-enhanced-block-git-"), "side"));
  const { view, h } = await blockHistory(r.dir);
  press(byId(await draw(view), "history-more"));
  let { spec } = await answer({ pick: "reflog" });
  ({ spec } = await answer({ entry: 1 }));
  assert.equal(spec.title, "Reflog · HEAD");
  await answer({ pick: "branch" });
  await answer({ set: (q) => q.input.set_value("from-reflog") });
  assert.equal(r.git("rev-parse", "from-reflog").trim(), one, h.line);
  press(byId(await draw(view), "history-more"));
  await answer({ pick: "worktrees" });
  ({ spec } = await answer({ pick: "wt-1" }));
  assert.deepEqual(spec.items.slice(0, 2).map((i) => i.label), ["main (this one)", "side"]);
  await answer({ pick: "open" });
  assert.deepEqual(state.runs.at(-1), ["space.new", { folder: spec.items[1].detail.split(" · ")[0] }]);
  assert.equal(view.block.page, "history");
  assert.deepEqual(state.violations, []);
  await view.close(makeCx("async"));
});

test("Open this version from a commit's file in the block's History: the copy opened here", async () => {
  const r = repo(({ write, git }) => { write("f.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "First"); write("f.txt", "two\n"); git("commit", "-qam", "Second"); });
  const first = r.git("rev-parse", "HEAD~1").trim(), opened = [];
  state.execHook = (cmd, args) => (cmd === "open" || cmd === "xdg-open" ? (opened.push(args[0]), { code: 0, stdout: "", stderr: "" }) : null);
  try {
    const { view, h } = await blockHistory(r.dir);
    handler(await commitList(view), "on_item_click")(first, makeCx()); await settle();
    { const fl = lists(await draw(view)).find((l) => l.listId === "history-files-list"); handler(fl, "on_item_secondary_click")(fl.getKey(0), {}, makeCx()); }
    await answer({ pick: "version" });
    assert.equal(opened.length, 1, h.line);
    assert.equal(readFileSync(opened[0], "utf8"), "one\n");
    assert.equal(view.block.page, "history");
    assert.deepEqual(state.violations, []);
    await view.close(makeCx("async"));
  } finally { state.execHook = null; }
});

test("Blame line N in the block's Changes: Show the commit is that page's commit scope; the block stays on Changes", async () => {
  const r = repo(({ write, git }) => {
    write("f.txt", "a\nb\nc\n"); git("add", "-A"); git("commit", "-qm", "First");
    write("f.txt", "a\nB\nc\n"); git("commit", "-qam", "Second");
    write("f.txt", "a\nB\nc\nd\n");
  });
  const second = r.git("rev-parse", "HEAD").trim();
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  await draw(view);
  assert.equal(view.block.page, "changes");
  const i = page.diff.rows.findIndex((x) => x.kind === " " && x.text === "B");
  page.rowMenu(page.diff.items.find((it) => it.rows.includes(i)).key, makeCx());
  await answer({ pick: "blame" });
  await answer({ pick: "show" });
  assert.deepEqual([page.scope, page.scopeTarget], ["commit", second]);
  assert.equal(view.block.page, "changes");
  assert.ok(texts(await draw(view)).includes("read-only"), "the read-only bar");
  assert.deepEqual(state.violations, []);
  await view.close(makeCx("async"));
});

test("a cherry-pick from a commit's menu that stops: the block's History says so, its Changes has the bar and the conflict view; aborted there, History's bar goes", async () => {
  const r = repo(({ write, git }) => {
    write("f.txt", "a\nb\nc\n"); git("add", "-A"); git("commit", "-qm", "init");
    git("switch", "-q", "-c", "side"); write("f.txt", "a\nside\nc\n"); git("commit", "-qam", "side");
    git("switch", "-q", "main"); write("f.txt", "a\nmain\nc\n"); git("commit", "-qam", "main");
  });
  const side = r.git("rev-parse", "side").trim(), head = r.git("rev-parse", "HEAD").trim();
  const { view, h } = await blockHistory(r.dir);
  h.showHistoryOf(null, true, makeCx("async")); await settle();   // the branch menu's All branches
  handler(await commitList(view), "on_item_secondary_click")(side, {}, makeCx());
  await inOverlay("commit-cherry-pick");
  await inOverlay("commit-confirm");
  // The menu's copy ran it and says every page changed: History reads again (no ref moved).
  for (let n = 0; n < 2; n++) { await draw(view); await settle(); }
  assert.equal(h.op, "cherry-pick");
  let tree = await draw(view);
  assert.match(texts(byId(tree, "history")).join(" "), /A cherry-pick stopped\. Resolve the conflicts in Changes, then Continue or Skip there, or abort it here\./);
  assert.ok(byId(tree, "history-abort"));
  press(byId(tree, "block-tab-changes")); await settle();
  for (let n = 0; n < 2; n++) { await draw(view); await settle(); }
  tree = await draw(view);
  assert.equal(view.part.operation, "cherry-pick");
  assert.deepEqual(texts(byId(tree, /^operation-words-/)), ["Cherry-pick stopped: 1 file conflict"]);
  assert.ok(byId(tree, "conflict-view"), "f.txt's conflict view");
  // Abort… in the block's Changes: HEAD stays where it was, and History's bar goes too.
  press(byId(tree, "operation-abort"));
  await answer();
  assert.equal(view.part.operation, null, view.part.line);
  assert.equal(r.git("rev-parse", "HEAD").trim(), head);
  press(byId(await draw(view), "block-tab-history")); await settle();
  for (let n = 0; n < 2; n++) { await draw(view); await settle(); }
  assert.equal(h.op, null);
  assert.equal(byId(await draw(view), "history-abort"), null);
  assert.deepEqual(state.violations, []);
  await view.close(makeCx("async"));
});
