// Patches (Copy as patch in the Changes and History menus; Apply a patch… with text pasted in):
// the working tree's, the index's or a range's changes as a patch git apply takes back (binary
// files too), commits as email patches (git format-patch, which git am takes back), and checking
// then applying a patch given as text. The patch travels the way the hunk buttons' do (gitops.js
// applyPatch: base64 arguments), so this works on another machine too; here are the steps.
// No Herdr imports: tested with node (test/git-enhanced/patches.test.mjs).
import { DIFF } from "./stashops.js";
import { step, plan, problem, unquoteC } from "./gitplan.js";

/** git's arguments for changes as a patch (--binary: binary files too, with their full hashes):
 *  `what` "worktree" (not staged: index → working tree), "index" (staged: HEAD → index), "all"
 *  (both: HEAD → working tree; not before the first commit), or "range" (commit `from` to commit
 *  `to`, or to the working tree when `to` is null). `paths`: only those. Untracked files are in
 *  none of them: stage them first (or git add -N). */
export function diffPatchArgs({ what = "worktree", from = null, to = null, paths = [] } = {}) {
  const base = ["diff", ...DIFF, "--binary"];
  const sides = what === "worktree" ? [] : what === "index" ? ["--cached"] : what === "all" ? ["HEAD"] : what === "range" && from ? [from, ...(to ? [to] : [])] : null;
  if (!sides) throw new Error(what === "range" ? "A range needs the commit it starts from" : `no patch of ${what}`);
  return [...base, ...sides, "--", ...paths];
}

/** git's arguments for `commits` as email patches, one after another, oldest first, to stdout
 *  (the message, author and date kept; binary files too). `commits` newest first, as the History
 *  page lists them: git writes an unsorted list the other way round. No cover letter, whatever
 *  format.coverLetter says (git am can't take one). */
/** One commit alone would be read as "every commit since it": that one goes with -1. */
export const formatPatchArgs = (commits) => (commits.length === 1 ? ["format-patch", "--stdout", "--no-cover-letter", "-1", commits[0]]
  : ["format-patch", "--stdout", "--no-cover-letter", "--no-walk=unsorted", ...commits]);
/** …for the commits from `from` (not included) to `to`, oldest first. */
export const formatRangeArgs = (from, to = "HEAD") => ["format-patch", "--stdout", "--no-cover-letter", `${from}..${to}`];

/** Whether `text` is git format-patch's (an mbox: git am takes it, with its messages) rather than
 *  a plain diff (git apply). */
export const isMbox = (text) => /^From [0-9a-f]{40,64} Mon Sep 17 00:00:00 2001$/m.test(String(text ?? "").slice(0, 200));

/** The files a patch touches (one per "diff --git" entry: its new path, the old one for a
 *  deletion; a binary file's from the entry's first line), for the question before applying it. */
export function patchFiles(text) {
  const out = [], name = (s) => { const t = unquoteC(s.replace(/\t$/, "")); return t === "/dev/null" ? null : t.replace(/^[^/]\//, ""); };
  // "diff --git a/<p> b/<p>": quoted names, or the same path twice (a path may hold spaces).
  const fromGit = (rest) => {
    const quoted = /^"(?:\\.|[^"\\])*" /.exec(rest);
    if (quoted) return name(rest.slice(quoted[0].length));
    const second = rest.indexOf(' "');
    if (second > 0) return name(rest.slice(second + 1));
    const len = (rest.length - 5) / 2;
    if (Number.isInteger(len) && len > 0 && rest.slice(2, 2 + len) === rest.slice(len + 5)) return rest.slice(2, 2 + len);
    const i = rest.lastIndexOf(" b/");
    return i > 0 ? rest.slice(i + 3) : null;
  };
  let cur = null;
  const end = () => { if (cur) { const p = cur.plus ?? cur.renamed ?? cur.minus ?? cur.git; if (p && !out.includes(p)) out.push(p); } cur = null; };
  for (const l of String(text ?? "").split("\n")) {
    if (l.startsWith("diff --git ")) { end(); cur = { git: fromGit(l.slice(11)), plus: null, minus: null, renamed: null, header: true }; continue; }
    if (!cur?.header) continue;
    if (l.startsWith("@@") || l.startsWith("GIT binary patch") || l.startsWith("Binary files ")) cur.header = false;
    else if (l.startsWith("--- ")) cur.minus = name(l.slice(4));
    else if (l.startsWith("+++ ")) { cur.plus = name(l.slice(4)); cur.header = false; }
    else if (l.startsWith("rename to ")) cur.renamed = unquoteC(l.slice(10));
  }
  end();
  return out;
}

