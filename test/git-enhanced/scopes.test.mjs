import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mod, NAME } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { READ_ONLY, readOnly, scopeId, parseScope, readOnlyRange, readOnlyLabel, readOnlyWords, COMMITS, REFS, parseCommits, parseRefList, matching, changesPage } = await mod("scopes.js");

const git = (cwd, ...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("scope ids: the three working-tree scopes as before, commits and refs with their target", () => {
  for (const s of ["work", "last", "branch"]) { assert.deepEqual(parseScope(s), { scope: s, target: null }); assert.equal(scopeId(s), s); }
  assert.deepEqual(parseScope("commit:0123abc"), { scope: "commit", target: "0123abc" });
  assert.deepEqual(parseScope("ref:origin/main"), { scope: "ref", target: "origin/main" });
  assert.deepEqual(parseScope("ref:a:b"), { scope: "ref", target: "a:b" }, "only the first colon splits");
  assert.equal(scopeId("ref", "v1"), "ref:v1");
  assert.equal(parseScope("commit:"), null);
  assert.equal(parseScope("nonsense"), null);
  assert.equal(parseScope("work:x").target, null);
  assert.equal(parseScope(undefined), null); assert.equal(parseScope(7), null);
  assert.deepEqual(READ_ONLY, ["commit", "ref", "turn"]);
  assert.deepEqual(parseScope("turn:lz1-ab12"), { scope: "turn", target: "lz1-ab12" });
  assert.equal(readOnly("turn"), true);
  assert.equal(readOnly("commit"), true); assert.equal(readOnly("work"), false); assert.equal(readOnly("last"), false);
});

test("what a read-only scope compares", () => {
  assert.deepEqual(readOnlyRange("commit", { sha: "c", parent: "p", empty: null }), { from: "p", to: "c" });
  assert.deepEqual(readOnlyRange("commit", { sha: "c", parent: null, empty: "e" }), { from: "e", to: "c" });
  assert.deepEqual(readOnlyRange("ref", { sha: "r", parent: "p" }), { from: "r", to: null });
  assert.equal(readOnlyRange("work", {}), null);
  assert.deepEqual(readOnlyRange("turn", { sha: "s", to: "e" }), { from: "s", to: "e" });
  assert.equal(readOnlyRange("turn", { sha: "s", to: null }), null);
  const at = new Date(2025, 0, 31, 14, 3).getTime(), turn = { agent: "pi", start: { at }, end: { at: at + 4 * 60000 } };
  assert.equal(readOnlyLabel("turn", "x", { turn }), "Turn · pi 14:03");
  assert.equal(readOnlyWords("turn", "x", { turn }), "what pi's turn changed (14:03–14:07)");
  assert.match(readOnlyWords("turn", "x", { turn: { ...turn, end: null } }), /still running, so against the working tree/);
  assert.equal(readOnlyLabel("turn", "x", null), "Turn");
  const sha = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(readOnlyLabel("commit", sha), "Commit 0123456");
  assert.equal(readOnlyLabel("ref", "main"), "vs main");
  assert.equal(readOnlyLabel("ref", sha), "vs 0123456");
  assert.equal(readOnlyWords("commit", sha, { subject: "Fix it" }), 'commit 0123456, "Fix it" against its first parent');
  assert.equal(readOnlyWords("commit", sha, { root: true }), "root commit 0123456 (all of its files)");
  assert.equal(readOnlyWords("ref", "v1", { sha }), "the working tree against v1 (0123456)");
});

test("the picker's lists from real git output, filtered by what is typed", () => {
  const d = tempDir("git-enhanced-scopes-");
  try {
    git(d, "init", "-q");
    writeFileSync(join(d, "a"), "1\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "First thing");
    git(d, "tag", "v1"); git(d, "branch", "feature/x");
    writeFileSync(join(d, "a"), "2\n"); git(d, "commit", "-qam", "Second thing");
    git(d, "update-ref", "refs/remotes/origin/HEAD", "HEAD"); git(d, "update-ref", "refs/remotes/origin/main", "HEAD");
    const commits = parseCommits(git(d, ...COMMITS));
    assert.deepEqual(commits.map((c) => c.subject), ["Second thing", "First thing"]);
    assert.ok(commits.every((c) => /^[0-9a-f]{40}$/.test(c.sha) && c.short.length >= 7 && c.age));
    const refs = parseRefList(git(d, ...REFS));
    assert.deepEqual(refs.map((r) => [r.kind, r.name]).sort(), [["branch", "feature/x"], ["branch", "main"], ["remote", "origin/main"], ["tag", "v1"]].sort());
    assert.deepEqual(matching(refs, "FEAT").map((r) => r.name), ["feature/x"]);
    assert.deepEqual(matching(commits, commits[1].short).map((c) => c.subject), ["First thing"]);
    assert.deepEqual(matching(commits, "second").length, 1);
    assert.equal(matching(refs, "  ").length, refs.length);
    assert.deepEqual(parseCommits("junk\n"), []);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("changesPage finds the panel's Changes page, not a History page, a Review tab or the tab header", () => {
  const tree = { id: "root", type: "row", children: [
    { id: "main", type: "block", content: { tab: "active" } },
    { id: "panel", type: "column", children: [{ id: "panel-body", type: "stack", children: [
      { id: "files", type: "block", content: { mod: "files-enhanced" } },
      { id: "history", type: "block", content: { mod: NAME, props: { view: "history" } } },
      { id: "tabs", type: "block", content: { mod: NAME, props: { role: "tabs", stack: "panel-body" } } },
      { id: "changes", type: "block", content: { mod: NAME, props: { palette: "theme" } } },
      { id: "other", type: "block", content: { mod: "changes" } },
    ] }] },
  ] };
  assert.deepEqual(changesPage(tree), { stack: "panel-body", child: "changes" });
  assert.equal(changesPage({ id: "r", type: "row", children: [{ id: "c", type: "block", content: { mod: NAME } }] }), null, "not in a stack: nothing to select");
  assert.equal(changesPage(null), null);
});
