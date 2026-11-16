// The look of the newer parts' controls, in one place: question.js, stashui.js, branchui.js,
// undoui.js and diffui.js draw with these. Theme colors come in as `t` (Herdr's theme()).
import { h_flex, v_flex } from "gpui-base";
import { div, svg } from "gpui-kit";
import { readable } from "./ink.js";
import { asset } from "./id.js";

export const CLEAR = "#00000000";

/** A popover's floating card, `w` wide. */
export const card = (t, w) => v_flex().mt(6).w(w).p(5).gap(1).rounded(9).border_1().border_color(t.border).bg(t.popover).shadow_lg();

/** A small outlined button in a row, a bar or a card: its color where it reads on any of them. */
export function chip(t, id, label, { color = t.foreground, enabled = true, tip = null, onClick } = {}) {
  return div().id(id).h(22).px(8).flex().flex_none().items_center().rounded(11).border_1().border_color(t.border).text_size(11)
    .text_color(enabled ? readable(t, color, [t.surface, t.popover, t.raised, t.hover]) : t.muted)
    .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover).border_color(t.input)).on_click(onClick))
    .when(Boolean(tip), (e) => e.tooltip(tip)).child(label);
}

/** A dialog's button: "plain", "primary" or "danger". */
export function dialogButton(t, id, label, { kind = "plain", enabled = true, onClick } = {}) {
  const fill = kind === "danger" ? t.ansi1 : kind === "primary" ? t.solid : CLEAR, ink = kind === "danger" ? t.accent_foreground : kind === "primary" ? t.solid_foreground : t.foreground;
  return h_flex().id(id).h(30).px(16).items_center().rounded(15).text_size(12).font_medium().bg(fill).text_color(ink).border_1().border_color(kind === "plain" ? t.input : fill)
    .when(enabled, (e) => e.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(onClick)).when(!enabled, (e) => e.opacity(0.7)).child(label);
}

/** A tick box. */
export const tick = (t, on) => div().size(14).flex_none().flex().items_center().justify_center().rounded(4).border_1().border_color(on ? t.accent : t.input).bg(on ? t.accent : CLEAR)
  .text_color(t.accent_foreground).when(on, (e) => e.child(svg(asset("check.svg")).size(10)));

/** A radio dot. */
export const dot = (t, on) => div().size(14).flex_none().flex().items_center().justify_center().rounded(7).border_1().border_color(on ? t.accent : t.input)
  .when(on, (e) => e.child(div().size(6).rounded(3).bg(t.accent)));

/** `color` (#rgb, #rrggbb or #rrggbbaa: theme colors may carry their own alpha) at `a` (0..1) of
 *  its opacity; anything else as it is. */
export function alpha(color, a) {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(color ?? ""));
  if (!m) return color;
  const hex = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const own = hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1;
  return `#${hex.slice(0, 6)}${Math.round(Math.min(1, Math.max(0, own * a)) * 255).toString(16).padStart(2, "0")}`;
}
