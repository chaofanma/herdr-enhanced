// A History or Review tab closed another way than ⤡ (the pane header's ×, ⌘W, the tab bar): the panel
// that gave way came back only through ⤡, so it stayed hidden. The pages in the panel, alive while
// hidden, look for their tabs every CLOSED_TAB_POLL ms and bring it back on that page (tabs.js
// restoreClosedTabs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { state, mount, draw, byId, press, settle, load } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const { KEY, ID } = await load("id.js");
const { restoreClosedTabs, CLOSED_TAB_POLL } = await load("tabs.js");

function repoDir() {
  const base = tempDir("git-enhanced-closed-"), A = join(base, "a");
  const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  sh(base, "init", "-q", "-b", "main", "a");
  sh(A, "config", "user.name", "Tess"); sh(A, "config", "user.email", "tess@x"); sh(A, "config", "core.hooksPath", "/dev/null");
  writeFileSync(join(A, "f.txt"), "1\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "One");
  return A;
}
// A layout with a panel column of three pages (as herdr-enhanced's), the panel shown on History.
function panelLayout() {
  return { id: "root", type: "row", children: [{ id: "work", type: "column", children: [{ id: "panel", type: "column", children: [{ id: "panel-body", type: "stack", active: "history", children: [
    { id: "files", type: "block", content: { mod: "files-enhanced" } },
    { id: "changes", type: "block", content: { mod: ID, props: { palette: "theme" } } },
    { id: "history", type: "block", content: { mod: ID, props: { palette: "theme", view: "history" } } }] }] }] }] };
}
const panel = () => state.layout.children[0].children[0];
const tabs = (...ids) => { state.spaces[0].tabs = ids.map((id) => ({ id })); };
const modPane = (pane, tab) => state.panes.push({ pane, mod: ID, tab, terminal: null });

// ⤢ on the panel's History page: tab tH made (as Herdr would: the tab is there, the panel hidden).
async function openHistoryTab() {
  state.shared.delete(KEY.tabs); state.shared.delete(KEY.titles); state.shared.set("layout", "herdr-enhanced");
  state.layout = panelLayout();
  const view = await mount(repoDir(), { palette: "theme", view: "history" });
  tabs("t1"); modPane("pp", "t1");
  state.focused = { ...state.focused, tab: "t1" };
  press(byId(await draw(view), "history-tab"));
  tabs("t1", "tH"); modPane("ph", "tH");
  panel().hidden = true;
  state.focused = { ...state.focused, tab: "tH" };
  await settle();
  assert.ok(state.shared.get(KEY.tabs)?.tH, "the tab's entry");
  assert.equal(state.shared.get(KEY.tabs).tH.layout, "herdr-enhanced", "the layout it was opened in");
  return view;
}

test("a page in the panel looks for its closed tabs; a tab's copy doesn't", async () => {
  state.everies.length = 0;
  await mount(repoDir(), { palette: "theme", view: "history" });
  assert.ok(state.everies.includes(CLOSED_TAB_POLL), `the panel's page polls every ${CLOSED_TAB_POLL} ms`);
  state.everies.length = 0;
  await mount(repoDir(), { palette: "theme", view: "history", root: "/somewhere", on: null });
  assert.ok(!state.everies.includes(CLOSED_TAB_POLL), "a History tab's copy doesn't");
});

test("closed by the pane header's × (or ⌘W): the panel comes back on History, the entries go, no tab is chosen", async () => {
  await openHistoryTab();
  state.runs.length = 0;
  restoreClosedTabs(ID); // seen open
  assert.deepEqual(state.runs, [], "open: nothing to do");
  tabs("t1"); state.focused = { ...state.focused, tab: "t1" }; // Herdr closed it and shows t1
  restoreClosedTabs(ID);
  assert.deepEqual(state.runs, [["layout.show", { id: "panel" }], ["layout.select", { stack: "panel-body", child: "history" }]]);
  assert.deepEqual(state.shared.get(KEY.tabs), {}); assert.deepEqual(state.shared.get(KEY.titles), {});
  state.runs.length = 0;
  restoreClosedTabs(ID);
  assert.deepEqual(state.runs, [], "once");
  assert.deepEqual(state.violations, []);
});

test("closed by ⤡: its own way back, nothing more", async () => {
  await openHistoryTab();
  restoreClosedTabs(ID);
  const tab = await mount(join(tempDir("git-enhanced-closed-tab-")), { palette: "theme", view: "history", root: state.shared.get(KEY.tabs).tH.root, on: null });
  tabs("t1", "tH"); state.focused = { ...state.focused, tab: "tH" };
  press(byId(await draw(tab), "history-back"));
  tabs("t1"); panel().hidden = false;
  state.runs.length = 0;
  restoreClosedTabs(ID);
  assert.deepEqual(state.runs, [], "⤡ already brought the panel back");
});

test("not brought back when the panel is shown already, in another layout, or with another page tab in front", async () => {
  await openHistoryTab();
  restoreClosedTabs(ID);
  panel().hidden = false; // the person showed it with the tab bar
  tabs("t1"); state.runs.length = 0;
  restoreClosedTabs(ID);
  assert.deepEqual(state.runs, [], "shown already: its page stays as the person left it");
  assert.deepEqual(state.shared.get(KEY.tabs), {}, "the entry goes all the same");

  await openHistoryTab();
  restoreClosedTabs(ID);
  state.shared.set("layout", "main-panel"); // another layout shows now
  tabs("t1"); state.runs.length = 0;
  restoreClosedTabs(ID);
  assert.deepEqual(state.runs, [], "another layout: its panel isn't the one hidden");

  await openHistoryTab();
  // A Review tab beside it, in front once History closes.
  state.shared.set(KEY.tabs, { ...state.shared.get(KEY.tabs), tR: { kind: "review", root: "/r", on: null, space: "s1", from: "t1", place: { stack: "panel-body", child: "changes", panel: "panel" }, layout: "herdr-enhanced" } });
  tabs("t1", "tH", "tR");
  restoreClosedTabs(ID);
  tabs("t1", "tR"); state.focused = { ...state.focused, tab: "tR" }; state.runs.length = 0;
  restoreClosedTabs(ID);
  assert.deepEqual(state.runs, [], "Review in front: the panel stays out of its way");
  assert.deepEqual(Object.keys(state.shared.get(KEY.tabs)), ["tR"], "History's entry went, Review's stays");
});

test("a tab never seen open (closed before this app started) is only let go, never acted on", async () => {
  state.shared.set("layout", "herdr-enhanced");
  state.layout = panelLayout(); panel().hidden = true;
  state.shared.set(KEY.tabs, { tOld: { kind: "history", root: "/r", on: null, space: "s1", from: "t1", place: { stack: "panel-body", child: "history", panel: "panel" }, layout: "herdr-enhanced" } });
  tabs("t1"); state.runs.length = 0;
  restoreClosedTabs(ID);
  assert.deepEqual(state.runs, []);
  state.shared.delete(KEY.tabs);
});
