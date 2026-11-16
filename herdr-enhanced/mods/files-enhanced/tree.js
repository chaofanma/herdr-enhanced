// Based on Herdr's shipped Files mod (Apache-2.0); changed: the tree grew from it. The shown folder
// (place.js: the focused terminal's, or a pinned one) as a tree of rows, on this computer or on the
// space's machine (machine.js), with git marks from every repository in it, a preview below
// (preview.js), a search (search.js), a Changed view, a right-click menu and dialogs (menu.js,
// dialog.js), several selected rows, a file clipboard and keys. It takes reveal requests
// (shared/reveal.js, own("reveal")): open the folders down to a path and select it.
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, settings, shared, setShared, props, openOverlay, watchFolder, nextCommand, layout, notify, spaces } from "herdr";
import { ID, asset, own } from "./id.js";
import { fullOf, parentOf, nameOf, relOf, foldersOf } from "./paths.js";
import { listFolders, PER_FOLDER, facts, known, capsOf, git, findRepos, mtimes, times, info, copyDropped, gone, platform } from "./machine.js";
import { location, placeKey, prefs } from "./place.js";
import { setPin, noteRoot, places, rootsHeight, REFOLLOW } from "./roots.js";
import { installed, checkInstalled } from "./installed.js";
import { requestOf, takers, placeIn, isTree, bringForward } from "./reveal.js";
import { folderName, up } from "./pins.js";
import { heard, announce } from "./signal.js";
import { clipboard, setClipboard, paste, cutRels } from "./clipboard.js";
import { openItems, openSettings, detectFor, foundProps, openBy, chosen, tryTo } from "./launch.js";
import { openSystem } from "./system.js";
import { hostOf } from "./remote.js";
import { menuHeight, MENU_WIDTH, openDialog } from "./menu.js";
import { clickSelect, inOrder, outermost } from "./selection.js";
import { shown, sorted } from "./listing.js";
import { parseStatus, markColor } from "./gitstatus.js";
import { branchOf, mergeRepos, repoFor } from "./repos.js";
import { checks, trustRepo, notReadBar, SAFE_ARGS } from "./repotrust.js";
import { age, fresh, changedFiles } from "./ages.js";
import { iconFor } from "./icons.js";
import { Nesting } from "./nest.js";
import { KEYS, settingsOf } from "./panelsettings.js";
import { settingsGear } from "./settingsview.js";
import { iconButton, ICON_GAP, chevron } from "./iconbutton.js";
import { anchorOf, menuAt, pressOn, closingClick, whenClosed } from "./menuat.js";
import { Preview } from "./preview.js";
import { searchMethods } from "./search.js";
import { shownIn } from "./shown.js";
import { openAsTab, showTab, backToPanel, restoreClosedTabs, CLOSED_TAB_POLL } from "./tabs.js";

// Rows in all, at most (Herdr's Files mod's cap; a folder lists PER_FOLDER), and how often a folder on
// another machine is looked at while the panel shows (there's no watchFolder there).
const TOTAL = 5000, POLL = 4000;
// The mark a row shows: a file's own; a folder's dot (its most urgent change inside), else its own line.
const markFor = (marks, rel, dir) => (dir ? marks[`dir:${rel}`] ?? marks[rel] : marks[rel]) ?? null;
// The rows' sizes (px): height, indent per level, gap, corner radius.
const ROW = { height: 26, indent: 16, gap: 6, radius: 6 };
const message = e => String(e?.message ?? e);
// How far down the git marks look for more repositories: the Files settings' own repoDepth.
const depthNow = () => settingsOf(KEYS.files, shared(KEYS.files)).repoDepth;
// What a menu or dialog copy needs to know of a machine's caps (plain JSON for props).
const plainCaps = c => ({ shell: c.shell, zip: c.zip, trash: c.trash, write: c.write, os: c.os });
// In a tab of its own (⤢): the tree at the left this wide (px) by default, the line between it and the
// preview dragged within these bounds; where it was left is kept in own("tabSplit"). The line is 7 px.
export const TAB_TREE = { size: 320, min: 200, max: 900, line: 7, preview: 280 };
// The header's fixed parts (px): its padding, ‹, the folder button's least (its padding, gap and
// chevron), each icon button, the gaps; with ⤢ it needs this much, and ⤢ shows from that width on.
const HEAD = { pad: 22, up: 24, root: 24, button: 24, gap: ICON_GAP, border: 2 };
// The key other mods ask this one to show a path by (shared/reveal.js).
const REVEAL = own("reveal");
// A full path's folder, and the folder two full paths share (on one machine).
const parts = p => p.split(/[\\/]+/);
const sepOf = p => (p.includes("\\") && !p.includes("/") ? "\\" : "/");
const folderOf = full => { const i = Math.max(full.lastIndexOf("/"), full.lastIndexOf("\\")); return i > 0 ? full.slice(0, i) : full.slice(0, 1) || "/"; };
function commonFolder(a, b) {
  const x = parts(a), y = parts(b);
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n++;
  return x.slice(0, n).join(sepOf(a)) || sepOf(a);
}

export class Tree {
  /** `window`: drawn in a window of its own (window.js): no card of its own, always on screen. */
  constructor(view, cx, { window = false } = {}) {
    this.view = view; this.inWindow = window;
    // A tab of its own (⤢ in the panel; props { root, on }): that folder, followed by nothing.
    const p = props();
    this.tabMode = !window && !p?.role && typeof p?.root === "string" && Boolean(p.root);
    this.tabRoot = this.tabMode ? p.root : null; this.tabOn = this.tabMode ? p.on ?? null : null;
    this.tabOpened = this.tabRoot; this.tabSpace = this.tabMode ? spaces().find(s => s.active)?.id ?? null : null;
    this.width = null; this.splitDrag = null;
    // Herdr's Files mod's memory: what each place had open (folders, preview; and here the selection).
    this.saved = new Map();
    this.held = new Map();
    this.context = null; this.root = null; this.on = null;
    this.forget();
    this.h = cx.focus_handle();
    this.preview = new Preview(this);
    this.cursor = null; this.picked = null; this.visible = [];
    this.tick = heard()?.t; this.refollowSeen = shared(REFOLLOW)?.t;
    this.found = null; this.detected = null; this.foundCache = new Map(); this.host = null;
    // Reveal requests: this copy takes them with the other trees (reveal.js takers); Changes
    // Enhanced's items in the menus show only while it's installed (installed.js).
    this.seenReveal = null; this.pendingReveal = null; this.top = null;
    takers.add(this);
    cx.spawn(async cx => { if (await checkInstalled()) cx.notify(); });
    this.refresh(cx);
    // Herdr's Files mod refreshes every 10 s. A folder on another machine waits while the panel is off
    // screen, and refreshes once it shows again (render()).
    cx.timer.every(10000, cx => {
      if (this.on && this.offscreen()) this.stale = true; else this.refresh(cx);
      cx.spawn(async cx => { if (await checkInstalled()) cx.notify(); });
    });
    cx.timer.every(POLL, cx => this.pollOnce(cx));
    // In the layout (not a window's, not a tab's): brings the panel back when the Files tab it gave
    // way to is closed another way than ⤡ (tabs.js). It runs hidden too.
    if (!window && !this.tabMode) cx.timer.every(CLOSED_TAB_POLL, () => restoreClosedTabs(ID));
    // Key commands (keys.json "<key>": "files-enhanced.search"…) and pane.go's "focus".
    cx.spawn(async cx => { for (;;) { const c = await nextCommand(); this.command(c, cx); cx.notify(); } });
  }

  // Herdr closed this copy: it takes no more requests.
  close() { takers.delete(this); }

  command(c, cx) {
    if (c === "focus") this.h.focus();
    else if (c === "search") this.openSearch(cx);
    else if (c === "contents") this.openSearch(cx, "contents");
    else if (c === "refresh") this.refresh(cx);
    else if (c === "collapse") this.collapse();
  }

