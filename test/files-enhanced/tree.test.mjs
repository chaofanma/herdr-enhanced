// The tree (main.js) rendered with stubbed Herdr modules against real temp folders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { utimesSync, readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { state, makeCx, settle, load, folder, at, draw, byId, allById, press, text, walk } from "./render/load.mjs";
import { NAME } from "./mod.mjs";
const { DETACH } = await load("detach.js");

const { default: Files } = await load("main.js");

// A tree on dir, loaded and drawn; returns { view, tree, root() } where root() draws again.
async function open(dir) {
  at(dir);
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle();
  return { view, tree: view.role, root: () => draw(view) };
}
// The tree's rows as drawn, by path.
const shownRows = root => allById(root, /^file-/).map(n => n.$.id.slice(5));
const color = node => node.$.calls.filter(([m]) => m === "text_color").map(([, a]) => a[0]).at(-1) ?? null;
const files = settingsValue => state.shared.set("files-enhanced.settings", settingsValue);
const git = (dir, ...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, stdio: "pipe" });
const detections = () => state.execLog.filter(([c, a]) => c === "sh" && /command -v "\$c"/.test(a?.[1] ?? "") && /cli \$c/.test(a?.[1] ?? "")).length;
// What the tree found of the Open with programs: the same here and on its machine.
const foundHere = (...cli) => { const f = { cli: new Set(cli), app: new Set() }; return { here: f, there: f }; };

test("Open with: found once per copy, again when the items change; menus get what was found", async () => {
  state.shared.clear(); state.execLog.length = 0; state.overlays.length = 0;
  const dir = folder(["a.txt", "src/b.js"]);
  const { tree, root } = await open(dir);
  root(); root();
  assert.equal(detections(), 1);
  state.shared.set("herdr-enhanced.open-with", { items: [{ id: "mine", name: "Mine", kind: "app", for: "files", argv: ["sh", "{file}"] }] });
  root(); await settle(); root();
  assert.equal(detections(), 2);
  assert.ok(tree.found.here.cli.has("sh"));
  press(byId(root(), "file-a.txt"), "on_mouse_down", { button: "right", modifiers: {} });
  const menu = state.overlays.at(-1);
  assert.equal(menu.props.role, "menu");
  assert.ok(menu.props.found.here.cli.includes("sh"));
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
  state.shared.clear();
});

test("a double-click opens a file the way settings.double says", async () => {
  state.shared.clear(); state.execLog.length = 0;
  const dir = folder(["a.txt"]);
  const { tree, root } = await open(dir);
  state.execHook = (command) => (command === "sh" || command === "git" ? null : { code: 0, stdout: "", stderr: "" });
  press(byId(root(), "file-a.txt"), "on_click", { click_count: 2, modifiers: {} });
  await settle();
  assert.deepEqual(state.execLog.at(-1).slice(0, 2), ["open", [`${dir}/a.txt`]]);
  tree.found = foundHere("zed");
  state.shared.set("herdr-enhanced.open-with", { double: "zed" });
  press(byId(root(), "file-a.txt"), "on_click", { click_count: 2, modifiers: {} });
  await settle();
  assert.deepEqual(state.execLog.at(-1).slice(0, 3), ["sh", ["-c", DETACH, "sh", "zed", `${dir}/a.txt`], dir]);
  state.execHook = null; state.shared.clear();
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});

test("Files settings: hidden, exclude, sort and foldersFirst apply at once", async () => {
  state.shared.clear();
  const dir = folder([".env", "b10.txt", "B2.md", "a.log", "zeta/x", "Alpha/y", "dist/z"]);
  const { root } = await open(dir);
  assert.deepEqual(shownRows(root()), ["Alpha", "dist", "zeta", ".env", "a.log", "B2.md", "b10.txt"]);
  files({ hidden: false, exclude: ["dist", "*.log"] });
  assert.deepEqual(shownRows(root()), ["Alpha", "zeta", "B2.md", "b10.txt"]);
  files({ sort: "type", foldersFirst: false });
  assert.deepEqual(shownRows(root()), [".env", "Alpha", "dist", "zeta", "a.log", "B2.md", "b10.txt"]);
  // Modified: newest first, which takes a stat (a refresh).
  const t = Date.now() / 1000;
  utimesSync(`${dir}/a.log`, t - 10, t - 10); utimesSync(`${dir}/b10.txt`, t - 1000, t - 1000); utimesSync(`${dir}/B2.md`, t - 100, t - 100); utimesSync(`${dir}/.env`, t - 5000, t - 5000);
  files({ sort: "modified" });
  root(); await settle();
  assert.deepEqual(shownRows(root()).slice(3), ["a.log", "B2.md", "b10.txt", ".env"]);
  state.shared.clear();
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});

