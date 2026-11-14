// The panel's settings window: a copy of either mod opened with props { role: "settings", section? }
// (openSettingsWindow: a page's Settings…; toggleSettingsWindow: its gear, which closes the window
// when this mod's is open), one per Herdr window whichever mod opens it (its key, SETTINGS_WINDOW). Pages of the shared settings the panel's mods read (panelsettings.js):
// Open with and Agents, both mods', and this mod's own (Files or Changes: PART in id.js), never the
// other's; whether the other is installed (installed.js, looked at again when the window opens) only
// adds the line saying both use Open with and Agents. Every change is saved at once, a text field's
// a moment after the last key (and when it loses the keyboard), with setShared + storedOf, so only
// what differs from the defaults is kept. Not a View: the mod's view holds one and draws it, so each
// re-render of the view (a shared value changed, a cx.notify) draws it again; its close() is the
// view's (Herdr closed the window).
// Shared: the same file in both mods (shared/, tools/copy-shared.mjs).
import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, TextareaState, Scrollbar } from "gpui-base";
import { theme, shared, setShared, props, closeOverlay, openOverlay, exec, home, settings } from "herdr";
import { ID, PART } from "./id.js";
import { installed, checkInstalled } from "./installed.js";
import { KEYS, settingsOf, storedOf } from "./panelsettings.js";
import { KNOWN, itemsOf, cliOf, detectScript, foundOf } from "./openwith.js";
import { storedWith, blankDraft, draftOf, addOwn, editOwn } from "./openlist.js";
import { linesOf, listOf, nestText, nestOf, STEPS, stepped, canStep, minutes, AGENT_PRESETS, presetOf, customAgent, COMMIT_AGENTS, commitCommandOf, commitModelNote } from "./fields.js";
import { joinCommand } from "./shellwords.js";
import { ICON, NONE, own, heading, note, row, button, iconButton, toggle, segmented, stepper, field, textbox, dropdown } from "./controls.js";
import { openWithPage, detection } from "./openwithview.js";
import { readable } from "./ink.js";

// The mod's own first (a window shows one of Files and Git), then the two both mods use.
export const SECTIONS = [["files", "Files"], ["changes", "Git"], ["open-with", "Open with"], ["agents", "Agents"]];
const KEY_OF = { "open-with": KEYS.openWith, files: KEYS.files, changes: KEYS.changes, agents: KEYS.agents };
// The sections shown: Open with and Agents are both mods'; Files and Git each one mod's own, and
// a mod's window shows only its own.
export const shownSections = () => SECTIONS.filter(([id]) => id === "open-with" || id === "agents" || id === PART);
const OWN_TITLE = Object.fromEntries(SECTIONS)[PART];
const OTHER_MOD = PART === "files" ? "Git Enhanced" : "Files Enhanced";
/** The window's title: "Files settings" or "Git settings". */
export const SETTINGS_TITLE = `${OWN_TITLE} settings`;
/** The line over those two, when both mods are installed (either window's change is the other's too). */
export const BOTH_USE = "Files Enhanced and Git Enhanced both use these.";
/** What a Reset all asks about between its two presses (the other mod's line: both installed). */
export const resetAllWhat = (both) => `Reset all puts ${OWN_TITLE}, Open with and Agents back to their defaults.`
  + (both ? ` ${OTHER_MOD} uses Open with and Agents too: they change there as well.` : "");

// The window's key: opening it again, from either mod, replaces the open one in its place.
export const SETTINGS_WINDOW = "herdr-enhanced-settings";
// This mod's settings window while it's open: its overlay id, and the window's copy once it has
// started. Module state: every copy of a mod shares its module (one run per build), so a page's gear
// knows the window another copy of the mod opened. The window's copy sets it too when it starts (after
// a rebuild the module starts empty while the window stays) and clears it in close(), whenever Herdr
// closes it (✕, Esc, the other mod's window in its place, a layout switch). Nothing kept: after a
// restart no window is open.
const shown = { id: null, copy: null };

