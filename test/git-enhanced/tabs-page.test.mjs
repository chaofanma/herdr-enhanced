// History and Review in a tab of their own (tabs.js): one per repository in a space, the panel that
// holds the page hidden while the tab is open (found in layout()), ⤡ in the tab brings the panel back
// on that page and closes the tab, the tab's name for herdr-t3's pane header.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { state, mount, draw, byId, lists, handler, press, walk, settle, makeCx, load } from "./render/load.mjs";
import { v_flex, h_resizable, resizable_panel } from "./render/stubs.mjs";
import { tempDir } from "./tmp.mjs";

const { KEY, ID } = await load("id.js");
const { MIN } = await load("historylayout.js");

test("⤢ on History and on the Changes page: the tab already open, else a new one; the panel gives way; ⤡ goes back; the pane header's names", async () => {
  const base = tempDir("git-enhanced-tabs-");
  const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const A = join(base, "a");
  sh(base, "init", "-q", "-b", "main", "a");
  sh(A, "config", "user.name", "Tess"); sh(A, "config", "user.email", "tess@x"); sh(A, "config", "core.hooksPath", "/dev/null");
  for (const n of [1, 2, 3]) { writeFileSync(join(A, "f.txt"), `${n}\n`); sh(A, "add", "-A"); sh(A, "commit", "-qm", `Commit ${n}`); }
  state.shared.delete(KEY.tabs); state.shared.delete(KEY.titles);
  // herdr-t3's panel with the three pages.
  state.layout = { id: "root", type: "row", children: [{ id: "work", type: "column", children: [{ id: "panel", type: "column", children: [{ id: "panel-body", type: "stack", children: [
    { id: "files", type: "block", content: { mod: "files-enhanced" } },
    { id: "changes", type: "block", content: { mod: ID, props: { palette: "theme" } } },
    { id: "history", type: "block", content: { mod: ID, props: { palette: "theme", view: "history" } } }] }] }] }] };
  const tabs = (...ids) => { state.spaces[0].tabs = ids.map((id) => ({ id })); };
  const modPane = (pane, tab) => state.panes.push({ pane, mod: ID, tab, terminal: null });
  const view = await mount(A, { palette: "theme", view: "history" });
  tabs("t1"); modPane("pp", "t1");
  let tree = await draw(view);
  state.runs.length = 0;
  press(byId(tree, "history-tab"));
  assert.deepEqual(state.runs.map((r) => r[0]), ["tab.new", "layout.hide"]);
  assert.deepEqual([state.runs[0][1].name, state.runs[0][1].props.view, state.runs[0][1].props.root], ["History", "history", A]);
  assert.deepEqual(state.runs[1][1], { id: "panel" });
  tabs("t1", "tH"); modPane("ph", "tH");
  await settle();
  assert.deepEqual(state.shared.get(KEY.titles), { tH: "History" });
  const entry = state.shared.get(KEY.tabs).tH;
  assert.deepEqual([entry.kind, entry.root, entry.space, entry.from, entry.place], ["history", A, "s1", "t1", { stack: "panel-body", child: "history", panel: "panel" }]);
  state.runs.length = 0;
  tree = await draw(view);
  press(byId(tree, "history-tab"));
  assert.deepEqual(state.runs, [["tab.select", { id: "tH" }], ["layout.hide", { id: "panel" }]], "the same tab, not a second");
  assert.equal(byId(tree, "history-back"), null, "no ⤡ in the panel");
  // The tab's copy: ⤡, which shows the panel on History, goes back to t1 and closes the tab.
  const kept = state.shared.get(KEY.tabs);
  const tab = await mount(base, { palette: "theme", view: "history", root: A, on: null });
  tabs("t1", "tH"); modPane("pp", "t1"); modPane("ph", "tH");
  state.focused = { ...state.focused, tab: "tH" };
  assert.deepEqual(state.shared.get(KEY.tabs), kept);
  tree = await draw(tab);
  assert.equal(byId(tree, "history-tab"), null, "no ⤢ in the tab");
  state.runs.length = 0;
  press(byId(tree, "history-back"));
  assert.deepEqual(state.runs, [["layout.show", { id: "panel" }], ["layout.select", { stack: "panel-body", child: "history" }], ["tab.select", { id: "t1" }], ["tab.close", { id: "tH" }]]);
  assert.deepEqual(state.shared.get(KEY.tabs), {}); assert.deepEqual(state.shared.get(KEY.titles), {});
  // Review: the same from the Changes page's ⤢, with ⤡ in the tab.
  const changes = await mount(A, { palette: "theme" });
  tabs("t1"); modPane("pp", "t1");
  tree = await draw(changes);
  state.runs.length = 0;
  press(byId(tree, "open-review"));
  assert.deepEqual(state.runs.map((r) => r[0]), ["tab.new", "layout.hide"]);
  assert.equal(state.runs[0][1].name, "Review"); assert.equal(state.runs[0][1].props.review, true);
  tabs("t1", "tR"); modPane("pr", "tR");
  await settle();
  assert.deepEqual(state.shared.get(KEY.titles), { tR: "Review" });
  assert.deepEqual(state.shared.get(KEY.tabs).tR.place, { stack: "panel-body", child: "changes", panel: "panel" });
  const review = await mount(base, { palette: "theme", review: true, root: A, on: null });
  tabs("t1", "tR"); modPane("pr", "tR");
  state.focused = { ...state.focused, tab: "tR" };
  tree = await draw(review);
  state.runs.length = 0;
  press(byId(tree, "review-back"));
  assert.deepEqual(state.runs.map((r) => r[0]), ["layout.show", "layout.select", "tab.select", "tab.close"]);
  assert.deepEqual(state.runs[1][1], { stack: "panel-body", child: "changes" });
  // Herdr's own layout: the panel's stack has Files and Changes; History in a block of its own works too.
  state.layout = { id: "root", type: "row", children: [{ id: "work", type: "column", children: [{ id: "work-body", type: "row", children: [
    { id: "main", type: "block" },
    { id: "panel", type: "column", children: [{ id: "panel-body", type: "stack", children: [
      { id: "files", type: "block", content: { mod: "files-enhanced" } }, { id: "changes", type: "block", content: { mod: ID } }] }] },
    { id: "own", type: "block", content: { mod: ID, props: { view: "history" } } }] }] }] };
  const own = await mount(A, { palette: "theme", view: "history" });
  tabs("t1"); modPane("pp", "t1");
  state.runs.length = 0;
  press(byId(await draw(own), "history-tab"));
  assert.deepEqual(state.runs.map((r) => r[0]), ["tab.new"], "a block of its own: nothing to hide");
  tabs("t1", "tO"); modPane("po", "tO");
  await settle();
  state.layout = null;
  assert.deepEqual(state.violations, []);
});

