// conflicts.js: conflict blocks parsed from literal texts (git's styles, custom marker sizes,
// CRLF, things that only look like markers) and from real merges, the files in conflict and
// their kinds, taking sides, marking resolved, Continue / Skip / Abort of real merges, rebases,
// cherry-picks and `git am`, and the agent's prompt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { mod } from "./mod.mjs";
import { repo, runner, SHELLS, ENV } from "./gitenv.mjs";

const C = await mod("conflicts.js");
const { runPlan, parseVersion } = await mod("gitplan.js");
const kinds = (segs) => segs.map((s) => s.kind);

test("parseConflicts: git's default style, labels, the text around, and every choice", () => {
  const text = "top\n<<<<<<< HEAD\nours 1\nours 2\n=======\ntheirs\n>>>>>>> feature/x\nmiddle\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> feature/x\nend";
  const segs = C.parseConflicts(text);
  assert.deepEqual(kinds(segs), ["text", "conflict", "text", "conflict", "text"]);
  const [, c] = segs;
  assert.deepEqual([c.index, c.ours, c.base, c.theirs, c.labels, c.line], [0, "ours 1\nours 2\n", null, "theirs\n", { ours: "HEAD", base: null, theirs: "feature/x" }, 1]);
  assert.equal(segs.map((s) => s.text ?? s.raw).join(""), text, "the segments make the text again");
  assert.equal(C.resolve(segs, []), text, "no choice keeps every block");
  assert.equal(C.resolve(segs, ["ours", "theirs"]), "top\nours 1\nours 2\nmiddle\nb\nend");
  assert.equal(C.resolve(segs, { 0: "both", 1: "both-theirs-first" }), "top\nours 1\nours 2\ntheirs\nmiddle\nb\na\nend");
  assert.equal(C.resolve(segs, ["theirs", "keep"]), "top\ntheirs\nmiddle\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> feature/x\nend");
  assert.deepEqual(C.unresolved(segs, ["theirs"]), [1]);
  assert.throws(() => C.resolve(segs, ["base"]), /no base/);
  assert.throws(() => C.resolve(segs, ["mine"]), /no choice/);
  assert.equal(C.conflictCount(segs), 2);
  assert.equal(C.hasConflicts(text), true);
  assert.equal(C.hasConflicts(C.resolve(segs, ["ours", "ours"])), false);
});

test("parseConflicts: diff3 and zdiff3 base sections, empty sides, a block at the end without a newline", () => {
  const text = "<<<<<<< HEAD\nmine\n||||||| merged common ancestors\nold\n=======\n>>>>>>> side\nafter\n<<<<<<< ours\n||||||| base\n=======\nnew\n>>>>>>> theirs";
  const segs = C.parseConflicts(text);
  assert.deepEqual(kinds(segs), ["conflict", "text", "conflict"]);
  assert.deepEqual([segs[0].ours, segs[0].base, segs[0].theirs, segs[0].labels.base], ["mine\n", "old\n", "", "merged common ancestors"]);
  assert.deepEqual([segs[2].ours, segs[2].base, segs[2].theirs, segs[2].labels.theirs], ["", "", "new\n", "theirs"]);
  assert.equal(C.resolve(segs, ["base", "theirs"]), "old\nafter\nnew\n");
  assert.equal(segs.map((s) => s.text ?? s.raw).join(""), text);
  // A marker without a label (git checkout -m writes "|||||||" alone).
  assert.equal(C.parseConflicts("<<<<<<<\na\n|||||||\nb\n=======\nc\n>>>>>>>\n")[0].base, "b\n");
});

