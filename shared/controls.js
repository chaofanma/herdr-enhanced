// The settings window's controls, drawn like Herdr's own Settings (frame/settings): a toggle,
// segmented choices, a − value + stepper, buttons and links, a check box, a drop-down whose list
// floats under it, text fields. The window is dragged by any press a control doesn't stop, so every
// control stops its own (own(); a drop-down's Popover stops the press on its field).
import { div, svg } from "gpui-kit";
import { chevron } from "./iconbutton.js";
import { h_flex, v_flex, Input, Textarea, Popover } from "gpui-base";
import { readable } from "./ink.js";

export const NONE = "#00000000";
export const ICON = (name) => `mods/workspace-chrome/${name}.svg`;

// A press on a control is the control's, not the window's (which would start dragging it).
export const own = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());

// A heading over a group of rows.
export const heading = (t, text) => div().pt(16).pb(4).text_size(11).font_semibold().text_color(t.muted).child(text.toUpperCase());

// A muted line of explanation.
export const note = (t, text) => div().py(4).text_size(11.5).line_height("16px").text_color(t.muted).child(text);

// One setting: what it is (and a line about it) on the left, its control on the right.
export function row(t, title, about, control) {
  return h_flex().w_full().gap(14).py(8).border_b(1).border_color(t.border).items_center()
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().text_size(13).text_color(t.foreground).child(title))
      .when(Boolean(about), (el) => el.child(div().text_size(11.5).line_height("16px").text_color(t.muted).child(about))))
    .child(div().flex_none().child(control));
}

export function button(t, id, label, onClick, o = {}) {
  // A warning's red where it reads on the button and under the pointer (the window is a popover).
  const color = o.warn ? readable(t, t.blocked, [t.raised, [t.popover, t.hover]]) : t.foreground;
  return own(h_flex().id(id).h(24).px(10).flex_none().items_center().rounded(6).border_1()
    .border_color(o.warn ? t.blocked : t.border).bg(o.primary ? t.solid : t.raised).text_size(12)
    .text_color(o.primary ? t.solid_foreground : color)
    .when(!o.disabled, (el) => el.cursor_pointer().hover((s) => s.bg(o.primary ? t.solid : t.hover).opacity(o.primary ? 0.88 : 1)).on_click(onClick))
    .when(Boolean(o.disabled), (el) => el.opacity(0.7))
    .when(Boolean(o.tooltip), (el) => el.tooltip(o.tooltip))
    .child(label));
}

// A link in a line of text: "Check again".
export const link = (t, id, label, onClick) => own(div().id(id).flex_none().text_size(11.5).text_color(t.accent).cursor_pointer()
  .hover((s) => s.underline()).on_click(onClick).child(label));

// An icon button: the settings window's close (Herdr's x), ↑, ↓. Drawn as the pages' icon buttons
// (iconbutton.js: 24 px, radius 6, the icon 14 px in `muted`).
export function iconButton(t, id, content, label, onClick, o = {}) {
  const on = !o.disabled;
  return own(div().id(id).size(24).flex().flex_none().items_center().justify_center().rounded(6)
    .text_size(14).text_color(t.muted).role("button").accessibility_label(label)
    .when(on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onClick).tooltip(label))
    .when(!on, (el) => el.opacity(0.7))
    .child(typeof content === "string" && content.endsWith(".svg") ? svg(content).size(14) : content));
}

// On / off, like Herdr's own settings.
export const toggle = (t, id, on, label, onClick) => own(div().id(id).w(32).h(18).p(2).flex().flex_none().rounded(9).cursor_pointer()
  .bg(on ? t.accent : t.hover).when(on, (el) => el.justify_end()).role("switch").accessibility_label(`${label}: ${on ? "on" : "off"}`)
  .on_click(onClick).child(div().w(14).h(14).rounded(7).bg(on ? t.accent_foreground : t.muted)));

// One of a few: [[value, label], …].
export function segmented(t, id, options, value, onPick) {
  return h_flex().p(2).gap(2).flex_none().rounded(7).border_1().border_color(t.border).bg(t.surface)
    .children(options.map(([v, label], i) => {
      const on = v === value;
      return own(div().id(`${id}-${i}`).h(20).px(9).flex().items_center().rounded(5).border_1().text_size(12)
        .border_color(on ? t.border : NONE).bg(on ? t.raised : NONE).text_color(on ? t.foreground : t.muted)
        .when(!on, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => onPick(v, cx)))
        .child(label));
    }));
}

