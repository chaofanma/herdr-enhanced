// The git operations' pages, dialogs, menus and states (conflicts, Pull ▾ and the menu beside Push,
// line staging, the stashes' and branches' extras, patches, Blame, History's ⋯ with Worktrees…,
// Remotes…, Reflog… and bisect, several commits selected, Tag… and Copy ›), drawn in each of the six
// themes Herdr 0.1.14 ships (test/shared/themes.json), read by test/shared/themecheck.mjs: only the
// theme's colors, and text that reads on what it is drawn on. Each state is set up once, on real git;
// each theme draws them all. themes.test.mjs draws the pages they sit in.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { state, stubs, repo, mount, overlay, drawWith, renderNow, renderRows, byId, lists, handler, press, settle, makeCx, load } from "./render/load.mjs";
import { MOD } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
import { THEMES, themeTests, setSources } from "../shared/themecheck.mjs";

const { checkInstalled } = await load("installed.js");
setSources(MOD);

// What each theme draws: { name, draw: () => tree }, with the props its copy was mounted with; a
// state can be one view drawn with some fields set (`fields`: [object, { field: value }]), put back
// after.
const scenes = [];
const where = () => ({ spaces: state.spaces, panes: state.panes, focused: state.focused });
function scene(name, v, { props = state.props, fields = [] } = {}) {
  const at = where();
  scenes.push({ name, draw: () => {
    Object.assign(state, at);
    const undo = [];
    const put = (get, set, value) => { undo.push([set, get()]); set(value); };
    put(() => state.props, (x) => { state.props = x; }, props);
    for (const [o, f] of fields) for (const [k, val] of Object.entries(f)) put(() => o[k], (x) => { o[k] = x; }, val);
    try { return renderNow(v); } finally { for (const [set, was] of undo.reverse()) set(was); }
  } });
}
// The question or menu opened last, as Herdr opens it (a copy with its props), drawn with them; the
// flow that asked stays waiting.
let last = null;
async function pop(name) {
  await settle();
  const spec = state.overlays.at(-1);
  assert.ok(spec?.props && spec !== last, `${name}: an overlay opened`);
  last = spec;
  const o = overlay(spec); await settle();
  scenes.push({ name, draw: () => drawWith(o.view, o.props) });
  return spec.props.question ?? spec.props;
}
// Answers the question or menu opened last: a menu's item, an entry's button, a commit menu's row
// (`commit`), or Confirm (after `set(part)`); the flow goes on.
async function pick({ item = null, entry = null, commit = null, set = () => {} } = {}) {
  await settle();
  const spec = state.overlays.at(-1), { view: q, props } = overlay(spec), saved = state.props;
  last = spec;
  set(q.part);
  const tree = drawWith(q, props);
  state.props = props;
  const id = commit ? `commit-${commit}` : item ? `menu-${item}` : entry !== null ? `question-entry-button-${entry}` : "question-confirm";
  assert.ok(byId(tree, id), `${id} in the overlay`);
  handler(byId(tree, id), "on_click")({}, makeCx());
  state.props = saved;
  await settle();
}

const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const cfg = (d) => { sh(d, "config", "user.name", "Tess"); sh(d, "config", "user.email", "tess@x"); sh(d, "config", "core.hooksPath", "/dev/null"); };
const commit = (d, file, text, msg) => { writeFileSync(join(d, file), text); sh(d, "add", "-A"); sh(d, "commit", "-qm", msg); };
const theme = { palette: "theme" };