  // What belongs to the place shown, cleared when another shows.
  forget() {
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.steps = new Map(); this.chains = new Map();
    this.marks = {}; this.ignored = new Set(); this.repo = null; this.repos = new Map(); this.repoScan = null; this.unread = new Map();
    this.mtimes = new Map(); this.stamps = new Map(); this.order = new Map(); this.nests = new Set();
    this.error = null; this.limited = false; this.loading = false; this.wanted = false; this.watched = null; this.lastPoll = null; this.polling = false;
  }

  here() {
    if (!this.tabMode) return location(this.held);
    return { space: this.tabSpace, follow: null, followOn: null, cwd: this.tabRoot, on: this.tabOn, pinned: false, held: false, tab: true };
  }
  // Known to be off screen in the shown layout (a hidden panel, the other page of a stack). A tab's
  // copy isn't in the layout: the layout's tree being hidden says nothing of it.
  offscreen() { return !this.inWindow && !this.tabMode && shownIn(layout(), ID) === false; }
  // Still the place to show? While a file is being edited the tree stays where it is.
  current(context) { return this.context === context && (Boolean(this.preview.edit) || placeKey(this.here()) === context.key); }
  caps() { return capsOf(this.on); }
  place() { return { on: this.on, host: this.host }; }

  // The selection (selection.js): `cursor` is the row the keys move and a plain click sets; setting `sel`
  // selects that row alone. `picked` ({ anchor, set }) holds the rows a ⌘- or Shift-click selected,
  // until a plain click, a key move or Esc.
  get sel() { return this.cursor; }
  set sel(path) { this.cursor = path; this.picked = null; }

