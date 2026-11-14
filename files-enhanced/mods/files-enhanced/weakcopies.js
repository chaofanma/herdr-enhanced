// A set of a mod's copies (or of their pages) held weakly. Herdr reloads a mod in place when its files
// change: it gives each copy a new object without calling the old one's close(), and the module that
// held the old objects stays in memory (an ES module can't be unloaded). A plain Set there kept every
// replaced copy, with all it holds (diffs, file lists, trees, commits), until Herdr restarted, and
// enough reloads filled the memory all mods share. Held here, a replaced copy goes once nothing else
// holds it. Plain JS (no Herdr imports): tested with node.

/** An iterable set held weakly: add(x), delete(x), has(x), clear(), size, and iteration over the
 *  members still alive, in the order they were added (one added again keeps its place). */
export function weakCopies() {
  const refs = new Set();
  // [ref, member] of the members still alive; a gone one's ref leaves the set on the way.
  function* live() {
    for (const r of refs) {
      const x = r.deref();
      if (x === undefined) refs.delete(r); else yield [r, x];
    }
  }
  return {
    add(x) {
      for (const [, y] of live()) if (y === x) return this;
      refs.add(new WeakRef(x));
      return this;
    },
    delete(x) {
      for (const [r, y] of live()) if (y === x) { refs.delete(r); return true; }
      return false;
    },
    has(x) {
      for (const [, y] of live()) if (y === x) return true;
      return false;
    },
    clear() { refs.clear(); },
    get size() { let n = 0; for (const _ of live()) n++; return n; },
    *[Symbol.iterator]() { for (const [, x] of live()) yield x; },
  };
}
