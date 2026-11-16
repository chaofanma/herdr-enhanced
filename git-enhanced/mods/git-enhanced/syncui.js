// Pull, Sync and push in the Changes page (pullsync.js has the logic): Pull ▾ in the bar under the
// header (fast-forward only, rebasing, or with a merge; uncommitted changes stashed around it), and
// the menu beside Push: Sync (pull, then push) or Publish, Force push (with lease)…, Push every tag.
// Nothing here reads the view: a flow gets `h`, a host (stashui.js) and the branch's facts
// (reads.js parseRepo): { branch, upstream, remote, ahead, behind }.
import { div } from "gpui-kit";
import { chevron } from "./iconbutton.js";
import { pressOn, closingClick } from "./menuat.js";
import * as P from "./pullsync.js";
import { carryOut, readPlan, pinned } from "./planflow.js";
import { plan, step } from "./gitplan.js";

const n = (k, one) => `${k} ${one}${k === 1 ? "" : "s"}`;
const stoppedNote = (how) => (said) => `The pull stopped on conflicts (${how}): ${said.split("\n").find((l) => /^CONFLICT|could not apply/i.test(l)) ?? said.split("\n")[0]}. Resolve them, then Continue, or Abort.`;

/** How the branch and its upstream stand (pullsync.js divergence). */
export const divergenceOf = (f = {}) => P.divergence({ ahead: f.ahead ?? 0, behind: f.behind ?? 0, upstream: f.upstream ?? null });

/** The remote branch's name on its remote: origin/feature/x → feature/x (null when the upstream
 *  isn't on `remote`). */
export const remoteBranchOf = (f) => (f?.upstream && f.remote && f.upstream.startsWith(`${f.remote}/`) ? f.upstream.slice(f.remote.length + 1) : null);

/** Pull ▾: the way to pull, then the pull. A rebase over commits of the branch's own asks first
 *  (they get new hashes). */
export async function pullFlow(h, { facts: f, version }) {
  const div = divergenceOf(f), at = await pinned(h, { branch: f.branch ?? null });
  if (!at) return;
  const pick = await h.choose({ title: div.words, width: 300, items: P.pullItems(div) });
  if (!pick || !h.same()) return;
  if (pick === "rebase" && div.ahead > 0) {
    const a = await h.ask({ title: `Pull ${n(div.behind, "commit")} and rebase ${f.branch}'s ${n(div.ahead, "commit")} on top?`, confirm: "Pull and rebase",
      detail: `Your unpushed ${n(div.ahead, "commit")} are made again on top of ${f.upstream}, with new hashes. Uncommitted changes are stashed around it and put back.` });
    if (!a || !h.same()) return;
  }
  return carryOut(h, plan([P.pullStep(pick, { autostash: true, version })]), { kind: "pull", stopped: stoppedNote(pick), at });
}

/** The menu beside Push: Sync (or Publish), Force push (with lease)…, Push every tag. */
export function pushItems(f = {}) {
  const div = divergenceOf(f), there = remoteBranchOf(f);
  const sync = !f.branch ? { id: "sync", label: "Sync", disabled: true, detail: "Detached HEAD: no branch to sync" }
    : !f.upstream ? { id: "sync", label: "Publish", disabled: !f.remote, detail: f.remote ? `Push ${f.branch} to ${f.remote} and track it` : "This repository has no remote" }
    : { id: "sync", label: "Sync…", detail: `${div.words}: pull (rebase), then push` };
  return [
    sync,
    { id: "force", label: "Force push (with lease)…", danger: true, disabled: !there, detail: there ? `Replace ${f.upstream} unless it moved since you saw it` : !f.upstream ? "No upstream to replace" : `${f.upstream} isn't on ${f.remote}` },
    { id: "tags", label: "Push every tag", disabled: !f.remote, detail: f.remote ? `git push --tags to ${f.remote}` : "This repository has no remote" },
  ];
}

/** That menu, then what was picked. */
export async function pushMenuFlow(h, { facts: f, version }) {
  const at = await pinned(h, { branch: f.branch ?? null });
  if (!at) return;
  const pick = await h.choose({ title: f.branch ?? "detached HEAD", width: 300, items: pushItems(f) });
  if (!pick || !h.same()) return;
  if (pick === "sync") {
    const p = P.syncPlan({ branch: f.branch, upstream: f.upstream, upstreamRemote: f.upstream ? f.remote : null, remote: f.remote, ahead: f.ahead ?? 0, behind: f.behind ?? 0, version });
    return carryOut(h, p, { kind: f.upstream ? "sync" : "push", yes: "Sync", stopped: stoppedNote("rebase"), at });
  }
  if (pick === "force") {
    const there = remoteBranchOf(f);
    // The lease's hash is what the person sees now: the remote-tracking ref as last fetched.
    const [expected, lost] = await readPlan(h, plan([step(P.expectedArgs(f.remote, there), "expected", { ok: [1] }), step(P.lostArgs(f.branch, f.remote, there), "lost", { ok: [128] })]))
      .then((o) => [o[0].trim() || null, o[1].trim() === "" ? null : Number(o[1].trim())]).catch(() => [null, null]);
    return carryOut(h, P.forcePushPlan({ branch: f.branch, remote: f.remote, remoteBranch: there, expected, lost, version }), { kind: "forcePush", yes: "Force push" });
  }
  if (pick === "tags") return carryOut(h, P.pushTagsPlan(f.remote), { kind: "push" });
}

/** The ▾ beside Push (26 px tall, radius 6, as the bar's buttons): Herdr's chevron, as every drop-down's.
 *  Its menu opens over it (menuat.js); while that is open it stays lit, with no tooltip, and a press
 *  closes it. */
export function pushMenuButton(t, { enabled, open = false, onClick }) {
  return div().id("push-menu").role("button").accessibility_label("Sync, force push (with lease), push every tag").h(26).w(22).flex().flex_none().items_center().justify_center().rounded(6).bg(t.raised).text_color(t.muted)
    .when(!enabled, (e) => e.opacity(0.7)).when(!open, (e) => e.tooltip("Sync, force push (with lease), push every tag"))
    .when(open, (e) => e.bg(t.hover).text_color(t.foreground))
    .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { if (!closingClick("push-menu")) onClick(cx); }).on_mouse_down("left", pressOn("push-menu", open))).child(chevron());
}
