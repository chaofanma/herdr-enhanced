// The panel's newer git actions (stashes, branches, undo, discarded changes, image copies, quiet
// fetches). Each takes `h`, a runner bound to one repository (runnerOf):
//   h.git(args, opts) / h.sh(script, args, opts) / h.run(cmd, args, opts) → Promise<{ code, stdout, stderr }>
// and throws git's own words (stashes.js gitSays) when git refuses. No Herdr imports: the caller
// hands its exec to runnerOf, and tests hand node's.
import { STASH_FORMAT, parseStashList, stashPushArgs, gitSays } from "./stashes.js";
import { pushArgs, upstreamArgs, deleteRemoteArgs, fetchArgs, pushTagArgs, deleteTagArgs, deleteRemoteTagArgs } from "./refs.js";
import { BRANCH_FORMAT, parseBranchRefs, OPERATION_SH, operationOf, abortArgs, remoteTarget } from "./branches.js";
import { REFLOG_FORMAT, parseReflog, lastAction, undoArgs, MARKED_SH, UNDO_MARK } from "./undo.js";
import { DISCARDED, SNAPSHOT_SH, LIST_SH, parseDiscarded, CHECK_SH, restorePlan, restoreSteps } from "./discarded.js";
import { IMAGES_SH, imagesArgs, parseCopies, pixelSize } from "./images.js";
import { FILES_SH, filesArgs, fileOf } from "./scripts.js";
import { APPLY } from "./hunk.js";

/** A runner for the repository at `cwd` (on machine `on`, null here) from an exec like Herdr's:
 *  exec(cmd, args, { cwd, on, timeout }). `files(list, body, args)` runs a script whose body finds
 *  the files (scripts.js fileOf) in "$d" (scripts.js FILES_SH): bytes for either end. */
export const runnerOf = (exec, cwd, on = null) => ({
  root: cwd, on,
  git: (args, opts = {}) => exec("git", args, { cwd, on, ...opts }),
  sh: (script, args = [], opts = {}) => exec("sh", ["-c", script, "sh", ...args], { cwd, on, ...opts }),
  run: (cmd, args = [], opts = {}) => exec(cmd, args, { cwd, on, ...opts }),
  files: (list, body, args = [], opts = {}) => exec("sh", ["-c", FILES_SH + body, "sh", ...filesArgs(list, args)], { cwd, on, ...opts }),
});

// stdout, or an Error with what git said.
const ok = (r, what) => { if (r.code !== 0) throw new Error(gitSays(r) || `${what} failed`); return r.stdout; };
const git = async (h, args, opts) => ok(await h.git(args, opts), `git ${args[0]}`);

/** Applies `patch` (hunk.js hunkPatch) with git apply's `flags` (hunk.js FLAGS): stages, unstages
 *  or reverts one hunk. git's refusal throws. */
export const applyPatch = async (h, patch, flags) => ok(await h.files([fileOf("patch", patch)], APPLY, flags), "git apply");

// ---- The working tree: what the file rows, the bar above them and the commit bar do

// git that may not ask for a password: there is no terminal to ask in, and it would wait for ever.
const NO_PROMPT = 'GIT_TERMINAL_PROMPT=0 exec git "$@"';
const net = async (h, args, timeout = 120000) => ok(await h.sh(NO_PROMPT, args, { timeout }), `git ${args[0]}`);

/** Deletes a file that was never committed: untracked (git clean -f) or only staged as new (git rm -f). */
export const deleteNew = (h, path, untracked) => git(h, ["--literal-pathspecs", ...(untracked ? ["clean", "-f", "-q"] : ["rm", "-f", "-q"]), "--", path]);

/** Revert all: every tracked file back to HEAD, the index too (git reset --hard), and the new files
 *  gone (git clean -fd). Ignored files stay. */
export async function revertEverything(h) {
  await git(h, ["reset", "--hard", "-q", "HEAD"]);
  await git(h, ["clean", "-fd", "-q"]);
}

/** git add -A's arguments for every change but the repositories inside this one (`leaveOut`: their
 *  paths as the status gives them, "sub/"): git would record each as an embedded repository (a
 *  gitlink, only the commit it is on). Each goes as `:(exclude,literal)<path>` with the whole tree
 *  (`:/`), so spaces, a leading "-", "*" or "?" stay literal; no --literal-pathspecs here, it would
 *  turn the magic off. */
export function addAllArgs(leaveOut = []) {
  if (!leaveOut.length) return ["add", "-A"];
  return ["add", "-A", "--", ":/", ...leaveOut.map((p) => `:(exclude,literal)${p}`)];
}

