// The cross links to Git Enhanced (only while it's installed) and the reveal requests Files takes
// (shared/reveal.js): its menu items ask Git Enhanced, files-enhanced.reveal shows a path.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { state, stubs, makeCx, settle, load, folder, at, draw } from "./render/load.mjs";
import { NAME } from "./mod.mjs";

const { default: Files } = await load("main.js");
const { items } = await load("menu.js");
const { takers, REVEAL } = await load("reveal.js");
const { checkInstalled } = await load("installed.js");
const git = (dir, ...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "init.defaultBranch=main", ...args], { cwd: dir, stdio: "pipe" });
const labels = (p) => items(p).map((x) => x?.label ?? null);
// Git Enhanced in the stubs' app folder, or not; the installed check looks again.
const changes = async (yes) => {
  const dir = join(stubs.appHome(), "mods", "git-enhanced");
  if (yes) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "main.js"), "// the other mod\n"); } else rmSync(dir, { recursive: true, force: true });
  await checkInstalled();
};
// Herdr's main layout with our three pages in the panel (hidden) and a stack header.
const LAYOUT = { id: "root", type: "row", children: [{ id: "main", type: "block", content: { tab: "active" } }, { id: "panel", type: "column", hidden: true, children: [{ id: "panel-body", type: "stack", active: "changes",
  header: { content: { mod: NAME, props: { role: "tabs", stack: "panel-body" } }, height: 34 }, children: [
    { id: "files", type: "block", content: { mod: NAME } },
    { id: "changes", type: "block", content: { mod: "git-enhanced", props: { palette: "theme" } } },
    { id: "history", type: "block", content: { mod: "git-enhanced", props: { palette: "theme", view: "history" } } }] }] }] };
async function open(dir) {
  at(dir);
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle(); draw(view);
  return { view, tree: view.role, root: () => draw(view) };
}

beforeEach(async () => {
  takers.clear(); state.shared.clear(); state.layout = LAYOUT;
  for (const k of ["runs", "overlays", "violations"]) state[k].length = 0;
  await changes(false);
});

test("a row's menu: Show changes, File history and Folder history only with Git Enhanced installed, and in a repository", async () => {
  const caps = { shell: true, zip: true, trash: "finder", write: true, os: "macos" };
  const file = { root: "/r", on: null, rel: "src/a.js", dir: false, found: null, caps, links: true, repo: { root: "/r", path: "src/a.js" }, mark: "M" };
  const ours = (p) => labels(p).filter((l) => ["Show changes", "File history", "Folder history"].includes(l));
  assert.deepEqual(ours(file), ["Show changes", "File history"]);
  const i = labels(file).indexOf("Show changes");
  assert.equal(labels(file)[i - 1], null, "a group of their own");
  assert.deepEqual(ours({ ...file, mark: null }), ["File history"], "no git mark: no changes to show");
  assert.deepEqual(ours({ ...file, rel: "src", dir: true, repo: { root: "/r", path: "src" } }), ["Folder history"]);
  assert.deepEqual(ours({ ...file, links: false }), [], "Git Enhanced not installed");
  assert.deepEqual(ours({ ...file, repo: null }), [], "not in a repository");
  assert.deepEqual(ours({ ...file, rel: "", dir: true, background: true }), [], "not on the folder's own menu");
  // A pick asks Git Enhanced and brings its page forward.
  const before = Date.now();
  items(file).find((x) => x?.label === "Show changes").run();
  const asked = state.shared.get(REVEAL.changes);
  assert.equal(REVEAL.changes, "git-enhanced.reveal");
  assert.deepEqual({ ...asked, at: 0 }, { at: 0, root: "/r", on: null, path: "src/a.js", page: "changes" });
  assert.ok(asked.at >= before);
  assert.deepEqual(state.runs, [["layout.select", { stack: "panel-body", child: "changes" }], ["layout.show", { id: "panel" }]]);
  state.runs.length = 0;
  items({ ...file, on: "vps" }).find((x) => x?.label === "File history").run();
  assert.deepEqual({ ...state.shared.get(REVEAL.changes), at: 0 }, { at: 0, root: "/r", on: "vps", path: "src/a.js", page: "history" });
  assert.deepEqual(state.runs[0], ["layout.select", { stack: "panel-body", child: "history" }]);
});

test("File history and Folder history in Herdr's own layout (no header, no History page): the Changes block comes forward", async () => {
  const caps = { shell: true, zip: true, trash: "finder", write: true, os: "macos" };
  const file = { root: "/r", on: null, rel: "src/a.js", dir: false, found: null, caps, links: true, repo: { root: "/r", path: "src/a.js" }, mark: "M" };
  const body = LAYOUT.children[1].children[0], { header, ...bare } = body;
  const shape = (stack) => ({ ...LAYOUT, children: [LAYOUT.children[0], { ...LAYOUT.children[1], children: [stack] }] });
  state.layout = shape({ ...bare, children: bare.children.filter((c) => c.id !== "history") });
  items(file).find((x) => x?.label === "File history").run();
  assert.deepEqual({ ...state.shared.get(REVEAL.changes), at: 0 }, { at: 0, root: "/r", on: null, path: "src/a.js", page: "history" });
  assert.deepEqual(state.runs, [["layout.select", { stack: "panel-body", child: "changes" }], ["layout.show", { id: "panel" }]]);
  state.runs.length = 0;
  items({ ...file, rel: "src", dir: true, repo: { root: "/r", path: "src" } }).find((x) => x?.label === "Folder history").run();
  assert.equal(state.shared.get(REVEAL.changes).path, "src");
  assert.deepEqual(state.runs, [["layout.select", { stack: "panel-body", child: "changes" }], ["layout.show", { id: "panel" }]]);
  // Our header over a stack without a History page: its Changes block has no switch; nothing to bring.
  state.runs.length = 0;
  state.layout = shape({ ...body, children: bare.children.filter((c) => c.id !== "history") });
  items(file).find((x) => x?.label === "File history").run();
  assert.deepEqual(state.runs, []);
});

