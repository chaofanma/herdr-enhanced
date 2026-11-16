// Branches in the panel: the branch picker's right-click menu (Rename…, Delete…, Merge into the
// current branch…, Rebase it onto this one…), its Remote branches rows, and the bar a stopped merge
// or rebase shows, with Abort…. Nothing here reads the view: the UI gets its data, colors and
// callbacks; a flow gets `h`, a host (see stashui.js: a runner, ask/choose, act, note, same).
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { validBranchName, renameBranch, deleteBranch, mergeBranch, rebaseOnto, abortOperation, switchRemote } from "./gitops.js";
import { branchMenu, notMerged, remoteTarget, operationWords, renameQuestion, deleteQuestion, forceDeleteQuestion, integrateQuestion, abortQuestion, stoppedNote } from "./branches.js";
import { chip, alpha } from "./look.js";
import { readable } from "./ink.js";
import * as BO from "./branchops.js";
import { carryOut, readPlan, questionOf, pinned, stillAt } from "./planflow.js";
import { plan, step, has, runPlan } from "./gitplan.js";
import { listArgs, parseWorktrees, listZ, whereWords } from "./worktrees.js";
import * as WB from "./wtbranch.js";

/** Right-click on local branch `b`: its menu, then the chosen action. `current`: the checked-out
 *  branch (null: detached); `operation`: what is in progress; `dirty`: uncommitted changes;
 *  `upstream`: the current branch's upstream. `w`: the other worktree that has `b` checked out
 *  (worktrees.js elsewhere), shown as `place`; `worktrees`, all of them; `spaces`: wtspaces.js. */
export async function branchMenuFlow(h, { b, current, operation, dirty, upstream, track = null, version = null, w = null, place = null, worktrees = [], spaces = null }) {
  // Merging and rebasing work on the checked-out branch: they run only while it is still `current`
  // where it was when the menu opened.
  const at = await pinned(h, { branch: current ?? null });
  if (!at) return;
  // Checked out in another worktree, a fast-forward runs there: what that worktree holds now.
  const behind = Boolean(b.upstream && !track?.gone && !track?.ahead && track?.behind);
  const there = w && !WB.goneOf(w) && !w.doing && behind ? await WB.stateThere(h, w) : null;
  const items = [...(w ? [WB.goItem(w, place)] : []), ...branchMenu(b, current, operation, WB.whyNot(w, place)), ...moreBranchItems(b, { current, operation, track, version, w, place, there })];
  const choice = await h.choose({ title: b.name, width: 300, items });
  if (!choice || !h.same()) return;
  if (choice === "worktree") return spaces?.go(w.path, worktrees);
  if (choice === "forget") return WB.forgetFlow(h, w, worktrees);
  if (choice === "rename") return renameFlow(h, b);
  if (choice === "delete") return w ? WB.deleteThereFlow(h, b, { w, place, list: worktrees, spaces }) : deleteFlow(h, b);
  if (choice === "ff") {
    const ref = (await h.git(BO.upstreamRefArgs(b.name))).stdout.trim() || null;
    return carryOut(h, w ? WB.ffTherePlan(w, ref) : BO.fastForwardPlan(b.name, ref), { kind: "switch" });
  }
  if (choice === "merge-with") return mergeWithFlow(h, { b, current, at });
  if (choice === "rebase-with") return rebaseWithFlow(h, { b, current, upstream, version, at });
  if (await h.ask(integrateQuestion({ how: choice, b, current, dirty, upstream })) && h.same()) {
    const target = choice === "merge" ? BO.mergeTarget(b.name, { tagToo: await tagToo(h, b.name) }) : `refs/heads/${b.name}`;
    h.act(choice, async () => {
      if (!(await stillAt(h, at))) return;
      const r = await (choice === "merge" ? mergeBranch : rebaseOnto)(h, target);
      if (r.stopped) h.note(stoppedNote(choice, r.stopped));
    });
  }
}

/** The items branchops.js adds to a branch's menu: Fast-forward to its upstream (behind, not ahead,
 *  not checked out here; checked out in another worktree `w`, shown as `place`, it runs there unless
 *  `there`, wtbranch.js stateThere, says that worktree isn't ready), Merge into <current> ▸ and
 *  Rebase <current> onto it ▸ with their options. */
