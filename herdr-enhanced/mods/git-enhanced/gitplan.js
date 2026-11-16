// What the git modules share (conflicts.js, pullsync.js, worktrees.js and the others):
// the plan they return, git's version and the features each version has, git's C-quoted names,
// and a runner that carries a plan out.
//
// A plan is `{ steps, confirm?, danger, problem? }`:
//   - `steps`: run in order; the first that fails ends the plan. A step is one of
//       { args, why }            git with `args`
//       { script, args, why }    sh -c script sh args… (POSIX sh, run in the repository)
//       { apply, why }           git apply with flags `apply` and the plan's `patch` (the caller's
//                                base64 transport: gitops.js applyPatch)
//       { body, args, why }      an sh script body (scripts.js FILES_SH's) with the plan's `patch`
//                                as the file "$d/patch" (the same transport: h.files)
//     and may say `net` (it talks to a remote: no password prompt, a longer time limit), `editor`
//     (git might open an editor: there is none), `slow` (a longer time limit), `stops` (it may stop
//     on conflicts: a failure that leaves an operation in progress is a stop, not an error) and
//     `ok` (exit codes that aren't failures).
//   - `confirm`: the question for the person before it runs; `danger`: it loses something, and
//     the question says what.
//   - `problem`: it can't run, and why (no steps then): what a disabled menu item says.
// No Herdr imports: tested with node (test/git-enhanced/gitplan.test.mjs).
import { OPERATION_SH, operationOf } from "./branches.js";
import { gitSays } from "./stashes.js";

/** git that opens no editor: there is no terminal, and the message git prepared is the one wanted. */
export const NO_EDITOR = ["-c", "core.editor=true"];
/** Paths are paths, not pathspecs (no globs, no :(magic)). */
export const LITERAL = "--literal-pathspecs";
/** An all-zero object name: git's "nothing" (an uncommitted line, a missing stage). */
export const ZERO = /^0+$/;
/** A full object name (SHA-1 or SHA-256). */
export const FULL_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** One step: git's `args`, `why` in words for a log or a tooltip, and its flags. */
export const step = (args, why, more = {}) => ({ args, why, ...more });

/** A plan from `steps` (falsy ones left out). */
export function plan(steps, { confirm = null, danger = false, ...more } = {}) {
  return { steps: steps.filter(Boolean), ...(confirm ? { confirm } : {}), danger: Boolean(danger), ...more };
}

/** A plan that can't run: no steps, and why. */
export const problem = (why) => ({ steps: [], danger: false, problem: why });

/** The index's file times brought up to date (git update-index --refresh; exit 1 just says some
 *  files have changes). The pages read with --no-optional-locks, which leaves them stale, and
 *  git reset --keep takes a file whose time changed but not its content for a change in the way. */
export const refreshStep = () => step(["update-index", "-q", "--refresh"], "Refresh the index", { ok: [1] });

// ---- git's version

/** `git version`'s output ("git version 2.39.3 (Apple Git-145)", "git version 2.45.1.windows.1")
 *  as { major, minor, patch }, or null. */
export function parseVersion(stdout) {
  const m = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(String(stdout ?? ""));
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? 0) } : null;
}

/** Whether `version` (parseVersion) is `want` ("2.30", "2.30.1") or newer; an unknown version
 *  (null) has nothing, so features that need a version are not offered until it is known. */
export function atLeast(version, want) {
  if (!version) return false;
  const [a = 0, b = 0, c = 0] = String(want).split(".").map(Number), v = [version.major, version.minor, version.patch];
  for (const [have, need] of [[v[0], a], [v[1], b], [v[2], c]]) if (have !== need) return have > need;
  return true;
}

/** The git version each feature here needs (from git's release notes). The pages show a feature
 *  only when `has(version, name)`; the plans leave out a flag the version lacks. */
