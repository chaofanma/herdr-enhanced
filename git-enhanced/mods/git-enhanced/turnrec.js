// Agent turns (turns.js has the pure parts): the recorder, the Turn scope's span, reverting a turn
// and undoing that.
//   - The recorder runs in one copy (the panel's Changes page; a module-level claim keeps it to one
//     even if more copies start). Every ~2 s it looks at agents(): an agent becoming "working"
//     starts a turn in the repository of its pane's folder, on this computer or on the space's
//     machine, one leaving it for "done" or "idle" ends it ("blocked" keeps it). Each end gets a
//     snapshot (turns.js SNAPSHOT, a POSIX sh script run where the repository is: a commit of the
//     working tree, untracked files too, made on a copy of the index; the person's index, branches
//     and files untouched) kept by refs/<mod>/turns/<id>/start and …/end. A snapshot over the time
//     limit records the turn as skipped. Records live in shared TURNS, newest first, `turnsKeep` per
//     repository; older ones' refs are deleted.
//   - The Turn scope compares a turn's start with its end (while it runs, with the working tree
//     now, as a tree snapshot).
//   - Revert this turn: a dialog lists what happens to each file, then `git restore
//     --source=<start> --worktree` (the index untouched) and the created files are deleted. What
//     was there just before is kept as …/undo, which Undo restores.
import { h_flex, v_flex } from "gpui-base";
import { div } from "gpui-kit";
import { exec, agents, panes, spaces, shared, setShared, props, theme, openOverlay, closeOverlay, notify } from "herdr";
import { ID } from "./id.js";
import { TURNS, TOO_BIG, turnRef, turnEvents, snapshotArgs, readSnapshot, revertPlan, planPaths, planWords, pruneTurns, recordRefs, turnLabel, turnId, viewable } from "./turns.js";
import { button, chip, dialog, keysFor } from "./ui.js";
import { iconButton, CLOSE } from "./iconbutton.js";
import { alpha } from "./look.js";
import { SAFE_ARGS, DIFF_SAFE, SAFE_GIT_SH } from "./repotrust.js";
import { readable } from "./ink.js";

// Which recorder records: the first that checks, until it stops checking for 10 s.
const CLAIM = { owner: null, at: 0 };
// A snapshot's limit for exec itself: over the script's own (turns.js SNAP_SECONDS for each of its
// two slow steps), with room for a machine further away.
const EXEC_MS = 40000;

/** The records in shared `key` (newest first). */
export const turnRecords = (key = TURNS) => { const v = shared(key); return Array.isArray(v) ? v : []; };

// One snapshot in `root` on machine `on` (null here): a commit kept by `ref`, or (`tree`) the
// working tree's tree only. The recorder works on its own: its git gets SAFE_ARGS (no fsmonitor, no
// hooks; the snapshot's script writes them out where it runs git through env). An agent's repository
// is read like the folder's own: the person works there, through the agent.
const snapshot = (root, on, opts) => { const [c, script, ...rest] = snapshotArgs(opts); return exec("sh", [c, SAFE_GIT_SH + script, ...rest], { cwd: root, on: on ?? null, timeout: EXEC_MS }).then(readSnapshot, (e) => ({ error: String(e.message ?? e) })); };
const git = (root, on, args) => exec("git", args, { cwd: root, on: on ?? null });
const readGit = (root, on, args) => git(root, on, [...SAFE_ARGS, ...args]);
// The repository key of a record: its machine and root.
const repoKey = (on, root) => `${on ?? ""}:${root}`;
const inChunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));

/** Change the records (`change(list)` → list) and save them; with `keep`, prune to that many per
 *  repository and delete the dropped ones' refs. */
export function saveTurns(change, { key = TURNS, keep = null } = {}) {
  const list = change(turnRecords(key));
  if (keep === null) { setShared(key, list); return; }
  const { kept, dropped } = pruneTurns(list, keep);
  setShared(key, kept);
  const byRepo = new Map();
  for (const r of dropped) if (r.root) (byRepo.get(r.repo) ?? byRepo.set(r.repo, { root: r.root, on: r.on ?? null, refs: [] }).get(r.repo)).refs.push(...recordRefs(r));
  for (const { root, on, refs } of byRepo.values()) exec("sh", ["-c", `${SAFE_GIT_SH}for r; do git update-ref -d "$r" 2>/dev/null; done; true`, "sh", ...refs], { cwd: root, on }).catch(() => {});
}

