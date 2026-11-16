// What a screen reader hears from Files' header buttons: that each is a button, and what it does
// (an icon has no words of its own; a tooltip is for the pointer only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, load, settle, makeCx, folder, at, draw, walk, text } from "./render/load.mjs";

test("every icon-only button of Files' header says it is a button and what it does", async () => {
  const { default: Files } = await load("main.js");
  state.shared.clear(); state.overlays.length = 0; state.violations.length = 0; state.props = {};
  at(folder(["a.txt"]));
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle();
  const said = (d, m) => d.calls.filter(([k]) => k === m).map(([, a]) => a[0]);
  const found = [...walk(draw(view))].filter((n) => n.$.handlers?.on_click?.length && [...walk(n)].some((x) => x.$.kind === "svg") && !text(n).trim())
    .map((n) => ({ id: n.$.id, role: said(n.$, "role")[0], label: said(n.$, "accessibility_label")[0] }));
  assert.ok(found.filter((b) => /^fm-/.test(b.id)).length >= 6, found.map((b) => b.id).join(" "));
  assert.deepEqual(found.filter((b) => b.role !== "button" || !b.label), [], "icon-only buttons that announce nothing");
});
