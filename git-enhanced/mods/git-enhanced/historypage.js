// The History page's copy (props.view "history": a panel page, or a full-width History tab with
// props.root): history.js draws the commits; its file diffs are this copy's DiffPane, read-only (no
// hunk buttons), wrapped or scrolled like every diff here, side by side with changed words in a tab.
// Based on Herdr's shipped changes mod (Apache-2.0); changed: the folder watch.
import { div } from "gpui-kit";
import { exec, props, watchFolder, shared, setShared } from "herdr";
import { SAFE_ARGS } from "./repotrust.js";
import { History } from "./history.js";
import { DiffPane } from "./diffpane.js";
import { RepoSet } from "./repos.js";
import { location, contextKey } from "./where.js";
import { palette } from "./colors.js";
import { DIFF, splitDiff } from "./hunk.js";
import { CLEAR } from "./look.js";
import { iconButton } from "./iconbutton.js";
import { ID, KEY, asset } from "./id.js";
import { SHOW } from "./scopes.js";
import { questions } from "./question.js";
import { settingsOf, storedOf, KEYS } from "./panelsettings.js";
import { diffArgs } from "./diffopts.js";
import { diffOptionsButton, whitespaceButton } from "./diffui.js";
import { codeFont, codeSize } from "./codefont.js";
import { checkInstalled } from "./installed.js";

const prefs = () => settingsOf(KEYS.changes, shared(KEYS.changes));
const optionsKey = (p) => `${p.whitespace}|${p.context}`;

export class HistoryPage {
  init(cx) {
    this.handle = cx.focus_handle();
    const tab = Boolean(props()?.root);
    // Side by side wherever the shared layout says so (the tab's switch, the panel's Split).
    this.diff = new DiffPane({ id: "history", split: () => true, words: () => tab });
    this.repos = new RepoSet();
    this.history = new History({
      mod: ID, names: { changed: KEY.changed, scope: KEY.scope, show: SHOW, split: KEY.historySplit, layout: KEY.historyLayout, reveal: KEY.reveal }, location, key: contextKey, repos: this.repos,
      diff: this.hooks(), focus: { track: (el) => el.track_focus(this.handle), focus: () => this.handle.focus() },
      watch: (root, on, cx) => this.watch(root, on, cx), codeFont,
      questions: questions(ID, () => ({ mono: codeFont() })), starter: () => settingsOf(KEYS.agents, shared(KEYS.agents)),
    });
    this.history.refresh(cx);
    // It loads again when the refs move: looked at every 10 s (and on file changes here); whether Files
    // Enhanced is installed (Show in Files) is looked at as often.
    cx.spawn(async (cx) => { if (await checkInstalled()) cx.notify(); });
    cx.timer.every(10000, (cx) => { this.history.refresh(cx); cx.spawn(async (cx) => { if (await checkInstalled()) cx.notify(); }); });
  }

