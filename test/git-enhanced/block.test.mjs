// A layout block's Changes page where no tab header of ours leads to History (block.js): Herdr's tab
// bar has buttons for `files` and `changes` only, so the block has a Changes | History switch (the
// shown page's name, first in its own top row; no ✕) and History in the same block; the Changes page
// stays alive under it (its recorder and timers are the same). Under our header (a stack's "header" with role "tabs") it's the
// Changes page alone. The floating window is window.test.mjs's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, byId, press, settle, load, walk, makeCx } from "./render/load.mjs";
import { NAME } from "./mod.mjs";

const { underOurHeader } = await load("block.js");
const { ChangesPage } = await load("changes.js");
const { HistoryPage } = await load("historypage.js");
const { takers } = await load("reveal.js");
const { SHOW } = await load("scopes.js");

const changes = { id: "changes", title: "Changes", type: "block", content: { mod: NAME, props: { palette: "theme" } } };
const files = { id: "files", title: "Files", type: "block", content: { mod: "files-enhanced" } };
// Herdr's main layout with our pages and no header; herdr-t3's panel, its header ours.
const main = { id: "root", type: "row", children: [{ id: "work", type: "column", children: [{ id: "work-body", type: "row", children: [
  { id: "main", type: "block" }, { id: "panel", type: "column", children: [{ id: "panel-body", type: "stack", children: [files, changes] }] }] }] }] };
const withHeader = (mod) => ({ id: "root", type: "row", children: [{ id: "panel", type: "column", children: [{ id: "panel-body", type: "stack",
  header: { content: { mod, props: { role: "tabs", stack: "panel-body" } }, height: 34 }, children: [files, changes,
    { id: "history", title: "History", type: "block", content: { mod: NAME, props: { palette: "theme", view: "history" } } }] }] }] });
const loose = { id: "root", type: "row", children: [{ id: "main", type: "block" }, changes] };

const ids = (tree, re) => { const out = []; walk(tree, (d) => { if (re.test(String(d.id))) out.push(d.id); }); return out; };
const dirty = () => { const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "a"); }); r.write("a.txt", "two\n"); return r; };

test("underOurHeader: a stack's header of either mod with role tabs; Herdr's own, none, or no stack: no", () => {
  assert.equal(underOurHeader(withHeader(NAME), NAME), true);
  assert.equal(underOurHeader(withHeader("files-enhanced"), NAME), true);
  assert.equal(underOurHeader(withHeader("tabs"), NAME), false, "a header of another mod");
  assert.equal(underOurHeader(main, NAME), false);
  assert.equal(underOurHeader(loose, NAME), false);
  assert.equal(underOurHeader(null, NAME), false);
  // The header as a block of its own, naming the stack.
  const apart = { id: "root", type: "column", children: [{ id: "top", type: "block", content: { mod: "files-enhanced", props: { role: "tabs", stack: "panel-body" } } }, main] };
  assert.equal(underOurHeader(apart, NAME), true);
});

test("under our tab header: the Changes page alone, no switch", async () => {
  state.layout = withHeader(NAME);
  const r = dirty();
  const view = await mount(r.dir, { palette: "theme" });
  const tree = await draw(view);
  assert.ok(byId(tree, "changes"));
  assert.deepEqual(ids(tree, /^changes-block|^block-tab-/), []);
  state.layout = withHeader("files-enhanced");
  assert.deepEqual(ids(await draw(view), /^changes-block|^block-tab-/), []);
  assert.deepEqual(state.violations, []);
  state.layout = null;
});

test("Herdr's main panel without a header: Changes | History in the block; History there, the Changes page alive under it", async () => {
  state.layout = main;
  const r = dirty();
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  assert.ok(page instanceof ChangesPage);
  const recorder = page.recorder, everies = [...state.everies];
  assert.ok(recorder, "the panel's copy records agent turns");
  let tree = await draw(view);
  assert.ok(byId(tree, "block-switch") && !byId(tree, "changes-block-bar"));
  assert.deepEqual(ids(tree, /^block-tab-/), ["block-tab-changes", "block-tab-history"]);
  assert.equal(byId(tree, "changes-window-close"), null, "no ✕");
  assert.ok(byId(tree, "changes") && !byId(tree, "history"), "Changes first");
  press(byId(tree, "block-tab-history")); await settle();
  tree = await draw(view);
  assert.ok(byId(tree, "history") && !byId(tree, "changes"), "History in the block");
  assert.ok(byId(tree, "history-settings-open"), "History keeps its own top row");
  assert.ok(view.block.pages.history instanceof HistoryPage);
  assert.equal(view.block.pages.history.history.commits.length, 1);
  assert.equal(view.part, page, "the same Changes page");
  assert.equal(page.recorder, recorder, "the same recorder");
  assert.deepEqual(state.everies.slice(0, everies.length), everies);
  assert.deepEqual(state.everies.slice(everies.length), [10000], "only History's timer started: no second Changes page");
  assert.equal(takers.has(view.block.pages.history.history), false, "the block's History takes no reveal requests");
  // Another copy asks this repository's Changes page to show a scope: the block goes back to it.
  state.shared.set(SHOW, { key: page.repoKey(), scope: "work", at: Date.now() });
  await draw(view); await settle();
  assert.equal(view.block.page, "changes");
  press(byId(tree, "block-tab-history")); await settle();
  tree = await draw(view);
  press(byId(tree, "block-tab-changes"));
  tree = await draw(view);
  assert.ok(byId(tree, "changes") && !byId(tree, "history"), "back to Changes");
  assert.equal(page.recorder, recorder);
  // Our header added at runtime: the page alone, Changes.
  press(byId(tree, "block-tab-history")); await settle();
  state.layout = withHeader(NAME);
  tree = await draw(view);
  assert.ok(byId(tree, "changes") && !byId(tree, "block-switch"));
  assert.deepEqual(state.violations, []);
  await view.close(makeCx("async"));
  state.layout = null;
});

