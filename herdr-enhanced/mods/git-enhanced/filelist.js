// The file list: a section per kind of change (Staged, Unstaged, Committed, or a read-only scope's own
// list), a row per file with its letter, folder and name ("old → new" for a rename), its Stage or
// Unstage button, a bubble for a comment on the whole file, its +/− numbers and, in the Review tab,
// its Viewed box; a repository inside this one has a dim "repository" instead. Its look and layout follow Herdr's Changes mod's list (a scroll area under a
// relative box, so its height reaches the panel's layout).
// Based on Herdr's shipped changes mod (Apache-2.0); changed: the file list's rows and scroll area.
import { h_flex, v_flex, Scrollbar } from "gpui-base";
import { div, svg } from "gpui-kit";
import { fromLabel } from "./renames.js";
import { asset } from "./id.js";
import { CLEAR, alpha } from "./look.js";
import { readable } from "./ink.js";

const ROW = 28, HEAD = 30;
/** How many of a section's rows the list shows before a Show more row under them. Every row shown is
 *  built on every render, and Herdr stops a render that runs too long (History's 400 file rows, built
 *  at once, did: "This view could not be re-rendered … interrupted"). */
export const ROWS_AT_ONCE = 100;
const letterColor = (t, letter) => (letter === "A" ? t.ansi2 : letter === "D" || letter === "U" ? t.ansi1 : t.blocked);

/** How many of section `g`'s rows show: `shown(g)` (all of them without it), never more than it has. */
const shownIn = (g, shown) => Math.min(g.rows.length, shown ? shown(g) : g.rows.length);
/** The list's height: every row shown and section header (and a section's Show more row), at least one
 *  row, at most `max`. */
export const listHeight = (sections, max = 260, shown = null) => Math.min(max, Math.max(44, sections.reduce((h, g) => {
  const n = shownIn(g, shown);
  return h + HEAD + n * ROW + (n < g.rows.length ? ROW : 0);
}, 0) + 12));

/** The list. `o`: { sections, open ({ path, section }), busy ({ path, section } of a running stage),
 *  idle, review, viewed(path) (true / false; undefined: not known yet), drafts (Map path → count),
 *  empty (the words when there is nothing), max, shown(section) (how many of its rows show; all
 *  without it), and onPick(path, section, cx), onStage(path, section, cx), onMenu(path, section, cx),
 *  onComment(path, cx), onViewed(path, cx), onMore(section key, cx) }. */
export function fileList(t, o) {
  const rows = [];
  o.sections.forEach((g, k) => {
    rows.push(h_flex().id(`section-${g.key}`).h(HEAD).flex_none().px(8).gap(6).items_center().when(k > 0, (e) => e.border_t(1).border_color(t.border))
      .child(div().text_size(11).font_semibold().text_color(t.muted).child(g.label))
      .child(div().text_size(11).text_color(t.dim).child(String(g.rows.length))));
    const n = shownIn(g, o.shown);
    for (let i = 0; i < n; i++) rows.push(fileRow(t, g.key, g.rows[i], o));
    if (n < g.rows.length) rows.push(moreRow(t, g.key, g.rows.length - n, o));
  });
  return div().flex_1().min_h(44).max_h(listHeight(o.sections, o.max, o.shown)).relative().border_b(1).border_color(t.border)
    .child(v_flex().id("changes-list").absolute().inset_0().size_full().overflow_y_scroll().p(6).children(rows)
      .when(!rows.length, (e) => e.child(div().p(8).text_color(t.dim).whitespace_normal().child(o.empty))))
    .child(Scrollbar.vertical("changes-list").absolute().inset_0());
}

