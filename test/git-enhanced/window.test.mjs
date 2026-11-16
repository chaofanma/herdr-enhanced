// Git Enhanced in a window of its own (mod.open git-enhanced, cmd-alt-g in keys.json): a copy
// whose props are only { overlay } draws the Changes page under a slim bar (Changes | History, ✕;
// no gear: each page has its own); the bar's controls and the page stop their presses (else Herdr drags the window); ✕
// closes it. Menus and dialogs, overlays too, still go by their own props.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, byId, press, handler, settle, makeCx, load, walk } from "./render/load.mjs";

const { ChangesWindow, isWindow } = await load("window.js");
const { ChangesPage } = await load("changes.js");
const { HistoryPage } = await load("historypage.js");
const { Question } = await load("question.js");
const { SettingsWindow } = await load("settingsview.js");
const { CommitOverlay } = await load("commitmenu.js");
const { fetchesItself } = await load("prefs.js");
// The gears a render draws (the settings icon).
const gears = (tree) => { let n = 0; walk(tree, (d) => { if (d.kind === "svg" && /settings\.svg$/.test(d.path)) n += 1; }); return n; };

test("a copy with only { overlay }: the Changes page under the window's bar; History; one gear, the page's; ✕", async () => {
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "a"); });
  r.write("a.txt", "two\n");
  const view = await mount(r.dir, { overlay: "w1" }), w = view.part;
  assert.ok(w instanceof ChangesWindow);
  assert.equal(fetchesItself({ overlay: "w1" }), false, "the panel's copy fetches, not a window");
  assert.equal(w.pages.changes.recorder, undefined, "the panel's copy records agent turns, not a window");
  let tree = await draw(view);
  assert.ok(byId(tree, "changes-window-bar"));
  assert.ok(byId(tree, "changes"), "the Changes page");
  assert.ok(w.pages.changes.entries.some((e) => e.path === "a.txt") && w.pages.changes.diff.rows.length > 0, "its files and the diff");
  assert.equal(w.pages.history, undefined, "History starts when asked for");
  // Every control of the bar, and the page itself, stop their presses: only the bar drags the window.
  for (const id of ["window-tab-changes", "window-tab-history", "changes-window-close", "changes-window-body"]) {
    const cx = makeCx();
    handler(byId(tree, id), "on_mouse_down")({}, cx);
    assert.equal(cx.stopped, true, `${id} stops its press`);
  }
  assert.equal(handler(byId(tree, "changes-window-bar"), "on_mouse_down"), undefined, "the bar itself drags the window");
  press(byId(tree, "window-tab-history")); await settle();
  tree = await draw(view);
  assert.ok(w.pages.history instanceof HistoryPage);
  assert.ok(byId(tree, "history") && !byId(tree, "changes"), "History shown");
  assert.equal(w.pages.history.history.commits.length, 1);
  assert.equal(gears(tree), 1, "History: its own gear, none in the bar");
  assert.ok(byId(tree, "history-settings-open"));
  press(byId(tree, "window-tab-changes"));
  tree = await draw(view);
  assert.ok(byId(tree, "changes") && !byId(tree, "history"));
  // One gear: the page's (the bar has none), the settings window at Git.
  assert.equal(byId(tree, "changes-window-settings"), null);
  assert.equal(gears(tree), 1);
  press(byId(tree, "changes-settings-open"));
  assert.deepEqual(state.overlays.at(-1).props, { role: "settings", section: "changes" });
  // ✕: this window goes.
  press(byId(tree, "changes-window-close"));
  assert.equal(state.closed.at(-1), "w1");
  assert.deepEqual(state.violations, []);
});

test("menus, dialogs and the shared parts still go by their own props, overlays or not", async () => {
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "a"); });
  assert.equal(isWindow({ overlay: "o1" }), true);
  for (const p of [{ overlay: "o1", role: "settings" }, { overlay: "o1", view: "history" }, { overlay: "o1", review: true }, {}, { view: "history" }]) assert.equal(isWindow(p), false, JSON.stringify(p));
  const cases = [
    [{ overlay: "o2", question: { id: "q1", title: "Sure?", confirm: "Yes" } }, Question],
    [{ overlay: "o3", role: "settings" }, SettingsWindow],
    [{ overlay: "o4", commitMenu: { hash: "0".repeat(40), root: r.dir, on: null, items: [] } }, CommitOverlay],
    [{ palette: "theme" }, ChangesPage],
    [{ palette: "theme", view: "history" }, HistoryPage],
  ];
  for (const [props, Part] of cases) {
    const view = await mount(r.dir, props);
    assert.ok(view.part instanceof Part, `${JSON.stringify(Object.keys(props))}: ${Part.name}`);
  }
});
