// The search box's Contents mode (⌘⇧F in the tree, or Names | Contents in its header): rg under the
// root (grep without it), results grouped by file with their lines and the matches marked. A click on
// a line previews the file; a double-click, or ↗ on the selected line, opens it at that line the way
// the Open with setting `line` says (Herdr's editor can't scroll to a line). Replace (here, or on
// another machine through machine.js writeText): a second field; every match starts checked (per line
// and per file); "Replace N in M files" asks once more, then each file's text as read for the search
// gets the replacements (contents.js) and is written only if the file still holds that text (the
// expected text of the save), so a file changed since the search is skipped and said.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { fullOf } from "./paths.js";
import { sh, readText, writeText, capsOf } from "./machine.js";
import { announce } from "./signal.js";
import { asset } from "./id.js";
import { SEARCH, MAX, BYTES, SECONDS, rgArgs, grepArgs, parseRg, parseGrep, jsPattern, searchError, replacePattern, applyReplacements } from "./contents.js";
import { readable } from "./ink.js";

export const ROW = 24;
const NONE = "#00000000";
const PREVIEW = 160; // characters of a long line shown around its first match

// Searches root (here, or on `on`) for the query { query, matchCase, wholeWord, regex } with the Files
// settings' hidden and exclude. Resolves parseRg's result with `rg` (false: grep did it), `limit` (it
// stopped at MAX matches) and `timeout` (it stopped after SECONDS).
export async function searchContents(root, on, q, prefs) {
  if (!capsOf(on).shell) throw new Error(`Searching contents needs sh, which ${on ?? "Windows"} doesn't have`);
  const opts = { hidden: prefs.hidden, exclude: prefs.exclude };
  const run = (json, args) => sh(on, SEARCH, [String(SECONDS), String(MAX), String(BYTES), json, ...args], { cwd: root, timeout: (SECONDS + 10) * 1000 });
  let r = await run("1", ["rg", ...rgArgs(q, opts)]), rg = true;
  if (r.code === 127) { rg = false; r = await run("0", ["grep", ...grepArgs(q, opts)]); }
  if (r.code === 127) throw new Error("Neither rg nor grep is installed there");
  const stopped = r.code === 143 || r.code === 141;
  if (!stopped && r.code > 1) throw new Error(searchError(r.stderr) ?? `${rg ? "rg" : "grep"} failed (${r.code})`);
  const found = rg ? parseRg(r.stdout) : parseGrep(r.stdout, jsPattern(q).re);
  // rg searches in parallel: its files come in any order; they're listed by path.
  found.files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }) || (a.path < b.path ? -1 : 1));
  const limit = found.full || found.lines >= MAX;
  return { ...found, rg, limit, timeout: stopped && !limit };
}

// The rows shown: each file, then its lines unless it's folded.
export function flatten(s) {
  const rows = [];
  for (const f of s.files ?? []) {
    rows.push({ kind: "file", f, key: `f:${f.path}` });
    if (!s.folded.has(f.path)) for (const m of f.matches) rows.push({ kind: "line", f, m, key: `l:${f.path}:${m.line}` });
  }
  return rows;
}

// A line's matches that a replace can take (rg's stand-in range for a line without one can't).
const real = m => (m.exact === false ? [] : m.ranges.filter(([a, b]) => b > a));
// Matches and files checked now: { n, files }.
export function checked(s) {
  let n = 0, files = 0;
  for (const f of s.files ?? []) {
    const k = f.matches.reduce((sum, m) => sum + (m.on === false ? 0 : real(m).length), 0);
    if (k) { n += k; files++; }
  }
  return { n, files };
}
const fileState = f => { const on = f.matches.filter(m => m.on !== false).length; return on === f.matches.length ? "on" : on ? "some" : "off"; };

// Why Replace can't run now, or null.
export function replaceBlocked(tree, s) {
  const write = tree.caps().write;
  // Not known yet (null): the probe is asked again, and Replace waits for it.
  if (write === null) { tree.relearn?.(); return `Finding out what ${tree.on} has…`; }
  if (!write) return `Replace needs base64 or openssl on ${tree.on}`;
  if (s.opts.regex) { const p = jsPattern({ query: s.query.trim(), ...s.opts }); if (p.error) return `JavaScript can't read this pattern (${p.error.replace(/^Invalid regular expression: /, "")})`; }
  if (s.busy) return "Searching…";
  if (!s.files?.length) return null;
  if (!s.texts) return "Reading the files…";
  return null;
}

