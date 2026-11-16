// Asking the space's agent: a dialog (a copy of the mod that opens it, props { role: "send", send:
// { title, context, sentKey } }; openSend) saying who it goes to, with a note to add and the
// context (a review, the lines asked about, a whole diff, the files and folders asked about). Send
// pastes the note and the context into the agent's terminal as one message (`hc send`, forced for
// an agent that is busy, after asking once) and brings the agent up. A space with no agent starts
// the settings' one (herdr-enhanced.agents: pi unless changed) with the text as its first message.
// Each mod opens its own copy, so either one asks without the other installed. Key commands
// (keys.json): `<mod>.send` and `<mod>.close`. Shared: the same file in both mods (shared/,
// tools/copy-shared.mjs).
import { h_flex, v_flex, TextareaState, Textarea, Popover } from "gpui-base";
import { div } from "gpui-kit";
import { chevron } from "./iconbutton.js";
import { agents, focused, hc, run, notify, props, closeOverlay, openOverlay, theme, nextCommand, setShared, shared, settings } from "herdr";
import { KEYS, settingsOf } from "./panelsettings.js";
import { startCommand } from "./fields.js";
import { ID } from "./id.js";
import { readable } from "./ink.js";

/** The shared key a sent review's drafts key goes to (`{ key, at }`), so the copies holding those
 *  drafts let them go: "<mod>.sent". */
export const SENT = `${ID}.sent`;

/** Opens the dialog as a copy of this mod: `title` (what is asked about), `context` (the text that
 *  goes with the note), `sentKey` (a review's drafts key: they go once it is sent); `compact` for a
 *  context of a few short lines (paths). */
export function openSend({ title, context = "", sentKey = null, compact = false }) {
  const [width, height] = !context ? [560, 250] : compact ? [560, 340] : [680, 560];
  return openOverlay({ mod: ID, kind: "dialog", modal: true, width, height, props: { role: "send", send: { title, context, sentKey } } });
}

/** Which agent a message goes to: the one picked, else the focused one, else an idle one, else the
 *  first. `list`: the space's agents. */
export function targetOf(list, picked) {
  return list.find((a) => a.address === picked) ?? list.find((a) => a.focused) ?? list.find((a) => a.status === "idle") ?? list[0] ?? null;
}

/** What is pasted: the note, a blank line, the context (either may be empty). */
export const messageOf = (note, context) => [String(note ?? "").trim(), context].filter(Boolean).join("\n\n");

const LARGE = 8 * 1024;
// The context's font: the terminals' (settings), else Herdr's own.
const monoFont = () => { const s = settings() ?? {}, f = s.font_family ?? s.font; return typeof f === "string" && f ? f : "JetBrains Mono"; };

export class SendDialog {
  // Made in the view's init (text states and focus handles can't be made in a render).
  constructor(cx) {
    Object.assign(this, { p: props()?.send ?? {}, picked: null, choosing: false, confirm: false, inFlight: false, error: null, handle: cx.focus_handle() });
    this.note = TextareaState.new({ placeholder: "A note for the agent (optional) · ⌘↩ sends", rows: 3 });
    this.note.set_auto_grow(2, 6);
    this.note.on("submit", (e, cx) => { if (e?.secondary) this.send(cx); });
    this.note.focus();
    cx.timer.after(100, () => this.note.focus());
    // The key commands `<mod>.send` and `<mod>.close` (keys.json).
    cx.spawn(async (cx) => {
      for (;;) {
        const asked = await nextCommand();
        if (asked === "send") this.send(cx);
        else if (asked === "close") this.shut();
        cx.notify();
      }
    });
  }

  shut() { const id = props()?.overlay; if (id) closeOverlay(id); }
  space() { return focused()?.space ?? null; }
  list() { const s = this.space(); return agents().filter((a) => a.space === s); }
  target() { return targetOf(this.list(), this.picked); }
  starter() { return settingsOf(KEYS.agents, shared(KEYS.agents)); }

