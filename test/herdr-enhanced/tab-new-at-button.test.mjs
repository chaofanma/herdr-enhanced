// The layout tab bar's +: its new-tab menu opens under the button, left edges lined up, 3 px off, as
// the panel's menus open at their buttons; not where the press landed (Herdr's default for a popup).
// Herdr zooms a popup's size, not its `at`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { state, byId, makeCx } from "../git-enhanced/render/load.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../herdr-enhanced/mods/tabs-enhanced");
const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } },
});
const { default: Tabs } = await import(pathToFileURL(join(dir, "main.js")).href);

function mount() {
  store.clear();
  state.layout = { id: "root", type: "row", children: [{ id: "tabs", type: "block", content: { mod: "tabs-enhanced" } }, { id: "main", type: "block" }] };
  state.spaces = [{ id: "s1", active: true, tabs: [{ id: "s1-t1", name: "work", active: true }] }];
  state.panes = []; state.runs.length = 0; state.overlays.length = 0; state.window = null;
  const view = new Tabs();
  view.init();
  return view;
}
// A press on + where `bounds` say it is, then its click: the popup it opened.
function openFrom(view, bounds) {
  const plus = byId(view.render(), "tab-new");
  assert.ok(plus, "+ is drawn");
  const cx = makeCx();
  for (const [button, fn] of plus.handlers.on_mouse_down ?? []) if (button === "left") fn({ button: "left", click_count: 1, position: { x: bounds.x + 4, y: bounds.y + 4 }, local_position: { x: 4, y: 4 }, bounds, modifiers: {} }, cx);
  assert.equal(cx.stopped, true, "the press is +'s (no window drag)");
  const before = state.overlays.length;
  plus.handlers.on_click.at(-1).at(-1)({ click_count: 1, modifiers: {} }, makeCx());
  assert.equal(state.overlays.length, before + 1, "a popup opened");
  return state.overlays.at(-1);
}

test("+ opens the new-tab menu under itself, left edges lined up", () => {
  const view = mount();
  const menu = openFrom(view, { x: 212, y: 6, width: 26, height: 26 });
  assert.equal(menu.mod, "new-menu");
  assert.deepEqual(menu.at, { x: 212, y: 6 + 26 + 3 });
});

test("zoomed, the gap grows with the zoom and the press's bounds stay the window's", () => {
  state.settings = { zoom: 1.5 };
  try {
    const view = mount();
    const menu = openFrom(view, { x: 318, y: 9, width: 39, height: 39 });
    assert.deepEqual(menu.at, { x: 318, y: 9 + 39 + 1.5 * 3 });
  } finally { state.settings = undefined; }
});
