// The Contents search: running rg (or grep without it) under the root, reading what it printed, and
// replacing matches in a file's text. Pure: tested in test/files-enhanced/contents.test.mjs. The search runs in
// SEARCH (a shell wrapper that stops it after a time and a number of matches).

import { escapeRegex } from "./fuzzy.js";
import { ID } from "./id.js";

// Matches kept and bytes read at most, seconds a search may take.
export const MAX = 2000, BYTES = 6 * 1024 * 1024, SECONDS = 5;

// Runs "$@" (rg or grep) writing into a fifo, reads at most <max> matches and <cap> bytes of it, and
// stops it after <seconds>: sh -c SEARCH files <seconds> <max> <cap> <json: 1 | 0> <program> <args…>.
// Exit codes: the program's (rg: 0 found, 1 none, 2 error), 127 when it isn't installed, 143 when it
// was stopped (time or enough matches). Its stderr comes after (2000 bytes); the shell's own notices
// about stopped jobs don't. Nothing left running holds the output open (fd 3 is closed for them), so
// it ends when the search does.
export const SEARCH = 'exec 3>&2 2>/dev/null; s=$1 max=$2 cap=$3 json=$4; shift 4; command -v "$1" >/dev/null 2>&1 || exit 127; '
  + `d=$(mktemp -d "\${TMPDIR:-/tmp}/${ID}-search.XXXXXX") || exit 1; ` + 'mkfifo "$d/p" || { rm -rf "$d"; exit 1; }; '
  + '"$@" > "$d/p" 2> "$d/e" 3>&- & r=$!; ( sleep "$s"; kill "$r" ) >/dev/null 2>&1 3>&- & w=$!; '
  + 'if [ "$json" = 1 ]; then awk -v max="$max" \'{ print } /^\\{"type":"match"/ { if (++n >= max) exit }\' < "$d/p"; else head -n "$max" < "$d/p"; fi | head -c "$cap"; '
  + 'kill "$r"; wait "$r"; c=$?; kill "$w"; head -c 2000 "$d/e" >&3; rm -rf "$d"; exit $c';

// Smart case: a query with no capital letter matches without case (rg --smart-case).
export const caseless = ({ query, matchCase }) => !matchCase && query === query.toLowerCase();

// Adapted from microsoft/vscode src/vs/base/common/strings.ts createRegExp (MIT), as getRgArgs
// (src/vs/workbench/services/search/node/ripgrepTextSearchEngine.ts) uses it for whole words: \b on
// the ends that are word characters. `escape`: the literal's escaping (Rust's for rg, JS's for JS).
function wordPattern(query, regex, escape) {
  let src = regex ? query : escape(query);
  if (!/\B/.test(query.charAt(0))) src = "\\b" + src;
  if (!/\B/.test(query.charAt(query.length - 1))) src += "\\b";
  return src;
}
const escapeJs = s => s.replace(/[\\{}*+?|^$.[\]()]/g, "\\$&");

// Adapted from microsoft/vscode src/vs/workbench/services/search/node/ripgrepTextSearchEngine.ts
// getRgArgs (MIT): rg's arguments for a query { query, matchCase, wholeWord, regex } and the Files
// settings { hidden, exclude }. .gitignore is respected (outside a git repository too); .git never
// searched; files over 2 MB skipped.
export function rgArgs(q, { hidden = true, exclude = [] } = {}) {
  const args = ["--json", "--no-config", "--no-require-git", "--crlf", "--max-filesize", "2M", ...(hidden ? ["--hidden"] : []), q.matchCase ? "--case-sensitive" : "--smart-case", "-g", "!.git"];
  for (const g of exclude) if (typeof g === "string" && g.trim()) args.push("-g", `!${g.trim()}`);
  let pattern = q.query, literal = false;
  // rg reads "--" as the end of its options, so that pattern goes in as a regex.
  if (!q.regex && pattern === "--") { q = { ...q, regex: true }; pattern = "\\-\\-"; }
  if (q.wholeWord) args.push("--regexp", wordPattern(pattern, q.regex, escapeRegex));
  else if (q.regex) args.push("--engine", "auto", "--regexp", pattern);
  else { args.push("--fixed-strings"); literal = true; }
  args.push("--");
  if (literal) args.push(pattern);
  args.push(".");
  return args;
}

// grep's arguments for the same (without rg: no .gitignore, so node_modules and .git are left out).
export function grepArgs(q, { hidden = true, exclude = [] } = {}) {
  const args = ["-rnI", "--exclude-dir=.git", "--exclude-dir=node_modules"];
  if (!hidden) args.push("--exclude=.*", "--exclude-dir=.*");
  for (const g of exclude) if (typeof g === "string" && g.trim() && !g.includes("/")) args.push(`--exclude=${g.trim()}`, `--exclude-dir=${g.trim()}`);
  if (caseless(q)) args.push("-i");
  if (q.wholeWord) args.push("-w");
  args.push(q.regex ? "-E" : "-F", "-e", q.query, "--", ".");
  return args;
}

