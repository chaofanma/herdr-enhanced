// Draft comments on screen: the cards under diff rows and the box a comment is written in. The box
// can't be a list row (a row holds no input), so it floats over the top right of the diff, or, in a
// narrow panel, sits under it; it keeps every press to itself, or the click that closes it would
// reach the row under it and open it again.
import { h_flex, v_flex, Textarea } from "gpui-base";
import { div } from "gpui-kit";
import { alpha } from "./look.js";
import { iconButton, CLOSE } from "./iconbutton.js";
import { readable } from "./ink.js";

/** How tall a card for `text` is in a diff `width` px wide with code characters `ch` px wide. */
export function cardHeight(text, width, ch = 8) {
  const perLine = Math.max(20, Math.floor((width - 60) / Math.max(5, ch * 0.92)));
  const lines = String(text ?? "").split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return 34 + lines * 17 + 10;
}

/** A comment's card (a list row: no handlers; the list's click edits it). `live`: the one being
 *  edited, shown as typed; `ui`: a font family, or none for the page's (Herdr refuses a font family
 *  that isn't a string: the whole view stops drawing). */
export function commentCard(t, { text, span, height, live, inset, ui }) {
  return div().w_full().h(height).flex_none().py(4).pr(14).pl(inset)
    .child(v_flex().size_full().px(10).py(6).gap(2).rounded(7).border_1().border_color(live ? t.accent : alpha(t.accent, 0.6)).bg(alpha(t.accent, 0.07))
      .when(typeof ui === "string" && ui !== "", (e) => e.font_family(ui)).text_size(12)
      .child(div().text_size(10.5).text_color(t.muted).truncate().child(live ? `${span} · editing` : span))
      .children(String(text || " ").split("\n").map((l) => div().text_color(t.foreground).whitespace_normal().child(l || " "))));
}

/** The comment box. `c`: { path, span (where, in words), editing (an id, or null) }; `state`: the
 *  box's TextareaState; `docked`: under the diff rather than over it; `help`: the help is shown.
 *  Callbacks: onAdd(cx), onCancel(cx), onDelete(cx), onHelp(cx). `lines`: what the selected rows'
 *  changed lines can have done to them ({ count, actions: [{ id, label, danger, tip }], note,
 *  onAction(id, cx) }), or null. */
export function composer(t, { c, state, docked, help, ui, lines = null, onAdd, onCancel, onDelete, onHelp }) {
  const keep = (e) => e.on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_mouse_up("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => cx.stop_propagation());
  const button = (id, label, kind, onClick) => div().id(id).h(26).px(10).flex().items_center().rounded(6).text_size(11.5).cursor_pointer()
    .bg(kind === "primary" ? t.solid : kind === "danger" ? alpha(t.ansi1, 0.14) : t.raised).text_color(kind === "primary" ? t.solid_foreground : kind === "danger" ? readable(t, t.ansi1, [[t.surface, alpha(t.ansi1, 0.14)]]) : t.foreground)
    .hover((s) => s.opacity(0.88)).on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }).child(label);
  const box = keep(v_flex().id("comment-box").gap(6).p(10).when(typeof ui === "string" && ui !== "", (e) => e.font_family(ui)).text_size(12).text_color(t.foreground))
    .when(docked, (e) => e.w_full().flex_none().border_t(1).border_color(t.border).bg(t.surface))
    .when(!docked, (e) => e.absolute().top(8).right(14).w(300).rounded(9).border_1().border_color(t.border).bg(alpha(t.surface, 0.92)).shadow_lg())
    .child(h_flex().gap(6).items_center()
      .child(div().flex_1().font_semibold().child(c.editing ? "Edit comment" : "Comment"))
      .child(div().id("comment-help").size(18).flex().items_center().justify_center().rounded(9).border_1().border_color(t.border).text_size(10.5).text_color(t.muted).cursor_pointer()
        .tooltip("How the comment box works").on_click((_e, cx) => { cx.stop_propagation(); onHelp(cx); }).child("?"))
      .child(iconButton(t, "comment-close", CLOSE, (cx) => { cx.stop_propagation(); onCancel(cx); }, { tip: "Close (Esc)" })))
    .child(div().text_size(11).text_color(t.muted).truncate().child(`${c.path.split("/").pop()} · ${c.span}`))
    .when(Boolean(help), (e) => e.child(v_flex().gap(2).px(8).py(6).rounded(6).bg(t.raised).text_size(10.5).text_color(t.muted)
      .child(div().whitespace_normal().child("Enter adds the comment; Shift-Enter starts a new line; Esc closes."))
      .child(div().whitespace_normal().child("Click another line to take in the lines between; a click inside the range keeps just that line."))
      .child(div().whitespace_normal().child("⌘↩ adds it from anywhere in the panel. Submit review sends every comment to the space's agent."))))
    .child(div().id("comment-text").w_full().min_h(64).px(8).py(6).rounded(7).border_1().border_color(t.accent).bg(t.surface).cursor_text()
      .child(Textarea.new(state).w_full().text_size(12).text_color(t.foreground)))
    .when(Boolean(lines), (e) => e.child(h_flex().id("comment-lines").gap(6).items_center().min_w(0)
      .child(div().flex_1().min_w(0).text_size(10.5).text_color(t.muted).truncate().child(lines.note ?? `${lines.count} changed line${lines.count === 1 ? "" : "s"}`))
      // An action that waits (`off`: why) is faded, its id says so (its tooltip is the why).
      .children(lines.actions.map((a) => (a.off
        ? div().id(`lines-${a.id}-busy`).h(26).px(10).flex().flex_none().items_center().rounded(6).text_size(11.5).bg(t.raised).text_color(t.muted).opacity(0.7).tooltip(a.off).child(a.label)
        : button(`lines-${a.id}`, a.label, a.danger ? "danger" : "plain", (cx) => lines.onAction(a.id, cx)).flex_none().tooltip(a.tip))))))
    .child(h_flex().gap(6).items_center()
      .when(Boolean(c.editing), (e) => e.child(button("comment-delete", "Delete", "danger", onDelete)))
      .child(div().flex_1())
      .child(button("comment-cancel", "Cancel", "plain", onCancel))
      .child(button("comment-add", c.editing ? "Save" : "Add comment", "primary", onAdd)));
  return box;
}
