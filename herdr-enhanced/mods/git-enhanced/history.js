// The History page: a copy whose props say view: "history" (a panel page, or a full-width tab from
// its ⤢ button with props { view: "history", root, on }) shows the repository's commits.
//   - One `git log` per page (gitlog.js: 300 commits, NUL separated, topological), from HEAD and its
//     upstream, or every branch, remote and tag ("All branches"). Commits on HEAD not on the
//     upstream get ↑ (not pushed), the upstream's not on HEAD ↓ (not pulled, listed first).
//     "Load more" asks for 300 more.
//   - Lanes (graph.js) at the left, drawn with paths in the theme's ansi colors.
//   - The search box: words in messages (any case) or a hash prefix; author:x; path:a/b (one
//     file: followed through renames). A search draws no lanes (they would not connect).
//   - A click selects a commit: under the list or beside it (the arrangement) its message (the body folded
//     under "Show full message"), people, dates, parents and refs, its files against its first
//     parent (a root commit: against the empty tree), all in one area that scrolls, and the clicked
//     file's diff, which the page that hosts this one draws (`diff`). A right-click opens the
//     commit menu (commitmenu.js).
//   - A cherry-pick, revert, merge or rebase left stopped shows a bar with Abort.
//   - Uncommitted changes are a row at the top (not while searching): a click lists them with their
//     diffs; its right-click has Commit…, Stash…, Discard all… (historyacts.js).
//   - The commit beside the commits or under them: the layout button at the right end of the
//     commit's files row (Automatic: side by side from 760 px; Side by side; Stacked), one setting
//     for every copy (`names.layout`, historylayout.js).
//   - It takes reveal requests (shared/reveal.js, names.reveal) for the History page: path:<path> in
//     the search for that repository (reveals.js chooses the copy). A commit's file rows have Show in
//     Files on a right-click while Files Enhanced is installed.
//   - The search box takes author:"name" and branch:name too; Author ▾ and Branch ▾ write them, and
//     HEAD selects the commit HEAD is on. A label of the selected commit (branch, remote branch,
//     tag) has its menu on a click; the commit menu's `page` rows run here (historyacts.js):
//     a label's menu, Create tag here…, Create worktree here…, Reset main to here ›, Interactive
//     rebase ›, Compare with the selected commit, Open on GitHub, Copy ›.
// It loads again when the refs move (checked whenever the host asks: a timer, file changes) and
// after an action (the shared `names.changed` key).
// With a commit selected, two lines can be dragged: the one between the commits and the commit (left
// and right side by side, up and down stacked) and the one between the commit's information and
// its diff (up and down). Where they were left is kept in the shared `names.split` key, in pixels,
// by copy and arrangement (h: side by side, v: stacked): the commits' width or height ("panel-v",
// "panel-h", "tab-v", "tab-h") and the information's height ("panel-v-info", "tab-h-info", …). The
// lines are strips of their own on the page's flex layout: inside gpui-base's resizable group the
// commit's diff couldn't be scrolled. The sizes and their limits: historylayout.js.
// Based on Herdr's shipped changes mod (Apache-2.0); changed: the file rows' look.
import { div, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list, VirtualListScrollHandle, Popover } from "gpui-base";

/** The page's width from which the search box and the filters share one row. */
export const FILTERS_IN_ONE_ROW = 560;
// A log that took this long (ms) in a repository without git's commit-graph gets a line offering to
// write it: without one, git reads the whole history for every page (topological order), with one
// only what it shows (200,000 commits: about 0.8 s against 0.05 s).
export const SLOW_LOG_MS = 400;
import { exec, props, shared, setShared, theme, openOverlay, notify, run, layout, appHome, home } from "herdr";
import { PAGE, startRefs, logArgs, oneArgs, parseLog, parseQuery, filtered, parseNameStatus, parseNumstat, detailArgs, parseDetails, ago, when, hashSet, signature, brief } from "./gitlog.js";
import { lanes, drawRow, DOT, LANE, width as laneSpan } from "./graph.js";
import { menuItems, menuHeight, awaitMenu, openCommitAsk } from "./commitmenu.js";
import { onPage } from "./onpage.js";
import { CLEAR, chip, button, field, listCard, CARD_HEADING, CARD_ROW, CARD_ONE, choice, lines2, tick, heading, rule } from "./ui.js";
import { iconButton, iconRow, CLOSE, withChevron } from "./iconbutton.js";
import { anchorOf } from "./menuat.js";
import { openAsTab, backToPanel, showTab } from "./tabs.js";
import { installed } from "./installed.js";
import { requestOf, takers, pagePlace, bringForward, askFiles } from "./reveal.js";
import { takersFor } from "./reveals.js";
import { repo, reader, platform } from "./machine.js";
import { notReadBar, trustRepo, SAFE_ARGS, DIFF_SAFE, SAFE_GIT_SH } from "./repotrust.js";
// History's bar while an operation waits: what stopped, and where to go on (Changes has the bar with
// Continue, Skip and Abort).
const stoppedLine = (op) => (op === "am" ? "A git am stopped: a patch didn't apply. Resolve it in Changes, then Continue, Skip or Abort there or here."
  : `A ${op} stopped. Resolve the conflicts in Changes, then Continue${op === "merge" ? "" : " or Skip"} there, or abort it here.`);

// git as the page reads on its own (repotrust.js SAFE_ARGS: no fsmonitor, no hooks), in `root` on `on`.
const readGit = (root, on) => (args) => exec("git", [...SAFE_ARGS, ...args], { cwd: root, on });
import { OPERATION_SH, operationOf } from "./branches.js";
import { rewriteFlow, resetFlow, worktreeFlow, refFlow, uncommittedFlow, webPage, tagFlow } from "./historyacts.js";
import { worktreeSpaces } from "./wtspaces.js";
import { readWorktrees, elsewhere, whereWords, tilde } from "./worktrees.js";
import { copyCommitFlow, copyCommitsFlow } from "./patchui.js";
import { openRebaseEditor } from "./rebaseedit.js";
import { urlCommand } from "./openat.js";
import { statusCount, stagedCount } from "./gitlog.js";
import { alpha } from "./look.js";
import { LINE, MIN, ROW, COLS, FILES, between, sizes, infoParts, oneLine, columns, colsRoom, dateText, LAYOUTS, LAYOUT_NAMES, layoutOf, sideBySide, layoutTip } from "./historylayout.js";
import { settingsGear } from "./settingsview.js";
import { readable } from "./ink.js";
import { gitVersion } from "./machine.js";
import * as Repo from "./repoui.js";
import * as Sel from "./commitsel.js";
import * as Bisect from "./bisectui.js";
import { openVersionFlow, PRUNE_VERSIONS_SH } from "./blameui.js";
import { CACHE } from "./id.js";
import { selectionFlow } from "./historyacts.js";

// Lane colors by index (graph.js): the current branch, its upstream, then the rest in turn.
const LANES = ["ansi4", "ansi5", "ansi2", "ansi3", "ansi6", "ansi1"];
// The uncommitted changes' row in the list.
export const UNCOMMITTED = "uncommitted";
// A failed action's words.
const WORDS = { reword: "Reword", squash: "Squash", drop: "Drop", rebase: "Rebase", worktree: "Worktree", switch: "Switch", merge: "Merge", push: "Push", upstream: "Set upstream",
  renameBranch: "Rename", deleteBranch: "Delete", fetch: "Fetch", remote: "Remote", tag: "Tag", bisect: "Bisect", cherryPick: "Cherry-pick", revert: "Revert", reset: "Reset", branch: "Branch", deleteRemote: "Delete on the remote", deleteTag: "Delete tag", commit: "Commit", stash: "Stash", revertAll: "Discard",
  commitGraph: "Writing git's commit-graph" };

// Path commands (graph.js) traced onto a PathBuilder.
function trace(b, d) {
  for (const [op, ...a] of d) {
    if (op === "M") b = b.move_to(a[0], a[1]);
    else if (op === "L") b = b.line_to(a[0], a[1]);
    else if (op === "A") b = b.arc_to(a[0], a[1], a[2], Boolean(a[3]), Boolean(a[4]), a[5], a[6]);
  }
  return b;
}
const disc = (x, y, r) => PathBuilder.fill().move_to(x - r, y).arc_to(r, r, 0, false, true, x + r, y).arc_to(r, r, 0, false, true, x - r, y).close().build();
// The pointer's place along a line's axis.
const along = (e, axis) => (axis === "x" ? e.position.x : e.position.y);

// What holds a commit, in words: its branches, remote branches and tags (commitsel.js parseContains).
function holdsWords(x) {
  const list = (a) => (a.length > 6 ? `${a.slice(0, 6).join(", ")} and ${a.length - 6} more` : a.join(", "));
  const parts = [x.branches.length && `On branches: ${list(x.branches)}`, x.remotes.length && `Remote: ${list(x.remotes)}`, x.tags.length && `Tags: ${list(x.tags)}`].filter(Boolean);
  return parts.length ? parts.join(" · ") : "On no branch or tag";
}

