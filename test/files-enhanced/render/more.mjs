// stubs.mjs with a few more of Herdr's surface for the tests in test/files-enhanced/*.test.mjs that load modules
// through load.mjs: theme() names its colors ("muted", "accent"…) so a test can tell them apart
// (or is one of Herdr's themes, state.palette),
// TextView.markdown, settings() with the appearance and zoom, and a writeTextFile that checks (and
// records, so a test can tell a save here from one on another machine).
export * from "./stubs.mjs";
import { div, InputState as BaseInput } from "./stubs.mjs";

// An input that also takes a selection (rename and compress select the name's stem) and lets go.
export const InputState = { new: (opts) => { const s = BaseInput.new(opts); s.set_selected_range = (r) => { s.range = r; }; s.release = () => true; return s; } };

// Herdr's writeTextFile: only over the text the caller expects (null: a new file), else it rejects.
// Both count as work in flight, so settle() waits for them.
import { readFile, writeFile } from "node:fs/promises";
import { state } from "./stubs.mjs";
const counted = async fn => { state.inflight++; try { return await fn(); } finally { state.inflight--; } };
export const writeTextFile = (path, text, expected) => counted(async () => {
  state.writes.push(path);
  const now = await readFile(path, "utf8").catch(() => null);
  if (now !== expected) throw new Error("The file changed (stale snapshot)");
  await writeFile(path, text);
  return null;
});
export const readTextFile = path => counted(() => readFile(path, "utf8").catch(() => null));

// state.palette: one of Herdr's themes (test/shared/themes.json), state.dark its appearance.
export const theme = () => state.palette ?? new Proxy({}, { get: (_t, k) => (typeof k === "string" ? k : undefined) });
export const settings = () => ({ font_size: 14, dark: state.dark ?? true, zoom: 1, ...(state.settings ?? {}) });
export const TextView = { new: (...a) => div().child(String(a[1] ?? "")), markdown: (id, text) => div().id(id).child(String(text)) };
