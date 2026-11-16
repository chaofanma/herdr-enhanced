import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { patchFiles, patchRows, patchCounts, unquotePath } = await mod("diffview.js");

// Token colors the caller would give: every "const" a keyword.
const colorize = { lang: (path) => (path.endsWith(".js") ? "js" : null), tokenize: (text, lang, state) => ({ spans: lang ? text.split(/(const)/).filter(Boolean).map((t) => ({ text: t, cls: t === "const" ? "keyword" : "" })) : [{ text, cls: "" }], state }) };

const PATCH = [
  "diff --git a/src/x.js b/src/x.js",
  "index 1111111..2222222 100644",
  "--- a/src/x.js",
  "+++ b/src/x.js",
  "@@ -1,3 +1,3 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  " const c = 4;",
  "diff --git a/img.png b/img.png",
  "new file mode 100644",
  "index 0000000..d9d6533",
  "Binary files /dev/null and b/img.png differ",
  "diff --git a/u.txt b/u.txt",
  "new file mode 100644",
  "index 0000000..3e75765",
  "--- /dev/null",
  "+++ b/u.txt",
  "@@ -0,0 +1 @@",
  "+new",
  "diff --git a/gone.txt b/gone.txt",
  "deleted file mode 100644",
  "index 3e75765..0000000",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "--- not a header",
  "diff --git a/old name.txt b/new name.txt",
  "similarity index 100%",
  "rename from old name.txt",
  "rename to new name.txt",
  "diff --git \"a/t\\303\\251.txt\" \"b/t\\303\\251.txt\"",
  "index 1..2 100644",
  "--- \"a/t\\303\\251.txt\"",
  "+++ \"b/t\\303\\251.txt\"",
  "@@ -1 +1 @@",
  "-a",
  "\\ No newline at end of file",
  "+b",
].join("\n") + "\n";

test("a patch cut into its files", () => {
  const files = patchFiles(PATCH);
  assert.deepEqual(files.map((f) => [f.path, f.status, f.binary, f.from]), [
    ["src/x.js", "M", false, null], ["img.png", "A", true, null], ["u.txt", "A", false, null], ["gone.txt", "D", false, null], ["new name.txt", "R", false, "old name.txt"], ["té.txt", "M", false, null],
  ]);
  assert.deepEqual(files[0].lines, ["@@ -1,3 +1,3 @@", " const a = 1;", "-const b = 2;", "+const b = 3;", " const c = 4;"]);
  assert.deepEqual(files[3].lines, ["@@ -1 +0,0 @@", "--- not a header"], "a removed line that looks like a header stays a line");
  assert.deepEqual(files[4].lines, []);
  assert.deepEqual(patchCounts(files), { files: 6, add: 3, del: 3 });
  assert.deepEqual(patchFiles(""), []);
});

test("its rows: a title per file, numbered lines, notes for binary and renamed files", () => {
  const rows = patchRows(patchFiles(PATCH), { colorize });
  assert.deepEqual(rows.slice(0, 6).map((r) => [r.kind, r.number ?? null, r.text]), [
    ["file", null, "src/x.js"], ["@", null, "@@ -1,3 +1,3 @@"], [" ", 1, "const a = 1;"], ["-", 2, "const b = 2;"], ["+", 2, "const b = 3;"], [" ", 3, "const c = 4;"],
  ]);
  assert.ok(rows[3].spans.some((s) => s.cls === "keyword"), "colored by the caller's tokenizer");
  assert.deepEqual(patchRows(patchFiles(PATCH))[3].spans, [{ text: "const b = 2;", cls: "" }], "plain without one");
  const titles = rows.filter((r) => r.kind === "file");
  assert.deepEqual(titles.map((r) => r.text), ["src/x.js", "img.png", "u.txt", "gone.txt", "old name.txt → new name.txt", "té.txt"]);
  assert.deepEqual(titles.map((r) => r.words), ["modified", "added", "added", "deleted", "renamed", "modified"]);
  assert.ok(rows.some((r) => r.kind === "note" && r.text === "Binary file"));
  assert.ok(rows.some((r) => r.kind === "note" && /Renamed/.test(r.text)));
  assert.equal(rows.at(-2).kind, "", "the no-newline marker is its own row");
});

test("at most `max` rows, saying how many lines were left out", () => {
  const rows = patchRows(patchFiles(PATCH), { max: 4 });
  assert.equal(rows.length, 5);
  assert.match(rows.at(-1).text, /more lines not shown/);
});

test("paths git quotes", () => {
  assert.equal(unquotePath("plain.txt"), "plain.txt");
  assert.equal(unquotePath("\"t\\303\\251.txt\""), "té.txt");
  assert.equal(unquotePath("\"tab\\there\""), "tab\there");
  assert.equal(unquotePath("\"quote\\\"s\""), "quote\"s");
  assert.equal(unquotePath("\"bad\\q\""), null);
});

test("a tab inside a line: spaces to the next multiple of four columns, so tab-aligned columns stay aligned", () => {
  const patch = "diff --git a/m.c b/m.c\n--- a/m.c\n+++ b/m.c\n@@ -1,2 +1,2 @@\n #define A\t1\n-#define BB\t2\n+#define BBB\t2\n";
  const rows = patchRows(patchFiles(patch));
  assert.deepEqual(rows.filter((r) => r.number != null).map((r) => r.text), ["#define A   1", "#define BB  2", "#define BBB 2"]);
  const withName = patchRows(patchFiles(patch.replace("@@ -1,2 +1,2 @@", "@@ -1,2 +1,2 @@ int\tmain(void)")));
  assert.equal(withName.find((r) => r.kind === "@").text, "@@ -1,2 +1,2 @@ int main(void)", "the function git names after @@ too");
});
