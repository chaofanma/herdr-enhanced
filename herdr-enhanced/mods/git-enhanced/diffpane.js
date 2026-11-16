// A file's diff, drawn: the rows of `git diff` output (numbered, token colored), long lines wrapped or
// scrolled sideways with the line numbers and the @@ rows' buttons staying put, unified or side by
// side, the changed words of a removed/added pair marked, and cards under rows (draft comments). The
// Changes page, the Review tab and the History page each keep one. It reads nothing of its host: the
// host hands in what to show and gets back what was pressed.
// The rows are Herdr's Changes mod's diffRows (Apache-2.0), changed: old numbers for the side by side
// view, the hunk each row belongs to, token spans with a state per side, columns for wrapping.
// Based on Herdr's shipped changes mod (Apache-2.0); changed: diffRows (rowsOf) and the diff's virtual list.
import { h_flex, v_flex, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { div } from "gpui-kit";
import { shared, setShared } from "herdr";
import { tokenize, languageOf } from "./tokens.js";
import { splitRows, wordRanges, markSpans } from "./review.js";
import { BORDER, SIGN, textCols, codeWidth, colsFor, wrapSpans, expandTabs } from "./wrap.js";
import { BAR, clamp, maxScroll, thumb, dragOffset, pageOffset, wheelDx } from "./hscroll.js";
import { buttonAt, buttonInset } from "./hunk.js";
import { isGap } from "./diffopts.js";
import { gapRow } from "./diffui.js";
import { CLEAR, alpha } from "./look.js";
import { readable } from "./ink.js";
import { KEY } from "./id.js";

// A monospace character's width as a share of the font size, and the narrowest line-number gutter.
const CHAR_WIDTH = 0.62, GUTTER_MIN = 30;
const charOf = (size) => size * CHAR_WIDTH;
const expand = (text) => expandTabs(text);

/** Diff lines (from the first @@ on, gap rows included: diffopts.js withGaps) as rows: { kind ("@",
 *  "+", "-", " ", or "" for anything else), number (the new file's line; the old one for "-"), old
 *  (a context line's old number), text (git's), spans and cols (as drawn, tabs expanded), hunk (its
 *  @@ row) }. The removed and the added side each carry their own token state, so a comment opened
 *  on one side doesn't color the other. */
export function rowsOf(lines, lang) {
  let old = 0, next = 0, hunk = -1, before = null, after = null;
  return lines.map((line, at) => {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (m) { old = Number(m[1]); next = Number(m[2]); hunk = at; before = after = null; const shown = expand(line); return { kind: "@", text: line, spans: [{ text: shown, cls: "" }], cols: textCols(shown), hunk: at }; }
    const kind = line[0] === "+" || line[0] === "-" || line[0] === " " ? line[0] : "";
    if (!kind) { const shown = expand(line); return { kind: "", text: line, spans: [{ text: shown, cls: "" }], cols: textCols(shown), hunk }; }
    const text = line.slice(1) || " ", shown = expand(text);
    const t = tokenize(shown, lang, kind === "-" ? before : after);
    if (kind === "-") before = t.state; else if (kind === "+") after = t.state; else before = after = t.state;
    const row = { kind, text, spans: t.spans, cols: textCols(shown), hunk };
    if (kind === "-") row.number = old++;
    else if (kind === "+") row.number = next++;
    else { row.old = old++; row.number = next++; }
    return row;
  });
}

export class DiffPane {
  /** `id`: the prefix of its elements' ids ("changes", "history"); `split()`: whether it may show side
   *  by side (a tab); `words()`: whether changed words are marked (a tab). Construct in init. */
  constructor({ id, split = () => false, words = () => false }) {
    Object.assign(this, { id, canSplit: split, wantWords: words });
    this.lines = null; this.rows = []; this.path = null; this.items = []; this.sizes = []; this.split = null; this.at = new Map();
    this.wraps = new Map(); this.scrollX = 0; this.drag = null; this.press = null; this.width = null; this.fontSize = 13; this.row = 23; this.gutter = 30; this.widest = 0;
    this.extras = new Map(); this.built = { wrap: true, split: false };
    this.scroll = VirtualListScrollHandle.new();
  }

  // ---- What it shows

  /** Long lines wrap (the default) or scroll sideways, the same in every copy (shared). */
  wrapping() { return shared(KEY.lines) !== "scroll"; }
  setWrapping(wrap) { if (wrap !== this.wrapping()) setShared(KEY.lines, wrap ? "wrap" : "scroll"); this.layout(); }
  /** Side by side, where it may be (a tab) and the shared layout says so. */
  sideBySide() { return this.canSplit() && shared(KEY.layout) === "split"; }
  setSideBySide(on) { if (on !== this.sideBySide()) setShared(KEY.layout, on ? "split" : "unified"); this.measure(); }

  /** The code font's size (px); a row is 1.8 of it. */
  setFont(size) { if (size !== this.fontSize) { this.fontSize = size; this.row = Math.round(size * 1.8); this.measure(); } }

  /** Shows `lines` (diff lines, cut to what is drawn) of file `path`; the same lines again change
   *  nothing (a refresh keeps the place). Another file starts at the left edge. */
  show(lines, path) {
    if (path !== this.path) { this.path = path; this.scrollX = 0; }
    if (this.lines && this.lines.length === lines.length && this.lines.every((l, i) => l === lines[i])) return false;
    this.lines = lines;
    this.rows = rowsOf(lines, languageOf(path));
    this.hunks = this.rows.flatMap((r, i) => (r.kind === "@" ? [i] : []));
    this.words = this.wantWords() ? wordRanges(this.rows, (i) => expand(this.rows[i].text)) : null;
    this.wraps = new Map();
    this.measure();
    return true;
  }
  clear() { this.lines = null; this.rows = []; this.path = null; this.hunks = []; this.words = null; this.measure(); }

  /** Cards under rows: Map(row index → [{ key, height }]), or key "top" for cards above every row. */
  setExtras(extras) { this.extras = extras; this.layout(); }

  // The gutter (as wide as the largest line number needs) and the widest line, then the items.
  measure() {
    const ch = charOf(this.fontSize), split = this.sideBySide();
    const digits = String(this.rows.reduce((m, r) => Math.max(m, r.number ?? 0, split ? r.old ?? 0 : 0), 0)).length;
    this.gutter = Math.max(GUTTER_MIN, Math.ceil(digits * ch) + 10);
    this.widest = this.rows.reduce((m, r) => Math.max(m, r.cols ?? 0), 0) * ch;
    this.layout();
  }

  /** The list's items and heights: a row is as tall as its wrapped lines (side by side, its taller
   *  half), @@ rows one line; the cards under the row they belong to. */
  layout() {
    const wrap = this.wrapping(), split = this.sideBySide(), ch = charOf(this.fontSize), view = this.view();
    this.built = { wrap, split };
    this.split = split ? splitRows(this.rows) : null;
    this.at = new Map();
    this.split?.forEach((s, j) => { for (const i of [s.header, s.left, s.right, s.note]) if (i != null && !this.at.has(i)) this.at.set(i, j); });
    this.cols = { one: colsFor(codeWidth(view, this.gutter, false), ch), half: colsFor(codeWidth(view, this.gutter, true), ch) };
    for (const c of this.wraps.keys()) if (c !== this.cols.one && c !== this.cols.half) this.wraps.delete(c);
    const tall = (i, cols) => (i == null ? 1 : wrap && this.rows[i].kind !== "@" && !isGap(this.rows[i].text) ? this.lineCuts(i, cols).length : 1) * this.row;
    const base = split
      ? this.split.map((s, j) => ({ key: `s:${j}`, kind: "split", j, rows: [s.header, s.left, s.right, s.note].filter((x) => x != null),
        height: s.header != null || s.note != null ? tall(s.header ?? s.note, this.cols.one) : Math.max(tall(s.left, this.cols.half), tall(s.right, this.cols.half)) }))
      : this.rows.map((_r, i) => ({ key: `r:${i}`, kind: "row", i, rows: [i], height: tall(i, this.cols.one) }));
    const items = [...(this.extras.get("top") ?? []).map((x) => ({ ...x, kind: "extra" }))];
    const placed = new Set();
    for (const it of base) {
      items.push(it);
      for (const i of it.rows) {
        if (placed.has(i)) continue;
        placed.add(i);
        for (const x of this.extras.get(i) ?? []) items.push({ ...x, kind: "extra" });
      }
    }
    this.items = items;
    this.sizes = items.map((it) => it.height);
    this.scrollX = clamp(this.scrollX, this.maxX());
  }

  /** The item a row is drawn in. */
  itemOf(i) { const k = this.split ? `s:${this.at.get(i)}` : `r:${i}`; return this.items.findIndex((it) => it.key === k); }
  /** The row an item key stands for ("r:<i>"; a side-by-side row: its new side, else its old side). */
  rowOf(key) {
    if (key.startsWith("r:")) return Number(key.slice(2));
    if (!key.startsWith("s:")) return -1;
    const s = this.split?.[Number(key.slice(2))];
    return s ? s.header ?? s.right ?? s.left ?? s.note ?? -1 : -1;
  }
  /** Both rows of a side-by-side item (or the one row). */
  rowsOfKey(key) {
    const s = key.startsWith("s:") ? this.split?.[Number(key.slice(2))] : null;
    if (!s) { const i = this.rowOf(key); return i >= 0 ? [i] : []; }
    return [...new Set([s.header, s.left, s.right, s.note].filter((x) => x != null))];
  }
  /** Brings row `i` on screen. */
  reveal(i, how = "center") { const k = this.itemOf(i); if (k >= 0) this.scroll.scroll_to_item(k, how); }
  top() { this.scroll.scroll_to_item(0); }

  // ---- Sizes and sideways scrolling

  /** The rows' width: the visible diff (it doesn't scroll sideways as a whole). */
  view() { return Math.max(120, (this.width ?? 366) - 0); }
  setWidth(w) { if (w !== this.width) { this.width = w; this.layout(); return true; } return false; }

  // A row's spans, its changed words marked, and cut into visual lines of `cols` columns (kept until
  // the lines or the widths change).
  spansOf(i) {
    const r = this.rows[i], range = (r.kind === "+" || r.kind === "-") ? this.words?.get(i) : null;
    return range ? markSpans(r.spans, range[0], range[1]) : r.spans;
  }
  lineCuts(i, cols) {
    const byRow = this.wraps.get(cols) ?? this.wraps.set(cols, new Map()).get(cols);
    let cut = byRow.get(i);
    if (!cut) byRow.set(i, (cut = wrapSpans(this.spansOf(i), cols)));
    return cut;
  }

  /** How far the code scrolls sideways (Scroll mode): the widest line past the code's width. */
  maxX() { return this.built.wrap ? 0 : maxScroll(this.widest + charOf(this.fontSize), codeWidth(this.view(), this.gutter, Boolean(this.split))); }
  sideways() { return this.maxX() > 0; }
  bar() {
    const left = BORDER + this.gutter + SIGN, track = Math.max(0, this.view() - left), max = this.maxX(), visible = codeWidth(this.view(), this.gutter, Boolean(this.split));
    return { left, track, visible, max, thumb: thumb({ track, visible, total: visible + max, offset: this.scrollX }) };
  }
  wheel(e) { const next = clamp(this.scrollX + wheelDx(e), this.maxX()); if (next === this.scrollX) return false; this.scrollX = next; return true; }
  trackPress(e) {
    const g = this.bar(), x = e.local_position?.x;
    if (x === undefined) return false;
    const page = pageOffset({ x, thumb: g.thumb, offset: this.scrollX, visible: g.visible, max: g.max });
    if (page === null) this.drag = { x: e.position.x, from: this.scrollX }; else this.scrollX = page;
    return true;
  }
  dragTo(e) {
    if (!this.drag) return false;
    const g = this.bar(), next = dragOffset({ from: this.drag.from, dx: e.position.x - this.drag.x, track: g.track, size: g.thumb.size, max: g.max });
    if (next === this.scrollX) return false;
    this.scrollX = next; return true;
  }
  endDrag() { if (!this.drag) return false; this.drag = null; return true; }

  // ---- The @@ rows' buttons

  /** Their geometry: the code font two sizes down, wide enough for "Unstage", `pad` before the rows'
   *  right edge. */
  buttons() { const size = Math.max(9, this.fontSize - 2); return { size, width: Math.ceil(charOf(size) * 7 + 14), gap: 4, pad: 16 }; }
  /** Remembers where a press on the rows was (rows can't hold handlers, so a click on a @@ row's
   *  button is found by the press's x). */
  pressed(e) { this.press = e?.local_position ? { x: e.local_position.x, at: Date.now() } : null; }
  /** Which of `count` buttons the last press on a @@ row hit, or -1. */
  buttonHit(count) {
    const p = this.press, g = this.buttons();
    if (!p || Date.now() - p.at > 2000 || !count) return -1;
    return buttonAt(p.x, this.view() - g.pad, count, g.width, g.gap);
  }

  // ---- Drawing

  /** The diff area. `o`: { colors (colors.js palette), target ({ from, to } rows lit up), marked
   *  (Set of rows with comments), current (the @@ row of the current hunk), actions (the @@ rows'
   *  buttons: [{ id, label, danger }]), busy (a row whose button runs), waiting (a git action runs:
   *  the buttons wait, faded as every control that waits), note (words where the buttons
   *  would be), extra(item, t) (draws a card), hint, onRow(key, cx), onSecondary(key, e, cx), font }. */
  element(t, o) {
    const sideways = this.sideways(), id = this.id;
    return div().id(`${id}-diff-area`).flex_1().min_w(0).min_h(0).relative().font_family(o.font).text_size(this.fontSize)
      .when(sideways, (e) => e.on_scroll_wheel((ev, cx) => { if (this.wheel(ev)) cx.notify(); }))
      .child(v_flex().size_full()
        .child(div().id(`${id}-diff-rows`).w_full().flex_1().min_h(0)
          .on_size_change((size, cx) => { if (this.setWidth(size.width)) cx.notify(); })
          .on_mouse_down("left", (e) => this.pressed(e))
          .child(v_virtual_list(`${id}-diff`, this.items.length, this.sizes.length ? this.sizes : this.row, (k) => this.items[k].key,
            (range) => this.items.slice(range.start, range.end).map((it) => this.draw(it, t, o))).size_full().track_scroll(this.scroll)
            .on_item_click((key, cx) => o.onRow?.(key, cx))
            .on_item_secondary_click((key, e, cx) => o.onSecondary?.(key, e, cx))))
        .when(sideways, (e) => e.child(this.hbar(t))))
      .child(Scrollbar.vertical(`${id}-diff`).viewport_from_layout().absolute().top(0).left(0).right(0).bottom(sideways ? BAR : 0))
      .when(Boolean(o.hint), (e) => e.child(o.hint));
  }

  /** Follows a sideways drag over the whole of `el` (the host's root): a release, or the pointer
   *  leaving it, ends it. */
  follow(el) {
    return el.when(Boolean(this.drag), (e) => e.on_mouse_move((ev, cx) => { if (this.dragTo(ev)) cx.notify(); })
      .on_mouse_up("left", (_e, cx) => { if (this.endDrag()) cx.notify(); }).on_hover((over, cx) => { if (!over && this.endDrag()) cx.notify(); }));
  }

  // The sideways bar under the diff, along the code: the thumb is the visible share.
  hbar(t) {
    const g = this.bar(), id = this.id;
    return div().id(`${id}-diff-hbar`).w_full().h(BAR).flex_none().pl(g.left)
      .child(div().id(`${id}-diff-htrack`).size_full().relative().on_mouse_down("left", (e, cx) => { if (this.trackPress(e)) cx.notify(); })
        .child(div().id(`${id}-diff-hthumb`).absolute().top(3).h(BAR - 6).left(g.thumb.start).w(g.thumb.size).rounded(2).bg(this.drag ? t.muted : t.border).hover((s) => s.bg(t.muted))));
  }

  // One item of the list (no handlers in here: the list's click and right-click get the key).
  draw(it, t, o) {
    if (it.kind === "extra") return o.extra ? o.extra(it, t) : div().h(it.height);
    if (it.kind === "split") return this.drawSplit(it, t, o);
    return this.drawRow(it.i, it.height, t, o);
  }

  tintOf(r, colors) { return r.kind === "+" ? colors.added : r.kind === "-" ? colors.removed : null; }

  drawRow(i, height, t, o) {
    const r = this.rows[i], lit = Boolean(o.target && i >= o.target.from && i <= o.target.to);
    if (isGap(r.text)) return gapRow({ t, text: r.text, height, inset: BORDER + this.gutter + SIGN });
    if (r.kind === "@") return this.drawHunk(i, height, t, o, lit);
    const tint = this.tintOf(r, o.colors), mark = o.marked?.has(i);
    return h_flex().w_full().h(height).flex_none().items_start().overflow_hidden()
      .bg(tint ? alpha(tint, lit ? 0.32 : 0.12) : lit ? alpha(t.accent, 0.12) : CLEAR)
      .border_l(BORDER).border_color(lit ? t.accent : mark ? alpha(t.accent, 0.45) : CLEAR)
      .children(this.lead(r.kind === " " && o.oldSide ? r.old : r.number, r.kind, tint, lit, t))
      .child(this.code(i, this.cols.one, tint, o.colors, t, lit));
  }

  // A @@ row: the header on the raised color, its buttons at the right edge of the visible rows.
  drawHunk(i, height, t, o, lit) {
    const r = this.rows[i], current = i === o.current, actions = o.actions ?? [];
    const row = h_flex().w_full().h(height).flex_none().items_center().relative().bg(current ? t.selected : t.raised)
      .border_l(BORDER).border_color(lit || current ? t.accent : CLEAR)
      .child(div().w(this.gutter + SIGN).flex_none())
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(expand(r.text)));
    if (!actions.length) return row.when(Boolean(o.note), (e) => e.child(div().flex_none().pr(16).text_size(Math.max(9, this.fontSize - 2)).text_color(t.muted).child(o.note)));
    const g = this.buttons(), n = actions.length;
    return row.pr(g.pad + n * (g.width + g.gap)).children(actions.map((a, k) =>
      div().absolute().top(3).right(g.pad + buttonInset(k, n, g.width, g.gap)).w(g.width).h(Math.max(10, this.row - 6)).flex().items_center().justify_center()
        .rounded(4).border_1().border_color(t.border).bg(t.surface).text_size(g.size).text_color(a.danger ? readable(t, t.ansi1) : t.foreground)
        .when(o.busy != null || Boolean(o.waiting), (e) => e.opacity(0.7)).child(o.busy === i && !a.danger ? "…" : a.label)));
  }

  // A row's line number (its gutter tinted all the way down) and its sign, beside its first line.
  lead(number, kind, tint, lit, t) {
    return [
      div().w(this.gutter).h_full().flex_none().when(Boolean(tint), (e) => e.bg(alpha(tint, 0.16)))
        .child(div().h(this.row).pr(4).flex().items_center().justify_end().text_color(lit ? t.foreground : tint ? alpha(t.foreground, 0.8) : t.dim).child(number == null ? "" : String(number))),
      div().w(SIGN).h(this.row).flex_none().flex().items_center().justify_center().font_bold().text_color(tint ? readable(t, tint, alpha(tint, lit ? 0.32 : 0.12)) : CLEAR).child(kind === "+" ? "+" : kind === "-" ? "−" : " "),
    ];
  }

  // A row's code in token colors, its changed words on a stronger tint. Wrapping: one clipped line per
  // visual line. Scrolling: one clipped line, moved left by the sideways offset.
  // A token's color where it reads on the row's tint (and a changed word's), else the foreground.
  code(i, cols, tint, colors, t, lit = false) {
    // A changed word's tint: light enough for its text to read (lighter still on a row the comment box
    // lights, tinted more already).
    const row = tint ? alpha(tint, lit ? 0.32 : 0.12) : lit ? alpha(t.accent, 0.12) : t.surface, mark = tint && alpha(tint, lit ? 0.1 : 0.38);
    const ink = (s) => readable(t, colors[s.cls] ?? t.foreground, s.mark && tint ? [[row, mark]] : [row]);
    const piece = (s) => div().when(Boolean(s.cls), (e) => e.text_color(ink(s))).when(Boolean(s.mark && tint), (e) => e.bg(mark).rounded(3)).child(s.text);
    if (this.built.wrap) return v_flex().flex_1().min_w(0).children(this.lineCuts(i, cols).map((line) => h_flex().w_full().h(this.row).flex_none().overflow_hidden().whitespace_nowrap().children(line.map(piece))));
    return h_flex().flex_1().min_w(0).h(this.row).overflow_hidden().whitespace_nowrap().child(h_flex().flex_none().relative().left(-this.scrollX).children(this.spansOf(i).map(piece)));
  }

  // A side-by-side row: old | new, each half with its numbers and tint (a missing side shaded); a @@
  // row or a note spans both.
  drawSplit(it, t, o) {
    const s = this.split[it.j];
    if (s.header != null || s.note != null) return this.drawRow(s.header ?? s.note, it.height, t, o);
    const half = (i, oldSide) => {
      if (i == null) return div().flex_1().min_w(0).h_full().bg(alpha(t.raised, 0.5));
      const r = this.rows[i], tint = this.tintOf(r, o.colors), lit = Boolean(o.target && i >= o.target.from && i <= o.target.to);
      return h_flex().flex_1().min_w(0).h_full().items_start().overflow_hidden()
        .bg(tint ? alpha(tint, lit ? 0.32 : 0.12) : CLEAR).border_l(BORDER).border_color(lit ? t.accent : o.marked?.has(i) ? alpha(t.accent, 0.45) : CLEAR)
        .children(this.lead(oldSide && r.kind === " " ? r.old : r.number, r.kind, tint, lit, t))
        .child(this.code(i, this.cols.half, tint, o.colors, t, lit));
    };
    return h_flex().w_full().h(it.height).flex_none().child(half(s.left, true)).child(div().w(1).h_full().flex_none().bg(t.border)).child(half(s.right, false));
  }
}
