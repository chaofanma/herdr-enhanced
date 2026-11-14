import { test } from "node:test";
import assert from "node:assert/strict";
import { KEYS, NEST, settingsOf, storedOf } from "../../shared/panelsettings.js";
import { linesOf, listOf, nestText, nestOf, STEPS, stepped, canStep, minutes, AGENT_PRESETS, presetOf, customAgent, startCommand } from "../../shared/fields.js";

test("the Never list: one name or glob per line", () => {
  assert.deepEqual(listOf("node_modules\n  *.log  \n\n\ndist\nnode_modules\n"), ["node_modules", "*.log", "dist"]);
  assert.deepEqual(listOf(""), []);
  assert.equal(linesOf(["a", "b/*.c"]), "a\nb/*.c");
  assert.deepEqual(listOf(linesOf(["a", "b"])), ["a", "b"]);
  // An empty list is the default, so nothing is stored.
  assert.equal(storedOf(KEYS.files, { ...settingsOf(KEYS.files), exclude: listOf(" \n") }), null);
});

test("nesting rules: saved only when the Files page would keep them", () => {
  assert.deepEqual(nestOf(nestText(NEST)), { nest: NEST });
  assert.equal(nestText({ "a.json": ["b.json", "c.json"], "*.ts": ["$(base).js"] }), '{\n  "a.json": ["b.json", "c.json"],\n  "*.ts": ["$(base).js"]\n}');
  assert.equal(nestText(NEST).split("\n").length, Object.keys(NEST).length + 2, "one rule a line");
  assert.equal(nestText({}), "{}");
  assert.deepEqual(nestOf(nestText({})), { nest: {} });
  assert.deepEqual(nestOf('{ "a.json": ["b.json"] }'), { nest: { "a.json": ["b.json"] } });
  assert.deepEqual(nestOf("  "), { nest: {} });
  assert.match(nestOf('{ "a.json": ["b.json"] ').error, /^Not saved: this isn't JSON yet/);
  assert.match(nestOf('["a"]').error, /one \{ … \} object/);
  assert.match(nestOf("null").error, /one \{ … \} object/);
  assert.match(nestOf('{ "a.json": "b.json" }').error, /"a.json" needs a list/);
  assert.match(nestOf('{ "a.json": ["b", 2] }').error, /needs a list/);
  // The default rules, typed back, store nothing.
  assert.equal(storedOf(KEYS.files, { ...settingsOf(KEYS.files), nest: nestOf(nestText(NEST)).nest }), null);
});

test("steppers move between steps, and from values in between", () => {
  const s = STEPS.freshMinutes;
  assert.equal(stepped(s, 10, 1), 15);
  assert.equal(stepped(s, 10, -1), 5);
  assert.equal(stepped(s, 7, 1), 10);
  assert.equal(stepped(s, 7, -1), 5);
  assert.equal(stepped(s, 0, -1), 0);
  assert.equal(stepped(s, 240, 1), 240);
  assert.equal(stepped(s, 999, -1), 240);
  assert.equal(canStep(s, 0, -1), false);
  assert.equal(canStep(s, 0, 1), true);
  assert.deepEqual(STEPS.repoDepth, [0, 1, 2, 3, 4]);
  // Every default is a step.
  const f = settingsOf(KEYS.files), c = settingsOf(KEYS.changes);
  assert.ok(STEPS.freshMinutes.includes(f.freshMinutes) && STEPS.autoFetch.includes(c.autoFetch) && STEPS.turnsKeep.includes(c.turnsKeep) && STEPS.repoDepth.includes(c.repoDepth));
});

test("minutes read as people say them", () => {
  assert.equal(minutes(0, "Off"), "Off");
  assert.equal(minutes(1, "Off"), "1 minute");
  assert.equal(minutes(15, "Never"), "15 minutes");
  assert.equal(minutes(60, "Never"), "1 hour");
  assert.equal(minutes(120, "Never"), "2 hours");
  assert.equal(minutes(90, "Never"), "90 minutes");
});

test("agents: presets by the command they run, or one of the person's own", () => {
  assert.equal(presetOf(settingsOf(KEYS.agents)).name, "pi", "the default is the pi preset");
  assert.equal(presetOf({ name: "Claude", argv: ["claude"] }).name, "claude");
  assert.equal(presetOf({ name: "x", argv: ["claude", "--resume"] }), null);
  // The pi preset is the default, so choosing it stores nothing.
  assert.equal(storedOf(KEYS.agents, { ...settingsOf(KEYS.agents), ...AGENT_PRESETS[0] }), null);
  assert.deepEqual(storedOf(KEYS.agents, { ...settingsOf(KEYS.agents), ...AGENT_PRESETS[2] }), { name: "codex", argv: ["codex"] });
  assert.deepEqual(customAgent(" Mine ", "my-agent --model 'big one'"), { name: "Mine", argv: ["my-agent", "--model", "big one"] });
  assert.deepEqual(customAgent("", "/opt/bin/agent --fast"), { name: "agent", argv: ["/opt/bin/agent", "--fast"] });
  assert.match(customAgent("x", "  ").error, /Type the command/);
  assert.match(customAgent("x", "a 'b").error, /quote/);
});

test("the agent starts in a new tab with the question, or right of the focused pane with it as an argument", () => {
  assert.deepEqual(startCommand({ argv: ["pi"], where: "tab" }, "why?", "s1"), ["tab.new", { space: "s1", argv: ["pi"], task: "why?" }]);
  assert.deepEqual(startCommand({ argv: ["claude", "--model", "x"], where: "right" }, "why?", "s1"), ["terminal.open", { argv: ["claude", "--model", "x", "why?"], place: "right" }]);
  assert.deepEqual(startCommand({ argv: ["pi"], where: "right" }, "", "s1"), ["terminal.open", { argv: ["pi"], place: "right" }]);
  const argv = ["pi"];
  startCommand({ argv, where: "right" }, "q", "s1");
  assert.deepEqual(argv, ["pi"], "the settings' argv is not changed");
});
