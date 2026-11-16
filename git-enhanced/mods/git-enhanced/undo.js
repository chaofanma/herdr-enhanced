// Undo (the "⋯" menu by Commit): undo the last commit, and undo the last git action from HEAD's
// reflog the way lazygit does. gitops.js runs git; this is the pure part.
// No Herdr imports: tested with node (test/git-enhanced/undo.test.mjs).
import { UNDO_MARK as MARK } from "./id.js";

/** Undos made here are marked in the reflog (GIT_REFLOG_ACTION), so the next undo skips the
 *  action they undid and goes one further back; lazygit's marks count too. */
export const UNDO_MARK = MARK;

/** HEAD's reflog, newest first: `git log -g -n 200 REFLOG_FORMAT HEAD`. */
export const REFLOG_FORMAT = "--format=%H%x1f%gs";

/** The reflog's lines as `{ hash, subject }`. */
export function parseReflog(stdout = "") {
  return stdout.split("\n").filter(Boolean).map((line) => { const [hash, subject = ""] = line.split("\x1f"); return { hash, subject }; });
}

const REBASE_END = /^(?:rebase|pull --rebase)(?: -i)? \((?:abort|finish)\)/;
const REBASE_START = /^(?:rebase|pull --rebase)(?: -i)? \(start\)/;
const after = (s) => s.slice(s.indexOf(": ") + 2);

// Adapted from lazygit pkg/gui/controllers/undo_controller.go, parseReflogForActions (MIT, Copyright
// (c) 2018 Jesse Duffield): walk the reflog from the newest entry, counting undo marks, and the
// first user action no undo has taken back yet is the one to undo. Its kinds here: "checkout",
// "commit" (also an amend or a merge commit), "initial" (the branch's first commit), "move" (a
// reset, pull, merge, cherry-pick or revert), "rebase" (a finished rebase, from its start), and
// "rebasing" (one in progress: nothing can be undone).
/** The action an undo takes back, `{ kind, from, to, subject, start? }` (`from`: where HEAD was
 *  before it, a hash, or for a checkout the branch or commit it came from), or null. */
export function lastAction(entries) {
  let counter = 0, finish = null;
  for (let i = 0; i < entries.length; i++) {
    const { hash, subject: s } = entries[i], prev = entries[i + 1]?.hash ?? null;
    let action = null;
    if (finish === null) {
      if (/^\[[^\]\s]+ undo\]/.test(s)) { counter++; continue; }
      if (/^\[lazygit redo\]/.test(s)) { counter--; continue; }
      if (REBASE_END.test(s)) { finish = hash; continue; }
      const m = /^checkout: moving from (\S+) to (\S+)/.exec(s);
      if (m) action = { kind: "checkout", from: m[1], to: m[2] };
      else if (/^commit/.test(s)) action = /^commit \(initial\)/.test(s) ? { kind: "initial", from: null, to: hash } : { kind: "commit", from: prev, to: hash };
      else if (/^(?:reset: moving to|pull|merge |cherry-pick|revert)/.test(s)) action = { kind: "move", from: prev, to: hash };
      else if (REBASE_START.test(s)) action = { kind: "rebasing", from: prev };
    } else if (REBASE_START.test(s)) { action = { kind: "rebase", from: prev, to: finish, start: s }; finish = null; }
    if (!action) continue;
    // Going from one place to the same place (git stash's "reset: moving to HEAD") is no action.
    if (action.kind !== "rebasing" && action.kind !== "initial" && action.from === action.to) continue;
    if (action.from === null && action.kind !== "initial") continue;
    if (counter === 0) return { ...action, subject: s };
    counter--;
  }
  return null;
}

const quote = (s) => `“${s}”`;

/** The action in words for "Undo: …?". */
export function actionWords(a) {
  const s = a.subject ?? "";
  if (a.kind === "checkout") return `switch from ${a.from} to ${a.to}`;
  if (a.kind === "initial") return `the first commit ${quote(after(s))}`;
  if (a.kind === "commit") return /^commit \(amend\)/.test(s) ? `amend ${quote(after(s))}` : /^commit \(merge\)/.test(s) ? `merge commit ${quote(after(s))}` : `commit ${quote(after(s))}`;
  if (a.kind === "rebase") { const m = /\(start\): checkout (\S+)/.exec(a.start ?? ""); return m ? `rebase onto ${m[1]}` : "rebase"; }
  let m;
  if ((m = /^reset: moving to (.+)$/.exec(s))) return `reset to ${m[1]}`;
  if ((m = /^merge (\S+): (.*)$/.exec(s))) return `merge of ${m[1]}${/^Fast-forward/.test(m[2]) ? " (fast-forward)" : ""}`;
  if (/^pull/.test(s)) return `pull${/: Fast-forward/.test(s) ? " (fast-forward)" : ""}`;
  if (/^cherry-pick/.test(s)) return `cherry-pick ${quote(after(s))}`;
  if (/^revert/.test(s)) return `revert ${quote(after(s))}`;
  return s;
}

