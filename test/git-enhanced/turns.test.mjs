import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, chmodSync, existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { mod, NAME } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { TURNS, turnRef, TOO_BIG, turnEvents, SNAPSHOT, snapshotArgs, readSnapshot, revertPlan, planPaths, planWords, pruneTurns, recordRefs, turnLabel, overlapping, turnId } = await mod("turns.js");

const tmp = (name = "turns-test-") => tempDir(`git-enhanced-${name}`);
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const repo = (dir) => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q"); git(dir, "config", "user.name", "Pat"); git(dir, "config", "user.email", "pat@x");
  return dir;
};
// Runs the snapshot as the recorder does (sh, its watchdog inside), here, with its TMPDIR apart;
// under dash too (a Linux machine's sh) when SHELL_FOR_TESTS says so.
let SH = "sh";
const snap = (cwd, opts = {}, env = {}) => {
  const r = spawnSync(SH, snapshotArgs(opts), { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return readSnapshot({ code: r.status ?? (r.signal ? 128 : 1), stdout: r.stdout, stderr: r.stderr });
};
const DASH = existsSync("/bin/dash") ? "/bin/dash" : null;

test("turnEvents: working starts a turn, blocked keeps it, done or idle (or gone) ends it", () => {
  const a = (address, status) => ({ address, status });
  assert.deepEqual(turnEvents({ agents: [a("t1", "working")], open: [] }), { end: [], start: [a("t1", "working")] });
  assert.deepEqual(turnEvents({ agents: [a("t1", "working")], open: [{ id: "x", address: "t1" }] }), { end: [], start: [] });
  assert.deepEqual(turnEvents({ agents: [a("t1", "blocked")], open: [{ id: "x", address: "t1" }] }), { end: [], start: [] }, "blocked: still the same turn");
  assert.deepEqual(turnEvents({ agents: [a("t1", "blocked")], open: [] }), { end: [], start: [] }, "blocked never starts one");
  assert.deepEqual(turnEvents({ agents: [a("t1", "done")], open: [{ id: "x", address: "t1" }] }), { end: ["x"], start: [] });
  assert.deepEqual(turnEvents({ agents: [a("t1", "idle")], open: [{ id: "x", address: "t1" }] }), { end: ["x"], start: [] });
  assert.deepEqual(turnEvents({ agents: [], open: [{ id: "x", address: "t1" }] }), { end: ["x"], start: [] }, "the agent went away");
  assert.deepEqual(turnEvents({ agents: [a("t1", "idle"), a("t2", "done")], open: [] }), { end: [], start: [] });
  // Two agents, each its own turn.
  assert.deepEqual(turnEvents({ agents: [a("t1", "working"), a("t2", "working")], open: [{ id: "x", address: "t1" }] }).start.map((x) => x.address), ["t2"]);
  // A snapshot of theirs still running: left alone either way.
  assert.deepEqual(turnEvents({ agents: [a("t1", "idle"), a("t2", "working")], open: [{ id: "x", address: "t1" }], busy: new Set(["t1", "t2"]) }), { end: [], start: [] });
});

test("turnEvents: the first check after a restart closes every open turn, then starts the working ones", () => {
  const agents = [{ address: "t1", status: "working" }, { address: "t2", status: "idle" }];
  const open = [{ id: "x", address: "t1" }, { id: "y", address: "t2" }, { id: "z", address: "gone" }];
  const e = turnEvents({ agents, open, first: true });
  assert.deepEqual(e.end, ["x", "y", "z"]);
  assert.deepEqual(e.start.map((a) => a.address), ["t1"]);
});

test("the snapshot leaves the index, HEAD, branches and files alone and keeps everything in a ref", () => {
  const d = repo(join(tmp(), "a repo with 'quotes' and spaces"));
  try {
    writeFileSync(join(d, "tracked.txt"), "one\n"); writeFileSync(join(d, "staged.txt"), "s\n");
    writeFileSync(join(d, ".gitignore"), "ignored.txt\n");
    git(d, "add", "-A"); git(d, "commit", "-qm", "base");
    writeFileSync(join(d, "tracked.txt"), "one\nchanged\n");          // unstaged
    writeFileSync(join(d, "staged.txt"), "s2\n"); git(d, "add", "staged.txt");   // staged
    writeFileSync(join(d, "new file.txt"), "untracked\n");            // untracked
    writeFileSync(join(d, "ignored.txt"), "never\n");
    const index = readFileSync(join(d, ".git", "index")), head = git(d, "rev-parse", "HEAD").trim(), status = git(d, "status", "--porcelain");
    const own = tmp("turns-tmpdir-");
    const s = snap(d, { ref: turnRef("t-1", "start"), message: `it's "quoted" $HOME` }, { TMPDIR: own });
    assert.ok(s.commit, JSON.stringify(s));
    assert.deepEqual(readFileSync(join(d, ".git", "index")), index, "the index is byte for byte the same");
    assert.equal(git(d, "rev-parse", "HEAD").trim(), head);
    assert.equal(git(d, "status", "--porcelain"), status);
    assert.equal(git(d, "branch", "--list").trim(), "* master".replace("master", git(d, "symbolic-ref", "--short", "HEAD").trim()));
    assert.equal(git(d, "rev-parse", turnRef("t-1", "start")).trim(), s.commit);
    assert.equal(git(d, "log", "-1", "--format=%P", s.commit).trim(), head, "HEAD is its parent");
    assert.equal(git(d, "log", "-1", "--format=%B", s.commit).trim(), `it's "quoted" $HOME`);
    assert.equal(git(d, "show", `${s.commit}:tracked.txt`), "one\nchanged\n");
    assert.equal(git(d, "show", `${s.commit}:staged.txt`), "s2\n");
    assert.equal(git(d, "show", `${s.commit}:new file.txt`), "untracked\n");
    assert.throws(() => git(d, "show", `${s.commit}:ignored.txt`), "ignored files are not snapshotted");
    assert.deepEqual(readdirSync(own), [], "the temp index is gone");
    // Tree only: no commit, no ref.
    const tree = snap(d, { tree: true }, { TMPDIR: own });
    assert.ok(tree.tree && !tree.commit);
    assert.equal(git(d, "rev-parse", `${s.commit}^{tree}`).trim(), tree.tree, "the same tree");
    assert.deepEqual(readdirSync(own), []);
    // No ref given: a commit, no ref.
    const loose = snap(d, {}, { TMPDIR: own });
    assert.ok(loose.commit);
  } finally { /* the repo is in its own temp folder */ }
});

test("the snapshot works without commits, without an index and without an identity", () => {
  const d = repo(join(tmp(), "fresh"));
  writeFileSync(join(d, "a.txt"), "a\n");
  const s = snap(d, { ref: turnRef("t-2", "start") }, { GIT_CONFIG_GLOBAL: "/dev/null", HOME: d });
  assert.ok(s.commit, JSON.stringify(s));
  assert.equal(git(d, "log", "-1", "--format=%P", s.commit).trim(), "", "no parent");
  assert.equal(git(d, "show", `${s.commit}:a.txt`), "a\n");
  assert.ok(!existsSync(join(d, ".git", "index")), "no index made");
});

for (const shell of ["sh", ...(DASH ? [DASH] : [])]) {
  test(`out of time (${shell}): skipped, the git it ran stopped, the temp index gone`, () => {
    SH = shell;
    try {
      const d = repo(join(tmp(), "slow"));
      writeFileSync(join(d, "a.txt"), "a\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "a");
      // A git whose add takes long.
      const bin = tmp("turns-bin-"), real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
      // (its sleep runs in a shell of its own: what git might start, which must be stopped too). Its
      // length is this run's own, 31 s and a fraction made of this process's id, so the check below
      // finds this test's sleep only: another test run on the machine at the same time (dash's
      // leftover lives until its test ends) neither counts nor is killed here, nor anyone's sleep 31.
      const slow = `31.${process.pid}${shell === "sh" ? 1 : 2}`;
      writeFileSync(join(bin, "git"), `#!/bin/sh\ncase " $* " in *" add -A "*) sh -c 'sleep ${slow}; true';; esac\nexec ${real} "$@"\n`); chmodSync(join(bin, "git"), 0o755);
      const own = tmp("turns-tmpdir-"), t0 = Date.now();
      const s = snap(d, { ref: turnRef("t-3", "start"), timeout: 1 }, { PATH: `${bin}:${process.env.PATH}`, TMPDIR: own });
      assert.deepEqual(s, { skipped: TOO_BIG });
      // Well under the slow add's 31 s, with room for a busy machine (7 s seen under load; dash ~4.6 s alone).
      assert.ok(Date.now() - t0 < 20000, "stopped at the limit, not after the slow add");
      assert.deepEqual(readdirSync(own), [], "the temp index is gone");
      assert.throws(() => git(d, "rev-parse", "--verify", "-q", turnRef("t-3", "start")));
      // (ps lists every process with its arguments: other tests' scripts carry big arguments, so a big buffer.)
      const mine = new RegExp(`^\\s*\\d+ sleep ${slow.replace(".", "\\.")}$`);
      const left = () => execFileSync("ps", ["-A", "-o", "pid=,command="], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter((l) => mine.test(l));
      // A busy machine can take a few seconds to end a stopped process (dash's sleep stays: no wait).
      if (shell === "sh") for (const until = Date.now() + 10000; left().length && Date.now() < until;) execFileSync("sleep", ["0.1"]);
      const stray = left();
      for (const l of stray) spawnSync("kill", ["-9", l.trim().split(" ")[0]]);
      // bash (macOS's sh) gives the watched git a process group of its own, so what it started goes
      // too; dash without a terminal can't, and only git itself is stopped (its leftovers hold
      // nothing of the caller's).
      if (shell === "sh") assert.equal(stray.length, 0, "the slow add, and what it started, were stopped too");
    } finally { SH = "sh"; }
  });
}

test("racy git: an edit in the same second as the last add, with the same size, is snapshotted", () => {
  // The index and the file share one timestamp (an add and an edit within a second): git can't tell
  // from the file's stat, so it compares the content because the entry is no older than the index.
  // A copy of the index made later must keep the index's time, or git skips that check.
  const d = repo(join(tmp(), "racy"));
  writeFileSync(join(d, "edit.txt"), "one\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "one");
  const t = Math.floor(Date.now() / 1000) - 100;
  writeFileSync(join(d, "edit.txt"), "two\n"); utimesSync(join(d, "edit.txt"), t, t);
  git(d, "add", "edit.txt");
  writeFileSync(join(d, "edit.txt"), "six\n"); utimesSync(join(d, "edit.txt"), t, t); utimesSync(join(d, ".git", "index"), t, t);
  // (--no-optional-locks: a plain status would write the index back, which hides the case.)
  assert.match(git(d, "--no-optional-locks", "status", "--porcelain"), /^MM edit.txt/m, "git itself sees the edit");
  const s = snap(d, { ref: turnRef("t-racy", "start") });
  assert.ok(s.commit, JSON.stringify(s));
  assert.equal(git(d, "show", `${s.commit}:edit.txt`), "six\n", "the snapshot has the file as it is");
});

test("snapshotArgs passes everything as arguments, never inside the script", () => {
  const a = snapshotArgs({ ref: "refs/x; rm -rf /", message: "$(boom)", timeout: 7 });
  assert.deepEqual(a.slice(0, 2), ["-c", SNAPSHOT]);
  assert.deepEqual(a.slice(2), ["sh", "commit", "refs/x; rm -rf /", "$(boom)", "7"]);
  assert.ok(!SNAPSHOT.includes("boom"));
  assert.ok(!/perl/.test(SNAPSHOT), "no perl");
  assert.deepEqual(snapshotArgs({ tree: true }).slice(2), ["sh", "tree", "", `${NAME} turn`, "10"]);
  assert.deepEqual(readSnapshot({ code: 1, stderr: "hint: x\nfatal: no" }), { error: "fatal: no" });
  assert.deepEqual(readSnapshot({ code: 0, stdout: "garbage" }).error !== undefined, true);
});

test("revertPlan: changed files go back, created ones go, deleted ones come back", () => {
  const plan = revertPlan(["M", "src/a.js", "A", "new dir/n.txt", "D", "gone.txt", "T", "link", "M", "../escape", "A", "/abs", ""].join("\0"));
  assert.deepEqual(plan, [
    { path: "gone.txt", was: "D", action: "restore" },
    { path: "link", was: "T", action: "restore" },
    { path: "new dir/n.txt", was: "A", action: "delete" },
    { path: "src/a.js", was: "M", action: "restore" },
  ]);
  assert.deepEqual(planPaths(plan), { restore: ["gone.txt", "link", "src/a.js"], remove: ["new dir/n.txt"] });
  assert.equal(planWords(plan[0]), "deleted by the turn: brought back");
  assert.equal(planWords(plan[2]), "created by the turn: deleted");
  assert.equal(planWords(plan[3]), "back to how it was at the start");
  assert.deepEqual(revertPlan(""), []);
});

test("a real revert plan from two snapshots", () => {
  const d = repo(join(tmp(), "plan"));
  writeFileSync(join(d, "keep.txt"), "k\n"); writeFileSync(join(d, "edit.txt"), "1\n"); writeFileSync(join(d, "del.txt"), "d\n");
  git(d, "add", "-A"); git(d, "commit", "-qm", "base");
  writeFileSync(join(d, "untracked-before.txt"), "u\n");
  const start = snap(d, { ref: turnRef("p", "start") }).commit;
  writeFileSync(join(d, "edit.txt"), "2\n"); rmSync(join(d, "del.txt")); writeFileSync(join(d, "made.txt"), "m\n"); rmSync(join(d, "untracked-before.txt"));
  const end = snap(d, { ref: turnRef("p", "end") }).commit;
  const plan = revertPlan(git(d, "diff", "--name-status", "-z", "--no-renames", start, end));
  assert.deepEqual(plan.map((p) => [p.path, p.was, p.action]), [["del.txt", "D", "restore"], ["edit.txt", "M", "restore"], ["made.txt", "A", "delete"], ["untracked-before.txt", "D", "restore"]]);
  // What the revert runs: restore from the start (worktree only), then the created files go.
  const index = readFileSync(join(d, ".git", "index"));
  const { restore, remove } = planPaths(plan);
  git(d, "--literal-pathspecs", "restore", `--source=${start}`, "--worktree", "--", ...restore);
  for (const p of remove) rmSync(join(d, p));
  assert.equal(readFileSync(join(d, "edit.txt"), "utf8"), "1\n");
  assert.equal(readFileSync(join(d, "del.txt"), "utf8"), "d\n");
  assert.equal(readFileSync(join(d, "untracked-before.txt"), "utf8"), "u\n", "an untracked file comes back too");
  assert.ok(!existsSync(join(d, "made.txt")));
  assert.deepEqual(readFileSync(join(d, ".git", "index")), index, "the index untouched");
});

test("pruneTurns keeps the newest per repository, never an open turn", () => {
  const r = (id, repo, at, open = false) => ({ id, repo, start: { at }, end: open ? null : { at: at + 1 } });
  const list = [r("a1", "A", 1), r("a2", "A", 2), r("a3", "A", 3), r("b1", "B", 1), r("a0", "A", 0, true)];
  const { kept, dropped } = pruneTurns(list, 2);
  assert.deepEqual(kept.map((x) => x.id), ["a3", "a2", "b1", "a0"]);
  assert.deepEqual(dropped.map((x) => x.id), ["a1"]);
  assert.deepEqual(pruneTurns(list, 0).kept.map((x) => x.id), ["a0"]);
  assert.deepEqual(pruneTurns("junk", 5), { kept: [], dropped: [] });
  assert.deepEqual(recordRefs({ id: "q" }), [`refs/${NAME}/turns/q/start`, `refs/${NAME}/turns/q/end`, `refs/${NAME}/turns/q/undo`]);
  assert.equal(TURNS, `${NAME}.turns`);
});

test("labels, overlaps and ids", () => {
  const at = (h, m) => new Date(2025, 0, 31, h, m).getTime();
  const pi = { id: "1", repo: "R", agent: "pi", start: { at: at(14, 3) }, end: { at: at(14, 7) }, files: 5 };
  assert.equal(turnLabel(pi), "pi · 14:03–14:07 · 5 files");
  assert.equal(turnLabel({ ...pi, files: 1 }), "pi · 14:03–14:07 · 1 file");
  assert.equal(turnLabel({ ...pi, end: null }), "pi · 14:03– · running");
  assert.equal(turnLabel({ ...pi, skipped: TOO_BIG }), `pi · 14:03–14:07 · skipped (${TOO_BIG})`);
  const codex = { id: "2", repo: "R", agent: "codex", start: { at: at(14, 5) }, end: { at: at(14, 9) } };
  const later = { id: "3", repo: "R", agent: "pi", start: { at: at(15, 0) }, end: { at: at(15, 1) } };
  const elsewhere = { id: "4", repo: "S", agent: "pi", start: { at: at(14, 4) }, end: null };
  assert.deepEqual(overlapping([pi, codex, later, elsewhere], pi).map((x) => x.id), ["2"]);
  assert.deepEqual(overlapping([pi, codex, later], later), []);
  assert.deepEqual(overlapping([pi, { ...codex, end: null }], pi, at(16, 0)).map((x) => x.id), ["2"], "a running turn overlaps what came after its start");
  assert.match(turnId(1_700_000_000_000, 0.5), /^[a-z0-9]+-[a-z0-9]{4}$/);
  assert.notEqual(turnId(1, 0.1), turnId(1, 0.2));
});
