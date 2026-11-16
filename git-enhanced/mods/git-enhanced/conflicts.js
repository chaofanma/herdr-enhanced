// Conflicts: the bar over the files while a merge, rebase, cherry-pick, revert or `git am` waits
// (Continue, Skip, Abort), the files in conflict and what can be done with each (take a side,
// delete, mark resolved), a file's conflict blocks and what a choice per block makes of the file
// (the conflict view), and the prompt that asks an agent to resolve them.
// No Herdr imports: tested with node (test/git-enhanced/conflicts.test.mjs).
import { OPERATION_SH, operationOf, abortArgs as stopArgs, abortQuestion } from "./branches.js";
import { NO_EDITOR, LITERAL, ZERO, step, plan, problem, has, nulFields, records } from "./gitplan.js";

// ---- What is stopped, and where

/** sh's script that tells what is stopped: the marks of branches.js OPERATION_SH, then records
 *  "\036<name>\n<value>": `am` (a `git am` session, which keeps its state where a rebase does),
 *  the rebase's `head-name` (the branch being rebased), `onto` and `step` ("<done>\n<total>"),
 *  the commit being applied (REBASE_HEAD, CHERRY_PICK_HEAD, REVERT_HEAD), what a merge merges
 *  (MERGE_HEAD, one hash a line) and its message's first line, the picks or reverts in the
 *  sequencer's to-do list, and the branch and HEAD. Per worktree: the files are in this
 *  worktree's git dir. */
export const STOPPED_SH = [
  "printf '\\036marks\\n'", `( ${OPERATION_SH} )`,
  'g=$(git rev-parse --git-dir) || exit 1',
  "put() { printf '\\036%s\\n' \"$1\"; }",
  'put am; [ -e "$g/rebase-apply/applying" ] && echo yes',
  'put head-name; for d in rebase-merge rebase-apply; do [ -f "$g/$d/head-name" ] && { cat "$g/$d/head-name"; break; }; done',
  'put onto; for d in rebase-merge rebase-apply; do [ -f "$g/$d/onto" ] && { cat "$g/$d/onto"; break; }; done',
  'put step; if [ -f "$g/rebase-merge/msgnum" ]; then cat "$g/rebase-merge/msgnum" "$g/rebase-merge/end"; elif [ -f "$g/rebase-apply/next" ]; then cat "$g/rebase-apply/next" "$g/rebase-apply/last"; fi',
  'for f in REBASE_HEAD CHERRY_PICK_HEAD REVERT_HEAD MERGE_HEAD; do put "$f"; [ -f "$g/$f" ] && cat "$g/$f"; done',
  'put message; [ -f "$g/MERGE_MSG" ] && sed -n 1p "$g/MERGE_MSG"',
  "put left; [ -f \"$g/sequencer/todo\" ] && grep -c -v -e '^#' -e '^$' \"$g/sequencer/todo\"",
  'put branch; git symbolic-ref -q --short HEAD',
  'put head; git rev-parse -q --verify HEAD',
  "exit 0",
].join("\n");

const hashes = (s) => String(s ?? "").split("\n").map((l) => l.trim()).filter((l) => /^[0-9a-f]{40,64}$/.test(l));

/** STOPPED_SH's output: { op, branch, rebasing, onto, commit, merging, message, step, left, head }.
 *  `op`: "merge", "rebase", "cherry-pick", "revert", "am" or null; `rebasing`: the branch a rebase
 *  works on (null for a detached one); `commit`: the commit being applied; `merging`: what a merge
 *  merges; `step`: { done, total } of a rebase; `left`: the picks or reverts in git's to-do list
 *  (sequencer/todo), the one stopped at included; null without one (a single pick). */
