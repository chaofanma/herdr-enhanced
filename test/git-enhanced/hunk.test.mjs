import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { DIFF, FLAGS, applyArgs, splitDiff, patchable, hunkStarts, hunkPatch, buttonAt, buttonInset } = await mod("hunk.js");

const HEADER = ["diff --git a/src/x.js b/src/x.js", "index 1111111..2222222 100644", "--- a/src/x.js", "+++ b/src/x.js"];
const THREE = [
  ...HEADER,
  "@@ -1,3 +1,3 @@",
  " a",
  "-b",
  "+B",
  " c",
  "@@ -10,3 +10,4 @@ function f() {",
  " j",
  "+new",
  " k",
  " l",
  "@@ -20,2 +21,2 @@",
  " t",
  "-u",
  "\\ No newline at end of file",
  "+U",
  "\\ No newline at end of file",
].join("\n") + "\n";

test("splitDiff keeps the header apart from the hunks", () => {
  const d = splitDiff(THREE);
  assert.deepEqual(d.header, HEADER);
  assert.equal(d.lines[0], "@@ -1,3 +1,3 @@");
  assert.equal(d.lines.at(-1), "\\ No newline at end of file");
  assert.equal(splitDiff("diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n"), null);
  assert.equal(splitDiff(""), null);
});

test("hunkStarts finds every @@ line", () => {
  assert.deepEqual(hunkStarts(splitDiff(THREE).lines), [0, 5, 10]);
});

test("hunkPatch is the header, one hunk and a final newline", () => {
  const { header, lines } = splitDiff(THREE);
  assert.equal(hunkPatch(header, lines, 0), [...HEADER, "@@ -1,3 +1,3 @@", " a", "-b", "+B", " c"].join("\n") + "\n");
  assert.equal(hunkPatch(header, lines, 5), [...HEADER, "@@ -10,3 +10,4 @@ function f() {", " j", "+new", " k", " l"].join("\n") + "\n");
  // The last hunk keeps both no-newline markers.
  assert.equal(hunkPatch(header, lines, 10), [...HEADER, "@@ -20,2 +21,2 @@", " t", "-u", "\\ No newline at end of file", "+U", "\\ No newline at end of file"].join("\n") + "\n");
  assert.equal(hunkPatch(header, lines, 1), null);
  assert.equal(hunkPatch(header, lines, 99), null);
});

test("patchable refuses type changes and submodules", () => {
  assert.equal(patchable(splitDiff(THREE)), true);
  const typechange = [
    "diff --git a/l b/l", "deleted file mode 100644", "index 3b18e51..0000000", "--- a/l", "+++ /dev/null", "@@ -1 +0,0 @@", "-hello",
    "diff --git a/l b/l", "new file mode 120000", "index 0000000..ce01362", "--- /dev/null", "+++ b/l", "@@ -0,0 +1 @@", "+target", "\\ No newline at end of file",
  ].join("\n");
  assert.equal(patchable(splitDiff(typechange)), false);
  const submodule = ["diff --git a/sub b/sub", "index 1234567..89abcde 160000", "--- a/sub", "+++ b/sub", "@@ -1 +1 @@", "-Subproject commit 1234567", "+Subproject commit 89abcde"].join("\n");
  assert.equal(patchable(splitDiff(submodule)), false);
});

test("buttonAt finds right-aligned buttons by x", () => {
  // Two 56px buttons, 4px apart, the last ending at x=300: [184, 240] and [244, 300].
  assert.equal(buttonAt(190, 300, 2, 56, 4), 0);
  assert.equal(buttonAt(240, 300, 2, 56, 4), 0);
  assert.equal(buttonAt(242, 300, 2, 56, 4), -1);
  assert.equal(buttonAt(244, 300, 2, 56, 4), 1);
  assert.equal(buttonAt(300, 300, 2, 56, 4), 1);
  assert.equal(buttonAt(301, 300, 2, 56, 4), -1);
  assert.equal(buttonAt(100, 300, 2, 56, 4), -1);
  assert.equal(buttonAt(260, 300, 1, 56, 4), 0);
  assert.equal(buttonAt(240, 300, 1, 56, 4), -1);
});

