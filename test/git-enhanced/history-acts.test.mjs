// The History page's menus: Interactive rebase › (reword, squash, drop, an interactive
// rebase in its editor; a pushed commit only with the tick), a worktree at a commit, Open on GitHub,
// comparing two commits, the labels' menus (branch, remote branch, tag), the uncommitted row
// (Commit, Stash, Discard), the Author and Branch filters and HEAD.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { state, mount, overlay, drawWith, draw, byId, lists, handler, press, texts, walk, settle, makeCx } from "./render/load.mjs";
import { NAME } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";

const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const cfg = (d) => { sh(d, "config", "user.name", "Tess"); sh(d, "config", "user.email", "tess@x"); sh(d, "config", "core.hooksPath", "/dev/null"); };
const commit = (dir, file, text, msg) => { writeFileSync(join(dir, file), text); sh(dir, "add", "-A"); sh(dir, "commit", "-qm", msg); return sh(dir, "rev-parse", "HEAD").trim(); };
const log = (dir) => sh(dir, "log", "--format=%s").trim().split("\n");

function repos() {
  const base = tempDir("git-enhanced-hacts-");
  sh(base, "init", "-q", "--bare", "-b", "main", "remote.git");
  sh(base, "clone", "-q", "remote.git", "a"); const A = join(base, "a"); cfg(A);
  const first = commit(A, "f.txt", "one\n", "First");
  sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  const second = commit(A, "g.txt", "g\n", "Second");
  const third = commit(A, "h.txt", "h\n", "Third");
  return { base, A, first, second, third };
}
const commitsList = (tree) => lists(tree).find((l) => l.listId === "history-commits");
// Right-click a commit, then a row of its menu.
async function menuRow(view, hash, row) {
  handler(commitsList(await draw(view)), "on_item_secondary_click")(hash, {}, makeCx());
  const spec = state.overlays.at(-1);
  assert.ok(spec.props.commitMenu, "the commit menu");
  const m = overlay(spec), tree = drawWith(m.view, m.props);
  const saved = state.props; state.props = m.props;
  assert.ok(byId(tree, `commit-${row}`), `the menu has ${row}: ${texts(tree).join(" | ")}`);
  press(byId(tree, `commit-${row}`));
  state.props = saved;
  await settle();
  return { spec, tree };
}
// The last question asked: change it (`set(part)`), then a menu item, Confirm, or Cancel.
async function answer({ set = () => {}, pick = null, cancel = false, check = [] } = {}) {
  await settle();
  const spec = state.overlays.at(-1);
  assert.ok(spec?.props?.question, "a question was asked");
  const q = overlay(spec);
  set(q.view.part);
  const saved = state.props; state.props = q.props;
  let tree = drawWith(q.view, q.props);
  for (const id of check) { press(byId(tree, `question-check-${id}`)); tree = drawWith(q.view, q.props); }
  if (cancel) await q.view.part.cancel();
  else press(byId(tree, pick ? `menu-${pick}` : "question-confirm"));
  state.props = saved;
  await settle();
  return { q: spec.props.question, tree };
}

