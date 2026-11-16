// Checks the copies `herdr-app check` can't reach with empty props and no repository: a scratch copy
// of Git Enhanced (or Files Enhanced) per variant, patched to start as that variant (fixed props,
// state set in init), each run through `herdr-app check` (Herdr's real elements: an unknown style
// method, a panel outside its group, a list's sizes, … fail it). Not a node test: run it by hand
// after changing a dialog, a menu, a page's states or a shared part (the tab header, the settings
// window, drawn the same by both mods):
//   node tools/check-variants.mjs        (copies in $OUT, else git-enhanced-checkvariants in the temp folder)
import { execFileSync } from "node:child_process";
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MOD, NAME } from "../test/git-enhanced/mod.mjs";
import { MOD as FILES_MOD, NAME as FILES_NAME } from "../test/files-enhanced/mod.mjs";

const OUT = process.env.OUT ?? join(tmpdir(), "git-enhanced-checkvariants");
mkdirSync(OUT, { recursive: true });
const A = "a".repeat(40), B = "b".repeat(40), C3 = "c".repeat(40);
const names = { mod: NAME, changed: `${NAME}.changed`, scope: `${NAME}.scope`, show: `${NAME}.show` };
const C = { root: "/tmp", on: null, sha: A, short: "aaaaaaa", subject: "Fix the thing", parents: [B], branch: "main", head: C3, names,
  refs: [{ kind: "branch", name: "main", current: true }, { kind: "remote", name: "origin/main", current: false }, { kind: "tag", name: "v1", current: false }], selected: B, site: "GitHub", ask: "m1" };