export const SINCE = {
  "status-v2": "2.11",              // status --porcelain=v2 (conflicts.js)
  "merge-continue": "2.12",         // git merge --continue
  "stash-push": "2.13",             // git stash push (-m, pathspecs)
  "worktree-move": "2.17",          // git worktree move / remove
  "prune-tags": "2.17",             // git fetch --prune-tags
  "rebase-merges": "2.18",          // git pull --rebase=merges
  "mainline-any": "2.21",           // cherry-pick / revert -m on a commit that isn't a merge
  "switch": "2.23",                 // git switch (previous branch: switch -)
  "sequencer-skip": "2.23",         // git cherry-pick --skip, git revert --skip
  "merge-autostash": "2.27",        // git merge --autostash, git pull --autostash without --rebase
  "bisect-first-parent": "2.29",    // git bisect start --first-parent
  "force-if-includes": "2.30",      // git push --force-if-includes
  "worktree-prunable": "2.31",      // worktree list --porcelain: "prunable"
  "stash-show-untracked": "2.32",   // git stash show --include-untracked
  "stash-staged": "2.35",           // git stash push --staged
  "worktree-list-z": "2.36",        // git worktree list --porcelain -z
  "update-refs": "2.38",            // git rebase --update-refs
  "autosquash-plain": "2.44",       // git rebase --autosquash without --interactive
};

/** Whether git `version` has feature `name` (SINCE). */
export const has = (version, name) => atLeast(version, SINCE[name] ?? "999");

// ---- Names as git prints them

// Bytes → text: UTF-8, a bad sequence as U+FFFD (standard ECMAScript has no TextDecoder).
function utf8(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    const n = b < 0x80 ? 0 : b >= 0xc2 && b < 0xe0 ? 1 : b >= 0xe0 && b < 0xf0 ? 2 : b >= 0xf0 && b < 0xf5 ? 3 : -1;
    if (n < 0) { out += "\ufffd"; i++; continue; }
    let cp = n === 0 ? b : b & (0x3f >> n), ok = i + n < bytes.length;
    for (let k = 1; ok && k <= n; k++) { const c = bytes[i + k]; if ((c & 0xc0) !== 0x80) ok = false; else cp = (cp << 6) | (c & 0x3f); }
    if (!ok || (n === 2 && (cp < 0x800 || (cp >= 0xd800 && cp < 0xe000))) || (n === 3 && (cp < 0x10000 || cp > 0x10ffff))) { out += "\ufffd"; i++; continue; }
    out += String.fromCodePoint(cp);
    i += n + 1;
  }
  return out;
}
// A code point → its UTF-8 bytes.
function utf8Of(cp, out) {
  if (cp < 0x80) out.push(cp);
  else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
  else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
}
const ESC = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

/** A name as git prints it outside -z: as it is, or in double quotes with C escapes (\t, \n, \",
 *  \\, \ooo octal bytes of UTF-8) when it holds anything unusual. Returns the name. */
export function unquoteC(s) {
  const t = String(s ?? "");
  if (t.length < 2 || t[0] !== '"' || t[t.length - 1] !== '"') return t;
  const bytes = [];
  const push = (str) => { for (const ch of str) utf8Of(ch.codePointAt(0), bytes); };
  for (let i = 1; i < t.length - 1; i++) {
    const c = t[i];
    if (c !== "\\") { push(c); continue; }
    const d = t[++i];
    if (/[0-7]/.test(d)) { let o = d; while (o.length < 3 && /[0-7]/.test(t[i + 1])) o += t[++i]; bytes.push(parseInt(o, 8) & 0xff); }
    else if (d in ESC) bytes.push(ESC[d]);
    else push(d ?? "");
  }
  return utf8(bytes);
}

/** `prefix` + `name` the way git quotes a name with core.quotepath=false (what git apply reads):
 *  in double quotes with C escapes when it holds a quote, a backslash or a control character;
 *  other characters (UTF-8 too) as they are. */
