import { test } from "node:test";
import assert from "node:assert/strict";
import { KEYS, SCHEMA, NEST, settingsOf, storedOf, choicesOf } from "../../shared/panelsettings.js";

test("the groups' shared keys", () => {
  assert.deepEqual(KEYS, { openWith: "herdr-enhanced.open-with", files: "files-enhanced.settings", changes: "git-enhanced.settings", agents: "herdr-enhanced.agents" });
});

test("nothing stored: every field is its default (today's behaviour)", () => {
  const f = settingsOf(KEYS.files, undefined);
  assert.equal(f.hidden, true); assert.deepEqual(f.exclude, []); assert.equal(f.ignored, "show");
  assert.equal(f.sort, "name"); assert.equal(f.foldersFirst, true); assert.equal(f.follow, true);
  assert.equal(f.freshMinutes, 10); assert.equal(f.markdown, "rendered"); assert.equal(f.icons, true);
  assert.equal(f.compact, true); assert.equal(f.nesting, false); assert.deepEqual(f.nest, NEST); assert.equal(f.repoDepth, 1);
  const c = settingsOf(KEYS.changes, null);
  assert.equal(c.context, 3); assert.equal(c.autoFetch, 0); assert.equal(c.askStageAll, true); assert.equal(c.turns, true);
  assert.equal(c.commitAgent, "pi"); assert.deepEqual(c.commitCommand, []); assert.equal(c.repoDepth, 1);
  assert.deepEqual(settingsOf(KEYS.agents, "junk"), { name: "pi", argv: ["pi"], where: "tab" });
  assert.deepEqual(settingsOf(KEYS.openWith, []), { items: null, double: "system", open: "system", line: "system" });
});

test("valid stored fields are kept, invalid ones fall back, unknown ones are dropped", () => {
  const f = settingsOf(KEYS.files, { hidden: false, sort: "size", freshMinutes: -3, exclude: ["dist", 4], ignored: "dim", extra: 1 });
  assert.equal(f.hidden, false); assert.equal(f.sort, "name"); assert.equal(f.freshMinutes, 10);
  assert.deepEqual(f.exclude, []); assert.equal(f.ignored, "dim"); assert.equal("extra" in f, false);
  assert.equal(settingsOf(KEYS.changes, { context: "file" }).context, "file");
  assert.equal(settingsOf(KEYS.changes, { context: 7 }).context, 3);
  assert.equal(settingsOf(KEYS.changes, { commitAgent: "codex" }).commitAgent, "codex");
  assert.equal(settingsOf(KEYS.changes, { commitAgent: "gemini" }).commitAgent, "pi");
  assert.deepEqual(settingsOf(KEYS.changes, { commitCommand: ["claude", "-p", "{prompt}"] }).commitCommand, ["claude", "-p", "{prompt}"]);
  assert.deepEqual(settingsOf(KEYS.files, { nest: { "a.json": ["b.json"] } }).nest, { "a.json": ["b.json"] });
  // Each group its own repoDepth: Files' for its git marks, Changes' for the repository switcher.
  assert.equal(settingsOf(KEYS.files, { repoDepth: 3 }).repoDepth, 3);
  assert.equal(settingsOf(KEYS.files, { repoDepth: -1 }).repoDepth, 1);
  assert.equal(settingsOf(KEYS.changes, { repoDepth: 2 }).repoDepth, 2);
  assert.deepEqual(settingsOf(KEYS.files, { nest: { "a.json": "b.json" } }).nest, NEST);
  assert.deepEqual(settingsOf(KEYS.openWith, { items: [{ id: "x" }] }).items, [{ id: "x" }]);
});

test("the defaults handed out are copies", () => {
  settingsOf(KEYS.files).exclude.push("dist");
  settingsOf(KEYS.files).nest["package.json"].push("x");
  assert.deepEqual(SCHEMA[KEYS.files].exclude, []);
  assert.equal(NEST["package.json"].includes("x"), false);
});

test("only the fields that differ from their defaults are stored", () => {
  assert.equal(storedOf(KEYS.files, settingsOf(KEYS.files)), null);
  assert.deepEqual(storedOf(KEYS.files, { ...settingsOf(KEYS.files), hidden: false, sort: "modified" }), { hidden: false, sort: "modified" });
  assert.deepEqual(storedOf(KEYS.agents, { argv: ["claude"], name: "claude" }), { argv: ["claude"], name: "claude" });
});

test("a field's choices", () => {
  assert.deepEqual(choicesOf(KEYS.files, "ignored"), ["show", "dim", "hide"]);
  assert.deepEqual(choicesOf(KEYS.changes, "context"), [3, 10, "file"]);
  assert.equal(choicesOf(KEYS.files, "hidden"), null);
  assert.throws(() => settingsOf("nope"), /no settings group/);
});
