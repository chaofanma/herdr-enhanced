// The mod in a space on another machine ("sim": the stubs run every exec here, so the remote code paths
// run for real against local folders), the remote Open with adapter, and whether the mod is on screen
// in any layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, symlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { state, makeCx, settle, load, folder, at, draw, byId, allById, press, text } from "./render/load.mjs";
import { NAME } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";

const { default: Files } = await load("main.js");
const M = await load("machine.js");
const R = await load("openwith.js");   // the remote forms and the host logic (shared); remote.js only asks Herdr for the target
const { shownIn } = await load("shown.js");
const { KNOWN } = await load("openwith.js");

async function open(dir, machine) {
  at(dir, machine);
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle();
  return { view, tree: view.role, root: () => draw(view) };
}
const shownRows = root => allById(root, /^file-/).map(n => n.$.id.slice(5));
const keyDown = (root, keystroke) => press(byId(root, "files-tree"), "on_key_down", { key: keystroke.split("-").pop(), keystroke, modifiers: {} });
const remoteExecs = () => state.execLog.filter(([, , , on]) => on === "sim");
const which = c => { const r = spawnSync("sh", ["-c", `command -v ${c}`], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; };
// A PATH like this one without the programs that move things to a Trash.
function noTrashPath() {
  const d = tempDir("files-enhanced-bin-"), seen = new Set();
  for (const dir of process.env.PATH.split(":")) {
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) if (!seen.has(n) && !["gio", "trash", "trash-put"].includes(n)) { seen.add(n); try { symlinkSync(join(dir, n), join(d, n)); } catch {} }
  }
  return d;
}

test("openwith.js on another machine: the ssh target, the editors that open files over ssh, terminal programs there", () => {
  const machines = [{ name: "vps", target: "me@10.0.0.7:2222", via: false }, { name: "fly", target: "fly ssh console -a x", via: true }, { name: "box", target: "box" }];
  assert.equal(R.hostIn(machines, "vps"), "me@10.0.0.7:2222");
  assert.equal(R.hostIn(machines, "fly"), null, "reached through a command, not ssh");
  assert.equal(R.hostIn(machines, "nope"), null);
  assert.equal(R.hasPort("me@h:2222"), true); assert.equal(R.hasPort("box"), false); assert.equal(R.hasPort("me@h"), false);
  const items = ["zed", "vscode", "typora", "nvim", "yazi"].map(id => ({ ...KNOWN.find(k => k.id === id), enabled: true }));
  const found = { here: { cli: new Set(["zed", "code"]), app: new Set(["Typora"]) }, there: { cli: new Set(["nvim"]), app: new Set() } };
  const labels = (dir, host) => R.remoteMenuItems(items, found, dir, host).map(m => m.label);
  assert.deepEqual(labels(false, "box"), ["Open in Zed", "Open in VS Code", "Open in Neovim"], "Typora can't open a file over ssh; yazi isn't there");
  assert.deepEqual(labels(false, "me@h:2222"), ["Open in Zed", "Open in Neovim"], "VS Code's ssh-remote+ takes no port");
  assert.deepEqual(labels(false, null), ["Open in Neovim"], "no ssh target: only what runs there");
  assert.deepEqual(R.remoteCommand(items[0], found, { path: "/srv/app/a.js", dir: false }, "me@h:2222"), { kind: "app", argv: ["zed", "ssh://me@h:2222/srv/app/a.js"], folder: null });
  assert.deepEqual(R.remoteCommand(items[1], found, { path: "/srv/app/a.js", dir: false, line: 9 }, "box").argv, ["code", "--remote", "ssh-remote+box", "-g", "/srv/app/a.js:9"]);
  assert.deepEqual(R.remoteCommand(items[3], found, { path: "/srv/app/a.js", dir: false, line: 9 }, null), { kind: "pane", argv: ["nvim", "+9", "/srv/app/a.js"], folder: "/srv/app" });
  assert.equal(R.remoteCommand(items[4], found, { path: "/srv", dir: true }, "box"), null);
  // An item that says how itself (what openwith.js would carry) wins over the table.
  assert.deepEqual(R.remoteForm({ id: "zed", remote: { argv: ["zed", "--x", "{path}"] } }).argv, ["zed", "--x", "{path}"]);
});

