// Everything open at once renders without an element used twice (the real kit throws): comments,
// the comment box, the scope picker, the stash list, the row's menu and the send dialog, in the panel
// and the Review tab, unified and split, narrow and wide. Then every popup the page opens: its root is
// as tall as what it holds (no scroll area there, none that only flex_1 sizes: Herdr sizes a popup by
// its content, and such an area has none, so the popup shows as a thin line).
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, overlay, drawWith, draw, byId, lists, renderRows, handler, walk, settle, makeCx, load } from "./render/load.mjs";
import { NAME } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { v_flex, div } from "./render/stubs.mjs";

const { KEY } = await load("id.js");
function setup() {
  const r = repo(({ write, git }) => {
    write("a.js", "const a = 1;\nconst b = 2;\n\tconst c = 3;\n"); git("add", "-A"); git("commit", "-qm", "one");
    write("a.js", "const a = 10;\nconst b = 2;\n\tconst c = 33;\nconst d = 4;\n"); git("add", "-A"); git("commit", "-qm", "two");
  });
  r.write("a.js", "const a = 11;\nconst b = 2;\n\tconst c = 33;\nconst d = 44;\n");
  r.write("z.txt", "untracked\n");
  r.git("stash", "push", "-q", "--include-untracked");
  r.write("a.js", "const a = 12;\nconst b = 2;\n\tconst c = 33;\nconst d = 4;\n// more\n");
  return r;
}
const SCROLLS = new Set(["overflow_y_scrollbar", "overflow_y_scroll", "overflow_scroll", "overflow_scrollbar"]);
/** What in a popup's tree breaks its height: a root that scrolls or fills, an area that scrolls with
 *  only flex_1 for a height (the popup fits what it holds, so there is nothing to fill) or only a
 *  max_h (it never scrolls in Herdr: the render stubs' layout checks say so for any tree). */
export function popupProblems(tree) {
  const out = [], calls = (n) => n.calls.map(([c]) => c), top = tree.$;
  const root = calls(top);
  if (root.some((c) => SCROLLS.has(c))) out.push(`the root (${top.id}) scrolls`);
  if (root.includes("size_full") || root.includes("h_full") || root.includes("flex_1")) out.push(`the root (${top.id}) fills instead of fitting`);
  walk(tree, (n) => {
    if (n === top) return;
    const c = calls(n);
    if (c.some((x) => SCROLLS.has(x)) && !c.some((x) => x === "h" || x === "size")) out.push(`${n.id ?? n.kind} scrolls with no height of its own`);
  });
  return out;
}

test("popupProblems sees the thin-line popups: a root that scrolls or fills, an area only flex_1 sizes", () => {
  assert.deepEqual(popupProblems(v_flex().id("m").size_full().min_h(0).overflow_y_scrollbar().child(div())), ["the root (m) scrolls", "the root (m) fills instead of fitting"]);
  assert.deepEqual(popupProblems(v_flex().id("m").w_full().child(div().id("list").flex_1().min_h(0).overflow_y_scrollbar())), ["list scrolls with no height of its own"]);
  assert.deepEqual(popupProblems(v_flex().id("m").w_full().p(5).child(div().id("list").max_h(300).overflow_y_scrollbar())), ["list scrolls with no height of its own"]);
  assert.deepEqual(popupProblems(v_flex().id("m").w_full().p(5).child(div().id("list").h(120).overflow_y_scrollbar())), []);
});

test("comments, the box, the pickers, the row's menu and the send dialog: no element used twice", async () => {
  const r = setup();
  for (const props of [{ palette: "theme" }, { palette: "theme", review: true, root: r.dir }]) {
    for (const layout of ["unified", "split"]) {
      state.shared.set(KEY.layout, layout);
      const view = await mount(r.dir, props), page = view.part;
      for (const width of [368, 1300]) {
        page.size = { width, height: 900 };
        if (page.open?.path !== "a.js") { page.pick("a.js", "unstaged", makeCx()); await settle(); }
        let tree = await draw(view);
        handler(byId(tree, "changes-diff-rows"), "on_size_change")({ width: width - 2, height: 500 }, makeCx());
        tree = await draw(view);
        const d = page.diff, plus = d.items.findIndex((it) => (it.kind === "row" ? d.rows[it.i].kind === "+" : it.kind === "split" && d.split[it.j].right != null && d.rows[d.split[it.j].right].kind === "+"));
        const list = lists(tree).find((l) => l.listId === "changes-diff");
        handler(list, "on_item_click")(d.items[plus].key, makeCx());
        assert.ok(page.composer, "the comment box");
        await draw(view);
        page.noteBox.set_value("Looks odd");
        for (const h of page.noteBox.handlers.submit) h({}, makeCx());
        assert.ok(page.notes.length > 0);
        tree = await draw(view);
        renderRows(lists(tree).find((l) => l.listId === "changes-diff"));
        page.choosingScope = true; page.choosingStash = true;
        tree = await draw(view);
        page.choosingScope = false; page.choosingStash = false;
        handler(lists(tree).find((l) => l.listId === "changes-diff"), "on_item_secondary_click")(d.items[d.itemOf(d.rows.findIndex((x) => x.kind === "+"))].key, {}, makeCx());
        await settle();
        const menu = state.overlays.at(-1);
        assert.ok(menu.props.question?.menu, "the row's menu");
        const m = overlay(menu);
        const saved = state.props;
        state.props = m.props;
        handler(byId(drawWith(m.view, m.props), "menu-ask"), "on_click")({}, makeCx());
        state.props = saved;
        await settle();
        const send = state.overlays.at(-1);
        assert.ok(send.props.send, "the send dialog");
        for (const agentsHere of [[], [{ address: "t9", space: "s1", status: "idle", focused: false, program: { name: "pi" }, tab_name: "1" }]]) {
          state.agents = agentsHere;
          const s = overlay(send);
          drawWith(s.view, s.props);
        }
        state.agents = [];
        page.setNotes([], makeCx());
      }
    }
  }
  state.shared.delete(KEY.layout);
  assert.deepEqual(state.violations, []);
});

