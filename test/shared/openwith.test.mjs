import "./no-outer-git.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { KNOWN, DEFAULT_ITEMS, itemsOf, itemOf, detectScript, foundOf, availability, menuItems, labelOf, expand, commandFor } from "../../shared/openwith.js";

const found = (cli = [], app = []) => ({ cli: new Set(cli), app: new Set(app) });

test("the default list is today's menu", () => {
  assert.deepEqual(DEFAULT_ITEMS.map(i => [i.id, i.kind, i.for, i.enabled]),
    [["zed", "app", "both", true], ["nvim", "pane", "files", true], ["yazi", "pane", "folders", true], ["lazygit", "pane", "folders", true]]);
  assert.equal(new Set(KNOWN.map(k => k.id)).size, KNOWN.length);
});

test("stored lists are checked: bad items and repeated ids are dropped", () => {
  assert.deepEqual(itemsOf(null), DEFAULT_ITEMS);
  const mine = { id: "my-ed", name: " My editor ", kind: "app", for: "files", argv: ["myed", "{file}"] };
  assert.deepEqual(itemsOf([mine, { ...mine, name: "again" }, { id: "Bad id", name: "x", kind: "app", for: "files", argv: ["x"] }, { id: "y", name: "y", kind: "tab", for: "files", argv: ["y"] }]),
    [{ id: "my-ed", name: "My editor", kind: "app", for: "files", argv: ["myed", "{file}"], enabled: true }]);
  assert.equal(itemOf({ id: "z", name: "z", kind: "pane", for: "both", argv: [] }), null);
  assert.equal(itemOf({ id: "z", name: "z", kind: "pane", for: "both", argv: ["z"], enabled: false }).enabled, false);
});

test("the detection script runs and its output parses", () => {
  const script = detectScript([{ id: "my", name: "My", kind: "app", for: "files", argv: ["sh", "{file}"] }]);
  assert.match(script, /command -v/); assert.match(script, /"Visual Studio Code"/);
  const out = execFileSync("sh", ["-c", script], { encoding: "utf8" });
  const f = foundOf(out);
  assert.equal(f.cli.has("sh"), true);
  assert.deepEqual(foundOf("cli zed\napp Cursor\nnoise\n"), { cli: new Set(["zed"]), app: new Set(["Cursor"]) });
});

test("availability: the command, else the app bundle, else nothing", () => {
  const code = KNOWN.find(k => k.id === "vscode");
  assert.equal(availability(code, found(["code"])), "cli");
  assert.equal(availability(code, found([], ["Visual Studio Code"])), "app");
  assert.equal(availability(code, found()), null);
  assert.equal(availability(KNOWN.find(k => k.id === "nvim"), found([], ["Neovim"])), null);
  assert.equal(availability(KNOWN.find(k => k.id === "typora"), found([], ["Typora"])), "app");
});

test("menus show enabled, found, fitting items with today's labels", () => {
  const f = found(["zed", "nvim", "yazi"]);
  assert.deepEqual(menuItems(DEFAULT_ITEMS, f, false).map(m => m.label), ["Open in Zed", "Open in Neovim"]);
  assert.deepEqual(menuItems(DEFAULT_ITEMS, f, true).map(m => m.label), ["Open in Zed", "Open yazi here"]);
  const off = DEFAULT_ITEMS.map(i => (i.id === "zed" ? { ...i, enabled: false } : i));
  assert.deepEqual(menuItems(off, f, true).map(m => m.label), ["Open yazi here"]);
  assert.equal(labelOf(KNOWN.find(k => k.id === "vscode"), true), "Open in VS Code");
});

test("placeholders", () => {
  assert.deepEqual(expand(["e", "{path}", "{file}:{line}", "{folder}"], { path: "/r/src/a.js", dir: false, line: 12 }), ["e", "/r/src/a.js", "/r/src/a.js:12", "/r/src"]);
  assert.deepEqual(expand(["e", "{file}:{line}", "{folder}"], { path: "/r/src", dir: true }), ["e", "/r/src:1", "/r/src"]);
});

test("commands: a line uses argvLine; a bundle without its command opens with open -a", () => {
  const code = KNOWN.find(k => k.id === "vscode"), nvim = KNOWN.find(k => k.id === "nvim"), yazi = KNOWN.find(k => k.id === "yazi");
  assert.deepEqual(commandFor(code, found(["code"]), { path: "/r/a.js", line: 7 }), { kind: "app", argv: ["code", "-g", "/r/a.js:7"], folder: "/r" });
  assert.deepEqual(commandFor(code, found(["code"]), { path: "/r", dir: true }), { kind: "app", argv: ["code", "/r"], folder: "/r" });
  assert.deepEqual(commandFor(code, found([], ["Visual Studio Code"]), { path: "/r/a.js", line: 7 }), { kind: "app", argv: ["open", "-a", "Visual Studio Code", "/r/a.js"], folder: "/r" });
  assert.deepEqual(commandFor(nvim, found(["nvim"]), { path: "/r/a.js", line: 3 }), { kind: "pane", argv: ["nvim", "+3", "/r/a.js"], folder: "/r" });
  assert.deepEqual(commandFor(yazi, found(["yazi"]), { path: "/r/src", dir: true }), { kind: "pane", argv: ["yazi"], folder: "/r/src" });
  assert.equal(commandFor(yazi, found(), { path: "/r", dir: true }), null);
});

