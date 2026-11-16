// More for stashes (the Stashes popover's menu and the Stash… dialog's options; stashes.js has the
// list and the plain push): stash keeping the index, or with ignored files too; apply or pop
// with the index as it was; a branch from a stash; rename one; clear them all; a stash's
// difference from the working tree.
// No Herdr imports: tested with node (test/git-enhanced/stashops.test.mjs).
import { step, plan, problem } from "./gitplan.js";

/** The diff flags the panel cuts patches from (hunk.js DIFF): no external or textconv diff, no
 *  colour, git's a/ and b/ prefixes whatever diff.noprefix says. */
export const DIFF = ["--no-ext-diff", "--no-textconv", "--no-color", "--src-prefix=a/", "--dst-prefix=b/"];

/** git stash push with: `keepIndex` (what is staged stays staged, and in the files), `untracked`
 *  files, or `ignored` ones too (--all: untracked and ignored); `message` its name. */
export function stashArgs({ message = "", keepIndex = false, untracked = false, ignored = false } = {}) {
  return ["stash", "push", ...(keepIndex ? ["--keep-index"] : []), ...(ignored ? ["--all"] : untracked ? ["--include-untracked"] : []), ...(message.trim() ? ["-m", message.trim()] : [])];
}

/** stashArgs as a plan: with `ignored`, the question says what leaves the folder. */
export function stashPlan(opts = {}) {
  const what = opts.keepIndex ? "The unstaged changes are stashed; what is staged stays" : "The changes are stashed";
  return plan([step(stashArgs(opts), opts.message?.trim() ? `Stash “${opts.message.trim()}”` : "Stash", { slow: true })],
    opts.ignored ? { confirm: `${what}, with every untracked and ignored file: build output, installed packages and files such as .env leave the folder until the stash is applied. Stash them?` } : {});
}

/** sh's script that refuses (exit 1) unless "$1" ("stash@{2}") is still the stash whose hash is
 *  "$2": a stash made or dropped since the list was read moves the numbers, and git takes a number. */
export const SAME_STASH_SH = 'ref=$1 sha=$2; [ "$(git rev-parse -q --verify "$ref" 2>/dev/null)" = "$sha" ] && exit 0; '
  + 'echo "The stashes changed since they were listed ($ref is another one now): nothing was done" >&2; exit 1';
// A plan's first step for stash `s` ({ ref, hash }: stashes.js parseStashList); none for a bare ref.
const sameStash = (s) => (s?.hash ? { script: SAME_STASH_SH, args: [s.ref, s.hash], why: `${s.ref} is still the one picked` } : null);
const refOf = (s) => (typeof s === "string" ? s : s.ref);

/** Apply (or `pop`: and drop it) stash `ref` ("stash@{2}") with the index as it was when stashed
 *  (--index: what was staged is staged again; git refuses when that can't be done). */
export const applyArgs = (ref, { pop = false, index = true } = {}) => ["stash", pop ? "pop" : "apply", ...(index ? ["--index"] : []), ref];
/** applyArgs as a plan for stash `s` ({ ref, hash }: refused when stash@{n} is another stash by
 *  then; or a bare ref). */
export const applyPlan = (s, opts = {}) => plan([sameStash(s), step(applyArgs(refOf(s), opts), `${opts.pop ? "Pop" : "Apply"} ${refOf(s)}${opts.index === false ? "" : ", staged changes staged again"}`, { slow: true })]);

/** A new branch `name` at the commit stash `s` ({ ref, hash }, or a bare ref) was made on, checked
 *  out, the stash applied with its index and dropped when that worked (git stash branch). */
export function branchPlan(s, name) {
  if (!String(name ?? "").trim()) return problem("The new branch needs a name");
  const ref = refOf(s);
  return plan([sameStash(s), step(["stash", "branch", name.trim(), ref], `Branch ${name.trim()} from ${ref}`, { slow: true })],
    { confirm: `Make branch ${name.trim()} where ${ref} was made, switch to it and apply the stash there? The stash is dropped once it applies.` });
}

/** sh's script that renames the stash whose hash is "$1" to message "$2": it is stored again with
 *  that message (it becomes stash@{0}), then its old entry is dropped, found by its hash (not by a
 *  number another stash could have moved). Stored first, so it is never missing from the list. */
export const RENAME_SH = 'sha=$1 msg=$2; i=0; old=; for h in $(git log -g --format=%H refs/stash 2>/dev/null); do '
  + 'if [ "$h" = "$sha" ]; then old=$i; break; fi; i=$((i + 1)); done; '
  + '[ -n "$old" ] || { echo "That stash is gone: popped or dropped meanwhile" >&2; exit 1; }; '
  + 'git stash store -m "$msg" "$sha" || exit 1; exec git stash drop -q "stash@{$((old + 1))}"';

/** Rename stash `s` ({ hash, ref }: stashes.js parseStashList) to `message`. */
export function renamePlan(s, message) {
  if (!String(message ?? "").trim()) return problem("A stash's name can't be empty");
  return plan([{ script: RENAME_SH, args: [s.hash, message.trim()], why: `Rename ${s.ref}` }]);
}

/** sh's script that refuses (exit 1) unless there are still "$1" stashes and the newest is "$2":
 *  git stash clear drops every stash, also one made after the count was shown. */
export const SAME_STASHES_SH = 'n=$1 top=$2; k=$(git log -g --format=%H refs/stash -- 2>/dev/null | wc -l | tr -d " "); '
  + 't=$(git rev-parse -q --verify refs/stash 2>/dev/null); [ "$k" = "$n" ] && [ "$t" = "$top" ] && exit 0; '
  + 'echo "The stashes changed since they were listed (now $k): nothing was dropped" >&2; exit 1';

/** Drop every stash of `list` (stashes.js parseStashList, newest first): a danger plan, refused
 *  when the stashes aren't those any more. */
export function clearPlan(list = []) {
  const count = list.length;
  if (!count) return problem("There are no stashes");
  return plan([{ script: SAME_STASHES_SH, args: [String(count), list[0].hash], why: "Still the stashes listed" }, step(["stash", "clear"], "Drop every stash")],
    { danger: true, confirm: `${count === 1 ? "Drop the only stash" : `Drop all ${count} stashes`}? None of them can be applied after this.` });
}

/** git's arguments for how the working tree differs from stash `ref` (its tracked files; the
 *  untracked files a stash holds aren't compared): `reverse` the other way round (what applying
 *  it would bring), `names` only the files' names and letters (-z). */
export const diffArgs = (ref, { reverse = false, names = false, paths = [] } = {}) =>
  ["diff", ...DIFF, ...(reverse ? ["-R"] : []), ...(names ? ["--name-status", "-z", "-M"] : []), ref, "--", ...paths];
