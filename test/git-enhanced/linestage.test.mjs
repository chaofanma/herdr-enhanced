// linestage.js against real git: the selected lines staged, unstaged and discarded, and the index
// and the working tree checked after each: several hunks, a block replaced in part, files without
// a newline at the end, new (untracked, intent-to-add) and deleted files, a rename, odd names,
// CRLF. The patches go through gitops.js applyPatch, the base64 path the page uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
import { repo } from "./gitenv.mjs";

const L = await mod("linestage.js");
const { DIFF, FLAGS, splitDiff } = await mod("hunk.js");
const { applyPatch } = await mod("gitops.js");
const { runPlan } = await mod("gitplan.js");

const lines = (...xs) => xs.map((x) => `${x}\n`).join("");
// The file's diff from the side `action` reads (SOURCE), or an untracked file's.
function diffOf(r, path, action, { untracked = false, extra = [] } = {}) {
  if (untracked) return r.tryGit("diff", "--no-index", ...DIFF, "--", "/dev/null", path).stdout;
  return r.git("diff", ...(L.SOURCE[action] === "staged" ? ["--cached"] : []), ...DIFF, ...extra, "--", ...(Array.isArray(path) ? path : [path]));
}
// The indexes of the diff's rows that are `rows` ("+B", "-b"), each the first not taken yet.
function pick(diff, ...rows) {
  const ls = splitDiff(diff).lines, taken = new Set();
  return rows.map((row) => { const i = ls.findIndex((l, k) => l === row && !taken.has(k)); assert.ok(i >= 0, `no row ${JSON.stringify(row)} in\n${diff}`); taken.add(i); return i; });
}
async function act(r, path, action, rows, opts = {}) {
  const diff = diffOf(r, path, action, opts), p = L.linePatch(diff, pick(diff, ...rows), action);
  assert.ok(p, `a patch for ${rows}`);
  await applyPatch(r.h, p.patch, p.flags);
  return p;
}
const index = (r, path) => r.git("show", `:${path}`);
const inIndex = (r, path) => r.tryGit("ls-files", "--error-unmatch", "--", path).status === 0;

test("the flags are the hunk buttons' flags; each action's diff", () => {
  assert.deepEqual(L.LINE_FLAGS, { stage: FLAGS.stage, unstage: FLAGS.unstage, discard: FLAGS.revert });
  assert.deepEqual(L.SOURCE, { stage: "unstaged", unstage: "staged", discard: "unstaged" });
  assert.throws(() => L.linePatch("", [], "commit"), /no line action/);
});

test("several hunks: a line of the second staged (its header counted after the first), then unstaged, then one discarded", async () => {
  const r = repo("git-enhanced-lines-");
  const base = Array.from({ length: 20 }, (_, i) => `l${i + 1}`);
  r.commit("one", { "f.txt": lines(...base) });
  const work = [...base]; work.splice(2, 0, "ins1", "ins2"); work.splice(17, 0, "new"); work[20] = "L18";
  assert.deepEqual(work.slice(15, 22), ["l14", "l15", "new", "l16", "l17", "L18", "l19"]);
  r.write("f.txt", lines(...work));
  const unstaged = diffOf(r, "f.txt", "stage");
  assert.match(unstaged, /^@@ -13,8 \+15,9 @@/m, "git's second hunk, two lines down after the first");
  const p = await act(r, "f.txt", "stage", ["+new"]);
  assert.match(p.patch, /^@@ -13,8 \+13,9 @@ l12$/m, "the first hunk isn't staged: no lines down");
  assert.equal(index(r, "f.txt"), lines(...base.slice(0, 15), "new", ...base.slice(15)));
  assert.equal(r.read("f.txt"), lines(...work), "the working tree is untouched");
  await act(r, "f.txt", "stage", ["+ins1", "+ins2"]);
  assert.equal(index(r, "f.txt"), lines("l1", "l2", "ins1", "ins2", ...base.slice(2, 15), "new", ...base.slice(15)));
  const back = await act(r, "f.txt", "unstage", ["+new"]);
  assert.match(back.patch, /^@@ -15,6 \+15,7 @@/m, "backwards: the index's numbers, and the result's below the staged lines");
  assert.equal(index(r, "f.txt"), lines("l1", "l2", "ins1", "ins2", ...base.slice(2)));
  await act(r, "f.txt", "discard", ["-l18", "+L18"]);
  assert.equal(r.read("f.txt"), lines("l1", "l2", "ins1", "ins2", ...base.slice(2, 15), "new", ...base.slice(15)), "l18 is back in the file");
  assert.equal(index(r, "f.txt"), lines("l1", "l2", "ins1", "ins2", ...base.slice(2)), "the index is untouched by a discard");
});

