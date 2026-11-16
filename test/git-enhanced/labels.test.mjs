// What a screen reader hears from the pages' icon-only buttons: that each is a button, and what it
// does. gpui-kit: an icon-only control announces nothing without `accessibility_label`, and a
// tooltip is for the pointer only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { repo, mount, draw, walk, texts, makeCx, settle, stubs } from "./render/load.mjs";

const { iconButton, CLOSE } = await import("../../shared/iconbutton.js");
const { iconButton: controlButton } = await import("../../shared/controls.js");
const said = (d, m) => d.calls.filter(([k]) => k === m).map(([, a]) => a[0]);
const hasSvg = (d) => { let hit = false; walk({ $: d }, (x) => { if (x.kind === "svg") hit = true; }); return hit; };
// The clickable elements whose only content is an icon, with what each announces.
function iconOnly(tree) {
  const out = [];
  walk(tree, (d) => {
    if (d.handlers?.on_click?.length && hasSvg(d) && texts({ $: d }).every((w) => !w.trim())) out.push({ id: d.id, role: said(d, "role")[0], label: said(d, "accessibility_label")[0] });
  });
  return out;
}
const mute = (found) => found.filter((b) => b.role !== "button" || !b.label);

test("an icon button is a button, named by its tooltip or by a label of its own", () => {
  const t = stubs.theme();
  const close = iconButton(t, "x", CLOSE, () => {}, { tip: "Close" }).$;
  assert.deepEqual([said(close, "role"), said(close, "accessibility_label")], [["button"], ["Close"]]);
  const ask = iconButton(t, "ask", CLOSE, () => {}, { tip: "Ask the space's agent about this file's diff", label: "Ask about diff" }).$;
  assert.deepEqual([said(ask, "accessibility_label"), said(ask, "tooltip")], [["Ask about diff"], ["Ask the space's agent about this file's diff"]]);
  const settingsClose = controlButton(t, "ps-close", CLOSE, "Close", () => {}).$;
  assert.deepEqual([said(settingsClose, "role"), said(settingsClose, "accessibility_label")], [["button"], ["Close"]], "the settings window's close");
});

test("every icon-only button of the Changes page, narrow and wide, and of History says it is a button and what it does", async () => {
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one"); });
  r.write("a.txt", "two\n");
  for (const width of [368, 1300]) {
    const view = await mount(r.dir, { palette: "theme" }), page = view.part;
    page.size = { width, height: 900 };
    if (page.open?.path !== "a.txt") { page.pick("a.txt", "unstaged", makeCx()); await settle(); }
    const found = iconOnly(await draw(view));
    assert.ok(found.length >= 4, `${width}: ${found.map((b) => b.id).join(" ")}`);
    assert.deepEqual(mute(found), [], `${width}: icon-only buttons that announce nothing`);
    if (width < 600) assert.equal(found.find((b) => b.id === "ask-diff")?.label, "Ask about diff", "as its words say when wider");
  }
  const found = iconOnly(await draw(await mount(r.dir, { palette: "theme", view: "history" })));
  assert.ok(found.length >= 4, found.map((b) => b.id).join(" "));
  assert.deepEqual(mute(found), [], "History: icon-only buttons that announce nothing");
});
