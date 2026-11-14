// The icon buttons of a page's top row and of the bar under it, the same in both mods: Files' header
// (search, changed files, pin, new file, new folder, collapse, ⋯, the gear), the Changes page's (Ask
// about diff in a narrow panel, the gear; under it ±'s neighbours Wrap, Split and ⤢), History's (Wrap, the
// layout button, ⤢ / ⤡, ⋯, the gear), the Review tab's ⤡. No frame: 24 px, radius 6, the icon 14 px in
// `muted`; under the pointer on `hover` in `foreground`; while on (a search open, Wrap, a pinned
// folder) on `selected` in `foreground`, as Herdr's tab bar shows the page that is open. Side by side
// they are 2 px apart (iconRow, or a row with ICON_GAP).
// Shared: the same file in both mods (shared/, tools/copy-shared.mjs).
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { pressOn, closingClick } from "./menuat.js";

/** An icon button: `icon` an svg path, or an element (⋯, a glyph: 14 px text); `onClick(cx)`; while
 *  `off` greyed (0.7) and not pressed (History's ⋯ in a folder with no repository). To a screen
 *  reader it is a button named by `label`, else by its tooltip: an icon has no words of its own,
 *  and a tooltip is for the pointer only. `menu`: it opens a menu, which opens at it (menuat.js:
 *  a press keeps where it is); `on` while that menu is open, when a press closes it instead. */
export function iconButton(t, id, icon, onClick, { tip = null, label = null, on = false, off = false, menu = false } = {}) {
  const name = label ?? tip;
  return div().id(id).role("button").when(Boolean(name), (e) => e.accessibility_label(name)).size(24).flex_none().flex().items_center().justify_center().rounded(6).when(on, (e) => e.bg(t.selected)).text_color(on ? t.foreground : t.muted)
    .when(off, (e) => e.opacity(0.7))
    .when(!off, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { if (!(menu && closingClick(id))) onClick(cx); }))
    .when(menu && !off, (e) => e.on_mouse_down("left", pressOn(id, on)))
    .when(Boolean(tip), (e) => e.tooltip(tip))
    .child(typeof icon === "string" ? svg(icon).size(14) : icon);
}

/** Close: Herdr's own x (its workspace-chrome icon, by path), for every close of a page, a window, a
 *  dialog, a line or a note. */
export const CLOSE = "mods/workspace-chrome/x.svg";

/** A drop-down's mark: Herdr's chevron (its workspace-chrome icon, by path), 12 px, at the end of
 *  every button or box that opens a menu (the docs write it ▾). `color`: none inside a button (it
 *  takes the button's words' color), `muted` beside a name. */
export const CHEVRON = "mods/workspace-chrome/chevron-down.svg";
export function chevron(color = null) {
  const mark = svg(CHEVRON).size(12).flex_none();
  return color ? mark.text_color(color) : mark;
}
/** A button's words with the drop-down's mark after them. */
export const withChevron = (words) => h_flex().gap(4).items_center().child(words).child(chevron());

/** Icon buttons side by side: one row, 2 px apart; the row they're in keeps its own spacing to them.
 *  Falsy items are left out. */
export const ICON_GAP = 2;
export const iconRow = (items) => h_flex().flex_none().gap(ICON_GAP).items_center().children(items.filter(Boolean));