function fileRow(t, section, { f, letter, add, del }, o) {
  // A repository inside this one ("sub/"): its name keeps the slash; no Stage, no comment, no
  // numbers, a dim "repository" instead (its right-click menu can stage it, after asking).
  const repo = Boolean(f.repo), bare = repo ? f.path.replace(/\/$/, "") : f.path;
  const cut = bare.lastIndexOf("/") + 1, folder = bare.slice(0, cut), name = f.path.slice(cut), id = `${section}-${f.path}`;
  const selected = o.open?.path === f.path && o.open?.section === section, viewed = o.review && !repo ? o.viewed(f.path) : false;
  // `dim` doesn't read on the selected row's tint: its hints are `muted` there. A mark's color where it
  // reads on the row, selected or under the pointer (else the foreground).
  const dim = selected ? t.muted : t.dim, row = selected ? t.selected : t.surface, ink = (c, on = [row, t.hover]) => readable(t, c, on);
  const staging = !repo && (section === "staged" || section === "unstaged"), count = o.drafts?.get(f.path) ?? 0;
  const comment = count ? `${count} draft comment${count === 1 ? "" : "s"} · click to comment on the whole file` : "Comment on the whole file";
  return h_flex().id(`file-${id}`).h(ROW).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer()
    .when(selected, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).when(viewed === true, (e) => e.opacity(0.5))
    .on_click((_e, cx) => o.onPick(f.path, section, cx))
    .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); o.onMenu(f.path, section, cx); })
    .child(div().w(14).flex_none().text_size(11).text_color(ink(letterColor(t, letter))).child(letter))
    .child(h_flex().flex_1().min_w(0)
      .when(Boolean(f.from), (e) => e.child(div().min_w(0).truncate().text_color(dim).child(`${fromLabel(f.from, f.path)} → `)))
      .child(div().min_w(0).truncate().text_color(dim).child(folder))
      .child(div().max_w(260).min_w(0).flex_none().truncate().child(name)))
    .when(staging, (e) => e.child(stageButton(t, id, section === "staged", o.busy?.path === f.path && o.busy?.section === section, o.idle, (cx) => o.onStage(f.path, section, cx))))
    .when(repo, (e) => e.child(div().id(`repo-label-${id}`).flex_none().text_size(10.5).text_color(dim)
      .tooltip("A git repository of its own inside this one: click to see why its changes aren't listed here").child("repository")))
    .when(!repo, (e) => e.child(div().id(`comment-on-${id}`).h(18).min_w(18).px(count ? 4 : 0).flex().flex_none().items_center().justify_center().gap(3).rounded(5)
      .when(count > 0, (e) => e.bg(alpha(t.accent, 0.2))).text_color(count ? ink(t.accent, [[row, alpha(t.accent, 0.2)]]) : dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .role("button").accessibility_label(comment).tooltip(comment)
      .on_click((_e, cx) => { cx.stop_propagation(); o.onComment(f.path, cx); })
      .child(svg(asset("message.svg")).size(11)).when(count > 0, (e) => e.child(div().text_size(10).child(String(count))))))
    .when(add > 0, (e) => e.child(div().flex_none().text_size(11).text_color(ink(t.ansi2)).child(`+${add}`)))
    .when(del > 0, (e) => e.child(div().flex_none().text_size(11).text_color(ink(t.ansi1)).child(`−${del}`)))
    .when(f.binary && !add && !del, (e) => e.child(div().flex_none().text_size(10.5).text_color(dim).child("binary")))
    .when(o.review && !repo, (e) => e.child(viewedBox(t, id, viewed, (cx) => o.onViewed(f.path, cx))));
}

// Under a section's rows when it has more: how many; a click shows ROWS_AT_ONCE more.
function moreRow(t, section, left, o) {
  const words = left > ROWS_AT_ONCE ? `Show ${ROWS_AT_ONCE} more · ${left.toLocaleString("en")} left` : `Show ${left} more`;
  return h_flex().id(`more-${section}`).h(ROW).flex_none().px(8).items_center().justify_center().rounded(7).cursor_pointer()
    .text_size(12).text_color(readable(t, t.accent, [t.surface, t.hover])).hover((s) => s.bg(t.hover))
    .role("button").accessibility_label(words)
    .on_click((_e, cx) => o.onMore(section, cx))
    .child(words);
}

function stageButton(t, id, unstage, busy, idle, onClick) {
  const word = unstage ? "Unstage" : "Stage";
  return div().id(`stage-${id}`).h(18).px(6).flex().flex_none().items_center().rounded(5).border_1().border_color(t.border).text_size(10)
    .text_color(idle ? t.foreground : t.muted).when(idle, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover))).when(!idle, (e) => e.opacity(0.7))
    .tooltip(unstage ? "Take it out of the index (git restore --staged)" : "Add it to the index (git add)")
    .on_click((_e, cx) => { cx.stop_propagation(); if (idle) onClick(cx); })
    .child(busy ? "…" : word);
}

// The Review tab's Viewed box; a viewed row is dimmed, and stops being viewed once its diff changes.
// Its id names its state: GPUI builds a tooltip from the frame its hover began in, so the same
// element would show the old words after a click.
function viewedBox(t, id, viewed, onClick) {
  const known = viewed !== undefined, on = viewed === true;
  return h_flex().id(`viewed-${on ? "on" : "off"}-${id}`).h(18).px(5).gap(4).flex_none().items_center().rounded(4).border_1().border_color(on ? t.accent : t.border)
    .text_size(10).text_color(on ? t.foreground : t.muted).when(!known, (e) => e.opacity(0.7))
    .when(known, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
    .tooltip(on ? "Viewed until its diff changes (v toggles the open file)" : "Mark as viewed (v for the open file)")
    .on_click((_e, cx) => { cx.stop_propagation(); if (known) onClick(cx); })
    .child(div().size(10).flex().items_center().justify_center().rounded(2).border_1().border_color(on ? t.accent : t.input).bg(on ? t.accent : CLEAR)
      .when(on, (e) => e.child(svg(asset("check.svg")).size(8).text_color(t.accent_foreground))))
    .child("Viewed");
}
