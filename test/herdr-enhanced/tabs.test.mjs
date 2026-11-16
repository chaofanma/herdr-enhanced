// The herdr-enhanced layout's tab bar (herdr-enhanced/mods/tabs-enhanced): Herdr's own tab bar with a
// History button beside Files and Changes, for the panel's History page. Rendered with the stubbed
// Herdr modules (git-enhanced/render: the same stubs as the mods' render tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { state, walk, byId, texts } from "../git-enhanced/render/load.mjs";
import { layoutProblems } from "../shared/layoutlint.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../herdr-enhanced/mods/tabs-enhanced");
// Herdr gives each copy its own localStorage; node has none that works without a file.
const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } },
});
const { default: Tabs } = await import(pathToFileURL(join(dir, "main.js")).href);

// Every color is its name, so a button's look can be read back.
const named = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? `#${k}` : undefined) });
const page = (id, mod, props) => ({ id, type: "block", content: { mod, ...(props ? { props } : {}) } });
// Herdr's main shape: the tab bar, then the work row with the panel (a stack of pages).
function shape({ history = true, hidden = true, active = "files" } = {}) {
  const pages = [page("files", "files-enhanced"), page("changes", "git-enhanced", { palette: "theme" })];
  if (history) pages.push(page("history", "git-enhanced", { palette: "theme", view: "history" }));
  return { id: "root", type: "row", children: [{ id: "work", type: "column", children: [
    { id: "tabs", type: "block", content: { mod: "tabs-enhanced" } },
    { id: "work-body", type: "row", children: [{ id: "main", type: "block" },
      { id: "panel", type: "column", hidden, children: [{ id: "panel-body", type: "stack", active, children: pages }] }] }] }] };
}
const space = (id, active = true) => ({ id, active, tabs: [{ id: `${id}-t1`, name: "work", active: true }] });
function fresh(layout, { panels = undefined, spaces = [space("s1")] } = {}) {
  store.clear();
  state.layout = layout; state.spaces = spaces; state.panes = []; state.runs.length = 0; state.palette = named; state.window = null;
  if (panels === undefined) state.shared.delete("workspace.panels"); else state.shared.set("workspace.panels", panels);
  const view = new Tabs();
  view.init();
  return view;
}
const draw = (view) => { const tree = view.render(); assert.deepEqual(layoutProblems(tree), []); return tree; };
// The panel's buttons, by the page each opens (Herdr's tab bar gives a button the id panel-<page>).
const buttons = (tree) => { const out = []; walk(tree, (d) => { const m = /^panel-(.+)$/.exec(String(d.id)); if (m) out.push(m[1]); }); return out; };
const button = (tree, page) => byId(tree, `panel-${page}`);
const icons = (n) => { const out = []; walk(n?.$ ? n : { $: n }, (d) => { if (d.kind === "svg") out.push(d.path); }); return out; };
const click = (n) => n.handlers.on_click[0][0]({}, {});
const lit = (n) => n.calls.some(([m, a]) => m === "bg" && a[0] === "#selected");

test("Files, Changes and History, in that order, where the panel has a History page; History comes with Changes", () => {
  let tree = draw(fresh(shape()));
  assert.deepEqual(buttons(tree), ["files", "changes", "history"]);
  const history = button(tree, "history");
  assert.deepEqual(texts(history), ["History"]);
  assert.deepEqual(icons(history), ["mods/workspace-chrome/clock.svg"], "an icon that ships with Herdr");
  // Herdr's own panel list (its welcome screen's choice) knows files and changes: History follows Changes.
  assert.deepEqual(buttons(draw(fresh(shape(), { panels: ["files"] }))), ["files"]);
  assert.deepEqual(buttons(draw(fresh(shape(), { panels: ["changes"] }))), ["changes", "history"]);
  assert.deepEqual(buttons(draw(fresh(shape(), { panels: [] }))), []);
  // No History page in the panel: no History button (the Changes page has its own switch there).
  assert.deepEqual(buttons(draw(fresh(shape({ history: false })))), ["files", "changes"]);
});

test("History's button shows the panel on History; lit while it shows; pressed again it hides the panel", () => {
  let view = fresh(shape());
  click(button(draw(view), "history"));
  assert.deepEqual(state.runs, [["layout.select", { stack: "panel-body", child: "history" }], ["layout.show", { id: "panel" }]]);
  state.layout = shape({ hidden: false, active: "history" }); state.runs.length = 0;
  const tree = draw(view);
  assert.ok(lit(button(tree, "history")) && !lit(button(tree, "changes")) && !lit(button(tree, "files")));
  click(button(tree, "history"));
  assert.deepEqual(state.runs, [["layout.hide", { id: "panel" }]]);
});

test("each space keeps its panel's page, History too: back in a space that showed History, the panel shows it again", () => {
  const view = fresh(shape({ hidden: false, active: "history" }), { spaces: [space("s1"), space("s2", false)] });
  draw(view);
  assert.deepEqual(JSON.parse(store.get("panels")), { s1: "history" });
  // To s2, which never had one: the panel closes.
  state.spaces = [space("s1", false), space("s2")]; state.runs.length = 0;
  draw(view);
  assert.deepEqual(state.runs, [["layout.hide", { id: "panel" }]]);
  state.layout = shape({ hidden: true, active: "history" });
  draw(view);
  // Back to s1: History again (a page with no button of Herdr's tab bar counted as closed).
  state.spaces = [space("s1"), space("s2", false)]; state.runs.length = 0;
  draw(view);
  assert.deepEqual(state.runs, [["layout.select", { stack: "panel-body", child: "history" }], ["layout.show", { id: "panel" }]]);
});

test("its own icons from its own folder, the others from the mods that ship with Herdr", () => {
  const view = fresh(shape());
  state.window = { platform: "windows", buttons: true, maximized: false };
  const tree = draw(view);
  const own = readdirSync(dir).filter((f) => f.endsWith(".svg"));
  for (const path of icons(tree)) {
    const m = /^mods\/([^/]+)\/(.+)$/.exec(path);
    assert.ok(m, path);
    if (m[1] === "tabs-enhanced") assert.ok(own.includes(m[2]), `${path} is in the folder`);
    else assert.ok(["files", "changes", "pane", "workspace-chrome"].includes(m[1]), `${path}: a mod Herdr ships`);
  }
  assert.deepEqual(icons(byId(tree, "minimize")), ["mods/tabs-enhanced/win-min.svg"]);
  assert.doesNotMatch(readFileSync(join(dir, "main.js"), "utf8"), /mods\/tabs\//, "never Herdr's tabs folder");
});

test("a copy of Herdr's tab bar that says so: its mod.json and the top of main.js", () => {
  const json = JSON.parse(readFileSync(join(dir, "mod.json"), "utf8"));
  assert.equal(json.place, "none", "only where a layout names it");
  assert.deepEqual(json.cloned_from, { name: "tabs", version: "0.1.15" });
  assert.match(readFileSync(join(dir, "main.js"), "utf8").split("\n").slice(0, 12).join("\n"), /Based on Herdr's shipped tabs mod \(Apache-2\.0\)/);
});
