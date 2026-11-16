// Draft review comments (the comment box and the cards under diff lines) and the messages that go to
// the space's agent: Submit review, Ask about lines, Ask about the diff. A comment is
// { id, path, start, end, quote, text, at }: start and end describe its first and last diff rows
// ({ kind, number, text }), so it finds its rows again after the diff is read anew, and quote keeps
// the lines as they were, for the message when they have left the diff. A comment on a whole file
// has no start or end. Drafts are kept per repository and scope in a shared key.
// No imports: tested with node (test/git-enhanced/comments.test.mjs).

/** A row as a comment remembers it. */
export const describe = (row) => ({ kind: row.kind, number: row.number ?? null, text: row.text });

/** Where a remembered row is in `rows` now: the same kind, number and text; else the same kind and
 *  text nearest to where it was (lines above it changed); else -1. */
export function findRow(rows, d) {
  if (!d) return -1;
  const exact = rows.findIndex((r) => r.kind === d.kind && (r.number ?? null) === d.number && r.text === d.text);
  if (exact >= 0) return exact;
  let best = -1, gap = Infinity;
  rows.forEach((r, i) => {
    if (r.kind !== d.kind || r.text !== d.text) return;
    const g = Math.abs((r.number ?? 0) - (d.number ?? 0));
    if (g < gap) { gap = g; best = i; }
  });
  return best;
}

/** The rows from..to (indexes) as quoted lines: the new file's line number (a removed line: "-")
 *  and the text; a hunk header as it is. */
export function quoteOf(rows, from, to) {
  const part = rows.slice(from, to + 1).filter((r) => r.kind !== "");
  const width = Math.max(1, ...part.map((r) => String(r.number ?? "").length));
  return part.map((r) => (r.kind === "@" ? r.text : `${(r.kind === "-" ? "-" : String(r.number ?? "")).padStart(width)} ${r.kind === " " ? " " : r.kind} ${r.text}`));
}

/** The rows from..to in words: "line 12", "lines 12–14", "removed lines" (only removed ones). */
export function spanOf(rows, from, to) {
  const numbers = rows.slice(from, to + 1).filter((r) => r.kind === "+" || r.kind === " ").map((r) => r.number).filter((n) => n != null);
  if (!numbers.length) return rows.slice(from, to + 1).some((r) => r.kind === "-") ? (to > from ? "removed lines" : "a removed line") : "this hunk";
  const a = Math.min(...numbers), b = Math.max(...numbers);
  return a === b ? `line ${a}` : `lines ${a}–${b}`;
}

/** A new comment's id. */
export const commentId = (now = Date.now(), rand = Math.random()) => `c${now.toString(36)}${Math.floor(rand * 1296).toString(36)}`;

/** A file's change in words, for a comment on the whole file: "renamed from old.txt, +2 −2". */
export function describeFile(f) {
  const what = f.from ? `renamed from ${f.from}` : ({ A: "added", D: "deleted", U: "in conflict" })[f.status] ?? "modified";
  return [what, f.binary ? "binary" : `+${f.add ?? 0} −${f.del ?? 0}`].join(", ");
}

/** A comment on rows from..to of file `path` (or the whole file when from is null; `about`: the
 *  file's change in words). */
export function makeComment({ rows, path, from = null, to = null, text, about = null, now = Date.now(), id = commentId(now) }) {
  if (from === null) return { id, path, start: null, end: null, quote: [], about, text, at: now };
  const a = Math.min(from, to ?? from), b = Math.max(from, to ?? from);
  return { id, path, start: describe(rows[a]), end: describe(rows[b]), quote: quoteOf(rows, a, b), span: spanOf(rows, a, b), text, at: now };
}

/** Where a comment's rows are in `rows` now: { from, to }, or null (they left the diff, or it is a
 *  whole-file comment). */
export function placeOf(rows, c) {
  if (!c.start) return null;
  const from = findRow(rows, c.start), to = findRow(rows, c.end);
  return from >= 0 && to >= from ? { from, to } : null;
}

/** The drafts' key: the machine (empty here), the repository and the scope. */
export const draftKey = (on, root, scope) => `${on ?? ""}:${root}:${scope}`;

/** The drafts kept under `key` in the shared map (a list, oldest first). */
export const draftsOf = (map, key) => (map && Array.isArray(map[key]) ? map[key].filter((c) => c && typeof c.id === "string" && typeof c.path === "string") : []);

/** The shared map with `list` as `key`'s drafts (none: the key goes); at most `keep` keys stay. */
export function withDrafts(map, key, list, keep = 100) {
  const next = { ...(map && typeof map === "object" && !Array.isArray(map) ? map : {}) };
  delete next[key];
  if (list.length) next[key] = list;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - keep))) delete next[k];
  return next;
}

const plural = (n, word) => (n === 1 ? `1 ${word}` : `${n} ${word}s`);
const fence = (lines) => ["```", ...lines, "```"].join("\n");

/** Submit review's message: what was reviewed (`where`: the repository and where it is; `scope`:
 *  the scope in words), then each comment with its file, lines, quote and words. */
export function reviewMessage({ where, scope, comments }) {
  const parts = comments.map((c) => {
    const head = `### ${c.path}${c.start ? `, ${c.span ?? "lines"}` : ` (the whole file${c.about ? `: ${c.about}` : ""})`}`;
    return [head, ...(c.quote?.length ? [fence(c.quote)] : []), `Comment: ${c.text}`].join("\n");
  });
  return `Review of ${where}: ${scope}. ${plural(comments.length, "comment")}. Line numbers are the new file's; "-" marks a removed line.\n\n${parts.join("\n\n")}`;
}

/** Ask about rows from..to of a file's diff: the context the send dialog shows. */
export function askLinesMessage({ where, view, rows, from, to }) {
  return `In ${where}, ${spanOf(rows, from, to)} of the diff (${view}; the new file's line numbers; "-" marks a removed line):\n\n${fence(quoteOf(rows, from, to))}`;
}

/** Ask about a file's whole diff (at most `max` rows). */
export function askDiffMessage({ where, view, rows, max = 400 }) {
  const shown = rows.slice(0, max), lines = quoteOf(shown, 0, shown.length - 1);
  return `The diff of ${where} (${view}):\n\n${fence(lines)}${rows.length > max ? `\n(${rows.length - max} more rows not shown)` : ""}`;
}
