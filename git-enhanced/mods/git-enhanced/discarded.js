// Recently discarded (the "⋯" menu by Commit): before every revert (a file, a hunk, all, deleting
// a new file) the files as they are go into a commit, refs/<mod>/discarded/<ms>; the last
// 50 stay. Restore puts the files back as they were from it. gitops.js runs these scripts.
// No Herdr imports: tested with node (test/git-enhanced/discarded.test.mjs).
// The snapshot works like a stash, never touching the person's index: a private index file
// (GIT_INDEX_FILE) gets the files with git add, and the commit's
// parents are HEAD and the index as it was (a stash's two parents).
import { REFS, ID } from "./id.js";

export const DISCARDED = `${REFS}discarded/`;
/** How many snapshots stay. */
export const KEEP = 50;

/** sh's script that snapshots files before they are discarded; prints the commit.
 *  Arguments: mode ("paths": the files named after the message; "all": everything uncommitted),
 *  the ref to write, the commit message, the paths. Then only the newest KEEP refs stay. */
export const SNAPSHOT_SH = [
  "set -e",
  "mode=$1; ref=$2; msg=$3; shift 3",
  "head=$(git rev-parse -q --verify 'HEAD^{commit}' || true)",
  "idx=$(git rev-parse --git-path index)",
  `d=$(mktemp -d "\${TMPDIR:-/tmp}/${ID}.XXXXXX")`,
  "trap 'rm -rf \"$d\"' EXIT",
  // The index as it is (when git can write it: not mid-conflict), the stash's second parent. Its
  // copies keep its time (cp -p): with a later time, git would skip checking the content of an
  // entry added in the same second as an edit of the same size ("racy git"), and miss the edit.
  'itree=; [ -f "$idx" ] && cp -p "$idx" "$d/i" && itree=$(GIT_INDEX_FILE="$d/i" git write-tree 2>/dev/null || true)',
  'export GIT_INDEX_FILE="$d/w"',
  'if [ "$mode" = all ]; then',
  '  if [ -f "$idx" ]; then cp -p "$idx" "$d/w"; fi',
  "  git add -A",
  "else",
  '  if [ -n "$head" ]; then git read-tree "$head"; else git read-tree --empty; fi',
  // Only paths git knows here or on disk (a staged deletion's file is in neither once reverted).
  "  n=$#; i=0",
  '  while [ "$i" -lt "$n" ]; do p=$1; shift; i=$((i+1)); if [ -e "$p" ] || [ -L "$p" ] || git --literal-pathspecs ls-files --error-unmatch -- "$p" >/dev/null 2>&1; then set -- "$@" "$p"; fi; done',
  '  [ "$#" -eq 0 ] || git --literal-pathspecs add -A -- "$@"',
  "fi",
  "wtree=$(git write-tree)",
  "unset GIT_INDEX_FILE",
  'icommit=; [ -n "$itree" ] && icommit=$(git commit-tree "$itree" ${head:+-p "$head"} -m "index")',
  'c=$(git commit-tree "$wtree" ${head:+-p "$head"} ${icommit:+-p "$icommit"} -m "$msg")',
  'git update-ref "$ref" "$c"',
  `git for-each-ref --sort=-refname --format='%(refname)' ${DISCARDED} | tail -n +${KEEP + 1} | while IFS= read -r r; do git update-ref -d "$r"; done`,
  'echo "$c"',
].join("\n");

/** The snapshot's arguments: `exec("sh", snapshotArgs(...), { cwd: root, on })`. */
export const snapshotArgs = ({ mode = "paths", ref, message, paths = [] }) => ["-c", SNAPSHOT_SH, "sh", mode, ref, message, ...paths];

/** What goes for each revert overlay (menu.js props): the mode, the paths, the words. */
export function discardOf(p) {
  if (p.revertFile) {
    const f = p.revertFile, paths = f.from ? [f.from, f.path] : [f.path];
    return { root: f.root, on: f.on, mode: "paths", paths, message: f.xy === "??" ? `Delete ${f.path}` : `Revert ${f.path}` };
  }
  if (p.revertHunk) return { root: p.revertHunk.root, on: p.revertHunk.on, mode: "paths", paths: [p.revertHunk.path], message: `Revert a hunk of ${p.revertHunk.path}` };
  if (p.revertAll) return { root: p.revertAll.root, on: p.revertAll.on, mode: "all", paths: [], message: "Revert all" };
  return null;
}

/** sh's script listing the snapshots, newest first: per snapshot "\x1e" ref "\x1f" commit "\x1f"
 *  subject "\x1f", then its files against its first parent (git diff-tree --name-status -z). */