// Reads every file with matches (the text Replace changes and writeTextFile checks against), and
// marks a file whose lines no longer say what the search found (changed since): f.stale.
export function readTexts(tree, s, cx) {
  if (s.texts || s.reading || !s.files?.length) return;
  const files = s.files, root = tree.root, on = tree.on, texts = new Map();
  s.reading = true;
  cx.spawn(async cx => {
    for (let i = 0; i < files.length; i += 24) {
      await Promise.all(files.slice(i, i + 24).map(async f => {
        const text = await readText(on, fullOf(root, f.path)).catch(() => null);
        texts.set(f.path, text);
        if (text == null) { f.unreadable = true; return; }
        const lines = text.split("\n");
        f.stale = f.matches.some(m => (lines[m.line - 1] ?? "").replace(/\r$/, "") !== m.text);
      }));
      if (s.files !== files) return;
    }
    if (s.files !== files) return;
    s.texts = texts; s.reading = false;
    cx.notify();
  });
}

// Replace, after the confirm: every checked match, file by file. Says what it did in s.done and runs
// the search again.
export function replaceAll(tree, s, cx) {
  if (s.replacing || replaceBlocked(tree, s) || !checked(s).n) return;
  const q = { query: s.query.trim(), ...s.opts }, pattern = replacePattern(s.replaceInput.value(), s.opts.regex);
  const re = s.opts.regex ? jsPattern(q).re : null, root = tree.root, on = tree.on, files = s.files, texts = s.texts;
  s.replacing = true; s.confirm = false; cx.notify();
  cx.spawn(async cx => {
    let replaced = 0, done = 0, since = 0, failed = 0, left = 0;
    const fulls = [];
    for (const f of files) {
      const ms = f.matches.filter(m => m.on !== false).flatMap(m => real(m).map(([start, end]) => ({ line: m.line, start, end, matched: m.text.slice(start, end) })));
      if (!ms.length) continue;
      const text = texts.get(f.path), full = fullOf(root, f.path);
      if (text == null) { failed++; continue; }
      if (f.stale) { since++; continue; }
      const out = applyReplacements(text, ms, re, pattern);
      left += out.skipped;
      if (!out.replaced) continue;
      try { await writeText(on, full, out.text, text); replaced += out.replaced; done++; fulls.push(full); }
      catch { const now = await readText(on, full).catch(() => null); if (now !== text) since++; else failed++; }
    }
    s.replacing = false;
    s.done = [`Replaced ${replaced} in ${done} file${done === 1 ? "" : "s"}`,
      since && `${since} file${since === 1 ? "" : "s"} changed since the search; skipped`,
      left && `${left} match${left === 1 ? "" : "es"} JavaScript reads differently, left as ${left === 1 ? "it was" : "they were"}`,
      failed && `${failed} couldn't be written or read`].filter(Boolean).join(" · ");
    if (fulls.length) {
      announce({ on, files: fulls });
      const v = tree.preview;
      if (v.file && !v.edit && fulls.includes(fullOf(root, v.file))) v.show(v.file, cx);
    }
    tree.find(cx);
    cx.notify();
  });
}

// The options row: Names | Contents, and for Contents match case, whole word, regex and Replace. A
// toggle's id names its state (a tooltip follows the click).
export function optionsRow(tree, s, t) {
  const contents = s.mode === "contents";
  const seg = (mode, label) => div().id(`fm-sm-${mode}`).px(7).h(20).flex().items_center().rounded(4).cursor_pointer()
    .text_color(s.mode === mode ? t.foreground : t.dim).when(s.mode === mode, el => el.bg(t.selected)).hover(st => st.text_color(t.foreground))
    .on_click((_e, cx) => tree.searchMode(mode, cx)).child(label);
  const opt = (key, label, tip) => div().id(`fm-so-${key}-${s.opts[key] ? "on" : "off"}`).px(5).h(20).flex().items_center().rounded(4).cursor_pointer().border_1()
    .border_color(s.opts[key] ? t.accent : NONE).text_color(s.opts[key] ? t.accent : t.muted).hover(st => st.bg(t.hover)).tooltip(tip)
    .on_click((_e, cx) => { s.opts[key] = !s.opts[key]; tree.find(cx); }).child(label);
  return h_flex().h(26).flex_none().mx(4).gap(4).items_center().text_size(11.5)
    .child(h_flex().p(1).gap(1).rounded(5).border_1().border_color(t.border).child(seg("names", "Names")).child(seg("contents", "Contents")))
    .child(div().flex_1())
    .when(contents, el => el
      .child(opt("matchCase", "Aa", s.opts.matchCase ? "Match case: on" : "Match case (off: smart case)"))
      .child(opt("wholeWord", "W", s.opts.wholeWord ? "Whole word: on" : "Whole word"))
      .child(opt("regex", ".*", s.opts.regex ? "Regular expression: on" : "Regular expression (off: the text as typed)"))
      .when(tree.caps().write, el => el.child(div().id(`fm-so-replace-${s.replaceOpen ? "on" : "off"}`).px(5).h(20).flex().items_center().rounded(4).cursor_pointer()
        .text_color(s.replaceOpen ? t.accent : t.muted).hover(st => st.bg(t.hover)).tooltip(s.replaceOpen ? "Hide Replace" : "Replace")
        .on_click((_e, cx) => tree.toggleReplace(cx)).child("⇄"))));
}

