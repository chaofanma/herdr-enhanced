// The tests never touch the repository they are started from: no-outer-git.mjs takes git's variables
// (GIT_DIR from a hook or `git rebase --exec`, …) out of the environment, and every test file that can
// start a program loads it, itself or through a helper.
import "./no-outer-git.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEST = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRUB = join(TEST, "shared", "no-outer-git.mjs");

// Every module a file loads, its own and the platform's (node:…), following relative imports.
const IMPORTS = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
function reach(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  let src;
  try { src = readFileSync(file, "utf8"); } catch { return seen; }
  for (const m of src.matchAll(IMPORTS)) {
    const spec = m[1] ?? m[2];
    if (spec.startsWith(".")) reach(resolve(dirname(file), spec), seen);
    else seen.add(spec);
  }
  return seen;
}

test("every test file that can start a program loads no-outer-git.mjs (itself or through a helper)", () => {
  const files = readdirSync(TEST, { withFileTypes: true }).filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(join(TEST, d.name)).filter((f) => f.endsWith(".test.mjs")).map((f) => join(TEST, d.name, f)));
  const starters = files.filter((f) => { const r = reach(f); return r.has("node:child_process") || r.has("child_process"); });
  assert.ok(starters.length >= 40, `the test files that start programs found (${starters.length})`);
  assert.deepEqual(starters.filter((f) => !reach(f).has(SCRUB)).map((f) => relative(TEST, f)), []);
});

// A repository standing for the one the tests were started from; what a stray git call would change.
function outerRepo() {
  const base = mkdtempSync(join(tmpdir(), "no-outer-git-"));
  const outer = join(base, "outer");
  const git = (...a) => execFileSync("git", a, { cwd: base, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  git("init", "-q", "-b", "main", outer);
  git("-C", outer, "config", "user.name", "Outer"); git("-C", outer, "config", "user.email", "outer@x");
  writeFileSync(join(outer, "o.txt"), "o\n");
  git("-C", outer, "add", "-A"); git("-C", outer, "commit", "-qm", "Outer");
  const state = () => [readFileSync(join(outer, ".git", "config"), "utf8"), git("-C", outer, "for-each-ref"), git("-C", outer, "log", "--all", "--format=%H %an %s")].join("\n");
  return { base, outer, state };
}

// A test's way with git: a repository of its own in the temp folder, its identity, a commit, a tag.
const probe = (scrubbed) => `${scrubbed ? `import ${JSON.stringify(pathToFileURL(SCRUB).href)};\n` : ""}
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const d = mkdtempSync(join(tmpdir(), "no-outer-git-probe-"));
const git = (...a) => execFileSync("git", a, { cwd: d, stdio: "ignore" });
git("init", "-q"); git("config", "user.name", "Probe"); git("config", "user.email", "probe@x");
writeFileSync(join(d, "p.txt"), "p\\n"); git("add", "-A"); git("commit", "-qm", "Probe"); git("tag", "probe");
`;
const run = (scrubbed, outer) => spawnSync(process.execPath, ["--input-type=module", "-e", probe(scrubbed)],
  { encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_DIR: join(outer, ".git") } });

test("with GIT_DIR set where the tests start, a test's git calls stay in its own folder", () => {
  const { base, outer, state } = outerRepo();
  try {
    const before = state();
    const r = run(true, outer);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(state(), before, "the outer repository as it was");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("without no-outer-git.mjs the same calls land in the outer repository (what it prevents)", () => {
  const { base, outer, state } = outerRepo();
  try {
    const before = state();
    run(false, outer);
    const after = state();
    assert.notEqual(after, before);
    assert.match(after, /name = Probe/, "its config rewritten");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
