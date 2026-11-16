// Every page and state of Git Enhanced the other tests reach, drawn in each of the six themes
// Herdr 0.1.14 ships (test/shared/themes.json: the stubs' theme() is that palette, settings().dark
// its appearance), read by test/shared/themecheck.mjs: only the theme's colors, and text that reads
// on what it is drawn on. Each state is a copy of its own, set up once; each theme draws them all.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { state, stubs, repo, mount, overlay, drawWith, renderNow, renderRows, byId, lists, handler, press, walk, settle, makeCx, load } from "./render/load.mjs";
import { NAME, MOD } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
import { THEMES, themeTests, setSources } from "../shared/themecheck.mjs";

const { KEY } = await load("id.js");
const { PALETTES } = await load("colors.js");
const { questions } = await load("question.js");
const { TRUSTED, checks } = await load("repotrust.js");
const { checkInstalled } = await load("installed.js");
setSources(MOD);
// The diff's fixed palettes: drawn where a block's props don't ask for the theme's colors.
const FIXED = Object.values(PALETTES).flatMap((p) => Object.values(p));

// What each theme draws: { name, draw: () => tree, allow }, with the props its copy was mounted with.
// A state can be one view drawn with other props, shared values or fields (`props`, `shared`,
// `fields`: [object, { field: value }]), put back after: mounting a copy takes its git reads and
// scripts.
const scenes = [];
// A page follows the focused terminal: each state is drawn where it was set up.
const where = () => ({ spaces: state.spaces, panes: state.panes, focused: state.focused });
function scene(name, v, { allow = [], shared = {}, props = state.props, fields = [] } = {}) {
  const at = where();
  scenes.push({ name, allow, draw: () => {
    Object.assign(state, at);
    const undo = [];
    const put = (get, set, value) => { undo.push([set, get()]); set(value); };
    if (props) put(() => state.props, (x) => { state.props = x; }, props);
    for (const [k, val] of Object.entries(shared)) put(() => state.shared.get(k), (x) => (x === undefined ? state.shared.delete(k) : state.shared.set(k, x)), val);
    for (const [o, f] of fields) for (const [k, val] of Object.entries(f)) put(() => o[k], (x) => { o[k] = x; }, val);
    try { return renderNow(v); } finally { for (const [set, was] of undo.reverse()) set(was); }
  } });
}
// An overlay as Herdr opens it (a copy with its props), drawn with them.
async function pop(name, spec, set = () => {}) {
  const o = overlay(spec); await settle(); set(o.view.part);
  scenes.push({ name, draw: () => drawWith(o.view, o.props), allow: [] });
}
const lastOverlay = () => state.overlays.at(-1);
const png = (w, h, tail = "") => Buffer.from([0x89, ...Buffer.from("PNG\r\n\x1a\n"), 0, 0, 0, 13, ...Buffer.from("IHDR"), 0, 0, 0, w, 0, 0, 0, h, ...Buffer.from(tail)]);
const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// A repository with a staged file, an unstaged one, an untracked one, an image, a stash, a branch.
function work() {
  const r = repo(({ write, git }) => {
    write("a.js", "const a = 1;\nconst b = 2;\n\tconst c = 3;\n"); write("b.txt", "b\n"); git("add", "-A"); git("commit", "-qm", "one");
    write("a.js", "const a = 10;\nconst b = 2;\n\tconst c = 33;\nconst d = 4;\n"); git("add", "-A"); git("commit", "-qm", "two");
  });
  writeFileSync(join(r.dir, "logo.png"), png(4, 3, "one")); r.git("add", "-A"); r.git("commit", "-qm", "logo");
  r.write("z.txt", "untracked\n"); r.git("stash", "push", "-q", "--include-untracked", "-m", "a stash");
  r.write("a.js", "const a = 12; // \"text\" 42\nconst b = 2;\n\tconst c = 33;\nconst d = 4;\nfunction f() { return true; }\n");
  r.write("b.txt", "b staged\n"); r.git("add", "b.txt");
  r.write("new.txt", "new\n");
  writeFileSync(join(r.dir, "logo.png"), png(40, 30, "two, bigger"));
  r.git("branch", "other");
  return r;
}
// History's repositories: a merge, a tag, a branch, ahead and behind its upstream.
function historyRepos() {
  const base = tempDir("git-enhanced-themes-");
  const cfg = (d) => { sh(d, "config", "user.name", "Tess"); sh(d, "config", "user.email", "tess@x"); sh(d, "config", "core.hooksPath", "/dev/null"); };
  const commit = (dir, file, text, msg) => { writeFileSync(join(dir, file), text); sh(dir, "add", "-A"); sh(dir, "commit", "-qm", msg); return sh(dir, "rev-parse", "HEAD").trim(); };
  sh(base, "init", "-q", "--bare", "-b", "main", "remote.git");
  sh(base, "clone", "-q", "remote.git", "a"); const A = join(base, "a"); cfg(A);
  commit(A, "f.txt", "one\n", "First");
  sh(A, "push", "-q", "-u", "origin", "HEAD:main"); sh(A, "tag", "v1");
  sh(A, "switch", "-qc", "side"); commit(A, "s.txt", "side\n", "Side work"); sh(A, "switch", "-q", "main");
  commit(A, "f.txt", "one\ntwo\n", "Fix the bug");
  sh(A, "merge", "-q", "--no-ff", "--no-edit", "side");
  sh(base, "clone", "-q", "remote.git", "b"); const B = join(base, "b"); cfg(B);
  commit(B, "g.txt", "from b\n", "Remote work"); sh(B, "push", "-q");
  sh(A, "fetch", "-q");
  commit(A, "f.txt", "one\ntwo\nthree\n", "Local three");
  writeFileSync(join(A, "f.txt"), "one\ntwo\nthree\nfour\n");
  return { base, A };
}

