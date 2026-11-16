// Several commits at once (the History page: click, ⌘-click, shift-click in the list, then
// Cherry-pick N…, Revert N… from the menu): the selection as pure state over the list's hashes
// in the order shown, cherry-picking several oldest first, reverting several newest first, and
// which branches and tags hold a commit.
// No Herdr imports: tested with node (test/git-enhanced/commitsel.test.mjs).
import { NO_EDITOR, step, plan, problem, has } from "./gitplan.js";

const short = (h) => String(h ?? "").slice(0, 7);
const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

// ---- The selection: { selected: [hash…], anchor }, `order` the hashes as the list shows them

/** Nothing selected. */
export const NONE = Object.freeze({ selected: [], anchor: null });

/** A click on `hash`: it alone, and a shift-click's range starts there. */
export const click = (state, hash) => ({ selected: [hash], anchor: hash });

/** A ⌘-click (Ctrl on Linux): `hash` in or out; the next range starts there. */
export function toggle(state, hash) {
  const has = state.selected.includes(hash);
  return { selected: has ? state.selected.filter((h) => h !== hash) : [...state.selected, hash], anchor: hash };
}

/** A shift-click on `hash`: every commit from the anchor to it in `order` (either way round);
 *  `add` (⌘⇧) keeps what was selected besides. Without an anchor it is a click. */
export function extend(state, hash, order, { add = false } = {}) {
  const a = order.indexOf(state.anchor), b = order.indexOf(hash);
  if (a < 0 || b < 0) return b < 0 ? state : click(state, hash);
  const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
  return { selected: add ? [...new Set([...state.selected, ...range])] : range, anchor: state.anchor };
}

/** Every commit shown; nothing; the selection without commits no longer shown (after a reload). */
export const selectAll = (order) => ({ selected: [...order], anchor: order[0] ?? null });
export const clear = () => ({ selected: [], anchor: null });
export function prune(state, order) {
  const shown = new Set(order);
  return { selected: state.selected.filter((h) => shown.has(h)), anchor: shown.has(state.anchor) ? state.anchor : null };
}

export const isSelected = (state, hash) => state.selected.includes(hash);
/** The selected hashes in the order shown (the History page's: newest first). */
export function inOrder(state, order) {
  const sel = new Set(state.selected);
  return order.filter((h) => sel.has(h));
}
/** …oldest first, the order commits are made again in (the reverse of the page's). */
export const oldestFirst = (state, order) => inOrder(state, order).reverse();

// ---- Cherry-pick and revert several

/** git cherry-pick of `hashes` in that order (oldestFirst): `x` adds "(cherry picked from commit
 *  …)" to each message, `noCommit` puts their changes together in the index without committing,
 *  `mainline` the parent a merge commit is taken against (1: the branch it was merged into). */
export const cherryPickArgs = (hashes, { x = false, noCommit = false, mainline = null } = {}) =>
  [...NO_EDITOR, "cherry-pick", ...(x ? ["-x"] : []), ...(noCommit ? ["--no-commit"] : []), ...(mainline ? ["-m", String(mainline)] : []), ...hashes];

/** git revert of `hashes` in that order (newest first): each undone by a new commit with git's
 *  message, or all of them in the index (`noCommit`). */
export const revertArgs = (hashes, { noCommit = false, mainline = null } = {}) =>
  [...NO_EDITOR, "revert", ...(noCommit ? ["--no-commit"] : ["--no-edit"]), ...(mainline ? ["-m", String(mainline)] : []), ...hashes];

// A merge in `commits` ({ hash, parents }) needs a mainline.
const mergeProblem = (commits, mainline, what) => {
  const m = commits.find((c) => (c.parents?.length ?? 0) > 1);
  return m && !mainline ? `${short(m.hash)} is a merge commit: ${what} it against one of its parents (mainline 1 is the branch it was merged into)` : null;
};
// -m on a commit that isn't a merge: git refuses it before 2.21 (a known `version`).
const mainlineProblem = (commits, mainline, version) => (mainline && version && !has(version, "mainline-any") && commits.some((c) => (c.parents?.length ?? 0) < 2)
  ? "Merge commits and plain ones together need git 2.21 or newer (older git refuses -m for a plain commit): select them apart" : null);

/** Cherry-pick the selected `commits` ({ hash, parents }, any order) onto `current`, oldest first
 *  by `order`. It may stop on conflicts (conflicts.js goes on from there). */
export function cherryPickPlan(commits, order, opts = {}, { current = null, version = null } = {}) {
  const by = new Map(commits.map((c) => [c.hash, c])), hashes = order.filter((h) => by.has(h)).reverse();
  if (!hashes.length) return problem("No commit is selected");
  const why = mergeProblem(commits, opts.mainline, "pick") ?? mainlineProblem(commits, opts.mainline, version);
  if (why) return problem(why);
  const onto = current ?? "HEAD";
  return plan([step(cherryPickArgs(hashes, opts), `Cherry-pick ${n(hashes.length, "commit")} onto ${onto}`, { editor: true, stops: true, slow: true })],
    { confirm: `Cherry-pick ${n(hashes.length, "commit")} onto ${onto}, oldest first${opts.noCommit ? ", into the index without committing" : ""}${opts.x ? ", each message saying where it came from" : ""}?` });
}

/** Revert the selected `commits` on `current`, newest first by `order`: new commits that undo
 *  them (nothing is rewritten). It may stop on conflicts. */
export function revertPlan(commits, order, opts = {}, { current = null, version = null } = {}) {
  const by = new Map(commits.map((c) => [c.hash, c])), hashes = order.filter((h) => by.has(h));
  if (!hashes.length) return problem("No commit is selected");
  const why = mergeProblem(commits, opts.mainline, "revert") ?? mainlineProblem(commits, opts.mainline, version);
  if (why) return problem(why);
  return plan([step(revertArgs(hashes, opts), `Revert ${n(hashes.length, "commit")}`, { editor: true, stops: true, slow: true })],
    { confirm: `Revert ${n(hashes.length, "commit")} on ${current ?? "HEAD"}, newest first? ${opts.noCommit ? "Their undoing is put in the index, not committed." : `${hashes.length === 1 ? "A new commit undoes it" : "New commits undo them"}; history isn't rewritten.`}` });
}

// ---- What holds a commit

/** git's arguments that list the branches, remote branches and tags that hold commit `sha`. */
export const containsArgs = (sha) => ["for-each-ref", "--contains", sha, "--format=%(refname)%00%(symref)", "refs/heads", "refs/remotes", "refs/tags"];

/** containsArgs' output as { branches, remotes, tags } (short names; a remote's HEAD, a symbolic
 *  ref, is left out). */
export function parseContains(stdout) {
  const out = { branches: [], remotes: [], tags: [] };
  for (const line of String(stdout ?? "").split("\n")) {
    const [ref = "", symref = ""] = line.split("\0");
    if (symref) continue;
    if (ref.startsWith("refs/heads/")) out.branches.push(ref.slice(11));
    else if (ref.startsWith("refs/remotes/")) out.remotes.push(ref.slice(13));
    else if (ref.startsWith("refs/tags/")) out.tags.push(ref.slice(10));
  }
  return out;
}
