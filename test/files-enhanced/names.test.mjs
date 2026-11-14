import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { splitName, numbered, freeName, archiveName } = await mod("names.js");

const takenBy = (...names) => name => names.includes(name);

test("a free name is kept", () => {
  assert.equal(freeName("a.txt", takenBy()), "a.txt");
});

test("a taken name gets the next number before the extension", () => {
  assert.equal(freeName("a.txt", takenBy("a.txt")), "a 2.txt");
  assert.equal(freeName("a.txt", takenBy("a.txt", "a 2.txt")), "a 3.txt");
  assert.equal(freeName("a.txt", takenBy("a.txt", "a 3.txt")), "a 2.txt");
});

test("dotfiles and names without an extension get the number at the end", () => {
  assert.equal(freeName(".env", takenBy(".env")), ".env 2");
  assert.equal(freeName("Makefile", takenBy("Makefile")), "Makefile 2");
  assert.equal(freeName("Makefile", takenBy("Makefile", "Makefile 2")), "Makefile 3");
});

test("folders get the number at the end, dots and all", () => {
  assert.equal(freeName("v1.2", takenBy("v1.2"), true), "v1.2 2");
  assert.equal(freeName("photos", takenBy("photos"), true), "photos 2");
});

test("tar archives keep both extensions", () => {
  assert.equal(freeName("x.tar.gz", takenBy("x.tar.gz")), "x 2.tar.gz");
  assert.equal(freeName("x.TAR.xz", takenBy("x.TAR.xz")), "x 2.TAR.xz");
  assert.equal(freeName("x.tar", takenBy("x.tar")), "x 2.tar");
});

test("only the last extension counts otherwise", () => {
  assert.deepEqual(splitName("a.b.c.txt"), ["a.b.c", ".txt"]);
  assert.deepEqual(splitName(".env.local"), [".env", ".local"]);
  assert.equal(freeName("app.min.js", takenBy("app.min.js")), "app.min 2.js");
});

test("odd names have no extension", () => {
  assert.deepEqual(splitName("file."), ["file.", ""]);
  assert.deepEqual(splitName("notes.final draft"), ["notes.final draft", ""]);
  assert.deepEqual(splitName("."), [".", ""]);
});

test("a number already in the name is not counted up", () => {
  assert.equal(freeName("a 2.txt", takenBy("a 2.txt")), "a 2 2.txt");
});

test("stem + ext is the name", () => {
  for (const name of ["a.txt", ".env", "Makefile", "x.tar.gz", "a.b.c", "név.md", "한국.txt"]) {
    const [stem, ext] = splitName(name);
    assert.equal(stem + ext, name);
    assert.equal(numbered(stem, ext, 1), name);
  }
});

test("archives: the item's name, or Archive, numbered when taken", () => {
  assert.equal(archiveName(["photos"], takenBy()), "photos.zip");
  assert.equal(archiveName(["a.txt"], takenBy("a.txt.zip")), "a.txt 2.zip");
  assert.equal(archiveName(["a", "b"], takenBy()), "Archive.zip");
  assert.equal(archiveName(["a", "b"], takenBy("Archive.zip", "Archive 2.zip")), "Archive 3.zip");
});

test("copies: \"a copy.txt\", then \"a copy 2.txt\", counting on from a copy", async () => {
  const { copyName, copyStart } = await mod("names.js");
  assert.equal(copyName("a.txt", takenBy()), "a copy.txt");
  assert.equal(copyName("a.txt", takenBy("a copy.txt")), "a copy 2.txt");
  assert.equal(copyName("a.txt", takenBy("a copy.txt", "a copy 2.txt")), "a copy 3.txt");
  assert.equal(copyName("a copy.txt", takenBy()), "a copy 2.txt");
  assert.equal(copyName("a copy 5.txt", takenBy()), "a copy 6.txt");
  assert.equal(copyName("x.tar.gz", takenBy()), "x copy.tar.gz");
  assert.equal(copyName(".env", takenBy()), ".env copy");
  assert.equal(copyName("v1.2", takenBy(), true), "v1.2 copy");
  assert.equal(copyName("photos", takenBy("photos copy"), true), "photos copy 2");
  assert.deepEqual(copyStart("a copy 0"), ["a copy", 1]);
});
