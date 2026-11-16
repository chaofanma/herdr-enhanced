// Every page and state of Files Enhanced the other tests reach, drawn in each of the six themes Herdr
// 0.1.14 ships (test/shared/themes.json: the stubs' theme() is that palette, settings().dark its
// appearance), read by test/shared/themecheck.mjs: only the theme's colors, and text that reads on
// what it is drawn on. Each state is a copy of its own, set up once; each theme draws them all.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { state, stubs, makeCx, settle, load, folder, at, draw, byId, press } from "./render/load.mjs";
import { MOD } from "./mod.mjs";
import { THEMES, themeTests, setSources } from "../shared/themecheck.mjs";

const { default: Files } = await load("main.js");
const { checks } = await load("repotrust.js");
setSources(MOD);

const git = (dir, ...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, stdio: "pipe" });
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 3, 8, 2, 0, 0, 0]);
const keyDown = (root, keystroke) => press(byId(root, "files-tree"), "on_key_down", { key: keystroke.split("-").pop(), keystroke, modifiers: {} });

// What each theme draws: { name, draw: () => tree }.
const scenes = [];
// The tree follows the focused terminal: each state is drawn where it was set up, with its props.
// What a render starts (a view made again for the theme) is let finish, and drawn again, as Herdr
// would draw the next frame.
const scene = (name, view, props = state.props) => {
  const at = { spaces: state.spaces, panes: state.panes, focused: state.focused };
  scenes.push({ name, draw: async () => {
    const saved = state.props, once = () => { Object.assign(state, at); state.props = props; try { return draw(view); } finally { state.props = saved; } };
    const started = state.tasks.length, tree = once();
    if (state.tasks.length === started) return tree;
    await settle();
    return once();
  } });
};
// A copy of the mod with `props` (the tree when there are none), in `dir`, after its first looks.
async function copy(dir, props = {}) {
  if (dir) at(dir);
  state.props = props;
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle(); draw(view); await settle();
  return view;
}
// An overlay the tree opened, as Herdr opens it.
const opened = async (name) => { const spec = state.overlays.at(-1); const v = await copy(null, { ...spec.props, overlay: "o9" }); scene(name, v, { ...spec.props, overlay: "o9" }); };

