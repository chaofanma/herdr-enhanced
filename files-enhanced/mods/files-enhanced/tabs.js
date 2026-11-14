// Pages opened in a tab of their own (each page's ⤢): Git Enhanced's History and Review, Files
// Enhanced's tree (kind "files").
//
// One tab per page and repository in a space: opening it again shows the tab that is open instead of
// making a second (two clicks would otherwise make two History tabs). While it is open the panel that
// holds the page is hidden: the page gets the room, and the panel doesn't show the same page again
// beside it (with the panel left open the screen would look as before, only narrower). ⤡ in the tab
// closes it, goes back to the tab it was opened from and shows the panel again on that page. A tab
// closed another way (the pane header's ×, ⌘W, the tab bar) brings the panel back too: the pages in
// the panel, alive while it is hidden, look for it every CLOSED_TAB_POLL ms (restoreClosedTabs).
//
// herdr-t3's pane header (t3-pane) names a mod pane by shared("<mod>.titles")[tab], so the tab's header
// says History or Review rather than the mod's folder name. Herdr's own pane header shows the mod's
// name; nothing a mod can set changes that.
//
// The layout is read, not assumed: the page's block is found in layout() by its mod and view, with the
// stack around it (the page to select) and the node holding that stack (what to hide, the panel).
// History without a block of its own is the Changes block's, under its Changes | History switch
// (block.js; Herdr's own layout): that block's panel gives way, and ⤡ shows it again on the block,
// which still shows History (a hidden copy stays as it was).
import { spaces, panes, focused, layout, run, shared, setShared } from "herdr";
import { NAMES, keysOf, liveTabs, pruned, findTab } from "./tabplace.js";
import { pagePlace, placeIn, isTree } from "./reveal.js";

// Where layout `tree` shows mod `mod`'s page `kind` (reveal.js): Files' tree, History, else the
// Changes page.
const placeFor = (tree, mod, kind) => (kind === "files" ? placeIn(tree, isTree(mod)) : pagePlace(tree, mod, kind === "history" ? "history" : "changes"));

/** Opens page `kind` of root/on as a tab (props: the tab copy's), or shows the one already open;
 *  hides the panel that holds the page. Call it from a click (it sets shared keys). */
export function openAsTab({ mod, kind, props, root, on = null }, cx) {
  const k = keysOf(mod), space = spaces().find((s) => s.active)?.id ?? null, from = focused()?.tab ?? null;
  const place = placeFor(layout(), mod, kind);
  const open = findTab(pruned(shared(k.tabs), liveTabs(spaces())), { kind, root, on, space });
  if (open) run("tab.select", { id: open });
  else {
    const before = new Set(panes().filter((p) => p.mod === mod).map((p) => p.tab));
    run("tab.new", { name: NAMES[kind], mod, props });
    // The new tab's id: the tab with a pane of this mod that wasn't there before.
    cx.spawn(async (cx) => {
      for (let i = 0; i < 40; i++) {
        const made = panes().find((p) => p.mod === mod && p.tab && !before.has(p.tab));
        if (made) {
          const live = liveTabs(spaces());
          setShared(k.tabs, { ...pruned(shared(k.tabs), live), [made.tab]: { kind, root, on, space, from, place, layout: shared("layout") ?? null } });
          setShared(k.titles, { ...pruned(shared(k.titles), live), [made.tab]: NAMES[kind] });
          return;
        }
        await cx.sleep(50);
      }
    });
  }
  if (place?.panel) run("layout.hide", { id: place.panel });
}

/** Brings forward the tab that shows page `kind` of root/on in the active space, when one is open
 *  (a reveal request taken by that tab's copy). */
export function showTab({ mod, kind, root, on = null }) {
  const space = spaces().find((s) => s.active)?.id ?? null;
  const open = findTab(pruned(shared(keysOf(mod).tabs), liveTabs(spaces())), { kind, root, on, space });
  if (open) run("tab.select", { id: open });
}

/** How often a page in the panel looks for its tabs closed another way than ⤡ (ms). */
export const CLOSED_TAB_POLL = 1500;
// The page tabs seen open: one gone from spaces() after it was seen was closed (the pane header's ×,
// ⌘W, the tab bar); one never seen open (closed before this app started) is only let go. The mod's
// copies share this module: one set for all of them, and the first copy to see a tab gone acts.
const seen = new Set();
// Whether the node `id` of layout `tree` is hidden (layout() gives what is shown now).
function hiddenIn(tree, id) {
  let hit = null;
  const visit = (n) => { if (hit || !n || typeof n !== "object") return; if (n.id === id) { hit = n; return; } for (const c of n.children ?? []) visit(c); };
  visit(tree);
  return Boolean(hit?.hidden);
}

/** Mod `mod`'s page tabs closed another way than ⤡: the panel that gave way comes back on that page,
 *  as ⤡ shows it, unless it is shown already, the layout is another one now, or the tab in front is
 *  another of these page tabs (the panel would show its page beside it). The closed tabs' entries
 *  go. Run by a page in the panel every CLOSED_TAB_POLL ms; cheap while no page tab is open. */
export function restoreClosedTabs(mod) {
  const k = keysOf(mod), map = shared(k.tabs) ?? {};
  if (!Object.keys(map).length) return;
  const live = liveTabs(spaces());
  if (!live.size) return; // the spaces aren't there to read: nothing can be told
  const closed = [];
  for (const [tab, entry] of Object.entries(map)) {
    if (live.has(tab)) seen.add(tab);
    else if (seen.has(tab)) closed.push([tab, entry]);
  }
  if (!closed.length) return;
  const without = (key) => { const m = { ...(shared(key) ?? {}) }; for (const [tab] of closed) delete m[tab]; return m; };
  setShared(k.tabs, without(k.tabs)); setShared(k.titles, without(k.titles));
  for (const [tab] of closed) seen.delete(tab);
  const front = focused()?.tab ?? null;
  if (front && live.has(front) && map[front]) return;
  const tree = layout(), now = shared("layout") ?? null;
  const entry = closed.map(([, e]) => e).find((e) => e.place?.panel && (e.layout ?? now) === now);
  if (!entry || !hiddenIn(tree, entry.place.panel)) return;
  run("layout.show", { id: entry.place.panel });
  if (entry.place.stack && entry.place.child) run("layout.select", { stack: entry.place.stack, child: entry.place.child });
}

/** ⤡ in a page's tab: the panel again on that page, the tab it was opened from, this tab closed. */
export function backToPanel({ mod, kind }) {
  const k = keysOf(mod), tab = focused()?.tab ?? null, live = liveTabs(spaces());
  const entry = tab ? (shared(k.tabs) ?? {})[tab] : null;
  const place = entry?.place ?? placeFor(layout(), mod, kind);
  if (place?.panel) run("layout.show", { id: place.panel });
  if (place?.stack && place?.child) run("layout.select", { stack: place.stack, child: place.child });
  if (entry?.from && entry.from !== tab && live.has(entry.from)) run("tab.select", { id: entry.from });
  if (!tab) return;
  run("tab.close", { id: tab });
  const without = (key) => { const m = pruned(shared(key), live); delete m[tab]; return m; };
  setShared(k.tabs, without(k.tabs));
  setShared(k.titles, without(k.titles));
}
