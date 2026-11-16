// Based on Herdr's shipped prompt and confirm mods (Apache-2.0); changed: the Files panel's dialogs, a
// dialog copy of this mod with props { role: "dialog", action, root, on, rel, dir, items?, caps? }.
// Herdr's prompt asks for a name: New file / New folder (in the folder rel; "a/b.txt" makes the folder a
// too), Rename (rel; the name picked without its extension), Compress (the items into a .zip in the
// folder holding them). Herdr's confirm asks before Delete (rel, or `items` for several: one dialog;
// each to the Trash where the machine has one; the ones that fail stay listed with why). Enter does it,
// Esc cancels.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme } from "herdr";
import { fullOf, parentOf, nameOf } from "./paths.js";
import { makeEntry, renameEntry, trashEntry, compress, listFolder, platform, capsOf } from "./machine.js";
import { announce } from "./signal.js";
import { archiveName } from "./names.js";
import { commonFolder } from "./selection.js";
import { folderName } from "./pins.js";
import { readable } from "./ink.js";

const TITLES = { newfile: "New file", newfolder: "New folder", rename: "Rename", compress: "Compress" };
const DOING = { newfile: "Create", newfolder: "Create", rename: "Rename", compress: "Compress" };
export const SHOWN = 8; // names a dialog lists before "and N more"
const said = e => (e instanceof Error ? e.message : String(e));

// The dialog's height for an action (a list of items makes Delete taller).
export function dialogHeight(action, items) {
  const n = items?.length ?? 0;
  if (action === "delete") return 184 + (n > 1 ? Math.min(n, SHOWN) * 17 + (n > SHOWN ? 17 : 0) : 0);
  return 200;
}

// What Delete does there, in the dialog's words.
function deleting(p) {
  if (!p.on) return platform() === "windows" ? "Move to the Recycle Bin" : "Move to the Trash";
  return (p.caps ?? capsOf(p.on)).trash ? `Move to the Trash on ${p.on}` : "Permanently delete";
}

// A name typed for a new file or folder: its parts, without empty ones ("a//b/" is "a/b").
const typedPath = name => name.split(/[\\/]+/).filter(Boolean).join("/");

