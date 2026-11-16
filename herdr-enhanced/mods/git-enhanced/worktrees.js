// Worktrees (the History page's Worktrees… list, a branch's "Open in a new worktree…"): the
// worktrees git knows, adding one from a branch, a new branch, a commit or a remote branch (with
// listed untracked or ignored files such as .env copied in), removing (with force only after a
// question), pruning, locking, moving, the folder a new one goes to by default, and which ones are
// merged into a base so they can go.
// No Herdr imports: tested with node (test/git-enhanced/worktrees.test.mjs).
import { step, plan, problem, has, nulFields, unquoteC } from "./gitplan.js";
import { SAFE_ARGS } from "./gittrust.js";

const short = (h) => String(h ?? "").slice(0, 7);

/** git's arguments that list the worktrees: --porcelain, with -z on git 2.36 and newer (`version`:
 *  gitplan.js parseVersion of `git version`), where no name can break a line. */
export const listArgs = (version) => ["worktree", "list", "--porcelain", ...(has(version, "worktree-list-z") ? ["-z"] : [])];
/** Whether listArgs(version) asks for -z (what parseWorktrees is told). */
export const listZ = (version) => has(version, "worktree-list-z");

/** `git worktree list --porcelain` as [{ path, head, branch, detached, bare, locked, lockReason,
 *  prunable, prunableReason, main }], the main worktree first and the others by path (git's
 *  order). `z`: the -z
 *  form (fields end with NUL, a worktree with an empty field), else lines and a blank line after
 *  each worktree, where git C-quotes a lock reason that holds a newline (unquoted here) but not a
 *  path: a path holding a newline can't be read from that form. `branch`: its short name, null
 *  when detached; `prunableReason` is git's words, to show, not to read. */
export function parseWorktrees(stdout, { z = false } = {}) {
  const fields = z ? nulFields(stdout) : String(stdout ?? "").split("\n");
  const out = [];
  let cur = null;
  const end = () => { if (cur) out.push(cur); cur = null; };
  for (const f of fields) {
    if (f === "") { end(); continue; }
    const sp = f.indexOf(" "), key = sp < 0 ? f : f.slice(0, sp), value = sp < 0 ? null : f.slice(sp + 1);
    if (key === "worktree") { end(); cur = { path: value, head: null, branch: null, detached: false, bare: false, locked: false, lockReason: null, prunable: false, prunableReason: null, main: out.length === 0 }; continue; }
    if (!cur) continue;
    const text = (v) => (v === null ? null : z ? v : unquoteC(v));
    if (key === "HEAD") cur.head = value;
    else if (key === "branch") cur.branch = value?.startsWith("refs/heads/") ? value.slice(11) : value;
    else if (key === "detached") cur.detached = true;
    else if (key === "bare") cur.bare = true;
    else if (key === "locked") { cur.locked = true; cur.lockReason = text(value); }
    else if (key === "prunable") { cur.prunable = true; cur.prunableReason = text(value); }
  }
  end();
  return out;
}

/** The worktree of `list` whose folder is `top` (git rev-parse --show-toplevel there), or null. */
export const currentOf = (list, top) => list.find((w) => w.path === String(top ?? "").replace(/\n$/, "")) ?? null;

/** The branches checked out in a worktree of `list` (parseWorktrees) other than the one at `top`, as a
 *  Map branch → that worktree (its entry): git checks a branch out in one worktree at a time, and
 *  won't switch to it, delete it or move it anywhere else. A worktree whose folder is gone
 *  (`prunable`) keeps its branch too, until git forgets it (git worktree prune). */
export function elsewhere(list, top) {
  const here = String(top ?? "").replace(/\n$/, ""), out = new Map();
  for (const w of list ?? []) if (w.branch && !w.bare && w.path !== here) out.set(w.branch, w);
  return out;
}

/** A branch row's second line for worktree `w` (one of elsewhere's), its folder shown as `place`. */
export const whereWords = (w, place) => (w.doing ? `Being ${w.doing === "rebase" ? "rebased" : "bisected"} in ${place}`
  : `Checked out in ${place}${w.prunable ? " · folder gone" : w.missing ? " · folder gone, locked" : ""}`);

/** sh: of the folders given, those that aren't there (each followed by a NUL). */
export const MISSING_SH = `for p; do [ -e "$p" ] || printf '%s\\0' "$p"; done; exit 0`;

