// Files in a tab of its own (⤢ in the panel's header, as History's): the shown folder in a tab, the
// panel that holds the tree hidden while it is open; in the tab the tree at the left, the preview at
// the right, the line between them dragged and kept; ⤡ (or closing the tab another way) brings the
// panel back on Files. A narrow panel leaves ⤢ out before anything else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { state, makeCx, settle, load, folder, at, draw, byId, press, text } from "./render/load.mjs";

const { default: Files } = await load("main.js");
const { ID, own } = await load("id.js");
const { TAB_TREE } = await load("tree.js");
const { restoreClosedTabs, CLOSED_TAB_POLL } = await load("tabs.js");
const { keysOf } = await load("tabplace.js");
const K = keysOf(ID);

// herdr-enhanced's shape: a panel column whose stack holds Files, Changes and History.
const panelLayout = () => ({ id: "root", type: "row", children: [{ id: "work", type: "column", children: [{ id: "panel", type: "column", children: [{ id: "panel-body", type: "stack", active: "files", children: [
  { id: "files", type: "block", content: { mod: ID } },
  { id: "changes", type: "block", content: { mod: "git-enhanced", props: { palette: "theme" } } }] }] }] }] });
const panel = () => state.layout.children[0].children[0];
const tabs = (...ids) => { state.spaces[0].tabs = ids.map((id) => ({ id })); };

function reset() {
  state.shared.clear(); state.overlays.length = 0; state.violations.length = 0; state.runs.length = 0; state.everies.length = 0;
  state.props = {}; state.layout = panelLayout();
}
async function mount(props = {}) {
  state.props = props;
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle();
  return { view, root: () => draw(view) };
}
const size = (view, width) => { const root = draw(view); press(byId(root, "files"), "on_size_change", { width, height: 700 }); };
const icon = (n) => [...(function* walk(x) { yield x; for (const c of x.$.children ?? []) if (c?.$) yield* walk(c); })(n)].find((x) => x.$.kind === "svg")?.$.path;

test("⤢ in the panel's header opens the folder in a tab and the panel makes room; again, the same tab", async () => {
  reset();
  const dir = folder(["src/a.js", "notes.md"]);
  at(dir); tabs("t1"); state.focused = { ...state.focused, tab: "t1" };
  const { view, root } = await mount();
  const ids = [...(function* walk(x) { yield x; for (const c of x.$.children ?? []) if (c?.$) yield* walk(c); })(root())].map((n) => n.$.id).filter((id) => /^fm-(collapse|tab|more|settings-open)$/.test(String(id)));
  assert.deepEqual(ids, ["fm-collapse", "fm-tab", "fm-more", "fm-settings-open"], "⤢ before ⋯, as History's");
  assert.equal(icon(byId(root(), "fm-tab")), "mods/pane/zoom.svg", "Herdr's pane zoom icon");
  assert.equal(byId(root(), "fm-back"), null);
  state.runs.length = 0;
  press(byId(root(), "fm-tab"));
  assert.deepEqual(state.runs, [["tab.new", { name: "Files", mod: ID, props: { root: dir, on: null } }], ["layout.hide", { id: "panel" }]]);
  tabs("t1", "tF"); state.panes.push({ pane: "pf", mod: ID, tab: "tF", terminal: null });
  await settle();
  const entry = state.shared.get(K.tabs)?.tF;
  assert.deepEqual([entry?.kind, entry?.root, entry?.place], ["files", dir, { stack: "panel-body", child: "files", panel: "panel" }]);
  assert.equal(state.shared.get(K.titles)?.tF, "Files");
  state.runs.length = 0;
  press(byId(root(), "fm-tab"));
  assert.deepEqual(state.runs, [["tab.select", { id: "tF" }], ["layout.hide", { id: "panel" }]], "the same tab, not a second");
  assert.ok(state.everies.some((e) => e.ms === CLOSED_TAB_POLL), "the panel's tree looks for its tab closed another way");
  assert.deepEqual(state.violations, []);
  void view;
});