test("Files settings: git-ignored entries shown, dimmed or hidden", async () => {
  state.shared.clear();
  const dir = folder([".gitignore", "a.log", "build/out.js", "src/a.js", "src/b.log"]);
  execFileSync("sh", ["-c", "printf '*.log\\nbuild/\\n' > .gitignore"], { cwd: dir });
  git(dir, "init", "-q"); git(dir, "add", ".gitignore", "src/a.js"); git(dir, "commit", "-qm", "x");
  const { tree, root } = await open(dir);
  assert.deepEqual(shownRows(root()), ["build", "src", ".gitignore", "a.log"]);
  files({ ignored: "dim" });
  root(); await settle();
  assert.ok(tree.ignored.has("a.log") && tree.ignored.has("build"), [...tree.ignored].join());
  const label = path => [...allById(root(), new RegExp(`^file-${path}$`))][0].$.children.find(c => c?.$ && text(c) === path.split("/").pop());
  assert.equal(color(label("a.log")), "muted");
  assert.equal(color(label("src")), null);
  files({ ignored: "hide" });
  assert.deepEqual(shownRows(root()), ["src", ".gitignore"]);
  // A file changed just now gets the fresh dot, unless settings.freshMinutes is 0.
  execFileSync("sh", ["-c", "echo more >> src/a.js"], { cwd: dir });
  tree.refresh(makeCx()); await settle();
  press(byId(root(), "file-src")); await settle();
  const dot = () => [...allById(root(), /^file-src\/a\.js$/)][0].$.children.some(c => c?.$?.calls.some(([m, a]) => m === "size" && a[0] === 6));
  assert.equal(dot(), true);
  files({ ignored: "hide", freshMinutes: 0 });
  assert.equal(dot(), false);
  state.shared.clear();
  root(); await settle();
  assert.deepEqual(shownRows(root()), ["build", "src", "src/a.js", "src/b.log", ".gitignore", "a.log"]);
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});

test("Files settings: follow off keeps the root until the roots popup or a pin changes it", async () => {
  state.shared.clear();
  const one = folder(["one.txt"]), two = folder(["two.txt"]);
  files({ follow: false });
  const { tree, root } = await open(one);
  at(two); root(); await settle(); root();
  assert.equal(tree.root, one, "the terminal moved; the tree stayed");
  // The roots popup's "Terminal's folder".
  state.shared.set(`${NAME}.refollow`, { space: "s1", t: 1 });
  root(); await settle(); root();
  assert.equal(tree.root, two);
  // Following again: the terminal's folder.
  files({});
  at(one); root(); await settle(); root();
  assert.equal(tree.root, one);
  state.shared.clear();
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});

test("Files settings: Markdown opens as source, code wraps", async () => {
  state.shared.clear();
  const dir = folder(["notes.md", "code.js"]);
  files({ markdown: "source", wrap: true });
  const { tree, root } = await open(dir);
  press(byId(root(), "file-notes.md")); await settle();
  assert.equal(tree.preview.source, true);
  assert.equal(byId(root(), /^fm-md-/), null, "no rendered Markdown");
  press(byId(root(), "file-code.js")); await settle();
  assert.equal(tree.preview.code.opts.soft_wrap, true);
  files({ markdown: "source", wrap: false });
  root(); await settle(); root();
  assert.equal(tree.preview.code.opts.soft_wrap, false, "rewrapped after the render");
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
  state.shared.clear();
});

