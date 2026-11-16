// A read-only diff of several files at once (the stash view): the patch cut into files, and the
// rows drawn for them (a title row per file, then its hunks with line numbers). Token colors
// come from the caller (`colorize`); tabs are spaces to the next multiple of four columns (wrap.js
// expandTabs). No Herdr imports: tested with node (test/git-enhanced/diffview.test.mjs).
import { expandTabs } from "./wrap.js";

// A path as git writes it in a patch: C-quoted ("t\303\251.txt") when odd, its bytes UTF-8.
const NAMED = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, "\"": 34, "\\": 92 };
export function unquotePath(s) {
  if (!s.startsWith("\"")) return s;
  let out = "";
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (c === "\"") { try { return decodeURIComponent(out); } catch { return null; } }
    if (c !== "\\") { out += encodeURIComponent(c); continue; }
    const d = s[++i];
    if (/[0-7]/.test(d ?? "")) { out += `%${parseInt(s.slice(i, i + 3), 8).toString(16).padStart(2, "0")}`; i += 2; }
    else if (d in NAMED) out += encodeURIComponent(String.fromCharCode(NAMED[d]));
    else return null;
  }
  return null;
}

// The path both sides of "diff --git a/P b/P" name, or null (a rename names two).
function bothSides(rest) {
  if (rest.startsWith("\"")) {
    const end = rest.indexOf("\" ", 1), a = end > 0 ? unquotePath(rest.slice(0, end + 1)) : null, b = end > 0 ? unquotePath(rest.slice(end + 2)) : null;
    return a?.startsWith("a/") && b === `b/${a.slice(2)}` ? a.slice(2) : null;
  }
  const n = (rest.length - 5) / 2, p = rest.slice(2, 2 + n);
  return Number.isInteger(n) && n > 0 && rest.startsWith("a/") && rest.slice(2 + n) === ` b/${p}` ? p : null;
}

// A path after a header line's a/ or b/ (none for "rename from" lines), or null for /dev/null.
function sidePath(s, prefix) {
  const p = unquotePath(s);
  if (p === null || p === "/dev/null") return null;
  return prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

/** A patch (git diff, git stash show -p, with a/ and b/ prefixes) as its files:
 *  `{ path, from, status, binary, lines }`. `status`: "A" added, "D" deleted, "R" renamed (`from`
 *  its old path), else "M"; `lines`: the file's hunks, from its first @@ line on. */
export function patchFiles(text = "") {
  const files = [];
  let f = null, header = false;
  for (const line of text.replace(/\n$/, "").split("\n")) {
    if (line.startsWith("diff --git ")) {
      f = { path: bothSides(line.slice(11)), from: null, status: "M", binary: false, lines: [] };
      files.push(f); header = true;
      continue;
    }
    if (!f) continue;
    if (header && !line.startsWith("@@")) {
      if (line.startsWith("new file mode")) f.status = "A";
      else if (line.startsWith("deleted file mode")) f.status = "D";
      else if (line.startsWith("rename from ")) { f.from = sidePath(line.slice(12), ""); f.status = "R"; }
      else if (line.startsWith("rename to ")) f.path = sidePath(line.slice(10), "") ?? f.path;
      else if (line.startsWith("Binary files ") || line === "GIT binary patch") f.binary = true;
      else if (line.startsWith("+++ ") && f.path === null) f.path = sidePath(line.slice(4), "b/");
      else if (line.startsWith("--- ") && f.path === null) f.path = sidePath(line.slice(4), "a/");
      continue;
    }
    header = false;
    f.lines.push(line);
  }
  return files.filter((x) => x.path !== null);
}

const WORDS = { A: "added", D: "deleted", R: "renamed", M: "modified" };
const PLAIN = { lang: () => null, tokenize: (text) => ({ spans: [{ text, cls: "" }], state: null }) };

/** The rows for `files` (patchFiles): `{ kind: "file", path, from, status, words, text }` before
 *  each file's lines, then its lines: `"@"` (a hunk header), `"+"`, `"-"`, `" "`, or `""` ("\ No
 *  newline at end of file"), each with `number` (the new file's line; the old one for "-") and
 *  `spans`; a binary or empty file gets a `"note"` row. `colorize`: { lang(path), tokenize(text,
 *  lang, state) → { spans, state } } for token colors (plain without). At most `max` rows, then a
 *  note says how many lines were left out. */
export function patchRows(files, { max = 4000, colorize = PLAIN } = {}) {
  const rows = [];
  let left = 0;
  for (const f of files) {
    if (rows.length >= max) { left += f.lines.length + 1; continue; }
    rows.push({ kind: "file", path: f.path, from: f.from, status: f.status, words: WORDS[f.status] ?? "modified", text: f.from ? `${f.from} → ${f.path}` : f.path });
    if (f.binary || !f.lines.length) { rows.push({ kind: "note", text: f.binary ? "Binary file" : f.status === "R" ? "Renamed, the content is the same" : "No text changes (mode only)" }); continue; }
    const lang = colorize.lang(f.path);
    let oldLine = 0, newLine = 0, state = null;
    for (const line of f.lines) {
      if (rows.length >= max) { left++; continue; }
      const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      if (h) { oldLine = Number(h[1]); newLine = Number(h[2]); state = null; rows.push({ kind: "@", text: expandTabs(line) }); continue; }
      const kind = line[0] === "+" || line[0] === "-" || line[0] === " " ? line[0] : "";
      if (!kind) { rows.push({ kind, text: line }); continue; }
      const text = expandTabs(line.slice(1) || " "), colored = colorize.tokenize(text, lang, state);
      state = colored.state;
      rows.push({ kind, number: kind === "-" ? oldLine++ : newLine++, text, spans: colored.spans });
      if (kind === " ") oldLine++;
    }
  }
  if (left) rows.push({ kind: "note", text: `… ${left} more lines not shown` });
  return rows;
}

/** How many files and lines a patch changes: `{ files, add, del }`. */
export function patchCounts(files) {
  let add = 0, del = 0;
  for (const f of files) for (const l of f.lines) { if (l[0] === "+") add++; else if (l[0] === "-") del++; }
  return { files: files.length, add, del };
}