test("shownIn: Herdr's own layout, herdr-t3's panel, a floating block, no block at all", () => {
  const main = panelActive => ({ id: "root", type: "row", children: [
    { id: "sidebar", type: "column", children: [{ id: "spaces", type: "block", content: { mod: "spaces" } }] },
    { id: "work", type: "column", children: [{ id: "work-body", type: "row", children: [
      { id: "main", type: "block", content: { tab: "active" } },
      { id: "panel", type: "column", hidden: panelActive === null, children: [{ id: "panel-body", type: "stack", active: panelActive ?? "files", children: [
        { id: "files", type: "block", content: { mod: NAME } }, { id: "changes", type: "block", content: { mod: "changes" } }] }] }] }] }] });
  assert.equal(shownIn(main("files"), NAME), true);
  assert.equal(shownIn(main("changes"), NAME), false, "the other page of the panel");
  assert.equal(shownIn(main(null), NAME), false, "the panel is hidden");
  // herdr-t3's panel with the tab header this mod draws: the header isn't the tree.
  const t3 = (active) => ({ id: "root", type: "row", children: [{ id: "panel", type: "column", children: [{ id: "panel-body", type: "stack", active,
    header: { content: { mod: NAME, props: { role: "tabs", stack: "panel-body" } }, height: 34 },
    children: [{ id: "files", title: "Files", type: "block", content: { mod: NAME } }, { id: "changes", type: "block", content: { mod: "git-enhanced" } }] }] }] });
  assert.equal(shownIn(t3("files"), NAME), true);
  assert.equal(shownIn(t3("changes"), NAME), false, "Changes shown under this mod's header");
  assert.equal(shownIn({ id: "root", type: "row", children: [{ id: "h", type: "block", content: { mod: NAME, props: { role: "tabs" } } }] }, NAME), null, "a header alone: no tree in the layout");
  assert.equal(shownIn({ id: "root", type: "stack", children: [{ id: "a", type: "block", content: { mod: "x" } }, { id: "b", type: "block", content: { mod: NAME } }] }, NAME), false, "a stack without active shows its first child");
  assert.equal(shownIn({ id: "root", type: "row", children: [], floating: [{ id: "f", content: { mod: NAME } }] }, NAME), true);
  assert.equal(shownIn({ id: "root", type: "row", children: [{ id: "a", type: "block", content: { mod: "files" } }] }, NAME), null, "not in the layout: a pane or a window");
  assert.equal(shownIn(null, NAME), null);
});