/** Opens the settings window (at `section`, else at this mod's own), as a copy of this mod: opened from
 *  the other mod, the one open is replaced by the other's. Its overlay id. */
export function openSettingsWindow(section = null) {
  const id = openOverlay({ mod: ID, kind: "window", key: SETTINGS_WINDOW, width: 640, height: 560, props: { role: "settings", ...(section ? { section } : {}) } });
  shown.id = id ?? null; shown.copy = null;
  return id;
}
/** Whether this mod's settings window is open (a page's gear: "Close settings"). */
export const settingsWindowOpen = () => Boolean(shown.id);
/** A page's gear: closes this mod's settings window when it's open, else opens it (at `section`). The
 *  overlay id it opened, else null. From a click. */
export function toggleSettingsWindow(section = null) {
  if (!shown.id) return openSettingsWindow(section);
  const id = shown.id;
  shown.id = null; shown.copy = null;
  closeOverlay(id);
  return null;
}
/** A page's gear, `id` naming its state (`<id>-open`, `<id>-close`: a tooltip changes only with the
 *  element's id): { id, tip, open }, `open` from its click. */
export function settingsGear(id, section) {
  const open = settingsWindowOpen();
  return { id: `${id}-${open ? "close" : "open"}`, tip: open ? "Close settings" : "Settings", open: (cx) => { toggleSettingsWindow(section); cx?.notify(); } };
}
/** Changes: the line under the commit section, and the one under "Your own command"'s field. */
export const PEN_SENDS = "The pen sends the diff, the staged and new file names, and recent commit subjects to the program you pick (and through it to its provider).";
export const COMMAND_NOTE = "{prompt} is replaced by the prompt (else it goes last); {model} by the model below.";
const SAVE_AFTER = 450;   // ms after the last key before a text field is saved
const ARMED_FOR = 3000;   // ms a Reset waits for its second press

export class SettingsWindow {
  // Made in the view's init (it makes text states and focus handles, which render can't).
  constructor(cx) {
    // The section asked for, else (none, or one this window doesn't show) this mod's own.
    const asked = props()?.section ?? null;
    this.section = shownSections().some(([id]) => id === asked) ? asked : PART;
    // This mod's window is open: the gears close it now.
    this.overlay = props()?.overlay ?? null;
    if (this.overlay) { shown.id = this.overlay; shown.copy = this; }
    this.found = null;        // what detection found: { cli, app } sets; null until it has run
    this.lookedFor = new Set(); // the commands it looked for
    this.detecting = false;
    this.detectError = null;
    this.open = null;         // the drop-down that is open, by id
    this.form = null;         // the form for a program of the person's own: { id (null: a new one), name, for, kind, error }
    this.armed = null;        // { what: "section" | "all", at } between a Reset's two presses
    this.focusOn = null;      // the text field that has the keyboard
    this.saves = {};          // text fields waiting to be saved: name -> { task, run }
    this.seen = {};           // each text field's last value, so a change event without a change is ignored
    this.nestError = null;
    this.agentError = null;
    this.commitError = null;  // Changes: why the typed commit command wasn't saved
    this.custom = false;      // Agents: "Your own" is chosen (before or after it differs from a preset)
    this.handle = cx.focus_handle();
    this.handle.focus();      // a window doesn't take the keyboard by itself; Esc closes this one
    // Again a moment later, as Herdr's prompt does: the window may not be up yet.
    cx.timer.after(300, () => { if (!this.focusOn) this.handle.focus(); });
    this.makeFields();
    this.sync(new Set());
    if (this.needsPrograms()) this.detect(cx);
    // Which mods are installed, looked at again: the line saying both use a page may come or go.
    cx.spawn(async (cx) => { if (await checkInstalled()) cx.notify(); });
  }

  // Settings now, as every mod reads them.
  openWith() { return settingsOf(KEYS.openWith, shared(KEYS.openWith)); }
  files() { return settingsOf(KEYS.files, shared(KEYS.files)); }
  changes() { return settingsOf(KEYS.changes, shared(KEYS.changes)); }
  agents() { return settingsOf(KEYS.agents, shared(KEYS.agents)); }