test("Interactive rebase ›: reword, squash into parent, drop; a pushed one only with the tick", async () => {
  const { A, first, second, third } = repos();
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  assert.deepEqual(h.commits.map((c) => c.subject), ["Third", "Second", "First"]);
  await menuRow(view, second, "rewrite");
  let { q } = await answer({ pick: "reword" });
  assert.deepEqual(q.items.map((i) => [i.id, i.label, Boolean(i.disabled)]), [["reword", "Reword…", false], ["squash", "Squash into parent…", false], ["drop", "Drop…", false], ["rebase-i", "Interactive rebase from here…", false]]);
  assert.equal(q.title, `Interactive rebase of main from ${second.slice(0, 7)}`);
  ({ q } = await answer({ set: (p) => p.input.set_value("Second, reworded\n\nA body line.") }));
  assert.equal(q.input.multiline, true); assert.equal(q.input.value, "Second");
  assert.deepEqual(log(A), ["Third", "Second, reworded", "First"]);
  assert.equal(sh(A, "log", "-1", "--format=%B", "HEAD~1").trim(), "Second, reworded\n\nA body line.");
  assert.equal(h.line, null, h.line);
  // Squash Third into its parent, with the joined message.
  const third2 = sh(A, "rev-parse", "HEAD").trim();
  await menuRow(view, third2, "rewrite");
  await answer({ pick: "squash" });
  ({ q } = await answer());
  assert.match(q.input.value, /^Second, reworded\n\nA body line\.\n\nThird$/);
  assert.deepEqual(log(A), ["Second, reworded", "First"]);
  assert.equal(sh(A, "show", "HEAD:h.txt"), "h\n");
  // Drop it.
  commit(A, "i.txt", "i\n", "Fourth");
  view.part.history.refresh(makeCx("async")); await settle();
  await menuRow(view, sh(A, "rev-parse", "HEAD~1").trim(), "rewrite");
  await answer({ pick: "drop" });
  ({ q } = await answer());
  assert.equal(q.danger, true); assert.match(q.title, /^Drop /);
  assert.deepEqual(log(A), ["Fourth", "First"]);
  assert.equal(existsSync(join(A, "g.txt")), false);
  // The first commit is pushed: its rows say so, and the question waits for the tick.
  await menuRow(view, first, "rewrite");
  ({ q } = await answer({ pick: "reword" }));
  assert.ok(q.items.every((i) => i.disabled || /pushed/.test(i.detail ?? "")), JSON.stringify(q.items));
  assert.match(q.items.find((i) => i.id === "squash").detail, /no parent/);
  const asked = await answer({ cancel: true, set: (p) => { p.input.set_value("Renamed first"); assert.equal(p.value(), null, "Confirm waits for the tick"); } });
  assert.ok(asked.q.checks.some((c) => c.id === "pushed" && c.required));
  assert.deepEqual(log(A), ["Fourth", "First"], "cancelled: nothing moved");
  await menuRow(view, first, "rewrite");
  await answer({ pick: "reword" });
  await answer({ set: (p) => p.input.set_value("Renamed first"), check: ["pushed"] });
  assert.deepEqual(log(A), ["Fourth", "Renamed first"]);
  void third;
  assert.deepEqual(state.violations, []);
});

