import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mod, NAME } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { PAGE, startRefs, logArgs, oneArgs, parseLog, parseRefs, parseQuery, filtered, parseNameStatus, parseNumstat, detailArgs, parseDetails, ago, when, hashSet, signature } = await mod("gitlog.js");

const git = (cwd, ...a) => execFileSync("git", ["-c", "user.name=Ann Author", "-c", "user.email=ann@x.org", "-c", "init.defaultBranch=main", ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
function fixture() {
  const d = tempDir("git-enhanced-gitlog-");
  git(d, "init", "-q");
  writeFileSync(join(d, "a.txt"), "a\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "First: add a");
  git(d, "tag", "v1");
  git(d, "switch", "-qc", "side");
  writeFileSync(join(d, "b.txt"), "b\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "Side work\n\nWith a body\nof two lines");
  git(d, "switch", "-q", "main");
  writeFileSync(join(d, "a.txt"), "a\nmore\n"); git(d, "commit", "-qam", "Fix (the) bug in a | b");
  git(d, "merge", "-q", "--no-edit", "--no-ff", "side");
  git(d, "update-ref", `refs/${NAME}/turns/x/start`, "HEAD");
  return d;
}

test("logArgs: one page, NUL separated, topological, from the given refs, filtered", () => {
  const a = logArgs({ refs: ["HEAD", "origin/main"], skip: 300 });
  assert.ok(a.includes("-z") && a.includes("--topo-order") && a.includes("--decorate=full"));
  assert.ok(a.includes(`--max-count=${PAGE + 1}`) && a.includes("--skip=300"));
  assert.deepEqual(a.slice(-3), ["HEAD", "origin/main", "--"]);
  const s = logArgs({ search: parseQuery("author:ann path:src/a.js fix it"), follow: true });
  assert.ok(s.includes("--grep=fix it") && s.includes("--author=ann") && s.includes("--fixed-strings") && s.includes("--regexp-ignore-case") && s.includes("--follow"));
  assert.deepEqual(s.slice(-3), ["HEAD", "--", "src/a.js"]);
  assert.ok(!logArgs({ search: parseQuery("path:src") }).includes("--follow"));
  assert.deepEqual(startRefs(), ["HEAD"]);
  assert.deepEqual(startRefs({ upstream: "origin/main" }), ["HEAD", "origin/main"]);
  assert.deepEqual(startRefs({ all: true, upstream: "x" }), ["--branches", "--remotes", "--tags", "HEAD"]);
});

test("parseLog reads a real log: hashes, parents, authors, refs, subjects with odd characters", () => {
  const d = fixture();
  try {
    const commits = parseLog(git(d, ...logArgs({ refs: startRefs({ all: true }) })));
    assert.equal(commits.length, 4);
    const [merge, ...rest] = commits;
    assert.equal(merge.parents.length, 2);
    assert.deepEqual(merge.refs, [{ kind: "branch", name: "main", current: true }]);
    assert.equal(merge.author, "Ann Author"); assert.equal(merge.email, "ann@x.org");
    assert.ok(merge.time > 1e9);
    assert.ok(rest.some((c) => c.subject === "Fix (the) bug in a | b"));
    const side = rest.find((c) => c.subject === "Side work");
    assert.deepEqual(side.refs, [{ kind: "branch", name: "side", current: false }]);
    const first = commits.at(-1);
    assert.deepEqual(first.parents, []);
    assert.deepEqual(first.refs, [{ kind: "tag", name: "v1", current: false }]);
    // Our turn refs never decorate.
    assert.ok(!commits.some((c) => c.refs.some((r) => r.name.includes(NAME))));
    // Searches: fixed strings, any case; author; path; one commit.
    assert.deepEqual(parseLog(git(d, ...logArgs({ search: parseQuery("(THE)") }))).map((c) => c.subject), ["Fix (the) bug in a | b"]);
    assert.equal(parseLog(git(d, ...logArgs({ search: parseQuery("author:ANN") }))).length, 4);
    assert.deepEqual(parseLog(git(d, ...logArgs({ search: parseQuery("path:b.txt"), follow: true }))).map((c) => c.subject), ["Side work"]);
    assert.equal(parseLog(git(d, ...logArgs({ count: 2 }))).length, 2);
    assert.equal(parseLog(git(d, ...logArgs({ skip: 3 }))).length, 1);
    assert.equal(parseLog(git(d, ...oneArgs(first.hash.slice(0, 7))))[0].hash, first.hash);
    // Details: the whole message and both people.
    const det = parseDetails(git(d, ...detailArgs(side.hash)));
    assert.equal(det.message, "Side work\n\nWith a body\nof two lines");
    assert.equal(det.committer, "Ann Author");
    assert.equal(det.parents.length, 1);
    // The files of the merge against its first parent.
    const files = parseNameStatus(git(d, "diff", "--name-status", "-z", "--no-renames", merge.parents[0], merge.hash));
    assert.deepEqual(files, [{ status: "A", path: "b.txt" }]);
    const stats = parseNumstat(git(d, "diff", "--numstat", "-z", "--no-renames", merge.parents[0], merge.hash));
    assert.deepEqual(stats.get("b.txt"), { add: 1, del: 0, binary: false });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("parseRefs sorts the current branch first and drops remote HEADs", () => {
  assert.deepEqual(parseRefs("tag: refs/tags/v2, refs/remotes/origin/HEAD, refs/remotes/origin/main, HEAD -> refs/heads/main, refs/heads/dev"), [
    { kind: "branch", name: "main", current: true },
    { kind: "branch", name: "dev", current: false },
    { kind: "remote", name: "origin/main", current: false },
    { kind: "tag", name: "v2", current: false },
  ]);
  assert.deepEqual(parseRefs("HEAD, refs/heads/x"), [{ kind: "head", name: "HEAD", current: true }, { kind: "branch", name: "x", current: false }]);
  assert.deepEqual(parseRefs(""), []);
  assert.deepEqual(parseRefs("refs/notes/commits"), []);
});

test("parseQuery: words, a hash prefix, author: and path: with quotes", () => {
  assert.deepEqual(parseQuery("fix login"), { grep: "fix login", author: null, path: null, sha: null, branch: null });
  assert.deepEqual(parseQuery("ABC1234"), { grep: "ABC1234", author: null, path: null, sha: "abc1234", branch: null });
  assert.equal(parseQuery("abc").sha, null);
  assert.deepEqual(parseQuery('author:"Ann A" path:"my dir/x.txt/" bug'), { grep: "bug", author: "Ann A", path: "my dir/x.txt", sha: null, branch: null });
  assert.deepEqual(parseQuery("path:./src/ author:"), { grep: null, author: null, path: "src", sha: null, branch: null });
  assert.deepEqual(parseQuery(""), { grep: null, author: null, path: null, sha: null, branch: null });
  // branch: one branch's history; never a value git would read as an option.
  assert.deepEqual(parseQuery("branch:feature/x fix"), { grep: "fix", author: null, path: null, sha: null, branch: "feature/x" });
  assert.equal(parseQuery("branch:--output=/tmp/x").branch, null);
  assert.equal(filtered(parseQuery("branch:main")), false, "one branch still draws its lanes");
  assert.deepEqual(startRefs({ all: true, upstream: "origin/main", branch: "side" }), ["side"]);
  assert.equal(filtered(parseQuery("")), false);
  assert.equal(filtered(parseQuery("path:x")), true);
});

test("name-status, numstat, details and times tolerate junk", () => {
  assert.deepEqual(parseNameStatus(""), []);
  assert.deepEqual(parseNameStatus("M\0a b.txt\0D\0c\0"), [{ status: "M", path: "a b.txt" }, { status: "D", path: "c" }]);
  assert.deepEqual([...parseNumstat("-\t-\timg.png\u00003\t1\ta\tb\0")], [["img.png", { add: 0, del: 0, binary: true }], ["a\tb", { add: 3, del: 1, binary: false }]]);
  assert.equal(parseDetails("nope"), null);
  assert.equal(ago(1000, 1030), "now");
  assert.equal(ago(0, 125), "2 min");
  assert.equal(ago(0, 7200), "2 h");
  assert.equal(ago(0, 45 * 3600), "2 d", "git says 2 days for 45 hours");
  assert.equal(ago(0, 86400 * 3), "3 d");
  assert.equal(ago(0, 86400 * 21), "3 w");
  assert.equal(ago(0, 86400 * 100), "3 mo");
  assert.equal(ago(0, 86400 * 800), "2 y");
  assert.match(when(1_700_000_000), /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.deepEqual([...hashSet("a\nb\n\n")], ["a", "b"]);
  assert.equal(signature("x y\n", "h\n"), "h|x y");
});

test("ago agrees with git's own relative dates (its rounding and where it changes units)", () => {
  // History said "1 d" for a commit 45 hours old while the branch list (git's words) said "2 days ago".
  const dir = mkdtempSync(join(tmpdir(), "ago-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const UNIT = { second: "now", seconds: "now", minute: "min", minutes: "min", hour: "h", hours: "h", day: "d", days: "d", week: "w", weeks: "w", month: "mo", months: "mo", year: "y", years: "y" };
    const now = Math.floor(Date.now() / 1000);
    for (const back of [30, 100, 89 * 60, 100 * 60, 30 * 3600, 45 * 3600, 3 * 86400, 13 * 86400 + 3600, 15 * 86400, 69 * 86400, 71 * 86400, 200 * 86400, 400 * 86400, 2000 * 86400]) {
      const at = now - back;
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", String(back)], { cwd: dir, env: { ...process.env, GIT_COMMITTER_DATE: `${at} +0000`, GIT_AUTHOR_DATE: `${at} +0000` } });
      const words = execFileSync("git", ["log", "-1", "--format=%cr"], { cwd: dir, encoding: "utf8" }).trim();
      const m = /^(\d+) ([a-z]+)/.exec(words);
      const theirs = m ? (UNIT[m[2]] === "now" ? "now" : `${m[1]} ${UNIT[m[2]]}`) : words;
      assert.equal(ago(at, Math.floor(Date.now() / 1000)), theirs, `${back} s back: git says "${words}"`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
