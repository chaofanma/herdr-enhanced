// The interactive rebase's editor, a dialog copy of the mod (props { rebaseEdit }): the commits from
// the chosen one up to HEAD, oldest first as git applies them. Each row has its action (pick,
// reword, squash, fixup, drop; keys p r s f d), moves up and down (the arrows; Alt+↑/↓ with the
// keyboard), and a message box where git will ask for one: a reword, and the last squash of a run
// (prefilled with the run's messages joined, as git would). Start answers the page that opened it,
// which runs the rebase (historyacts.js); the editor itself runs nothing.
import { div } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { props, closeOverlay, openOverlay, theme } from "herdr";
import { ACTIONS, stepsProblem, messageSteps } from "./rewrite.js";
import { button } from "./ui.js";
import { readable } from "./ink.js";

// Answers on their way back to the copy that asked (copies share this module, as question.js).
const pending = new Map();
let opened = 0;

/** Opens the editor for `data` ({ rows: [{ sha, short, subject, author, message }], branch, from,
 *  pushed }) as an overlay of mod `mod`; resolves with { rows: [{ sha, action }], messages } or null. */
export function openRebaseEditor(mod, data) {
  const id = `r${Date.now().toString(36)}-${++opened}`;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    try { openOverlay({ mod, kind: "dialog", width: 680, height: Math.min(640, 250 + data.rows.length * 38), props: { rebaseEdit: { ...data, id } } }); }
    catch (e) { pending.delete(id); console.log(`the rebase editor could not open: ${e}`); resolve(null); }
  });
}
const answer = (id, value) => { const r = pending.get(id); if (!r) return; pending.delete(id); r(value); };
export const isRebaseOverlay = (p) => Boolean(p?.rebaseEdit);

const KEYS = { p: "pick", r: "reword", s: "squash", f: "fixup", d: "drop" };
const COLORS = { pick: "ansi4", reword: "ansi3", squash: "ansi5", fixup: "ansi6", drop: "ansi1" };

/** The message git's combined message would start from for the run ending at row `i`: the commit
 *  the run goes into, then every squash's message (a fixup's is left out). */
export function runMessage(rows, i) {
  let j = i;
  while (j > 0 && (rows[j].action === "squash" || rows[j].action === "fixup" || rows[j].action === "drop")) j--;
  const parts = [rows[j]?.message ?? ""];
  for (let k = j + 1; k <= i; k++) if (rows[k].action === "squash") parts.push(rows[k].message);
  return parts.filter((m) => m.trim()).join("\n\n");
}

