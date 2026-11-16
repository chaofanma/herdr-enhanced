// Staging single lines: the Changes page's diff with lines selected, and Stage lines, Unstage
// lines or Discard lines… on them. From one file's diff and the selected lines this makes the
// patch for git apply that does only those lines, and git apply's flags:
//   - stage: from the unstaged diff (index → working tree), applied to the index;
//   - unstage: from the staged diff (HEAD → index), applied backwards to the index;
//   - discard: from the unstaged diff, applied backwards to the working tree.
// The caller applies it the way the hunk buttons do (gitops.js applyPatch: the patch travels as
// base64 arguments, so this works on another machine too). Hunk headers are counted again; a
// file without a newline at its end, several hunks, new, deleted and renamed files are handled.
// No Herdr imports: tested with node (test/git-enhanced/linestage.test.mjs).
import { plan, problem, quoteC, unquoteC } from "./gitplan.js";

/** git apply's flags per action (hunk.js FLAGS: stage, unstage, revert). */
export const LINE_FLAGS = { stage: ["--cached"], unstage: ["--cached", "-R"], discard: ["-R"] };
/** The diff each action's lines are selected in: "unstaged" (git diff) or "staged" (git diff --cached). */
export const SOURCE = { stage: "unstaged", unstage: "staged", discard: "unstaged" };

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const MARKER = "\\ No newline at end of file";

/** One file's diff (`git diff` output, or hunk.js splitDiff's { header, lines }) as
 *  { header, lines, hunks: [{ oldStart, oldCount, newStart, newCount, context, at, body }] }:
 *  `lines` from the first @@ on (what the line indexes count), each hunk's `body` its rows
 *  { i, kind: " " | "-" | "+", text, eol } (`eol` false: the file ends there without a newline;
 *  git's "\ No newline at end of file" rows are folded into it). Null when the diff has no hunk
 *  (binary, a mode change only, nothing) or holds more than one file. */
export function parseDiff(diff) {
  let header, lines;
  if (typeof diff === "string") {
    const all = diff.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
    if (first < 0) return null;
    header = all.slice(0, first); lines = all.slice(first);
  } else if (diff?.lines) ({ header = [], lines } = diff);
  else return null;
  if (!lines.length || [...header, ...lines].filter((l) => l.startsWith("diff --git ")).length > 1) return null;
  const hunks = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], m = HUNK.exec(l);
    if (m) {
      cur = { oldStart: Number(m[1]), oldCount: m[2] === undefined ? 1 : Number(m[2]), newStart: Number(m[3]), newCount: m[4] === undefined ? 1 : Number(m[4]), context: m[5], at: i, body: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) return null;
    if (l.startsWith("\\")) { const last = cur.body.at(-1); if (last) last.eol = false; continue; }
    if (l.startsWith("diff ")) return null;
    const kind = l[0] === "+" || l[0] === "-" ? l[0] : " ";
    cur.body.push({ i, kind, text: l === "" ? "" : l.slice(1), eol: true });
  }
  return hunks.length ? { header, lines, hunks } : null;
}

/** The indexes (into the diff's lines) of its changed lines: what can be selected. */
export function changedLines(diff) {
  const d = parseDiff(diff);
  return d ? d.hunks.flatMap((h) => h.body.filter((r) => r.kind !== " ").map((r) => r.i)) : [];
}
/** The changed lines of the hunk that holds line `i` (its @@ row or a row in it). */
export function hunkLines(diff, i) {
  const d = parseDiff(diff);
  const h = d?.hunks.find((x, k) => i >= x.at && i < (d.hunks[k + 1]?.at ?? d.lines.length));
  return h ? h.body.filter((r) => r.kind !== " ").map((r) => r.i) : [];
}

