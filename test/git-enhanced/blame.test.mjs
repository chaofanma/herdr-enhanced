// blame.js: porcelain output read from literal outputs (quoted names, a commit shown once, a
// boundary, uncommitted lines, a commit with two paths, CRLF) and from real repositories (a
// rename, -w, a revision), runs, age buckets, heat, and "blame before this change".
import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
import { repo } from "./gitenv.mjs";

const B = await mod("blame.js");
const A = "a".repeat(40), C = "c".repeat(40), Z = "0".repeat(40);
const info = (name, time, summary) => [`author ${name}`, `author-mail <${name}@x>`, `author-time ${time}`, "author-tz +0000", `committer ${name}`, `committer-mail <${name}@x>`, `committer-time ${time}`, "committer-tz +0000", `summary ${summary}`];

test("parseBlame on literal output: details once per commit, quoted names, boundary, uncommitted, two paths, CRLF", () => {
  const out = [
    `${A} 1 1 2`, ...info("Ann", 1000, "first: a summary"), "boundary", 'filename "we\\tird \\"name\\".txt"', "\tline one\r",
    `${A} 2 2`, "\tline two",
    `${Z} 3 3 1`, ...info("Not Committed Yet", 3000, "Version of x from x"), `previous ${C} "we\\tird \\"name\\".txt"`, 'filename "we\\tird \\"name\\".txt"', "\tlocal edit",
    `${C} 3 4 1`, ...info("Cy", 2000, "moved in"), `previous ${A} other.txt`, "filename other.txt", "\tfrom another file",
    `${C} 9 5 1`, 'filename "we\\tird \\"name\\".txt"', "\tsecond path of C",
    `${A} 3 6 1`, "\tline three",
  ].join("\n") + "\n";
  const { commits, lines } = B.parseBlame(out);
  assert.deepEqual(lines.map((l) => [l.line, l.orig, l.sha[0], l.path, l.text]), [
    [1, 1, "a", 'we\tird "name".txt', "line one\r"],
    [2, 2, "a", 'we\tird "name".txt', "line two"],
    [3, 3, "0", 'we\tird "name".txt', "local edit"],
    [4, 3, "c", "other.txt", "from another file"],
    [5, 9, "c", 'we\tird "name".txt', "second path of C"],
    [6, 3, "a", 'we\tird "name".txt', "line three"],
  ]);
  const a = commits.get(A), z = commits.get(Z), c = commits.get(C);
  assert.deepEqual([a.author, a.authorMail, a.authorTime, a.summary, a.boundary, a.previous, a.uncommitted], ["Ann", "Ann@x", 1000, "first: a summary", true, null, false]);
  assert.deepEqual([z.uncommitted, z.previous], [true, { sha: C, path: 'we\tird "name".txt' }]);
  assert.deepEqual(c.previous, { sha: A, path: "other.txt" });
  assert.deepEqual(B.runsOf(lines).map((r) => [r.sha[0], r.start, r.count]), [["a", 1, 2], ["0", 3, 1], ["c", 4, 2], ["a", 6, 1]]);
  assert.deepEqual(B.parseBlame(""), { commits: new Map(), lines: [] });
});

test("arguments, age buckets and heat", () => {
  assert.deepEqual(B.blameArgs("a b.txt"), ["-c", "core.quotepath=false", "blame", "--porcelain", "--", "a b.txt"]);
  assert.deepEqual(B.blameArgs("-x.txt", { rev: "HEAD~2", whitespace: true, moves: true, copies: true, lines: [10, 20] }),
    ["-c", "core.quotepath=false", "blame", "--porcelain", "-w", "-M", "-C", "-L", "10,20", "HEAD~2", "--", "-x.txt"]);
  const now = 1_800_000_000, day = 86400;
  assert.deepEqual([0, day - 1, day, 8 * day, 40 * day, 100 * day, 200 * day, 400 * day, 800 * day, 5000 * day].map((age) => B.ageBucket(now - age, now)), [0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(B.ageBucket(0, now), -1, "not committed yet");
  const commits = new Map([["n", { sha: "n", authorTime: now - day }], ["o", { sha: "o", authorTime: now - 1000 * day }], ["m", { sha: "m", authorTime: now - 30 * day }], ["u", { sha: "u", uncommitted: true, authorTime: now }]]);
  const heat = B.heatOf(commits, now);
  assert.equal(heat.get("n"), 1); assert.equal(heat.get("o"), 0); assert.equal(heat.get("u"), 1);
  assert.ok(heat.get("m") > 0.3 && heat.get("m") < 0.7, `${heat.get("m")}`);
  assert.equal(B.heatOf(new Map([["x", { sha: "x", authorTime: 5 }]]), now).get("x"), 1, "one commit");
});

test("real blame: a rename followed, uncommitted lines, the root commit as boundary, -w, a revision, and before this change", async () => {
  const r = repo("git-enhanced-blame-");
  const commitAt = (msg, files) => r.commit(msg, files);
  const one = commitAt("one", { "old name.txt": "a\nb\nc\n" });
  r.git("mv", "old name.txt", "new ä.txt"); r.git("commit", "-q", "-m", "rename");
  const renamed = r.git("rev-parse", "HEAD").trim();
  const three = commitAt("three", { "new ä.txt": "a\nB\nc\n" });
  const four = commitAt("indent", { "new ä.txt": "a\nB\n    c\n" });
  r.write("new ä.txt", "a\nB\n    c\nlocal\n");
  const blame = B.parseBlame((await r.h.git(B.blameArgs("new ä.txt"))).stdout);
  assert.deepEqual(blame.lines.map((l) => [l.text, l.sha, l.path]), [
    ["a", one, "old name.txt"], ["B", three, "new ä.txt"], ["    c", four, "new ä.txt"], ["local", "0".repeat(40), "new ä.txt"],
  ]);
  assert.equal(blame.commits.get(one).boundary, true, "the root commit");
  assert.equal(blame.commits.get("0".repeat(40)).uncommitted, true);
  assert.deepEqual(blame.commits.get(three).previous, { sha: renamed, path: "new ä.txt" });
  const ws = B.parseBlame((await r.h.git(B.blameArgs("new ä.txt", { whitespace: true }))).stdout);
  assert.equal(ws.lines[2].sha, one, "-w: the indent isn't a change");
  const atRev = B.parseBlame((await r.h.git(B.blameArgs("new ä.txt", { rev: three }))).stdout);
  assert.deepEqual(atRev.lines.map((l) => l.sha), [one, three, one]);
  // Before this change: B's line before commit three, at the rename's version.
  const before = B.beforeOf(blame.lines[1], blame);
  assert.deepEqual([before.rev, before.path, before.line], [renamed, "new ä.txt", 2]);
  const earlier = B.parseBlame((await r.h.git(before.args)).stdout);
  assert.equal(earlier.lines[before.line - 1].text, "b");
  assert.equal(earlier.lines[before.line - 1].sha, one);
  assert.equal(B.beforeOf(blame.lines[0], blame), null, "a line from the root commit has nothing before");
  const local = B.beforeOf(blame.lines[3], blame);
  assert.equal(local.rev, four, "a line not committed yet: HEAD's version");
  await assert.rejects(r.h.git(B.blameArgs("no such file")).then((x) => { if (x.code) throw new Error(x.stderr); }), /no such path|no such file/);
});
