// patches.js against real repositories: patches of the working tree, the index and a range (a
// binary file, a new and a deleted file) applied back through gitops.js applyPatch; a patch that
// doesn't apply changes nothing; --3way's conflicts; format-patch mail made into commits with git
// am, and an am that stops; the files a patch touches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mod } from "./mod.mjs";
import { repo } from "./gitenv.mjs";

const P = await mod("patches.js");
const C = await mod("conflicts.js");
const { applyPatch } = await mod("gitops.js");
const { fileOf } = await mod("scripts.js");
const { gitSays } = await mod("stashes.js");
const { runPlan } = await mod("gitplan.js");

// The page's transports: git apply through applyPatch, a body script through h.files.
const ways = (h) => ({
  apply: (patch, flags) => applyPatch(h, patch, flags),
  send: async (patch, body, args) => { const r = await h.files([fileOf("patch", patch)], body, args); if (r.code !== 0) throw new Error(gitSays(r) || "failed"); return r.stdout; },
});
const bytes = (n, seed) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed * 17) % 256));

test("patch arguments, mail or diff, the files a patch touches", () => {
  assert.deepEqual(P.diffPatchArgs(), ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--binary", "--"]);
  assert.deepEqual(P.diffPatchArgs({ what: "index", paths: ["a b"] }).slice(-3), ["--cached", "--", "a b"]);
  assert.deepEqual(P.diffPatchArgs({ what: "all" }).slice(-2), ["HEAD", "--"]);
  assert.deepEqual(P.diffPatchArgs({ what: "range", from: "v1", to: "v2" }).slice(-3), ["v1", "v2", "--"]);
  assert.deepEqual(P.diffPatchArgs({ what: "range", from: "v1" }).slice(-2), ["v1", "--"]);
  assert.throws(() => P.diffPatchArgs({ what: "range" }), /starts from/);
  assert.throws(() => P.diffPatchArgs({ what: "stash" }), /no patch of stash/);
  assert.deepEqual(P.formatPatchArgs(["b", "a"]), ["format-patch", "--stdout", "--no-cover-letter", "--no-walk=unsorted", "b", "a"]);
  assert.deepEqual(P.formatPatchArgs(["b"]), ["format-patch", "--stdout", "--no-cover-letter", "-1", "b"], "one commit alone is no range");
  assert.deepEqual(P.formatRangeArgs("main"), ["format-patch", "--stdout", "--no-cover-letter", "main..HEAD"]);
  const text = [
    "diff --git a/x y.txt b/x y.txt", "index 1..2 100644", "--- a/x y.txt\t", "+++ b/x y.txt\t", "@@ -1 +1 @@", "-a", "+b",
    "diff --git a/img.png b/img.png", "index 3..4 100644", "GIT binary patch", "literal 3", "abc", "",
    "diff --git a/gone.txt b/gone.txt", "deleted file mode 100644", "--- a/gone.txt", "+++ /dev/null", "@@ -1 +0,0 @@", "-x",
    "diff --git a/old b/new", "similarity index 100%", "rename from old", "rename to new",
    'diff --git "a/q\\"x" "b/q\\"x"', "new file mode 100644", "--- /dev/null", '+++ "b/q\\"x"', "@@ -0,0 +1 @@", "+q",
  ].join("\n") + "\n";
  assert.deepEqual(P.patchFiles(text), ["x y.txt", "img.png", "gone.txt", "new", 'q"x']);
  assert.deepEqual(P.patchFiles(""), []);
  assert.equal(P.isMbox(`From ${"a".repeat(40)} Mon Sep 17 00:00:00 2001\nFrom: x\n`), true);
  assert.equal(P.isMbox(text), false);
  assert.equal(P.applyPlan("").problem, "The patch is empty");
  assert.equal(P.applyPlan("hello\n").problem, "No file changes in it: is it a patch?");
  assert.match(P.applyPlan(`From ${"a".repeat(40)} Mon Sep 17 00:00:00 2001\n`).problem, /git am/);
  assert.match(P.amPlan(text).problem, /git apply/);
});

test("the working tree's changes as a patch, binary file, new and deleted files too, applied back after a reset", async () => {
  const r = repo("git-enhanced-patches-");
  r.write("img.bin", bytes(3000, 1));
  r.commit("one", { "a.txt": "a\n", "gone.txt": "g\n", "sp ace.txt": "s\n" });
  r.write("a.txt", "a changed\n"); r.write("img.bin", bytes(3500, 2)); r.remove("gone.txt"); r.write("sp ace.txt", "s2\n");
  r.write("new.txt", "new\n"); r.git("add", "new.txt");
  const patch = (await r.h.git(P.diffPatchArgs({ what: "all" }))).stdout;
  assert.match(patch, /GIT binary patch/);
  const want = { a: r.read("a.txt"), img: readFileSync(r.path("img.bin")), s: r.read("sp ace.txt") };
  r.git("reset", "-q", "--hard");
  const p = P.applyPlan(patch, { target: "both" });
  assert.deepEqual(p.files, ["a.txt", "gone.txt", "img.bin", "new.txt", "sp ace.txt"]);
  assert.match(p.confirm, /^Apply this patch to the working tree and the index\? It changes 5 files: a\.txt, gone\.txt, img\.bin, new\.txt, sp ace\.txt\.$/);
  await runPlan(r.h, p, ways(r.h));
  assert.equal(r.read("a.txt"), want.a);
  assert.deepEqual(readFileSync(r.path("img.bin")), want.img, "the binary file, byte for byte");
  assert.equal(r.read("sp ace.txt"), want.s);
  assert.equal(r.exists("gone.txt"), false);
  assert.equal(r.read("new.txt"), "new\n");
  assert.match(r.git("status", "--porcelain"), /^A  new\.txt$/m);
  // Taken back out again (reverse), then a patch that doesn't apply: refused, nothing changes.
  await runPlan(r.h, P.applyPlan(patch, { target: "both", reverse: true }), ways(r.h));
  assert.equal(r.git("status", "--porcelain"), "");
  r.write("a.txt", "something else\n");
  await assert.rejects(runPlan(r.h, P.applyPlan(patch), ways(r.h)), /patch does not apply|does not match/);
  assert.equal(r.read("a.txt"), "something else\n");
  assert.equal(r.exists("gone.txt"), true, "all or nothing: no other file changed either");
});

test("the index's patch staged again; a range's patch applied on another branch; --3way leaves a conflict", async () => {
  const r = repo("git-enhanced-patches-idx-");
  r.commit("one", { "f.txt": "1\n2\n3\n" });
  r.write("f.txt", "1\nTWO\n3\n"); r.git("add", "f.txt"); r.write("f.txt", "1\nTWO\n3\nunstaged\n");
  const staged = (await r.h.git(P.diffPatchArgs({ what: "index" }))).stdout;
  r.git("reset", "-q");
  await runPlan(r.h, P.applyPlan(staged, { target: "index" }), ways(r.h));
  assert.equal(r.git("show", ":f.txt"), "1\nTWO\n3\n");
  assert.equal(r.read("f.txt"), "1\nTWO\n3\nunstaged\n", "the working tree untouched");
  r.git("reset", "-q", "--hard");
  const c1 = r.git("rev-parse", "HEAD").trim();
  const c2 = r.commit("two", { "f.txt": "1\n2\n3\n4\n" });
  const range = (await r.h.git(P.diffPatchArgs({ what: "range", from: c1, to: c2 }))).stdout;
  r.git("switch", "-q", "-c", "other", c1);
  r.commit("other's", { "o.txt": "o\n" });
  await runPlan(r.h, P.applyPlan(range), ways(r.h));
  assert.equal(r.read("f.txt"), "1\n2\n3\n4\n");
  r.git("reset", "-q", "--hard");
  r.commit("in the way", { "f.txt": "1\n2\nTHREE\n" });
  const three = P.applyPlan(range, { threeWay: true });
  assert.deepEqual(three.steps.map((s) => s.apply), [["--3way"]], "no check first");
  assert.equal(three.confirm, "Apply this patch to the working tree and the index, with a three-way merge? It changes f.txt. git apply --3way stages what it applies, and a file it can't merge waits in conflict.");
  // A file that merges cleanly is staged: the index changes too.
  const clean = P.applyPlan("diff --git a/o.txt b/o.txt\n--- a/o.txt\n+++ b/o.txt\n@@ -1 +1 @@\n-o\n+O\n", { threeWay: true });
  await runPlan(r.h, clean, ways(r.h));
  assert.equal(r.git("diff", "--cached", "--name-only").trim(), "o.txt", "--3way staged it");
  r.git("reset", "-q", "--hard");
  await assert.rejects(runPlan(r.h, three, ways(r.h)), /conflict/i);
  assert.deepEqual(C.parseUnmerged((await r.h.git(C.UNMERGED_ARGS)).stdout).map((f) => f.path), ["f.txt"]);
  assert.equal(C.conflictCount(C.parseConflicts(r.read("f.txt"))), 1);
});

test("commits as format-patch mail (newest first in, oldest first out), made again with git am; an am that stops", async () => {
  const r = repo("git-enhanced-patches-am-");
  const base = r.commit("base", { "f.txt": "base\n" });
  r.git("switch", "-q", "-c", "work");
  const a = r.commit("first change", { "a.txt": "a\n" });
  r.commit("skipped", { "s.txt": "s\n" });
  const b = r.commit("second change\n\nWith a body.", { "b.txt": "b\n" });
  const mail = (await r.h.git(P.formatPatchArgs([b, a]))).stdout;
  assert.equal(P.isMbox(mail), true);
  assert.deepEqual([...mail.matchAll(/^Subject: (.*)$/gm)].map((m) => m[1]), ["[PATCH 1/2] first change", "[PATCH 2/2] second change"]);
  r.git("switch", "-q", "-c", "copy", base);
  const am = P.amPlan(mail);
  assert.equal(am.confirm, "Make 2 commits from these patches on the current branch, with their messages and authors?");
  const res = await runPlan(r.h, am, ways(r.h));
  assert.equal(res.stopped, null);
  assert.deepEqual(r.git("log", "--format=%s", `${base}..copy`).trim().split("\n"), ["second change", "first change"]);
  assert.equal(r.git("log", "-1", "--format=%b").trim(), "With a body.");
  assert.equal(r.exists("s.txt"), false, "the commit left out stays out");
  // One that doesn't apply: git am stops and waits (conflicts.js: "am").
  r.git("switch", "-q", "-c", "clash", base);
  r.commit("clash", { "a.txt": "different\n" });
  const stop = await runPlan(r.h, P.amPlan(mail), ways(r.h));
  assert.ok(stop.stopped, "stopped");
  assert.equal(C.parseStopped((await r.h.sh(C.STOPPED_SH)).stdout).op, "am");
  await runPlan(r.h, C.abortPlan("am"));
  const range = (await r.h.git(P.formatRangeArgs(base, "work"))).stdout;
  assert.equal((range.match(/^From [0-9a-f]{40} /gm) ?? []).length, 3);
});
