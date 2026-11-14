// The root picker, opened as a popup copy of this mod from the header's folder name with
// props { role: "roots", space, on, root, pinned, follow }: "Follow terminal" and the recent roots.
// Picking one pins it for the space (shared own("pins"): space id -> { path, on }); Follow unpins.
// With the Files setting follow off it reads "Terminal's folder": the tree shows the terminal's folder
// once and stays there (shared own("refollow") tells the trees). ↑/↓ move, Enter picks, Esc closes.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared } from "herdr";
import { folderName, remember, recentRoots } from "./pins.js";
import { KEYS, settingsOf } from "./panelsettings.js";
import { own, asset } from "./id.js";
import { closedNow } from "./menuat.js";

const following = () => settingsOf(KEYS.files, shared(KEYS.files)).follow;

export const PINS = own("pins"), RECENT = own("recent"), REFOLLOW = own("refollow");
export const pins = () => shared(PINS) ?? {};
export function setPin(space, place) {
  const all = { ...pins() };
  if (place?.path) all[space] = { path: place.path, on: place.on ?? null };
  else delete all[space];
  setShared(PINS, all);
}

// Every root shown goes first in own("recent").
export function noteRoot(place) {
  const list = shared(RECENT) ?? [], next = remember(list, place);
  if (next !== list) setShared(RECENT, next);
}

const ROW = 40;
export const places = p => [{ follow: true, path: p.follow }, ...recentRoots(shared(RECENT), p.on, p.follow)];
export const rootsHeight = list => 10 + list.length * ROW;

export class Roots {
  constructor(view, cx) {
    this.view = view;
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  // Herdr closed the popup: the header stops lighting the folder's name (menuat.js).
  close() { closedNow(props()?.overlay); }

  choose(x) {
    const p = props();
    if (x.follow) setShared(REFOLLOW, { space: p.space, t: Date.now() });
    setPin(p.space, x.follow ? null : { path: x.path, on: p.on });
    closeOverlay(p.overlay);
  }

  render() {
    const t = theme();
    const p = props() ?? {}, list = places(p), follows = following();
    const current = x => x.follow ? !p.pinned && (follows || x.path === p.root) : p.pinned && x.path === p.root;
    // Herdr's menu's frame and keys.
    return v_flex()
      .id("fm-roots")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(list[this.at]);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(list.map((x, i) => h_flex().id(`fm-ri-${i}`).h(ROW).px(8).gap(9).rounded(7).items_center().cursor_pointer()
        .when(i === this.at, el => el.bg(t.selected))
        .hover(st => st.bg(t.hover))
        .on_click(() => this.choose(x))
        .child(svg(asset(`glyphs/${x.follow ? "terminal" : "folder"}.svg`)).size(14).flex_none().text_color(t.muted))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_color(t.foreground).child(x.follow ? `${follows ? "Follow terminal" : "Terminal's folder"} (${folderName(x.path) || "no folder"})` : folderName(x.path)))
          .child(div().truncate().text_size(11).text_color(t.muted).child(x.path ?? "")))
        .when(current(x), el => el.child(svg(asset("glyphs/check.svg")).size(12).flex_none().text_color(t.accent)))));
  }
}