// A merge stopped on two files (f.txt changed on both sides, g.txt deleted on main); `style`:
// merge.conflictStyle (diff3 writes the base too).
function mergeStopped(style = null) {
  const r = repo(({ write, git }) => {
    if (style) git("config", "merge.conflictStyle", style);
    write("f.txt", "a\nb\nc\n"); write("g.txt", "g\n"); git("add", "-A"); git("commit", "-qm", "init");
    git("switch", "-q", "-c", "side"); write("f.txt", "a\nside\nc\n"); write("g.txt", "g side\n"); git("commit", "-qam", "side");
    git("switch", "-q", "main"); write("f.txt", "a\nmain\nc\n"); git("rm", "-q", "g.txt"); git("commit", "-qam", "main");
  });
  try { r.git("merge", "side"); } catch { /* stops on conflicts */ }
  return r;
}
// A clone of a bare remote with its own commit and one it hasn't pulled (diverged), a branch that
// tracks a remote branch and is behind it, one whose upstream is gone, an annotated tag, two stashes.
function remoteRepos() {
  const base = tempDir("git-enhanced-themes-git-");
  sh(base, "init", "-q", "--bare", "-b", "main", "remote.git");
  sh(base, "clone", "-q", "remote.git", "a"); const A = join(base, "a"); cfg(A);
  commit(A, "f.txt", "one\n", "First"); sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  sh(A, "switch", "-qc", "feature"); commit(A, "x.txt", "x\n", "Feature"); sh(A, "push", "-q", "-u", "origin", "feature");
  sh(A, "switch", "-qc", "old"); sh(A, "push", "-q", "-u", "origin", "old"); sh(A, "push", "-q", "origin", "--delete", "old");
  sh(A, "switch", "-q", "main");
  sh(base, "clone", "-q", "remote.git", "b"); const B = join(base, "b"); cfg(B);
  commit(B, "g.txt", "from b\n", "Remote work"); sh(B, "push", "-q");
  sh(B, "switch", "-q", "feature"); commit(B, "y.txt", "y\n", "More feature"); sh(B, "push", "-q");
  sh(A, "fetch", "-q", "--prune");
  commit(A, "f.txt", "one\ntwo\n", "Local two"); sh(A, "tag", "-a", "v2", "-m", "Version two");
  writeFileSync(join(A, "s.txt"), "s1\n"); sh(A, "add", "s.txt"); sh(A, "stash", "push", "-q", "-m", "first stash");
  writeFileSync(join(A, "s.txt"), "s2\n"); sh(A, "add", "s.txt"); sh(A, "stash", "push", "-q", "-m", "second stash");
  writeFileSync(join(A, "f.txt"), "one\ntwo\nthree\n");
  return { base, A, B };
}

