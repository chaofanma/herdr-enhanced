import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync, symlinkSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { plan, nameArgs, inside } = await mod("paste.js");

test("a folder never goes into itself; cutting into its own folder does nothing; a copy there is a copy", () => {
  assert.deepEqual(plan("cut", ["/r/a", "/r/b/c.txt", "/r/x.txt"], "/r/a/sub"), [
    { src: "/r/a", skip: "a can't go into itself" }, { src: "/r/b/c.txt", copy: false }, { src: "/r/x.txt", copy: false }]);
  assert.deepEqual(plan("copy", ["/r/a"], "/r/a"), [{ src: "/r/a", skip: "a can't go into itself" }]);
  assert.deepEqual(plan("cut", ["/r/x.txt"], "/r"), [{ src: "/r/x.txt", skip: "already there" }]);
  assert.deepEqual(plan("copy", ["/r/x.txt", "/q/y.txt"], "/r"), [{ src: "/r/x.txt", copy: true }, { src: "/q/y.txt", copy: false }]);
  assert.deepEqual(plan("copy", ["/ab"], "/a"), [{ src: "/ab", copy: false }], "/a isn't inside /ab");
  assert.equal(inside("/r/a", "/r/"), true);
});

test("naming arguments", () => {
  assert.deepEqual(nameArgs("a.txt", false), ["a", "1", ".txt", "a.txt", "1"]);
  assert.deepEqual(nameArgs("a.txt", true), ["a copy", "1", ".txt", "a.txt copy", "1"]);
  assert.deepEqual(nameArgs("a copy 3.txt", true), ["a copy", "4", ".txt", "a copy 3.txt copy", "1"]);
  assert.deepEqual(nameArgs("v1.2", true), ["v1 copy", "1", ".2", "v1.2 copy", "1"]);
});

// The shell loop itself, on real folders.
const { TRANSFER, parseTransfer } = await mod("paste.js");
const run = (mode, dest, items) => parseTransfer(execFileSync("sh", ["-c", TRANSFER, "files", mode, dest, ...items.flatMap(([src, copy]) => [src, ...nameArgs(src.split("/").pop(), copy)])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));

test("the shell copies and moves with those names, never over anything", () => {
  const d = tempDir("files-enhanced-test-paste-");
  mkdirSync(join(d, "src/photos"), { recursive: true }); mkdirSync(join(d, "dest"));
  writeFileSync(join(d, "src/a.txt"), "A"); writeFileSync(join(d, "src/photos/p.jpg"), "P"); writeFileSync(join(d, "dest/a.txt"), "old");
  symlinkSync("a.txt", join(d, "src/link"));
  // Copy into another folder: "a 2.txt" next to the a.txt already there, which stays as it was.
  assert.deepEqual(run("copy", join(d, "dest"), [[join(d, "src/a.txt"), false], [join(d, "src/photos"), false], [join(d, "src/link"), false]]),
    [{ status: "ok", value: "a 2.txt" }, { status: "ok", value: "photos" }, { status: "ok", value: "link" }]);
  assert.equal(readFileSync(join(d, "dest/a.txt"), "utf8"), "old");
  assert.equal(readFileSync(join(d, "dest/photos/p.jpg"), "utf8"), "P");
  assert.equal(lstatSync(join(d, "dest/link")).isSymbolicLink(), true);
  // Duplicate (a copy where it is): "a copy.txt", then "a copy 2.txt"; folders "photos copy".
  assert.deepEqual(run("copy", join(d, "src"), [[join(d, "src/a.txt"), true], [join(d, "src/a.txt"), true], [join(d, "src/photos"), true]]),
    [{ status: "ok", value: "a copy.txt" }, { status: "ok", value: "a copy 2.txt" }, { status: "ok", value: "photos copy" }]);
  // Move: gone from where it was; the second photos is "photos 2".
  assert.deepEqual(run("cut", join(d, "dest"), [[join(d, "src/photos"), false], [join(d, "src/nothing"), false]]),
    [{ status: "ok", value: "photos 2" }, { status: "gone", value: join(d, "src/nothing") }]);
  assert.equal(existsSync(join(d, "src/photos")), false);
  assert.deepEqual(readdirSync(join(d, "dest")).sort(), ["a 2.txt", "a.txt", "link", "photos", "photos 2"]);
});