// A Changes page with a.js's unstaged diff open, `width` wide.
async function page(dir, props, width = 368) {
  const v = await mount(dir, props), p = v.part.pages?.changes ?? v.part;
  p.size = { width, height: 900 };
  if (p.open?.path !== "a.js" || p.open?.section !== "unstaged") { p.pick("a.js", "unstaged", makeCx()); await settle(); }
  handler(byId(renderNow(v), "changes-diff-rows"), "on_size_change")({ width: width - 2, height: 500 }, makeCx());
  await settle();
  return { v, p };
}

before(async () => {
  // Set up in the first theme: what a state keeps of its colors must follow a switch to another.
  state.palette = THEMES[0].colors;
  const r = work();
  const theme = { palette: "theme" };
  // The page, narrow and wide, in each palette, unified and split; its pickers open (the scope's
  // commits, the stashes, the branches, the diff's options); a stopped merge and a line.
  const narrow = await page(r.dir, theme, 368), wide = await page(r.dir, theme, 1300);
  for (const [label, props] of [["One Dark Pro", {}], ["Dark+", { palette: "dark-plus" }], ["theme colors", theme]]) {
    const allow = props.palette === "theme" ? [] : FIXED;
    for (const layout of ["unified", "split"]) for (const { v } of [narrow, wide]) {
      scene(`Changes (${label}, ${layout}, ${v === narrow.v ? "narrow" : "wide"}): an unstaged diff`, v, { allow, props, shared: { [KEY.layout]: layout } });
    }
  }
  {
    const { v, p } = narrow;
    scene("Changes: the scope picker", v, { fields: [[p, { choosingScope: true }]] });
    p.scopeLists.show("commit", { root: p.root, on: null }, () => {}, makeCx()); await settle();
    const kind = p.scopeLists.kind;
    p.scopeLists.close();
    scene("Changes: the scope picker, its commits", v, { fields: [[p, { choosingScope: true }], [p.scopeLists, { kind }]] });
    p.input.set_value("Fix the thing");
    scene("Changes: a commit message typed", v);
    scene("Changes: the stash list", v, { fields: [[p, { choosingStash: true }]] });
    p.openBranches(true, makeCx()); await settle(); p.openBranches(false, makeCx());
    scene("Changes: the branch picker", v, { fields: [[p, { choosingBranch: true }]] });
    scene("Changes: the diff's options", v, { fields: [[p, { choosingDiffOptions: true }]] });
    scene("Changes: a stopped merge, a line", v, { fields: [[p, { operation: "merge", conflicts: 1, line: "git said no: CONFLICT (content)" }]] });
  }
  // A staged file; an untracked one; the image's two sides; a stash's changes.
  for (const [path, section] of [["b.txt", "staged"], ["new.txt", "unstaged"], ["logo.png", "unstaged"]]) {
    const v = await mount(r.dir, theme), p = v.part;
    p.pick(path, section, makeCx()); await settle();
    scene(`Changes: ${path} (${section})`, v);
  }
  {
    const shown = await page(r.dir, theme); shown.p.showStash(shown.p.stashes[0], makeCx()); await settle();
    scene("Changes: a stash's changes", shown.v);
  }
  // The comment box, narrow (docked) and wide (over the diff), then a card under its row.
  {
    const c = await page(r.dir, theme, 368);
    c.p.clickRow(c.p.diff.rows.findIndex((x) => x.kind === "+"), makeCx());
    scene("Changes: the comment box", c.v);
    const w = await page(r.dir, theme, 1300);
    w.p.clickRow(w.p.diff.rows.findIndex((x) => x.kind === "+"), makeCx());
    scene("Changes (wide): the comment box", w.v);
    w.p.noteBox.set_value("Looks odd");
    for (const h of w.p.noteBox.handlers.submit) h({}, makeCx());
    scene("Changes (wide): a comment card", w.v);
  }
  // Every menu and question the page opens.
  {
    const { p } = narrow;
    p.fileMenu("a.js", "unstaged", makeCx()); await settle(); await pop("Changes: a file's menu", lastOverlay());
    p.rowMenu(p.diff.items[p.diff.itemOf(p.diff.rows.findIndex((x) => x.kind === "+"))].key, makeCx()); await settle(); await pop("Changes: a row's menu", lastOverlay());
    p.penMenu(makeCx(), [{ id: "pi", label: "pi" }, { id: "opencode", label: "OpenCode" }]); await settle(); await pop("Changes: the pen's agents", lastOverlay());
    p.moreMenu(makeCx()); await settle(); await pop("Changes: ⋯", lastOverlay());
    p.openBranches(true, makeCx()); await settle();
    p.branchMenu(p.branches.find((b) => b.name === "other"), makeCx()); await settle(); await pop("Changes: a branch's menu", lastOverlay());
    p.revertAll(makeCx()); await settle(); await pop("Changes: Revert all?", lastOverlay());
    p.stashWith(makeCx()); await settle(); await pop("Changes: Stash…", lastOverlay());
  }
  questions(NAME).ask({ title: "Restore?", detail: "Why it asks.", lines: Array.from({ length: 30 }, (_, i) => `line ${i}`), files: { items: [{ path: "a.txt", checked: true }, { path: "b.txt", checked: false }] }, confirm: "Restore", danger: true, error: "git said no" });
  await pop("a question with lines, files and an error", lastOverlay());
  questions(NAME).ask({ title: "Reword?", input: { value: "Subject\n\nBody", multiline: true, required: true }, choices: { value: "a", options: [{ id: "a", label: "A" }, { id: "b", label: "B", detail: "why", disabled: true }] },
    checks: [{ id: "pushed", label: "It is pushed: I know", value: false, required: true }], confirm: "Reword" });
  await pop("a question with a message, choices and checks", lastOverlay());
  questions(NAME).ask({ title: "New worktree", confirm: "Create", input: { value: "", placeholder: "branch name", required: true } });
  await pop("a question with one line to fill", lastOverlay());
  questions(NAME).ask({ title: "Recently discarded", confirm: null, entries: [{ id: "e1", title: "Revert all", detail: "3 files · 2 minutes ago", button: "Restore…" }] });
  await pop("a question's entries", lastOverlay());
  questions(NAME).choose({ title: "Branch main", items: [{ id: "a", label: "Check out" }, { id: "b", label: "Merge into main…", disabled: true, detail: "No branch is checked out" }, { id: "c", label: "Delete…", danger: true }, { id: "d", label: "Ticked", checked: true }] });
  await pop("a menu: plain, disabled, danger, ticked", lastOverlay());
  // The send dialog (a row's Ask), with and without an agent there.
  await pop("the send dialog, no agent", { props: { role: "send", send: { title: "a.js:1", context: "1 + const a = 1;", sentKey: ":/tmp:work" } } });
  state.agents = [{ address: "t9", space: "s1", status: "idle", focused: false, program: { name: "pi" }, tab_name: "1" }];
  await pop("the send dialog, an agent", { props: { role: "send", send: { title: "a.js:1", context: "1 + const a = 1;", sentKey: ":/tmp:work" } } });

  // A repository below the folder that isn't read: the bar with Read it.
  {
    checks.clear(); state.shared.delete(TRUSTED);
    const dir = tempDir("git-enhanced-themes-trust-");
    for (const [name, extra] of [["plain", []], ["odd", [["diff.secret.textconv", "cat"]]]]) {
      const d = join(dir, name); mkdirSync(d); sh(d, "init", "-q", "-b", "main"); sh(d, "config", "user.name", "t"); sh(d, "config", "user.email", "t@t");
      writeFileSync(join(d, "a.txt"), "one\n"); sh(d, "add", "-A"); sh(d, "commit", "-qm", "first"); writeFileSync(join(d, "a.txt"), "two\n");
      for (const [k, val] of extra) sh(d, "config", k, val);
    }
    const u = await mount(dir, theme);
    u.part.repoSet.openList(true, makeCx()); await settle();
    press(byId(renderNow(u), "repo-0")); await settle();
    scene("Changes: a repository not read", u);
    // The switcher open: its list (one not read).
    const v = await mount(dir, theme);
    let switcher = null;
    walk(renderNow(v), (n) => { if (n.kind === "popover" && n.popover === "repo-list") switcher = n; });
    handler(switcher, "on_open_change")(true, makeCx()); await settle();
    scene("Changes: the repository switcher", v);
  }

  // The Review tab; the block's Changes | History switch (no tab header of ours), at History too; the
  // floating window, at both pages.
  {
    const { v } = await page(r.dir, { palette: "theme", review: true, root: r.dir }, 1300);
    scene("the Review tab", v);
    // (The narrow page above is a layout block's: its switch shows at Changes.)
    const bh = await mount(r.dir, theme);
    press(byId(renderNow(bh), "block-tab-history")); await settle();
    scene("the block's switch at History", bh);
    const w = await mount(r.dir, { overlay: "w1" });
    press(byId(renderNow(w), "window-tab-history")); await settle();
    // A window's copy has no block props: the diff in One Dark Pro's colors.
    scene("the window: Changes", w, { allow: FIXED, fields: [[w.part, { page: "changes" }]] });
    scene("the window: History", w, { allow: FIXED });
  }

  // History: the list with its lanes, a commit's details, files and diff, narrow and as a tab; the
  // uncommitted row; the filters; its menus.
  {
    const { A, base } = historyRepos();
    const h1 = await mount(A, { palette: "theme", view: "history" }), h = h1.part.history;
    scene("History: the list", h1);
    const sel = await mount(A, { palette: "theme", view: "history" }), hs = sel.part.history;
    const merge = hs.commits.find((c) => c.parents.length === 2);
    hs.select(merge.hash, makeCx()); await settle();
    scene("History: a merge's details, files and diff", sel);
    const un = await mount(A, { palette: "theme", view: "history" });
    un.part.history.selectUncommitted(makeCx()); await settle();
    scene("History: the uncommitted changes", un);
    const tab = await mount(join(base, "b"), { palette: "theme", view: "history", root: A, on: null }), ht = tab.part.history;
    ht.size = { width: 1400, height: 900 };
    ht.select(merge.hash, makeCx()); await settle();
    scene("History tab: wide, a commit", tab);
    scene("History: the filters open", h1, { fields: [[h, { choosingAuthor: true, choosingBranch: true }]] });
    scene("History: a stopped rebase", h1, { fields: [[h, { op: "rebase", line: "The rebase stopped: CONFLICT (content)." }]] });
    const none = await mount(A, { palette: "theme", view: "history" });
    none.part.history.search.set_value("author:nobody"); await settle();
    scene("History: nothing matches", none);
    // Menus: a commit's, a ref's, a file's, the layout.
    handler(lists(renderNow(h1)).find((l) => l.listId === "history-commits"), "on_item_secondary_click")(h.commits[0].hash, {}, makeCx()); await settle();
    const menu = lastOverlay();
    await pop("History: a commit's menu", menu);
    for (const [action, mode] of [["reset", "hard"], ["revert", null]]) await pop(`History: ${action}?`, { props: { commitAsk: { ...menu.props.commitMenu, action, mode } } });
    await pop("History: a new branch's name", { props: { commitName: { ...menu.props.commitMenu, action: "branch" } } });
    h.chooseLayout(makeCx()); await settle(); await pop("History: the layout menu", lastOverlay());
    // A file's menu is there with Files Enhanced installed.
    mkdirSync(join(stubs.appHome(), "mods", "files-enhanced"), { recursive: true }); writeFileSync(join(stubs.appHome(), "mods", "files-enhanced", "main.js"), "// the other mod\n");
    await checkInstalled();
    hs.fileRowMenu(hs.files[0], makeCx()); await settle(); await pop("History: a file's menu", lastOverlay());
    const ref = hs.details?.refs?.[0] ?? h.commits.find((c) => c.refs?.length)?.refs[0];
    if (ref) { h.refMenu(ref, makeCx()); await settle(); await pop("History: a ref's menu", lastOverlay()); }
  }
  // The interactive rebase's editor; a turn's revert.
  {
    const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
    const rows = [{ sha: A, short: "aaaaaaa", subject: "First", author: "T", message: "First" }, { sha: B, short: "bbbbbbb", subject: "Second", author: "T", message: "Second\n\nbody" }, { sha: C, short: "ccccccc", subject: "Third", author: "T", message: "Third" }];
    await pop("the rebase editor", { props: { rebaseEdit: { id: "r1", rows, branch: "main", from: "aaaaaaa", pushed: true } } }, (part) => { part.rows[1].action = "squash"; part.rows[2].action = "drop"; part.rows[0].action = "reword"; part.at = 1; });
    await pop("a turn's revert", { props: { turnRevert: { root: r.dir, on: null, id: "t1", label: "pi · 14:03–14:07 · 2 files", start: A, running: false, plan: [{ path: "a.txt", was: "M", action: "restore" }, { path: "n.txt", was: "A", action: "delete" }], later: ["a.txt"], key: `${NAME}.turns`, changed: `${NAME}.changed` } } });
  }
  // The shared parts: the tab header, the settings window at each of its sections.
  {
    state.layout = { id: "root", type: "row", children: [{ id: "panel", type: "column", children: [{ id: "panel-body", type: "stack", active: "changes", children: [
      { id: "files", title: "Files", type: "block" }, { id: "changes", title: "Changes", type: "block" }, { id: "history", title: "History", type: "block" }] }] }] };
    const tabs = await mount(undefined, { role: "tabs", stack: "panel-body" });
    scene("the tab header", tabs);
    const s = await mount(undefined, { role: "settings", overlay: "o9" });
    for (const section of ["open-with", "changes", "agents"]) scene(`the settings window: ${section}`, s, { fields: [[s.part, { section }]] });
    scene("the settings window: Reset all, asking again", s, { fields: [[s.part, { armed: { what: "all", at: Date.now() } }]] });
  }
  state.agents = [];
});

themeTests({ test, assert, scenes: () => scenes, state, stubs, min: 30, rows: (l) => renderRows(l, { start: 0, end: Math.min(l.count, 80) }) });
