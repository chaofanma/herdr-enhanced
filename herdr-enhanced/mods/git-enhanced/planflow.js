// Carrying out the git modules' plans (gitplan.js) from a page: a plan that can't run says why,
// one with a question asks it first (its first sentence the title, the rest what it changes), then
// it runs as the page's action (busy, a reload after) and one that stopped on conflicts says so.
// Nothing here reads a view: a flow gets `h`, a host (stashui.js: a runner for the repository, ask
// and choose, act, note, same; `reads`, a runner that reads with SAFE_ARGS) and its facts.
import { runPlan } from "./gitplan.js";
import { applyPatch } from "./gitops.js";
import { fileOf } from "./scripts.js";
import { gitSays } from "./stashes.js";

/** How a plan's `apply` and `body` steps reach git: the patch as a file, base64 on its way to the
 *  machine (gitops.js applyPatch, h.files). */
export function waysOf(h) {
  return {
    apply: (patch, flags) => applyPatch(h, patch, flags),
    send: async (patch, body, args) => {
      const r = await h.files([fileOf("patch", patch)], body, args);
      if (r.code !== 0) throw new Error(gitSays(r) || "failed");
      return r.stdout;
    },
  };
}

/** A plan's `confirm` as a question: up to its first "? " the title, the rest the detail. */
export function questionOf(p, { yes = "OK", ...more } = {}) {
  const text = String(p.confirm ?? ""), at = text.indexOf("? "), last = text.lastIndexOf(". ");
  // "… what happens. Do it?": the question last, what happens before it.
  const [title, detail] = at >= 0 ? [text.slice(0, at + 1), text.slice(at + 2)] : text.endsWith("?") && last > 0 ? [text.slice(last + 2), text.slice(0, last + 1)] : [text, null];
  return { title, detail, confirm: yes, danger: Boolean(p.danger), ...more };
}

/** git's CONFLICT lines of a stop, else its first line. */
export const conflictWords = (said) => {
  const lines = String(said ?? "").split("\n");
  return lines.filter((l) => /^CONFLICT/.test(l)).join("\n") || lines.find((l) => l.trim()) || "it waits on conflicts";
};

// ---- Where HEAD is (a guard for what rewrites or moves the checked-out branch)

/** sh's script that prints the checked-out branch's short name (empty when detached) and HEAD's
 *  hash (empty on an unborn branch), a line each. */
export const HERE_SH = 'b=$(git symbolic-ref -q --short HEAD); c=$(git rev-parse -q --verify HEAD); printf "%s\\n%s\\n" "$b" "$c"; exit 0';
/** Where HEAD is now: { branch (null: detached), head (null: unborn) }, read as the page reads. */
export async function hereOf(h) {
  const r = await (h.reads ?? h).sh(HERE_SH);
  if (r.code !== 0) throw new Error(gitSays(r) || "Couldn't read where HEAD is");
  const [branch = "", head = ""] = r.stdout.split("\n");
  return { branch: branch.trim() || null, head: head.trim() || null };
}
/** Why `now` (hereOf) isn't `at` ({ branch, head? }: what the question was asked for; a head left
 *  out isn't compared), in words, or null when it is. */
export function movedWords(at, now) {
  const sameBranch = (at.branch ?? null) === now.branch, sameHead = at.head === undefined || (at.head ?? null) === now.head;
  if (sameBranch && sameHead) return null;
  const where = now.branch ? (sameBranch ? `${now.branch} at ${String(now.head ?? "").slice(0, 7)}` : now.branch) : `detached at ${String(now.head ?? "").slice(0, 7)}`;
  return `${sameBranch ? `${now.branch ?? "HEAD"} moved` : "The branch changed"} while you were asked (now ${where}): nothing was done`;
}
/** Whether HEAD is still at `at` (null: no guard); notes why not. */
export async function stillAt(h, at) {
  if (!at) return true;
  const words = movedWords(at, await hereOf(h));
  if (words) h.note(words);
  return !words;
}
/** `at` with HEAD's hash filled in now when it was left out (before a question is asked), or
 *  null when the branch already isn't `at.branch` (noted). */
export async function pinned(h, at) {
  if (!at) return null;
  const now = await hereOf(h), words = movedWords({ branch: at.branch }, now);
  if (words) { h.note(words.replace(" while you were asked", "")); return false; }
  return { branch: at.branch ?? null, head: at.head === undefined ? now.head : at.head };
}

/** Runs plan `p` as action `kind`: a problem is noted, a question (`p.confirm`, unless `asked`)
 *  asked with button `yes`; `after(result)` follows a run that went through; a stop on conflicts is
 *  noted (`stopped(words)` says it, else a line that points at the conflict bar). `at` ({ branch,
 *  head? }: what the plan was made for): it runs only while HEAD is still there (HEAD's hash is
 *  taken before the question when left out). Resolves true when it ran (or started to). */
export async function carryOut(h, p, { kind, yes = "OK", asked = false, after = null, stopped = null, width = undefined, at = null } = {}) {
  if (p.problem) { h.note(p.problem); return false; }
  const where = await pinned(h, at);
  if (where === false) return false;
  if (p.confirm && !asked) {
    if (!(await h.ask(questionOf(p, { yes, width }))) || !h.same()) return false;
  }
  h.act(kind, async () => {
    if (!(await stillAt(h, where))) return;
    const r = await runPlan(h, p, waysOf(h));
    if (r.stopped) h.note(stopped ? stopped(r.stopped) : `Stopped on conflicts: ${conflictWords(r.stopped)}. Resolve them in Changes, then Continue, or Abort.`);
    else if (after) await after(r);
  });
  return true;
}

/** Runs a read-only plan (no question, no reload): its outputs, or git's words thrown. */
export async function readPlan(h, p) {
  if (p.problem) throw new Error(p.problem);
  return (await runPlan(h.reads ?? h, p, waysOf(h))).outputs;
}