test("the side git apply matches keeps exact numbers: a change in the second of two like blocks is the one undone", async () => {
  const r = repo("git-enhanced-lines-twins-");
  const block = (t) => ["k1", "k2", "k3", t, "k4", "k5", "k6"];
  const spacer = Array.from({ length: 10 }, (_, i) => `s${i + 1}`), many = Array.from({ length: 30 }, (_, i) => `i${i + 1}`);
  r.commit("one", { "f.txt": lines("u0", ...spacer, ...block("T"), "u1", ...block("T"), "u2") });
  r.write("f.txt", lines("u0", ...many, ...spacer, ...block("T2"), "u1", ...block("T2"), "u2")); r.git("add", "f.txt");
  const diff = diffOf(r, "f.txt", "unstage"), rows = pick(diff, "-T", "+T2", "-T", "+T2");
  const p = L.linePatch(diff, rows.slice(2), "unstage");
  // The second block starts at line 50 in the index; at 20 in HEAD, which is nearer the first
  // block (at 42 in the index): a patch that said 20 would have git find the first block.
  assert.match(p.patch, /^@@ -50,7 \+50,7 @@/m);
  // With HEAD's numbers (what keeping the old side's start gives), git takes the first block.
  await applyPatch(r.h, p.patch.replace(/^@@ -50,7 \+50,7 @@/m, "@@ -20,7 +20,7 @@"), p.flags);
  assert.equal(index(r, "f.txt"), lines("u0", ...many, ...spacer, ...block("T"), "u1", ...block("T2"), "u2"), "the wrong block undone");
  r.git("add", "f.txt");
  await applyPatch(r.h, p.patch, p.flags);
  assert.equal(index(r, "f.txt"), lines("u0", ...many, ...spacer, ...block("T2"), "u1", ...block("T"), "u2"));
});

test("a block replaced in part: kept old lines stay as context, unselected new lines go", async () => {
  const r = repo("git-enhanced-lines-block-");
  r.commit("one", { "f.txt": lines("c0", "x1", "x2", "x3", "c9") });
  r.write("f.txt", lines("c0", "y1", "y2", "c9"));
  await act(r, "f.txt", "stage", ["-x1", "+y1"]);
  assert.equal(index(r, "f.txt"), lines("c0", "y1", "x2", "x3", "c9"));
  await act(r, "f.txt", "stage", ["-x3", "+y2"]);
  assert.equal(index(r, "f.txt"), lines("c0", "y1", "x2", "y2", "c9"), "y2 after x2: the unselected x2 stays before it");
  await act(r, "f.txt", "unstage", ["+y1", "-x1"]);
  assert.equal(index(r, "f.txt"), lines("c0", "x1", "x2", "y2", "c9"));
  await act(r, "f.txt", "unstage", ["-x3"]);
  assert.equal(index(r, "f.txt"), lines("c0", "x1", "x2", "x3", "y2", "c9"), "x3 comes back, y2 stays");
});

