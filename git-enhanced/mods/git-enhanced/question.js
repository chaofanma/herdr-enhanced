// Questions the panel asks in a dialog of its own mod (the mod hands a copy whose props have
// `question` to Question): a confirm ("Drop stash@{1}?"), a small form (a name, a choice,
// checkboxes, a list of files to tick, a list with a button each) or a menu at the pointer. The
// panel awaits the answer:
//   const { ask, choose } = questions("<mod name>");
//   const a = await ask({ title, detail, confirm: "Drop", danger: true });
//   a === null: cancelled (Cancel, Esc, a click beside the dialog); else { text, choice, checks, files }.
//   const id = await choose({ title, items }); // a menu item's id, or null
// The dialog and the panel are copies of one mod, and copies share its module (AGENTS.md: "a
// shared promise"), so the answer goes back through `pending` below; the panel's task goes on
// with its own cx.
// Spec: { title, detail?, lines?: string[] (a box of mono lines: the files a restore overwrites),
//   input?: { value?, placeholder?, required?, multiline? (a box of several lines: a commit message) },
//   choices?: { value, options: [{ id, label, detail?, disabled? }] },
//   checks?: [{ id, label, value, only?: [choice ids], required? (Confirm waits for the tick) }],
//   files?: { items: [{ path, checked, label? (shown instead of the path) }], only?: [choice ids] },
//   entries?: [{ id, title, detail?, button }] (a list, each with its button: answers { choice: id }),
//   mono? (the font family of lines and paths),
//   confirm (null: no confirm button), danger?, cancel?, error? (a red line: why the last answer
//   didn't do), width?, height? }.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { props, closeOverlay, openOverlay, theme } from "herdr";
import { chip, dialogButton, tick, dot } from "./look.js";
import { readable } from "./ink.js";
import { iconButton, CLOSE } from "./iconbutton.js";
import { tick as mark } from "./ui.js";
import { menuAt } from "./menuat.js";

// Answers on their way back to the copy that asked: question id → resolve.
const pending = new Map();
let asked = 0;

/** The questions of mod `mod` (its dialogs are copies of it): `ask(spec)` opens a dialog and
 *  resolves with the answer, or null; `choose({ title, items, width })` opens a menu at the pointer
 *  and resolves with the chosen item's id, or null (items: [{ id, label, danger?, disabled?,
 *  detail?: a second line, why it's off, checked?: a menu of settings marks the one in use with a
 *  ✓ at the row's end }], anchor?: a menu from a button opens at it, anchorOf's: menuat.js; else at
 *  the press). `defaults()`: spec fields every question gets, such as `mono`, the font of its lines
 *  and paths. */
export function questions(mod, defaults = () => ({})) {
  const ask = (wanted) => {
    const { anchor = null, ...spec } = { ...defaults(), ...wanted };
    const id = `q${Date.now().toString(36)}-${++asked}`;
    const width = spec.width ?? (spec.menu ? 250 : 460), height = spec.height ?? heightOf(spec);
    const at = spec.menu && anchor ? { at: menuAt(anchor, width, height) } : {};
    return new Promise((resolve) => {
      pending.set(id, resolve);
      try {
        openOverlay({ mod, kind: spec.menu ? "popup" : "dialog", width, height, ...at, props: { question: { ...spec, id } } });
      } catch (e) { pending.delete(id); console.log(`the question could not open: ${e}`); resolve(null); }
    });
  };
  return { ask, choose: ({ title, items, width, anchor }) => ask({ menu: true, title, items, width, anchor }) };
}

/** The answer to question `id` (null: cancelled); a second answer is ignored. */
export function answer(id, value) {
  const resolve = pending.get(id);
  if (!resolve) return false;
  pending.delete(id);
  resolve(value);
  return true;
}

// The lines box (18 px rows, 6 px padding above and below, a 1 px border) and the files box (24 px
// rows 1 px apart, 4 px padding): as tall as their rows, 160 and 180 px at most; past that they scroll.
const LINE_ROW = 18, FILE_ROW = 24;
export const linesHeight = (n) => Math.min(160, n * LINE_ROW + 14);
export const filesHeight = (n) => Math.min(180, n * (FILE_ROW + 1) - 1 + 10);

// A height that fits the spec's parts (the files and lines boxes scroll past theirs).
function heightOf(s) {
  if (s.menu) return 10 + (s.title ? 30 : 0) + s.items.reduce((h, i) => h + (i.detail ? 42 : 30), 0);
  let h = 120 + (s.detail ? 20 * Math.ceil(String(s.detail).length / 60) : 0) + (s.error ? 34 : 0);
  if (s.lines?.length) h += linesHeight(s.lines.length) + 8;
  if (s.input) h += s.input.multiline ? 150 : 44;
  if (s.choices) h += s.choices.options.length * 40;
  if (s.checks) h += s.checks.length * 28;
  if (s.files) h += filesHeight(s.files.items.length) + 8;
  if (s.entries) h += Math.max(1, Math.min(8, s.entries.length)) * 50 + 10;
  return Math.min(620, h);
}

