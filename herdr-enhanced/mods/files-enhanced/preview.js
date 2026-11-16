// Based on Herdr's shipped Files mod (Apache-2.0); changed: its read-only preview, which grew Markdown,
// images, editing and breadcrumbs. A file of the tree's root, here or on the space's machine: text in a
// code view, Markdown rendered (or its source), an image drawn from a copy in the app's cache. Edit
// turns the code view writable; ⌘S or Save writes it only if the file still holds what was loaded
// (machine.js writeText: Herdr's writeTextFile here, a checked base64 save there), else "Changed on
// disk" offers Reload or Overwrite.
import { div, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { theme, settings } from "herdr";
import { Buffer } from "buffer";
import { fullOf } from "./paths.js";
import { readText, writeText, imageFor, capsOf } from "./machine.js";
import { announce } from "./signal.js";
import { editLine } from "./editline.js";
import { prefs } from "./place.js";
import { readable } from "./ink.js";
import { iconButton, CLOSE } from "./iconbutton.js";

// Characters a preview shows (and an edit takes).
export const LIMIT = 400000;

// The editor's language for a file: Herdr's Files mod's map (to the grammars its editor has) and a few
// more of ours; otherwise the extension itself.
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html",
  cjs: "js", json5: "json", astro: "html", mdx: "md", markdown: "md", zsh: "sh", bash: "sh", ksh: "sh" };
const BY_NAME = { makefile: "makefile", gnumakefile: "makefile", ".bashrc": "sh", ".bash_profile": "sh", ".zshrc": "sh", ".zprofile": "sh", ".profile": "sh" };
export function language(rel) {
  const name = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(BY_NAME, name)) return BY_NAME[name];
  const ext = extension(rel);
  return LANG[ext] || ext || "txt";
}
export const extension = rel => { const name = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase(), dot = name.lastIndexOf("."); return dot > 0 ? name.slice(dot + 1) : ""; };
const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"]), MARKDOWN = new Set(["md", "markdown", "mdx"]);
const cut = text => (text.length > LIMIT ? text.slice(0, LIMIT) + "\n… (file truncated)" : text);
const message = e => String(e?.message ?? e);

// The code view's colors: Herdr's Files mod's, and booleans like constants; each where it reads on
// the surface (else the foreground; comments are hints, `dim` or else `muted`).
const syntaxOf = (t) => {
  const ink = (c) => readable(t, c);
  return { keyword: ink(t.ansi5), string: ink(t.ansi2), comment: readable(t, [t.dim, t.muted], t.surface, 3), function: ink(t.ansi4), type: ink(t.ansi3), number: ink(t.ansi1), constant: ink(t.ansi6), boolean: ink(t.ansi6) };
};

export class Preview {
  constructor(tree) {
    this.tree = tree;
    this.file = null; this.code = null; this.text = null; this.image = null; this.error = null; this.edit = null;
    this.source = prefs().markdown === "source";
  }

  // Herdr's Files mod's show(): `rel` read into a read-only code view (null: nothing shown).
  show(rel, cx) {
    this.code?.release();
    this.code = null; this.file = rel; this.error = null; this.text = null; this.image = null; this.edit = null;
    // A Markdown file opens the way settings.markdown says (Rendered / Source switches it until the next).
    this.source = prefs().markdown === "source";
    if (!rel || !cx) return;
    const tree = this.tree, context = tree.context, on = tree.on, full = fullOf(tree.root, rel), here = !on;
    cx.spawn(async cx => {
      try {
        if (IMAGES.has(extension(rel))) {
          const shown = await imageFor(on, full).catch(e => ({ error: message(e) }));
          if (this.file !== rel || !tree.current(context)) return;
          if (typeof shown === "string") this.image = shown; else this.error = shown.error;
          return;
        }
        const text = await readText(on, full);
        if (this.file !== rel || !tree.current(context)) return;
        if (text === null) { this.error = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.error = here ? "Binary file · no text preview (Open ↗ shows it)" : "Binary file · no text preview"; return; }
        this.text = text;
        this.code = this.editor(cut(text), true);
      } catch {
        if (this.file === rel && tree.current(context)) this.error = "Cannot preview this file (binary, too large, or unreadable)";
      } finally { cx.notify(); }
    });
  }

  editor(value, readonly) {
    this.wrapped = prefs().wrap;
    const syntax = syntaxOf(theme());
    this.colors = JSON.stringify(syntax);
    return EditorState.new({ language: language(this.file), readonly, value, font_family: settings().font_family, font_size: 12, soft_wrap: this.wrapped, syntax });
  }

  // settings.wrap or the theme changed: the code view again, wrapped as the settings say and in the
  // theme's colors, after the render that noticed (a new EditorState can't be made while rendering).
  // Wrapping waits until an edit ends; an edit gets the theme's colors at once, its text kept.
  rewrap(cx) {
    if (!this.code || this.rewrapping) return;
    const colors = this.colors !== JSON.stringify(syntaxOf(theme()));
    if (!colors && (this.edit || this.wrapped === prefs().wrap)) return;
    const code = this.code;
    this.rewrapping = true;
    cx.spawn(async cx => {
      await cx.sleep(0);
      this.rewrapping = false;
      if (this.code !== code || this.text == null) return;
      if (this.edit) { this.editing(this.edit, code.value()); cx.notify(); return; }
      this.code.release();
      this.code = this.editor(cut(this.text), true);
      cx.notify();
    });
  }