export function parseStopped(stdout) {
  const r = records(stdout), one = (k) => (r[k] ?? "").trim() || null;
  let op = operationOf(r.marks ?? "");
  if (op === "rebase" && one("am") === "yes") op = "am";
  const headName = one("head-name");
  const [done, total] = (r.step ?? "").split("\n").map((n) => Number(n.trim()));
  const left = one("left");
  return {
    op, branch: one("branch"), head: one("head"),
    rebasing: headName && headName.startsWith("refs/heads/") ? headName.slice(11) : null,
    onto: hashes(r.onto)[0] ?? null,
    commit: hashes(r.REBASE_HEAD)[0] ?? hashes(r.CHERRY_PICK_HEAD)[0] ?? hashes(r.REVERT_HEAD)[0] ?? null,
    merging: hashes(r.MERGE_HEAD), message: one("message"),
    step: Number.isFinite(done) && Number.isFinite(total) && total > 0 ? { done, total } : null,
    left: left === null ? null : Number(left) || 0,
  };
}

const OPS = ["merge", "rebase", "cherry-pick", "revert", "am"];
const known = (op) => OPS.includes(op);

/** git's arguments that go on with operation `op` once its conflicts are resolved; no editor
 *  opens (the message git prepared is kept, its comment lines dropped as an edit would). A merge
 *  goes on with git commit where git is older than 2.12 (no merge --continue) or unknown. */
export const continueArgs = (op, version = null) => (!known(op) ? null
  : op === "merge" && !has(version, "merge-continue") ? [...NO_EDITOR, "commit"] : [...NO_EDITOR, op, "--continue"]);
/** …that leave out the commit being applied and go on (null: a merge can't skip). */
export const skipArgs = (op) => (known(op) && op !== "merge" ? [...NO_EDITOR, op, "--skip"] : null);
/** …that stop the operation and go back to before it (branches.js abortArgs). */
export const abortArgs = (op) => (known(op) ? stopArgs(op) : null);

const short = (h) => String(h ?? "").slice(0, 7);

/** Continue: refused while `unresolved` files still conflict (git would refuse too). It may stop
 *  again (a rebase's next commit can conflict). */
export function continuePlan(op, { unresolved = 0, version = null } = {}) {
  if (!known(op)) return problem("Nothing is in progress");
  if (unresolved > 0) return problem(`${unresolved} file${unresolved === 1 ? " still has" : "s still have"} conflicts: resolve ${unresolved === 1 ? "it" : "them"} first`);
  return plan([step(continueArgs(op, version), `git ${op} --continue`, { editor: true, stops: true, slow: true })]);
}

/** Skip the commit being applied (`stopped`: parseStopped): it's left out, and whatever was
 *  resolved for it so far is lost. A cherry-pick or revert skips on git 2.23 and newer (`version`:
 *  known and older, a problem). */
export function skipPlan(op, stopped = {}, { version = null } = {}) {
  if (!known(op)) return problem("Nothing is in progress");
  if (op === "merge") return problem("A merge can't skip: abort it, or resolve the conflicts");
  if ((op === "cherry-pick" || op === "revert") && version && !has(version, "sequencer-skip")) return problem(`Skipping in a ${op} needs git 2.23 or newer`);
  const c = stopped.commit ? `${short(stopped.commit)} ` : "";
  const what = op === "rebase" ? `Commit ${c}is left out of the rebased branch (it stays in the reflog)`
    : op === "cherry-pick" ? `Commit ${c}isn't picked`
    : op === "revert" ? `Commit ${c}isn't reverted`
    : "This patch isn't applied";
  return plan([step(skipArgs(op), `git ${op} --skip`, { editor: true, stops: true, slow: true })],
    { danger: true, confirm: `Skip it? ${what}, and the conflicts resolved for it so far are lost.` });
}

/** Abort: back to before the operation (branches.js abortQuestion says what is lost). */
export function abortPlan(op) {
  if (!known(op)) return problem("Nothing is in progress");
  const q = abortQuestion(op);
  return plan([step(abortArgs(op), `git ${op} --abort`, { slow: true })], { danger: true, confirm: `${q.title} ${q.detail}` });
}

/** Which version is which while `op` waits ({ branch, onto, commit }: parseStopped's or the
 *  page's words): during a rebase "ours" is where the commits are being replayed (the branch
 *  rebased onto, plus those replayed so far) and "theirs" the commit being replayed. */
