// What one look at a repository reads, in as few execs as possible: each exec on another machine is a
// round trip, so the facts come from one sh script (REPO_SH) and the files from another (TREE_SH).
// Their output is records "\x1e<name>\n<value>", parsed by records().
// No Herdr imports: tested with node under sh and dash (test/git-enhanced/reads.test.mjs).
import { READ } from "./scripts.js";
import { STASH_FORMAT, parseStashList } from "./stashes.js";
import { operationOf, OPERATION_MARKS } from "./branches.js";
import { parseStatusZ, parseNumstatZ, parseNameStatusZ } from "./renames.js";
import { DIFF_SAFE } from "./gittrust.js";

// Read-only git; a diff's numbers and letters without the repository's diff programs (DIFF_SAFE).
// The page runs both scripts as a reader (machine.js): their git gets SAFE_ARGS too.
const R = READ.join(" "), D = DIFF_SAFE.join(" ");
const put = (name, cmd) => `printf '\\036%s\\n' ${name}; ${cmd}`;

/** sh -c REPO_SH sh <base>: HEAD, the branch and its upstream (ahead and behind), the remote a first
 *  push goes to, HEAD's parent, the base branch (the `base` given, else origin/HEAD, else main, else
 *  master) and where HEAD left it, what is in progress, and the stashes. */
export const REPO_SH = [
  "g=$(git rev-parse --git-dir 2>/dev/null) || exit 3",
  put("head", "git rev-parse -q --verify HEAD"),
  "b=$(git symbolic-ref -q --short HEAD)",
  put("branch", 'printf "%s" "$b"'),
  'u=; [ -n "$b" ] && { u=$(git rev-parse -q --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null) || u=; }',
  put("upstream", 'printf "%s" "$u"'),
  put("counts", '[ -n "$u" ] && git rev-list --left-right --count "HEAD...@{u}" 2>/dev/null'),
  'r=; [ -n "$b" ] && r=$(git config --get "branch.$b.remote" 2>/dev/null); [ -n "$r" ] || { git config --get remote.origin.url >/dev/null 2>&1 && r=origin; }; [ -n "$r" ] || r=$(git remote 2>/dev/null | head -n 1)',
  put("remote", 'printf "%s" "$r"'),
  put("parent", "git rev-parse -q --verify HEAD~1 2>/dev/null"),
  'base=$1; [ -n "$base" ] || base=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)',
  '[ -n "$base" ] || { git rev-parse -q --verify refs/heads/main >/dev/null && base=main; }',
  '[ -n "$base" ] || { git rev-parse -q --verify refs/heads/master >/dev/null && base=master; }',
  put("base", 'printf "%s" "$base"'),
  put("merge", '[ -n "$base" ] && git rev-parse -q --verify "$base^{commit}" >/dev/null && git merge-base HEAD "$base" 2>/dev/null'),
  put("op", `for f in ${OPERATION_MARKS}; do [ -e "$g/$f" ] && echo "$f"; done`),
  put("stash", `git stash list '${STASH_FORMAT}' 2>/dev/null`),
  "exit 0",
].join("\n");

/** `records`' fields as the page uses them: { head, branch, upstream, ahead, behind, remote,
 *  parent, base, merge, operation, stashes }; null where there is none. */
export function parseRepo(stdout) {
  const r = records(stdout), one = (k) => (r[k] ?? "").trim() || null;
  const [ahead, behind] = (r.counts ?? "").trim().split(/\s+/).map((n) => (n === "" || n === undefined ? null : Number(n)));
  const branch = one("branch"), upstream = one("upstream");
  return {
    head: one("head"), branch, upstream,
    ahead: upstream ? ahead ?? 0 : null, behind: upstream ? behind ?? 0 : null,
    remote: one("remote"), parent: one("parent"), base: one("base"), merge: one("merge"),
    operation: operationOf(r.op ?? ""), stashes: parseStashList(r.stash ?? ""),
  };
}

/** sh -c TREE_SH sh <ref> <to>: the files. Always the status (untracked files too, renames found);
 *  without `to` (the working tree is part of what is shown) the staged and unstaged numbers; with
 *  `ref`, the numbers and letters of `git diff <ref> [<to>]`. */
export const TREE_SH = [
  "ref=$1 to=$2",
  put("status", `git ${R} status --porcelain=v1 -z --renames --untracked-files=all`),
  'if [ -z "$to" ]; then',
  put("staged", `git ${R} diff ${D} --cached --numstat -z -M`),
  put("unstaged", `git ${R} diff ${D} --numstat -z -M`),
  "fi",
  'if [ -n "$ref" ]; then',
  put("scope", `git ${R} diff ${D} "$ref" \${to:+"$to"} --numstat -z -M --`),
  put("names", `git ${R} diff ${D} "$ref" \${to:+"$to"} --name-status -z -M --`),
  "fi",
  "exit 0",
].join("\n");

/** TREE_SH's output: { entries (status), staged, unstaged, scope (Maps of numbers by path), names
 *  (letters) }; a part not read is null. */
export function parseTree(stdout) {
  const r = records(stdout), has = (k) => Object.prototype.hasOwnProperty.call(r, k);
  return {
    entries: parseStatusZ(r.status ?? ""),
    staged: has("staged") ? parseNumstatZ(r.staged) : null,
    unstaged: has("unstaged") ? parseNumstatZ(r.unstaged) : null,
    scope: has("scope") ? parseNumstatZ(r.scope) : null,
    names: has("names") ? parseNameStatusZ(r.names) : null,
  };
}

/** The records in a script's output: { name: value }. A value is everything up to the next record
 *  (a trailing newline of a one-line value dropped by the caller where it matters). */
export function records(stdout) {
  const out = {};
  for (const part of String(stdout ?? "").split("\x1e").slice(1)) {
    const nl = part.indexOf("\n");
    if (nl < 0) { out[part] = ""; continue; }
    out[part.slice(0, nl)] = part.slice(nl + 1);
  }
  return out;
}
