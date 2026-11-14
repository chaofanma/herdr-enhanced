import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { DETACH } = await mod("detach.js");

const run = (...argv) => { const t = Date.now(); const r = spawnSync("sh", ["-c", DETACH, "sh", ...argv], { encoding: "utf8" }); return { ...r, ms: Date.now() - t }; };

test("a command that fails at once: its code and stderr", () => {
  const r = run("sh", "-c", "echo 'no such file' >&2; exit 3");
  assert.equal(r.status, 3); assert.match(r.stderr, /no such file/); assert.ok(r.ms < 1500);
});

test("a command that hands off and leaves: 0 at once", () => {
  const r = run("true");
  assert.equal(r.status, 0); assert.ok(r.ms < 1500);
});

test("a command that stays open: 0 after about two seconds, and it keeps running", () => {
  // A shell that sleeps, found again by the mark in its arguments (no perl: the mod uses only sh).
  const mark = `files-enhanced-detach-test-${process.pid}`;
  const r = run("sh", "-c", "sleep 30; : $0", mark);
  assert.equal(r.status, 0); assert.ok(r.ms >= 1900 && r.ms < 4000, `took ${r.ms} ms`);
  const alive = spawnSync("pgrep", ["-f", mark], { encoding: "utf8" }).stdout.trim();
  assert.ok(alive, "the program still runs after sh left");
  // Its sleep first, then the shell.
  for (const pid of alive.split("\n")) { spawnSync("pkill", ["-P", pid]); try { process.kill(Number(pid)); } catch {} }
});

test("arguments with spaces and quotes reach the command unchanged", () => {
  const out = join(tempDir("files-enhanced-detach-"), "args");
  const r = run("sh", "-c", 'printf "%s|" "$@" > "$0"', out, "a b", "it's", '"q"', "$HOME");
  assert.equal(r.status, 0);
  assert.equal(readFileSync(out, "utf8"), `a b|it's|"q"|$HOME|`);
});
