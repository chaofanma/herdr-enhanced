// The Changes page: the repository the focused terminal is in (or the one its folder holds, repos.js),
// its changes in sections with a diff of the open file, and everything done to them: stage, unstage,
// revert, stash, commit, push, branches, undo; comments on lines sent to the space's agent; the scopes
// (the uncommitted changes, the last commit, the branch, a commit, the working tree against a ref,
// an agent's turn). The panel's copy, and the Review tab (props.review: the same page full width,
// side by side, changed words, Viewed files, keys). It works the same on this computer and in a
// space on another machine: every git call and script goes through Herdr's exec with `on`.
// It grew from Herdr's Changes mod (Apache-2.0): its refresh, its file list and its diff.
// Based on Herdr's shipped changes mod (Apache-2.0); changed: the page's skeleton (watch, refresh, the list and the commit row) and countLines.
import { h_flex, v_flex, InputState, Input, TextareaState, Popover } from "gpui-base";
import { div, svg } from "gpui-kit";
import { exec, readTextFile, watchFolder, theme, nextCommand, props, shared, setShared, run, appHome, notify, layout, home } from "herdr";
import { ID, KEY, CACHE, asset } from "./id.js";
import { location, contextKey } from "./where.js";
import { repo, reader, sh, has, platform, fetchImages, hostOf, facts as machineFacts, capsOf, gitVersion } from "./machine.js";
import { STOPPED_SH, parseStopped, UNMERGED_ARGS, parseUnmerged, sideNames } from "./conflicts.js";
import { has as gitHas } from "./gitplan.js";
import * as Conflict from "./conflictui.js";
import * as Sync from "./syncui.js";
import { changedLines, linePlan } from "./linestage.js";
import { TRACK_ARGS, parseTracking } from "./branchops.js";
import { blameFlow } from "./blameui.js";
import { carryOut, questionOf, waysOf } from "./planflow.js";
import { runPlan as runGitPlan } from "./gitplan.js";
import { checks, trustRepo, notReadBar, SAFE_ARGS, SAFE_GIT_SH } from "./repotrust.js";
import { STATE_SH } from "./scripts.js";
import { REPO_SH, parseRepo, TREE_SH, parseTree } from "./reads.js";
import { sectionsOf, scopeFiles, isStaged, sides, isNestedRepo, nestedRepos, repoList, leftOutLine } from "./status.js";
import { DiffPane } from "./diffpane.js";
import { palette } from "./colors.js";
import { fileList, ROWS_AT_ONCE } from "./filelist.js";
import { commitBar, pushState } from "./commitbar.js";
import { composer, commentCard, cardHeight } from "./composer.js";
import { openSend } from "./send.js";
import * as Notes from "./comments.js";
import { DIFF, FLAGS, splitDiff, patchable, hunkPatch } from "./hunk.js";
import { diffsByPath, hash } from "./review.js";
import { enterAction, Presses, newlineTyped } from "./keys.js";
import { RepoSet, pinned } from "./repos.js";
import { SHOW, readOnly, scopeId, parseScope, readOnlyRange, readOnlyLabel, readOnlyWords } from "./scopes.js";
import { resolveSpan, ScopeLists, readOnlyBar } from "./scopepick.js";
import { TurnRecorder, turnRecords, turnSpan, turnButtons, turnNote } from "./turnrec.js";
import { openAsTab, backToPanel, showTab } from "./tabs.js";
import { installed, checkInstalled } from "./installed.js";
import { requestOf, takers, placeIn, isPage, pagePlace, bringForward, askFiles } from "./reveal.js";
import { takersFor, sectionFor } from "./reveals.js";
import { turnChoices } from "./turns.js";
import { KEYS, settingsOf, storedOf } from "./panelsettings.js";
import { FETCH_TICK, fetchDue, fetchesItself, bareMessage } from "./prefs.js";
import { questions } from "./question.js";
import { onPage } from "./onpage.js";
import * as G from "./gitops.js";
import { imageExt, imageSides, sideLabels } from "./images.js";
import { imagePane } from "./imageui.js";
import { contentHeader, pathsOf } from "./renames.js";
import * as Stash from "./stashui.js";
import * as Branch from "./branchui.js";
import { readWorktrees, elsewhere, whereWords, tilde } from "./worktrees.js";
import { worktreeSpaces } from "./wtspaces.js";
import { goneOf, forgetFlow } from "./wtbranch.js";
import { remoteTarget } from "./branches.js";
import * as Undo from "./undoui.js";
import { discardFlow } from "./undoui.js";
import { settingsGear } from "./settingsview.js";
import { diffOptionsButton, whitespaceButton } from "./diffui.js";
import { iconButton, iconRow, chevron, withChevron } from "./iconbutton.js";
import { anchorOf, pressOn, closingClick } from "./menuat.js";
import { diffArgs, MORE, withGaps, withoutGaps, isGap, revealed, lineFor } from "./diffopts.js";
import { openAt, lineMenu, runPlan, programFinder, remotePlan } from "./openat.js";
import { itemsOf } from "./openwith.js";
import { prompt as penPrompt, penCommand, PEN_SH, penArgs, readPen, AGENTS, agentOf } from "./commitmsg.js";
import { tokenize, languageOf } from "./tokens.js";
import { wrapSpans, expandTabs } from "./wrap.js";
import { CLEAR, alpha, chip } from "./look.js";
import { codeFont, codeSize } from "./codefont.js";
import { readable } from "./ink.js";

const prefs = () => settingsOf(KEYS.changes, shared(KEYS.changes));
const countLines = (text) => (text ? text.split("\n").length - Number(text.endsWith("\n")) : 0);
/** Why an action did nothing: another one (`words`, BUSY's) is running. */
export const busyWords = (words) => `Busy (${String(words).replace(/…$/, "")}): try again once it's done`;
const firstLine = (e) => String(e?.message ?? e).split("\n")[0];
const MAX_FILES = 1000, MAX_LINES = 1500, MAX_COLS = 4000;
// The page width (px) from which the top row keeps the file count's chip beside the Changes | History
// switch (header): the switch, the chip and an untruncated scope box with the rest need about 460.
const CHIP_ROOM = 470;
// How often a copy looks at a repository on another machine (one sh), and at one here (a timer
// besides the folder watch, as Herdr's Changes mod does).
const POLL_MS = 4000, TICK_MS = 10000;

// What an action is called while it runs.
const BUSY = {
  commit: "Committing…", amend: "Amending…", push: "Pushing…", fetch: "Fetching…", pull: "Pulling…", switch: "Switching…",
  stash: "Stashing…", apply: "Applying…", pop: "Popping…", dropStash: "Dropping…", stage: "Staging…", unstage: "Unstaging…",
  stageAll: "Staging…", unstageAll: "Unstaging…", revert: "Reverting…", revertAll: "Reverting…", stageHunk: "Staging…", am: "Applying…", stageLines: "Staging…", unstageLines: "Unstaging…",
  unstageHunk: "Unstaging…", revertHunk: "Reverting…", renameBranch: "Renaming…", deleteBranch: "Deleting…", merge: "Merging…",
  rebase: "Rebasing…", worktree: "Changing worktrees…", abort: "Aborting…", sync: "Syncing…", forcePush: "Pushing…", continue: "Continuing…", skip: "Skipping…", resolve: "Resolving…", undoCommit: "Undoing…", undo: "Undoing…", restore: "Restoring…",
};
// After these, HEAD may be elsewhere: Amend goes off first.
const MOVES_HEAD = new Set(["switch", "merge", "rebase", "undo", "undoCommit", "abort", "pull", "continue", "skip"]);