const TARGET = { worktree: [], index: ["--cached"], both: ["--index"] };

/** Check, then apply, patch `text` (a plain diff): to the working tree, the index (`index`), or
 *  both (`both`); `reverse` takes it back out. git apply is all or nothing: the check says why it
 *  doesn't apply, and nothing changes. `threeWay` instead merges what doesn't apply cleanly
 *  (git apply --3way, which needs the index to match those files and changes it too; a file with
 *  conflicts then waits in conflict, conflicts.js lists it; there is no check first, since git's
 *  check can't tell). */
export function applyPlan(text, { target = "worktree", reverse = false, threeWay = false } = {}) {
  if (!String(text ?? "").trim()) return problem("The patch is empty");
  if (isMbox(text)) return problem("This is git format-patch's mail: apply it as commits (git am)");
  if (!TARGET[target]) throw new Error(`no target ${target}`);
  const files = patchFiles(text);
  if (!files.length) return problem("No file changes in it: is it a patch?");
  const flags = [...(threeWay ? ["--3way", ...(target === "index" ? ["--cached"] : [])] : TARGET[target]), ...(reverse ? ["-R"] : [])];
  const which = files.length === 1 ? files[0] : `${files.length} files`;
  return {
    ...plan([
      !threeWay && { apply: ["--check", ...flags], why: `Check that it applies to ${which}` },
      { apply: flags, why: `${reverse ? "Take the patch back out of" : "Apply the patch to"} ${which}` },
    ], { confirm: `${reverse ? "Take this patch back out of" : "Apply this patch to"} ${threeWay ? (target === "index" ? "the index, with a three-way merge" : "the working tree and the index, with a three-way merge") : target === "index" ? "the index" : target === "both" ? "the working tree and the index" : "the working tree"}? It changes ${files.length === 1 ? files[0] : `${files.length} files: ${files.slice(0, 5).join(", ")}${files.length > 5 ? "…" : ""}`}.${threeWay ? " git apply --3way stages what it applies, and a file it can't merge waits in conflict." : ""}` }),
    patch: text, files,
  };
}

/** The body of a FILES_SH script (gitplan.js `body` steps) that makes commits of email patches in
 *  "$d/patch" with git am, git's flags in "$@". */
export const AM_BODY = 'git -c core.editor=true am "$@" "$d/patch"';

/** Make commits from email patches `text` (formatPatchArgs' output) on the current branch with
 *  git am (`threeWay`: a three-way merge where a patch doesn't apply cleanly). It may stop on
 *  conflicts: conflicts.js's Continue, Skip and Abort for "am" go on from there. */
export function amPlan(text, { threeWay = true } = {}) {
  if (!isMbox(text)) return problem("This isn't git format-patch's mail: apply it as a patch (git apply)");
  const count = (String(text).match(/^From [0-9a-f]{40,64} Mon Sep 17 00:00:00 2001$/gm) ?? []).length;
  return {
    ...plan([{ body: AM_BODY, args: threeWay ? ["--3way"] : [], why: `Make ${count === 1 ? "a commit" : `${count} commits`} from the patches`, stops: true }],
      { confirm: `Make ${count === 1 ? "a commit" : `${count} commits`} from these patches on the current branch, with their messages and authors?` }),
    patch: text,
  };
}