test("every popup fits what it holds: the file menu, the row's menu, the pen's agents, ⋯, a branch's menu, a commit's menu", async () => {
  const r = setup();
  r.git("branch", "other");
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  if (page.open?.path !== "a.js") { page.pick("a.js", "unstaged", makeCx()); await settle(); }
  const opened = [];
  const take = () => { const o = state.overlays.at(-1); assert.equal(o.kind, "popup", JSON.stringify(Object.keys(o.props))); opened.push(o); };
  page.fileMenu("a.js", "unstaged", makeCx()); await settle(); take();
  page.rowMenu(page.diff.items[page.diff.itemOf(page.diff.rows.findIndex((x) => x.kind === "+"))].key, makeCx()); await settle(); take();
  page.penMenu(makeCx(), [{ id: "pi", label: "pi" }, { id: "opencode", label: "OpenCode" }]); await settle(); take();
  page.moreMenu(makeCx()); await settle(); take();
  page.openBranches(true, makeCx()); await settle();
  page.branchMenu(page.branches.find((b) => b.name === "other"), makeCx()); await settle(); take();
  const history = await mount(r.dir, { palette: "theme", view: "history" }), h = history.part.history;
  handler(lists(await draw(history)).find((l) => l.listId === "history-commits"), "on_item_secondary_click")(h.commits[0].hash, {}, makeCx());
  await settle(); take();
  for (const o of opened) {
    const { view: v, props } = overlay(o);
    const tree = drawWith(v, props);
    assert.deepEqual(popupProblems(tree), [], `${Object.keys(o.props)[0]}: ${JSON.stringify(o.props.question?.title ?? "")}`);
    assert.ok(o.height > 0 && o.height <= 640, `asks for a height that fits: ${o.height}`);
  }
  assert.deepEqual(state.violations, []);
});

// A scroll area needs a height of its own: max_h alone never scrolls in Herdr (its content shows
// clipped and stays still). The render stubs check every tree for it
// (test/shared/layoutlint.mjs, into state.violations); this opens the lists that had only a max_h.
test("lists that scroll have a height of their own: the branch picker, the stashes, the scope's rows, Author ▾, Branch ▾, the switcher, a question's lines and files", async () => {
  const r = setup();
  r.git("branch", "other"); r.git("stash", "push", "-q", "-m", "second");
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  page.openBranches(true, makeCx()); await settle();
  page.choosingStash = true;
  let tree = await draw(view);
  assert.ok(byId(tree, "branch-other") || byId(tree, "branch-0"), "the branch picker is open");
  assert.ok(byId(tree, "stash-0"), "the stashes are open");
  assert.deepEqual(state.violations, []);
  // The scope picker's list of commits.
  page.openBranches(false, makeCx()); page.choosingStash = false; page.choosingScope = true;
  page.scopeLists.show("commit", { root: page.root, on: null }, () => {}, makeCx()); await settle();
  tree = await draw(view);
  assert.ok(byId(tree, "scope-row-0"), "the scope's rows");
  assert.deepEqual(state.violations, []);
  const rows = (await draw(view)), list = (() => { let hit = null; walk(rows, (n) => { if (n.id === "scope-rows") hit = n; }); return hit; })();
  assert.ok(list.calls.some(([m, a]) => m === "h" && a[0] > 0 && a[0] <= 290), "as tall as its rows, 290 px at most");
  // History: Author ▾ and Branch ▾.
  const history = await mount(r.dir, { palette: "theme", view: "history" }), h = history.part.history;
  h.choosingAuthor = true; h.choosingBranch = true;
  tree = await draw(history);
  assert.ok(byId(tree, "history-author-any") && byId(tree, "history-branch-head"));
  assert.deepEqual(state.violations, []);
  // The repository switcher, for a folder with two repositories below it.
  const work = tempDir("git-enhanced-lists-");
  for (const name of ["one", "two"]) { const d = join(work, name); mkdirSync(d); execFileSync("git", ["init", "-q"], { cwd: d }); }
  const panel = await mount(work, { palette: "theme" });
  let pop = null;
  walk(await draw(panel), (n) => { if (n.kind === "popover" && n.popover === "repo-list") pop = n; });
  assert.ok(pop, "the switcher");
  handler(pop, "on_open_change")(true, makeCx()); await settle();
  tree = await draw(panel);
  assert.ok(byId(tree, "repo-1"), "its list is open");
  assert.deepEqual(state.violations, []);
  // A question with lines and files to tick.
  const { questions } = await load("question.js");
  questions(NAME).ask({ title: "Restore?", lines: Array.from({ length: 30 }, (_, i) => `line ${i}`), files: { items: [{ path: "a.txt", checked: true }, { path: "b.txt", checked: false }] }, confirm: "Restore" });
  const o = overlay(state.overlays.at(-1)), q = drawWith(o.view, o.props);
  assert.deepEqual(state.violations, []);
  let lines = null, files = null;
  walk(q, (n) => { if (n.id === "question-lines") lines = n; if (n.id === "question-files") files = n; });
  assert.ok(lines.calls.some(([m, a]) => m === "h" && a[0] === 160), "30 lines: 160 px, scrolling");
  assert.ok(files.calls.some(([m, a]) => m === "h" && a[0] === 59), "two files: as tall as they are");
  assert.deepEqual(state.violations, []);
});