export function sideNames(op, { branch = null, rebasing = null, onto = null, commit = null } = {}) {
  const b = branch ?? "HEAD", c = commit ? ` ${short(commit)}` : "";
  if (op === "rebase") return { ours: `${onto ? short(onto) : "The new base"} (being rebased onto)`, theirs: `Your commit${c}${rebasing ? ` from ${rebasing}` : ""}` };
  if (op === "cherry-pick") return { ours: b, theirs: `The picked commit${c}` };
  if (op === "revert") return { ours: b, theirs: `The revert of${c || " the commit"}` };
  if (op === "am") return { ours: b, theirs: "The patch" };
  return { ours: b, theirs: onto ?? "The merged branch" };
}

// ---- The files in conflict

/** `git status` that lists the files in conflict (the "u" entries), NUL separated. */
export const UNMERGED_ARGS = ["--no-optional-locks", "status", "--porcelain=v2", "-z", "--untracked-files=no", "--ignore-submodules=none"];

/** The kinds of conflict, by status code. */
export const KINDS = {
  UU: "both modified", AA: "both added", DD: "both deleted",
  AU: "added by us", UA: "added by them", DU: "deleted by us", UD: "deleted by them",
};

/** UNMERGED_ARGS' output as [{ path, xy, kind, base, ours, theirs, submodule, modes, hashes }]:
 *  `base`, `ours`, `theirs` say which versions git has (stages 1, 2, 3; an absent one has mode
 *  000000), `kind` the words for `xy` (KINDS). The other entries (changed, renamed: those take
 *  one more field, the old path) are passed over. */
export function parseUnmerged(stdout) {
  const parts = nulFields(stdout), out = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.startsWith("2 ")) { i++; continue; }
    if (!e.startsWith("u ")) continue;
    const f = e.split(" "), path = f.slice(10).join(" ");
    if (f.length < 11 || !path) continue;
    const [, xy, sub, m1, m2, m3, mW, h1, h2, h3] = f, has = (m) => !ZERO.test(m);
    out.push({ path, xy, kind: KINDS[xy] ?? "in conflict", base: has(m1), ours: has(m2), theirs: has(m3), submodule: sub !== "N...", modes: [m1, m2, m3, mW], hashes: [h1, h2, h3] });
  }
  return out;
}

/** What can be done with conflicted file `f` (parseUnmerged): its menu's items, { id, label,
 *  detail }. "edit" (resolve its blocks) only when both sides have it and it isn't a submodule. */
export function fileChoices(f, names = { ours: "ours", theirs: "theirs" }) {
  const items = [];
  if (f.ours && f.theirs && !f.submodule) items.push({ id: "edit", label: "Resolve the conflicts…", detail: "Choose per block, in the file's conflict view" });
  items.push(f.ours ? { id: "ours", label: `Take ${names.ours}`, detail: "Their changes to this file are dropped" } : { id: "ours", label: `Take ${names.ours}: deleted`, detail: "The file goes" });
  items.push(f.theirs ? { id: "theirs", label: `Take ${names.theirs}`, detail: "Our changes to this file are dropped" } : { id: "theirs", label: `Take ${names.theirs}: deleted`, detail: "The file goes" });
  if (f.ours || f.theirs) items.push({ id: "delete", label: "Delete the file", detail: "git rm" });
  items.push({ id: "resolved", label: "Mark as resolved", detail: "As the file is now (git add)" });
  return items;
}

/** Take a whole side of file `f` (parseUnmerged): its version from that side, staged; or, when
 *  that side deleted it, the file goes. Edits to its conflicts so far are lost. `names`: the
 *  sides in words (sideNames, as the menu says them: in a rebase "ours" is the new base). */