  // Saving ----------------------------------------------------------------

  // Stores one group: only the fields that differ from their defaults, and only when that changes
  // something (every mod redraws on a change).
  store(key, value) {
    if (JSON.stringify(value) !== JSON.stringify(shared(key) ?? null)) setShared(key, value);
  }

  patch(key, change) { this.store(key, storedOf(key, { ...settingsOf(key, shared(key)), ...change })); }

  saveList(items) { this.store(KEYS.openWith, storedWith(this.openWith(), items)); }

  // A text field's save, SAVE_AFTER the last key; flush() does it at once.
  later(name, cx, run) {
    this.saves[name]?.task.cancel();
    const task = cx.timer.after(SAVE_AFTER, (cx) => { delete this.saves[name]; run(); cx.notify(); });
    this.saves[name] = { task, run };
  }

  flush(name) {
    const save = this.saves[name];
    if (!save) return;
    save.task.cancel();
    delete this.saves[name];
    save.run();
  }

  flushAll() { for (const name of Object.keys(this.saves)) this.flush(name); }

  drop(name) {
    this.saves[name]?.task.cancel();
    delete this.saves[name];
  }

  // Text fields ------------------------------------------------------------

  // The text states, made once. A change saves (later); focus and blur light the field's frame, and
  // leaving a field, or Enter in a one-line one, saves it at once.
  makeFields() {
    const text = (name, state, onChange, onEnter) => {
      state.on("focus", (_e, cx) => { this.focusOn = name; cx.notify(); });
      state.on("blur", (_e, cx) => { if (this.focusOn === name) this.focusOn = null; this.flush(name); cx.notify(); });
      state.on("change", (_e, cx) => {
        const value = state.value();
        if (value === this.seen[name]) return;
        this.seen[name] = value;
        onChange(value, cx);
        cx.notify();
      });
      if (onEnter) state.on("submit", (_e, cx) => { onEnter(cx); cx.notify(); });
      return state;
    };
    const area = (opts, min, max) => { const s = TextareaState.new(opts); s.set_auto_grow(min, max); return s; };
    this.exclude = text("exclude", area({ placeholder: "node_modules\n*.log", rows: 3 }, 3, 8),
      (v, cx) => this.later("exclude", cx, () => this.patch(KEYS.files, { exclude: listOf(v) })));
    this.nest = text("nest", area({ rows: 8 }, 6, 16), (v, cx) => {
      const r = nestOf(v);
      this.nestError = r.error ?? null;
      if (r.error) this.drop("nest");
      else this.later("nest", cx, () => this.patch(KEYS.files, { nest: r.nest }));
    });
    this.model = text("model", InputState.new({ placeholder: "provider/model" }),
      (v, cx) => this.later("model", cx, () => this.patch(KEYS.changes, { commitModel: v.trim() })), () => this.flush("model"));
    // Changes: the command of "Your own command" (commitAgent "custom"), saved as its words.
    this.commitCommand = text("commitCommand", InputState.new({ placeholder: "my-writer --model {model} {prompt}" }), (v, cx) => {
      const r = commitCommandOf(v);
      this.commitError = r.error ?? null;
      if (r.error) this.drop("commitCommand");
      else this.later("commitCommand", cx, () => this.patch(KEYS.changes, { commitCommand: r.argv }));
    }, () => this.flush("commitCommand"));
    this.template = text("template", InputState.new({ placeholder: "feat: " }),
      (v, cx) => this.later("template", cx, () => this.patch(KEYS.changes, { template: v })), () => this.flush("template"));
    const agent = (_v, cx) => {
      if (!this.custom) return;
      const r = customAgent(this.agentName.value(), this.agentCommand.value());
      this.agentError = r.error ?? null;
      if (r.error) this.drop("agent");
      else this.later("agent", cx, () => this.patch(KEYS.agents, { name: r.name, argv: r.argv }));
    };
    this.agentName = text("agentName", InputState.new({ placeholder: "my-agent" }), agent, () => this.flush("agent"));
    this.agentCommand = text("agentCommand", InputState.new({ placeholder: "my-agent --flag" }), agent, () => this.flush("agent"));
    // The program form saves only when it's added or saved (the button, or Enter in a field).
    const form = () => { if (this.form) this.form.error = null; };
    const submit = (cx) => this.submitForm(cx);
    this.formName = text("formName", InputState.new({ placeholder: "My Editor" }), form, submit);
    this.formCommand = text("formCommand", InputState.new({ placeholder: "myeditor {file}" }), form, submit);
    this.formLine = text("formLine", InputState.new({ placeholder: "myeditor {file}:{line}" }), form, submit);
    this.formRemote = text("formRemote", InputState.new({ placeholder: "myeditor --ssh {host} {file}:{line}" }), form, submit);
  }

