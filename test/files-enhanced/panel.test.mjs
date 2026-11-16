// The panel's tab header and settings window as Files Enhanced draws them (test/shared/panel.mjs),
// and its own ways to the window: the gear at the end of the tree's header, Settings… at the end of
// the shown folder's menu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubs, load, state, settle, makeCx, folder, at, draw, byId, walk, press, text } from "./render/load.mjs";
import { NAME } from "./mod.mjs";
import { panelTests } from "../shared/panel.mjs";

await panelTests({ name: NAME, stubs, load });

test("Settings… ends the shown folder's menu (the background, the header's ⋯), not a row's", async () => {
  const { items } = await load("menu.js");
  const base = { root: "/tmp", on: null, rel: "", dir: true, found: null };
  const folderMenu = items({ ...base, background: true }), rowMenu = items({ ...base, rel: "a.txt", dir: false });
  assert.equal(folderMenu.at(-1)?.label, "Settings…");
  assert.equal(folderMenu.at(-2), null, "after a line");
  assert.ok(!rowMenu.some((x) => x?.label === "Settings…"));
  state.overlays.length = 0;
  folderMenu.at(-1).run();
  await settle();
  assert.deepEqual(state.overlays.at(-1), { mod: NAME, kind: "window", key: "herdr-enhanced-settings", width: 640, height: 560, props: { role: "settings", section: "files" } });
});

test("the header: one gear, last, for the settings window at Files; ⋯ for the folder's menu; it fits a 300 px panel", async () => {
  const { default: Files } = await load("main.js");
  const { settingsWindowOpen, toggleSettingsWindow } = await load("settingsview.js");
  if (settingsWindowOpen()) toggleSettingsWindow();
  const gears = (root) => [...walk(root)].filter((n) => n.$.kind === "svg" && /settings\.svg$/.test(n.$.path)).length;
  state.shared.clear(); state.overlays.length = 0; state.violations.length = 0; state.props = {};
  at(folder(["a.txt"]));
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle();
  const root = draw(view), gear = byId(root, "fm-settings-open"), more = byId(root, "fm-more");
  assert.equal(gears(root), 1, "one gear");
  const row = [...walk(root)].find((n) => n.$.children.some((c) => c?.$?.id === "fm-settings-open"));
  assert.equal(row.$.children.at(-1).$.id, "fm-settings-open", "the gear is last");
  // Its icon buttons 2 px apart: every page's icon buttons side by side are (Changes' top-buttons test).
  assert.ok(row.$.calls.some(([m, a]) => m === "gap" && a[0] === 2), "icon buttons 2 px apart");
  // As tall as the Changes and History pages' top rows (42 px), the gear as far from the right edge
  // (14 px); on the left 8 px, before ‹ (its 24 px box).
  const call = (m) => row.$.calls.find(([c]) => c === m)?.[1][0];
  assert.deepEqual([call("h"), call("pl"), call("pr")], [42, 8, 14], "42 px, 8 px left, 14 px right");
  assert.deepEqual(gear.$.handlers.tooltip, [["Settings"]]);
  press(gear);
  assert.deepEqual(state.overlays.at(-1), { mod: NAME, kind: "window", key: "herdr-enhanced-settings", width: 640, height: 560, props: { role: "settings", section: "files" } });
  // Open: the gear says so and closes it (its id names the state: a tooltip changes with the id).
  const opened = `o${state.overlays.length}`;
  state.closed.length = 0;
  let again = byId(draw(view), "fm-settings-close");
  assert.equal(byId(draw(view), "fm-settings-open"), null);
  assert.deepEqual(again.$.handlers.tooltip, [["Close settings"]]);
  press(again);
  assert.deepEqual(state.closed, [opened]);
  assert.ok(byId(draw(view), "fm-settings-open"), "closed: the gear opens it");
  // Opened, then closed by Herdr (✕, Esc, the other mod's window): one press opens it again.
  press(byId(draw(view), "fm-settings-open"));
  const { SettingsWindow } = await load("settingsview.js");
  const saved = state.props;
  state.props = { role: "settings", section: "files", overlay: `o${state.overlays.length}` };
  const w = new SettingsWindow(makeCx());
  state.props = saved;
  assert.ok(byId(draw(view), "fm-settings-close"));
  w.close();
  again = byId(draw(view), "fm-settings-open");
  press(again);
  assert.deepEqual(state.closed, [opened], "nothing closed: opened");
  assert.equal(state.overlays.at(-1).props.section, "files");
  press(byId(draw(view), "fm-settings-close"));
  assert.equal(state.closed.length, 2);
  // ⋯: the folder's menu (no gear in it).
  assert.equal(text(more), "⋯");
  assert.equal(gears(more), 0);
  assert.deepEqual(more.$.handlers.tooltip, [["This folder's menu"]]);
  press(more);
  assert.deepEqual([state.overlays.at(-1).props.role, state.overlays.at(-1).props.background], ["menu", true]);
  // 300 px: the buttons keep their 24 px (flex_none); the root's name takes what is left (flex_1,
  // min_w 0, its label truncates), and there is room for it.
  const calls = (n, m) => n.$.calls.filter(([c]) => c === m).map(([, a]) => a);
  const buttons = row.$.children.filter((c) => c.$.id !== "fm-root");
  for (const b of buttons) assert.ok(calls(b, "flex_none").length && (calls(b, "size").some(([v]) => v === 24) || calls(b, "w").some(([v]) => v === 24)), `${b.$.id ?? b.$.kind}: 24 px, never shrinks`);
  const name = byId(root, "fm-root");
  assert.ok(calls(name, "flex_1").length && calls(name, "min_w").some(([v]) => v === 0), "the root's name gives way");
  assert.ok(name.$.children.some((c) => c?.$ && calls(c, "truncate").length && calls(c, "min_w").some(([v]) => v === 0)), "its label truncates");
  const used = buttons.length * 24 + (row.$.children.length - 1) * 2 + 8 + 14 + 2;   // + gaps, pl(8) pr(14), the card's border
  assert.ok(300 - used >= 40, `${300 - used} px left for the root's name`);
  assert.deepEqual(state.violations, []);
});
