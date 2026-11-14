// Three layout checks the render stubs of both mods run over every tree a test renders (load.mjs's
// draw and renderNow, test/shared/panel.mjs's draw); what they find goes into state.violations, so
// every `assert.deepEqual(state.violations, [])` catches it. Each breaks a page on screen while
// every other check passes:
// (a) a scroll area needs a height of its own: h (or size), size_full or h_full, or flex_1 with
//     min_h(0) in a column that has a height (h, size, size_full, h_full, or flex_1 in a column that
//     has one, up the tree). With a max_h alone it shows its content clipped and never scrolls in
//     Herdr (History's information, for one); with flex_1 in a column as tall as its content it
//     comes out 0 px tall (the stopped cherry-pick's box of what git said, for one).
// (b) an h_flex centres what it holds, so a child holding a virtual list (at any depth) is as tall as
//     its content and the list comes out 0 px tall, unless the row stretches its children
//     (items_stretch) or that child has a height: h_full or size_full (or h, size; the Changes
//     page's diff, for one).
// (c) an open popover's button has no tooltip: the pointer is still on the button when the menu
//     opens, so its tooltip shows over the menu (History's branch menu, for one).
const SCROLLS = new Set(["overflow_y_scrollbar", "overflow_y_scroll", "overflow_scrollbar", "overflow_scroll"]);

/** The problems in a rendered tree (the stubs' elements: `el.$` is { kind, id, calls, children }). */
export function layoutProblems(tree) {
  const out = [], lists = new Map();
  const calls = (n) => n.calls.map(([m]) => m);
  const holdsList = (n) => {
    if (lists.has(n)) return lists.get(n);
    const yes = n.kind === "vlist" || n.children.some((c) => c?.$ && holdsList(c.$));
    lists.set(n, yes);
    return yes;
  };
  const sized = (k) => calls(k).some((x) => x === "h" || x === "size" || x === "size_full" || x === "h_full");
  const column = (k) => k.kind === "v_flex" || (k.kind === "div" && calls(k).includes("flex_col"));
  // The column, up `up` (nearest first), that leaves a flex_1 element as tall as its content: null
  // when one has a height, or the chain leaves the columns (a row, another kind) or reaches the
  // tree's root (its host sizes it): not told.
  const unsized = (up) => {
    for (let i = 0; i < up.length - 1; i++) {
      const k = up[i];
      if (!column(k) || sized(k)) return null;
      if (!calls(k).includes("flex_1")) return k;
    }
    return null;
  };
  const visit = (node, up = []) => {
    const n = node?.$;
    if (!n) return;
    const c = calls(n);
    if (c.some((x) => SCROLLS.has(x))) {
      const flexed = c.includes("flex_1") && n.calls.some(([m, a]) => m === "min_h" && a[0] === 0);
      if (!(sized(n) || flexed)) out.push(`layout: ${n.id ?? n.kind} scrolls with ${c.includes("max_h") ? "only a max_h" : "no height of its own"} (it never scrolls in Herdr)`);
      else if (!sized(n)) {
        const k = unsized(up);
        if (k) out.push(`layout: ${n.id ?? n.kind} scrolls with flex_1 in ${k.id ?? k.kind}, a column as tall as its content: it comes out 0 px tall`);
      }
    }
    if (n.kind === "h_flex" && !c.includes("items_stretch")) {
      for (const child of n.children) {
        const k = child?.$;
        if (k && holdsList(k) && !calls(k).some((x) => x === "h_full" || x === "size_full" || x === "h" || x === "size")) out.push(`layout: ${k.id ?? k.kind} holds a virtual list in an h_flex (${n.id ?? "no id"}) that doesn't stretch it: the list is 0 px tall`);
      }
    }
    if (n.kind === "popover" && n.calls.some(([m, a]) => m === "open" && a[0] === true)) {
      const tipped = (m) => { if (!m) return null; if (m.calls.some(([k]) => k === "tooltip")) return m; for (const k of m.children) { const hit = tipped(k?.$); if (hit) return hit; } return null; };
      const hit = tipped(n.triggerEl?.$);
      if (hit) out.push(`layout: ${hit.id ?? hit.kind}, the button of the open menu ${n.popover ?? n.id ?? "(no id)"}, has a tooltip (it covers the menu)`);
    }
    n.children.forEach((k) => visit(k, [n, ...up]));
  };
  visit(tree);
  return out;
}
