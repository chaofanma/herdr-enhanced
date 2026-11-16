// refs.js: what each label's menu has, and git's arguments for its actions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";

const R = await mod("refs.js");
const { stagedCount } = await mod("gitlog.js");

test("a label's menu: a branch (checked out or not, nothing checked out, busy), a remote branch, a tag", () => {
  const ids = (items) => items.map((i) => i.id);
  const other = R.refItems({ kind: "branch", name: "side" }, { b: { name: "side", current: false, upstream: null }, current: "main", remote: "origin" });
  assert.deepEqual(ids(other), ["checkout", "merge", "rebase", "push", "upstream", "rename", "delete"]);
  assert.equal(other.find((i) => i.id === "merge").label, "Merge into main…");
  assert.equal(other.find((i) => i.id === "rebase").label, "Rebase main onto it…");
  assert.equal(other.find((i) => i.id === "push").label, "Publish to origin");
  const here = R.refItems({ kind: "branch", name: "main", current: true }, { b: { name: "main", current: true, upstream: "origin/main" }, current: "main", remote: "origin" });
  assert.deepEqual(ids(here), ["push", "upstream", "rename"], "the checked-out branch: no checkout, merge, rebase or delete");
  assert.equal(here[0].label, "Push to origin/main"); assert.equal(here[1].label, "Change upstream…");
  const detached = R.refItems({ kind: "branch", name: "side" }, { b: { name: "side", current: false }, current: null, remote: null });
  assert.equal(detached.find((i) => i.id === "merge").disabled, true);
  assert.match(detached.find((i) => i.id === "merge").detail, /No branch is checked out/);
  assert.equal(detached.find((i) => i.id === "push").disabled, true, "no remote");
  const busy = R.refItems({ kind: "branch", name: "side" }, { b: { name: "side" }, current: "main", operation: "rebase", remote: "origin" });
  assert.ok(["checkout", "merge", "rebase"].every((id) => busy.find((i) => i.id === id).disabled));
  const remote = R.refItems({ kind: "remote", name: "origin/feature/x" }, { tracker: null });
  assert.deepEqual(ids(remote), ["track", "fetch", "delete-remote"]);
  assert.equal(remote[0].label, "Check out (tracking)"); assert.match(remote[0].detail, /a new local feature\/x/);
  assert.equal(remote[1].label, "Fetch origin"); assert.equal(remote[2].label, "Delete it on origin…");
  assert.equal(R.refItems({ kind: "remote", name: "origin/x" }, { tracker: "x" })[0].label, "Check out x");
  assert.deepEqual(R.splitRemote({ name: "my/remote/x", remote: "my/remote" }), ["my/remote", "x"]);
  const tag = R.refItems({ kind: "tag", name: "v1" }, { remote: "origin" });
  assert.deepEqual(ids(tag), ["push-tag", "delete-tag"]); assert.equal(tag[0].label, "Push to origin");
  assert.equal(R.refItems({ kind: "tag", name: "v1" }, { remote: null })[0].disabled, true);
});

test("git's arguments: pushes by full ref names, upstream, deletes on the remote, fetch, tags", () => {
  assert.deepEqual(R.pushArgs({ name: "side", upstream: null }, { remote: "origin" }), ["push", "-u", "origin", "refs/heads/side:refs/heads/side"]);
  assert.deepEqual(R.pushArgs({ name: "side", upstream: "up/other" }, { remote: "origin", upstreamRemote: "up" }), ["push", "up", "refs/heads/side:refs/heads/other"]);
  assert.deepEqual(R.upstreamArgs("side", "origin/main"), ["branch", "--set-upstream-to=refs/remotes/origin/main", "side"]);
  assert.deepEqual(R.deleteRemoteArgs("origin", "feature/x"), ["push", "origin", "--delete", "refs/heads/feature/x"]);
  assert.deepEqual(R.fetchArgs("origin"), ["fetch", "--prune", "origin"]);
  assert.deepEqual(R.pushTagArgs("origin", "v1"), ["push", "origin", "refs/tags/v1"]);
  assert.deepEqual(R.deleteTagArgs("v1"), ["tag", "-d", "v1"]);
  assert.deepEqual(R.deleteRemoteTagArgs("origin", "v1"), ["push", "origin", "--delete", "refs/tags/v1"]);
  assert.equal(R.defaultRemote(["up", "origin"], "up"), "up");
  assert.equal(R.defaultRemote(["up", "origin"], null), "origin");
  assert.equal(R.defaultRemote(["up"], "gone"), "up");
  assert.equal(R.defaultRemote([], null), null);
});

test("the questions: a remote branch's delete asks twice; a tag's may go on the remote too; an upstream from the remote branches", () => {
  assert.match(R.deleteRemoteQuestion("origin", "x", 1).title, /^Delete x on origin\?$/);
  assert.equal(R.deleteRemoteQuestion("origin", "x", 1).confirm, "Continue…");
  assert.match(R.deleteRemoteQuestion("origin", "x", 2).title, /^Really delete origin\/x\?$/);
  assert.deepEqual(R.deleteTagQuestion("v1", "origin").checks, [{ id: "remote", label: "Also delete it on origin", value: false }]);
  assert.equal(R.deleteTagQuestion("v1", null).checks, undefined);
  const q = R.upstreamQuestion({ name: "side", upstream: "origin/b" }, ["origin/a", "origin/b"]);
  assert.equal(q.choices.value, "origin/b"); assert.deepEqual(q.choices.options.map((o) => o.id), ["origin/a", "origin/b"]);
});

test("the staged files of a status: the index column", () => {
  assert.equal(stagedCount("M  a\0 M b\0?? c\0A  d\0MM e\0"), 3);
  assert.equal(stagedCount(""), 0);
});
