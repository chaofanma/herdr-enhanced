// A second press on ⋯ or the folder's name while its popup is open closes the popup: Herdr closes
// it at the press (its copy's close()), and the click that follows doesn't open it again. The
// press after that opens it again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load, state, settle, makeCx, folder, at, draw, byId, press } from "./render/load.mjs";

const { default: Files } = await load("main.js");
const B = { x: 300, y: 9, width: 24, height: 24 };

async function mountTree() {
  state.shared.clear(); state.overlays.length = 0; state.violations.length = 0; state.props = {};
  at(folder(["a.txt", "src/b.txt"]));
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle();
  return view;
}
const down = (view, id) => {
  const b = byId(draw(view), id);
  assert.ok(b, `${id} is drawn`);
  b.$.handlers.on_mouse_down.find(([button]) => button === "left").at(-1)({ button: "left", click_count: 1, position: { x: B.x + 4, y: B.y + 4 }, local_position: { x: 4, y: 4 }, bounds: B, modifiers: {} }, makeCx());
};
const up = async (view, id) => { press(byId(draw(view), id)); await settle(); };
// Herdr closes popup `spec` (a press beside it): its copy's close().
async function herdrCloses(spec) {
  const was = state.props;
  state.props = { ...spec.props, overlay: `o${state.overlays.indexOf(spec) + 1}` };
  const copy = new Files();
  copy.init({}, makeCx());
  await copy.close(makeCx());
  state.props = was;
  await settle();
}

for (const id of ["fm-more", "fm-root"]) {
  test(`${id}: a second press closes its popup; the next opens it again`, async () => {
    const view = await mountTree();
    let before = state.overlays.length;
    down(view, id); await up(view, id);
    assert.equal(state.overlays.length, before + 1, "a press opens it");
    const popup = state.overlays.at(-1);
    before = state.overlays.length;
    down(view, id);
    await herdrCloses(popup);
    await up(view, id);
    assert.equal(state.overlays.length, before, "a second press only closes it");
    down(view, id); await up(view, id);
    assert.equal(state.overlays.length, before + 1, "the press after that opens it again");
    await herdrCloses(state.overlays.at(-1));
    assert.deepEqual(state.violations, []);
  });
}