// The query as a JavaScript RegExp for finding and replacing matches in a file's text: sticky (it's
// run at a given place), ^ and $ at line ends, case as rg had it. { re } or { error } when JavaScript
// can't read the pattern (rg's syntax isn't JavaScript's).
export function jsPattern(q) {
  const src = q.wholeWord ? wordPattern(q.query, q.regex, escapeJs) : q.regex ? q.query : escapeJs(q.query);
  const flags = "my" + (caseless(q) ? "i" : "");
  try { return { re: new RegExp(src, flags + "u") }; } catch { /* not valid with u: without it, as rg reads \- and the like */ }
  try { return { re: new RegExp(src, flags) }; } catch (e) { return { error: String(e?.message ?? e) }; }
}

// UTF-8 byte offsets in a string as UTF-16 indexes (rg's submatches count bytes).
export function utf16At(text) {
  const marks = [];
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.codePointAt(i);
    marks.push([bytes, i]);
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    if (c >= 0x10000) i++;
  }
  marks.push([bytes, text.length]);
  return offset => {
    let lo = 0, hi = marks.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (marks[mid][0] <= offset) lo = mid; else hi = mid - 1; }
    return marks[lo][1];
  };
}

const eol = s => s.replace(/\r?\n$/, "");
const pathOf = p => p.replace(/^\.\//, "");

// One file's matches: { path, matches: [{ line, text, ranges: [[start, end]…] }] } (text without its
// line end; ranges in UTF-16 units of it).
function fileOf(files, path) {
  let f = files.get(path);
  if (!f) files.set(path, f = { path, matches: [] });
  return f;
}

// Adapted from microsoft/vscode src/vs/workbench/services/search/node/ripgrepTextSearchEngine.ts
// RipgrepParser (MIT): rg --json's "match" messages as files and lines, in rg's order. A line with no
// submatch gets its first character (as VS Code does), lines and paths that aren't UTF-8 are left out
// (`skipped`). At most `max` matches: { files: [...], count, lines, skipped, full }.
export function parseRg(stdout, max = MAX) {
  const files = new Map();
  let count = 0, lines = 0, skipped = 0, full = false;
  for (const raw of String(stdout ?? "").split("\n")) {
    if (!raw.startsWith('{"type":"match"')) continue;
    let msg;
    try { msg = JSON.parse(raw); } catch { continue; } // cut short at the byte limit
    const d = msg.data;
    if (d?.path?.text == null || d?.lines?.text == null) { skipped++; continue; }
    const text = d.lines.text, at = utf16At(text), shown = eol(text);
    const ranges = [];
    for (const m of d.submatches?.length ? d.submatches : [null]) {
      if (count >= max) { full = true; break; }
      count++;
      ranges.push(m ? [Math.min(at(m.start), shown.length), Math.min(at(m.end), shown.length)] : [0, Math.min(1, shown.length)]);
    }
    // exact: false for a line rg gave no match in (its first character stands in): not replaceable.
    if (ranges.length) { fileOf(files, pathOf(d.path.text)).matches.push({ line: d.line_number, text: shown, ranges, ...(d.submatches?.length ? {} : { exact: false }) }); lines++; }
    if (full) break;
  }
  return { files: [...files.values()], count, lines, skipped, full };
}

// grep -rn's "path:line:text" lines as the same, the matches found again with `re` (jsPattern) for
// the highlight. A path with ":<digits>:" in it is read up to the first one.
export function parseGrep(stdout, re, max = MAX) {
  const files = new Map();
  let count = 0, lines = 0, full = false;
  for (const raw of String(stdout ?? "").split("\n")) {
    const m = /^(.*?):(\d+):(.*)$/.exec(raw);
    if (!m) continue;
    const text = eol(m[3]), ranges = [];
    if (re) {
      for (let i = 0; i <= text.length && ranges.length < 1000;) {
        re.lastIndex = i;
        const hit = re.exec(text);
        if (hit) { ranges.push([i, i + hit[0].length]); i += Math.max(1, hit[0].length); } else i++;
      }
    }
    if (!ranges.length) ranges.push([0, 0]);
    if (count + ranges.length > max) { full = true; break; }
    count += ranges.length; lines++;
    fileOf(files, pathOf(m[1])).matches.push({ line: Number(m[2]), text, ranges });
  }
  return { files: [...files.values()], count, lines, skipped: 0, full };
}

// rg's or grep's error, said shortly (VS Code's rgErrorMsgForDisplay, in short).
export function searchError(stderr) {
  const lines = String(stderr ?? "").split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.some(l => /regex parse error/i.test(l))) {
    const why = lines.find(l => l.startsWith("error:"));
    return `Regex parse error${why ? `: ${why.slice(6).trim()}` : ""}`;
  }
  return (lines[0] ?? "").replace(/^(rg|grep): /, "") || null;
}