test("the tab: its folder whatever the terminal, the tree at the left and the preview at the right; ⤡ goes back", async () => {
  reset();
  const dir = folder(["src/a.js", "notes.md"]), other = folder(["elsewhere.txt"]);
  writeFileSync(join(dir, "notes.md"), "# Notes\n");
  at(other); tabs("t1", "tF"); state.focused = { ...state.focused, tab: "tF" };
  state.shared.set(K.tabs, { tF: { kind: "files", root: dir, on: null, space: "s1", from: "t1", place: { stack: "panel-body", child: "files", panel: "panel" }, layout: null } });
  const { view, root } = await mount({ root: dir, on: null });
  assert.equal(text(byId(root(), "fm-root")), dir.split("/").pop(), "its own folder, not the terminal's");
  assert.equal(byId(root(), "fm-tab"), null, "no ⤢ in the tab");
  assert.equal(icon(byId(root(), "fm-back")), "mods/pane/unzoom.svg", "⤡, Herdr's pane unzoom icon");
  assert.equal(byId(root(), /^fm-pin-/), null, "nothing to pin");
  assert.ok(!state.everies.some((e) => e.ms === CLOSED_TAB_POLL), "a tab's copy doesn't look for closed tabs");
  // Side by side: the tree's column, the line, the preview's column (a hint until a file is picked).
  const body = byId(root(), "fm-tab-body");
  assert.deepEqual(body.$.children.filter((c) => c?.$).map((c) => c.$.id), ["fm-tab-tree", "fm-tab-line", "fm-tab-preview"]);
  assert.equal(byId(root(), "fm-tab-tree").$.calls.findLast(([m]) => m === "w")?.[1][0], TAB_TREE.size);
  assert.ok(byId(root(), "fm-tab-hint"), "a hint where the preview goes");
  press(byId(root(), "file-notes.md")); await settle();
  assert.ok(byId(byId(root(), "fm-tab-preview"), "fm-preview"), "the preview at the right");
  // ⤡: the panel on Files, the tab it came from, this tab closed.
  state.runs.length = 0;
  press(byId(root(), "fm-back"));
  assert.deepEqual(state.runs, [["layout.show", { id: "panel" }], ["layout.select", { stack: "panel-body", child: "files" }], ["tab.select", { id: "t1" }], ["tab.close", { id: "tF" }]]);
  assert.deepEqual(state.shared.get(K.tabs), {});
  assert.deepEqual(state.violations, []);
  void view;
});

test("the line between the tree and the preview drags, stays within its bounds and is kept", async () => {
  reset();
  const dir = folder(["a.txt"]);
  at(dir); tabs("t1", "tF");
  const { view, root } = await mount({ root: dir, on: null });
  size(view, 1200);
  const line = byId(root(), "fm-tab-line");
  press(line, "on_mouse_down", { position: { x: 500, y: 300 }, modifiers: {} });
  press(byId(root(), "files"), "on_mouse_move", { position: { x: 580, y: 300 }, modifiers: {} });
  assert.equal(byId(root(), "fm-tab-tree").$.calls.findLast(([m]) => m === "w")?.[1][0], TAB_TREE.size + 80, "follows the pointer");
  press(byId(root(), "files"), "on_mouse_up", { position: { x: 580, y: 300 }, modifiers: {} });
  assert.equal(state.shared.get(own("tabSplit")), TAB_TREE.size + 80, "kept where it was left");
  // Never narrower than its least, and the preview keeps its own.
  press(byId(root(), "fm-tab-line"), "on_mouse_down", { position: { x: 600, y: 300 }, modifiers: {} });
  press(byId(root(), "files"), "on_mouse_move", { position: { x: -900, y: 300 }, modifiers: {} });
  assert.equal(byId(root(), "fm-tab-tree").$.calls.findLast(([m]) => m === "w")?.[1][0], TAB_TREE.min);
  press(byId(root(), "files"), "on_mouse_move", { position: { x: 5000, y: 300 }, modifiers: {} });
  assert.equal(byId(root(), "fm-tab-tree").$.calls.findLast(([m]) => m === "w")?.[1][0], Math.min(TAB_TREE.max, 1200 - TAB_TREE.preview - TAB_TREE.line));
  press(byId(root(), "files"), "on_mouse_up", { position: { x: 5000, y: 300 }, modifiers: {} });
  assert.deepEqual(state.violations, []);
});

test("a narrow panel leaves ⤢ out (every button still fits); on another machine the chip goes before the name's room", async () => {
  reset();
  const dir = folder(["a.txt"]);
  at(dir); tabs("t1");
  const { view, root } = await mount();
  size(view, 320);
  assert.ok(byId(root(), "fm-tab"), "320 px: ⤢ fits");
  size(view, 300);
  assert.equal(byId(root(), "fm-tab"), null, "300 px: ⤢ left out");
  assert.ok(byId(root(), "fm-settings-open") && byId(root(), "fm-more"), "the rest stays");
  assert.deepEqual(state.violations, []);
  // On another machine: the machine's badge where the name keeps 48 px beside its 36, else only the name.
  reset();
  const remote = folder(["b.txt"]);
  at(remote, "build-runner-eu-west-17"); tabs("t1");
  const m = await mount();
  const badge = () => byId(m.root(), "fm-root").$.children.filter((c) => c?.$?.kind === "div").length === 2;
  size(m.view, 440);
  assert.ok(badge(), "440 px: the badge beside the name");
  size(m.view, 360);
  assert.ok(!badge(), "360 px: the name alone (the tooltip names both)");
  assert.deepEqual(state.violations, []);
});

test("closed by the pane header's ×: the panel comes back on Files", async () => {
  reset();
  const dir = folder(["a.txt"]);
  at(dir); tabs("t1"); state.focused = { ...state.focused, tab: "t1" };
  const { root } = await mount();
  press(byId(root(), "fm-tab"));
  tabs("t1", "tF"); state.panes.push({ pane: "pf2", mod: ID, tab: "tF", terminal: null });
  panel().hidden = true;
  await settle();
  restoreClosedTabs(ID); // seen open
  tabs("t1"); state.runs.length = 0;
  restoreClosedTabs(ID);
  assert.deepEqual(state.runs, [["layout.show", { id: "panel" }], ["layout.select", { stack: "panel-body", child: "files" }]]);
  assert.deepEqual(state.violations, []);
});
