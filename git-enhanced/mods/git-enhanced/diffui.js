// Above the diff, by Wrap and Split: ± (a choice of several values, so a menu: the lines of
// context) and Ignore whitespace (a switch, so an icon button, lit while on); and the "⋯ N lines"
// rows between hunks. They get their data, colors and callbacks; the caller stores what changes.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Popover } from "gpui-base";
import { CONTEXTS, MORE, contextWords, nonDefault } from "./diffopts.js";
import { CLEAR, card, alpha } from "./look.js";
import { iconButton } from "./iconbutton.js";
import { asset } from "./id.js";

/** Ignore whitespace (git diff -w), `on` while ignored; Lucide's pilcrow. onToggle(cx). `prefix`:
 *  its id's start (History's are "history-diff"). */
export function whitespaceButton({ t, on, onToggle, prefix = "diff" }) {
  return iconButton(t, `${prefix}-whitespace-${on ? "on" : "off"}`, asset("pilcrow.svg"), onToggle, {
    on, tip: on ? "Whitespace ignored (git diff -w): hunks can't be staged or reverted · click to show it" : "Whitespace shown · click to ignore it (git diff -w: hunks can't be staged or reverted then)" });
}

/** ±: the lines of context. `prefs`: { context }; `open`: the popover is; onOpenChange(open, cx);
 *  onSet("context", 3 | 10 | "file", cx); `prefix` as whitespaceButton's. */
export function diffOptionsButton({ t, prefs: p, open, onOpenChange, onSet, prefix = "diff" }) {
  const marked = nonDefault(p);
  const box = h_flex().id(`${prefix}-options-box`).h(24).min_w(24).px(marked ? 6 : 0).gap(3).flex_none().items_center().justify_center().rounded(6)
    .when(marked || open, (e) => e.bg(t.selected)).text_size(11.5).text_color(marked ? t.foreground : t.muted)
    .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).when(!open, (e) => e.tooltip(`Lines of context around each change: ${contextWords(p)} · click to choose`))
    // ± as an icon (Lucide's diff), 14 px as the icons beside it; the lines after it when not 3.
    .child(svg(asset("diff.svg")).size(14).flex_none()).when(marked, (e) => e.child(div().text_size(10.5).child(p.context === "file" ? "∞" : String(p.context))));
  const part = (c) => div().id(`${prefix}-context-${c.value}`).h(22).px(8).flex().items_center().rounded(5).text_size(11.5).bg(p.context === c.value ? t.selected : CLEAR)
    .text_color(p.context === c.value ? t.foreground : t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => onSet("context", c.value, cx)).child(c.label);
  return Popover.new(`${prefix}-options`).anchor("top_right").open(open).on_open_change(onOpenChange).trigger(box)
    .content(card(t, 260).p(8).gap(8).text_size(12)
      .child(v_flex().px(4).gap(4).child(div().text_size(11).text_color(t.muted).child("Context around each change"))
        .child(h_flex().h(26).p(1).gap(1).items_center().rounded(6).border_1().border_color(t.border).children(CONTEXTS.map(part)))));
}

/** A "⋯ N lines" row between hunks (a list row: no handlers; the list's click opens it), `height`
 *  tall, its words `inset` from the left (past the line numbers). */
export function gapRow({ t, text, height, inset }) {
  return h_flex().w_full().h(height).flex_none().pl(inset).gap(8).items_center().bg(alpha(t.raised, 0.5)).border_t(1).border_b(1).border_color(alpha(t.border, 0.5))
    .child(div().text_color(t.muted).child(text))
    .child(div().text_size(10.5).text_color(t.muted).child(`click: ${MORE} more lines on each side`));
}
