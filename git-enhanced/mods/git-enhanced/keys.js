// The Enter keys of the panel (main.js): the commit message box is a textarea whose own Enter
// starts a new line; cmd-enter commits (the newline the textarea types for it taken back), and
// in the comment box cmd- or ctrl-enter adds.
// No Herdr imports: tested with node (test/git-enhanced/keys.test.mjs).

/** What an Enter press does: "comment" adds the comment being written, "commit" is a press on
 *  Commit, null nothing (plain Enter is the textarea's newline). `secondary`: cmd held (the
 *  textarea's submit says so too); `control`: ctrl held; `held`: a held key's repeat; `typing`:
 *  the commit message box has the keyboard; `naming`: the new-branch box has it; `composer`:
 *  the comment box is open. The box with the keyboard decides: the message box commits even
 *  with a comment box open, the branch name never does anything here (its Enter makes it). */
export function enterAction({ secondary = false, control = false, held = false, typing = false, naming = false, composer = false } = {}) {
  if (held || naming) return null;
  if (typing) return secondary ? "commit" : null;
  if (composer) return secondary || control ? "comment" : null;
  return secondary ? "commit" : null;
}

/** Whether `after` is `before` with one stretch (empty: just the cursor; else the selection)
 *  replaced by a single newline: what Herdr's textarea types for an Enter, cmd-enter's too
 *  (and for each of a held key's repeats), before its submit. */
export function newlineTyped(before, after) {
  if (after.length > before.length + 1) return false;
  let i = 0, j = 0;
  while (i < before.length && i < after.length && before[i] === after[i]) i++;
  while (j < before.length - i && j < after.length - i && before[before.length - 1 - j] === after[after.length - 1 - j]) j++;
  return after.slice(i, after.length - j) === "\n";
}

/** One physical press can reach the panel twice, in either order: as the textarea's submit and
 *  as the key going up to the panel's on_key_down; and a held key repeats (after 225 ms, then
 *  every 30 ms, on a fast setting), which the textarea's submit doesn't say. Commit's first press
 *  may only arm a question (stage everything? amend a pushed commit?), so a second delivery
 *  would answer it unseen. `take(now)` is true for a press: the key went up since the last one
 *  (`release()`, from the panel's on_key_up) and `gap` ms have passed. Should a key-up be missed
 *  (the window lost the keyboard mid-press), `stale` ms without a delivery count as one. Every
 *  call moves the window, so a held key's repeats never get there. */
export class Presses {
  constructor(gap = 150, stale = 2000) { this.gap = gap; this.stale = stale; this.last = -Infinity; this.up = true; }
  release() { this.up = true; }
  take(now) {
    const since = now - this.last;
    this.last = now;
    if (since < this.gap || (!this.up && since < this.stale)) return false;
    this.up = false;
    return true;
  }
}
