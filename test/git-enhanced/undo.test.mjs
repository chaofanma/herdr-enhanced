import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { UNDO_MARK, REFLOG_FORMAT, parseReflog, lastAction, actionWords, undoArgs, markedArgs } = await mod("undo.js");

const e = (hash, subject) => ({ hash, subject });

test("the reflog's last user action, as lazygit finds it", () => {
  assert.equal(lastAction([]), null);
  assert.deepEqual(lastAction([e("c", "commit: three"), e("b", "commit: two")]), { kind: "commit", from: "b", to: "c", subject: "commit: three" });
  assert.deepEqual(lastAction([e("b", "checkout: moving from main to side"), e("b", "commit: two")]), { kind: "checkout", from: "main", to: "side", subject: "checkout: moving from main to side" });
  // An undo mark skips the action it undid: the next undo goes one further back.
  assert.equal(lastAction([e("b", `${UNDO_MARK}: updating HEAD`), e("c", "commit: three"), e("b", "commit: two"), e("a", "commit (initial): one")]).subject, "commit: two");
  assert.equal(lastAction([e("x", "[lazygit undo]: updating HEAD"), e("y", `${UNDO_MARK}`), e("c", "checkout: moving from a to b"), e("c", "commit: three"), e("b", "commit: two"), e("a", "commit (initial): one")]).subject, "commit: two");
  // The oldest entry has nothing before it to go back to.
  assert.equal(lastAction([e("b", "commit: two")]), null);
  // git stash's "reset: moving to HEAD" goes nowhere: no action.
  assert.equal(lastAction([e("c", "reset: moving to HEAD"), e("c", "commit: three"), e("b", "commit: two")]).subject, "commit: three");
  assert.deepEqual(lastAction([e("a", "commit (initial): one")]), { kind: "initial", from: null, to: "a", subject: "commit (initial): one" });
  // A finished rebase, from its start; its picks are skipped.
  const rebase = [e("r2", "rebase (finish): returning to refs/heads/side"), e("r2", "rebase (pick): two"), e("r1", "rebase (pick): one"), e("m", "rebase (start): checkout main"), e("s", "commit: side work")];
  assert.deepEqual(lastAction(rebase), { kind: "rebase", from: "s", to: "r2", start: "rebase (start): checkout main", subject: "rebase (start): checkout main" });
  // An aborted rebase ends where it began: no action; the commit before it is the last.
  assert.equal(lastAction([e("s", "rebase (abort): updating HEAD"), e("m", "rebase (start): checkout main"), e("s", "commit: side work"), e("p", "commit: base")]).subject, "commit: side work");
  assert.equal(lastAction([e("r1", "rebase (pick): one"), e("m", "rebase (start): checkout main"), e("s", "commit: x")]).kind, "rebasing");
  assert.equal(lastAction([e("m2", "pull --ff-only: Fast-forward"), e("m1", "commit: x")]).kind, "move");
  assert.equal(lastAction([e("p2", "pull --rebase (finish): returning to refs/heads/main"), e("p1", "pull --rebase (pick): x"), e("u", "pull --rebase (start): checkout u"), e("o", "commit: mine")]).kind, "rebase");
  assert.equal(lastAction([e("z", "fetch: whatever"), e("c", "commit: c"), e("b", "commit: b")]).subject, "commit: c", "other entries aren't actions");
});