export function takeSidePlan(f, side, names = { ours: "ours", theirs: "theirs" }) {
  if (side !== "ours" && side !== "theirs") throw new Error(`no side ${side}`);
  const other = side === "ours" ? "theirs" : "ours", me = names[side], them = names[other];
  if (!f[side]) {
    return plan([step([LITERAL, "rm", "-q", "--", f.path], `${f.path} is deleted on ${side}`)],
      { danger: true, confirm: `Take ${me} for ${f.path}? It was deleted there: the file goes${f[other] ? `, with the changes of ${them}` : ""}.` });
  }
  return plan([step([LITERAL, "checkout", `--${side}`, "--", f.path], `${f.path} as ${side} has it`), step([LITERAL, "add", "--", f.path], "Marked resolved")],
    { danger: true, confirm: `Take ${me} for ${f.path}? ${f[other] ? `The changes of ${them} are dropped` : `It is kept as ${me} added it`}, and so is any editing of its conflicts so far.` });
}

/** Delete conflicted file `f` (git rm, both sides' changes go). */
export const deletePlan = (f) => plan([step([LITERAL, "rm", "-q", "--", f.path], `${f.path} deleted`)], { danger: true, confirm: `Delete ${f.path}? Both sides' versions of it go.` });

/** Mark `paths` resolved as they are in the working tree: staged, or a file that is gone staged
 *  as deleted (git add -A). */
export const resolvedPlan = (paths) => plan([step([LITERAL, "add", "-A", "--", ...paths], `Marked resolved: ${paths.join(", ")}`)]);

/** Start file `path` over: its conflict markers back as git first wrote them (`style` "merge",
 *  "diff3", or "zdiff3" (git 2.35) to show the base too); edits to it so far are lost. Works
 *  until the file is marked resolved. */
export function restartPlan(path, style = null) {
  const args = [LITERAL, "checkout", ...(style ? [`--conflict=${style}`] : ["-m"]), "--", path];
  return plan([step(args, `${path} back to its conflicts`)], { danger: true, confirm: `Start ${path} over? Its conflict markers come back as git wrote them; editing of it so far is lost.` });
}

// ---- A file's conflict blocks

/** git's arguments that tell the marker length of `path` (its conflict-marker-size attribute). */
export const markerSizeArgs = (path) => ["check-attr", "-z", "conflict-marker-size", "--", path];
/** That output as a length: the attribute's number, else git's 7. */
export function parseMarkerSize(stdout) {
  const f = nulFields(stdout), n = Number(f[2]);
  return Number.isInteger(n) && n > 0 ? n : 7;
}

// Adapted from lazygit pkg/gui/mergeconflicts/find_conflicts.go (MIT, Copyright (c) 2018 Jesse
// Duffield), determineLineType / isConflictMarker / isTargetMarker: a marker is exactly `size`
// of its character at the start of a line; the start, base and end markers may have a label
// after a space, the separator has nothing after it. Changed: a line's "\r" (CRLF) is no part of
// it, and a block that never ends, or a marker where none belongs, leaves its lines as text.
function markerOf(line, size) {
  const l = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (l.length < size) return null;
  const c = l[0];
  if (!"<|=>".includes(c)) return null;
  for (let i = 1; i < size; i++) if (l[i] !== c) return null;
  if (c === "=") return l.length === size ? { kind: "sep", label: "" } : null;
  if (l.length !== size && l[size] !== " ") return null;
  return { kind: c === "<" ? "start" : c === "|" ? "base" : "end", label: l.slice(size + 1) };
}

/** A file's text cut into its segments: `{ kind: "text", text }` and `{ kind: "conflict", index,
 *  ours, base, theirs, labels: { ours, base, theirs }, raw, line }` — each side's lines with their
 *  line ends, `base` null without a base section (merge.conflictStyle diff3 or zdiff3 writes one),
 *  `raw` the block as it is, `line` its first line (0-based). `size`: the marker length
 *  (parseMarkerSize). Every segment's text joined is the text again. */