test("buttonAt hits the buttons where main.js draws them, at any row width", () => {
  // main.js: button k's right edge sits pad + buttonInset(k) before the row's right edge; the
  // press is measured across the same row (the visible diff, which no longer scrolls sideways).
  for (const view of [229, 366, 1180]) for (const count of [1, 2]) {
    const width = 63, gap = 4, pad = 16;
    for (let k = 0; k < count; k++) {
      const right = view - pad - buttonInset(k, count, width, gap), left = right - width;
      for (const x of [left, left + width / 2, right]) assert.equal(buttonAt(x, view - pad, count, width, gap), k, `view ${view} k ${k} x ${x}`);
      assert.equal(buttonAt(left - 1, view - pad, count, width, gap), -1, "the gap before it");
    }
    assert.equal(buttonAt(view - pad + 1, view - pad, count, width, gap), -1, "the pad");
  }
  assert.deepEqual([0, 1].map((k) => buttonInset(k, 2, 56, 4)), [60, 0]);
});

// A real repo: one file with two hunks (the second at a last line without a newline);
// stage, unstage and revert one hunk with exactly the command the panel runs.
test("stage, unstage and revert one hunk in a temp repo", (t) => {
  const dir = tempDir("git-enhanced-hunk-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const apply = (patch, flags) => execFileSync("sh", applyArgs(patch, flags), { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const diff = (...base) => splitDiff(git("diff", ...base, ...DIFF, "--", "f.txt"));
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const file = join(dir, "f.txt");
  git("init", "-q");
  writeFileSync(file, lines.join("\n"));
  git("add", "f.txt");
  git("-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "one");
  const edited = [...lines];
  edited[1] = "line 2 changed";
  edited[19] = "line 20 changed";
  writeFileSync(file, edited.join("\n"));

  // Stage the first hunk: the index gets line 2 only.
  let d = diff();
  assert.equal(patchable(d), true);
  assert.deepEqual(hunkStarts(d.lines).length, 2);
  apply(hunkPatch(d.header, d.lines, hunkStarts(d.lines)[0]), FLAGS.stage);
  const staged = git("diff", "--cached", ...DIFF);
  assert.match(staged, /\+line 2 changed/);
  assert.doesNotMatch(staged, /line 20 changed/);
  const unstaged = git("diff", ...DIFF);
  assert.match(unstaged, /\+line 20 changed/);
  assert.match(unstaged, /\\ No newline at end of file/);
  assert.doesNotMatch(unstaged, /line 2 changed/);

  // Unstage it again: nothing is staged, the working tree keeps both edits.
  d = diff("--cached");
  assert.equal(hunkStarts(d.lines).length, 1);
  apply(hunkPatch(d.header, d.lines, 0), FLAGS.unstage);
  assert.equal(git("diff", "--cached", ...DIFF), "");
  assert.equal(readFileSync(file, "utf8"), edited.join("\n"));

  // Revert the second hunk (the one with the no-newline markers): only line 2 stays changed.
  d = diff();
  const [, second] = hunkStarts(d.lines);
  apply(hunkPatch(d.header, d.lines, second), FLAGS.revert);
  const back = [...lines];
  back[1] = "line 2 changed";
  assert.equal(readFileSync(file, "utf8"), back.join("\n"));

  // A patch that no longer applies fails with git's message, nothing changes.
  assert.throws(() => apply(hunkPatch(d.header, d.lines, second), FLAGS.revert), (e) => e.status !== 0 && /patch does not apply|error/.test(String(e.stderr)));
  assert.equal(readFileSync(file, "utf8"), back.join("\n"));
});