before(async () => {
  state.palette = THEMES[0].colors;
  state.shared.clear();
  mkdirSync(join(stubs.appHome(), "mods", "files-enhanced"), { recursive: true }); writeFileSync(join(stubs.appHome(), "mods", "files-enhanced", "main.js"), "// the other mod\n");
  await checkInstalled();

  // ---- Conflicts: the bar, a conflicted file's menu, the conflict view and its states.
  {
    const r = mergeStopped();
    for (const width of [368, 1300]) {
      const v = await mount(r.dir, theme), p = v.part;
      p.size = { width, height: 900 };
      if (p.open?.path !== "f.txt") { p.pick("f.txt", "unstaged", makeCx()); await settle(); }
      await settle();
      const label = width < 600 ? "narrow" : "wide";
      scene(`Conflicts (${label}): the bar and f.txt's conflict view`, v);
      scene(`Conflicts (${label}): a block chosen`, v, { fields: [[p.conflictView, { choices: ["theirs"] }]] });
      if (width > 600) {
        scene("Conflicts: the view reading", v, { fields: [[p, { conflictView: { path: "f.txt" } }]] });
        scene("Conflicts: a file the view can't read", v, { fields: [[p, { conflictView: { path: "f.txt", error: "Can't read this file (binary, too large, or unreadable): take a whole side from its menu" } }]] });
        scene("Conflicts: busy", v, { fields: [[p, { busy: "resolve" }]] });
        scene("Conflicts: on a machine that can't take the file back", v, { fields: [[p, { caps: { put: false }, on: "vps" }]] });
        const section = p.sections().find((g) => g.rows.some((x) => x.f.path === "g.txt"))?.key;
        p.fileMenu("g.txt", section, makeCx()); await pop("Conflicts: a conflicted file's menu");
        press(byId(renderNow(v), "operation-abort")); await pop("Conflicts: Abort the merge?");
      }
    }
    const b = mergeStopped("diff3"), v = await mount(b.dir, theme);
    v.part.size = { width: 1300, height: 900 };
    scene("Conflicts: a block with its base", v);
  }
  {
    // A rebase stopped at commit 1 of 2: Skip…; Continue's question about the markers left, Skip's.
    const r = repo(({ write, git }) => {
      write("f.txt", "a\n"); git("add", "-A"); git("commit", "-qm", "init");
      git("switch", "-q", "-c", "topic"); write("f.txt", "topic\n"); git("commit", "-qam", "t1"); write("t.txt", "t\n"); git("add", "-A"); git("commit", "-qm", "t2");
      git("switch", "-q", "main"); write("f.txt", "main\n"); git("commit", "-qam", "m"); git("switch", "-q", "topic");
    });
    try { r.git("rebase", "main"); } catch { /* stops */ }
    const v = await mount(r.dir, theme), p = v.part;
    p.size = { width: 1300, height: 900 };
    scene("Conflicts: a rebase stopped (Skip…)", v);
    r.git("add", "f.txt");
    p.refresh(makeCx("async"), true); await settle();
    press(byId(renderNow(v), "conflict-continue")); await pop("Conflicts: Continue with markers left?");
    press(byId(renderNow(v), "conflict-skip")); await pop("Conflicts: Skip it?");
  }
  {
    // A git am whose patch didn't apply (no conflicts, nothing staged).
    const r = repo(({ write, git }) => { write("f.txt", "a\n"); git("add", "-A"); git("commit", "-qm", "init"); });
    const v = await mount(r.dir, theme), p = v.part;
    p.size = { width: 1300, height: 900 };
    scene("Conflicts: a git am whose patch didn't apply", v, { fields: [[p, { operation: "am", stopped: { op: "am", step: { done: 1, total: 2 } } }]] });
  }

  // ---- Pull ▾, the menu beside Push, the branches, the stashes, ⋯ by Commit.
  const { base, A } = remoteRepos();
  {
    const v = await mount(A, theme), p = v.part;
    p.size = { width: 1300, height: 900 };
    scene("Changes: diverged, Pull ↓1 ▾ and ▾ by Push", v);
    scene("Changes: ▾ by Push while a git action runs", v, { fields: [[p, { busy: "fetch" }]] });
    p.pull(makeCx()); await pop("Changes: Pull ▾");
    p.pushMenu(makeCx()); await pop("Changes: ▾ by Push");
    await pick({ item: "sync" }); await pop("Changes: Sync?");
    p.pushMenu(makeCx()); await pick({ item: "force" }); await pop("Changes: Force push?");
    // The branch picker: ↑ ↓ and gone, Back to the previous branch, Clean up branches….
    p.openBranches(true, makeCx()); await settle(); p.openBranches(false, makeCx());
    scene("Changes: the branch picker, upstreams", v, { fields: [[p, { choosingBranch: true }]] });
    p.openBranches(true, makeCx()); await settle();
    p.branchMenu(p.branches.find((x) => x.name === "feature"), makeCx()); await pop("Changes: a branch's menu, behind its upstream");
    await pick({ item: "merge-with" }); await pop("Changes: Merge into ▸");
    p.openBranches(true, makeCx()); await settle();
    p.branchMenu(p.branches.find((x) => x.name === "feature"), makeCx()); await pick({ item: "rebase-with" }); await pop("Changes: Rebase onto it ▸");
    p.cleanupBranches(makeCx()); await pop("Changes: Clean up branches");
    // The stashes: ⋯ per stash, Drop all 2…, idle and busy; a stash's ⋯; Drop all?
    scene("Changes: the stashes, ⋯ and Drop all", v, { fields: [[p, { choosingStash: true }]] });
    scene("Changes: the stashes while a git action runs", v, { fields: [[p, { choosingStash: true, busy: "apply" }]] });
    p.stashMore(p.stashes[0], makeCx()); await pop("Changes: a stash's ⋯");
    p.stashClear(makeCx()); await pop("Changes: Drop all the stashes?");
    // ⋯ by Commit: Move my unpushed commits…, Copy changes as patch ▸, Apply a patch….
    p.moreMenu(makeCx()); await pop("Changes: ⋯ by Commit");
    await pick({ item: "move-commits" }); await pop("Changes: Move my unpushed commits");
    p.moreMenu(makeCx()); await pick({ item: "copy-patch" }); await pop("Changes: Copy changes as patch");
    p.moreMenu(makeCx()); await pick({ item: "apply-patch" }); await pop("Changes: Apply a patch");
  }

  // ---- Lines: the comment box's rows, Stage lines / Discard…, Unstage lines, waiting, refused.
  {
    const r = repo(({ write, git }) => { write("f.txt", "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n"); git("add", "-A"); git("commit", "-qm", "init"); write("f.txt", "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nK\n"); });
    for (const width of [368, 1300]) {
      const v = await mount(r.dir, theme), p = v.part;
      p.size = { width, height: 900 };
      handler(byId(renderNow(v), "changes-diff-rows"), "on_size_change")({ width: width - 2, height: 500 }, makeCx()); await settle();
      const plusB = p.diff.rows.findIndex((x) => x.kind === "+" && x.text === "B");
      p.clickRow(plusB - 2, makeCx()); p.clickRow(plusB, makeCx());
      const label = width < 600 ? "narrow" : "wide";
      scene(`Lines (${label}): Stage lines and Discard…`, v);
      scene(`Lines (${label}): waiting for a git action`, v, { fields: [[p, { busy: "commit" }]] });
      if (width > 600) {
        scene("Lines: rows read again since", v, { fields: [[p.composer, { rows: ["x"] }]] });
        scene("Lines: another machine without base64", v, { fields: [[p, { caps: { put: false }, on: "vps" }]] });
        press(byId(renderNow(v), "lines-discard")); await pop("Lines: Discard 2 lines?");
      }
    }
  }

  // ---- Blame: a diff line's Blame line N, its menu.
  {
    const r = repo(({ write, git }) => {
      write("f.txt", "a\nb\nc\n"); git("add", "-A"); git("commit", "-qm", "First");
      write("f.txt", "a\nB\nc\n"); git("commit", "-qam", "Second");
      write("f.txt", "a\nB\nc\nd\n");
    });
    const v = await mount(r.dir, theme), p = v.part;
    const i = p.diff.rows.findIndex((x) => x.kind === " " && x.text === "B");
    p.rowMenu(p.diff.items.find((it) => it.rows.includes(i)).key, makeCx());
    await pick({ item: "blame" }); await pop("Blame: the line's commit");
  }

  // ---- History: ⋯, Worktrees…, Remotes…, Reflog…, bisect, several commits, Tag…, Copy ›.
  {
    // Three worktrees at origin/main: one with an ignored file, one whose folder is gone.
    for (let i = 0; i < 3; i++) sh(A, "worktree", "add", "-q", "-b", `w${i}`, join(base, `wt-${i}`), "origin/main");
    writeFileSync(join(base, "wt-0", ".gitignore"), "local.cfg\n"); writeFileSync(join(base, "wt-0", "local.cfg"), "x\n");
    rmSync(join(base, "wt-2"), { recursive: true, force: true });
    const v = await mount(A, { palette: "theme", view: "history" }), h = v.part.history;
    const more = async (item) => { press(byId(renderNow(v), "history-more")); if (item) await pick({ item }); };
    await more(null); await pop("History: ⋯");
    await more("worktrees"); await pop("History: Worktrees…");
    await pick({ item: "wt-1" }); await pop("History: a worktree's menu");
    await pick({ item: "remove" }); await pop("History: Remove the worktree?");
    await more("worktrees"); await pick({ item: "cleanup" }); await pop("History: Clean up merged worktrees");
    await more("remotes"); await pop("History: Remotes…");
    await pick({ item: "r-0" }); await pop("History: a remote's menu");
    await more("reflog"); await pop("History: Reflog…");
    await pick({ entry: 1 }); await pop("History: a reflog entry's menu");
    // Several commits selected: two rows marked, their menu.
    const [c0, c1] = h.commits;
    h.downMods = {}; h.clickRow(c0.hash, makeCx()); await settle();
    h.downMods = { platform: true }; h.clickRow(c1.hash, makeCx()); await settle();
    scene("History: two commits selected", v);
    h.menu(c1.hash, makeCx()); await pop("History: the selection's menu");
    // One commit: its menu's Tag… and Copy ›.
    h.downMods = {}; h.clickRow(c0.hash, makeCx()); await settle();
    handler(lists(renderNow(v)).find((l) => l.listId === "history-commits"), "on_item_secondary_click")(c0.hash, {}, makeCx()); await settle();
    await pick({ commit: "tag" }); await pop("History: Tag…");
    handler(lists(renderNow(v)).find((l) => l.listId === "history-commits"), "on_item_secondary_click")(c0.hash, {}, makeCx()); await settle();
    await pick({ commit: "copy" }); await pop("History: Copy ›");
    const tag = h.commits.flatMap((c) => c.refs).find((x) => x.kind === "tag");
    h.refMenu(tag, makeCx()); await pop("History: a tag's menu");
    scene("History: a stopped git am", v, { fields: [[h, { op: "am" }]] });
    scene("History: a stopped merge", v, { fields: [[h, { op: "merge" }]] });
  }
  {
    // Bisect: the start question, the bar while testing, busy, and once git names the commit.
    const r = repo(({ write, git }) => { for (let i = 1; i <= 8; i++) { write("n.txt", `${i <= 5 ? "ok" : "broken"} ${i}\n`); git("add", "-A"); git("commit", "-qm", `C${i}`); if (i === 1) git("tag", "v1"); } });
    const v = await mount(r.dir, { palette: "theme", view: "history" }), h = v.part.history;
    const bad = r.git("rev-parse", "HEAD").trim();
    h.downMods = {}; h.clickRow(bad, makeCx()); await settle();
    press(byId(renderNow(v), "history-more")); await pick({ item: "bisect" }); await pop("Bisect: a good commit?");
    await pick(); await pick();
    await settle();
    scene("Bisect: testing", v);
    scene("Bisect: testing, busy", v, { fields: [[h, { busy: "bisect" }]] });
    scene("Bisect: the first bad commit", v, { fields: [[h, { bisect: { ...h.bisect, first: bad } }]] });
  }
});

themeTests({ test, assert, scenes: () => scenes, state, stubs, min: 40, rows: (l) => renderRows(l, { start: 0, end: Math.min(l.count, 80) }) });
