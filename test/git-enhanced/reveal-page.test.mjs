// The cross links to Files Enhanced (only while it's installed) and the reveal requests Changes
// Enhanced takes (shared/reveal.js, reveals.js): git-enhanced.reveal opens a file's diff or its
// history; Show in Files asks Files Enhanced.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { state, stubs, mount, draw, overlay, drawWith, byId, lists, handler, settle, makeCx, load } from "./render/load.mjs";
import { NAME } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";

const { KEY } = await load("id.js");
const { takers, REVEAL } = await load("reveal.js");
const { checkInstalled } = await load("installed.js");
const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
function repoAt(dir, files, when = null) {
  mkdirSync(dir, { recursive: true });
  sh(dir, "init", "-q", "-b", "main"); sh(dir, "config", "user.name", "Tess"); sh(dir, "config", "user.email", "t@x"); sh(dir, "config", "core.hooksPath", "/dev/null");
  for (const [p, text] of Object.entries(files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), text); }
  sh(dir, "add", "-A");
  execFileSync("git", ["commit", "-qm", "one"], { cwd: dir, env: { ...process.env, ...(when ? { GIT_AUTHOR_DATE: `${when} +0000`, GIT_COMMITTER_DATE: `${when} +0000` } : {}) } });
  if (when) { const t = new Date(when * 1000); utimesSync(join(dir, ".git", "index"), t, t); }
  return dir;
}
// Files Enhanced in the stubs' app folder, or not; the installed check looks again.
const files = async (yes) => {
  const dir = join(stubs.appHome(), "mods", "files-enhanced");
  if (yes) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "main.js"), "// the other mod\n"); } else rmSync(dir, { recursive: true, force: true });
  await checkInstalled();
};
const page = (history) => ({ id: history ? "history" : "changes", type: "block", content: { mod: NAME, props: { palette: "theme", ...(history ? { view: "history" } : {}) } } });
const layoutWith = (...pages) => ({ id: "root", type: "row", children: [{ id: "main", type: "block", content: { tab: "active" } }, { id: "panel", type: "column", hidden: true, children: [{ id: "panel-body", type: "stack", active: "files", children: [
  { id: "files", type: "block", content: { mod: "files-enhanced" } }, ...pages] }] }] });
// A question menu that was opened last: its item ids, and a click on one.
async function menuPick(id) {
  await settle();
  const spec = state.overlays.at(-1), q = spec?.props?.question;
  assert.ok(q?.menu, "a menu opened");
  const m = overlay(spec), tree = drawWith(m.view, m.props), saved = state.props;
  if (id) { state.props = m.props; handler(byId(tree, `menu-${id}`), "on_click")({}, makeCx()); state.props = saved; }
  await settle();
  return q.items.map((i) => i.id);
}
const ask = (req) => state.shared.set(KEY.reveal, { at: Date.now(), on: null, page: "changes", ...req });

beforeEach(async () => {
  takers.clear(); state.shared.clear(); state.layout = layoutWith(page(false), page(true));
  for (const k of ["runs", "overlays", "violations"]) state[k].length = 0;
  await files(false);
});