export class TurnRecorder {
  /** `settings()`: { turns (record or not), turnsKeep }; `key`: the shared key of the records. */
  constructor({ settings, key = TURNS }) { this.settings = settings; this.key = key; this.first = true; this.busy = new Set(); }

  /** One look at the agents (from a timer, every ~2 s). */
  check(cx) {
    const s = this.settings();
    if (!s.turns) return;
    const now = Date.now();
    if (CLAIM.owner && CLAIM.owner !== this && now - CLAIM.at < 10000) return;
    CLAIM.owner = this; CLAIM.at = now;
    const records = turnRecords(this.key), open = records.filter((r) => !r.end);
    const { end, start } = turnEvents({ agents: agents(), open, first: this.first, busy: this.busy });
    this.first = false;
    for (const id of end) this.end(records.find((r) => r.id === id), cx);
    for (const a of start) this.start(a, cx);
  }

  start(a, cx) {
    // The agent's folder, on its space's machine (null: this computer). One whose folder is unknown: no turn.
    const cwd = panes().find((p) => p.pane === a.pane)?.cwd, on = spaces().find((s) => s.id === a.space)?.machine ?? null;
    if (!cwd) return;
    this.busy.add(a.address);
    cx.spawn(async () => {
      try {
        const top = await exec("git", [...SAFE_ARGS, "rev-parse", "--show-toplevel"], { cwd, on });
        if (top.code !== 0) return;
        const root = top.stdout.trim(), id = turnId(), at = Date.now();
        const s = await snapshot(root, on, { ref: turnRef(id, "start"), message: `${ID}: turn ${id} started` });
        const record = { id, repo: repoKey(on, root), root, on, agent: a.program?.name || a.app || "agent", app: a.app ?? null, address: a.address, pane: a.pane, space: a.space, tab: a.tab,
          start: { at, ref: s.commit ? turnRef(id, "start") : null, commit: s.commit ?? null }, end: null, files: null, skipped: s.commit ? null : s.skipped ?? `no snapshot (${s.error})` };
        saveTurns((list) => [record, ...list], { key: this.key, keep: this.settings().turnsKeep });
      } catch { /* the folder went away: no turn */ }
      finally { this.busy.delete(a.address); }
    });
  }

  end(r, cx) {
    if (!r) return;
    this.busy.add(r.address);
    cx.spawn(async () => {
      try {
        const at = Date.now();
        let end = { at, ref: null, commit: null }, files = null, skipped = r.skipped;
        if (r.start?.commit && !r.skipped) {
          const s = await snapshot(r.root, r.on, { ref: turnRef(r.id, "end"), message: `${ID}: turn ${r.id} ended` });
          if (s.commit) {
            end = { at, ref: turnRef(r.id, "end"), commit: s.commit };
            const d = await readGit(r.root, r.on, ["diff", ...DIFF_SAFE, "--name-only", "-z", "--no-renames", r.start.commit, s.commit]);
            files = d.code === 0 ? d.stdout.split("\0").filter(Boolean).length : null;
          } else skipped = s.skipped ?? `no end snapshot (${s.error})`;
        }
        saveTurns((list) => list.map((x) => (x.id === r.id ? { ...x, end, files, skipped } : x)), { key: this.key, keep: this.settings().turnsKeep });
      } catch {
        saveTurns((list) => list.map((x) => (x.id === r.id ? { ...x, end: { at: Date.now(), ref: null, commit: null }, skipped: x.skipped ?? "the repository went away" } : x)), { key: this.key });
      } finally { this.busy.delete(r.address); }
    });
  }
}

/** What the Turn scope compares (scopes.js readOnlyRange): `{ sha: start, to: end (or, running, the
 *  working tree's tree now), turn }`, or null when the turn can't be shown (gone, skipped, another
 *  repository). */
export async function turnSpan({ root, on }, id, records) {
  const r = records.find((x) => x.id === id);
  if (!r || r.repo !== repoKey(on, root) || !viewable(r)) return null;
  if ((await readGit(root, on, ["cat-file", "-e", `${r.start.commit}^{commit}`])).code !== 0) return null;
  let to = r.end?.commit ?? null;
  if (!to) { const s = await snapshot(root, on, { tree: true }); if (!s.tree) return null; to = s.tree; }
  return { sha: r.start.commit, to, turn: r, running: !r.end, subject: turnLabel(r) };
}

/** Revert this turn…: work out what happens to each file (start against the end, or against now
 *  while it runs; which of them changed after it ended) and ask in a dialog (TurnOverlay). `o`:
 *  { root, record, mod (for the dialog), key (records), changed (the shared key set after) }. */
