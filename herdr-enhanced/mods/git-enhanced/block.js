// The panel's Changes block where nothing else leads to History: Herdr's tab bar has buttons for the
// panel's `files` and `changes` only, so a layout with neither our tab header (a stack's "header" of
// either mod with role "tabs", paneltabs.js) nor a History page of its own (which its tab bar or
// header shows: the herdr-enhanced layout's tab bar has a History button) gets a Changes | History
// switch, History drawn in the same block. The switch is the shown page's name, first in its own top row (window.js titleSwitch):
// no row of its own under Herdr's tab bar, whose Changes button already leads here. Where the layout
// leads to History itself the block is the Changes page alone, with its own name. The layout is read at every render (it changes at
// runtime). The Changes page stays alive while History shows: this copy records agent turns and
// fetches, its timers keep running, and it still follows what other copies ask (its render-time
// follow); when it shows a file or a scope it was asked to, the block switches back to it. The
// block's History takes no reveal requests itself (a hidden History would take them unseen): with no
// History page in the layout, the Changes page takes a History request (Files' File history, Folder
// history) for the block (reveals.js chooses it like a panel History page), and the block shows its
// History, filtered by the path, and comes forward. Which page shows lives only for the session.
import { v_flex } from "gpui-base";
import { theme, layout } from "herdr";
import { PageSwitch } from "./window.js";
import { placeOf } from "./tabplace.js";
import { takers, hasOurHeader, pagePlace, bringForward } from "./reveal.js";
import { ID } from "./id.js";

/** A layout block's Changes page: no History page, window, Review or History tab (they have props
 *  view, overlay, review or root). */
export const isBlock = (p) => !p?.view && !p?.overlay && !p?.review && !p?.root;

/** Whether layout `tree` shows `mod`'s Changes page in a stack with our tab header (reveal.js
 *  hasOurHeader). A block outside any stack never is. */
export const underOurHeader = (tree, mod = ID) => hasOurHeader(tree, placeOf(tree, mod, "changes")?.stack);

/** Whether layout `tree` leads to `mod`'s History by itself, so the Changes block needs no switch: our
 *  tab header is over it, or the layout has a History page of its own. */
export const leadsToHistory = (tree, mod = ID) => underOurHeader(tree, mod) || Boolean(placeOf(tree, mod, "history"));

export class BlockSwitch extends PageSwitch {
  constructor(changes) {
    super(changes);
    changes.onForward = (cx) => { if (this.page !== "changes") this.show("changes", cx); };
    changes.historySwitch = this;
    changes.titled = (t) => this.title(t);
  }
  started(page) { takers.delete(page.history); page.history.titled = (t) => this.title(t); }
  /** What a page shows as its name: the switch, or null (its own name) where the layout leads to
   *  History itself. */
  title(t) { return leadsToHistory(layout()) ? null : this.titleSwitch(t, "block"); }
  /** The block's History (history.js), once it has shown; else null. */
  history() { return this.pages.history?.history ?? null; }

  /** A History request (reveal.js) the Changes page took for this block; `how` (reveals.js): "show"
   *  (History shows that repository, or will: it's the Changes page's) or "pick" (another one the
   *  folder lists: chosen first, for both pages, as the switcher does). The block shows History
   *  (made now if it never showed), whose search gets path:<path> once it shows that repository
   *  (history.js pendingReveal); the panel comes forward on this block. */
  reveal(req, how, cx) {
    this.show("history", cx);
    this.pages.history.history.pendingReveal = { root: req.root, on: req.on ?? null, path: req.path };
    if (how === "pick") this.pages.changes.repoSet.choose(req.root);
    bringForward(pagePlace(layout(), ID, "history"));
  }

  render(cx) {
    const changes = this.pages.changes;
    if (leadsToHistory(layout())) { this.page = "changes"; return changes.render(cx); }
    const t = theme(), page = this.shown();
    if (page !== changes) changes.follow(cx);
    return v_flex().id("changes-block").size_full().min_h(0).overflow_hidden().text_color(t.foreground).child(page.render(cx));
  }
}