test("parseConflicts: CRLF files keep their line ends; custom marker sizes; markers that are none", () => {
  const crlf = "x\r\n<<<<<<< HEAD\r\na\r\n=======\r\nb\r\n>>>>>>> side\r\ny\r\n";
  const segs = C.parseConflicts(crlf);
  assert.deepEqual(kinds(segs), ["text", "conflict", "text"]);
  assert.deepEqual([segs[1].ours, segs[1].theirs, segs[1].labels.ours, segs[1].labels.theirs], ["a\r\n", "b\r\n", "HEAD", "side"]);
  assert.equal(C.resolve(segs, ["theirs"]), "x\r\nb\r\ny\r\n");
  // conflict-marker-size=10: seven-character runs are content, and the other way round.
  const ten = "<<<<<<<<<< HEAD\n<<<<<<< not a marker\n=======\n========== \n==========\nb\n>>>>>>>>>> side\n";
  const big = C.parseConflicts(ten, 10);
  assert.deepEqual(kinds(big), ["conflict"]);
  assert.deepEqual([big[0].ours, big[0].theirs], ["<<<<<<< not a marker\n=======\n========== \n", "b\n"]);
  assert.deepEqual(kinds(C.parseConflicts(ten)), ["text"], "with 7, none of those lines is a marker");
  // Look-alikes: inside a line, too long, a separator with a label, a label without the space.
  const fake = "x <<<<<<< HEAD\n<<<<<<<< eight\n<<<<<<<HEAD\n======= label\n>>>>>>>side\n";
  assert.deepEqual(kinds(C.parseConflicts(fake)), ["text"]);
  // An RST underline inside theirs (a second separator) is content.
  assert.equal(C.parseConflicts("<<<<<<< a\nx\n=======\nTitle\n=======\n>>>>>>> b\n")[0].theirs, "Title\n=======\n");
});

test("parseConflicts: blocks that never end, or markers out of place, stay text", () => {
  const open = "a\n<<<<<<< HEAD\nb\n=======\nc\n";
  assert.deepEqual(kinds(C.parseConflicts(open)), ["text"]);
  assert.equal(C.resolve(C.parseConflicts(open)), open);
  // An end marker before the separator: not a block; a new start inside one starts over.
  assert.deepEqual(kinds(C.parseConflicts("<<<<<<< a\nx\n>>>>>>> b\n")), ["text"]);
  const restart = "<<<<<<< a\nx\n<<<<<<< c\ny\n=======\nz\n>>>>>>> d\n";
  const segs = C.parseConflicts(restart);
  assert.deepEqual(kinds(segs), ["text", "conflict"]);
  assert.deepEqual([segs[0].text, segs[1].ours, segs[1].labels.ours], ["<<<<<<< a\nx\n", "y\n", "c"]);
  assert.equal(segs.map((s) => s.text ?? s.raw).join(""), restart);
  assert.deepEqual(C.parseConflicts(""), []);
  assert.deepEqual(C.parseConflicts("no newline"), [{ kind: "text", text: "no newline" }]);
});

test("the files in conflict from status --porcelain=v2 -z: kinds, sides, odd paths, other entries passed over", () => {
  const z = (...e) => e.join("\0") + "\0";
  const u = (xy, m, path) => `u ${xy} N... ${m.join(" ")} 100644 ${m.map((x) => (x === "000000" ? "0".repeat(40) : "a".repeat(40))).join(" ")} ${path}`;
  const out = z(
    "# branch.oid 0123456789012345678901234567890123456789",
    "1 .M N... 100644 100644 100644 " + "b".repeat(40) + " " + "b".repeat(40) + " plain.txt",
    "2 R. N... 100644 100644 100644 " + "c".repeat(40) + " " + "c".repeat(40) + " R100 new name.txt", "u UU fake old path",
    u("UU", ["100644", "100644", "100644"], "both mod.txt"),
    u("AA", ["000000", "100644", "100644"], "new\nline.txt"),
    u("DU", ["100644", "000000", "100644"], "gone here.txt"),
    u("UD", ["100644", "100644", "000000"], "gone there.txt"),
    u("DD", ["100644", "000000", "000000"], "both gone.txt"),
    "? untracked.txt",
  );
  const files = C.parseUnmerged(out);
  assert.deepEqual(files.map((f) => [f.path, f.xy, f.kind, f.base, f.ours, f.theirs]), [
    ["both mod.txt", "UU", "both modified", true, true, true],
    ["new\nline.txt", "AA", "both added", false, true, true],
    ["gone here.txt", "DU", "deleted by us", true, false, true],
    ["gone there.txt", "UD", "deleted by them", true, true, false],
    ["both gone.txt", "DD", "both deleted", true, false, false],
  ], "the renamed entry's old path (which looks like a u entry) is passed over");
  assert.deepEqual(C.parseUnmerged(""), []);
  assert.deepEqual(C.fileChoices(files[0]).map((i) => i.id), ["edit", "ours", "theirs", "delete", "resolved"]);
  assert.deepEqual(C.fileChoices(files[2]).map((i) => i.label), ["Take ours: deleted", "Take theirs", "Delete the file", "Mark as resolved"]);
  assert.deepEqual(C.fileChoices({ ...files[0], submodule: true }).map((i) => i.id), ["ours", "theirs", "delete", "resolved"]);
});

