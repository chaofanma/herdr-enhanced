// rewrite.js against real repositories in the temp folder, its scripts under sh and dash: which commits may be
// rewritten, reword / squash / fixup / drop, an interactive rebase (reorder, squash, fixup, drop,
// reword at once), a rebase that stops on a conflict, a refusal, web pages, worktrees.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";

const R = await mod("rewrite.js");
const { runnerOf } = await mod("gitops.js");
const SHELLS = ["/bin/sh", ...(existsSync("/bin/dash") ? ["/bin/dash"] : [])];
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PI_") && !k.startsWith("GIT_"))), GIT_CONFIG_NOSYSTEM: "1" };
const run = (shell) => (command, args, { cwd } = {}) => {
  try {
    const program = command === "sh" ? shell : command;
    const stdout = execFileSync(program, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 << 20 });
    return Promise.resolve({ code: 0, stdout, stderr: "" });
  } catch (e) { return Promise.resolve({ code: e.status ?? 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") }); }
};
function repo() {
  const dir = tempDir("git-enhanced-rewrite-");
  const git = (...a) => execFileSync("git", a, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main"); git("config", "user.name", "t"); git("config", "user.email", "t@t"); git("config", "core.hooksPath", "/dev/null");
  const commit = (file, text, message) => { writeFileSync(join(dir, file), text); git("add", "-A"); git("commit", "-qm", message); return git("rev-parse", "HEAD").trim(); };
  return { dir, git, commit, log: () => git("log", "--format=%s", "HEAD").trim().split("\n") };
}

test("the todo list, which steps can run, whose messages git asks for, the message files", () => {
  assert.equal(R.todoOf([{ action: "pick", sha: "aaaaaaa" }, { action: "fixup", sha: "bbbbbbb" }]), "pick aaaaaaa\nfixup bbbbbbb\n");
  assert.equal(R.stepsProblem([]), "Nothing to rebase");
  assert.match(R.stepsProblem([{ action: "squash", sha: "aaaaaaa" }]), /can't be squashed/);
  assert.match(R.stepsProblem([{ action: "drop", sha: "aaaaaaa" }, { action: "fixup", sha: "bbbbbbb" }]), /can't be squashed/, "the first one kept");
  assert.match(R.stepsProblem([{ action: "drop", sha: "aaaaaaa" }]), /Every commit would be dropped/);
  assert.match(R.stepsProblem([{ action: "exec", sha: "aaaaaaa" }]), /is no step/);
  assert.match(R.stepsProblem([{ action: "pick", sha: "HEAD; rm" }]), /is no step/);
  assert.equal(R.stepsProblem([{ action: "pick", sha: "aaaaaaa" }, { action: "squash", sha: "bbbbbbb" }]), null);
  const steps = (s) => s.split(" ").map((x, i) => ({ action: x, sha: `${i}`.padStart(7, "a") }));
  assert.deepEqual(R.messageSteps(steps("pick reword squash fixup pick fixup fixup reword")), ["aaaaaa1", "aaaaaa2", "aaaaaa7"]);
  assert.deepEqual(R.messageSteps(steps("pick fixup squash pick squash")), ["aaaaaa2", "aaaaaa4"], "the last squash of each run");
  assert.deepEqual(R.messageFiles({ aaaaaaa: "Subject\n\nBody\n\n\n", bbbbbbb: "   ", "x; rm": "no" }), [{ name: "msg-aaaaaaa", text: "Subject\n\nBody\n" }]);
});

for (const shell of SHELLS) {
  const h = (dir) => runnerOf(run(shell), dir);
  test(`${shell}: what a rewrite takes: parents, on HEAD, pushed, the commits after it, merges in the way, too many`, async () => {
    const r = repo();
    const a = r.commit("f.txt", "1\n", "A"), b = r.commit("f.txt", "2\n", "B"), c = r.commit("g.txt", "g\n", "C");
    let ch = await R.chainOf(h(r.dir), b);
    assert.deepEqual([ch.parent, ch.grand, ch.parentMerges, ch.onHead, ch.pushed, ch.count], [a, null, false, true, false, 2]);
    assert.deepEqual(ch.chain.map((x) => x.sha), [b, c]);
    assert.equal(R.rewriteBlock(ch, { sha: b }), null);
    ch = await R.chainOf(h(r.dir), a);
    assert.deepEqual([ch.parent, ch.count, ch.chain.length], [null, 3, 3], "the root commit: every commit");
    assert.match(R.rewriteBlock(ch, { sha: a, action: "squash" }), /no parent to squash into/);
    assert.equal(R.rewriteBlock(ch, { sha: a, action: "reword" }), null);
    // Pushed: a remote branch has it.
    const bare = tempDir("git-enhanced-rewrite-remote-");
    execFileSync("git", ["init", "-q", "--bare", bare], { env });
    r.git("remote", "add", "origin", bare); r.git("push", "-q", "origin", `${b}:refs/heads/main`); r.git("fetch", "-q", "origin");
    ch = await R.chainOf(h(r.dir), b);
    assert.equal(ch.pushed, true);
    assert.match(R.rewriteBlock(ch, { sha: b }), /Already pushed/);
    assert.equal(R.rewriteBlock(ch, { sha: b, pushedOk: true }), null, "the person said so");
    assert.equal((await R.chainOf(h(r.dir), c)).pushed, false);
    // Not on HEAD; a merge in the way; too many.
    r.git("switch", "-q", "-c", "side", a); const s = r.commit("s.txt", "s\n", "S"); r.git("switch", "-q", "main");
    ch = await R.chainOf(h(r.dir), s);
    assert.equal(ch.onHead, false); assert.match(R.rewriteBlock(ch, { sha: s }), /current branch/);
    r.git("merge", "-q", "--no-ff", "--no-edit", "side");
    assert.match(R.rewriteBlock(await R.chainOf(h(r.dir), b), { sha: b }), /a merge between this commit and HEAD/);
    const big = repo();
    let stream = "";
    for (let i = 1; i <= R.MOST + 5; i++) stream += `commit refs/heads/main\nmark :${i}\ncommitter T <t@x> ${1_600_000_000 + i} +0000\ndata 3\nc${i % 10}\n${i > 1 ? `from :${i - 1}\n` : ""}M 644 inline f.txt\ndata ${String(i).length + 1}\n${i}\n\n`;
    execFileSync("git", ["fast-import", "--quiet"], { cwd: big.dir, input: stream, env });
    big.git("reset", "-q", "--hard");
    const first = big.git("rev-list", "--max-parents=0", "HEAD").trim();
    ch = await R.chainOf(h(big.dir), first);
    assert.equal(ch.count, R.MOST + 5); assert.equal(ch.chain.length, 0, "not listed");
    assert.match(R.rewriteBlock(ch, { sha: first }), /More than 500 commits/);
  });

  test(`${shell}: reword (a message of several paragraphs), squash with a message, fixup, drop, the root commit`, async () => {
    const r = repo();
    r.commit("f.txt", "1\n", "A"); const b = r.commit("f.txt", "2\n", "B"); const c = r.commit("g.txt", "g\n", "C"); r.commit("h.txt", "h\n", "D");
    const go = async (action, sha, message = null) => {
      const ch = await R.chainOf(h(r.dir), sha);
      assert.equal(R.rewriteBlock(ch, { sha, action }), null);
      return R.runPlan(h(r.dir), R.planFor(action, ch, { message }));
    };
    assert.deepEqual(await go("reword", b, "B, reworded\n\nWhy: a body\nof two lines.\n"), { stopped: null });
    assert.deepEqual(r.log(), ["D", "C", "B, reworded", "A"]);
    assert.equal(r.git("log", "-1", "--format=%B", "HEAD~2").trim(), "B, reworded\n\nWhy: a body\nof two lines.");
    assert.equal(r.git("show", "HEAD~2:f.txt"), "2\n", "the content stays");
    const c2 = r.git("rev-parse", "HEAD~1").trim();
    assert.deepEqual(await go("squash", c2, "B and C together"), { stopped: null });
    assert.deepEqual(r.log(), ["D", "B and C together", "A"]);
    assert.equal(r.git("show", "HEAD~1:g.txt"), "g\n");
    const d2 = r.git("rev-parse", "HEAD").trim();
    assert.deepEqual(await go("fixup", d2), { stopped: null });
    assert.deepEqual(r.log(), ["B and C together", "A"], "fixup keeps the parent's message");
    assert.equal(r.git("show", "HEAD:h.txt"), "h\n");
    r.commit("i.txt", "i\n", "E");
    const bc = r.git("rev-parse", "HEAD~1").trim();
    assert.deepEqual(await go("drop", bc), { stopped: null });
    assert.deepEqual(r.log(), ["E", "A"]);
    assert.equal(existsSync(join(r.dir, "g.txt")), false, "what it added is gone");
    const root = r.git("rev-list", "--max-parents=0", "HEAD").trim();
    assert.deepEqual(await go("reword", root, "The very first"), { stopped: null });
    assert.deepEqual(r.log(), ["E", "The very first"]);
    assert.equal(r.git("status", "--porcelain").trim(), "");
    void c;
  });

  test(`${shell}: one interactive rebase: reorder, squash with its message, fixup, drop, reword`, async () => {
    const r = repo();
    const a = r.commit("a.txt", "a\n", "A"), b = r.commit("b.txt", "b\n", "B"), c = r.commit("c.txt", "c\n", "C"), d = r.commit("d.txt", "d\n", "D"), e = r.commit("e.txt", "e\n", "E");
    const ch = await R.chainOf(h(r.dir), b);
    assert.deepEqual(ch.chain.map((x) => x.sha), [b, c, d, e]);
    // E first, then B with C squashed in, D dropped... and E reworded.
    const rows = [{ sha: e, action: "reword" }, { sha: b, action: "pick" }, { sha: c, action: "squash" }, { sha: d, action: "drop" }];
    const plan = R.editorPlan(ch, rows, { [e]: "E, first now", [c]: "B with C", [b]: "not asked: dropped from the plan" });
    assert.deepEqual(Object.keys(plan.messages).sort(), [c, e].sort());
    assert.equal(plan.base, a);
    assert.deepEqual(await R.runPlan(h(r.dir), plan), { stopped: null });
    assert.deepEqual(r.log(), ["B with C", "E, first now", "A"]);
    assert.equal(existsSync(join(r.dir, "d.txt")), false);
    assert.equal(r.git("show", "HEAD:c.txt"), "c\n");
    // A squash without a message of ours: git's combined one, its comments gone.
    const ch2 = await R.chainOf(h(r.dir), r.git("rev-parse", "HEAD~1").trim());
    const [x, y] = ch2.chain.map((k) => k.sha);
    assert.deepEqual(await R.runPlan(h(r.dir), R.editorPlan(ch2, [{ sha: x, action: "pick" }, { sha: y, action: "squash" }])), { stopped: null });
    const message = r.git("log", "-1", "--format=%B").trim();
    assert.match(message, /E, first now/); assert.match(message, /B with C/); assert.doesNotMatch(message, /^#/m);
  });

  test(`${shell}: a rebase that stops on a conflict waits (abort brings it all back); git's refusal is an error`, async () => {
    const r = repo();
    r.commit("f.txt", "1\n", "A"); const b = r.commit("f.txt", "2\n", "B"); r.commit("f.txt", "3\n", "C");
    const before = r.git("rev-parse", "HEAD").trim();
    const ch = await R.chainOf(h(r.dir), b);
    const out = await R.runPlan(h(r.dir), R.planFor("drop", ch));
    assert.ok(out.stopped, "stopped");
    assert.match(out.stopped, /conflict|CONFLICT|could not apply/i);
    assert.ok(existsSync(join(r.dir, ".git", "rebase-merge")));
    r.git("rebase", "--abort");
    assert.equal(r.git("rev-parse", "HEAD").trim(), before);
    writeFileSync(join(r.dir, "f.txt"), "dirty\n");
    await assert.rejects(R.runPlan(h(r.dir), R.planFor("reword", await R.chainOf(h(r.dir), b), { message: "x" })), /unstaged changes|uncommitted|commit or stash/i);
    assert.equal(r.git("rev-parse", "HEAD").trim(), before, "nothing moved");
    assert.equal(existsSync(join(r.dir, ".git", "rebase-merge")), false);
  });

  test(`${shell}: a worktree with a new branch at a commit, where Herdr's worktree dialog puts them`, async () => {
    const r = repo();
    const a = r.commit("f.txt", "1\n", "A"); r.commit("f.txt", "2\n", "B");
    const base = tempDir("git-enhanced-worktrees-");
    const made = await h(r.dir).sh(R.WORKTREE_SH, ["feature/a+b", a, base]);
    assert.equal(made.code, 0, made.stderr);
    const name = r.dir.split("/").pop(), path = `${base}/${name}/${R.slugOf("feature/a+b")}`;
    assert.equal(made.stdout.trim(), path);
    assert.equal(R.slugOf("feature/a+b"), "feature-a-b"); assert.equal(R.slugOf("-x//y-"), "x-y");
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: path, encoding: "utf8" }).trim(), a);
    assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: path, encoding: "utf8" }).trim(), "feature/a+b");
    const again = await h(r.dir).sh(R.WORKTREE_SH, ["feature/a+b", a, base]);
    assert.notEqual(again.code, 0); assert.match(again.stderr, /already exists/);
    // From inside a linked worktree: still the repository's name.
    const inner = await h(path).sh(R.WORKTREE_SH, ["two", a, base]);
    assert.equal(inner.stdout.trim(), `${base}/${name}/two`, inner.stderr);
  });
}

