// A repository's `git status --porcelain=v1 -z --no-renames` as the tree's marks: keyed by path
// relative to the shown root, A (new), M, D or U (conflict); folders get their most urgent child's
// mark under "dir:<path>". With --ignored=matching, "!!" entries are the ignored paths. Pure: tested in
// test/files-enhanced/gitstatus.test.mjs.
import { readable } from "./ink.js";

// How urgent a mark is: a folder's dot takes the most urgent one inside it.
export const RANK = { A: 1, M: 2, D: 3, U: 4 };

// A path with "/" only and no "/" at its end; without case where `fold` (Windows).
const plain = (path, fold) => {
  let s = path.split("\\").join("/");
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return fold ? s.toLowerCase() : s;
};

// A mark's color in the tree: new green, deleted or conflicted red, the rest (modified) yellow.
const COLORS = { A: "ansi2", D: "ansi1", U: "ansi1" };
// A mark's color where it reads on a row, selected or under the pointer (else the theme's foreground).
export const markColor = (mark, t) => (mark ? readable(t, t[COLORS[mark] ?? "ansi3"], [t.surface, t.selected, t.hover]) : null);

// The mark for a status code (XY): untracked or added A, a conflict U, deleted D, else M.
export const markOf = xy => (xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M");

// Folder dots: each marked path's folders up to the root get its mark unless they have a more urgent
// one. Changes `marks` in place.
export function addDots(marks) {
  for (const [rel, mark] of Object.entries(marks)) {
    if (rel.startsWith("dir:")) continue;
    const parts = rel.split("/");
    for (let n = parts.length - 1; n > 0; n--) {
      const key = `dir:${parts.slice(0, n).join("/")}`;
      if ((RANK[marks[key]] ?? 0) < RANK[mark]) marks[key] = mark;
    }
  }
  return marks;
}

// stdout of the status run in a repository whose top folder is `top`, for the tree shown at `root`
// (inside the repository, or above it): { marks, ignored } with the paths below root only. `fold`:
// paths compare without case (Windows). At most `limit` entries are read.
export function parseStatus(stdout, top, root, { fold = false, limit = 20000 } = {}) {
  const shown = plain(root, fold), under = shown.endsWith("/") ? shown : `${shown}/`, repo = plain(top.trim(), false);
  const marks = {}, ignored = new Set();
  for (const entry of String(stdout ?? "").split("\0").filter(Boolean).slice(0, limit)) {
    const xy = entry.slice(0, 2);
    if (xy === "##") continue;
    // The entry's path from the repository's top, as a path from the shown root (if it's under it).
    const path = plain(repo.endsWith("/") ? repo + entry.slice(3) : `${repo}/${entry.slice(3)}`, false);
    if (!(fold ? path.toLowerCase() : path).startsWith(under)) continue;
    const rel = path.slice(under.length);
    if (xy === "!!") ignored.add(rel);
    else marks[rel] = markOf(xy);
  }
  return { marks: addDots(marks), ignored };
}