  // Another place shows: the one before goes to `saved`, this one comes back from it.
  enter(l, cx) {
    if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.preview.file, sel: this.cursor });
    const was = this.saved.get(placeKey(l)), machineChanged = (l.on ?? null) !== this.on;
    this.context = { key: placeKey(l), cwd: l.cwd, on: l.on ?? null, space: l.space };
    this.root = l.cwd; this.on = l.on ?? null;
    this.forget();
    this.folders = new Set(was?.folders);
    this.preview.show(null);
    this.sel = was?.sel ?? null;
    if (was?.file) this.preview.show(was.file, cx);
    // An unpin notice stays for the folder it brought you to.
    if (this.notice && this.notice.seen++) this.notice = null;
    if (machineChanged || !this.learned) { this.host = null; this.learned = true; this.learn(cx); }
    // An open search looks in the new folder, after this render: enter() runs from render(), where Herdr
    // refuses cx.notify(), and find() asks for one at once.
    if (this.search) {
      const s = this.search;
      s.results = []; s.files = []; s.texts = null; s.note = null; s.done = null; s.confirm = false;
      cx.spawn(async cx => { await cx.sleep(0); if (this.search === s) this.find(cx); });
    }
  }

  // What the machine has (machine.js facts) and the ssh target Herdr reaches it by (remote.js).
  learn(cx) {
    const on = this.on, context = this.context;
    cx.spawn(async cx => {
      await facts(on).catch(() => null);
      const host = await hostOf(on);
      if (this.context !== context) return;
      this.host = host; cx.notify();
    });
  }
  // What the machine has was asked for and isn't known (its probe failed, through a slow jump host
  // say): asked again by the next render's settle(), at most every 10 s. From render: no cx here.
  relearn() {
    if (!this.on || known(this.on) || Date.now() - (this.relearned ?? 0) < 10000) return;
    this.relearned = Date.now(); this.wantsFacts = true;
  }

  // Finds the "Open with" items' programs (one sh here, one on the space's machine), unless that list was
  // already asked about there. Reached from render(): the task's first step is an await.
  detect(cx) {
    const items = openItems(), sig = JSON.stringify([this.on, items]);
    if (sig === this.detected) return;
    this.detected = sig;
    if (this.foundCache.has(sig)) { this.found = this.foundCache.get(sig); return; }
    this.found = null;
    const on = this.on;
    cx.spawn(async cx => {
      const found = await detectFor(items, on);
      this.foundCache.set(sig, found);
      if (this.detected !== sig) return;
      this.found = found; cx.notify();
    });
  }

  // Herdr's Files mod's refresh(): the root and every open folder (one call), then git, which is the slow
  // part. One task at a time: refreshes asked for while it runs make it go round once more.
  refresh(cx) {
    const l = this.here();
    if (placeKey(l) !== this.context?.key && !this.preview.edit) this.enter(l, cx);
    const context = this.context;
    if (!context?.cwd) return;
    this.wanted = true;
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        while (this.wanted && this.context === context) {
          this.wanted = false;
          await this.pass(context, cx);
        }
      } catch (e) { if (this.current(context)) this.error = message(e); }
      if (this.context === context) this.loading = false;
      cx.notify();
    });
  }

  // One refresh: list, then git and the changed files' times.
  async pass(context, cx) {
    const p = prefs();
    // What this pass asks for (settle() refreshes again when the settings ask for more).
    this.asked = { ignored: p.ignored !== "show", sort: p.sort, compact: p.compact, repoDepth: depthNow() };
    const folders = ["", ...this.folders];
    const got = await listFolders(context.on, folders.map(f => fullOf(context.cwd, f)), { chains: p.compact });
    if (!this.current(context)) return;
    this.take(folders, got, p);
    if (this.error) {
      // A pinned folder that's gone: back to following the terminal, saying why.
      const now = this.here();
      if (now.pinned && placeKey(now) === context.key && await gone(context.on, context.cwd) && this.current(context)) {
        this.notice = { text: `Unpinned ${context.cwd}: it no longer exists`, seen: 0 };
        setPin(now.space, null);
        return;
      }
    } else if (!context.noted) { context.noted = true; noteRoot({ path: context.cwd, on: context.on }); }
    cx.notify();
    if (p.sort === "modified") await this.stampsFor(context, folders);
    const found = await this.gitAll(context, this.asked.ignored), marks = found?.marks ?? {};
    if (!this.current(context)) return;
    // When the changed files changed: the Changed view's order and ages, the tree's fresh dots.
    const t = await mtimes(context.on, context.cwd, Object.keys(marks).filter(k => !k.startsWith("dir:")));
    if (!this.current(context)) return;
    Object.assign(this, { marks, ignored: found?.ignored ?? new Set(), repo: found !== null, mtimes: t });
    this.watch(context, cx);
  }

  // A listing (machine.js listFolders) into the tree: each folder's entries, TOTAL in all; an open folder
  // that's gone closes; the root's error shows.
  take(folders, got, p = prefs()) {
    this.error = null; this.limited = false;
    for (const rel of folders) {
      const r = got.get(fullOf(this.root, rel));
      if (!r || r.error) {
        if (!rel) { this.error = r?.error ?? "Cannot list this folder"; this.entries.delete(""); }
        else { this.folders.delete(rel); this.entries.delete(rel); }
        continue;
      }
      this.store(rel, r);
    }
    this.chainsFrom(p);
  }

  // One folder's listing, within what the others leave of TOTAL.
  store(rel, r) {
    const used = [...this.entries].filter(([k]) => k !== rel).reduce((n, [, e]) => n + e.length, 0);
    const room = Math.max(0, Math.min(PER_FOLDER, TOTAL - used)), kept = r.entries.slice(0, room);
    if (r.more || r.entries.length > room) this.limited = true;
    this.entries.set(rel, kept);
    this.steps.set(rel, r.steps);
  }

  // Compact folders: a folder whose only listed entry is a folder shows the chain as one row, from what
  // the listing found on the way (machine.js LIST), with settings.hidden and exclude applied; a
  // repository's folder ends a chain (it keeps a row of its own, and its branch badge).
  chainsFrom(p = prefs()) {
    this.chains = new Map();
    this.chainSig = JSON.stringify([p.compact, p.hidden, p.exclude]);
    if (!p.compact) return;
    for (const [prefix, steps] of this.steps) {
      for (const e of this.entries.get(prefix) ?? []) {
        if (!e.dir) continue;
        const names = [];
        for (let at = e.name; names.length < 10;) {
          const kids = steps?.get(at);
          if (!kids || kids.some(k => k.git)) break;
          const inside = shown(kids, prefix ? `${prefix}/${at}` : at, { hidden: p.hidden, exclude: p.exclude });
          if (inside.length !== 1 || !inside[0].dir) break;
          names.push(inside[0].name); at = `${at}/${inside[0].name}`;
        }
        if (names.length) this.chains.set(prefix ? `${prefix}/${e.name}` : e.name, names);
      }
    }
  }

  // Sorting by modified: when each listed entry changed, one stat per 400 (folder -> Map name -> ms).
  async stampsFor(context, folders) {
    const rels = folders.flatMap(f => (this.entries.get(f) ?? []).map(e => (f ? `${f}/${e.name}` : e.name)));
    const t = await times(context.on, context.cwd, rels);
    if (!this.current(context)) return;
    for (const f of folders) {
      const m = new Map();
      for (const e of this.entries.get(f) ?? []) { const ms = t.get(f ? `${f}/${e.name}` : e.name); if (ms != null) m.set(e.name, ms); }
      this.stamps.set(f, m);
    }
  }

  // A folder's entries as listed now: settings.hidden / exclude / ignored filter them and sort /
  // foldersFirst order them (listing.js); with settings.nesting related files go under their parent
  // file (nest.js), as its `kids`. Kept until the entries, the settings or the ignored paths change, so
  // a render costs a lookup.
  listed(prefix, p = prefs()) {
    const entries = this.entries.get(prefix);
    if (!entries) return [];
    const sig = JSON.stringify([p.hidden, p.exclude, p.ignored, p.sort, p.foldersFirst, p.nesting && p.nest]), was = this.order.get(prefix);
    if (was && was.entries === entries && was.sig === sig && was.ignored === this.ignored && was.stamps === this.stamps.get(prefix)) return was.list;
    const stamps = p.sort === "modified" ? this.stamps.get(prefix) : null;
    let list = sorted(shown(entries, prefix, p, this.ignored, !this.on && platform() === "windows"), p, stamps);
    if (p.nesting) {
      const groups = new Nesting(p.nest).nest(list.filter(e => !e.dir).map(e => e.name));
      if (groups.size) {
        const inner = new Set([...groups.values()].flat()), byName = new Map(list.map(e => [e.name, e]));
        list = list.filter(e => !inner.has(e.name)).map(e => (groups.has(e.name) ? { ...e, kids: groups.get(e.name).map(k => byName.get(k)) } : e));
      }
    }
    this.order.set(prefix, { entries, sig, ignored: this.ignored, stamps: this.stamps.get(prefix), list });
    return list;
  }

  // The folder a row stands for: the deepest of a compacted chain, else the folder itself.
  deepest(head, p = prefs()) {
    const chain = p.compact ? this.chains.get(head) : null;
    return chain ? `${head}/${chain.join("/")}` : head;
  }

  // ---- git

  // Every git the tree runs is its own, never one the person asked for: SAFE_ARGS (repotrust.js: no
  // fsmonitor, no hooks). The repository the root is in is always read; one below it only when its
  // own config has the usual settings or the person trusted it (Read it on its folder's row).

  // The status of the repository the root is in, as marks keyed by path relative to the root (folders
  // get their most urgent child's mark as a dot) and, with `ignored`, the git-ignored paths; null
  // outside a repository. Herdr's Files mod asks the same way.
  async gitStatus(cwd, on, ignored) {
    const top = await git(on, cwd, [...SAFE_ARGS, "rev-parse", "--show-toplevel"]).catch(() => null);
    if (!top || top.code !== 0) return null;
    return { top: top.stdout.trim(), ...await this.repoStatus(top.stdout.trim(), cwd, on, ignored, cwd) };
  }

  // One repository's status (top: its folder), as marks relative to the shown root, its ignored paths
  // and its branch (--branch). Writes nothing under .git (index lock, fsmonitor cookie): the folder
  // watch would refresh again. --ignored=matching only when asked: an ignored folder (node_modules) is
  // one entry, not its files.
  async repoStatus(top, root, on, ignored, cwd = top) {
    const status = await git(on, cwd, ["--no-optional-locks", ...SAFE_ARGS, "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--branch",
      ...(ignored ? ["--ignored=matching"] : [])]).catch(() => null);
    if (status?.code !== 0) return { marks: {}, ignored: new Set(), branch: null };
    return { ...parseStatus(status.stdout, top, root, { fold: !on && platform() === "windows", limit: TOTAL * 4 }), branch: branchOf(status.stdout) };
  }

  // The marks of every repository the root shows: the one it's in and those below it, up to
  // files-enhanced.settings repoDepth folders down (repos.js, VS Code's way), looked for again after 30 s.
  // One status each, at once. { marks, ignored } (each path from its own repository), or null when
  // there's none; this.repos: each nested repository's folder -> its branch; this.unread: each one
  // not read (its config has settings beyond the usual ones) -> its check. One git can't check is
  // left out (a folder like any other).
  async gitAll(context, ignored) {
    const { cwd, on } = context, depth = depthNow();
    const [own, nested] = await Promise.all([this.gitStatus(cwd, on, ignored), this.findRepos(context, depth)]);
    const checked = await Promise.all(nested.map(rel => checks.check(fullOf(cwd, rel), on)));
    const listed = nested.filter((_rel, i) => !checked[i].error), unread = new Map();
    for (const rel of listed) if (checks.verdict(fullOf(cwd, rel), on) === "ask") unread.set(rel, checks.get(fullOf(cwd, rel), on));
    const found = await Promise.all(listed.filter(rel => !unread.has(rel)).map(rel => this.repoStatus(fullOf(cwd, rel), cwd, on, ignored).then(st => ({ root: rel, ...st }))));
    if (!this.current(context)) return null;
    this.repos = new Map(found.map(x => [x.root, x.branch]));
    this.unread = unread;
    this.top = own?.top ?? null;
    if (!own && !found.length) return null;
    return mergeRepos([...(own ? [{ root: "", ...own }] : []), ...found]);
  }

  // Read it on a repository's folder: trust its config as it is now; the marks come with the next look.
  readRepo(rel, check, cx) {
    const context = this.context;
    if (!context) return;
    trustRepo(check, fullOf(context.cwd, rel), context.on);
    this.unread.delete(rel);
    this.refresh(cx);
    cx.notify();
  }

  async findRepos(context, depth) {
    const was = this.repoScan, sig = `${context.key}|${depth}`;
    if (was?.sig === sig && Date.now() - was.at < 30000) return was.list;
    const list = await findRepos(context.on, context.cwd, depth);
    if (this.context === context) this.repoScan = { sig, at: Date.now(), list };
    return list;
  }

  // ---- Changes on disk

  // Here, watchFolder: Herdr's Files mod's loop. Its 10-second timer covers a watch that fails.
  watch(context, cx) {
    if (context.on || this.watched === context) return;
    this.watched = context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(context.cwd); if (this.current(context)) this.soon(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  // Many changes in a row (an agent writing files) make one refresh, a quarter second after the first.
  soon(cx) {
    if (this.burst) return;
    this.burst = cx.timer.after(250, cx => { this.burst = null; this.refresh(cx); });
  }

  // On another machine there's no watch: every POLL ms, while the panel shows (shown.js), one stat of
  // the root, the open folders and the previewed file there; a change reloads the tree, a change of the
  // file its preview.
  pollOnce(cx) {
    const context = this.context;
    if (!context?.on || !context.cwd || this.polling || this.loading || this.offscreen()) return;
    const folders = ["", ...[...this.folders].slice(0, 40)], file = this.preview.edit ? null : this.preview.file;
    const paths = [...folders.map(f => fullOf(context.cwd, f)), ...(file ? [fullOf(context.cwd, file)] : [])];
    this.polling = true;
    cx.spawn(async cx => {
      try {
        const got = await info(context.on, paths);
        if (this.context !== context) return;
        const now = { folders: JSON.stringify([folders, got.slice(0, folders.length)]), file, fileSig: file ? JSON.stringify(got[folders.length]) : null }, was = this.lastPoll;
        this.lastPoll = now;
        if (!was) return;
        if (was.folders !== now.folders) this.refresh(cx);
        if (file && was.file === file && was.fileSig !== now.fileSig && this.preview.file === file && !this.preview.edit) this.preview.show(file, cx);
      } catch { /* the machine is away: the next look tries again */ }
      finally { this.polling = false; }
    });
  }

  // What other copies said (signal.js): reload, select what they made, show a changed file again. And
  // the roots popup's "Terminal's folder" (own("refollow")): the root held for the space goes.
  follow(cx) {
    const back = shared(REFOLLOW);
    if (back?.t !== this.refollowSeen) {
      this.refollowSeen = back?.t;
      if (back?.space) this.held.delete(back.space);
    }
    const news = heard();
    if (!news || news.t === this.tick) return;
    this.tick = news.t;
    const same = (news.on ?? null) === this.on && Boolean(this.root);
    const made = same && news.select ? relOf(this.root, news.select) : null;
    if (made) this.reveal(made, cx);
    const v = this.preview;
    if (same && v.file && !v.edit && (news.files ?? []).includes(fullOf(this.root, v.file))) v.show(v.file, cx);
    this.refresh(cx);
  }

  // ---- Folders

  // Herdr's Files mod's toggle(), opening: the folder listed when it isn't yet.
  open(rel, cx) {
    if (this.folders.has(rel)) return;
    this.folders.add(rel);
    if (!this.entries.has(rel) && !this.pending.has(rel)) {
      const context = this.context, p = prefs();
      this.pending.add(rel);
      cx.spawn(async cx => {
        try {
          const got = (await listFolders(context.on, [fullOf(context.cwd, rel)], { chains: p.compact })).get(fullOf(context.cwd, rel));
          if (!this.current(context) || !this.folders.has(rel)) return;
          if (!got || got.error) { this.folders.delete(rel); throw new Error(got?.error ?? "Cannot list this folder"); }
          this.store(rel, got); this.chainsFrom(p);
          if (p.sort === "modified") await this.stampsFor(context, [rel]);
        } catch (e) { if (this.current(context)) this.error = message(e); }
        finally { if (this.context === context) this.pending.delete(rel); cx.notify(); }
      });
    }
  }

  toggle(rel, cx) {
    if (this.folders.has(rel)) {
      for (const f of [...this.folders]) if (f === rel || f.startsWith(rel + "/")) { this.folders.delete(f); this.entries.delete(f); }
    } else this.open(rel, cx);
    cx.notify();
  }

  collapse() {
    this.folders.clear();
    for (const k of [...this.entries.keys()]) if (k) this.entries.delete(k);
  }

  toggleNest(head, cx) {
    if (this.nests.has(head)) this.nests.delete(head); else this.nests.add(head);
    cx.notify();
  }

  // Opens the folders down to a path and selects it.
  reveal(rel, cx) {
    for (const f of foldersOf(rel)) this.open(f, cx);
    this.sel = rel;
  }

  // ---- Reveal requests (shared/reveal.js)

  // A request seen by a render, taken from a timer (a render may not start work that notifies).
  takeReveal(cx) {
    const req = requestOf(shared(REVEAL), "files");
    if (req && req.at !== this.seenReveal) { this.seenReveal = req.at; cx.timer.after(1, cx => this.revealRequest(req, cx)); }
    const p = this.pendingReveal;
    if (p && this.context && !this.loading && (this.on ?? null) === p.on && relOf(this.root, p.full) !== null) { this.pendingReveal = null; cx.timer.after(1, cx => this.showFull(p.full, cx)); }
  }

  // The trees whose root holds the path show it. When none does, the first tree that follows the
  // terminal (else the first) pins, for the space, the folder its root and the path share (the path's
  // folder on another machine), and shows it once it's there.
  revealRequest(req, cx) {
    const holds = t => Boolean(t.root) && (t.on ?? null) === req.on && relOf(t.root, req.full) !== null;
    const trees = [...takers], holders = trees.filter(holds);
    // A Files tab (⤢) of the active space that holds the path takes it: the panel's tree, hidden behind
    // it, stays so.
    const space = spaces().find(s => s.active)?.id ?? null, tabbed = holders.filter(t => t.tabMode && t.tabSpace === space);
    const takersNow = tabbed.length ? tabbed : holders;
    if (takersNow.length) { if (takersNow.includes(this)) this.showFull(req.full, cx); return; }
    // None holds it: the panel's tree that follows the terminal pins (a tab's never does).
    const panelTrees = trees.filter(t => !t.tabMode);
    if ((panelTrees.find(t => !t.here().pinned) ?? panelTrees[0]) !== this) return;
    const l = this.here();
    if (!l.space) return;
    const folder = this.root && (this.on ?? null) === req.on ? commonFolder(this.root, folderOf(req.full)) : folderOf(req.full);
    this.pendingReveal = { full: req.full, on: req.on };
    setPin(l.space, { path: folder, on: req.on });
    bringForward(placeIn(layout(), isTree(ID)));
    cx.notify();
  }

  // Opens the folders down to a full path under the root and selects it; the tree comes back from a
  // search or the Changed view, and its page comes forward.
  showFull(full, cx) {
    const rel = relOf(this.root, full);
    if (rel === null) return;
    if (this.search) this.closeSearch(cx);
    this.changes = false;
    if (rel) this.reveal(rel, cx);
    this.h.focus();
    // A tab's tree brings its tab forward; the panel's, the panel's page.
    if (this.tabMode) showTab({ mod: ID, kind: "files", root: this.tabOpened, on: this.tabOn });
    else bringForward(placeIn(layout(), isTree(ID)));
    cx.notify();
  }

  // A breadcrumb: the tree again, that folder shown and selected.
  revealFolder(rel, cx) {
    if (this.search) this.closeSearch(cx);
    this.changes = false;
    for (const f of foldersOf(rel)) this.open(f, cx);
    this.sel = rel; this.h.focus();
    cx.notify();
  }

  // ---- Selection and what acts on it

  // A ⌘- or Shift-click on a row.
  multiClick(path, mods) {
    const next = clickSelect({ cursor: this.cursor, anchor: this.picked?.anchor ?? this.cursor, set: this.picked?.set }, path, mods, this.visible.map(r => r.path));
    this.cursor = next.cursor;
    this.picked = next.set.size === 1 && next.set.has(next.cursor) ? null : { anchor: next.anchor, set: next.set };
  }

  // The selected rows, in the order shown: the picked ones, else the cursor row.
  selection() {
    const order = this.visible.map(r => r.path);
    if (this.picked) return inOrder(this.picked.set, order);
    return this.cursor != null && order.includes(this.cursor) ? [this.cursor] : [];
  }
  picks(path) { return this.picked ? this.picked.set.has(path) : this.cursor === path; }
  dirOf(rel) { return Boolean(this.visible.find(r => r.path === rel)?.dir); }

  // ⌘X / ⌘C: the selected rows (the outermost) on the file clipboard. ⌘V: pasted into the folder of the
  // cursor row (a folder: into it), else the root. Through sh, here or there.
  clip(mode) {
    const rows = outermost(this.selection());
    if (!rows.length || !this.caps().shell) return;
    setClipboard(mode, rows.map(r => fullOf(this.root, r)), this.on);
  }
  pasteHere() {
    if (!clipboard() || !this.caps().shell || !this.root) return;
    const cur = this.visible.find(r => r.path === this.cursor);
    paste(this.root, this.on, cur ? (cur.dir ? cur.path : parentOf(cur.path)) : "");
  }

  // Delete (Del, ⌘⌫): the selected rows after one dialog.
  deleteSelected() {
    const rows = this.selection();
    if (rows.length === 1) openDialog("delete", this.target(rows[0], this.dirOf(rows[0])));
    else if (rows.length > 1) openDialog("delete", { ...this.target("", true), rel: undefined, items: outermost(rows).map(rel => ({ rel, dir: this.dirOf(rel) })) });
  }

  // The repository a row is in, as the reveal API names it: { root (its folder), path (the row
  // relative to it) }, or null outside one. A nested repository's own folder is its path "".
  repoOf(rel) {
    const nested = repoFor(rel, [...this.repos.keys()]);
    if (nested) return { root: fullOf(this.root, nested), path: rel === nested ? "" : rel.slice(nested.length + 1) };
    const path = this.top ? relOf(this.top, fullOf(this.root, rel)) : null;
    return path === null ? null : { root: this.top, path };
  }

  // What a menu or dialog gets: where, what, and what this machine can do there; for a row, its
  // repository and mark, and whether Git Enhanced is installed (its items in the menu).
  target(rel, dir, background = false) {
    const row = rel && !background;
    return { root: this.root, on: this.on, rel, dir: Boolean(dir), background, caps: plainCaps(this.caps()), found: foundProps(this.found), host: this.host,
      links: installed("changes"), repo: row ? this.repoOf(rel) : null, mark: row ? markFor(this.marks, rel, dir) : null };
  }

  // The right-click menu: a popup copy of this mod for a row, the shown folder (background) or several
  // rows (batch).
  // The menu popup: the target of the row it's for (its repository and git mark, which the cross
  // links need), else the shown folder's own.
  // `from`: the header button it came from, { which, anchor, cx }: the menu opens at the button
  // (menuat.js) and the button is lit until the menu closes. Else it opens where the press was.
  popup(extra, from = null) {
    const given = { role: "menu", ...this.target(extra.rel ?? "", extra.dir ?? true, extra.background ?? !extra.rel), ...extra };
    const height = menuHeight(given), at = from?.anchor ? { at: menuAt(from.anchor, MENU_WIDTH, height) } : {};
    const id = openOverlay({ mod: ID, kind: "popup", width: MENU_WIDTH, height, ...at, props: given });
    if (from) this.litWhileOpen(from.which, id, from.cx);
  }
  menu(rel, dir, background = false) { this.popup({ rel, dir: Boolean(dir), background }); }
  // From ⋯ (with its cx), or a right-click on the tree's background (none: at the press).
  backgroundMenu(cx = null) { if (this.root) this.popup({ rel: "", background: true }, cx ? { which: "more", anchor: anchorOf("fm-more"), cx } : null); }
  // Header button `which` is lit while popup `id` (a copy of this mod) is open: its copy's close()
  // says when it went (menuat.js closedNow).
  litWhileOpen(which, id, cx) {
    this.menuFrom = which; cx.notify();
    cx.spawn(async (cx) => { await whenClosed(id); if (this.menuFrom === which) { this.menuFrom = null; cx.notify(); } });
  }

  // A right-click on a row: on one of several selected rows, one menu for all of them; otherwise that
  // row is selected and gets its own.
  rightClick(path, dir, cx) {
    cx.stop_propagation();
    const many = this.selection();
    if (many.length > 1 && many.includes(path)) return this.popup({ rel: undefined, batch: many.map(rel => ({ rel, dir: this.dirOf(rel) })) });
    this.sel = path; cx.notify();
    this.menu(path, dir);
  }

  // ---- The root

  // Pins the shown folder for the active space, so the tree stays on it whatever terminal is focused;
  // unpinning goes back to following the terminal (settings.follow off: it stays on this folder).
  togglePin(l) {
    if (!l.space || !this.root) return;
    this.notice = null;
    if (l.pinned) this.held.set(l.space, { path: this.root, on: this.on });
    setPin(l.space, l.pinned ? null : { path: this.root, on: this.on });
  }

  // Shows and pins the folder above, with the one you were in open in it.
  goUp(l, cx) {
    const above = up(this.root);
    if (!above || (!l.space && !this.tabMode)) return;
    const name = folderName(this.root), into = p => (p ? `${name}/${p}` : name);
    const next = placeKey({ cwd: above, on: this.on, space: l.space }), was = this.saved.get(next);
    this.saved.set(next, { folders: new Set([...(was?.folders ?? []), name, ...[...this.folders].map(into)]), file: this.preview.file ? into(this.preview.file) : was?.file, sel: into(this.sel) });
    this.notice = null;
    // A tab's tree goes up on its own; the panel's pins the folder above for the space.
    if (this.tabMode) { this.tabRoot = above; cx?.notify(); return; }
    setPin(l.space, { path: above, on: this.on });
  }

  // The header's folder name: a popup to follow the terminal again or show a recent root, under the
  // name, left edges lined up (menuat.js); the name lit while it's open (from a click: `cx`).
  roots(l, cx = null) {
    if (!l.space || this.tabMode) return;
    const p = { role: "roots", space: l.space, on: l.followOn, root: this.root, pinned: l.pinned, follow: l.follow };
    const height = rootsHeight(places(p)), anchor = anchorOf("fm-root", { align: "left" });
    const id = openOverlay({ mod: ID, kind: "popup", width: 300, height, ...(anchor ? { at: menuAt(anchor, 300, height) } : {}), props: p });
    if (cx) this.litWhileOpen("roots", id, cx);
  }

  // ---- Opening

  // A double-click or Shift+Enter (Open with's `double`), or the preview's Open ↗ (`open`): a file in the
  // program the panel's settings name for it, else the system's way here; a folder the system's way.
  // On another machine only an item that can open it there (openwith.js remoteCommand).
  launch(rel, dir = false, how = "double") {
    const full = fullOf(this.root, rel);
    if (dir) { if (!this.on) tryTo("Cannot open", () => openSystem(full)); return; }
    openBy(openSettings()[how], this.found, { path: full, dir: false, folder: fullOf(this.root, parentOf(rel)), name: nameOf(rel) }, this.place());
  }
  // Whether launch(…, how) can do something for a file here: always on this computer; on another
  // machine when the setting's item can open it there.
  canOpen(how) {
    if (!this.on) return true;
    return Boolean(chosen(openSettings()[how], this.found, { path: fullOf(this.root, "x"), dir: false, folder: this.root, name: "x" }, this.place()));
  }
  canOpenAt() { return this.canOpen("line"); }

  // Files dragged in from the file manager: copied into a folder here, named the way Finder names copies.
  drop(paths, rel, cx) {
    if (!paths?.length) return;
    cx.stop_propagation();
    if (this.on) {
      notify({ title: "Can't copy files there", body: `Dropped files are on this computer; the folder is on ${this.on}.`, level: "error" });
      return;
    }
    const dest = fullOf(this.root, rel);
    tryTo("Cannot copy here", async () => {
      const names = await copyDropped(paths, dest);
      announce({ on: null, select: names[0] ? fullOf(dest, names[0]) : null });
    });
  }

  // ---- Keys

  // The row the keys are on (null: none yet) and where it is in the rows shown.
  current_row() {
    const row = this.visible.find(r => r.path === this.cursor) ?? null;
    return { row, index: row ? this.visible.indexOf(row) : -1 };
  }
  // Moves to the row `by` away (or the first), previewing a file.
  moveBy(by, cx) {
    const { index } = this.current_row(), next = this.visible[index < 0 ? 0 : Math.min(this.visible.length - 1, Math.max(0, index + by))];
    if (next && (next.dir || this.preview.look(next.path, cx))) this.sel = next.path;
    cx.notify();
  }
  // →: a closed folder opens, a file's nested files show, a file is previewed (Enter: never the nested).
  forward(cx, enter) {
    const { row } = this.current_row();
    if (!row) return;
    if (row.dir) { if (!this.folders.has(row.path)) this.toggle(row.path, cx); }
    else if (row.kids && !enter && !this.nests.has(row.head)) this.toggleNest(row.head, cx);
    else this.preview.look(row.path, cx);
    cx.notify();
  }
  // ←: an open folder (or nested files) closes; else up to the parent: a nested file's parent file, a
  // compacted row's folder above its first.
  back(cx) {
    const { row } = this.current_row();
    if (this.changes || !row) return;
    const opened = row.dir ? this.folders.has(row.path) : row.kids && this.nests.has(row.head);
    if (opened) return row.dir ? this.toggle(row.path, cx) : this.toggleNest(row.head, cx);
    const above = row.under ?? parentOf(row.head ?? row.path);
    if (above) { this.sel = above; cx.notify(); }
  }

  // ↑/↓ (j/k) move and preview files, → / l / Enter open, ← / h close or go to the parent, Shift+Enter
  // opens in its program, F2 renames, Del or ⌘⌫ deletes the selection, ⌘X / ⌘C / ⌘V cut, copy and
  // paste files (Ctrl elsewhere than macOS), / searches (⌘⇧F in files), Esc drops a selection of several
  // rows or closes the preview. While a file is edited the letters do nothing (typing gone astray), the
  // arrows still move. While searching, the search box has the keys.
  onKey(e, cx) {
    if (this.search) return this.searchKey(e, cx, false);
    const typed = e.keystroke, k = platform() !== "macos" && /^ctrl-[xcv]$/.test(typed) ? `cmd-${typed.slice(5)}` : typed;
    if (this.preview.edit && ["j", "k", "h", "l"].includes(k)) return;
    const row = () => this.current_row().row;
    const act = {
      down: () => this.moveBy(1, cx), j: () => this.moveBy(1, cx), up: () => this.moveBy(-1, cx), k: () => this.moveBy(-1, cx),
      right: () => this.forward(cx, false), l: () => this.forward(cx, false), enter: () => this.forward(cx, true),
      left: () => this.back(cx), h: () => this.back(cx),
      "shift-enter": () => { const r = row(); if (r) this.launch(r.path, r.dir); },
      f2: () => { const r = row(); if (r) openDialog("rename", this.target(r.path, r.dir)); },
      delete: () => this.deleteSelected(), "cmd-backspace": () => this.deleteSelected(),
      "cmd-x": () => this.clip("cut"), "cmd-c": () => this.clip("copy"), "cmd-v": () => this.pasteHere(),
      "/": () => this.openSearch(cx), "cmd-shift-f": () => this.openSearch(cx, "contents"),
      escape: () => {
        if (this.picked) this.picked = null;
        else if (this.preview.leave(cx)) this.preview.show(null);
        cx.notify();
      },
    }[k];
    if (act) act();
  }

  // Settings changed since the last look (render() asks): ignored paths, entry times or chains to fetch
  // (a refresh), chains to filter again, a Markdown preview to switch, a code view to wrap or unwrap.
  settle(cx) {
    // A probe asked for again (relearn): its task's first step is an await, so render stays still.
    if (this.wantsFacts) {
      this.wantsFacts = false;
      const on = this.on;
      cx.spawn(async cx => { await facts(on).catch(() => null); if (this.on === on && known(on)) cx.notify(); });
    }
    const p = prefs(), a = this.asked;
    if (a && this.context?.cwd && ((p.ignored !== "show") !== a.ignored || (p.sort === "modified" && a.sort !== "modified") || (p.compact && !a.compact) || depthNow() !== a.repoDepth)) this.refresh(cx);
    if (this.chainSig !== JSON.stringify([p.compact, p.hidden, p.exclude])) this.chainsFrom(p);
    if (p.markdown !== this.markdownSeen) { if (this.markdownSeen !== undefined) this.preview.source = p.markdown === "source"; this.markdownSeen = p.markdown; }
    this.preview.rewrap(cx);
  }

  // ---- Drawing

  // The icon of a row: Material Icon Theme's (icons.js) with settings.icons, else Herdr's glyphs.
  icon(name, dir, open, rel, t, p = prefs()) {
    if (p.icons) return image(iconFor(name, dir, open, rel, this.light)).size(16).flex_none();
    return svg(asset(dir ? "folder.svg" : "file.svg")).size(14).flex_none().text_color(dir ? t.accent : t.muted);
  }
  // The icon a file has in the search lists.
  fileIcon(rel, t) { return this.icon(nameOf(rel), false, false, rel, t); }

  // A row's box (Herdr's Files mod's row, at ROW's sizes): the hover, the selection, a cut row faded, and
  // what a click does: ⌘ and Shift select, a folder opens or closes, a file previews, a double-click
  // opens it.
  rowBox(id, rel, dir, indent, t, cut) {
    return h_flex().id(id).h(ROW.height).flex_none().pl(8 + indent).pr(8).gap(ROW.gap).items_center().rounded(ROW.radius).cursor_pointer().hover(s => s.bg(t.hover))
      .when(this.picks(rel), el => el.bg(t.selected))
      .when(Boolean(cut?.has(rel)), el => el.opacity(0.5))
      .on_click((e, cx) => {
        this.h.focus();
        const mods = e.modifiers ?? {};
        if (mods.platform || mods.shift) this.multiClick(rel, mods);
        else if (dir) { this.sel = rel; this.toggle(rel, cx); }
        else if (e.click_count >= 2) { this.sel = rel; this.launch(rel); }
        else if (this.preview.look(rel, cx)) this.sel = rel;
        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => this.rightClick(rel, dir, cx));
  }

  // The rows under `prefix` (Herdr's Files mod's rows(), into `out`): each entry, and what's open under it.
  rows(prefix, depth, out, t, p = prefs(), cut = cutRels(this.root, this.on)) {
    if (out.length >= TOTAL || depth > 40) return out;
    const within = p.freshMinutes * 60000;
    for (const entry of this.listed(prefix, p)) {
      if (out.length >= TOTAL) break;
      const head = prefix ? `${prefix}/${entry.name}` : entry.name, path = entry.dir ? this.deepest(head, p) : head;
      out.push(this.row({ entry, head, path, depth, t, p, cut, within }));
      if (entry.dir && this.folders.has(path)) this.rows(path, depth + 1, out, t, p, cut);
      else if (entry.kids && this.nests.has(head)) {
        for (const kid of entry.kids) { const rel = prefix ? `${prefix}/${kid.name}` : kid.name; out.push(this.row({ entry: kid, head: rel, path: rel, depth: depth + 1, t, p, cut, within, under: head })); }
      }
    }
    return out;
  }

  // One row. A compacted chain is one row for its deepest folder ("src/main/java": it opens, selects,
  // takes a menu and drops); a file with nested files gets a chevron of its own; `under`: the file a
  // nested one is listed under.
  row({ entry, head, path, depth, t, p, cut, within, under }) {
    const dir = entry.dir, open = dir ? this.folders.has(path) : this.nests.has(head);
    // A selection inside a chain is its row.
    if (path !== head && this.cursor && path.startsWith(`${this.cursor}/`) && (this.cursor === head || this.cursor.startsWith(`${head}/`))) this.cursor = path;
    const mark = markFor(this.marks, head, dir), branch = dir ? this.repos.get(path) : null;
    // Git-ignored, with settings.ignored "dim": the muted color (a mark's color wins).
    const color = markColor(mark, t) ?? (entry.ignored ? t.muted : null), recent = !dir && mark !== null && fresh(this.mtimes.get(head), Date.now(), within);
    this.visible.push({ path, dir, head, kids: Boolean(entry.kids), under });
    const arrow = svg(asset(`chevron-${open ? "down" : "right"}.svg`)).size(12).flex_none().text_color(t.dim);
    const lead = dir ? arrow
      : entry.kids ? div().id(`nest-${path}`).size(12).flex_none().on_click((_e, cx) => { cx.stop_propagation(); this.toggleNest(head, cx); }).child(arrow)
        : div().w(12).flex_none();
    const name = path === head ? entry.name : `${entry.name}/${path.slice(head.length + 1)}`;
    let box = this.rowBox(`file-${path}`, path, dir, depth * ROW.indent, t, cut)
      .child(lead)
      .child(this.icon(dir ? nameOf(path) : entry.name, dir, open && dir, path, t, p))
      .child(div().flex_1().min_w(0).truncate().when(color !== null, el => el.text_color(color)).child(name));
    if (dir) box = box.on_drop((e, cx) => this.drop(e.paths, path, cx));
    // A repository below the root: its branch, muted; one not read: "Not read" and Read it.
    if (branch) box = box.child(h_flex().flex_none().max_w(120).gap(3).items_center().text_size(10.5).text_color(t.dim)
      .child(svg(asset("glyphs/git-branch.svg")).size(10).flex_none()).child(div().min_w(0).truncate().child(branch)));
    const unread = dir ? this.unread.get(path) : null;
    if (unread) box = box.child(notReadBar(t, { id: `repo-${path}`, check: unread, compact: true, onRead: cx => this.readRepo(path, unread, cx) }));
    // Still being read: a spinner (native, no timer).
    if (dir && this.pending.has(path)) box = box.child(svg(asset("glyphs/spinner.svg")).size(10).flex_none().text_color(t.dim).spin(900));
    // Changed in the last settings.freshMinutes (10): an agent probably just touched it.
    if (recent) box = box.child(div().size(6).flex_none().rounded(3).bg(t.accent));
    if (mark) box = box.child(div().text_size(11).text_color(color).child(dir ? "•" : mark));
    return box;
  }

  // The Changed view: the git changes under the root as one list, most recently modified first.
  changedRows(t) {
    const note = text => div().p(8).text_size(12).text_color(t.dim).child(text);
    const noGit = known(this.on) && !known(this.on).tools.has("git");
    if (!this.repo) return [note(this.repo === false ? (noGit ? `git isn't installed${this.on ? ` on ${this.on}` : ""}` : "Not a git repository") : "Loading changes…")];
    const all = changedFiles(this.marks, this.mtimes), list = all.slice(0, 500), now = Date.now(), window = prefs().freshMinutes * 60000;
    if (!list.length) return [note("No changes")];
    const out = list.map(c => {
      const color = markColor(c.mark, t), name = c.path.lastIndexOf("/") + 1;
      this.visible.push({ path: c.path, dir: false });
      return this.rowBox(`chg-${c.path}`, c.path, false, 0, t, null)
        .child(div().w(12).flex_none().text_size(11).text_color(color).child(c.mark))
        // The name, then its folder (dim).
        .child(h_flex().flex_1().min_w(0).overflow_hidden()
          .child(div().flex_none().text_color(color).child(c.path.slice(name)))
          .when(name > 0, el => el.child(div().w(8).flex_none()).child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(c.path.slice(0, name - 1)))))
        .child(div().flex_none().text_size(11).text_color(fresh(c.mtime, now, window) ? t.accent : t.dim).child(c.mtime == null ? "" : age(c.mtime, now)));
    });
    if (all.length > list.length) out.push(note(`Showing ${list.length} of ${all.length} changes`));
    return out;
  }

  // The header (Herdr's Files mod's, grown): ‹ up a level, the root's name (the roots popup; on another
  // machine its name too), then the buttons. A toggle's id names its state: GPUI builds a tooltip from
  // the frame its hover began in, so the same element would show its old words after a click. The
  // root's name gives way first: the buttons always fit, down to a 300 px panel (⤢ from 308 px wide).
  // Last, the gear: the settings window at Files (the folder's menu, ⋯, has Settings… too).
  header(t, l) {
    // A button: an icon button as the Changes and History pages' (iconbutton.js), with its glyph (one
    // of ours, or one of Herdr's by path), or a text in the same box (⋯: there is no three-dots glyph);
    // `lit` while on; `menu`: it opens a menu (at it: menuat.js), `label` its name while `tip` is off.
    const button = ({ id, glyph, text, tip, label = null, act, lit = false, menu = false }) =>
      iconButton(t, id, text ? div().text_size(14).child(text) : glyph.includes("/") ? glyph : asset(`glyphs/${glyph}.svg`), act, { tip, label, on: lit, menu });
    const searchKeys = platform() === "macos" ? "⌘⇧F" : "Ctrl+Shift+F", pinned = l.pinned;
    // ⤢ in the panel (a layout block): the tree in a tab of its own, the panel making room; ⤡ in that
    // tab: back to the panel. Herdr's own icons for a pane's zoom and unzoom, as History's.
    const zoom = this.tabMode ? { id: "fm-back", glyph: "mods/pane/unzoom.svg", tip: "Back to the panel (closes this tab)", act: () => backToPanel({ mod: ID, kind: "files" }) }
      : !this.inWindow && placeIn(layout(), isTree(ID)) ? { id: "fm-tab", glyph: "mods/pane/zoom.svg", tip: "Open Files in a tab (the panel makes room)", act: (cx) => this.openTab(cx) } : null;
    const buttons = !this.root ? [] : [
      { id: "fm-search", glyph: "search", tip: `Search files (/), in files (${searchKeys})`, lit: Boolean(this.search), act: (cx) => (this.search ? this.closeSearch(cx) : this.openSearch(cx)) },
      { id: `fm-changes-${this.changes ? "on" : "off"}`, glyph: "mods/changes/changes.svg", tip: this.changes ? "Back to the tree" : "Changed files", lit: Boolean(this.changes), act: (cx) => { this.changes = !this.changes; cx.notify(); } },
      // A tab's folder is its own: nothing to pin.
      ...(this.tabMode ? [] : [{ id: `fm-pin-${pinned ? "on" : "off"}`, glyph: pinned ? "pin-off" : "pin", tip: pinned ? (prefs().follow ? "Unpin: follow the terminal" : "Unpin") : "Pin this folder", lit: pinned, act: () => this.togglePin(l) }]),
      { id: "fm-newfile", glyph: "plus", tip: "New file", act: () => openDialog("newfile", this.target("", true)) },
      { id: "fm-newfolder", glyph: "folder-plus", tip: "New folder", act: () => openDialog("newfolder", this.target("", true)) },
      { id: "fm-collapse", glyph: "minus", tip: "Collapse all", act: (cx) => { this.collapse(); cx.notify(); } },
      ...(zoom ? [zoom] : []),
      // Lit, with no tooltip (it would show over the menu), while its menu is open.
      { id: "fm-more", text: "⋯", tip: this.menuFrom === "more" ? null : "This folder's menu", label: "This folder's menu", lit: this.menuFrom === "more", menu: true, act: (cx) => this.backgroundMenu(cx) },
    ];
    // The gear, with no folder too: opens the settings window, or closes it when it's open.
    const gear = settingsGear("fm-settings", "files");
    buttons.push({ id: gear.id, glyph: "settings", tip: gear.tip, act: (cx) => gear.open(cx) });
    // What the folder button has beside the buttons at this width (not known yet: all it needs). A
    // narrow panel leaves ⤢ out first (every button fits beside the folder button's least), then the
    // machine's chip (shown where the name keeps 48 px beside the chip's 36).
    const fixed = n => HEAD.pad + HEAD.up + n * HEAD.button + (n + 1) * HEAD.gap + HEAD.border;
    let room = (this.width ?? Infinity) - fixed(buttons.length);
    const at = buttons.findIndex(b => b.id === "fm-tab");
    if (at >= 0 && room < HEAD.root) { buttons.splice(at, 1); room += HEAD.button + HEAD.gap; }
    const chip = Boolean(this.on) && room >= HEAD.root + 48 + 4 + 36;
    const where = this.root ? (this.on ? `${this.on}: ${this.root}` : this.root) : "No folder";
    // As tall as the Changes and History pages' top rows, the gear as far from the right edge (14 px);
    // 8 px on the left, before ‹ (a 24 px box: its chevron lines up with their titles).
    return h_flex().h(42).flex_none().pl(8).pr(14).gap(ICON_GAP).items_center().border_b(1).border_color(t.border)
      .child(up(this.root) ? button({ id: "fm-up", glyph: "chevron-left", tip: "Up one level", act: (cx) => this.goUp(l, cx) }) : div().w(24).flex_none())
      // On another machine its name is a chip beside the folder's: both give way in a narrow panel, the
      // chip first and further (a long machine name kept its whole width and cut the folder's name to
      // its first letter); the name keeps 48 px, the chip 36, and where that doesn't fit the chip goes.
      // The tooltip has both whole. A tab's folder button has no menu (its folder is its own).
      .child(h_flex().id("fm-root").flex_1().min_w(0).overflow_hidden().h(26).px(4).gap(4).items_center().rounded(6)
        .when(this.menuFrom === "roots", el => el.bg(t.hover)).when(this.menuFrom !== "roots", el => el.tooltip(where))
        .when(!this.tabMode, el => el.cursor_pointer().hover(s => s.bg(t.hover)).on_click((_e, cx) => { if (!closingClick("fm-root")) this.roots(l, cx); }).on_mouse_down("left", pressOn("fm-root", this.menuFrom === "roots")))
        .child(div().min_w(chip ? 48 : 0).flex_shrink(1).truncate().font_semibold().child(this.root ? folderName(this.root) : "Files"))
        .when(chip, el => el.child(div().min_w(36).flex_shrink(4).truncate().px(5).rounded(4).bg(t.raised).text_size(10.5).text_color(t.dim).child(this.on)))
        .when(!this.tabMode, el => el.child(chevron(t.muted))))
      .children(buttons.map(button));
  }

  // render() reaches refresh(), follow(), detect() and settle(): nothing on those paths may call
  // cx.notify() or setShared() before an await (Herdr refuses them while a view renders and shows "This
  // view could not be re-rendered").
  render(cx) {
    if (!this.preview.edit && placeKey(this.here()) !== this.context?.key) this.refresh(cx);
    else if (this.stale && !this.offscreen()) { this.stale = false; this.refresh(cx); }
    this.follow(cx);
    this.takeReveal(cx);
    this.detect(cx);
    this.settle(cx);
    const t = theme(), l = this.here(), p = prefs(), framed = !this.inWindow && props()?.frame !== "none";
    this.visible = []; this.light = settings().dark === false;
    const rows = this.search || this.changes ? [] : this.rows("", 0, [], t, p);
    // Herdr's Files mod's words, and ours for a folder the settings empty.
    const listed = this.entries.get("")?.length > 0;
    const empty = this.error || (!this.root ? "No folder" : this.loading && !listed ? "Loading files…" : listed ? "Nothing to show: the Files settings hide everything here" : "No files");
    let tree = v_flex().id("files-tree").track_focus(this.h).on_key_down((e, cx) => this.onKey(e, cx)).flex_1().min_h(0)
      .on_mouse_down("right", () => this.backgroundMenu())
      .on_drop((e, cx) => this.drop(e.paths, "", cx));
    if (this.search) tree = tree.child(this.searchView(t));
    else if (this.changes) tree = tree.overflow_y_scrollbar().p(6).children(this.changedRows(t));
    else tree = tree.overflow_y_scrollbar().p(6)
      .when(Boolean(this.notice), el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.notice.text)))
      .children(rows)
      .when(Boolean(this.error) || !this.listed("", p).length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(empty)))
      .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child(`File list limited to ${PER_FOLDER} entries per folder and 5,000 total`)));
    // In a tab of its own: the tree at the left, the line to drag, the preview at the right (or what to
    // do for one). Else the tree, the preview under it.
    const body = !this.tabMode ? null : h_flex().id("fm-tab-body").flex_1().min_h(0).items_stretch()
      .child(v_flex().id("fm-tab-tree").w(this.treeWidth()).h_full().flex_none().min_h(0).child(tree))
      .child(this.tabLine(t))
      .child(v_flex().id("fm-tab-preview").flex_1().min_w(0).min_h(0).h_full()
        .child(this.preview.file ? this.preview.pane(t)
          : v_flex().id("fm-tab-hint").flex_1().items_center().justify_center().text_size(12).text_color(t.muted).child("Pick a file to see it here")));
    return v_flex().id("files").size_full().min_h(0).overflow_hidden().text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .when(framed, el => el.rounded(10).bg(t.surface).border_1().border_color(t.border))
      .when(Boolean(this.splitDrag), el => el.on_mouse_move((e, cx) => this.splitTo(e, cx)).on_mouse_up("left", (_e, cx) => this.splitEnd(cx))
        .on_hover((over, cx) => { if (!over) this.splitEnd(cx); }))
      .child(this.header(t, l))
      .when(!this.tabMode, el => el.child(tree).when(Boolean(this.preview.file), el => el.child(this.preview.pane(t))))
      .when(this.tabMode, el => el.child(body));
  }

  // ---- In a tab of its own (⤢)

  // ⤢: this folder in a tab, the panel making room (tabs.js); the tab that shows it already, if any.
  openTab(cx) {
    if (!this.root) return;
    openAsTab({ mod: ID, kind: "files", props: { root: this.root, on: this.on ?? null }, root: this.root, on: this.on ?? null }, cx);
  }
  // The tree's width beside the preview: being dragged, else where it was left (own("tabSplit")), else
  // TAB_TREE.size; the preview keeps TAB_TREE.preview px.
  treeWidth() {
    const most = Math.max(TAB_TREE.min, Math.min(TAB_TREE.max, (this.width ?? Infinity) - TAB_TREE.preview - TAB_TREE.line));
    const want = this.splitDrag?.size ?? shared(own("tabSplit")) ?? TAB_TREE.size;
    return Math.round(Math.max(TAB_TREE.min, Math.min(most, Number(want) || TAB_TREE.size)));
  }
  // The line between the tree and the preview: dragged sideways (its press starts it, the page follows
  // the pointer, a release or the pointer leaving the page ends it).
  tabLine(t) {
    const on = Boolean(this.splitDrag);
    return div().id("fm-tab-line").w(TAB_TREE.line).h_full().flex_none().relative().cursor_col_resize().hover(s => s.bg(t.hover))
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); const w = this.treeWidth(); this.splitDrag = { from: e.position.x, start: w, size: w }; cx.notify(); })
      .child(div().absolute().top(0).bottom(0).left(3).w(1).bg(on ? t.accent : t.border));
  }
  splitTo(e, cx) {
    const d = this.splitDrag;
    if (!d) return;
    const most = Math.max(TAB_TREE.min, Math.min(TAB_TREE.max, (this.width ?? Infinity) - TAB_TREE.preview - TAB_TREE.line));
    const size = Math.round(Math.max(TAB_TREE.min, Math.min(most, d.start + e.position.x - d.from)));
    if (size !== d.size) { d.size = size; cx.notify(); }
  }
  splitEnd(cx) {
    const d = this.splitDrag;
    if (!d) return;
    this.splitDrag = null;
    if (d.size !== d.start) setShared(own("tabSplit"), d.size);
    cx.notify();
  }
}

Object.assign(Tree.prototype, searchMethods);
