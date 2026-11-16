// Agent turns (turnrec.js): what starts and ends one, the snapshot of a repository at a turn's
// start and end, what reverting a turn does to each file, which records are kept, and how a turn
// reads in the scope picker. The snapshots use a private GIT_INDEX_FILE, so the person's index,
// branches and files are never touched: the repository's index is copied to a temp file,
// `git add -A` (untracked files too) and `write-tree` run on the copy, and `commit-tree` (HEAD as
// parent) gives a commit kept by a ref under refs/<mod>/turns/<id>/. Restoring writes only the working tree.
// No Herdr imports: tested with node (test/git-enhanced/turns.test.mjs).
import { ID, KEY, REFS, AUTHOR } from "./id.js";
import { LIMIT_SH } from "./scripts.js";
import { SAFE_ARGS } from "./gittrust.js";

// The recorder's git, written out where the snapshot runs it through env (a function wouldn't reach
// it): no fsmonitor, no hooks (gittrust.js SAFE_ARGS).
const SAFE = SAFE_ARGS.join(" ");

/** Shared records (newest first) and the refs keeping their snapshots. */
export const TURNS = KEY.turns;
export const turnRef = (id, which) => `${REFS}turns/${id}/${which}`;
/** Seconds a snapshot may take; after that the turn is recorded as skipped. */
export const SNAP_SECONDS = 10;
export const TOO_BIG = "repository too big to snapshot";

/** What the recorder does on a check: turns to end (record ids) and agents to start one for.
 *  A turn starts when an agent is "working" and has no open turn; it ends when the agent is "done"
 *  or "idle" (or gone); "blocked" keeps it open. The first check closes every open turn (Herdr
 *  restarted mid-turn: it ends then) before starting new ones. Agents in `busy` (a snapshot of
 *  theirs is running) are left alone. */
export function turnEvents({ agents = [], open = [], first = false, busy = new Set() }) {
  const end = [], start = [], byAddress = new Map(agents.map((a) => [a.address, a]));
  const still = new Set();
  for (const r of open) {
    if (busy.has(r.address)) { still.add(r.address); continue; }
    const a = byAddress.get(r.address);
    if (first || !a || a.status === "done" || a.status === "idle") end.push(r.id);
    else still.add(r.address);
  }
  for (const a of agents) if (a.status === "working" && !still.has(a.address) && !busy.has(a.address)) start.push(a);
  return { end, start };
}

// The snapshot, as sh: $1 "commit" (kept by the ref $2 when not empty, message $3) or "tree" (the
// working tree's tree only); $4 the seconds each slow step may take. The slow git steps run under
// the watchdog (scripts.js LIMIT_SH: in the background, their output in files, never in the
// caller's pipe, so nothing left over keeps the caller waiting; stopped with what they started when
// the time is up, exit 142; the script's own messages on fd 3). The temp index goes in every case. The index is copied with its time
// (cp -p): git checks the content of an entry no older than the index file it reads, and a copy
// made later than the index would hide an edit made in the same second as the last `git add`
// ("racy git"). Our own identity, so a repository without one still snapshots.
// The two settings pinned for the private index (core.ignorestat, core.splitIndex) are adapted
// from cline/cline checkpoint-hooks.ts, SCRATCH_INDEX_GIT_CONFIG (Apache-2.0).
export const SNAPSHOT = LIMIT_SH + [
  `idx=$(mktemp "\${TMPDIR:-/tmp}/${ID}-turn.XXXXXX") || exit 1`,
  "trap 'rm -f \"$idx\" \"$idx.lock\" \"$idx.out\" \"$idx.err\" \"$idx.out.stopped\"' EXIT",
  "trap 'exit 143' HUP INT TERM",
  "s=${4:-10}",
  "src=$(git rev-parse --git-path index 2>&3) || exit 1",
  "if [ -f \"$src\" ]; then cp -p \"$src\" \"$idx\" || exit 1; else rm -f \"$idx\"; fi",
  `limit "$s" "$idx.out" "$idx.err" env GIT_INDEX_FILE="$idx" git ${SAFE} -c core.ignorestat=false -c core.splitIndex=false add -A; c=$?`,
  "[ \"$c\" = 142 ] && exit 142; [ \"$c\" = 0 ] || { cat \"$idx.err\" >&3; exit 1; }",
  `limit "$s" "$idx.out" "$idx.err" env GIT_INDEX_FILE="$idx" git ${SAFE} -c core.splitIndex=false write-tree; c=$?`,
  "[ \"$c\" = 142 ] && exit 142; [ \"$c\" = 0 ] || { cat \"$idx.err\" >&3; exit 1; }",
  "tree=$(cat \"$idx.out\")",
  "if [ \"$1\" = tree ]; then printf 'tree %s\\n' \"$tree\"; exit 0; fi",
  `export GIT_AUTHOR_NAME=${AUTHOR} GIT_AUTHOR_EMAIL=${AUTHOR}@localhost GIT_COMMITTER_NAME=${AUTHOR} GIT_COMMITTER_EMAIL=${AUTHOR}@localhost`,
  "if parent=$(git rev-parse -q --verify 'HEAD^{commit}'); then commit=$(git commit-tree \"$tree\" -p \"$parent\" -m \"$3\" 2>&3) || exit 1",
  "else commit=$(git commit-tree \"$tree\" -m \"$3\" 2>&3) || exit 1; fi",
  "if [ -n \"$2\" ]; then git update-ref \"$2\" \"$commit\" 2>&3 || exit 1; fi",
  "printf 'commit %s\\n' \"$commit\"",
].join("\n");