// Adapted from lazygit pkg/commands/patch/transform.go (MIT, Copyright (c) 2018 Jesse Duffield),
// transformHunkLines: lines of the file the patch is applied to ("-" lines going forward, "+"
// lines backwards) that aren't selected stay as context, the others that aren't selected go;
// context from unselected lines waits until the selected lines of the same change are placed
// (unless an unselected line of the other side came first). Changed: a line's missing newline
// travels with the line, and is given back or taken away when the line is no longer the last of
// its side; the hunk headers are counted so the side git apply matches against is exact.
function transformHunk(h, selected, reverse) {
  const out = [];
  let pending = [], skipped = false;
  const flush = () => { out.push(...pending); pending = []; };
  for (const r of h.body) {
    if (r.kind === " ") { flush(); skipped = false; out.push({ kind: " ", text: r.text, old: r.eol, new: r.eol }); continue; }
    const inTarget = reverse ? r.kind === "+" : r.kind === "-";
    if (selected.has(r.i)) {
      if (inTarget || skipped) flush();
      out.push(r.kind === "-" ? { kind: "-", text: r.text, old: r.eol } : { kind: "+", text: r.text, new: r.eol });
      continue;
    }
    if (inTarget) { pending.push(reverse ? { kind: " ", text: r.text, old: null, new: r.eol } : { kind: " ", text: r.text, old: r.eol, new: null }); continue; }
    skipped = true;
  }
  flush();
  // The side being made (new going forward, old backwards): every line has its newline but the
  // last, which keeps what its source had (a line that ended the file without one may end it so).
  const made = reverse ? "old" : "new", on = (o) => o.kind === " " || o.kind === (reverse ? "-" : "+");
  const last = out.reduce((k, o, j) => (on(o) ? j : k), -1);
  out.forEach((o, j) => {
    if (!on(o)) return;
    const source = o.kind === " " ? (o[made] ?? o[reverse ? "new" : "old"]) : o[made];
    o[made] = j === last ? source : true;
  });
  return out;
}

// The rows of one transformed hunk: a context line whose two sides now differ in their newline
// becomes the line taken out and put back.
function rowsOf(out) {
  const rows = [];
  for (const o of out) {
    if (o.kind === " " && o.old === o.new) { rows.push(` ${o.text}`); if (!o.old) rows.push(MARKER); }
    else if (o.kind === " ") { rows.push(`-${o.text}`); if (!o.old) rows.push(MARKER); rows.push(`+${o.text}`); if (!o.new) rows.push(MARKER); }
    else { rows.push(`${o.kind}${o.text}`); if (!(o.kind === "-" ? o.old : o.new)) rows.push(MARKER); }
  }
  return rows;
}

