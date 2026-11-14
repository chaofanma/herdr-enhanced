import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { mod, MOD, NAME } from "./mod.mjs";
const { iconFor } = await mod("icons.js");

const name = p => p.replace(`mods/${NAME}/icons/`, "").replace(".svg", "");

test("files: by name, then the longest extension, then the default", () => {
  const cases = { "a.ts": "typescript", "a.d.ts": "typescript-def", "a.spec.ts": "test-ts", "x.test.js": "test-js", "package.json": "nodejs", "Dockerfile": "docker",
    ".gitignore": "git", "README.md": "readme", "notes.md": "markdown", "x.unknown": "file", "Makefile": "makefile", "a.PY": "python", "run.pl": "perl",
    "vite.config.ts": "vite", ".eslintrc.json": "eslint", "tsconfig.json": "tsconfig", "Cargo.toml": "toml", "go.mod": "go-mod", "a.tsx": "react_ts", "a.sh": "console", ".env": "tune", "noext": "file" };
  for (const [n, icon] of Object.entries(cases)) assert.equal(name(iconFor(n)), icon, n);
});

test("folders: by name with . _ - and __ around, open variants, two names deep", () => {
  assert.equal(name(iconFor("src", true)), "folder-src");
  assert.equal(name(iconFor("src", true, true)), "folder-src-open");
  assert.equal(name(iconFor("SRC", true)), "folder-src");
  assert.equal(name(iconFor(".github", true)), "folder-github");
  assert.equal(name(iconFor("workflows", true, false, ".github/workflows")), "folder-gh-workflows");
  assert.equal(name(iconFor("workflows", true, false, "docs/workflows")), "folder");
  assert.equal(name(iconFor("__tests__", true)), "folder-test");
  assert.equal(name(iconFor("_config", true)), "folder-config");
  assert.equal(name(iconFor("node_modules", true, true)), "folder-node-open");
  assert.equal(name(iconFor("misc-stuff", true)), "folder");
  assert.equal(name(iconFor("misc-stuff", true, true)), "folder-open");
});

test("light themes get light variants where there are some", () => {
  assert.equal(name(iconFor("a.toml", false, false, "", true)), "toml_light");
  assert.equal(name(iconFor("a.ts", false, false, "", true)), "typescript");
});

test("every icon the tables name is there, 16 px, with the license", () => {
  const src = readFileSync(join(MOD, "icons.js"), "utf8");
  const named = new Set([...src.matchAll(/":"((?:folder-)?[a-z0-9_-]+)"/g)].map(m => m[1]));
  for (const icon of named) {
    assert.ok(existsSync(join(MOD, `icons/${icon}.svg`)), icon);
    if (icon.startsWith("folder-")) assert.ok(existsSync(join(MOD, `icons/${icon}-open.svg`)), `${icon}-open`);
  }
  for (const f of readdirSync(join(MOD, "icons")).filter(f => f.endsWith(".svg"))) {
    assert.match(readFileSync(join(MOD, "icons", f), "utf8"), /^<svg\b[^>]*\swidth="16" height="16"/, f);
  }
  assert.match(readFileSync(join(MOD, "icons/LICENSE"), "utf8"), /MIT License[\s\S]*ced21b9b5241c1efa502a8c46ec7363a690a7058|ced21b9b5241c1efa502a8c46ec7363a690a7058[\s\S]*MIT License/);
});
