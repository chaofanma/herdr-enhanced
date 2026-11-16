// reflog.js: entries read from literal and real reflogs (HEAD's and a branch's), and their
// restore plans: a branch there, reset --keep (refused when it would overwrite a change), detached.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
import { repo } from "./gitenv.mjs";

const R = await mod("reflog.js");
const { runPlan, parseVersion } = await mod("gitplan.js");
const S1 = "1".repeat(40), S2 = "2".repeat(40);

test("parseReflog on literal output: selectors by number, times, actions, messages without a colon, nothing", () => {
  const out = [S1, "HEAD@{1794249802 +0800}", "commit (amend): fix: the thing", "fix: the thing", S2, "HEAD@{1794249700 -0130}", "update by push", "", ""].join("\0");
  assert.deepEqual(R.parseReflog(out), [
    { sha: S1, selector: "HEAD@{0}", index: 0, time: 1794249802, action: "commit (amend)", kind: "commit", message: "fix: the thing", subject: "fix: the thing" },
    { sha: S2, selector: "HEAD@{1}", index: 1, time: 1794249700, action: "update by push", kind: "update", message: "", subject: "" },
  ]);
  assert.equal(R.parseReflog(out, "refs/heads/main")[1].selector, "refs/heads/main@{1}");
  assert.deepEqual(R.parseReflog(""), []);
  assert.deepEqual(R.reflogArgs("refs/heads/x", 5), ["-c", "log.showSignature=false", "log", "-g", "-z", "--date=raw", "--max-count=5", "--format=%H%x00%gD%x00%gs%x00%s", "refs/heads/x", "--"]);
});

test("a real reflog: HEAD's and a branch's, in order, with times; restore as a branch, by reset --keep, detached", async () => {
  const r = repo("git-enhanced-reflog-");
  const one = r.commit("one", { "f.txt": "1\n" });
  const two = r.commit("two", { "f.txt": "2\n" });
  r.git("switch", "-q", "-c", "side"); r.git("switch", "-q", "main");
  r.git("commit", "-q", "--amend", "-m", "two, amended");
  const amended = r.git("rev-parse", "HEAD").trim();
  r.git("reset", "-q", "--hard", one);
  const head = R.parseReflog((await r.h.git(R.reflogArgs())).stdout);
  assert.deepEqual(head.map((e) => [e.kind, e.action, e.sha]), [
    ["reset", "reset", one], ["commit", "commit (amend)", amended], ["checkout", "checkout", two], ["checkout", "checkout", two], ["commit", "commit", two], ["commit", "commit (initial)", one],
  ]);
  assert.match(head[0].message, /^moving to /);
  assert.equal(head[2].message, "moving from side to main");
  assert.ok(head.every((e) => e.time > 1_600_000_000), "times");
  assert.equal(r.git("rev-parse", head[1].selector).trim(), amended, "the selector names the entry");
  const branch = R.parseReflog((await r.h.git(R.reflogArgs("refs/heads/main", 2))).stdout, "refs/heads/main");
  assert.deepEqual(branch.map((e) => [e.sha, e.selector]), [[one, "refs/heads/main@{0}"], [amended, "refs/heads/main@{1}"]]);
  // Back to the amended commit: as a branch, then by moving main there (an untracked file stays),
  // then detached.
  await runPlan(r.h, R.branchPlan(head[1], "rescued"));
  assert.equal(r.git("rev-parse", "rescued").trim(), amended);
  r.write("other.txt", "untracked stays\n");
  r.write("f.txt", "1\n"); // the same content, a newer time: the index's times go stale
  const reset = R.resetPlan(head[1], { branch: "main" });
  assert.equal(reset.danger, true);
  assert.match(reset.confirm, /^Move main to [0-9a-f]{7} “two, amended”\? Commits on main after it leave the branch/);
  await runPlan(r.h, reset);
  assert.equal(r.git("rev-parse", "HEAD").trim(), amended);
  assert.equal(r.read("other.txt"), "untracked stays\n");
  r.write("f.txt", "an uncommitted change\n");
  await assert.rejects(runPlan(r.h, R.resetPlan(head[0], { branch: "main" })), /not uptodate|overwritten|would be overwritten|Entry/i, "reset --keep refuses to overwrite it");
  assert.equal(r.read("f.txt"), "an uncommitted change\n");
  r.git("checkout", "-q", "--", "f.txt");
  await runPlan(r.h, R.detachPlan(head[0], { version: parseVersion(r.git("version")) }));
  assert.equal(r.tryGit("symbolic-ref", "-q", "HEAD").status, 1, "detached");
  assert.equal(r.git("rev-parse", "HEAD").trim(), one);
  assert.deepEqual(R.detachPlan(head[0], { version: parseVersion("git version 2.22.0") }).steps[0].args, ["checkout", "--detach", one]);
  assert.equal(R.resetPlan(head[0]).problem, "No branch is checked out: check the entry out, or make a branch there");
  assert.equal(R.branchPlan(head[0], " ").problem, "The new branch needs a name");
  assert.deepEqual(R.entryItems(head[0], { branch: "main", head: one }).map((i) => [i.id, Boolean(i.disabled)]), [["branch", false], ["reset", true], ["detach", true], ["copy", false]]);
  assert.match(R.entryItems(head[1], { branch: null }).find((i) => i.id === "reset").detail, /No branch/);
});
