// A repository inside the shown one (untracked: git lists it as "sub/" with --untracked-files=all):
// its row says "repository" and has no Stage or Revert; a click explains instead of failing to show
// a file, and Show its changes switches the page to it (the trust check still applies, below the
// scan's depth too, and on another machine); its menu stages it as an embedded repository only after
// asking; Stage all and the commit's stage-everything leave it out and say so; the counts don't
// take it for a file.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { state, repo, mount, overlay, drawWith, draw, byId, handler, press, textOf, settle, makeCx, load } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const { runnerOf, stageEverything, commitStaged, addAllArgs } = await load("gitops.js");
const { TRUSTED, NOT_READ, checks } = await load("repotrust.js");
const { KEY } = await load("id.js");

const inner = (dir, files = { "s.txt": "s\n" }, config = []) => {
  mkdirSync(dir, { recursive: true });
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main"); git("config", "user.name", "t"); git("config", "user.email", "t@t"); git("config", "core.hooksPath", "/dev/null");
  for (const [p, s] of Object.entries(files)) writeFileSync(join(dir, p), s);
  git("add", "-A"); git("commit", "-qm", "inner");
  for (const [k, v] of config) git("config", k, v);
  return git;
};
// The parent: one commit, a new file, a repository "inner" (with a change of its own), one with a
// space in its name, and one three folders down (below the scan's depth of 1).
function parent() {
  const r = repo(({ write, git }) => { write("a.txt", "a\n"); git("add", "-A"); git("commit", "-qm", "first"); });
  r.write("new.txt", "fresh\n");
  inner(join(r.dir, "inner")); writeFileSync(join(r.dir, "inner", "s.txt"), "changed\n");
  inner(join(r.dir, "my repo"));
  inner(join(r.dir, "deep", "er", "far"), { "f.txt": "f\n" }); writeFileSync(join(r.dir, "deep", "er", "far", "f.txt"), "far changed\n");
  return r;
}
const gitlinks = (r) => r.git("ls-files", "-s").split("\n").filter((l) => l.startsWith("160000"));
async function answerLast({ cancel = false, pick = null } = {}) {
  await settle();
  const spec = state.overlays.at(-1);
  assert.ok(spec?.props?.question, "a question was asked");
  const { view: q, props } = overlay(spec), tree = drawWith(q, props), saved = state.props;
  state.props = props;
  if (cancel) await q.close(); else handler(byId(tree, pick ? `menu-${pick}` : "question-confirm"), "on_click")({}, makeCx());
  state.props = saved;
  await settle();
  return spec.props.question;
}
const rightClick = (tree, id) => { const cx = makeCx(); handler(byId(tree, id), "on_mouse_down")({}, cx); assert.equal(cx.stopped, true); };

beforeEach(() => { checks.clear(); state.shared.delete(TRUSTED); state.shared.delete(KEY.repo); state.execHook = null; });

