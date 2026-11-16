// pullsync.js: pull modes, ahead/behind, Sync and Publish, a force push with a lease against
// local bare remotes (someone else's pushes, a background fetch), tags and fetches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
import { withRemote, cloneOf, SHELLS, runner } from "./gitenv.mjs";

const S = await mod("pullsync.js");
const { runPlan, parseVersion } = await mod("gitplan.js");
const V = (s) => parseVersion(`git version ${s}`);

test("pull's arguments per mode, autostash where git has it", () => {
  assert.deepEqual(S.pullArgs("ff-only", { version: V("2.40.0") }), ["-c", "core.editor=true", "pull", "--no-rebase", "--ff-only", "--autostash"]);
  assert.deepEqual(S.pullArgs("rebase", { version: V("2.20.0") }), ["-c", "core.editor=true", "pull", "--rebase", "--autostash"]);
  assert.deepEqual(S.pullArgs("merge", { version: V("2.26.0") }), ["-c", "core.editor=true", "pull", "--no-rebase", "--no-edit"], "merge --autostash is git 2.27");
  assert.deepEqual(S.pullArgs("merge", { autostash: false, remote: "up", branch: "feature/x" }), ["-c", "core.editor=true", "pull", "--no-rebase", "--no-edit", "up", "refs/heads/feature/x"]);
  assert.throws(() => S.pullArgs("squash"), /no pull mode/);
  assert.deepEqual(S.pullStep("ff-only").stops, false);
  assert.deepEqual([S.pullStep("rebase").net, S.pullStep("rebase").stops], [true, true]);
});

