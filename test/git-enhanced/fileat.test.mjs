// fileat.js: a file's bytes, size and kind at a revision, in the index and on a conflict's
// sides; a tree's entries (folders, an executable, a link, a submodule, odd names) from literal
// output and real repositories; whether a path is there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { symlinkSync, chmodSync } from "node:fs";
import { mod } from "./mod.mjs";
import { repo } from "./gitenv.mjs";

const F = await mod("fileat.js");
const S = "a".repeat(40);

test("names, arguments, binary look, and parseTree on literal output", () => {
  assert.equal(F.spec("HEAD~1", "src/a b.txt"), "HEAD~1:src/a b.txt");
  assert.equal(F.spec("", "x"), ":x", "the index");
  assert.equal(F.spec("", "x", { stage: 3 }), ":3:x", "theirs, in a conflict");
  assert.equal(F.spec("v1", "/lead.txt"), "v1:lead.txt");
  assert.deepEqual(F.showArgs("v1", "a.pdf", { textconv: true }), ["cat-file", "--textconv", "v1:a.pdf"]);
  assert.deepEqual(F.existsArgs("main", "x"), ["rev-parse", "-q", "--verify", "main:x"]);
  assert.deepEqual(F.treeArgs("v1"), ["ls-tree", "-z", "--long", "v1^{tree}"]);
  assert.deepEqual(F.treeArgs("v1", "src/"), ["ls-tree", "-z", "--long", "v1:src"]);
  assert.equal(F.looksBinary("text\n"), false);
  assert.equal(F.looksBinary("PNG\0\0"), true);
  const out = [`100644 blob ${S}      12\tz file.txt`, `040000 tree ${S}       -\tsrc`, `100755 blob ${S}       3\trun.sh`, `120000 blob ${S}       5\tlink`, `160000 commit ${S}       -\tvendor/lib`, `100644 blob ${S} 1234567\tnew\nline`].join("\0") + "\0";
  assert.deepEqual(F.parseTree(out, "pkg").map((e) => [e.name, e.path, e.kind, e.size]), [
    ["src", "pkg/src", "dir", null], ["link", "pkg/link", "link", 5], ["new\nline", "pkg/new\nline", "file", 1234567], ["run.sh", "pkg/run.sh", "exec", 3],
    ["vendor/lib", "pkg/vendor/lib", "submodule", null], ["z file.txt", "pkg/z file.txt", "file", 12],
  ]);
  assert.deepEqual(F.parseTree(""), []);
});

test("real files at revisions: bytes, size, kind, the index, a tree and its folder, a path there or not", async () => {
  const r = repo("git-enhanced-fileat-");
  r.write("bin.dat", Buffer.from([0, 1, 2, 3]));
  r.write("run.sh", "#!/bin/sh\n"); chmodSync(r.path("run.sh"), 0o755);
  symlinkSync("run.sh", r.path("link"));
  const one = r.commit("one", { "src/a b.txt": "v1\n", "gone.txt": "g\n", "we\nird.txt": "w\n" });
  const two = r.commit("two", { "src/a b.txt": "v2\n", "gone.txt": null });
  r.git("update-index", "--add", "--cacheinfo", `160000,${one},vendor/lib`); r.git("commit", "-q", "-m", "a submodule");
  const three = r.git("rev-parse", "HEAD").trim();
  r.write("src/a b.txt", "v3 staged\n"); r.git("add", "src/a b.txt");
  const text = async (args) => (await r.h.git(args)).stdout;
  assert.equal(await text(F.showArgs(one, "src/a b.txt")), "v1\n");
  assert.equal(await text(F.showArgs(two, "src/a b.txt")), "v2\n");
  assert.equal(await text(F.showArgs("", "src/a b.txt")), "v3 staged\n", "the index");
  assert.equal((await text(F.sizeArgs(two, "src/a b.txt"))).trim(), "3");
  assert.equal((await text(F.typeArgs(two, "src"))).trim(), "tree");
  assert.equal((await text(F.typeArgs(three, "vendor/lib"))).trim(), "commit");
  assert.equal(F.looksBinary(await text(F.showArgs(one, "bin.dat"))), true);
  assert.equal((await r.h.git(F.existsArgs(one, "gone.txt"))).code, 0);
  const gone = await r.h.git(F.existsArgs(two, "gone.txt"));
  assert.deepEqual([gone.code, gone.stdout, gone.stderr], [1, "", ""], "deleted in two: 1, quietly");
  assert.equal((await r.h.git(F.existsArgs("no-such-rev", "gone.txt"))).code, 1);
  assert.equal((await r.h.git(F.existsArgs(two, "we\nird.txt"))).code, 0);
  const top = F.parseTree(await text(F.treeArgs(three)));
  assert.deepEqual(top.map((e) => [e.name, e.kind]), [["src", "dir"], ["vendor", "dir"], ["bin.dat", "file"], ["link", "link"], ["run.sh", "exec"], ["we\nird.txt", "file"]]);
  assert.equal(top.find((e) => e.name === "bin.dat").size, 4);
  const src = F.parseTree(await text(F.treeArgs(two, "src")), "src");
  assert.deepEqual(src.map((e) => [e.path, e.size]), [["src/a b.txt", 3]]);
  const vendor = F.parseTree(await text(F.treeArgs(three, "vendor")), "vendor");
  assert.deepEqual(vendor.map((e) => [e.path, e.kind, e.sha]), [["vendor/lib", "submodule", one]]);
  assert.notEqual((await r.h.git(F.treeArgs(two, "gone.txt"))).code, 0, "not a folder");
});

test("a conflict's three sides from the index's stages", async () => {
  const r = repo("git-enhanced-fileat-stages-");
  r.commit("base", { "f.txt": "base\n" });
  r.git("switch", "-q", "-c", "side"); r.commit("side", { "f.txt": "side\n" });
  r.git("switch", "-q", "main"); r.commit("main", { "f.txt": "main\n" });
  r.tryGit("merge", "side");
  const side = async (stage) => (await r.h.git(F.showArgs("", "f.txt", { stage }))).stdout;
  assert.deepEqual([await side(1), await side(2), await side(3)], ["base\n", "main\n", "side\n"]);
});