test("Show in Files on a file row and on a commit's file rows, only with Files Enhanced installed", async () => {
  const dir = repoAt(tempDir("git-enhanced-reveal-"), { "a.txt": "1\n", "b.txt": "1\n" });
  writeFileSync(join(dir, "a.txt"), "2\n"); rmSync(join(dir, "b.txt"));
  let view = await mount(dir, { palette: "theme" });
  view.part.fileMenu("a.txt", "unstaged", makeCx());
  assert.deepEqual(await menuPick(null), ["revert"], "without Files Enhanced: as before");
  await files(true);
  view = await mount(dir, { palette: "theme" });
  view.part.fileMenu("a.txt", "unstaged", makeCx());
  assert.deepEqual(await menuPick("files"), ["revert", "files"]);
  assert.equal(REVEAL.files, "files-enhanced.reveal");
  assert.deepEqual({ ...state.shared.get(REVEAL.files), at: 0 }, { at: 0, full: join(dir, "a.txt"), on: null });
  assert.deepEqual(state.runs.slice(-2), [["layout.select", { stack: "panel-body", child: "files" }], ["layout.show", { id: "panel" }]]);
  // A deleted file: the item is there but off.
  view.part.fileMenu("b.txt", "unstaged", makeCx());
  await settle();
  assert.equal(state.overlays.at(-1).props.question.items.find((i) => i.id === "files").disabled, true);
  // History: a commit's file rows have it on a right-click.
  const history = await mount(dir, { palette: "theme", view: "history" }), h = history.part.history;
  let tree = await draw(history);
  handler(lists(tree).find((l) => l.listId === "history-commits"), "on_item_click")(h.commits[0].hash, makeCx()); await settle();
  tree = await draw(history);
  state.shared.delete(REVEAL.files);
  { const fl = lists(tree).find((l) => l.listId === "history-files-list"); handler(fl, "on_item_secondary_click")(fl.getKey(0), {}, makeCx()); }
  assert.deepEqual(await menuPick("files"), ["version", "files"]);
  assert.deepEqual({ ...state.shared.get(REVEAL.files), at: 0 }, { at: 0, full: join(dir, h.files[0].path), on: null });
  await files(false);
  { const fl = lists(await draw(history)).find((l) => l.listId === "history-files-list"); handler(fl, "on_item_secondary_click")(fl.getKey(0), {}, makeCx()); }
  assert.deepEqual(await menuPick(null), ["version"], "no Show in Files without Files Enhanced");
  assert.deepEqual(state.violations, []);
});

test("git-enhanced.reveal: the Changes page showing that repository opens the file's diff and comes forward", async () => {
  const dir = repoAt(tempDir("git-enhanced-reveal-"), { "a.txt": "1\n", "b.txt": "1\n", "c.txt": "1\n" });
  writeFileSync(join(dir, "a.txt"), "2\n"); writeFileSync(join(dir, "b.txt"), "2\n"); sh(dir, "add", "b.txt");
  const view = await mount(dir, { palette: "theme" }), p = view.part;
  assert.equal(p.open.path, "b.txt", "the first file's diff to begin with");
  state.runs.length = 0;
  ask({ root: dir, path: "a.txt" });
  await draw(view); await settle(); await draw(view);
  assert.deepEqual(p.open, { path: "a.txt", section: "unstaged" });
  assert.deepEqual(state.runs.slice(0, 2), [["layout.select", { stack: "panel-body", child: "changes" }], ["layout.show", { id: "panel" }]]);
  // A file without changes here says so; a stale request is let go.
  ask({ root: dir, path: "c.txt" });
  await draw(view); await settle(); await draw(view);
  assert.match(p.line, /c\.txt: no changes here/);
  state.shared.set(KEY.reveal, { at: Date.now() - 60000, root: dir, on: null, path: "b.txt", page: "changes" });
  await draw(view); await settle();
  assert.equal(p.open.path, "a.txt", "too old");
  // A read-only scope goes back to the uncommitted changes first.
  p.setScope("last", makeCx()); await settle();
  ask({ root: dir, path: "b.txt" });
  await draw(view); await settle(); await draw(view); await settle(); await draw(view);
  assert.equal(p.scope, "work");
  assert.deepEqual(p.open, { path: "b.txt", section: "staged" });
  assert.deepEqual(state.violations, []);
});