test("no newline at the end: each side's last line keeps or gets its newline as it should", async () => {
  // Forward: index "a\nb", working tree "a\nB".
  let r = repo("git-enhanced-lines-eol-");
  r.commit("one", { "f.txt": "a\nb" }); r.write("f.txt", "a\nB");
  await act(r, "f.txt", "stage", ["+B"]);
  assert.equal(index(r, "f.txt"), "a\nB\nb", "B goes before the kept b, which still ends the file without a newline");
  r = repo("git-enhanced-lines-eol2-");
  r.commit("one", { "f.txt": "a\nb" }); r.write("f.txt", "a\nB");
  await act(r, "f.txt", "stage", ["-b"]);
  assert.equal(index(r, "f.txt"), "a\n");
  // A line added after one that ended the file: that one gets its newline.
  r = repo("git-enhanced-lines-eol3-");
  r.commit("one", { "f.txt": "a\nb" }); r.write("f.txt", "a\nb\nc");
  const p = await act(r, "f.txt", "stage", ["+c"]);
  assert.match(p.patch, /^-b\n\\ No newline at end of file\n\+b\n\+c\n\\ No newline at end of file\n$/m);
  assert.equal(index(r, "f.txt"), "a\nb\nc");
  // Backwards: HEAD "a\nb", index "a\nB".
  r = repo("git-enhanced-lines-eol4-");
  r.commit("one", { "f.txt": "a\nb" }); r.write("f.txt", "a\nB"); r.git("add", "f.txt");
  await act(r, "f.txt", "unstage", ["-b"]);
  assert.equal(index(r, "f.txt"), "a\nb\nB", "b back before the kept B, which keeps ending the file without a newline");
  r = repo("git-enhanced-lines-eol5-");
  r.commit("one", { "f.txt": "a\nb" }); r.write("f.txt", "a\nB"); r.git("add", "f.txt");
  await act(r, "f.txt", "unstage", ["+B"]);
  assert.equal(index(r, "f.txt"), "a\n");
  // Discard a newline taken away, and one added.
  r = repo("git-enhanced-lines-eol6-");
  r.commit("one", { "f.txt": "a\nb\n" }); r.write("f.txt", "a\nb");
  await act(r, "f.txt", "discard", ["-b", "+b"]);
  assert.equal(r.read("f.txt"), "a\nb\n");
  r.commit("two", { "f.txt": "a\nb" }); r.write("f.txt", "a\nb\n");
  await act(r, "f.txt", "discard", ["-b", "+b"]);
  assert.equal(r.read("f.txt"), "a\nb");
});

test("a new file: lines of an untracked one staged (it is made in the index), unstaged in part and in full; intent-to-add; discard", async () => {
  const r = repo("git-enhanced-lines-new-");
  r.commit("one", { "keep.txt": "k\n" });
  r.write("n.txt", lines("n1", "n2", "n3"));
  const p = await act(r, "n.txt", "stage", ["+n1", "+n3"], { untracked: true });
  assert.match(p.patch, /^diff --git a\/n\.txt b\/n\.txt\nnew file mode 100644\n--- \/dev\/null\n\+\+\+ b\/n\.txt\n@@ -0,0 \+1,2 @@\n\+n1\n\+n3\n$/);
  assert.equal(index(r, "n.txt"), lines("n1", "n3"));
  await act(r, "n.txt", "unstage", ["+n1"]);
  assert.equal(index(r, "n.txt"), lines("n3"), "still in the index with what is left");
  const all = await act(r, "n.txt", "unstage", ["+n3"]);
  assert.equal(all.all, true);
  assert.equal(inIndex(r, "n.txt"), false, "every line unstaged: untracked again");
  assert.equal(r.read("n.txt"), lines("n1", "n2", "n3"));
  // Intent-to-add: git diff shows it as new.
  r.git("add", "-N", "n.txt");
  await act(r, "n.txt", "stage", ["+n2"]);
  assert.equal(index(r, "n.txt"), lines("n2"));
  // Discard lines of an untracked file, then all of them: the file goes.
  r.write("u.txt", lines("u1", "u2", "u3"));
  await act(r, "u.txt", "discard", ["+u2"], { untracked: true });
  assert.equal(r.read("u.txt"), lines("u1", "u3"));
  await act(r, "u.txt", "discard", ["+u1", "+u3"], { untracked: true });
  assert.equal(r.exists("u.txt"), false);
});

test("a deleted file: deletions staged in part (it stays with the rest) and in full; unstaged and discarded in part (it comes back with those lines)", async () => {
  const r = repo("git-enhanced-lines-del-");
  r.commit("one", { "d.txt": lines("d1", "d2", "d3"), "e.txt": lines("e1", "e2") });
  r.remove("d.txt");
  const p = await act(r, "d.txt", "stage", ["-d2"]);
  assert.match(p.patch, /^diff --git a\/d\.txt b\/d\.txt\n--- a\/d\.txt\n\+\+\+ b\/d\.txt\n@@ -1,3 \+1,2 @@\n d1\n-d2\n d3\n$/);
  assert.equal(index(r, "d.txt"), lines("d1", "d3"));
  r.git("reset", "-q");
  await act(r, "d.txt", "stage", ["-d1", "-d2", "-d3"]);
  assert.equal(inIndex(r, "d.txt"), false, "every line staged: the deletion is staged");
  await act(r, "d.txt", "unstage", ["-d2"]);
  assert.equal(index(r, "d.txt"), lines("d2"), "back in the index with that line");
  assert.equal(r.exists("d.txt"), false);
  r.remove("e.txt");
  await act(r, "e.txt", "discard", ["-e1"]);
  assert.equal(r.read("e.txt"), lines("e1"), "the file comes back with the discarded deletion's line");
});