export function moreBranchItems(b, { current, operation, track, version, w = null, place = null, there = null }) {
  if (b.current) return [];
  const why = operation ? `Not while a ${operation} is in progress` : !current ? "No branch is checked out" : null, off = (r) => (r ? { disabled: true, detail: r } : {});
  const ffWhy = (!b.upstream ? null : track?.gone ? `${b.upstream} is gone` : track?.ahead ? `${b.name} has commits ${b.upstream} doesn't: not a fast-forward` : !track?.behind ? `Up to date with ${b.upstream}` : null)
    ?? (w ? WB.ffThereWhy(w, place, there) : null);
  return [
    ...(b.upstream ? [{ id: "ff", label: `Fast-forward to ${b.upstream}`, ...off(ffWhy), ...(ffWhy ? {} : { detail: `${w ? `in ${place} · ` : ""}${track.behind} commit${track.behind === 1 ? "" : "s"} behind` }) }] : []),
    { id: "merge-with", label: current ? `Merge into ${current} ▸` : "Merge into the current branch ▸", ...off(why), ...(why ? {} : { detail: "fast-forward only, a merge commit, squash, without committing" }) },
    { id: "rebase-with", label: current ? `Rebase ${current} onto it ▸` : "Rebase the current branch onto it ▸", ...off(why), ...(why ? {} : { detail: "with autosquash, autostash, stacked branches moved along" }) },
  ];
}

// Whether a tag has branch `name`'s name too (git would take the tag for the short name).
const tagToo = async (h, name) => (await (h.reads ?? h).git(BO.tagTooArgs(name))).code === 0;

const stopped = (how) => (said) => `${how} stopped on conflicts: ${said.split("\n").find((l) => /^CONFLICT|could not apply/i.test(l)) ?? said.split("\n")[0]}`;

// Merge into ▸: how, then the plan's question.
async function mergeWithFlow(h, { b, current, at }) {
  const pick = await h.choose({ title: `Merge ${b.name} into ${current}`, width: 300, items: [
    { id: "ff-only", label: "Fast-forward only", detail: `Only if ${current} has no commits of its own` },
    { id: "no-ff", label: "Always a merge commit", detail: "--no-ff, even when a fast-forward would do" },
    { id: "squash", label: "Squash", detail: "Its changes staged as one, for you to commit" },
    { id: "no-commit", label: "Without committing", detail: "Stops before the merge commit" },
  ] });
  if (!pick || !h.same()) return;
  const opts = pick === "squash" ? { squash: true } : pick === "no-commit" ? { commit: false } : { ff: pick };
  return carryOut(h, BO.mergePlan(b.name, opts, { current, tagToo: await tagToo(h, b.name) }), { kind: "merge", yes: "Merge", stopped: stopped("Merge"), at });
}

// Rebase onto it ▸: the options (moving stacked branches along needs git 2.38), then the question.
async function rebaseWithFlow(h, { b, current, upstream, version, at }) {
  const refs = has(version, "update-refs");
  const a = await h.ask({ title: `Rebase ${current} onto ${b.name}`, confirm: "Next…",
    detail: `The commits of ${current} that ${b.name} doesn't have are made again on top of it.${refs ? "" : " (Moving stacked branches along needs git 2.38 or newer.)"}`,
    checks: [{ id: "autosquash", label: "Put fixup! and squash! commits in place (autosquash)", value: false },
      { id: "autostash", label: "Stash uncommitted changes around it (autostash)", value: true },
      ...(refs ? [{ id: "updateRefs", label: "Move branches stacked on it along (update-refs)", value: false }] : [])] });
  if (!a || !h.same()) return;
  const opts = { autosquash: Boolean(a.checks.autosquash), autostash: Boolean(a.checks.autostash), updateRefs: Boolean(a.checks.updateRefs), version };
  return carryOut(h, BO.rebasePlan(b.name, opts, { branch: current, upstream }), { kind: "rebase", yes: "Rebase", stopped: stopped("Rebase"), at });
}

/** A branch row's second line: its age, its upstream, how far apart they are ("↑2 ↓3") or "gone". */
export function trackWords(b, track) {
  if (!b.upstream) return b.age;
  const apart = track?.gone ? " · gone" : `${track?.ahead ? ` ↑${track.ahead}` : ""}${track?.behind ? ` ↓${track.behind}` : ""}`;
  return `${b.age} · ${b.upstream}${apart}`;
}

