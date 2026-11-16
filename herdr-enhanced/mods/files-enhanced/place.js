// Based on Herdr's shipped Files mod (Apache-2.0); changed: its location() with pins and held roots.
// Where the tree is. Herdr's Files mod's way: the focused pane's live folder, else the focused block's,
// else the space's, on the space's machine (a terminal block's address says its machine). On top of
// that, a folder pinned for the space (own("pins")) wins, and with the Files setting follow off the root
// a copy showed first for a space stays (`held`: space id -> { path, on }) until ‹, the roots popup or a
// pin changes it.
import { spaces, panes, focused, shared } from "herdr";
import { KEYS, settingsOf } from "./panelsettings.js";
import { pins } from "./roots.js";

export const prefs = () => settingsOf(KEYS.files, shared(KEYS.files));

// { cwd: the root shown, on, space, pinned, held, follow: the terminal's folder, followOn: its machine }.
export function location(held) {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  const follow = pane?.cwd || f?.cwd || space?.folder, pin = space ? pins()[space.id] : null, following = prefs().follow;
  // Following again forgets the held roots: turned off later, the tree stays where it is then.
  if (held?.size && following) held.clear();
  const base = { space: space?.id, follow, followOn: on };
  if (pin?.path) return { ...base, cwd: pin.path, on: pin.on ?? null, pinned: true, held: false };
  if (held && space && !following) {
    if (!held.has(space.id) && follow) held.set(space.id, { path: follow, on });
    const h = held.get(space.id);
    if (h) return { ...base, cwd: h.path, on: h.on, pinned: false, held: true };
  }
  return { ...base, cwd: follow, on, pinned: false, held: false };
}

// What the tree keeps its open folders and preview under: the root shown, where, for which space.
export const placeKey = l => JSON.stringify({ cwd: l.cwd, on: l.on, space: l.space });