// A merge of `side` into main that conflicts in four ways.
function conflicted() {
  const r = repo("git-enhanced-conflicts-");
  r.commit("base", { "uu.txt": "base\n", "du.txt": "base\n", "ud.txt": "base\n", "keep.txt": "k\n" });
  r.git("switch", "-q", "-c", "side");
  r.commit("side", { "uu.txt": "side\n", "du.txt": "side\n", "ud.txt": null, "aa.txt": "side\n" });
  r.git("switch", "-q", "main");
  r.commit("main", { "uu.txt": "main\n", "du.txt": null, "ud.txt": "main\n", "aa.txt": "main\n" });
  assert.notEqual(r.tryGit(...["-c", "core.editor=true", "merge", "--no-edit", "side"]).status, 0);
  return r;
}

test("a real merge: what is stopped, the files and kinds, taking sides, deleting, marking resolved, Continue", async () => {
  const r = conflicted();
  for (const shell of SHELLS) {
    const s = C.parseStopped((await runner(r.dir, shell).sh(C.STOPPED_SH)).stdout);
    assert.equal(s.op, "merge", shell);
    assert.equal(s.branch, "main");
    assert.deepEqual(s.merging, [r.git("rev-parse", "side").trim()]);
    assert.match(s.message, /side/);
    assert.equal(s.commit, null);
    assert.equal(s.head, r.git("rev-parse", "HEAD").trim());
  }
  const files = C.parseUnmerged((await r.h.git(C.UNMERGED_ARGS)).stdout);
  assert.deepEqual(files.map((f) => `${f.xy} ${f.path}`), ["AA aa.txt", "DU du.txt", "UD ud.txt", "UU uu.txt"]);
  const by = Object.fromEntries(files.map((f) => [f.path, f]));
  assert.equal(C.continuePlan("merge", { unresolved: files.length }).problem, "4 files still have conflicts: resolve them first");
  // The conflict view of uu.txt: theirs.
  const segs = C.parseConflicts(r.read("uu.txt"), C.parseMarkerSize((await r.h.git(C.markerSizeArgs("uu.txt"))).stdout));
  assert.deepEqual([segs[0].ours, segs[0].theirs, segs[0].labels], ["main\n", "side\n", { ours: "HEAD", base: null, theirs: "side" }]);
  r.write("uu.txt", C.resolve(segs, ["theirs"]));
  const steps = [C.resolvedPlan(["uu.txt"]), C.takeSidePlan(by["aa.txt"], "ours"), C.takeSidePlan(by["du.txt"], "ours"), C.takeSidePlan(by["ud.txt"], "theirs")];
  assert.ok(steps.slice(1).every((p) => p.danger && p.confirm), "taking a side says what goes");
  assert.match(steps[2].confirm, /deleted there: the file goes, with the changes of theirs/);
  // The sides as the menu names them: in a rebase "ours" is the new base, "theirs" your commit.
  const names = C.sideNames("rebase", { onto: "1".repeat(40), commit: "2".repeat(40), rebasing: "feat" });
  assert.equal(C.takeSidePlan(by["aa.txt"], "theirs", names).confirm,
    "Take Your commit 2222222 from feat for aa.txt? The changes of 1111111 (being rebased onto) are dropped, and so is any editing of its conflicts so far.");
  assert.equal(C.fileChoices(by["aa.txt"], names).find((i) => i.id === "theirs").label, "Take Your commit 2222222 from feat");
  for (const p of steps) await runPlan(r.h, p);
  assert.deepEqual(C.parseUnmerged((await r.h.git(C.UNMERGED_ARGS)).stdout), []);
  assert.equal(r.read("aa.txt"), "main\n");
  assert.equal(r.exists("du.txt") || r.exists("ud.txt"), false, "a side that deleted a file: it goes");
  assert.equal(r.git("diff", "--cached", "--name-status", "HEAD").trim().split("\n").sort().join(" "), "D\tud.txt M\tuu.txt", "against HEAD (main): ud.txt deleted as side did, uu.txt theirs");
  await runPlan(r.h, C.continuePlan("merge"));
  assert.equal(r.git("log", "-1", "--format=%P").trim().split(" ").length, 2, "the merge commit, with git's message and no editor");
  assert.equal(r.git("log", "-1", "--format=%B").trim(), "Merge branch 'side'", "git's message, its comment lines (# Conflicts:) dropped");
  assert.equal(C.parseStopped((await r.h.sh(C.STOPPED_SH)).stdout).op, null);
  // The same with git merge --continue (git 2.12 and newer).
  const r2 = conflicted();
  for (const p of ["uu.txt", "aa.txt", "du.txt", "ud.txt"]) r2.tryGit("add", "-A", "--", p);
  const version = parseVersion(r2.git("version"));
  assert.deepEqual(C.continuePlan("merge", { version }).steps[0].args, ["-c", "core.editor=true", "merge", "--continue"]);
  await runPlan(r2.h, C.continuePlan("merge", { version }));
  assert.equal(r2.git("log", "-1", "--format=%B").trim(), "Merge branch 'side'");
});