/** sh: for each worktree folder given, the branch that a rebase or a bisect there started from, if one
 *  is in progress: `git worktree list` says only "detached" then, while git keeps the branch to that
 *  worktree (it won't switch to it or delete it elsewhere). Lines "<rebase|bisect> US <folder> US
 *  <what git wrote: refs/heads/<name>, a name, or a hash>" (US: the byte 0x1f); a folder that is gone
 *  or isn't a worktree is left out. */
export const BUSY_SH = `for p; do
  g=$(cd "$p" 2>/dev/null && git rev-parse --git-dir 2>/dev/null) || continue
  case $g in /*) ;; *) g=$p/$g ;; esac
  for f in rebase-merge/head-name rebase-apply/head-name; do
    if [ -f "$g/$f" ]; then printf 'rebase\\037%s\\037%s\\n' "$p" "$(cat "$g/$f")"; continue 2; fi
  done
  if [ -f "$g/BISECT_START" ]; then printf 'bisect\\037%s\\037%s\\n' "$p" "$(cat "$g/BISECT_START")"; fi
done
exit 0`;

/** BUSY_SH's lines as [{ doing: "rebase" | "bisect", path, branch }]: refs/heads/ taken off; a rebase
 *  of a detached HEAD ("detached HEAD") and a bisect started on a commit (a hash) have no branch and
 *  are left out. */