// Adapted from microsoft/vscode src/vs/workbench/services/search/common/replace.ts ReplacePattern
// (MIT). The replacement for a regex search: \n, \t and \\ are a line end, a tab and a backslash, $0 is
// the whole match ($&); $1… are groups, $<name> named ones, $$ a dollar. \u \U \l \L before a group
// upper- or lower-case one letter of it or all of it. A literal search's replacement is used as typed.
export function replacePattern(replace, regex) {
  if (!regex) return { text: replace, literal: true };
  let out = "";
  for (let i = 0; i < replace.length; i++) {
    const c = replace[i], n = replace[i + 1];
    if (c === "\\" && (n === "\\" || n === "n" || n === "t")) { out += n === "n" ? "\n" : n === "t" ? "\t" : "\\"; i++; }
    else if (c === "$" && n === "0") { out += "$&"; i++; }
    else out += c;
  }
  return { text: out, literal: false };
}

// ECMAScript's GetSubstitution for one match, with the match alone as its context ($` and $' are
// empty, as VS Code has them).
function substitute(m, replacement) {
  let out = "";
  const groups = m.length - 1;
  for (let i = 0; i < replacement.length; i++) {
    const c = replacement[i], n = replacement[i + 1];
    if (c !== "$" || n === undefined) { out += c; continue; }
    if (n === "$") { out += "$"; i++; }
    else if (n === "&") { out += m[0]; i++; }
    else if (n === "`" || n === "'") i++;
    else if (n >= "0" && n <= "9") {
      const two = replacement.slice(i + 1, i + 3);
      if (/^\d\d$/.test(two) && +two >= 1 && +two <= groups) { out += m[+two] ?? ""; i += 2; }
      else if (+n >= 1 && +n <= groups) { out += m[+n] ?? ""; i++; }
      else out += "$";
    } else if (n === "<" && m.groups) {
      const end = replacement.indexOf(">", i + 2);
      if (end < 0) out += "$";
      else { out += m.groups[replacement.slice(i + 2, end)] ?? ""; i = end; }
    } else out += "$";
  }
  return out;
}

// Adapted from microsoft/vscode src/vs/workbench/services/search/common/replace.ts
// replaceWithCaseOperations (MIT): \u / \U / \l / \L before $N change that group's case.
function caseOps(m, replacement) {
  if (!/\\[uUlL]/.test(replacement)) return replacement;
  return replacement.replace(/((?:\\[uUlL])+)\$(\d+)/g, (all, ops, num) => {
    const value = m[+num];
    if (!value) return all;
    let out = "", i = 0;
    for (const op of ops.replace(/\\/g, "")) {
      if (op === "U") { out += value.slice(i).toUpperCase(); i = value.length; break; }
      if (op === "L") { out += value.slice(i).toLowerCase(); i = value.length; break; }
      if (i < value.length) { out += op === "u" ? value[i].toUpperCase() : value[i].toLowerCase(); i++; }
    }
    return (out + value.slice(i)).replace(/\$/g, "$$$$");
  });
}

// What a match is replaced with: the literal text, or the pattern filled in from the regex match.
export const replacementFor = (m, pattern) => (pattern.literal ? pattern.text : substitute(m, caseOps(m, pattern.text)));

// Where each line starts in a text (rg counts lines by "\n").
function lineStarts(text) {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

// The text with the given matches replaced: matches [{ line, start, end, matched }] (start/end in
// UTF-16 units of the line, `matched` what was there at search time), `re` (jsPattern; for a regex
// pattern the groups come from it, run at the match), `pattern` (replacePattern). A match whose text
// isn't there any more, or the regex doesn't match the same way, is left alone. { text, replaced,
// skipped }.
export function applyReplacements(text, matches, re, pattern) {
  const starts = lineStarts(text), sorted = [...matches].sort((a, b) => a.line - b.line || a.start - b.start);
  let out = "", at = 0, replaced = 0, skipped = 0;
  for (const x of sorted) {
    const from = starts[x.line - 1] === undefined ? -1 : starts[x.line - 1] + x.start, to = from + (x.end - x.start);
    if (from < at || text.slice(from, to) !== x.matched) { skipped++; continue; }
    let m = [x.matched];
    if (!pattern.literal) {
      re.lastIndex = from;
      m = re.exec(text);
      if (!m || m.index !== from || m[0] !== x.matched) { skipped++; continue; }
    }
    out += text.slice(at, from) + replacementFor(m, pattern);
    at = to; replaced++;
  }
  return { text: out + text.slice(at), replaced, skipped };
}
