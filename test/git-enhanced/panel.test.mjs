// The panel's tab header and settings window as Git Enhanced draws them (test/shared/panel.mjs),
// and its own ways to the window: the Changes page's gear and Settings… in its ⋯ menu, the History
// page's gear. Each page draws one gear, last in its top row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubs, load, state, settle, repo, mount, draw, overlay, drawWith, byId, press, handler, makeCx, walk } from "./render/load.mjs";
import { NAME } from "./mod.mjs";
import { panelTests } from "../shared/panel.mjs";

await panelTests({ name: NAME, stubs, load });

// The gears a render draws (the settings icon), and the row an element is in.
const gears = (tree) => { let n = 0; walk(tree, (d) => { if (d.kind === "svg" && /settings\.svg$/.test(d.path)) n += 1; }); return n; };
const rowOf = (tree, id) => { let row = null; walk(tree, (d) => { if (!row && d.children?.some((c) => c?.$?.id === id)) row = d; }); return row; };

test("the Changes page's gear, Settings… in the ⋯ menu by Commit, and History's gear open the settings window at Git", async () => {
  const { settingsWindowOpen, toggleSettingsWindow } = await load("settingsview.js");
  if (settingsWindowOpen()) toggleSettingsWindow();
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one"); });
  const window = { mod: NAME, kind: "window", key: "herdr-enhanced-settings", width: 640, height: 560, props: { role: "settings", section: "changes" } };
  const view = await mount(r.dir, { palette: "theme" });
  let tree = await draw(view);
  assert.equal(gears(tree), 1, "Changes: one gear");
  assert.equal(rowOf(tree, "changes-settings-open").children.at(-1).$.id, "changes-settings-open", "last in the top row");
  assert.deepEqual(byId(tree, "changes-settings-open").handlers.tooltip, [["Settings"]]);
  press(byId(tree, "changes-settings-open"));
  assert.deepEqual(state.overlays.at(-1), window);
  // Pressed again while the window is open: it closes it.
  state.closed.length = 0;
  tree = await draw(view);
  assert.equal(byId(tree, "changes-settings-open"), null);
  assert.deepEqual(byId(tree, "changes-settings-close").handlers.tooltip, [["Close settings"]]);
  const opened = state.overlays.length;
  press(byId(tree, "changes-settings-close"));
  assert.deepEqual(state.closed, [`o${opened}`], "closeOverlay with the window's id");
  assert.equal(state.overlays.length, opened, "nothing opened");
  // Settings… keeps opening, open or not (only its menus close: they close themselves).
  state.closed.length = 0;
  for (let i = 0; i < 2; i++) {
    press(byId(await draw(view), "commit-more"));
    await settle();
    const menu = state.overlays.at(-1);
    assert.equal(menu.props.question.items.at(-1).id, "settings");
    const m = overlay(menu);
    handler(byId(drawWith(m.view, m.props), "menu-settings"), "on_click")({}, makeCx());
    await settle();
    assert.deepEqual(state.overlays.at(-1), window);
  }
  const windows = state.overlays.map((o, i) => (o.kind === "window" ? `o${i + 1}` : null)).filter(Boolean);
  assert.equal(windows.length, 3);
  assert.deepEqual(state.closed.filter((id) => windows.includes(id)), [], "no window closed");
  assert.ok(byId(await draw(view), "changes-settings-close"), "open: the gear closes it");
  const history = await mount(r.dir, { palette: "theme", view: "history" });
  state.overlays.length = 0; state.closed.length = 0;
  tree = await draw(history);
  assert.equal(gears(tree), 1, "History: one gear");
  assert.equal(rowOf(tree, "history-settings-close").children.at(-1).$.id, "history-settings-close", "last in the top row");
  assert.deepEqual(byId(tree, "history-settings-close").handlers.tooltip, [["Close settings"]], "one window for the mod: History's gear closes it too");
  press(byId(tree, "history-settings-close"));
  assert.equal(state.closed.length, 1);
  tree = await draw(history);
  assert.deepEqual(byId(tree, "history-settings-open").handlers.tooltip, [["Settings"]]);
  press(byId(tree, "history-settings-open"));
  assert.deepEqual(state.overlays, [window]);
  assert.deepEqual(state.violations, []);
});

test("the gear after the window closed by itself (✕, Esc, the other mod's window, a layout switch): it opens it again", async () => {
  const { settingsWindowOpen, toggleSettingsWindow } = await load("settingsview.js");
  if (settingsWindowOpen()) toggleSettingsWindow();
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one"); });
  const view = await mount(r.dir, { palette: "theme" });
  state.overlays.length = 0; state.closed.length = 0;
  press(byId(await draw(view), "changes-settings-open"));
  assert.equal(state.overlays.length, 1);
  // The window's copy starts, then Herdr closes it: its close().
  const w = overlay(state.overlays[0], "o1");
  await settle();
  assert.ok(byId(await draw(view), "changes-settings-close"));
  await w.view.close(makeCx("async"));
  const tree = await draw(view);
  assert.deepEqual(byId(tree, "changes-settings-open").handlers.tooltip, [["Settings"]]);
  press(byId(tree, "changes-settings-open"));
  assert.equal(state.overlays.length, 2, "opened again with one press");
  assert.deepEqual(state.closed, []);
  assert.deepEqual(state.violations, []);
});
