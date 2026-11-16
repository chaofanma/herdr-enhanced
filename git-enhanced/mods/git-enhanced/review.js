// The review tab's pure parts (main.js in review mode): side-by-side rows, the
// changed words of a removed/added pair, and the hash that tells a viewed
// file's diff changed. No Herdr imports: tested with node (test/git-enhanced/review.test.mjs).

/** Side-by-side rows from unified diff rows (`kind`: "@", "-", "+", " " or "" for anything
 *  else): `{ header: i }` for a @@ row, `{ left: i, right: i }` for context, and a run of "-"
 *  rows paired row by row with the run of "+" rows after it (`{ left, right }`, null on the
 *  shorter side). Other rows ("\ No newline at end of file") are `{ note: i }`, after the pairs
 *  of the change they sit in. Indexes are into `rows`. */
export function splitRows(rows) {
  const out = [];
  let dels = [], adds = [], notes = [];
  const flush = () => {
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push({ left: dels[k] ?? null, right: adds[k] ?? null });
    for (const i of notes) out.push({ note: i });
    dels = []; adds = []; notes = [];
  };
  rows.forEach((r, i) => {
    if (r.kind === "-") { if (adds.length) flush(); dels.push(i); }
    else if (r.kind === "+") adds.push(i);
    else if (r.kind === "" && (dels.length || adds.length)) notes.push(i);
    else { flush(); out.push(r.kind === "@" ? { header: i } : r.kind === " " ? { left: i, right: i } : { note: i }); }
  });
  flush();
  return out;
}

/** The removed/added pairs splitRows makes, as [old row, new row]. */
export const pairs = (rows) => splitRows(rows).filter((s) => s.left != null && s.right != null && s.left !== s.right).map((s) => [s.left, s.right]);

const isWord = (c) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
const high = (c) => c !== undefined && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdbff;
const low = (c) => c !== undefined && c.charCodeAt(0) >= 0xdc00 && c.charCodeAt(0) <= 0xdfff;

/** What differs between two lines: `{ a: [start, end], b: [start, end] }`, the part of each
 *  between their common prefix and suffix, widened to whole words. Null when they're equal or
 *  share nothing (the whole line changed). */
export function changedRange(a, b) {
  if (a === b) return null;
  const n = Math.min(a.length, b.length);
  let p = 0, s = 0;
  while (p < n && a[p] === b[p]) p++;
  while (s < n - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  // Back to the start of a word the prefix ends inside, forward to the end of one the suffix starts inside.
  while (p > 0 && (high(a[p - 1]) || (isWord(a[p - 1]) && (isWord(a[p]) || isWord(b[p]))))) p--;
  while (s > 0 && (low(a[a.length - s]) || (isWord(a[a.length - s]) && (isWord(a[a.length - s - 1]) || isWord(b[b.length - s - 1]))))) s--;
  if (p === 0 && s === 0) return null;
  return { a: [p, a.length - s], b: [p, b.length - s] };
}

/** Each paired removed/added row's changed part: Map(row index → [start, end]) into
 *  `text(i)`, the row's text as drawn. */
export function wordRanges(rows, text) {
  const out = new Map();
  for (const [a, b] of pairs(rows)) {
    const r = changedRange(text(a), text(b));
    if (r) { out.set(a, r.a); out.set(b, r.b); }
  }
  return out;
}

/** Spans (`{ text, cls }`, covering a line in order) cut at [start, end): the pieces inside
 *  get `mark: true`. */
export function markSpans(spans, start, end) {
  if (end <= start) return spans;
  const out = [];
  let at = 0;
  for (const s of spans) {
    const from = at, to = at + s.text.length, cuts = [from, Math.min(Math.max(start, from), to), Math.min(Math.max(end, from), to), to];
    at = to;
    for (let k = 0; k < 3; k++) if (cuts[k + 1] > cuts[k]) out.push({ ...s, text: s.text.slice(cuts[k] - from, cuts[k + 1] - from), ...(k === 1 ? { mark: true } : {}) });
  }
  return out;
}

/** A short hash of text (its length and FNV-1a): a viewed file's diff, to see it changed. */
export function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${text.length.toString(36)}-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** The first C-quoted string at the start of `s` (how git writes an odd path), unescaped; null
 *  if it isn't one. Octal escapes are UTF-8 bytes. */
export function unquote(s) {
  if (s[0] !== "\"") return null;
  const named = { a: "\x07", b: "\b", t: "\t", n: "\n", v: "\v", f: "\f", r: "\r", "\"": "\"", "\\": "\\" };
  let encoded = "";
  try {
    for (let i = 1; i < s.length; i++) {
      const c = String.fromCodePoint(s.codePointAt(i));
      i += c.length - 1;
      if (c === "\"") return decodeURIComponent(encoded);
      if (c !== "\\") { encoded += encodeURIComponent(c); continue; }
      const d = s[++i];
      if (/^[0-7]$/.test(d ?? "")) { encoded += `%${parseInt(s.slice(i, i + 3), 8).toString(16).padStart(2, "0")}`; i += 2; }
      else if (d !== undefined && Object.prototype.hasOwnProperty.call(named, d)) encoded += encodeURIComponent(named[d]);
      else return null;
    }
  } catch { return null; }
  return null;
}

/** The path a "diff --git " header names (the rest of the line): `a/P b/P`, or both C-quoted.
 *  Null when it can't be told (a rename's two paths). */
export function headerPath(rest) {
  if (rest.startsWith("\"")) { const q = unquote(rest); return q?.startsWith("a/") ? q.slice(2) : null; }
  const n = (rest.length - 5) / 2, path = rest.slice(2, 2 + n);
  return Number.isInteger(n) && n > 0 && rest.startsWith("a/") && rest.slice(2 + n) === ` b/${path}` ? path : null;
}

/** `git diff` output of many files cut at each "diff --git" line: Map(path → its text). A
 *  path in two pieces (a type change) gets both. */
export function diffsByPath(stdout) {
  const out = new Map();
  let path = null, chunk = [];
  const close = () => { if (path !== null) out.set(path, (out.get(path) ?? "") + chunk.join("\n") + "\n"); };
  for (const line of stdout.replace(/\n$/, "").split("\n")) {
    if (line.startsWith("diff --git ")) { close(); path = headerPath(line.slice(11)); chunk = [line]; }
    else if (path !== null) chunk.push(line);
  }
  close();
  return out;
}
