// The right-click menu's items (menu.js) with the panel's Open with settings (launch.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, load, settle } from "./render/load.mjs";
import { NAME } from "./mod.mjs";
const { DETACH } = await load("detach.js");

const { items } = await load("menu.js");
const { openBy } = await load("launch.js");
const labels = p => items(p).map(x => x?.label ?? null);
// What a tree passes: the programs found here and on the space's machine, and what the machine can do.
const found = (...cli) => ({ here: { cli, app: [] }, there: { cli, app: [] } });
const caps = { shell: true, zip: true, trash: "finder", write: true, os: "macos" };
const file = { root: "/r", on: null, rel: "src/a.js", dir: false, found: found("zed", "nvim", "yazi", "lazygit"), caps };
const dir = { ...file, rel: "src", dir: true };

test("nothing set: today's menus, Zed only when it's found", () => {
  state.shared.clear();
  assert.deepEqual(labels(file), ["Open", "Open in Zed", null, "Reveal in Finder", "Open terminal here", "Open in Neovim", "Ask agent about this…", null,
    "New file…", "New folder…", null, "Cut", "Copy", "Duplicate", "Move to…", null, "Copy path", "Copy relative path", "Copy name", null, "Compress…", "Rename…", "Delete"]);
  assert.deepEqual(labels(dir).slice(0, 6), ["Open in Finder", "Open in Zed", "Open terminal here", "Open yazi here", "Open lazygit here", "Ask agent about this…"]);
  assert.deepEqual(labels({ ...file, found: found("nvim") }).slice(0, 6), ["Open", null, "Reveal in Finder", "Open terminal here", "Open in Neovim", "Ask agent about this…"]);
  assert.deepEqual(labels({ ...dir, found: null }).slice(0, 3), ["Open in Finder", "Open terminal here", "Ask agent about this…"]);
  assert.equal(items(file)[0].hint, "Double-click");
  // Another machine: no Open, Reveal or apps of this computer (Zed needs the machine's ssh target);
  // its terminal programs run there.
  const there = labels({ ...file, on: "vps", caps: { ...caps, trash: null } });
  assert.equal(there.some(l => /^Open$|Zed|Finder/.test(l ?? "")), false);
  assert.ok(there.includes("Open in Neovim") && there.includes("Delete permanently"));
  assert.ok(labels({ ...file, on: "vps", host: "vps" }).includes("Open in Zed"), "with an ssh target: Zed opens it over ssh");
});

test("the person's list: order, kinds and labels; the double-click hint follows settings.double", () => {
  state.shared.set("herdr-enhanced.open-with", {
    double: "code-it",
    items: [
      { id: "code-it", name: "VS Code", kind: "app", for: "both", cli: "code", argv: ["code", "{path}"] },
      { id: "hx", name: "Helix", kind: "pane", for: "files", argv: ["hx", "{file}"] },
      { id: "zed", name: "Zed", kind: "app", for: "both", cli: "zed", argv: ["zed", "{path}"], enabled: false },
    ],
  });
  const p = { ...file, found: found("code", "hx", "zed") };
  assert.deepEqual(labels(p).slice(0, 6), ["Open", "Open in VS Code", null, "Reveal in Finder", "Open terminal here", "Open in Helix"]);
  const list = items(p);
  assert.equal(list[0].hint, "", "Open has no hint: a double-click opens VS Code");
  assert.equal(list[1].hint, "Double-click");
  // VS Code missing: a double-click falls back to Open.
  assert.equal(items({ ...p, found: found("hx") })[0].hint, "Double-click");
  state.shared.clear();
});