test("a repository inside this one: its row says repository, no Stage; a click explains, not 'Cannot show this file'; the counts", async () => {
  const r = parent(), view = await mount(r.dir, { palette: "theme" }), page = view.part;
  const rows = page.sections().find((g) => g.key === "unstaged").rows;
  assert.deepEqual(rows.map((x) => [x.f.path, Boolean(x.f.repo)]), [["deep/er/far/", true], ["inner/", true], ["my repo/", true], ["new.txt", false]]);
  let tree = await draw(view);
  const row = byId(tree, "file-unstaged-inner/");
  assert.ok(row, "the row");
  assert.match(textOf(row), /inner\//, "its name keeps the slash");
  assert.equal(textOf(byId(tree, "repo-label-unstaged-inner/")), "repository");
  assert.match(textOf(byId(tree, "file-unstaged-deep/er/far/")), /deep\/er\/.*far\//);
  for (const p of ["inner/", "my repo/", "deep/er/far/"]) {
    assert.equal(byId(tree, `stage-unstaged-${p}`), null, `no Stage on ${p}`);
    assert.equal(byId(tree, `comment-on-unstaged-${p}`), null, `no comment bubble on ${p}`);
  }
  assert.ok(byId(tree, "stage-unstaged-new.txt"), "a file keeps its Stage");
  // The counts: the files only; the bar names the repositories.
  assert.equal(textOf(byId(tree, "changes-uncommitted")), "Uncommitted · 1 file · 3 repositories");
  assert.ok(textOf(tree).includes("1 file"), "the header's chip");
  assert.ok(!/\b4 files\b/.test(textOf(tree)), "no repository counted as a file");
  // The click: the explanation and Show its changes, no diff, no "Cannot show this file".
  press(row); await settle();
  tree = await draw(view);
  const pane = byId(tree, "nested-repo-view");
  assert.ok(pane, "the explanation instead of a diff");
  assert.match(textOf(pane), /^inner\/ is a git repository of its own inside this one\. Its changes are in that repository\./);
  assert.ok(byId(tree, "nested-repo-show"));
  assert.doesNotMatch(textOf(tree), /Cannot show this file/);
  assert.equal(page.diff.rows.length, 0);
  assert.equal(page.untrackedLines.has("inner/"), false);
  // Its menu: no Revert or Delete; Stage it as an embedded repository…
  rightClick(tree, "file-unstaged-inner/");
  const menu = await answerLast({ cancel: true });
  assert.deepEqual(menu.items.map((i) => [i.id, i.label]), [["stage", "Stage it as an embedded repository…"]]);
  // A file's row is as before.
  press(byId(tree, "file-unstaged-new.txt")); await settle();
  tree = await draw(view);
  assert.equal(byId(tree, "nested-repo-view"), null);
  assert.deepEqual(page.diff.rows.filter((x) => x.kind === "+").map((x) => x.text), ["fresh"]);
  assert.deepEqual(state.violations, []);
});

test("Show its changes switches the page to that repository, below the scan's depth too; the trust check still applies", async () => {
  const r = parent();
  const odd = join(r.dir, "odd");
  inner(odd, { "o.txt": "o\n" }, [["diff.secret.textconv", "cat"]]); writeFileSync(join(odd, "o.txt"), "o2\n");
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  // Three folders down: the scan (depth 1) doesn't find it; it opens all the same. (The first row,
  // open by itself.)
  assert.deepEqual(page.open, { path: "deep/er/far/", section: "unstaged" });
  assert.ok(!page.repoSet.list().includes(join(r.dir, "deep", "er", "far")), "not found by the scan");
  let tree = await draw(view);
  press(byId(tree, "nested-repo-show")); await settle();
  tree = await draw(view);
  assert.equal(page.root, join(r.dir, "deep", "er", "far"));
  assert.deepEqual(page.entries.map((e) => e.path), ["f.txt"]);
  assert.deepEqual(page.diff.rows.filter((x) => x.kind === "+").map((x) => x.text), ["far changed"]);
  assert.ok(byId(tree, "repo-box"), "the switcher, to go back");
  assert.ok(page.repoSet.list().includes(r.dir) && page.repoSet.list().includes(join(r.dir, "deep", "er", "far")));
  // Back to the parent with the switcher; then the one whose config has more than the usual settings.
  page.repoSet.choose(r.dir); page.refresh(makeCx("async")); await settle();
  assert.equal(page.root, r.dir);
  page.pick("odd/", "unstaged", makeCx()); await settle();
  tree = await draw(view);
  const before = state.execLog.length;
  press(byId(tree, "nested-repo-show")); await settle();
  tree = await draw(view);
  assert.equal(page.root, null); assert.equal(page.unread?.root, odd, "not read");
  assert.ok(textOf(byId(tree, "changes-not-read")).includes(NOT_READ));
  assert.deepEqual(state.execLog.slice(before).filter(([c, a, cwd]) => cwd === odd && !(c === "sh" && /config --file/.test(a[1] ?? ""))), [], "nothing read there but the check");
  press(byId(tree, "changes-read-it")); await settle();
  assert.equal(page.root, odd);
  assert.deepEqual(page.entries.map((e) => e.path), ["o.txt"]);
  assert.deepEqual(state.violations, []);
});

test("on another machine: the explanation, and Show its changes switches there (every call with `on`)", async () => {
  const r = parent(), view = await mount(r.dir, { palette: "theme" }, "vps"), page = view.part;
  assert.equal(page.on, "vps");
  page.pick("inner/", "unstaged", makeCx()); await settle();
  let tree = await draw(view);
  assert.match(textOf(byId(tree, "nested-repo-view")), /^inner\/ is a git repository of its own/);
  const mark = state.execLog.length;
  press(byId(tree, "nested-repo-show")); await settle();
  tree = await draw(view);
  assert.equal(page.root, join(r.dir, "inner")); assert.equal(page.on, "vps");
  assert.deepEqual(page.entries.map((e) => e.path), ["s.txt"]);
  const calls = state.execLog.slice(mark).filter(([c]) => c === "git" || c === "sh" || c === "find");
  assert.ok(calls.length > 0 && calls.every(([, , , on]) => on === "vps"), "everything ran on vps");
  assert.deepEqual(state.violations, []);
});

test("the menu's Stage asks in plain words, and only Stage it anyway records a gitlink", async () => {
  const r = parent(), view = await mount(r.dir, { palette: "theme" }), page = view.part;
  let tree = await draw(view);
  rightClick(tree, "file-unstaged-my repo/");
  await answerLast({ pick: "stage" });
  const q = await answerLast({ cancel: true });
  assert.equal(q.title, "Stage my repo/ as an embedded repository?");
  assert.match(q.detail, /records only the commit it is on, not its files/);
  assert.match(q.detail, /clone this repository get an empty folder/);
  assert.match(q.detail, /submodule \(git submodule add/);
  assert.match(q.detail, /\.gitignore/);
  assert.equal(q.confirm, "Stage it anyway");
  assert.deepEqual(gitlinks(r), [], "cancelled: nothing staged");
  tree = await draw(view);
  rightClick(tree, "file-unstaged-my repo/");
  await answerLast({ pick: "stage" });
  await answerLast();
  assert.equal(gitlinks(r).length, 1);
  assert.match(gitlinks(r)[0], /^160000 [0-9a-f]+ 0\tmy repo$/);
  assert.ok(page.entries.some((e) => e.path === "my repo" && e.xy === "A "), "it is staged now");
  assert.deepEqual(state.violations, []);
});

test("Stage all stages the files and leaves the repositories inside out, and says so once", async () => {
  const r = parent(), view = await mount(r.dir, { palette: "theme" }), page = view.part;
  let tree = await draw(view);
  press(byId(tree, "stage-all")); await settle();
  assert.deepEqual(r.git("diff", "--cached", "--name-only").split("\n").filter(Boolean), ["new.txt"]);
  assert.deepEqual(gitlinks(r), []);
  assert.equal(page.line, "Stage all left out 3 repositories inside this one (deep/er/far/, inner/, my repo/): stage one from its right-click menu if you mean to.");
  tree = await draw(view);
  assert.equal(textOf(tree).split(page.line).length, 2, "the line shows once");
  // Every file staged: Unstage all (the repositories inside don't count).
  assert.match(textOf(byId(tree, "stage-all")), /Unstage all/);
  assert.deepEqual(state.violations, []);
});

test("the commit's stage-everything leaves them out too, its question says so, and the line after it", async () => {
  const r = parent(), view = await mount(r.dir, { palette: "theme" }), page = view.part;
  page.input.set_value("Everything");
  let tree = await draw(view);
  press(byId(tree, "commit")); await settle();
  assert.equal(page.askStage, true);
  tree = await draw(view);
  assert.ok(textOf(tree).includes("Nothing is staged. Commit again to stage every change and commit it. The 3 repositories inside this one (deep/er/far/, inner/, my repo/) stay out."));
  press(byId(tree, "commit")); await settle();
  assert.equal(r.git("log", "-1", "--format=%s").trim(), "Everything");
  assert.deepEqual(r.git("show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean), ["new.txt"]);
  assert.deepEqual(r.git("ls-tree", "-r", "HEAD").split("\n").filter((l) => l.startsWith("160000")), [], "no gitlink committed");
  assert.equal(page.line, "Staging every change left out 3 repositories inside this one (deep/er/far/, inner/, my repo/): stage one from its right-click menu if you mean to.");
  // Only repositories left: nothing to commit, said plainly (no failed git commit).
  page.input.set_value("Again");
  tree = await draw(view);
  press(byId(tree, "commit")); await settle();
  assert.match(page.line, /^Nothing to commit: deep\/er\/far\/, inner\/, my repo\/ are repositories inside this one/);
  assert.equal(r.git("log", "-1", "--format=%s").trim(), "Everything");
  assert.deepEqual(state.violations, []);
});

// Herdr's exec, as node does it.
const exec = (cmd, args, { cwd } = {}) => new Promise((resolve) => execFile(cmd, args, { cwd, encoding: "utf8" }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr })));

test("stage-everything's exclusions stay literal: spaces, a leading '-', '*' and '?' in a repository's name", async () => {
  const dir = tempDir("git-enhanced-nested-");
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main"); git("config", "user.name", "t"); git("config", "user.email", "t@t");
  const names = ["my repo", "-lead", "st*r", "q?", "a)b"];
  for (const n of names) inner(join(dir, n));
  // Files a glob would match: "st*r/" must not leave out stXr/, nor "q?/" q1/.
  mkdirSync(join(dir, "stXr")); writeFileSync(join(dir, "stXr", "f"), "x\n");
  mkdirSync(join(dir, "q1")); writeFileSync(join(dir, "q1", "f"), "y\n");
  writeFileSync(join(dir, "-file"), "z\n"); writeFileSync(join(dir, "plain.txt"), "p\n");
  const leaveOut = names.map((n) => `${n}/`).sort();
  assert.deepEqual(addAllArgs([]), ["add", "-A"]);
  assert.deepEqual(addAllArgs(["a b/"]), ["add", "-A", "--", ":/", ":(exclude,literal)a b/"]);
  const h = runnerOf(exec, dir, null);
  await stageEverything(h, leaveOut);
  assert.deepEqual(git("diff", "--cached", "--name-only").split("\n").filter(Boolean).sort(), ["-file", "plain.txt", "q1/f", "stXr/f"]);
  assert.equal(git("ls-files", "-s").split("\n").filter((l) => l.startsWith("160000")).length, 0);
  git("reset", "-q");
  await commitStaged(h, { message: "all but the repositories", stageAll: true, leaveOut });
  assert.deepEqual(git("ls-tree", "-r", "--name-only", "HEAD").split("\n").filter(Boolean).sort(), ["-file", "plain.txt", "q1/f", "stXr/f"]);
});