test("a deleted file marked resolved, a file started over with its base shown, a deleted one", async () => {
  const r = conflicted();
  r.remove("uu.txt");
  await runPlan(r.h, C.resolvedPlan(["uu.txt"]));
  assert.match(r.git("status", "--porcelain"), /^D  uu\.txt$/m, "a file that is gone: staged as deleted");
  const r2 = conflicted();
  r2.write("uu.txt", "half done\n");
  await runPlan(r2.h, C.restartPlan("uu.txt", "diff3"));
  const segs = C.parseConflicts(r2.read("uu.txt"));
  assert.deepEqual([segs[0].ours, segs[0].base, segs[0].theirs], ["main\n", "base\n", "side\n"], "diff3 markers, the base between");
  assert.equal(C.resolve(segs, ["base"]), "base\n");
  await runPlan(r2.h, C.deletePlan({ path: "aa.txt" }));
  assert.equal(r2.exists("aa.txt"), false);
  assert.match(r2.git("status", "--porcelain"), /^D  aa\.txt$/m, "both added it: deleted against HEAD, no longer in conflict");
});

test("a merge's base section from git (diff3, zdiff3) and a custom marker size from .gitattributes", async () => {
  for (const style of ["diff3", "zdiff3"]) {
    const r = repo("git-enhanced-conflicts-style-");
    r.commit("base", { "f.txt": "1\n2\n3\n" });
    r.git("switch", "-q", "-c", "side"); r.commit("side", { "f.txt": "1\nside\n3\n" });
    r.git("switch", "-q", "main"); r.commit("main", { "f.txt": "1\nmain\n3\n" });
    r.tryGit("-c", `merge.conflictStyle=${style}`, "-c", "core.editor=true", "merge", "--no-edit", "side");
    const [, c] = C.parseConflicts(r.read("f.txt"));
    assert.deepEqual([c.ours, c.base, c.theirs], ["main\n", "2\n", "side\n"], style);
  }
  const r = repo("git-enhanced-conflicts-size-");
  r.commit("base", { ".gitattributes": "*.txt conflict-marker-size=12\n", "f.txt": "x\n" });
  r.git("switch", "-q", "-c", "side"); r.commit("side", { "f.txt": "side\n" });
  r.git("switch", "-q", "main"); r.commit("main", { "f.txt": "main\n" });
  r.tryGit("-c", "core.editor=true", "merge", "--no-edit", "side");
  const size = C.parseMarkerSize((await r.h.git(C.markerSizeArgs("f.txt"))).stdout);
  assert.equal(size, 12);
  assert.match(r.read("f.txt"), /^<{12} HEAD$/m);
  assert.equal(C.conflictCount(C.parseConflicts(r.read("f.txt"), size)), 1);
  assert.equal(C.conflictCount(C.parseConflicts(r.read("f.txt"))), 0);
  assert.equal(C.parseMarkerSize((await r.h.git(C.markerSizeArgs(".gitattributes"))).stdout), 7, "unspecified: git's 7");
  assert.equal(C.parseMarkerSize(""), 7);
});

