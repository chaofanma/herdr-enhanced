// Several repositories for one folder (repos.js): the commands that find them and read their
// branches, what they print, which one to show and the remembered choice. Modelled on VS Code's
// repository scan (extensions/git/src/model.ts scanWorkspaceFolders: the folder's own repo, then
// folders below it up to git.repositoryScanMaxDepth, node_modules skipped, a .git file counts as
// well as a folder, so submodules and nested repos are their own). Only a `.git` git would take
// counts (KEEP): a folder with a HEAD file, a file starting with "gitdir: ".
// No Herdr imports: tested with node (test/git-enhanced/reposcan.test.mjs).

/** At most this many repositories are listed. */
export const MAX = 50;
/** The scan's and the branch reading's time limits (ms, exec's `timeout`). */
export const SCAN_MS = 4000, INFO_MS = 6000;

/** The sh script find runs on the `.git` entries it found (`sh -c KEEP sh <path>...`): it prints
 *  the ones that are a repository's, each followed by a NUL. A folder counts when it has a HEAD
 *  file; a file (a submodule's or a worktree's) when its first line starts with "gitdir: ", as
 *  git reads it. The rest are not repositories: a `.git` folder that GitKraken left behind
 *  holding only its gk/ folder, a stray `.git` file. POSIX sh (dash too, no bash or perl); a file
 *  without a newline at its end is read too (read fills the line, then fails). Exits 0. */
export const KEEP = [
  "for g; do",
  "  if [ -d \"$g\" ]; then",
  "    if [ -f \"$g/HEAD\" ]; then printf '%s\\0' \"$g\"; fi",
  "  elif [ -f \"$g\" ]; then",
  "    l=",
  "    IFS= read -r l 2>/dev/null <\"$g\"",
  "    case $l in \"gitdir: \"*) printf '%s\\0' \"$g\" ;; esac",
  "  fi",
  "done",
].join("\n");

/** find's arguments for the repositories' `.git` entries (folders, or files for submodules and
 *  worktrees; KEEP leaves out the ones that aren't a repository's) `depth` folders below
 *  `folder`: `<folder>/<a>/.git` is one down. node_modules and .git folders are not entered.
 *  Null when depth is 0 (only the folder's own repository). */
export function scanArgs(folder, depth) {
  const d = Math.floor(Number(depth));
  if (!(d > 0)) return null;
  return [folder, "-maxdepth", String(d + 1), "(", "-name", "node_modules", "-prune", ")", "-o", "(", "-name", ".git", "-prune", "-exec", "sh", "-c", KEEP, "sh", "{}", "+", ")"];
}

const parent = (p) => p.slice(0, p.lastIndexOf("/")) || "/";

/** The repository roots find printed (NUL separated `.git` paths): each `.git`'s folder, in
 *  path order, without `top` (the folder's own repository, listed first by the caller) and
 *  without repeats; at most `max`. */
export function parseScan(stdout, top = null, max = MAX) {
  const roots = new Set();
  for (const entry of String(stdout ?? "").split("\0")) {
    if (!entry.endsWith("/.git")) continue;
    const root = parent(entry);
    if (root !== top) roots.add(root);
  }
  return [...roots].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, max);
}

/** sh's arguments for each root's branch (or short hash when detached; empty without commits),
 *  last commit time and index time (unix seconds; empty when unknown) and, with `counts`, the
 *  number of changed files as the Changes page counts them. Printed as NUL separated fields,
 *  five per root. `exec("sh", infoArgs(roots, true))`. */
export function infoArgs(roots, counts = false) {
  const script = [
    // GNU's stat -c or BSD's stat -f, whichever the machine has (no perl).
    "if stat -c %Y / >/dev/null 2>&1; then g=1; else g=0; fi",
    "for d; do",
    "  cd \"$d\" 2>/dev/null || { printf '%s\\0\\0\\0\\0\\0' \"$d\"; continue; }",
    "  b=$(git symbolic-ref -q --short HEAD 2>/dev/null || git rev-parse --verify -q --short HEAD 2>/dev/null)",
    "  c=$(git log -1 --format=%ct 2>/dev/null)",
    "  f=$(git rev-parse --git-path index 2>/dev/null); i=; if [ -n \"$f\" ] && [ -f \"$f\" ]; then if [ $g = 1 ]; then i=$(stat -c %Y \"$f\" 2>/dev/null); else i=$(stat -f %m \"$f\" 2>/dev/null); fi; fi",
    counts
      ? "  n=$(git --no-optional-locks status --porcelain=v1 -z --no-renames --untracked-files=all 2>/dev/null | tr -cd '\\000' | wc -c | tr -d ' ')"
      : "  n=",
    "  printf '%s\\0%s\\0%s\\0%s\\0%s\\0' \"$d\" \"$b\" \"$c\" \"$i\" \"$n\"",
    "done",
  ].join("\n");
  return ["-c", script, "sh", ...roots];
}

const num = (s) => (s === "" || s === undefined || !Number.isFinite(Number(s)) ? null : Number(s));

/** What infoArgs printed: Map(root → { branch, commit, index, changed }), null where unknown. */
export function parseInfo(stdout) {
  const parts = String(stdout ?? "").split("\0"), out = new Map();
  for (let i = 0; i + 4 < parts.length; i += 5) {
    const [root, branch, commit, index, changed] = parts.slice(i, i + 5);
    if (!root) continue;
    out.set(root, { branch: branch || null, commit: num(commit), index: num(index), changed: num(changed) });
  }
  return out;
}

/** When a repository last changed: its last commit or its index (an add, a checkout), whichever
 *  is later; 0 when neither is known. */
export const changedAt = (info) => Math.max(info?.commit ?? 0, info?.index ?? 0);

/** Which root to show: the remembered one while it is listed; else the one shown now (same
 *  folder, so the page doesn't jump while you work); else the repository the folder is in;
 *  else the most recently changed (ties: path order). Null when there is none. */
export function pickRepo({ roots, top = null, remembered = null, current = null, info = new Map() }) {
  const all = [...(top ? [top] : []), ...roots.filter((r) => r !== top)];
  if (remembered && all.includes(remembered)) return remembered;
  if (current && all.includes(current)) return current;
  if (top) return top;
  let best = null;
  for (const r of all) if (best === null || changedAt(info.get(r)) > changedAt(info.get(best))) best = r;
  return best;
}

/** The remembered choices' key for a folder: the machine (empty here) and the folder. */
export const folderKey = (on, folder) => `${on ?? ""}:${folder}`;

/** The remembered choices after picking `root` for `folder`: the folder's own repository
 *  (`top`) is its default anyway, so picking it forgets the choice. The newest `max` stay. */
export function rememberRepo(map, folder, root, top = null, max = 100) {
  const next = { ...(map && typeof map === "object" && !Array.isArray(map) ? map : {}) };
  delete next[folder];
  if (root && root !== top) next[folder] = root;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) delete next[k];
  return next;
}

/** A root's name for people: its folder's name, and where it is from the shown folder
 *  ("packages/api", "." for the folder itself, the full path when it is elsewhere). */
export function repoLabel(root, folder) {
  const name = root.slice(root.lastIndexOf("/") + 1) || root;
  const rel = root === folder ? "." : folder && root.startsWith(folder.endsWith("/") ? folder : `${folder}/`) ? root.slice(folder.length).replace(/^\//, "") : root;
  return { name, where: rel };
}