test("git-enhanced.reveal of another repository: the panel switches to one it lists, else opens a Review tab", async () => {
  const work = tempDir("git-enhanced-reveal-");
  const older = repoAt(join(work, "older"), { "o.txt": "1\n" }, 1_600_000_000), newer = repoAt(join(work, "newer"), { "n.txt": "1\n" }, 1_700_000_000);
  writeFileSync(join(older, "o.txt"), "2\n");
  const view = await mount(work, { palette: "theme" }), p = view.part;
  assert.equal(p.root, newer);
  ask({ root: older, path: "o.txt" });
  for (let i = 0; i < 4; i++) { await draw(view); await settle(); }
  assert.equal(p.root, older, "picked from the switcher's list");
  assert.deepEqual(state.shared.get(KEY.repo), { [`:${work}`]: older });
  assert.deepEqual(p.open, { path: "o.txt", section: "unstaged" });
  // A repository it doesn't list: a Review tab on it (its copy then shows the file).
  const elsewhere = repoAt(tempDir("git-enhanced-reveal-"), { "e.txt": "1\n" });
  state.runs.length = 0;
  ask({ root: elsewhere, path: "e.txt" });
  await draw(view); await settle();
  const made = state.runs.find(([name]) => name === "tab.new");
  assert.ok(made, JSON.stringify(state.runs));
  assert.deepEqual([made[1].name, made[1].mod, made[1].props.review, made[1].props.root], ["Review", NAME, true, elsewhere]);
  assert.deepEqual(state.violations, []);
});

test("git-enhanced.reveal for History: path:<path> in the History page's search; a layout without any Changes block: a History tab", async () => {
  const dir = repoAt(tempDir("git-enhanced-reveal-"), { "src/a b.js": "1\n", "c.txt": "1\n" });
  const history = await mount(dir, { palette: "theme", view: "history" }), h = history.part.history;
  state.runs.length = 0;
  ask({ root: dir, path: "src/a b.js", page: "history" });
  await draw(history); await settle(); await draw(history);
  assert.equal(h.query, 'path:"src/a b.js"');
  assert.deepEqual(state.runs.slice(0, 2), [["layout.select", { stack: "panel-body", child: "history" }], ["layout.show", { id: "panel" }]]);
  // The whole repository: the path goes from the search.
  ask({ root: dir, path: "", page: "history" });
  await draw(history); await settle(); await draw(history);
  assert.equal(h.query, "");
  // No Changes block in the layout (the Changes page is a window's, outside it): History in a tab.
  takers.clear();
  state.layout = layoutWith();
  const changes = await mount(dir, { palette: "theme" });
  state.runs.length = 0;
  ask({ root: dir, path: "c.txt", page: "history" });
  await draw(changes); await settle();
  const made = state.runs.find(([name]) => name === "tab.new");
  assert.ok(made, JSON.stringify(state.runs));
  assert.deepEqual([made[1].name, made[1].props.view, made[1].props.root], ["History", "history", dir]);
  assert.deepEqual(state.violations, []);
});

// Herdr's own layout (main) with our two blocks: its tab bar has the Files and Changes buttons, no
// header of ours and no History page; the Changes block's Changes | History switch shows History.
const drawn = async (view, n = 4) => { for (let i = 0; i < n; i++) { await draw(view); await settle(); } };
const tabsMade = () => state.runs.filter(([name]) => name === "tab.new");

