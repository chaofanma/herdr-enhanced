import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOWN, DEFAULT_ITEMS, itemsOf } from "../../shared/openwith.js";
import { KEYS, settingsOf } from "../../shared/panelsettings.js";
import {
  GROUPS, groupOf, isOwn, rowsOf, tick, untick, move, listValue, choicesOf, pickersFor, storedWith, idFor,
  blankDraft, draftOf, itemOfDraft, addOwn, editOwn, removeOwn, statusOf, commandOf, menusOf,
} from "../../shared/openlist.js";

const ids = (items) => items.map((i) => `${i.id}${i.enabled ? "" : "(off)"}`);
const found = (cli = [], app = []) => ({ cli: new Set(cli), app: new Set(app) });
const defaults = () => itemsOf(null);
const S = (stored) => settingsOf(KEYS.openWith, stored);
// The window's round trip: what it stores, read back the way every mod reads it.
const saved = (settings, items) => { const stored = storedWith(settings, items); return { stored, items: itemsOf(S(stored).items) }; };

test("every known program is in one of the window's groups", () => {
  assert.deepEqual(GROUPS.map((g) => g.title), ["Apps", "In a pane: files", "In a pane: folders", "Your own"]);
  const by = (g) => KNOWN.filter((k) => groupOf(k) === g).map((k) => k.id);
  assert.deepEqual(by("apps"), ["zed", "vscode", "cursor", "sublime", "idea", "pycharm", "webstorm", "xcode", "typora"]);
  assert.deepEqual(by("files"), ["nvim", "vim", "helix", "micro", "emacs", "nano"]);
  assert.deepEqual(by("folders"), ["yazi", "ranger", "lf", "nnn", "broot", "lazygit", "gitui", "tig"]);
  assert.equal(by("own").length, 0);
  assert.equal(groupOf({ id: "my-ed", kind: "app", for: "files", argv: ["x"] }), "own");
  // A stored copy of a known program stays in its group whatever it says.
  assert.equal(groupOf({ id: "nvim", kind: "app", for: "both", argv: ["nvim"] }), "files");
  assert.equal(isOwn(KNOWN[0]), false);
});

test("rows: ticked first in menu order, then the rest in a fixed order", () => {
  const rows = rowsOf(defaults(), "apps");
  assert.deepEqual(rows.map((r) => [r.item.id, r.ticked]).slice(0, 3), [["zed", true], ["vscode", false], ["cursor", false]]);
  assert.equal(rows.length, 9);
  assert.deepEqual([rows[0].first, rows[0].last], [true, true]);
  const list = tick(tick(defaults(), "xcode"), "vscode");
  assert.deepEqual(rowsOf(list, "apps").filter((r) => r.ticked).map((r) => r.item.id), ["zed", "xcode", "vscode"]);
  const off = untick(list, "zed");
  const apps = rowsOf(off, "apps");
  assert.deepEqual(apps.filter((r) => r.ticked).map((r) => r.item.id), ["xcode", "vscode"]);
  assert.deepEqual(apps.filter((r) => !r.ticked).map((r) => r.item.id).slice(0, 3), ["zed", "cursor", "sublime"]);
  assert.deepEqual(rowsOf(defaults(), "folders").filter((r) => r.ticked).map((r) => [r.item.id, r.first, r.last]), [["yazi", true, false], ["lazygit", false, true]]);
});

test("ticking adds a copy at the end; unticking keeps the place; the default list stores as null", () => {
  const added = tick(defaults(), "vscode");
  assert.deepEqual(ids(added), ["zed", "nvim", "yazi", "lazygit", "vscode"]);
  assert.deepEqual(added[4], { ...KNOWN.find((k) => k.id === "vscode"), enabled: true });
  assert.deepEqual(ids(untick(added, "vscode")), ["zed", "nvim", "yazi", "lazygit", "vscode(off)"]);
  assert.deepEqual(ids(tick(untick(added, "nvim"), "nvim")), ids(added));
  // The default state, however it was reached, is stored as nothing at all.
  assert.equal(listValue(defaults()), null);
  assert.equal(storedWith(S(null), tick(untick(defaults(), "zed"), "zed")), null);
  assert.equal(storedWith(S(null), itemsOf(JSON.parse(JSON.stringify(DEFAULT_ITEMS)))), null);
  // Anything else is stored, and reads back as it was.
  const r = saved(S(null), untick(defaults(), "zed"));
  assert.deepEqual(ids(r.items), ["zed(off)", "nvim", "yazi", "lazygit"]);
  assert.equal(storedWith(S(r.stored), tick(r.items, "zed")), null);
  assert.deepEqual(ids(saved(S(null), added).items), ids(added));
});