test("a commit's page on the web from the remote's URL; the site's name", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(R.webUrl("git@github.com:owner/repo.git", sha), `https://github.com/owner/repo/commit/${sha}`);
  assert.equal(R.webUrl("https://github.com/owner/repo.git", sha), `https://github.com/owner/repo/commit/${sha}`);
  assert.equal(R.webUrl("https://github.com/owner/repo", sha), `https://github.com/owner/repo/commit/${sha}`);
  assert.equal(R.webUrl("ssh://git@ssh.github.com:443/owner/repo.git", sha), `https://github.com/owner/repo/commit/${sha}`);
  assert.equal(R.webUrl("https://me@bitbucket.org/team/repo.git", sha), `https://bitbucket.org/team/repo/commits/${sha}`);
  assert.equal(R.webUrl("git@gitlab.com:group/sub/repo.git", sha), `https://gitlab.com/group/sub/repo/-/commit/${sha}`);
  for (const bad of ["/tmp/remote.git", "file:///tmp/remote.git", "../other", "", "git@host:../../etc"]) assert.equal(R.webUrl(bad, sha), null, bad);
  assert.equal(R.webUrl("git@github.com:owner/repo.git", "HEAD"), null);
  assert.equal(R.siteOf(`https://github.com/o/r/commit/${sha}`), "GitHub");
  assert.equal(R.siteOf(`https://gitlab.com/o/r/-/commit/${sha}`), "GitLab");
  assert.equal(R.siteOf(`https://git.example.com/o/r/commit/${sha}`), "git.example.com");
});
