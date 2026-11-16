import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { openAt, lineMenu } = await mod("openat.js");
const { lineFor } = await mod("diffopts.js");

const found = (cli = [], app = []) => ({ cli: new Set(cli), app: new Set(app) });

test("what Open at line runs", () => {
  const path = "/r/src/a.js";
  assert.deepEqual(openAt({ openWith: { line: "system" }, found: found(), path, line: 7, platform: "macos" }), { kind: "system", name: "the default app", argv: ["open", path] });
  assert.deepEqual(openAt({ openWith: { line: "system" }, found: found(), path, line: 7, platform: "linux" }).argv, ["xdg-open", path]);
  // The default items have Zed (an app) and Neovim (a pane).
  assert.deepEqual(openAt({ openWith: { line: "zed", items: null }, found: found(["zed"]), path, line: 7, platform: "macos" }), { kind: "app", argv: ["zed", `${path}:7`], folder: "/r/src", name: "Zed" });
  assert.deepEqual(openAt({ openWith: { line: "nvim", items: null }, found: found(["nvim"]), path, line: 7, platform: "macos" }), { kind: "pane", argv: ["nvim", "+7", path], folder: "/r/src", name: "Neovim" });
  // Not on this computer: the system's opener, saying which was missing.
  const missing = openAt({ openWith: { line: "zed", items: null }, found: found(), path, line: 7, platform: "macos" });
  assert.equal(missing.kind, "system"); assert.equal(missing.missing, "Zed");
  // A person's own item, and one turned off.
  const mine = [{ id: "mine", name: "Mine", kind: "app", for: "files", cli: "mine", argv: ["mine", "{file}"], argvLine: ["mine", "--at", "{line}", "{file}"] }];
  assert.deepEqual(openAt({ openWith: { line: "mine", items: mine }, found: found(["mine"]), path, line: 3, platform: "macos" }).argv, ["mine", "--at", "3", path]);
  assert.equal(openAt({ openWith: { line: "mine", items: [{ ...mine[0], enabled: false }] }, found: found(["mine"]), path, line: 3, platform: "macos" }).kind, "system");
});

test("the row's menu", () => {
  const plan = { kind: "app", name: "Zed" };
  assert.deepEqual(lineMenu({ kind: "+", line: 12, local: true, exists: true, plan }).map((i) => [i.id, i.label, i.detail, Boolean(i.disabled)]), [
    ["ask", "Ask about line 12…", "Sends it to the space's agent", false], ["open", "Open at line 12", "in Zed", false]]);
  assert.equal(lineMenu({ kind: "@", line: 3, local: true, exists: true, plan })[0].label, "Ask about this hunk…");
  assert.equal(lineMenu({ kind: "-", line: 3, local: true, exists: true, plan })[0].label, "Ask about this removed line…");
  assert.match(lineMenu({ kind: "+", line: 3, local: true, exists: true, plan: { kind: "system", missing: "Zed" } })[1].detail, /^Zed isn't here: the default app opens the file, not the line$/);
  assert.deepEqual(lineMenu({ kind: "+", line: 3, local: false, exists: true, plan: null })[1], { id: "open", label: "Open at line 3", detail: "Only for this computer's repositories", disabled: true });
  assert.equal(lineMenu({ kind: "+", line: 3, local: true, exists: false, plan })[1].disabled, true);
});

test("the line a row opens at", () => {
  const rows = [
    { kind: "@", text: "@@ -10,6 +10,5 @@ f()" },
    { kind: " ", number: 10 }, { kind: "-", number: 11 }, { kind: "-", number: 12 }, { kind: "+", number: 11 }, { kind: " ", number: 12 },
    { kind: "", text: "⋯ 30 lines" },
    { kind: "@", text: "@@ -50,3 +45,1 @@" }, { kind: " ", number: 45 }, { kind: "-", number: 51 }, { kind: "-", number: 52 },
    { kind: "@", text: "@@ -1,2 +0,0 @@" }, { kind: "-", number: 1 },
  ];
  assert.equal(lineFor(rows, 0), 10, "a hunk: its first line");
  assert.equal(lineFor(rows, 1), 10);
  assert.equal(lineFor(rows, 2), 11, "a removed line: the next new one");
  assert.equal(lineFor(rows, 4), 11);
  assert.equal(lineFor(rows, 6), null, "a gap row");
  assert.equal(lineFor(rows, 9), 45, "removed at the hunk's end: the one before");
  assert.equal(lineFor(rows, 12), 1, "a file emptied: its first line");
  assert.equal(lineFor(rows, 99), null);
});

test("running the plan, and looking for programs once in a while", async () => {
  const { runPlan, programFinder } = await mod("openat.js");
  const calls = [], runs = [];
  const exec = async (cmd, args, opts) => { calls.push([cmd, args, opts]); return cmd === "bad" ? { code: 1, stdout: "", stderr: "no such thing\nmore" } : { code: 0, stdout: cmd === "sh" ? "cli zed\n" : "", stderr: "" }; };
  assert.equal(await runPlan({ kind: "app", argv: ["zed", "/r/a:3"], folder: "/r" }, { exec, run: (...a) => runs.push(a) }), null);
  assert.deepEqual(calls.at(-1), ["zed", ["/r/a:3"], { cwd: "/r" }]);
  assert.equal(await runPlan({ kind: "pane", argv: ["nvim", "+3", "/r/a"], folder: "/r" }, { exec, run: (...a) => runs.push(a) }), null);
  assert.deepEqual(runs.at(-1), ["terminal.open", { argv: ["nvim", "+3", "/r/a"], folder: "/r", place: "right" }]);
  assert.equal(await runPlan({ kind: "system", argv: ["bad", "/r/a"] }, { exec, run: () => {} }), "no such thing");
  const programs = programFinder(exec, 1000);
  const before = calls.length;
  assert.ok((await programs([])).cli.has("zed"));
  await programs([]);
  assert.equal(calls.length, before + 1, "looked for once within the ttl");
});
