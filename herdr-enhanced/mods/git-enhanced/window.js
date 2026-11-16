// Git Enhanced in a window of its own: `mod.open git-enhanced` (cmd-alt-g in this entry's
// keys.json; the same again closes it) opens a copy whose props are only { overlay } (mod.json's
// overlay: a window). The Changes page, or History, under a slim bar: Changes | History and ✕ (no
// gear: each page has its own, for the settings window). Herdr drags a window by any press the mod
// doesn't stop: the bar drags it; the page and the bar's controls stop their presses. A window copy
// doesn't fetch or record turns by itself (prefs.js fetchesItself): the panel's copy does.
// The switch itself (PageSwitch) is a panel block's too, where no tab header of ours leads to
// History (block.js): there as one segmented control in place of the page's name (titleSwitch).
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, theme, closeOverlay } from "herdr";
import { ChangesPage } from "./changes.js";
import { HistoryPage } from "./historypage.js";
import { CLEAR } from "./look.js";
import { iconButton, CLOSE } from "./iconbutton.js";

/** A copy mod.open opened: an overlay that is none of the mod's dialogs, menus or shared parts
 *  (main.js asks for those first) and no page of a layout. */
export const isWindow = (p) => Boolean(p?.overlay) && !p.role && !p.view && !p.review;
const stop = (_e, cx) => cx.stop_propagation();
const PAGES = [["changes", "Changes"], ["history", "History"]];

/** The slim bar Changes | History sits in: 32 px, a line under it. */
export const switchBar = (t, id) => h_flex().id(id).h(32).flex_none().pl(8).pr(4).gap(2).items_center().border_b(1).border_color(t.border);

/** Changes | History, one page shown, `changes` first: a ChangesPage whose init() the code holding
 *  the switch runs (ChangesWindow.init, or main.js for a layout block). History starts the first
 *  time it's asked for, then stays as it was. */
export class PageSwitch {
  constructor(changes) { this.page = "changes"; this.pages = { changes }; }

  show(page, cx) {
    if (!this.pages[page]) { const p = new HistoryPage(); p.init(cx); this.pages[page] = p; this.started?.(p); }
    this.page = page;
    cx.notify();
  }
  shown() { return this.pages[this.page]; }

  /** The two tabs, ids `<prefix>-tab-changes` and `<prefix>-tab-history`; `own(el)` adds what the bar
   *  needs of each (the window: they stop their presses). */
  tabs(t, prefix, own = (e) => e) {
    return PAGES.map(([id, label]) => own(div().id(`${prefix}-tab-${id}`).h(24).px(10).flex().flex_none().items_center().rounded(6).text_size(12)
      .text_color(this.page === id ? t.foreground : t.muted).when(this.page === id, (e) => e.bg(t.raised).font_medium())
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); if (this.page !== id) this.show(id, cx); })
      .child(label)));
  }

  /** The two pages as one segmented control (controls.js segmented's look), for a page's own top
   *  row in place of its name (block.js): the frame `<prefix>-switch`, the pages
   *  `<prefix>-tab-changes` and `<prefix>-tab-history`. */
  titleSwitch(t, prefix) {
    return h_flex().id(`${prefix}-switch`).p(2).gap(2).flex_none().items_center().rounded(7).border_1().border_color(t.border).bg(t.surface)
      .children(PAGES.map(([id, label]) => {
        const on = this.page === id;
        return div().id(`${prefix}-tab-${id}`).h(20).px(9).flex().flex_none().items_center().rounded(5).border_1().text_size(12)
          .border_color(on ? t.border : CLEAR).bg(on ? t.raised : CLEAR).text_color(on ? t.foreground : t.muted)
          .when(!on, (e) => e.cursor_pointer().hover((s) => s.text_color(t.foreground)))
          .on_click((_e, cx) => { cx.stop_propagation(); if (this.page !== id) this.show(id, cx); })
          .child(label);
      }));
  }

  gone() { for (const p of Object.values(this.pages)) p.gone?.(); }
  async close(cx) { for (const p of Object.values(this.pages)) await p.close?.(cx); }
}

export class ChangesWindow extends PageSwitch {
  constructor() { super(new ChangesPage()); }
  init(cx) { this.pages.changes.init(cx); }

  render(cx) {
    const t = theme(), overlay = props()?.overlay;
    return v_flex().id("changes-window").size_full().min_h(0).overflow_hidden().text_color(t.foreground)
      .child(switchBar(t, "changes-window-bar")
        .children(this.tabs(t, "window", (e) => e.on_mouse_down("left", stop))).child(div().flex_1())
        .child(iconButton(t, "changes-window-close", CLOSE, (cx) => { cx.stop_propagation(); closeOverlay(overlay); }, { tip: "Close (the same key again closes it too)" })
          .on_mouse_down("left", stop)))
      .child(v_flex().id("changes-window-body").flex_1().min_h(0).p(6).on_mouse_down("left", stop).child(this.shown().render(cx)));
  }
}