/** Whether a part shows for the current choice (its `only` lists the choices it belongs to). */
export const shownFor = (part, choice) => !part?.only || part.only.includes(choice);

export class Question {
  init(_props, cx) {
    const q = props().question;
    this.q = q; this.choice = q.choices?.value ?? null; this.done = false;
    this.checks = Object.fromEntries((q.checks ?? []).map((c) => [c.id, Boolean(c.value)]));
    this.files = new Map((q.files?.items ?? []).map((f) => [f.path, Boolean(f.checked)]));
    this.fileLabels = new Map((q.files?.items ?? []).map((f) => [f.path, f.label ?? f.path]));
    this.handle = cx.focus_handle();
    if (q.input) {
      // Several lines (a commit message): Enter is a new line there, so only the button confirms.
      this.input = q.input.multiline ? TextareaState.new({ placeholder: q.input.placeholder ?? "", value: q.input.value ?? "", rows: 6 }) : InputState.new({ placeholder: q.input.placeholder ?? "", value: q.input.value ?? "" });
      if (q.input.multiline) this.input.set_auto_grow(4, 10);
      else this.input.on("submit", (_e, cx) => this.confirm(cx));
      this.input.on("change", (_e, cx) => cx.notify());
      this.input.focus();
      cx.timer.after(150, () => this.input?.focus());
    } else this.handle.focus();
  }

  // Herdr closed the dialog (Esc, a click beside it) or a button did: unanswered means cancelled.
  gone() { if (!this.done) { this.done = true; answer(this.q.id, null); } }

  cancel() { this.gone(); closeOverlay(props().overlay); }

  // What Confirm would answer, or null when it can't yet (no file ticked, a required name empty).
  value() {
    const files = [...this.files].filter(([, on]) => on).map(([path]) => path);
    if (this.q.files && shownFor(this.q.files, this.choice) && !files.length) return null;
    if (this.q.input?.required && !this.input.value().trim()) return null;
    if ((this.q.checks ?? []).some((c) => c.required && shownFor(c, this.choice) && !this.checks[c.id])) return null;
    return { text: this.input ? this.input.value() : null, choice: this.choice, checks: { ...this.checks }, files };
  }

  confirm(choice) {
    const value = this.value();
    if (!value || this.done || this.q.confirm === null && choice === undefined) return;
    this.done = true;
    answer(this.q.id, choice === undefined ? value : { ...value, choice });
    closeOverlay(props().overlay);
  }

