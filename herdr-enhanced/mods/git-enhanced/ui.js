// Building blocks for the panel's own modules (repos.js, history.js, commitmenu.js, scopepick.js,
// turnrec.js): popover cards, choice rows, chips, buttons, fields and a dialog frame, in the theme
// colors handed in. Glyphs instead of icon files, so the modules move between mods unchanged.
import { h_flex, v_flex } from "gpui-base";
import { div, svg } from "gpui-kit";
import { readable } from "./ink.js";
import { asset } from "./id.js";

export const CLEAR = "#00000000";

/** A floating card for a Popover's content, `width` px wide (`max` px tall at most). */
export const card = (t, width, max = 420) => v_flex().mt(3).w(width).max_h(max).p(5).gap(1).rounded(9).border_1().border_color(t.border).bg(t.popover).shadow_lg();

/** The heights of a list card's rows: a heading, a choice with a title and a line under it, and a
 *  choice with a title only (its words in the middle). */
export const CARD_HEADING = 22, CARD_ROW = 36, CARD_ONE = 26;
/** A floating card whose rows scroll: a scroll area needs a height of its own (a max_h alone never
 *  scrolls in Herdr), so it is as tall as its rows (`heights`, 1 px apart, 5 px padding, a 1 px
 *  border), `max` px at most. Give each row that height (`.h(CARD_ROW).flex_none()`). */
export const listCard = (t, width, max, heights) => v_flex().mt(3).w(width).h(Math.min(max, 12 + heights.reduce((n, h) => n + h, 0) + Math.max(0, heights.length - 1)))
  .p(5).gap(1).rounded(9).border_1().border_color(t.border).bg(t.popover).shadow_lg().overflow_y_scrollbar();

/** A clickable row: `on(cx)` on a click; `off` greys it out, `danger` reds it, `chosen` marks it. */
export function choice(t, id, { on, off = false, danger = false, chosen = false, tip = null }) {
  return h_flex().id(id).w_full().min_h(26).px(9).py(4).gap(8).items_center().rounded(5).text_size(12)
    .text_color(off ? t.muted : danger ? readable(t, t.ansi1, [t.popover, [t.popover, t.selected], [t.popover, t.hover]]) : t.foreground)
    .when(chosen, (e) => e.bg(t.selected))
    .when(Boolean(tip), (e) => e.tooltip(tip))
    .when(!off, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => on(cx)));
}
/** A title over a dim line, filling the row. */
export const lines2 = (t, title, sub) => v_flex().flex_1().min_w(0)
  .child(div().text_size(12).truncate().child(title))
  .when(Boolean(sub), (e) => e.child(div().text_size(10.5).text_color(t.muted).truncate().child(sub)));
/** The mark at the end of the row that is in use. */
export const tick = (t, on) => div().w(14).flex_none().flex().items_center().justify_center().text_color(readable(t, t.accent, [t.popover, [t.popover, t.selected], [t.popover, t.hover]]))
  .when(on, (e) => e.child(svg(asset("check.svg")).size(12)));
/** A dim heading inside a card. */
export const heading = (t, text) => div().px(9).pt(4).pb(2).text_size(10.5).font_medium().text_color(t.muted).child(text);
/** A line between groups of rows. */
export const rule = (t) => div().h(1).my(3).mx(4).flex_none().bg(t.border);
/** A short note under rows. */
export const note = (t, text, color = null) => div().px(9).py(3).text_size(10.5).text_color(color ?? t.muted).whitespace_normal().child(text);

/** A small label: outlined in `color` (its text in it where that reads on a row, selected or not),
 *  or filled with it. */
export const chip = (t, text, color, filled = false) => div().h(16).max_w(130).px(5).flex().flex_none().items_center().rounded(8).border_1()
  .border_color(color).bg(filled ? color : CLEAR).text_size(10).text_color(filled ? t.accent_foreground : readable(t, color, [t.surface, t.selected, t.hover])).truncate().child(text);

/** A button: "plain", "primary" (the theme's solid) or "danger"; `busy` greys it. */
export function button(t, id, label, on, { kind = "plain", busy = false, tip = null, small = false } = {}) {
  const bg = kind === "primary" ? t.solid : kind === "danger" ? t.ansi1 : t.raised, fg = kind === "primary" ? t.solid_foreground : kind === "danger" ? t.accent_foreground : t.foreground;
  return h_flex().id(id).h(small ? 22 : 30).px(small ? 7 : 13).flex_none().items_center().justify_center().rounded(small ? 5 : 7).text_size(small ? 11.5 : 12).font_medium()
    .bg(bg).text_color(fg).when(kind === "plain", (e) => e.border_1().border_color(t.border))
    .when(Boolean(tip), (e) => e.tooltip(tip))
    .when(busy, (e) => e.opacity(0.7))
    .when(!busy, (e) => e.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => on(cx)))
    .child(label);
}

/** A frame for an Input: `focused` lights its border; presses stay in it. */
export const field = (t, id, input, focused = true) => div().id(id).h(28).px(8).flex().flex_none().items_center().rounded(6).border_1()
  .border_color(focused ? t.accent : t.input).bg(t.surface).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(input);

/** A dialog's content in `root` (an element filling the overlay): a title line with its
 *  subject, the body, and a footer with the buttons; `danger` tints the title. */
export function dialog(t, root, { title, subject = null, body, buttons, danger = false }) {
  return root.child(v_flex().flex_1().min_h(0).px(18).pt(16).pb(10).gap(8)
    .child(div().text_size(14.5).font_semibold().text_color(danger ? readable(t, t.ansi1, t.popover) : t.foreground).whitespace_normal().child(title))
    .when(Boolean(subject), (e) => e.child(div().text_size(11.5).text_color(t.muted).truncate().child(subject)))
    .child(v_flex().flex_1().min_h(0).gap(6).text_size(12.5).text_color(t.muted).child(body)))
    .child(h_flex().flex_none().px(14).py(10).gap(8).items_center().border_t(1).border_color(t.border)
      .child(div().flex_1().text_size(10.5).text_color(t.muted).child("Esc closes"))
      .children(buttons));
}

/** Escape and Enter for an overlay's root: each runs its action (if any) and stops there. */
export const keysFor = (actions) => (e, cx) => {
  const act = actions[e.key];
  if (!act) return;
  act(cx);
  cx.stop_propagation();
};