test("History requests in Herdr's own layout: the Changes block shows its History, filtered by the path, and comes forward; no tab", async () => {
  state.layout = layoutWith(page(false));
  const dir = repoAt(tempDir("git-enhanced-reveal-"), { "src/a b.js": "1\n", "src/c.js": "1\n", "d.txt": "1\n" });
  writeFileSync(join(dir, "d.txt"), "2\n");
  const view = await mount(dir, { palette: "theme" });
  assert.ok(view.block, "the block with the switch");
  await drawn(view, 2);
  assert.equal(view.block.page, "changes");
  state.runs.length = 0;
  // File history: History made in the block, path:<file> once it has read the repository.
  ask({ root: dir, path: "src/a b.js", page: "history" });
  await drawn(view);
  assert.equal(view.block.page, "history");
  const h = view.block.history();
  assert.equal(h.root, dir);
  assert.equal(h.query, 'path:"src/a b.js"');
  assert.deepEqual(tabsMade(), [], "no History tab");
  assert.deepEqual(state.runs.slice(0, 2), [["layout.select", { stack: "panel-body", child: "changes" }], ["layout.show", { id: "panel" }]]);
  assert.equal(takers.has(h), false, "the block's History still takes no requests itself");
  // Folder history, the block on Changes again: back to History, the folder's filter instead.
  view.block.show("changes", makeCx()); await drawn(view, 1);
  state.runs.length = 0;
  ask({ root: dir, path: "src", page: "history" });
  await drawn(view);
  assert.equal(view.block.page, "history");
  assert.equal(view.block.history(), h, "the same History");
  assert.equal(h.query, "path:src");
  assert.deepEqual(tabsMade(), []);
  assert.deepEqual(state.runs.slice(0, 2), [["layout.select", { stack: "panel-body", child: "changes" }], ["layout.show", { id: "panel" }]]);
  // Show changes still goes to the Changes page (the block switches back).
  ask({ root: dir, path: "d.txt" });
  await drawn(view);
  assert.equal(view.block.page, "changes");
  assert.deepEqual(view.part.open, { path: "d.txt", section: "unstaged" });
  assert.deepEqual(state.violations, []);
  await view.close(makeCx("async"));
});

test("History requests in Herdr's own layout for another repository the folder lists: chosen first, then filtered", async () => {
  state.layout = layoutWith(page(false));
  const work = tempDir("git-enhanced-reveal-");
  const older = repoAt(join(work, "older"), { "o.txt": "1\n" }, 1_600_000_000), newer = repoAt(join(work, "newer"), { "n.txt": "1\n" }, 1_700_000_000);
  const view = await mount(work, { palette: "theme" });
  await drawn(view, 2);
  assert.equal(view.part.root, newer);
  ask({ root: older, path: "o.txt", page: "history" });
  await drawn(view, 6);
  assert.deepEqual(state.shared.get(KEY.repo), { [`:${work}`]: older }, "picked as the switcher does");
  assert.equal(view.block.page, "history");
  assert.equal(view.block.history().root, older);
  assert.equal(view.block.history().query, "path:o.txt");
  assert.deepEqual(tabsMade(), []);
  // One the folder doesn't list: a History tab, as before.
  const elsewhere = repoAt(tempDir("git-enhanced-reveal-"), { "e.txt": "1\n" });
  state.runs.length = 0;
  ask({ root: elsewhere, path: "e.txt", page: "history" });
  await drawn(view, 2);
  assert.deepEqual(tabsMade().map(([, spec]) => [spec.name, spec.props.view, spec.props.root]), [["History", "history", elsewhere]]);
  assert.equal(view.block.history().query, "path:o.txt", "the block's History left as it was");
  assert.deepEqual(state.violations, []);
  await view.close(makeCx("async"));
});

test("History requests with our header and a History page: that page takes them; the Changes block stays the Changes page", async () => {
  const header = { content: { mod: NAME, props: { role: "tabs", stack: "panel-body" } }, height: 34 };
  state.layout = layoutWith(page(false), page(true));
  state.layout.children[1].children[0].header = header;
  const dir = repoAt(tempDir("git-enhanced-reveal-"), { "a.txt": "1\n" });
  const changes = await mount(dir, { palette: "theme" });
  const history = await mount(dir, { palette: "theme", view: "history" });
  await drawn(changes, 1); await drawn(history, 1);
  state.runs.length = 0;
  ask({ root: dir, path: "a.txt", page: "history" });
  for (let i = 0; i < 4; i++) { await drawn(changes, 1); await drawn(history, 1); }
  assert.equal(history.part.history.query, "path:a.txt");
  assert.equal(changes.block.page, "changes");
  assert.equal(changes.block.pages.history, undefined, "the block made no History");
  assert.deepEqual(tabsMade(), []);
  assert.deepEqual(state.runs.slice(0, 2), [["layout.select", { stack: "panel-body", child: "history" }], ["layout.show", { id: "panel" }]]);
  assert.deepEqual(state.violations, []);
});
