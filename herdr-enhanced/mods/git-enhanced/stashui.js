// Stashes in the panel: the Stashes popover, the stash view (a stash's changes, read-only, where
// the diff is), and the flows behind their buttons. Nothing here reads the view: the UI gets its
// data, colors and callbacks, and a flow gets `h`, a host:
//   h = runnerOf(...) (gitops.js) + { ask, choose } (question.js) + act(kind, work) (runs work with
//   the view's busy state and error line, refreshing after) + note(text) (a line under the diff) +
//   same() (still the repo the flow began in).
import { div } from "gpui-kit";
import { v_flex, h_flex, Popover, Scrollbar, v_virtual_list } from "gpui-base";
import { stashApplyEntry, stashDrop, stashPush, stashPatch, bringBack } from "./gitops.js";
import { patchFiles, patchRows, patchCounts } from "./diffview.js";
import { dropQuestion, stashWithQuestion, stashChoices } from "./stashes.js";
import * as O from "./stashops.js";
import { carryOut } from "./planflow.js";
import { validBranchName } from "./gitops.js";
import { CLEAR, card, chip, alpha } from "./look.js";
import { readable } from "./ink.js";
import { iconButton, CLOSE, chevron } from "./iconbutton.js";
const plural = (n, word) => (n === 1 ? `1 ${word}` : `${n} ${word}s`);
// A stash's row in the popover: its message and a line under it, Apply, Pop, Drop….
const STASH_ROW = 42, CLEAR_ROW = 28;

/** Stash `s`'s changes for the view: `{ rows, counts }`, or `{ error }`. `colorize`: see
 *  diffview.js patchRows. */
export async function loadStash(h, s, colorize) {
  try {
    const files = patchFiles(await stashPatch(h, s.hash));
    return { rows: patchRows(files, { colorize }), counts: patchCounts(files) };
  } catch (e) { return { error: String(e?.message ?? e) }; }
}

/** Apply or pop stash `s` (at once), or drop it (asks first). A pop or apply that stops on
 *  conflicts says so in git's words; the stash stays (git keeps it). */
export async function stashAction(h, s, what) {
  if (what === "drop") {
    if (await h.ask(dropQuestion(s)) && h.same()) h.act("dropStash", () => stashDrop(h, s.hash));
    return;
  }
  h.act(what === "pop" ? "pop" : "apply", async () => {
    try { await stashApplyEntry(h, s.hash, what === "pop"); }
    catch (e) {
      if (!/CONFLICT/.test(e.message)) throw e;
      h.note(`Stash ${what} stopped with conflicts: ${e.message}`);
    }
  });
}

/** Stash…: the dialog over the changed `files` ([{ path, untracked, from? }]), then git stash push
 *  with its choices. `staged`: something is staged; `open`: the file shown. A ticked rename is
 *  stashed by its new path, which takes the old one's removal along into the stash, but git
 *  leaves that removal staged: the old file comes back from HEAD (unless something is there now),
 *  so the files are as before the rename, and the stash holds all of it. */
export async function stashWith(h, { files, staged, open }) {
  const a = await h.ask(stashWithQuestion({ paths: files.map((f) => f.path), staged, open }));
  if (!a || !h.same()) return;
  // Everything, keeping what is staged or with ignored files too: stashops.js (ignored files ask what
  // leaves the folder).
  if (a.choice === "all" && (a.checks?.keep || a.checks?.ignored)) {
    return carryOut(h, O.stashPlan({ message: a.text ?? "", keepIndex: Boolean(a.checks.keep), untracked: Boolean(a.checks.untracked), ignored: Boolean(a.checks.ignored) }), { kind: "stash", yes: "Stash" });
  }
  const untracked = new Set(files.filter((f) => f.untracked).map((f) => f.path));
  const olds = a.choice === "files" ? files.filter((f) => f.from && a.files.includes(f.path)).map((f) => f.from) : [];
  h.act("stash", async () => {
    await stashPush(h, stashChoices(a, untracked));
    for (const old of olds) await bringBack(h, old);
  });
}