test("a space on another machine: listed, previewed, edited and saved there, polled, its menus", async () => {
  state.shared.clear(); state.execLog.length = 0; state.watched.length = 0; state.writes.length = 0; state.overlays.length = 0; state.notes.length = 0;
  M.forget();
  const dir = folder(["src/a.js", "notes.md", "pic.png", "lib/one/two/deep.txt"]);
  writeFileSync(join(dir, "src/a.js"), "const a = 1;\n");
  writeFileSync(join(dir, "pic.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]));
  const { tree, root } = await open(dir, "sim");
  assert.equal(tree.on, "sim");
  assert.deepEqual(shownRows(root()), ["lib/one/two", "src", "notes.md", "pic.png"], "listed there, the chain compacted");
  assert.ok(remoteExecs().some(([c, a]) => c === "sh" && a[1] === M.LIST), "LIST ran there");
  assert.deepEqual(state.watched, [], "no watchFolder for another machine");
  assert.match(text(byId(root(), "fm-root")), /sim/, "the header names the machine");
  // Preview and edit: the save goes as base64 through WRITE, not writeTextFile.
  press(byId(root(), "file-src")); await settle();
  press(byId(root(), "file-src/a.js")); await settle();
  assert.equal(tree.preview.text, "const a = 1;\n");
  press(byId(root(), "fm-edit"));
  assert.ok(tree.preview.edit, "editing there");
  tree.preview.code.set_value("const a = 2;\n");
  tree.preview.edit.dirty = true;
  press(byId(root(), "fm-save")); await settle();
  assert.equal(readFileSync(join(dir, "src/a.js"), "utf8"), "const a = 2;\n");
  assert.deepEqual(state.writes, []);
  assert.ok(remoteExecs().some(([c, a]) => c === "sh" && a[1] === M.WRITE));
  // Changed on disk meanwhile: the next save says so.
  writeFileSync(join(dir, "src/a.js"), "someone else\n");
  tree.preview.code.set_value("mine\n"); tree.preview.edit.dirty = true;
  press(byId(root(), "fm-save")); await settle();
  assert.equal(tree.preview.edit.conflict, true);
  assert.equal(readFileSync(join(dir, "src/a.js"), "utf8"), "someone else\n");
  press(byId(root(), "fm-overwrite")); await settle();
  assert.equal(readFileSync(join(dir, "src/a.js"), "utf8"), "mine\n");
  press(byId(root(), "fm-edit")); await settle();       // Done
  // The poll: a new file there shows without a watch.
  tree.pollOnce(makeCx()); await settle();
  writeFileSync(join(dir, "src/new.txt"), "n");
  const before = state.execLog.length;
  tree.pollOnce(makeCx()); await settle();
  assert.ok(state.execLog.slice(before).some(([c, a, , on]) => on === "sim" && a[1] === M.INFO), "one INFO there");
  assert.ok(state.execLog.slice(before).some(([c, a, , on]) => on === "sim" && a[1] === M.LIST), "then the listing again");
  root(); await settle();
  assert.ok(shownRows(root()).includes("src/new.txt"), "a change there reloaded the tree");
  const quiet = state.execLog.length;
  tree.pollOnce(makeCx()); await settle();
  assert.equal(state.execLog.slice(quiet).filter(([, a]) => a[1] === M.LIST).length, 0, "nothing changed: no listing");
  state.layout = { id: "root", type: "stack", active: "other", children: [{ id: "other", type: "block", content: { mod: "x" } }, { id: "files", type: "block", content: { mod: NAME } }] };
  const hidden = state.execLog.length, every10 = state.everies.filter(e => e.ms === 10000).at(-1).fn;
  tree.pollOnce(makeCx()); await settle();
  every10(makeCx()); await settle();
  assert.equal(state.execLog.length, hidden, "not on screen: no look, and the 10-second refresh waits");
  assert.equal(tree.stale, true);
  state.layout = null;
  root(); await settle();
  assert.ok(state.execLog.slice(hidden).some(([, a]) => a[1] === M.LIST), "shown again: refreshed");
  assert.equal(tree.stale, false);
  // An image there: fetched into the app's cache.
  press(byId(root(), "file-pic.png")); await settle();
  assert.match(tree.preview.image, new RegExp(`^cache/${NAME}/[0-9a-f]{16}\\.png$`));
  // The menu: no Open or Reveal, Delete for good where there's no Trash.
  state.path = noTrashPath(); M.forget(); await M.facts("sim");
  press(byId(root(), "file-notes.md"), "on_mouse_down", { button: "right", modifiers: {} });
  const { items } = await load("menu.js"), labels = items(state.overlays.at(-1).props).map(x => x?.label ?? null);
  assert.equal(labels.includes("Open") || labels.some(l => /Finder/.test(l ?? "")), false);
  assert.ok(labels.includes("Delete permanently") && labels.includes("Compress…") && labels.includes("Duplicate"));
  // Drops from this computer can't go there.
  press(byId(root(), "files-tree"), "on_drop", { paths: ["/tmp/x"] });
  assert.match(state.notes.at(-1).title, /Can't copy files there/);
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
  state.path = null; M.forget(); state.shared.clear();
});

test("another machine: paste, Delete (for good there), Replace, all through sh there", async () => {
  state.shared.clear(); state.writes.length = 0; state.notes.length = 0;
  state.path = noTrashPath(); M.forget();
  const dir = folder(["a.txt", "docs/keep.md", "c.txt"]);
  writeFileSync(join(dir, "a.txt"), "foo here\n"); writeFileSync(join(dir, "c.txt"), "foo too\n");
  const { tree, root } = await open(dir, "sim");
  const done = async () => { await settle(); root(); await settle(); root(); };
  press(byId(root(), "file-a.txt"));
  keyDown(root(), "cmd-c");
  assert.equal(state.shared.get(`${NAME}.clipboard`).on, "sim");
  press(byId(root(), "file-docs")); await done();
  keyDown(root(), "cmd-v"); await done();
  assert.deepEqual(readdirSync(join(dir, "docs")).sort(), ["a.txt", "keep.md"]);
  assert.equal(tree.sel, "docs/a.txt", "the copy is selected");
  // Delete: the dialog says it's for good, and it is.
  press(byId(root(), "file-c.txt")); await settle();
  keyDown(root(), "delete");
  const ask = state.overlays.at(-1);
  assert.equal(ask.props.caps.trash, null);
  state.props = { ...ask.props, overlay: "o9" };
  const dialog = new Files(); dialog.init({}, makeCx()); await settle();
  assert.match(text(draw(dialog)), /Permanently delete: c\.txt\?/);
  press(byId(draw(dialog), "fm-ok")); await settle();
  assert.equal(existsSync(join(dir, "c.txt")), false);
  state.props = {};
  // Replace there.
  await done();
  tree.openSearch(makeCx(), "contents");
  tree.search.input.set_value("foo"); await settle(); root(); await settle();
  press(byId(root(), /^fm-so-replace-/)); await settle(); root(); await settle();
  tree.search.replaceInput.set_value("bar");
  press(byId(root(), "fm-replace")); press(byId(root(), "fm-replace-yes")); await settle();
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "bar here\n");
  assert.equal(readFileSync(join(dir, "docs/a.txt"), "utf8"), "bar here\n");
  assert.deepEqual(state.writes, [], "saved with WRITE there, not writeTextFile");
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
  state.path = null; M.forget(); state.shared.clear();
});

test("the dialogs: Rename picks the stem, a change of case, a new file in a new folder", async () => {
  state.shared.clear(); M.forget();
  const dir = folder(["notes.final.md", "src/"]);
  const dialog = async p => { state.props = { role: "dialog", root: dir, on: null, overlay: "o1", ...p }; const v = new Files(); v.init({}, makeCx()); await settle(); return v; };
  let v = await dialog({ action: "rename", rel: "notes.final.md", dir: false });
  assert.deepEqual(v.role.part.input.range, { start: 0, end: "notes.final".length });
  v.role.part.input.set_value("Notes.final.md");
  press(byId(draw(v), "fm-ok")); await settle();
  assert.ok(readdirSync(dir).includes("Notes.final.md"), readdirSync(dir).join());
  assert.equal(state.shared.get(`${NAME}.changed`).select, join(dir, "Notes.final.md"));
  v = await dialog({ action: "rename", rel: "src", dir: true });
  assert.deepEqual(v.role.part.input.range, { start: 0, end: 3 }, "a folder: the whole name");
  state.execLog.length = 0;
  press(byId(draw(v), "fm-ok")); await settle();
  assert.equal(state.execLog.length, 0, "the same name: nothing to do");
  v = await dialog({ action: "newfile", rel: "src", dir: true });
  v.role.part.input.set_value("deep/er/x.txt");
  press(byId(draw(v), "fm-ok")); await settle();
  assert.ok(existsSync(join(dir, "src/deep/er/x.txt")));
  v = await dialog({ action: "newfile", rel: "src", dir: true });
  v.role.part.input.set_value("deep/er/x.txt");
  press(byId(draw(v), "fm-ok")); await settle();
  assert.match(v.role.part.error, /x\.txt already exists/);
  v = await dialog({ action: "newfolder", rel: "", dir: true });
  v.role.part.input.set_value("made");
  press(byId(draw(v), "fm-ok")); await settle();
  assert.ok(existsSync(join(dir, "made")));
  state.props = {};
  assert.equal(state.violations.length, 0, state.violations.join("\n"));
});
