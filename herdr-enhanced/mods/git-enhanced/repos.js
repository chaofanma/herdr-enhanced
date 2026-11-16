// Several repositories for one folder: the shown folder's own repository plus the ones up to
// settings.repoDepth folders below it (reposcan.js). The Changes page, the History page and the
// Review tab show one of them; with more than one, a switcher ("name ▾") picks another, and the
// pick is remembered per folder (shared REPO: { "<machine>:<folder>": root }). The Review tab and a
// History tab stay on the repository they were opened for (props.root).
// A repository found below the folder is read only when its own git config has only the usual
// settings or the person trusted it (repotrust.js; the folder's own one always is): one git can't
// check is left out, one that waits shows "Not read" and Read it. Its branch and counts aren't read.
import { div } from "gpui-kit";
import { chevron } from "./iconbutton.js";
import { h_flex, Popover } from "gpui-base";
import { exec, props, shared, setShared } from "herdr";
import { MAX, SCAN_MS, INFO_MS, scanArgs, parseScan, infoArgs, parseInfo, pickRepo, folderKey, rememberRepo, repoLabel } from "./reposcan.js";
import { KEYS, settingsOf } from "./panelsettings.js";
import { listCard, CARD_HEADING, CARD_ROW, CARD_ONE, choice, heading, lines2, tick } from "./ui.js";
import { KEY } from "./id.js";
import { checks, SAFE_GIT_SH } from "./repotrust.js";

export const REPO = KEY.repo;
// A folder is scanned again after this long (ms); opening the switcher reads the branches again.
const TTL = 30000;
// Repositories a page opened by itself for a folder ("Show its changes" on a repository inside the
// shown one): "<machine>:<folder>" → Set of roots, listed with the scan's ones, below its depth too.
// Module-wide: every copy of the mod (the Changes and History pages) lists them.
const added = new Map();

/** A copy opened for one repository (props.root: the Review tab, a History tab) never switches. */
export const pinned = () => Boolean(props()?.root);

/** The root remembered for a folder (null: none, or a pinned copy). Part of the copies' context
 *  key, so a pick starts the page over on the new repository. */
export function rememberedRepo(on, folder, key = REPO) {
  if (pinned() || !folder) return null;
  const r = (shared(key) ?? {})[folderKey(on, folder)];
  return typeof r === "string" ? r : null;
}

export class RepoSet {
  /** `key`: the shared key of the remembered picks. */
  constructor({ key = REPO } = {}) {
    this.key = key;
    this.scans = new Map();   // "<machine>:<folder>|<depth>" → { at, roots, info }
    this.shown = null;        // the last pick: { folder, on, top, roots, info }
    this.choosing = false; this.counting = false;
  }

  /** The root to show for `cwd`: `top` is the repository it is in (rev-parse), `current` the one
   *  shown now. Scans the folder (cached a while); reads branch times only when the default is
   *  the most recently changed one. Null: no repository at all. */
  async pick({ cwd, on, top, current }) {
    if (pinned()) { this.shown = null; return top; }
    const depth = settingsOf(KEYS.changes, shared(KEYS.changes)).repoDepth;
    const k = `${folderKey(on, cwd)}|${depth}`;
    let scan = this.scans.get(k);
    if (!scan || Date.now() - scan.at > TTL) {
      const args = scanArgs(cwd, depth), found = args ? await exec("find", args, { cwd, on, timeout: SCAN_MS }).catch(() => null) : null;
      const all = found ? parseScan(found.stdout, null, MAX + 1).filter((r) => r !== top) : [];
      // Each one's config, checked (cached a while): one git can't read is left out.
      const checked = await Promise.all(all.map((r) => checks.check(r, on)));
      scan = { at: Date.now(), roots: all.filter((_r, i) => !checked[i].error), info: new Map() };
      this.scans.set(k, scan);
    }
    const more = [...(added.get(folderKey(on, cwd)) ?? [])].filter((r) => r !== top && !scan.roots.includes(r));
    // Their configs checked too (cached): the switcher and the page say "not read" as for the others.
    await Promise.all(more.map((r) => checks.check(r, on)));
    const roots = [...scan.roots.slice(0, top ? MAX - 1 : MAX), ...more];
    const remembered = rememberedRepo(on, cwd, this.key);
    // Without a repository of its own the default is the most recently changed one: read when.
    if (!top && roots.length > 1 && !(remembered && roots.includes(remembered)) && !(current && roots.includes(current)) && !scan.info.size) {
      scan.info = (await this.read(roots.filter((r) => this.reads(r, on)), on, false)).info;
    }
    this.shown = { key: k, folder: cwd, on, top, roots, info: scan.info };
    return pickRepo({ roots, top, remembered, current, info: scan.info });
  }

  /** Whether `root` is read: the folder's own repository (`top`), one opened for itself
   *  (props.root), or one whose check says so (repotrust.js: the usual settings only, or trusted). */
  reads(root, on, top = this.shown?.top) {
    return root === top || pinned() || checks.verdict(root, on) === "read";
  }
  /** The check of `root` when it waits for the person (Read it), else null. From a task. */
  async unread(root, on, top) {
    if (!root || root === top || pinned()) return null;
    const check = await checks.check(root, on);
    return checks.verdict(root, on) === "ask" ? check : null;
  }