/** Stage all (git add -A, deletions too) but the repositories in `leaveOut`, or take everything out
 *  of the index again. */
export const stageEverything = (h, leaveOut = []) => git(h, addAllArgs(leaveOut));
export const unstageEverything = (h, hasHead = true) => git(h, hasHead ? ["reset", "-q"] : ["rm", "-r", "-q", "--cached", "--", "."]);

/** Commits what is staged with `message`, which goes as a file (any length, nothing to quote);
 *  `amend` rewrites the last commit instead; `stageAll` stages every change first, but the
 *  repositories in `leaveOut` (addAllArgs). */
export async function commitStaged(h, { message, amend = false, stageAll = false, leaveOut = [] }) {
  if (stageAll) await git(h, addAllArgs(leaveOut));
  return ok(await h.files([fileOf("message", message)], 'git commit "$@" -F "$d/message"', amend ? ["--amend"] : [], { timeout: 120000 }), amend ? "git commit --amend" : "git commit");
}

/** git push to the upstream; without one, the branch is published: pushed to `remote` and tracked
 *  there (git push -u <remote> HEAD). */
export const pushBranch = (h, { upstream, remote }) => net(h, upstream ? ["push"] : ["push", "-u", remote, "HEAD"]);
/** git fetch --prune, and git pull that only fast-forwards (a branch that diverged fails with git's words). */
export const fetchRemote = (h) => net(h, ["fetch", "--prune"]);
export const pullFastForward = (h) => net(h, ["pull", "--ff-only"]);

/** Switches to `branch`, or makes it from HEAD first (`create`); git refuses when local changes would be lost. */
export const switchBranch = (h, branch, create = false) => git(h, create ? ["switch", "-c", branch] : ["switch", branch]);

/** The last commit's whole message, or null. */
export async function lastMessage(h) {
  const r = await h.git(["log", "-1", "--format=%B"]);
  return r.code === 0 ? r.stdout.replace(/\s+$/, "") : null;
}

/** Whether HEAD is on its upstream already (amending it rewrites a pushed commit). */
export const headPushed = async (h) => (await h.git(["merge-base", "--is-ancestor", "HEAD", "@{u}"])).code === 0;

/** A quiet fetch (the settings' autoFetch): git may not ask for a password, and prints nothing. */
// Plain `git`, not `exec git`: a reader's script defines git as a function (SAFE_GIT_SH) that exec skips.
export const quietFetch = async (h) => ok(await h.sh("export GIT_TERMINAL_PROMPT=0; git fetch --prune --quiet", [], { timeout: 120000 }), "git fetch");

// Stashes

/** The repo's stashes, newest first (stashes.js parseStashList); [] when git can't list them. */
export async function stashEntries(h) {
  const r = await h.git(["stash", "list", STASH_FORMAT]);
  return r.code === 0 ? parseStashList(r.stdout) : [];
}

// Where stash `hash` is now: stash@{n} moves when another one is made or dropped.
async function stashRef(h, hash) {
  const s = (await stashEntries(h)).find((x) => x.hash === hash);
  if (!s) throw new Error("That stash is gone: popped or dropped meanwhile");
  return s.ref;
}

/** git stash apply (or pop) of stash `hash`; a conflict throws git's CONFLICT lines. */
export const stashApplyEntry = async (h, hash, pop) => git(h, ["stash", pop ? "pop" : "apply", await stashRef(h, hash)]);
export const stashDrop = async (h, hash) => git(h, ["stash", "drop", await stashRef(h, hash)]);
/** git stash push with the Stash… dialog's choices (stashes.js stashPushArgs). */
export const stashPush = (h, choices) => git(h, stashPushArgs(choices));

/** The stash's changes as one patch: its tracked changes and the untracked files it holds
 *  (`git stash show -p --include-untracked`; git before 2.32 can't show those: then without). */
export async function stashPatch(h, hash) {
  const base = ["-c", "diff.noprefix=false", "-c", "diff.mnemonicPrefix=false", "stash", "show", "-p", "--no-color", "--no-ext-diff", "--no-textconv"];
  let r = await h.git([...base, "--include-untracked", hash]);
  if (r.code !== 0 && /include-untracked|unknown option/.test(r.stderr)) r = await h.git([...base, hash]);
  return ok(r, "git stash show");
}

// Branches

