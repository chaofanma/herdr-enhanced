// Bisect (History: "Bisect from here…" on a commit, then a bar with Good, Bad, Skip and Reset):
// git's arguments to start, mark and end a bisect, where it stands (from the files and refs it
// keeps in the git dir), and reading `git bisect log` and what a mark printed: the next commit to
// test, or the first bad one.
// No Herdr imports: tested with node (test/git-enhanced/bisect.test.mjs).
import { step, plan, problem, has, records } from "./gitplan.js";

const short = (h) => String(h ?? "").slice(0, 7);
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** git bisect start: `bad` (a commit that has the bug) and `good` (commits that don't), which can
 *  also be marked after; `firstParent` follows only a merge's first parent (git 2.29); `terms`
 *  { new, old } for words other than bad and good ("broken" / "fixed"); `noCheckout` leaves the
 *  files alone (the commit to test is BISECT_HEAD then). */
export function startArgs({ bad = null, good = [], firstParent = false, noCheckout = false, terms = null } = {}) {
  return ["bisect", "start", ...(firstParent ? ["--first-parent"] : []), ...(noCheckout ? ["--no-checkout"] : []),
    ...(terms ? [`--term-new=${terms.new}`, `--term-old=${terms.old}`] : []), ...(bad ? [bad, ...good] : []), "--"];
}

/** startArgs as a plan, with the good commits marked after when no bad one is known yet. */
export function startPlan(opts = {}, { version = null } = {}) {
  if (opts.firstParent && !has(version, "bisect-first-parent")) return problem("Following only first parents needs git 2.29 or newer");
  const later = !opts.bad && opts.good?.length ? opts.good : [];
  return plan([
    step(startArgs({ ...opts, good: opts.bad ? opts.good ?? [] : [] }), "Start bisecting", { slow: true }),
    later.length && step(markArgs(opts.terms?.old ?? "good", later), `Mark ${later.map(short).join(", ")} ${opts.terms?.old ?? "good"}`, { slow: true }),
  ], { confirm: `Start bisecting? git checks out commits between the good and the bad one for you to test${opts.noCheckout ? " (here: without changing the files)" : ", which changes the files; commit or stash your changes first"}. Reset ends it.` });
}

/** Mark the commit being tested (or `revs`) with `term`: "good", "bad", "skip" (can't be tested),
 *  or the start's own terms. git then checks out the next one, or says which is the first bad;
 *  exit 2 is git saying only skipped commits are left (parseOutput's `candidates`), not a failure. */
export const markArgs = (term, revs = []) => ["bisect", term, ...revs];
export const markPlan = (term, revs = []) => plan([step(markArgs(term, revs), `Mark ${revs.length ? revs.map(short).join(", ") : "it"} ${term}`, { slow: true, ok: [2] })]);

/** End the bisect: back to the branch (or commit) it started on, or to `to`. */
export const resetArgs = (to = null) => ["bisect", "reset", ...(to ? [to] : [])];
export const resetPlan = (to = null) => plan([step(resetArgs(to), "End the bisect", { slow: true })]);

/** sh's script that tells where a bisect stands, from what git keeps in this worktree's git dir:
 *  records "\036<name>\n<value>" of BISECT_START (the branch or commit it started on), BISECT_TERMS
 *  (the bad and the good word), BISECT_EXPECTED_REV (the commit git checked out to test), HEAD,
 *  BISECT_HEAD (with --no-checkout), and the refs under refs/bisect/ ("<ref> <hash>" a line). */
export const BISECT_SH = [
  "git rev-parse --git-dir >/dev/null || exit 1",
  "put() { printf '\\036%s\\n' \"$1\"; }",
  'show() { p=$(git rev-parse --git-path "$1") && [ -f "$p" ] && cat "$p"; }',
  "put start; show BISECT_START", "put terms; show BISECT_TERMS", "put expected; show BISECT_EXPECTED_REV",
  "put head; git rev-parse -q --verify HEAD", "put bisect-head; git rev-parse -q --verify BISECT_HEAD",
  "put refs; git for-each-ref --format='%(refname) %(objectname)' refs/bisect/",
  "exit 0",
].join("\n");

/** BISECT_SH's output as { active, start, terms: { bad, good }, bad, good, skipped, testing }:
 *  `bad` the bad commit known (the first bad one, once found, is it with every parent good),
 *  `good` and `skipped` hashes, `testing` the commit to test now. */
export function parseState(stdout) {
  const r = records(stdout), one = (k) => (r[k] ?? "").trim() || null;
  const [badTerm = "bad", goodTerm = "good"] = (r.terms ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const refs = (r.refs ?? "").split("\n").map((l) => l.trim().split(" ")).filter((p) => p.length === 2);
  const named = (prefix) => refs.filter(([ref]) => ref.startsWith(`refs/bisect/${prefix}-`)).map(([, h]) => h);
  const start = one("start");
  return {
    active: Boolean(start), start, terms: { bad: badTerm, good: goodTerm },
    bad: refs.find(([ref]) => ref === `refs/bisect/${badTerm}`)?.[1] ?? null, good: named(goodTerm), skipped: named("skip"),
    testing: one("bisect-head") ?? one("expected") ?? (start ? one("head") : null),
  };
}

// A word of a line `git bisect log` writes: git quotes the start's arguments ('HEAD' '--'), and
// the marks' hashes go bare.
function words(s) {
  const out = [];
  for (const m of String(s).matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)) out.push(m[1] !== undefined ? m[1].replace(/'\\''/g, "'") : m[2]);
  return out;
}

/** `git bisect log` as { steps: [{ command, args }], first }: the commands it lists ("start" with
 *  its arguments, then each mark with its hashes), what `git bisect replay` reruns; `first` the
 *  first bad commit once found, from git's "# first <term> commit: [<hash>]" line. That line and
 *  the other "#" comments are git's own English words, written into the log and not translated as
 *  git is today; the commands are what can be relied on, and `first` is null when its line isn't
 *  there. */
export function parseLog(stdout) {
  const steps = [];
  let first = null;
  for (const line of String(stdout ?? "").split("\n")) {
    const m = /^git bisect (\S+)(?: (.*))?$/.exec(line.trim());
    if (m) { steps.push({ command: m[1], args: words(m[2] ?? "") }); continue; }
    const f = /^# first \S+ commit: \[([0-9a-f]{40,64})\]/.exec(line);
    if (f) first = f[1];
  }
  return { steps, first };
}

/** What a mark (or the start) printed, read from its hashes only, not from its words (git
 *  translates those): `next`, the commit git checked out to test ("[<hash>] <subject>"); `found`,
 *  the first bad commit (a line starting with its hash, then "commit <hash>" as git log shows it);
 *  `candidates` when only skipped commits are left (bare hashes, one a line). What can't be read
 *  safely: how many commits and steps are left, and why git refused a mark; show those as git
 *  says them. */
export function parseOutput(stdout) {
  const lines = String(stdout ?? "").split("\n").map((l) => l.replace(/\r$/, ""));
  const next = lines.map((l) => /^\[([0-9a-f]{40,64})\] /.exec(l)?.[1]).find(Boolean) ?? null;
  const commitLines = new Set(lines.map((l) => /^commit ([0-9a-f]{40,64})\b/.exec(l)?.[1]).filter(Boolean));
  const found = lines.map((l) => /^([0-9a-f]{40,64}) \S/.exec(l)?.[1]).find((h) => h && commitLines.has(h)) ?? null;
  const candidates = found ? [] : lines.filter((l) => SHA.test(l.trim())).map((l) => l.trim());
  return { next: found ? null : next, found, candidates };
}