test("⤢ in the Changes block's History (Herdr's own layout, no History page): the panel gives way; ⤡ brings it back, the block still on History", async () => {
  const base = tempDir("git-enhanced-tabs-block-");
  const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const A = join(base, "a");
  sh(base, "init", "-q", "-b", "main", "a");
  sh(A, "config", "user.name", "Tess"); sh(A, "config", "user.email", "tess@x"); sh(A, "config", "core.hooksPath", "/dev/null");
  for (const n of [1, 2]) { writeFileSync(join(A, "f.txt"), `${n}\n`); sh(A, "add", "-A"); sh(A, "commit", "-qm", `Commit ${n}`); }
  state.shared.delete(KEY.tabs); state.shared.delete(KEY.titles);
  // Herdr's own layout with our two blocks: no header of ours, no History page; History is the
  // Changes block's own (its Changes | History switch).
  state.layout = { id: "root", type: "row", children: [{ id: "work", type: "column", children: [{ id: "work-body", type: "row", children: [
    { id: "main", type: "block" },
    { id: "panel", type: "column", children: [{ id: "panel-body", type: "stack", children: [
      { id: "files", type: "block", content: { mod: "files-enhanced" } },
      { id: "changes", type: "block", content: { mod: ID, props: { palette: "theme" } } }] }] }] }] }] };
  const tabs = (...ids) => { state.spaces[0].tabs = ids.map((id) => ({ id })); };
  const modPane = (pane, tab) => state.panes.push({ pane, mod: ID, tab, terminal: null });
  const block = await mount(A, { palette: "theme" });
  assert.ok(block.block, "the block with the switch");
  tabs("t1"); modPane("pb", "t1");
  await draw(block); await settle();
  block.block.show("history", makeCx());
  let tree;
  for (let i = 0; i < 4; i++) { tree = await draw(block); await settle(); }
  state.runs.length = 0;
  press(byId(tree, "history-tab"));
  assert.deepEqual(state.runs.map((r) => r[0]), ["tab.new", "layout.hide"], "the History tab, and the panel gives way");
  assert.deepEqual(state.runs[1][1], { id: "panel" });
  tabs("t1", "tH"); modPane("ph", "tH");
  await settle();
  assert.deepEqual(state.shared.get(KEY.tabs).tH.place, { stack: "panel-body", child: "changes", panel: "panel", switch: true });
  // The tab's ⤡: the panel again on the Changes block, which kept showing History (a hidden copy
  // stays as it was), back to t1, the tab closed.
  const tab = await mount(base, { palette: "theme", view: "history", root: A, on: null });
  tabs("t1", "tH"); modPane("pb", "t1"); modPane("ph", "tH");
  state.focused = { ...state.focused, tab: "tH" };
  tree = await draw(tab);
  state.runs.length = 0;
  press(byId(tree, "history-back"));
  assert.deepEqual(state.runs, [["layout.show", { id: "panel" }], ["layout.select", { stack: "panel-body", child: "changes" }], ["tab.select", { id: "t1" }], ["tab.close", { id: "tH" }]]);
  assert.equal(block.block.page, "history");
  state.layout = null;
  assert.deepEqual(state.violations, []);
  await block.close(makeCx("async"));
});