  send(cx) {
    if (this.inFlight) return;
    const a = this.target(), text = messageOf(this.note.value(), this.p.context);
    if (!text) { this.error = "Nothing to send yet: write a note"; cx.notify(); return; }
    if (!a) {
      const s = this.starter();
      run(...startCommand(s, text, this.space()));
      notify({ title: `Started ${s.name} with your question`, level: "success", timeout: 3000 });
      this.sent();
      this.shut();
      return;
    }
    const busy = a.status === "working" || a.status === "blocked";
    if (busy && !this.confirm) return this.warnBusy(cx);
    this.inFlight = true; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      const r = await hc(["send", ...(busy ? ["--force"] : []), a.address, text]).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
      this.inFlight = false;
      if (r.code !== 0) { this.error = `Couldn't send it: ${(r.stderr || r.stdout || "").trim().split("\n")[0] || `hc send failed (${r.code})`}`; cx.notify(); return; }
      this.sent();
      run("agent.focus", { terminal: a.address });
      notify({ title: `Sent to ${a.program?.name ?? a.app ?? "the agent"}`, body: this.p.title, level: "success", timeout: 3000 });
      this.shut();
    });
  }

  // A busy agent: the first press only warns (the button reads "Send anyway"); the next one sends.
  warnBusy(cx) { this.confirm = true; cx.notify(); }

  // A sent review: its drafts go (every copy showing them hears it).
  sent() { if (this.p.sentKey) setShared(SENT, { key: this.p.sentKey, at: Date.now() }); }

  dotColor(t, status) { return t[status] ?? t.unknown ?? t.muted; }

  picker(t, list, a) {
    const row = (x, i) => h_flex().id(`send-agent-${i}`).h(30).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
      .when(x.address === a?.address, (e) => e.bg(t.selected))
      .on_click((_e, cx) => { this.picked = x.address; this.confirm = false; this.choosing = false; cx.notify(); })
      .child(div().size(8).rounded(4).bg(this.dotColor(t, x.status)))
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(`${x.program?.name ?? x.app ?? "agent"} · ${x.tab_name || x.title || x.address}`))
      .child(div().text_size(10.5).text_color(t.muted).child(x.status));
    const box = h_flex().id("send-to").h(28).px(8).gap(8).items_center().rounded(7).border_1().border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover))
      .child(div().size(8).rounded(4).bg(a ? this.dotColor(t, a.status) : t.muted))
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(a ? `${a.program?.name ?? a.app ?? "agent"} · ${a.tab_name || a.title || a.address} (${a.status})` : `No agent here: Send starts ${this.starter().name}`))
      .when(list.length > 1, (e) => e.child(chevron(t.muted)));
    if (list.length < 2) return box;
    return Popover.new("send-agents").open(this.choosing).on_open_change((open, cx) => { this.choosing = open; cx.notify(); }).trigger(box)
      .content(v_flex().mt(4).w(420).p(5).gap(1).rounded(8).border_1().border_color(t.border).bg(t.popover).shadow_lg().children(list.map(row)));
  }

  render() {
    const t = theme(), p = this.p, list = this.list(), a = this.target(), context = p.context ?? "";
    const button = (id, label, kind, onClick, off = false) => div().id(id).h(30).px(14).flex().items_center().rounded(8).text_size(12).font_medium()
      .bg(kind === "primary" ? t.solid : t.raised).text_color(kind === "primary" ? t.solid_foreground : t.foreground)
      .when(off, (e) => e.opacity(0.7)).when(!off, (e) => e.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => onClick(cx))).child(label);
    const label = this.inFlight ? "Sending…" : !a ? `Start ${this.starter().name}` : this.confirm ? "Send anyway" : "Send";
    return v_flex().id("send").track_focus(this.handle).size_full().min_h(0).p(16).gap(10).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .on_key_down((e, cx) => {
        const sendKey = e.key === "enter" && Boolean(e.modifiers?.platform || e.modifiers?.control);
        if (e.key !== "escape" && !sendKey) return;
        if (sendKey) this.send(cx); else this.shut();
        cx.stop_propagation();
      })
      .child(v_flex().gap(2).child(div().text_size(11).text_color(t.muted).child("Ask the agent")).child(div().text_size(14.5).font_semibold().truncate().child(p.title ?? "")))
      .child(h_flex().gap(8).items_center().child(div().w(24).text_size(11.5).text_color(t.muted).child("To")).child(div().flex_1().min_w(0).child(this.picker(t, list, a))))
      .child(div().id("send-note").w_full().px(8).py(6).rounded(7).border_1().border_color(t.accent).bg(t.surface).cursor_text()
        .child(Textarea.new(this.note).w_full().text_size(12.5).text_color(t.foreground)))
      .when(Boolean(context), (e) => e
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().text_size(11).text_color(t.muted).child(`Goes with it (${Math.ceil(context.length / 1024)} KB)`))
          .child(div().id("send-copy").px(6).py(2).rounded(5).text_size(11).text_color(t.accent).cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => { cx.write_to_clipboard(context); notify({ title: "Copied", level: "success", timeout: 1500 }); }).child("Copy")))
        .child(div().id("send-context").flex_1().min_h(0).overflow_scroll().px(10).py(8).rounded(7).bg(t.raised).font_family(monoFont()).text_size(11).text_color(t.muted)
          .children(context.split("\n").map((l) => div().whitespace_nowrap().child(l || " "))))
        .when(context.length > LARGE, (e) => e.child(div().text_size(11).text_color(readable(t, t.blocked, t.popover)).child(`This is ${Math.ceil(context.length / 1024)} KB: some agents cut a long paste short.`))))
      .when(!context, (e) => e.child(div().flex_1()))
      .when(Boolean(this.confirm && a), (e) => e.child(div().text_size(11.5).text_color(readable(t, t.blocked, t.popover)).whitespace_normal().child(`${a.program?.name ?? "The agent"} is ${a.status}: what you send is typed into it now. Send anyway?`)))
      .when(Boolean(this.error), (e) => e.child(div().text_size(11.5).text_color(readable(t, t.ansi1, t.popover)).whitespace_normal().child(this.error)))
      .when(!a, (e) => e.child(div().text_size(11.5).text_color(t.muted).whitespace_normal()
        .child(`No agent is running in this space. Send starts ${this.starter().name} ${this.starter().where === "right" ? "right of the focused pane" : "in a new tab"} with this as its first message.`)))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(10.5).text_color(t.muted).child("Esc closes · ⌘↩ sends"))
        .child(button("send-cancel", "Cancel", "plain", () => this.shut()))
        .child(button("send-go", label, "primary", (cx) => this.send(cx), this.inFlight)));
  }
}
