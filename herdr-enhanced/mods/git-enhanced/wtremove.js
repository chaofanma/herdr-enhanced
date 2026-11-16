// Removing a worktree from a page, as Herdr's own worktree mod does: what goes is read before the
// question (uncommitted changes or untracked files, which git won't remove unless forced, and ignored
// files, which git deletes without a word), and read again once it is answered: changes that came
// meanwhile get one more question. Then the space in that worktree closes, with its terminals (a
// shell in the folder keeps it busy on Windows), and git removes it; git refusing for what isn't read
// before (a submodule in it) asks once more, forced. No Herdr imports: a flow gets `h` (planflow.js)
// and `spaces` (wtspaces.js).
import { plan, step, runPlan, nulFields } from "./gitplan.js";
import { readPlan } from "./planflow.js";
import * as W from "./worktrees.js";

/** Whether worktree `path` has uncommitted changes or untracked files (git worktree remove refuses it
 *  then, unless forced); a folder git can't read there counts as having them. */
export async function dirtyOf(h, path) {
  const r = await (h.reads ?? h).git(["-C", path, "status", "--porcelain"]).catch(() => null);
  return !r || r.code !== 0 || r.stdout.trim() !== "";
}

/** The ignored files and folders of worktree `path` (read as the page reads: SAFE_ARGS), [] when its
 *  folder can't be read. */
export async function ignoredOf(h, path) {
  const [out] = await readPlan(h, plan([step(W.ignoredArgs(path), "Ignored files", { ok: [128] })])).catch(() => [""]);
  return nulFields(out);
}

/** What removing worktree `w` takes, read before its question: { ignored, dirty, space } (`space`:
 *  the one in it, of `spaces`, wtspaces.js; `list`: the repository's worktrees). */
export async function removeFacts(h, w, { list = [], spaces = null } = {}) {
  return { ignored: await ignoredOf(h, w.path), dirty: await dirtyOf(h, w.path), space: spaces?.find(w.path, list) ?? null };
}

/** Removes worktree `w` once its question, asked with `facts` (removeFacts's), was answered; run it
 *  in h.act. `ask(facts)` words a forced question (default: worktrees.js removeAsk). True when the
 *  worktree went, false when a question asked here was declined. */
export async function removeNow(h, w, facts, spaces, ask = (f) => W.removeAsk(w, f)) {
  const { ignored, space } = facts;
  let force = facts.dirty || w.locked;
  if (!force && await dirtyOf(h, w.path)) {
    const q = ask({ ignored, dirty: true, space });
    if (!(await h.ask({ ...q, detail: `It changed since you were asked. ${q.detail}` })) || !h.same()) return false;
    force = true;
  }
  if (space) spaces.close(space.id);
  try { await runPlan(h, W.removePlan(w, { force, ignored })); return true; }
  catch (e) {
    if (force) throw e;
    const q = ask({ ignored, dirty: true, space: null });
    if (!(await h.ask({ ...q, detail: `git said: ${String(e?.message ?? e).split("\n")[0]}. ${q.detail}` })) || !h.same()) return false;
    await runPlan(h, W.removePlan(w, { force: true, ignored }));
    return true;
  }
}
