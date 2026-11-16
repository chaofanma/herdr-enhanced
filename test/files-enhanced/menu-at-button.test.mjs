// The header's menus open at their buttons, not where the press landed: ⋯ (the folder's menu) under
// it, its right edge on the button's; the folder's name (its list of folders) under it, left edges
// lined up; 3 px off, as History's filters' lists. Herdr zooms a popup's size, not its `at`. While
// its menu is open the button looks pressed and has no tooltip, until the menu's copy closes. A
// right-click on the tree's background still opens the folder's menu where it was pressed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load, state, settle, makeCx, folder, at, draw, byId, press } from "./render/load.mjs";
import { THEMES } from "../shared/themecheck.mjs";

const { default: Files } = await load("main.js");
const t = THEMES[0].colors;
const bgs = (n) => n.$.calls.filter(([m]) => m === "bg").map(([, a]) => a[0]);
const tipOf = (n) => n.$.handlers.tooltip?.at(-1)?.[0];

async function mountTree() {
  state.shared.clear(); state.overlays.length = 0; state.violations.length = 0; state.props = {};
  at(folder(["a.txt", "src/b.txt"]));
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle();
  return view;
}
// Presses `id` where `bounds` say it is, clicks it: the popup it opened (its openOverlay spec).
async function openFrom(view, id, bounds) {
  const b = byId(draw(view), id);
  assert.ok(b, `${id} is drawn`);
  const down = (b.$.handlers.on_mouse_down ?? []).find(([button]) => button === "left");
  assert.ok(down, `${id}: a press keeps where it is`);
  down.at(-1)({ button: "left", click_count: 1, position: { x: bounds.x + 4, y: bounds.y + 4 }, local_position: { x: 4, y: 4 }, bounds, modifiers: {} }, makeCx());
  const before = state.overlays.length;
  press(b);
  await settle();
  assert.equal(state.overlays.length, before + 1, `${id}: a popup opened`);
  return state.overlays.at(-1);
}
// Herdr closes popup `n` (its overlay id o<n>): its copy's close().
async function closeCopy(spec) {
  const was = state.props;
  state.props = { ...spec.props, overlay: `o${state.overlays.indexOf(spec) + 1}` };
  const copy = new Files();
  copy.init({}, makeCx());
  await copy.close(makeCx());
  state.props = was;
  await settle();
}
const z = (n) => n * (state.settings?.zoom ?? 1);

test("⋯ opens the folder's menu under it, right edges lined up; pressed and with no tooltip until the menu closes", async () => {
  const was = state.palette;
  state.palette = t;
  try {
    const view = await mountTree();
    const tip = tipOf(byId(draw(view), "fm-more"));
    const more = { x: 400, y: 9, width: 24, height: 24 };
    const menu = await openFrom(view, "fm-more", more);
    assert.equal(menu.props.role, "menu");
    assert.deepEqual(menu.at, { x: 400 + 24 - z(menu.width), y: 9 + 24 + z(3) });
    let b = byId(draw(view), "fm-more");
    assert.ok(bgs(b).includes(t.selected), "pressed while its menu is open");
    assert.equal(tipOf(b), undefined, "no tooltip over its menu");
    await closeCopy(menu);
    b = byId(draw(view), "fm-more");
    assert.ok(!bgs(b).includes(t.selected), "not once the menu closed");
    assert.equal(tipOf(b), tip, "its tooltip back");
    // A right-click on the background: the same menu, where the press was; no button lit.
    const tree = [...(function* w(n) { if (!n?.$) return; yield n; for (const c of n.$.children) yield* w(c); })(draw(view))].find((n) => (n.$.handlers.on_mouse_down ?? []).some(([button]) => button === "right") && n.$.handlers.on_drop);
    assert.ok(tree, "the tree's background takes a right-click");
    tree.$.handlers.on_mouse_down.find(([button]) => button === "right").at(-1)({ button: "right", position: { x: 200, y: 300 } }, makeCx());
    const bg = state.overlays.at(-1);
    assert.equal(bg.props.role, "menu");
    assert.equal(bg.at, undefined, "at the press");
    assert.ok(!bgs(byId(draw(view), "fm-more")).includes(t.selected));
    assert.deepEqual(state.violations, []);
  } finally { state.palette = was; }
});

test("the folder's name opens its list of folders under it, left edges lined up; lit while it's open; zoomed, only its size grows", async () => {
  const was = state.palette;
  state.palette = t;
  try {
    const view = await mountTree();
    const name = { x: 40, y: 8, width: 120, height: 26 };
    let menu = await openFrom(view, "fm-root", name);
    assert.equal(menu.props.role, "roots");
    assert.deepEqual(menu.at, { x: 40, y: 8 + 26 + 3 });
    assert.ok(bgs(byId(draw(view), "fm-root")).includes(t.hover), "lit while its list is open");
    assert.equal(tipOf(byId(draw(view), "fm-root")), undefined, "no tooltip over it");
    await closeCopy(menu);
    assert.ok(!bgs(byId(draw(view), "fm-root")).includes(t.hover));
    state.settings = { zoom: 1.25 };
    try {
      const more = { x: 400, y: 9, width: 24, height: 24 };
      menu = await openFrom(view, "fm-more", more);
      assert.deepEqual(menu.at, { x: 400 + 24 - 1.25 * menu.width, y: 9 + 24 + 1.25 * 3 });
      await closeCopy(menu);
    } finally { state.settings = undefined; }
    assert.deepEqual(state.violations, []);
  } finally { state.palette = was; }
});
