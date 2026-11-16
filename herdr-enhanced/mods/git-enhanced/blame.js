// Blame (the diff's Blame toggle: who last changed each line and when, coloured by age; a line's
// "Blame before this change"): git blame's porcelain arguments and output read into lines and
// runs of lines from the same commit, age buckets for the heat colours, and where a line's
// previous version is.
// No Herdr imports: tested with node (test/git-enhanced/blame.test.mjs).
import { ZERO, unquoteC } from "./gitplan.js";

/** git's arguments for blame of `path` (from the repository's top) at `rev` (null: the file as it
 *  is in the working tree, uncommitted lines too): `whitespace` ignores changes of whitespace
 *  (-w); `moves` finds lines moved or copied within the file (-M), `copies` from other files of
 *  the same commit too (-C); `lines` [from, to] blames only those (-L). The person's
 *  blame.ignoreRevsFile applies (git refuses to blame when it names a file that isn't there). */
export function blameArgs(path, { rev = null, whitespace = false, moves = false, copies = false, lines = null } = {}) {
  return ["-c", "core.quotepath=false", "blame", "--porcelain",
    ...(whitespace ? ["-w"] : []), ...(moves ? ["-M"] : []), ...(copies ? ["-C"] : []),
    ...(lines ? ["-L", `${lines[0]},${lines[1]}`] : []), ...(rev ? [rev] : []), "--", path];
}

const HEAD = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) (\d+) (\d+)(?: (\d+))?$/;

/** `git blame --porcelain` as { commits, lines }:
 *  - `commits`: Map(sha → { sha, author, authorMail, authorTime, committer, committerMail,
 *    committerTime, summary, previous: { sha, path } | null, boundary, uncommitted }): `boundary`
 *    the commit where blame stopped (a root commit, or the edge of a range or a shallow clone),
 *    `uncommitted` the all-zero name git gives lines not committed yet;
 *  - `lines`: [{ line, orig, sha, path, text }], `line` its number now, `orig` in that commit's
 *    version of `path` (a line moved or copied has its old path there). */
export function parseBlame(stdout) {
  const commits = new Map(), lines = [];
  let cur = null, c = null;
  for (const l of String(stdout ?? "").split("\n")) {
    if (l.startsWith("\t")) {
      if (cur) lines.push({ line: cur.final, orig: cur.orig, sha: cur.sha, path: cur.path ?? c.path, text: l.slice(1) });
      continue;
    }
    const m = HEAD.exec(l);
    if (m) {
      const sha = m[1];
      c = commits.get(sha);
      if (!c) { c = { sha, author: null, authorMail: null, authorTime: 0, committer: null, committerMail: null, committerTime: 0, summary: "", previous: null, boundary: false, uncommitted: ZERO.test(sha), path: null }; commits.set(sha, c); }
      cur = { sha, orig: Number(m[2]), final: Number(m[3]), path: null };
      continue;
    }
    if (!c) continue;
    const sp = l.indexOf(" "), key = sp < 0 ? l : l.slice(0, sp), value = sp < 0 ? "" : l.slice(sp + 1);
    if (key === "author") c.author = value;
    else if (key === "author-mail") c.authorMail = value.replace(/^<|>$/g, "");
    else if (key === "author-time") c.authorTime = Number(value) || 0;
    else if (key === "committer") c.committer = value;
    else if (key === "committer-mail") c.committerMail = value.replace(/^<|>$/g, "");
    else if (key === "committer-time") c.committerTime = Number(value) || 0;
    else if (key === "summary") c.summary = value;
    else if (key === "boundary") c.boundary = true;
    else if (key === "previous") { const s2 = value.indexOf(" "); c.previous = { sha: value.slice(0, s2), path: unquoteC(value.slice(s2 + 1)) }; }
    else if (key === "filename") { c.path = unquoteC(value); if (cur) cur.path = c.path; }
  }
  for (const x of commits.values()) delete x.path;
  return { commits, lines };
}

/** The lines as runs of neighbours from the same commit: [{ sha, start, count }] (`start`: the
 *  run's first line number). */
export function runsOf(lines) {
  const runs = [];
  for (const l of lines) {
    const last = runs.at(-1);
    if (last && last.sha === l.sha && last.start + last.count === l.line) last.count++;
    else runs.push({ sha: l.sha, start: l.line, count: 1 });
  }
  return runs;
}

/** How old a change may be, in seconds, for each age bucket: a day, a week, a month, three and
 *  six months, a year, two, four; older is the last bucket. */
export const AGE_STEPS = [86400, 7 * 86400, 30 * 86400, 91 * 86400, 182 * 86400, 365 * 86400, 730 * 86400, 1461 * 86400];

/** The age bucket of a change made at `time` (unix seconds) when it is `now`: 0 (within a day)
 *  to AGE_STEPS.length (older than four years); -1 for a line not committed yet (time 0). */
export function ageBucket(time, now) {
  if (!time) return -1;
  const age = Math.max(0, now - time), i = AGE_STEPS.findIndex((s) => age < s);
  return i < 0 ? AGE_STEPS.length : i;
}

/** Each commit's heat in this file, 1 for the newest to 0 for the oldest (by author time, on a
 *  log scale of age so the recent ones stand apart): Map(sha → 0..1); uncommitted lines are 1. */
export function heatOf(commits, now) {
  const out = new Map(), done = [...commits.values()].filter((c) => !c.uncommitted && c.authorTime);
  const age = (c) => Math.log1p(Math.max(0, now - c.authorTime));
  const ages = done.map(age), lo = Math.min(...ages), hi = Math.max(...ages);
  for (const c of commits.values()) out.set(c.sha, c.uncommitted || !c.authorTime ? 1 : hi === lo ? 1 : 1 - (age(c) - lo) / (hi - lo));
  return out;
}

/** "Blame before this change" for blame line `l` (parseBlame's): the commit before the one that
 *  last changed it and the file's path there, with the line's number in that commit's version,
 *  and blameArgs for it (`opts`: the same options); null when there is none (the line came in
 *  with a root or boundary commit). For a line not committed yet, that is HEAD's version. */
export function beforeOf(l, blame, opts = {}) {
  const prev = blame.commits.get(l.sha)?.previous;
  if (!prev) return null;
  const line = Math.max(1, l.orig);
  return { rev: prev.sha, path: prev.path, line, args: blameArgs(prev.path, { ...opts, rev: prev.sha }) };
}
