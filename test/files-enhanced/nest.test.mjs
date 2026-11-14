import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { Nesting } = await mod("nest.js");
const { NEST } = await mod("panelsettings.js");

const groups = (rules, files) => Object.fromEntries(new Nesting(rules).nest(files));

test("the default rules", () => {
  const files = ["package.json", "package-lock.json", "pnpm-lock.yaml", "README.md", "a.ts", "a.js", "a.d.ts", "a.js.map", "b.tsx", "b.js", ".env", ".env.local", ".env.production", "Cargo.toml", "Cargo.lock", "go.mod", "go.sum", "c.js"];
  assert.deepEqual(groups(NEST, files), {
    "package.json": ["package-lock.json", "pnpm-lock.yaml"],
    "a.ts": ["a.js", "a.d.ts", "a.js.map"],
    "b.tsx": ["b.js"],
    ".env": [".env.local", ".env.production"],
    "Cargo.toml": ["Cargo.lock"],
    "go.mod": ["go.sum"],
  });
});

test("$(capture), a child's child, two parents, no parent of itself", () => {
  // VS Code's own example: *.ts nests $(capture).*.ts and $(capture).js; *.js nests $(capture).min.js.
  const rules = { "*.ts": ["$(capture).*.ts", "$(capture).js"], "*.js": ["$(capture).min.js"] };
  assert.deepEqual(groups(rules, ["a.ts", "a.d.ts", "a.js", "a.min.js", "b.ts", "b.min.js"]), { "a.ts": ["a.d.ts", "a.js", "a.min.js"] });
  // A file both could claim goes to the first listed.
  assert.deepEqual(groups({ "x.json": ["shared.lock"], "y.json": ["shared.lock"] }, ["x.json", "y.json", "shared.lock"]), { "x.json": ["shared.lock"] });
  // A pattern matching its own parent doesn't nest it under itself.
  assert.deepEqual(groups({ "*.md": ["*.md"] }, ["a.md"]), {});
  // Two stars can't be read: left out.
  assert.deepEqual(groups({ "*.*": ["x"], "a": ["*.b.*"] }, ["a", "x", "c.b.d"]), {});
  assert.deepEqual(groups({}, ["a"]), {});
});