export function parseConflicts(text, size = 7) {
  const lines = String(text ?? "").match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const segments = [];
  let plain = "", block = null, count = 0;
  const flushText = () => { if (plain) segments.push({ kind: "text", text: plain }); plain = ""; };
  const drop = () => { plain += block.raw; block = null; }; // not a conflict after all: its lines are text
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n], m = markerOf(line.replace(/\n$/, ""), size);
    if (block) {
      const part = block.part;
      if (m?.kind === "start" || (m?.kind === "base" && part !== "ours") || (m?.kind === "end" && part !== "theirs")) { drop(); n--; continue; }
      block.raw += line;
      if (m?.kind === "base" && part === "ours") { block.part = "base"; block.base = ""; block.labels.base = m.label; continue; }
      if (m?.kind === "sep" && part !== "theirs") { block.part = "theirs"; continue; }
      if (m?.kind === "end") {
        block.labels.theirs = m.label;
        flushText();
        const { ours, base, theirs, labels, raw, line: at } = block;
        segments.push({ kind: "conflict", index: count++, ours, base, theirs, labels, raw, line: at });
        block = null;
        continue;
      }
      block[part] += line;
      continue;
    }
    if (m?.kind === "start") { block = { part: "ours", ours: "", base: null, theirs: "", labels: { ours: m.label, base: null, theirs: "" }, raw: line, line: n }; continue; }
    plain += line;
  }
  if (block) drop();
  flushText();
  return segments;
}

// ---- Markers left in what is staged or on disk (before Continue, Mark as resolved)

// A marker line of `size` or more of its character (`size` exactly for one file), as git grep and
// grep read an ERE: the start and end markers may have a label after a space or tab, the
// separator nothing but a CR.
const START = (n) => `^<{${n}}([[:space:]]|$)`, SEP = (n) => `^={${n}}[[:space:]]?$`, END = (n) => `^>{${n}}([[:space:]]|$)`;

/** git grep's arguments that list the staged files (the index: what Continue commits) holding a
 *  start, a separator and an end marker line, 7 or more characters long (any conflict-marker-size
 *  of git's 7 and up), NUL separated. Text files only. Exit 1: none. */
export const MARKED_ARGS = ["grep", "--cached", "--no-color", "-I", "-l", "-z", "-E", "--all-match", "-e", START("7,"), "-e", SEP("7,"), "-e", END("7,")];
/** git's arguments that list the files staged against HEAD (what Continue would commit anew), NUL
 *  separated: MARKED_ARGS' files outside it were committed with their markers before, on purpose. */
export const STAGED_ARGS = ["diff", "--cached", "--name-only", "-z", "--no-renames", "--no-ext-diff", "HEAD", "--"];
/** The files of MARKED_ARGS' output that are in STAGED_ARGS' output: markers about to be committed. */
export function markedFiles(markedStdout, stagedStdout) {
  const staged = new Set(nulFields(stagedStdout));
  return nulFields(markedStdout).filter((p) => staged.has(p));
}
/** The question before Continue when `files` (markedFiles) still have conflict markers. */
export function markersQuestion(files) {
  const n = files.length, few = files.slice(0, 3).join(", ") + (n > 3 ? ` and ${n - 3} more` : "");
  return { title: `${n === 1 ? "A file still has" : `${n} files still have`} conflict markers: ${few}. Continue anyway?`,
    detail: `They would be committed with the markers in them (<<<<<<<, =======, >>>>>>>).`, danger: true };
}
/** sh's script that counts the conflict blocks of file "$2" with markers of size "$1" exactly (its
 *  start markers), for a file too big to read as text: grep, wherever the file is. Prints the
 *  number; exit 0. */
export const COUNT_MARKERS_SH = 'n=$1 p=$2; case $n in ""|*[!0-9]*) n=7;; esac; '
  + 'c=$(grep -c -E -e "^<{$n}([[:space:]]|\$)" -- "$p" 2>/dev/null) || c=0; printf "%s\n" "${c:-0}"; exit 0';

/** How many conflict blocks `segments` hold. */
export const conflictCount = (segments) => segments.filter((s) => s.kind === "conflict").length;

