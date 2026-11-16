// Files' header buttons are the icon buttons both mods draw (iconbutton.js, the same file in each, as
// the Changes and History pages' top rows have them): no frame, 24 px, the icon 14 px in `muted`; under
// the pointer `hover` in `foreground`; while on (the search open, the changed files shown, the folder
// pinned) on `selected` in `foreground`, as their Wrap and Herdr's tab bar show what is open. Files
// drew a button that was on as an `accent` icon with no background, and kept its icons `muted` under
// the pointer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubs, load, state, settle, makeCx, folder, at, draw, byId, press } from "./render/load.mjs";

// How an element looks: its calls, without the ones naming it or saying what it does (id, tooltip,
// its label for a screen reader, handlers) and its children; a hover by the calls it makes.
function replay(fn) {
  const calls = [];
  const p = new Proxy({}, { get: (_t, m) => (...a) => { calls.push(`${String(m)}(${a.map((x) => JSON.stringify(x)).join(",")})`); return p; } });
  fn(p);
  return calls;
}
function look(n) {
  const out = [];
  for (const [m, a] of n.$.calls) {
    if (["id", "tooltip", "accessibility_label", "child", "children"].includes(m) || /^on_/.test(m)) continue;
    out.push(m === "hover" ? `hover(${replay(a[0]).join(".")})` : `${m}(${a.map((x) => JSON.stringify(x)).join(",")})`);
  }
  return out;
}
// Its icon's calls (only its size: the color is the button's), or its text.
const inside = (n) => n.$.children.map((c) => (c?.$ ? (c.$.kind === "svg" ? ["svg", c.$.calls] : ["text", c.$.children]) : ["?", c]));

test("Files' header buttons are the icon buttons the Changes and History pages have; on, on `selected` in `foreground`", async () => {
  const { default: Files } = await load("main.js");
  const { iconButton } = await load("iconbutton.js");
  const t = stubs.theme();
  const off = look(iconButton(t, "model", "mods/x.svg", () => {}, { tip: "x" })), on = look(iconButton(t, "model", "mods/x.svg", () => {}, { tip: "x", on: true }));
  assert.ok(on.includes(`bg("${t.selected}")`) && on.includes(`text_color("${t.foreground}")`), on.join("."));
  state.shared.clear(); state.overlays.length = 0; state.violations.length = 0; state.props = {};
  at(folder(["a.txt"]));
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle();
  let root = draw(view);
  const ids = ["fm-up", "fm-search", "fm-changes-off", "fm-pin-off", "fm-newfile", "fm-newfolder", "fm-collapse", "fm-more", "fm-settings-open"];
  for (const id of ids) {
    const b = byId(root, id);
    assert.ok(b, `${id} is drawn`);
    assert.deepEqual(look(b), off, `${id}: drawn as the shared icon button`);
    const [what] = inside(b);
    if (id === "fm-more") assert.deepEqual(what, ["text", ["⋯"]], "⋯: the glyph");
    else assert.deepEqual(what, ["svg", [["size", [14]]]], `${id}: its icon 14 px, the button's color`);
  }
  // On: the search open, the changed files shown, the folder pinned.
  press(byId(root, "fm-search")); await settle();
  root = draw(view);
  assert.deepEqual(look(byId(root, "fm-search")), on, "the search open");
  press(byId(root, "fm-search")); await settle();
  press(byId(draw(view), "fm-changes-off")); await settle();
  root = draw(view);
  assert.deepEqual(look(byId(root, "fm-changes-on")), on, "the changed files shown");
  press(byId(root, "fm-changes-on")); await settle();
  press(byId(draw(view), "fm-pin-off")); await settle();
  root = draw(view);
  assert.deepEqual(look(byId(root, "fm-pin-on")), on, "the folder pinned");
  assert.deepEqual(look(byId(root, "fm-search")), off, "the search closed again");
  assert.deepEqual(state.violations, []);
});
