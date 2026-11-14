// The panel's tab header and settings window (shared/paneltabs.js, shared/settingsview.js), as a mod
// draws them: run by test/files-enhanced/panel.test.mjs and test/git-enhanced/panel.test.mjs
// against each mod's own copy, under that mod's render stubs. A copy may never notify, store or run
// a program while it renders, and every control in the window stops its press (else the window
// would drag). The other mod is installed only where a test puts its main.js in the app's folder.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { layoutProblems } from "./layoutlint.mjs";

// The tree a render described: each element's recorded data ($), depth first.
function* walk(e) { if (!e?.$) return; yield e.$; for (const c of e.$.children) yield* walk(c); }
const textOf = (e) => (typeof e === "string" || typeof e === "number" ? String(e) : e?.$ ? e.$.children.map(textOf).join("") : "");
const find = (root, id) => { const n = [...walk(root)].find((x) => x.id === id); assert.ok(n, `no element ${id}`); return n; };
const has = (root, id) => [...walk(root)].some((x) => x.id === id);
const ids = (root, re) => [...walk(root)].map((x) => x.id).filter((id) => re.test(String(id)));

const FOUND = "cli zed\ncli nvim\ncli yazi\ncli code\ncli pi\ncli codex\napp Typora\napp Cursor\n";