test("moving a ticked item past its neighbour in the group", () => {
  const list = tick(defaults(), "vscode");            // zed nvim yazi lazygit vscode
  assert.deepEqual(ids(move(list, "vscode", -1)), ["vscode", "zed", "nvim", "yazi", "lazygit"]);
  assert.deepEqual(ids(move(move(list, "vscode", -1), "vscode", 1)), ["zed", "vscode", "nvim", "yazi", "lazygit"]);
  assert.deepEqual(ids(move(list, "zed", -1)), ids(list), "nothing above it in Apps");
  assert.deepEqual(ids(move(list, "vscode", 1)), ids(list), "nothing below it in Apps");
  assert.deepEqual(ids(move(list, "nvim", -1)), ids(list), "nvim is alone in its group");
  // Switched-off items are passed over, and keep their own places.
  const off = untick(tick(list, "cursor"), "vscode");  // zed nvim yazi lazygit vscode(off) cursor
  assert.deepEqual(ids(move(off, "cursor", -1)), ["cursor", "zed", "nvim", "yazi", "lazygit", "vscode(off)"]);
  assert.deepEqual(ids(move(off, "vscode", -1)), ids(off), "an unticked item doesn't move");
  // Down and back up is the default list again, stored as null.
  const down = move(defaults(), "yazi", 1);
  assert.deepEqual(ids(down), ["zed", "nvim", "lazygit", "yazi"]);
  assert.equal(storedWith(S(null), move(down, "yazi", -1)), null);
});

test("picker choices: the ticked programs that open files, line-capable first for Open at a line", () => {
  const list = tick(tick(untick(defaults(), "nvim"), "typora"), "helix");   // zed nvim(off) yazi lazygit typora helix
  assert.deepEqual(choicesOf(list, "double").map((c) => c.value), ["system", "zed", "typora", "helix"]);
  assert.equal(choicesOf(list, "double")[0].label, "System default");
  const line = choicesOf(list, "line");
  assert.deepEqual(line.map((c) => [c.value, c.note]), [["system", ""], ["zed", ""], ["helix", ""], ["typora", "opens without the line"]]);
  // A picker whose program went away goes back to the system default.
  const s = { ...S(null), double: "helix", open: "zed", line: "helix" };
  assert.deepEqual(pickersFor(s, untick(list, "helix")), { ...s, double: "system", line: "system" });
  assert.deepEqual(saved(s, untick(list, "helix")).stored.open, "zed");
  assert.equal(saved(s, untick(list, "helix")).stored.double, undefined);
  assert.deepEqual(pickersFor({ ...S(null), double: "yazi" }, list).double, "system", "yazi opens folders only");
});

test("ids from names: lowercase, dashes, never taken", () => {
  assert.equal(idFor("My Editor", []), "my-editor");
  assert.equal(idFor("  Café  Pro!! ", []), "cafe-pro");
  assert.equal(idFor("Zed", []), "zed-2", "a known program's id");
  assert.equal(idFor("my editor", [{ id: "my-editor" }, { id: "my-editor-2" }]), "my-editor-3");
  assert.equal(idFor("편집기", []), "program");
  assert.equal(idFor("편집기", [{ id: "program" }]), "program-2");
});

