// Renamed files: git's -z outputs with renames in them (status, numstat, name-status), the label
// "old → new", and hunk patches of a renamed file's diff. A rename shows as one file at its new
// path that remembers the old one (`from`); staging, unstaging and reverting it name both paths
// (gitops.js). No imports: tested with node (test/git-enhanced/renames.test.mjs).

// Adapted from lazygit pkg/commands/git_commands/file_loader.go, gitStatus (MIT, Copyright (c)
// 2018 Jesse Duffield): in `git status --porcelain -z`, an entry whose status has R or C (a rename
// or copy) is followed by one more field, the path it came from. lazygit looks at the first
// letter only; a rename in the working tree (intent-to-add) has it second, so both are looked at.
/** `git status --porcelain=v1 -z` as `[{ xy, path, from }]` (`from`: a rename's or copy's old path, else null). */
export function parseStatusZ(stdout = "") {
  const parts = stdout.split("\0"), out = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2), moved = /[RC]/.test(xy);
    out.push({ xy, path: entry.slice(3), from: moved ? parts[i + 1] ?? null : null });
    if (moved) i++;
  }
  return out;
}

/** `git diff --numstat -z -M` as Map(path → { add, del, binary, from }): a rename's entry has an
 *  empty path and its old and new paths as the next two fields. */
export function parseNumstatZ(stdout = "") {
  const parts = stdout.split("\0"), out = new Map();
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(parts[i]);
    if (!m) continue;
    let path = m[3], from = null;
    if (path === "") { from = parts[i + 1] ?? null; path = parts[i + 2] ?? ""; i += 2; }
    if (!path) continue;
    out.set(path, { add: Number(m[1]) || 0, del: Number(m[2]) || 0, binary: m[1] === "-", from });
  }
  return out;
}

/** `git diff --name-status -z -M` as `[{ status, path, from }]` (`status`: its letter, R for a
 *  rename whatever its score). */
export function parseNameStatusZ(stdout = "") {
  const parts = stdout.split("\0"), out = [];
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (!s) continue;
    if (/^[RC]\d*$/.test(s)) { out.push({ status: s[0], from: parts[i + 1], path: parts[i + 2] }); i += 2; }
    else { out.push({ status: s[0], path: parts[i + 1], from: null }); i += 1; }
  }
  return out.filter((e) => e.path);
}

/** What the file list shows before a renamed file's name: its old name when it stayed in its
 *  folder, else its old path. */
export function fromLabel(from, path) {
  const dir = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
  return dir(from) === dir(path) ? from.slice(dir(from).length) : from;
}

/** A diff header for one hunk's patch of a renamed file: the rename's lines dropped and both
 *  sides named by the new path, so a hunk applies to the content only and the rename stays
 *  (`git apply --cached -R` of the whole header would take the rename back too). Other headers
 *  come back as they are. */
export function contentHeader(header, path) {
  if (!header.some((l) => l.startsWith("rename from ") || l.startsWith("copy from "))) return header;
  const q = (p) => (/[\0-\x1f"\\\x7f]/.test(p) ? null : p), name = q(path);
  if (name === null) return null;
  return [`diff --git a/${name} b/${name}`, `--- a/${name}`, `+++ b/${name}`];
}

/** The paths an action on a file names: the old one too for a rename. */
export const pathsOf = (path, from) => (from ? [from, path] : [path]);
