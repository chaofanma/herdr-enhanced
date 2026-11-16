// The stubs' guard (render/stubs.mjs): only git, find and the mod's sh scripts run; any other
// program (an editor, an opener, an agent's CLI) is answered and counted as a violation, and so is a
// script that would start one: the pen's, or one handed such a program. The scripts here would exit
// 7 if they ran.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { state, stubs } from "./render/load.mjs";

test("the stubs answer launchers and agent CLIs themselves, also when a script would run them", async () => {
  const before = state.violations.length;
  for (const program of ["zed", "open", "pi", "claude", "codex", "opencode"]) {
    const r = await stubs.exec("sh", ["-c", "exit 7", "sh", program, "/tmp/x"]);
    assert.equal(r.code, 0, `sh … ${program} isn't run`);
  }
  assert.equal((await stubs.exec("false", [])).code, 0, "a program that isn't git or find is answered");
  assert.equal(state.violations.splice(before).length, 7, "each is a violation");
  assert.equal((await stubs.exec("sh", ["-c", "exit 7", "sh", "plain"])).code, 7, "other scripts run");
  assert.equal((await stubs.exec("sh", ["-c", 'for c in "$@"; do :; done; exit 7', "sh", "git", "zed", "pi"])).code, 7, "a probe that looks programs up runs");
  assert.equal(state.violations.length, before);
});

test("the stubs' app folder holds no other mod: every test here runs with files-enhanced absent", () => {
  const mods = join(stubs.appHome(), "mods");
  assert.deepEqual(existsSync(mods) ? readdirSync(mods) : [], []);
});