// The Replace row: the field, then "Replace N in M files" (or why not), then the confirm.
export function replaceRow(tree, s, t) {
  const blocked = replaceBlocked(tree, s), { n, files } = checked(s), ready = !blocked && n > 0 && !s.replacing;
  const button = (id, label, enabled, act, primary = false) => div().id(id).flex_none().px(8).h(24).flex().items_center().rounded(6).text_size(11.5)
    .border_1().border_color(primary ? t.ansi1 : t.border).bg(primary ? t.ansi1 : t.raised).text_color(primary ? t.solid_foreground : enabled ? t.foreground : t.dim)
    .when(enabled, el => el.cursor_pointer().hover(st => st.opacity(0.88)).on_click(act)).child(label);
  const what = `${n} in ${files} file${files === 1 ? "" : "s"}`;
  return v_flex().flex_none().mx(4).gap(4)
    .child(h_flex().gap(6).items_center()
      .child(h_flex().h(28).flex_1().min_w(0).px(8).items_center().rounded(7).border_1().border_color(t.input).bg(t.surface)
        .child(Input.new(s.replaceInput).flex_1().h_full().text_size(12.5).text_color(t.foreground)))
      .when(!s.confirm, el => el.child(button("fm-replace", s.replacing ? "Replacing…" : `Replace ${what}`, ready, (_e, cx) => { s.confirm = true; cx.notify(); }))))
    .when(Boolean(s.confirm), el => el.child(h_flex().gap(6).items_center().text_size(11.5)
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(`Replace ${what} with “${s.replaceInput.value()}”?`))
      .child(button("fm-replace-no", "Cancel", true, (_e, cx) => { s.confirm = false; cx.notify(); }))
      .child(button("fm-replace-yes", "Replace", ready, (_e, cx) => replaceAll(tree, s, cx), true))))
    .when(Boolean(blocked) && blocked !== "Searching…", el => el.child(div().text_size(11).text_color(t.dim).truncate().child(blocked)));
}

// A line's text for its row: a long one around its first match; the ranges moved with it. A tab
// left in it shows as one space (a raw tab has no width on screen), so the ranges stay put.
function excerpt(m) {
  let text = m.text, ranges = m.ranges, from = 0;
  const lead = text.length - text.trimStart().length;
  if (lead && (!ranges.length || ranges[0][0] >= lead)) from = lead;
  if (text.length - from > PREVIEW && ranges.length && ranges[0][0] - from > 40) from = ranges[0][0] - 30;
  const cut = from > lead;
  text = text.slice(from, from + PREVIEW);
  ranges = ranges.map(([a, b]) => [a - from, Math.min(b - from, text.length)]).filter(([a, b]) => b > a && a < text.length);
  return { text: ((cut ? "…" : "") + text).replace(/\t/g, " "), ranges: cut ? ranges.map(([a, b]) => [a + 1, b + 1]) : ranges };
}

// The text in runs, the matched ones marked.
function marked(text, ranges, t) {
  const out = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) out.push(div().flex_none().child(text.slice(at, a)));
    out.push(div().flex_none().rounded(2).bg(t.selection).text_color(readable(t, [t.foreground, t.accent_foreground], t.selection)).child(text.slice(Math.max(a, at), b)));
    at = Math.max(at, b);
  }
  if (at < text.length) out.push(div().flex_none().child(text.slice(at)));
  return out;
}