/** The tests, for one mod: `name` its folder, `stubs` its render stubs, `load(rel)` one of its modules. */
export async function panelTests({ name, stubs, load }) {
  const { state, makeCx, settle } = stubs;
  const { default: Mod } = await load("main.js");
  const { KEYS } = await load("panelsettings.js");
  const { MODS, checkInstalled } = await load("installed.js");
  const { SETTINGS_WINDOW } = await load("settingsview.js");
  const { PART } = await load("id.js");
  const other = PART === "files" ? "changes" : "files";
  // This mod's window: its own section, Open with, Agents, whichever mods are installed.
  const SHOWN = [PART, "open-with", "agents"];
  const TITLE = PART === "files" ? "Files settings" : "Git settings";
  const isOn = (root, id) => find(root, `ps-s-${id}`).calls.some(([m, a]) => m === "bg" && a[0] !== "#00000000");

  // A render, checked for layouts that fail on screen (layoutlint.mjs: into state.violations).
  const draw = (view) => { state.rendering = true; let tree; try { tree = view.render(makeCx()); } finally { state.rendering = false; } state.violations.push(...layoutProblems(tree)); return tree; };
  const click = (node) => { const cx = makeCx(); node.handlers.on_click.at(-1).at(-1)({ click_count: 1, modifiers: {} }, cx); return cx; };
  // A press on a drop-down's field, or outside its open list: its Popover (`<id>-drop`) says open or closed.
  const drop = (root, id, open = true) => { const n = [...walk(root)].find((x) => x.kind === "popover" && x.popover === `${id}-drop`); assert.ok(n, `no drop-down ${id}`); n.handlers.on_open_change[0].at(-1)(open, makeCx()); };
  const press = (node) => { const cx = makeCx(); node.handlers.on_mouse_down.find(([b]) => b === "left")[1]({ button: "left" }, cx); return cx.stopped === true; };
  // A person typing in a text state, and a state's other events (submit, blur).
  const type = (s, v) => { s.val = v; for (const h of s.handlers.change ?? []) h({}, makeCx()); };
  const emit = (s, ev) => { for (const h of s.handlers[ev] ?? []) h({}, makeCx()); };
  const mount = (props) => { state.props = props; const v = new Mod(); v.init({}, makeCx("async")); return v; };
  const part = (v) => v.role ?? v.part;
  // The other mod, installed or not, in the stubs' app folder.
  const otherMain = () => join(stubs.appHome(), "mods", MODS[other], "main.js");
  const install = () => { mkdirSync(join(stubs.appHome(), "mods", MODS[other]), { recursive: true }); writeFileSync(otherMain(), "// the other mod\n"); };
  const uninstall = () => rmSync(join(stubs.appHome(), "mods", MODS[other]), { recursive: true, force: true });
  // The settings window as its overlay copy, after its first looks (programs, the mods installed).
  const windowView = async (section) => { const v = mount({ role: "settings", overlay: "o9", ...(section ? { section } : {}) }); await settle(); return v; };

  beforeEach(() => {
    Object.assign(state, { rendering: false, props: {} });
    for (const k of ["violations", "overlays", "closed", "runs", "execLog"]) state[k].length = 0;
    state.shared.clear();
    state.execHook = (cmd) => (cmd === "sh" ? { code: 0, stdout: FOUND, stderr: "" } : null);
    state.layout = { id: "root", type: "row", children: [{ id: "panel", type: "column", children: [{ id: "panel-body", type: "stack", active: "files", children: [
      { id: "files", title: "Files", type: "block" }, { id: "changes", title: "Changes", type: "block" }, { id: "history", title: "History", type: "block" }] }] }] };
    install();
  });

  test(`${name}: the header: the stack's children as tabs, a click shows one; no gear (each page has its own)`, () => {
    const view = mount({ role: "tabs", stack: "panel-body" });
    const strip = draw(view);
    assert.deepEqual(ids(strip, /^panel-tab-/), ["panel-tab-files", "panel-tab-changes", "panel-tab-history"]);
    assert.deepEqual(["files", "changes", "history"].map((id) => textOf({ $: find(strip, `panel-tab-${id}`) })), ["Files", "Changes", "History"]);
    const icon = (id) => [...walk({ $: find(strip, `panel-tab-${id}`) })].find((n) => n.kind === "svg")?.path;
    assert.deepEqual(["files", "changes", "history"].map(icon), ["mods/files/file.svg", "mods/changes/changes.svg", "mods/workspace-chrome/clock.svg"], "Herdr's own icons");
    assert.ok(find(strip, "panel-tab-files").calls.some(([m]) => m === "bg"), "the shown page is lit");
    assert.ok(!find(strip, "panel-tab-changes").calls.some(([m]) => m === "bg"));
    for (const id of ["panel-tab-files", "panel-tab-history"]) assert.equal(press(find(strip, id)), true, `${id} keeps its press`);
    assert.deepEqual([...walk(strip)].filter((n) => n.kind === "svg").map((n) => n.path), ["mods/files/file.svg", "mods/changes/changes.svg", "mods/workspace-chrome/clock.svg"], "no gear: only the tabs' icons");
    assert.deepEqual(ids(strip, /^panel-/), ["panel-tabs", "panel-tab-files", "panel-tab-changes", "panel-tab-history"]);
    assert.equal(SETTINGS_WINDOW, "herdr-enhanced-settings", "one window, whichever mod opens it");
    click(find(strip, "panel-tab-changes"));
    click(find(strip, "panel-tab-files"));
    assert.deepEqual(state.runs, [["layout.select", { stack: "panel-body", child: "changes" }]], "the shown page isn't selected again");
    // Another stack, its own icons, children without titles; a stack that isn't there: nothing.
    state.layout = { id: "root", type: "row", children: [{ id: "side", type: "stack", active: "b", children: [{ id: "a", type: "block" }, { id: "b", type: "block" }] }] };
    const own = draw(mount({ role: "tabs", stack: "side", icons: { a: "mods/x/a.svg" } }));
    assert.deepEqual(["a", "b"].map((id) => textOf({ $: find(own, `panel-tab-${id}`) })), ["a", "b"]);
    assert.equal([...walk({ $: find(own, "panel-tab-a") })].find((n) => n.kind === "svg")?.path, "mods/x/a.svg");
    assert.ok(find(own, "panel-tab-b").calls.some(([m]) => m === "bg"));
    assert.deepEqual(ids(draw(mount({ role: "tabs", stack: "nowhere" })), /^panel-/), ["panel-tabs"]);
    assert.deepEqual(state.violations, []);
  });

  test(`${name}: the window's sections: this mod's own, Open with and Agents, never the other's, installed or not`, async () => {
    const { SETTINGS_TITLE } = await load("settingsview.js");
    assert.equal(SETTINGS_TITLE, TITLE);
    for (const both of [false, true]) {
      if (both) install(); else uninstall();
      await checkInstalled();
      const how = both ? `with ${MODS[other]}` : `without ${MODS[other]}`;
      let root = draw(await windowView());
      assert.deepEqual(ids(root, /^ps-s-/), SHOWN.map((s) => `ps-s-${s}`), how);
      assert.deepEqual(ids(root, /^ps-s-/).map((id) => textOf({ $: find(root, id) })), [PART === "files" ? "Files" : "Git", "Open with", "Agents"], how);
      assert.equal(textOf(root.$.children[0]), TITLE, `the title bar, ${how}`);
      // Opened with no section: this mod's own.
      assert.equal(part(await windowView()).section, PART, `the default, ${how}`);
      assert.ok(isOn(root, PART) && !isOn(root, "open-with"), `its own is lit, ${how}`);
      // Asked for the other's section (or one that isn't there): this mod's own too.
      for (const asked of [other, "nowhere"]) {
        const v = await windowView(asked);
        assert.equal(part(v).section, PART, `asked for ${asked}, ${how}`);
        assert.ok(isOn(draw(v), PART));
      }
      // Asked for one it shows: that one.
      for (const asked of SHOWN) assert.equal(part(await windowView(asked)).section, asked, `asked for ${asked}, ${how}`);
    }
    assert.deepEqual(state.violations, []);
  });

  test(`${name}: Open with and Agents say both mods use them, only when both are installed`, async () => {
    const { BOTH_USE } = await load("settingsview.js");
    assert.equal(BOTH_USE, "Files Enhanced and Git Enhanced both use these.");
    await checkInstalled();
    for (const section of ["open-with", "agents"]) {
      const root = draw(await windowView(section));
      assert.equal(textOf({ $: find(root, "ps-both-use") }), BOTH_USE, `${section}, both installed`);
    }
    assert.equal(has(draw(await windowView(PART)), "ps-both-use"), false, `not on ${PART}`);
    uninstall();
    await checkInstalled();
    for (const section of SHOWN) assert.equal(has(draw(await windowView(section)), "ps-both-use"), false, `${section}, ${MODS[other]} not installed`);
    assert.deepEqual(state.violations, []);
  });

  test(`${name}: every page draws without notifying, storing or running anything, and every control stops its press`, async () => {
    const view = await windowView();
    for (const id of SHOWN) {
      let root = draw(view);
      if (id !== PART) { click(find(root, `ps-s-${id}`)); root = draw(view); }
      for (const n of walk(root)) {
        if (n.handlers.on_click) assert.ok(n.handlers.on_mouse_down?.some(([b]) => b === "left"), `${n.id ?? n.kind} on ${id} doesn't stop its press`);
      }
      // The page itself stops presses too, so a click between controls doesn't drag the window.
      const body = [...walk(root)].find((n) => n.children.some((c) => c?.$?.id === "ps-body"));
      assert.ok(body.handlers.on_mouse_down, "the page stops presses");
    }
    assert.deepEqual(state.violations, []);
    assert.equal(state.execLog.filter(([c]) => c === "sh").length, 1, "programs looked for once");
  });

  test(`${name}: Open with: detection, ticking, order, pickers`, async () => {
    const view = mount({ role: "settings", overlay: "o9", section: "open-with" });
    assert.equal(state.execLog.length, 1, "detection starts when the window opens at Open with");
    assert.equal(state.execLog[0][0], "sh");
    let root = draw(view);
    assert.ok(textOf(root).includes("Looking for programs"), "a spinner while it runs");
    await settle();
    root = draw(view);
    assert.ok(textOf(root).includes("Check again"));
    assert.ok(textOf(root).includes("Now a file offers Zed, Neovim; a folder Zed, yazi."));
    assert.ok(textOf(root).includes("app found: opens without a line"), "Cursor: only its app");
    assert.ok(textOf(root).includes("not installed"));
    // Tick VS Code: a copy at the end of the list.
    click(find(root, "ps-p-vscode-tick"));
    assert.deepEqual(state.shared.get(KEYS.openWith).items.map((i) => i.id), ["zed", "nvim", "yazi", "lazygit", "vscode"]);
    root = draw(view);
    assert.ok(textOf(root).includes("Now a file offers Zed, Neovim, VS Code"));
    // Up: before Zed.
    click(find(root, "ps-p-vscode-up"));
    assert.deepEqual(state.shared.get(KEYS.openWith).items.map((i) => i.id), ["vscode", "zed", "nvim", "yazi", "lazygit"]);
    root = draw(view);
    assert.equal(find(root, "ps-p-vscode-up").handlers.on_click, undefined, "first: no ↑");
    // Double-click opens with VS Code.
    drop(root, "ps-pick-double");
    root = draw(view);
    assert.deepEqual([0, 1, 2, 3].map((i) => textOf({ $: find(root, `ps-pick-double-${i}`) })), ["System default", "VS Code", "Zed", "Neovim"]);
    assert.equal(has(root, "ps-pick-double-4"), false, "only the ticked ones that open files");
    click(find(root, "ps-pick-double-1"));
    assert.equal(state.shared.get(KEYS.openWith).double, "vscode");
    root = draw(view);
    assert.equal(has(root, "ps-pick-double-0"), false, "the list closed");
    assert.ok(textOf({ $: find(root, "ps-pick-double-field") }).includes("VS Code"));
    // Untick it: it keeps its place, and the picker goes back to the system default.
    click(find(root, "ps-p-vscode-tick"));
    const ow = state.shared.get(KEYS.openWith);
    assert.deepEqual(ow.items.map((i) => `${i.id}${i.enabled ? "" : "-off"}`), ["vscode-off", "zed", "nvim", "yazi", "lazygit"]);
    assert.equal(ow.double, undefined);
    root = draw(view);
    click(find(root, "ps-detect"));
    assert.equal(state.execLog.length, 2, "Check again looks again");
    await settle();
    assert.deepEqual(state.violations, []);
  });

  test(`${name}: Open with: a program of your own, added, changed, removed`, async () => {
    const view = await windowView("open-with"), w = part(view);
    let root = draw(view);
    click(find(root, "ps-own-add"));
    root = draw(view);
    assert.ok(textOf(root).includes("Add a program"));
    click(find(root, "ps-form-save"));
    root = draw(view);
    assert.ok(textOf(root).includes("Give it a name."));
    assert.equal(state.shared.get(KEYS.openWith), undefined, "nothing stored");
    type(w.formName, "My Editor");
    type(w.formCommand, "open -a 'My Editor' {file}");
    type(w.formLine, "~/bin/myed --goto {file}:{line}");
    root = draw(view);
    assert.equal(textOf(root).includes("Give it a name."), false, "typing clears the error");
    assert.ok(has(root, "ps-form-remote") && textOf(root).includes("Command for a file on another machine (over ssh)"), "an app: the field for another machine");
    type(w.formRemote, "myed --ssh {file}");
    click(find(root, "ps-form-save"));
    root = draw(view);
    assert.ok(textOf(root).includes("needs {host}"), "a command for another machine without {host}: said, nothing stored");
    assert.equal(state.shared.get(KEYS.openWith), undefined);
    type(w.formRemote, "");
    click(find(root, "ps-form-kind-1"));                 // Run in a pane
    click(find(root, "ps-form-for-2"));                  // Both
    root = draw(view);
    assert.equal(has(root, "ps-form-remote"), false, "a pane program runs on that machine itself: no field");
    click(find(root, "ps-form-save"));
    assert.deepEqual(state.shared.get(KEYS.openWith).items.at(-1), { id: "my-editor", name: "My Editor", kind: "pane", for: "both", argv: ["open", "-a", "My Editor", "{file}"], enabled: true, argvLine: [`${stubs.home()}/bin/myed`, "--goto", "{file}:{line}"] });
    assert.equal(state.execLog.length, 2, "its command is looked for");
    await settle();
    root = draw(view);
    assert.equal(textOf(root).includes("Add a program"), false, "the form closed");
    click(find(root, "ps-p-my-editor-edit"));
    root = draw(view);
    assert.equal(w.formCommand.value(), "open -a 'My Editor' {file}");
    assert.ok(textOf(root).includes("Change My Editor"));
    type(w.formName, "Mine");
    emit(w.formName, "submit");                          // Enter saves too
    assert.equal(state.shared.get(KEYS.openWith).items.at(-1).name, "Mine");
    assert.equal(state.shared.get(KEYS.openWith).items.at(-1).id, "my-editor", "the id stays");
    await settle();
    root = draw(view);
    click(find(root, "ps-p-my-editor-remove"));
    assert.equal(state.shared.get(KEYS.openWith), null, "the default list again");
    // An app with a command for another machine: stored as its remote form, shown again in the form.
    await settle();
    root = draw(view);
    click(find(root, "ps-own-add"));
    type(w.formName, "Far Ed");
    type(w.formCommand, "fared {file}");
    type(w.formRemote, "fared --ssh {host} '{file}:{line}'");
    emit(w.formRemote, "submit");
    assert.deepEqual(state.shared.get(KEYS.openWith).items.at(-1), { id: "far-ed", name: "Far Ed", kind: "app", for: "files", argv: ["fared", "{file}"], enabled: true, remote: { argv: ["fared", "--ssh", "{host}", "{file}:{line}"] } });
    await settle();
    root = draw(view);
    click(find(root, "ps-p-far-ed-edit"));
    assert.equal(w.formRemote.value(), "fared --ssh {host} {file}:{line}");
    type(w.formRemote, "");
    emit(w.formRemote, "submit");
    assert.equal("remote" in state.shared.get(KEYS.openWith).items.at(-1), false, "emptied: none");
    await settle();
    assert.deepEqual(state.violations, []);
  });

  test(`${name}: Reset asks with a second press, for the section or for all`, async () => {
    state.shared.set(KEYS.agents, { where: "right" });
    state.shared.set(KEYS.openWith, { double: "zed" });
    const view = await windowView("agents");
    let root = draw(view);
    click(find(root, "ps-reset-section"));
    root = draw(view);
    assert.ok(textOf({ $: find(root, "ps-reset-section") }).includes("Press again to reset"));
    assert.deepEqual(state.shared.get(KEYS.agents), { where: "right" }, "not yet");
    click(find(root, "ps-reset-section"));
    assert.equal(state.shared.get(KEYS.agents), null);
    assert.deepEqual(state.shared.get(KEYS.openWith), { double: "zed" }, "only this section");
    root = draw(view);
    assert.ok(textOf({ $: find(root, "ps-reset-section") }).includes("Reset this section"));
    click(find(root, "ps-reset-all"));
    click(find(draw(view), "ps-reset-all"));
    assert.equal(state.shared.get(KEYS.openWith), null);
    await settle();
    assert.deepEqual(state.violations, []);
  });

  test(`${name}: Reset all resets Open with, this mod's own and Agents, never the other mod's; its second press says so`, async () => {
    const { resetAllWhat } = await load("settingsview.js");
    const mine = KEYS[PART], theirs = KEYS[other];
    for (const both of [true, false]) {
      if (both) install(); else uninstall();
      await checkInstalled();
      state.shared.set(KEYS.openWith, { double: "zed" });
      state.shared.set(KEYS.agents, { where: "right" });
      state.shared.set(mine, { repoDepth: 3 });
      state.shared.set(theirs, { repoDepth: 4 });
      const view = await windowView();
      let root = draw(view);
      assert.equal(has(root, "ps-reset-all-what"), false, "nothing said before the first press");
      click(find(root, "ps-reset-all"));
      root = draw(view);
      assert.ok(textOf({ $: find(root, "ps-reset-all") }).includes("Press again to reset"));
      const said = textOf({ $: find(root, "ps-reset-all-what") });
      assert.equal(said, resetAllWhat(both));
      assert.ok(said.startsWith(`Reset all puts ${PART === "files" ? "Files" : "Git"}, Open with and Agents back to their defaults.`), said);
      assert.equal(said.includes(`${PART === "files" ? "Git" : "Files"} Enhanced uses Open with and Agents too`), both, `the other mod named only when installed: ${said}`);
      assert.deepEqual(state.shared.get(mine), { repoDepth: 3 }, "not yet");
      click(find(root, "ps-reset-all"));
      for (const key of [KEYS.openWith, KEYS.agents, mine]) assert.equal(state.shared.get(key), null, `${key} reset`);
      assert.deepEqual(state.shared.get(theirs), { repoDepth: 4 }, "the other mod's own settings stay");
      assert.equal(has(draw(view), "ps-reset-all-what"), false, "the line goes with the second press");
    }
    await settle();
    assert.deepEqual(state.violations, []);
  });

  if (PART === "files") test(`${name}: Files: switches, steppers, the Never list and nesting rules`, async () => {
    const view = await windowView("files"), w = part(view);
    let root = draw(view);
    click(find(root, "ps-hidden"));
    assert.deepEqual(state.shared.get(KEYS.files), { hidden: false });
    root = draw(view);
    click(find(root, "ps-ignored-1"));
    click(find(root, "ps-freshMinutes-plus"));
    assert.deepEqual(state.shared.get(KEYS.files), { hidden: false, ignored: "dim", freshMinutes: 15 });
    // Files' own repoDepth (the Changes page has Changes' own).
    click(find(root, "ps-repoDepth-plus"));
    assert.deepEqual(state.shared.get(KEYS.files), { hidden: false, ignored: "dim", freshMinutes: 15, repoDepth: 2 });
    assert.equal(state.shared.get(KEYS.changes), undefined);
    root = draw(view);
    click(find(root, "ps-repoDepth-minus")); click(find(draw(view), "ps-repoDepth-minus"));
    assert.deepEqual(state.shared.get(KEYS.files), { hidden: false, ignored: "dim", freshMinutes: 15, repoDepth: 0 });
    root = draw(view);
    assert.equal(find(root, "ps-repoDepth-minus").handlers.on_click, undefined, "0 is the least");
    type(w.exclude, "node_modules\n*.log\n");
    assert.equal(state.shared.get(KEYS.files).exclude, undefined, "a moment after the last key");
    await settle();
    assert.deepEqual(state.shared.get(KEYS.files).exclude, ["node_modules", "*.log"]);
    assert.equal(state.shared.get(KEYS.files).repoDepth, 0);
    type(w.nest, '{ "a.json": ["b.json"] ');
    root = draw(view);
    assert.ok(textOf(root).includes("Not saved: this isn't JSON yet"));
    await settle();
    assert.equal(state.shared.get(KEYS.files).nest, undefined, "broken rules aren't saved");
    type(w.nest, '{ "a.json": ["b.json"] }');
    emit(w.nest, "blur");                                // leaving the box saves at once
    assert.deepEqual(state.shared.get(KEYS.files).nest, { "a.json": ["b.json"] });
    root = draw(view);
    assert.equal(textOf(root).includes("Not saved"), false);
    assert.deepEqual(state.violations, []);
  });

  if (PART === "changes") test(`${name}: Changes: repositories depth, context, the code size, the model and the template`, async () => {
    const view = await windowView("changes"), w = part(view);
    let root = draw(view);
    assert.ok(textOf(root).includes("Look for repositories this many folders down"));
    click(find(root, "ps-repoDepth-plus"));
    root = draw(view);
    click(find(root, "ps-repoDepth-plus"));
    click(find(root, "ps-context-2"));
    root = draw(view);
    click(find(root, "ps-codeSize-3"));                  // 11 · 12 · 13 · 14 · Terminal
    root = draw(view);
    assert.equal(find(root, "ps-autoFetch-minus").handlers.on_click, undefined, "Never is the least");
    type(w.model, "  example/fast-model ");
    emit(w.model, "submit");                             // Enter saves at once
    assert.equal(state.shared.get(KEYS.changes).commitModel, "example/fast-model");
    type(w.template, "feat: ");
    await settle();
    assert.deepEqual(state.shared.get(KEYS.changes), { repoDepth: 3, context: "file", codeSize: 14, commitModel: "example/fast-model", template: "feat: " });
    assert.equal(state.shared.get(KEYS.files), undefined, "Files' repoDepth stays its own");
    assert.deepEqual(state.violations, []);
  });

  if (PART === "changes") test(`${name}: Changes: who writes commit messages, found or not, and your own command`, async () => {
    const { PEN_SENDS, COMMAND_NOTE } = await load("settingsview.js");
    const { penCommand, SYSTEM } = await load("commitmsg.js");
    state.shared.set(KEYS.changes, { commitCommand: ["my-writer"] });
    // What detection finds decides the labels: pi and codex here (FOUND), then claude, opencode and my-writer.
    const labels = async (found) => {
      state.execHook = (cmd) => (cmd === "sh" ? { code: 0, stdout: found, stderr: "" } : null);
      const view = await windowView("changes");
      const script = state.execLog.filter(([c]) => c === "sh").at(-1)[1][1];
      for (const p of ["pi", "claude", "codex", "opencode", "my-writer"]) assert.ok(script.includes(` ${p}`), `${p} is looked for`);
      let root = draw(view);
      drop(root, "ps-commitAgent");
      root = draw(view);
      return [0, 1, 2, 3, 4].map((i) => textOf({ $: find(root, `ps-commitAgent-${i}`) }));
    };
    assert.deepEqual(await labels(FOUND), ["pifound", "Claude Codenot found here", "Codexfound", "OpenCodenot found here", "Your own commandnot found here"]);
    assert.deepEqual(await labels("cli claude\ncli opencode\ncli my-writer\n"), ["pinot found here", "Claude Codefound", "Codexnot found here", "OpenCodefound", "Your own commandfound"]);
    state.shared.clear();
    state.execHook = (cmd) => (cmd === "sh" ? { code: 0, stdout: FOUND, stderr: "" } : null);
    const view = await windowView("changes"), w = part(view);
    let root = draw(view);
    assert.ok(textOf(root).includes("Commit messages written by"));
    assert.equal(textOf({ $: find(root, "ps-pen-sends") }), PEN_SENDS);
    assert.ok(textOf(root).includes("Given to pi as --model."), "the model's note says what it does for pi");
    // Each agent, picked from the drop-down, is stored (pi, the default, as nothing); the model's note follows.
    const notes = { claude: "Given to claude -p as --model.", codex: "Given to codex exec as --model.", opencode: "Given to opencode run as --model.", pi: "Given to pi as --model." };
    for (const [i, id] of [[1, "claude"], [2, "codex"], [3, "opencode"], [0, "pi"]]) {
      drop(root, "ps-commitAgent");
      root = draw(view);
      click(find(root, `ps-commitAgent-${i}`));
      assert.equal(state.shared.get(KEYS.changes)?.commitAgent, id === "pi" ? undefined : id, id);
      root = draw(view);
      assert.equal(has(root, "ps-commitAgent-0"), false, "the list closed");
      assert.ok(textOf(root).includes(notes[id]), `${id}'s model note`);
      assert.equal(has(root, "ps-commitCommand-note"), false, `${id}: no command field`);
    }
    // Your own command: its field, its note; typing stores the words a moment later.
    drop(root, "ps-commitAgent");
    root = draw(view);
    click(find(root, "ps-commitAgent-4"));
    assert.deepEqual(state.shared.get(KEYS.changes), { commitAgent: "custom" });
    root = draw(view);
    assert.equal(textOf({ $: find(root, "ps-commitCommand-note") }), COMMAND_NOTE);
    assert.ok(textOf(root).includes("Put in place of {model} in your command."));
    type(w.commitCommand, "my-writer --model {model} 'the prompt: {prompt}'");
    assert.equal(state.shared.get(KEYS.changes).commitCommand, undefined, "a moment after the last key");
    await settle();
    assert.deepEqual(state.shared.get(KEYS.changes), { commitAgent: "custom", commitCommand: ["my-writer", "--model", "{model}", "the prompt: {prompt}"] });
    assert.deepEqual(penCommand({ agent: "custom", command: state.shared.get(KEYS.changes).commitCommand, model: "m1", text: "P" }).argv,
      ["my-writer", "--model", "m1", `the prompt: ${SYSTEM}\n\nP`], "what the pen runs with it");
    // A quote that isn't closed: said under the field, nothing stored.
    type(w.commitCommand, "my-writer 'oops");
    root = draw(view);
    assert.ok(textOf({ $: find(root, "ps-commitCommand-note") }).includes("quote that isn't closed"));
    await settle();
    emit(w.commitCommand, "blur");
    assert.deepEqual(state.shared.get(KEYS.changes).commitCommand, ["my-writer", "--model", "{model}", "the prompt: {prompt}"], "not saved");
    // Leaving the field saves at once; opened again, the field shows the stored words as a command line.
    type(w.commitCommand, "llm -m {model}");
    emit(w.commitCommand, "blur");
    assert.deepEqual(state.shared.get(KEYS.changes).commitCommand, ["llm", "-m", "{model}"]);
    state.shared.set(KEYS.changes, { commitAgent: "custom", commitCommand: ["my writer", "{prompt}"] });
    const again = await windowView("changes");
    assert.equal(part(again).commitCommand.value(), "'my writer' {prompt}");
    assert.ok(has(draw(again), "ps-commitCommand-note"));
    // The pen's choice is the same setting: what the settings stored is the pen's agent.
    const { agentOf } = await load("commitmsg.js");
    assert.equal(agentOf(state.shared.get(KEYS.changes).commitAgent).id, "custom");
    assert.deepEqual(state.violations, []);
  });

  test(`${name}: Agents: a preset, or a command of your own`, async () => {
    const view = await windowView("agents"), w = part(view);
    let root = draw(view);
    assert.ok(textOf(root).includes("found") && textOf(root).includes("not installed"), "pi found, claude not");
    click(find(root, "ps-agent-codex"));
    assert.deepEqual(state.shared.get(KEYS.agents), { name: "codex", argv: ["codex"] });
    root = draw(view);
    click(find(root, "ps-agent-pi"));
    assert.equal(state.shared.get(KEYS.agents), null, "pi is the default");
    // "Your own" and straight back to pi: nothing was stored, but the page shows pi again.
    root = draw(view);
    click(find(root, "ps-agent-own"));
    root = draw(view);
    assert.ok(has(root, "ps-agent-pi") && textOf(root).includes("Words with spaces go in quotes"));
    const before = state.notified;
    click(find(root, "ps-agent-pi"));
    assert.ok(state.notified > before, "it redraws");
    assert.equal(textOf(draw(view)).includes("Words with spaces go in quotes"), false);
    root = draw(view);
    click(find(root, "ps-agent-own"));
    type(w.agentCommand, "my-agent --model 'big one'");
    type(w.agentName, "");
    await settle();
    assert.deepEqual(state.shared.get(KEYS.agents), { name: "my-agent", argv: ["my-agent", "--model", "big one"] });
    type(w.agentCommand, "my-agent 'oops");
    root = draw(view);
    assert.ok(textOf(root).includes("quote that isn't closed"));
    await settle();
    assert.deepEqual(state.shared.get(KEYS.agents).argv, ["my-agent", "--model", "big one"], "not saved");
    root = draw(view);
    click(find(root, "ps-where-1"));
    assert.equal(state.shared.get(KEYS.agents).where, "right");
    assert.deepEqual(state.violations, []);
  });

  test(`${name}: Esc closes a drop-down first, then the window; ✕ closes it; text waiting is saved when it goes`, async () => {
    const view = await windowView("open-with");
    let root = draw(view);
    drop(root, "ps-pick-line");
    const key = (k) => { const cx = makeCx(); root.$.handlers.on_key_down[0][0]({ key: k, keystroke: k, modifiers: {} }, cx); return cx; };
    root = draw(view);
    assert.ok(has(root, "ps-pick-line-0"));
    key("escape");
    root = draw(view);
    assert.equal(has(root, "ps-pick-line-0"), false);
    assert.deepEqual(state.closed, []);
    // A press outside an open drop-down closes it too.
    drop(root, "ps-pick-open");
    root = draw(view);
    drop(root, "ps-pick-open", false);
    root = draw(view);
    assert.equal(has(root, "ps-pick-open-0"), false);
    key("escape");
    assert.deepEqual(state.closed, ["o9"]);
    click(find(draw(view), "ps-close"));
    assert.deepEqual(state.closed, ["o9", "o9"]);
    // Herdr closes the window while a text field waits: what was typed is kept.
    const agents = await windowView("agents"), w = part(agents);
    click(find(draw(agents), "ps-agent-own"));
    type(w.agentCommand, "my-agent --fast");
    await agents.close(makeCx("async"));
    assert.deepEqual(state.shared.get(KEYS.agents)?.argv, ["my-agent", "--fast"]);
    assert.deepEqual(state.violations, []);
  });
}
