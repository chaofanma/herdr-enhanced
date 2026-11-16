// remoteops.js: `git remote -v` read from literal outputs and real repositories; add, rename,
// set-url, push URLs, the default remote for pushes, remove (danger), against local bare remotes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
import { repo, withRemote } from "./gitenv.mjs";

const R = await mod("remoteops.js");
const { runPlan } = await mod("gitplan.js");

test("parseRemotes: names and URLs, push URLs, URLs with spaces, nothing", () => {
  const out = [
    "origin\tgit@github.com:me/app.git (fetch)", "origin\tgit@github.com:me/app.git (push)",
    "my/mirror\t/Users/me/my repos/app.git (fetch)", "my/mirror\thttps://example.com/a.git (push)", "my/mirror\thttps://example.com/b.git (push)",
    "nourl\t (fetch)", "garbage line", "",
  ].join("\n");
  assert.deepEqual(R.parseRemotes(out), [
    { name: "origin", fetch: "git@github.com:me/app.git", push: ["git@github.com:me/app.git"] },
    { name: "my/mirror", fetch: "/Users/me/my repos/app.git", push: ["https://example.com/a.git", "https://example.com/b.git"] },
    { name: "nourl", fetch: "", push: [] },
  ]);
  assert.deepEqual(R.parseRemotes(""), []);
  assert.equal(R.parsePushDefault("up\n"), "up");
  assert.equal(R.parsePushDefault(""), null);
});

test("names: what is checked before git, and git's own rule", async () => {
  assert.equal(R.nameProblem(""), "A remote needs a name");
  assert.equal(R.nameProblem("origin", [{ name: "origin" }]), "There is a remote called origin already");
  assert.equal(R.nameProblem("a b"), "A remote's name can't hold spaces");
  assert.equal(R.nameProblem("team/fork"), null);
  const r = repo("git-enhanced-remotes-names-");
  assert.equal((await r.h.git(R.validNameArgs("team/fork"))).code, 0);
  assert.notEqual((await r.h.git(R.validNameArgs("bad..name"))).code, 0);
  assert.notEqual((await r.h.git(R.validNameArgs("x:y"))).code, 0);
  assert.equal(R.addPlan({ name: "x", url: " " }).problem, "A remote needs a URL");
});

test("add (and fetch), rename with its tracking branches and the default for pushes, set-url, push URLs", async () => {
  const me = withRemote("git-enhanced-remotes-");
  const fork = repo("git-enhanced-remotes-fork-", { bare: true });
  me.git("push", "-q", fork.dir, "main:main");
  const list = async () => R.parseRemotes((await me.h.git(R.REMOTES_ARGS)).stdout);
  await runPlan(me.h, R.addPlan({ name: "-fork", url: fork.dir, remotes: await list() }));
  assert.deepEqual((await list()).map((r) => r.name), ["-fork", "origin"], "a name like an option is a name (git remote add -- …)");
  assert.equal(me.tryGit("rev-parse", "-q", "--verify", "refs/remotes/-fork/main").status, 0, "fetched right away");
  me.git("branch", "--set-upstream-to=-fork/main", "main");
  await runPlan(me.h, R.pushDefaultPlan("-fork"));
  assert.equal(R.parsePushDefault((await me.h.git(R.PUSH_DEFAULT_ARGS)).stdout), "-fork");
  await runPlan(me.h, R.renamePlan("-fork", "fork", { remotes: await list(), pushDefault: "-fork" }));
  assert.deepEqual((await list()).map((r) => r.name), ["fork", "origin"]);
  assert.equal(me.git("rev-parse", "--abbrev-ref", "main@{u}").trim(), "fork/main", "the tracking branch followed");
  assert.equal(R.parsePushDefault((await me.h.git(R.PUSH_DEFAULT_ARGS)).stdout), "fork");
  assert.equal(R.renamePlan("fork", "origin", { remotes: await list() }).problem, "There is a remote called origin already");
  // A push URL of its own, then back to the fetch URL; a new fetch URL with a space in its path.
  await runPlan(me.h, R.setUrlPlan("fork", "/tmp/push target.git", { push: true }));
  let fork2 = (await list()).find((r) => r.name === "fork");
  assert.deepEqual([fork2.fetch, fork2.push], [fork.dir, ["/tmp/push target.git"]]);
  assert.deepEqual(R.remoteItems(fork2, { pushDefault: "fork" }).map((i) => i.id), ["fetch", "copy-url", "set-url", "set-push-url", "clear-push-url", "push-default-off", "set-head", "rename", "remove"]);
  await runPlan(me.h, R.clearPushUrlPlan("fork"));
  await runPlan(me.h, R.clearPushUrlPlan("fork"), {});
  fork2 = (await list()).find((r) => r.name === "fork");
  assert.deepEqual(fork2.push, [fork.dir], "pushes go to the fetch URL again (and a second clear is fine)");
  await runPlan(me.h, R.setUrlPlan("fork", "/tmp/a dir/b.git"));
  assert.equal((await list()).find((r) => r.name === "fork").fetch, "/tmp/a dir/b.git");
  await runPlan(me.h, R.pushDefaultPlan(null));
  await runPlan(me.h, R.pushDefaultPlan(null));
  assert.equal(me.tryGit(...R.PUSH_DEFAULT_ARGS).status, 1, "unset (twice is fine)");
  assert.deepEqual(R.remoteItems((await list())[1]).map((i) => i.id).slice(3, 5), ["set-push-url", "push-default"]);
});

test("remove: a danger plan that names what goes; the remote branches and upstreams go, the remote stays", async () => {
  const me = withRemote("git-enhanced-remotes-remove-");
  me.git("switch", "-q", "-c", "two"); me.git("push", "-q", "-u", "origin", "two");
  const p = R.removePlan("origin", { tracking: ["main", "two"] });
  assert.equal(p.danger, true);
  assert.match(p.confirm, /^Remove remote origin\? Its remote branches \(origin\/…\) go from this repository\. main, two lose their upstream\./);
  await runPlan(me.h, p);
  assert.equal(me.git("for-each-ref", "refs/remotes").trim(), "");
  assert.notEqual(me.tryGit("rev-parse", "--abbrev-ref", "main@{u}").status, 0, "main has no upstream now");
  assert.equal(me.origin.git("rev-parse", "main").trim().length, 40, "the remote repository is untouched");
  assert.match(R.removePlan("x", { tracking: ["a"] }).confirm, /a loses its upstream/);
  assert.deepEqual(R.setHeadPlan("origin").steps[0], { args: ["remote", "set-head", "--auto", "--", "origin"], why: "Ask origin for its default branch", net: true });
  const back = withRemote("git-enhanced-remotes-head-");
  back.git("remote", "rename", "--", "origin", "-o");
  back.git("update-ref", "-d", "refs/remotes/-o/HEAD");
  await runPlan(back.h, R.setHeadPlan("-o"));
  assert.equal(back.git("symbolic-ref", "refs/remotes/-o/HEAD").trim(), "refs/remotes/-o/main");
});
