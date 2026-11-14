// The shown folder's bookkeeping for the header: its name, the folder above it, and the list of recent
// roots. Places are { path, on } (on: the machine, null here). Pure: tested in test/files-enhanced/pins.test.mjs.

// A folder's last name ("/" for the top, "C:" for a drive).
export function folderName(path) {
  const parts = (path ?? "").split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path ?? "";
}

// The folder above, or null at the top ("/", "C:\", "\\server\share").
export function up(path) {
  const p = (path ?? "").replace(/(.)[\\/]+$/, "$1");
  if (!p || p === "/" || p === "\\" || /^[a-z]:[\\/]?$/i.test(p) || /^\\\\[^\\]+\\[^\\]+$/.test(p)) return null;
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (i < 0) return null;
  const head = p.slice(0, i);
  if (!head) return p[0];
  return /^[a-z]:$/i.test(head) ? head + p[i] : head;
}

const same = (a, b) => a.path === b.path && (a.on ?? null) === (b.on ?? null);

// The list with `place` first, once; the same list when it already is first (nothing to save).
export function remember(list, place, max = 16) {
  if (!place?.path) return list;
  if (list.length && same(list[0], place)) return list;
  return [{ path: place.path, on: place.on ?? null }, ...list.filter(x => !same(x, place))].slice(0, max);
}

// What the root popup lists after "Follow terminal": recent roots on this machine, without the
// terminal's own folder, most recent first.
export const recentRoots = (list, on, follow, max = 8) =>
  (list ?? []).filter(x => x?.path && (x.on ?? null) === (on ?? null) && x.path !== follow).slice(0, max);