// A branch `feat` with two commits, the first conflicting with main.
function rebasing() {
  const r = repo("git-enhanced-conflicts-rebase-");
  r.commit("base", { "f.txt": "base\n" });
  r.git("switch", "-q", "-c", "feat");
  const first = r.commit("f1", { "f.txt": "feat\n" });
  r.commit("f2", { "g.txt": "g\n" });
  r.git("switch", "-q", "main");
  const onto = r.commit("m", { "f.txt": "main\n" });
  r.git("switch", "-q", "feat");
  assert.notEqual(r.tryGit("rebase", "main").status, 0);
  return { r, first, onto };
}

test("a real rebase: where it is, the sides' names, Skip (danger) and then it finishes", async () => {
  const { r, first, onto } = rebasing();
  const s = C.parseStopped((await r.h.sh(C.STOPPED_SH)).stdout);
  assert.deepEqual([s.op, s.rebasing, s.onto, s.commit, s.step, s.branch], ["rebase", "feat", onto, first, { done: 1, total: 2 }, null]);
  const names = C.sideNames("rebase", s);
  assert.match(names.ours, /being rebased onto/);
  assert.match(names.theirs, new RegExp(`Your commit ${first.slice(0, 7)} from feat`));
  const skip = C.skipPlan("rebase", s);
  assert.equal(skip.danger, true);
  assert.match(skip.confirm, new RegExp(`Commit ${first.slice(0, 7)} is left out of the rebased branch`));
  const res = await runPlan(r.h, skip);
  assert.equal(res.stopped, null);
  assert.equal(C.parseStopped((await r.h.sh(C.STOPPED_SH)).stdout).op, null);
  assert.deepEqual(r.git("log", "--format=%s", "main..feat").trim().split("\n"), ["f2"], "f1 left out, f2 replayed");
  assert.equal(C.skipPlan("merge").problem, "A merge can't skip: abort it, or resolve the conflicts");
});

test("a real rebase resolved and continued with no editor, one that stops again, and Abort", async () => {
  const { r } = rebasing();
  r.write("f.txt", "resolved\n"); r.git("add", "f.txt");
  const res = await runPlan(r.h, C.continuePlan("rebase"));
  assert.equal(res.stopped, null);
  assert.deepEqual(r.git("log", "--format=%s", "main..feat").trim().split("\n"), ["f2", "f1"], "f1 kept its message");
  // Two conflicting commits: Continue after the first stops again on the second; Abort goes back.
  const r2 = repo("git-enhanced-conflicts-again-");
  r2.commit("base", { "f.txt": "base\n" });
  r2.git("switch", "-q", "-c", "feat");
  r2.commit("f1", { "f.txt": "feat1\n" });
  const tip = r2.commit("f2", { "f.txt": "feat2\n" });
  r2.git("switch", "-q", "main"); r2.commit("m", { "f.txt": "main\n" });
  r2.git("switch", "-q", "feat");
  r2.tryGit("rebase", "main");
  r2.write("f.txt", "mine1\n"); r2.git("add", "f.txt");
  const again = await runPlan(r2.h, C.continuePlan("rebase"));
  assert.match(again.stopped, /CONFLICT|could not apply/i, "stopped on f2");
  assert.deepEqual(C.parseStopped((await r2.h.sh(C.STOPPED_SH)).stdout).step, { done: 2, total: 2 });
  const abort = C.abortPlan("rebase");
  assert.equal(abort.danger, true);
  assert.match(abort.confirm, /^Abort the rebase\? git rebase --abort: the branch goes back/);
  await runPlan(r2.h, abort);
  assert.equal(r2.git("rev-parse", "HEAD").trim(), tip);
  assert.equal(r2.git("branch", "--show-current").trim(), "feat");
});