before(async () => {
  // Set up in the first theme: what a state keeps of its colors must follow a switch to another.
  state.palette = THEMES[0].colors;
  state.shared.clear(); state.overlays.length = 0;
  // A repository: changed, new, deleted and ignored files, a folder, code, Markdown, an image.
  const dir = folder(["src/a.js", "src/b.js", "src/old.txt", "docs/guide.md", "logo.png", "notes.txt", ".gitignore", "build/out.txt", "lib/"]);
  writeFileSync(`${dir}/src/a.js`, "// a comment\nconst a = \"text\";\nfunction f() { return 42 + true; }\n");
  writeFileSync(`${dir}/docs/guide.md`, "# Guide\n\nSome *text* and `code`.\n");
  writeFileSync(`${dir}/logo.png`, png); writeFileSync(`${dir}/.gitignore`, "build/\n");
  git(dir, "-c", "init.defaultBranch=main", "init", "-q"); git(dir, "add", "-A"); git(dir, "commit", "-qm", "x");
  writeFileSync(`${dir}/src/a.js`, "// a comment\nconst a = \"changed\";\n"); writeFileSync(`${dir}/src/new.js`, "new\n");
  rmSync(`${dir}/src/old.txt`);
  for (const ignored of [false, true]) {
    state.shared.set("files-enhanced.settings", ignored ? { ignored: "dim" } : {});
    const v = await copy(dir);
    press(byId(draw(v), "file-src")); await settle();
    press(byId(draw(v), "file-src/a.js")); await settle(); draw(v); await settle();
    scene(`the tree, a code file previewed${ignored ? ", ignored files dimmed" : ""}`, v, {});
  }
  state.shared.delete("files-enhanced.settings");
  for (const [file, settings] of [["docs/guide.md", {}], ["docs/guide.md", { markdown: "source" }], ["logo.png", {}]]) {
    state.shared.set("files-enhanced.settings", settings);
    const v = await copy(dir);
    press(byId(draw(v), "file-docs")); await settle();
    press(byId(draw(v), `file-${file}`)); await settle(); draw(v); await settle();
    scene(`the tree, ${file} previewed ${JSON.stringify(settings)}`, v, {});
  }
  state.shared.delete("files-enhanced.settings");
  {
    // Editing, with unsaved changes and the warning that holds them.
    const v = await copy(dir);
    press(byId(draw(v), "file-notes.txt")); await settle();
    press(byId(draw(v), "fm-edit")); await settle();
    scene("the editor", v, {});
    const w = await copy(dir);
    press(byId(draw(w), "file-notes.txt")); await settle();
    press(byId(draw(w), "fm-edit")); await settle();
    w.role.preview.edit.dirty = true; w.role.preview.edit.warn = true;
    scene("the editor, unsaved changes held", w, {});
    // Several selected rows; the Changed view; a folder's branch badge; breadcrumbs.
    const s = await copy(dir);
    press(byId(draw(s), "file-notes.txt")); await settle();
    press(byId(draw(s), "file-logo.png"), "on_click", { click_count: 1, modifiers: { platform: true } });
    scene("several selected rows", s, {});
    const c = await copy(dir); c.role.changes = true;
    scene("the Changed view", c, {});
  }
  {
    // The search: names, then contents with Replace open.
    const v = await copy(dir), tree = v.role;
    tree.openSearch(makeCx()); tree.search.input.set_value("a"); await settle(); draw(v); await settle();
    scene("the name search", v, {});
    const n = await copy(dir);
    n.role.openSearch(makeCx()); n.role.search.input.set_value("zzz-nothing"); await settle(); draw(n); await settle();
    scene("the name search, nothing found", n, {});
    const cs = await copy(dir);
    keyDown(draw(cs), "cmd-shift-f"); cs.role.search.input.set_value("const"); await settle(); draw(cs); await settle();
    if (cs.role.search.replacing !== undefined) cs.role.search.replacing = true;
    scene("the contents search", cs, {});
  }
  {
    // Menus: a row's, the folder's, several rows'; the roots popup; Move to; the dialogs.
    const v = await copy(dir);
    press(byId(draw(v), "file-notes.txt"), "on_mouse_down", { button: "right", modifiers: {} }); await opened("a file's menu");
    press(byId(draw(v), "file-src"), "on_mouse_down", { button: "right", modifiers: {} }); await opened("a folder's menu");
    press(byId(draw(v), "fm-more")); await opened("the shown folder's menu");
    press(byId(draw(v), "file-notes.txt")); await settle();
    press(byId(draw(v), "file-logo.png"), "on_click", { click_count: 1, modifiers: { platform: true } });
    press(byId(draw(v), "file-logo.png"), "on_mouse_down", { button: "right", modifiers: {} }); await opened("several rows' menu");
    const l = v.role.here();
    v.role.roots(l); await opened("the roots popup");
    for (const [name, props] of [
      ["Move to…", { role: "moveto", root: dir, on: null, items: [{ rel: "src", dir: true }, { rel: "notes.txt", dir: false }] }],
      ["Rename", { role: "dialog", action: "rename", root: dir, on: null, rel: "notes.txt", dir: false }],
      ["New file", { role: "dialog", action: "newfile", root: dir, on: null, rel: "src", dir: true }],
      ["New folder", { role: "dialog", action: "newfolder", root: dir, on: null, rel: "", dir: true }],
      ["Delete one", { role: "dialog", action: "delete", root: dir, on: null, rel: "notes.txt", dir: false }],
      ["Delete several", { role: "dialog", action: "delete", root: dir, on: null, items: ["notes.txt", "logo.png", "src"].map((rel) => ({ rel, dir: rel === "src" })) }],
      ["Compress", { role: "dialog", action: "compress", root: dir, on: null, items: [{ rel: "notes.txt", dir: false }, { rel: "src", dir: true }] }],
      ["the send dialog", { role: "send", send: { title: "notes.txt", context: "notes.txt", sentKey: "k" } }],
    ]) {
      const d = await copy(null, { ...props, overlay: "o9" });
      scene(name, d, { ...props, overlay: "o9" });
    }
    const m = await copy(null, { role: "moveto", root: dir, on: null, items: [{ rel: "src", dir: true }], overlay: "o9" });
    press(byId(draw(m), "fm-mtr-lib")); await settle();
    scene("Move to…, a folder picked", m, { role: "moveto", root: dir, on: null, items: [{ rel: "src", dir: true }], overlay: "o9" });
    const e = await copy(null, { role: "dialog", action: "rename", root: dir, on: null, rel: "notes.txt", dir: false, overlay: "o9" });
    e.role.part.error = "A file with that name is already there";
    scene("Rename, an error", e, { role: "dialog", action: "rename", root: dir, on: null, rel: "notes.txt", dir: false, overlay: "o9" });
  }
  {
    // A repository below the root that isn't read; the window; the shared parts.
    checks.clear();
    const two = folder(["a/x.txt", "b/y.txt"]);
    for (const r of ["a", "b"]) { git(`${two}/${r}`, "-c", "init.defaultBranch=main", "init", "-q"); git(`${two}/${r}`, "add", "."); git(`${two}/${r}`, "commit", "-qm", "x"); }
    git(`${two}/b`, "config", "filter.secret.clean", "cat");
    writeFileSync(`${two}/a/x.txt`, "changed"); writeFileSync(`${two}/b/y.txt`, "changed");
    scene("a repository not read, a branch badge", await copy(two), {});
    scene("the window", await copy(dir, { overlay: "w1" }), { overlay: "w1" });
    state.layout = { id: "root", type: "row", children: [{ id: "panel", type: "column", children: [{ id: "panel-body", type: "stack", active: "files", children: [
      { id: "files", title: "Files", type: "block" }, { id: "changes", title: "Changes", type: "block" }, { id: "history", title: "History", type: "block" }] }] }] };
    scene("the tab header", await copy(null, { role: "tabs", stack: "panel-body" }), { role: "tabs", stack: "panel-body" });
    for (const section of ["open-with", "files", "agents"]) {
      const p = { role: "settings", overlay: "o9", section };
      scene(`the settings window: ${section}`, await copy(null, p), p);
    }
    const p = { role: "settings", overlay: "o9" }, armed = await copy(null, p);
    armed.role.armed = { what: "all", at: Date.now() };
    scene("the settings window: Reset all, asking again", armed, p);
  }
  state.props = {};
});

themeTests({ test, assert, scenes: () => scenes, state, stubs, min: 30, rows: null });
