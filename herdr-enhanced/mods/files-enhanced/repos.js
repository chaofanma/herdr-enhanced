// Git marks when the shown folder holds several repositories: the repositories below the root, up to
// repoDepth folders down (files-enhanced.settings, panelsettings.js; 1 by default, like VS Code's
// git.repositoryScanMaxDepth), each file's mark from the repository it's in, and each repository's
// branch for its folder's badge. Pure: tested in test/files-enhanced/repos.test.mjs.
//
// Adapted from microsoft/vscode extensions/git/src/model.ts (MIT): scanWorkspaceFolders /
// traverseWorkspaceFolder (folders down to the depth, .git and ignored names skipped; nested
// repositories and submodules are repositories of their own) and getRepository (a path belongs to
// the deepest repository holding it). Only a .git git would take counts (KEEP).

import { addDots } from "./gitstatus.js";

export const MAX_REPOS = 20;

// The sh script find runs on the .git entries it found (`sh -c KEEP sh <path>...`): it prints the
// ones that are a repository's, a line each. A folder counts when it has a HEAD file; a file (a
// submodule's or a worktree's) when its first line starts with "gitdir: ", as git reads it. The rest
// are not repositories: a .git folder that GitKraken left behind holding only its gk/ folder, a stray
// .git file. POSIX sh (dash too, no bash or perl); a file without a newline at its end is read too.
export const KEEP = [
  "for g; do",
  "  if [ -d \"$g\" ]; then",
  "    if [ -f \"$g/HEAD\" ]; then printf '%s\\n' \"$g\"; fi",
  "  elif [ -f \"$g\" ]; then",
  "    l=",
  "    IFS= read -r l 2>/dev/null <\"$g\"",
  "    case $l in \"gitdir: \"*) printf '%s\\n' \"$g\" ;; esac",
  "  fi",
  "done",
].join("\n");

// find's arguments for the repositories' .git entries (folders, or files for submodules and
// worktrees; KEEP leaves out the ones that aren't a repository's) down to `depth` folders below "."
// (node_modules not entered); "./.git" is the root's own.
export const findArgs = depth => [".", "-maxdepth", String(depth + 1), "(", "-name", "node_modules", "-prune", ")", "-o", "(", "-name", ".git", "-prune", "-exec", "sh", "-c", KEEP, "sh", "{}", "+", ")"];

// The repositories find printed, as folders relative to the root: the shallowest first, then by name,
// at most `max`; the root's own left out.
export function reposOf(stdout, max = MAX_REPOS) {
  const roots = new Set();
  for (const line of String(stdout ?? "").split("\n")) {
    const p = line.trim().replace(/^\.\//, "");
    if (!p.endsWith(".git") || p === ".git") continue;
    const root = p.slice(0, -"/.git".length);
    if (root && !root.split("/").includes("node_modules")) roots.add(root);
  }
  const depth = r => r.split("/").length;
  return [...roots].sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0)).slice(0, max);
}

// The repository a path is in: the deepest of `roots` holding it, else "" (the root's own, if any).
export function repoFor(rel, roots) {
  let best = "";
  for (const r of roots) if ((rel === r || rel.startsWith(r + "/")) && r.length > best.length) best = r;
  return best;
}

// The branch `git status --branch` names on its first line ("## main...origin/main [ahead 1]"):
// "main"; a detached HEAD: "detached"; null without a branch line.
export function branchOf(stdout) {
  const first = String(stdout ?? "").split("\0")[0];
  if (!first.startsWith("## ")) return null;
  const head = first.slice(3);
  if (/^HEAD \(no branch\)/.test(head)) return "detached";
  const fresh = /^(?:No commits yet on|Initial commit on) (.+)$/.exec(head);
  if (fresh) return fresh[1];
  return head.split("...")[0].split(" ")[0] || null;
}

// Each repository's marks and ignored paths (parseStatus with its paths relative to the shown root,
// no folder dots yet) as one set: a path keeps the mark of the repository it's in, so a nested
// repository's files come from its own status, and the outer one's line for the nested folder itself
// ("?? lib/", " M sub") stays as that folder's mark. Folder dots are added over all of them.
// parts: [{ root: "" for the root's own repository or a folder, marks, ignored }].
export function mergeRepos(parts) {
  const roots = parts.map(x => x.root).filter(Boolean), marks = {}, ignored = new Set();
  const own = (rel, root) => repoFor(rel, roots) === root || roots.includes(rel);
  for (const part of parts) {
    for (const [rel, mark] of Object.entries(part.marks ?? {})) if (!rel.startsWith("dir:") && own(rel, part.root)) marks[rel] = mark;
    for (const rel of part.ignored ?? []) if (own(rel, part.root)) ignored.add(rel);
  }
  return { marks: addDots(marks), ignored };
}