test("own programs: added ticked at the end, edited in place, removed", () => {
  const draft = { ...blankDraft(), name: "My Editor", command: "open -a 'My Editor' {file}", line: "myed --goto {file}:{line}" };
  const added = addOwn(defaults(), draft, "/Users/me");
  assert.equal(added.id, "my-editor");
  assert.deepEqual(added.items.at(-1), { id: "my-editor", name: "My Editor", kind: "app", for: "files", argv: ["open", "-a", "My Editor", "{file}"], enabled: true, argvLine: ["myed", "--goto", "{file}:{line}"] });
  assert.deepEqual(rowsOf(added.items, "own").map((r) => [r.item.id, r.ticked]), [["my-editor", true]]);
  assert.deepEqual(draftOf(added.items.at(-1)), { name: "My Editor", command: "open -a 'My Editor' {file}", line: "myed --goto {file}:{line}", for: "files", kind: "app", remote: "" });
  // It survives the round trip through shared state.
  const back = saved(S(null), added.items).items;
  assert.deepEqual(back.at(-1), added.items.at(-1));

  const off = untick(added.items, "my-editor");
  const edited = editOwn(off, "my-editor", { ...draftOf(off.at(-1)), name: "Mine", kind: "pane", for: "both", line: "" }, "/Users/me");
  assert.deepEqual(edited.items.at(-1), { id: "my-editor", name: "Mine", kind: "pane", for: "both", argv: ["open", "-a", "My Editor", "{file}"], enabled: false });
  assert.deepEqual(ids(removeOwn(edited.items, "my-editor")), ids(defaults()));
  assert.deepEqual(ids(removeOwn(defaults(), "zed")), ids(defaults()), "known programs are unticked, not removed");
  assert.match(editOwn(defaults(), "zed", draft).error, /isn't in the list/);
});

test("own programs: what's wrong with a draft, and commands given by a path", () => {
  const draft = (over) => ({ ...blankDraft(), name: "X", command: "x {file}", ...over });
  assert.equal(itemOfDraft(draft({ name: "  " }), "x").error, "Give it a name.");
  assert.equal(itemOfDraft(draft({ command: "  " }), "x").error, "Type the command it runs.");
  assert.match(itemOfDraft(draft({ command: "x 'unclosed" }), "x").error, /quote/);
  assert.match(itemOfDraft(draft({ line: 'x "{file}' }), "x").error, /line command/);
  const viaPath = itemOfDraft(draft({ command: "~/bin/my ed {file}", line: "~/bin/my +{line} {file}" }), "x", "/Users/me").item;
  assert.deepEqual(viaPath.argv, ["/Users/me/bin/my", "ed", "{file}"]);
  assert.deepEqual(viaPath.argvLine, ["/Users/me/bin/my", "+{line}", "{file}"]);
  assert.equal(viaPath.cli, "", "not looked for");
  assert.equal(statusOf(viaPath, null), "unchecked");
  assert.equal(itemOfDraft(draft({ command: "x {file}" }), "x").item.cli, undefined, "looked for by its name");
});

test("own programs: a command for a file on another machine (over ssh), for an app only", () => {
  const draft = (over) => ({ ...blankDraft(), name: "X", command: "x {file}", ...over });
  const item = itemOfDraft(draft({ remote: "~/bin/x --ssh {host} '{file}:{line}'" }), "x", "/Users/me").item;
  assert.deepEqual(item.remote, { argv: ["/Users/me/bin/x", "--ssh", "{host}", "{file}:{line}"] });
  assert.equal(draftOf(item).remote, "/Users/me/bin/x --ssh {host} {file}:{line}", "shown as a command line again");
  assert.equal("remote" in itemOfDraft(draft({ remote: "  " }), "x").item, false, "empty: none");
  assert.equal("remote" in itemOfDraft(draft({ kind: "pane", remote: "x {host}" }), "x").item, false, "a pane program needs none");
  assert.match(itemOfDraft(draft({ remote: "x '{host}" }), "x").error, /another machine has a quote/);
  assert.match(itemOfDraft(draft({ remote: "x {file}" }), "x").error, /needs \{host\}/);
  // Edited: the form follows the draft.
  const added = addOwn(defaults(), draft({ remote: "x {host} {path}" }), "/Users/me");
  assert.deepEqual(added.items.at(-1).remote, { argv: ["x", "{host}", "{path}"] });
  assert.equal("remote" in editOwn(added.items, added.id, { ...draftOf(added.items.at(-1)), remote: "" }, "/Users/me").items.at(-1), false);
});

test("a row's status and command", () => {
  const k = (id) => KNOWN.find((x) => x.id === id);
  assert.equal(statusOf(k("vscode"), null), null);
  assert.equal(statusOf(k("vscode"), found(["code"])), "found");
  assert.equal(statusOf(k("vscode"), found([], ["Visual Studio Code"])), "app");
  assert.equal(statusOf(k("vscode"), found()), "missing");
  assert.equal(statusOf(k("typora"), found([], ["Typora"])), "found", "Typora never opens at a line");
  assert.equal(statusOf(k("typora"), found()), "missing");
  assert.equal(statusOf(k("nvim"), found(["nvim"])), "found");
  assert.equal(commandOf(k("vscode"), found(["code"])), "code {path}");
  assert.equal(commandOf(k("vscode"), found([], ["Visual Studio Code"])), "open -a 'Visual Studio Code' {path}");
  assert.equal(commandOf(k("vscode"), null), "code {path}");
  assert.equal(commandOf(k("emacs"), found()), "emacs -nw {file}");
});

test("what the menus show now", () => {
  const list = tick(defaults(), "vscode");
  assert.deepEqual(menusOf(list, found(["zed", "nvim", "yazi", "code"])), { files: ["Zed", "Neovim", "VS Code"], folders: ["Zed", "yazi", "VS Code"] });
  assert.deepEqual(menusOf(move(list, "vscode", -1), found(["zed", "code"])), { files: ["VS Code", "Zed"], folders: ["VS Code", "Zed"] });
});
