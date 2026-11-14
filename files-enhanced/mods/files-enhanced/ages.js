// The "Changed" view's list and ages, and which changes are fresh (an agent just touched them).
// Pure: tested in test/files-enhanced/ages.test.mjs.

export const FRESH = 10 * 60 * 1000; // ms: a change this recent gets a dot in the tree (settings.freshMinutes)

// "now", "3m", "2h", "5d": how long ago `ms` (ms since the epoch) was.
export function age(ms, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000);
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}

// Whether a change at `ms` is within `window` ms of now; a window of 0 means never (no dot).
export const fresh = (ms, now = Date.now(), window = FRESH) => window > 0 && ms != null && now - ms < window;

// The changed files among git marks (folders' "dir:" dots left out) with their times (a Map of path
// -> ms), most recently modified first; files without a time (deleted ones) last, by path.
export function changedFiles(marks, times) {
  return Object.keys(marks ?? {}).filter(k => !k.startsWith("dir:"))
    .map(path => ({ path, mark: marks[path], mtime: times?.get(path) ?? null }))
    .sort((a, b) => (b.mtime ?? -Infinity) - (a.mtime ?? -Infinity) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// Lines of "<seconds>\t<path>" (what stat prints in mtimes()) as a Map of path -> ms.
export function parseTimes(out) {
  const times = new Map();
  for (const line of String(out ?? "").split("\n")) {
    const tab = line.indexOf("\t"), s = Number(line.slice(0, tab));
    if (tab > 0 && Number.isFinite(s)) times.set(line.slice(tab + 1), s * 1000);
  }
  return times;
}