  // A file the person picked (a click, the keys, search): previewed, unless unsaved edits hold the
  // preview. Answers whether it went.
  look(rel, cx) {
    if (this.edit && rel === this.file) return true;
    if (!this.leave(cx)) return false;
    this.show(rel, cx);
    return true;
  }

  // With unsaved edits, the first try to leave them (another file, Esc, ✕, Done) only warns.
  leave(cx) {
    const e = this.edit;
    if (!e?.dirty || e.warn) return true;
    e.warn = true; cx.notify();
    return false;
  }

  // Why the file can't be edited, or null: text not cut short, and a machine that can take the save.
  // While what the machine has isn't known (its probe out, or failed: it is asked again here), the
  // file can be edited; the save finds out (machine.js writeText).
  readOnly() {
    if (this.text == null) return "";
    if (this.text.length > LIMIT) return "Too long to edit here";
    const on = this.tree.on, caps = capsOf(on);
    if (!caps.known) { this.tree.relearn?.(); return null; }
    if (!caps.write) return on ? `Saving on ${on} needs base64 or openssl there` : "";
    if (on && Buffer.from(this.text, "utf8").length > caps.writeMax) return `Too big to save on ${on} through Herdr`;
    return null;
  }
  canEdit() { return this.readOnly() === null; }

  // Edit: the code view turns writable. The tree stays on this folder until editing ends.
  startEdit(cx) {
    if (this.edit || !this.canEdit()) return;
    this.editing(this.edit = { original: this.text, dirty: false }, this.text);
    cx.notify();
  }

  // Edit e's writable view of `text`, in place of the code view.
  editing(e, text) {
    const state = this.editor(text, false);
    this.code?.release(); this.code = state;
    state.on("change", (_ev, cx) => {
      if (this.edit !== e || this.code !== state) return;
      const dirty = state.value() !== e.original;
      if (dirty !== e.dirty || e.warn) { e.dirty = dirty; e.warn = false; cx.notify(); }
    });
    // The keys stay where they were (there's no way to give them to the editor): a hint shows until the
    // person clicks into the text (editLine).
    state.on("focus", (_ev, cx) => {
      if (this.edit !== e || this.code !== state || e.focused) return;
      e.focused = true; cx.notify();
    });
  }

  // Back to the read-only view, loaded again.
  stopEdit(cx) {
    if (!this.edit) return;
    this.show(this.file, cx);
    this.tree.h.focus(); cx.notify();
  }

  // ⌘S / Save: written only if the file still holds what was loaded (or last saved); otherwise it
  // changed on disk, and Reload or Overwrite decide. Overwrite writes over whatever is there now.
  save(cx, overwrite = false) {
    const e = this.edit, tree = this.tree;
    if (!e || e.busy || (!e.dirty && !overwrite)) return;
    const on = tree.on, full = fullOf(tree.root, this.file), text = this.code.value();
    Object.assign(e, { busy: true, error: null });
    cx.notify();
    cx.spawn(async cx => {
      try {
        await writeText(on, full, text, overwrite ? await readText(on, full) : e.original);
        if (this.edit !== e) return;
        e.original = text; e.dirty = this.code.value() !== text; e.conflict = false; e.warn = false; this.text = text;
        // The other copies show it again; this one has it.
        tree.tick = announce({ on, files: [full] });
      } catch (err) {
        if (this.edit !== e) return;
        const disk = await readText(on, full).catch(() => undefined);
        if (disk !== e.original) e.conflict = true; else e.error = message(err);
      } finally { if (this.edit === e) e.busy = false; cx.notify(); }
    });
  }

  // Changed on disk → Reload: my edits go, the file as it is now comes in (still editing if it can be).
  reload(cx) {
    const e = this.edit, rel = this.file, tree = this.tree;
    if (!e) return;
    cx.spawn(async cx => {
      const disk = await readText(tree.on, fullOf(tree.root, rel)).catch(() => null);
      if (this.edit !== e) return;
      if (disk == null || disk.length > LIMIT || disk.includes("\0")) { this.edit = null; this.show(rel, cx); return cx.notify(); }
      e.original = disk; e.dirty = false; e.conflict = false; e.warn = false; this.text = disk;
      this.code.set_value(disk);
      cx.notify();
    });
  }

  markdown() { return Boolean(this.file) && MARKDOWN.has(extension(this.file)); }

