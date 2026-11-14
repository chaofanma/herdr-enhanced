import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { folderName, up, remember, recentRoots } = await mod("pins.js");

test("folderName is the last part", () => {
  assert.equal(folderName("/Users/me/proj"), "proj");
  assert.equal(folderName("/Users/me/proj/"), "proj");
  assert.equal(folderName("/"), "/");
  assert.equal(folderName("C:\\Users\\me"), "me");
  assert.equal(folderName("C:\\"), "C:");
  assert.equal(folderName(null), "");
});

test("up goes to the folder above", () => {
  assert.equal(up("/Users/me/proj"), "/Users/me");
  assert.equal(up("/Users/me/proj/"), "/Users/me");
  assert.equal(up("/Users"), "/");
  assert.equal(up("C:\\Users\\me"), "C:\\Users");
  assert.equal(up("C:\\Users"), "C:\\");
  assert.equal(up("\\\\server\\share\\docs"), "\\\\server\\share");
});

test("up stops at the top", () => {
  for (const top of ["/", "//", "C:\\", "C:", "c:/", "\\\\server\\share", "", null, "relative"]) assert.equal(up(top), null, String(top));
});

test("remember puts a place first, once, and caps the list", () => {
  const a = { path: "/a", on: null }, b = { path: "/b", on: null }, rb = { path: "/b", on: "vps" };
  assert.deepEqual(remember([], a), [a]);
  assert.deepEqual(remember([a, b], b), [b, a]);
  assert.deepEqual(remember([a, b], rb), [rb, a, b]);
  const long = Array.from({ length: 20 }, (_, i) => ({ path: `/${i}`, on: null }));
  const next = remember(long, a, 16);
  assert.equal(next.length, 16);
  assert.deepEqual(next[0], a);
});

test("remember returns the same list when nothing changes", () => {
  const list = [{ path: "/a", on: null }];
  assert.equal(remember(list, { path: "/a" }), list);
  assert.equal(remember(list, null), list);
});

test("recentRoots keeps this machine's, without the terminal's folder", () => {
  const list = [{ path: "/t", on: null }, { path: "/x", on: "vps" }, { path: "/a", on: null }, { path: "/b" }];
  assert.deepEqual(recentRoots(list, null, "/t").map(x => x.path), ["/a", "/b"]);
  assert.deepEqual(recentRoots(list, "vps", "/t").map(x => x.path), ["/x"]);
  assert.equal(recentRoots(Array.from({ length: 12 }, (_, i) => ({ path: `/${i}` })), null, null).length, 8);
  assert.deepEqual(recentRoots(undefined, null, null), []);
});