/** sh's arguments for a snapshot under the time limit: `exec("sh", snapshotArgs(...), { cwd: root,
 *  on })`. `tree`: only the working tree's tree (no commit, no ref). */
export const snapshotArgs = ({ ref = "", message = `${ID} turn`, tree = false, timeout = SNAP_SECONDS } = {}) =>
  ["-c", SNAPSHOT, "sh", tree ? "tree" : "commit", ref, message, String(timeout)];

/** A snapshot's result: `{ commit }` or `{ tree }`, `{ skipped }` when the time ran out, or `{ error }`. */
export function readSnapshot({ code, stdout = "", stderr = "" }) {
  const m = /^(commit|tree) ([0-9a-f]{40,64})$/m.exec(stdout);
  if (code === 0 && m) return { [m[1]]: m[2] };
  if (code === 142) return { skipped: TOO_BIG };
  return { error: (stderr || stdout).trim().split("\n").filter((l) => !l.startsWith("hint:")).join(" ").slice(0, 300) || `snapshot failed (${code})` };
}

/** What reverting a turn does to each file, from `git diff --name-status -z --no-renames <start>
 *  <end>`: a changed file goes back to how it was at the start, a created one is deleted, a deleted
 *  one comes back. `{ path, was, action: "restore" | "delete" }`, in path order. */
export function revertPlan(stdout) {
  const parts = String(stdout ?? "").split("\0"), out = [];
  for (let i = 0; i + 1 < parts.length && parts[i]; i += 2) {
    const was = parts[i][0], path = parts[i + 1];
    if (!path || path.startsWith("/") || path.split("/").includes("..")) continue;
    out.push({ path, was, action: was === "A" ? "delete" : "restore" });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
/** A plan's paths by action. */
export const planPaths = (plan) => ({ restore: plan.filter((p) => p.action === "restore").map((p) => p.path), remove: plan.filter((p) => p.action === "delete").map((p) => p.path) });
/** A plan step in words for the confirm dialog. */
export const planWords = (step) => (step.was === "A" ? "created by the turn: deleted" : step.was === "D" ? "deleted by the turn: brought back" : "back to how it was at the start");

/** The records to keep: per repository the newest `keep` (open turns always stay), newest first;
 *  and the dropped ones (their refs go). */
export function pruneTurns(records, keep = 50) {
  const count = new Map(), kept = [], dropped = [];
  const list = [...(Array.isArray(records) ? records : [])].filter((r) => r && r.id && r.repo).sort((a, b) => (b.start?.at ?? 0) - (a.start?.at ?? 0));
  for (const r of list) {
    const n = count.get(r.repo) ?? 0;
    if (!r.end || n < Math.max(0, keep)) { kept.push(r); count.set(r.repo, n + 1); }
    else dropped.push(r);
  }
  return { kept, dropped };
}

/** The refs a record keeps. */
export const recordRefs = (r) => ["start", "end", "undo"].map((w) => turnRef(r.id, w));

const hm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
/** A turn for people: "pi · 14:03–14:07 · 5 files" (running: "pi · 14:03– · running"). */
export function turnLabel(r) {
  const when = `${hm(r.start?.at ?? 0)}–${r.end ? hm(r.end.at) : ""}`;
  const what = r.skipped ? `skipped (${r.skipped})` : !r.end ? "running" : `${r.files ?? 0} file${r.files === 1 ? "" : "s"}`;
  return `${r.agent || "agent"} · ${when} · ${what}`;
}

/** Other turns of the same repository that ran at the same time as `r` (their changes mix). */
export function overlapping(records, r, now = Date.now()) {
  const from = r.start?.at ?? 0, to = r.end?.at ?? now;
  return records.filter((o) => o.id !== r.id && o.repo === r.repo && (o.start?.at ?? 0) < to && (o.end?.at ?? now) > from);
}

/** A new turn's id (safe in a ref name). */
export const turnId = (now = Date.now(), rand = Math.random()) => `${now.toString(36)}-${Math.floor(rand * 36 ** 4).toString(36).padStart(4, "0")}`;

/** A record that can be shown as a scope: both snapshots there (a running turn: its start). */
export const viewable = (r) => Boolean(r?.start?.commit && !r.skipped && (!r.end || r.end.commit));

/** The scope picker's rows for one repository's turns: `{ kind: "turn", id, title, sub, off, warn }`;
 *  `warn` when other turns ran at the same time (their changes mix). */
export function turnChoices(records, repo, now = Date.now()) {
  const mine = (Array.isArray(records) ? records : []).filter((r) => r?.repo === repo);
  return mine.map((r) => {
    const others = overlapping(mine, r, now);
    const sub = r.skipped ? `skipped: ${r.skipped}` : others.length ? `ran with ${[...new Set(others.map((o) => o.agent))].join(", ")}: their changes mix` : !r.end ? "running: against the working tree now" : r.reverted && !r.reverted.undone ? "reverted" : "";
    return { kind: "turn", id: r.id, title: turnLabel(r), sub, off: !viewable(r), warn: others.length > 0 };
  });
}

/** The header's name for a turn scope, and the scope in words (for a review sent to an agent). */
export const turnScopeLabel = (r) => (r ? `Turn · ${r.agent} ${hm(r.start?.at ?? 0)}` : "Turn");
export const turnScopeWords = (r) => (r ? `what ${r.agent}'s turn changed (${hm(r.start?.at ?? 0)}–${r.end ? hm(r.end.at) : "now: it is still running, so against the working tree"})` : "an agent's turn");