  // Each root's branch and times, and with `counts` its changed files (one exec for all); only the
  // ones that are read. `{ info, missed }`: missed, the roots git didn't answer for (the exec
  // couldn't start, the machine is unreachable, or it stopped before printing them).
  async read(roots, on, counts) {
    if (!roots.length) return { info: new Map(), missed: [] };
    const [cmd, script, ...rest] = infoArgs(roots, counts);
    const r = await exec("sh", [cmd, SAFE_GIT_SH + script, ...rest], { cwd: roots[0], on, timeout: INFO_MS }).catch(() => null);
    const info = r ? parseInfo(r.stdout) : new Map();
    return { info, missed: roots.filter((root) => !info.has(root)) };
  }

  /** Every repository listed for the shown folder: its own first. */
  list() { const s = this.shown; return s ? [...(s.top ? [s.top] : []), ...s.roots] : []; }
  /** The switcher shows when there is more than one, or when the one shown is below the folder. */
  many() { const n = this.list().length; return n > 1 || (n === 1 && !this.shown.top); }

  /** Lists `root` for the shown folder from now on, wherever it is (a repository inside the shown
   *  one, below the scan's depth too); choose() then shows it. */
  add(root) {
    const s = this.shown;
    if (!s || !root || root === s.top) return;
    const k = folderKey(s.on, s.folder);
    (added.get(k) ?? added.set(k, new Set()).get(k)).add(root);
  }

  /** Show `root` for the shown folder from now on (its own repository: forget the pick). */
  choose(root) {
    const s = this.shown;
    if (!s) return;
    this.choosing = false;
    setShared(this.key, rememberRepo(shared(this.key), folderKey(s.on, s.folder), root, s.top));
  }

  // The switcher opened: read every repository's branch and changed files again.
  openList(open, cx) {
    this.choosing = open;
    const s = this.shown;
    if (open && s && !this.counting) {
      this.counting = true;
      const list = this.list();
      cx.spawn(async (cx) => {
        try {
          const { info, missed } = await this.read(list.filter((r) => this.reads(r, s.on, s.top)), s.on, true);
          if (this.shown === s) {
            // One git didn't answer for keeps the branch the last read knew; its changes aren't counted.
            for (const r of missed) { const was = s.info.get(r); if (was) info.set(r, { ...was, changed: null }); }
            s.info = info; s.missed = missed.length;
            const scan = this.scans.get(s.key); if (scan) scan.info = info;
          }
        } finally { this.counting = false; cx.notify(); }
      });
    }
    cx.notify();
  }

  /** The switcher: the shown repository's name; its list has every repository with its place,
   *  branch and changed files, the shown one ticked. `root`: the one shown now; `picked(cx)` runs
   *  after a pick, from the click (the page starts over there, not in a render). */
  switcher(t, { root, picked = null, id = "repo" }) {
    const s = this.shown, list = this.list(), here = root ? repoLabel(root, s?.folder) : { name: "", where: "" };
    const box = h_flex().id(`${id}-box`).h(22).min_w(0).max_w(140).px(7).gap(4).items_center().rounded(6).cursor_pointer().hover((st) => st.bg(t.hover))
      .when(this.choosing, (e) => e.bg(t.hover)).when(!this.choosing, (e) => e.tooltip(list.length > 1 ? `${list.length} repositories here · switch` : `The repository in ${here.where}, below this folder`))
      .child(div().min_w(0).truncate().text_size(11.5).font_medium().child(here.name))
      .child(chevron(t.muted));
    const pick = (r, cx) => { if (r !== root) { this.choose(r); picked?.(cx); } else this.choosing = false; cx.notify(); };
    // Each row's place and what is known of it: its branch ("no commits" only for one read without
    // one) and changed files ("…" while they're counted). A row with nothing under its name is one line.
    const rows = list.map((r) => {
      const label = repoLabel(r, s.folder), info = s.info.get(r), changed = info?.changed;
      const where = label.where === "." || label.where === label.name ? "" : `  ${label.where}`;
      const detail = !this.reads(r, s.on, s.top) ? "not read: its git config has settings beyond the usual ones"
        : [info ? info.branch ?? "no commits" : "", changed === null || changed === undefined ? (this.counting ? "…" : "") : changed ? `${changed} changed` : "clean"].filter(Boolean).join(" · ");
      return { r, name: `${label.name}${where}`, detail, height: detail ? CARD_ROW : CARD_ONE };
    });
    const missed = this.counting ? 0 : s?.missed ?? 0, read = list.filter((r) => this.reads(r, s.on, s.top)).length;
    const note = missed ? `Couldn't read ${missed >= read ? "them" : `${missed} of them`} just now: git didn't answer` : null;
    return Popover.new(`${id}-list`).open(this.choosing).on_open_change((open, cx) => this.openList(open, cx))
      .trigger(box)
      .content(listCard(t, 320, 380, [CARD_HEADING, ...(note ? [CARD_ONE] : []), ...rows.map((x) => x.height)])
        .child(heading(t, s?.top ? "This folder's repository, then the ones below it" : "Repositories below this folder").h(CARD_HEADING).flex_none())
        .when(Boolean(note), (e) => e.child(div().id(`${id}-unread`).h(CARD_ONE).flex_none().px(9).flex().items_center().text_size(11).text_color(t.muted).truncate().child(note)))
        .children(rows.map((x, i) => choice(t, `${id}-${i}`, { on: (cx) => pick(x.r, cx), chosen: x.r === root }).h(x.height).flex_none()
          .child(lines2(t, x.name, x.detail || null)).child(tick(t, x.r === root)))));
  }
}
