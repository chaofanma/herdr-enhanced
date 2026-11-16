// The reflog (History's Reflog… list: everywhere HEAD or a branch has been, and getting back to
// one of those places): git's arguments and output for HEAD's or a branch's reflog, and the
// plans that restore an entry: a new branch there, the current branch moved back there (reset
// --keep), or a look at it on a detached HEAD.
// No Herdr imports: tested with node (test/git-enhanced/reflog.test.mjs).
import { step, plan, problem, has, nulFields, refreshStep } from "./gitplan.js";

const short = (h) => String(h ?? "").slice(0, 7);
const FIELDS = 4;

/** git's arguments for the newest `count` entries of `ref`'s reflog ("HEAD", or a branch as
 *  "refs/heads/<name>"): hash, the entry's selector with its time (--date=raw puts the time in
 *  it), the entry's message and the commit's subject, NUL separated. */
export const reflogArgs = (ref = "HEAD", count = 200) =>
  ["-c", "log.showSignature=false", "log", "-g", "-z", "--date=raw", `--max-count=${count}`, "--format=%H%x00%gD%x00%gs%x00%s", ref, "--"];

/** reflogArgs' output as [{ sha, selector, index, time, action, kind, message, subject }], newest
 *  first: `selector` the entry by its number ("HEAD@{2}", what git commands take), `time` when
 *  the entry was made (unix seconds), `action` the words before ": " in its message, which git
 *  writes in English ("commit (amend)", "checkout", "reset", "rebase (finish)", "pull --rebase",
 *  "merge feature"), `kind` its first word, `message` the rest. */
export function parseReflog(stdout, ref = "HEAD") {
  const f = nulFields(stdout), out = [];
  for (let i = 0; i + FIELDS <= f.length; i += FIELDS) {
    const [sha, sel, gs, subject] = f.slice(i, i + FIELDS).map((x, k) => (k === 0 ? x.replace(/^\n/, "") : x));
    if (!/^[0-9a-f]{40,64}$/.test(sha)) continue;
    const at = /@\{(\d+)(?: [+-]\d{4})?\}$/.exec(sel), colon = gs.indexOf(": ");
    const action = colon < 0 ? gs : gs.slice(0, colon);
    out.push({ sha, selector: `${ref}@{${out.length}}`, index: out.length, time: at ? Number(at[1]) : 0, action, kind: action.split(" ")[0], message: colon < 0 ? "" : gs.slice(colon + 2), subject });
  }
  return out;
}

/** Restore entry `e` as a new branch `name` there (nothing else moves). */
export function branchPlan(e, name) {
  if (!String(name ?? "").trim()) return problem("The new branch needs a name");
  return plan([step(["branch", name.trim(), e.sha], `Branch ${name.trim()} at ${short(e.sha)}`)]);
}

/** Move the current `branch` back (or forward) to entry `e` with git reset --keep: files the
 *  move changes come back as they were there, and git refuses when that would overwrite an
 *  uncommitted change. The commits after it leave the branch (the reflog keeps them). */
export function resetPlan(e, { branch = null } = {}) {
  if (!branch) return problem("No branch is checked out: check the entry out, or make a branch there");
  return plan([refreshStep(), step(["reset", "--keep", e.sha], `Move ${branch} to ${short(e.sha)}`)],
    { danger: true, confirm: `Move ${branch} to ${short(e.sha)} “${e.subject}”? Commits on ${branch} after it leave the branch (the reflog keeps them for a while); uncommitted changes stay, or git refuses if they'd be overwritten.` });
}

/** Look at entry `e` on a detached HEAD (git switch --detach, git 2.23; checkout before). */
export function detachPlan(e, { version = null } = {}) {
  return plan([step(has(version, "switch") ? ["switch", "--detach", e.sha] : ["checkout", "--detach", e.sha], `Check out ${short(e.sha)}, detached`)],
    { confirm: `Check out ${short(e.sha)} “${e.subject}” on a detached HEAD? No branch moves; commits made there belong to no branch until you make one.` });
}

/** The menu of entry `e`: `branch`, the checked-out branch (null: detached); `head`, HEAD's hash. */
export function entryItems(e, { branch = null, head = null } = {}) {
  const here = e.sha === head;
  return [
    { id: "branch", label: "Create a branch here…" },
    { id: "reset", label: branch ? `Move ${branch} here…` : "Move the branch here…", danger: true, disabled: !branch || here, detail: !branch ? "No branch is checked out" : here ? `${branch} is here` : "git reset --keep" },
    { id: "detach", label: "Check out (detached)…", disabled: here, detail: here ? "HEAD is here" : undefined },
    { id: "copy", label: "Copy the hash" },
  ];
}