export function quoteC(name, prefix = "") {
  const s = `${prefix}${name}`;
  if (!/["\\\x00-\x1f\x7f]/.test(s)) return s;
  const back = { 7: "a", 8: "b", 9: "t", 10: "n", 11: "v", 12: "f", 13: "r", 34: '"', 92: "\\" };
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    out += back[cp] ? `\\${back[cp]}` : cp < 0x20 || cp === 0x7f ? `\\${cp.toString(8).padStart(3, "0")}` : ch;
  }
  return out + '"';
}

/** Fields of NUL-separated output, without the empty one after the last NUL. */
export function nulFields(stdout) {
  const parts = String(stdout ?? "").split("\0");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

/** The records of a script that prints "\036<name>\n<value>" for each thing it reads (one exec,
 *  however many facts): { name: value }. */
export function records(stdout) {
  const out = {};
  for (const part of String(stdout ?? "").split("\x1e").slice(1)) {
    const nl = part.indexOf("\n");
    out[nl >= 0 ? part.slice(0, nl) : part] = nl >= 0 ? part.slice(nl + 1) : "";
  }
  return out;
}

// ---- Carrying a plan out

/** sh's script for git steps that may prompt or open an editor: the person's GIT_EDITOR and
 *  GIT_SEQUENCE_EDITOR would win over `-c core.editor=true` (git reads them first), so they go;
 *  and git may not ask for a password, there being no terminal to ask in. */
export const GIT_SH = 'unset GIT_EDITOR GIT_SEQUENCE_EDITOR; GIT_TERMINAL_PROMPT=0 exec git "$@"';
const LONG = 120000;

/** What git said when step result `r` failed: stashes.js gitSays, after the lines a push prints
 *  for each ref it refused (" ! [rejected] main -> main (stale info)"), which say why. */
export function failureWords(r) {
  const refused = String(r?.stderr ?? "").split(/\r\n|\r|\n/).filter((l) => /^ ! /.test(l)).map((l) => l.trim().replace(/\s+/g, " "));
  const said = gitSays(r);
  return [...new Set([...refused, ...(said ? said.split("\n") : [])])].join("\n");
}

/** Runs `plan` with runner `h` (gitops.js runnerOf: h.git, h.sh), step by step. `apply(patch,
 *  flags)` carries out `apply` steps (gitops.js applyPatch), `send(patch, body, args)` `body` steps
 *  (h.files with the patch as "$d/patch", scripts.js FILES_SH); both throw git's words.
 *  `onStep(i, step)` hears each one start. Returns { done, stopped, outputs }: `stopped`, git's
 *  words when a `stops` step left an operation (a merge, a rebase, git am…) waiting on conflicts,
 *  and `outputs`, each step's stdout. A plan with a problem, or a step git refuses, throws git's
 *  words; the steps after it don't run. */
export async function runPlan(h, p, { apply = null, send = null, onStep = null } = {}) {
  if (p.problem) throw new Error(p.problem);
  const outputs = [];
  const waiting = async () => { const op = await h.sh(OPERATION_SH); return op.code === 0 && Boolean(operationOf(op.stdout)); };
  for (let i = 0; i < p.steps.length; i++) {
    const s = p.steps[i], opts = s.net || s.slow ? { timeout: LONG } : {};
    onStep?.(i, s);
    let r;
    if (s.apply || s.body) {
      const run = s.apply ? apply : send;
      if (!run) throw new Error(s.apply ? "No way to apply a patch was given" : "No way to send a patch was given");
      try { outputs.push(String((await (s.apply ? run(p.patch, s.apply) : run(p.patch, s.body, s.args ?? []))) ?? "")); }
      catch (e) { if (s.stops && await waiting()) return { done: i, stopped: String(e?.message ?? e) || "Stopped on conflicts", outputs }; throw e; }
      continue;
    }
    if (s.script) r = await h.sh(s.script, s.args ?? [], opts);
    else if (s.net || s.editor) r = await h.sh(GIT_SH, s.args, opts);
    else r = await h.git(s.args, opts);
    if (r.code === 0 || s.ok?.includes(r.code)) { outputs.push(r.stdout); continue; }
    if (s.stops && await waiting()) return { done: i, stopped: gitSays(r) || "Stopped on conflicts", outputs };
    throw new Error(failureWords(r) || `${s.script ? "sh" : `git ${s.args.find((a) => !a.startsWith("-") && !a.includes("=")) ?? ""}`} failed`.trim());
  }
  return { done: p.steps.length, stopped: null, outputs };
}
