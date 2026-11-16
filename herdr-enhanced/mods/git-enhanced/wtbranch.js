// A branch checked out in another worktree (worktrees.js elsewhere): what its menus offer instead of
// what git refuses for it. "Go to its worktree" (or, its folder gone, forget the missing worktrees);
// Delete… removes that worktree or detaches it first, then deletes the branch as git branch -d does;
// Fast-forward runs in that worktree, where its files and index move with the branch (moving the
// branch from here would leave them behind). Nothing here reads a view: a flow gets `h` (planflow.js)
// and `spaces` (wtspaces.js). No Herdr imports: tested with node.
import { plan, step, problem, runPlan } from "./gitplan.js";
import { carryOut } from "./planflow.js";
import { deleteBranch } from "./gitops.js";
import { OPERATION_SH, operationOf, notMerged, forceDeleteQuestion, remoteUpstream, upstreamRef } from "./branches.js";
import { removeFacts, removeNow } from "./wtremove.js";
import * as W from "./worktrees.js";

/** Whether worktree `w`'s folder is gone (git's prunable, or `missing`: locked). */
export const goneOf = (w) => Boolean(w?.prunable || w?.missing);

/** The first item of a branch's menu when worktree `w` (shown as `place`) has it: go there, or, its
 *  folder gone, forget it (forgetFlow). `name`: the local branch's, in a remote branch's menu. */
export function goItem(w, place, name = null) {
  if (!goneOf(w)) return { id: "worktree", label: name ? `Go to ${name}'s worktree` : "Go to its worktree", detail: W.whereWords(w, place) };
  const detail = `${name ? `${name}'s worktree: ` : ""}${place} is gone${w.missing ? `; it is locked${w.lockReason ? ` (${w.lockReason})` : ""}` : ""}`;
  return { id: "forget", label: w.prunable ? "Forget the missing worktrees…" : name ? `Forget ${name}'s worktree…` : "Forget its worktree…", detail };
}

/** A label's menu (refs.js refItems) when worktree `w` (shown as `place`) has its branch (a remote
 *  branch's: its local branch `name`): Check out goes there instead (goItem); Rename… and Delete…
 *  wait as whyNot says. */
export function withWorktree(items, w, place, name = null) {
  const not = whyNot(w, place);
  return items.map((x) => (x.id === "checkout" || x.id === "track" ? goItem(w, place, name)
    : (x.id === "rename" || x.id === "delete") && not[x.id] ? { ...x, disabled: true, detail: not[x.id] } : x));
}

/** Forget worktree `w`, whose folder is gone, after asking: git worktree prune for every missing one
 *  (`list`: the worktrees), or, locked, that one by force (worktrees.js forgetPlan). */
export const forgetFlow = (h, w, list = []) => (w.prunable ? carryOut(h, W.prunePlan(list), { kind: "worktree", yes: "Forget them" })
  : carryOut(h, W.forgetPlan(w), { kind: "worktree", yes: "Forget it" }));

/** Why Delete… can't run for a branch whose worktree `w` has it, or null: a folder that is gone is
 *  forgotten first. */
export const deleteWhy = (w) => (goneOf(w) ? "Its worktree's folder is gone: forget it first" : null);

/** Why Rename… can't run for a branch worktree `w` (shown as `place`) has, or null: git won't rename
 *  a branch that a rebase or a bisect there started from ("is being rebased at …"). */
export const renameWhy = (w, place) => (w?.doing ? `${W.whereWords(w, place)}: finish or abort it there first` : null);

/** What a branch's menu (branches.js branchMenu) can't do while worktree `w`, shown as `place`, has
 *  that branch: { rename, delete }. */
export const whyNot = (w, place) => ({ rename: renameWhy(w, place), delete: deleteWhy(w) });

/** Why a fast-forward of the branch in worktree `w` (shown as `place`) can't run there, or null:
 *  `there` is stateThere's. */
export function ffThereWhy(w, place, there) {
  if (goneOf(w)) return "Its worktree's folder is gone";
  if (w.doing) return W.whereWords(w, place);
  if (there?.operation) return `A ${there.operation} is in progress in ${place}`;
  if (there?.dirty) return `${place} has uncommitted changes`;
  return null;
}

/** What worktree `w` holds now, before a fast-forward there: `dirty`, changes to tracked files,
 *  staged or not (git would carry them along, but someone may be working there; a folder git can't
 *  read counts as dirty), and `operation`, a merge, cherry-pick or revert stopped there (operationOf). */
export async function stateThere(h, w) {
  const r = h.reads ?? h;
  const st = await r.git(["-C", w.path, "status", "--porcelain", "--untracked-files=no"]).catch(() => null);
  const op = await r.sh(`cd "$1" || exit 1; ${OPERATION_SH}`, [w.path]).catch(() => null);
  return { dirty: !st || st.code !== 0 || st.stdout.trim() !== "", operation: op?.code === 0 ? operationOf(op.stdout) : null };
}

/** Fast-forward `w`'s branch to `upstreamRef` in that worktree: git merge --ff-only there moves its
 *  files and index too. */
export function ffTherePlan(w, upstreamRef) {
  if (!upstreamRef) return problem(`${w.branch} has no upstream`);
  return plan([step(["-C", w.path, "merge", "--ff-only", upstreamRef], `Fast-forward ${w.branch} in ${w.path}`)]);
}