/** A stash's ⋯ menu: Apply (staged as it was), Branch from it…, Rename…, Compare with the working
 *  tree (`compare(s)`: the page shows that). */
export async function stashMoreFlow(h, s, { compare }) {
  const pick = await h.choose({ title: `${s.ref} · ${s.message || "(no message)"}`, width: 300, items: [
    { id: "apply-index", label: "Apply (staged as it was)", detail: "What was staged is staged again" },
    { id: "branch", label: "Branch from it…", detail: "A branch where it was made, the stash applied there" },
    { id: "rename", label: "Rename…" },
    { id: "compare", label: "Compare with working tree", detail: "Read-only: the files now against the stash" },
  ] });
  if (!pick || !h.same()) return;
  if (pick === "apply-index") return carryOut(h, O.applyPlan(s, { index: true }), { kind: "apply" });
  if (pick === "compare") return compare(s);
  if (pick === "rename") {
    const a = await h.ask({ title: `Rename ${s.ref}`, confirm: "Rename", input: { value: s.message ?? "", placeholder: "The stash's name", required: true }, detail: "It becomes stash@{0}, the newest." });
    if (!a || !h.same()) return;
    return carryOut(h, O.renamePlan(s, a.text), { kind: "stash" });
  }
  let name = "", error = null;
  for (;;) {
    const p = O.branchPlan(s.ref, "x");
    const a = await h.ask({ title: `Branch from ${s.ref}`, confirm: "Make the branch", error, input: { value: name, placeholder: "new-branch-name", required: true },
      detail: p.confirm.replace(/^Make branch x where /, "A new branch where ").replace(/\? /, ". ") });
    if (!a || !h.same()) return;
    name = a.text.trim();
    if (await validBranchName(h, name).catch(() => false)) break;
    error = `“${name}” can't be a branch name`;
  }
  return carryOut(h, O.branchPlan(s, name), { kind: "switch", asked: true });
}

/** Drop all…: every stash of `list` (the ones shown), after asking. */
export const clearFlow = (h, list) => carryOut(h, O.clearPlan(list), { kind: "dropStash", yes: "Drop all" });

/** The Stashes popover: `label` on a box that opens the list; per stash its message, branch and age
 *  (a click: onShow(s, cx)) and Apply, Pop, Drop… (onAction(s, "apply" | "pop" | "drop", cx)).
 *  `shownHash`: the stash in the view, marked. `idle`: nothing is running. */
