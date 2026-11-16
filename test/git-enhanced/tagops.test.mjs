// tagops.js: tag names, annotated and lightweight tags made, moved (danger), pushed one at a time
// and all together, deleted here and on a local bare remote (danger), and their details read
// from literal and real for-each-ref output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
import { withRemote } from "./gitenv.mjs";

const T = await mod("tagops.js");
const { runPlan } = await mod("gitplan.js");

test("names and arguments", async () => {
  assert.equal(T.nameProblem(" "), "A tag needs a name");
  assert.equal(T.nameProblem("-x"), "A tag's name can't start with -");
  assert.equal(T.nameProblem("v 1"), "A tag's name can't hold spaces");
  assert.equal(T.nameProblem("v1", ["v1"]), "There is a tag called v1 already");
  assert.equal(T.nameProblem("release/v1.2"), null);
  assert.deepEqual(T.tagArgs("v1", { message: "One\n\n# kept\n" }), ["-c", "tag.gpgSign=false", "tag", "-a", "--cleanup=whitespace", "-m", "One\n\n# kept", "v1", "HEAD"]);
  assert.deepEqual(T.tagArgs("v1", { rev: "abc", force: true }), ["-c", "tag.gpgSign=false", "tag", "-f", "v1", "abc"]);
  assert.deepEqual(T.pushTagArgs("-r", "v1"), ["push", "--", "-r", "refs/tags/v1"]);
  assert.equal(T.deletePlan("v1", { here: false }).problem, "Delete it where?");
  assert.equal(T.tagPlan("v1", {}, { tags: ["v1"] }).problem, "There is a tag called v1 already");
  const me = withRemote("git-enhanced-tags-names-");
  assert.equal((await me.h.git(T.validTagArgs("release/v1.2"))).code, 0);
  assert.notEqual((await me.h.git(T.validTagArgs("bad..name"))).code, 0);
});

test("parseTags on literal output: annotated (a message with blank lines and #), signed, lightweight, nothing", () => {
  const A = "a".repeat(40), C = "c".repeat(40), S = "5".repeat(40);
  const rec = (...f) => f.join("\0") + "\0\n";
  const out = rec("refs/tags/v1", "tag", A, C, "Ann", "<ann@x>", "1794254633 +0800", "Release one\n\n# not a comment\nbody\n")
    + rec("refs/tags/signed", "tag", S, C, "Bo", "<bo@x>", "1794254000 -0130", "Signed\n-----BEGIN PGP SIGNATURE-----\nabc\n-----END PGP SIGNATURE-----\n")
    + rec("refs/tags/light/x", "commit", C, "", "", "", "", "the commit's own message\n");
  assert.deepEqual(T.parseTags(out), [
    { name: "v1", annotated: true, object: A, commit: C, tagger: "Ann", email: "ann@x", time: 1794254633, zone: "+0800", subject: "Release one", message: "Release one\n\n# not a comment\nbody", signed: false },
    { name: "signed", annotated: true, object: S, commit: C, tagger: "Bo", email: "bo@x", time: 1794254000, zone: "-0130", subject: "Signed", message: "Signed", signed: true },
    { name: "light/x", annotated: false, object: C, commit: C, tagger: null, email: null, time: 0, zone: "", subject: null, message: null, signed: false },
  ]);
  assert.deepEqual(T.parseTags(""), []);
});

test("real tags: annotated with its message kept, lightweight, moved, pushed, deleted here and there", async () => {
  const me = withRemote("git-enhanced-tags-");
  // tag.gpgSign in the person's config must not make git ask for a passphrase.
  me.git("config", "tag.gpgSign", "true"); me.git("config", "gpg.program", "false");
  const first = me.git("rev-parse", "HEAD").trim();
  await runPlan(me.h, T.tagPlan("v1", { message: "Release one\n\n# not a comment\nbody" }));
  await runPlan(me.h, T.tagPlan("light", {}));
  const second = me.commit("two", { "two.txt": "2\n" });
  let tags = T.parseTags((await me.h.git(T.tagsArgs())).stdout);
  const v1 = tags.find((t) => t.name === "v1");
  assert.deepEqual([v1.annotated, v1.commit, v1.tagger, v1.email, v1.message, v1.signed], [true, first, "Test", "test@example.com", "Release one\n\n# not a comment\nbody", false]);
  assert.ok(v1.time > 1_600_000_000);
  assert.deepEqual(T.parseTags((await me.h.git(T.detailsArgs("light"))).stdout).map((t) => [t.name, t.annotated, t.commit]), [["light", false, first]]);
  // Move v1 to the second commit: a danger plan.
  const move = T.tagPlan("v1", { rev: second, message: "Release one, again", force: true }, { tags: ["v1", "light"], was: first });
  assert.equal(move.danger, true);
  assert.match(move.confirm, /^Move tag v1 from [0-9a-f]{7} to [0-9a-f]{7}\?/);
  await runPlan(me.h, move);
  tags = T.parseTags((await me.h.git(T.detailsArgs("v1"))).stdout);
  assert.deepEqual([tags[0].commit, tags[0].message], [second, "Release one, again"]);
  // Push one, then all; delete one here and on origin.
  await runPlan(me.h, T.pushTagPlan("origin", "v1"));
  assert.equal(me.origin.git("tag").trim(), "v1");
  await runPlan(me.h, T.pushAllPlan("origin"));
  assert.deepEqual(me.origin.git("tag").trim().split("\n"), ["light", "v1"]);
  const del = T.deletePlan("v1", { remote: "origin", sha: second });
  assert.equal(del.danger, true);
  assert.match(del.confirm, /^Delete tag v1 here and on origin\? Clones that fetched it keep it\. It can be made again on [0-9a-f]{7}\.$/);
  assert.deepEqual(del.steps.map((s) => s.args[0]), ["push", "tag"], "the remote first");
  await runPlan(me.h, del);
  assert.equal(me.origin.git("tag").trim(), "light");
  assert.equal(me.git("tag").trim(), "light");
  await runPlan(me.h, T.deletePlan("light", { here: false, remote: "origin" }));
  assert.equal(me.origin.git("tag").trim(), "");
  assert.equal(me.git("tag").trim(), "light", "kept here");
});
