// More for branches (the branch picker's menu, History's branch labels, a Clean up branches…
// dialog): each branch's upstream state (gone, ahead, behind), merged branches and the clean-up
// that deletes them, moving unpushed commits to a new branch, merge and rebase with options,
// switching back to the previous branch, and fast-forwarding a branch that isn't checked out.
// No Herdr imports: tested with node (test/git-enhanced/branchops.test.mjs).
import { NO_EDITOR, step, plan, problem, has, nulFields, refreshStep } from "./gitplan.js";

const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const list = (xs, most = 5) => `${xs.slice(0, most).join(", ")}${xs.length > most ? `, and ${xs.length - most} more` : ""}`;

// ---- Upstream state

/** for-each-ref over the local branches: name, upstream, git's tracking words ("[ahead 1,
 *  behind 2]", "[gone]": English in for-each-ref, which never translates them) and its short form
 *  ("<", ">", "<>", "=", nothing when gone), and whether it is HEAD; %00 between the fields. */
export const TRACK_ARGS = ["for-each-ref", "--format=%(refname)%00%(upstream)%00%(upstream:track)%00%(upstream:trackshort)%00%(HEAD)", "refs/heads"];

/** TRACK_ARGS' output as [{ name, upstream, ahead, behind, gone, current }]: `upstream` its
 *  short name ("origin/main", or a local branch's name) or null; `gone`: it has an upstream that
 *  isn't there any more (deleted on the remote, and pruned here). */