test("a rename: its lines unstaged under the new name, and the rename stays", async () => {
  const r = repo("git-enhanced-lines-rename-");
  const base = Array.from({ length: 12 }, (_, i) => `r${i + 1}`);
  r.commit("one", { "old name.txt": lines(...base) });
  r.git("mv", "old name.txt", "new name.txt");
  const work = [...base]; work[1] = "R2"; work[10] = "R11";
  r.write("new name.txt", lines(...work)); r.git("add", "new name.txt");
  const diff = diffOf(r, ["old name.txt", "new name.txt"], "unstage", { extra: ["-M"] });
  assert.match(diff, /^rename from old name\.txt$/m);
  const p = L.linePatch(diff, pick(diff, "-r11", "+R11"), "unstage");
  assert.match(p.patch, /^diff --git a\/new name\.txt b\/new name\.txt\n--- a\/new name\.txt\t\n\+\+\+ b\/new name\.txt\t\n/);
  await applyPatch(r.h, p.patch, p.flags);
  assert.equal(index(r, "new name.txt"), lines("r1", "R2", ...base.slice(2)));
  assert.equal(inIndex(r, "old name.txt"), false, "the rename stays");
});

test("odd names, CRLF lines, and selections that take nothing", async () => {
  const r = repo("git-enhanced-lines-odd-");
  const names = ["sp ace ä.txt", 'q"uote\\.txt', "-dash.txt"];
  r.commit("one", Object.fromEntries([...names.map((n) => [n, lines("a", "b")]), ["crlf.txt", "a\r\nb\r\n"]]));
  for (const n of names) {
    r.write(n, lines("a", "B"));
    await act(r, n, "stage", ["-b", "+B"]);
    assert.equal(index(r, n), lines("a", "B"), n);
  }
  r.write("crlf.txt", "a\r\nB\r\n");
  await act(r, "crlf.txt", "stage", ["-b\r", "+B\r"]);
  assert.equal(index(r, "crlf.txt"), "a\r\nB\r\n");
  const diff = r.git("diff", ...DIFF, "--", "crlf.txt");
  assert.equal(diff, "", "nothing left unstaged");
  r.write("crlf.txt", "a\r\nC\r\n");
  const d = r.git("diff", ...DIFF, "--", "crlf.txt");
  assert.equal(L.linePatch(d, [0, 1], "stage"), null, "the @@ row and a context row aren't changes");
  assert.equal(L.linePatch(d, [], "stage"), null);
  assert.equal(L.linePatch("diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n", [0], "stage"), null);
  const two = r.git("diff", ...DIFF);
  assert.equal(L.parseDiff(two + two.replace(/crlf\.txt/g, "other.txt")), null, "two files");
  assert.deepEqual(L.changedLines(d), pick(d, "-B\r", "+C\r"));
  assert.deepEqual(L.hunkLines(d, 0), L.changedLines(d));
  assert.deepEqual(L.hunkLines(d, 99), []);
  assert.deepEqual(L.parseDiff(splitDiff(d)).hunks.length, 1, "splitDiff's form too");
});

test("linePlan: through runPlan with the page's applyPatch; discarding is a danger plan", async () => {
  const r = repo("git-enhanced-lines-plan-");
  r.commit("one", { "f.txt": lines("a", "b", "c") });
  r.write("f.txt", lines("a", "B", "c"));
  const diff = r.git("diff", ...DIFF, "--", "f.txt");
  const stage = L.linePlan(diff, pick(diff, "+B", "-b"), "stage", "f.txt");
  assert.deepEqual([stage.danger, stage.confirm, stage.steps[0].why], [false, undefined, "Stage 2 lines of f.txt"]);
  await runPlan(r.h, stage, { apply: (patch, flags) => applyPatch(r.h, patch, flags) });
  assert.equal(index(r, "f.txt"), lines("a", "B", "c"));
  const discard = L.linePlan(diff, pick(diff, "+B"), "discard", "f.txt");
  assert.equal(discard.danger, true);
  assert.equal(discard.confirm, "Discard 1 line of f.txt? The selected changes are taken out of the file; they aren't staged anywhere.");
  assert.equal(L.linePlan(diff, [], "stage").problem, "No changed line is selected");
});
