// What one copy of this mod tells the others after it changed files (a menu, a dialog, a save, a
// replace, a paste): shared own("changed") = { t, on, select, files }. Every tree reloads; one whose
// root (on the same machine) holds `select`, a full path, opens the folders down to it and selects it;
// one previewing a file in `files` (full paths) loads it again.
import { shared, setShared } from "herdr";
import { own } from "./id.js";

export const CHANGED = own("changed");

// Says so; returns the tick it set (a tree that made the change knows it has seen it).
export function announce({ on = null, select = null, files = [] } = {}) {
  const t = Date.now() + Math.random();
  setShared(CHANGED, { t, on: on ?? null, select, files });
  return t;
}

// The last announcement, or null.
export const heard = () => shared(CHANGED) ?? null;
