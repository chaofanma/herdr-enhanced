import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { splitRows, pairs, changedRange, wordRanges, markSpans, hash, unquote, headerPath, diffsByPath } = await mod("review.js");
const { DIFF } = await mod("hunk.js");

const rows = (kinds) => kinds.split("").map((k) => ({ kind: k === "." ? "" : k === "_" ? " " : k }));

test("splitRows pairs a run of removals with the additions after it", () => {
  // @@, context, two removed, three added, context, one removed, a note, one added.
  assert.deepEqual(splitRows(rows("@_--+++_-.+")), [
    { header: 0 }, { left: 1, right: 1 },
    { left: 2, right: 4 }, { left: 3, right: 5 }, { left: null, right: 6 },
    { left: 7, right: 7 },
    { left: 8, right: 10 }, { note: 9 },
  ]);
  // Additions with nothing removed, removals with nothing added, a second hunk.
  assert.deepEqual(splitRows(rows("@++_--@_")), [
    { header: 0 }, { left: null, right: 1 }, { left: null, right: 2 }, { left: 3, right: 3 },
    { left: 4, right: null }, { left: 5, right: null }, { header: 6 }, { left: 7, right: 7 },
  ]);
  // A removal after additions starts a new change.
  assert.deepEqual(splitRows(rows("-+-+")), [{ left: 0, right: 1 }, { left: 2, right: 3 }]);
  // A row of no kind outside a change stands alone.
  assert.deepEqual(splitRows(rows("._")), [{ note: 0 }, { left: 1, right: 1 }]);
  assert.deepEqual(pairs(rows("@_--+++_-.+")), [[2, 4], [3, 5], [8, 10]]);
});

test("changedRange is the differing middle, snapped to words", () => {
  assert.deepEqual(changedRange("const foo = 1;", "const fooBar = 1;"), { a: [6, 9], b: [6, 12] });
  assert.deepEqual(changedRange("return a + b;", "return a - b;"), { a: [9, 10], b: [9, 10] });
  assert.deepEqual(changedRange("let count = 10;", "let count = 12;"), { a: [12, 14], b: [12, 14] });
  assert.deepEqual(changedRange("foo();", "bar();"), { a: [0, 3], b: [0, 3] });
  assert.deepEqual(changedRange("a(x)", "a(x, y)"), { a: [3, 3], b: [3, 6] });
  assert.equal(changedRange("same", "same"), null);
  assert.equal(changedRange("abc", "xyz"), null);
  assert.equal(changedRange("alpha", "alphabet"), null);
  // Not inside a surrogate pair.
  assert.deepEqual(changedRange("x 😀 y", "x 😃 y"), { a: [2, 4], b: [2, 4] });
  assert.deepEqual(changedRange("naïve café", "naïve cafés"), { a: [6, 10], b: [6, 11] });
});

test("wordRanges marks both rows of each pair", () => {
  const r = [{ kind: "@", text: "@@" }, { kind: "-", text: "x = 1" }, { kind: "+", text: "x = 2" }, { kind: "+", text: "y = 3" }, { kind: " ", text: "z" }];
  assert.deepEqual([...wordRanges(r, (i) => r[i].text)], [[1, [4, 5]], [2, [4, 5]]]);
});

test("markSpans cuts spans at the marked range", () => {
  const spans = [{ text: "const ", cls: "keyword" }, { text: "fooBar", cls: "" }, { text: " = 1;", cls: "" }];
  assert.deepEqual(markSpans(spans, 6, 12), [{ text: "const ", cls: "keyword" }, { text: "fooBar", cls: "", mark: true }, { text: " = 1;", cls: "" }]);
  assert.deepEqual(markSpans(spans, 3, 8), [
    { text: "con", cls: "keyword" }, { text: "st ", cls: "keyword", mark: true }, { text: "fo", cls: "", mark: true }, { text: "oBar", cls: "" }, { text: " = 1;", cls: "" },
  ]);
  assert.deepEqual(markSpans(spans, 4, 4), spans);
  assert.equal(markSpans(spans, 0, 17).map((s) => s.text).join(""), "const fooBar = 1;");
});

test("hash changes with the text", () => {
  assert.equal(hash("abc"), hash("abc"));
  assert.notEqual(hash("abc"), hash("abd"));
  assert.notEqual(hash(""), hash(" "));
  assert.match(hash("diff --git a/x b/x\n"), /^[0-9a-z]+-[0-9a-f]{8}$/);
});

test("unquote and headerPath read git's paths", () => {
  assert.equal(unquote("\"a/sp\\\"ace\\tx\" \"b/…\""), "a/sp\"ace\tx");
  assert.equal(unquote("\"a/\\355\\225\\234.txt\""), "a/한.txt");
  assert.equal(unquote("plain"), null);
  assert.equal(unquote("\"unterminated"), null);
  assert.equal(headerPath("a/src/x.js b/src/x.js"), "src/x.js");
  assert.equal(headerPath("a/with space b/with space"), "with space");
  assert.equal(headerPath("a/a b/c b/a b/c"), "a b/c");
  assert.equal(headerPath("\"a/q\\\"uote\" \"b/q\\\"uote\""), "q\"uote");
  assert.equal(headerPath("a/old b/new"), null);
});

// A real repo: what git prints for a plain change, a path with a space and a quote, a new
// symlink replacing a file (two pieces), and a binary file.
test("diffsByPath cuts a real diff by file", (t) => {
  const dir = tempDir("git-enhanced-review-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  writeFileSync(join(dir, "a.txt"), "one\n");
  writeFileSync(join(dir, "sp \"q\".txt"), "x\n");
  writeFileSync(join(dir, "link"), "file\n");
  writeFileSync(join(dir, "bin"), Buffer.from([0, 1, 2]));
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "one");
  writeFileSync(join(dir, "a.txt"), "two\n");
  writeFileSync(join(dir, "sp \"q\".txt"), "y\n");
  rmSync(join(dir, "link"));
  symlinkSync("a.txt", join(dir, "link"));
  writeFileSync(join(dir, "bin"), Buffer.from([0, 1, 3]));
  const out = git("diff", "HEAD", "--no-renames", ...DIFF);
  const byPath = diffsByPath(out);
  assert.deepEqual([...byPath.keys()].sort(), ["a.txt", "bin", "link", "sp \"q\".txt"]);
  assert.match(byPath.get("a.txt"), /^diff --git a\/a.txt b\/a.txt\n[\s\S]*-one\n\+two\n$/);
  assert.match(byPath.get("link"), /deleted file mode[\s\S]*new file mode 120000/);
  assert.match(byPath.get("bin"), /Binary files/);
  assert.equal([...byPath.values()].join(""), out);
  // A change in one file changes only its hash.
  writeFileSync(join(dir, "a.txt"), "three\n");
  const again = diffsByPath(git("diff", "HEAD", "--no-renames", ...DIFF));
  assert.notEqual(hash(again.get("a.txt")), hash(byPath.get("a.txt")));
  assert.equal(hash(again.get("bin")), hash(byPath.get("bin")));
});