const edit = (dir, file, pairs) => {
  let s = readFileSync(join(dir, file), "utf8");
  for (const [a, b] of pairs) { if (!(typeof a === "string" ? s.includes(a) : a.test(s))) throw new Error(`${file}: no ${a}`); s = s.replace(a, b); }
  writeFileSync(join(dir, file), s);
};
// Every module that reads props() gets these instead.
function fixProps(dir, p) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const path = join(dir, f), s = readFileSync(path, "utf8");
    const m = /import \{([^}]*)\} from "herdr";\n/.exec(s);
    if (!m || !/\bprops\b/.test(m[1])) continue;
    const list = m[1].split(",").map((x) => x.trim()).filter((x) => x && x !== "props");
    const fixed = `import { ${list.join(", ")} } from "herdr";\nconst props = () => (${JSON.stringify({ ...p, overlay: "o1" })});\n`;
    writeFileSync(path, s.replace(m[0], fixed));
  }
}
let failed = 0;
function check(name, p, patch = () => {}, from = MOD) {
  const dir = join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(from, dir, { recursive: true });
  fixProps(dir, p);
  patch(dir);
  try { execFileSync("herdr-app", ["check", dir], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n${e.stdout}${e.stderr}`); }
}

// Questions: a menu, a form with every part, a list with buttons, a one-line name.
check("question-menu", { question: { id: "q1", menu: true, title: "Branch main", items: [{ id: "a", label: "Check out" }, { id: "b", label: "Merge into main…", disabled: true, detail: "No branch is checked out" }, { id: "c", label: "Delete…", danger: true }] } });
check("question-menu-checked", { question: { id: "q5", menu: true, title: "History layout", width: 220, items: [{ id: "auto", label: "Automatic (by width)", checked: true }, { id: "side", label: "Side by side", checked: false }, { id: "stacked", label: "Stacked", checked: false }] } });
check("question-form", { question: { id: "q2", title: "Reword aaaaaaa?", detail: "Its message becomes what is written here.", lines: ["a.txt", "b.txt"], confirm: "Reword", danger: true, error: "git said no",
  input: { value: "Subject\n\nBody", multiline: true, required: true }, choices: { value: "a", options: [{ id: "a", label: "A" }, { id: "b", label: "B", detail: "why", disabled: true }] },
  checks: [{ id: "pushed", label: "It is pushed: I know", value: false, required: true }, { id: "x", label: "Only for b", value: true, only: ["b"] }], files: { items: [{ path: "a.txt", checked: true }, { path: "b.txt", checked: false }] } } });
check("question-entries", { question: { id: "q3", title: "Recently discarded", confirm: null, entries: [{ id: "e1", title: "Revert all", detail: "3 files · 2 minutes ago", button: "Restore…" }] } });
check("question-name", { question: { id: "q4", title: "New worktree at aaaaaaa", confirm: "Create", input: { value: "", placeholder: "branch name", required: true }, checks: [{ id: "agent", label: "Start pi there", value: true }] } });
// The commit menu with every row, and its dialogs.
check("commit-menu", { commitMenu: C });
check("commit-ask-hard", { commitAsk: { ...C, action: "reset", mode: "hard" } });
check("commit-ask-revert", { commitAsk: { ...C, action: "revert", mode: null } });
check("commit-name", { commitName: { ...C, action: "branch" } });
check("commit-stopped", { commitAsk: { ...C, action: "cherry-pick", mode: null } }, (d) => edit(d, "commitmenu.js", [["this.working = false; this.error = null; this.stopped = null;", `this.working = false; this.error = null; this.stopped = "CONFLICT (content): Merge conflict in a.txt";`]]));
// The interactive rebase's editor: a squash and a reword (their message boxes), pushed.
const rows = [{ sha: A, short: "aaaaaaa", subject: "First", author: "T", message: "First" }, { sha: B, short: "bbbbbbb", subject: "Second", author: "T", message: "Second\n\nbody" }, { sha: C3, short: "ccccccc", subject: "Third", author: "T", message: "Third" }];
check("rebase-editor", { rebaseEdit: { id: "r1", rows, branch: "main", from: "aaaaaaa", pushed: true } }, (d) => edit(d, "rebaseedit.js", [["    this.handle = cx.focus_handle();\n    this.handle.focus();\n  }", `    this.handle = cx.focus_handle();\n    this.handle.focus();\n    this.rows[1].action = "squash"; this.rows[2].action = "drop"; this.rows[0].action = "reword"; this.at = 1;\n  }`]]));
// The send dialog and a turn's revert.
check("send-dialog", { role: "send", send: { title: "a.js:1", context: "1 + const a = 1;\n2 + const b = 2;", sentKey: ":/tmp:work" } });
check("turn-revert", { turnRevert: { root: "/tmp", on: null, id: "t1", label: "pi · 14:03–14:07 · 2 files", start: A, running: false, plan: [{ path: "a.txt", was: "M", action: "restore" }, { path: "n.txt", was: "A", action: "delete" }], later: ["a.txt"], key: `${NAME}.turns`, changed: `${NAME}.changed` } });

// The History page: a selected commit (its labels, files, a comparison), a stopped rebase, a line,
// the uncommitted row, both widths (the line between the commits and the commit), the filters open.
const commits = `[{ hash: "${A}", parents: ["${B}", "${C3}"], author: "Ann", email: "a@x", time: 1700000000, refs: [{ kind: "branch", name: "main", current: true }, { kind: "tag", name: "v1", current: false }], subject: "Merge it" },
  { hash: "${B}", parents: ["${C3}"], author: "Bo", email: "b@x", time: 1690000000, refs: [{ kind: "remote", name: "origin/main", current: false }], subject: "Second" },
  { hash: "${C3}", parents: [], author: "Ann", email: "a@x", time: 1680000000, refs: [], subject: "Root" }]`;
const historyState = (extra) => (d) => edit(d, "history.js", [[`    takers.add(this);\n  }`, `    takers.add(this);
    this.context = o.key(); this.root = "/tmp"; this.on = null; this.commits = ${commits};
    this.graph = lanes(this.commits, { colors: 6, reserved: 2, head: "${A}" }); this.more = true; this.ahead = new Set(["${A}"]); this.behind = new Set(["${B}"]);
    this.head = { hash: "${A}", branch: "main", upstream: "origin/main" }; this.op = "rebase"; this.line = "The rebase stopped: CONFLICT (content). Resolve it in Changes, or Abort here.";
    this.dirty = { count: 3, staged: 1, sig: "x" }; this.site = "GitHub"; this.siteFor = "/tmp"; this.branchNames = ["main", "side"];
${extra}
  }`]]);
const selected = `    this.selected = "${A}"; this.comparing = "${C3}"; this.from = "${C3}";
    this.details = { hash: "${A}", parents: ["${B}", "${C3}"], author: "Ann", email: "a@x", authorTime: 1700000000, committer: "Bo", committerEmail: "b@x", commitTime: 1700000100, refs: [{ kind: "branch", name: "main", current: true }, { kind: "tag", name: "v1", current: false }, { kind: "remote", name: "origin/main", current: false }], message: "Merge it\\n\\nbody line" };
    this.files = [{ status: "M", path: "src/a.js", add: 1, del: 2, binary: false }, { status: "A", path: "img.png", add: 0, del: 0, binary: true }]; this.file = "src/a.js";`;
check("history-wide", { view: "history", palette: "theme" }, historyState(`${selected}\n    this.size = { width: 1400, height: 900 };`));
check("history-narrow", { view: "history", palette: "theme" }, historyState(`${selected}\n    this.size = { width: 480, height: 900 };`));
check("history-tab", { view: "history", palette: "theme", root: "/tmp" }, historyState(`${selected}\n    this.size = { width: 1400, height: 900 };`));
check("history-uncommitted", { view: "history", palette: "theme" }, historyState(`    this.selected = "uncommitted"; this.details = { uncommitted: true }; this.from = "HEAD";
    this.files = [{ status: "M", path: "a.txt", add: 2, del: 1, binary: false }, { status: "?", path: "new.txt", add: 0, del: 0, binary: false, untracked: true }]; this.file = "a.txt";`));
check("history-filters", { view: "history", palette: "theme" }, historyState(`    this.choosingAuthor = true; this.query = 'author:"Ann" branch:side'; this.search.set_value(this.query);`));
check("history-bisect", { view: "history", palette: "theme" }, historyState(`${selected}\n    this.size = { width: 480, height: 900 }; this.bisect = { active: true, start: "main", terms: { bad: "bad", good: "good" }, bad: "${A}", good: ["${C3}"], skipped: [], testing: "${B}", first: null };`));
check("history-branches", { view: "history", palette: "theme" }, historyState(`    this.choosingBranch = true;`));

// The Changes page in states a repository puts it in: a merge stopped on conflicts with a file's
// conflict view, at the panel's width.
const changesState = (extra) => (d) => edit(d, "changes.js", [["    this.refresh(cx);\n    cx.timer.every(TICK_MS", `    this.context = contextKey(); this.root = "/tmp"; this.on = null; this.hasHead = true; this.readOnce = true; this.size = { width: 368, height: 900 };
    this.facts = { head: "${A}", branch: "main", upstream: "origin/main", ahead: 1, behind: 2, remote: "origin", parent: "${B}", base: "main", merge: "${A}", stashes: [] };
    this.version = { major: 2, minor: 40, patch: 0 };