const box = (on, t, size = 12) => div().size(size).flex_none().flex().items_center().justify_center().rounded(3).border_1()
  .border_color(on === "off" ? t.input : t.accent).bg(on === "on" ? t.accent : NONE)
  .when(on === "on", el => el.child(svg(asset("glyphs/check.svg")).size(size - 3).text_color(t.accent_foreground)))
  .when(on === "some", el => el.child(div().w(size - 6).h(2).bg(t.accent)));

// One row of the results at index i (absolute in its clipped box).
export function contentsRow(tree, s, row, i, t) {
  // `dim` doesn't read on the selected row's tint: its hints are `muted` there.
  const selected = i === s.at, top = i * ROW - s.top, dim = selected ? t.muted : t.dim;
  const base = h_flex().absolute().left(0).right(0).top(top).h(ROW).gap(6).items_center().rounded(5).cursor_pointer()
    .when(selected, el => el.bg(t.selected)).hover(st => st.bg(t.hover));
  if (row.kind === "file") {
    const f = row.f, name = f.path.lastIndexOf("/") + 1, n = f.matches.reduce((k, m) => k + m.ranges.length, 0);
    return base.id(`fm-cs-f-${f.path}`).px(6)
      .on_click((_e, cx) => { s.at = i; tree.foldFile(f.path, cx); })
      .child(svg(asset(`chevron-${s.folded.has(f.path) ? "right" : "down"}.svg`)).size(10).flex_none().text_color(dim))
      .when(Boolean(s.replaceOpen), el => el.child(div().id(`fm-cs-fx-${f.path}-${fileState(f)}`).flex_none().on_click((_e, cx) => {
        cx.stop_propagation();
        const on = fileState(f) !== "on";
        for (const m of f.matches) m.on = on;
        s.confirm = false; cx.notify();
      }).child(box(fileState(f), t))))
      .child(tree.fileIcon(f.path, t))
      .child(h_flex().flex_1().min_w(0).overflow_hidden().gap(6)
        .child(div().flex_none().font_semibold().text_color(f.stale ? dim : t.foreground).child(f.path.slice(name)))
        .when(name > 0, el => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(dim).child(f.path.slice(0, name - 1)))))
      .when(Boolean(f.stale && s.replaceOpen), el => el.child(div().flex_none().text_size(10.5).text_color(readable(t, t.blocked, [t.surface, t.selected, t.hover])).child("changed")))
      .child(div().flex_none().px(5).rounded(8).bg(t.raised).text_size(10.5).text_color(t.muted).child(String(n)));
  }
  const { f, m } = row, ex = excerpt(m);
  return base.id(`fm-cs-l-${f.path}:${m.line}`).pl(22).pr(6)
    .on_click((e, cx) => { s.at = i; if (e.click_count >= 2) tree.openAt(f.path, m.line); else tree.pick({ rel: f.path }, cx); s.input.focus(); cx.notify(); })
    .when(Boolean(s.replaceOpen), el => el.child(div().id(`fm-cs-lx-${f.path}:${m.line}-${m.on === false ? "off" : "on"}`).flex_none().on_click((_e, cx) => {
      cx.stop_propagation(); m.on = m.on === false; s.confirm = false; cx.notify();
    }).child(box(m.on === false ? "off" : "on", t, 11))))
    .child(div().w(30).flex_none().text_size(10.5).text_color(dim).child(String(m.line)))
    .child(h_flex().flex_1().min_w(0).overflow_hidden().text_size(12).text_color(t.muted).children(marked(ex.text, ex.ranges, t)))
    .when(selected && tree.canOpenAt(), el => el.child(div().id(`fm-cs-open-${f.path}:${m.line}`).flex_none().px(4).rounded(4).text_size(11).text_color(dim)
      .hover(st => st.text_color(t.foreground).bg(t.hover)).tooltip(`Open at line ${m.line}`)
      .on_click((_e, cx) => { cx.stop_propagation(); tree.openAt(f.path, m.line); }).child("↗")));
}

// A new search's state for Contents (kept on the Tree's search).
export function contentsState() {
  return { opts: { matchCase: false, wholeWord: false, regex: false }, files: [], folded: new Set(), replaceOpen: false, replaceInput: null, texts: null, confirm: false, done: null };
}
export const newReplaceInput = () => InputState.new({ placeholder: "Replace with…" });
