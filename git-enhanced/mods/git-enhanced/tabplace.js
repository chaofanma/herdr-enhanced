// Which tab shows a page, and where the layout shows it: the pure half of tabs.js.
// Shared: the same file in both mods (shared/, tools/copy-shared.mjs).

export const NAMES = { history: "History", review: "Review", files: "Files" };
/** The shared keys of `mod`'s tabs: herdr-t3's t3-pane names a mod pane by "<mod>.titles". */
export const keysOf = (mod) => ({ tabs: `${mod}.tabs`, titles: `${mod}.titles` });

/** The ids of every tab now. */
export const liveTabs = (list) => new Set((list ?? []).flatMap((s) => (s.tabs ?? []).map((t) => t.id)));

/** `map` without the entries of tabs that are gone. */
export function pruned(map, live) {
  const out = {};
  for (const [id, v] of Object.entries(map ?? {})) if (live.has(id)) out[id] = v;
  return out;
}

/** The open tab that shows page `kind` of root (on machine `on`) in space `space`, or null. */
export function findTab(map, { kind, root, on = null, space = null }) {
  for (const [id, v] of Object.entries(map ?? {}))
    if (v.kind === kind && v.root === root && (v.on ?? null) === (on ?? null) && (v.space ?? null) === space) return id;
  return null;
}

/** Where layout `tree` shows `mod`'s page `view` ("history"; "changes" for the Changes page, a block
 *  without a view): { stack, child, panel }: the stack and child to select, and the node to hide (the
 *  stack's parent when it has an id, like a panel column; else the stack). A block with a role (the
 *  panel's tab header) isn't a page. Null when it isn't there. */
export function placeOf(tree, mod, view) {
  let hit = null;
  const visit = (n, parents) => {
    if (hit || !n || typeof n !== "object") return;
    const c = n.content;
    if (c && typeof c === "object" && c.mod === mod && (c.props?.view ?? "changes") === view && !c.props?.review && !c.props?.root && !c.props?.role) {
      const at = parents.map((p) => p.type).lastIndexOf("stack"), stack = at >= 0 ? parents[at] : null;
      const holder = at > 0 ? parents[at - 1] : null;
      hit = { stack: stack?.id ?? null, child: n.id ?? null, panel: holder?.id && at > 1 ? holder.id : stack?.id ?? null };
      return;
    }
    for (const child of n.children ?? []) visit(child, [...parents, n]);
  };
  visit(tree, []);
  return hit;
}