test("a real cherry-pick of two commits stopped on the first; a revert; git am: each one's state and Abort", async () => {
  const r = repo("git-enhanced-conflicts-pick-");
  r.commit("base", { "f.txt": "base\n" });
  r.git("switch", "-q", "-c", "side");
  const a = r.commit("a", { "f.txt": "side\n" });
  r.commit("b", { "g.txt": "g\n" });
  r.git("switch", "-q", "main");
  const head = r.commit("m", { "f.txt": "main\n" });
  r.tryGit("cherry-pick", a, "side");
  let s = C.parseStopped((await r.h.sh(C.STOPPED_SH)).stdout);
  assert.deepEqual([s.op, s.commit, s.branch], ["cherry-pick", a, "main"]);
  assert.equal(s.left, 2, "git's to-do list: the pick stopped at, then b");
  assert.match(C.agentPrompt({ op: s.op, files: ["f.txt"], branch: s.branch, commit: s.commit }), new RegExp(`Cherry-picking commit ${a.slice(0, 7)} onto main`));
  await runPlan(r.h, C.abortPlan("cherry-pick"));
  assert.equal(r.git("rev-parse", "HEAD").trim(), head);
  // A revert that conflicts.
  const r2 = repo("git-enhanced-conflicts-revert-");
  r2.commit("base", { "f.txt": "1\n" });
  const c = r2.commit("two", { "f.txt": "2\n" });
  r2.commit("three", { "f.txt": "3\n" });
  r2.tryGit("-c", "core.editor=true", "revert", "--no-edit", c);
  s = C.parseStopped((await r2.h.sh(C.STOPPED_SH)).stdout);
  assert.deepEqual([s.op, s.commit], ["revert", c]);
  assert.match(C.skipPlan("revert", s).confirm, /isn't reverted/);
  await runPlan(r2.h, C.skipPlan("revert", s));
  assert.equal(C.parseStopped((await r2.h.sh(C.STOPPED_SH)).stdout).op, null);
  // git am keeps its state where a rebase does (rebase-apply): it is told apart.
  const r3 = repo("git-enhanced-conflicts-am-");
  r3.commit("base", { "f.txt": "1\n" });
  r3.git("switch", "-q", "-c", "side"); r3.commit("side", { "f.txt": "side\n" });
  const patch = r3.git("format-patch", "-1", "--stdout");
  r3.git("switch", "-q", "main"); r3.commit("main", { "f.txt": "main\n" });
  r3.write("p.mbox", patch);
  r3.tryGit("am", "p.mbox");
  s = C.parseStopped((await r3.h.sh(C.STOPPED_SH)).stdout);
  assert.equal(s.op, "am");
  assert.deepEqual(C.continueArgs("am"), ["-c", "core.editor=true", "am", "--continue"]);
  await runPlan(r3.h, C.abortPlan("am"));
  assert.equal(C.parseStopped((await r3.h.sh(C.STOPPED_SH)).stdout).op, null);
});

test("Continue / Skip / Abort arguments, nothing in progress, and the prompt for an agent", () => {
  assert.deepEqual(C.continueArgs("merge", parseVersion("git version 2.12.0")), ["-c", "core.editor=true", "merge", "--continue"]);
  assert.deepEqual(C.continueArgs("merge", parseVersion("git version 2.11.4")), ["-c", "core.editor=true", "commit"], "before merge --continue: git commit");
  assert.deepEqual(C.continueArgs("merge"), ["-c", "core.editor=true", "commit"], "a version not known: git commit, which every git has");
  assert.equal(C.skipPlan("cherry-pick", {}, { version: parseVersion("git version 2.22.0") }).problem, "Skipping in a cherry-pick needs git 2.23 or newer");
  assert.equal(C.skipPlan("rebase", {}, { version: parseVersion("git version 2.22.0") }).problem, undefined, "a rebase could always skip");
  assert.deepEqual(C.skipArgs("cherry-pick"), ["-c", "core.editor=true", "cherry-pick", "--skip"]);
  assert.equal(C.skipArgs("merge"), null);
  assert.deepEqual(C.abortArgs("revert"), ["revert", "--abort"]);
  assert.equal(C.continueArgs("bisect"), null);
  assert.equal(C.continuePlan(null).problem, "Nothing is in progress");
  assert.equal(C.continuePlan("rebase", { unresolved: 1 }).problem, "1 file still has conflicts: resolve it first");
  assert.equal(C.parseStopped("").op, null);
  const files = [{ path: "src/a b.js", xy: "UU", kind: "both modified" }, { path: "old.txt", xy: "UD", kind: "deleted by them" }];
  const p = C.agentPrompt({ op: "rebase", files, branch: "feature", onto: "main" });
  assert.match(p, /^A git rebase stopped on conflicts\. Rebasing feature onto main\./);
  assert.match(p, /- src\/a b\.js \(both modified\)\n- old\.txt \(deleted by them\)/);
  assert.match(p, /Don't commit, and don't run --continue, --skip or --abort/);
  assert.match(p, /tell me, file by file, what you chose and why/);
  assert.match(p, /other way round/, "a rebase's sides explained");
  assert.match(C.agentPrompt({ op: "merge", files: ["x"], branch: "main", onto: "side" }), /Merging side into main\.[\s\S]*after <<<<<<< is ours/);
  assert.deepEqual(C.sideNames("merge", { branch: "main", onto: "side" }), { ours: "main", theirs: "side" });
});

test("STOPPED_SH: outside a repository it fails; on an unborn branch nothing is stopped", () => {
  const plain = repo("git-enhanced-conflicts-none-");
  for (const shell of SHELLS) {
    const r = spawnSync(shell, ["-c", C.STOPPED_SH], { cwd: plain.dir, env: ENV, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const s = C.parseStopped(r.stdout);
    assert.deepEqual([s.op, s.branch, s.head, s.step, s.left], [null, "main", null, null, null], "an unborn branch: no HEAD yet");
    const outside = spawnSync(shell, ["-c", C.STOPPED_SH], { cwd: tmpdir(), env: { ...ENV, GIT_CEILING_DIRECTORIES: dirname(tmpdir()) }, encoding: "utf8" });
    assert.notEqual(outside.status, 0);
  }
});

test("markers left: git grep of the index (7 or more, all three kinds, CRLF), staged against HEAD only; grep counts a file's blocks of its size", async () => {
  const r = repo("git-enhanced-conflicts-markers-");
  r.commit("one", { "old.txt": "<<<<<<< a\n=======\n>>>>>>> b\n", "f.txt": "1\n", "g.txt": "1\n", "h.txt": "1\n", "-dash.txt": "1\n" });
  r.write("f.txt", "<<<<<<< HEAD\r\nx\r\n=======\r\ny\r\n>>>>>>> side\r\n");
  r.write("g.txt", "only a\n=======\nsetext heading\n");
  r.write("h.txt", "<<<<<<<<<<\nx\n==========\ny\n>>>>>>>>>> b\n");
  r.write("-dash.txt", "<<<<<<< a\n=======\n>>>>>>> b\n<<<<<<< a\n=======\n>>>>>>> b\n");
  r.git("add", "-A");
  const marked = r.git(...C.MARKED_ARGS), staged = r.git(...C.STAGED_ARGS);
  assert.deepEqual(C.markedFiles(marked, staged), ["-dash.txt", "f.txt", "h.txt"]);
  assert.equal(C.markersQuestion(["a", "b", "c", "d"]).title, "4 files still have conflict markers: a, b, c and 1 more. Continue anyway?");
  for (const shell of SHELLS) {
    const h = runner(r.dir, shell), count = async (n, p) => (await h.sh(C.COUNT_MARKERS_SH, [n, p])).stdout.trim();
    assert.deepEqual([await count("7", "-dash.txt"), await count("7", "f.txt"), await count("7", "h.txt"), await count("10", "h.txt"), await count("7", "gone.txt")], ["2", "1", "0", "1", "0"], shell);
  }
});