export const LIST_SH = [
  `for r in $(git for-each-ref --sort=-refname --format='%(refname)' ${DISCARDED}); do`,
  '  c=$(git rev-parse "$r") || continue',
  "  p=$(git rev-parse -q --verify \"$c^1\" || true)",
  "  printf '\\036%s\\037%s\\037%s\\037' \"$r\" \"$c\" \"$(git log -1 --format=%s \"$c\")\"",
  '  if [ -n "$p" ]; then git diff-tree -r -z --name-status --no-renames "$p" "$c"; else git diff-tree -r -z --root --name-status --no-renames "$c"; fi',
  "done",
].join("\n");

/** LIST_SH's output as `{ ref, commit, at, what, files: [{ status, path }] }`, newest first. */
export function parseDiscarded(stdout = "") {
  return stdout.split("\x1e").filter(Boolean).map((chunk) => {
    const [ref, commit, what, rest = ""] = chunk.split("\x1f"), parts = rest.split("\0"), files = [];
    // diff-tree --root prints the commit first, a line of its own.
    let k = /^[0-9a-f]{7,}$/.test(parts[0] ?? "") ? 1 : 0;
    for (; k + 1 < parts.length; k += 2) if (parts[k]) files.push({ status: parts[k], path: parts[k + 1] });
    return { ref, commit, at: Number(ref.slice(DISCARDED.length)) || 0, what, files };
  });
}

/** sh's script that tells, per path, the snapshot's blob ("-": none) and the file's now ("-":
 *  none, "?": not a file), as "<want> <have> <path>\0". Arguments: the commit, the paths. */
export const CHECK_SH = [
  "c=$1; shift",
  "for p; do",
  '  w=$(git rev-parse -q --verify "$c:$p" 2>/dev/null) || w=-',
  '  if [ -f "$p" ] || [ -L "$p" ]; then h=$(git hash-object -- "$p" 2>/dev/null) || h="?"; elif [ -e "$p" ]; then h="?"; else h=-; fi',
  "  printf '%s %s %s\\0' \"$w\" \"$h\" \"$p\"",
  "done",
].join("\n");

/** CHECK_SH's output as what a restore does to each path: "same" (nothing), "overwrite" (the
 *  file changed since), "recreate" (it's gone now), "delete" (the snapshot had none; one is here). */
export function restorePlan(stdout = "") {
  return stdout.split("\0").filter(Boolean).map((entry) => {
    const [want, have] = entry.split(" ", 2), path = entry.slice(want.length + have.length + 2);
    // Not a file now (a folder): left alone when the snapshot had nothing there either.
    const action = want === "-" ? (have === "-" || have === "?" ? "same" : "delete") : have === "-" ? "recreate" : have === want ? "same" : "overwrite";
    return { path, action };
  });
}

/** What a restore runs for a plan (restorePlan): `take`, the paths that come from the snapshot
 *  (git restore --source=<snapshot> --worktree: the files only, the index stays), and `drop`, the
 *  files the snapshot didn't have (rm -f). */
export function restoreSteps(plan) {
  return {
    take: plan.filter((p) => p.action === "overwrite" || p.action === "recreate").map((p) => p.path),
    drop: plan.filter((p) => p.action === "delete").map((p) => p.path),
  };
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

const files = (n) => `${n} file${n === 1 ? "" : "s"}`;
const some = (paths, most = 3) => (paths.length <= most ? paths.join(", ") : `${paths.slice(0, most).join(", ")} and ${paths.length - most} more`);

/** The Recently discarded list (parseDiscarded's copies): a Restore… button each, answering the copy's ref. */
export const discardedQuestion = (copies, now = Date.now()) => ({
  title: "Recently discarded", confirm: null, cancel: "Close", height: 460, width: 520, empty: "Nothing discarded yet",
  detail: `Before each revert the files go into a copy here (the last ${KEEP}). Restore puts them back as they were then; the index stays as it is.`,
  entries: copies.map((d) => ({ id: d.ref, title: d.what, detail: `${ago(d.at, now)} · ${files(d.files.length)}: ${some(d.files.map((f) => f.path))}`, button: "Restore…" })),
});

/** The question before restoring copy `d` by `plan` (restorePlan), or null when there is nothing
 *  to restore (every file is as it was). */
export function restoreQuestion(d, plan, now = Date.now()) {
  const by = (action) => plan.filter((x) => x.action === action).map((x) => x.path);
  const overwrite = by("overwrite"), recreate = by("recreate"), drop = by("delete");
  if (!overwrite.length && !recreate.length && !drop.length) return null;
  const changed = overwrite.length + drop.length;
  return {
    title: `Restore “${d.what}”?`, confirm: "Restore", danger: changed > 0,
    lines: [...overwrite.map((x) => `overwrites  ${x}`), ...recreate.map((x) => `recreates   ${x}`), ...drop.map((x) => `deletes     ${x}`)],
    detail: `The files as they were ${ago(d.at, now)}.${changed ? ` ${files(changed)} changed since; how they are now is kept as a copy first.` : ""}`,
  };
}