/** The local and remote branches, most recently committed first (branches.js parseBranchRefs). */
export async function branchRefs(h) {
  const remotes = (await h.git(["remote"])).stdout.split("\n").filter(Boolean);
  return parseBranchRefs(await git(h, ["for-each-ref", "--sort=-committerdate", BRANCH_FORMAT, "refs/heads", "refs/remotes"]), remotes);
}

/** Whether `name` can be a branch's name (git check-ref-format --branch). */
export const validBranchName = async (h, name) => (await h.git(["check-ref-format", "--branch", name])).code === 0;
export const renameBranch = (h, from, to) => git(h, ["branch", "-m", "--", from, to]);
/** git branch -d (refuses a branch whose commits aren't merged: branches.js notMerged), or -D. */
export const deleteBranch = (h, name, force) => git(h, ["branch", force ? "-D" : "-d", "--", name]);

// The History page's labels (refs.js has git's arguments)

/** The remotes' names. */
export const remoteNames = async (h) => (await h.git(["remote"])).stdout.split("\n").filter(Boolean);
/** A remote's fetch URL, or null. */
export const remoteUrl = async (h, remote) => { const r = await h.git(["remote", "get-url", remote]); return r.code === 0 ? r.stdout.trim() : null; };
/** Pushes local branch `b` ({ name, upstream }) to its upstream, or publishes it to `remote`. */
export const pushLocalBranch = (h, b, where) => net(h, pushArgs(b, where));
export const setUpstream = (h, name, remoteBranch) => git(h, upstreamArgs(name, remoteBranch));
export const deleteRemoteBranch = (h, remote, branch) => net(h, deleteRemoteArgs(remote, branch));
export const fetchFrom = (h, remote) => net(h, fetchArgs(remote));
export const pushTag = (h, remote, tag) => net(h, pushTagArgs(remote, tag));
export const deleteTag = (h, tag) => git(h, deleteTagArgs(tag));
export const deleteRemoteTag = (h, remote, tag) => net(h, deleteRemoteTagArgs(remote, tag));

/** What is in progress: "merge", "rebase", "cherry-pick", "revert", or null. */
export async function repoOperation(h) {
  const r = await h.sh(OPERATION_SH);
  return r.code === 0 ? operationOf(r.stdout) : null;
}

// A merge or rebase: no editor opens (there is no terminal), and one that stops on conflicts is
// not an error: { stopped: git's words }; a refusal (local changes in the way) throws.
async function mayStop(h, args) {
  const r = await h.git(["-c", "core.editor=true", ...args], { timeout: 120000 });
  if (r.code === 0) return { stopped: null };
  const said = gitSays(r);
  if (/CONFLICT|could not apply/i.test(said) && await repoOperation(h)) return { stopped: said };
  throw new Error(said || `git ${args[0]} failed`);
}
/** git merge --no-edit `name`: a fast-forward, or a merge commit with git's message. */
export const mergeBranch = (h, name) => mayStop(h, ["merge", "--no-edit", name]);
/** git rebase `name`: the current branch's own commits made again on top of it. */
export const rebaseOnto = (h, name) => mayStop(h, ["rebase", name]);
export const abortOperation = (h, op) => git(h, ["-c", "core.editor=true", ...abortArgs(op)]);

/** A click on remote branch `rb` (branches.js remoteTarget): switch to the local branch that
 *  tracks it, or make one tracking it. */
export function switchRemote(h, rb, local) {
  const to = remoteTarget(rb, local);
  return git(h, to.local ? ["switch", to.local] : ["switch", "--track", to.track]);
}

// Undo

/** The last action an undo takes back (undo.js lastAction), from HEAD's last 200 reflog entries. */
export async function lastGitAction(h) {
  const r = await h.git(["log", "-g", "-n", "200", REFLOG_FORMAT, "HEAD"]);
  return r.code === 0 ? lastAction(parseReflog(r.stdout)) : null;
}

// git with the undo mark as GIT_REFLOG_ACTION (exec has no environment of its own).
const marked = async (h, args) => ok(await h.sh(MARKED_SH, [UNDO_MARK, ...args]), `git ${args[0]}`);

/** Undoes `action` (undo.js undoArgs), marked as an undo in the reflog. */
export async function undoGitAction(h, action) {
  const branch = action.kind === "checkout" && (await h.git(["rev-parse", "-q", "--verify", `refs/heads/${action.from}`])).code === 0;
  return marked(h, undoArgs(action, branch));
}