/** "Back to the previous branch" in the picker. */
export async function previousFlow(h, { version }) {
  const r = await h.sh(BO.PREVIOUS_SH);
  return carryOut(h, BO.previousPlan(r.code === 0 ? BO.parsePrevious(r.stdout) : null, { version }), { kind: "switch" });
}

/** "Clean up branches…": the merged ones and those whose upstream is gone, ticked, deleted the safe
 *  way; the ones git kept (not merged) can then go by force, asked again. `base`: the branch they
 *  are merged into; `current`. */
export async function cleanupFlow(h, { base, version }) {
  const [tracking, merged, wt] = await readPlan(h, plan([step(BO.TRACK_ARGS, "tracking"), step(BO.mergedArgs(base), "merged"), step(listArgs(version), "worktrees", { ok: [128, 129] })]));
  const candidates = BO.cleanupCandidates({ branches: BO.parseTracking(tracking), merged: BO.parseMerged(merged), base, worktrees: parseWorktrees(wt, { z: listZ(version) }) });
  if (!candidates.length) { h.note(`No branch to clean up: none is merged into ${base} or has lost its upstream`); return; }
  const a = await h.ask({ title: "Clean up branches", confirm: "Delete…", detail: `Merged into ${base}, or their upstream is gone. Untick what stays.`,
    files: { items: candidates.map((c) => ({ path: c.name, checked: true })) } });
  if (!a || !h.same()) return;
  const chosen = candidates.filter((c) => a.files.includes(c.name));
  const p = BO.cleanupPlan(chosen);
  if (p.problem) { h.note(p.problem); return; }
  if (!(await h.ask({ ...questionOf(p), confirm: "Delete" })) || !h.same()) return;
  h.act("deleteBranch", async () => {
    const out = (await runPlan(h, p)).outputs[0], kept = BO.parseDeleted(out).filter((d) => d.status === "kept").map((d) => d.name);
    if (!kept.length) return;
    const force = BO.cleanupPlan(chosen.filter((c) => kept.includes(c.name)).map((c) => ({ ...c, merged: false })), { force: true });
    if (await h.ask({ ...questionOf(force), confirm: "Delete by force" }) && h.same()) await runPlan(h, force);
    else h.note(`Kept ${kept.join(", ")}: ${kept.length === 1 ? "its commits aren't" : "their commits aren't"} merged`);
  });
}

/** ⋯ → "Move my unpushed commits to a new branch…": the name and where you go on, then the plan's
 *  question. `branch`: { branch, upstream, ahead }. */
export async function moveCommitsFlow(h, { branch: f, version = null }) {
  const at = await pinned(h, { branch: f.branch ?? null });
  if (!at) return;
  let name = "", error = null, stay = "go";
  for (;;) {
    const a = await h.ask({ title: `Move ${f.ahead} unpushed commit${f.ahead === 1 ? "" : "s"} to a new branch`, confirm: "Next…", error,
      detail: `${f.branch} goes back to ${f.upstream}.`, input: { value: name, placeholder: "new-branch-name", required: true },
      choices: { value: stay, options: [{ id: "go", label: "Go on working on the new branch", detail: "Nothing in the files changes" },
        { id: "stay", label: `Stay on ${f.branch}`, detail: `Its files become ${f.upstream}'s; uncommitted changes stay, or git refuses` }] } });
    if (!a || !h.same()) return;
    name = a.text.trim(); stay = a.choice;
    if (await validBranchName(h, name).catch(() => false)) break;
    error = `“${name}” can't be a branch name`;
  }
  return carryOut(h, BO.moveCommitsPlan({ branch: f.branch, upstream: f.upstream, name, ahead: f.ahead, stay: stay === "stay", version }), { kind: "switch", yes: "Move them", at });
}

// Rename…: a name, asked again while git refuses it, then git branch -m.
async function renameFlow(h, b) {
  let name = b.name, error = null;
  for (;;) {
    const a = await h.ask(renameQuestion(b, name, error));
    if (!a || !h.same()) return;
    name = a.text.trim();
    if (name === b.name) return;
    if (await validBranchName(h, name).catch(() => false)) break;
    error = `“${name}” can't be a branch name`;
  }
  h.act("renameBranch", () => renameBranch(h, b.name, name));
}