test("remote forms: Zed, VS Code and Cursor have theirs; a stored item keeps a valid one, an invalid one is dropped", async () => {
  const { remoteOf, remoteForm } = await import("../../shared/openwith.js");
  assert.deepEqual(KNOWN.filter(k => k.remote).map(k => k.id), ["zed", "vscode", "cursor"]);
  assert.deepEqual(KNOWN.find(k => k.id === "vscode").remote, { argv: ["code", "--remote", "ssh-remote+{host}", "{path}"], argvLine: ["code", "--remote", "ssh-remote+{host}", "-g", "{file}:{line}"], port: false });
  const mine = { id: "my-ed", name: "Mine", kind: "app", for: "files", argv: ["myed", "{file}"] };
  const form = { argv: ["myed", "--ssh", "{host}", "{path}"], argvLine: ["myed", "--ssh", "{host}", "{file}:{line}"], port: true };
  assert.deepEqual(itemOf({ ...mine, remote: form }).remote, form, "kept, all three fields");
  assert.deepEqual(itemOf({ ...mine, remote: { argv: ["myed", "{host}:{path}"] } }).remote, { argv: ["myed", "{host}:{path}"] });
  for (const bad of [null, "myed {host}", [], { argv: [] }, { argv: ["myed", 3] }, { argv: [" ", "{host}"] }, { argv: "myed" },
    { argv: ["myed"], argvLine: "x" }, { argv: ["myed"], argvLine: [] }, { argv: ["myed"], port: "no" }]) {
    const item = itemOf({ ...mine, remote: bad });
    assert.ok(item, `the item stays: ${JSON.stringify(bad)}`);
    assert.equal("remote" in item, false, `dropped: ${JSON.stringify(bad)}`);
  }
  assert.equal(remoteOf({ argv: ["x"], port: 1 }), null);
  assert.equal("remote" in itemOf({ ...mine, kind: "pane", remote: form }), false, "a pane program runs there itself");
  // Through itemsOf too, and a copy of a known program stored before they had one still has its form.
  assert.deepEqual(itemsOf([{ ...mine, remote: { argv: [1] } }]), [{ ...mine, enabled: true }]);
  const oldZed = { id: "zed", name: "Zed", kind: "app", for: "both", cli: "zed", argv: ["zed", "{path}"] };
  assert.deepEqual(remoteForm(itemsOf([oldZed])[0]), KNOWN[0].remote);
  // A remote form's program is looked for here too.
  assert.match(detectScript([{ ...mine, remote: { argv: ["myed-remote", "{host}"] } }]), /for c in [^;]* myed-remote[ ;]/);
});

test("your own program on another machine: offered with a remote form, built with {host}; left out without one", async () => {
  const { remoteMenuItems, remoteCommand } = await import("../../shared/openwith.js");
  const withForm = itemsOf([{ id: "my-ed", name: "Mine", kind: "app", for: "both", argv: ["myed", "{file}"], remote: { argv: ["myed", "--ssh", "{host}", "{file}:{line}"] } }])[0];
  const without = itemsOf([{ id: "plain", name: "Plain", kind: "app", for: "files", argv: ["plain", "{file}"] }])[0];
  const byPath = itemsOf([{ id: "pathed", name: "Pathed", kind: "app", for: "files", cli: "", argv: ["/opt/ed", "{file}"], remote: { argv: ["/opt/ed-ssh", "{host}", "{path}"], port: false } }])[0];
  const f = { here: found(["myed", "plain"]), there: found() };
  const labels = (host) => remoteMenuItems([withForm, without, byPath], f, false, host).map(m => m.item.id);
  assert.deepEqual(labels("me@box"), ["my-ed", "pathed"], "Plain has no form for another machine: left out");
  assert.deepEqual(labels("me@box:2222"), ["my-ed"], "port: false takes no target with a port");
  assert.deepEqual(labels(null), [], "no ssh target");
  assert.deepEqual(remoteCommand(withForm, f, { path: "/srv/a.js", dir: false, line: 4 }, "me@box"), { kind: "app", argv: ["myed", "--ssh", "me@box", "/srv/a.js:4"], folder: null });
  assert.deepEqual(remoteCommand(withForm, f, { path: "/srv/a.js", dir: false }, "me@box").argv, ["myed", "--ssh", "me@box", "/srv/a.js:1"]);
  assert.deepEqual(remoteCommand(byPath, f, { path: "/srv", dir: true }, "box").argv, ["/opt/ed-ssh", "box", "/srv"]);
  assert.equal(remoteCommand(without, f, { path: "/srv/a.js", dir: false }, "me@box"), null);
  assert.equal(remoteCommand(withForm, { here: found(), there: found() }, { path: "/srv/a.js", dir: false }, "me@box"), null, "its program isn't here");
});