export class ChangesPage {
  init(cx) {
    this.handle = cx.focus_handle();
    this.questions = questions(ID, () => ({ mono: codeFont() }));
    this.programs = programFinder(exec);
    this.repoSet = new RepoSet();
    // Side by side wherever the shared layout says so (the Review tab's switch, the panel's Split).
    this.diff = new DiffPane({ id: "changes", split: () => true, words: () => this.review() });
    this.scopeLists = new ScopeLists();
    this.presses = new Presses();
    this.fetched = new Map(); this.moreContext = new Map(); this.untrackedLines = new Map();
    // How many rows each section of the list shows (by its key), past ROWS_AT_ONCE after Show more.
    this.shown = new Map();
    this.seenChange = shared(KEY.changed); this.seenShow = shared(SHOW)?.at ?? null; this.seenSent = shared(KEY.sent)?.at ?? null;
    this.reset();
    // The commit message: one row empty, up to six as it grows (then it scrolls), soft wrapped; an
    // empty box starts with the settings' template.
    this.template = prefs().template; this.message = this.template;
    this.input = TextareaState.new({ placeholder: "Commit message (⌘↩ commits)", rows: 1, value: this.template });
    this.input.set_auto_grow(1, 6);
    this.input.on("change", (_e, cx) => {
      const before = this.message;
      this.message = this.input.value(); this.typed = { before, at: Date.now() };
      // An edit takes Commit's questions back, but not whitespace at the ends or a typed newline
      // (cmd-enter's, taken back by untype()).
      if (before.trim() !== this.message.trim() && !newlineTyped(before, this.message)) { this.askStage = false; this.askPushed = false; }
      cx.notify();
    });
    this.input.on("submit", (e, cx) => { if (e?.secondary) this.untype(); this.enter(enterAction({ secondary: e?.secondary, typing: true }), cx); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    // The branch picker's "New branch…" name.
    this.branchInput = InputState.new({ placeholder: "new-branch-name" });
    this.branchInput.on("submit", (_e, cx) => this.newBranch(cx));
    this.branchInput.on("change", (_e, cx) => { if (this.branchError) { this.branchError = null; cx.notify(); } });
    this.branchInput.on("focus", () => { this.naming = true; });
    this.branchInput.on("blur", () => { this.naming = false; });
    // The comment box: Enter adds, Shift-Enter is a new line.
    this.noteBox = TextareaState.new({ placeholder: "Comment on these lines", rows: 4 });
    this.noteBox.set_auto_grow(4, 14);
    this.noteBox.on("change", (_e, cx) => { this.noteText = this.noteBox.value(); if (this.composer?.editing) { this.placeNotes(); cx.notify(); } });
    this.noteBox.on("submit", (e, cx) => { if (!e?.shift) this.enter("comment", cx); });
    // Reveal requests (shared/reveal.js): this copy takes them with the mod's other copies (takers);
    // Files Enhanced's item in the file menu shows only while it's installed.
    this.kind = "changes"; this.readOnce = false; this.seenReveal = null; this.pendingReveal = null;
    takers.add(this);
    cx.spawn(async (cx) => { if (await checkInstalled()) cx.notify(); });
    this.refresh(cx);
    cx.timer.every(TICK_MS, (cx) => {
      if (!this.on) this.refresh(cx);
      cx.spawn(async (cx) => { if (await checkInstalled()) cx.notify(); });
    });
    cx.timer.every(POLL_MS, (cx) => this.poll(cx));
    // The Review tab takes the keyboard for its keys; a click in it gives it back.
    if (this.review()) { this.handle.focus(); cx.timer.after(300, () => this.handle.focus()); }
    // The panel's copy records agent turns (only one copy records) and fetches by itself; a window's
    // (mod.open, props.overlay) does neither: a recorder taking over from a closed window would end
    // the turns still running (its first check ends every open one, as after a restart).
    if (!props()?.view && !props()?.root && !props()?.overlay) { this.recorder = new TurnRecorder({ settings: prefs }); cx.timer.every(2000, (cx) => this.recorder.check(cx)); }
    if (fetchesItself(props())) cx.timer.every(FETCH_TICK, (cx) => this.autoFetch(cx));
    // The key commands `<mod>.submit`, `.ask`, `.clear`, `.scope` (keys.json).
    const keyCommands = new Map([["submit", (cx) => this.submit(cx)], ["ask", (cx) => this.askDiff(cx)], ["clear", (cx) => this.setNotes([], cx)], ["scope", (cx) => this.cycleScope(cx)]]);
    cx.spawn(async (cx) => {
      for (;;) {
        keyCommands.get(await nextCommand())?.(cx);
        cx.notify();
      }
    });
  }

  // Everything that belongs to one repository and scope, as a new context starts.
  reset() {
    Object.assign(this, {
      root: null, on: null, hasHead: false, facts: null, entries: [], dirty: new Map(), files: [], tree: null, error: null, limited: false,
      scope: "work", scopeTarget: null, scopeSpan: null, ref: null, to: null, open: null, closed: false, picture: null, patch: null,
      hunksOff: false, gaps: new Map(), notes: [], composer: null, noteText: "", stashShown: null, hashes: null, busy: null, busyRow: null,
      busyHunk: null, line: null, askStage: false, askPushed: false, amend: false, amendMessage: null, draft: null, choosingBranch: false,
      branches: null, remoteBranches: [], newBranchOpen: false, branchError: null, choosingScope: false, choosingStash: false, state: null,
      choosingDiffOptions: false, watched: null, hunkAt: 0, top: null, unread: null, stopped: null, unmerged: [], conflictView: null, conflictClosed: null, version: null,
    });
    this.diff?.clear();
  }

  review() { return Boolean(props()?.review); }
  repoKey() { return `${this.on ?? ""}:${this.root}`; }
  runner() { return repo(this.root, this.on); }
  // Still the repository a task began with.
  same(root, on, context) { return this.root === root && this.on === on && this.context === context && contextKey() === context; }

  // ---- Reading the repository

  /** Reads the repository again: its facts, the scope, the files, the open file's diff. A request
   *  while one runs is dropped, unless it follows an action (`afterAction`): then it runs after. */
  refresh(cx, afterAction = false) {
    if (this.loading) { this.again ||= afterAction; return; }
    const { cwd, on } = location(), context = contextKey();
    if (context !== this.context) {
      this.context = context;
      this.reset();
      this.message = this.template; this.input?.set_value(this.template);
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try { await this.read(cwd, on, context, cx); }
      catch (e) { if (contextKey() === context) this.error = firstLine(e); }
      finally {
        this.loading = false; this.readOnce = true;
        cx.notify();
        if (this.again) { this.again = false; this.refresh(cx, true); }
      }
    });
  }

  async read(cwd, on, context, cx) {
    const found = await exec("git", [...SAFE_ARGS, "rev-parse", "--show-toplevel"], { cwd, on }), top = found.code === 0 ? found.stdout.trim() : null;
    if (contextKey() !== context) return;
    const root = await this.repoSet.pick({ cwd, on, top, current: this.root ?? this.unread?.root });
    if (contextKey() !== context) return;
    if (!root) { this.root = null; this.unread = null; this.entries = []; this.dirty = new Map(); this.files = []; this.diff.clear(); this.open = null; this.error = "Not a git repository"; return; }
    // One below the folder whose config has settings beyond the usual ones: nothing is read until
    // the person says so (Read it).
    const check = await this.repoSet.unread(root, on, top);
    if (contextKey() !== context) return;
    if (check) {
      Object.assign(this, { root: null, on, top, unread: { root, on, check }, hasHead: false, facts: null, tree: null, entries: [], dirty: new Map(), files: [], error: null,
        open: null, hashes: null, stashes: [], operation: null, limited: false });
      this.diff.clear();
      return;
    }
    const h = reader(root, on);
    const facts = await h.sh(REPO_SH, [props()?.base ?? ""]);
    if (facts.code !== 0) throw new Error(firstLine(facts.stderr) || "git can't read this repository");
    const f = parseRepo(facts.stdout), hasHead = Boolean(f.head);
    f.offBase = Boolean(f.base && f.merge && f.branch && f.base !== f.branch && f.base !== `${f.remote ?? "origin"}/${f.branch}`);
    // git's version (once per machine: what the newer features need) and, while an operation waits,
    // what stopped and the files in conflict with their kinds (conflicts.js).
    const version = await gitVersion(on);
    let stopped = null, unmerged = [];
    if (f.operation) {
      const s = await h.sh(STOPPED_SH);
      if (s.code === 0) stopped = parseStopped(s.stdout);
      if (gitHas(version, "status-v2")) { const u = await h.git(UNMERGED_ARGS); if (u.code === 0) unmerged = parseUnmerged(u.stdout); }
    }
    // The scope: this repository's remembered one (another repository: its own), what it compares.
    const remembered = parseScope((shared(KEY.scope) ?? {})[`${on ?? ""}:${root}`]);
    let scope = root === this.root && on === this.on ? this.scope : remembered?.scope ?? (f.offBase && f.merge !== f.head ? "branch" : "work");
    let target = root === this.root && on === this.on ? this.scopeTarget : remembered?.target ?? null;
    if ((scope === "last" && !f.parent) || (scope === "branch" && !f.offBase)) scope = "work";
    const git = (args) => h.git(args);
    const span = hasHead && readOnly(scope) ? await (scope === "turn" ? turnSpan({ root, on }, target, turnRecords()) : resolveSpan(git, scope, target)) : null;
    if (!span) { if (readOnly(scope)) scope = "work"; target = null; }
    const range = span ? readOnlyRange(scope, span) : null;
    const to = range?.to ?? null, ref = !hasHead ? null : scope === "branch" ? f.merge : scope === "last" ? f.parent : range ? range.from : "HEAD";
    const treeOut = await h.sh(TREE_SH, [ref ?? "", to ?? ""]);
    if (treeOut.code !== 0) throw new Error(firstLine(treeOut.stderr) || "git status failed");
    const tree = parseTree(treeOut.stdout);
    if (contextKey() !== context) return;
    const entries = tree.entries.slice(0, MAX_FILES), dirty = new Map(entries.map((e) => [e.path, e.xy]));
    const untracked = entries.filter((e) => e.xy === "??").map((e) => e.path);
    // What the scope's diff has (the header's numbers; the Committed or read-only list).
    let files;
    if (ref) files = scopeFiles({ names: tree.names ?? [], scope: tree.scope, untracked: to ? [] : untracked, lines: this.untrackedLines });
    else files = sectionsOf({ entries, staged: tree.staged, unstaged: tree.unstaged, lines: this.untrackedLines }).flatMap((g) => g.rows.map((r) => ({ ...r.f, add: r.add, del: r.del })));
    const hashes = this.review() ? await this.diffHashes(h, hasHead ? [ref, ...(to ? [to] : [])].filter(Boolean) : null, files) : null;
    if (contextKey() !== context) return;
    const moved = root !== this.root || on !== this.on || scope !== this.scope || target !== this.scopeTarget;
    if (moved || ref !== this.ref || to !== this.to) this.diff.clear();
    if (root !== this.root || on !== this.on) this.untrackedLines = new Map();
    if (moved) this.shown = new Map();
    // Another machine: what it can do (a hunk's patch travels as base64, so it needs base64 or
    // openssl there; without them the hunk buttons hide). Found once in ten minutes (machine.js).
    const caps = on ? capsOf(on, await machineFacts(on).catch(() => null)) : null;
    if (contextKey() !== context) return;
    Object.assign(this, { root, on, top, unread: null, hasHead, facts: f, tree, entries, dirty, files, limited: tree.entries.length > MAX_FILES, error: null,
      scope, scopeTarget: target, scopeSpan: span, ref, to, hashes, stashes: f.stashes, operation: stopped?.op ?? f.operation, caps, version, stopped, unmerged });
    if (this.conflictView && !unmerged.some((u) => u.path === this.conflictView.path)) this.conflictView = null;
    if (moved) { this.notes = this.loadNotes(); this.composer = null; }
    this.pruneViewed();
    this.watch(root, on, cx);
    // The open file: gone from the list, or moved to the other section (the rest of it staged).
    const sections = this.sections(), here = (p, s) => sections.some((g) => g.key === s && g.rows.some((r) => r.f.path === p));
    if (this.open && !here(this.open.path, this.open.section)) {
      const other = sections.find((g) => g.rows.some((r) => r.f.path === this.open.path));
      this.open = other ? { path: this.open.path, section: other.key } : null;
      if (!this.open) this.diff.clear();
    }
    // The first file's diff shows until another is picked (or it is closed).
    if (!this.open && !this.closed && sections.length && sections[0].rows.length) this.open = { path: sections[0].rows[0].f.path, section: sections[0].key };
    if (this.open) {
      try { await this.load(this.open, context); }
      catch (e) { if (contextKey() === context) this.diff.show([`Cannot show this diff: ${firstLine(e)}`], this.open.path); }
    } else this.diff.clear();
    this.placeNotes();
  }

  // Review tab: a hash of each listed file's diff against the scope's ref (a new file: of its
  // content), so a Viewed file whose diff changed is no longer viewed. Null when git failed.
  async diffHashes(h, refs, files) {
    const texts = new Map();
    for (const base of refs ? [refs] : [["--cached"], []]) {
      const r = await h.git(["diff", ...base, "--no-renames", ...DIFF]);
      if (r.code !== 0) return null;
      for (const [path, text] of diffsByPath(r.stdout)) texts.set(path, (texts.get(path) ?? "") + text);
    }
    const fresh = files.filter((f) => f.fresh && !f.repo).map((f) => f.path);
    if (fresh.length) {
      const r = await h.git(["hash-object", "--", ...fresh]);
      if (r.code === 0) r.stdout.split("\n").filter(Boolean).forEach((x, k) => { if (k < fresh.length) texts.set(fresh[k], `new file ${x}`); });
    }
    return new Map([...texts].map(([path, text]) => [path, hash(text)]));
  }

  // Local repositories: reloaded on file changes (watchFolder); one on another machine is polled.
  watch(root, on, cx) {
    if (on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  // A repository on another machine: one sh a few seconds apart says whether anything changed.
  poll(cx) {
    if (!this.on || !this.root || this.loading || this.busy || this.polling) return;
    const root = this.root, on = this.on, context = this.context;
    const shown = this.open && this.dirty.get(this.open.path) === "??" ? [this.open.path] : [];
    this.polling = true;
    cx.spawn(async (cx) => {
      try {
        const r = await sh(on, SAFE_GIT_SH + STATE_SH, shown, { cwd: root, timeout: 15000 });
        const state = r.stdout.trim();
        if (this.same(root, on, context) && state !== this.state) { const first = this.state === null; this.state = state; if (!first) this.refresh(cx); }
      } catch { /* the machine is away for now */ }
      finally { this.polling = false; }
    });
  }

  // ---- Scopes and sections

  scopeKey() { return scopeId(this.scope, this.scopeTarget); }
  scopeLabel(which = this.scope) {
    if (readOnly(which)) return readOnlyLabel(which, this.scopeTarget, this.scopeSpan);
    if (which === "last") return "Last commit";
    if (which === "branch") return `vs ${this.facts?.base ?? "base"}`;
    return "Uncommitted";
  }
  // The scope in words, for a message to an agent.
  scopeWords() {
    if (readOnly(this.scope)) return readOnlyWords(this.scope, this.scopeTarget, this.scopeSpan ?? {});
    if (this.scope === "last") return "the last commit and the uncommitted changes, against HEAD's parent";
    if (this.scope === "branch") return `everything on ${this.facts?.branch ?? "this branch"} since it left ${this.facts?.base}, uncommitted changes included`;
    return "the uncommitted changes";
  }
  // What the open file's diff is, in words.
  viewWords() {
    const s = this.open?.section;
    return s === "staged" ? "staged changes: what a commit takes" : s === "unstaged" ? "unstaged changes: the working tree against the staged version" : this.scopeWords();
  }

  sections() {
    if (!this.root) return [];
    if (readOnly(this.scope)) return this.files.length ? [{ key: "committed", label: this.scopeLabel(), rows: this.files.map((f) => ({ f, letter: f.status, add: f.add, del: f.del })) }] : [];
    const tree = this.tree ?? {};
    return sectionsOf({ entries: this.entries, staged: tree.staged, unstaged: tree.unstaged, lines: this.untrackedLines,
      committed: this.scope === "work" ? [] : this.files.filter((f) => !f.fresh) });
  }

  // The base of a section's diff: staged HEAD → index, unstaged index → working tree, else the scope's.
  baseOf(section) {
    if (section === "staged") return ["--cached"];
    if (section === "unstaged" || !this.hasHead) return [];
    return [this.ref ?? "HEAD", ...(this.to ? [this.to] : [])];
  }
  rowOf(path, section) { return this.sections().find((g) => g.key === section)?.rows.find((r) => r.f.path === path) ?? null; }
  // How many of section `g`'s rows the list shows: ROWS_AT_ONCE, more after each Show more, and down
  // to the open file wherever it is (n opens the next one, a reveal or a refresh can move it down).
  shownOf(g) {
    const open = this.open?.section === g.key ? g.rows.findIndex((r) => r.f.path === this.open.path) + 1 : 0;
    return Math.max(this.shown.get(g.key) ?? ROWS_AT_ONCE, open);
  }
  // Show more under a section: ROWS_AT_ONCE more of its rows.
  showMore(section) {
    const g = this.sections().find((x) => x.key === section);
    if (g) this.shown.set(section, this.shownOf(g) + ROWS_AT_ONCE);
  }

  setScope(scope, cx, target = null) {
    this.scopeLists.close();
    if (!this.root || (scope === this.scope && (target ?? null) === (this.scopeTarget ?? null))) { this.choosingScope = false; cx.notify(); return; }
    setShared(KEY.scope, { ...(shared(KEY.scope) ?? {}), [this.repoKey()]: scopeId(scope, target) });
    Object.assign(this, { scope, scopeTarget: target, choosingScope: false, composer: null, open: null, closed: false });
    this.diff.clear();
    this.notes = this.loadNotes();
    this.refresh(cx, true);
    cx.notify();
  }
  // The scopes the key command cycles through: those this repository offers.
  cycleScope(cx) {
    const offered = ["work", ...(this.facts?.parent ? ["last"] : []), ...(this.facts?.offBase ? ["branch"] : [])];
    const at = offered.indexOf(this.scope);
    this.setScope(offered[(at + 1) % offered.length], cx);
  }

  // ---- The open file

  pick(file, section, cx) {
    const same = this.open?.path === file && this.open?.section === section;
    // A file opened below the rows shown (n, a reveal) keeps the list down to it after it closes.
    if (!same) { const g = this.sections().find((x) => x.key === section), at = g ? g.rows.findIndex((r) => r.f.path === file) + 1 : 0; if (g && at > this.shownOf(g)) this.shown.set(section, at); }
    this.open = same ? null : { path: file, section };
    this.closed = !this.open; this.line = null; this.hunkAt = 0; this.stashShown = null; this.conflictClosed = null; this.conflictView = null;
    this.diff.clear();
    if (this.review()) { this.toTop = Boolean(this.open); this.handle.focus(); }
    const context = this.context, open = this.open;
    if (open) cx.spawn(async (cx) => {
      try { await this.load(open, context); }
      catch (e) { if (contextKey() === context && this.open === open) this.line = `Cannot show this diff: ${firstLine(e)}`; }
      this.placeNotes();
      cx.notify();
    });
    cx.notify();
  }

  // The open file's diff: a new file's whole content, else git's diff of its section (or scope) with
  // the settings' whitespace and context; an image's two sides; the hunks' patches for the buttons.
  async load(open, context) {
    const { path, section } = open, root = this.root, on = this.on, h = reader(root, on);
    const row = this.rowOf(path, section), f = row?.f ?? this.files.find((x) => x.path === path);
    if (!f) return;
    // A repository inside this one has no diff here: the diff area explains (covering, nestedPane).
    if (f.repo) {
      if (contextKey() !== context || this.open?.path !== path || this.open?.section !== section) return;
      this.patch = null; this.hunksOff = false; this.gaps = new Map(); this.picture = null;
      this.diff.clear();
      return;
    }
    let lines, patch = null, hunksOff = false, gaps = new Map(), picture = null;
    const ext = imageExt(path);
    if (ext) {
      const base = f.fresh ? [] : this.baseOf(section);
      picture = { path, section, root, on, labels: sideLabels(base), copies: null, error: null, svg: ext === "svg" };
      const sidesOf = imageSides({ base, path, from: f.from, status: f.status, fresh: f.fresh, hasHead: this.hasHead });
      try { picture.copies = on ? await fetchImages(root, on, ext, sidesOf) : await G.imageCopies(h, `${appHome()}/${CACHE}`, ext, sidesOf); }
      catch (e) { picture.error = firstLine(e); }
    }
    if (f.fresh || (!this.hasHead && f.status === "A" && section !== "staged" && !this.dirty.has(path))) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot show this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        const n = countLines(text);
        if (this.untrackedLines.get(path) !== n) this.untrackedLines.set(path, n);
        lines = [`@@ -0,0 +1,${n} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, MAX_LINES).map((l) => `+${l}`)];
      }
    } else {
      const options = prefs(), more = this.moreContext.get(this.contextFor(path, section)) ?? 0;
      const r = await h.git(["diff", ...this.baseOf(section), ...DIFF, ...diffArgs(options, more), ...(f.from ? ["-M"] : []), "--", ...pathsOf(path, f.from)]);
      if (r.code !== 0) throw new Error(firstLine(r.stderr) || "git diff failed");
      // The hunk buttons cut their patches from the diff's own lines, not from the rows shown.
      const d = splitDiff(r.stdout);
      lines = d ? d.lines : [f.binary ? "Binary file changed" : "No text diff available"];
      if (d) ({ lines, gaps } = withGaps(d.lines));
      if (d && (section === "staged" || section === "unstaged") && patchable(d)) {
        // A rename's hunks apply to its content only (renames.js contentHeader; null: none for it).
        const header = contentHeader(d.header, path);
        if (options.whitespace || !header) hunksOff = true; else patch = { path, section, lines: d.lines, header };
      }
    }
    // A file in conflict that both sides have: its conflict view covers the diff (choices made so far
    // stay while the file holds the same text).
    const u = this.unmerged.find((x) => x.path === path);
    let conflict = null;
    if (u && u.ours && u.theirs && !u.submodule && this.conflictClosed !== path) {
      conflict = await Conflict.loadConflict(h, u);
      const was = this.conflictView;
      if (was?.path === path && was.text === conflict.text && was.choices) conflict.choices = was.choices;
    }
    if (contextKey() !== context || this.open?.path !== path || this.open?.section !== section) return;
    this.conflictView = conflict;
    this.patch = patch; this.hunksOff = hunksOff; this.gaps = gaps;
    if (!picture || this.picture?.path !== path || this.picture?.section !== section || !this.picture.text) this.picture = picture;
    this.diff.setFont(codeSize());
    this.diff.show(lines.slice(0, MAX_LINES + 1).map((l) => (l.length > MAX_COLS ? `${l.slice(0, MAX_COLS)}… (line cut)` : l)), path);
    if (this.toTop) { this.toTop = false; this.diff.top(); }
  }
  contextFor(path, section) { return `${this.repoKey()}|${section ?? ""}|${path}`; }

  // ---- Actions

  /** Runs `work(h)` as action `kind`: its words on the busy button, git's refusal under the diff,
   *  a refresh after. `row`: the file row whose button runs. */
  perform(kind, work, cx, row = null) {
    if (!this.root) return;
    // One git action at a time: a second one says why nothing happened instead of being dropped.
    if (this.busy) { this.line = busyWords(BUSY[this.busy] ?? this.busy); cx.notify(); return; }
    const root = this.root, on = this.on, context = this.context;
    if (MOVES_HEAD.has(kind)) this.stopAmend();
    this.busy = kind; this.busyRow = row; this.line = null;
    cx.spawn(async (cx) => {
      try { await work(repo(root, on), context); }
      catch (e) { if (this.same(root, on, context)) this.line = `${kind === "commit" || kind === "amend" ? "Commit" : (BUSY[kind] ?? kind).replace("…", "")} failed: ${String(e?.message ?? e).trim()}`; }
      finally {
        this.busy = null; this.busyRow = null; this.busyHunk = null;
        setShared(KEY.changed, Date.now());
        this.seenChange = shared(KEY.changed);
        this.refresh(cx, true);
        cx.notify();
      }
    });
    cx.notify();
  }

  /** The newer modules' flows run with a host: git there, the questions, act (perform), note (the
   *  line under the diff) and same (still the repository the flow began in). From a task's cx. */
  host(cx) {
    const root = this.root, on = this.on, context = this.context;
    // Answers come back in the question's call: the flow takes them in this page's (onpage.js).
    const q = this.questions;
    return { ...repo(root, on), ...q, ask: (spec) => onPage(cx, q.ask(spec)), choose: (spec) => onPage(cx, q.choose(spec)), reads: reader(root, on),
      act: (kind, work) => this.perform(kind, () => work(), cx),
      note: (text) => { this.line = text; cx.notify(); },
      same: () => this.same(root, on, context) };
  }
  // A flow that throws (a read git refused, a question that couldn't open) says why on the line
  // under the diff, as History's flows do, instead of ending without a word.
  flow(cx, fn) {
    const root = this.root, on = this.on, context = this.context;
    cx.spawn(async (cx) => {
      try { await fn(this.host(cx), cx); }
      catch (e) { if (this.same(root, on, context)) this.line = firstLine(e) || "That didn't work"; }
      cx.notify();
    });
  }

  stageRow(path, section, cx) {
    const row = this.rowOf(path, section);
    if (!row || row.f.repo) return;
    const paths = pathsOf(path, row.f.from), hasHead = this.hasHead;
    if (section === "staged") this.perform("unstage", (h) => G.unstagePaths(h, paths, hasHead), cx, { path, section });
    else this.perform("stage", (h) => G.stagePaths(h, paths), cx, { path, section });
  }
  // The status's files, and the repositories inside this one ("sub/": never staged with the rest).
  changedFiles() { return this.entries.filter((e) => !isNestedRepo(e)); }
  innerRepos() { return nestedRepos(this.entries); }
  allStaged() { const files = this.changedFiles(); return files.length > 0 && files.every((e) => { const s = sides(e.xy); return s.staged && !s.unstaged; }); }
  hasStaged() { return this.entries.some((e) => isStaged(e.xy)); }
  // Stage all leaves out the repositories inside this one (git would record each as an embedded
  // repository) and says so once.
  stageAll(cx) {
    if (this.allStaged()) { const hasHead = this.hasHead; this.perform("unstageAll", (h) => G.unstageEverything(h, hasHead), cx); return; }
    const repos = this.innerRepos();
    this.perform("stageAll", async (h, context) => {
      await G.stageEverything(h, repos);
      if (repos.length && contextKey() === context) this.line = leftOutLine(repos);
    }, cx);
  }

  // Revert or delete a file (its menu), all, or a hunk: asks first; a copy of what goes is kept
  // (Recently discarded…). When git can't keep one, it asks again, without a copy.
  // Asks, keeps a copy, asks again without one (undoui.js discardFlow).
  discardFlow(h, spec) { return discardFlow(h, spec); }
  fileMenu(path, section, cx) {
    if (!this.root) return;
    const xy = this.dirty.get(path) ?? null, row = this.rowOf(path, section), from = row?.f.from ?? null, name = path.split("/").pop();
    if (row?.f.repo || (xy === "??" && path.endsWith("/"))) { this.repoMenu(path, cx); return; }
    const untracked = xy === "??", added = Boolean(xy && xy[0] === "A" && xy[1] !== "D");
    // Show in Files (Files Enhanced installed): not for a file that is gone from the working tree.
    const root = this.root, on = this.on, gone = (row?.letter ?? row?.f.status) === "D" || (xy && xy[1] === "D");
    const files = installed("files") ? [{ id: "files", label: "Show in Files", disabled: Boolean(gone), detail: gone ? "Not in the working tree" : undefined }] : [];
    // A file in conflict: what can be done with it (conflicts.js fileChoices).
    const u = readOnly(this.scope) ? null : this.unmerged.find((x) => x.path === path);
    if (u) {
      const names = this.sideNames();
      cx.spawn(async (cx) => {
        const h = this.host(cx), pick = await h.choose({ title: `${name} · ${u.kind}`, width: 300, items: [...Conflict.conflictItems(u, names), ...files] });
        if (pick === "files") { askFiles({ full: `${root}/${path}`, on }); return; }
        if (!pick || !h.same()) return;
        await Conflict.conflictPick(h, pick, { f: u, names, edit: () => { this.conflictClosed = null; if (this.open?.path !== path) this.pick(path, section, cx); else this.refresh(cx, true); } });
        cx.notify();
      });
      return;
    }
    const items = [...(readOnly(this.scope) ? [] : !xy ? [{ id: "none", label: "No uncommitted changes", disabled: true }]
      : [{ id: "revert", label: untracked || added ? "Delete file…" : "Revert changes…", danger: true }]), ...files];
    if (!items.length) return;
    cx.spawn(async (cx) => {
      const h = this.host(cx), pick = await h.choose({ title: `${name}${path.includes("/") ? ` · ${path.slice(0, path.lastIndexOf("/"))}` : ""}`, width: 250, items });
      if (pick === "files") { askFiles({ full: `${root}/${path}`, on }); return; }
      if (pick !== "revert" || !h.same()) return;
      const paths = pathsOf(path, from);
      if (untracked || added) {
        await this.discardFlow(h, { title: `Delete ${name}?`, detail: `${path} was never committed.`, confirm: "Delete",
          keep: { mode: "paths", paths: [path], message: `Delete ${path}` }, work: () => G.deleteNew(h, path, untracked) });
      } else {
        await this.discardFlow(h, { title: `Revert ${name}?`, detail: from ? `This takes back the rename of ${from} to ${path} and discards its changes, staged and unstaged.` : `This discards the uncommitted changes to ${path}, staged and unstaged.`,
          confirm: "Revert", keep: { mode: "paths", paths, message: `Revert ${path}` }, work: () => G.revertPaths(h, paths) });
      }
      cx.notify();
    });
  }
  // A repository inside this one: no Revert or Delete (git clean leaves a repository alone), and
  // staging it is on purpose only: asked first, in plain words. Show in Files as for a file.
  repoMenu(path, cx) {
    const root = this.root, on = this.on, name = path.split("/").filter(Boolean).pop() + "/";
    const items = [...(readOnly(this.scope) || this.dirty.get(path) !== "??" ? [] : [{ id: "stage", label: "Stage it as an embedded repository…" }]),
      ...(installed("files") ? [{ id: "files", label: "Show in Files" }] : [])];
    if (!items.length) return;
    cx.spawn(async (cx) => {
      const h = this.host(cx), pick = await h.choose({ title: `${name}${path.slice(0, -1).includes("/") ? ` · ${path.slice(0, path.slice(0, -1).lastIndexOf("/"))}` : ""} · repository`, width: 280, items });
      if (pick === "files") { askFiles({ full: `${root}/${path.replace(/\/$/, "")}`, on }); return; }
      if (pick !== "stage" || !h.same()) return;
      const a = await h.ask({ title: `Stage ${path} as an embedded repository?`, width: 460,
        detail: `${path} is a git repository of its own. Staging it records only the commit it is on, not its files: people who clone this repository get an empty folder there.\n\nUsually what's meant is a submodule (git submodule add <its URL> ${path.replace(/\/$/, "")}), or a line in .gitignore so it isn't listed.`,
        confirm: "Stage it anyway" });
      if (!a || !h.same()) return;
      this.perform("stage", (h) => G.stagePaths(h, [path.replace(/\/$/, "")]), cx, { path, section: "unstaged" });
      cx.notify();
    });
  }
  // "Show its changes": this page on the repository inside this one (listed for the folder from now
  // on, below the scan's depth too; read only as any other below the folder is: repotrust.js). A
  // copy opened for one repository (the Review tab) opens a Review tab for it instead.
  showNested(path, cx) {
    if (!this.root) return;
    const full = `${this.root}/${path.replace(/\/$/, "")}`, on = this.on;
    if (pinned()) { openAsTab({ mod: ID, kind: "review", root: full, on, props: { ...(props() ?? {}), review: true, root: full, on } }, cx); return; }
    this.repoSet.add(full);
    this.repoSet.choose(full);
    this.refresh(cx, true);
    cx.notify();
  }
  // The open row when it is a repository inside this one: its path ("sub/"), else null.
  openRepo() {
    const o = this.open;
    if (!o || !this.root) return null;
    const f = this.rowOf(o.path, o.section)?.f ?? this.files.find((x) => x.path === o.path);
    return f?.repo ? o.path : null;
  }

  // Revert all and Amend need a repository with a commit, and nothing else running.
  canChangeAll() { return Boolean(this.root && this.hasHead && !this.busy); }
  revertAll(cx) {
    if (!this.canChangeAll()) return;
    // A repository inside this one stays (git clean -fd leaves it alone): not counted.
    const files = this.changedFiles(), fresh = files.filter((e) => e.xy === "??" || (e.xy[0] === "A" && e.xy[1] !== "D")).length, tracked = files.length - fresh;
    const lost = [tracked && `resets ${tracked} tracked file${tracked === 1 ? "" : "s"} to HEAD`, fresh && `deletes ${fresh} new file${fresh === 1 ? "" : "s"}`].filter(Boolean).join(" and ") || "changes nothing";
    cx.spawn(async (cx) => {
      const h = this.host(cx);
      await this.discardFlow(h, { title: "Revert all uncommitted changes?", detail: `This ${lost} in ${this.root}${this.on ? ` on ${this.on}` : ""}, staged changes included; ignored files stay.`,
        confirm: "Revert all", keep: { mode: "all", paths: [], message: "Revert all" }, work: () => G.revertEverything(h) });
      cx.notify();
    });
  }

  // ---- Hunks

  // What a @@ row's buttons do: only on a Staged or Unstaged diff of a text file.
  hunkActions() {
    const p = this.patch, o = this.open;
    if (!p || !o || p.path !== o.path || p.section !== o.section || this.caps?.put === false) return [];
    return o.section === "staged" ? [{ id: "unstage", label: "Unstage" }] : [{ id: "stage", label: "Stage" }, { id: "revert", label: "Revert…", danger: true }];
  }
  hunk(kind, i, cx) {
    const p = this.patch, at = withoutGaps(this.diff.lines ?? [], i), patch = p ? hunkPatch(p.header, p.lines, at) : null;
    if (!patch || !this.root) return;
    // One git action at a time: a second one says why nothing happened, as perform() does.
    if (this.busy) { this.line = busyWords(BUSY[this.busy] ?? this.busy); cx.notify(); return; }
    if (kind === "revert") {
      const path = p.path, header = p.lines[at];
      cx.spawn(async (cx) => {
        const h = this.host(cx);
        await this.discardFlow(h, { title: "Revert this hunk?", detail: `${header}\nThis discards these unstaged lines in ${path}.`, confirm: "Revert",
          keep: { mode: "paths", paths: [path], message: `Revert a hunk of ${path}` }, work: () => G.applyPatch(h, patch, FLAGS.revert) });
        cx.notify();
      });
      return;
    }
    this.busyHunk = i;
    this.perform(kind === "stage" ? "stageHunk" : "unstageHunk", (h) => G.applyPatch(h, patch, FLAGS[kind]), cx);
  }

  // ---- Lines (linestage.js): the comment box's rows, staged, unstaged or discarded on their own

  /** The changed lines among the comment box's rows (indexes into the diff's own lines), or null:
   *  only in a Staged or Unstaged diff that has hunk buttons. */
  lineSelection() {
    const c = this.composer, p = this.patch, o = this.open;
    if (!c || c.editing || c.from === null || !p || !o || p.path !== o.path || p.section !== o.section || c.path !== o.path || this.lineStale()) return null;
    const changed = new Set(changedLines({ header: p.header, lines: p.lines })), picked = [];
    for (let i = c.from; i <= c.to; i++) {
      if (isGap(this.diff.rows[i]?.text)) continue;
      const at = withoutGaps(this.diff.lines ?? [], i);
      if (changed.has(at)) picked.push(at);
    }
    return picked.length ? picked : null;
  }
  // What the comment box offers for them: Stage lines and Discard lines… (unstaged), Unstage lines
  // (staged); on another machine without base64 or openssl, why there is nothing.
  lineChoices() {
    if (this.lineStale()) return { count: 0, actions: [], note: "The diff changed since these rows were selected: select them again", onAction: () => {} };
    const sel = this.lineSelection();
    if (!sel) return null;
    if (this.caps?.put === false) return { count: sel.length, actions: [], note: `Staging lines on ${this.on} needs base64 or openssl there`, onAction: () => {} };
    const actions = this.open.section === "staged" ? [{ id: "unstage", label: "Unstage lines", tip: "Take only these lines out of the index" }]
      : [{ id: "stage", label: "Stage lines", tip: "Stage only these lines" }, { id: "discard", label: "Discard…", danger: true, tip: "Take these changes out of the file (asks; a copy is kept)" }];
    // While a git action runs they wait (off, saying why), as the hunk buttons do.
    const busy = this.busy ? busyWords(BUSY[this.busy] ?? this.busy) : null;
    return { count: sel.length, actions: busy ? actions.map((a) => ({ ...a, off: busy })) : actions, onAction: (id, cx) => this.lineAction(id, cx) };
  }
  lineAction(action, cx) {
    const sel = this.lineSelection(), p = this.patch;
    if (this.busy) { this.line = busyWords(BUSY[this.busy] ?? this.busy); cx.notify(); return; }
    if (!sel || !p) return;
    const plan = linePlan({ header: p.header, lines: p.lines }, sel, action, p.path), path = p.path, from = this.rowOf(path, p.section)?.f.from ?? null;
    // The box closes once the lines went, and only when nothing is typed in it: a comment being
    // written stays, and a Discard… cancelled keeps the rows selected.
    const box = this.composer, done = (cx) => { if (this.composer === box && !this.noteBox.value().trim()) this.closeBox(cx); };
    if (action !== "discard") { this.flow(cx, (h, cx) => carryOut(h, plan, { kind: action === "stage" ? "stageLines" : "unstageLines", after: () => done(cx) })); return; }
    const q = questionOf(plan), shown = sel.map((k) => (p.lines[k] ?? "").slice(0, 1) + expandTabs((p.lines[k] ?? "").slice(1))), MOST = 8;
    const lines = [...shown.slice(0, MOST), ...(shown.length > MOST ? [`… ${shown.length - MOST} more`] : [])];
    this.flow(cx, (h, cx) => this.discardFlow(h, { title: q.title, detail: q.detail, lines, confirm: "Discard", keep: { mode: "paths", paths: pathsOf(path, from), message: `Discard lines of ${path}` },
      work: async () => { await runGitPlan(h, plan, waysOf(h)); done(cx); } }));
  }

  // ---- Commit, amend, the pen, push, fetch, pull

  commit(cx) {
    const message = (this.message ?? "").trim();
    if (bareMessage(message, this.template) || !this.root || this.busy) return;
    // Amending with nothing staged and no changes only rewrites the message.
    const files = this.changedFiles().length, amend = Boolean(this.amend && this.hasHead), stageAll = !this.hasStaged() && (files > 0 || !amend);
    if (!amend && !files && !this.hasStaged()) { this.line = this.dirty.size ? `Nothing to commit: ${repoList(this.innerRepos())} ${this.dirty.size === 1 ? "is a repository" : "are repositories"} inside this one (stage one from its right-click menu if you mean to)` : "Nothing to commit"; cx.notify(); return; }
    const repos = stageAll ? this.innerRepos() : [];
    if (stageAll && !this.askStage && prefs().askStageAll) { this.askStage = true; cx.notify(); return; }
    this.perform(amend ? "amend" : "commit", async (h, context) => {
      // HEAD already on the upstream: amending rewrites a pushed commit, so the first press only asks.
      if (amend && !this.askPushed && prefs().askAmendPushed && (await G.headPushed(h))) { this.askPushed = true; return; }
      this.askStage = false; this.askPushed = false;
      await G.commitStaged(h, { message, amend, stageAll, leaveOut: repos });
      if (contextKey() === context) { this.message = this.template; this.input.set_value(this.template); if (amend) { this.amend = false; this.amendMessage = null; this.draft = null; } }
      if (repos.length && contextKey() === context) this.line = leftOutLine(repos, "Staging every change");
    }, cx);
  }
  toggleAmend(cx) {
    if (!this.canChangeAll()) return;
    this.askStage = false; this.askPushed = false;
    if (this.amend) { this.stopAmend(); cx.notify(); return; }
    this.amend = true; this.draft = this.message; this.amendMessage = null;
    const h = this.runner(), context = this.context;
    cx.spawn(async (cx) => {
      const text = await G.lastMessage(h).catch(() => null);
      if (contextKey() !== context || !this.amend || text === null) return;
      this.amendMessage = text; this.message = text; this.input.set_value(text);
      cx.notify();
    });
    cx.notify();
  }
  stopAmend() {
    if (!this.amend) return;
    this.amend = false;
    if (this.amendMessage !== null && this.message === this.amendMessage) { this.message = this.draft ?? this.template; this.input.set_value(this.message); }
    this.amendMessage = null; this.draft = null;
  }

  // The pen: the settings' agent writes the message from the staged diff (else every change and the
  // new files' names) in the style of the last subjects; it lands in the box, never committed. The
  // agent runs here; the repository may be anywhere.
  penAgent() { return agentOf(prefs().commitAgent); }
  penModel() { return prefs().commitModel || props()?.commit_model || ""; }
  async penFound() {
    const out = [];
    for (const a of AGENTS) {
      const program = a.id === "custom" ? penCommand({ agent: "custom", command: prefs().commitCommand, text: "" })?.program : a.program;
      if (program && (await has(null, program))) out.push(a);
    }
    return out;
  }
  writeMessage(cx, agent = this.penAgent()) {
    if (!this.root || this.writing || this.busy) return;
    const h = this.runner(), hasHead = this.hasHead, context = this.context, model = this.penModel();
    this.writing = true; this.line = null;
    cx.spawn(async (cx) => {
      try {
        const out = async (args) => { const r = await h.git(args); if (r.code !== 0) throw new Error(firstLine(r.stderr) || `git ${args[0]} failed`); return r.stdout; };
        let staged = true, untracked = [], diff = await out(["diff", "--cached", "--no-color", "--no-ext-diff"]);
        if (!diff.trim()) {
          staged = false;
          diff = await out(["diff", ...(hasHead ? ["HEAD"] : []), "--no-color", "--no-ext-diff"]);
          untracked = (await out(["ls-files", "--others", "--exclude-standard"])).split("\n").filter(Boolean);
        }
        if (!diff.trim() && !untracked.length) throw new Error("no changes to describe");
        const subjects = hasHead ? (await out(["log", "-8", "--format=%s"])).split("\n").filter(Boolean) : [];
        const cmd = penCommand({ agent: agent.id, model, command: prefs().commitCommand, text: penPrompt({ diff, staged, untracked, subjects }) });
        if (!cmd) throw new Error("the settings' commit command is empty");
        const r = await sh(null, PEN_SH, penArgs(cmd), { timeout: (cmd.timeout + 15) * 1000 });
        const answer = readPen(agent.id, r, cmd);
        if (contextKey() !== context) return;
        if (answer.text) { this.message = answer.text; this.input.set_value(answer.text); this.askStage = false; }
        else this.line = `${agent.name} couldn't write the message: ${answer.error}${model ? ` (${model})` : ""}`;
      } catch (e) { if (contextKey() === context) this.line = `${agent.name} couldn't write the message: ${firstLine(e)}`; }
      finally { this.writing = false; cx.notify(); }
    });
    cx.notify();
  }
  // A click on the pen: the settings' agent, or, when it isn't here, a choice of those that are.
  pen(cx) {
    cx.spawn(async (cx) => {
      const found = await this.penFound(), mine = this.penAgent();
      if (found.some((a) => a.id === mine.id)) this.writeMessage(cx, mine);
      else this.penMenu(cx, found);
      cx.notify();
    });
  }
  // The pen's right-click: which agent writes (only those found on this computer); the pick is kept
  // in the settings.
  penMenu(cx, found = null) {
    cx.spawn(async (cx) => {
      const list = found ?? (await this.penFound()), mine = this.penAgent();
      const items = list.length ? list.map((a) => ({ id: a.id, label: `Write with ${a.name}`, checked: a.id === mine.id, detail: a.id === "custom" ? (prefs().commitCommand ?? []).join(" ") : `the diff goes to ${a.name}'s model provider` }))
        : [{ id: "none", label: "No agent found here", detail: "pi, claude, codex or opencode", disabled: true }];
      const pick = await onPage(cx, this.fromButton("pen", this.questions.choose({ title: "Who writes the message", width: 300, items }), cx));
      const a = AGENTS.find((x) => x.id === pick);
      if (!a) return;
      if (a.id !== prefs().commitAgent) setShared(KEYS.changes, storedOf(KEYS.changes, { ...prefs(), commitAgent: a.id }));
      this.writeMessage(cx, a);
      cx.notify();
    });
  }

  push(cx) {
    const p = this.facts, s = pushState(p, { idle: !this.busy });
    if (!s.enabled) return;
    this.perform("push", (h) => G.pushBranch(h, { upstream: p.upstream, remote: p.remote }), cx);
  }
  fetch(cx) { if (this.root) this.fetched.set(this.repoKey(), Date.now()); this.perform("fetch", (h) => G.fetchRemote(h), cx); }
  // Pull ▾ and the menu beside Push (syncui.js): pull modes, Sync or Publish, force push with a
  // lease, push every tag. Their menus, and the ones that follow, open at the button (menuat.js):
  // under Pull ▾ (`id`, the one pressed), over ▾ at the bottom of the page.
  pull(cx, id) { if (this.root && !this.busy) { const facts = this.facts ?? {}, version = this.version; this.flow(cx, (h, cx) => Sync.pullFlow(this.fromMenuButton("pull", h, anchorOf(id, { align: "left" }), cx), { facts, version })); } }
  // While its menu is open ▾ has no tooltip (it would show over the menu): `menuFrom`.
  pushMenu(cx) { if (this.root && !this.busy && this.hasHead) { const facts = this.facts ?? {}, version = this.version; this.flow(cx, (h, cx) => Sync.pushMenuFlow(this.fromMenuButton("push", h, anchorOf("push-menu", { side: "above" }), cx), { facts, version })); } }
  // The settings' autoFetch (minutes; 0 never): git fetch --prune for the shown repository that often,
  // quietly (a failure shows only in Fetch's tooltip), then the numbers are read again. Only the
  // folder's own repository or one the person trusted (Read it) fetches by itself (repotrust.js).
  autoFetch(cx) {
    const root = this.root, on = this.on, k = this.repoKey(), now = Date.now();
    if (!root || this.busy || this.autoFetching || !this.facts?.remote || !fetchDue(prefs().autoFetch, this.fetched.get(k), now)) return;
    if (root !== this.top && checks.verdict(root, on, { fetch: true }) !== "read") return;
    this.fetched.set(k, now); this.autoFetching = true;
    cx.spawn(async (cx) => {
      try { await G.quietFetch(reader(root, on)); this.fetchError = null; }
      catch (e) { this.fetchError = firstLine(e); }
      finally { this.autoFetching = false; }
      if (this.root === root && this.on === on) this.refresh(cx, true);
    });
  }

  // ---- Branches

  openBranches(open, cx) {
    this.choosingBranch = open; this.newBranchOpen = false; this.branchError = null;
    if (open && this.root) {
      const h = reader(this.root, this.on), context = this.context;
      this.branches = null;
      cx.spawn(async (cx) => {
        let read;
        try {
          const refs = await G.branchRefs(h), tr = await h.git(TRACK_ARGS), worktrees = await readWorktrees(h, this.version);
          read = { refs, tracked: tr.code === 0 ? parseTracking(tr.stdout) : [], worktrees };
        } catch (e) { read = { error: firstLine(e) }; }
        if (this.context !== context) return;
        if (read.error) Object.assign(this, { branches: [], branchError: read.error });
        // The branches checked out in another worktree: their rows go to it instead of switching.
        else Object.assign(this, { branches: read.refs.local, remoteBranches: read.refs.remote, tracking: new Map(read.tracked.map((x) => [x.name, x])),
          worktrees: read.worktrees, elsewhere: elsewhere(read.worktrees, this.top ?? this.root) });
        cx.notify();
      });
    }
    cx.notify();
  }
  switchTo(branch, create, cx) { this.choosingBranch = false; this.newBranchOpen = false; this.perform("switch", (h) => G.switchBranch(h, branch, create), cx); }
  // A click on a branch checked out in another worktree (git won't check it out here too): the space
  // that is in that worktree, as Herdr's own worktree list finds it, else a new space there. Its
  // folder gone, the question that forgets it (it can be checked out here after): every missing
  // one, or, locked, that one (wtbranch.js forgetFlow).
  toWorktree(w, cx) {
    this.choosingBranch = false; this.newBranchOpen = false;
    const list = this.worktrees ?? [];
    if (goneOf(w)) this.flow(cx, (h) => forgetFlow(h, w, list));
    else worktreeSpaces(this.on).go(w.path, list);
    cx.notify();
  }
  // A worktree's folder as a row shows it: ~ for the home folder, on this computer.
  placeOf(path) { return this.on ? path : tilde(path, home()); }
  newBranch(cx) {
    const name = this.branchInput.value().trim();
    if (!name || !this.root || this.busy) return;
    const h = this.runner(), context = this.context;
    cx.spawn(async (cx) => {
      const ok = await G.validBranchName(h, name).catch(() => false);
      if (this.context !== context) return;
      if (ok) this.switchTo(name, true, cx); else this.branchError = `"${name}" can't be a branch name`;
      cx.notify();
    });
  }
  branchMenu(b, cx) {
    if (!this.root || this.busy) return;
    const w = b.current ? null : this.elsewhere?.get(b.name) ?? null;
    const facts = { b, current: this.facts?.branch ?? null, operation: this.operation, dirty: this.dirty.size > 0, upstream: this.facts?.upstream ?? null, track: this.tracking?.get(b.name) ?? null, version: this.version,
      w, place: w ? this.placeOf(w.path) : null, worktrees: this.worktrees ?? [], spaces: worktreeSpaces(this.on) };
    this.choosingBranch = false;
    this.flow(cx, (h) => Branch.branchMenuFlow(h, facts));
  }
  // The picker's "Back to the previous branch" and "Clean up branches…" (branchops.js).
  previousBranch(cx) { this.choosingBranch = false; const version = this.version; this.flow(cx, (h) => Branch.previousFlow(h, { version })); cx.notify(); }
  cleanupBranches(cx) {
    this.choosingBranch = false;
    const base = this.facts?.base ?? this.facts?.branch, version = this.version;
    if (base) this.flow(cx, (h) => Branch.cleanupFlow(h, { base, version }));
    cx.notify();
  }
  // A click on a remote branch: its local branch (or a new one tracking it); that local branch
  // checked out in another worktree, that worktree, as a click on the local branch.
  remoteClick(rb, cx) {
    const local = this.branches ?? [], to = remoteTarget(rb, local), w = to.local ? this.elsewhere?.get(to.local) ?? null : null;
    if (w) return this.toWorktree(w, cx);
    this.choosingBranch = false; this.newBranchOpen = false;
    this.flow(cx, async (h) => Branch.remoteSwitch(h, rb, local)); cx.notify();
  }
  abortOperation(cx) { if (this.operation && this.root && !this.busy) { const op = this.operation; this.flow(cx, (h) => Conflict.abortFlow(h, { op })); } }
  // A stopped operation (conflicts.js): which side is which, Continue, Skip…, and the agent.
  conflictFiles() { return this.entries.filter((x) => sides(x.xy).conflict); }
  sideNames() {
    const s = this.stopped ?? {}, op = this.operation;
    return sideNames(op, { branch: this.facts?.branch ?? null, rebasing: s.rebasing, onto: op === "merge" ? (s.merging?.[0]?.slice(0, 7) ?? null) : s.onto, commit: s.commit });
  }
  continueOperation(cx) {
    if (!this.operation || !this.root || this.busy) return;
    const op = this.operation, unresolved = this.conflictFiles().length, version = this.version;
    this.flow(cx, (h) => Conflict.continueFlow(h, { op, unresolved, version }));
  }
  skipOperation(cx) {
    if (!this.operation || !this.root || this.busy) return;
    const op = this.operation, stopped = this.stopped ?? {}, version = this.version;
    this.flow(cx, (h) => Conflict.skipFlow(h, { op, stopped, version }));
  }
  askConflicts() {
    if (!this.operation || !this.root) return;
    const files = this.unmerged.length ? this.unmerged : this.conflictFiles().map((e) => e.path);
    openSend({ title: `Resolve the conflicts · ${files.length} file${files.length === 1 ? "" : "s"}`,
      context: Conflict.askText({ where: `${this.root}${this.on ? ` (on ${this.on})` : ""}`, op: this.operation, stopped: this.stopped ?? {}, files }) });
  }
  moreMenu(cx) {
    if (!this.root || this.busy) return;
    const fill = (m) => { if (bareMessage(this.message, this.template)) { this.message = m; this.input.set_value(m); } };
    const p = this.facts ?? {}, facts = { hasHead: this.hasHead, operation: this.operation, branch: { branch: p.branch, upstream: p.upstream, ahead: p.ahead }, fill, version: this.version };
    const clip = cx.read_from_clipboard?.() ?? "";
    // While its menu is open ⋯ has no tooltip (it would show over the menu): `menuFrom`. Its menus
    // open over it, at the bottom of the page.
    this.flow(cx, (h, cx) => Undo.moreMenuFlow(this.fromMenuButton("more", h, anchorOf("commit-more", { side: "above" }), cx), { ...facts, clip, copy: (text, what) => { cx.write_to_clipboard(text); notify({ title: `Copied ${what}`, level: "success", timeout: 2000 }); } }));
  }
  // `answer` (a menu's), with `which` button marked as its menu's while it's open (no tooltip then).
  fromButton(which, answer, cx) {
    this.menuFrom = which; cx.notify();
    return answer.finally(() => { if (this.menuFrom === which) this.menuFrom = null; });
  }
  // A flow's host whose menus open at button `which` (`anchor`, anchorOf's; null: at the press), the
  // button marked while each of them is open.
  fromMenuButton(which, h, anchor, cx) {
    return { ...h, choose: (spec) => this.fromButton(which, h.choose({ ...spec, anchor }), cx) };
  }

  // ---- Stashes

  stashQuick(cx) { this.perform("stash", (h) => G.stashPush(h, { mode: "all", untracked: true }), cx); }
  stashWith(cx) {
    if (!this.root || this.busy || !this.hasHead || !this.dirty.size) return;
    const from = new Map(this.sections().flatMap((g) => g.rows).filter((r) => r.f.from).map((r) => [r.f.path, r.f.from]));
    const files = [...this.dirty].map(([path, xy]) => ({ path, untracked: xy === "??", from: from.get(path) ?? null })).sort((a, b) => a.path.localeCompare(b.path));
    const facts = { files, staged: this.hasStaged(), open: this.open?.path ?? null };
    this.flow(cx, (h) => Stash.stashWith(h, facts));
  }
  showStash(s, cx) {
    this.choosingStash = false; this.composer = null;
    const shown = (this.stashShown = { stash: s, root: this.root, on: this.on, view: null });
    const h = reader(this.root, this.on);
    cx.spawn(async (cx) => { shown.view = await Stash.loadStash(h, s, { lang: languageOf, tokenize }); cx.notify(); });
    cx.notify();
  }
  stashAction(s, what, cx) { this.choosingStash = false; this.flow(cx, (h) => Stash.stashAction(h, s, what)); cx.notify(); }
  // A stash's ⋯ (stashui.js stashMoreFlow); Compare with working tree is the read-only scope
  // "Compare with…" at the stash's commit.
  stashMore(s, cx) { this.choosingStash = false; this.flow(cx, (h, cx) => Stash.stashMoreFlow(h, s, { compare: (st) => this.setScope("ref", cx, st.hash) })); cx.notify(); }
  stashClear(cx) { this.choosingStash = false; const list = [...(this.stashes ?? [])]; this.flow(cx, (h) => Stash.clearFlow(h, list)); cx.notify(); }

  // ---- Comments

  notesKey() { return Notes.draftKey(this.on, this.root, this.scopeKey()); }
  loadNotes() { return this.root ? Notes.draftsOf(shared(KEY.drafts), this.notesKey()) : []; }
  setNotes(list, cx) {
    this.notes = list;
    if (this.root) setShared(KEY.drafts, Notes.withDrafts(shared(KEY.drafts), this.notesKey(), list));
    this.placeNotes();
    cx?.notify();
  }
  // The cards under the rows of the open file: each comment under its last row (a whole-file comment
  // above them all); the one being edited shows what is typed.
  placeNotes() {
    const rows = this.diff.rows, extras = new Map(), width = this.diff.view(), ch = this.diff.fontSize * 0.62, editing = this.composer?.editing ?? null;
    this.marked = new Set();
    for (const c of this.notes) {
      if (c.path !== this.open?.path) continue;
      const text = c.id === editing ? this.noteText : c.text, place = Notes.placeOf(rows, c);
      const item = { key: `c:${c.id}`, id: c.id, text, span: c.start ? c.span ?? "lines" : "the whole file", live: c.id === editing, height: cardHeight(text, width, ch) };
      const at = place ? place.to : "top";
      if (place) for (let i = place.from; i <= place.to; i++) this.marked.add(i);
      (extras.get(at) ?? extras.set(at, []).get(at)).push(item);
    }
    this.diff.setExtras(extras);
  }
  // A click on a row: the comment box on it; another row widens the range, one inside it keeps just
  // that one; a @@ row takes its whole hunk.
  clickRow(i, cx) {
    const r = this.diff.rows[i];
    if (!r || !this.open) return;
    if (isGap(r.text)) { this.openGap(i, cx); return; }
    if (r.kind === "") return;
    let from = i, to = i;
    if (r.kind === "@") { const end = this.diff.rows.findIndex((x, k) => k > i && x.kind === "@"); from = i + 1; to = (end < 0 ? this.diff.rows.length : end) - 1; }
    const c = this.composer;
    if (c && !c.editing && c.path === this.open.path && c.from !== null && r.kind !== "@") {
      if (i < c.from || i > c.to) { from = Math.min(c.from, i); to = Math.max(c.to, i); }
    }
    // The rows as they were selected: a reload of the diff (the file changed) moves rows, and the
    // lines' actions then refuse rather than take other lines (lineStale).
    this.composer = { path: this.open.path, from, to, editing: null, rows: this.rowsAt(from, to) };
    this.openBox(cx);
  }
  rowsAt(from, to) { return this.diff.rows.slice(from, to + 1).map((r) => `${r.kind}\t${r.text}`); }
  /** The box's rows aren't the ones selected any more (the diff was read again since). */
  lineStale() { const c = this.composer; return Boolean(c?.rows && c.from !== null && this.rowsAt(c.from, c.to).join("\n") !== c.rows.join("\n")); }
  commentFile(path, cx) {
    if (this.open?.path !== path) { const section = this.sections().find((g) => g.rows.some((r) => r.f.path === path))?.key ?? null; if (section) this.pick(path, section, cx); }
    this.composer = { path, from: null, to: null, editing: null };
    this.openBox(cx);
  }
  editNote(id, cx) {
    const c = this.notes.find((x) => x.id === id);
    if (!c) return;
    const place = Notes.placeOf(this.diff.rows, c);
    this.composer = { path: c.path, from: place?.from ?? null, to: place?.to ?? null, editing: id };
    this.openBox(cx, c.text);
  }
  openBox(cx, text = "") {
    this.noteText = text; this.noteBox.set_value(text); this.noteBox.focus();
    cx.timer.after(60, () => this.noteBox.focus());
    this.placeNotes();
    cx.notify();
  }
  closeBox(cx) { this.composer = null; this.noteText = ""; this.placeNotes(); this.handle.focus(); cx.notify(); }
  addNote(cx) {
    const c = this.composer, text = this.noteBox.value().trim();
    if (!c) return;
    if (!text) { this.closeBox(cx); return; }
    const list = c.editing ? this.notes.map((x) => (x.id === c.editing ? { ...x, text } : x))
      : [...this.notes, Notes.makeComment({ rows: this.diff.rows, path: c.path, from: c.from, to: c.to, text, about: c.from === null ? this.describe(c.path) : null })];
    this.composer = null; this.noteText = "";
    this.setNotes(list, cx);
    this.handle.focus();
  }
  deleteNote(cx) { const id = this.composer?.editing; this.composer = null; this.setNotes(this.notes.filter((x) => x.id !== id), cx); }
  where(path) { const full = `${this.root}/${path}`; return this.on ? `${full} (on ${this.on})` : full; }
  // A file's change in words (a comment on the whole file says it): its row in the scope's list.
  describe(path) { const f = this.files.find((x) => x.path === path); return f ? Notes.describeFile(f) : null; }
  // Submit review: every comment in one message to the space's agent; sent, the drafts go.
  submit(cx) {
    if (!this.notes.length || !this.root) return;
    const where = `${this.root}${this.on ? ` (on ${this.on})` : ""}`;
    openSend({ title: `Review · ${this.notes.length} comment${this.notes.length === 1 ? "" : "s"}`, context: Notes.reviewMessage({ where, scope: this.scopeWords(), comments: this.notes }), sentKey: this.notesKey() });
  }
  askRows(from, to) {
    if (!this.open) return;
    openSend({ title: `${this.open.path} · ${Notes.spanOf(this.diff.rows, from, to)}`, context: Notes.askLinesMessage({ where: this.where(this.open.path), view: this.viewWords(), rows: this.diff.rows, from, to }) });
  }
  askDiff() {
    if (!this.open || !this.diff.rows.length) return;
    openSend({ title: this.open.path, context: Notes.askDiffMessage({ where: this.where(this.open.path), view: this.viewWords(), rows: this.diff.rows }) });
  }
  // The rows a right-click asks about: a @@ row its hunk, a side-by-side row both its lines.
  askKey(key) {
    const rows = this.diff.rowsOfKey(key).filter((i) => this.diff.rows[i]?.kind !== "" && !isGap(this.diff.rows[i]?.text));
    if (!rows.length) return;
    const r = this.diff.rows[rows[0]];
    if (r.kind === "@") { const end = this.diff.rows.findIndex((x, k) => k > rows[0] && x.kind === "@"); this.askRows(rows[0] + 1, (end < 0 ? this.diff.rows.length : end) - 1); return; }
    this.askRows(Math.min(...rows), Math.max(...rows));
  }
  // Right-click a row: Ask about it, or Open at its line with the settings' program for lines.
  rowMenu(key, cx) {
    if (key.startsWith("c:") || !this.open) return;
    const i = this.diff.rowOf(key), r = this.diff.rows[i], path = this.open.path, root = this.root, on = this.on;
    if (!r || r.kind === "" || isGap(r.text)) return;
    const line = lineFor(this.diff.rows, i), exists = this.files.find((f) => f.path === path)?.status !== "D" && this.dirty.get(path)?.[1] !== "D";
    cx.spawn(async (cx) => {
      const openWith = settingsOf(KEYS.openWith, shared(KEYS.openWith)), items = itemsOf(openWith.items);
      const here = await this.programs(items), there = on ? await this.programs(items, on) : null;
      const plan = on ? remotePlan({ openWith, found: { here, there }, path: `${root}/${path}`, line, on, host: await hostOf(on) }) : openAt({ openWith, found: here, path: `${root}/${path}`, line, platform: platform() });
      // Blame: a new-side line as the working tree (or the scope's newer commit) has it, a removed
      // one as the older side had it (blame.js).
      const blameAt = r.kind === "-" ? { rev: this.ref ?? "HEAD", line: r.number } : r.kind === "+" || r.kind === " " ? { rev: this.to ?? null, line: r.number } : null;
      const blame = blameAt && this.hasHead && exists !== undefined ? [{ id: "blame", label: `Blame line ${blameAt.line}${r.kind === "-" ? " (removed)" : ""}`, detail: "Who last changed it, and when" }] : [];
      const pick = await onPage(cx, this.questions.choose({ title: `${path.split("/").pop()} · line ${line}`, width: 300, items: [...lineMenu({ kind: r.kind, line, local: !on, exists, plan, machine: on }), ...blame] }));
      if (pick === "ask") this.askKey(key);
      else if (pick === "blame" && this.root === root) {
        const h = this.host(cx);
        await blameFlow(h, { path, ...blameAt, show: (sha) => this.setScope("commit", cx, sha),
          copy: (text, what) => { cx.write_to_clipboard(text); notify({ title: `Copied ${what}`, body: text, level: "success", timeout: 2000 }); } });
      }
      else if (pick === "open" && plan && this.root === root) {
        const failed = await runPlan(plan, { exec, run });
        if (failed) this.line = `Open failed: ${failed}`;
      }
      cx.notify();
    });
  }

  // ---- More context, review keys, viewed files

  openGap(i, cx) {
    const gap = this.gaps?.get(i), open = this.open, context = this.context;
    if (!gap || !open) return;
    const k = this.contextFor(open.path, open.section);
    this.moreContext.set(k, (this.moreContext.get(k) ?? 0) + MORE);
    cx.spawn(async (cx) => {
      try { await this.load(open, context); } catch (e) { this.line = `Cannot show more lines: ${firstLine(e)}`; }
      const want = revealed(gap), row = this.diff.rows.findIndex((r) => r.kind !== "-" && r.kind !== "@" && r.number === want);
      if (row >= 0) this.diff.reveal(row);
      this.placeNotes();
      cx.notify();
    });
  }
  isViewed(path) { const h = this.hashes?.get(path); return h === undefined ? undefined : (shared(KEY.viewed) ?? {})[this.notesKey()]?.[path] === h; }
  toggleViewed(path) {
    const h = this.hashes?.get(path);
    if (h === undefined || !this.root) return;
    const all = { ...(shared(KEY.viewed) ?? {}) }, k = this.notesKey(), mine = { ...(all[k] ?? {}) };
    if (mine[path] === h) delete mine[path]; else mine[path] = h;
    if (Object.keys(mine).length) all[k] = mine; else delete all[k];
    setShared(KEY.viewed, all);
  }
  // A viewed file whose diff changed, or that left the list, is no longer viewed.
  pruneViewed() {
    const all = shared(KEY.viewed) ?? {}, k = this.notesKey(), mine = all[k];
    if (!this.hashes || !mine) return;
    const listed = new Set(this.files.map((f) => f.path));
    const kept = Object.entries(mine).filter(([path, h]) => listed.has(path) && (!this.hashes.has(path) || this.hashes.get(path) === h));
    if (kept.length === Object.keys(mine).length) return;
    const next = { ...all };
    if (kept.length) next[k] = Object.fromEntries(kept); else delete next[k];
    setShared(KEY.viewed, next);
  }
  currentHunk() { const h = this.diff.hunks ?? []; return h.length ? h[Math.min(this.hunkAt, h.length - 1)] : -1; }
  // The Review tab's keys: j/k hunk, n/p file, s/u/r stage, unstage or revert the current hunk, v viewed.
  reviewKey(key, cx) {
    if (key === "j" || key === "k") {
      const h = this.diff.hunks ?? [];
      if (h.length) { this.hunkAt = Math.max(0, Math.min(h.length - 1, this.hunkAt + (key === "j" ? 1 : -1))); this.diff.reveal(h[this.hunkAt], "top"); }
    } else if (key === "n" || key === "p") {
      const list = this.sections().flatMap((g) => g.rows.map((r) => ({ path: r.f.path, section: g.key })));
      const at = list.findIndex((x) => x.path === this.open?.path && x.section === this.open?.section), d = key === "n" ? 1 : -1;
      const next = list[at < 0 ? (d > 0 ? 0 : list.length - 1) : at + d];
      if (next) this.pick(next.path, next.section, cx);
    } else if (key === "s" || key === "u" || key === "r") {
      const kind = { s: "stage", u: "unstage", r: "revert" }[key], i = this.currentHunk();
      if (i >= 0 && this.hunkActions().some((a) => a.id === kind)) this.hunk(kind, i, cx);
    } else if (key === "v") { if (this.open) this.toggleViewed(this.open.path); }
    else return false;
    cx.notify();
    return true;
  }
  // The Review tab: the one open for this repository already, if any; the panel makes room while it
  // is open (tabs.js). From a click.
  openReview(cx) {
    if (this.root) openAsTab({ mod: ID, kind: "review", root: this.root, on: this.on, props: { ...(props() ?? {}), review: true, root: this.root, on: this.on } }, cx);
  }

  // ---- Keys

  // cmd-enter's newline is taken back: the box as it was before the press.
  untype() {
    const now = this.input.value(), t = this.typed;
    const before = now !== this.message ? this.message : t && Date.now() - t.at < 50 ? t.before : null;
    if (before === null || !newlineTyped(before, now)) return;
    this.message = before; this.typed = null; this.input.set_value(before);
  }
  // An Enter's action (keys.js), whichever way it came. Commit acts once per press (Presses); a
  // comment's press is taken too, so its other delivery can't commit. True when the key is the page's.
  enter(action, cx) {
    const press = Boolean(action) && this.presses.take(Date.now());
    if (action === "comment") this.addNote(cx);
    else if (action === "commit" && press) this.commit(cx);
    return Boolean(action);
  }

  // ---- Drawing

  narrow() { const width = this.size?.width ?? 368; return width < 600; }

  // What the diff area shows instead of the open file's diff: a stash's changes, or an image's sides.
  covering() {
    const nested = this.stashShown ? null : this.openRepo();
    if (nested) return (t) => this.nestedPane(t, nested);
    const v = this.conflictView;
    if (v && v.path === this.open?.path && !this.stashShown) {
      const put = this.caps?.put !== false;
      return (t) => Conflict.conflictPane({ t, v, names: this.sideNames(), code: { family: codeFont(), size: this.diff.fontSize, row: this.diff.row }, idle: !this.busy,
        canSave: put, saveWhy: `Writing the file on ${this.on} needs base64 or openssl there`,
        onChoose: (i, c, cx) => { v.choices = [...v.choices]; v.choices[i] = c; cx.notify(); },
        onSave: (cx) => this.perform("resolve", (h) => Conflict.saveConflict(h, v), cx),
        onBase: (cx) => this.flow(cx, (h) => Conflict.baseFlow(h, { path: v.path, version: this.version })),
        onClose: (cx) => { this.conflictClosed = v.path; this.conflictView = null; cx.notify(); } });
    }
    const s = this.stashShown;
    if (s && (s.root !== this.root || s.on !== this.on || !(this.stashes ?? []).some((x) => x.hash === s.stash.hash))) this.stashShown = null;
    const im = this.picture;
    if (!this.stashShown && im && im.root === this.root && im.on === this.on && im.path === this.open?.path && im.section === this.open?.section && !im.text) {
      return (t) => imagePane({ t, path: im.path, copies: im.copies, error: im.error, dir: CACHE, labels: im.labels, onText: im.svg ? (cx) => { im.text = true; cx.notify(); } : null });
    }
    if (!this.stashShown) return null;
    return (t, colors) => Stash.stashPane({ t, colors, code: { family: codeFont(), size: this.diff.fontSize, row: this.diff.row, ch: this.diff.fontSize * 0.62 }, stash: s.stash, view: s.view, idle: !this.busy,
      wrap: this.diff.wrapping() ? wrapSpans : null, width: (this.stashWidth ?? this.diff.view()) - 2,
      onAction: (st, what, cx) => this.stashAction(st, what, cx), onClose: (cx) => { this.stashShown = null; cx.notify(); },
      onWidth: (w, cx) => { if (w !== this.stashWidth) { this.stashWidth = w; cx.notify(); } } });
  }

  // A repository inside this one, open: why there is no diff, and Show its changes.
  nestedPane(t, path) {
    return v_flex().id("nested-repo-view").flex_1().min_w(0).min_h(0).p(12).gap(10)
      .child(div().text_size(12).text_color(t.foreground).whitespace_normal().child(`${path} is a git repository of its own inside this one. Its changes are in that repository.`))
      .child(div().text_size(11).text_color(t.dim).whitespace_normal().child("Stage all and Commit leave it out. A submodule (git submodule add) or a line in .gitignore is usually what's meant; its right-click menu can stage it as an embedded repository."))
      .child(h_flex().child(chip(t, "nested-repo-show", "Show its changes", { tip: pinned() ? "Open a Review tab for that repository" : "Switch this page to that repository", onClick: (_e, cx) => this.showNested(path, cx) })));
  }

  // ---- Reveal requests (shared/reveal.js, reveals.js)

  // What the choice among this mod's copies needs to know of this one: a list. A layout block whose
  // switch shows History where the layout has no History page (block.js) counts as a panel History
  // page too, on the repository its History shows (else this page's: History starts on it).
  revealFacts() {
    const tab = this.review(), p = props() ?? {};
    const facts = [{ copy: this, kind: "changes", tab, root: tab ? p.root : this.root, on: tab ? p.on ?? null : this.on, roots: tab ? [] : this.repoSet.list() }];
    if (this.historySwitch && pagePlace(layout(), ID, "history")?.switch) {
      const h = this.historySwitch.history(), seen = h?.readOnce ? h : this;
      facts.push({ copy: this, kind: "history", tab: false, root: seen.root, on: seen.on, roots: this.repoSet.list() });
    }
    return facts;
  }
  // A request seen by a render (once this copy has read its repository), taken from a timer; a
  // pending one once the repository it switched to has been read.
  takeReveal(cx) {
    if (!this.readOnce || this.loading) return;
    const req = requestOf(shared(KEY.reveal), "changes");
    if (req && req.at !== this.seenReveal) { this.seenReveal = req.at; cx.timer.after(1, (cx) => this.revealRequest(req, cx)); }
    const p = this.pendingReveal;
    if (p && this.root === p.root && this.on === p.on) { this.pendingReveal = null; cx.timer.after(1, (cx) => this.showPath(p.path, cx)); }
  }
  revealRequest(req, cx) {
    const ready = [...takers].filter((c) => c.readOnce).flatMap((c) => c.revealFacts());
    const mine = takersFor(req, ready, Boolean(pagePlace(layout(), ID, req.page))).find((x) => x.copy === this);
    if (!mine) return;
    // History: the block's own (its switch) for a repository it shows or lists, else a tab.
    if (req.page === "history") { if (mine.how !== "tab" && this.historySwitch) this.historySwitch.reveal(req, mine.how, cx); else this.openHistoryTab(req, cx); return; }
    if (mine.how === "show") this.showPath(req.path, cx);
    else if (mine.how === "pick") { this.pendingReveal = req; this.repoSet.choose(req.root); cx.notify(); }
    else openAsTab({ mod: ID, kind: "review", root: req.root, on: req.on, props: { ...(props() ?? {}), review: true, root: req.root, on: req.on } }, cx);
  }
  // No History page here (nor a block's switch that can show it): History for that repository in a
  // tab of its own (its copy takes the request).
  openHistoryTab(req, cx) {
    openAsTab({ mod: ID, kind: "history", root: req.root, on: req.on, props: { ...(props()?.palette ? { palette: props().palette } : {}), view: "history", root: req.root, on: req.on } }, cx);
  }
  // A file's diff, in the uncommitted changes when a read-only scope shows; the page comes forward
  // (and `onForward`, set by a block that may show History instead: block.js, switches back to it).
  showPath(path, cx) {
    if (readOnly(this.scope)) { this.pendingReveal = { root: this.root, on: this.on, path }; this.setScope("work", cx); return; }
    const section = sectionFor(this.sections(), path);
    if (!section) this.line = `${path}: no changes here`;
    else if (this.open?.path !== path || this.open?.section !== section) this.pick(path, section, cx);
    if (this.review()) showTab({ mod: ID, kind: "review", root: this.root, on: this.on });
    else { bringForward(placeIn(layout(), isPage(ID, "changes"))); this.onForward?.(cx); }
    cx.notify();
  }

  // Things another copy asked for, seen by a render and done from a timer (a render may not start
  // work that notifies); a block showing History calls it in its render (block.js).
  follow(cx) {
    if (contextKey() !== this.context) this.refresh(cx);
    const size = codeSize();
    if (size !== this.diff.fontSize) this.diff.setFont(size);
    if (this.diff.sideBySide() !== this.diff.built.split) this.diff.measure();
    else if (this.diff.wrapping() !== this.diff.built.wrap) this.diff.layout();
    const options = `${prefs().whitespace}|${prefs().context}`;
    if (this.optionsSeen !== undefined && options !== this.optionsSeen) cx.timer.after(1, (cx) => this.refresh(cx, true));
    this.optionsSeen = options;
    const changed = shared(KEY.changed);
    if (changed !== this.seenChange) { this.seenChange = changed; cx.timer.after(1, (cx) => this.refresh(cx, true)); }
    const sent = shared(KEY.sent);
    if (sent?.at && sent.at !== this.seenSent) { this.seenSent = sent.at; if (sent.key === this.notesKey()) cx.timer.after(1, (cx) => this.setNotes([], cx)); }
    const show = shared(SHOW);
    if (show?.at && show.at !== this.seenShow) { this.seenShow = show.at; if (!this.review() && show.key === this.repoKey()) cx.timer.after(1, (cx) => { this.onForward?.(cx); this.setScope(show.scope, cx, show.target ?? null); }); }
    this.takeReveal(cx);
    const template = prefs().template;
    if (template !== this.template) {
      const old = this.template;
      this.template = template;
      cx.timer.after(1, (cx) => { if (this.message === old && !this.amend) { this.message = template; this.input.set_value(template); cx.notify(); } });
    }
    // Drafts another copy changed (the Review tab and the panel share them).
    const stored = this.root ? Notes.draftsOf(shared(KEY.drafts), this.notesKey()) : [];
    if (!this.composer && JSON.stringify(stored.map((c) => [c.id, c.text])) !== JSON.stringify(this.notes.map((c) => [c.id, c.text]))) { this.notes = stored; this.placeNotes(); }
  }

  render(cx) {
    this.follow(cx);
    const t = theme(), colors = palette(props()?.palette, t), review = this.review(), cover = this.covering(), sections = this.sections();
    const add = this.files.reduce((n, f) => n + (f.add ?? 0), 0), del = this.files.reduce((n, f) => n + (f.del ?? 0), 0);
    const drafts = new Map(); for (const c of this.notes) drafts.set(c.path, (drafts.get(c.path) ?? 0) + 1);
    const target = this.composer && this.composer.path === this.open?.path && this.composer.from !== null ? { from: this.composer.from, to: this.composer.to } : null;
    const root = v_flex().id("changes").size_full().min_h(0).relative().rounded(10).overflow_hidden().bg(t.surface).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_size_change((size, cx) => { const w = this.size?.width; this.size = size; if (w !== size.width) cx.notify(); })
      .on_key_down((e, cx) => {
        const m = e.modifiers ?? {};
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
        else if (e.key === "escape" && this.composer) { this.closeBox(cx); cx.stop_propagation(); }
        else if (e.key === "enter" && (m.platform || m.control) && this.enter(enterAction({ secondary: m.platform, control: m.control, held: e.is_held, typing: this.typing, naming: this.naming, composer: Boolean(this.composer) }), cx)) cx.stop_propagation();
        else if (review && !this.typing && !this.naming && !this.choosingBranch && !this.composer && !m.platform && !m.control && !m.alt && !m.shift && this.reviewKey(e.key, cx)) cx.stop_propagation();
      })
      .on_key_up((e) => { if (e.key === "enter") this.presses.release(); });
    return this.diff.follow(root)
      .child(this.header(t, { add, del, review }))
      .when(Boolean(this.root), (e) => e.child(this.repoBar(t, review)))
      .when(Boolean(this.unread), (e) => e.child(this.unreadBar(t)))
      .children(this.root ? [turnNote(t, { root: this.root, on: this.on, changed: KEY.changed })].filter(Boolean) : [])
      .when(Boolean(this.root && this.operation), (e) => e.child(Conflict.stoppedBar({ t, op: this.operation, stopped: this.stopped, conflicts: this.conflictFiles().length, staged: this.hasStaged(), idle: !this.busy, busy: this.busy,
        narrow: this.narrow(), version: this.version, onContinue: (cx) => this.continueOperation(cx), onSkip: (cx) => this.skipOperation(cx), onAbort: (cx) => this.abortOperation(cx), onAsk: () => this.askConflicts() })))
      .when(Boolean(this.root) && !readOnly(this.scope) && (this.dirty.size > 0 || (this.stashes ?? []).length > 0), (e) => e.child(this.actionBar(t)))
      .when(Boolean(this.root) && readOnly(this.scope), (e) => e.child(readOnlyBar(t, { words: this.scopeWords(), back: (cx) => this.setScope("work", cx),
        extra: this.scope === "turn" ? turnButtons(t, { root: this.root, record: turnRecords().find((r) => r.id === this.scopeTarget) ?? null, mod: ID, changed: KEY.changed }) : [] })))
      .child(fileList(t, { sections, open: this.open, busy: this.busy === "stage" || this.busy === "unstage" ? this.busyRow : null, idle: !this.busy, review,
        viewed: (p) => this.isViewed(p), drafts, max: review ? 320 : 260, shown: (g) => this.shownOf(g), onMore: (s, cx) => { this.showMore(s); cx.notify(); },
        empty: this.error || (this.unread ? "Its changes show once it is read" : this.loading && !this.root ? "Reading the changes…" : this.root ? (readOnly(this.scope) ? "No differences" : "No uncommitted changes") : "No folder"),
        onPick: (p, s, cx) => this.pick(p, s, cx), onStage: (p, s, cx) => this.stageRow(p, s, cx), onMenu: (p, s, cx) => this.fileMenu(p, s, cx),
        onComment: (p, cx) => this.commentFile(p, cx), onViewed: (p, cx) => { this.toggleViewed(p); cx.notify(); } }))
      .when(this.limited, (e) => e.child(div().px(12).py(4).text_size(11).text_color(t.dim).child(`Showing the first ${MAX_FILES.toLocaleString("en")} changed files`)))
      // The diff's row stretches what it holds: an h_flex centres it, and a box as tall as its content
      // would leave the diff's virtual list 0 px tall (no diff shown at all).
      .child(h_flex().flex_1().min_h(0).min_w(0).items_stretch()
        .child(div().id("changes-diff-box").flex_1().min_w(0).min_h(0).flex().when(Boolean(cover), (e) => e.hidden())
          .child(this.diff.element(t, { colors, font: codeFont(), target, marked: this.marked, current: review ? this.currentHunk() : null, actions: this.hunkActions(), busy: this.busyHunk, waiting: Boolean(this.busy),
            note: this.hunksOff ? "whitespace ignored · no Stage / Revert" : null, extra: (it) => commentCard(t, { ...it, inset: 4 + this.diff.gutter + 16, ui: null }),
            hint: this.hint(t),
            onRow: (key, cx) => this.rowClick(key, cx), onSecondary: (key, _e, cx) => this.rowMenu(key, cx) })))
        .when(Boolean(cover), (e) => e.child(cover(t, colors)))
        .when(Boolean(this.composer) && !this.narrow(), (e) => e.child(this.box(t, false))))
      .when(Boolean(this.composer) && this.narrow(), (e) => e.child(this.box(t, true)))
      .when(Boolean(this.line), (e) => e.child(div().px(10).py(4).text_size(11).text_color(readable(t, t.ansi1)).whitespace_normal().child(this.line)))
      .when(this.askStage, (e) => e.child(div().px(10).pb(8).text_size(11).text_color(readable(t, t.blocked)).whitespace_normal().child(this.askStageWords())))
      .when(this.askPushed, (e) => e.child(div().px(10).pb(8).text_size(11).text_color(readable(t, t.blocked)).child("This commit is already pushed; amending rewrites it. Press Commit again to amend.")))
      .child(this.commitBar(t));
  }

  // What the first Commit with nothing staged asks; the repositories inside this one stay out.
  askStageWords() {
    const repos = this.innerRepos(), n = repos.length;
    const out = n ? ` The ${n === 1 ? "repository" : `${n} repositories`} inside this one (${repoList(repos)}) ${n === 1 ? "stays" : "stay"} out.` : "";
    return (this.amend ? "Nothing is staged. Commit again to stage every change into the last commit." : "Nothing is staged. Commit again to stage every change and commit it.") + out;
  }

  rowClick(key, cx) {
    if (key.startsWith("c:")) { if (key.slice(2) !== this.composer?.editing) this.editNote(key.slice(2), cx); return; }
    const i = this.diff.rowOf(key);
    if (i < 0) return;
    const r = this.diff.rows[i], actions = this.hunkActions();
    if (r?.kind === "@" && actions.length) {
      const k = this.diff.buttonHit(actions.length);
      if (k >= 0) { this.hunk(actions[k].id, i, cx); return; }
    }
    this.clickRow(i, cx);
  }

  // What a click and a right-click do, over the diff's bottom right corner: no wider than the diff
  // less its margins, and it wraps. With only its text's width as a limit it would take the whole
  // diff's width, and on a narrow panel its right margin would push its first letters past the diff's
  // left edge.
  hint(t) {
    if (!this.open || !this.diff.rows.length || this.composer || this.notes.length) return null;
    return div().absolute().bottom(this.diff.sideways() ? 16 : 6).right(14).max_w(Math.max(120, this.diff.view() - 28))
      .px(8).py(3).rounded(6).bg(alpha(t.raised, 0.9)).text_size(10).text_color(t.muted).whitespace_normal()
      .child(this.review() ? "Click a line to comment · right-click: ask, open · j/k hunk · n/p file · s/u/r stage, unstage, revert · v viewed" : "Click a line to comment · right-click: ask, or open at the line");
  }

  box(t, docked) {
    const c = this.composer, rows = this.diff.rows;
    const span = c.from === null ? "the whole file" : Notes.spanOf(rows, c.from, c.to);
    return composer(t, { c: { path: c.path, span, editing: c.editing }, state: this.noteBox, docked, help: this.help, ui: null, lines: this.lineChoices(),
      onAdd: (cx) => this.enter("comment", cx), onCancel: (cx) => this.closeBox(cx), onDelete: (cx) => this.deleteNote(cx), onHelp: (cx) => { this.help = !this.help; cx.notify(); } });
  }

  // The page's top row. On a narrow panel (narrow(): under 600 px) "Ask about diff" is its icon
  // alone: with its words the row runs off a 375 px panel, the button cut in half at its right
  // edge. The scope box gives way first (its label truncates); everything else keeps
  // its width, the gear last of all. In a block with the Changes | History switch (block.js) the
  // switch is the page's name, and under CHIP_ROOM px the file count's chip makes room for it (the
  // bar over the list says the count too).
  header(t, { add, del, review }) {
    const n = this.notes.length, narrow = this.narrow(), gear = settingsGear("changes-settings", "changes");
    const named = this.titled?.(t) ?? null, chip = !named || (this.size?.width ?? 368) >= CHIP_ROOM;
    const ask = n === 0 && Boolean(this.open && this.diff.rows.length);
    const button = (id, label, primary, onClick, tip) => div().id(id).h(24).px(10).flex().flex_none().items_center().rounded(6).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .text_size(12).font_medium().cursor_pointer().hover((s) => s.opacity(0.88)).when(Boolean(tip), (e) => e.tooltip(tip)).on_click((_e, cx) => onClick(cx)).child(label);
    return h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(named ?? div().flex_none().font_semibold().child("Changes"))
      .when(chip, (e) => e.child(div().flex_none().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(this.countWords(this.files.filter((f) => !f.repo).length, 0))))
      .when(Boolean(this.root), (e) => e.child(this.scopePicker(t)))
      .when(review, (e) => e.children(this.switches(t)).child(this.optionsControl(t)).child(this.whitespaceControl(t))
        .when(Boolean(this.hashes), (e) => e.child(div().text_size(11).text_color(t.dim).child(`${this.files.filter((f) => this.isViewed(f.path) === true).length} / ${this.files.length} viewed`))))
      .child(div().flex_1())
      .child(div().flex_none().text_size(11).text_color(readable(t, t.ansi2)).child(`+${add}`)).child(div().flex_none().text_size(11).text_color(readable(t, t.ansi1)).child(`−${del}`))
      .when(ask && !narrow, (e) => e.child(button("ask-diff", "Ask about diff", false, () => this.askDiff(), "Ask the space's agent about this file's diff")))
      .when(n > 0, (e) => e
        .child(div().id("drafts-discard").h(24).px(8).flex().flex_none().items_center().rounded(6).text_size(12).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.setNotes([], cx)).child("Discard"))
        .child(button("drafts-submit", `Submit review · ${n}`, true, (cx) => this.submit(cx), "Send every comment to the space's agent as one message")))
      // Last, the gear: the settings window at Git, or closes it when it's open (the ⋯ menu by
      // Commit has Settings… too). Under 600 px Ask about diff is an icon button beside it.
      .child(iconRow([
        ask && narrow && iconButton(t, "ask-diff", asset("message.svg"), () => this.askDiff(), { tip: "Ask the space's agent about this file's diff", label: "Ask about diff" }),
        iconButton(t, gear.id, "mods/workspace-chrome/settings.svg", (cx) => gear.open(cx), { tip: gear.tip }),
      ]));
  }