// − value +. Either end is faded where it wouldn't change anything.
export function stepper(t, id, label, onMinus, onPlus, o = {}) {
  const side = (k, glyph, name, f, ok) => own(div().id(`${id}-${k}`).w(24).h(22).flex().items_center().justify_center()
    .text_size(13).text_color(t.muted).accessibility_label(name)
    .when(ok, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(f))
    .when(!ok, (el) => el.opacity(0.7))
    .child(glyph));
  return h_flex().flex_none().items_center().rounded(6).border_1().border_color(t.border).bg(t.raised).overflow_hidden()
    .child(side("minus", "\u2212", "Less", onMinus, o.minus !== false))
    .child(div().min_w(o.w ?? 76).px(6).flex().justify_center().text_size(12).text_color(t.foreground).child(label))
    .child(side("plus", "+", "More", onPlus, o.plus !== false));
}

// A check box and what it's for; a click anywhere on either ticks or unticks.
export function checkbox(t, id, on, label, onClick, o = {}) {
  return own(h_flex().id(id).gap(8).min_w(0).items_center().cursor_pointer().on_click(onClick)
    .accessibility_label(`${label}: ${on ? "ticked" : "not ticked"}`)
    .child(div().size(15).flex().flex_none().items_center().justify_center().rounded(4).border_1()
      .border_color(on ? t.accent : t.input).bg(on ? t.accent : t.surface)
      .when(on, (el) => el.child(svg(ICON("check")).size(11).text_color(t.accent_foreground))))
    .child(div().min_w(0).truncate().text_size(12.5).text_color(on ? t.foreground : t.muted).child(label)));
}

// A choice from a short list, which opens under its field over the rows below it (as History's
// filters do), so nothing moves when it opens or closes; the Popover keeps it inside Herdr's window.
// The Popover takes the press on the field (stopping it, so the window doesn't drag), a press
// outside the list and Esc; `onOpen(open, cx)` follows it. Choices are { value, label, note }.
export function dropdown(t, id, choices, value, open, onOpen, onPick, o = {}) {
  const w = o.w ?? 230;
  const chosen = choices.find((c) => c.value === value) ?? choices[0];
  const label = (c) => h_flex().flex_1().min_w(0).gap(6).items_center()
    .child(div().min_w(0).truncate().child(c.label))
    .when(Boolean(c.note), (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(c.note)));
  // No press of its own (own() would stop it before the Popover around it saw it).
  const field = h_flex().id(`${id}-field`).w(w).h(26).px(9).gap(6).items_center().rounded(6).border_1()
    .border_color(open ? t.accent : t.border).bg(t.raised).text_size(12).text_color(t.foreground).cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .child(label(chosen))
    .child(chevron(t.muted));
  const list = () => v_flex().w(w).mt(4).p(3).gap(1).rounded(7).border_1().border_color(t.border).bg(t.surface).shadow_lg()
    .children(choices.map((c, i) => own(h_flex().id(`${id}-${i}`).h(24).px(7).gap(6).items_center().rounded(5).text_size(12)
      .text_color(t.foreground).when(c.value === chosen.value, (el) => el.bg(t.selected))
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => onPick(c.value, cx))
      .child(label(c))
      .child(c.value === chosen.value ? svg(ICON("check")).size(12).flex_none().text_color(t.accent) : div().w(12).flex_none()))));
  return Popover.new(`${id}-drop`).open(open).on_open_change((next, cx) => onOpen(next, cx)).trigger(field)
    .when(open, (el) => el.content(list()));
}

// A one-line text field. Its own frame carries the press, so a click in it doesn't drag the window.
export const field = (t, state, focused, o = {}) => own(div().w(o.w ?? 240).child(
  Input.new(state).w_full().h(26).px(8).rounded(6).border_1().border_color(o.error ? t.blocked : focused ? t.accent : t.input)
    .bg(t.surface).text_size(12).text_color(t.foreground)
    .when(Boolean(o.font), (el) => el.font_family(o.font))));

// A text box of several lines.
export const textbox = (t, state, focused, o = {}) => own(div().w_full().child(
  Textarea.new(state).w_full().px(8).py(6).rounded(6).border_1().border_color(o.error ? t.blocked : focused ? t.accent : t.input)
    .bg(t.surface).text_size(12).line_height("17px").text_color(t.foreground)
    .when(Boolean(o.font), (el) => el.font_family(o.font))));

// A spinner, turning natively (no timer).
export const spinner = (t) => svg(ICON("spinner")).size(12).flex_none().text_color(t.working).spin(900);