export function askRevert(o, cx) {
  const r = o.record, on = r.on ?? null, run = (args) => git(o.root, on, args);
  cx.spawn(async () => {
    const now = await snapshot(o.root, on, { tree: true }), to = r.end?.commit ?? now.tree;
    if (!to) { notify({ title: "Can't revert this turn", body: now.skipped ?? now.error ?? "no snapshot of the working tree", level: "error" }); return; }
    const plan = revertPlan((await run(["diff", "--name-status", "-z", "--no-renames", r.start.commit, to])).stdout);
    let later = [];
    if (r.end?.commit && now.tree && plan.length) {
      for (const chunk of inChunks(plan.map((p) => p.path), 200)) later.push(...(await run(["--literal-pathspecs", "diff", "--name-only", "-z", "--no-renames", r.end.commit, now.tree, "--", ...chunk])).stdout.split("\0").filter(Boolean));
    }
    openOverlay({ mod: o.mod, kind: "dialog", width: 560, height: 460, props: { turnRevert: { root: o.root, on, id: r.id, label: turnLabel(r), start: r.start.commit, running: !r.end, plan, later, key: o.key ?? TURNS, changed: o.changed } } });
  });
}

// Make `paths` as they are in `snapshot`: the ones it has are restored (worktree only), the others deleted.
async function become(root, on, snapshot, paths, there) {
  const keep = paths.filter((p) => there.has(p)), drop = paths.filter((p) => !there.has(p));
  for (const chunk of inChunks(keep, 100)) {
    const r = await git(root, on, ["--literal-pathspecs", "restore", `--source=${snapshot}`, "--worktree", "--", ...chunk]);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0] || "git restore failed");
  }
  for (const chunk of inChunks(drop, 200)) await exec("sh", ["-c", "for p; do rm -f -- \"$p\"; done", "sh", ...chunk], { cwd: root, on: on ?? null });
}

/** Undo a revert: the files it touched go back to how they were just before it (…/undo). */
export function undoRevert({ root, record, key = TURNS, changed }, cx) {
  const v = record?.reverted;
  if (!v?.undo) return;
  cx.spawn(async () => {
    try {
      const there = new Set();
      for (const chunk of inChunks(v.paths, 200)) {
        const r = await git(root, record.on, ["--literal-pathspecs", "ls-tree", "-r", "-z", "--name-only", v.undo, "--", ...chunk]);
        for (const p of r.stdout.split("\0")) if (p) there.add(p);
      }
      await become(root, record.on, v.undo, v.paths, there);
      saveTurns((list) => list.map((x) => (x.id === record.id ? { ...x, reverted: { ...x.reverted, undone: Date.now() } } : x)), { key });
      if (changed) setShared(changed, Date.now());
      notify({ title: "Undid the revert", body: turnLabel(record), level: "success", timeout: 3000 });
    } catch (e) { notify({ title: "Could not undo the revert", body: String(e.message ?? e).slice(0, 300), level: "error" }); }
  });
}

/** The read-only bar's buttons for a turn: Revert this turn…, or Undo after a revert. */
export function turnButtons(t, { root, record, mod, key = TURNS, changed }) {
  if (!record) return [];
  if (record.reverted && !record.reverted.undone) return [chip(t, "reverted", t.blocked), button(t, "turn-undo", "Undo", (cx) => undoRevert({ root, record, key, changed }, cx), { small: true, tip: "Put back what the revert changed" })];
  return [button(t, "turn-revert", "Revert this turn…", (cx) => askRevert({ root, record, mod, key, changed }, cx), { small: true, kind: "danger", tip: "Take this turn's changes out of the working tree (asks first)" })];
}

/** A note under the header after a turn of this repository was reverted (the last 30 min): Undo,
 *  or put it away. Null when there is none. */
export function turnNote(t, { root, on, key = TURNS, changed }) {
  if (!root) return null;
  const r = turnRecords(key).find((x) => x.repo === repoKey(on, root) && x.reverted && !x.reverted.undone && !x.reverted.hidden && Date.now() - x.reverted.at < 30 * 60000);
  if (!r) return null;
  const hide = () => saveTurns((list) => list.map((x) => (x.id === r.id ? { ...x, reverted: { ...x.reverted, hidden: true } } : x)), { key });
  return h_flex().h(30).flex_none().px(14).gap(6).items_center().border_b(1).border_color(t.border).bg(alpha(t.blocked, 0.09))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(readable(t, t.blocked, alpha(t.blocked, 0.09))).child(`Reverted ${r.agent}'s turn ${turnLabel(r).split(" · ")[1]} (${r.reverted.paths.length} file${r.reverted.paths.length === 1 ? "" : "s"})`))
    .child(button(t, "turn-note-undo", "Undo", (cx) => undoRevert({ root, record: r, key, changed }, cx), { small: true }))
    .child(iconButton(t, "turn-note-hide", CLOSE, () => hide(), { tip: "Put this note away" }));
}

