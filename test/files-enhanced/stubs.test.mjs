// The stubs' guard (render/stubs.mjs): a test never starts a program that shows something on the
// screen (an app, a file, Finder, the Trash) or asks an AI provider (an agent's CLI), nor a script
// handed one to run, nor the Open with launcher (detach.js). The scripts here would exit 7 if they ran.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { stubs } from "./render/load.mjs";

const { DETACH } = await import("./mod.mjs").then(({ mod }) => mod("detach.js"));

test("the stubs answer launchers and agent CLIs themselves, also when sh or perl would run them", async () => {
  for (const program of ["zed", "open", "osascript", "pi", "claude", "codex", "opencode"]) {
    const r = await stubs.exec("sh", ["-c", "exit 7", "sh", program, "/tmp/x"]);
    assert.equal(r.code, 0, `sh … ${program} isn't run`);
  }
  assert.equal((await stubs.exec("sh", ["-c", DETACH, "sh", "true"])).code, 0, "the Open with launcher");
  assert.equal((await stubs.exec("sh", ["-c", "exit 7", "sh", "plain"])).code, 7, "other scripts run");
  assert.equal((await stubs.exec("sh", ["-c", 'for c in "$@"; do :; done; exit 7', "sh", "git", "zed", "pi"])).code, 7, "a probe that looks programs up runs");
});

test("the stubs' app folder holds no other mod: every test here runs with git-enhanced absent", () => {
  const mods = join(stubs.appHome(), "mods");
  assert.deepEqual(existsSync(mods) ? readdirSync(mods) : [], []);
});