test("the tree hands its menus the row's repository, its mark and whether Git Enhanced is installed", async () => {
  const dir = folder(["top.txt", "src/a.js", "lib/b.js"]);
  git(dir, "init", "-q"); git(dir, "add", "top.txt", "src"); git(dir, "commit", "-qm", "one");
  git(join(dir, "lib"), "init", "-q"); git(join(dir, "lib"), "add", "-A"); git(join(dir, "lib"), "commit", "-qm", "lib");
  writeFileSync(join(dir, "src/a.js"), "changed\n");
  let { tree } = await open(join(dir, "src"));
  assert.equal(tree.target("a.js", false).links, false, "Git Enhanced not installed");
  await changes(true);
  ({ tree } = await open(join(dir, "src")));
  // The shown folder is inside its repository: paths from the repository's folder.
  assert.deepEqual(tree.target("a.js", false), { ...tree.target("a.js", false), links: true, repo: { root: dir, path: "src/a.js" }, mark: "M" });
  ({ tree } = await open(dir));
  assert.deepEqual(tree.target("lib/b.js", false).repo, { root: join(dir, "lib"), path: "b.js" }, "a nested repository's own");
  assert.deepEqual(tree.target("lib", true).repo, { root: join(dir, "lib"), path: "" }, "its folder: the whole repository");
  assert.equal(tree.target("lib/b.js", false).mark, null);
  assert.equal(tree.target("", true, true).repo, null, "the background: no row");
  assert.deepEqual(state.violations, []);
});

test("a row's right-click menu gets the row's repository and mark: Show changes and File history show", async () => {
  // The menu was opened with the shown folder's own target, so a row's repository and mark were
  // missing and the cross links never showed on a row.
  const dir = folder(["a.txt", "b.txt"]);
  git(dir, "init", "-q"); git(dir, "add", "-A"); git(dir, "commit", "-qm", "one");
  writeFileSync(join(dir, "a.txt"), "changed\n");
  await changes(true);
  const { tree, root } = await open(dir);
  state.overlays.length = 0;
  tree.rightClick("a.txt", false, makeCx());
  const menu = state.overlays.at(-1).props;
  assert.deepEqual([menu.rel, menu.dir, menu.background], ["a.txt", false, false]);
  assert.deepEqual(menu.repo, { root: dir, path: "a.txt" });
  assert.equal(menu.mark, "M");
  assert.ok(labels(menu).includes("Show changes") && labels(menu).includes("File history"), labels(menu).join(", "));
  tree.rightClick("b.txt", false, makeCx());
  assert.deepEqual(labels(state.overlays.at(-1).props).filter((l) => ["Show changes", "File history"].includes(l)), ["File history"], "unchanged: no changes to show");
  tree.backgroundMenu();
  const bg = state.overlays.at(-1).props;
  assert.equal(bg.repo, null, "the folder's own menu: no row");
  assert.equal(bg.background, true);
  root();
  assert.deepEqual(state.violations, []);
});

test("files-enhanced.reveal: the tree holding the path opens down to it, selects it and comes forward", async () => {
  const dir = folder(["a.txt", "src/deep/x.txt", "src/y.txt"]);
  const { tree, root } = await open(dir);
  assert.equal(tree.folders.size, 0);
  state.runs.length = 0;
  state.shared.set(REVEAL.files, { at: Date.now(), full: join(dir, "src/deep/x.txt"), on: null });
  root(); await settle(); root(); await settle(); root();
  assert.equal(tree.sel, "src/deep/x.txt");
  assert.ok(tree.folders.has("src") && tree.folders.has("src/deep"), [...tree.folders].join(" "));
  assert.deepEqual(state.runs.slice(0, 2), [["layout.select", { stack: "panel-body", child: "files" }], ["layout.show", { id: "panel" }]]);
  // Seen once: the same request again does nothing; an old one (another session's) is let go.
  tree.sel = "a.txt"; root(); await settle();
  assert.equal(tree.sel, "a.txt");
  state.shared.set(REVEAL.files, { at: Date.now() - 60000, full: join(dir, "src/y.txt"), on: null });
  root(); await settle(); root();
  assert.equal(tree.sel, "a.txt", "too old");
  // On another machine: not this tree's.
  state.shared.set(REVEAL.files, { at: Date.now(), full: join(dir, "src/y.txt"), on: "vps" });
  root(); await settle(); root();
  assert.notEqual(tree.sel, "src/y.txt");
  assert.deepEqual(state.violations, []);
});

test("files-enhanced.reveal outside the shown folder: the folder both share is pinned for the space, then the path shows", async () => {
  const dir = folder(["README.md", "src/a.js"]);
  const { tree, root } = await open(join(dir, "src"));
  assert.equal(tree.root, join(dir, "src"));
  state.shared.set(REVEAL.files, { at: Date.now(), full: join(dir, "README.md"), on: null });
  root(); await settle(); root(); await settle(); root(); await settle(); root();
  assert.deepEqual(state.shared.get(`${NAME}.pins`), { s1: { path: dir, on: null } });
  assert.equal(tree.root, dir);
  assert.equal(tree.sel, "README.md");
  assert.deepEqual(state.violations, []);
});
