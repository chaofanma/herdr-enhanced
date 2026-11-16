// The settings window's Open with page: which programs the Files and Changes menus offer, in what
// order, and what double-click, Open ↗ and Open at a line use. `w` is the window (settingsview.js):
// its state (what detection found, the open drop-down, the form) and its savers.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { KEYS } from "./panelsettings.js";
import { itemsOf } from "./openwith.js";
import { GROUPS, rowsOf, choicesOf, statusOf, commandOf, menusOf, isOwn, tick, untick, move, removeOwn } from "./openlist.js";
import { joinCommand } from "./shellwords.js";
import { heading, note, row, button, link, iconButton, checkbox, dropdown, segmented, field, spinner } from "./controls.js";
import { readable } from "./ink.js";

const PICKER_ROWS = [
  ["double", "Double-click a file opens with", "Shift+Enter on a file too."],
  ["open", "Open \u2197 opens with", "The button over a file's preview."],
  ["line", "Open at a line with", "Search results and diff lines. One marked \u201copens without the line\u201d opens the file at its top."],
];

const STATUS = {
  found: ["found", "ansi2"],
  app: ["app found: opens without a line", "muted"],
  unchecked: ["a path: not looked for", "muted"],
  missing: ["not installed", "muted"],
};

export function openWithPage(w, t) {
  const settings = w.openWith(), items = itemsOf(settings.items);
  const page = v_flex().w_full();

  page.child(heading(t, "Opening files"));
  for (const [picker, title, about] of PICKER_ROWS) {
    const id = `ps-pick-${picker}`, open = w.open === id;
    page.child(row(t, title, about, dropdown(t, id, choicesOf(items, picker), settings[picker], open,
      (next, cx) => { w.open = next ? id : null; cx.notify(); },
      (value, cx) => { w.open = null; w.patch(KEYS.openWith, { [picker]: value }); cx.notify(); })));
  }
  page.child(note(t, "Each offers the system's default and the ticked programs below that open files."));

  page.child(heading(t, "In the menus"));
  page.child(detection(w, t));
  page.child(note(t, "The ticked programs are in the Files and Changes menus, in this order: \u2191 \u2193 move one. A program that isn't installed can be ticked too: it shows once it is."));
  if (w.found) {
    const now = menusOf(items, w.found), list = (names) => (names.length ? names.join(", ") : "nothing");
    page.child(note(t, `Now a file offers ${list(now.files)}; a folder ${list(now.folders)}.`));
  }
  for (const group of GROUPS) {
    page.child(div().pt(12).pb(2).text_size(12).font_medium().text_color(t.muted).child(group.title));
    const rows = rowsOf(items, group.id);
    for (const r of rows) page.child(programRow(w, t, items, r));
    if (group.id === "own") {
      if (!rows.length && !w.form) page.child(note(t, "Programs you add yourself: an editor, a viewer, a script."));
      page.child(w.form ? ownForm(w, t) : h_flex().pt(8).child(button(t, "ps-own-add", "Add your own\u2026", (_e, cx) => w.openForm(null, cx))));
    }
  }
  return page;
}

// Looking for programs: a spinner while it runs, then a line with Check again.
export function detection(w, t) {
  const line = h_flex().py(4).gap(6).items_center().text_size(11.5).text_color(t.muted);
  if (w.detecting) return line.child(spinner(t)).child(div().child("Looking for programs on this computer\u2026"));
  if (w.detectError) return line.child(div().min_w(0).truncate().text_color(readable(t, t.blocked, t.popover)).child(`Couldn't look for programs: ${w.detectError}`)).child(link(t, "ps-detect", "Check again", (_e, cx) => w.detect(cx)));
  if (!w.found) return line.child(link(t, "ps-detect", "Look for programs", (_e, cx) => w.detect(cx)));
  return line.child(div().child("Looked for them on this computer.")).child(link(t, "ps-detect", "Check again", (_e, cx) => w.detect(cx)));
}

