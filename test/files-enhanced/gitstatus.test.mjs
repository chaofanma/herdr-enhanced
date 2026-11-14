import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { parseStatus, markOf, addDots } = await mod("gitstatus.js");

const z = (...entries) => entries.join("\0") + "\0";

test("marks from status codes", () => {
  assert.equal(markOf("??"), "A"); assert.equal(markOf("A "), "A"); assert.equal(markOf("AM"), "A");
  assert.equal(markOf(" M"), "M"); assert.equal(markOf("M "), "M"); assert.equal(markOf(" D"), "D");
  assert.equal(markOf("UU"), "U"); assert.equal(markOf("DU"), "U"); assert.equal(markOf("R "), "M");
});

test("paths below the root, relative to it, with folder dots", () => {
  const out = parseStatus(z(" M src/a.js", "?? src/new/b.js", " D old.txt", "UU src/c.js", "!! node_modules/", "!! src/x.log"), "/repo", "/repo");
  assert.deepEqual(out.marks, { "src/a.js": "M", "src/new/b.js": "A", "old.txt": "D", "src/c.js": "U", "dir:src": "U", "dir:src/new": "A" });
  assert.deepEqual([...out.ignored], ["node_modules", "src/x.log"]);
});

test("a root inside the repository keeps only its own paths", () => {
  const out = parseStatus(z(" M src/a.js", " M docs/x.md", "?? src/lib/n.js"), "/repo\n", "/repo/src/");
  assert.deepEqual(out.marks, { "a.js": "M", "lib/n.js": "A", "dir:lib": "A" });
});

test("a branch line is skipped, Windows paths fold", () => {
  const out = parseStatus(z("## main...origin/main", " M Src/A.js"), "C:/Repo", "c:\\repo\\src", { fold: true });
  assert.deepEqual(out.marks, { "A.js": "M" });
  assert.deepEqual(parseStatus("", "/r", "/r"), { marks: {}, ignored: new Set() });
  assert.deepEqual(Object.keys(parseStatus(z(" M a", " M b", " M c"), "/r", "/r", { limit: 2 }).marks), ["a", "b"]);
});

test("dots keep the most urgent mark", () => {
  assert.deepEqual(addDots({ "a/b/c.txt": "A", "a/d.txt": "D", "a/b/e.txt": "M" }),
    { "a/b/c.txt": "A", "a/d.txt": "D", "a/b/e.txt": "M", "dir:a": "D", "dir:a/b": "M" });
});
