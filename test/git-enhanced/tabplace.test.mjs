// tabplace.js: the layouts name this mod (mod.mjs NAME).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mod, NAME } from "./mod.mjs";

const { liveTabs, pruned, findTab, placeOf, NAMES } = await mod("tabplace.js");

// herdr-t3 given a panel with our pages, and Herdr's main layout with our pages.
const t3 = { id: "root", type: "row", children: [
  { id: "sidebar", type: "column", children: [{ id: "spaces", type: "block", content: { mod: "t3-spaces" } }] },
  { id: "work", type: "column", children: [{ id: "panel", type: "column", hidden: true, children: [{ id: "panel-body", type: "stack",
    header: { content: { mod: NAME, props: { role: "tabs", stack: "panel-body" } }, height: 34 }, children: [
      { id: "files", title: "Files", type: "block", content: { mod: "files-enhanced", props: { palette: "theme" } } },
      { id: "changes", title: "Changes", type: "block", content: { mod: NAME, props: { palette: "theme" } } },
      { id: "history", title: "History", type: "block", content: { mod: NAME, props: { palette: "theme", view: "history" } } }] }] }] }] };
const main = { id: "root", type: "row", children: [{ id: "work", type: "column", children: [{ id: "work-body", type: "row", children: [
  { id: "main", type: "block" },
  { id: "panel", type: "column", hidden: true, children: [{ id: "panel-body", type: "stack", children: [
    { id: "files", type: "block", content: { mod: "files-enhanced" } }, { id: "changes", type: "block", content: { mod: NAME } }] }] }] }] }] };

test("placeOf finds the page, its stack and the panel to hide", () => {
  assert.deepEqual(placeOf(t3, NAME, "history"), { stack: "panel-body", child: "history", panel: "panel" });
  assert.deepEqual(placeOf(t3, NAME, "changes"), { stack: "panel-body", child: "changes", panel: "panel" });
  assert.deepEqual(placeOf(main, NAME, "changes"), { stack: "panel-body", child: "changes", panel: "panel" });
  assert.equal(placeOf(main, NAME, "history"), null, "main has no History page");
  assert.equal(placeOf(null, NAME, "history"), null);
  // The panel's tab header in a block of its own isn't the Changes page.
  const header = { id: "root", type: "row", children: [{ id: "top", type: "block", content: { mod: NAME, props: { role: "tabs", stack: "panel-body" } } }, ...main.children] };
  assert.deepEqual(placeOf(header, NAME, "changes"), { stack: "panel-body", child: "changes", panel: "panel" });
});

test("placeOf: a page outside a stack, or a stack right under the root", () => {
  const loose = { id: "root", type: "row", children: [{ id: "h", type: "block", content: { mod: NAME, props: { view: "history" } } }] };
  assert.deepEqual(placeOf(loose, NAME, "history"), { stack: null, child: "h", panel: null });
  const top = { id: "root", type: "stack", children: [{ id: "h", type: "block", content: { mod: NAME, props: { view: "history" } } }] };
  assert.deepEqual(placeOf({ id: "w", type: "row", children: [top] }, NAME, "history"), { stack: "root", child: "h", panel: "root" });
  // A tab copy's own props (root) never count as the page.
  const tabbed = { id: "root", type: "row", children: [{ id: "x", type: "block", content: { mod: NAME, props: { view: "history", root: "/r" } } }] };
  assert.equal(placeOf(tabbed, NAME, "history"), null);
});

test("findTab: one tab per page, repository, machine and space; gone tabs pruned", () => {
  const spaces = [{ id: "s1", tabs: [{ id: "a" }, { id: "b" }] }, { id: "s2", tabs: [{ id: "c" }] }];
  const live = liveTabs(spaces);
  assert.deepEqual([...live], ["a", "b", "c"]);
  const map = { a: { kind: "history", root: "/r", on: null, space: "s1" }, z: { kind: "history", root: "/r", on: null, space: "s1" },
    c: { kind: "review", root: "/r", on: "dev", space: "s2" } };
  assert.deepEqual(Object.keys(pruned(map, live)), ["a", "c"]);
  assert.equal(findTab(pruned(map, live), { kind: "history", root: "/r", space: "s1" }), "a");
  assert.equal(findTab(map, { kind: "history", root: "/other", space: "s1" }), null);
  assert.equal(findTab(map, { kind: "review", root: "/r", on: null, space: "s2" }), null, "another machine");
  assert.equal(findTab(map, { kind: "review", root: "/r", on: "dev", space: "s2" }), "c");
  assert.equal(findTab(map, { kind: "history", root: "/r", space: "s2" }), null, "another space");
  assert.deepEqual(NAMES, { history: "History", review: "Review", files: "Files" });
});