/** git's arguments that undo action `a` (lastAction): a commit goes back with --soft (its changes
 *  stay, staged: how things were before it), the branch's first commit by deleting the branch's
 *  ref (its files stay, staged), any other history move with --keep (which refuses to overwrite
 *  uncommitted changes), a checkout by switching back (`branch`: `from` is a local branch). */
export function undoArgs(a, branch) {
  if (a.kind === "checkout") return branch ? ["switch", a.from] : ["switch", "--detach", a.from];
  if (a.kind === "initial") return ["update-ref", "-d", "HEAD"];
  if (a.kind === "commit") return ["reset", "--soft", a.from];
  return ["reset", "--keep", a.from];
}

/** sh's script that runs git with the arguments after its first, which is GIT_REFLOG_ACTION (exec
 *  has no environment of its own): sh -c MARKED_SH sh UNDO_MARK <git args>. */
export const MARKED_SH = 'a=$1; shift; GIT_REFLOG_ACTION=$a exec git "$@"';
export const markedArgs = (args) => ["-c", MARKED_SH, "sh", UNDO_MARK, ...args];

/** The ⋯ menu's items: Undo last commit, Undo last git action…, Recently discarded…, Settings…
 *  (the panel's settings window). `hasHead`: something is committed; `operation`: a merge or rebase
 *  in progress (both undos wait for it). */
export function moreItems({ hasHead, operation }) {
  const off = !hasHead || Boolean(operation), why = operation ? `Not while a ${operation} is in progress` : "Nothing committed yet";
  return [
    { id: "undo-commit", label: "Undo last commit", detail: off ? why : "Its changes go back to staged", disabled: off },
    { id: "undo-action", label: "Undo last git action…", detail: off ? why : "Commit, amend, reset, switch, merge, pull…", disabled: off },
    { id: "discarded", label: "Recently discarded…", detail: "What reverts threw away, kept here" },
    { id: "settings", label: "Settings…", detail: "Diffs, committing, Open with, agents" },
  ];
}

/** The question before undoing HEAD's commit `c` ({ short, subject, parents, pushed }) on `branch`
 *  with `upstream`, or null when it needs none (an ordinary commit not pushed yet). */
export function undoCommitQuestion(c, { branch, upstream } = {}) {
  const what = `${c.short} “${c.subject}”`, b = branch ?? "the branch";
  const why = [
    c.parents.length === 0 && `${what} is the branch's first commit: undoing it leaves ${b} with no commits (git update-ref -d HEAD); its files stay, staged.`,
    c.parents.length > 1 && `${what} is a merge commit: undoing it puts everything it merged in back as staged changes.`,
    c.pushed && `${what} is already on ${upstream ?? "the upstream"}: afterwards ${b} and ${upstream ?? "its remote"} differ, and pushing the commit again needs --force.`,
  ].filter(Boolean);
  return why.length ? { title: "Undo the last commit?", detail: why.join(" "), confirm: "Undo commit", danger: Boolean(c.pushed) } : null;
}

/** The question before undoing action `a` (lastAction). `branch`, `upstream`, `ahead`: the
 *  current branch's (pushInfo); HEAD on the upstream (ahead 0) means they'll differ after. */
export function undoActionQuestion(a, { branch, upstream, ahead } = {}) {
  const short = (h) => String(h ?? "").slice(0, 7);
  const how = a.kind === "checkout" ? `git switch ${a.from}: it stops if uncommitted changes would be overwritten.`
    : a.kind === "initial" ? "The branch goes back to having no commits (git update-ref -d HEAD); the files stay, staged."
    : a.kind === "commit" ? `HEAD goes back to ${short(a.from)} with git reset --soft: the commit's changes stay, staged, as they were before it.`
    : `HEAD goes back to ${short(a.from)} with git reset --keep: files it changed come back as they were; git refuses if that would overwrite uncommitted changes.`;
  const differ = a.kind !== "checkout" && upstream && ahead === 0 ? ` ${branch} is on ${upstream} now: afterwards they differ.` : "";
  return { title: `Undo: ${actionWords(a)}?`, detail: how + differ, confirm: "Undo" };
}
