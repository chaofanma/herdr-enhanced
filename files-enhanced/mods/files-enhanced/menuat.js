// Where a menu opened from a button goes: touching the button, as the lists of History's filters and
// Changes' branch box do, instead of where the press landed (a popup's default in Herdr). There the
// menu's corner was wherever on the button the press was, and at the window's edge Herdr pushed the
// menu back over the button: the commit bar's ⋯ and ▾ covered themselves and the pointer.
// The menu goes under the button, GAP px off; over it for a button at the bottom of its page (the
// commit bar's), else under it where the window has no room above. Its right edge lines up with the
// button's for a button at the right of its row, its left edge for one at the left. A press on the
// button keeps its bounds (pressOn: the on_mouse_down event's, in the window, as a popup's `at`); the
// click that follows asks for them (anchorOf). Herdr zooms a popup's width and height
// (settings().zoom), not its `at`.
// A second press on a button whose menu is open closes the menu: Herdr closes a popup at a press
// beside it, so the press only has to keep the click that follows from opening the menu again
// (pressOn's `open`, closingClick).
// A menu that is a copy of the mod itself (Files' menu, its folder list) says when it closes
// (closedNow, from the copy's close()), so the page that opened it knows (whenClosed) and its button
// looks pressed only while the menu is open.
// Shared: the same file in both mods (shared/, tools/copy-shared.mjs).
import { settings } from "herdr";

const GAP = 3;     // px between a button and its menu, as History's filters' lists (listCard)
const MARGIN = 8;  // px Herdr keeps a popup inside the window

// Each menu button at its last press: id → { bounds: { x, y, width, height } in the window,
// closing: its menu was open then }.
const pressed = new Map();

/** The on_mouse_down handler of menu button `id`, `open` whether its menu is open as the button was
 *  drawn: keeps where the button is, for its menu, and whether this press closes the menu. */
export const pressOn = (id, open = false) => (e) => {
  const b = e?.bounds, was = pressed.get(id);
  pressed.set(id, { bounds: b ? { x: b.x, y: b.y, width: b.width, height: b.height } : was?.bounds ?? null, closing: Boolean(open) });
};

/** Whether the click that ends a press on button `id` only closes its menu (Herdr closed it at the
 *  press): then the button doesn't open it again. Asked once per press. */
export function closingClick(id) {
  const p = pressed.get(id);
  if (!p?.closing) return false;
  p.closing = false;
  return true;
}

/** Where button `id`'s menu opens: the button's bounds at its last press, with `side` ("below",
 *  "above") and `align` ("right", "left"); null when it was never pressed (opened another way). */
export function anchorOf(id, { side = "below", align = "right" } = {}) {
  const b = pressed.get(id)?.bounds;
  return b ? { ...b, side, align } : null;
}

/** A popup's `at` for a menu `width` × `height` px (as openOverlay is given them) at `anchor`. */
export function menuAt(anchor, width, height) {
  const z = settings()?.zoom ?? 1;
  const x = anchor.align === "left" ? anchor.x : anchor.x + anchor.width - width * z;
  const over = anchor.y - (GAP + height) * z;
  const y = anchor.side === "above" && over >= MARGIN ? over : anchor.y + anchor.height + GAP * z;
  return { x, y };
}

// Popups a page waits on: overlay id → what settles its wait.
const waiting = new Map();
/** Settles once popup `id` (a copy of this mod) has closed. */
export const whenClosed = (id) => new Promise((resolve) => { waiting.set(id, resolve); });
/** From popup `id`'s copy, as it closes: the page waiting on it goes on. */
export function closedNow(id) {
  const done = waiting.get(id);
  waiting.delete(id);
  done?.();
}