test("ahead and behind: parsed, in words, and which pull modes can work", () => {
  assert.deepEqual(S.parseAheadBehind("2\t3\n"), { ahead: 2, behind: 3 });
  assert.equal(S.parseAheadBehind(""), null);
  assert.deepEqual(S.aheadBehindArgs(), ["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
  assert.equal(S.divergence({ upstream: "origin/main" }).words, "Up to date with origin/main");
  assert.equal(S.divergence({ ahead: 1, upstream: "origin/main" }).words, "1 commit to push to origin/main");
  assert.equal(S.divergence({ behind: 4, upstream: "origin/main" }).words, "4 commits to pull from origin/main");
  const d = S.divergence({ ahead: 2, behind: 3, upstream: "origin/main" });
  assert.deepEqual([d.state, d.pull, d.push, d.modes], ["diverged", true, true, ["rebase", "merge"]]);
  assert.equal(S.divergence({ ahead: 5 }).state, "none");
  assert.deepEqual(S.pullItems(d).map((i) => [i.id, Boolean(i.disabled)]), [["ff-only", true], ["rebase", false], ["merge", false]]);
  assert.match(S.pullItems(d)[0].detail, /diverged/);
});

test("Sync with real remotes: diverged, rebase then push; ff-only refused when diverged; Publish a new branch", async () => {
  const me = withRemote("git-enhanced-sync-");
  const other = cloneOf(me.origin, "git-enhanced-sync-other-");
  other.commit("theirs", { "theirs.txt": "t\n" }); other.git("push", "-q", "origin", "main");
  me.commit("mine", { "mine.txt": "m\n" });
  // A merge of the branch's own: Sync's rebase keeps it.
  me.git("switch", "-q", "-c", "topic"); me.commit("topic", { "topic.txt": "t\n" }); me.git("switch", "-q", "main");
  me.git("merge", "-q", "--no-ff", "--no-edit", "topic");
  me.git("fetch", "-q");
  const counts = S.parseAheadBehind((await me.h.git(S.aheadBehindArgs())).stdout);
  assert.deepEqual(counts, { ahead: 3, behind: 1 });
  const base = { branch: "main", upstream: "origin/main", upstreamRemote: "origin", remote: "origin", ...counts, version: parseVersion(me.git("version")) };
  assert.match(S.syncPlan({ ...base, mode: "ff-only" }).problem, /diverged/);
  me.write("dirty.txt", "uncommitted\n"); me.write("f.txt", "1 changed\n");
  const p = S.syncPlan({ ...base, mode: "rebase" });
  assert.equal(p.confirm, "Sync main with origin/main? It pulls (rebase), 1 commit known to come in, then pushes 3 commits. Your 3 unpushed commits are made again on top of origin/main, with new hashes; merge commits among them are kept.");
  assert.ok(p.steps[0].args.includes("--rebase=merges"));
  const old = S.syncPlan({ ...base, mode: "rebase", version: parseVersion("git version 2.17.1") });
  assert.match(old.confirm, /merge commits among them are flattened \(keeping them needs git 2\.18\)\.$/);
  assert.ok(old.steps[0].args.includes("--rebase") && !old.steps[0].args.includes("--rebase=merges"));
  assert.ok(S.pullArgs("rebase", { version: base.version }).includes("--rebase"), "Pull ▾ keeps plain --rebase");
  const res = await runPlan(me.h, p);
  assert.equal(res.stopped, null);
  assert.deepEqual(me.git("log", "--first-parent", "--format=%s", "origin/main").trim().split("\n"), ["Merge branch 'topic'", "mine", "theirs", "one"], "rebased onto theirs, the merge kept, and pushed");
  assert.equal(me.read("f.txt"), "1 changed\n", "the autostash put the changes back");
  // Publish: a new branch has no upstream.
  me.git("switch", "-q", "-c", "feature/x");
  const pub = S.syncPlan({ branch: "feature/x", remote: "origin" });
  assert.deepEqual(pub.steps[0].args, ["push", "-u", "--", "origin", "refs/heads/feature/x:refs/heads/feature/x"]);
  await runPlan(me.h, pub);
  assert.equal(me.git("rev-parse", "--abbrev-ref", "@{u}").trim(), "origin/feature/x");
  assert.equal(S.syncPlan({ branch: null }).problem, "No branch is checked out: switch to one first");
  assert.equal(S.syncPlan({ branch: "x" }).problem, "No remote to publish to: add one first");
  assert.match(S.syncPlan({ branch: "x", upstream: "main", upstreamRemote: "." }).problem, /local branch/);
  assert.match(S.syncPlan({ branch: "x", upstream: "fork/x", upstreamRemote: "origin" }).problem, /fork\/x isn't on origin/);
});

test("Sync with a merge that stops on conflicts: the push doesn't run", async () => {
  const me = withRemote("git-enhanced-sync-merge-");
  const other = cloneOf(me.origin, "git-enhanced-sync-merge-other-");
  other.commit("theirs", { "f.txt": "theirs\n" }); other.git("push", "-q", "origin", "main");
  me.commit("mine", { "f.txt": "mine\n" });
  const remoteTip = other.git("rev-parse", "HEAD").trim();
  const res = await runPlan(me.h, S.syncPlan({ branch: "main", upstream: "origin/main", upstreamRemote: "origin", remote: "origin", mode: "merge" }));
  assert.equal(res.done, 0);
  assert.match(res.stopped, /CONFLICT/);
  assert.equal(me.origin.git("rev-parse", "main").trim(), remoteTip, "nothing was pushed");
});

test("force push with a lease: an amend goes through; a background fetch's commits and someone's newer push are refused", async () => {
  const me = withRemote("git-enhanced-lease-");
  const version = parseVersion(me.git("version"));
  me.commit("two", { "f.txt": "2\n" }); me.git("push", "-q");
  me.git("commit", "-q", "--amend", "-m", "two, amended");
  const expected = (await me.h.git(S.expectedArgs("origin", "main"))).stdout.trim();
  const lost = Number((await me.h.git(S.lostArgs("main", "origin", "main"))).stdout.trim());
  assert.equal(lost, 1);
  const p = S.forcePushPlan({ branch: "main", remote: "origin", expected, lost, version });
  assert.equal(p.danger, true);
  assert.match(p.confirm, /^Force push main to origin\/main\? It replaces origin\/main \([0-9a-f]{7}\): 1 commit there that it doesn't have is lost for everyone\./);
  assert.deepEqual(p.steps[1].args, ["push", `--force-with-lease=refs/heads/main:${expected}`, "--force-if-includes", "--", "origin", "refs/heads/main:refs/heads/main"]);
  await runPlan(me.h, p);
  assert.equal(me.origin.git("log", "-1", "--format=%s", "main").trim(), "two, amended");
  // Someone pushes; a fetch in the background brings it, unseen. The lease alone would let the
  // push through (expected is what the fetch brought); the check refuses.
  const other = cloneOf(me.origin, "git-enhanced-lease-other-");
  other.commit("theirs", { "t.txt": "t\n" }); other.git("push", "-q", "origin", "main");
  me.git("fetch", "-q");
  me.git("commit", "-q", "--amend", "-m", "two, again");
  const seen = (await me.h.git(S.expectedArgs("origin", "main"))).stdout.trim();
  for (const shell of SHELLS) {
    await assert.rejects(runPlan(runner(me.dir, shell), S.forcePushPlan({ branch: "main", remote: "origin", expected: seen, version })), /fetched but never in main/, shell);
  }
  assert.equal(me.origin.git("log", "-1", "--format=%s", "main").trim(), "theirs", "their commit is still there");
  // Once it has been in the branch (here: rebased onto it), the push may replace it.
  me.git("rebase", "-q", "origin/main");
  me.git("reset", "-q", "--hard", "HEAD~1");
  me.commit("mine again", { "m.txt": "m\n" });
  await runPlan(me.h, S.forcePushPlan({ branch: "main", remote: "origin", expected: seen, version }));
  assert.equal(me.origin.git("log", "-1", "--format=%s", "main").trim(), "mine again");
  // Someone pushes after the person looked: the lease refuses.
  const stale = me.git("rev-parse", "origin/main").trim();
  other.git("fetch", "-q"); other.git("reset", "-q", "--hard", "origin/main"); other.commit("newer", { "n.txt": "n\n" }); other.git("push", "-q", "origin", "main");
  me.git("commit", "-q", "--amend", "-m", "mine, amended");
  await assert.rejects(runPlan(me.h, S.forcePushPlan({ branch: "main", remote: "origin", expected: stale, version })), /^Error: ! \[rejected\] main -> main \(stale info\)\nerror: failed to push/);
  assert.equal(me.origin.git("log", "-1", "--format=%s", "main").trim(), "newer");
  assert.match(S.forcePushPlan({ branch: "main", remote: "origin" }).problem, /fetch first/);
  assert.deepEqual(S.forcePushPlan({ branch: "a", remote: "o", expected: "1".repeat(40), version: V("2.29.0") }).steps[1].args.includes("--force-if-includes"), false);
  assert.equal(S.forcePushPlan({ branch: "a", remote: "o", expected: "1".repeat(40), lost: 0 }).danger, false, "nothing to lose");
});

test("a remote whose name reads like an option: '--' before it in pushes and fetches; git pull can't name it", async () => {
  assert.deepEqual(S.pushArgs("feature/x", "-r", "x", { track: true, followTags: true }), ["push", "-u", "--follow-tags", "--", "-r", "refs/heads/feature/x:refs/heads/x"]);
  assert.deepEqual(S.pushArgs("main", "origin"), ["push", "--", "origin", "refs/heads/main:refs/heads/main"]);
  assert.throws(() => S.pullArgs("rebase", { remote: "-r" }), /can't name remote -r/);
  const me = withRemote("git-enhanced-sync-dash-");
  const dash = cloneOf(me.origin, "git-enhanced-sync-dash-r-");
  me.git("remote", "add", "--", "-r", me.origin.dir);
  me.git("switch", "-q", "-c", "topic");
  await runPlan(me.h, S.syncPlan({ branch: "topic", remote: "-r" }));
  assert.equal(me.git("rev-parse", "--abbrev-ref", "@{u}").trim(), "-r/topic");
  me.git("tag", "t1");
  await runPlan(me.h, S.pushTagsPlan("-r"));
  await runPlan(me.h, S.fetchPlan({ remote: "-r" }));
  me.git("commit", "-q", "--amend", "-m", "one, amended");
  const expected = me.git("rev-parse", "refs/remotes/-r/topic").trim();
  await runPlan(me.h, S.forcePushPlan({ branch: "topic", remote: "-r", expected, version: parseVersion(me.git("version")) }));
  dash.git("fetch", "-q");
  assert.equal(dash.git("log", "-1", "--format=%s", "origin/topic").trim(), "one, amended");
  assert.equal(dash.git("ls-remote", "--tags", "origin", "t1").trim().endsWith("refs/tags/t1"), true);
});

test("why the plan checks itself: git ignores --force-if-includes when the lease names its hash", async () => {
  const me = withRemote("git-enhanced-lease-why-");
  const other = cloneOf(me.origin, "git-enhanced-lease-why-other-");
  other.commit("theirs", { "t.txt": "t\n" }); other.git("push", "-q", "origin", "main");
  me.git("fetch", "-q"); // in the background: nobody looked at "theirs"
  me.git("commit", "-q", "--amend", "-m", "one, amended");
  const seen = me.git("rev-parse", "refs/remotes/origin/main").trim();
  const plain = me.tryGit("push", "--force-with-lease=refs/heads/main:" + seen, "--force-if-includes", "origin", "refs/heads/main:refs/heads/main");
  assert.equal(plain.status, 0, "git lets it through");
  assert.equal(me.origin.git("log", "-1", "--format=%s", "main").trim(), "one, amended", "and their commit is gone from the remote");
  assert.equal(me.tryGit("merge-base", "--is-ancestor", other.git("rev-parse", "HEAD").trim(), "refs/remotes/origin/main").status, 1);
});

test("tags and fetches: push every tag, fetch every remote with pruning, prune tags of one remote (danger)", async () => {
  const me = withRemote("git-enhanced-fetch-");
  me.git("tag", "v1"); me.git("tag", "-a", "v2", "-m", "two");
  await runPlan(me.h, S.pushTagsPlan("origin"));
  assert.deepEqual(me.origin.git("tag").trim().split("\n"), ["v1", "v2"]);
  // A second remote, a branch deleted on origin, a tag only here.
  const up = cloneOf(me.origin, "git-enhanced-fetch-up-");
  me.git("remote", "add", "up", up.dir);
  me.git("push", "-q", "origin", "HEAD:refs/heads/gone");
  me.git("fetch", "-q", "origin");
  me.origin.git("branch", "-D", "gone");
  me.git("tag", "local-only");
  const version = parseVersion(me.git("version"));
  const all = S.fetchPlan({ all: true, version });
  assert.deepEqual(all.steps[0].args, ["fetch", "--all", "--prune"]);
  await runPlan(me.h, all);
  assert.equal(me.tryGit("rev-parse", "-q", "--verify", "refs/remotes/origin/gone").status, 1, "pruned");
  assert.equal(me.tryGit("rev-parse", "-q", "--verify", "refs/remotes/up/main").status, 0, "the other remote fetched");
  assert.match(S.fetchPlan({ all: true, pruneTags: true, version }).problem, /one remote/);
  const tags = S.fetchPlan({ remote: "origin", pruneTags: true, version });
  assert.equal(tags.danger, true);
  assert.match(tags.confirm, /Tags made here and never pushed to origin are deleted too/);
  await runPlan(me.h, tags);
  assert.deepEqual(me.git("tag").trim().split("\n"), ["v1", "v2"], "local-only is gone");
  assert.match(S.fetchPlan({ remote: "origin", pruneTags: true, version: V("2.16.0") }).problem, /2\.17/);
  assert.equal(S.fetchPlan({}).problem, "No remote to fetch from");
  assert.deepEqual(S.fetchPlan({ remote: "up", prune: false, tags: true }).steps[0].args, ["fetch", "--tags", "--", "up"]);
});
