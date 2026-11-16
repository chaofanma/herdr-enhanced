// One hunk of a file's diff as a patch for `git apply`: what the @@ rows'
// Stage / Unstage / Revert… buttons apply (main.js, git.js applyPatch).
// No Herdr imports: tested with node (test/git-enhanced/hunk.test.mjs).
import { FILES_SH, filesArgs, fileOf } from "./scripts.js";

/** Flags for the diff the panel shows and the patches are cut from: no external or textconv
 *  diff, no color, and the a/ b/ prefixes git apply expects whatever diff.noprefix says. */
export const DIFF = ["--no-ext-diff", "--no-textconv", "--no-color", "--src-prefix=a/", "--dst-prefix=b/"];

/** The body of a script (gitops.js applyPatch, scripts.js FILES_SH) that applies the patch it got
 *  as the file "$d/patch" with git apply's flags in "$@". exec has no stdin, so the patch travels
 *  as base64 arguments, on this computer as on another machine. */
export const APPLY = 'git apply --whitespace=nowarn "$@" "$d/patch"';

/** git apply's flags: stage the hunk, take it back out of the index, drop it from the working tree. */
export const FLAGS = { stage: ["--cached"], unstage: ["--cached", "-R"], revert: ["-R"] };

/** sh's arguments for applying `patch` with `flags`: `exec("sh", applyArgs(patch, FLAGS.stage), { cwd: root, on })`. */
export const applyArgs = (patch, flags) => ["-c", FILES_SH + APPLY, "sh", ...filesArgs([fileOf("patch", patch)], flags)];

/** `git diff` output for one file as its header (the lines before the first @@) and the rest
 *  (from the first @@ on), or null when it has no hunk (binary, mode only, nothing). */
export function splitDiff(stdout) {
  const all = stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
  return first < 0 ? null : { header: all.slice(0, first), lines: all.slice(first) };
}

/** Whether its hunks can be applied one at a time: one file's text diff. Not a type change
 *  (a file becoming a symlink is two diffs) and not a submodule. */
export function patchable({ header, lines }) {
  const files = [...header, ...lines].filter((l) => l.startsWith("diff --git ")).length;
  return files === 1 && !header.some((l) => / 160000$/.test(l));
}

/** Where each hunk starts in `lines`: the indexes of its @@ lines. */
export const hunkStarts = (lines) => lines.flatMap((l, i) => (l.startsWith("@@") ? [i] : []));

/** The patch of the hunk whose @@ line is lines[start]: the header, the hunk's lines up to the
 *  next @@ ("\ No newline at end of file" ones included) and a final newline; null when
 *  lines[start] is not a @@ line. */
export function hunkPatch(header, lines, start) {
  if (!lines[start]?.startsWith("@@")) return null;
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("@@")) end++;
  return [...header, ...lines.slice(start, end)].join("\n") + "\n";
}

/** How far button k of `count`, `width` wide with `gap` between them, ends before the last
 *  one's right edge. main.js draws each that far (plus its pad) from the row's right edge. */
export const buttonInset = (k, count, width, gap) => (count - 1 - k) * (width + gap);

/** Which of `count` buttons, `width` wide with `gap` between them and the last one's right edge
 *  at `right`, holds x: its index, or -1. Rows of a virtual list can't hold click handlers, so
 *  a @@ row's buttons are found by where the press was. */
export function buttonAt(x, right, count, width, gap) {
  for (let k = 0; k < count; k++) {
    const end = right - buttonInset(k, count, width, gap);
    if (x >= end - width && x <= end) return k;
  }
  return -1;
}
