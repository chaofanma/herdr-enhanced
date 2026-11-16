// The git modules are pure: they import only other modules of this folder that are pure
// too (no Herdr, no node built-ins such as buffer or fs), and use no node globals (Buffer,
// process, require). Herdr's mod runtime is not node; these run there and in other copies alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MOD } from "./mod.mjs";

const GIT_MODULES = ["gitplan.js", "conflicts.js", "pullsync.js", "remoteops.js", "worktrees.js", "linestage.js", "blame.js", "reflog.js",
  "branchops.js", "stashops.js", "commitsel.js", "patches.js", "fileat.js", "bisect.js", "tagops.js"];

const source = (name) => readFileSync(join(MOD, name), "utf8");
const importsOf = (text) => [...text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
// Comments and strings can mention Buffer or process; the code can't.
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');

function impurity(name, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  const text = source(name);
  for (const spec of importsOf(text)) {
    if (!/^\.\/[\w-]+\.js$/.test(spec)) return `${name} imports ${spec}`;
    const why = impurity(spec.slice(2), seen);
    if (why) return `${name} → ${why}`;
  }
  const global = /\b(Buffer|process|require|TextEncoder|TextDecoder|setTimeout|globalThis)\b/.exec(code(text));
  return global ? `${name} uses ${global[1]}` : null;
}

test("the git modules import only pure modules of this folder and use no node globals", () => {
  const present = GIT_MODULES.filter((n) => existsSync(join(MOD, n)));
  assert.ok(present.includes("gitplan.js"));
  for (const name of present) assert.equal(impurity(name), null, name);
  // The check sees an impure import through another module.
  assert.match(impurity("hunk.js"), /scripts\.js imports buffer/);
});