  setText(name, state, value) {
    this.seen[name] = value;
    state.set_value(value);
  }

  // Moves the keyboard into a text field that may only show from the next render on: now, and again
  // a moment later.
  focusField(state, cx) {
    state.focus();
    cx.timer.after(80, () => state.focus());
  }

  // Puts the stored settings in the text fields; `cleared` names groups just reset (read as nothing
  // stored, whatever shared() says yet).
  sync(cleared) {
    const now = (key) => settingsOf(key, cleared.has(key) ? null : shared(key));
    const f = now(KEYS.files), c = now(KEYS.changes), a = now(KEYS.agents);
    for (const name of ["exclude", "nest", "model", "template", "agent", "commitCommand"]) this.drop(name);
    this.setText("exclude", this.exclude, linesOf(f.exclude));
    this.setText("nest", this.nest, nestText(f.nest));
    this.setText("model", this.model, c.commitModel);
    this.setText("template", this.template, c.template);
    this.setText("commitCommand", this.commitCommand, joinCommand(c.commitCommand));
    this.commitError = null;
    this.custom = !presetOf(a);
    this.setText("agentName", this.agentName, a.name);
    this.setText("agentCommand", this.agentCommand, joinCommand(a.argv));
    this.nestError = null;
    this.agentError = null;
  }

  // Programs on this computer ----------------------------------------------

  needsPrograms() { return this.section === "open-with" || this.section === "agents" || this.section === "changes"; }

