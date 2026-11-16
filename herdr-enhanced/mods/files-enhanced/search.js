// The search box, as methods of the tree (tree.js mixes them in): files under the root by a fuzzy match
// of their path, best first (Names: fd, or find where there's none), or the lines that have the text
// (Contents, ⌘⇧F: csearch.js). It takes the tree's place until Esc. Here or on the space's machine.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { settings } from "herdr";
import { fullOf, parentOf, nameOf } from "./paths.js";
import { findFiles, platform } from "./machine.js";
import { searchContents, flatten, readTexts, replaceAll, optionsRow, replaceRow, contentsRow, contentsState, newReplaceInput } from "./csearch.js";
import { rank, spans } from "./fuzzy.js";
import { excluder } from "./listing.js";
import { folderName } from "./pins.js";
import { openSettings, openBy } from "./launch.js";
import { prefs } from "./place.js";
import { markColor } from "./gitstatus.js";
import { asset } from "./id.js";
import { readable } from "./ink.js";

const HIT = 24, HITS = 100; // result rows: height, how many

export const searchMethods = {
  // Whether a path under the root may be listed: settings.hidden and settings.exclude, for every folder
  // on the way (the names search's results).
  listable() {
    const p = prefs(), left = excluder(p.exclude, !this.on && platform() === "windows");
    return rel => {
      const parts = rel.split("/");
      if (!p.hidden && parts.some(x => x.startsWith("."))) return false;
      for (let i = 1; i <= parts.length; i++) if (left(parts.slice(0, i).join("/"))) return false;
      return true;
    };
  },

  openSearch(cx, mode) {
    if (!this.root) return;
    if (!this.search) {
      const s = this.search = { mode: mode ?? "names", query: "", results: [], at: 0, top: 0, height: 0, busy: false, again: false, note: null, error: null, ...contentsState() };
      this.searchInput(s, "");
      // Again once it's drawn: an input not on screen yet may not take the keyboard.
      cx.timer.after(100, () => this.search === s && s.input.focus());
    } else if (mode && mode !== this.search.mode) return this.searchMode(mode, cx);
    this.search.input.focus();
    cx.notify();
  },

  // The query field (made again when the mode changes, for its placeholder).
  searchInput(s, value) {
    s.input?.release();
    const input = s.input = InputState.new({ placeholder: s.mode === "contents" ? "Search in files…" : "Search files…", value });
    input.on("change", (_e, cx) => {
      if (this.search !== s || s.input !== input) return;
      s.query = input.value(); s.timer?.cancel();
      s.timer = cx.timer.after(s.mode === "contents" ? 300 : 200, cx => this.find(cx));
    });
    input.on("submit", (_e, cx) => this.searchEnter(cx));
  },

  // Names | Contents: the same query, searched the other way.
  searchMode(mode, cx) {
    const s = this.search;
    if (!s || s.mode === mode) return;
    s.mode = mode; s.at = 0; s.top = 0; s.results = []; s.files = []; s.note = s.error = null; s.done = null; s.confirm = false;
    this.searchInput(s, s.query);
    s.input.focus();
    this.find(cx);
  },

  toggleReplace(cx) {
    const s = this.search;
    if (!s) return;
    s.replaceOpen = !s.replaceOpen; s.confirm = false;
    if (s.replaceOpen && !s.replaceInput) {
      const input = s.replaceInput = newReplaceInput();
      // A new replacement asks again; Enter asks, then (asked) replaces.
      input.on("change", (_e, cx) => { if (this.search === s) { s.confirm = false; s.done = null; cx.notify(); } });
      input.on("submit", (_e, cx) => { if (this.search !== s) return; if (s.confirm) replaceAll(this, s, cx); else { s.confirm = true; cx.notify(); } });
    }
    if (s.replaceOpen) { s.replaceInput.focus(); readTexts(this, s, cx); }
    cx.notify();
  },

  foldFile(path, cx) {
    const s = this.search;
    if (s.folded.has(path)) s.folded.delete(path); else s.folded.add(path);
    cx.notify();
  },

  // ↗ on a Contents result, or a double-click: the file at that line, the way the Open with setting
  // `line` says ("system": the file in its default app here, without the line; on another machine only
  // an item that can open it there).
  openAt(rel, line) {
    if (!this.canOpenAt()) return;
    openBy(openSettings().line, this.found, { path: fullOf(this.root, rel), dir: false, line, folder: fullOf(this.root, parentOf(rel)), name: nameOf(rel) }, this.place());
  },

  closeSearch(cx) {
    const s = this.search;
    if (!s) return;
    s.timer?.cancel(); s.input.release(); s.replaceInput?.release(); this.search = null;
    this.h.focus(); cx.notify();
  },

  // One search at a time; typing during one runs the latest query after it, and results for a query, a
  // mode or a folder that's no longer shown are dropped.
  find(cx) {
    const s = this.search, query = s?.query.trim();
    if (!s) return;
    if (!query) { s.results = []; s.files = []; s.texts = null; s.note = s.error = null; return cx.notify(); }
    if (s.busy) { s.again = true; return; }
    s.busy = true; cx.notify();
    const context = this.context, root = this.root, on = this.on, mode = s.mode, opts = { ...s.opts }, sig = JSON.stringify(opts);
    const still = () => this.search === s && s.query.trim() === query && s.mode === mode && JSON.stringify(s.opts) === sig && this.current(context);
    cx.spawn(async cx => {
      try {
        if (mode === "contents") {
          const r = await searchContents(root, on, { query, ...opts }, prefs());
          if (!still()) return;
          // The same search again (after a replace) keeps its place; another starts at the top.
          const again = s.searched === sig + query;
          s.searched = sig + query;
          s.files = r.files; s.texts = null; s.reading = false; s.confirm = false; s.error = null;
          if (!again) { s.at = 0; s.top = 0; s.folded = new Set(); s.done = null; }
          s.count = r.count;
          s.note = r.timeout ? "Stopped after 5 s: not every file was searched" : r.limit ? `The first ${r.count} matches: type more to narrow`
            : !r.rg ? "rg isn't installed: searched with grep (.gitignore not read)" : r.skipped ? `${r.skipped} lines that aren't UTF-8 left out` : null;
          if (s.replaceOpen) readTexts(this, s, cx);
          return;
        }
        const r = await findFiles(on, root, query);
        if (!still()) return;
        const all = rank(r.paths.filter(this.listable()), query, Infinity);
        s.results = all.slice(0, HITS); s.at = 0; s.top = 0; s.error = null;
        s.note = r.cut ? "Stopped after 5 s: not every file was searched" : r.fd && r.paths.length >= 400 ? "The first 400 matches, ranked: type more to narrow"
          : !r.fd ? "fd isn't installed: searched with find" : all.length > HITS ? `The best ${HITS} of ${all.length}` : null;
      } catch (e) { if (still()) { s.results = []; s.files = []; s.error = String(e?.message ?? e); } }
      finally {
        if (this.search === s) { s.busy = false; if (s.again) { s.again = false; this.find(cx); } }
        cx.notify();
      }
    });
  },

  // A result: previewed, and shown in the tree (its folders opened, selected) for when the search closes.
  pick(hit, cx) {
    if (!hit || !this.preview.look(hit.rel, cx)) return;
    this.reveal(hit.rel, cx); cx.notify();
  },

  // Enter: a Names result is picked; on Contents, a line previews its file, a file row folds.
  searchEnter(cx) {
    const s = this.search;
    if (!s) return;
    if (s.mode !== "contents") return this.pick(s.results[s.at], cx);
    const row = flatten(s)[s.at];
    if (row?.kind === "file") this.foldFile(row.f.path, cx);
    else if (row) this.pick({ rel: row.f.path }, cx);
  },

  // The search's keys: ↑/↓ move, Enter picks (in the box its submit does), Esc closes. They come from
  // the box, or from the tree when a click on a result left the keyboard there.
  searchKey(e, cx, inBox) {
    const s = this.search, n = s.mode === "contents" ? flatten(s).length : s.results.length;
    if (e.key === "escape") { cx.stop_propagation(); if (s.confirm) { s.confirm = false; return cx.notify(); } return this.closeSearch(cx); }
    if (e.key === "enter") { cx.stop_propagation(); return inBox ? undefined : this.searchEnter(cx); }
    if (e.key !== "down" && e.key !== "up") return;
    if (n) { s.at = (s.at + (e.key === "down" ? 1 : n - 1)) % n; s.reveal = true; }
    cx.stop_propagation(); cx.notify();
  },

  // Rows at fixed offsets in a clipped box (up to HITS names, or the Contents rows): the arrows scroll it
  // just enough to keep the selection in view, the wheel scrolls it freely.
  searchView(t) {
    const s = this.search, contents = s.mode === "contents", list = contents ? flatten(s) : s.results, n = list.length;
    const height = s.height || 300, max = Math.max(0, n * HIT - height);
    s.at = Math.max(0, Math.min(s.at, n - 1));
    if (s.reveal) {
      s.reveal = false;
      if (s.at * HIT < s.top) s.top = s.at * HIT;
      else if ((s.at + 1) * HIT > s.top + height) s.top = (s.at + 1) * HIT - height;
    }
    s.top = Math.max(0, Math.min(s.top, max));
    const first = Math.floor(s.top / HIT), last = Math.min(n, Math.ceil((s.top + height) / HIT));
    const message = s.error || (!s.query.trim() ? `Type to search ${contents ? "in files" : "files"} in ${folderName(this.root)}` : !n ? (s.busy ? "Searching…" : contents ? "No matches" : "No matching files") : null);
    const row = (hit, i) => {
      const name = hit.rel.lastIndexOf("/") + 1, mark = this.marks[hit.rel], color = markColor(mark, t) ?? t.foreground;
      return h_flex().id(`fm-hit-${hit.rel}`).absolute().left(0).right(0).top(i * HIT - s.top).h(HIT).px(8).gap(6).items_center().rounded(5).cursor_pointer()
        .when(i === s.at, el => el.bg(t.selected))
        .hover(st => st.bg(t.hover))
        .on_click((_e, cx) => { s.at = i; this.pick(hit, cx); s.input.focus(); })
        .child(this.fileIcon(hit.rel, t))
        // The name, then its folder (dim; muted on the selected row's tint, where dim doesn't read),
        // with the matched letters in the accent color.
        .child(h_flex().flex_1().min_w(0).overflow_hidden()
          .children(spans(hit.rel, hit.at, name).map(x => div().flex_none().text_color(x.hit ? t.accent : color).when(x.hit, el => el.font_semibold()).child(x.text)))
          .when(name > 0, el => el.child(div().w(8).flex_none())
            .children(spans(hit.rel, hit.at, 0, name - 1).map(x => div().flex_none().text_size(11.5).text_color(x.hit ? t.accent : i === s.at ? t.muted : t.dim).child(x.text)))))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(color).child(mark)));
    };
    const foot = s.done || (n > 0 ? (contents ? [`${s.count} match${s.count === 1 ? "" : "es"} in ${s.files.length} file${s.files.length === 1 ? "" : "s"}`, s.note].filter(Boolean).join(" · ") : s.note) : null);
    return v_flex().id("fm-searchbox").size_full().min_h(0)
      .on_key_down((e, cx) => this.searchKey(e, cx, true))
      .child(h_flex().h(32).flex_none().mx(4).mt(4).px(8).gap(6).items_center().rounded(7).border_1().border_color(t.accent).bg(t.surface)
        .child(svg(asset("glyphs/search.svg")).size(13).flex_none().text_color(t.dim))
        .child(Input.new(s.input).flex_1().h_full().text_size(12.5).text_color(t.foreground))
        .when(s.busy, el => el.child(svg(asset("glyphs/spinner.svg")).size(12).flex_none().text_color(t.dim).spin(900))))
      .child(optionsRow(this, s, t))
      .when(contents && s.replaceOpen && this.caps().write, el => el.child(replaceRow(this, s, t)))
      .child(div().id("fm-results").relative().flex_1().min_h(0).mt(2).overflow_hidden()
        .on_size_change((size, cx) => { s.height = size.height / (Number(settings().zoom) || 1); cx.notify(); })
        .on_scroll_wheel((e, cx) => { s.top = Math.max(0, Math.min(s.top - e.delta.y, max)); cx.notify(); })
        .children(list.slice(first, last).map((hit, i) => (contents ? contentsRow(this, s, hit, first + i, t) : row(hit, first + i))))
        .when(Boolean(message), el => el.child(div().p(8).text_size(12).text_color(s.error ? readable(t, t.blocked) : t.dim).child(message))))
      .when(Boolean(foot), el => el.child(div().flex_none().px(8).py(4).text_size(11).text_color(s.done ? t.foreground : t.dim).child(foot)));
  },
};
