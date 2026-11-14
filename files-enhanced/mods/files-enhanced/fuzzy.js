// Fuzzy file search: the fd patterns for a query, and the ranking and highlighting of what it finds.
// A query's words (split by spaces) must each appear in the path, their letters in order. Ranking:
// more words found in the file name first, then fewer gaps between matched letters (contiguous runs
// first), then the shorter path. Pure: tested in test/files-enhanced/fuzzy.test.mjs.

// What has to be escaped in a Rust regex (what regex::escape escapes).
const META = /[\\.+*?()|[\]{}^$#&\-~]/g;
export const escapeRegex = s => s.replace(META, "\\$&");

// The query's words, lowercased.
export const words = query => String(query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);

// One fd regex per word, matched against the full path under `root` (fd's --full-path matches the
// absolute path, so each is anchored below the root, whose own letters would match everything):
// "ab c" under /r -> ["^/r/.*a.*b", "^/r/.*c"]. fd takes the first as its pattern, the rest with --and.
export function patterns(query, root) {
  const head = "^" + escapeRegex(String(root ?? "").replace(/\/+$/, "")) + "/";
  return words(query).map(w => head + ".*" + [...w].map(escapeRegex).join(".*"));
}

// Where w's letters fall in s (both lowercased), from index `from` on, with the fewest gaps (a gap: a
// letter that isn't right after the one before); ties go to the earliest end. Null when they don't
// all appear in order.
export function bestMatch(s, w, from = 0) {
  const n = s.length - from, m = w.length;
  if (!m) return { gaps: 0, at: [] };
  if (m > n) return null;
  // cost[j]: fewest gaps with w[..i] matched and w[i] at s[from + j]; back[i][j]: where w[i - 1] was.
  let cost = new Array(n).fill(Infinity);
  for (let j = 0; j < n; j++) if (s[from + j] === w[0]) cost[j] = 0;
  const back = [null];
  for (let i = 1; i < m; i++) {
    const next = new Array(n).fill(Infinity), prev = new Array(n).fill(-1);
    let best = Infinity, bestAt = -1; // the cheapest w[i - 1] at least two letters back
    for (let j = 0; j < n; j++) {
      if (j >= 2 && cost[j - 2] < best) { best = cost[j - 2]; bestAt = j - 2; }
      if (s[from + j] !== w[i]) continue;
      const run = j >= 1 ? cost[j - 1] : Infinity, gap = best + 1;
      if (run <= gap && run < Infinity) { next[j] = run; prev[j] = j - 1; }
      else if (gap < Infinity) { next[j] = gap; prev[j] = bestAt; }
    }
    cost = next; back.push(prev);
  }
  let end = -1;
  for (let j = 0; j < n; j++) if (cost[j] < (end < 0 ? Infinity : cost[end])) end = j;
  if (end < 0) return null;
  const at = new Array(m);
  for (let i = m - 1, j = end; i >= 0; j = back[i] ? back[i][j] : -1, i--) at[i] = from + j;
  return { gaps: cost[end], at };
}

// Whether w's letters are all in s, in order (the cheap test before bestMatch).
const has = (s, w) => { let i = 0; for (let j = 0; j < s.length && i < w.length; j++) if (s[j] === w[i]) i++; return i === w.length; };

// A path's score for the words, or null when one of them isn't in it.
export function score(rel, ws) {
  const p = rel.toLowerCase(), name = p.lastIndexOf("/") + 1, at = new Set();
  let base = 0, gaps = 0;
  for (const w of ws) {
    if (!has(p, w)) return null;
    const inName = bestMatch(p, w, name), m = inName ?? bestMatch(p, w, 0);
    if (!m) return null;
    if (inName) base++;
    gaps += m.gaps;
    for (const i of m.at) at.add(i);
  }
  return { rel, base, gaps, at: [...at].sort((a, b) => a - b) };
}

// The paths that match the query, best first, at most `limit`.
export function rank(paths, query, limit = 100) {
  const ws = words(query), out = [];
  if (!ws.length) return out;
  for (const rel of paths) { const s = score(rel, ws); if (s) out.push(s); }
  out.sort((a, b) => b.base - a.base || a.gaps - b.gaps || a.rel.length - b.rel.length || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return out.slice(0, limit);
}

// text[from..to) in runs, `hit` where a matched letter is (for drawing the highlight).
export function spans(text, at, from = 0, to = text.length) {
  const hits = new Set(at), out = [];
  for (let i = from; i < to; i++) {
    const hit = hits.has(i), last = out[out.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else out.push({ text: text[i], hit });
  }
  return out;
}
