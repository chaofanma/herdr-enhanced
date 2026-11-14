import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { escapeRegex, words, patterns, bestMatch, score, rank, spans } = await mod("fuzzy.js");

test("regex characters are escaped, others left alone", () => {
  assert.equal(escapeRegex("a.b*c+(d)[e]{f}^$|?\\#&-~"), "a\\.b\\*c\\+\\(d\\)\\[e\\]\\{f\\}\\^\\$\\|\\?\\\\\\#\\&\\-\\~");
  assert.equal(escapeRegex("src/<x>_y@z"), "src/<x>_y@z");
});

test("words split on spaces and lowercase", () => {
  assert.deepEqual(words("  Main  TEST "), ["main", "test"]);
  assert.deepEqual(words(""), []);
  assert.deepEqual(words(null), []);
});

test("patterns are anchored below the root, one per word", () => {
  assert.deepEqual(patterns("ab c", "/r"), ["^/r/.*a.*b", "^/r/.*c"]);
  assert.deepEqual(patterns("a.js", "/my.dir/"), ["^/my\\.dir/.*a.*\\..*j.*s"]);
  assert.deepEqual(patterns("x", "/"), ["^/.*x"]);
  assert.deepEqual(patterns("   ", "/r"), []);
});

test("the patterns match what they should (as a JS regex)", () => {
  const [p] = patterns("mjs", "/root"), re = new RegExp(p, "i");
  assert.ok(re.test("/root/src/main.js"));
  assert.ok(!re.test("/root/src/main.ts"));
  // The root's own letters don't count.
  const [q] = patterns("root", "/root");
  assert.ok(!new RegExp(q, "i").test("/root/a.txt"));
});

test("bestMatch prefers a contiguous run", () => {
  assert.deepEqual(bestMatch("main.js", "main"), { gaps: 0, at: [0, 1, 2, 3] });
  assert.deepEqual(bestMatch("m_a_in", "main"), { gaps: 2, at: [0, 2, 4, 5] });
  // "ab" in "a_xab": the run at the end beats the scattered start.
  assert.deepEqual(bestMatch("a_xab", "ab"), { gaps: 0, at: [3, 4] });
  assert.equal(bestMatch("abc", "abd"), null);
  assert.equal(bestMatch("ab", "abc"), null);
  assert.deepEqual(bestMatch("src/app.js", "app", 4), { gaps: 0, at: [4, 5, 6] });
  assert.equal(bestMatch("app/x.js", "app", 4), null);
});

test("score counts name hits and gaps, and returns the matched letters", () => {
  assert.deepEqual(score("src/main.js", ["main"]), { rel: "src/main.js", base: 1, gaps: 0, at: [4, 5, 6, 7] });
  const s = score("src/lib/util.js", ["srcutil"]);
  assert.equal(s.base, 0);
  assert.equal(s.gaps, 1);
  assert.equal(score("src/main.js", ["zzz"]), null);
  assert.equal(score("src/main.js", ["main", "zzz"]), null);
  assert.equal(score("src/main.js", ["src", "main"]).base, 1);
});

test("rank: name hits, then contiguous, then fewer gaps, then shorter", () => {
  const paths = ["readme.md", "lib/m/a/i/n.txt", "docs/main-guide.md", "src/main.js", "test/domain.js", "main.js", "m_a_i_n.js"];
  const got = rank(paths, "main").map(r => r.rel);
  assert.deepEqual(got, ["main.js", "src/main.js", "test/domain.js", "docs/main-guide.md", "m_a_i_n.js", "lib/m/a/i/n.txt"]);
});

test("rank: case is ignored, words can come in any order, the limit holds", () => {
  assert.deepEqual(rank(["src/Main.JS"], "main").map(r => r.rel), ["src/Main.JS"]);
  assert.deepEqual(rank(["src/app/view.ts", "src/view/app.ts"], "app view").map(r => r.rel), ["src/app/view.ts", "src/view/app.ts"]);
  assert.equal(rank(Array.from({ length: 300 }, (_, i) => `f${i}.txt`), "f", 100).length, 100);
  assert.deepEqual(rank(["a"], " "), []);
});

test("spans split text into hit and miss runs", () => {
  assert.deepEqual(spans("main.js", [0, 1, 5]), [{ text: "ma", hit: true }, { text: "in.", hit: false }, { text: "j", hit: true }, { text: "s", hit: false }]);
  assert.deepEqual(spans("src/main.js", [4, 5], 4), [{ text: "ma", hit: true }, { text: "in.js", hit: false }]);
  assert.deepEqual(spans("src/main.js", [0], 0, 3), [{ text: "s", hit: true }, { text: "rc", hit: false }]);
  assert.deepEqual(spans("", []), []);
});
