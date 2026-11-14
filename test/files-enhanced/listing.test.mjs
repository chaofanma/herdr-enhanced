import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { globRegex, excluder, ignoredIn, shown, sorted, extensionOf } = await mod("listing.js");

const e = (name, dir = false) => ({ name, dir });
const names = list => list.map(x => x.name);

test("globs: a name matches at any depth, a path from the root", () => {
  const out = excluder(["dist", "*.log", "src/gen", "**/build", "docs/*.pdf", ".DS_Store", "{tmp,cache}", "file?.txt", "[ab].md"]);
  for (const p of ["dist", "a/b/dist", "x.log", "a/x.log", "src/gen", "a/build", "build", "a/b/build", "docs/a.pdf", "q/.DS_Store", "tmp", "a/cache", "file1.txt", "a.md", "b.md"]) assert.equal(out(p), true, p);
  for (const p of ["distro", "a/dist.txt", "x.log.txt", "a/src/gen", "src/gen2", "docs/sub/a.pdf", "file12.txt", "c.md", "tmp2"]) assert.equal(out(p), false, p);
  assert.equal(globRegex("*.JS", true).test("a/b.js"), true);
  assert.equal(globRegex("*.JS").test("a/b.js"), false);
  assert.equal(excluder([])("x"), false);
  assert.equal(excluder(["", "  ", 3])("x"), false);
  assert.equal(excluder(["./out/"])("out"), true);
  assert.equal(excluder(["{*.js,*.ts}"])("a/b.ts"), true);
});

test("ignored: the path or a folder above it", () => {
  const set = new Set(["node_modules", "a/b.log"]);
  assert.equal(ignoredIn(set, "node_modules"), true);
  assert.equal(ignoredIn(set, "node_modules/x/y.js"), true);
  assert.equal(ignoredIn(set, "a/b.log"), true);
  assert.equal(ignoredIn(set, "a"), false);
  assert.equal(ignoredIn(null, "a"), false);
});

test("what a folder lists", () => {
  const list = [e(".env"), e("a.txt"), e("dist", true), e("b.log"), e("node_modules", true), e(".github", true)];
  assert.deepEqual(names(shown(list, "")), names(list), "nothing set: everything");
  assert.deepEqual(names(shown(list, "", { hidden: false })), ["a.txt", "dist", "b.log", "node_modules"]);
  assert.deepEqual(names(shown(list, "", { exclude: ["dist", "*.log"] })), [".env", "a.txt", "node_modules", ".github"]);
  const ig = new Set(["node_modules", "sub/x.txt"]);
  assert.deepEqual(names(shown(list, "", { ignored: "hide" }, ig)), [".env", "a.txt", "dist", "b.log", ".github"]);
  const dim = shown(list, "", { ignored: "dim" }, ig);
  assert.deepEqual(dim.filter(x => x.ignored).map(x => x.name), ["node_modules"]);
  assert.equal(shown(list, "", { ignored: "show" }, ig).some(x => x.ignored), false);
  assert.deepEqual(names(shown([e("x.txt"), e("y.txt")], "sub", { ignored: "hide" }, ig)), ["y.txt"]);
  assert.deepEqual(names(shown([e("gen", true)], "src", { exclude: ["src/gen"] })), []);
});

test("sort by name: folders first, natural, case-insensitive", () => {
  const list = [e("b10.txt"), e("B2.txt"), e("a.txt"), e("zeta", true), e("Alpha", true)];
  assert.deepEqual(names(sorted(list)), ["Alpha", "zeta", "a.txt", "B2.txt", "b10.txt"]);
  assert.deepEqual(names(sorted(list, { foldersFirst: false })), ["a.txt", "Alpha", "B2.txt", "b10.txt", "zeta"]);
});

test("sort by type: the extension, then the name", () => {
  const list = [e("z.js"), e("a.ts"), e("b.js"), e("Makefile"), e(".gitignore"), e("src", true), e("c.JS")];
  assert.deepEqual(names(sorted(list, { sort: "type" })), ["src", ".gitignore", "Makefile", "b.js", "c.JS", "z.js", "a.ts"]);
  assert.equal(extensionOf("x.tar.gz"), "gz");
  assert.equal(extensionOf(".env"), "");
  assert.equal(extensionOf("v1.2", true), "");
});

test("sort by modified: newest first, unknown last", () => {
  const list = [e("old.txt"), e("new.txt"), e("mid.txt"), e("none.txt"), e("dir", true)];
  const times = new Map([["old.txt", 1], ["new.txt", 3], ["mid.txt", 2], ["dir", 0]]);
  assert.deepEqual(names(sorted(list, { sort: "modified" }, times)), ["dir", "new.txt", "mid.txt", "old.txt", "none.txt"]);
  assert.deepEqual(names(sorted(list, { sort: "modified", foldersFirst: false }, times)), ["new.txt", "mid.txt", "old.txt", "dir", "none.txt"]);
  assert.deepEqual(names(sorted(list, { sort: "modified" }, null)), ["dir", "mid.txt", "new.txt", "none.txt", "old.txt"]);
});