export function parseBusy(stdout) {
  const out = [];
  for (const line of String(stdout ?? "").split("\n")) {
    const [doing, path, what = ""] = line.split("\x1f"), name = what.trim().replace(/^refs\/heads\//, "");
    if ((doing !== "rebase" && doing !== "bisect") || !path || !name || name === "detached HEAD" || /^[0-9a-f]{40,64}$/.test(name)) continue;
    out.push({ doing, path, branch: name });
  }
  return out;
}

/** `list` (parseWorktrees) with each detached worktree that `busy` (parseBusy) names given the branch
 *  its rebase or bisect started from and `doing`, as elsewhere() then counts it. */
export function withBusy(list, busy) {
  const by = new Map((busy ?? []).map((b) => [b.path, b]));
  return (list ?? []).map((w) => { const b = !w.branch && w.detached ? by.get(w.path) : null; return b ? { ...w, branch: b.branch, doing: b.doing } : w; });
}

/** The worktrees (parseWorktrees; `version`: the git version, for -z), with a rebase or a bisect in
 *  progress in one filled in (BUSY_SH, run only when one is detached); [] when git can't list them.
 *  `h`: a runner that reads. */
export async function readWorktrees(h, version) {
  const listed = await h.git(listArgs(version));
  let list = listed.code === 0 ? parseWorktrees(listed.stdout, { z: listZ(version) }) : [];
  // git doesn't call a locked worktree whose folder is gone prunable (the lock keeps it, and its
  // branch): `missing`, looked for when one is locked.
  const locked = list.filter((w) => w.locked && !w.main && !w.bare).map((w) => w.path);
  if (locked.length) {
    const m = await h.sh(MISSING_SH, locked).catch(() => null), gone = new Set(m?.code === 0 ? m.stdout.split("\0").filter(Boolean) : []);
    list = list.map((w) => (gone.has(w.path) ? { ...w, missing: true } : w));
  }
  const detached = list.filter((w) => w.detached && !w.prunable && !w.missing).map((w) => w.path);
  if (!detached.length) return list;
  const b = await h.sh(BUSY_SH, detached).catch(() => null);
  return b?.code === 0 ? withBusy(list, parseBusy(b.stdout)) : list;
}

/** `path` with the home folder `userHome` as "~" (null or empty: as it is). */
export function tilde(path, userHome) {
  const p = String(path ?? ""), h = String(userHome ?? "").replace(/\/+$/, "");
  return h && (p === h || p.startsWith(`${h}/`)) ? `~${p.slice(h.length)}` : p;
}

// Adapted from the Herdr app's worktree mod (mods/worktree/main.js: place, spaceOf; Apache-2.0).
/** Where space `s` is now: the folder of the first of its terminals that has one, else its own. */
const placeOf = (s, paneList) => {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return (paneList ?? []).find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
};
/** The space (of `spaceList`, Herdr's spaces(); `paneList`: its panes()) that is in worktree `path`
 *  on machine `on` (null: this computer), and not in another worktree of `all` (parseWorktrees) inside
 *  that one; undefined when none is. */
export function spaceFor(path, all, on, spaceList, paneList) {
  const inside = (p, dir) => p === dir || p.startsWith(`${dir}/`);
  return (spaceList ?? []).find((s) => {
    if ((s.machine ?? null) !== (on ?? null)) return false;
    const at = placeOf(s, paneList)?.replace(/\\/g, "/");
    if (!at || !inside(at, path)) return false;
    return !(all ?? []).some((c) => c.path !== path && c.path.length > path.length && inside(at, c.path));
  });
}

// Paths are POSIX on both ends (this computer and the machines exec reaches).
const baseOf = (p) => { const s = p.replace(/\/+$/, ""); return s.slice(s.lastIndexOf("/") + 1); };

/** Where a new worktree goes by default: Herdr's own worktree folder, where its worktree dialog
 *  (mods/worktree) and "Create worktree here…" (rewrite.js WORKTREE_SH) put them, so all of a
 *  repository's worktrees are in one place: <home>/.herdr/worktrees/<repository>/<label, anything
 *  but letters, digits, ".", "_" and "-" as one "-">. `label`: a branch, or a detached one's short hash; `home`: that machine's. */
export function defaultPath(mainPath, label, home) {
  const leaf = String(label ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "worktree";
  return `${String(home ?? "~").replace(/\/+$/, "")}/.herdr/worktrees/${baseOf(mainPath)}/${leaf}`;
}

/** sh's script that copies the listed files and folders ("$3"…, relative paths) from worktree "$1"
 *  into the new worktree "$2": their folders made, nothing ever overwritten (what is there already
 *  is left), links copied as links, modes and times kept. Prints "<status>\0<path>\0" for each:
 *  copied, exists, missing, bad (absolute, or reaching out with ..), failed. */
export const COPY_SH = 'src=$1 dst=$2; shift 2; case $src in -*) src=./$src;; esac; case $dst in -*) dst=./$dst;; esac; '
  + '[ -d "$dst" ] || { echo "$dst is no folder" >&2; exit 1; }; '
  + 'for p; do while :; do case $p in */) p=${p%/};; *) break;; esac; done; '
  + 'case $p in ""|/*|..|../*|*/..|*/../*) printf "bad\\0%s\\0" "$p"; continue;; esac; '
  + 'if [ ! -e "$src/$p" ] && [ ! -L "$src/$p" ]; then printf "missing\\0%s\\0" "$p"; continue; fi; '
  + 'if [ -e "$dst/$p" ] || [ -L "$dst/$p" ]; then printf "exists\\0%s\\0" "$p"; continue; fi; '
  + 'if mkdir -p -- "$(dirname "$dst/$p")" && cp -RPp -- "$src/$p" "$dst/$p"; then printf "copied\\0%s\\0" "$p"; else printf "failed\\0%s\\0" "$p"; fi; '
  + 'done; exit 0';

/** COPY_SH's output: [{ status, path }]. */
export function parseCopied(stdout) {
  const f = nulFields(stdout), out = [];
  for (let i = 0; i + 1 < f.length; i += 2) out.push({ status: f[i], path: f[i + 1] });
  return out;
}

/** git's arguments that list the ignored files and folders of the worktree (folders end with
 *  "/"), and the untracked ones: what may be worth copying into a new worktree. */
export const IGNORED_ARGS = ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory"];
export const UNTRACKED_ARGS = ["ls-files", "-z", "--others", "--exclude-standard", "--directory", "--no-empty-directory"];

/** The files of `paths` (IGNORED_ARGS' and UNTRACKED_ARGS' output, NUL separated, or a list) as
 *  { path, checked } for the copy list: environment files (.env, .env.*, .envrc, *.local) ticked,
 *  folders and the rest not; folders that are builds or installs (node_modules, target, dist…)
 *  left out. */
export function copyChoices(...outputs) {
  const BIG = /(^|\/)(node_modules|target|dist|build|out|\.venv|venv|__pycache__|\.next|\.cache|\.gradle|\.terraform|vendor)\/$/;
  const seen = new Set(), out = [];
  for (const o of outputs) for (const p of Array.isArray(o) ? o : nulFields(o)) {
    if (!p || seen.has(p) || BIG.test(p)) continue;
    seen.add(p);
    out.push({ path: p, checked: !p.endsWith("/") && /(^|\/)(\.env(\.[^/]+)?|\.envrc|[^/]+\.local)$/.test(p) });
  }
  return out;
}

/** Add a worktree at `path`, from one of:
 *  - `branch`: a local branch, checked out there (git refuses one checked out elsewhere);
 *  - `newBranch` (+ `from`, default HEAD): a new branch made there;
 *  - `commit`: a detached HEAD at that commit;
 *  - `remoteBranch` ("origin/feature/x"; `remote`: its remote's name, "origin", for a name with a
 *    slash): a new local branch tracking it, named `newBranch` or as it is there.
 *  Then `copy` (relative paths) from worktree `root` into it (COPY_SH). `lock`: locked, with
 *  `reason`. */
export function addPlan({ path, branch = null, newBranch = null, from = null, commit = null, remoteBranch = null, remote = null, copy = [], root = null, lock = false, reason = null } = {}) {
  if (!path) return problem("A worktree needs a folder");
  const locking = lock ? ["--lock", ...(reason ? ["--reason", reason] : [])] : [];
  let args, why;
  if (remoteBranch) {
    const r = remote ?? remoteBranch.split("/")[0], name = newBranch ?? remoteBranch.slice(r.length + 1);
    if (!remoteBranch.startsWith(`${r}/`) || !name) return problem(`${remoteBranch} isn't a branch of ${r}`);
    args = ["worktree", "add", ...locking, "--track", "-b", name, "--", path, `refs/remotes/${remoteBranch}`];
    why = `A worktree with ${name} tracking ${remoteBranch}`;
  } else if (newBranch) {
    args = ["worktree", "add", ...locking, "-b", newBranch, "--", path, ...(from ? [from] : [])];
    why = `A worktree with a new branch ${newBranch}${from ? ` at ${from}` : ""}`;
  } else if (branch) {
    // The short name: git checks out a branch it is given by name; refs/heads/<name> would be
    // taken for a commit, and the worktree's HEAD detached. (A branch's name can't start with "-".)
    args = ["worktree", "add", ...locking, "--", path, branch];
    why = `A worktree for ${branch}`;
  } else if (commit) {
    args = ["worktree", "add", ...locking, "--detach", "--", path, commit];
    why = `A worktree at ${short(commit)}`;
  } else return problem("Choose a branch, a new branch's name or a commit");
  if (copy.length && !root) return problem("Copying files needs the worktree they come from");
  return plan([step(args, why, { slow: true }), copy.length && { script: COPY_SH, args: [root, path, ...copy], why: `Copy ${copy.length === 1 ? copy[0] : `${copy.length} files`} into it` }]);
}

/** git's arguments that list worktree `path`'s ignored files and folders (IGNORED_ARGS there): git
 *  worktree remove deletes them without a word (it refuses only for changes and untracked files). */
export const ignoredArgs = (path) => ["-C", path, ...IGNORED_ARGS];

/** Ignored files in words: the first `few` and how many more ("a, b and 3 more"). */
export function namesOf(paths, few = 3) {
  const list = [...paths], shown = list.slice(0, few).join(", ");
  return list.length > few ? `${shown} and ${list.length - few} more` : shown;
}
/** The sentence that names the ignored files going with a worktree's folder ("" for none). */
export const ignoredWords = (ignored) => (ignored.length
  ? ` ${ignored.length === 1 ? "An ignored file goes" : `${ignored.length} ignored files go`} with the folder too: ${namesOf(ignored)}.`
  : "");

/** The question before removing worktree `w` the safe way; `ignored`: its ignored files
 *  (ignoredArgs), which git deletes with the folder (it refuses only for changes and untracked
 *  files). { title, detail }. */
export function removeQuestion(w, ignored = []) {
  return { title: `Remove the worktree at ${w.path}?`,
    detail: `Its folder goes; git refuses while it has uncommitted changes or untracked files.${ignoredWords(ignored)}${w.branch ? ` Its branch ${w.branch} stays.` : ""}` };
}

/** The question before removing worktree `w`, its state read first: `dirty` (uncommitted changes or
 *  untracked files) or a lock makes it forced (removePlan's own words), else removeQuestion's;
 *  `ignored`, its ignored files; `space` ({ name }), the space in it, which closes first. */
export function removeAsk(w, { ignored = [], dirty = false, space = null } = {}) {
  const closes = space ? ` The space ${space.name || "in it"} closes first, with its terminals.` : "";
  if (!dirty && !w.locked) { const q = removeQuestion(w, ignored); return { ...q, detail: `${q.detail}${closes}`, confirm: "Remove", danger: true }; }
  const text = removePlan(w, { force: true, ignored }).confirm, at = text.indexOf("? ");
  return { title: text.slice(0, at + 1), detail: `${text.slice(at + 2)}${closes}`, confirm: "Remove anyway", danger: true };
}

/** Remove worktree `w` (parseWorktrees). git refuses one with changes or untracked files, or a
 *  locked one, but not one with ignored files (`ignored`: named in the question); `force` removes
 *  it anyway (twice --force for a locked one): a danger plan. Its branch stays. */
export function removePlan(w, { force = false, ignored = [] } = {}) {
  if (w.main) return problem("The main worktree can't be removed");
  const branch = w.branch ? ` Its branch ${w.branch} stays.` : "";
  if (!force) return plan([step(["worktree", "remove", "--", w.path], `Remove the worktree at ${w.path}`)], { danger: ignored.length > 0 });
  return plan([step(["worktree", "remove", "--force", ...(w.locked ? ["--force"] : []), "--", w.path], `Remove the worktree at ${w.path} anyway`)],
    { danger: true, confirm: `Remove the worktree at ${w.path} anyway? Its uncommitted changes and untracked files are deleted with the folder${w.locked ? `, and it was locked${w.lockReason ? ` (${w.lockReason})` : ""}` : ""}.${ignoredWords(ignored)}${branch}` });
}

/** Forget the worktrees whose folders are gone (`list`: parseWorktrees; prunable ones, git 2.31).
 *  A folder on a disk that isn't connected looks gone too: lock a worktree to keep it. */
export function prunePlan(list = []) {
  const gone = list.filter((w) => w.prunable && !w.locked);
  const which = gone.length ? ` (${gone.slice(0, 5).map((w) => w.path).join(", ")}${gone.length > 5 ? "…" : ""})` : "";
  return plan([step(["worktree", "prune"], "Forget worktrees whose folders are gone")],
    { confirm: `Forget the worktrees whose folders are gone${which}? Their branches stay. A worktree on a disk that isn't connected now looks gone too: lock it to keep it.` });
}

/** Forget locked worktree `w` whose folder is gone (`missing`: git worktree prune leaves a locked one
 *  alone): git worktree remove -f -f, after a question that names the lock. */
export function forgetPlan(w) {
  const branch = w.branch ? ` Its branch ${w.branch} stays, free to check out elsewhere.` : "";
  return plan([step(["worktree", "remove", "--force", "--force", "--", w.path], `Forget the worktree at ${w.path}`)], { danger: true,
    confirm: `Forget the worktree at ${w.path}? It is locked${w.lockReason ? ` (${w.lockReason})` : ""} and its folder isn't there: git forgets it even so (git worktree remove -f -f). On a disk that isn't connected, the folder stays there, no longer a worktree.${branch}` });
}

/** Lock worktree `path` (pruning and removing leave it alone), with `reason`; unlock it. */
export const lockPlan = (path, reason = null) => plan([step(["worktree", "lock", ...(reason ? ["--reason", reason] : []), "--", path], `Lock ${path}`)]);
export const unlockPlan = (path) => plan([step(["worktree", "unlock", "--", path], `Unlock ${path}`)]);

/** Move worktree `w` to folder `to` (git 2.17): not the main one, not a locked one. */
export function movePlan(w, to) {
  if (w.main) return problem("The main worktree can't be moved");
  if (w.locked) return problem(`It is locked${w.lockReason ? ` (${w.lockReason})` : ""}: unlock it first`);
  if (!to) return problem("Where to?");
  return plan([step(["worktree", "move", "--", w.path, to], `Move ${w.path} to ${to}`, { slow: true })]);
}

// ---- Clean-up

/** sh's script that prints which of the commits "$2"… are in "$1" (a base such as main), a line each. */
export const MERGED_SH = 'base=$1; shift; for c; do git merge-base --is-ancestor "$c" "$base" 2>/dev/null && printf "%s\\n" "$c"; done; exit 0';

/** The worktrees of `list` that are merged into the base (`mergedStdout`: MERGED_SH's output for
 *  their heads), and may go: not the main one, not `current` (its path), not a locked or bare one. */
export function mergedWorktrees(list, mergedStdout, { current = null } = {}) {
  const merged = new Set(String(mergedStdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean));
  return list.filter((w) => !w.main && !w.bare && !w.locked && w.path !== current && w.head && merged.has(w.head));
}
/** MERGED_SH's arguments for the worktrees of `list` that could go, against `base`. */
export const mergedArgs = (list, base) => [base, ...new Set(list.filter((w) => !w.main && !w.bare && w.head).map((w) => w.head))];

/** The clean-up's choices for `worktrees` (mergedWorktrees): [{ w, note, checked, ignored }].
 *  "Merged" also holds a worktree that has no commits of its own yet (its head is the base's tip,
 *  `baseHead`) and a detached one at an old commit: those start unticked, with a note. One with
 *  ignored files (`ignored`: path -> its ignored files, ignoredArgs) isn't offered: removing it
 *  would delete them (`ignored` says which, for the question). */
export function cleanupChoices(worktrees, { baseHead = null, ignored = new Map() } = {}) {
  return worktrees.map((w) => {
    const its = ignored.get(w.path) ?? [];
    const note = its.length ? `ignored files: ${namesOf(its, 2)}` : w.detached || !w.branch ? "detached" : baseHead && w.head === baseHead ? "no commits of its own yet" : null;
    return { w, note, checked: !note, ignored: its };
  });
}

/** sh's script that removes each worktree "$1" (not by force: one with changes stays) and then,
 *  when "$2" isn't empty, deletes its branch with git branch -d (which keeps one whose commits
 *  aren't merged); then "$3" "$4"… for the next. A worktree that holds ignored files now is left
 *  (git would delete them without a word). Prints "<status>\0<name>\0" for each: removed, kept
 *  (git refused: changes; its words go to stderr) or ignored (the worktree's path), then deleted or
 *  branch-kept (its branch). */
export const CLEANUP_SH = 'while [ $# -ge 2 ]; do p=$1 b=$2; shift 2; '
  + `if [ -d "$p" ] && [ -n "$(git ${SAFE_ARGS.join(" ")} -C "$p" ${IGNORED_ARGS.filter((a) => a !== "-z").join(" ")} 2>/dev/null | head -n 1)" ]; then printf "ignored\\0%s\\0" "$p"; continue; fi; `
  + 'if git worktree remove -- "$p"; then printf "removed\\0%s\\0" "$p"; '
  + 'if [ -n "$b" ]; then if git branch -d -- "$b" >/dev/null 2>&1; then printf "deleted\\0%s\\0" "$b"; else printf "branch-kept\\0%s\\0" "$b"; fi; fi; '
  + 'else printf "kept\\0%s\\0" "$p"; fi; done; exit 0';

/** Remove `worktrees` (the ticked ones of cleanupChoices), and their branches too when `branches`
 *  (git branch -d, which keeps a branch with unmerged commits). One with changes or ignored files
 *  is kept, and the rest go on. The question is the ticked list itself: `confirm` is its words. */
export function cleanupPlan(worktrees, { branches = true } = {}) {
  if (!worktrees.length) return problem("No worktree to clean up");
  const args = worktrees.flatMap((w) => [w.path, branches && w.branch ? w.branch : ""]);
  return plan([{ script: CLEANUP_SH, args, why: `Remove ${worktrees.length === 1 ? "a merged worktree" : `${worktrees.length} merged worktrees`}`, slow: true }],
    { danger: true, confirm: `Remove ${worktrees.length === 1 ? `the worktree at ${worktrees[0].path}` : `${worktrees.length} worktrees`}${branches ? " and their branches" : ""}? Each is merged; one with uncommitted changes or ignored files is kept.` });
}
/** CLEANUP_SH's output: [{ status, path }] (COPY_SH's form). */
export const parseCleanup = parseCopied;
