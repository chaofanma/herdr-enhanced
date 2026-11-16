// Pull, sync and push (the commit bar's Pull ▾, Sync and Push ▾, the History page's Fetch…):
// pull in the mode the person picks (fast-forward only, rebase, merge) with their changes stashed
// around it, how far the branch and its upstream are apart, Sync (pull, then push; Publish when
// there is no upstream), a force push that can't overwrite what wasn't seen, pushing tags, and
// fetches (every remote, pruning branches and tags).
// No Herdr imports: tested with node (test/git-enhanced/pullsync.test.mjs).
import { NO_EDITOR, step, plan, problem, has } from "./gitplan.js";

const short = (h) => String(h ?? "").slice(0, 7);
const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** git push of local branch `branch` to `remoteBranch` on `remote`, by full ref names (so
 *  push.default and a tag of the same name change nothing), with "--" before the remote: a remote
 *  may be called "-f", which git would take for an option. `track`: -u, the branch tracks it
 *  after; `followTags`: annotated tags on the pushed commits go too. (git pull has no "--": a
 *  remote like that is pulled as the branch's upstream, not by name.) */
export const pushArgs = (branch, remote, remoteBranch = branch, { track = false, followTags = false } = {}) =>
  ["push", ...(track ? ["-u"] : []), ...(followTags ? ["--follow-tags"] : []), "--", remote, `refs/heads/${branch}:refs/heads/${remoteBranch}`];

/** The pull modes, as the Pull ▾ menu lists them. */
export const PULL_MODES = ["ff-only", "rebase", "merge"];

/** git pull in `mode`: "ff-only" (only when the branch has no commits of its own), "rebase" (its
 *  own commits made again on top), "merge" (a merge commit when both sides have commits; git's
 *  message, no editor). Each says --rebase or --no-rebase, so the person's pull.rebase doesn't
 *  change it. `autostash`: uncommitted changes are stashed first and put back after (git 2.27 for
 *  ff-only and merge; left out on older git, where git refuses with changes in the way).
 *  `remote` and `branch`: pull that branch instead of the upstream. `keepMerges`: a rebase keeps
 *  the branch's own merge commits (--rebase=merges, git 2.18; plain --rebase flattens them). */
export function pullArgs(mode, { autostash = true, version = null, remote = null, branch = null, keepMerges = false } = {}) {
  if (!PULL_MODES.includes(mode)) throw new Error(`no pull mode ${mode}`);
  if (remote?.startsWith("-")) throw new Error(`git pull can't name remote ${remote} (it reads like an option): pull it as the branch's upstream`);
  const rebase = keepMerges && has(version, "rebase-merges") ? "--rebase=merges" : "--rebase";
  const args = [...NO_EDITOR, "pull", ...(mode === "rebase" ? [rebase] : ["--no-rebase", mode === "ff-only" ? "--ff-only" : "--no-edit"])];
  if (autostash && (mode === "rebase" || has(version, "merge-autostash"))) args.push("--autostash");
  if (remote) args.push(remote, ...(branch ? [`refs/heads/${branch}`] : []));
  return args;
}

/** The pull as one step: it fetches (a remote), and a rebase or merge may stop on conflicts. */
export const pullStep = (mode, opts = {}) => step(pullArgs(mode, opts), `git pull (${mode})`, { net: true, editor: true, slow: true, stops: mode !== "ff-only" });

/** git's arguments that count the commits HEAD has that `upstream` hasn't, and the other way. */
export const aheadBehindArgs = (upstream = "@{u}") => ["rev-list", "--left-right", "--count", `HEAD...${upstream}`];
/** Their output ("2\t3") as { ahead, behind }, or null. */
export function parseAheadBehind(stdout) {
  const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(String(stdout ?? ""));
  return m ? { ahead: Number(m[1]), behind: Number(m[2]) } : null;
}

/** How the branch and its upstream stand: `state` "none" (no upstream), "even", "ahead", "behind"
 *  or "diverged"; `words` for the bar; `pull` / `push`: there is something to; `modes`: the pull
 *  modes that can bring the upstream's commits in (fast-forward only can't once both have commits). */
export function divergence({ ahead = 0, behind = 0, upstream = null } = {}) {
  if (!upstream) return { state: "none", ahead: 0, behind: 0, pull: false, push: true, modes: [], words: "No upstream: Publish pushes it and tracks it" };
  const state = ahead && behind ? "diverged" : ahead ? "ahead" : behind ? "behind" : "even";
  const words = state === "even" ? `Up to date with ${upstream}`
    : state === "ahead" ? `${n(ahead, "commit")} to push to ${upstream}`
    : state === "behind" ? `${n(behind, "commit")} to pull from ${upstream}`
    : `${upstream} and this branch have diverged: ${ahead} to push, ${behind} to pull`;
  return { state, ahead, behind, pull: behind > 0, push: ahead > 0, modes: state === "diverged" ? ["rebase", "merge"] : PULL_MODES, words };
}

/** The Pull ▾ menu's items for `div` (divergence): fast-forward only says why when it can't. */
export function pullItems(div = {}) {
  const ff = div.state === "diverged";
  return [
    { id: "ff-only", label: "Pull (fast-forward only)", disabled: ff, detail: ff ? "The branches have diverged: rebase or merge" : "Only if this branch has no commits of its own" },
    { id: "rebase", label: "Pull, rebasing my commits", detail: "Your unpushed commits are made again on top (new hashes)" },
    { id: "merge", label: "Pull with a merge", detail: "A merge commit when both sides have commits" },
  ];
}

/** Sync the current `branch` with its `upstream` (`upstreamRemote`: its remote): pull in `mode`,
 *  then push (`followTags`: annotated tags on the pushed commits too). Without an upstream it is
 *  Publish: pushed to `remote` under its own name and tracked. A pull that stops on conflicts
 *  ends it before the push. `ahead`/`behind`: the counts known before (divergence). */
export function syncPlan({ branch = null, upstream = null, upstreamRemote = null, remote = null, mode = "rebase", ahead = 0, behind = 0, autostash = true, followTags = false, version = null } = {}) {
  if (!branch) return problem("No branch is checked out: switch to one first");
  if (!upstream) {
    if (!remote) return problem("No remote to publish to: add one first");
    return plan([step(pushArgs(branch, remote, branch, { track: true, followTags }), `Publish ${branch} to ${remote}`, { net: true, slow: true })]);
  }
  if (mode === "ff-only" && ahead > 0 && behind > 0) return problem("The branches have diverged: fast-forward only can't pull; choose rebase or merge");
  const pushRemote = upstreamRemote ?? remote;
  if (pushRemote === ".") return problem(`${branch}'s upstream ${upstream} is a local branch: there is nowhere to push`);
  if (!pushRemote || !upstream.startsWith(`${pushRemote}/`)) return problem(`${upstream} isn't on ${pushRemote ?? "a known remote"}: push it from the branch's menu`);
  const push = pushArgs(branch, pushRemote, upstream.slice(pushRemote.length + 1), { followTags });
  // A rebase makes the unpushed commits again (new hashes); it keeps their merges where git can.
  const merges = has(version, "rebase-merges");
  const again = mode === "rebase" && ahead > 0 && behind > 0
    ? ` Your ${n(ahead, "unpushed commit")} ${ahead === 1 ? "is" : "are"} made again on top of ${upstream}, with new hashes; ${merges ? "merge commits among them are kept" : "merge commits among them are flattened (keeping them needs git 2.18)"}.` : "";
  return plan([pullStep(mode, { autostash, version, keepMerges: true }), step(push, `Push ${branch} to ${upstream}`, { net: true, slow: true })],
    { confirm: `Sync ${branch} with ${upstream}? It pulls (${mode === "ff-only" ? "fast-forward only" : mode})${behind ? `, ${n(behind, "commit")} known to come in` : ""}, then pushes${ahead ? ` ${n(ahead, "commit")}` : ""}.${again}` });
}

// ---- Force push with a lease

/** git's arguments that read what `remote`/`branch` was when last fetched: the lease's expected hash. */
export const expectedArgs = (remote, branch) => ["rev-parse", "-q", "--verify", `refs/remotes/${remote}/${branch}`];
/** …that count the commits there that local branch `local` doesn't have: what a force push loses. */
export const lostArgs = (local, remote, branch) => ["rev-list", "--count", `refs/heads/${local}..refs/remotes/${remote}/${branch}`];

/** sh's script that checks what --force-if-includes checks: that commit "$2" (the remote branch
 *  as last fetched) is in local branch "$1" or in one of its reflog's entries, so the person has
 *  had it in their branch. Without that, a fetch in the background brought commits nobody looked
 *  at, and a force push would drop them. Exit 1 with why. */
export const INCLUDES_SH = 'b=$1 e=$2; git rev-parse -q --verify "$e^{commit}" >/dev/null || { echo "$e isn\'t here: fetch first" >&2; exit 1; }; '
  + 'left=$( { git rev-parse -q --verify "$b"; git rev-list -g "$b" 2>/dev/null; } | sed "s/^/^/" | git rev-list -n 1 --stdin "$e" ) || exit 1; '
  + '[ -z "$left" ] && exit 0; echo "The remote branch has commits that were fetched but never in ${b#refs/heads/}: pull or look at them first" >&2; exit 1';

/** Force push local `branch` to `remote`/`remoteBranch` (its name there; the same by default),
 *  replacing it only if it is still `expected` (expectedArgs: what the person saw) and the person
 *  has had that commit in their branch (INCLUDES_SH). git ignores --force-if-includes when the
 *  lease names its expected hash, which is why the plan checks that itself first; the flag goes
 *  along on git 2.30 and newer all the same. `lost`: lostArgs' count, for the question. */
export function forcePushPlan({ branch, remote, remoteBranch = branch, expected = null, lost = null, version = null } = {}) {
  if (!branch || !remote) return problem("No branch or remote to push");
  if (!expected) return problem(`${remote}/${remoteBranch} isn't known here: fetch first, so the push knows what it replaces`);
  const args = ["push", `--force-with-lease=refs/heads/${remoteBranch}:${expected}`, ...(has(version, "force-if-includes") ? ["--force-if-includes"] : []), "--", remote, `refs/heads/${branch}:refs/heads/${remoteBranch}`];
  const gone = lost === null ? "commits there that it doesn't have are lost for everyone" : lost === 0 ? "it has every commit there, so nothing is lost" : `${n(lost, "commit")} there that it doesn't have ${lost === 1 ? "is" : "are"} lost for everyone`;
  return plan([
    { script: INCLUDES_SH, args: [`refs/heads/${branch}`, expected], why: `${short(expected)} has been in ${branch}` },
    step(args, `Force push ${branch} to ${remote}/${remoteBranch}`, { net: true, slow: true }),
  ], { danger: lost !== 0, confirm: `Force push ${branch} to ${remote}/${remoteBranch}? It replaces ${remote}/${remoteBranch} (${short(expected)}): ${gone}. git refuses if it moved since, or if commits were fetched there that you never had in ${branch}.` });
}

// ---- Tags and fetches

/** git push of every tag (refs/tags/*) to `remote`. */
export const pushTagsArgs = (remote) => ["push", "--tags", "--", remote];
export const pushTagsPlan = (remote) => plan([step(pushTagsArgs(remote), `Push every tag to ${remote}`, { net: true, slow: true })]);

/** A fetch: of `remote`, or of every remote (`all`); `prune` drops remote branches gone there;
 *  `pruneTags` (one remote only; git 2.17) deletes local tags that remote doesn't have, which
 *  takes tags never pushed too: a danger plan. `tags`: every tag, not only those on fetched commits. */
export function fetchPlan({ remote = null, all = false, prune = true, pruneTags = false, tags = false, version = null } = {}) {
  if (!all && !remote) return problem("No remote to fetch from");
  if (pruneTags && all) return problem("Pruning tags takes one remote: with every remote, each one's fetch would delete the tags only the others have");
  if (pruneTags && !has(version, "prune-tags")) return problem("Pruning tags needs git 2.17 or newer");
  const args = ["fetch", ...(all ? ["--all"] : []), ...(prune || pruneTags ? ["--prune"] : []), ...(pruneTags ? ["--prune-tags"] : []), ...(tags ? ["--tags"] : []), ...(all ? [] : ["--", remote])];
  const s = step(args, all ? "Fetch every remote" : `Fetch ${remote}`, { net: true, slow: true });
  return pruneTags
    ? plan([s], { danger: true, confirm: `Fetch ${remote} and delete the local tags it doesn't have? Tags made here and never pushed to ${remote} are deleted too.` })
    : plan([s]);
}