test("the interactive rebase's editor: reorder, squash with the joined message, fixup, drop, reword; Start runs it", async () => {
  const { A, first } = repos();
  commit(A, "x.txt", "x\n", "Fourth"); commit(A, "y.txt", "y\n", "Fifth");
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  const second = h.commits.find((c) => c.subject === "Second").hash;
  await menuRow(view, second, "rewrite");
  await answer({ pick: "rebase-i" });
  const spec = state.overlays.at(-1);
  assert.ok(spec.props.rebaseEdit, "the editor");
  assert.deepEqual(spec.props.rebaseEdit.rows.map((r) => r.subject), ["Second", "Third", "Fourth", "Fifth"]);
  const ed = overlay(spec), part = ed.view.part;
  let tree = drawWith(ed.view, ed.props);
  const saved = state.props; state.props = ed.props;
  assert.equal(byId(tree, "rebase-start").calls.some(([c]) => c === "opacity"), true, "nothing changed yet: Start is off");
  // Fifth to the top, Third squashed into Second, Fourth dropped, Fifth reworded.
  for (let i = 0; i < 3; i++) { press(byId(tree, `rebase-up-${3 - i}`)); tree = drawWith(ed.view, ed.props); }
  assert.deepEqual(part.rows.map((r) => r.subject), ["Fifth", "Second", "Third", "Fourth"]);
  press(byId(tree, "rebase-squash-2")); press(byId(tree, "rebase-drop-3")); press(byId(tree, "rebase-reword-0"));
  tree = drawWith(ed.view, ed.props);
  assert.ok(byId(tree, "rebase-message-0") && byId(tree, "rebase-message-2") && !byId(tree, "rebase-message-1"), "boxes where git asks");
  assert.equal(part.boxes.get(part.rows[2].sha).value(), "Second\n\nThird", "the run's messages joined");
  part.boxes.get(part.rows[0].sha).set_value("Fifth, first now");
  part.boxes.get(part.rows[2].sha).set_value("Second and Third");
  // The keys: f on a row makes it a fixup; p puts it back.
  part.at = 3; part.key({ key: "f", modifiers: {} }, makeCx()); assert.equal(part.rows[3].action, "fixup");
  part.key({ key: "d", modifiers: {} }, makeCx()); assert.equal(part.rows[3].action, "drop");
  press(byId(drawWith(ed.view, ed.props), "rebase-start"));
  state.props = saved;
  await settle();
  assert.deepEqual(log(A), ["Second and Third", "Fifth, first now", "First"]);
  assert.equal(existsSync(join(A, "x.txt")), false);
  assert.equal(sh(A, "show", "HEAD:h.txt"), "h\n");
  void first;
  // A squash as the first row kept: the editor says why and Start stays off.
  await menuRow(view, sh(A, "rev-parse", "HEAD~1").trim(), "rewrite");
  await answer({ pick: "rebase-i" });
  const again = overlay(state.overlays.at(-1));
  again.view.part.set(0, "squash", makeCx());
  assert.match(again.view.part.problem(), /can't be squashed/);
  assert.equal(again.view.part.ready(), false);
  await again.view.part.cancel(); await settle();
  assert.deepEqual(log(A), ["Second and Third", "Fifth, first now", "First"]);
  assert.deepEqual(state.violations, []);
});

test("a rebase that stops: the bar says so and Abort brings it back", async () => {
  const base = tempDir("git-enhanced-hacts-stop-");
  sh(base, "init", "-q", "-b", "main", "a"); const A = join(base, "a"); cfg(A);
  commit(A, "f.txt", "1\n", "A"); const b = commit(A, "f.txt", "2\n", "B"); commit(A, "f.txt", "3\n", "C");
  const before = sh(A, "rev-parse", "HEAD").trim();
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  await menuRow(view, b, "rewrite");
  await answer({ pick: "drop" });
  await answer();
  assert.match(h.line ?? "", /^The rebase stopped: .*Abort here\.$/);
  assert.equal(h.op, "rebase");
  const tree = await draw(view);
  assert.ok(texts(tree).includes("A rebase stopped. Resolve the conflicts in Changes, then Continue or Skip there, or abort it here."));
  press(byId(tree, "history-abort")); await settle();
  assert.equal(h.op, null);
  assert.equal(sh(A, "rev-parse", "HEAD").trim(), before);
  assert.deepEqual(state.violations, []);
});

test("a git am that stopped is no rebase: History says git am, and Abort am aborts it", async () => {
  const base = tempDir("git-enhanced-hacts-am-");
  sh(base, "init", "-q", "-b", "main", "a"); const A = join(base, "a"); cfg(A);
  commit(A, "f.txt", "1\n", "A"); commit(A, "f.txt", "2\n", "B");
  const patch = sh(A, "format-patch", "-1", "--stdout");
  sh(A, "reset", "-q", "--hard", "HEAD~1"); commit(A, "f.txt", "other\n", "Other");
  const before = sh(A, "rev-parse", "HEAD").trim();
  writeFileSync(join(base, "p.mbox"), patch);
  try { sh(A, "am", join(base, "p.mbox")); } catch { /* the patch doesn't apply */ }
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  assert.equal(h.op, "am");
  const tree = await draw(view);
  assert.ok(texts(tree).includes("A git am stopped: a patch didn't apply. Resolve it in Changes, then Continue, Skip or Abort there or here."));
  assert.deepEqual(texts(byId(tree, "history-abort")), ["Abort am"]);
  press(byId(tree, "history-abort")); await settle();
  assert.equal(h.op, null, h.line);
  assert.equal(existsSync(join(A, ".git", "rebase-apply")), false);
  assert.equal(sh(A, "rev-parse", "HEAD").trim(), before);
  assert.deepEqual(state.violations, []);
});

test("a worktree at a commit, opened as a space with the agent; Open on GitHub; Compare with the selected commit", async () => {
  const { A, first, third } = repos();
  sh(A, "remote", "set-url", "--push", "origin", join(A, "..", "remote.git"));
  sh(A, "config", "remote.origin.url", "git@github.com:tess/project.git");
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  assert.equal(h.site, "GitHub");
  state.shared.set("herdr-enhanced.agents", { name: "pi", argv: ["pi", "--fast"] });
  await menuRow(view, first, "worktree");
  await answer({ set: (p) => p.input.set_value("bad..name") });
  let { q } = await answer({ set: (p) => p.input.set_value("try/first") });
  assert.match(q.error ?? "", /can't be a branch name/);
  assert.ok(q.checks.some((c) => c.id === "agent" && c.value === true));
  const folder = `${state.home}/.herdr/worktrees/a/try-first`;
  assert.equal(sh(folder, "rev-parse", "HEAD").trim(), first, "checked out at the commit, in the person's (here: the test's) home");
  assert.deepEqual(state.runs.at(-1), ["space.new", { folder, argv: ["pi", "--fast"] }]);
  state.shared.delete("herdr-enhanced.agents");
  // Open on GitHub: the browser here, never really started.
  const opened = [];
  state.execHook = (cmd, args) => (cmd === "open" || cmd === "xdg-open" ? (opened.push([cmd, ...args]), { code: 0, stdout: "", stderr: "" }) : null);
  await menuRow(view, third, "web");
  await settle();
  assert.deepEqual(opened.map((x) => x.at(-1)), [`https://github.com/tess/project/commit/${third}`]);
  state.execHook = null;
  // Compare: First selected, then Third's menu.
  handler(commitsList(await draw(view)), "on_item_click")(first, makeCx()); await settle();
  await menuRow(view, third, "compare-selected");
  await settle();
  assert.equal(h.selected, third); assert.equal(h.comparing, first); assert.equal(h.from, first);
  assert.deepEqual(h.files.map((f) => f.path).sort(), ["g.txt", "h.txt"]);
  const tree = await draw(view);
  assert.ok(texts(byId(tree, "history-info")).some((x) => /Compared with/.test(x)));
  press(byId(tree, "history-compare-off")); await settle();
  assert.equal(h.comparing, null); assert.deepEqual(h.files.map((f) => f.path), ["h.txt"]);
  assert.deepEqual(state.violations, []);
});

test("the labels' menus: a branch (check out, merge, push, upstream, rename, delete), a remote branch (track, fetch, delete twice), a tag (push, delete there too)", async () => {
  const { A, first, second } = repos();
  sh(A, "branch", "side", first); sh(A, "tag", "v1", second);
  sh(A, "push", "-q", "origin", "refs/heads/main:refs/heads/feature/r"); sh(A, "fetch", "-q");
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  h.all = true; h.reload(makeCx("async")); await settle();
  const at = (hash) => h.commits.find((c) => c.hash === hash);
  const refIndex = (hash, name) => at(hash).refs.findIndex((r) => r.name === name);
  // side: its menu from the commit menu's row.
  await menuRow(view, first, `ref-${refIndex(first, "side")}`);
  let { q } = await answer({ pick: "push" });
  assert.deepEqual(q.items.map((i) => i.id), ["checkout", "merge", "rebase", "push", "upstream", "rename", "delete"]);
  assert.equal(q.items.find((i) => i.id === "push").label, "Publish to origin");
  assert.equal(sh(A, "rev-parse", "--abbrev-ref", "side@{u}").trim(), "origin/side", h.line);
  // Set upstream: to origin/main.
  await menuRow(view, first, `ref-${refIndex(first, "side")}`);
  await answer({ pick: "upstream" });
  ({ q } = await answer({ set: (p) => { p.choice = "origin/main"; } }));
  assert.equal(sh(A, "rev-parse", "--abbrev-ref", "side@{u}").trim(), "origin/main");
  // Rename, then delete (merged: no second question).
  await menuRow(view, first, `ref-${refIndex(first, "side")}`);
  await answer({ pick: "rename" });
  await answer({ set: (p) => p.input.set_value("side2") });
  assert.ok(sh(A, "branch", "--list", "side2").trim());
  h.reload(makeCx("async")); await settle();
  await menuRow(view, first, `ref-${refIndex(first, "side2")}`);
  await answer({ pick: "delete" });
  const n = state.overlays.length;
  await answer();
  assert.equal(state.overlays.length, n, "merged: no second question");
  assert.equal(sh(A, "branch", "--list", "side2").trim(), "");
  // The tag: push, then delete here and there.
  h.reload(makeCx("async")); await settle();
  await menuRow(view, second, `ref-${refIndex(second, "v1")}`);
  ({ q } = await answer({ pick: "push-tag" }));
  assert.deepEqual(q.items.slice(0, 2).map((i) => i.label), ["A lightweight tag", "Push to origin"]);
  assert.match(sh(join(A, "..", "remote.git"), "tag"), /v1/);
  await menuRow(view, second, `ref-${refIndex(second, "v1")}`);
  await answer({ pick: "delete-tag" });
  await answer({ check: ["remote"] });
  assert.equal(sh(A, "tag").trim(), ""); assert.equal(sh(join(A, "..", "remote.git"), "tag").trim(), "");
  // The remote branch origin/feature/r: delete asks twice; then it is gone there.
  h.reload(makeCx("async")); await settle();
  const fr = h.commits.find((c) => c.refs.some((r) => r.name === "origin/feature/r"));
  await menuRow(view, fr.hash, `ref-${fr.refs.findIndex((r) => r.name === "origin/feature/r")}`);
  ({ q } = await answer({ pick: "delete-remote" }));
  assert.deepEqual(q.items.map((i) => i.id), ["track", "fetch", "delete-remote"]);
  ({ q } = await answer());
  assert.match(q.title, /^Delete feature\/r on origin\?$/);
  ({ q } = await answer());
  assert.match(q.title, /^Really delete origin\/feature\/r\?$/);
  assert.equal(sh(join(A, "..", "remote.git"), "branch", "--list", "feature/r").trim(), "");
  // A label of the selected commit has the same menu on a click.
  handler(commitsList(await draw(view)), "on_item_click")(first, makeCx()); await settle();
  const k = h.details.refs.findIndex((r) => r.kind === "remote");
  if (k >= 0) {
    press(byId(await draw(view), `history-ref-${k}`)); await settle();
    ({ q } = await answer({ cancel: true }));
    assert.match(q.title, /^Remote branch /);
  }
  assert.deepEqual(state.violations, []);
});

test("the uncommitted row: listed at the top, its files and diffs, Commit (everything when nothing is staged), Stash, Discard (a copy kept)", async () => {
  const { A } = repos();
  writeFileSync(join(A, "f.txt"), "one\nmore\n"); writeFileSync(join(A, "new.txt"), "new\n");
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  assert.deepEqual([h.dirty.count, h.dirty.staged], [2, 0]);
  let tree = await draw(view);
  const list = commitsList(tree);
  assert.equal(list.count, h.commits.length + 1);
  assert.equal(list.getKey(0), "uncommitted");
  handler(list, "on_item_click")("uncommitted", makeCx()); await settle();
  assert.deepEqual(h.files.map((f) => [f.status, f.path]), [["M", "f.txt"], ["?", "new.txt"]]);
  assert.ok(view.part.diff.rows.some((r) => r.kind === "+" && r.text === "more"));
  h.pickFile("new.txt", makeCx()); await settle();
  assert.ok(view.part.diff.rows.some((r) => r.kind === "+" && r.text === "new"), "a new file: all of it added");
  // Right-click: Commit…, everything.
  handler(commitsList(await draw(view)), "on_item_secondary_click")("uncommitted", {}, makeCx());
  let { q } = await answer({ pick: "commit" });
  assert.match(q.items[0].detail, /everything/);
  ({ q } = await answer({ set: (p) => p.input.set_value("All of it") }));
  assert.match(q.detail, /git add -A/);
  assert.equal(log(A)[0], "All of it"); assert.equal(sh(A, "status", "--porcelain"), "");
  assert.equal(h.dirty.count, 0);
  assert.equal(commitsList(await draw(view)).getKey(0), h.commits[0].hash, "no row when clean");
  // Stash… (its button), then Discard all… (a copy kept).
  writeFileSync(join(A, "f.txt"), "stash me\n");
  h.refresh(makeCx("async")); await settle();
  handler(commitsList(await draw(view)), "on_item_click")("uncommitted", makeCx()); await settle();
  press(byId(await draw(view), "history-uncommitted-stash"));
  await answer({ set: (p) => p.input.set_value("parked") });
  assert.match(sh(A, "stash", "list"), /parked/);
  writeFileSync(join(A, "f.txt"), "throw away\n");
  h.refresh(makeCx("async")); await settle();
  handler(commitsList(await draw(view)), "on_item_secondary_click")("uncommitted", {}, makeCx());
  await answer({ pick: "discard" });
  ({ q } = await answer());
  assert.match(q.detail, /A copy is kept/);
  assert.equal(readFileSync(join(A, "f.txt"), "utf8"), "one\nmore\n", "back to HEAD");
  assert.ok(sh(A, "for-each-ref", `refs/${NAME}/discarded/`).trim(), "the copy");
  assert.deepEqual(state.violations, []);
});

test("Author ▾ and Branch ▾ write the search; HEAD selects HEAD's commit, the search cleared when it hides it", async () => {
  const { A, first } = repos();
  sh(A, "switch", "-qc", "lonely", first); execFileSync("git", ["-c", "user.name=Ann", "-c", "user.email=ann@x", "commit", "-q", "--allow-empty", "-m", "By Ann"], { cwd: A });
  sh(A, "switch", "-q", "main");
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  assert.deepEqual(h.branchNames.sort(), ["lonely", "main"]);
  let tree = await draw(view);
  handler(walkFind(tree, "history-branches"), "on_open_change")(true, makeCx());
  tree = await draw(view);
  press(byId(tree, `history-branch-${h.branchNames.indexOf("lonely")}`)); await settle();
  assert.equal(h.search.value(), "branch:lonely");
  assert.deepEqual(h.commits.map((c) => c.subject), ["By Ann", "First"]);
  assert.ok(h.graph, "one branch still draws lanes");
  handler(walkFind(await draw(view), "history-authors"), "on_open_change")(true, makeCx());
  tree = await draw(view);
  const ann = texts(tree).includes("Ann");
  assert.ok(ann);
  press(byId(tree, "history-author-0")); await settle();
  assert.match(h.search.value(), /^author:(Ann|Tess) branch:lonely$/);
  h.setFilter("author", "Ann", makeCx()); await settle();
  assert.equal(h.search.value(), "author:Ann branch:lonely");
  assert.deepEqual(h.commits.map((c) => c.subject), ["By Ann"]);
  // HEAD: hidden by the search, so the search goes, then it is selected.
  press(byId(await draw(view), "history-head")); await settle();
  await draw(view); await settle();
  assert.equal(h.search.value(), "");
  assert.equal(h.selected, sh(A, "rev-parse", "HEAD").trim());
  assert.deepEqual(state.violations, []);
});

function walkFind(tree, popover) { let hit = null; walk(tree, (n) => { if (n.popover === popover) hit ??= n; }); return hit; }

test("the commit menu at its tallest (three labels, a selected commit, a web site) still fits under 640 px", async () => {
  const { load } = await import("./render/load.mjs");
  const { menuItems, menuHeight } = await load("commitmenu.js");
  const refs = [{ kind: "branch", name: "a" }, { kind: "remote", name: "origin/a" }, { kind: "tag", name: "v1" }, { kind: "tag", name: "v2" }, { kind: "head", name: "HEAD" }];
  const c = { sha: "1".repeat(40), head: "2".repeat(40), branch: "main", refs, selected: "3".repeat(40), site: "GitHub" };
  const items = menuItems(c);
  assert.equal(items.filter((i) => /^ref-/.test(i.id ?? "")).length, 3, "three labels at most");
  assert.ok(menuHeight(items) <= 640, String(menuHeight(items)));
  assert.ok(items.some((i) => i.id === "compare-selected") && items.some((i) => i.id === "web" && i.label === "Open on GitHub"));
  assert.ok(!menuItems({ ...c, selected: c.sha, site: null }).some((i) => i.id === "compare-selected" || i.id === "web"), "not itself, no site: no rows");
});

test("History: an action asked for while another runs says Busy instead of nothing", async () => {
  const base = tempDir("git-enhanced-hacts-busy-");
  sh(base, "init", "-q", "-b", "main", "a"); const A = join(base, "a"); cfg(A);
  commit(A, "f.txt", "1\n", "A");
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  h.busy = "fetch";
  h.moreMenu(makeCx());
  assert.equal(h.line, "Busy (Fetch): try again once it's done");
  h.act("tag", async () => { throw new Error("must not run"); }, makeCx());
  assert.equal(h.line, "Busy (Fetch): try again once it's done");
  h.busy = null;
  assert.deepEqual(state.violations, []);
});