  // What the preview draws: an image, rendered Markdown (unless Source is picked or it's being edited),
  // the code, or why not.
  view(t) {
    if (this.image) return h_flex().id("fm-image").flex_1().min_h(0).p(12).justify_center().overflow_hidden().child(image(this.image).max_w_full().max_h_full());
    if (this.text != null && this.markdown() && !this.source && !this.edit) return div().id("fm-md").flex_1().min_h(0).overflow_y_scrollbar().px(14).py(10).text_size(13).text_color(t.foreground)
      .child(TextView.markdown(`fm-md-${this.file}`, this.text.length > LIMIT ? this.text.slice(0, LIMIT) + "\n\n… (file truncated)" : this.text).selectable(true));
    if (this.code) return Editor.new(this.code).flex_1().min_h(0);
    return div().flex_1().p(12).text_color(t.dim).child(this.error || "Loading file…");
  }

  // The bar's path as breadcrumbs: a folder in it shows that folder in the tree (its folders opened, it
  // selected; the tree has no way to scroll to it), the file's name last.
  crumbs(t) {
    const parts = this.file.split("/");
    return h_flex().id("fm-crumbs").flex_1().min_w(0).overflow_hidden().gap(3).items_center()
      .children(parts.flatMap((name, i) => {
        const rel = parts.slice(0, i + 1).join("/"), last = i === parts.length - 1;
        const part = last ? div().min_w(0).truncate().text_color(t.muted).child(name)
          : div().id(`fm-crumb-${rel}`).flex_none().cursor_pointer().text_color(t.dim).hover(s => s.text_color(t.foreground)).tooltip(`Show ${rel} in the tree`)
            .on_click((_e, cx) => this.tree.revealFolder(rel, cx)).child(name);
        return i ? [div().flex_none().text_color(t.dim).child("›"), part] : [part];
      }));
  }

  // The strip above the view: a thin line above and below, the path and the controls in 12px.
  bar(t) { return h_flex().flex_none().h(28).gap(8).px(12).items_center().text_size(12).border_color(t.border).border_t(1).border_b(1); }

  // The preview: its bar (path, ● for unsaved edits, Rendered / Source, Save, Edit / Done, Open ↗, ✕),
  // a line when an edit needs a word (unsaved, changed on disk, a failed save; before the first click
  // into the text, a hint), and the view. ⌘S saves and Esc ends editing while the editor has the keys.
  pane(t) {
    const e = this.edit, line = editLine(e), tree = this.tree, why = e ? null : this.readOnly();
    const link = (id, text, act, color = t.dim) => div().id(id).flex_none().cursor_pointer().text_color(color).hover(s => s.text_color(t.foreground)).on_click(act).child(text);
    return v_flex().id("fm-preview").flex_1().min_h(0)
      .on_key_down((ev, cx) => {
        if (!this.edit) return;
        if (ev.keystroke === "cmd-s") { cx.stop_propagation(); this.save(cx); }
        else if (ev.key === "escape") { cx.stop_propagation(); if (this.leave(cx)) this.stopEdit(cx); }
      })
      .child(this.bar(t)
        .child(this.crumbs(t))
        .when(Boolean(e?.dirty), el => el.child(div().flex_none().text_color(t.accent).child("●")))
        // Markdown: rendered, or its source in the code view.
        .when(this.markdown() && this.text != null && !e, el => el.child(h_flex().flex_none().p(1).gap(1).rounded(5).border_1().border_color(t.border).text_size(11)
          .children([["Rendered", false], ["Source", true]].map(([label, source]) => div().id(`fm-${label.toLowerCase()}`).px(6).h(18).flex().items_center().rounded(4).cursor_pointer()
            .text_color(this.source === source ? t.foreground : t.dim).when(this.source === source, el => el.bg(t.selected)).hover(s => s.text_color(t.foreground))
            .on_click((_e, cx) => { this.source = source; cx.notify(); }).child(label)))))
        .when(Boolean(e?.dirty), el => el.child(link("fm-save", e.busy ? "Saving…" : "Save", (_e, cx) => this.save(cx), t.accent)))
        .when(Boolean(e) || why === null, el => el.child(link("fm-edit", e ? "Done" : "Edit", (_e, cx) => {
          if (!this.edit) this.startEdit(cx); else if (this.leave(cx)) this.stopEdit(cx);
        })))
        .when(Boolean(why), el => el.child(div().id("fm-readonly").flex_none().text_color(t.dim).tooltip(why).child("Read-only")))
        .when(tree.canOpen("open"), el => el.child(link("files-open", "Open ↗", () => tree.launch(this.file, false, "open"))))
        .child(iconButton(t, "files-close", CLOSE, (cx) => { if (this.leave(cx)) this.show(null); cx.notify(); }, { tip: "Close the preview" })))
      .when(Boolean(line), el => el.child(h_flex().h(26).flex_none().px(12).gap(10).items_center().border_b(1).border_color(t.border).text_size(11.5)
        .child(div().flex_1().min_w(0).truncate().text_color(line.warn ? readable(t, t.blocked) : t.muted).child(line.text))
        .when(Boolean(e?.conflict), el => el
          .child(link("fm-reload", "Reload", (_e, cx) => this.reload(cx)))
          .child(link("fm-overwrite", "Overwrite", (_e, cx) => this.save(cx, true))))))
      .child(this.view(t));
  }
}
