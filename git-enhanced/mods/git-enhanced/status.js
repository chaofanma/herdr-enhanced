// The Changes page's file list: the status's entries (renames.js parseStatusZ) in the Staged and
// Unstaged sections, the files a scope adds (its diff against a ref) in Committed, or a read-only
// scope's own list. Each row is { f, letter, add, del }, f the file ({ path, from, status, fresh,
// binary, repo? }); a file staged and then edited again is in both sections, with each side's numbers.
// A repository inside this one (untracked, so git lists it as its folder: "sub/") is a row with
// `repo: true`: never staged with the rest, never shown as a file (isNestedRepo).
// No imports: tested with node (test/git-enhanced/status.test.mjs).

/** A status code's two sides: the index's letter (null: nothing staged) and the working tree's
 *  (null: nothing unstaged). An untracked file is new in the working tree; a conflict shows as U
 *  there and has no staged side. A type change counts as modified, a copy as added. */
export function sides(xy) {
  if (xy === "??") return { staged: null, unstaged: "A", untracked: true, conflict: false };
  if (!xy || xy === "!!") return { staged: null, unstaged: null, untracked: false, conflict: false };
  if (xy.includes("U") || xy === "AA" || xy === "DD") return { staged: null, unstaged: "U", untracked: false, conflict: true };
  const letter = (c) => (c === " " ? null : c === "T" ? "M" : c === "C" ? "A" : c);
  return { staged: letter(xy[0]), unstaged: letter(xy[1]), untracked: false, conflict: false };
}

/** Whether a status entry ({ xy, path }) is a repository inside this one: with
 *  --untracked-files=all git lists an untracked folder only when it holds a repository of its own,
 *  as "dir/" (the trailing slash kept). */
export const isNestedRepo = (e) => e?.xy === "??" && String(e.path ?? "").endsWith("/");

/** The repositories inside this one among the status entries: their paths as git gives them ("sub/"). */
export const nestedRepos = (entries = []) => entries.filter(isNestedRepo).map((e) => e.path);

/** "a/, b/" of up to `max` paths, then "and N more". */
export function repoList(paths, max = 4) {
  return paths.slice(0, max).join(", ") + (paths.length > max ? `, and ${paths.length - max} more` : "");
}

/** The line after a Stage all (or the commit's stage-everything) that left repositories out. */
export function leftOutLine(paths, what = "Stage all") {
  const n = paths.length;
  return `${what} left out ${n} ${n === 1 ? "repository" : "repositories"} inside this one (${repoList(paths)}): stage one from its right-click menu if you mean to.`;
}

/** Whether anything of a status code is staged (Commit takes it). */
export const isStaged = (xy) => Boolean(sides(xy).staged);

const numbers = (map, path) => map?.get(path) ?? { add: 0, del: 0, binary: false };

/** The sections for the scopes that show the working tree: `entries` (the status), `staged` and
 *  `unstaged` (numstat Maps, renames.js parseNumstatZ), `lines` (Map: an untracked file's line count,
 *  once its content was read), and `committed` (files the scope's diff has that the status
 *  doesn't: [{ path, from, status, add, del, binary }], the Last commit and vs <base> scopes). */
export function sectionsOf({ entries = [], staged = null, unstaged = null, lines = new Map(), committed = [] } = {}) {
  const st = [], un = [];
  for (const e of entries) {
    const s = sides(e.xy);
    if (s.staged) {
      const n = numbers(staged, e.path);
      st.push({ f: { path: e.path, from: s.staged === "R" ? e.from : null, status: s.staged, fresh: false, binary: n.binary }, letter: s.staged, add: n.add, del: n.del });
    }
    if (s.unstaged) {
      const n = s.untracked ? { add: lines.get(e.path) ?? 0, del: 0, binary: false } : numbers(unstaged, e.path);
      // A rename that is only in the working tree (an intent-to-add file) keeps its old path there.
      un.push({ f: { path: e.path, from: s.unstaged === "R" ? e.from : null, status: s.unstaged, fresh: s.untracked, binary: n.binary, ...(isNestedRepo(e) ? { repo: true } : {}) }, letter: s.unstaged, add: n.add, del: n.del });
    }
  }
  const out = [];
  if (st.length) out.push({ key: "staged", label: "Staged", rows: st });
  if (un.length) out.push({ key: "unstaged", label: "Unstaged", rows: un });
  const dirty = new Set(entries.map((e) => e.path));
  const rest = committed.filter((f) => !dirty.has(f.path));
  if (rest.length) out.push({ key: "committed", label: "Committed", rows: rest.map((f) => ({ f: { ...f, fresh: false }, letter: f.status, add: f.add, del: f.del })) });
  return out;
}

/** A scope's own files (git diff <from> [<to>], and with the working tree the untracked files as new
 *  ones): `names` (renames.js parseNameStatusZ), `scope` (numstat Map), `untracked` (paths). */
export function scopeFiles({ names = [], scope = null, untracked = [], lines = new Map() } = {}) {
  const out = names.map((n) => { const c = numbers(scope, n.path); return { path: n.path, from: n.from ?? null, status: n.status === "C" ? "A" : n.status === "T" ? "M" : n.status, add: c.add, del: c.del, binary: c.binary, fresh: false }; });
  const listed = new Set(out.map((f) => f.path));
  for (const p of untracked) if (!listed.has(p)) out.push({ path: p, from: null, status: "A", add: lines.get(p) ?? 0, del: 0, binary: false, fresh: true, ...(p.endsWith("/") ? { repo: true } : {}) });
  return out;
}

/** The section a file's diff comes from on the Uncommitted scope: "staged" (HEAD → index),
 *  "unstaged" (index → working tree), or null (the scope's own diff). */
export const SECTION_BASE = { staged: ["--cached"], unstaged: [] };

/** The row key a file of a section has (ids must be unique: a file can be in two sections). */
export const rowKey = (section, path) => `${section}:${path}`;