export function stashPopover({ t, stashes, open, shownHash, idle, label, onOpenChange, onShow, onAction, onMore = null, onClear = null }) {
  const box = h_flex().id("stash-box").h(22).px(7).gap(4).items_center().rounded(6).text_size(11.5).cursor_pointer().hover((s) => s.bg(t.hover)).when(open, (e) => e.bg(t.hover))
    .when(!open, (e) => e.tooltip("The stashes: look at one, apply, pop or drop it")).child(label).child(chevron(t.muted));
  const row = (s, i) => h_flex().id(`stash-${i}`).h(STASH_ROW).flex_none().px(8).gap(6).items_center().rounded(6).hover((st) => st.bg(t.hover)).when(s.hash === shownHash, (e) => e.bg(t.selected))
    .child(v_flex().id(`stash-show-${i}`).flex_1().min_w(0).gap(1).cursor_pointer().tooltip("Show its changes").on_click((_e, cx) => onShow(s, cx))
      .child(div().text_size(12).truncate().child(s.message || "(no message)"))
      .child(div().text_size(10.5).text_color(t.muted).truncate().child([s.branch ? `on ${s.branch}` : "detached HEAD", s.age, s.ref].join(" · "))))
    .child(chip(t, `apply-${i}`, "Apply", { enabled: idle, onClick: (_e, cx) => onAction(s, "apply", cx) }))
    .child(chip(t, `pop-${i}`, "Pop", { enabled: idle, onClick: (_e, cx) => onAction(s, "pop", cx) }))
    .child(chip(t, `drop-${i}`, "Drop…", { color: t.ansi1, enabled: idle, onClick: (_e, cx) => onAction(s, "drop", cx) }))
    .when(Boolean(onMore), (e) => e.child(chip(t, `stash-more-${i}`, "⋯", { enabled: idle, tip: "Apply staged as it was, branch from it, rename, compare", onClick: (_e, cx) => onMore(s, cx) })));
  const clear = onClear ? h_flex().id("stash-clear").h(CLEAR_ROW).flex_none().px(8).items_center().rounded(6).text_size(11.5).text_color(idle ? readable(t, t.ansi1, [t.popover, [t.popover, t.hover]]) : t.muted)
    .when(idle, (e) => e.cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => onClear(cx))).tooltip("Drop every stash (asks first)").child(stashes.length === 1 ? "Drop it…" : `Drop all ${stashes.length}…`) : null;
  return Popover.new("stashes").anchor("top_right").open(open).on_open_change(onOpenChange).trigger(box)
    // A scroll area needs a height of its own (a max_h alone never scrolls in Herdr): the rows' own
    // (look.js card: 5 px padding, rows 1 px apart, a 1 px border), 360 px at most.
    .content(card(t, 380).h(Math.min(360, 12 + stashes.length * (STASH_ROW + 1) - 1 + (clear ? CLEAR_ROW + 1 : 0))).overflow_y_scrollbar().children(stashes.map(row)).when(Boolean(clear), (e) => e.child(clear)));
}

// How tall each of the view's rows is at this width: code rows wrap when `wrap` (a function cutting
// spans into lines of `cols` columns) is given; kept on `view` until the width or the font change.
function layoutOf(view, { code, width, wrap }) {
  const digits = String(view.rows.reduce((m, r) => Math.max(m, r.number ?? 0), 0)).length;
  const numbers = Math.max(28, Math.ceil(digits * code.ch) + 10), sign = 16;
  const cols = Math.max(1, Math.floor((width - numbers - sign - 8) / code.ch)), key = `${code.size}|${code.row}|${cols}|${Boolean(wrap)}`;
  if (view.layout?.key === key) return view.layout;
  const lines = new Map(), heights = view.rows.map((r, i) => {
    if (!wrap || !r.spans) return code.row;
    const cut = wrap(r.spans, cols);
    lines.set(i, cut);
    return Math.max(1, cut.length) * code.row;
  });
  return (view.layout = { key, numbers, sign, lines, heights });
}

/** The stash view, in place of the diff: a bar (the stash, its counts, Apply / Pop / Drop… / ×)
 *  over its rows. `view`: what loadStash gave ({ rows, counts } or { error }; null while loading),
 *  `colors`: token colors and `added` / `removed`; `code`: { family, size, row, ch } (the code
 *  font, its size, a row's height, a column's width); `width`: the rows' width; `wrap`: see
 *  layoutOf. onAction(s, what, cx), onClose(cx), onWidth(width, cx). */