/** Whether `text` still has conflict blocks (before marking a file resolved). */
export const hasConflicts = (text, size = 7) => conflictCount(parseConflicts(text, size)) > 0;

/** The choices for a block: one side, both (ours first or theirs first), the base, or the block
 *  kept as it is, markers and all. */
export const CHOICES = ["ours", "theirs", "both", "both-theirs-first", "base", "keep"];

/** The file's text with `choices` made: an array or an object by block index ("keep" where none
 *  is given). A "base" for a block without one throws, as does a choice that is none. */
export function resolve(segments, choices = []) {
  let out = "";
  for (const s of segments) {
    if (s.kind !== "conflict") { out += s.text; continue; }
    const c = choices[s.index] ?? "keep";
    if (c === "ours") out += s.ours;
    else if (c === "theirs") out += s.theirs;
    else if (c === "both") out += s.ours + s.theirs;
    else if (c === "both-theirs-first") out += s.theirs + s.ours;
    else if (c === "base") { if (s.base === null) throw new Error(`Conflict ${s.index + 1} has no base: git writes one with merge.conflictStyle diff3`); out += s.base; }
    else if (c === "keep") out += s.raw;
    else throw new Error(`"${c}" is no choice`);
  }
  return out;
}

/** The blocks `choices` leave unresolved ("keep" or none given), by index. */
export const unresolved = (segments, choices = []) => segments.filter((s) => s.kind === "conflict" && (choices[s.index] ?? "keep") === "keep").map((s) => s.index);

// ---- Asking an agent

const OP_WORDS = { merge: "merge", rebase: "rebase", "cherry-pick": "cherry-pick", revert: "revert", am: "git am (applying patches)" };

/** The prompt that asks an agent to resolve the conflicts of operation `op` in `files` (paths,
 *  or parseUnmerged entries), on `branch`, from or onto `onto`, and to say what it chose. */
export function agentPrompt({ op, files = [], branch = null, onto = null, commit = null } = {}) {
  const list = files.map((f) => (typeof f === "string" ? `- ${f}` : `- ${f.path} (${f.kind ?? KINDS[f.xy] ?? "in conflict"})`));
  const what = op === "merge" ? `Merging ${onto ?? "another branch"} into ${branch ?? "the current branch"}`
    : op === "rebase" ? `Rebasing ${branch ?? "the current branch"} onto ${onto ?? "another commit"}${commit ? `, at its commit ${short(commit)}` : ""}`
    : op === "cherry-pick" ? `Cherry-picking ${commit ? `commit ${short(commit)}` : "a commit"} onto ${branch ?? "the current branch"}`
    : op === "revert" ? `Reverting ${commit ? `commit ${short(commit)}` : "a commit"} on ${branch ?? "the current branch"}`
    : `Applying a patch with git am on ${branch ?? "the current branch"}`;
  const sides = op === "rebase"
    ? "During a rebase the sides are the other way round: “ours” (HEAD, the first part of a block) is the new base with the commits replayed so far, and “theirs” is the commit being replayed."
    : "In each block, the part after <<<<<<< is ours (the current branch, HEAD) and the part before >>>>>>> is theirs (the incoming change); a part after ||||||| is the common base.";
  return [
    `A git ${OP_WORDS[op] ?? op ?? "operation"} stopped on conflicts. ${what}.`,
    "",
    list.length ? `Files in conflict:\n${list.join("\n")}` : "Find the files in conflict with: git status",
    "",
    "Please resolve them:",
    "1. In each file, work out what the result should be: one side, the other, or both combined, so the code is right. Remove every conflict marker (<<<<<<<, |||||||, =======, >>>>>>>).",
    "2. For a file deleted on one side, decide whether it should stay (git add) or go (git rm).",
    "3. Stage each file you resolved with git add (or git rm). Don't commit, and don't run --continue, --skip or --abort: I'll go on myself.",
    "4. Then tell me, file by file, what you chose and why, and anything you weren't sure about.",
    "",
    sides,
  ].join("\n");
}
