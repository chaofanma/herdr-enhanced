// Move to…: a popup copy of this mod with props { role: "moveto", root, on, items: [{ rel, dir }] }:
// the root's folders as a tree (each folder read when it's opened, the Files settings' hidden and
// exclude apply). Pick one with a click (a double-click moves at once) or ↑/↓, then Move (or Enter)
// puts the items there (clipboard.js moveInto); →/← open and close, Esc closes. A folder being moved,
// and what's in it, can't be picked.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, theme, shared } from "herdr";
import { fullOf } from "./paths.js";
import { listFolder } from "./machine.js";
import { asset } from "./id.js";
import { moveInto } from "./clipboard.js";
import { folderName } from "./pins.js";
import { KEYS, settingsOf } from "./panelsettings.js";
import { shown, sorted } from "./listing.js";
import { readable } from "./ink.js";

const ROW = 26;
export const MOVE_SIZE = { width: 320, height: 380 };
// The list's own height: Herdr makes a popup as tall as its content (up to the height asked for), and
// a list that only fills the space left got none there. The rest is the title, the buttons, an
// error line and the padding.
const LIST_HEIGHT = MOVE_SIZE.height - 100;

export class MoveTo {
  constructor(view, cx) {
    this.view = view;
    this.open = new Set([""]); this.subs = new Map(); this.pending = new Set();
    this.at = 0; this.busy = false; this.error = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.load("", cx);
  }

  // A folder's subfolders, read once.
  load(rel, cx) {
    if (this.subs.has(rel) || this.pending.has(rel)) return;
    const p = props();
    this.pending.add(rel);
    cx.spawn(async cx => {
      try {
        const entries = (await listFolder(p.on, fullOf(p.root, rel))).filter(e => e.dir);
        const s = settingsOf(KEYS.files, shared(KEYS.files));
        this.subs.set(rel, sorted(shown(entries, rel, { hidden: s.hidden, exclude: s.exclude })).map(e => e.name));
      } catch (e) { this.subs.set(rel, []); this.error = String(e?.message ?? e); }
      finally { this.pending.delete(rel); cx.notify(); }
    });
  }

  toggle(rel, cx) {
    if (this.open.has(rel) && rel) this.open.delete(rel);
    else { this.open.add(rel); this.load(rel, cx); }
    cx.notify();
  }

  // The rows shown, top to bottom: the root, then each open folder's subfolders.
  rows() {
    const out = [{ rel: "", depth: 0, name: folderName(props().root) || "/" }];
    const walk = (rel, depth) => {
      for (const name of this.subs.get(rel) ?? []) {
        const sub = rel ? `${rel}/${name}` : name;
        out.push({ rel: sub, depth, name });
        if (this.open.has(sub) && out.length < 2000) walk(sub, depth + 1);
      }
    };
    walk("", 1);
    return out;
  }

  // A folder being moved, or one inside it.
  blocked(rel) { return (props().items ?? []).some(x => x.dir && (rel === x.rel || rel.startsWith(x.rel + "/"))); }
  // Where every item is now (a move there does nothing), or null.
  here() {
    const items = props().items ?? [], parents = new Set(items.map(x => (x.rel.includes("/") ? x.rel.slice(0, x.rel.lastIndexOf("/")) : "")));
    return parents.size === 1 ? [...parents][0] : null;
  }

  move(rel, cx) {
    const p = props();
    if (this.busy || rel == null || this.blocked(rel) || rel === this.here()) return;
    Object.assign(this, { busy: true, error: null });
    cx.notify();
    cx.spawn(async cx => {
      const moved = await moveInto(p.root, p.on, p.items.map(x => x.rel), rel).then(() => true, e => { this.error = e instanceof Error ? e.message : String(e); return false; });
      this.busy = false;
      if (moved) closeOverlay(p.overlay);
      cx.notify();
    });
  }

  render() {
    const t = theme(), p = props() ?? {}, rows = this.rows(), n = p.items?.length ?? 0;
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    const target = rows[this.at], ok = target && !this.blocked(target.rel) && target.rel !== this.here();
    const button = (id, text, primary, enabled, act) => h_flex().id(id).h(30).px(12).items_center().rounded(8).text_size(12.5).font_medium()
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .when(!enabled, el => el.opacity(0.7)).when(enabled, el => el.cursor_pointer().hover(s => s.opacity(0.88)).on_click(act)).child(text);
    return v_flex().id("fm-moveto").track_focus(this.handle).size_full().min_h(0).p(8).gap(6).bg(t.popover).text_size(12.8).text_color(t.foreground)
      .on_key_down((e, cx) => {
        const r = rows[this.at];
        if (e.key === "down") this.at = Math.min(rows.length - 1, this.at + 1);
        else if (e.key === "up") this.at = Math.max(0, this.at - 1);
        else if (e.key === "right" && r && !this.open.has(r.rel)) return this.toggle(r.rel, cx);
        else if (e.key === "left" && r?.rel && this.open.has(r.rel)) return this.toggle(r.rel, cx);
        else if (e.key === "enter") return this.move(r?.rel, cx);
        else if (e.key === "escape") { closeOverlay(p.overlay); return; }
        else return;
        cx.notify();
      })
      .child(div().px(4).text_size(12).text_color(t.muted).truncate().child(`Move ${n === 1 ? p.items[0].rel : `${n} items`} to…`))
      .child(v_flex().id("fm-moveto-tree").h(LIST_HEIGHT).flex_none().overflow_y_scrollbar()
        .children(rows.map((r, i) => {
          const blocked = this.blocked(r.rel), open = this.open.has(r.rel), now = r.rel === this.here();
          return h_flex().id(`fm-mtr-${r.rel || "/"}`).h(ROW).flex_none().pl(4 + r.depth * 14).pr(6).gap(6).items_center().rounded(6)
            .when(i === this.at, el => el.bg(t.selected))
            .when(!blocked, el => el.cursor_pointer().hover(s => s.bg(t.hover)))
            .when(blocked, el => el.opacity(0.7))
            .on_click((e, cx) => { this.at = i; if (e.click_count >= 2) return this.move(r.rel, cx); cx.notify(); })
            .child(r.rel
              ? div().id(`fm-mt-chev-${r.rel}`).size(14).flex_none().flex().items_center().justify_center().cursor_pointer()
                .on_click((_e, cx) => { cx.stop_propagation(); this.toggle(r.rel, cx); })
                .child(svg(asset(`chevron-${open ? "down" : "right"}.svg`)).size(12).text_color(t.muted))
              : div().w(14).flex_none())
            .child(svg(asset("folder.svg")).size(14).flex_none().text_color(t.accent))
            .child(div().flex_1().min_w(0).truncate().child(r.name))
            .when(now, el => el.child(div().flex_none().text_size(11).text_color(t.muted).child("here now")))
            .when(this.pending.has(r.rel), el => el.child(svg(asset("glyphs/spinner.svg")).size(10).flex_none().text_color(t.muted).spin(900)));
        })))
      .child(div().h(16).px(4).text_size(11.5).text_color(readable(t, t.blocked, t.popover)).truncate().child(this.error ?? ""))
      .child(h_flex().pt(2).justify_end().gap(8)
        .child(button("fm-mt-cancel", "Cancel", false, true, () => closeOverlay(props().overlay)))
        .child(button("fm-mt-ok", this.busy ? "Moving…" : target ? `Move to ${target.name}` : "Move", true, ok && !this.busy, (_e, cx) => this.move(target?.rel, cx))));
  }
}