  // A repository here is watched; one on another machine is looked at by the 10 s timer.
  watch(root, on, cx) {
    if (on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try { while (this.watched === root) { await watchFolder(root); if (this.watched === root) this.history.refresh(cx); } }
      catch { this.watched = null; }
    });
  }

  // What history.js asks of the page around it: open a file's diff, clear it, keep it in step with
  // the shared modes, draw it, its switches, and follow a sideways drag.
  hooks() {
    const d = this.diff;
    const hooks = {
      // `to` null: the working tree; `untracked`: a new file, all of it added.
      // The diff settings (lines of context, whitespace) as the Changes page reads them; `shown`:
      // what to read again when they change.
      open: async (req) => {
        const { root, on, from, to, path, binary, untracked = false, still } = req, p = prefs();
        this.shown = req; this.optionsSeen = optionsKey(p);
        const args = untracked ? ["diff", "--no-index", ...DIFF, ...diffArgs(p), "--", "/dev/null", path] : ["diff", from, ...(to ? [to] : []), ...DIFF, ...diffArgs(p), "--", path];
        const r = await exec("git", [...SAFE_ARGS, ...args], { cwd: root, on });
        if (!still()) return;
        const fine = r.code === 0 || (untracked && r.code === 1);
        const parts = fine ? splitDiff(r.stdout) : null;
        const lines = parts ? parts.lines : [!fine ? `Cannot show this diff: ${(r.stderr || "").trim().split("\n")[0]}` : binary ? "Binary file changed" : "No text diff available"];
        d.setFont(codeSize());
        d.show(lines.slice(0, 1501).map((l) => (l.length > 4000 ? `${l.slice(0, 4000)}… (line cut)` : l)), path);
        d.top();
      },
      clear: () => { this.shown = null; d.clear(); },
      // From History's render: a render may not start work that notifies, so a read again is a timer's.
      sync: (cx) => {
        if (codeSize() !== d.fontSize) d.setFont(codeSize());
        const key = optionsKey(prefs()), req = this.shown;
        if (req && key !== this.optionsSeen) {
          this.optionsSeen = key;
          if (req.still()) cx.timer.after(1, (cx) => cx.spawn(async (cx) => { if (this.shown === req && req.still()) await hooks.open(req); cx.notify(); }));
        }
        if (d.sideBySide() !== d.built.split) d.measure(); else if (d.wrapping() !== d.built.wrap) d.layout();
      },
      element: (t, hint) => d.element(t, { colors: palette(props()?.palette, t), font: codeFont(),
        hint: hint ? div().absolute().top(8).px(12).text_color(t.dim).child(hint) : null }),
      controls: (t, wide) => (wide ? this.switches(t) : [this.linesButton(t), this.splitButton(t)]),
      // ± and ¶, before the rest in the panel and in the tab.
      options: (t) => [this.optionsControl(t), this.whitespaceControl(t)],
      frame: (el) => d.follow(el),
      resize: () => d.layout(),
    };
    return hooks;
  }
  // ± (the lines of context) and ¶ (ignore whitespace): the Changes page's, the same settings.
  optionsControl(t) {
    return diffOptionsButton({ t, prefix: "history-diff", prefs: prefs(), open: Boolean(this.choosingDiffOptions), onOpenChange: (o, cx) => { this.choosingDiffOptions = o; cx.notify(); },
      onSet: (field, value, cx) => { const p = prefs(); if (p[field] !== value) setShared(KEYS.changes, storedOf(KEYS.changes, { ...p, [field]: value })); cx.notify(); } });
  }
  whitespaceControl(t) {
    return whitespaceButton({ t, prefix: "history-diff", on: prefs().whitespace, onToggle: (cx) => { const p = prefs(); setShared(KEYS.changes, storedOf(KEYS.changes, { ...p, whitespace: !p.whitespace })); cx.notify(); } });
  }

  switches(t) {
    const d = this.diff, split = d.sideBySide(), wrap = d.wrapping();
    const part = (id, label, on, pick, tip) => div().id(id).h(20).px(8).flex().items_center().rounded(5).text_size(12).bg(on ? t.selected : CLEAR).text_color(on ? t.foreground : t.dim)
      .cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip(tip).on_click((_e, cx) => { pick(); cx.notify(); }).child(label);
    const group = (a, b) => div().h(24).p(1).gap(1).flex().flex_none().items_center().rounded(6).border_1().border_color(t.border).child(a).child(b);
    return [
      group(part("history-layout-unified", "Unified", !split, () => d.setSideBySide(false), "One column, removed lines above the added ones"),
        part("history-layout-split", "Split", split, () => d.setSideBySide(true), "Old | new side by side")),
      group(part("history-lines-wrap", "Wrap", wrap, () => d.setWrapping(true), "Long lines wrap within the width"),
        part("history-lines-scroll", "Scroll", !wrap, () => d.setWrapping(false), "Long lines stay one line; the code scrolls sideways")),
    ];
  }
  linesButton(t) {
    const wrap = this.diff.wrapping();
    return iconButton(t, `history-lines-${wrap ? "wrap" : "scroll"}`, asset("wrap.svg"), (cx) => { this.diff.setWrapping(!wrap); cx.notify(); }, {
      on: wrap, tip: wrap ? "Long lines wrap · click to keep them one line and scroll sideways" : "Long lines scroll sideways · click to wrap them" });
  }
  // The panel's Split icon (Herdr's split-right): old | new side by side, or one column (shared with
  // the tab's Unified | Split and the Changes page's).
  splitButton(t) {
    const split = this.diff.sideBySide();
    return iconButton(t, `history-diff-split-${split ? "on" : "off"}`, "mods/pane/split-right.svg", (cx) => { this.diff.setSideBySide(!split); cx.notify(); }, {
      on: split, tip: split ? "Old | new side by side · click for one column" : "One column · click for old | new side by side" });
  }

  render(cx) { return this.history.render(cx); }
  async close() { this.history.close(); }
}