export class History {
  /** `o`: { mod (the mod's folder, for its overlays, icons and the tab), names ({ changed, scope,
   *  show }: shared keys the commit menu sets; split, layout: the lines' sizes and the arrangement), location() ({ cwd, on } the copy looks at), key() (its
   *  context: a change starts the page over), repos (a RepoSet, repos.js), diff (the host's file
   *  diff: open, clear, sync(cx), element, controls, options (± and ¶), frame, resize), focus ({ track(el), focus() }),
   *  watch(root, on, cx) (reload on file changes), codeFont(), questions (question.js questions(mod):
   *  ask/choose), starter() ({ name, argv }: the agent a new worktree's space may start) }.
   *  Construct in init. */
  constructor(o) {
    this.o = o;
    this.tab = Boolean(props()?.root);
    this.context = undefined; this.root = null; this.on = null; this.error = null;
    this.commits = []; this.graph = null; this.more = false; this.pages = 1; this.all = false; this.query = ""; this.typed = 0;
    this.slowLog = SLOW_LOG_MS; this.slow = null; this.slowDismissed = new Set();
    this.head = { hash: null, branch: null, upstream: null }; this.ahead = new Set(); this.behind = new Set(); this.op = null; this.sig = null;
    this.selected = null; this.details = null; this.files = null; this.file = null; this.from = null; this.empty = null;
    this.want = 0; this.running = false; this.loading = false;
    this.dirty = { count: 0, staged: 0, sig: "" }; this.site = null; this.siteFor = null; this.line = null; this.busy = null;
    this.comparing = null; this.jumpHead = false; this.choosingAuthor = false; this.choosingBranch = false; this.branchNames = []; this.branchAway = new Map();
    this.splitDrag = null; this.colDrag = null; this.colHover = null;
    this.list = VirtualListScrollHandle.new();
    this.seenChange = shared(o.names.changed);
    this.search = InputState.new({ placeholder: "Message or SHA · author:name · path:dir/file" });
    this.searching = false; // until it has the keys (ui.js field() would take undefined for focused)
    // Typing searches once it pauses; Enter at once.
    this.search.on("change", (_e, cx) => {
      if (this.search.value() === this.query) return;
      this.query = this.search.value(); this.pages = 1;
      const n = ++this.typed;
      cx.timer.after(350, (cx) => { if (n === this.typed) this.reload(cx); });
    });
    this.search.on("submit", (_e, cx) => { this.query = this.search.value(); this.pages = 1; this.typed++; this.reload(cx); });
    // Its border says whether it has the keys: each change is drawn (without a draw the border kept
    // `accent` after a click elsewhere).
    this.search.on("focus", (_e, cx) => { this.searching = true; cx.notify(); });
    this.search.on("blur", (_e, cx) => { this.searching = false; cx.notify(); });
    // Reveal requests: this copy takes them with the mod's other copies (reveal.js takers).
    this.kind = "history"; this.readOnce = false; this.seenReveal = null; this.pendingReveal = null;
    takers.add(this);
  }

  // The page goes (its copy closed): it takes no more requests.
  close() { takers.delete(this); }

  /** Load again if anything moved; `force`: whatever moved (the search, All branches, a page more).
   *  Requests while a load runs are remembered and run after it, one at a time. */
  refresh(cx, force = false) {
    this.want = Math.max(this.want, force ? 2 : 1);
    if (!this.running) this.loadAll(cx);
  }
  // The loads asked for, one after the other until none is left.
  loadAll(cx) {
    this.running = true;
    cx.spawn(async (cx) => {
      // Never in the caller's phase: a render may have asked.
      await cx.sleep(0);
      try {
        while (this.want) {
          const force = this.want === 2;
          this.want = 0;
          this.loading = true;
          try { await this.loadOnce(force, cx); }
          catch (e) { this.error = String(e.message ?? e); }
          this.loading = false; this.readOnce = true;
          cx.notify();
        }
      } finally { this.running = false; }
    });
  }
  reload(cx) { this.refresh(cx, true); }
  // Read it: trust the repository's config as it is now and read it (a change to it asks again).
  readIt(cx) {
    const u = this.unread;
    if (!u) return;
    trustRepo(u.check, u.root, u.on);
    this.unread = null;
    this.reload(cx);
    cx.notify();
  }

  // Where the copy looks now: a new place starts the page over.
  follow() {
    const context = this.o.key();
    if (context === this.context) return false;
    this.context = context; this.root = null; this.unread = null; this.commits = []; this.graph = null; this.sig = null; this.pages = 1; this.error = null; this.op = null;
    this.unselect();
    return true;
  }

  unselect() { this.selected = null; this.details = null; this.files = null; this.file = null; this.from = null; this.bodyOpen = false; this.o.diff.clear(); }

  async loadOnce(force, cx) {
    this.follow();
    const context = this.context, { cwd, on } = this.o.location();
    if (!cwd) return;
    const found = await readGit(cwd, on)(["rev-parse", "--show-toplevel"]), top = found.code === 0 ? found.stdout.trim() : null;
    if (this.o.key() !== context) return;
    const root = await this.o.repos.pick({ cwd, on, top, current: this.root ?? this.unread?.root });
    if (this.o.key() !== context) return;
    if (!root) { this.root = null; this.unread = null; this.commits = []; this.graph = null; this.error = "Not a git repository"; return; }
    // One below the folder whose config has settings beyond the usual ones: not read until Read it.
    const check = await this.o.repos.unread(root, on, top);
    if (this.o.key() !== context) return;
    if (check) { this.root = null; this.unread = { root, on, check }; this.commits = []; this.graph = null; this.sig = null; this.error = null; this.op = null; this.unselect(); return; }
    this.unread = null;
    if (root !== this.root) { this.root = root; this.on = on; this.sig = null; this.empty = null; this.branchAway = new Map(); this.unselect(); }
    await this.page(context, force, cx);
    this.o.watch(root, on, cx);
  }