test("your own app on another machine: in the menu with a command for it (over ssh), left out without one", async () => {
  const mine = { id: "my-ed", name: "My Ed", kind: "app", for: "both", argv: ["myed", "{path}"], remote: { argv: ["myed", "--ssh", "{host}", "{path}"] } };
  const { remote: _, ...plain } = mine;
  const p = { ...file, on: "vps", host: "me@vps", found: found("myed") };
  state.shared.set("herdr-enhanced.open-with", { items: [mine] });
  assert.ok(labels(p).includes("Open in My Ed"));
  assert.ok(labels({ ...p, rel: "src", dir: true }).includes("Open in My Ed"), "a folder too (for: both)");
  state.execHook = () => ({ code: 0, stdout: "", stderr: "" }); state.execLog.length = 0;
  await items(p).find(x => x?.label === "Open in My Ed").run();
  assert.deepEqual(state.execLog.at(-1).slice(0, 3), ["sh", ["-c", DETACH, "sh", "myed", "--ssh", "me@vps", "/r/src/a.js"], undefined], "run here, with no folder of its own");
  state.shared.set("herdr-enhanced.open-with", { items: [plain] });
  assert.equal(labels(p).includes("Open in My Ed"), false, "no command for another machine: left out there");
  assert.ok(labels({ ...p, on: null }).includes("Open in My Ed"), "and still here");
  state.execHook = null; state.shared.clear();
});

test("running items: a pane item opens a terminal in the file's folder, an app runs there", async () => {
  state.shared.clear(); state.runs.length = 0; state.execLog.length = 0;
  state.execHook = (command, args) => (command === "sh" ? null : { code: 0, stdout: "", stderr: "" });
  const list = items(file);
  list.find(x => x?.label === "Open in Neovim").run();
  assert.deepEqual(state.runs.at(-1), ["terminal.open", { argv: ["nvim", "/r/src/a.js"], folder: "/r/src", place: "right", name: "a.js" }]);
  items(dir).find(x => x?.label === "Open yazi here").run();
  assert.deepEqual(state.runs.at(-1), ["terminal.open", { argv: ["yazi"], folder: "/r/src", place: "right", name: "src" }]);
  await list.find(x => x?.label === "Open in Zed").run();
  assert.deepEqual(state.execLog.at(-1).slice(0, 3), ["sh", ["-c", DETACH, "sh", "zed", "/r/src/a.js"], "/r/src"]);
  state.execHook = null;
});

test("openBy: the chosen item, or the system's way when it isn't usable here", async () => {
  state.execLog.length = 0; state.notes.length = 0;
  state.execHook = () => ({ code: 0, stdout: "", stderr: "" });
  const target = { path: "/r/src/a.js", dir: false, folder: "/r/src", name: "a.js" };
  const both = (...cli) => { const f = { cli: new Set(cli), app: new Set() }; return { here: f, there: f }; };
  const sets = both("zed");
  state.shared.set("herdr-enhanced.open-with", { double: "zed" });
  await openBy("zed", sets, target);
  assert.deepEqual(state.execLog.at(-1).slice(0, 2), ["sh", ["-c", DETACH, "sh", "zed", "/r/src/a.js"]]);
  await openBy("zed", both(), target);
  assert.deepEqual(state.execLog.at(-1).slice(0, 2), ["open", ["/r/src/a.js"]], "Zed missing: the system opens it");
  await openBy("yazi", both("yazi"), target);
  assert.deepEqual(state.execLog.at(-1).slice(0, 2), ["open", ["/r/src/a.js"]], "a folder program isn't used for a file");
  await openBy("system", sets, target);
  assert.deepEqual(state.execLog.at(-1).slice(0, 2), ["open", ["/r/src/a.js"]]);
  state.execHook = () => ({ code: 1, stdout: "", stderr: "zed: something broke\nmore" });
  await openBy("zed", sets, target);
  assert.deepEqual(state.notes.at(-1), { title: "Cannot open in Zed", body: "zed: something broke", level: "error" });
  // On another machine: Zed opens the path there over ssh (no folder of its own here), the system's way
  // doesn't exist, a terminal program runs in that space.
  state.execHook = () => ({ code: 0, stdout: "", stderr: "" }); state.execLog.length = 0;
  const vps = { on: "vps", host: "me@vps:2222" };
  assert.equal(await openBy("zed", sets, target, vps), true);
  assert.deepEqual(state.execLog.at(-1).slice(0, 3), ["sh", ["-c", DETACH, "sh", "zed", "ssh://me@vps:2222/r/src/a.js"], undefined]);
  state.execLog.length = 0;
  assert.equal(await openBy("system", sets, target, vps), false);
  assert.equal(state.execLog.length, 0, "nothing runs");
  const { KNOWN } = await load("openwith.js");
  state.shared.set("herdr-enhanced.open-with", { items: ["vscode", "nvim"].map(id => KNOWN.find(k => k.id === id)) });
  assert.equal(await openBy("vscode", { here: { cli: new Set(["code"]), app: new Set() }, there: { cli: new Set(), app: new Set() } }, target, vps), false, "VS Code's ssh-remote+ can't take a port");
  assert.equal(await openBy("vscode", { here: { cli: new Set(["code"]), app: new Set() }, there: { cli: new Set(), app: new Set() } }, { ...target, line: 7 }, { on: "vps", host: "vps" }), true);
  assert.deepEqual(state.execLog.at(-1)[1].slice(3), ["code", "--remote", "ssh-remote+vps", "-g", "/r/src/a.js:7"]);
  state.runs.length = 0;
  await openBy("nvim", both("nvim"), { ...target, line: 3 }, vps);
  assert.deepEqual(state.runs.at(-1), ["terminal.open", { argv: ["nvim", "+3", "/r/src/a.js"], folder: "/r/src", place: "right", name: "a.js" }]);
  state.execHook = null; state.shared.clear();
  await settle();
});