  // A menu: its items; a click answers with the item's id. When an item says whether it is checked,
  // each row keeps room at its end for the ✓.
  menu(t) {
    const q = this.q, marks = q.items.some((item) => typeof item.checked === "boolean");
    // A popup is as tall as its content (the height asked for is the most it gets), so the root
    // is no scroll area and every row has its height (heightOf counts the same).
    return v_flex().id("question-menu").track_focus(this.handle).w_full().min_h(0).p(5).gap(0).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.cancel(); cx.stop_propagation(); } })
      .when(Boolean(q.title), (e) => e.child(div().h(30).flex_none().flex().items_end().px(9).pb(5).text_size(10.5).font_semibold().text_color(t.muted).truncate().child(q.title)))
      .children(q.items.map((item) => h_flex().id(`menu-${item.id}`).h(item.detail ? 42 : 30).flex_none().px(9).gap(8).items_center().rounded(7)
        .when(!item.disabled, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => { if (!this.done) { this.done = true; answer(q.id, item.id); closeOverlay(props().overlay); } }))
        .child(v_flex().flex_1().min_w(0).justify_center()
          .child(div().truncate().text_color(item.disabled ? t.muted : item.danger ? readable(t, t.ansi1, [t.popover, [t.popover, t.hover]]) : t.foreground).child(item.label))
          .when(Boolean(item.detail), (e) => e.child(div().text_size(10.5).text_color(t.muted).truncate().child(item.detail))))
        .when(marks, (e) => e.child(mark(t, item.checked)))));
  }

  render(cx) {
    const t = theme(), q = this.q;
    if (q.menu) return this.menu(t);
    const value = this.value(), mono = (e) => (q.mono ? e.font_family(q.mono) : e);
    const pick = (id, on, mark, label, detail, onClick, off) => h_flex().id(id).px(6).py(4).gap(9).items_start().rounded(7)
      .when(!off, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick))
      .child(div().pt(1).when(Boolean(off), (e) => e.opacity(0.7)).child(mark(t, on)))
      .child(v_flex().flex_1().min_w(0).child(div().when(Boolean(off), (e) => e.text_color(t.muted)).child(label)).when(Boolean(detail), (e) => e.child(div().text_size(11).text_color(t.muted).whitespace_normal().child(detail))));
    return v_flex().id("question-root").track_focus(this.handle).size_full().min_h(0).px(20).py(16).gap(10).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { this.cancel(); cx.stop_propagation(); }
        else if (e.key === "enter" && !q.input) { this.confirm(); cx.stop_propagation(); }
      })
      .child(h_flex().gap(10).items_start()
        .child(div().flex_1().min_w(0).text_size(14.5).font_semibold().whitespace_normal().child(q.title))
        .child(iconButton(t, "question-x", CLOSE, () => this.cancel(), { tip: "Cancel (Esc)" })))
      .when(Boolean(q.detail), (e) => e.child(div().whitespace_normal().text_color(t.muted).child(q.detail)))
      // A scroll area needs a height of its own (a max_h alone never scrolls in Herdr): the rows' own,
      // capped; heightOf counts the same.
      .when(Boolean(q.lines?.length), (e) => e.child(mono(v_flex().id("question-lines").h(linesHeight(q.lines.length)).flex_none().overflow_y_scrollbar().px(10).py(6).rounded(7).border_1().border_color(t.border).text_size(11.5).text_color(t.muted))
        .children(q.lines.map((l) => div().h(LINE_ROW).flex_none().truncate().child(l)))))
      .when(Boolean(this.input) && !q.input?.multiline, (e) => e.child(h_flex().id("question-input").h(32).px(10).items_center().rounded(8).border_1().border_color(t.accent).bg(t.surface).cursor_text()
        .child(Input.new(this.input).w_full().h_full().text_size(12.5).text_color(t.foreground))))
      .when(Boolean(this.input) && Boolean(q.input?.multiline), (e) => e.child(mono(div().id("question-text").px(8).py(6).rounded(8).border_1().border_color(t.accent).bg(t.surface).cursor_text()
        .child(Textarea.new(this.input).w_full().text_size(12.5).text_color(t.foreground)))))
      .when(Boolean(q.choices), (e) => e.child(v_flex().gap(1).children(q.choices.options.map((o) =>
        pick(`question-choice-${o.id}`, this.choice === o.id, dot, o.label, o.detail, (_e, cx) => { this.choice = o.id; cx.notify(); }, o.disabled)))))
      .children((q.checks ?? []).filter((c) => shownFor(c, this.choice)).map((c) =>
        pick(`question-check-${c.id}`, this.checks[c.id], tick, c.label, null, (_e, cx) => { this.checks[c.id] = !this.checks[c.id]; cx.notify(); })))
      .when(Boolean(q.files) && shownFor(q.files, this.choice), (e) => e.child(v_flex().id("question-files").h(filesHeight(this.files.size)).flex_none().overflow_y_scrollbar().p(4).gap(1).rounded(7).border_1().border_color(t.border)
        .children([...this.files].map(([path, on], i) => h_flex().id(`question-file-${i}`).h(24).flex_none().px(6).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.files.set(path, !this.files.get(path)); cx.notify(); })
          .child(tick(t, on)).child(mono(div().min_w(0).truncate().text_size(11.5)).child(this.fileLabels.get(path) ?? path))))))
      .when(Boolean(q.entries), (e) => e.child(v_flex().id("question-entries").flex_1().min_h(0).overflow_y_scrollbar().gap(1)
        .when(!q.entries.length, (e) => e.child(div().py(8).text_color(t.muted).child(q.empty ?? "Nothing here yet")))
        .children(q.entries.map((entry, i) => h_flex().id(`question-entry-${i}`).flex_none().px(8).py(6).gap(10).items_center().rounded(7).hover((s) => s.bg(t.hover))
          .child(v_flex().flex_1().min_w(0).gap(1).child(div().truncate().child(entry.title)).when(Boolean(entry.detail), (e) => e.child(div().text_size(11).text_color(t.muted).truncate().child(entry.detail))))
          .child(chip(t, `question-entry-button-${i}`, entry.button, { onClick: () => this.confirm(entry.id) }))))))
      .when(Boolean(q.error), (e) => e.child(div().whitespace_normal().text_size(11.5).text_color(readable(t, t.ansi1, t.popover)).child(q.error)))
      .when(!q.entries, (e) => e.child(div().flex_1()))
      .child(this.buttons(t, q, Boolean(value)));
  }

  // The foot: Cancel, and the question's own button (none when `confirm` is null), on once the
  // answer is complete (`ready`).
  buttons(t, q, ready) {
    const cancel = dialogButton(t, "question-cancel", q.cancel ?? "Cancel", { onClick: () => this.cancel() });
    return h_flex().gap(8).justify_end().child(cancel)
      .when(q.confirm !== null, (e) => e.child(dialogButton(t, "question-confirm", q.confirm ?? "OK", { kind: q.danger ? "danger" : "primary", enabled: ready, onClick: () => this.confirm() })));
  }
}