  // "3 files", "3 files · 2 repositories": a repository inside this one isn't a file. The header's
  // chip counts the files only (no room there); the bar over the list names the repositories too.
  countWords(files, repos) {
    return `${files} file${files === 1 ? "" : "s"}${repos ? ` · ${repos} ${repos === 1 ? "repository" : "repositories"}` : ""}`;
  }

  // The scope picker: the scope's name in a box; its list has the scopes this repository offers.
  scopePicker(t) {
    const f = this.facts ?? {}, turns = turnChoices(turnRecords(), this.repoKey());
    const options = [
      { scope: "work", label: "Uncommitted", detail: "the working tree against HEAD", ok: true },
      { scope: "last", label: "Last commit", detail: f.parent ? "the last commit, plus what is uncommitted" : "HEAD has no parent", ok: Boolean(f.parent) },
      { scope: "branch", label: f.base ? `vs ${f.base}` : "vs the base branch", detail: f.offBase ? `everything on ${f.branch} since it left ${f.base}` : f.base ? `on ${f.base} itself` : "no main or master branch", ok: Boolean(f.offBase) },
      { scope: "commit", label: "A commit…", detail: this.scope === "commit" ? readOnlyWords("commit", this.scopeTarget, this.scopeSpan ?? {}) : "one commit against its first parent · read-only", ok: this.hasHead, list: true },
      { scope: "ref", label: "Compare with…", detail: this.scope === "ref" ? readOnlyWords("ref", this.scopeTarget, this.scopeSpan ?? {}) : "a branch, tag or commit against the working tree · read-only", ok: this.hasHead, list: true },
      { scope: "turn", label: "An agent's turn…", detail: this.scope === "turn" ? readOnlyWords("turn", this.scopeTarget, this.scopeSpan ?? {}) : turns.length ? `${turns.length} recorded here · what one changed · read-only` : "none recorded here yet", ok: turns.length > 0, list: true },
    ];
    const boxBorder = this.choosingScope ? t.accent : t.border;
    const box = h_flex().id("scope-box").h(24).min_w(0).px(8).gap(6).items_center().rounded(6).border_1().border_color(boxBorder).bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover))
      .when(!this.choosingScope, (e) => e.tooltip("What is shown: the uncommitted changes, the last commit, the whole branch, one commit, the working tree against a ref, or an agent's turn"))
      .child(div().min_w(0).text_size(12).truncate().child(this.scopeLabel())).child(chevron(t.muted));
    const choose = (o, cx) => o.list ? this.scopeLists.show(o.scope, { root: this.root, on: this.on }, (scope, target, cx) => this.setScope(scope, cx, target), cx, o.scope === "turn" ? () => turns : null) : this.setScope(o.scope, cx);
    return Popover.new("scope").open(this.choosingScope).on_open_change((open, cx) => { this.choosingScope = open; if (!open) this.scopeLists.close(); cx.notify(); }).trigger(box)
      .content(this.scopeLists.kind ? this.scopeLists.element(t) : v_flex().mt(4).w(290).p(5).gap(1).rounded(8).border_1().border_color(t.border).bg(t.popover).shadow_lg().children(options.map((o) =>
        h_flex().id(`scope-${o.scope}`).px(9).py(6).gap(10).items_center().rounded(6).when(o.ok, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => choose(o, cx)))
          .child(v_flex().flex_1().min_w(0).gap(1).child(div().text_size(12).when(!o.ok, (e) => e.text_color(t.muted)).child(o.label)).child(div().text_size(10.5).text_color(t.muted).truncate().child(o.detail)))
          .child(o.scope === this.scope ? svg(asset("check.svg")).size(12).text_color(t.accent) : div().w(12)))));
  }

  // The Review tab's switches: Unified | Split, Wrap | Scroll.
  switches(t) {
    const split = this.diff.sideBySide(), wrap = this.diff.wrapping();
    const part = (id, label, on, pick, tip) => div().id(id).h(20).px(8).flex().items_center().rounded(5).text_size(12).bg(on ? t.selected : CLEAR).text_color(on ? t.foreground : t.dim)
      .cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip(tip).on_click((_e, cx) => { pick(); this.placeNotes(); cx.notify(); }).child(label);
    const group = (a, b) => h_flex().h(24).p(1).gap(1).flex_none().items_center().rounded(6).border_1().border_color(t.border).child(a).child(b);
    return [
      group(part("layout-unified", "Unified", !split, () => this.diff.setSideBySide(false), "One column, removed lines above the added ones"),
        part("layout-split", "Split", split, () => this.diff.setSideBySide(true), "Old | new side by side")),
      group(part("lines-wrap", "Wrap", wrap, () => this.diff.setWrapping(true), "Long lines wrap within the width"),
        part("lines-scroll", "Scroll", !wrap, () => this.diff.setWrapping(false), "Long lines stay one line; the code scrolls sideways")),
    ];
  }
  // The panel's Wrap / Scroll icon (its id names its state, so its tooltip is never the old one).
  linesButton(t) {
    const wrap = this.diff.wrapping();
    return iconButton(t, `lines-mode-${wrap ? "wrap" : "scroll"}`, asset("wrap.svg"), (cx) => { this.diff.setWrapping(!wrap); this.placeNotes(); cx.notify(); }, {
      on: wrap, tip: wrap ? "Long lines wrap · click to keep them one line and scroll sideways" : "Long lines scroll sideways · click to wrap them" });
  }
  // The panel's Split icon (Herdr's split-right): old | new side by side, or one column (shared with
  // the Review tab's Unified | Split and History's).
  splitButton(t) {
    const split = this.diff.sideBySide();
    return iconButton(t, `diff-split-${split ? "on" : "off"}`, "mods/pane/split-right.svg", (cx) => { this.diff.setSideBySide(!split); this.placeNotes(); cx.notify(); }, {
      on: split, tip: split ? "Old | new side by side · click for one column" : "One column · click for old | new side by side" });
  }
  // Ignore whitespace: a switch beside ± (the panel's bar, the Review tab's).
  whitespaceControl(t) {
    return whitespaceButton({ t, on: prefs().whitespace, onToggle: (cx) => { const p = prefs(); setShared(KEYS.changes, storedOf(KEYS.changes, { ...p, whitespace: !p.whitespace })); cx.notify(); } });
  }
  optionsControl(t) {
    return diffOptionsButton({ t, prefs: prefs(), open: Boolean(this.choosingDiffOptions), onOpenChange: (o, cx) => { this.choosingDiffOptions = o; cx.notify(); },
      onSet: (field, value, cx) => { const p = prefs(); if (p[field] !== value) setShared(KEYS.changes, storedOf(KEYS.changes, { ...p, [field]: value })); cx.notify(); } });
  }

  // The row under the header: the repository switcher, the branch, Fetch, Pull ↓N; in the panel the
  // diff options, Wrap / Scroll and the button that opens the Review tab.
  // A repository below the folder that isn't read: the switcher (another one), and why, with Read it.
  unreadBar(t) {
    const u = this.unread;
    return v_flex().flex_none()
      .when(this.repoSet.many(), (e) => e.child(h_flex().h(30).flex_none().px(10).gap(4).items_center().border_b(1).border_color(t.border)
        .child(this.repoSet.switcher(t, { root: u.root, picked: (cx) => this.refresh(cx, true) }))))
      .child(notReadBar(t, { id: "changes", check: u.check, onRead: (cx) => this.readIt(cx) }));
  }
  // Read it: trust its config as it is now and read it (a change to it asks again).
  readIt(cx) {
    const u = this.unread;
    if (!u) return;
    trustRepo(u.check, u.root, u.on);
    this.unread = null;
    this.refresh(cx, true);
    cx.notify();
  }

  repoBar(t, review) {
    const p = this.facts ?? {}, idle = !this.busy;
    // `menu`: it opens a menu (at it: menuat.js), and while that is open it stays lit, with no tooltip,
    // and a press closes it.
    const action = (id, label, onClick, tip, menu = false) => div().id(id).h(22).px(7).flex().flex_none().items_center().rounded(6).text_size(11.5).text_color(idle ? t.foreground : t.muted)
      .when(idle, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((ev, cx) => { if (!(menu && closingClick(id))) onClick(ev, cx); })).when(!idle, (e) => e.opacity(0.7))
      .when(menu && idle, (e) => e.on_mouse_down("left", pressOn(id, this.menuFrom === "pull"))).when(menu && this.menuFrom === "pull", (e) => e.bg(t.hover))
      .when(!(menu && this.menuFrom === "pull"), (e) => e.tooltip(tip)).child(label);
    const pullId = `pull-${Sync.divergenceOf(p).state}-${p.ahead ?? 0}-${p.behind}`;
    return h_flex().h(30).flex_none().px(10).gap(4).items_center().border_b(1).border_color(t.border)
      .child(h_flex().flex_1().min_w(0).gap(2).when(this.repoSet.many(), (e) => e.child(this.repoSet.switcher(t, { root: this.root, picked: (cx) => this.refresh(cx, true) }))).when(this.hasHead, (e) => e.child(this.branchPicker(t))))
      .when(Boolean(p.remote), (e) => e.child(action("fetch", this.busy === "fetch" ? BUSY.fetch : "Fetch", (_e, cx) => this.fetch(cx), `git fetch --prune: what ${p.remote} has now${this.fetchError ? ` · the last automatic fetch failed: ${this.fetchError}` : ""}`)))
      .when(p.behind > 0, (e) => e.child(action(pullId, this.busy === "pull" ? BUSY.pull : withChevron(`Pull ↓${p.behind}`), (_e, cx) => this.pull(cx, pullId), `${Sync.divergenceOf(p).words} · choose how to pull`, true)))
      .when(!review, (e) => e.child(iconRow([this.optionsControl(t), this.whitespaceControl(t), this.linesButton(t), this.splitButton(t),
        // ⤢: Herdr's own icon for a pane's zoom, as History's; ⤡ in the tab goes back.
        iconButton(t, "open-review", "mods/pane/zoom.svg", (cx) => this.openReview(cx), { tip: "Open the review in a tab (the panel makes room)" })])))
      // ⤡: Herdr's own icon for a pane's unzoom (its pane mod's), as History's in its tab.
      .when(review && Boolean(props()?.root), (e) => e.child(iconButton(t, "review-back", "mods/pane/unzoom.svg", () => backToPanel({ mod: ID, kind: "review" }), { tip: "Back to the panel (closes this tab)" })));
  }

  // The branch as a small box; its list has the local branches (a click switches, a right-click has
  // their menu), "New branch…", and the remote branches.
  branchPicker(t) {
    const branch = this.facts?.branch, name = this.busy === "switch" ? BUSY.switch : branch || "detached HEAD";
    const room = Math.min(320, Math.max(80, (this.size?.width ?? 368) - 246));
    const box = h_flex().id("branch-box").h(22).min_w(0).max_w(room).px(7).gap(5).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
      .when(this.choosingBranch, (e) => e.bg(t.hover)).when(!this.choosingBranch, (e) => e.tooltip("Switch branch, or make a new one"))
      .child(svg(asset("git-branch.svg")).size(12).flex_none().text_color(t.muted)).child(div().min_w(0).truncate().text_size(11.5).child(name)).child(chevron(t.muted));
    const list = this.branches;
    // A scroll area needs a height of its own (a max_h alone never scrolls in Herdr): the rows' own,
    // 360 px at most. Each part has a fixed height (Branch.BRANCH_ROW, …).
    const parts = [this.newBranchOpen ? 60 : 30, 30, 30, ...(!this.newBranchOpen && this.branchError ? [34] : []), ...(!list ? [28] : []),
      ...(list ?? []).map(() => Branch.BRANCH_ROW), ...(list ? Branch.remoteHeights(this.remoteBranches) : [])];
    const height = Math.min(360, 14 + parts.reduce((n, h) => n + h, 0) + 2 * (parts.length - 1));
    return Popover.new("branches").open(this.choosingBranch).on_open_change((open, cx) => this.openBranches(open, cx)).trigger(box)
      .content(v_flex().mt(4).w(300).h(height).overflow_y_scrollbar().p(6).gap(2).rounded(8).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .child(this.newBranchOpen
          ? v_flex().h(60).flex_none().px(4).py(4).gap(4)
            .child(div().id("branch-name").h(28).px(8).flex().items_center().rounded(6).border_1().border_color(t.accent).bg(t.surface).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .child(Input.new(this.branchInput).h_full().text_size(12).text_color(t.foreground)))
            .child(div().px(2).text_size(10.5).whitespace_normal().text_color(this.branchError ? readable(t, t.ansi1, t.popover) : t.muted).child(this.branchError ?? "Enter makes it from HEAD and switches to it"))
          : h_flex().id("branch-new").h(30).flex_none().px(8).gap(8).items_center().rounded(6).text_size(12).cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => { this.newBranchOpen = true; this.branchError = null; this.branchInput.set_value(""); this.branchInput.focus(); cx.timer.after(100, () => this.branchInput.focus()); cx.notify(); })
            .child(svg(asset("plus.svg")).size(12).text_color(t.muted)).child("New branch…"))
        .child(h_flex().id("branch-previous").h(30).flex_none().px(8).gap(8).items_center().rounded(6).text_size(12).cursor_pointer().hover((s) => s.bg(t.hover))
          .tooltip("git switch -: back to the branch you were on before").on_click((_e, cx) => this.previousBranch(cx)).child(div().w(12).text_color(t.muted).child("↩")).child("Back to the previous branch"))
        .child(h_flex().id("branch-cleanup").h(30).flex_none().px(8).gap(8).items_center().rounded(6).text_size(12).cursor_pointer().hover((s) => s.bg(t.hover))
          .tooltip(`Delete the branches merged into ${this.facts?.base ?? "the base"} or whose upstream is gone (asks, ticked first)`).on_click((_e, cx) => this.cleanupBranches(cx)).child(div().w(12).text_color(t.muted).child("⌫")).child("Clean up branches…"))
        .when(!this.newBranchOpen && Boolean(this.branchError), (e) => e.child(div().h(34).flex_none().px(8).py(4).text_size(11).text_color(readable(t, t.ansi1, t.popover)).whitespace_normal().overflow_hidden().child(this.branchError)))
        .when(!list, (e) => e.child(div().h(28).flex_none().px(8).flex().items_center().text_size(11.5).text_color(t.muted).child("Reading the branches…")))
        .children((list ?? []).map((b, i) => {
          // Checked out in another worktree: its second line says where, and a click goes there.
          const w = b.current ? null : this.elsewhere?.get(b.name) ?? null;
          const tip = !w ? null : w.prunable ? `Its worktree's folder ${w.path} is gone: click to forget it (git worktree prune), then it can be checked out here`
            : w.missing ? `Its worktree's folder ${w.path} is gone, and it is locked${w.lockReason ? ` (${w.lockReason})` : ""}: click to forget it even so (git worktree remove -f -f)`
            : `${w.doing ? `Being ${w.doing === "rebase" ? "rebased" : "bisected"}` : "Checked out"} in the worktree at ${w.path}: click to go to its space`;
          return h_flex().id(`branch-${i}`).h(Branch.BRANCH_ROW).flex_none().px(8).gap(8).items_center().rounded(6)
            .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.branchMenu(b, cx); })
            .when(!b.current, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => (w ? this.toWorktree(w, cx) : this.switchTo(b.name, false, cx))))
            .when(Boolean(tip), (e) => e.tooltip(tip))
            .child(v_flex().flex_1().min_w(0).gap(1).child(div().text_size(12).truncate().child(b.name)).child(div().text_size(10.5).text_color(t.muted).truncate().child(w ? whereWords(w, this.placeOf(w.path)) : Branch.trackWords(b, this.tracking?.get(b.name)))))
            .child(b.current ? svg(asset("check.svg")).size(12).text_color(t.accent) : div().w(12));
        }))
        .children(list ? Branch.remoteRows({ t, remotes: this.remoteBranches, local: list, onClick: (rb, cx) => this.remoteClick(rb, cx), away: this.elsewhere, placeOf: (p) => this.placeOf(p) }) : []));
  }

  // The bar over the files: what is uncommitted, and Stage all, Stash, Stash…, the stashes, Revert all.
  actionBar(t) {
    const idle = !this.busy, dirty = this.dirty.size > 0, staged = this.entries.filter((e) => isStaged(e.xy)).length;
    const action = (id, label, color, on, onClick, tip) => div().id(id).h(22).px(7).flex().flex_none().items_center().rounded(6).text_size(11.5).text_color(on ? readable(t, color, [t.surface, t.hover]) : t.muted)
      .when(on, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick)).when(!on, (e) => e.opacity(0.7)).when(Boolean(tip), (e) => e.tooltip(tip)).child(label);
    const repos = this.innerRepos().length, words = dirty ? `Uncommitted · ${this.countWords(this.dirty.size - repos, repos)}${staged ? ` · ${staged} staged` : ""}` : "No uncommitted changes";
    const all = this.allStaged();
    return h_flex().h(32).flex_none().px(10).gap(2).items_center().border_b(1).border_color(t.border)
      .child(div().id("changes-uncommitted").flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(words))
      .when(dirty, (e) => e.child(action("stage-all", this.busy === "stageAll" || this.busy === "unstageAll" ? BUSY.stageAll : all ? "Unstage all" : "Stage all", t.foreground, idle, (_e, cx) => this.stageAll(cx), all ? "git reset: take everything out of the index" : repos ? "git add -A: stage every change but the repositories inside this one" : "git add -A: stage every change")))
      .when(dirty, (e) => e.child(action("stash", this.busy === "stash" ? BUSY.stash : "Stash", t.foreground, idle && this.hasHead, (_e, cx) => this.stashQuick(cx), this.hasHead ? "git stash -u: put every change away, new files too" : "Nothing committed to stash against")))
      .when(dirty, (e) => e.child(action("stash-with", "…", t.foreground, idle && this.hasHead, (_e, cx) => this.stashWith(cx), this.hasHead ? "Stash…: with a message, only the staged changes, or only some files" : "Nothing committed to stash against")))
      .when((this.stashes ?? []).length > 0, (e) => e.child(Stash.stashPopover({ t, stashes: this.stashes, open: this.choosingStash, shownHash: this.stashShown?.stash.hash, idle,
        label: this.busy === "apply" || this.busy === "pop" || this.busy === "dropStash" ? BUSY[this.busy] : `Stashes · ${this.stashes.length}`,
        onOpenChange: (open, cx) => { this.choosingStash = open; cx.notify(); }, onShow: (s, cx) => this.showStash(s, cx), onAction: (s, what, cx) => this.stashAction(s, what, cx),
        onMore: (s, cx) => this.stashMore(s, cx), onClear: (cx) => this.stashClear(cx) })))
      .when(dirty, (e) => e.child(action("revert-all", this.busy === "revertAll" ? BUSY.revertAll : "Revert all…", t.ansi1, idle && this.hasHead, (_e, cx) => this.revertAll(cx), "Discard every uncommitted change (asks first; a copy is kept)")));
  }

  commitBar(t) {
    const idle = !this.busy, enabled = Boolean(!bareMessage(this.message, this.template) && this.root && idle);
    const agent = this.penAgent();
    const label = this.busy === "commit" ? BUSY.commit : this.busy === "amend" ? BUSY.amend : this.askStage ? (this.amend ? "Stage all & amend" : "Stage all & commit") : "Commit";
    const push = pushState(this.facts, { busy: this.busy === "push", idle });
    return commitBar(t, {
      narrow: this.narrow(), input: this.input, typing: this.typing,
      pen: this.root ? { busy: Boolean(this.writing), open: this.menuFrom === "pen", label: `Write a commit message with ${agent.name}`, tip: `Write a commit message with ${agent.name} (right-click: another agent). The diff goes to ${agent.name}'s model provider.`, onClick: (cx) => this.pen(cx), onMenu: (cx) => this.penMenu(cx) } : null,
      amend: { ok: Boolean(this.root && this.hasHead), on: this.amend, busy: !idle, onToggle: (cx) => this.toggleAmend(cx) },
      more: { idle: Boolean(this.root && idle), open: this.menuFrom === "more", onClick: (cx) => this.moreMenu(cx) },
      commit: { enabled, label, onClick: (cx) => this.commit(cx), tip: this.amend ? "Rewrite the last commit with this message (⌘↩)" : `Commit the staged changes (⌘↩); with nothing staged it ${prefs().askStageAll ? "asks to stage" : "stages"} everything` },
      push: { ...push, onClick: (cx) => this.push(cx) },
      pushMenu: this.root && this.hasHead ? Sync.pushMenuButton(t, { enabled: idle, open: this.menuFrom === "push", onClick: (cx) => this.pushMenu(cx) }) : null,
    });
  }

  // Herdr closed this copy: it takes no more requests.
  async close() { takers.delete(this); }
}