// One program: its box, its name, what's on this computer, the command it runs; ↑ ↓ when ticked;
// Edit and Remove for the person's own.
function programRow(w, t, items, r) {
  const { item, ticked } = r, id = `ps-p-${item.id}`;
  const found = statusOf(item, w.found), status = STATUS[found];
  const toggleIt = (_e, cx) => { w.saveList(ticked ? untick(items, item.id) : tick(items, item.id)); cx.notify(); };
  const runs = commandOf(item, w.found);
  const tip = item.argvLine ? `${runs}\nat a line: ${joinCommand(item.argvLine)}` : runs;
  return h_flex().w_full().h(28).gap(8).items_center().border_b(1).border_color(t.border)
    .child(div().w(140).flex_none().min_w(0).child(checkbox(t, `${id}-tick`, ticked, item.name, toggleIt)))
    .child(div().w(180).flex_none().min_w(0).truncate().text_size(11).text_color(status ? readable(t, t[status[1]], t.popover) : t.muted).child(status?.[0] ?? ""))
    .child(div().id(`${id}-cmd`).flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).tooltip(tip).child(runs))
    .child(h_flex().flex_none().gap(2).items_center()
      .when(ticked, (el) => el
        .child(iconButton(t, `${id}-up`, "\u2191", `Move ${item.name} up`, () => w.saveList(move(items, item.id, -1)), { disabled: r.first }))
        .child(iconButton(t, `${id}-down`, "\u2193", `Move ${item.name} down`, () => w.saveList(move(items, item.id, 1)), { disabled: r.last })))
      .when(isOwn(item), (el) => el
        .child(link(t, `${id}-edit`, "Edit", (_e, cx) => w.openForm(item, cx)))
        .child(div().w(6))
        .child(link(t, `${id}-remove`, "Remove", (_e, cx) => { if (w.form?.id === item.id) w.form = null; w.saveList(removeOwn(items, item.id)); cx.notify(); }))));
}

// The form for a program of the person's own, new (w.form.id null) or one to change.
function ownForm(w, t) {
  const f = w.form, label = (text) => div().w(84).flex_none().text_size(12).text_color(t.muted).child(text);
  const line = (name, control, after) => h_flex().gap(8).items_center().child(label(name)).child(control)
    .when(Boolean(after), (el) => el.child(div().text_size(11.5).text_color(t.muted).child(after)));
  return v_flex().mt(8).p(12).gap(8).rounded(8).border_1().border_color(t.border).bg(t.surface)
    .child(div().text_size(12.5).font_medium().child(f.id ? `Change ${f.name}` : "Add a program"))
    .child(line("Name", field(t, w.formName, w.focusOn === "formName", { w: 220 })))
    .child(line("Command", field(t, w.formCommand, w.focusOn === "formCommand", { w: 380 })))
    .child(line("With a line", field(t, w.formLine, w.focusOn === "formLine", { w: 380 }), "optional"))
    .child(line("For", segmented(t, "ps-form-for", [["files", "Files"], ["folders", "Folders"], ["both", "Both"]], f.for, (v, cx) => { f.for = v; f.error = null; cx.notify(); })))
    .child(line("How", segmented(t, "ps-form-kind", [["app", "Open as an app"], ["pane", "Run in a pane"]], f.kind, (v, cx) => { f.kind = v; f.error = null; cx.notify(); })))
    // An app runs here: for a file on another machine it needs a command that reaches it over ssh.
    .when(f.kind === "app", (el) => el.child(v_flex().id("ps-form-remote").gap(4)
      .child(div().text_size(12).text_color(t.muted).child("Command for a file on another machine (over ssh)"))
      .child(h_flex().gap(8).items_center().child(div().w(84).flex_none())
        .child(field(t, w.formRemote, w.focusOn === "formRemote", { w: 380 }))
        .child(div().text_size(11.5).text_color(t.muted).child("optional")))
      .child(note(t, "{host} is the machine's ssh target; {path} {file} {folder} {line} are on that machine. Empty: it isn't offered in spaces on other machines. A pane program runs there by itself."))))
    .child(note(t, "In a command: {path} the file or folder, {file} the file, {folder} its folder, {line} the line. Quote words with spaces: 'My App'. An app runs and leaves; a pane program runs right of your pane, in the folder."))
    .child(h_flex().gap(8).items_center()
      .child(button(t, "ps-form-save", f.id ? "Save" : "Add", (_e, cx) => w.submitForm(cx), { primary: true }))
      .child(button(t, "ps-form-cancel", "Cancel", (_e, cx) => w.closeForm(cx)))
      .when(Boolean(f.error), (el) => el.child(div().min_w(0).truncate().text_size(11.5).text_color(readable(t, t.blocked, t.popover)).child(f.error))));
}