// The row that holds `id` (a page's top row holds its gear).
const rowOf = (tree, id) => { let row = null; walk(tree, (d) => { if (!row && d.children?.some((c) => c?.$?.id === id)) row = d; }); return row; };
// A page's top row: the one its icon buttons' row (the gear's) is in.
const topRow = (tree, gear) => { const icons = rowOf(tree, gear); let row = null; walk(tree, (d) => { if (!row && d.children?.some((c) => c?.$ === icons)) row = d; }); return row; };
const words = (d) => { const out = []; walk({ $: d }, (n) => { for (const c of n.children ?? []) if (typeof c === "string") out.push(c); }); return out; };

test("the switch is the page's name in its own top row: no bar above the page, in Changes and in History", async () => {
  state.layout = main;
  const r = dirty();
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  for (const width of [368, 547]) {
    page.size = { width, height: 900 };
    let tree = await draw(view);
    assert.equal(byId(tree, "changes-block-bar"), null, "no row of its own");
    const top = topRow(tree, "changes-settings-open");
    assert.equal(top.children[0]?.$?.id, "block-switch", `${width}: first in the Changes page's top row`);
    assert.deepEqual(ids({ $: top.children[0].$ }, /^block-tab-/), ["block-tab-changes", "block-tab-history"]);
    assert.ok(!words(top).includes("Changes") || words(top.children[0].$).includes("Changes"), "the page's name is the switch's");
    assert.equal(words(top).filter((w) => w === "Changes").length, 1, "Changes said once");
    // The file count gives way on a narrow panel (the list's bar says it too); a wider one keeps it.
    assert.equal(words(top).includes("1 file"), width >= 470, `${width}: the count`);
  }
  let tree = await draw(view);
  press(byId(tree, "block-tab-history")); await settle();
  tree = await draw(view);
  assert.equal(byId(tree, "changes-block-bar"), null);
  // History's top row: the one the switch is in, holding its icon buttons' row (the gear's).
  const top = rowOf(tree, "block-switch");
  assert.ok(byId({ $: top }, "history-settings-open"), "the row with History's gear");
  assert.equal(top.children[0]?.$?.id, "block-switch", "first in History's top row");
  assert.equal(words(top).filter((w) => w === "History").length, 1, "History said once");
  press(byId(tree, "block-tab-changes"));
  tree = await draw(view);
  assert.ok(byId(tree, "changes") && !byId(tree, "history"), "back to Changes");
  // Under our header: the page's own name again, the count too, and no switch.
  state.layout = withHeader(NAME);
  page.size = { width: 368, height: 900 };
  tree = await draw(view);
  const own = topRow(tree, "changes-settings-open");
  assert.equal(byId(tree, "block-switch"), null);
  assert.ok(words(own).includes("Changes") && words(own).includes("1 file"));
  assert.deepEqual(state.violations, []);
  await view.close(makeCx("async"));
  state.layout = null;
});

// Herdr's main shape with a tab bar of its own that leads to every page (Files, Changes, History):
// a History page of its own in the stack, and no header of ours.
const withHistory = { id: "root", type: "row", children: [{ id: "work", type: "column", children: [
  { id: "tabs", type: "block", content: { mod: "tabs-enhanced" } }, { id: "work-body", type: "row", children: [
    { id: "main", type: "block" }, { id: "panel", type: "column", children: [{ id: "panel-body", type: "stack", children: [files, changes,
      { id: "history", type: "block", content: { mod: NAME, props: { palette: "theme", view: "history" } } }] }] }] }] }] };

test("a layout with a History page of its own: the Changes page alone with its own name, no switch", async () => {
  assert.equal(underOurHeader(withHistory, NAME), false, "no header of ours");
  state.layout = withHistory;
  const r = dirty();
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  page.size = { width: 368, height: 900 };
  const tree = await draw(view);
  assert.deepEqual(ids(tree, /^block-|^changes-block/), [], "the layout leads to History itself");
  const top = topRow(tree, "changes-settings-open");
  assert.ok(words(top).includes("Changes") && words(top).includes("1 file"), "its own name, and the count");
  assert.ok(byId(tree, "changes") && !byId(tree, "history"));
  assert.deepEqual(state.violations, []);
  await view.close(makeCx("async"));
  state.layout = null;
});

test("a block outside any stack: the switch too", async () => {
  state.layout = loose;
  const r = dirty();
  const view = await mount(r.dir, { palette: "theme" });
  let tree = await draw(view);
  assert.deepEqual(ids(tree, /^block-tab-/), ["block-tab-changes", "block-tab-history"]);
  press(byId(tree, "block-tab-history")); await settle();
  tree = await draw(view);
  assert.ok(byId(tree, "history"));
  assert.deepEqual(state.violations, []);
  state.layout = null;
});

test("History, Review and History tabs and the window: no block switch", async () => {
  state.layout = main;
  const r = dirty();
  for (const props of [{ view: "history" }, { review: true, root: r.dir }, { view: "history", root: r.dir }, { overlay: "w1" }]) {
    const view = await mount(r.dir, props);
    assert.equal(view.block, undefined, JSON.stringify(props));
    assert.deepEqual(ids(await draw(view), /^changes-block|^block-tab-/), [], JSON.stringify(props));
  }
  assert.deepEqual(state.violations, []);
  state.layout = null;
});