export function parseTracking(stdout) {
  const out = [];
  for (const line of String(stdout ?? "").split("\n")) {
    const [ref, up = "", track = "", short = "", head = ""] = line.split("\0");
    if (!ref?.startsWith("refs/heads/")) continue;
    const upstream = up ? up.replace(/^refs\/(remotes|heads)\//, "") : null;
    const num = (w) => Number(new RegExp(`${w} (\\d+)`).exec(track)?.[1] ?? 0);
    out.push({ name: ref.slice(11), upstream, ahead: num("ahead"), behind: num("behind"), gone: Boolean(upstream) && (/\bgone\b/.test(track) || !short), current: head === "*" });
  }
  return out;
}

// ---- Clean-up

/** The branches the clean-up never offers, whatever their state. */
export const PROTECTED = ["main", "master", "develop", "trunk"];

/** git's arguments that list the local branches merged into `base`. */
export const mergedArgs = (base) => ["for-each-ref", "--merged", base, "--format=%(refname)", "refs/heads"];
/** Their output as a Set of branch names. */
export const parseMerged = (stdout) => new Set(String(stdout ?? "").split("\n").filter((l) => l.startsWith("refs/heads/")).map((l) => l.slice(11)));

/** The branches the clean-up offers: merged into `base` (`merged`: parseMerged) or, with
 *  `gone`, whose upstream is gone. Never the current branch, `base`, PROTECTED ones, or one
 *  checked out in a worktree (`worktrees`: worktrees.js parseWorktrees). Each is { name, merged,
 *  gone }; one that isn't merged needs a forced delete. */
export function cleanupCandidates({ branches = [], merged = new Set(), base = null, worktrees = [], gone = true } = {}) {
  const busy = new Set(worktrees.map((w) => w.branch).filter(Boolean)), baseName = String(base ?? "").replace(/^refs\/heads\//, "");
  return branches
    .filter((b) => !b.current && b.name !== baseName && !PROTECTED.includes(b.name) && !busy.has(b.name))
    .filter((b) => merged.has(b.name) || (gone && b.gone))
    .map((b) => ({ name: b.name, merged: merged.has(b.name), gone: b.gone }));
}

/** sh's script that deletes each branch "$@" with git branch -d (git keeps one whose commits
 *  aren't merged into its upstream or HEAD) and goes on: "<deleted|kept>\0<name>\0" for each. */
export const DELETE_SH = 'for b; do if git branch -d -- "$b" >/dev/null 2>&1; then printf "deleted\\0%s\\0" "$b"; else printf "kept\\0%s\\0" "$b"; fi; done; exit 0';
/** DELETE_SH's output: [{ status, name }]. */
export function parseDeleted(stdout) {
  const f = nulFields(stdout), out = [];
  for (let i = 0; i + 1 < f.length; i += 2) out.push({ status: f[i], name: f[i + 1] });
  return out;
}

/** Delete `candidates` (cleanupCandidates): the safe way (git branch -d, which keeps any branch
 *  whose commits aren't merged), or with `force` those that aren't merged (git branch -D: a
 *  danger plan, their commits are then only in the reflog). */
export function cleanupPlan(candidates, { force = false } = {}) {
  if (!force) {
    if (!candidates.length) return problem("No branch to clean up");
    const names = candidates.map((c) => c.name);
    return plan([{ script: DELETE_SH, args: names, why: `Delete ${n(names.length, "merged branch", "merged branches")}` }],
      { confirm: `Delete ${n(names.length, "branch", "branches")} (${list(names)})? Each is merged or its upstream is gone; git keeps any whose commits aren't merged.` });
  }
  const names = candidates.filter((c) => !c.merged).map((c) => c.name);
  if (!names.length) return problem("Every branch here is merged: no forced delete is needed");
  return plan([step(["branch", "-D", "--", ...names], `Delete ${list(names)} by force`)],
    { danger: true, confirm: `Delete ${n(names.length, "branch", "branches")} whose commits aren't merged (${list(names)})? Their commits are then only in the reflog, which git cleans up after a while.` });
}

// ---- Moving unpushed commits

/** Move the `ahead` commits of `branch` that its upstream doesn't have to a new branch `name`;
 *  `branch` goes back to its upstream. `stay`: on `branch` (a new branch here, then git reset
 *  --keep @{u}, which brings the files back to the upstream's and keeps uncommitted changes, or
 *  refuses); else on the new branch (git switch -c, then git branch -f <branch> <branch>@{u}: no
 *  file changes at all). */
export function moveCommitsPlan({ branch = null, upstream = null, name = null, ahead = 0, stay = false, version = null } = {}) {
  if (!branch) return problem("No branch is checked out");
  if (!upstream) return problem(`${branch} has no upstream to go back to`);
  if (!ahead) return problem(`${branch} has no commits that ${upstream} doesn't have`);
  if (!String(name ?? "").trim()) return problem("The new branch needs a name");
  const to = name.trim(), what = `${n(ahead, "commit")} of ${branch} that ${upstream} doesn't have`;
  const steps = stay
    ? [step(["branch", to, "HEAD"], `${to} at ${branch}'s commits`), refreshStep(), step(["reset", "--keep", "@{u}"], `${branch} back to ${upstream}`)]
    : [step(has(version, "switch") ? ["switch", "-c", to] : ["checkout", "-b", to], `${to} at ${branch}'s commits, checked out`), step(["branch", "-f", branch, `${branch}@{u}`], `${branch} back to ${upstream}`)];
  return plan(steps, { confirm: `Move the ${what} to a new branch ${to}? ${branch} goes back to ${upstream}; ${stay ? `you stay on ${branch}, and its files become ${upstream}'s (uncommitted changes stay)` : `you go on working on ${to}, with nothing in the files changed`}.` });
}

// ---- Merge and rebase with options

/** git merge of `name` into the current branch: `ff` "no-ff" (always a merge commit), "ff-only"
 *  (only a fast-forward) or null (git's way); `squash` (the changes staged, no commit; not with
 *  no-ff); `commit` false stops before committing (--no-commit, which needs --no-ff to stop a
 *  fast-forward too); `message` the merge commit's, else git's (no editor either way). */
export function mergeArgs(name, { ff = null, squash = false, commit = true, message = null } = {}) {
  if (squash && ff === "no-ff") throw new Error("A squash merge makes no merge commit: it can't be --no-ff");
  const noFf = ff === "no-ff" || (!commit && !squash && ff !== "ff-only");
  return [...NO_EDITOR, "merge", ...(noFf ? ["--no-ff"] : ff === "ff-only" ? ["--ff-only"] : []), ...(squash ? ["--squash"] : []), ...(!commit && !squash ? ["--no-commit"] : []),
    ...(message?.trim() ? ["-m", message.trim()] : ["--no-edit"]), name];
}

/** What git merge is given for local branch `name`: its short name (git's message then says
 *  "Merge branch 'name'"), or refs/heads/<name> when a tag has that name too (`tagToo`): git takes
 *  the tag first for a short name. */
export const mergeTarget = (name, { tagToo = false } = {}) => (tagToo ? `refs/heads/${name}` : name);
/** git's arguments that tell whether a tag is called `name` too (exit 0: yes). */
export const tagTooArgs = (name) => ["rev-parse", "-q", "--verify", `refs/tags/${name}`];

/** mergeArgs as a plan for the `current` branch: it may stop on conflicts. `tagToo`: a tag has
 *  the branch's name too (mergeTarget). */
export function mergePlan(name, opts = {}, { current = null, tagToo = false } = {}) {
  if (!current) return problem("No branch is checked out");
  if (opts.squash && opts.ff === "no-ff") return problem("A squash merge makes no merge commit: it can't be --no-ff");
  const how = opts.squash ? `${name}'s changes are staged on ${current}, not committed: commit them yourself`
    : opts.commit === false ? `the merge stops before its commit, so you can look at it and commit`
    : opts.ff === "ff-only" ? `only if ${current} has no commits of its own (a fast-forward)`
    : opts.ff === "no-ff" ? "with a merge commit even when a fast-forward would do"
    : "a fast-forward when it can be, else a merge commit";
  return plan([step(mergeArgs(mergeTarget(name, { tagToo }), opts), `Merge ${name} into ${current}`, { editor: true, stops: true, slow: true })], { confirm: `Merge ${name} into ${current}: ${how}?` });
}

/** git rebase of the current branch onto `onto`: `autosquash` puts fixup!/squash! commits in
 *  place (before git 2.44 only an interactive rebase does: then -i with the list as git made it);
 *  `autostash` stashes uncommitted changes around it; `updateRefs` moves branches stacked on it
 *  along (git 2.38). No editor opens: squashed messages are git's. */
export function rebaseArgs(onto, { autosquash = false, autostash = false, updateRefs = false, version = null } = {}) {
  if (updateRefs && !has(version, "update-refs")) throw new Error("Moving stacked branches along (--update-refs) needs git 2.38 or newer");
  const interactive = autosquash && !has(version, "autosquash-plain");
  return [...NO_EDITOR, ...(interactive ? ["-c", "sequence.editor=true"] : []), "rebase", ...(interactive ? ["-i"] : []),
    ...(autosquash ? ["--autosquash"] : []), ...(autostash ? ["--autostash"] : []), ...(updateRefs ? ["--update-refs"] : []), onto];
}

/** rebaseArgs as a plan for `branch` (`upstream`: where it is pushed, if anywhere), onto local
 *  branch `onto` (given as refs/heads/<onto>: a tag of that name would win over the short name). */
export function rebasePlan(onto, opts = {}, { branch = null, upstream = null } = {}) {
  if (!branch) return problem("No branch is checked out");
  if (opts.updateRefs && !has(opts.version, "update-refs")) return problem("Moving stacked branches along needs git 2.38 or newer");
  const pushed = upstream ? ` ${branch} is on ${upstream}: after this they differ, and a push needs a force push.` : "";
  return plan([step(rebaseArgs(`refs/heads/${onto}`, opts), `Rebase ${branch} onto ${onto}`, { editor: true, stops: true, slow: true })],
    { confirm: `Rebase ${branch} onto ${onto}? Its own commits are made again on top, with new hashes.${pushed}` });
}

// ---- The previous branch, and fast-forwarding another

/** sh's script that tells where HEAD was before the last switch: its full ref name (empty for a
 *  detached commit), then its hash; exit 1 when there was none. */
export const PREVIOUS_SH = 'r=$(git rev-parse -q --symbolic-full-name "@{-1}" 2>/dev/null) || exit 1; h=$(git rev-parse -q --verify "@{-1}" 2>/dev/null) || exit 1; printf "%s\\n%s\\n" "$r" "$h"';
/** PREVIOUS_SH's output as { branch, sha } (`branch` null for a detached commit), or null. */
export function parsePrevious(stdout) {
  const [ref = "", sha = ""] = String(stdout ?? "").split("\n");
  if (!/^[0-9a-f]{40,64}$/.test(sha.trim())) return null;
  return { branch: ref.startsWith("refs/heads/") ? ref.slice(11) : null, sha: sha.trim() };
}
/** Back to `previous` (parsePrevious): its branch, or that commit detached (git 2.23's switch;
 *  checkout before). */
export function previousPlan(previous, { version = null } = {}) {
  if (!previous) return problem("There is no previous branch");
  const sw = has(version, "switch");
  const args = previous.branch ? (sw ? ["switch", previous.branch] : ["checkout", previous.branch]) : sw ? ["switch", "--detach", previous.sha] : ["checkout", "--detach", previous.sha];
  return plan([step(args, previous.branch ? `Back to ${previous.branch}` : `Back to ${previous.sha.slice(0, 7)}, detached`)]);
}

/** git's arguments that read branch `name`'s upstream as a full ref ("refs/remotes/origin/main"). */
export const upstreamRefArgs = (name) => ["rev-parse", "-q", "--symbolic-full-name", `${name}@{u}`];

/** Fast-forward branch `name`, not checked out, to `upstreamRef` (upstreamRefArgs): git fetch
 *  from this repository itself, which refuses a move that isn't a fast-forward and a branch
 *  checked out in any worktree. */
export function fastForwardPlan(name, upstreamRef) {
  if (!upstreamRef) return problem(`${name} has no upstream`);
  return plan([step(["fetch", ".", `${upstreamRef}:refs/heads/${name}`], `Fast-forward ${name} to ${upstreamRef.replace(/^refs\/(remotes|heads)\//, "")}`)]);
}
