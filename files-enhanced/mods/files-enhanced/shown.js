// Whether this mod's tree is on screen in the shown layout (herdr layout()): some block (a node's
// content, a stack's header or a floating block) shows it, and no node on its way is hidden or a stack
// child other than the active one. A block whose props give it a role (the panel's tab header,
// `role: "tabs"`) isn't the tree. Null when no block in the layout shows it (it's a pane, a dialog or a
// window): then nobody can tell, and the caller acts as if it were shown. Any layout works: nothing
// here knows a node by its id.
export function shownIn(node, mod) {
  let found = false, shown = false;
  const tree = (c) => c?.mod === mod && !c.props?.role;
  const look = (n, visible) => {
    if (!n || typeof n !== "object") return;
    const here = visible && !n.hidden;
    if (tree(n.content)) { found = true; shown ||= here; }
    if (tree(n.header?.content)) { found = true; shown ||= here; }
    const kids = Array.isArray(n.children) ? n.children : [];
    const active = n.type === "stack" ? n.active ?? kids[0]?.id : null;
    for (const c of kids) look(c, here && (n.type !== "stack" || c?.id === active));
    for (const f of Array.isArray(n.floating) ? n.floating : []) look(f, here);
  };
  look(node, true);
  return found ? shown : null;
}
