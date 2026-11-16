// The "⋯" menu by Commit: Undo last commit, Undo last git action… (HEAD's reflog read like
// lazygit's undo) and Recently discarded… (the copies kept before each revert; Restore… puts files
// back). Nothing here reads the view: a flow gets `h`, a
// host (see stashui.js: a runner, ask/choose, act, note, same) and the facts it needs.
import { headCommit, undoLastCommit, lastGitAction, undoGitAction, discardedList, restorePlanOf, restoreDiscarded, keepDiscarded } from "./gitops.js";
import { moreItems, undoCommitQuestion, undoActionQuestion } from "./undo.js";
import { discardedQuestion, restoreQuestion, ago } from "./discarded.js";
import { openSettingsWindow } from "./settingsview.js";
import { moveCommitsFlow } from "./branchui.js";
import { copyChangesFlow, applyPatchFlow } from "./patchui.js";

/** The menu, then what was chosen. `hasHead`, `operation`; `branch` ({ branch, upstream, ahead }:
 *  pushInfo); `fill(message)`: an undone commit's message for the message box. */
export async function moreMenuFlow(h, { hasHead, operation, branch, fill, copy = null, clip = "", version = null }) {
  const items = moreItems({ hasHead, operation }), b = branch ?? {};
  const moveWhy = operation ? `Not while a ${operation} is in progress` : !b.branch ? "No branch is checked out" : !b.upstream ? `${b.branch} has no upstream` : !b.ahead ? `Nothing on ${b.branch} that ${b.upstream} doesn't have` : null;
  if (copy) items.splice(2, 0, { id: "copy-patch", label: "Copy changes as patch ▸", detail: "What isn't staged, what is, or both" },
    { id: "apply-patch", label: "Apply a patch…", disabled: Boolean(operation), detail: operation ? `Not while a ${operation} is in progress` : "git apply, or git am for email patches" });
  items.splice(2, 0, { id: "move-commits", label: "Move my unpushed commits to a new branch…", disabled: Boolean(moveWhy), detail: moveWhy ?? `${b.ahead} commit${b.ahead === 1 ? "" : "s"}; ${b.branch} goes back to ${b.upstream}` });
  const choice = await h.choose({ width: 300, items });
  if (!choice || !h.same()) return;
  if (choice === "move-commits") return moveCommitsFlow(h, { branch: b, version });
  if (choice === "copy-patch") return copyChangesFlow(h, { hasHead, copy });
  if (choice === "apply-patch") return applyPatchFlow(h, { clip });
  if (choice === "undo-commit") return undoCommitFlow(h, { branch, fill });
  if (choice === "undo-action") return undoActionFlow(h, { branch });
  if (choice === "settings") return openSettingsWindow("changes");
  return discardedFlow(h);
}

// git reset --soft HEAD~1, asking first when the commit is pushed, a merge, or the first one.
async function undoCommitFlow(h, { branch, fill }) {
  const c = await headCommit(h).catch(() => null);
  if (!c) { h.note("Nothing to undo: no commit yet"); return; }
  const q = undoCommitQuestion(c, branch ?? {});
  if (q && !(await h.ask(q))) return;
  if (!h.same()) return;
  h.act("undoCommit", async () => { await undoLastCommit(h, c.parents.length === 0); if (c.message) fill(c.message); });
}

// The reflog's last user action no undo took back, in words; asks; undoes it.
async function undoActionFlow(h, { branch }) {
  const a = await lastGitAction(h).catch(() => null);
  if (!h.same()) return;
  if (!a) { h.note("Nothing to undo in the reflog"); return; }
  if (a.kind === "rebasing") { h.note("A rebase is in progress: finish or abort it first"); return; }
  if (!(await h.ask(undoActionQuestion(a, branch ?? {}))) || !h.same()) return;
  h.act(a.kind === "checkout" ? "switch" : "undo", async () => {
    try { await undoGitAction(h, a); } catch (e) { h.note(`Undo refused: ${e.message}`); }
  });
}

// Recently discarded…: the list; Restore… on a copy says what it overwrites, asks, restores.
async function discardedFlow(h) {
  let copies;
  try { copies = await discardedList(h); } catch (e) { h.note(`Recently discarded failed: ${e.message}`); return; }
  const pick = await h.ask(discardedQuestion(copies));
  const d = pick && copies.find((x) => x.ref === pick.choice);
  if (!d || !h.same()) return;
  let plan;
  try { plan = await restorePlanOf(h, d.commit, d.files.map((f) => f.path)); } catch (e) { h.note(`Restore failed: ${e.message}`); return; }
  const q = restoreQuestion(d, plan);
  if (!q) { h.note(`Nothing to restore: the files are as they were ${ago(d.at)}`); return; }
  if (await h.ask(q) && h.same()) h.act("restore", () => restoreDiscarded(h, d.commit, plan, `“${d.what}”`));
}

/** Asks before throwing changes away, keeps a copy (Changes' ⋯ → Recently discarded… brings it
 *  back), asks again when no copy could be kept, then `work`. */
export async function discardFlow(h, { title, detail, lines = undefined, confirm, keep, work }) {
  const a = await h.ask({ title, detail: `${detail} A copy is kept: ⋯ by Commit → Recently discarded… brings it back.`, lines, confirm, danger: true });
  if (!a || !h.same()) return;
  let why = null;
  try { await keepDiscarded(h, keep); } catch (e) { why = String(e?.message ?? e ?? "").trim().split("\n")[0] || "no reason given"; }
  if (why) {
    const again = await h.ask({ title: "No copy could be kept", detail: `git couldn't keep a copy of what goes (${why}). ${confirm} without a copy?`, confirm: `${confirm} without a copy`, danger: true });
    if (!again || !h.same()) return;
  }
  h.act(keep.mode === "all" ? "revertAll" : "revert", work);
}