/** HEAD's commit: { short, parents, subject, message, pushed } (`pushed`: its upstream has it), or null. */
export async function headCommit(h) {
  const r = await h.git(["log", "-1", "--format=%h%x1f%P%x1f%s%x1f%B", "HEAD"]);
  if (r.code !== 0) return null;
  const [short, parents, subject, ...message] = r.stdout.split("\x1f");
  const pushed = (await h.git(["merge-base", "--is-ancestor", "HEAD", "@{u}"])).code === 0;
  return { short, parents: parents.split(" ").filter(Boolean), subject, message: message.join("\x1f").replace(/\s+$/, ""), pushed };
}

/** Undo last commit: git reset --soft HEAD~1 (its changes go back to staged), or for the branch's
 *  first commit git update-ref -d HEAD (no commits; its files stay, staged). Marked as an undo. */
export const undoLastCommit = (h, first) => marked(h, first ? ["update-ref", "-d", "HEAD"] : ["reset", "--soft", "HEAD~1"]);

// Discarded changes

/** Keeps a copy of what a revert is about to discard (discarded.js discardOf: mode, paths,
 *  message): a commit under refs/<mod>/discarded/<ms>. Throws when git can't make it. */
export async function keepDiscarded(h, { mode = "paths", paths = [], message }) {
  return ok(await h.sh(SNAPSHOT_SH, [mode, `${DISCARDED}${Date.now()}`, message, ...paths], { timeout: 120000 }), "keeping a copy").trim();
}

/** The copies kept, newest first, with their files (discarded.js parseDiscarded). */
export const discardedList = async (h) => parseDiscarded(ok(await h.sh(LIST_SH, [], { timeout: 60000 }), "listing the copies"));

/** What restoring copy `commit` does to each of `paths` (discarded.js restorePlan). */
export const restorePlanOf = async (h, commit, paths) => restorePlan(ok(await h.sh(CHECK_SH, [commit, ...paths], { timeout: 60000 }), "comparing the files"));

/** Restores copy `commit` by `plan`: the files as they are now are kept as a copy first (a
 *  restore discards them, so it can be taken back too), then the copy's files come back into the
 *  working tree only (the index stays) and the files it didn't have go. */
export async function restoreDiscarded(h, commit, plan, words) {
  const { take, drop } = restoreSteps(plan);
  if (!take.length && !drop.length) return;
  await keepDiscarded(h, { paths: [...take, ...drop], message: `Before restoring ${words}` });
  if (take.length) await git(h, ["--literal-pathspecs", "restore", `--source=${commit}`, "--worktree", "--", ...take]);
  if (drop.length) ok(await h.run("rm", ["-f", "--", ...drop]), "rm");
}

// Images

/** Copies an image diff's two sides (images.js imageSides) into folder `dir` (in the app's folder:
 *  image() shows nothing else), the newest 20 kept: `{ before, after }`, each `{ name, bytes, size }`
 *  (`size`: { width, height } or null) or null (no such side). */
export async function imageCopies(h, dir, ext, sides) {
  const [before, after] = parseCopies(ok(await h.sh(IMAGES_SH, imagesArgs(dir, ext, sides), { timeout: 60000 }), "copying the image"));
  const sized = (c) => (c ? { name: c.name, bytes: c.bytes, size: pixelSize(c.head, ext) } : null);
  return { before: sized(before), after: sized(after) };
}

// Renamed files: both paths go together (renames.js pathsOf).

/** Stages `paths` (a rename: its new path and the old one's removal). */
export const stagePaths = (h, paths) => git(h, ["--literal-pathspecs", "add", "-A", "--", ...paths]);
/** Unstages `paths`; without a commit there is nothing to restore from: out of the index. */
export const unstagePaths = (h, paths, hasHead = true) => git(h, hasHead ? ["--literal-pathspecs", "restore", "--staged", "--", ...paths] : ["--literal-pathspecs", "rm", "-r", "-q", "--cached", "--", ...paths]);
/** Reverts a rename (`from` → `path`), staged and unstaged: the old file back from HEAD, the new one gone. */
export const revertPaths = (h, paths) => git(h, ["--literal-pathspecs", "restore", "--source=HEAD", "--staged", "--worktree", "--", ...paths]);

/** A renamed file's old path, deleted in the index and gone from the files, back from HEAD;
 *  nothing when something is at that path now. */
export const bringBack = async (h, path) =>
  ok(await h.sh('[ -e "$1" ] || [ -L "$1" ] || exec git --literal-pathspecs restore --source=HEAD --staged --worktree -- "$1"', [path]), "git restore");