export class RebaseEditor {
  init(_props, cx) {
    const p = props().rebaseEdit;
    this.p = p; this.done = false; this.at = 0; this.pushedOk = false;
    this.rows = p.rows.map((r) => ({ ...r, action: "pick" }));
    // One message box per commit, made here (never while drawing); `edited`: typed in, kept.
    this.boxes = new Map(); this.edited = new Set();
    for (const r of this.rows) {
      const box = TextareaState.new({ value: r.message, rows: 3 });
      box.set_auto_grow(2, 8);
      box.on("change", () => { if (box.value() !== this.filled.get(r.sha)) this.edited.add(r.sha); });
      this.boxes.set(r.sha, box);
    }
    this.filled = new Map(this.rows.map((r) => [r.sha, r.message]));
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  /** The shas whose message git asks for now. */
  asked() { return new Set(messageSteps(this.rows)); }
  // After a change: the boxes nobody typed in get the text git would start from.
  refill() {
    for (const [i, r] of this.rows.entries()) {
      if (this.edited.has(r.sha)) continue;
      const text = r.action === "squash" ? runMessage(this.rows, i) : r.message;
      if (this.filled.get(r.sha) !== text) { this.filled.set(r.sha, text); this.boxes.get(r.sha).set_value(text); }
    }
  }
  set(i, action, cx) { if (this.rows[i] && ACTIONS.includes(action)) { this.rows[i].action = action; this.at = i; this.refill(); cx.notify(); } }
  move(i, by, cx) {
    const j = i + by;
    if (j < 0 || j >= this.rows.length) return;
    [this.rows[i], this.rows[j]] = [this.rows[j], this.rows[i]];
    this.at = j; this.refill(); cx.notify();
  }

  problem() { return stepsProblem(this.rows.map((r) => ({ action: r.action, sha: r.sha }))); }
  ready() { return !this.problem() && (!this.p.pushed || this.pushedOk) && this.rows.some((r, k) => r.action !== "pick" || this.p.rows[k].sha !== r.sha); }

  start() {
    if (!this.ready() || this.done) return;
    const asked = this.asked(), messages = {};
    for (const sha of asked) messages[sha] = this.boxes.get(sha).value();
    this.done = true;
    answer(this.p.id, { rows: this.rows.map((r) => ({ sha: r.sha, action: r.action })), messages });
    closeOverlay(props().overlay);
  }
  gone() { if (!this.done) { this.done = true; answer(this.p.id, null); } }
  cancel() { this.gone(); closeOverlay(props().overlay); }

  key(e, cx) {
    const m = e.modifiers ?? {};
    if (e.key === "escape") { this.cancel(); return true; }
    if ((e.key === "up" || e.key === "down") && m.alt) { this.move(this.at, e.key === "up" ? -1 : 1, cx); return true; }
    if (e.key === "up" || e.key === "k") { this.at = Math.max(0, this.at - 1); cx.notify(); return true; }
    if (e.key === "down" || e.key === "j") { this.at = Math.min(this.rows.length - 1, this.at + 1); cx.notify(); return true; }
    if (KEYS[e.key] && !m.platform && !m.control) { this.set(this.at, KEYS[e.key], cx); return true; }
    return false;
  }

  render() {
    const t = theme(), p = this.p, asked = this.asked(), problem = this.problem();
    const row = (r, i) => {
      const chosen = i === this.at, gone = r.action === "drop";
      return v_flex().id(`rebase-row-${i}`).flex_none().gap(4).px(8).py(5).rounded(7).bg(chosen ? t.selected : t.surface)
        .child(h_flex().gap(6).items_center()
          .child(button(t, `rebase-up-${i}`, "↑", (cx) => this.move(i, -1, cx), { small: true, busy: i === 0, tip: "Earlier (Alt+↑)" }))
          .child(button(t, `rebase-down-${i}`, "↓", (cx) => this.move(i, 1, cx), { small: true, busy: i === this.rows.length - 1, tip: "Later (Alt+↓)" }))
          .child(div().w(56).flex_none().text_size(11).text_color(t.muted).child(r.short))
          .child(div().id(`rebase-pick-row-${i}`).flex_1().min_w(0).truncate().text_size(12).text_color(gone ? t.muted : t.foreground).cursor_pointer().on_click((_e, cx) => { this.at = i; cx.notify(); })
            .when(gone, (e) => e.line_through()).child(r.subject || "(no message)"))
          .children(ACTIONS.map((a) => div().id(`rebase-${a}-${i}`).h(20).px(6).flex().flex_none().items_center().rounded(5).text_size(11).cursor_pointer()
            .bg(r.action === a ? t[COLORS[a]] : t.raised).text_color(r.action === a ? t.accent_foreground : t.muted).hover((s) => s.opacity(0.88))
            .tooltip(`${a[0].toUpperCase() + a.slice(1)} (${a[0]})`).on_click((_e, cx) => this.set(i, a, cx)).child(a))))
        .when(asked.has(r.sha), (e) => e.child(div().id(`rebase-message-${i}`).px(8).py(5).rounded(6).border_1().border_color(t.accent).bg(t.raised).cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Textarea.new(this.boxes.get(r.sha)).w_full().text_size(12).text_color(t.foreground))));
    };
    return v_flex().id("rebase-editor").track_focus(this.handle).size_full().min_h(0).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (this.key(e, cx)) cx.stop_propagation(); })
      .child(v_flex().flex_1().min_h(0).px(18).pt(16).pb(8).gap(8)
        .child(div().text_size(14.5).font_semibold().whitespace_normal().child(`Interactive rebase of ${p.branch} from ${p.from}`))
        .child(div().text_size(11.5).text_color(t.muted).whitespace_normal().child("Oldest first, as git applies them. Squash and fixup fold a commit into the one above it (squash joins the messages); drop leaves it out. Where git asks for a message, the box under the row is it."))
        .child(v_flex().id("rebase-rows").flex_1().min_h(0).overflow_y_scrollbar().gap(2).children(this.rows.map(row)))
        .when(Boolean(problem), (e) => e.child(div().text_size(11.5).text_color(readable(t, t.ansi1, t.popover)).whitespace_normal().child(problem)))
        .when(Boolean(p.pushed), (e) => e.child(h_flex().id("rebase-pushed").gap(8).items_center().cursor_pointer().on_click((_e, cx) => { this.pushedOk = !this.pushedOk; cx.notify(); })
          .child(div().size(14).flex_none().rounded(4).border_1().border_color(this.pushedOk ? t.accent : t.border).bg(this.pushedOk ? t.accent : t.surface))
          .child(div().text_size(11.5).text_color(readable(t, t.ansi1, t.popover)).whitespace_normal().child("Some of these are pushed: I know the branch then differs from the remote's (a push needs --force)")))))
      .child(h_flex().flex_none().px(14).py(10).gap(8).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1().text_size(10.5).text_color(t.muted).child("p r s f d set the action · Alt+↑/↓ moves · Esc closes"))
        .child(button(t, "rebase-cancel", "Cancel", () => this.cancel()))
        .child(button(t, "rebase-start", "Start rebase", () => this.start(), { kind: p.pushed ? "danger" : "primary", busy: !this.ready(), tip: problem ?? "git rebase -i with this list" })));
  }
}