const cmdClick = { click_count: 1, modifiers: { platform: true } }, shiftClick = { click_count: 1, modifiers: { shift: true } };
const selectedRows = root => allById(root, /^file-/).filter(n => n.$.calls.some(([m, a]) => m === "bg" && a[0] === "selected")).map(n => n.$.id.slice(5));
const keyDown = (root, keystroke) => press(byId(root, "files-tree"), "on_key_down", { key: keystroke.split("-").pop(), keystroke, modifiers: {} });

test("several rows: ⌘-click toggles, Shift-click takes the range, Esc goes back to one", async () => {
  state.shared.clear(); state.overlays.length = 0;
  const dir = folder(["a.txt", "b.txt", "c.txt", "d.txt", "src/e.js"]);
  const { tree, root } = await open(dir);
  press(byId(root(), "file-a.txt")); await settle();
  assert.deepEqual(selectedRows(root()), ["a.txt"]);
  press(byId(root(), "file-c.txt"), "on_click", cmdClick);
  assert.deepEqual(selectedRows(root()), ["a.txt", "c.txt"]);
  assert.equal(tree.preview.file, "a.txt", "a ⌘-click doesn't preview");
  press(byId(root(), "file-src"), "on_click", shiftClick);
  assert.deepEqual(selectedRows(root()), ["src", "a.txt", "b.txt", "c.txt"], "from c (the last ⌘-click) up to src");
  assert.equal(tree.folders.has("src"), false, "a Shift-click doesn't open a folder");
  // A right-click on one of them: one menu for all.
  press(byId(root(), "file-b.txt"), "on_mouse_down", { button: "right", modifiers: {} });
  const menu = state.overlays.at(-1).props;
  assert.deepEqual(menu.batch.map(b => b.rel), ["src", "a.txt", "b.txt", "c.txt"]);
  assert.equal(menu.batch[0].dir, true);
  // Del: one dialog for the four.
  keyDown(root(), "delete");
  assert.equal(state.overlays.at(-1).props.action, "delete");
  assert.equal(state.overlays.at(-1).props.items.length, 4);
  // Esc: back to the last clicked row.
  keyDown(root(), "escape");
  assert.deepEqual(selectedRows(root()), ["src"]);
  assert.ok(tree.preview.file, "the first Esc kept the preview");
  // A right-click elsewhere selects that row alone and gets its own menu.
  press(byId(root(), "file-c.txt"), "on_click", cmdClick);
  press(byId(root(), "file-d.txt"), "on_mouse_down", { button: "right", modifiers: {} });
  assert.equal(state.overlays.at(-1).props.rel, "d.txt");
  assert.deepEqual(selectedRows(root()), ["d.txt"]);
  // A key move: one row again.
  press(byId(root(), "file-a.txt"), "on_click", cmdClick);
  keyDown(root(), "down");
  assert.equal(selectedRows(root()).length, 1);
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});

