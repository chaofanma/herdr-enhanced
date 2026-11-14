// The tree's selection: the row last clicked (the cursor, which the keys move) and, after a ⌘-click or a
// Shift-click, a set of rows. A plain click selects one row; ⌘ toggles a row in the set; Shift selects
// the rows from the anchor (the last row clicked without Shift) to this one, in the order shown; ⌘⇧
// adds that range to the set. Pure: tested in test/files-enhanced/selection.test.mjs.

// state: { cursor, anchor, set } (set: a Set or an array of paths; empty: just the cursor). `mods`: a
// click's modifiers (platform = ⌘ on macOS, the Windows key elsewhere). `order`: the paths shown, top
// to bottom. Returns the next { cursor, anchor, set: Set }.
export function clickSelect(state, path, mods = {}, order = []) {
  const was = new Set(state?.set ?? []);
  if (!was.size && state?.cursor) was.add(state.cursor);
  if (mods.shift) {
    const anchor = state?.anchor ?? state?.cursor ?? path, a = order.indexOf(anchor), b = order.indexOf(path);
    if (a < 0 || b < 0) return { cursor: path, anchor: path, set: new Set([path]) };
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    return { cursor: path, anchor, set: new Set(mods.platform ? [...was, ...range] : range) };
  }
  if (mods.platform) {
    if (was.has(path)) was.delete(path); else was.add(path);
    return { cursor: path, anchor: path, set: was };
  }
  return { cursor: path, anchor: path, set: new Set([path]) };
}

// The selected paths in the order shown (rows no longer shown left out).
export const inOrder = (set, order) => order.filter(p => set.has(p));

// The folder holding all of these paths (relative, "" for the root): where a batch's archive goes.
export function commonFolder(paths) {
  const parts = paths.map(p => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")).split("/") : []));
  if (!parts.length) return "";
  const out = [];
  for (let i = 0; parts.every(x => i < x.length && x[i] === parts[0][i]); i++) out.push(parts[0][i]);
  return out.join("/");
}

// The paths without the ones inside another of them (a folder and a file in it: the folder), in their
// order.
export function outermost(paths) {
  const all = new Set(paths), out = [];
  for (const p of all) {
    let inside = false;
    for (let q = p; q.includes("/") && !inside;) { q = q.slice(0, q.lastIndexOf("/")); inside = all.has(q); }
    if (!inside) out.push(p);
  }
  return out;
}