  // The commits, when the refs (or the search, the pages, All branches, what stopped) changed since
  // the last time.
  async page(context, force, cx) {
    const { root, on } = this, git = readGit(root, on);
    // What git printed (trimmed) when it succeeded, else null.
    const out = (args) => git(args).then((r) => (r.code === 0 ? r.stdout.trim() : null));
    const head = await out(["rev-parse", "--verify", "-q", "HEAD"]);
    const refs = await out(["for-each-ref", "--format=%(objectname) %(refname)", "refs/heads", "refs/remotes", "refs/tags"]);
    // The uncommitted changes (the top row): read every time, since they move without the refs.
    const st = head ? await git(["--no-optional-locks", "status", "--porcelain=v1", "-z", "--no-renames"]) : null;
    const dirty = st?.code === 0 ? { count: statusCount(st.stdout), staged: stagedCount(st.stdout), sig: st.stdout } : { count: 0, staged: 0, sig: "" };
    if (this.o.key() !== context || root !== this.root) return;
    if (dirty.sig !== this.dirty.sig) {
      this.dirty = dirty;
      // The uncommitted row selected: gone when nothing is left, else its files again.
      if (this.selected === UNCOMMITTED) { if (!dirty.count) this.unselect(); else this.selectUncommitted(cx); }
    }
    // What stopped (a merge, rebase, cherry-pick, revert or git am): read every time too, since it
    // starts and ends without moving a ref (a cherry-pick from a commit's menu that stops, its abort).
    const marks = await exec("sh", ["-c", SAFE_GIT_SH + OPERATION_SH], { cwd: root, on }), op = marks.code === 0 ? operationOf(marks.stdout) : null;
    const sig = `${signature(refs, head)}|${op}|${this.all}|${this.query}|${this.pages}`;
    if (!force && sig === this.sig) return;
    const branch = head ? await out(["symbolic-ref", "-q", "--short", "HEAD"]) : null;
    const upstream = branch ? await out(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]) : null;
    const search = parseQuery(this.query), shown = this.pages * PAGE;
    // While bisecting, HEAD is the commit being tested: the bad end is listed too, so the commits
    // git tests and the first bad one (Show it) are in the list.
    const bisect = await Bisect.bisectState(reader(root, on)).catch(() => null);
    const from = [...startRefs({ all: this.all, upstream, branch: search.branch }).filter((r) => head || r !== "HEAD"),
      ...(bisect && !search.branch ? [`refs/bisect/${bisect.terms.bad}`] : [])];
    let commits = [], more = false;
    if (head || (this.all && refs)) {
      // One file: follow it through renames.
      const follow = Boolean(search.path && head && (await out(["cat-file", "-t", `HEAD:${search.path}`])) === "blob");
      const started = Date.now();
      const r = await git(logArgs({ refs: from, count: shown + 1, search, follow }));
      if (Date.now() - started >= this.slowLog && !this.slowDismissed.has(root)) this.slow = (await this.hasCommitGraph(root, on)) ? null : root;
      if (r.code !== 0) throw new Error(brief(r.stderr) || "git log failed");
      commits = parseLog(r.stdout);
      more = commits.length > shown;
      if (more) commits = commits.slice(0, shown);
      if (search.sha) {
        const one = parseLog((await git(oneArgs(search.sha))).stdout)[0];
        if (one && !commits.some((c) => c.hash === one.hash)) commits.unshift(one);
      }
    }
    // Not pushed (↑) and not pulled (↓): up to 2000 each. The ones not pulled go first (only the
    // upstream's commits descend from them, so the order stays topological).
    const ahead = upstream ? hashSet(await out(["rev-list", "--max-count=2000", "@{u}..HEAD"])) : new Set();
    const behind = upstream ? hashSet(await out(["rev-list", "--max-count=2000", "HEAD..@{u}"])) : new Set();
    if (behind.size && !this.all && !filtered(search)) commits = [...commits.filter((c) => behind.has(c.hash)), ...commits.filter((c) => !behind.has(c.hash))];
    // The remote's web site, once per repository (the commit menu's Open on …).
    if (this.siteFor !== root) { this.siteFor = root; this.site = (await webPage(reader(root, on), "0".repeat(40), upstream?.split("/")[0] ?? null).catch(() => null))?.site ?? null; }
    const names = await out(["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads"]);
    if (this.o.key() !== context || root !== this.root) return;
    this.branchNames = names ? names.split("\n").filter(Boolean).slice(0, 60) : [];
    this.head = { hash: head, branch, upstream };
    this.commits = commits; this.more = more; this.ahead = ahead; this.behind = behind; this.op = op; this.sig = sig; this.error = null; this.bisect = bisect;
    this.picks = Sel.prune(this.picks ?? Sel.NONE, commits.map((c) => c.hash));
    this.graph = filtered(search) ? null : lanes(commits, { colors: LANES.length, reserved: 2, head, fixed: (c) => this.fixedColor(c) });
    // HEAD ▸ asked while HEAD wasn't listed: now it is.
    if (this.jumpHead) { this.jumpHead = false; this.headWanted = true; }
  }

  // The current branch's lane and its upstream's keep their colors.
  fixedColor(c) {
    if (c.refs?.some((r) => r.current)) return 0;
    const u = this.head.upstream;
    return u && c.refs?.some((r) => r.kind === "remote" && r.name === u) ? 1 : undefined;
  }

  loadMore(cx) { this.pages++; this.reload(cx); }

  // A click on a commit: its details and files (a second click closes them); `against`: another
  // commit to compare it with instead of its first parent. The uncommitted row: its files.
  select(hash, cx, against = null) {
    this.o.focus.focus();
    if (hash === this.selected && !against && !this.comparing) { this.unselect(); cx.notify(); return; }
    this.unselect();
    this.selected = hash; this.comparing = against;
    if (hash === UNCOMMITTED) { this.selectUncommitted(cx); return; }
    const { root, on } = this, context = this.context, git = readGit(root, on);
    cx.spawn(async (cx) => {
      try {
        const d = parseDetails((await git(detailArgs(hash))).stdout);
        if (!d) throw new Error("this commit can't be read");
        if (!d.parents.length && !this.empty) this.empty = (await git(["hash-object", "-t", "tree", "/dev/null"])).stdout.trim();
        const from = against ?? d.parents[0] ?? this.empty;
        const names = await git(["diff", ...DIFF_SAFE, "--name-status", "-z", "--no-renames", from, hash]), stats = await git(["diff", ...DIFF_SAFE, "--numstat", "-z", "--no-renames", from, hash]);
        if (this.context !== context || this.selected !== hash) return;
        const numbers = parseNumstat(stats.stdout);
        // What holds it (for-each-ref --contains walks every ref: slow in a big repository) comes
        // alongside: the details and files show first, the holds line once it is read.
        const holds = git(Sel.containsArgs(hash)).catch(() => null);
        const details = { ...d, holds: null };
        this.details = details; this.from = from;
        this.files = parseNameStatus(names.stdout).slice(0, 1000).map((f) => ({ ...f, ...(numbers.get(f.path) ?? { add: 0, del: 0, binary: false }) }));
        cx.notify();
        if (this.files.length) await this.openFile(this.files[0].path);
        cx.notify();
        const held = await holds;
        if (this.context === context && this.selected === hash && this.details === details && held?.code === 0) this.details = { ...details, holds: Sel.parseContains(held.stdout) };
      } catch (e) { if (this.selected === hash) this.error = String(e.message ?? e); }
      finally { cx.notify(); }
    });
    cx.notify();
  }

  // The uncommitted changes: their files against HEAD (new files too) and the first one's diff.
  selectUncommitted(cx) {
    const { root, on } = this, context = this.context, git = readGit(root, on);
    cx.spawn(async (cx) => {
      try {
        const names = await git(["--no-optional-locks", "diff", ...DIFF_SAFE, "HEAD", "--name-status", "-z", "--no-renames"]), stats = await git(["--no-optional-locks", "diff", ...DIFF_SAFE, "HEAD", "--numstat", "-z", "--no-renames"]);
        const fresh = await git(["--no-optional-locks", "ls-files", "--others", "--exclude-standard", "-z"]);
        if (this.context !== context || this.selected !== UNCOMMITTED) return;
        const numbers = parseNumstat(stats.stdout);
        const tracked = parseNameStatus(names.stdout).map((f) => ({ ...f, ...(numbers.get(f.path) ?? { add: 0, del: 0, binary: false }) }));
        const untracked = fresh.stdout.split("\0").filter(Boolean).map((path) => ({ status: "?", path, add: 0, del: 0, binary: false, untracked: true }));
        this.details = { uncommitted: true }; this.from = "HEAD";
        this.files = [...tracked, ...untracked].slice(0, 1000);
        if (this.files.length) await this.openFile(this.files[0].path);
      } catch (e) { if (this.selected === UNCOMMITTED) this.error = String(e.message ?? e); }
      finally { cx.notify(); }
    });
    cx.notify();
  }

  // A file of the selected commit: the host draws its diff against the commit's first parent (or
  // the commit compared with); an uncommitted file's against HEAD.
  async openFile(path) {
    const hash = this.selected, file = this.files?.find((f) => f.path === path);
    if (!hash || !file) return;
    this.file = path;
    const to = hash === UNCOMMITTED ? null : hash;
    await this.o.diff.open({ root: this.root, on: this.on, from: this.from, to, path, binary: file.binary, untracked: Boolean(file.untracked), still: () => this.selected === hash && this.file === path });
  }
  pickFile(path, cx) { cx.spawn(async (cx) => { await this.openFile(path); cx.notify(); }); }

  // A click on a commit: it alone (and its details); ⌘ adds it to the selection or takes it out,
  // ⇧ selects from the last one clicked to it (⌘⇧ adds those), as commitsel.js says.
  clickRow(k, cx) {
    const mods = this.downMods ?? {}, order = this.commits.map((c) => c.hash);
    this.downMods = null;
    const many = mods.platform || mods.control, range = mods.shift;
    if (k === UNCOMMITTED || (!many && !range)) { this.picks = k === UNCOMMITTED ? Sel.NONE : Sel.click(Sel.NONE, k); this.select(k, cx); return; }
    const from = this.picks?.selected.length ? this.picks : this.selected && this.selected !== UNCOMMITTED ? Sel.click(Sel.NONE, this.selected) : Sel.NONE;
    this.picks = range ? Sel.extend(from, k, order, { add: Boolean(many) }) : Sel.toggle(from, k);
    // The details are the clicked commit's while it is selected; taken out, the last one still
    // selected shows (none: no details), so the details never belong to a row that isn't marked.
    const show = Sel.isSelected(this.picks, k) ? k : this.picks.selected.at(-1) ?? null;
    if (show !== this.selected) { if (show) this.select(show, cx); else this.unselect(); }
    cx.notify();
  }

  // Right-click on a commit: the commit menu at the pointer; the rows that are the page's come
  // back here (awaitMenu) and run as flows (historyacts.js). The uncommitted row: its own menu.
  menu(hash, cx) {
    if (!this.root || !cx) return;
    if (hash === UNCOMMITTED) { this.flow(cx, (h) => uncommittedFlow(h, { staged: this.dirty.staged, count: this.dirty.count, where: this.where() })); return; }
    const c = this.commits.find((x) => x.hash === hash);
    if (!c) return;
    // On one of several selected: what can be done with all of them.
    if ((this.picks?.selected.length ?? 0) > 1 && Sel.isSelected(this.picks, hash)) {
      const commits = this.commits.filter((x) => Sel.isSelected(this.picks, x.hash)), order = this.commits.map((x) => x.hash), current = this.head.branch;
      this.flow(cx, async (h, cx) => selectionFlow(h, { commits, order, current, copy: this.copier(cx), clear: () => { this.picks = Sel.NONE; }, version: await gitVersion(this.on) }));
      return;
    }
    const { id, answer } = awaitMenu();
    const m = { root: this.root, on: this.on, sha: c.hash, short: c.hash.slice(0, 7), subject: c.subject, parents: c.parents, branch: this.head.branch, head: this.head.hash,
      names: { ...this.o.names, mod: this.o.mod }, refs: c.refs, selected: this.selected && this.selected !== UNCOMMITTED ? this.selected : null, site: this.site, ask: id };
    openOverlay({ mod: this.o.mod, kind: "popup", width: 280, height: menuHeight(menuItems(m), m.subject), props: { commitMenu: m } });
    cx.spawn(async (cx) => { const pick = await onPage(cx, answer); if (pick) this.picked(pick, m, cx); });
  }

  // A page row of the commit menu.
  picked(pick, m, cx) {
    const c = { sha: m.sha, short: m.short, subject: m.subject };
    if (pick.startsWith("ref-")) { const ref = m.refs?.[Number(pick.slice(4))]; if (ref) this.refMenu(ref, cx); return; }
    if (pick === "compare-selected") { if (m.selected) this.select(m.sha, cx, m.selected); return; }
    if (pick === "web") { this.openWeb(m.sha, cx); return; }
    if (pick === "worktree") {
      const on = this.on;
      this.flow(cx, (h) => worktreeFlow(h, { c, starter: this.o.starter?.(), open: (folder, argv) => run("space.new", { folder, ...(on ? { machine: on } : {}), ...(argv ? { argv } : {}) }) }));
      return;
    }
    if (pick === "reset") this.flow(cx, (h) => resetFlow(h, { c, branch: this.head.branch, ask: (mode) => openCommitAsk(m, "reset", mode) }));
    if (pick === "tag") { this.flow(cx, (h) => tagFlow(h, { c })); return; }
    if (pick === "copy") { const parents = m.parents; this.flow(cx, (h, cx) => copyCommitFlow(h, { c: { ...c, parents }, copy: this.copier(cx) })); return; }
    if (pick === "rewrite") this.flow(cx, (h, cx) => rewriteFlow(h, { c, branch: this.head.branch, openEditor: (data) => onPage(cx, openRebaseEditor(this.o.mod, data)) }));
  }

  /** A label's menu (a branch, a remote branch or a tag of a commit). */
  refMenu(ref, cx) {
    if (ref.kind === "head") return;
    const on = this.on, top = this.root;
    this.flow(cx, async (h) => refFlow(h, { ref, current: this.head.branch, operation: this.op, dirty: this.dirty.count > 0,
      version: await gitVersion(on), top, spaces: worktreeSpaces(on), placeOf: (p) => this.placeOf(p) }));
  }

  // Open on GitHub (or the remote's site): the browser here, whatever machine the repository is on.
  openWeb(sha, cx) {
    const h = repo(this.root, this.on);
    cx.spawn(async () => {
      const page = await webPage(h, sha, this.head.upstream?.split("/")[0] ?? null).catch(() => null);
      if (!page) { notify({ title: "No web page for this commit", body: "The remote isn't on a site the History page knows (GitHub, GitLab, Bitbucket or one like them).", level: "info", timeout: 4000 }); return; }
      const [program, ...args] = urlCommand(page.url, platform());
      const r = await exec(program, args).catch((e) => ({ code: 1, stderr: String(e) }));
      if (r.code !== 0) notify({ title: `Could not open ${page.site}`, body: brief(r.stderr) || page.url, level: "error" });
    });
  }

  // ⋯: worktrees, remotes, the reflog, fetching every remote, pruning tags (repoui.js).
  moreMenu(cx) {
    const sel = this.commits.find((c) => c.hash === this.selected) ?? null;
    const on = this.on, facts = { branch: this.head.branch ?? null, head: this.head.hash ?? null, upstream: this.head.upstream ?? null, top: this.root, selected: sel, bisecting: Boolean(this.bisect), operation: this.op };
    // Its menu, and the ones that follow, open under it (menuat.js); while one is open ⋯ is lit and
    // has no tooltip (it would show over the menu).
    const anchor = anchorOf("history-more");
    const atMore = (h, cx) => ({ ...h, choose: (spec) => { this.moreOpen = true; cx.notify(); return h.choose({ ...spec, anchor }).finally(() => { this.moreOpen = false; }); } });
    this.flow(cx, async (h, cx) => Repo.moreFlow(atMore(h, cx), { facts, version: await gitVersion(on),
      open: (folder) => run("space.new", { folder, ...(on ? { machine: on } : {}) }),
      copy: this.copier(cx), spaces: worktreeSpaces(on) }));
  }
  // What a flow's copy does: the text on the clipboard, and a note that says what (from a task's cx).
  copier(cx) { return (text, what) => { cx.write_to_clipboard(text); notify({ title: `Copied ${what}`, body: text.length > 80 ? `${text.slice(0, 80)}…` : text, level: "success", timeout: 2000 }); }; }

  // The repository in words, for the questions.
  where() { return `${this.root}${this.on ? ` on ${this.on}` : ""}`; }

  /** The host a flow gets (historyacts.js): this repository's runner, a reader (SAFE_ARGS: what a
   *  flow reads on its own), the questions, act, note, same. */
  host(cx) {
    const root = this.root, on = this.on, context = this.context;
    // Answers come back in the question's call: the flow takes them in this page's (onpage.js).
    const q = this.o.questions;
    return { ...repo(root, on), ...q, ask: (spec) => onPage(cx, q.ask(spec)), choose: (spec) => onPage(cx, q.choose(spec)), reads: reader(root, on),
      act: (kind, work) => this.act(kind, work, cx),
      note: (text) => { this.line = text; cx.notify(); },
      same: () => this.root === root && this.on === on && this.context === context };
  }
  flow(cx, fn) {
    if (!this.root || !this.o.questions) return;
    if (this.busy) { this.line = `Busy (${WORDS[this.busy] ?? this.busy}): try again once it's done`; cx.notify(); return; }
    cx.spawn(async (cx) => {
      try { await fn(this.host(cx), cx); }
      catch (e) { this.line = brief(String(e?.message ?? e)) || "That didn't work"; }
      cx.notify();
    });
  }
  // A git action of a flow: one at a time; then every page reloads (names.changed).
  act(kind, work, cx) {
    // One at a time: a second one says why nothing happened instead of being dropped.
    if (this.busy) { this.line = `Busy (${WORDS[this.busy] ?? this.busy}): try again once it's done`; cx.notify(); return; }
    const root = this.root;
    this.busy = kind; this.line = null; cx.notify();
    cx.spawn(async (cx) => {
      try { await work(); }
      catch (e) { if (this.root === root) this.line = `${WORDS[kind] ?? kind} failed: ${brief(String(e?.message ?? e)) || "no reason given"}`; }
      finally {
        this.busy = null;
        if (this.o.names.changed) setShared(this.o.names.changed, Date.now());
        this.seenChange = shared(this.o.names.changed);
        this.reload(cx); cx.notify();
      }
    });
  }

  // HEAD ▸: select the commit HEAD is on; when it isn't listed (a search, another branch), the
  // search goes and it is selected once loaded.
  jumpToHead(cx) {
    const at = this.commits.findIndex((c) => c.hash === this.head.hash);
    if (at >= 0) { this.select(this.head.hash, cx); this.list.scroll_to_item(at + this.extra(), "center"); return; }
    if (!this.head.hash) return;
    this.query = ""; this.search.set_value(""); this.all = false; this.pages = 1; this.jumpHead = true; this.reload(cx);
  }

  // The search box's author: or branch: (Author ▾, Branch ▾): `value` null takes it out.
  setFilter(key, value, cx) {
    const re = new RegExp(`(^|\\s)${key}:(?:"[^"]*"|\\S*)`, "g");
    const rest = this.search.value().replace(re, " ").replace(/\s+/g, " ").trim();
    const token = value ? `${key}:${/\s/.test(value) ? `"${value}"` : value}` : "";
    const next = [token, rest].filter(Boolean).join(" ");
    this.choosingAuthor = false; this.choosingBranch = false;
    this.search.set_value(next); this.query = next; this.pages = 1; this.typed++; this.reload(cx); cx.notify();
  }
  /** The uncommitted row shows: changes, and no search. */
  extra() { return this.dirty.count > 0 && !filtered(parseQuery(this.query)) && !parseQuery(this.query).branch ? 1 : 0; }

  // ---- Reveal requests (shared/reveal.js, reveals.js)

  // What the choice among the mod's copies needs to know of this one.
  revealFacts() {
    const p = props() ?? {};
    return { copy: this, kind: "history", tab: this.tab, root: this.tab ? p.root : this.root, on: this.tab ? p.on ?? null : this.on, roots: this.tab ? [] : this.o.repos.list() };
  }
  // A request seen by a render (once this copy has loaded), taken from a timer; a pending one once the
  // repository it switched to is loaded.
  takeReveal(cx) {
    const key = this.o.names.reveal;
    if (!key || !this.readOnce || this.loading) return;
    const req = requestOf(shared(key), "changes");
    if (req && req.at !== this.seenReveal) { this.seenReveal = req.at; cx.timer.after(1, (cx) => this.revealRequest(req, cx)); }
    const p = this.pendingReveal;
    if (p && this.root === p.root && this.on === p.on) { this.pendingReveal = null; cx.timer.after(1, (cx) => this.showPath(p.path, cx)); }
  }
  revealRequest(req, cx) {
    const ready = [...takers].filter((c) => c.readOnce).flatMap((c) => c.revealFacts());
    const mine = takersFor(req, ready, Boolean(pagePlace(layout(), this.o.mod, req.page))).find((x) => x.copy === this);
    if (!mine) return;
    const tab = (kind, extra) => openAsTab({ mod: this.o.mod, kind, root: req.root, on: req.on, props: { ...(props()?.palette ? { palette: props().palette } : {}), ...extra, root: req.root, on: req.on } }, cx);
    if (req.page === "changes") tab("review", { review: true });
    else if (mine.how === "show") this.showPath(req.path, cx);
    else if (mine.how === "pick") { this.pendingReveal = req; this.o.repos.choose(req.root); cx.notify(); }
    else tab("history", { view: "history" });
  }
  // path:<path> in the search ("" takes it out: the whole repository); the page comes forward (a
  // Changes block's History: that block).
  showPath(path, cx) {
    this.setFilter("path", path || null, cx);
    if (this.tab) showTab({ mod: this.o.mod, kind: "history", root: this.root, on: this.on });
    else bringForward(pagePlace(layout(), this.o.mod, "history"));
  }
  // A file row's right-click: Show in Files (Files Enhanced installed; not for a file this commit
  // deleted).
  // A commit's file: Open this version (fileat.js: a copy of it as that commit has it, here), and
  // Show in Files with Files Enhanced installed.
  fileRowMenu(f, cx) {
    if (!this.root) return;
    const root = this.root, on = this.on, gone = f.status === "D", rev = this.selected && this.selected !== UNCOMMITTED ? this.selected : null;
    const items = [...(rev ? [{ id: "version", label: "Open this version", disabled: gone, detail: gone ? "This commit deletes it" : `As ${rev.slice(0, 7)} has it, a copy opened here` }] : []),
      ...(installed("files") ? [{ id: "files", label: "Show in Files", disabled: gone, detail: gone ? "Deleted here" : undefined }] : [])];
    if (!items.length) return;
    this.flow(cx, async (h) => {
      const pick = await h.choose({ title: f.path.split("/").pop(), width: 280, items });
      if (pick === "files") askFiles({ full: `${root}/${f.path}`, on });
      if (pick === "version") await openVersionFlow(h, { rev, path: f.path, dir: `${appHome()}/${CACHE}`,
        prune: (dir) => exec("sh", ["-c", PRUNE_VERSIONS_SH, "sh", dir]).catch(() => null), open: async (file) => {
        const [program, ...args] = urlCommand(file, platform());
        const r = await exec(program, args).catch((e) => ({ code: 1, stderr: String(e) }));
        return r.code === 0 ? null : brief(r.stderr) || `${program} failed`;
      } });
    });
  }

  // ⤢: the history in a tab of its own (the one open already, if any); the panel gives way (tabs.js).
  openTab(cx) {
    if (this.root) openAsTab({ mod: this.o.mod, kind: "history", root: this.root, on: this.on,
      props: { ...(props() ?? {}), view: "history", root: this.root, on: this.on } }, cx);
  }

  // A line dragged (splitLine): { which, axis, key, from, start, size, min, max }. The size follows
  // the pointer and is kept in names.split[key] when the press ends (or the pointer leaves the page).
  splitTo(e, cx) {
    const d = this.splitDrag;
    if (!d) return;
    const size = between(d.start + along(e, d.axis) - d.from, d.min, d.max);
    if (size !== d.size) { d.size = size; cx.notify(); }
  }
  splitEnd(cx) {
    const d = this.splitDrag, split = this.o.names.split;
    if (!d) return;
    this.splitDrag = null;
    if (split && d.size !== d.start) setShared(split, { ...(shared(split) ?? {}), [d.key]: d.size });
    cx.notify();
  }
  // Side by side or stacked: the setting (names.layout, one for every copy), "auto" by the page's width.
  arrangement() {
    const layout = layoutOf(this.o.names.layout ? shared(this.o.names.layout) : null);
    return { layout, side: sideBySide(layout, this.size?.width ?? 368) };
  }
  // The arrangement's button, at the right end of the commit's files row (it arranges the commit).
  arrangeButton(t) { const { layout, side } = this.arrangement(); return this.layoutButton(t, layout, side); }
  // The arrangement's button: its icon shows the one in use (a box split by a vertical line: side by
  // side; by a horizontal one: stacked). Its id names its state, so the tooltip's words follow it
  // (GPUI builds a tooltip from the frame its hover began in).
  layoutButton(t, layout, side) {
    const id = `history-layout-${layout}${layout === "auto" ? `-${side ? "side" : "stacked"}` : ""}`;
    return iconButton(t, id, `mods/${this.o.mod}/layout-${side ? "side" : "stacked"}.svg`, (cx) => this.chooseLayout(cx, id), { tip: this.layoutMenuOpen ? null : layoutTip(layout, side), label: layoutTip(layout, side), menu: true, on: this.layoutMenuOpen });
  }
  // A click on it (`id`): a menu under it (menuat.js), the setting in use checked; a pick sets it for
  // every copy.
  chooseLayout(cx, id = null) {
    const key = this.o.names.layout;
    if (!key) return;
    const now = layoutOf(shared(key));
    // While its menu is open the button has no tooltip (it would show over the menu).
    this.layoutMenuOpen = true; cx.notify();
    cx.spawn(async (cx) => {
      const picked = await onPage(cx, this.o.questions.choose({ title: "History layout", width: 220, items: LAYOUTS.map((id) => ({ id, label: LAYOUT_NAMES[id], checked: id === now })), anchor: id ? anchorOf(id) : null })).finally(() => { this.layoutMenuOpen = false; });
      if (LAYOUTS.includes(picked) && picked !== layoutOf(shared(key))) setShared(key, picked);
      cx.notify();
    });
  }

  // A line: a 1 px rule in a 7 px strip (LINE) that takes the press. `which`: "list", the one
  // between the commits and the commit (axis "x": left and right, side by side; "y": up and down,
  // stacked), or "info", the one between the commit's information and its diff (always "y").
  // `size`: what it moves now, kept between `min` and `max`.
  splitLine(t, { which, axis, key, size, min, max }) {
    const across = axis === "x", on = this.splitDrag?.which === which;
    return div().id(which === "info" ? "history-info-line" : "history-split-line").flex_none().relative().hover((s) => s.bg(t.hover))
      .when(across, (e) => e.w(LINE).h_full().cursor_col_resize()).when(!across, (e) => e.h(LINE).w_full().cursor_row_resize())
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        this.splitDrag = { which, axis, key, from: along(e, axis), start: size, size, min, max };
        cx.notify();
      })
      .child(div().absolute().bg(on ? t.accent : t.border)
        .when(across, (e) => e.top(0).bottom(0).left(3).w(1)).when(!across, (e) => e.left(0).right(0).top(3).h(1)));
  }

  // A column's line over the list (one-line rows): `which` "author", between the subject and the
  // author, or "date", between the author and the date; `right`: its 7 px strip's offset from the
  // list's right edge; `cols`: the widths in use; `room`: what the author and the date can take
  // (colsRoom); `place`: "panel" or "tab", whose widths it keeps. Seen only while the pointer is over
  // it or it is dragged, as the page's other lines look then (splitLine): the strip in `hover` and a
  // 1 px rule; a double-click gives both columns their default widths.
  colLine(t, { which, right, cols, room, place }) {
    const on = this.colDrag?.which === which, shown = on || this.colHover === which;
    return div().id(`history-col-${which}`).absolute().top(0).bottom(0).right(right).w(LINE).cursor_col_resize()
      .hover((s) => s.bg(t.hover)).when(on, (e) => e.bg(t.hover))
      .when(!this.colDrag, (e) => e.tooltip("Drag to resize the columns · double-click: their default widths"))
      .on_hover((over, cx) => { const was = this.colHover; this.colHover = over ? which : was === which ? null : was; if (this.colHover !== was) cx.notify(); })
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        if ((e?.click_count ?? 1) >= 2) { this.colDrag = null; this.colReset(place, cx); return; }
        this.colDrag = { which, place, from: e.position.x, start: { ...cols }, size: { ...cols }, room };
        cx.notify();
      })
      .when(shown, (e) => e.child(div().absolute().top(0).bottom(0).left(3).w(1).bg(on ? t.accent : t.border)));
  }
  // A column's line dragged: "author" trades the subject's width for the author's (the subject keeps
  // ROW.subject); "date" trades the author's for the date's (the other line stays where it is).
  colTo(e, cx) {
    const d = this.colDrag;
    if (!d) return;
    const dx = e.position.x - d.from, { author: a0, date: d0 } = d.start;
    let author = a0, date = d0;
    if (d.which === "author") author = between(a0 - dx, COLS.author, d.room - d0);
    else { date = between(d0 - dx, COLS.date, a0 + d0 - COLS.author); author = a0 + d0 - date; }
    if (author !== d.size.author || date !== d.size.date) { d.size = { author, date }; cx.notify(); }
  }
  // The press ended (or the pointer left the page): both widths kept for the place (names.split).
  colEnd(cx) {
    const d = this.colDrag, split = this.o.names.split;
    if (!d) return;
    this.colDrag = null;
    if (split && (d.size.author !== d.start.author || d.size.date !== d.start.date)) {
      setShared(split, { ...(shared(split) ?? {}), [`${d.place}-author`]: d.size.author, [`${d.place}-date`]: d.size.date });
    }
    cx.notify();
  }
  // A double-click on a column's line: the place's kept widths go, so the defaults are back.
  colReset(place, cx) {
    const split = this.o.names.split, kept = split ? { ...(shared(split) ?? {}) } : null;
    if (kept && (`${place}-author` in kept || `${place}-date` in kept)) {
      delete kept[`${place}-author`]; delete kept[`${place}-date`];
      setShared(split, kept);
    }
    cx.notify();
  }

  // Abort what stopped (a merge, rebase, cherry-pick, revert or git am).
  abort(cx) {
    const op = this.op, root = this.root, on = this.on;
    if (!op || !root) return;
    cx.spawn(async (cx) => {
      const r = await exec("git", [op, "--abort"], { cwd: root, on }).catch((e) => ({ code: 1, stderr: String(e) }));
      if (r.code !== 0) notify({ title: `Could not abort the ${op}`, body: brief(r.stderr || r.stdout).slice(0, 300), level: "error" });
      this.reload(cx);
    });
  }

  // j/k or the arrows move the selection.
  key(e, cx) {
    if (this.searching || e.modifiers?.platform || e.modifiers?.control || e.modifiers?.alt) return false;
    const d = e.key === "j" || e.key === "down" ? 1 : e.key === "k" || e.key === "up" ? -1 : 0;
    if (!d || !this.commits.length) return false;
    const at = this.commits.findIndex((c) => c.hash === this.selected);
    const next = Math.max(0, Math.min(this.commits.length - 1, at < 0 ? 0 : at + d));
    if (this.commits[next].hash !== this.selected) { this.select(this.commits[next].hash, cx); this.list.scroll_to_item(next + this.extra()); }
    return true;
  }

  // A ref's chip: the current branch filled; branches blue, remotes magenta, tags yellow, a detached HEAD the accent.
  refChip(r, t) {
    const color = r.kind === "head" ? t.accent : r.kind === "tag" ? t.ansi3 : r.kind === "remote" ? t.ansi5 : t.ansi4;
    return chip(t, r.kind === "tag" ? `◇ ${r.name}` : r.name, color, r.current);
  }

  // Row i's lanes as paths (graph.js); a search draws a dot.
  lanesOf(i, t, H, cy, bg, max) {
    const c = this.commits[i], g = this.graph?.[i];
    if (!g || this.flat) return div().w(18).h(H).flex_none().flex().items_center().justify_center().child(div().size(7).rounded(4).bg(t.accent));
    const d = drawRow(c, g, { height: H, cy }), color = (k) => t[LANES[k % LANES.length]] ?? t.accent;
    const parts = [], byColor = new Map();
    for (const l of d.lines) (byColor.get(l.color) ?? byColor.set(l.color, []).get(l.color)).push(l.d);
    try {
      const paint = (path, c) => window.paint_path(path, c).absolute().top(0).left(0).w(d.width).h(H);
      for (const [k, list] of byColor) parts.push(paint(list.reduce((b, cmds) => trace(b, cmds), PathBuilder.stroke(1.5)).build(), color(k)));
      const { x, y, kind } = d.dot, dot = color(d.dot.color);
      if (kind === "head") parts.push(paint(disc(x, y, DOT + 2), dot), paint(disc(x, y, 2), bg));
      else if (kind === "merge") parts.push(paint(disc(x, y, DOT + 1), dot), paint(disc(x, y, DOT - 1.5), bg));
      else parts.push(paint(disc(x, y, DOT), dot));
    } catch (e) {
      // Paths can't be drawn here: dots from now on.
      this.flat = true; console.log(`history: lanes drawn as dots (${e})`);
      return this.lanesOf(i, t, H, cy, bg, max);
    }
    // As wide as the widest row's lanes on every row (lanesWidth), so the hash and what follows it
    // line up from row to row; a row's own width moved them by a lane beside a branch.
    return div().w(Math.min(Math.max(d.width, this.lanesWidth()), max)).h(H).flex_none().relative().overflow_hidden().children(parts);
  }

  // The uncommitted changes' row: a hollow dot where HEAD's lane is, and how many files.
  uncommittedRow(t, H, one) {
    const selected = this.selected === UNCOMMITTED, d = this.dirty;
    const words = `${d.count} uncommitted file${d.count === 1 ? "" : "s"}${d.staged ? ` · ${d.staged} staged` : ""}`;
    return h_flex().w_full().h(H).flex_none().pl(4).pr(8).gap(6).items_center().cursor_pointer().bg(selected ? t.selected : CLEAR).border_l(2).border_color(selected ? t.accent : CLEAR)
      // Its ring on the first lane, in a box as wide as the commits' graph (lanesWidth): the hash
      // column and the words line up with theirs. A search's flat list has 18 px dots, centered.
      .child(this.flat || !this.graph
        ? div().w(18).h(H).flex_none().flex().items_center().justify_center().child(div().size(9).rounded(5).border_1().border_color(t.accent))
        : div().w(this.lanesWidth()).h(H).flex_none().relative().child(div().absolute().left(LANE - 4.5).top(H / 2 - 4.5).size(9).rounded(5).border_1().border_color(t.accent)))
      .when(one, (e) => e.child(div().w(ROW.hash).flex_none().text_size(11).text_color(t.dim).child("·······")))
      .child(div().flex_1().min_w(0).truncate().italic().text_color(t.muted).child(words))
      .child(div().flex_none().text_size(10.5).text_color(t.dim).child("right-click: Commit · Stash · Discard"));
  }

  // Author ▾: the authors of what is listed, most commits first; one picked goes in the search box.
  authorFilter(t) {
    const now = parseQuery(this.query).author, counts = new Map();
    for (const c of this.commits) counts.set(c.author, (counts.get(c.author) ?? 0) + 1);
    const people = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 30);
    const box = button(t, "history-author", now ? `Author: ${now}` : withChevron("Author"), () => {}, { small: true, kind: now ? "primary" : "plain", tip: this.choosingAuthor ? null : "Only one person's commits (author:\"name\" in the search)" });
    return Popover.new("history-authors").open(this.choosingAuthor).on_open_change((open, cx) => { this.choosingAuthor = open; cx.notify(); }).trigger(box)
      .content(listCard(t, 260, 360, [CARD_HEADING, CARD_ONE, ...people.map(() => CARD_ROW)])
        .child(heading(t, "Commits by").h(CARD_HEADING).flex_none())
        .child(choice(t, "history-author-any", { on: (cx) => this.setFilter("author", null, cx), chosen: !now }).h(CARD_ONE).flex_none().child(lines2(t, "Anyone", null)).child(tick(t, !now)))
        .children(people.map(([name, n], i) => choice(t, `history-author-${i}`, { on: (cx) => this.setFilter("author", name, cx), chosen: now === name }).h(CARD_ROW).flex_none()
          .child(lines2(t, name, `${n} listed`)).child(tick(t, now === name)))));
  }

  // The branch menu: which history shows, its button says (`main ▾`, `All branches ▾`, a branch's
  // name): the current branch and its upstream, every branch, remote branch and tag (All branches),
  // or one branch (branch:name in the search), up to 60 by their last commit.
  branchFilter(t) {
    const now = parseQuery(this.query).branch, all = !now && this.all, current = !now && !all;
    const branch = this.head.branch ?? "HEAD", upstream = this.head.upstream;
    const box = button(t, "history-branch", withChevron(now ?? (all ? "All branches" : branch)), () => {}, { small: true, kind: current ? "plain" : "primary",
      tip: this.choosingBranch ? null : "Which history: the current branch, all branches, or one branch" });
    // A branch's row is one line; the checked-out one says so on a second, and one checked out in
    // another worktree says where (read when the menu opens: readAway).
    const out = (name) => name === this.head.branch, away = (name) => (out(name) ? null : this.branchAway.get(name) ?? null);
    const tall = (name) => (out(name) || away(name) ? CARD_ROW : CARD_ONE);
    const second = (name) => (out(name) ? "checked out" : away(name) ? whereWords(away(name), this.placeOf(away(name).path)) : null);
    const rows = [CARD_HEADING, CARD_ROW, CARD_ROW, ...(this.branchNames.length ? [7] : []), ...this.branchNames.map(tall)];
    return Popover.new("history-branches").open(this.choosingBranch).on_open_change((open, cx) => { this.choosingBranch = open; if (open) this.readAway(cx); cx.notify(); }).trigger(box)
      .content(listCard(t, 260, 420, rows)
        .child(heading(t, "The history of").h(CARD_HEADING).flex_none())
        .child(choice(t, "history-branch-head", { on: (cx) => this.showHistoryOf(null, false, cx), chosen: current }).h(CARD_ROW).flex_none()
          .child(lines2(t, "Current branch", upstream ? `${branch} and ${upstream}` : branch)).child(tick(t, current)))
        .child(choice(t, "history-branch-all", { on: (cx) => this.showHistoryOf(null, true, cx), chosen: all }).h(CARD_ROW).flex_none()
          .child(lines2(t, "All branches", "Every branch, remote branch and tag")).child(tick(t, all)))
        .when(this.branchNames.length > 0, (e) => e.child(rule(t)))
        .children(this.branchNames.map((name, i) => choice(t, `history-branch-${i}`, { on: (cx) => this.showHistoryOf(name, false, cx), chosen: now === name }).h(tall(name)).flex_none()
          .child(lines2(t, name, second(name))).child(tick(t, now === name)))));
  }
  // The branches checked out in another worktree (worktrees.js elsewhere), read each time the branch
  // menu opens: checking a branch out there moves no ref here, so the page's reads don't see it.
  readAway(cx) {
    const { root, on } = this, context = this.context;
    if (!root) return;
    cx.spawn(async (cx) => {
      const list = await readWorktrees(reader(root, on), await gitVersion(on)).catch(() => null);
      if (!list || this.root !== root || this.on !== on || this.context !== context) return;
      this.branchAway = elsewhere(list, root);
      cx.notify();
    });
  }
  // A worktree's folder as the menus show it: ~ for the home folder, on this computer.
  placeOf(path) { return this.on ? path : tilde(path, home()); }
  // A row of the branch menu: one branch (`branch`), all of them (`all`), or the current one.
  showHistoryOf(branch, all, cx) { this.all = all; this.setFilter("branch", branch, cx); }

  // Whether the repository has git's commit-graph (a file, or a chain of them, in its objects).
  async hasCommitGraph(root, on) {
    const r = await exec("sh", ["-c", `${SAFE_GIT_SH}d=$(git rev-parse --git-common-dir) || exit 1; [ -e "$d/objects/info/commit-graph" ] || [ -e "$d/objects/info/commit-graphs/commit-graph-chain" ]`], { cwd: root, on });
    return r.code === 0;
  }
  // Write it: git commit-graph write --reachable (git gc writes the same file); then the page loads again.
  writeCommitGraph(cx) {
    const root = this.root, on = this.on;
    this.act("commitGraph", async () => {
      const r = await repo(root, on).git(["commit-graph", "write", "--reachable"]);
      if (r.code !== 0) throw new Error(brief(r.stderr) || "git commit-graph write failed");
      if (this.slow === root) this.slow = null;
    }, cx);
  }

  // The widest lanes a one-line row draws (graph.js; at most 220 px), or a search's dot (18 px).
  lanesWidth() {
    const g = this.graph;
    if (!g || this.flat) return 18;
    if (this.widest?.graph !== g) {
      let n = 1;
      for (const r of g) n = Math.max(n, laneSpan(r));
      this.widest = { graph: g, px: Math.min(220, LANE * n) };
    }
    return this.widest.px;
  }

  // A commit's row: one line (lanes, hash, refs, subject, author, when) when the list has room for
  // it (historylayout.js oneLine), else two. The refs never draw over the author: the part they share
  // with the subject clips what doesn't fit.
  row(i, t, H, one, font) {
    // Marked: the selection when there is one (⌘ and ⇧ clicks), else the commit whose details show.
    const c = this.commits[i], selected = this.picks?.selected.length ? Sel.isSelected(this.picks, c.hash) : c.hash === this.selected;
    // `dim` doesn't read on the selected row's tint: its hints are `muted` there.
    const dim = selected ? t.muted : t.dim;
    const mark = this.ahead.has(c.hash) ? ["↑", t.ansi2] : this.behind.has(c.hash) ? ["↓", t.ansi3] : null;
    const chips = c.refs.slice(0, 3).map((r) => this.refChip(r, t)), extra = c.refs.length - chips.length;
    const graph = this.lanesOf(i, t, H, one ? H / 2 : 12, selected ? t.selected : t.surface, one ? 220 : 120);
    const top = h_flex().min_w(0).overflow_hidden().gap(4).items_center()
      .when(Boolean(mark), (e) => e.child(div().flex_none().font_bold().text_size(11).text_color(readable(t, mark[1], [selected ? t.selected : t.surface, t.hover])).child(mark[0])))
      .children(chips)
      .when(extra > 0, (e) => e.child(div().flex_none().text_size(10).text_color(dim).child(`+${extra}`)))
      .child(div().flex_1().min_w(0).truncate().child(c.subject || "(no message)"));
    const row = h_flex().w_full().h(H).flex_none().pl(4).pr(8).gap(6).items_center().cursor_pointer().bg(selected ? t.selected : CLEAR).border_l(2).border_color(selected ? t.accent : CLEAR);
    if (one) {
      return row.child(graph)
        .child(div().w(ROW.hash).flex_none().font_family(font).text_size(11).text_color(dim).child(c.hash.slice(0, 7)))
        .child(top.flex_1())
        .child(div().w(this.cols?.author ?? ROW.author).flex_none().truncate().text_size(11).text_color(t.muted).child(c.author))
        .child(div().w(this.cols?.date ?? ROW.date).flex_none().truncate().text_size(11).text_color(dim).child(dateText(c.time, this.cols?.date ?? ROW.date)));
    }
    return row.child(graph).child(v_flex().flex_1().min_w(0).gap(1)
      .child(top)
      .child(h_flex().min_w(0).gap(6).text_size(10.5).text_color(dim)
        .child(div().flex_none().font_family(font).child(c.hash.slice(0, 7)))
        .child(div().min_w(0).truncate().child(c.author))
        .child(div().flex_none().child(ago(c.time)))));
  }

  // The selected commit: message, people, dates, parents, refs, then its files. The message's body
  // is folded: "Show full message" opens it in place (the area scrolls as one).
  info(t, font) {
    const d = this.details;
    if (!d) return div().p(12).text_size(12).text_color(t.dim).child(this.error ?? "Reading the commit…");
    if (d.uncommitted) return this.uncommittedInfo(t);
    const [subject, ...rest] = d.message.split("\n"), body = rest.join("\n").replace(/^\s*\n/, "").trimEnd();
    const person = (who, email, time) => `${who} <${email}> · ${when(time)} (${ago(time)})`;
    const hashLink = (id, text, tip, action) => div().id(id).px(4).rounded(4).font_family(font).text_color(t.accent).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(tip).on_click(action).child(text);
    return v_flex().gap(6).p(12)
      .child(div().font_semibold().text_size(13).whitespace_normal().child(subject || "(no message)"))
      .when(Boolean(body), (e) => e.child(div().id("history-body-toggle").flex_none().self_start().px(4).rounded(4).text_size(11.5).text_color(t.accent).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.bodyOpen = !this.bodyOpen; cx.notify(); })
        .child(this.bodyOpen ? "Hide full message" : "Show full message")))
      .when(Boolean(body) && this.bodyOpen, (e) => e.child(v_flex().id("history-body").text_size(12).text_color(t.muted).whitespace_normal().children(body.split("\n").map((l) => div().min_h(14).child(l || " ")))))
      .child(h_flex().flex_wrap().gap(6).items_center().text_size(11).text_color(t.dim)
        .child(hashLink("history-sha", d.hash.slice(0, 10), "Copy the full SHA", (_e, cx) => { cx.write_to_clipboard(d.hash); notify({ title: "Copied the SHA", body: d.hash.slice(0, 7), level: "success", timeout: 2000 }); }))
        .children(d.refs.map((r, k) => (r.kind === "head" ? this.refChip(r, t)
          : div().id(`history-ref-${k}`).cursor_pointer().tooltip(`${r.name}: check out, merge, push, delete…`).on_click((_e, cx) => this.refMenu(r, cx)).child(this.refChip(r, t))))))
      .when(Boolean(d.holds), (e) => e.child(div().id("history-holds").text_size(11).text_color(t.dim).whitespace_normal().child(holdsWords(d.holds))))
      .when(Boolean(this.comparing), (e) => e.child(h_flex().gap(6).items_center().px(8).py(4).rounded(6).bg(t.raised).text_size(11).text_color(t.muted)
        .child(div().flex_1().min_w(0).whitespace_normal().child(`Compared with ${this.comparing.slice(0, 7)}, not its parent: what changed from that commit to this one`))
        .child(iconButton(t, "history-compare-off", CLOSE, (cx) => this.select(d.hash, cx), { tip: "Against its parent again" }))))
      .child(div().text_size(11).text_color(t.dim).whitespace_normal().child(`Author: ${person(d.author, d.email, d.authorTime)}`))
      .when(d.committer !== d.author || d.commitTime !== d.authorTime, (e) => e.child(div().text_size(11).text_color(t.dim).whitespace_normal().child(`Committer: ${person(d.committer, d.committerEmail, d.commitTime)}`)))
      .child(h_flex().flex_wrap().gap(4).items_center().text_size(11).text_color(t.dim)
        .child(d.parents.length ? (d.parents.length > 1 ? "Parents:" : "Parent:") : "Root commit (against the empty tree)")
        .children(d.parents.map((p, k) => hashLink(`history-parent-${k}`, p.slice(0, 7), "Show this parent", (_e, cx) => this.goTo(p, cx)))));
  }

  // The information area: the message's part (it scrolls) over the files' part, each a height of its
  // own (historylayout.js infoParts), so the files' count row is always seen.
  infoArea(t, font, infoH) {
    const parts = this.details && this.files ? infoParts(infoH, this.files.length) : { message: infoH, files: 0 };
    return v_flex().id("history-info").h(infoH).flex_none()
      .child(div().id("history-info-text").h(parts.message).flex_none().overflow_y_scrollbar().child(this.info(t, font)))
      .when(parts.files > 0, (e) => e.child(v_flex().id("history-files").h(parts.files).flex_none().min_h(0).child(this.filesPart(t, font))));
  }

  // The files of the selected commit (or of the uncommitted changes): their count row (the layout
  // button at its end), then a virtual list of them, a row each (only the rows on screen are built:
  // a click on one is the list's, rows can't have handlers); fixed heights (historylayout.js FILES).
  filesPart(t, font) {
    const d = this.details, files = this.files ?? [], here = Boolean(d.uncommitted);
    const row = h_flex().h(FILES.head).flex_none().gap(8).items_center().border_t(1).border_color(t.border).text_size(11);
    let head;
    if (here) {
      const n = this.dirty;
      head = row.text_color(t.dim).child(div().flex_1().min_w(0).truncate().child(`${n.count} file${n.count === 1 ? "" : "s"} changed${n.staged ? `, ${n.staged} staged` : ""}, against HEAD`));
    } else {
      const add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0);
      head = row.text_color(t.muted).child(`${files.length} file${files.length === 1 ? "" : "s"}${d.parents.length > 1 ? " against the first parent" : ""}`)
        .child(div().text_color(readable(t, t.ansi2)).child(`+${add}`)).child(div().text_color(readable(t, t.ansi1)).child(`−${del}`)).child(div().flex_1());
    }
    const list = v_virtual_list("history-files-list", files.length, FILES.row + FILES.gap, (k) => files[k].path, (range) => {
      const rows = [];
      for (let k = range.start; k < range.end; k++) rows.push(this.fileRow(t, font, files[k], k, here));
      return rows;
    }).size_full()
      .on_item_click((path, cx) => this.pickFile(path, cx))
      .on_item_secondary_click((path, _e, cx) => { const f = files.find((x) => x.path === path); if (f) this.fileRowMenu(f, cx); });
    return v_flex().size_full().min_h(0).px(12).pb(FILES.pad).child(head.child(this.arrangeButton(t)))
      .child(div().id("history-files-area").flex_1().min_h(0).relative().child(list)
        .child(Scrollbar.vertical("history-files-list").viewport_from_layout().absolute().top(0).left(0).right(0).bottom(0)));
  }

  // A file's row in the list: its status letter, folder and name, binary, and its counts; FILES.row
  // tall with FILES.gap over it (as the rows were spaced in a column).
  fileRow(t, font, f, k, here) {
    const parts = f.path.split("/"), name = parts.pop(), status = here && f.status === "?" ? "U" : f.status;
    const added = f.status === "A" || (here && f.status === "?");
    return div().w_full().h(FILES.row + FILES.gap).pt(FILES.gap).flex_none().child(h_flex().id(`history-file-${k}`).w_full().h(FILES.row).px(6).gap(8).items_center().rounded(6).cursor_pointer().when(this.file === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
          .child(div().w(12).text_size(11).text_color(this.fileInk(t, added ? t.ansi2 : f.status === "D" ? t.ansi1 : t.blocked, f)).child(status))
          .child(h_flex().flex_1().min_w(0).child(div().text_color(this.file === f.path ? t.muted : t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().min_w(0).truncate().when(here, (e) => e.font_family(font)).child(name)))
          .when(f.binary, (e) => e.child(div().text_size(10.5).text_color(t.dim).child("binary")))
          .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(this.fileInk(t, t.ansi2, f)).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(this.fileInk(t, t.ansi1, f)).child(`−${f.del}`))));
  }

  // A file row's mark or count: its color where it reads on the row (selected or under the pointer),
  // else the foreground.
  fileInk(t, color, f) { return readable(t, color, [this.file === f.path ? t.selected : t.surface, t.hover]); }

  // The uncommitted row's details: the title and its actions (the files, each against HEAD, in the
  // files' part under them).
  uncommittedInfo(t) {
    const act = (id, label, fn, o = {}) => button(t, id, label, (cx) => fn(cx), { small: true, ...o });
    return v_flex().gap(6).p(12)
      .child(div().font_semibold().text_size(13).child("Uncommitted changes"))
      .child(h_flex().gap(6).flex_wrap()
        .child(act("history-uncommitted-commit", "Commit…", (cx) => this.menuAction("commit", cx)))
        .child(act("history-uncommitted-stash", "Stash…", (cx) => this.menuAction("stash", cx)))
        .child(act("history-uncommitted-discard", "Discard all…", (cx) => this.menuAction("discard", cx), { kind: "danger" })));
  }
  // The uncommitted changes' Commit…, Stash…, Discard all… straight from their buttons.
  menuAction(which, cx) {
    this.flow(cx, (h) => uncommittedFlow(h, { staged: this.dirty.staged, count: this.dirty.count, where: this.where(), pick: which }));
  }

  // A parent clicked: select it, and bring its row on screen when it is listed.
  goTo(hash, cx) {
    const at = this.commits.findIndex((c) => c.hash === hash);
    this.select(hash, cx);
    if (at >= 0) this.list.scroll_to_item(at + this.extra(), "center");
  }

  // The search box and the filters. Below FILTERS_IN_ONE_ROW px they don't fit one row (in a 370 px
  // panel the search box would be left a few letters wide): the search box gets a row of its own, the
  // buttons the row under it.
  filterBar(t, width) {
    const search = div().flex_1().min_w(0).child(field(t, "history-search", Input.new(this.search).w_full().text_size(12).text_color(t.foreground), this.searching));
    const buttons = [this.authorFilter(t), this.branchFilter(t),
      button(t, "history-head", "HEAD", (cx) => this.jumpToHead(cx), { small: true, busy: !this.head.hash, tip: "Select the commit HEAD is on" })];
    if (width >= FILTERS_IN_ONE_ROW) return h_flex().id("history-filters").h(38).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border).child(search).children(buttons);
    return v_flex().id("history-filters").flex_none().px(10).py(5).gap(5).border_b(1).border_color(t.border)
      .child(h_flex().h(28).min_w(0).items_center().child(search))
      .child(h_flex().h(26).min_w(0).gap(8).items_center().overflow_hidden().children(buttons));
  }

  render(cx) {
    const t = theme(), font = this.o.codeFont(), diff = this.o.diff;
    // A new place, or something changed by an action: load (never from here directly).
    if (this.follow()) this.refresh(cx);
    const changedAt = shared(this.o.names.changed);
    if (changedAt !== this.seenChange) { this.seenChange = changedAt; this.refresh(cx); }
    this.takeReveal(cx);
    diff.sync(cx);
    const width = this.size?.width ?? 368, height = this.size?.height ?? 700;
    const { layout, side } = this.arrangement();
    // Stacked: the list takes 38% of what the bars leave, the commit the rest. Side by side: the
    // list at the left, the commit beside it. The commit: its information in an area of its own
    // height (40% of the commit's), scrolling, a line, the diff under it (historylayout.js).
    const body = height - 80 - (this.op ? 34 : 0) - (this.bisect ? 32 : 0), listKey = `${this.tab ? "tab" : "panel"}-${side ? "h" : "v"}`, infoKey = `${listKey}-info`, split = this.o.names.split;
    // A line's size: being dragged, else kept from a drag (names.split), else a share of the page.
    const kept = (key) => (this.splitDrag?.key === key ? this.splitDrag.size : split ? shared(split)?.[key] : null);
    const { listW, listH, listMax, infoH, infoMax } = sizes({ width, body, side, list: kept(listKey), info: kept(infoKey) });
    // One-line or two-line rows by the list's own width: beside the commit its width (also before
    // one is picked, so a pick doesn't change the rows), stacked the page's (less its border).
    // The author's and the date's widths, kept per place (panel, tab) from a drag of their lines
    // (colLine); one narrower than its default lets the rows stay one line in a narrower list.
    const place = this.tab ? "tab" : "panel", keptCols = split ? { author: shared(split)?.[`${place}-author`], date: shared(split)?.[`${place}-date`] } : null;
    const rowsW = side ? listW : width - 2, lanes = this.lanesWidth(), one = oneLine(rowsW, lanes, keptCols);
    // What the rows use (row()): being dragged, else the kept widths fitted to the list (columns).
    const cols = this.colDrag?.size ?? columns(keptCols, rowsW, lanes);
    this.cols = cols;
    const H = one ? 26 : 40, extra = this.extra(), count = extra + this.commits.length + (this.more ? 1 : 0);
    const keyOf = (i) => (i < extra ? UNCOMMITTED : i - extra < this.commits.length ? this.commits[i - extra].hash : "more");
    const list = v_virtual_list("history-commits", count, H, keyOf, (range) => {
      const rows = [];
      for (let i = range.start; i < range.end; i++) rows.push(i < extra ? this.uncommittedRow(t, H, one) : i - extra < this.commits.length ? this.row(i - extra, t, H, one, font)
        : h_flex().w_full().h(H).flex_none().items_center().justify_center().text_size(12).text_color(t.accent).cursor_pointer().child(`Load ${PAGE} more`));
      return rows;
    }).size_full().track_scroll(this.list)
      .on_item_click((k, cx) => { if (k === "more") this.loadMore(cx); else this.clickRow(k, cx); })
      .on_item_secondary_click((k, _e, cx) => { if (k !== "more") this.menu(k, cx); });
    if (this.headWanted && this.head.hash) {
      this.headWanted = false;
      const at = this.commits.findIndex((c) => c.hash === this.head.hash);
      if (at >= 0) cx.timer.after(1, (cx) => { this.select(this.head.hash, cx); this.list.scroll_to_item(at + this.extra(), "center"); });
    }
    const waiting = this.loading || (this.context !== undefined && !this.root && !this.error && !this.unread);
    const empty = !this.commits.length ? div().absolute().top(8).px(12).text_size(12).text_color(t.dim)
      .child(this.error ?? (this.unread ? "Its history shows once it is read" : waiting ? "Reading the history…" : this.query.trim() ? "No commit matches" : "No commits yet")) : null;
    // A row's click has no modifiers of its own: the press before it says whether ⌘ or ⇧ was held.
    const listArea = div().id("history-list-area").relative().min_h(0).min_w(0).on_mouse_down("left", (e) => { this.downMods = e?.modifiers ?? {}; })
      .child(list).child(Scrollbar.vertical("history-commits").viewport_from_layout().absolute().top(0).left(0).right(0).bottom(0))
      .when(Boolean(empty), (e) => e.child(empty))
      // The lines between the subject and the author, and between the author and the date, over the
      // list (its rows can't have handlers): measured from its right edge, where the row's 8 px
      // padding, the date, a 6 px gap and the author are; each in the middle of its gap.
      .when(one && this.commits.length > 0, (e) => e
        .child(this.colLine(t, { which: "author", right: 13 + cols.date + cols.author, cols, room: colsRoom(rowsW, lanes), place }))
        .child(this.colLine(t, { which: "date", right: 7 + cols.date, cols, room: colsRoom(rowsW, lanes), place })));
    // The information is one scroll area with a height of its own: sized by max_h alone it would show
    // more or less as the window changed but never scroll; nothing in it scrolls by itself.
    const details = this.selected ? v_flex().min_h(0).min_w(0)
      .child(this.infoArea(t, font, infoH))
      .child(this.splitLine(t, { which: "info", axis: "y", key: infoKey, size: infoH, min: MIN.info, max: infoMax }))
      .child(div().flex_1().min_h(0).flex().child(diff.element(t, this.file ? null : this.files?.length === 0 ? "No file changed (an empty commit)" : this.details ? "Select a file to see its diff" : ""))) : null;
    const branch = this.head.branch ?? (this.head.hash ? `detached at ${this.head.hash.slice(0, 7)}` : "");
    const gear = settingsGear("history-settings", "changes"), named = this.titled?.(t) ?? null;
    return diff.frame(this.o.focus.track(v_flex().id("history").size_full().min_h(0).relative().overflow_hidden().rounded(10).border_1().border_color(t.border).bg(t.surface).text_color(t.foreground).text_size(13))
      .on_size_change((size, cx) => { const w = this.size?.width; this.size = size; if (w !== size.width) { diff.resize(size); cx.notify(); } })
      .on_key_down((e, cx) => { if (this.key(e, cx)) cx.stop_propagation(); })
      .when(Boolean(this.splitDrag || this.colDrag), (e) => e.on_mouse_move((ev, cx) => { this.splitTo(ev, cx); this.colTo(ev, cx); })
        .on_mouse_up("left", (_e, cx) => { this.splitEnd(cx); this.colEnd(cx); })
        .on_hover((over, cx) => { if (!over) { this.splitEnd(cx); this.colEnd(cx); } }))
      // The top row, as tall and as padded as the Changes page's (a card of the same radius): in a
      // block with the Changes | History switch (block.js) the switch, the page's name, stays put.
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(named ?? div().font_semibold().child("History"))
        .when(Boolean(this.root ?? this.unread) && this.o.repos.many(), (e) => e.child(this.o.repos.switcher(t, { root: this.root ?? this.unread.root, picked: (cx) => this.reload(cx), id: "history-repo" })))
        .child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(branch))
        .child(div().flex_1())
        // In a tab the diff's view switches (text, the row's own spacing); in the panel its Wrap, an
        // icon button with the others.
        .when(Boolean(this.tab), (e) => e.children(diff.controls(t, true)))
        .child(iconRow([
          ...diff.options(t),
          ...(this.tab ? [] : diff.controls(t, false)),
          // ⤢ and ⤡: Herdr's own icons for a pane's zoom and unzoom (its pane mod's).
          this.tab ? iconButton(t, "history-back", "mods/pane/unzoom.svg", () => backToPanel({ mod: this.o.mod, kind: "history" }), { tip: "Back to the panel (closes this tab)" })
            : iconButton(t, "history-tab", "mods/pane/zoom.svg", (cx) => this.openTab(cx), { tip: "Open the history in a tab (the panel makes room)" }),
          iconButton(t, "history-more", div().text_size(14).child("⋯"), (cx) => this.moreMenu(cx), { off: !this.root, tip: this.moreOpen ? null : "Worktrees, remotes, the reflog, fetching every remote", label: "Worktrees, remotes, the reflog, fetching every remote", menu: true, on: this.moreOpen }),
          // Last, the gear: the settings window at Git (the page's only way there), or closes it.
          iconButton(t, gear.id, "mods/workspace-chrome/settings.svg", (cx) => gear.open(cx), { tip: gear.tip }),
        ])))
      .child(this.filterBar(t, width))
      .when(Boolean(this.line) || Boolean(this.busy), (e) => e.child(h_flex().id("history-line").flex_none().px(12).py(5).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).whitespace_normal().text_size(11.5).text_color(this.busy ? t.dim : readable(t, t.ansi1)).child(this.busy ? `${WORDS[this.busy] ?? this.busy}…` : this.line))
        .when(!this.busy, (e) => e.child(iconButton(t, "history-line-close", CLOSE, (cx) => { this.line = null; cx.notify(); }, { tip: "Dismiss" })))))
      .when(Boolean(this.slow) && this.slow === this.root && !this.busy, (e) => e.child(h_flex().id("history-slow").flex_none().px(12).py(5).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).whitespace_normal().text_size(11.5).text_color(t.muted).child("Large history without git's commit-graph: every page reads all of it."))
        .child(button(t, "history-slow-write", "Write it", (cx) => this.writeCommitGraph(cx), { small: true, tip: "git commit-graph write --reachable: git's own index of the commits (git gc writes the same)" }))
        .child(iconButton(t, "history-slow-close", CLOSE, (cx) => { this.slowDismissed.add(this.slow); this.slow = null; cx.notify(); }, { tip: "Dismiss" }))))
      .when(Boolean(this.unread), (e) => e.child(notReadBar(t, { id: "history", check: this.unread.check, onRead: (cx) => this.readIt(cx) })))
      .when(Boolean(this.op), (e) => e.child(h_flex().flex_none().px(12).py(6).gap(8).items_center().bg(alpha(t.blocked, 0.13)).border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).whitespace_normal().text_size(11.5).text_color(readable(t, t.blocked, alpha(t.blocked, 0.13))).child(stoppedLine(this.op)))
        .child(button(t, "history-abort", `Abort ${this.op}`, (cx) => this.abort(cx), { small: true, kind: "danger", tip: `git ${this.op} --abort` }))))
      .when(Boolean(this.bisect), (e) => e.child(Bisect.bisectBar({ t, s: this.bisect, idle: !this.busy,
        onMark: (term, cx) => this.flow(cx, (h) => Bisect.markFlow(h, term)), onReset: (cx) => this.flow(cx, (h) => Bisect.resetFlow(h)), onShow: (hash, cx) => this.goTo(hash, cx) })))
      // With a commit selected, a line to drag between the commits and the commit: left and right side
      // by side, up and down stacked; another between its information and its diff, up and down.
      // The page keeps its plain flex layout (the diff's list needs the height that gives it to
      // scroll); the lines only change sizes.
      .child(!details ? v_flex().flex_1().min_h(0).child(listArea.flex_1())
        : side
          ? h_flex().flex_1().min_h(0).child(listArea.w(listW).h_full().flex_none()).child(this.splitLine(t, { which: "list", axis: "x", key: listKey, size: listW, min: MIN.listW, max: listMax })).child(details.flex_1().h_full())
          : v_flex().flex_1().min_h(0).child(listArea.h(listH).flex_none()).child(this.splitLine(t, { which: "list", axis: "y", key: listKey, size: listH, min: MIN.listH, max: listMax })).child(details.flex_1())));
  }
}