${extra}
    cx.timer.every(TICK_MS`]]);
check("changes-conflict", { palette: "theme" }, changesState(`    this.operation = "merge"; this.stopped = { op: "merge", branch: "main", merging: ["${B}"], message: "Merge branch 'side'", step: null, left: null };
    this.entries = [{ path: "f.txt", xy: "UU" }, { path: "g.txt", xy: "DU" }]; this.dirty = new Map(this.entries.map((e) => [e.path, e.xy]));
    this.unmerged = [{ path: "f.txt", xy: "UU", kind: "both modified", ours: true, theirs: true, base: true, submodule: false }];
    this.open = { path: "f.txt", section: "unstaged" };
    this.conflictView = { path: "f.txt", text: "a\\n<<<<<<< HEAD\\nmain\\n=======\\nside\\n>>>>>>> side\\nc\\n", size: 7, choices: ["theirs"], error: null,
      segments: [{ kind: "text", text: "a\\n" }, { kind: "conflict", index: 0, ours: "main\\n", base: null, theirs: "side\\n", labels: { ours: "HEAD", base: null, theirs: "side" }, raw: "", line: 1 }, { kind: "text", text: "c\\n" }] };`));
check("changes-rebase-stopped", { palette: "theme" }, changesState(`    this.operation = "rebase"; this.stopped = { op: "rebase", branch: null, rebasing: "topic", onto: "${B}", commit: "${C3}", merging: [], step: { done: 2, total: 5 }, left: 4 };
    this.entries = [{ path: "f.txt", xy: "UU" }]; this.dirty = new Map(this.entries.map((e) => [e.path, e.xy]));`));

// The shared parts (shared/), in both mods: the tab header over a panel's three pages, the settings
// window at each of the mod's three sections (Open with, its own, Agents), with both mods counted
// installed and with only this one, and with Reset all waiting for its second press (its line).
const panel = `{ id: "root", type: "row", children: [{ id: "panel-body", type: "stack", active: "changes", children: [{ id: "files", title: "Files", type: "block" }, { id: "changes", title: "Changes", type: "block" }, { id: "history", title: "History", type: "block" }] }] }`;
const withLayout = (d) => edit(d, "paneltabs.js", [["tabsOf(findNode(layout(), stack))", `tabsOf(findNode(${panel}, stack))`]]);
const INSTALLED = "export const installed = (part) => part === PART || seen.get(part) === true;";
const bothInstalled = (d) => edit(d, "installed.js", [[INSTALLED, "export const installed = (part) => Boolean(part);"]]);
const oneInstalled = (d) => edit(d, "installed.js", [[INSTALLED, "export const installed = (part) => part === PART;"]]);
const armedAll = (d) => edit(d, "settingsview.js", [[`this.armed = null;        // { what`, `this.armed = { what: "all", at: Date.now() }; // { what`]]);
for (const [mod, from, own] of [[NAME, MOD, "changes"], [FILES_NAME, FILES_MOD, "files"]]) {
  check(`${mod}-panel-tabs`, { role: "tabs", stack: "panel-body" }, withLayout, from);
  for (const section of ["open-with", own, "agents"]) {
    check(`${mod}-settings-${section}`, { role: "settings", section }, bothInstalled, from);
    check(`${mod}-settings-${section}-alone`, { role: "settings", section }, oneInstalled, from);
  }
  check(`${mod}-settings-reset-all`, { role: "settings" }, (d) => { bothInstalled(d); armedAll(d); }, from);
  check(`${mod}-settings-reset-all-alone`, { role: "settings" }, (d) => { oneInstalled(d); armedAll(d); }, from);
}

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("every variant passed");