test("the stubs, like the kit, refuse a resizable_panel outside its group", () => {
  const before = state.violations.length;
  h_resizable("ok").child(resizable_panel()).child(resizable_panel());
  assert.equal(state.violations.length, before);
  v_flex().id("loose").child(resizable_panel());
  assert.deepEqual(state.violations.splice(before), ["a resizable_panel outside a resizable group (loose)"]);
});

test("History: the line between the commits and the commit drags, up and down in the panel, left and right in the tab; kept per copy and direction", async () => {
  const base = tempDir("git-enhanced-split-");
  const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const A = join(base, "a");
  sh(base, "init", "-q", "-b", "main", "a");
  sh(A, "config", "user.name", "Tess"); sh(A, "config", "user.email", "tess@x"); sh(A, "config", "core.hooksPath", "/dev/null");
  for (const n of [1, 2, 3]) { writeFileSync(join(A, "f.txt"), `${n}\n`); sh(A, "add", "-A"); sh(A, "commit", "-qm", `Commit ${n}`); }
  state.shared.delete(KEY.historySplit);
  // The line is a strip that takes a press; the page keeps its plain flex layout, so the diff's list
  // has a height to scroll in (inside gpui-base's resizable group the diff doesn't scroll).
  const kinds = (t) => { const out = new Set(); walk(t, (n) => out.add(n.kind)); return out; };
  const sizeOf = (t, m) => byId(t, "history-list-area").calls.find(([k]) => k === m)?.[1][0];
  const has = (n, m) => n.calls.some(([k]) => k === m);
  // Up and down in the panel (narrow).
  const panel = await mount(A, { palette: "theme", view: "history" }), h = panel.part.history;
  h.size = { width: 480, height: 900 };
  let tree = await draw(panel);
  assert.equal(byId(tree, "history-split-line"), null, "no line before a commit is picked");
  handler(lists(tree).find((l) => l.listId === "history-commits"), "on_item_click")(h.commits[1].hash, makeCx()); await settle();
  tree = await draw(panel);
  assert.ok(!kinds(tree).has("v_resizable") && !kinds(tree).has("h_resizable") && !kinds(tree).has("resizable_panel"), "no resizable group");
  const first = sizeOf(tree, "h");
  assert.ok(first >= 140, `the commits get a height (${first})`);
  let line = byId(tree, "history-split-line");
  assert.ok(has(line, "cursor_row_resize") && line.calls.some(([k, a]) => k === "h" && a[0] === 7), "a 7 px strip, up and down");
  // Press the line, move 60 px down, let go: the commits grow by 60 and the size is kept.
  handler(line, "on_mouse_down")({ position: { x: 100, y: 500 }, button: "left" }, makeCx());
  tree = await draw(panel);
  handler(byId(tree, "history"), "on_mouse_move")({ position: { x: 100, y: 560 } }, makeCx());
  tree = await draw(panel);
  assert.equal(sizeOf(tree, "h"), first + 60, "follows the pointer");
  assert.equal(state.shared.get(KEY.historySplit), undefined, "kept only when the press ends");
  handler(byId(tree, "history"), "on_mouse_up")({ position: { x: 100, y: 560 }, button: "left" }, makeCx());
  assert.deepEqual(state.shared.get(KEY.historySplit), { "panel-v": first + 60 });
  tree = await draw(panel);
  assert.equal(sizeOf(tree, "h"), first + 60, "the kept size is used");
  assert.equal(handler(byId(tree, "history"), "on_mouse_move"), undefined, "no move handler once the press ended");
  // Dragged far: the commit keeps room for its information's least, the line under it and its
  // diff's 120 px; leaving the page ends the drag.
  const LOW = 900 - 80 - 7 - (MIN.info + 7 + MIN.diff);
  handler(byId(tree, "history-split-line"), "on_mouse_down")({ position: { x: 100, y: 500 }, button: "left" }, makeCx());
  tree = await draw(panel);
  handler(byId(tree, "history"), "on_mouse_move")({ position: { x: 100, y: 5000 } }, makeCx());
  tree = await draw(panel);
  assert.equal(sizeOf(tree, "h"), LOW, "at most the page less the commit's least and the line");
  handler(byId(tree, "history"), "on_hover")(false, makeCx());
  assert.equal(state.shared.get(KEY.historySplit)["panel-v"], LOW, "leaving the page ends the drag");
  // ... and left and right in the tab (wide), kept apart from the panel's.
  const tab = await mount(base, { palette: "theme", view: "history", root: A, on: null }), th = tab.part.history;
  th.size = { width: 1400, height: 900 };
  tree = await draw(tab);
  handler(lists(tree).find((l) => l.listId === "history-commits"), "on_item_click")(th.commits[0].hash, makeCx()); await settle();
  tree = await draw(tab);
  const w0 = sizeOf(tree, "w");
  assert.ok(w0 >= 380, `the commits get a width (${w0})`);
  line = byId(tree, "history-split-line");
  assert.ok(has(line, "cursor_col_resize") && line.calls.some(([k, a]) => k === "w" && a[0] === 7), "a 7 px strip, left and right");
  handler(line, "on_mouse_down")({ position: { x: 600, y: 300 }, button: "left" }, makeCx());
  tree = await draw(tab);
  handler(byId(tree, "history"), "on_mouse_move")({ position: { x: 500, y: 300 } }, makeCx());
  handler(byId(tree, "history"), "on_mouse_up")({ position: { x: 500, y: 300 }, button: "left" }, makeCx());
  assert.equal(state.shared.get(KEY.historySplit)["tab-h"], w0 - 100);
  assert.equal(state.shared.get(KEY.historySplit)["panel-v"], LOW, "the panel's size stays");
  // A press and a release without a move keeps nothing new.
  const before = JSON.stringify(state.shared.get(KEY.historySplit));
  tree = await draw(tab);
  handler(byId(tree, "history-split-line"), "on_mouse_down")({ position: { x: 500, y: 300 }, button: "left" }, makeCx());
  tree = await draw(tab);
  handler(byId(tree, "history"), "on_mouse_up")({ position: { x: 500, y: 300 }, button: "left" }, makeCx());
  assert.equal(JSON.stringify(state.shared.get(KEY.historySplit)), before);
  state.shared.delete(KEY.historySplit);
  assert.deepEqual(state.violations, []);
});