// Herdr's prompt's and confirm's buttons; `color`: the primary one's (Delete's is `ansi1`: the theme's
// `blocked` doesn't carry white text in every theme, win98's pure red for one).
function buttonFor(t, color, busy) {
  return (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
    .border_1().border_color(primary ? color : t.input).bg(primary ? color : t.raised)
    .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
    .when(primary && busy, el => el.opacity(0.7))
    .hover(s => s.opacity(0.88)).on_click(action).child(text);
}

// The prompt: a name for New file, New folder, Rename or Compress.
class NamePrompt {
  constructor(view, cx) {
    const p = props();
    this.view = view;
    this.items = p.items?.length ? p.items : [{ rel: p.rel, dir: p.dir }];
    this.text = p.action === "rename" ? nameOf(p.rel) : "";
    this.input = InputState.new({ value: this.text });
    // Rename picks the stem (Windows Explorer's way); a folder or a dotfile, the whole name.
    const dot = this.text.lastIndexOf(".");
    if (this.text) this.input.set_selected_range({ start: 0, end: p.dir || dot <= 0 ? this.text.length : dot });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = null; cx.notify(); });
    // Enter in the field does what the action's button does.
    this.input.on("submit", (_event, cx) => { this.submit(cx); });
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    if (p.action === "compress") this.nameArchive(cx);
  }

  // Compress: the archive's name, free in the folder it goes to (names.js archiveName), its stem picked.
  nameArchive(cx) {
    const p = props(), into = this.into();
    cx.spawn(async cx => {
      const there = await listFolder(p.on, fullOf(p.root, into)).catch(() => []), taken = new Set(there.map(e => e.name));
      if (this.input.value()) return;
      const name = archiveName(this.items.map(x => nameOf(x.rel)), n => taken.has(n));
      this.input.set_value(name);
      this.input.set_selected_range({ start: 0, end: name.length - 4 });
      cx.notify();
    });
  }

  // Where Compress puts the archive: the folder holding every item.
  into() { return this.items.length === 1 ? parentOf(this.items[0].rel) : commonFolder(this.items.map(x => x.rel)); }

  submit(cx) {
    const typed = this.input.value().trim();
    if (this.working || ["", ".", ".."].includes(typed)) return;
    const p = props(), name = typed;
    if (p.action !== "newfile" && p.action !== "newfolder" && /[\\/]/.test(name)) { this.error = "A name can't contain / or \\"; return cx.notify(); }
    if (p.action === "rename" && name === nameOf(p.rel)) return closeOverlay(p.overlay);
    this.working = true;
    cx.notify();
    cx.spawn(async cx => {
      const made = await this.make(p, name).catch(e => { this.error = said(e); return undefined; });
      this.working = false;
      if (made !== undefined) { announce({ on: p.on, select: made }); closeOverlay(p.overlay); }
      cx.notify();
    });
  }

  // Makes it; resolves the full path to select afterwards.
  async make(p, name) {
    const at = rel => fullOf(p.root, rel);
    if (p.action === "rename") {
      await renameEntry(p.on, at(p.rel), name);
      return at(parentOf(p.rel) ? `${parentOf(p.rel)}/${name}` : name);
    }
    if (p.action === "compress") {
      const into = this.into(), zip = name.toLowerCase().endsWith(".zip") ? name : `${name}.zip`;
      await compress(p.on, at(into), this.items.map(x => (into ? x.rel.slice(into.length + 1) : x.rel)), zip);
      return at(into ? `${into}/${zip}` : zip);
    }
    const typed = typedPath(name), rel = p.rel ? `${p.rel}/${typed}` : typed;
    await makeEntry(p.on, at(rel), p.action === "newfolder");
    return at(rel);
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const button = buttonFor(t, t.solid, this.working), many = this.items.length > 1, one = this.items[0];
    const where = p.action === "compress" ? `${many ? `${this.items.length} items` : nameOf(one.rel)} into a .zip in ${this.into() || folderName(p.root)}`
      : p.action === "rename" ? `${nameOf(p.rel)}, in ${parentOf(p.rel) || folderName(p.root)}` : `In ${p.rel || folderName(p.root)} · a name with / makes its folders too`;
    const label = text => div().pt(16).pb(7).text_size(11.5).text_color(t.muted).child(text);
    return v_flex().id("fm-ask").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(TITLES[p.action] ?? ""))
        .child(div().text_size(11).text_color(t.muted).child("Esc")))
      .child(label(where))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.inputFocused ? t.accent : t.input).bg(t.surface).text_size(12.8).text_color(t.foreground))
      .child(div().h(18).pt(4).text_size(11.5).text_color(readable(t, t.blocked, t.popover)).truncate().child(this.error ?? ""))
      .child(h_flex().pt(2).gap(8).justify_end()
        .child(button("fm-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("fm-ok", DOING[p.action] ?? "OK", true, (_e, cx) => this.submit(cx))));
  }
}

// The confirm: Delete, for one row or several.
class DeleteConfirm {
  constructor(view, cx) {
    const p = props();
    this.view = view;
    // What's still to do: every item at first; after a Delete that failed for some, those.
    this.left = p.items?.length ? p.items : [{ rel: p.rel, dir: p.dir }];
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  yes(cx) {
    if (this.working) return;
    const p = props();
    this.working = true;
    cx.notify();
    cx.spawn(async cx => {
      // One by one, so one that can't go doesn't keep the others; those stay listed with why.
      const failed = [];
      for (const x of this.left) await trashEntry(p.on, fullOf(p.root, x.rel)).catch(e => failed.push({ item: x, why: said(e) }));
      this.working = false;
      announce({ on: p.on });
      if (failed.length) {
        const went = this.left.length - failed.length;
        this.left = failed.map(f => f.item);
        this.error = failed.length > 1 || went ? `${failed.length} couldn't be deleted: ${failed[0].why}` : failed[0].why;
      } else closeOverlay(p.overlay);
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const button = buttonFor(t, t.ansi1, this.working), many = this.left.length > 1, one = this.left[0];
    const folders = this.left.some(x => x.dir) ? " (folders with everything in them)" : "";
    const detail = many ? `${deleting(p)} these ${this.left.length} items${folders}?` : `${deleting(p)}: ${one.rel}${one.dir ? " and everything in it" : ""}?`;
    const names = many ? this.left.slice(0, SHOWN).map(x => (x.dir ? `${x.rel}/` : x.rel)) : [];
    return v_flex()
      .id("fm-ask")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "enter") this.yes(cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
      })
      .size_full()
      .min_h(0)
      .p(18)
      .gap(12)
      .bg(t.popover)
      .text_size(13)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(many ? `Delete ${this.left.length} items` : "Delete")).child(div().text_size(11).text_color(t.muted).child("Esc")))
      .child(v_flex().id("fm-ask-list").flex_1().min_h(0).overflow_y_scrollbar().gap(1).text_color(t.muted)
        .child(div().pb(4).child(detail))
        .children(names.map(n => div().h(16).text_size(12).text_color(t.foreground).truncate().child(n)))
        .when(this.left.length > SHOWN, el => el.child(div().h(16).text_size(12).text_color(t.muted).child(`and ${this.left.length - SHOWN} more`))))
      .child(div().h(32).text_size(11.5).text_color(readable(t, t.blocked, t.popover)).overflow_hidden().child(this.error ?? ""))
      .child(h_flex().justify_end().gap(8).text_size(12)
        .child(button("fm-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("fm-ok", "Delete", true, (_e, cx) => this.yes(cx))));
  }
}

// The dialog copy: the confirm for Delete, the prompt otherwise.
export class Dialog {
  constructor(view, cx) {
    this.part = props()?.action === "delete" ? new DeleteConfirm(view, cx) : new NamePrompt(view, cx);
  }

  render(cx) {
    const shown = this.part;
    return shown.render(cx);
  }
}