export function stashPane({ t, colors, code, stash: s, view, idle, width, wrap, onAction, onClose, onWidth }) {
  const button = (id, label, color, what, tip) => chip(t, id, label, { color, enabled: idle, tip, onClick: (_e, cx) => onAction(s, what, cx) });
  const c = view?.counts, about = [s.ref, s.branch ? `on ${s.branch}` : "detached HEAD", s.age, c && `${plural(c.files, "file")} · +${c.add} −${c.del}`].filter(Boolean).join(" · ");
  const bar = h_flex().h(40).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border).bg(t.raised)
    .child(v_flex().flex_1().min_w(0).child(div().text_size(12).font_semibold().truncate().child(s.message || "(no message)")).child(div().text_size(10.5).text_color(t.muted).truncate().child(about)))
    .child(button("stash-view-apply", "Apply", t.foreground, "apply", "git stash apply: these changes into the working tree; the stash stays"))
    .child(button("stash-view-pop", "Pop", t.foreground, "pop", "git stash pop: apply it, then drop it"))
    .child(button("stash-view-drop", "Drop…", t.ansi1, "drop", "Delete it from the stash list (asks)"))
    .child(iconButton(t, "stash-view-close", CLOSE, (cx) => onClose(cx), { tip: "Back to the changes" }));
  const pane = v_flex().id("stash-view").flex_1().min_w(0).min_h(0).font_family(code.family).text_size(code.size).on_size_change((size, cx) => onWidth(size.width, cx)).child(bar);
  if (view?.error) return pane.child(div().p(12).text_size(11.5).text_color(t.ansi1).whitespace_normal().child(`Can't show this stash: ${view.error}`));
  if (!view?.rows) return pane.child(div().p(12).text_size(11.5).text_color(t.muted).child("Loading the stash…"));
  const layout = layoutOf(view, { code, width, wrap }), rows = view.rows;
  return pane.child(div().flex_1().min_h(0).relative()
    .child(v_virtual_list("stash-diff", rows.length, layout.heights, (i) => `st:${i}`, (range) => rows.slice(range.start, range.end).map((r, k) => stashLine(r, range.start + k, layout, t, colors, code))).size_full())
    .child(Scrollbar.vertical("stash-diff").viewport_from_layout().absolute().top(0).left(0).right(0).bottom(0)));
}

// One row of the stash view (a list row: no handlers).
function stashLine(r, i, layout, t, colors, code) {
  if (r.kind === "file") {
    const tone = r.status === "A" ? t.ansi2 : r.status === "D" ? t.ansi1 : t.blocked;
    return h_flex().w_full().h(code.row).flex_none().px(8).gap(8).items_center().bg(t.raised).border_t(1).border_color(t.border)
      .child(div().w(12).flex_none().text_size(11).text_color(readable(t, tone, t.raised)).child(r.status))
      .child(div().flex_1().min_w(0).truncate().font_semibold().child(r.text))
      .child(div().flex_none().text_size(10.5).text_color(t.muted).child(r.words));
  }
  if (r.kind === "@") return h_flex().w_full().h(code.row).flex_none().pl(layout.numbers + layout.sign).items_center().bg(t.raised).text_color(t.muted).truncate().child(r.text);
  if (r.kind === "note" || !r.spans) return h_flex().w_full().h(code.row).flex_none().pl(layout.numbers + layout.sign).items_center().text_color(t.muted).truncate().child(r.text);
  const tone = r.kind === "+" ? colors.added : r.kind === "-" ? colors.removed : null;
  // A token's color where it reads on the row's tint, else the foreground.
  const on = tone ? alpha(tone, 0.16) : t.surface;
  const piece = (sp) => div().when(Boolean(sp.cls), (e) => e.text_color(readable(t, colors[sp.cls] ?? t.foreground, on))).child(sp.text);
  const text = layout.lines.get(i) ?? [r.spans];
  return h_flex().w_full().h(layout.heights[i]).flex_none().items_start().when(Boolean(tone), (e) => e.bg(alpha(tone, 0.16)))
    .child(div().w(layout.numbers).h(code.row).flex_none().pr(6).flex().items_center().justify_end().text_size(code.size - 1).text_color(tone ? t.foreground : t.muted).child(String(r.number)))
    .child(div().w(layout.sign).h(code.row).flex_none().flex().items_center().justify_center().text_color(tone ? readable(t, tone, on) : CLEAR).child(r.kind === "+" ? "+" : r.kind === "-" ? "−" : ""))
    .child(v_flex().flex_1().min_w(0).children(text.map((line) => h_flex().h(code.row).flex_none().overflow_hidden().whitespace_nowrap().children(line.map(piece)))));
}