test("several selected rows: one menu for all of them", () => {
  state.shared.clear();
  const batch = { root: "/r", on: null, batch: [{ rel: "src", dir: true }, { rel: "src/a.js", dir: false }, { rel: "b.txt", dir: false }], found: null };
  assert.deepEqual(labels(batch), ["Cut", "Copy", "Copy paths", null, "Compress…", "Move to…", "Ask agent about these…", null, "Delete 2 items…"]);
  assert.deepEqual(labels({ ...batch, on: "vps" }), ["Cut", "Copy", "Copy paths", null, "Move to…", "Ask agent about these…", null, "Delete 2 items permanently…"]);
  let copied = null;
  items(batch).find(x => x?.label === "Copy paths").run({ write_to_clipboard: t => { copied = t; } });
  assert.equal(copied, "/r/src\n/r/b.txt");
  state.overlays.length = 0;
  items(batch).at(-1).run();
  assert.deepEqual(state.overlays.at(-1).props.items, [{ rel: "src", dir: true }, { rel: "b.txt", dir: false }]);
  assert.equal(state.overlays.at(-1).props.action, "delete");
  // Asking the agent: this mod's own send dialog, whatever else is installed.
  items(batch).find(x => x?.label === "Ask agent about these…").run({ write_to_clipboard() {} });
  assert.deepEqual(state.overlays.at(-1), { mod: NAME, kind: "dialog", modal: true, width: 560, height: 340, props: { role: "send", send: { title: "2 items", context: "Folder: /r/src\nFile: /r/b.txt", sentKey: null } } });
});

test("the file clipboard in the menus: Cut / Copy keep paths, Paste shows when it can paste here", () => {
  state.shared.clear();
  const bg = { root: "/r", on: null, rel: "", dir: true, background: true, found: null };
  assert.equal(labels(bg).includes("Paste"), false);
  items(file).find(x => x?.label === "Cut").run();
  const c = state.shared.get(`${NAME}.clipboard`);
  assert.deepEqual([c.mode, c.paths, c.on], ["cut", ["/r/src/a.js"], null]);
  assert.equal(typeof c.at, "number");
  assert.ok(labels(bg).includes("Paste"));
  assert.ok(labels(dir).includes("Paste"));
  assert.equal(labels({ ...bg, on: "vps" }).includes("Paste"), false, "cut here, not pasteable on another machine");
  items({ ...dir, rel: "lib" }).find(x => x?.label === "Copy").run();
  assert.deepEqual(state.shared.get(`${NAME}.clipboard`).paths, ["/r/lib"]);
  assert.equal(state.shared.get(`${NAME}.clipboard`).mode, "copy");
  state.overlays.length = 0;
  items(file).find(x => x?.label === "Move to…").run();
  assert.deepEqual(state.overlays.at(-1).props, { role: "moveto", root: "/r", on: null, items: [{ rel: "src/a.js", dir: false }] });
  state.shared.clear();
});