// Delete…: asks, git branch -d; git refusing because its commits aren't merged asks again, then -D.
async function deleteFlow(h, b) {
  if (!(await h.ask(deleteQuestion(b))) || !h.same()) return;
  h.act("deleteBranch", async () => {
    try { await deleteBranch(h, b.name, false); }
    catch (e) {
      if (!notMerged(e.message)) throw e;
      if (await h.ask(forceDeleteQuestion(b, e.message))) await deleteBranch(h, b.name, true);
    }
  });
}

/** A click on remote branch `rb`: switch to its local branch, or make one tracking it. */
export const remoteSwitch = (h, rb, local) => h.act("switch", () => switchRemote(h, rb, local));

/** Abort… a stopped `op` (asks: what was resolved so far goes). */
export async function abortFlow(h, op) {
  if (await h.ask(abortQuestion(op)) && h.same()) h.act("abort", () => abortOperation(h, op));
}

/** The branch picker's Remote branches part: a heading and a row per remote branch (at most
 *  `most`), each saying where a click goes (onClick(rb, cx)). `local`: the local branches; `away`:
 *  those checked out in another worktree (worktrees.js elsewhere), whose folders show as placeOf's. */
// The branch picker's rows have heights of their own (its list is as tall as they are): a branch,
// local or remote, two lines; the remote branches' heading; the line saying how many more there are.
export const BRANCH_ROW = 40, REMOTE_HEADING = 30, MORE_ROW = 24;
const MOST_REMOTES = 60;
/** The heights remoteRows' rows take, in order. */
export const remoteHeights = (remotes, most = MOST_REMOTES) => (!remotes?.length ? []
  : [REMOTE_HEADING, ...remotes.slice(0, most).map(() => BRANCH_ROW), ...(remotes.length > most ? [MORE_ROW] : [])]);

export function remoteRows({ t, remotes, local, most = MOST_REMOTES, onClick, away = null, placeOf = (p) => p }) {
  if (!remotes?.length) return [];
  const rows = remotes.slice(0, most).map((rb, i) => {
    const to = remoteTarget(rb, local), w = to.local ? away?.get(to.local) ?? null : null;
    // Its local branch checked out in another worktree: a click goes there (or forgets it, gone).
    const tip = w ? (WB.goneOf(w) ? `${to.local}'s worktree at ${w.path} is gone: click to forget it` : `${to.local} is checked out in the worktree at ${w.path}: click to go to its space`)
      : to.local ? `Switch to ${to.local}` : `git switch --track ${rb.name}: a local ${rb.branch} that tracks it`;
    return h_flex().id(`remote-branch-${i}`).h(BRANCH_ROW).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => onClick(rb, cx))
      .tooltip(tip)
      .child(v_flex().flex_1().min_w(0).gap(1).child(div().text_size(12).truncate().child(rb.name))
        .child(div().text_size(10.5).text_color(t.muted).truncate().child(to.local ? `${rb.age} · local ${to.local}${w ? ` · ${whereWords(w, placeOf(w.path))}` : ""}` : rb.age)));
  });
  return [
    div().h(REMOTE_HEADING).flex_none().flex().items_end().px(8).pb(4).border_t(1).border_color(t.border).text_size(10.5).font_semibold().text_color(t.muted).child("Remote branches"),
    ...rows,
    ...(remotes.length > most ? [div().h(MORE_ROW).flex_none().flex().items_center().px(8).text_size(10.5).text_color(t.muted).child(`${remotes.length - most} more not shown`)] : []),
  ];
}

/** The bar of a stopped `op` with `conflicts` files in conflict: what stopped, and Abort…
 *  (onAbort(cx)); `aborting` while that runs. */
export function operationBar({ t, op, conflicts, idle, aborting, onAbort }) {
  return h_flex().id("operation-bar").h(30).flex_none().px(14).gap(6).items_center().border_b(1).border_color(t.border).bg(alpha(t.blocked, 0.12))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(readable(t, t.blocked, alpha(t.blocked, 0.12))).child(operationWords(op, conflicts)))
    .child(chip(t, "operation-abort", aborting ? "Aborting…" : "Abort…", { color: t.ansi1, enabled: idle, tip: `git ${op} --abort (asks first)`, onClick: (_e, cx) => onAbort(cx) }));
}
