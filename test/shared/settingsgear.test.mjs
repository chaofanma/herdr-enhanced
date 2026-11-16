// A page's gear (shared/settingsview.js toggleSettingsWindow): it opens this mod's settings window, and
// closes it when it's open. Each mod knows only its own window (its module's state): Files' and
// Changes' are apart, and opening one replaces the other (one key), which closes the other's copy.
// Both mods' modules in one process, on the Changes tests' stubs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { state, makeCx, load } from "../git-enhanced/render/load.mjs";
import { MOD as FILES } from "../files-enhanced/mod.mjs";

const C = await load("settingsview.js");
const F = await import(pathToFileURL(join(FILES, "settingsview.js")).href);
// The window's copy Herdr starts for overlay `id` (with that mod's SettingsWindow).
const windowCopy = (mod, id) => {
  const saved = state.props;
  state.props = { role: "settings", overlay: id };
  try { return new mod.SettingsWindow(makeCx()); } finally { state.props = saved; }
};
const reset = () => { for (const m of [C, F]) if (m.settingsWindowOpen()) m.toggleSettingsWindow(); state.overlays.length = 0; state.closed.length = 0; };

test("the two mods' modules are apart: each its own window state", () => {
  assert.notEqual(C.toggleSettingsWindow, F.toggleSettingsWindow);
  reset();
  assert.equal(C.settingsWindowOpen(), false); assert.equal(F.settingsWindowOpen(), false);
});

test("press: opened; again: closeOverlay with its id; closed by Herdr, then press: opened again", () => {
  reset();
  const id = C.toggleSettingsWindow("changes");
  assert.equal(state.overlays.length, 1);
  assert.deepEqual(state.overlays[0].props, { role: "settings", section: "changes" });
  assert.equal(C.settingsWindowOpen(), true);
  assert.deepEqual(C.settingsGear("changes-settings", "changes").id, "changes-settings-close");
  assert.equal(C.toggleSettingsWindow("changes"), null);
  assert.deepEqual(state.closed, [id]);
  assert.equal(state.overlays.length, 1, "nothing opened");
  assert.deepEqual([C.settingsGear("changes-settings", "changes").id, C.settingsGear("changes-settings", "changes").tip], ["changes-settings-open", "Settings"]);
  // Opened, its copy started, then Herdr closed it (✕, Esc, a layout switch): its close().
  const again = C.toggleSettingsWindow("changes"), w = windowCopy(C, again);
  w.close();
  assert.equal(C.settingsWindowOpen(), false);
  C.toggleSettingsWindow("changes");
  assert.equal(state.overlays.length, 3, "one press opens it");
  assert.deepEqual(state.closed, [id]);
});

test("Files' and Changes' windows: each gear knows only its own; one replacing the other closes the other's copy", () => {
  reset();
  const c = C.toggleSettingsWindow("changes"), cw = windowCopy(C, c);
  assert.equal(F.settingsWindowOpen(), false, "Changes' window isn't Files'");
  // Files' gear: Files' window, in the place of Changes' (Herdr closes that copy).
  const f = F.toggleSettingsWindow("files");
  assert.equal(state.overlays.at(-1).mod, "files-enhanced");
  assert.deepEqual(state.closed, [], "Files' gear closed nothing");
  const fw = windowCopy(F, f);
  cw.close();
  assert.equal(C.settingsWindowOpen(), false);
  assert.equal(F.settingsWindowOpen(), true);
  // Files' gear again: closes Files' window.
  F.toggleSettingsWindow("files");
  assert.deepEqual(state.closed, [f]);
  fw.close();
  assert.equal(F.settingsWindowOpen(), false);
});

test("Settings… while the window is open: the new window replaces it; the old copy's close() leaves the new one known", () => {
  reset();
  const first = C.openSettingsWindow("changes"), w1 = windowCopy(C, first);
  const second = C.openSettingsWindow("agents");
  assert.notEqual(second, first);
  w1.close();
  assert.equal(C.settingsWindowOpen(), true, "the new window is still open");
  C.toggleSettingsWindow();
  assert.deepEqual(state.closed, [second]);
  // Herdr keeping the id for the window in its place, its new copy started before the old one went.
  reset();
  const id = C.openSettingsWindow("changes"), old = windowCopy(C, id);
  C.openSettingsWindow("changes");
  state.overlays.length = 0;
  const kept = windowCopy(C, id);
  old.close();
  assert.equal(C.settingsWindowOpen(), true, "the new copy started first");
  kept.close();
  assert.equal(C.settingsWindowOpen(), false);
});

test("after a rebuild (the module starts empty, the window stays): the window's copy starts again and the gear closes it", () => {
  reset();
  const w = windowCopy(C, "w7");
  assert.equal(C.settingsWindowOpen(), true);
  C.toggleSettingsWindow();
  assert.deepEqual(state.closed, ["w7"]);
  w.close();
  assert.equal(C.settingsWindowOpen(), false);
});