  // Looks for every program the pages show (the known ones, the person's own, the agents, and in
  // Changes' window the commit message writers) with one shell script. From init or a click, never
  // from render (cx.spawn runs its start at once).
  detect(cx) {
    if (this.detecting) return;
    this.detecting = true;
    this.detectError = null;
    const writers = shownSections().some(([id]) => id === "changes")
      ? [...COMMIT_AGENTS.filter((a) => a.program).map((a) => ({ argv: [a.program] })), ...(this.changes().commitCommand.length ? [{ argv: this.changes().commitCommand }] : [])]
      : [];
    const extra = [...itemsOf(this.openWith().items), ...AGENT_PRESETS, { argv: this.agents().argv }, ...writers];
    const looked = new Set([...KNOWN, ...extra].map(cliOf).filter((c) => c && /^[A-Za-z0-9._+-]+$/.test(c)));   // the names detectScript checks
    const script = detectScript(extra);
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", script], { timeout: 20000 });
        this.found = foundOf(r.stdout);
        this.lookedFor = looked;
      } catch (e) {
        this.detectError = String(e?.message ?? e).split("\n")[0];
      }
      this.detecting = false;
      cx.notify();
    });
  }

  // The program form ---------------------------------------------------------

  openForm(item, cx) {
    const d = item ? draftOf(item) : blankDraft();
    this.form = { id: item?.id ?? null, name: item?.name ?? "", for: d.for, kind: d.kind, error: null };
    this.setText("formName", this.formName, d.name);
    this.setText("formCommand", this.formCommand, d.command);
    this.setText("formLine", this.formLine, d.line);
    this.setText("formRemote", this.formRemote, d.remote);
    this.focusField(this.formName, cx);
    cx.notify();
  }

  closeForm(cx) {
    this.form = null;
    this.handle.focus();
    cx.notify();
  }

  submitForm(cx) {
    const f = this.form;
    if (!f) return;
    const draft = { name: this.formName.value(), command: this.formCommand.value(), line: this.formLine.value(), remote: this.formRemote.value(), for: f.for, kind: f.kind };
    const items = itemsOf(this.openWith().items);
    const r = f.id ? editOwn(items, f.id, draft, home()) : addOwn(items, draft, home());
    if (r.error) { f.error = r.error; cx.notify(); return; }
    this.saveList(r.items);
    this.closeForm(cx);
    this.detect(cx);          // look for its command too
  }

  // The window ---------------------------------------------------------------

  show(section, cx) {
    this.flushAll();
    this.section = section;
    this.open = null;
    this.armed = null;
    if (this.needsPrograms() && !this.found) this.detect(cx);
    this.handle.focus();
    cx.notify();
  }

  // A Reset asks first: its first press arms it for ARMED_FOR ms ("Press again to reset").
  reset(what, cx) {
    const now = Date.now();
    if (this.armed?.what !== what || now - this.armed.at > ARMED_FOR) {
      const at = now;
      this.armed = { what, at };
      cx.timer.after(ARMED_FOR, (cx) => { if (this.armed?.at === at) { this.armed = null; cx.notify(); } });
      cx.notify();
      return;
    }
    this.armed = null;
    // All: what this window shows, never the other mod's own section.
    const keys = what === "all" ? shownSections().map(([id]) => KEY_OF[id]) : [KEY_OF[this.section]];
    for (const key of keys) this.store(key, null);
    this.form = null;
    this.open = null;
    this.sync(new Set(keys));
    this.handle.focus();
    cx.notify();
  }

  // ✕ or Esc: what waits to be saved goes in, and the window closes.
  shut() {
    this.flushAll();
    closeOverlay(props()?.overlay);
  }

  // Herdr closed the window (or the app quits): text still waiting to be saved goes in, and the gears
  // open it again. Not when another window of this mod already took its place (a Settings… while it
  // was open: the new id, or the new copy).
  close() {
    this.flushAll();
    if (shown.copy === this || (shown.copy === null && shown.id === this.overlay)) { shown.id = null; shown.copy = null; }
  }

  key(e, cx) {
    if (e.key !== "escape") return;
    if (this.open) this.open = null;
    else if (this.focusOn) { this.flushAll(); this.focusOn = null; this.handle.focus(); }
    else if (this.form) this.form = null;
    else { cx.stop_propagation(); this.shut(); return; }
    cx.stop_propagation();
    cx.notify();
  }

  render(_cx) {
    const t = theme();
    const page = { "open-with": () => openWithPage(this, t), files: () => this.filesPage(t), changes: () => this.changesPage(t), agents: () => this.agentsPage(t) }[this.section];
    return v_flex().id("panel-settings").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).bg(t.popover).text_color(t.foreground)
      // The title bar: a press here (not on ✕) drags the window.
      .child(h_flex().h(40).flex_none().pl(18).pr(10).items_center()
        .child(div().flex_1().text_size(14).font_semibold().child(SETTINGS_TITLE))
        .child(iconButton(t, "ps-close", ICON("x"), "Close", () => this.shut())))
      .child(h_flex().flex_none().px(12).pb(8).gap(2).items_center().border_b(1).border_color(t.border)
        .children(shownSections().map(([id, title]) => {
          const on = id === this.section;
          return own(h_flex().id(`ps-s-${id}`).h(26).px(10).items_center().rounded(6).text_size(12.5)
            .text_color(on ? t.foreground : t.muted).bg(on ? t.selected : NONE).role("tab").accessibility_label(title)
            .when(!on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.show(id, cx)))
            .child(title));
        })))
      // The page scrolls; a press anywhere in it is the page's, never a drag.
      .child(own(div().relative().flex_1().min_h(0).w_full())
        .child(div().id("ps-body").size_full().overflow_y_scroll().child(div().px(18).pt(2).pb(20)
          .when((this.section === "open-with" || this.section === "agents") && this.both(), (el) => el.child(note(t, BOTH_USE).id("ps-both-use").pt(12)))
          .child(page())))
        .child(Scrollbar.vertical("ps-body").mode("always").absolute().inset_0()))
      // Between Reset all's two presses: what it resets.
      .when(this.armed?.what === "all", (el) => el.child(own(div().id("ps-reset-all-what").flex_none().px(18).py(6).border_t(1).border_color(t.border)
        .text_size(11.5).line_height("16px").text_color(readable(t, t.blocked, t.popover)).child(resetAllWhat(this.both())))))
      .child(this.footer(t));
  }

  both() { return installed("files") && installed("changes"); }

  footer(t) {
    const resetButton = (what, label) => {
      const armed = this.armed?.what === what;
      return button(t, `ps-reset-${what}`, armed ? "Press again to reset" : label, (_e, cx) => this.reset(what, cx), { warn: armed });
    };
    return h_flex().h(44).flex_none().px(18).gap(8).items_center().border_t(1).border_color(t.border)
      .child(resetButton("section", "Reset this section"))
      .child(resetButton("all", "Reset all"))
      .child(div().flex_1())
      .child(div().text_size(11.5).text_color(t.muted).child("Saved as you change it"));
  }

  // Pages --------------------------------------------------------------------

  // A field with its title and line on top and a text box under it, full width.
  boxRow(t, title, about, box, error) {
    return v_flex().w_full().gap(6).py(8).border_b(1).border_color(t.border)
      .child(div().text_size(13).child(title))
      .when(Boolean(about), (el) => el.child(div().text_size(11.5).line_height("16px").text_color(t.muted).child(about)))
      .child(box)
      .when(Boolean(error), (el) => el.child(div().text_size(11.5).text_color(readable(t, t.blocked, t.popover)).child(error)));
  }

  // On / off for one field of a group.
  flag(t, key, now, name, title, about) {
    return row(t, title, about, toggle(t, `ps-${name}`, now[name], title, () => this.patch(key, { [name]: !now[name] })));
  }

  choice(t, key, now, name, title, about, options) {
    return row(t, title, about, segmented(t, `ps-${name}`, options, now[name], (v) => this.patch(key, { [name]: v })));
  }

  number(t, key, now, name, title, about, label) {
    const steps = STEPS[name], v = now[name];
    return row(t, title, about, stepper(t, `ps-${name}`, label(v),
      () => this.patch(key, { [name]: stepped(steps, v, -1) }), () => this.patch(key, { [name]: stepped(steps, v, 1) }),
      { minus: canStep(steps, v, -1), plus: canStep(steps, v, 1) }));
  }

  // A mono font for code-like boxes: the person's terminal font, if Herdr says which.
  mono() {
    const f = settings()?.font_family;
    return typeof f === "string" && f ? f : undefined;
  }

  filesPage(t) {
    const f = this.files(), K = KEYS.files;
    return v_flex().w_full()
      .child(heading(t, "What's listed"))
      .child(this.flag(t, K, f, "hidden", "Show hidden files", "Names that start with a dot."))
      .child(this.choice(t, K, f, "ignored", "Git-ignored files", null, [["show", "Show"], ["dim", "Dim"], ["hide", "Hide"]]))
      .child(this.boxRow(t, "Never list", "One name or glob per line, like node_modules or *.log. .git is always left out.",
        textbox(t, this.exclude, this.focusOn === "exclude", { font: this.mono() })))
      .child(heading(t, "Order"))
      .child(this.choice(t, K, f, "sort", "Sort by", null, [["name", "Name"], ["type", "Type"], ["modified", "Modified"]]))
      .child(this.flag(t, K, f, "foldersFirst", "Folders first", null))
      .child(this.flag(t, K, f, "compact", "Compact folders", "A folder holding only one folder shares its row: a/b/c."))
      .child(this.flag(t, K, f, "nesting", "Nest related files", "package-lock.json under package.json, a.js under a.ts, as the rules below say."))
      .child(this.boxRow(t, "Nesting rules", "A file's name, then the names listed under it; * matches anything, $(base) is the file's name without its extension.",
        textbox(t, this.nest, this.focusOn === "nest", { font: this.mono(), error: Boolean(this.nestError) }), this.nestError))
      .child(heading(t, "Repositories"))
      .child(this.number(t, K, f, "repoDepth", "Look for repositories this many folders down", "Their files get git marks and their folders the branch. 0: only the shown folder's own repository.", (n) => String(n)))
      .child(heading(t, "While you work"))
      .child(this.flag(t, K, f, "follow", "Follow the terminal's folder", "The list shows the folder of the terminal you're in, unless you pin one."))
      .child(this.number(t, K, f, "freshMinutes", "Mark files changed in the last\u2026", "A dot on files changed that recently.", (n) => minutes(n, "Off")))
      .child(this.flag(t, K, f, "icons", "File type icons", null))
      .child(heading(t, "Opening files"))
      .child(this.choice(t, K, f, "markdown", "Markdown opens as", null, [["rendered", "Rendered"], ["source", "Source"]]))
      .child(this.flag(t, K, f, "wrap", "Wrap long lines when editing", null));
  }

  changesPage(t) {
    const c = this.changes(), K = KEYS.changes;
    const text = (name, state, w) => field(t, state, this.focusOn === name, { w });
    return v_flex().w_full()
      .child(heading(t, "Diffs"))
      .child(this.flag(t, K, c, "whitespace", "Ignore whitespace in diffs", null))
      .child(this.choice(t, K, c, "context", "Context lines", "Unchanged lines shown around each change.", [[3, "3"], [10, "10"], ["file", "Whole file"]]))
      .child(this.choice(t, K, c, "codeSize", "Code size", "The diffs and the conflict view. Terminal: the terminals' size less one.", [[11, "11"], [12, "12"], [13, "13"], [14, "14"], ["terminal", "Terminal"]]))
      .child(heading(t, "Repositories"))
      .child(this.number(t, K, c, "repoDepth", "Look for repositories this many folders down", "The ones the repository switcher offers. 0: only the folder's own repository.", (n) => String(n)))
      .child(this.number(t, K, c, "autoFetch", "Fetch automatically every\u2026", null, (n) => minutes(n, "Never")))
      .child(heading(t, "Committing"))
      .child(this.flag(t, K, c, "askStageAll", "Ask before staging everything when nothing is staged", null))
      .child(this.flag(t, K, c, "askAmendPushed", "Ask before amending a pushed commit", null))
      .child(this.commitWriter(t, c))
      .child(row(t, "Commit message model", commitModelNote(c.commitAgent), text("model", this.model, 240)))
      .child(row(t, "New commit messages start with", "For example feat: (the space after it counts).", text("template", this.template, 160)))
      .child(note(t, PEN_SENDS).id("ps-pen-sends").pt(8))
      .child(heading(t, "Agent turns"))
      .child(this.flag(t, K, c, "turns", "Snapshot each agent turn", "The repo as it was when a turn began and ended, to see what each turn changed."))
      .child(this.number(t, K, c, "turnsKeep", "Turns kept per repo", "The oldest go first.", (n) => String(n)));
  }

  // Changes: who writes the pen's commit messages (commitAgent; the pen's right-click picks from the
  // same list), each with what detection found here, and the command of "Your own command".
  commitWriter(t, c) {
    const id = "ps-commitAgent", open = this.open === id;
    const status = (program) => (!program || !this.found || !this.lookedFor.has(program) ? "" : this.found.cli.has(program) ? "found" : "not found here");
    const choices = COMMIT_AGENTS.map((a) => ({ value: a.id, label: a.id === "custom" ? "Your own command" : a.name, note: status(a.id === "custom" ? c.commitCommand[0] : a.program) }));
    const pick = (value, cx) => {
      this.open = null;
      this.patch(KEYS.changes, { commitAgent: value });
      if (value === "custom") {
        this.drop("commitCommand");
        this.commitError = null;
        this.setText("commitCommand", this.commitCommand, joinCommand(this.changes().commitCommand));
        this.focusField(this.commitCommand, cx);
      }
      cx.notify();
    };
    const el = v_flex().w_full()
      .child(row(t, "Commit messages written by", "What the pen by the message box runs. Its right-click picks one too.",
        dropdown(t, id, choices, c.commitAgent, open, (next, cx) => { this.open = next ? id : null; cx.notify(); }, pick, { w: 250 })))
      .child(detection(this, t));
    if (c.commitAgent !== "custom") return el;
    return el.child(v_flex().w_full().pb(8).gap(6).border_b(1).border_color(t.border)
      .child(h_flex().gap(8).items_center().child(div().w(70).flex_none().text_size(12).text_color(t.muted).child("Command"))
        .child(field(t, this.commitCommand, this.focusOn === "commitCommand", { w: 400, error: Boolean(this.commitError), font: this.mono() })))
      .child(div().id("ps-commitCommand-note").text_size(11.5).line_height("16px").text_color(this.commitError ? readable(t, t.blocked, t.popover) : t.muted).child(this.commitError ?? COMMAND_NOTE)));
  }

  agentsPage(t) {
    const a = this.agents(), preset = this.custom ? null : presetOf(a);
    // found or not installed, for a command detection looked for; nothing for one it didn't (yet).
    const found = (cli) => (!this.found || !this.lookedFor.has(cli) ? "" : this.found.cli.has(cli) ? "found" : "not installed");
    const radio = (id, on, label, status, onPick) => own(h_flex().id(id).h(30).px(8).gap(10).items_center().rounded(6)
      .when(!on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onPick))
      .role("radio_button").accessibility_label(`${label}${on ? ", chosen" : ""}`)
      .child(div().text_color(on ? t.accent : t.muted).child(on ? "\u25c9" : "\u25cb"))
      .child(div().text_size(13).text_color(t.foreground).child(label))
      .child(div().text_size(11).text_color(status === "found" ? readable(t, t.ansi2, [t.popover, [t.popover, t.hover]]) : t.muted).child(status)));
    // A preset: stored at once; the page redraws even when it was stored already ("Your own" was
    // chosen without changing anything).
    const pick = (p) => (_e, cx) => {
      this.custom = false;
      this.drop("agent");
      this.agentError = null;
      this.patch(KEYS.agents, { name: p.name, argv: p.argv });
      cx.notify();
    };
    const page = v_flex().w_full()
      .child(heading(t, "When a space has no agent"))
      .child(note(t, "Asking about a file or a change goes to the space's agent. With none there, this one starts:"))
      .child(detection(this, t))
      .children(AGENT_PRESETS.map((p) => radio(`ps-agent-${p.name}`, preset?.name === p.name, p.name, found(p.argv[0]), pick(p))))
      .child(radio("ps-agent-own", !preset, "Your own", this.custom ? found(a.argv[0]) : "", (_e, cx) => {
        this.custom = true;
        this.setText("agentName", this.agentName, a.name);
        this.setText("agentCommand", this.agentCommand, joinCommand(a.argv));
        this.focusField(this.agentCommand, cx);
        cx.notify();
      }));
    if (!preset) {
      page.child(v_flex().pl(34).pt(2).pb(6).gap(6)
        .child(h_flex().gap(8).items_center().child(div().w(70).text_size(12).text_color(t.muted).child("Name")).child(field(t, this.agentName, this.focusOn === "agentName", { w: 200 })))
        .child(h_flex().gap(8).items_center().child(div().w(70).text_size(12).text_color(t.muted).child("Command"))
          .child(field(t, this.agentCommand, this.focusOn === "agentCommand", { w: 340, error: Boolean(this.agentError) })))
        .child(div().text_size(11.5).text_color(this.agentError ? readable(t, t.blocked, t.popover) : t.muted).child(this.agentError ?? "Words with spaces go in quotes, as in a shell.")));
    }
    return page
      .child(heading(t, "Where it opens"))
      .child(this.choice(t, KEYS.agents, a, "where", "Open it in", null, [["tab", "A new tab"], ["right", "Right of the focused pane"]]));
  }
}
