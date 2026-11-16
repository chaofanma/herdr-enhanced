// A worktree's space in Herdr: the space whose terminals are in that worktree (worktrees.js spaceFor,
// as Herdr's own worktree list finds it), going there (a new space when there is none), closing it.
import { spaces, panes, run } from "herdr";
import { spaceFor } from "./worktrees.js";

/** For a page on machine `on` (null: this computer): { find(path, list), go(path, list), close(id) }.
 *  `list`: the repository's worktrees (parseWorktrees), so that a space in a worktree inside the one
 *  at `path` isn't taken for its. */
export function worktreeSpaces(on) {
  const find = (path, list = []) => spaceFor(path, list, on, spaces(), panes()) ?? null;
  return {
    find,
    go(path, list = []) {
      const s = find(path, list);
      if (s) run("space.select", { id: s.id });
      else run("space.new", { folder: path, ...(on ? { machine: on } : {}) });
    },
    close(id) { run("space.close", { id, confirmed: true }); },
  };
}