/** Whether a copy's props make it the revert dialog. */
export const isTurnOverlay = (p) => Boolean(p?.turnRevert);

/** The revert dialog: props { turnRevert: { root, on, id, label, start, running, plan, later, key, changed } }. */
export class TurnOverlay {
  init(_props, cx) {
    Object.assign(this, { p: props().turnRevert, working: false, error: null, handle: cx.focus_handle() });
    this.handle.focus();
  }

  close() { const id = props()?.overlay; if (id) closeOverlay(id); }

  go(cx) {
    const p = this.p;
    if (this.working || !p.plan.length) return;
    this.working = true; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        // What is there now, for Undo.
        const before = await snapshot(p.root, p.on, { ref: turnRef(p.id, "undo"), message: `${ID}: before reverting turn ${p.id}` });
        if (!before.commit) throw new Error(before.skipped ?? before.error ?? "no snapshot");
        const paths = p.plan.map((s) => s.path), { remove } = planPaths(p.plan), created = new Set(remove);
        await become(p.root, p.on, p.start, paths, new Set(paths.filter((x) => !created.has(x))));
        saveTurns((list) => list.map((x) => (x.id === p.id ? { ...x, reverted: { at: Date.now(), undo: before.commit, paths } } : x)), { key: p.key });
        if (p.changed) setShared(p.changed, Date.now());
        notify({ title: "Reverted the turn", body: p.label, level: "success", timeout: 3000 });
        this.close();
      } catch (e) { this.error = String(e.message ?? e); this.working = false; cx.notify(); }
    });
  }

  render() {
    const t = theme(), p = this.p, later = new Set(p.later ?? []);
    const root = v_flex().id("turn-revert").size_full().min_h(0).bg(t.popover).text_color(t.foreground).track_focus(this.handle)
      .on_key_down(keysFor({ escape: () => this.close(), enter: (cx) => this.go(cx) }));
    const rows = p.plan.slice(0, 400).map((s, i) => h_flex().id(`turn-step-${i}`).min_h(20).gap(8).items_start().text_size(11.5)
      .child(div().w(14).flex_none().text_color(readable(t, s.was === "A" ? t.ansi1 : s.was === "D" ? t.ansi2 : t.blocked, t.raised)).child(s.was))
      .child(v_flex().flex_1().min_w(0)
        .child(div().text_color(t.foreground).truncate().child(s.path))
        .child(div().text_size(10.5).text_color(later.has(s.path) ? readable(t, t.ansi1, t.raised) : t.muted).whitespace_normal().child(later.has(s.path) ? `${planWords(s)} · changed since the turn ended: those edits go too (Undo brings them back)` : planWords(s)))));
    return dialog(t, root, {
      title: `Revert ${p.label}?`, subject: p.running ? "The agent is still working: its later changes stay" : `${p.plan.length} file${p.plan.length === 1 ? "" : "s"} · the index and other files stay as they are`,
      danger: true,
      // The body fills the dialog (flex_1), so the files, flex_1 in it, have what's left: in a body
      // as tall as its content they came out 0 px tall.
      body: v_flex().flex_1().min_h(0).gap(6)
        .child(div().whitespace_normal().child(p.plan.length ? "Each file goes back to how it was when the turn started:" : "This turn changed no file."))
        .child(v_flex().id("turn-steps").flex_1().min_h(0).overflow_y_scrollbar().gap(3).px(8).py(6).rounded(6).bg(t.raised).children(rows)
          .when(p.plan.length > 400, (e) => e.child(div().text_size(11).text_color(t.muted).child(`… and ${p.plan.length - 400} more`))))
        .when(Boolean(this.error), (e) => e.child(div().text_size(11.5).text_color(readable(t, t.ansi1, t.popover)).whitespace_normal().child(this.error))),
      buttons: [button(t, "turn-cancel", "Cancel", () => this.close()), button(t, "turn-confirm", this.working ? "Reverting…" : "Revert", (cx) => this.go(cx), { kind: "danger", busy: this.working || !p.plan.length })],
    });
  }
}
