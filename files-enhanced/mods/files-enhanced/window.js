// Files Enhanced in a window of its own: `mod.open files-enhanced` (cmd-alt-f in this entry's
// keys.json; the same again closes it) opens a copy whose props are only { overlay } (mod.json's
// overlay: a window). The tree as in the panel, without its card (the window has a frame), under a
// slim bar: "Files" and ✕ (no gear: the tree's own opens the settings window). Herdr drags a
// window by any press the mod doesn't stop: the bar drags it; the tree and the bar's controls stop
// their presses.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, theme, closeOverlay } from "herdr";
import { iconButton, CLOSE } from "./iconbutton.js";
import { Tree } from "./tree.js";

/** A copy mod.open opened: an overlay with no role (menus, dialogs and the shared parts have one). */
export const isWindow = (p) => Boolean(p?.overlay) && !p.role;
const stop = (_e, cx) => cx.stop_propagation();

export class FilesWindow {
  constructor(view, cx) { this.tree = new Tree(view, cx, { window: true }); }

  render(cx) {
    const t = theme(), overlay = props()?.overlay;
    return v_flex().id("fm-window").size_full().min_h(0).overflow_hidden().text_color(t.foreground)
      .child(h_flex().id("fm-window-bar").h(30).flex_none().pl(12).pr(4).gap(2).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().text_color(t.muted).child("Files"))
        .child(iconButton(t, "fm-window-close", CLOSE, (cx) => { cx.stop_propagation(); closeOverlay(overlay); }, { tip: "Close (the same key again closes it too)" })
          .on_mouse_down("left", stop)))
      .child(v_flex().id("fm-window-body").flex_1().min_h(0).on_mouse_down("left", stop).child(this.tree.render(cx)));
  }

  close(cx) { return this.tree.close?.(cx); }
}