// The file's names in the header: its path, and what kind of change the diff is. The names have
// git's one-letter prefixes (a/, b/; hunk.js DIFF asks for those whatever diff.noprefix says).
function headerFacts(header) {
  const name = (l) => { const t = unquoteC(l.slice(4).replace(/\t$/, "")); return t === "/dev/null" ? null : t.replace(/^[^/]\//, ""); };
  const minus = header.find((l) => l.startsWith("--- ")), plus = header.find((l) => l.startsWith("+++ "));
  const a = minus ? name(minus) : null, b = plus ? name(plus) : null;
  const created = header.some((l) => l.startsWith("new file mode ")) || (minus && a === null);
  const deleted = header.some((l) => l.startsWith("deleted file mode ")) || (plus && b === null);
  const mode = (header.find((l) => /^(new|deleted) file mode /.test(l)) ?? "").split(" ").at(-1) || "100644";
  return { path: b ?? a, created: Boolean(created), deleted: Boolean(deleted), mode };
}

// A header for `path` git apply reads: a change of its content, its creation, or its deletion
// (names quoted the way git quotes them; a name with a space gets git's tab after it).
function headerFor(path, kind, mode) {
  const A = quoteC(path, "a/"), B = quoteC(path, "b/"), tab = /^"/.test(A) || !path.includes(" ") ? "" : "\t";
  if (kind === "create") return [`diff --git ${A} ${B}`, `new file mode ${mode}`, "--- /dev/null", `+++ ${B}${tab}`];
  if (kind === "delete") return [`diff --git ${A} ${B}`, `deleted file mode ${mode}`, `--- ${A}${tab}`, "+++ /dev/null"];
  return [`diff --git ${A} ${B}`, `--- ${A}${tab}`, `+++ ${B}${tab}`];
}

/** The patch that `action` ("stage", "unstage", "discard") makes of the `selected` lines (indexes
 *  into the diff's lines from its first @@, as hunk.js splitDiff gives them; context rows, @@
 *  rows and the rest are passed over) of `diff`, the file's diff from SOURCE[action]:
 *  { patch, flags, lines, all } (`lines`: how many changed lines it takes; `all`: every one), or
 *  null when the selection holds no changed line or the diff can't be cut (binary, several files).
 *  A rename's lines apply to its content under the new name; the rename stays. A new file stays
 *  new while it keeps any line, a deleted one gone while it loses all of them. The diff needs
 *  context (git diff's default three lines): without any, git apply refuses the patch. */
export function linePatch(diff, selected, action) {
  const flags = LINE_FLAGS[action];
  if (!flags) throw new Error(`no line action ${action}`);
  const d = parseDiff(diff);
  if (!d) return null;
  const sel = new Set([...selected].filter((i) => d.hunks.some((h) => h.body.some((r) => r.i === i && r.kind !== " "))));
  if (!sel.size) return null;
  const reverse = action !== "stage", facts = headerFacts(d.header);
  if (!facts.path) return null;
  const changed = d.hunks.reduce((n, h) => n + h.body.filter((r) => r.kind !== " ").length, 0), all = sel.size === changed;
  const rows = [];
  let offset = 0;
  for (const h of d.hunks) {
    const out = transformHunk(h, sel, reverse);
    if (!out.some((o) => o.kind !== " " || o.old !== o.new)) continue;
    const oldCount = out.reduce((n, o) => n + (o.kind !== "+" ? 1 : 0), 0), newCount = out.reduce((n, o) => n + (o.kind !== "-" ? 1 : 0), 0);
    // The side git apply matches against keeps its numbers; the other follows from it and the
    // hunks before. A side with no lines names the line before where it would be.
    let oldStart, newStart;
    if (!reverse) {
      oldStart = h.oldStart;
      const at = (h.oldCount > 0 ? h.oldStart : h.oldStart + 1) + offset;
      newStart = newCount > 0 ? at : at - 1;
      offset += newCount - oldCount;
    } else {
      newStart = h.newStart;
      const at = (h.newCount > 0 ? h.newStart : h.newStart + 1) + offset;
      oldStart = oldCount > 0 ? at : at - 1;
      offset += oldCount - newCount;
    }
    rows.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${h.context}`, ...rowsOf(out));
  }
  if (!rows.length) return null;
  // A new file stays one while it keeps lines (going forward any selection; backwards, all of
  // them); a deleted one stays deleted when it loses all its lines. Otherwise: its content.
  const kind = facts.created && (!reverse || all) ? "create" : facts.deleted && (reverse || all) ? "delete" : "change";
  return { patch: [...headerFor(facts.path, kind, facts.mode), ...rows].join("\n") + "\n", flags, lines: sel.size, all };
}

/** linePatch as a plan for gitplan.js runPlan (its `apply` the caller's: gitops.js applyPatch):
 *  discarding is a danger plan (the lines are gone from the file, staged nowhere). `path`: the
 *  file's name for the question. */
export function linePlan(diff, selected, action, path = null) {
  const p = linePatch(diff, selected, action);
  if (!p) return problem("No changed line is selected");
  const n = `${p.lines} line${p.lines === 1 ? "" : "s"}`, of = path ? ` of ${path}` : "";
  const why = action === "stage" ? `Stage ${n}${of}` : action === "unstage" ? `Unstage ${n}${of}` : `Discard ${n}${of}`;
  return {
    ...plan([{ apply: p.flags, why }], action === "discard" ? { danger: true, confirm: `Discard ${n}${of}? The selected changes are taken out of the file; they aren't staged anywhere.` } : {}),
    patch: p.patch,
  };
}