test("the action in words, and what undoes it", () => {
  const w = (subject, kind = "move", extra = {}) => actionWords({ kind, subject, from: "f", to: "t", ...extra });
  assert.equal(w("commit: Fix it", "commit"), "commit “Fix it”");
  assert.equal(w("commit (amend): Fix it", "commit"), "amend “Fix it”");
  assert.equal(w("commit (merge): Merge branch 'x'", "commit"), "merge commit “Merge branch 'x'”");
  assert.equal(w("commit (initial): one", "initial"), "the first commit “one”");
  assert.equal(w("reset: moving to HEAD~2"), "reset to HEAD~2");
  assert.equal(w("merge side: Fast-forward"), "merge of side (fast-forward)");
  assert.equal(w("merge side: Merge made by the 'ort' strategy."), "merge of side");
  assert.equal(w("pull --ff-only: Fast-forward"), "pull (fast-forward)");
  assert.equal(w("cherry-pick: A thing"), "cherry-pick “A thing”");
  assert.equal(w("revert: Revert \"A thing\""), "revert “Revert \"A thing\"”");
  assert.equal(actionWords({ kind: "checkout", from: "main", to: "side" }), "switch from main to side");
  assert.equal(actionWords({ kind: "rebase", start: "rebase (start): checkout main" }), "rebase onto main");
  assert.deepEqual(undoArgs({ kind: "commit", from: "abc" }), ["reset", "--soft", "abc"]);
  assert.deepEqual(undoArgs({ kind: "move", from: "abc" }), ["reset", "--keep", "abc"]);
  assert.deepEqual(undoArgs({ kind: "rebase", from: "abc" }), ["reset", "--keep", "abc"]);
  assert.deepEqual(undoArgs({ kind: "checkout", from: "main" }, true), ["switch", "main"]);
  assert.deepEqual(undoArgs({ kind: "checkout", from: "abc1234" }, false), ["switch", "--detach", "abc1234"]);
  assert.deepEqual(undoArgs({ kind: "initial" }), ["update-ref", "-d", "HEAD"]);
});

test("undo after undo in a real repo: each takes the next action back", () => {
  const dir = tempDir("git-enhanced-undo-");
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const undo = () => {
    const a = lastAction(parseReflog(git("log", "-g", "-n", "200", REFLOG_FORMAT, "HEAD")));
    const branch = a.kind === "checkout" && spawnSync("git", ["rev-parse", "-q", "--verify", `refs/heads/${a.from}`], { cwd: dir }).status === 0;
    const r = spawnSync("sh", markedArgs(undoArgs(a, branch)), { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return actionWords(a);
  };
  const head = () => git("log", "-1", "--format=%s").trim();
  git("init", "-q", "-b", "main"); git("config", "user.name", "t"); git("config", "user.email", "t@t");
  writeFileSync(join(dir, "f"), "1\n"); git("add", "-A"); git("commit", "-qm", "one");
  writeFileSync(join(dir, "f"), "2\n"); git("commit", "-qam", "two");
  git("switch", "-q", "-c", "side"); writeFileSync(join(dir, "s"), "s\n"); git("add", "-A"); git("commit", "-qm", "side");
  git("switch", "-q", "main");
  git("merge", "-q", "--no-edit", "side");
  git("commit", "-q", "--amend", "-m", "two, amended", "--allow-empty");
  assert.equal(undo(), "amend “two, amended”");
  assert.equal(head(), "side", "the merge's fast-forward commit again");
  assert.equal(undo(), "merge of side (fast-forward)");
  assert.equal(head(), "two");
  assert.equal(git("status", "--porcelain"), "", "--keep: the merged file went with the move");
  assert.equal(undo(), "switch from side to main");
  assert.equal(git("branch", "--show-current").trim(), "side");
  assert.equal(undo(), "commit “side”");
  assert.equal(git("status", "--porcelain").trim(), "A  s", "--soft: the commit's changes, staged");
  // A move --keep refuses when it would overwrite an uncommitted change.
  git("commit", "-qm", "side again"); writeFileSync(join(dir, "f"), "3\n"); git("commit", "-qam", "three");
  git("reset", "-q", "--hard", "HEAD~1");
  writeFileSync(join(dir, "f"), "dirty\n");
  const a = lastAction(parseReflog(git("log", "-g", "-n", "200", REFLOG_FORMAT, "HEAD")));
  assert.equal(actionWords(a), "reset to HEAD~1");
  const r = spawnSync("sh", markedArgs(undoArgs(a)), { cwd: dir, encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not uptodate|would be overwritten/);
});