test("the dialog for several: lists them, deletes each, keeps the ones that failed", async () => {
  const dir = folder(["a.txt", "b.txt", "c.txt"]);
  state.props = { role: "dialog", action: "delete", root: dir, on: null, items: ["a.txt", "b.txt", "c.txt"].map(rel => ({ rel, dir: false })), overlay: "o9" };
  const view = new Files(); view.init({}, makeCx()); await settle();
  assert.deepEqual([...walk(draw(view))].filter(n => n.$.kind === "div" && n.$.calls.some(([m, a]) => m === "h" && a[0] === 16)).map(text), ["a.txt", "b.txt", "c.txt"]);
  state.execLog.length = 0;
  state.execHook = (c, args) => (c === "osascript" ? (args[1].includes("b.txt") ? { code: 1, stdout: "", stderr: "0:85: execution error: Finder got an error (-10000)" } : { code: 0, stdout: "", stderr: "" }) : null);
  press(byId(draw(view), "fm-ok")); await settle();
  assert.equal(state.execLog.filter(([c]) => c === "osascript").length, 3, "each one tried");
  assert.deepEqual(view.role.part.left.map(x => x.rel), ["b.txt"]);
  assert.match(view.role.part.error, /1 couldn't be deleted: Finder got an error/);
  state.execHook = null; state.props = {};
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});

test("Compress: Archive.zip for several, the item's name for one, never over a file", async () => {
  const dir = folder(["src/a.txt", "src/b.txt", "src/sub/c.txt"]);
  const make = async items => {
    state.props = { role: "dialog", action: "compress", root: dir, on: null, items, overlay: "o9" };
    const view = new Files(); view.init({}, makeCx()); await settle();
    return view;
  };
  let view = await make([{ rel: "src/a.txt", dir: false }, { rel: "src/sub", dir: true }]);
  assert.equal(view.role.part.input.value(), "Archive.zip");
  press(byId(draw(view), "fm-ok")); await settle();
  assert.equal(view.role.part.error ?? null, null);
  const list = execFileSync("unzip", ["-Z1", `${dir}/src/Archive.zip`], { encoding: "utf8" }).trim().split("\n").sort();
  assert.deepEqual(list, ["a.txt", "sub/", "sub/c.txt"]);
  view = await make([{ rel: "src/a.txt", dir: false }, { rel: "src/b.txt", dir: false }]);
  assert.equal(view.role.part.input.value(), "Archive 2.zip");
  view = await make([{ rel: "src/sub", dir: true }]);
  assert.equal(view.role.part.input.value(), "sub.zip");
  view.role.part.input.set_value("Archive.zip");
  press(byId(draw(view), "fm-ok")); await settle();
  assert.match(view.role.part.error, /already exists/);
  state.props = {};
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});

test("⌘C / ⌘X / ⌘V: copies get new names, a cut moves and empties the clipboard, nothing is written over", async () => {
  state.shared.clear(); state.notes.length = 0;
  const dir = folder(["a.txt", "b.txt", "docs/a.txt", "docs/keep.md"]);
  const { tree, root } = await open(dir);
  const done = async () => { await settle(); root(); await settle(); root(); };
  press(byId(root(), "file-a.txt"));
  keyDown(root(), "cmd-c");
  assert.deepEqual(state.shared.get(`${NAME}.clipboard`).paths, [`${dir}/a.txt`]);
  // Into the folder of the selected file (the root): a copy where it came from.
  keyDown(root(), "cmd-v"); await done();
  // Into docs (selected), which has an a.txt: "a 2.txt"; docs/a.txt stays as it was.
  press(byId(root(), "file-docs")); await done();
  keyDown(root(), "cmd-v"); await done();
  assert.deepEqual(readdirSync(dir).sort(), ["a copy.txt", "a.txt", "b.txt", "docs"]);
  assert.deepEqual(readdirSync(`${dir}/docs`).sort(), ["a 2.txt", "a.txt", "keep.md"]);
  assert.equal(readFileSync(`${dir}/docs/a.txt`, "utf8"), "docs/a.txt");
  assert.deepEqual(shownRows(root()), ["docs", "docs/a 2.txt", "docs/a.txt", "docs/keep.md", "a copy.txt", "a.txt", "b.txt"]);
  assert.equal(tree.sel, "docs/a 2.txt", "the copy is selected");
  // Cut b.txt (drawn faded), paste into docs: moved, and the clipboard is empty again.
  press(byId(root(), "file-b.txt"));
  keyDown(root(), "cmd-x");
  assert.ok(byId(root(), "file-b.txt").$.calls.some(([m, a]) => m === "opacity" && a[0] === 0.5));
  press(byId(root(), "file-docs/keep.md")); await done();
  keyDown(root(), "cmd-v"); await done();
  assert.equal(existsSync(`${dir}/b.txt`), false);
  assert.equal(existsSync(`${dir}/docs/b.txt`), true);
  assert.equal(state.shared.get(`${NAME}.clipboard`), null);
  assert.equal(tree.sel, "docs/b.txt", "the moved file is selected");
  // A folder can't go into itself.
  press(byId(root(), "file-docs")); await done();
  keyDown(root(), "cmd-x");
  press(byId(root(), "file-docs"));  await done();
  keyDown(root(), "cmd-v"); await done();
  assert.equal(existsSync(`${dir}/docs/keep.md`), true);
  assert.match(state.notes.at(-1).body, /docs can't go into itself/);
  state.shared.clear();
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});

test("Duplicate and Move to", async () => {
  state.shared.clear(); state.overlays.length = 0;
  const dir = folder(["a.txt", "src/x.js", "src/deep/y.js", "lib/"]);
  const { items } = await load("menu.js");
  const p = { root: dir, on: null, rel: "a.txt", dir: false, found: null };
  await items(p).find(x => x?.label === "Duplicate").run(); await settle();
  await items(p).find(x => x?.label === "Duplicate").run(); await settle();
  assert.deepEqual(readdirSync(dir).sort(), ["a copy 2.txt", "a copy.txt", "a.txt", "lib", "src"]);
  // Move to…: src can't go into itself or its folders; lib can take it.
  state.props = { role: "moveto", root: dir, on: null, items: [{ rel: "src", dir: true }, { rel: "a.txt", dir: false }], overlay: "o5" };
  const view = new Files(); view.init({}, makeCx()); await settle();
  let r = draw(view);
  assert.deepEqual(allById(r, /^fm-mtr-/).map(n => n.$.id), ["fm-mtr-/", "fm-mtr-lib", "fm-mtr-src"]);
  assert.ok(byId(r, "fm-mtr-src").$.calls.some(([m]) => m === "opacity"), "src is faded");
  // Herdr makes a popup as tall as its content: a list that only fills the space left (flex_1) got
  // no height there (a menu like that shows as a thin line). The list has a height of its own.
  const list = byId(r, "fm-moveto-tree").$.calls.map(([m, a]) => [m, a[0]]);
  assert.ok(list.some(([m, v]) => m === "h" && v > 200), "the list has a fixed height");
  assert.ok(!list.some(([m]) => m === "flex_1"), "not only the space left");
  press(byId(r, "fm-mt-chev-src")); await settle(); r = draw(view);
  assert.ok(byId(r, "fm-mtr-src/deep"));
  press(byId(r, "fm-mtr-src/deep")); r = draw(view);
  assert.equal(byId(r, "fm-mt-ok").$.handlers.on_click, undefined, "Move is off for a folder inside src");
  press(byId(r, "fm-mtr-lib")); r = draw(view);
  assert.match(text(byId(r, "fm-mt-ok")), /Move to lib/);
  press(byId(r, "fm-mt-ok")); await settle();
  assert.deepEqual(readdirSync(`${dir}/lib`).sort(), ["a.txt", "src"]);
  assert.equal(existsSync(`${dir}/src`), false);
  state.props = {}; state.shared.clear();
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});

const typeQuery = async (tree, text) => { tree.search.input.set_value(text); await settle(); };
const csRows = root => allById(root, /^fm-cs-[fl]-/).map(n => n.$.id.slice(6));

test("Contents search: a tab inside a matched line shows as a space (a raw tab has no width on screen); the line's own text is kept", async () => {
  state.shared.clear();
  const dir = folder(["m.c"]);
  writeFileSync(`${dir}/m.c`, "#define NEEDLE\t1\n\tint\tneedle;\n");
  const { tree, root } = await open(dir);
  keyDown(root(), "cmd-shift-f");
  await typeQuery(tree, "needle"); root(); await settle();
  const lines = allById(root(), /^fm-cs-l-/);
  assert.deepEqual(lines.map(n => n.$.id), ["fm-cs-l-m.c:1", "fm-cs-l-m.c:2"]);
  // The line number, then the line: the leading tab trimmed, the others drawn as spaces.
  assert.deepEqual(lines.map(text), ["1#define NEEDLE 1", "2int needle;"]);
  assert.equal(tree.search.files[0].matches[1].text, "\tint\tneedle;", "replace still reads the line as it is");
  state.props = {}; state.shared.clear();
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});

test("Contents search: ⌘⇧F, results by file, a click previews, ↗ opens at the line", async () => {
  state.shared.clear(); state.execLog.length = 0;
  const dir = folder(["src/a.js", "src/b.js", "notes.md", ".hidden.txt"]);
  writeFileSync(`${dir}/src/a.js`, "const needle = 1;\n// Needle again\n"); writeFileSync(`${dir}/notes.md`, "no match here\n"); writeFileSync(`${dir}/.hidden.txt`, "needle\n");
  const { tree, root } = await open(dir);
  keyDown(root(), "cmd-shift-f");
  assert.equal(tree.search.mode, "contents");
  await typeQuery(tree, "needle"); root(); await settle();
  assert.deepEqual(csRows(root()), ["f-.hidden.txt", "l-.hidden.txt:1", "f-src/a.js", "l-src/a.js:1", "l-src/a.js:2"]);
  assert.match(text(root()), /3 matches in 2 files/);
  // Match case: "needle" no longer finds "Needle".
  press(byId(root(), "fm-so-matchCase-off")); await settle(); root(); await settle();
  assert.deepEqual(csRows(root()), ["f-.hidden.txt", "l-.hidden.txt:1", "f-src/a.js", "l-src/a.js:1"]);
  press(byId(root(), "fm-so-matchCase-on")); await settle();
  // Hidden files follow the Files setting.
  files({ hidden: false });
  tree.find(makeCx()); await settle();
  assert.deepEqual(csRows(root()), ["f-src/a.js", "l-src/a.js:1", "l-src/a.js:2"]);
  // A click on a line previews its file; ↗ opens it at the line (Open with's `line`, "system" here).
  press(byId(root(), "fm-cs-l-src/a.js:2")); await settle();
  assert.equal(tree.preview.file, "src/a.js");
  state.execHook = c => (c === "open" ? { code: 0, stdout: "", stderr: "" } : null);
  press(byId(root(), "fm-cs-open-src/a.js:2")); await settle();
  assert.deepEqual(state.execLog.at(-1).slice(0, 2), ["open", [`${dir}/src/a.js`]]);
  tree.found = foundHere("nvim");
  state.shared.set("herdr-enhanced.open-with", { line: "nvim" });
  press(byId(root(), "fm-cs-open-src/a.js:2"));
  assert.deepEqual(state.runs.at(-1), ["terminal.open", { argv: ["nvim", "+2", `${dir}/src/a.js`], folder: `${dir}/src`, place: "right", name: "a.js" }]);
  state.execHook = null;
  // A file row folds its lines; Names goes back to file names.
  press(byId(root(), "fm-cs-f-src/a.js"));
  assert.deepEqual(csRows(root()), ["f-src/a.js"]);
  press(byId(root(), "fm-sm-names")); await settle(); root(); await settle();
  assert.equal(tree.search.mode, "names");
  assert.equal(csRows(root()).length, 0);
  state.shared.clear();
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});

test("Replace: checked matches, a confirm, files changed since the search are skipped", async () => {
  state.shared.clear();
  const dir = folder(["a.txt", "b.txt", "c.txt"]);
  writeFileSync(`${dir}/a.txt`, "foo one\nfoo two\n"); writeFileSync(`${dir}/b.txt`, "a foo\n"); writeFileSync(`${dir}/c.txt`, "foo\n");
  const { tree, root } = await open(dir);
  tree.openSearch(makeCx(), "contents");
  await typeQuery(tree, "foo"); root(); await settle();
  press(byId(root(), /^fm-so-replace-/)); await settle(); root(); await settle();
  assert.ok(tree.search.texts, "the files were read for the replace");
  tree.search.replaceInput.set_value("bar");
  // Uncheck a.txt's second line and all of c.txt.
  press(byId(root(), "fm-cs-lx-a.txt:2-on"));
  press(byId(root(), "fm-cs-fx-c.txt-on"));
  assert.match(text(byId(root(), "fm-replace")), /Replace 2 in 2 files/);
  // b.txt changes after the search: skipped.
  writeFileSync(`${dir}/b.txt`, "a foo\nchanged\n");
  press(byId(root(), "fm-replace"));
  press(byId(root(), "fm-replace-yes")); await settle(); root(); await settle();
  assert.equal(readFileSync(`${dir}/a.txt`, "utf8"), "bar one\nfoo two\n");
  assert.equal(readFileSync(`${dir}/b.txt`, "utf8"), "a foo\nchanged\n");
  assert.equal(readFileSync(`${dir}/c.txt`, "utf8"), "foo\n");
  assert.equal(tree.search.done, "Replaced 1 in 1 file · 1 file changed since the search; skipped");
  assert.match(text(root()), /Replaced 1 in 1 file/);
  // A regex JavaScript can't read: Replace is off and says why.
  press(byId(root(), "fm-so-regex-off")); await typeQuery(tree, "(?i)foo"); root(); await settle();
  assert.match(text(root()), /JavaScript can't read this pattern/);
  assert.equal(byId(root(), "fm-replace").$.handlers.on_click, undefined);
  // Regex groups.
  await typeQuery(tree, "f(o+)"); root(); await settle(); root(); await settle();
  tree.search.replaceInput.set_value("<$1>");
  press(byId(root(), "fm-replace")); press(byId(root(), "fm-replace-yes")); await settle();
  assert.equal(readFileSync(`${dir}/c.txt`, "utf8"), "<oo>\n");
  state.shared.clear();
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});

test("Look: file-type icons, compact folders, nested files, breadcrumbs", async () => {
  state.shared.clear();
  const dir = folder(["src/main/java/App.java", "src/main/java/Util.java", "docs/guide.md", "package.json", "package-lock.json", "a.ts", "a.js", "a.d.ts", "README.md"]);
  const { tree, root } = await open(dir);
  const iconOf = row => [...walk(byId(root(), `file-${row}`))].find(n => n.$.kind === "image" || (n.$.kind === "svg" && !n.$.path.includes("chevron")))?.$;
  // Icons: Material's, by name; off: the plain glyphs.
  assert.equal(iconOf("a.ts").path, `mods/${NAME}/icons/typescript.svg`);
  assert.equal(iconOf("package.json").path, `mods/${NAME}/icons/nodejs.svg`);
  assert.equal(iconOf("docs").path, `mods/${NAME}/icons/folder-docs.svg`);
  // Compact: src holds only main, main only java: one row, the deepest folder.
  assert.deepEqual(shownRows(root()).slice(0, 2), ["docs", "src/main/java"]);
  assert.equal(text(byId(root(), "file-src/main/java")).includes("src/main/java"), true);
  press(byId(root(), "file-src/main/java")); await settle();
  assert.deepEqual(shownRows(root()).slice(0, 4), ["docs", "src/main/java", "src/main/java/App.java", "src/main/java/Util.java"]);
  assert.equal(iconOf("src/main/java").path, `mods/${NAME}/icons/folder-open.svg`, "java has no folder icon here: the open default");
  // ← from a file inside goes to the row; ← again closes it.
  press(byId(root(), "file-src/main/java/App.java")); await settle();
  keyDown(root(), "left");
  assert.equal(tree.sel, "src/main/java");
  // Nesting (off by default): the lock file under package.json, a.js and a.d.ts under a.ts.
  files({ nesting: true });
  assert.deepEqual(shownRows(root()).filter(r => !r.includes("/")), ["docs", "a.ts", "package.json", "README.md"]);
  press(byId(root(), "nest-a.ts"));
  assert.deepEqual(shownRows(root()).filter(r => !r.includes("/")), ["docs", "a.ts", "a.d.ts", "a.js", "package.json", "README.md"]);
  // Icons off: today's glyphs.
  files({ nesting: true, icons: false });
  assert.equal(iconOf("a.ts").path, `mods/${NAME}/file.svg`);
  // Compact off: the chain's first folder again.
  files({ compact: false });
  assert.deepEqual(shownRows(root()).slice(0, 2), ["docs", "src"]);
  files({});
  // Breadcrumbs: a folder in the preview's path is shown in the tree.
  press(byId(root(), "file-src/main/java/Util.java")); await settle();
  press(byId(root(), "file-src/main/java")); await settle();  // closed again
  assert.ok(byId(root(), "fm-crumb-src/main"));
  press(byId(root(), "fm-crumb-src/main")); await settle(); root();
  assert.equal(tree.sel, "src/main/java", "inside a chain: its row");
  assert.deepEqual(selectedRows(root()), ["src/main/java"]);
  press(byId(root(), "fm-crumb-src")); await settle();
  assert.deepEqual(text(byId(root(), "fm-crumbs")), "src›main›java›Util.java");
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
  state.shared.clear();
});

test("Keys: ⌘⌫ deletes the selection; while editing, j / k / h / l do nothing and the arrows move", async () => {
  state.shared.clear(); state.overlays.length = 0;
  const dir = folder(["a.txt", "b.txt", "c.txt"]);
  const { tree, root } = await open(dir);
  press(byId(root(), "file-a.txt")); await settle();
  press(byId(root(), "file-b.txt"), "on_click", cmdClick);
  keyDown(root(), "cmd-backspace");
  assert.deepEqual(state.overlays.at(-1).props.items.map(x => x.rel), ["a.txt", "b.txt"]);
  press(byId(root(), "file-c.txt")); await settle();
  keyDown(root(), "cmd-backspace");
  assert.equal(state.overlays.at(-1).props.rel, "c.txt");
  // Edit c.txt: the letters stay out of the tree, the arrows don't.
  press(byId(root(), "fm-edit"));
  assert.ok(tree.preview.edit);
  for (const k of ["k", "j", "h", "l"]) keyDown(root(), k);
  assert.equal(tree.sel, "c.txt");
  assert.ok(tree.preview.edit, "still editing");
  keyDown(root(), "up"); await settle();
  assert.equal(tree.sel, "b.txt");
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});

test("Several repositories: each file's mark from its own, a branch badge on each repository's folder", async () => {
  state.shared.clear();
  const dir = folder(["a/x.txt", "b/y.txt", "c/z.txt", "own/lib/inner.txt", "own/top.txt"]);
  for (const [r, files] of [["a", "."], ["b", "."], ["own", "top.txt"], ["own/lib", "."]]) {
    git(`${dir}/${r}`, "-c", "init.defaultBranch=main", "init", "-q");
    git(`${dir}/${r}`, "add", files); git(`${dir}/${r}`, "commit", "-qm", "x");
  }
  git(`${dir}/b`, "checkout", "-qb", "feature/two");
  writeFileSync(`${dir}/a/x.txt`, "changed"); writeFileSync(`${dir}/b/new.txt`, "new"); writeFileSync(`${dir}/own/lib/inner.txt`, "changed");
  // c isn't one: its .git holds only GitKraken's gk/ (a folder GitKraken leaves behind).
  mkdirSync(`${dir}/c/.git/gk`, { recursive: true }); writeFileSync(`${dir}/c/.git/gk/config`, "{}\n");
  // The root isn't a repository: a and b are found one folder down.
  const { tree, root } = await open(dir);
  root(); await settle(); root();
  assert.deepEqual([...tree.repos.entries()], [["a", "main"], ["b", "feature/two"], ["own", "main"]]);
  assert.equal(tree.marks["a/x.txt"], "M");
  assert.equal(tree.marks["b/new.txt"], "A");
  assert.equal(tree.marks["dir:a"], "M");
  assert.equal(tree.marks["own/lib/inner.txt"], undefined, "own/lib is two folders down: not looked for at repoDepth 1");
  const badge = row => text(byId(root(), `file-${row}`));
  assert.match(badge("a"), /main/); assert.match(badge("b"), /feature\/two/); assert.doesNotMatch(badge("c"), /main/);
  // The Git settings' repoDepth is Git Enhanced's own: Files doesn't follow it.
  state.shared.set("git-enhanced.settings", { repoDepth: 2 });
  root(); await settle(); root();
  assert.equal(tree.marks["own/lib/inner.txt"], undefined, "git-enhanced.settings repoDepth isn't Files'");
  // Files' repoDepth 2 finds own/lib, whose files come from its own status (own's says "lib/" is new).
  state.shared.set("files-enhanced.settings", { repoDepth: 2 });
  root(); await settle(); root();
  assert.equal(tree.marks["own/lib/inner.txt"], "M");
  assert.equal(tree.marks["own/lib"], "A", "own's line for the nested folder stays its own mark");
  // The Changed view lists them all.
  tree.changes = true;
  assert.deepEqual(allById(root(), /^chg-/).map(n => n.$.id.slice(4)).sort(), ["a/x.txt", "b/new.txt", "own/lib", "own/lib/inner.txt"]);
  tree.changes = false;
  // repoDepth 0: only the root's own (none here).
  state.shared.set("files-enhanced.settings", { repoDepth: 0 });
  root(); await settle(); root();
  assert.equal(tree.repo, false);
  assert.deepEqual(tree.marks, {});
  state.shared.clear();
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});