/** Detach worktree `w` (it keeps its files and changes, on the same commit): its branch is free. */
export const detachPlan = (w) => plan([step(["-C", w.path, "checkout", "--detach"], `Detach the worktree at ${w.path}`)]);

/** Whether git branch -d takes branch `b` (merged into its upstream when that resolves, else into
 *  HEAD here: git's own rule): true, false, or null when git can't tell. */
export async function mergedOf(h, b) {
  const r = h.reads ?? h, ancestor = async (into) => (await r.git(["merge-base", "--is-ancestor", `refs/heads/${b.name}`, into]).catch(() => null))?.code;
  const up = upstreamRef(b);
  let code = up ? await ancestor(up) : null;
  if (code !== 0 && code !== 1) code = await ancestor("HEAD");
  return code === 0 ? true : code === 1 ? false : null;
}

// The branch's part of a question: -d, or -D for one that isn't merged; its remote branch stays.
function deleteWords(b, merged) {
  const remote = remoteUpstream(b) ? ` Its remote branch ${b.upstream} stays.` : "";
  if (merged === false) return `Then git branch -D ${b.name}: it isn't merged, so its commits that no other branch has would be only in the reflog, which git cleans up after a while.${remote}`;
  return `Then git branch -d ${b.name}${merged === null ? "; if git refuses, you're asked again" : ""}.${remote}`;
}

/** The question before removing worktree `w` (shown as `place`) and deleting its branch `b`:
 *  `dirty` or a lock make the removal forced; `ignored` (its ignored files) and `space` (the space
 *  in it, which closes first) are named, and a rebase or a bisect stopped there; `merged`,
 *  mergedOf's. */
export function removeAndDeleteAsk(b, w, place, { ignored = [], dirty = false, space = null, merged = null } = {}) {
  const forced = dirty || w.locked;
  const what = forced ? `Its uncommitted changes and untracked files are deleted with the folder${w.locked ? `, and it was locked${w.lockReason ? ` (${w.lockReason})` : ""}` : ""}.` : "Its folder goes.";
  const doing = w.doing ? ` The ${w.doing} in progress there is abandoned.` : "";
  const closes = space ? ` The space ${space.name || "in it"} closes first, with its terminals.` : "";
  return { title: `Remove the worktree at ${place}${forced ? " anyway" : ""} and delete ${b.name}?`,
    detail: `${what}${doing}${W.ignoredWords(ignored)}${closes} ${deleteWords(b, merged)}`,
    confirm: forced || merged === false ? "Remove and delete anyway" : "Remove and delete", danger: true };
}

/** The question before detaching worktree `w` (shown as `place`) and deleting its branch `b`. */
export const detachAndDeleteAsk = (b, w, place, merged = null) => ({
  title: `Detach the worktree at ${place} and delete ${b.name}?`,
  detail: `It stays where it is, with its files and changes, on the same commit (git checkout --detach there). ${deleteWords(b, merged)}`,
  confirm: merged === false ? "Detach and delete anyway" : "Detach and delete", danger: true,
});

// The branch goes once its worktree has let it go: -D when it isn't merged (asked already), else
// -d, and git refusing that asks again.
async function deleteAfter(h, b, merged) {
  try { await deleteBranch(h, b.name, merged === false); }
  catch (e) {
    if (!notMerged(e.message)) throw e;
    if (await h.ask(forceDeleteQuestion(b, e.message))) await deleteBranch(h, b.name, true);
  }
}

/** Delete… on branch `b`, checked out in worktree `w` (shown as `place`; `list`: the worktrees;
 *  `spaces`: wtspaces.js): remove that worktree (wtremove.js) or detach it, after one question, then
 *  the branch; the branch stays when the worktree does. A worktree in the middle of a rebase or a
 *  bisect keeps the branch while detached: only removing it frees it. The main worktree can't be
 *  removed. */
export async function deleteThereFlow(h, b, { w, place, list = [], spaces = null }) {
  const how = !w.doing ? "checked out" : `being ${w.doing === "rebase" ? "rebased" : "bisected"}`;
  const pick = await h.choose({ title: `${b.name} is ${how} in ${place}`, width: 320, items: [
    { id: "remove", label: `Remove the worktree and delete ${b.name}…`, danger: true,
      ...(w.main ? { disabled: true, detail: "The main worktree can't be removed" } : { detail: "Its folder goes too" }) },
    { id: "detach", label: `Detach the worktree and delete ${b.name}…`,
      ...(w.doing ? { disabled: true, detail: `${W.whereWords(w, place)}: finish or abort it there first` } : { detail: "Its folder stays, on the same commit" }) },
  ] });
  if (!pick || !h.same()) return;
  const merged = await mergedOf(h, b);
  if (pick === "detach") {
    if (!(await h.ask(detachAndDeleteAsk(b, w, place, merged))) || !h.same()) return;
    h.act("deleteBranch", async () => { await runPlan(h, detachPlan(w)); await deleteAfter(h, b, merged); });
    return;
  }
  const facts = await removeFacts(h, w, { list, spaces }), ask = (f) => removeAndDeleteAsk(b, w, place, { ...f, merged });
  if (!(await h.ask(ask(facts))) || !h.same()) return;
  h.act("deleteBranch", async () => { if (await removeNow(h, w, facts, spaces, ask)) await deleteAfter(h, b, merged); });
}
