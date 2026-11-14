// The panel mods' reveal API, public: any mod (each of the two for the other, when it's installed)
// asks one of them to show something by setting its shared key.
//   setShared("git-enhanced.reveal", { at: Date.now(), root, on, path, page })
//     root: the repository's folder; on: its machine (null: this computer); path: relative to root
//     (a file or a folder; "" for the whole repository); page: "changes" (the file's diff on the
//     Changes page) or "history" (path:<path> in the History page's search).
//   setShared("files-enhanced.reveal", { at: Date.now(), full, on })
//     full: an absolute path on machine `on`; the Files tree opens the folders down to it and
//     selects it.
// A copy that can show it does (each mod's own rules), and brings its page forward (layout.select
// and layout.show, the stack found in layout(): pagePlace). A layout may have no History page but a
// Changes block with its own Changes | History switch (Herdr's tab bar has buttons for the panel's
// files and changes only): History is that block's then. A request older than RECENT ms is let go: shared
// state outlives the app. The asking side brings the page forward too, so a page that never showed
// (Herdr starts a copy the first time it shows) starts and takes the request.
// Shared: the same file in both mods (shared/, tools/copy-shared.mjs).
import { setShared, layout, run } from "herdr";
import { MODS } from "./installed.js";
import { findNode } from "./paneltabs.js";
import { ID } from "./id.js";
import { weakCopies } from "./weakcopies.js";

/** The two keys, by part. */
export const REVEAL = { files: `${MODS.files}.reveal`, changes: `${MODS.changes}.reveal` };
/** How long a request stays worth taking (ms). */
export const RECENT = 15000;

/** A request worth taking on key `kind` ("files" or "changes"): `at` a time in the last RECENT ms
 *  and the fields its key needs, cleaned; else null. */
export function requestOf(value, kind, now = Date.now()) {
  if (!value || typeof value !== "object" || typeof value.at !== "number" || now - value.at > RECENT || value.at > now + 1000) return null;
  const on = typeof value.on === "string" && value.on ? value.on : null;
  if (kind === "files") return typeof value.full === "string" && value.full ? { at: value.at, full: value.full, on } : null;
  if (typeof value.root !== "string" || !value.root || (value.path != null && typeof value.path !== "string")) return null;
  return { at: value.at, root: value.root, on, path: String(value.path ?? "").replace(/^\/+|\/+$/g, ""), page: value.page === "history" ? "history" : "changes" };
}

/** Where layout `tree` shows a block whose content passes `test(content)`: { stack, child, panel }:
 *  the stack and child to select, and the node to show (the stack's parent when it has an id, like a
 *  panel column; else the stack). Null when no block does. Headers aren't children: never found. */
export function placeIn(tree, test) {
  let hit = null;
  const visit = (n, parents) => {
    if (hit || !n || typeof n !== "object") return;
    if (n.content && typeof n.content === "object" && test(n.content)) {
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

// Our tab header: a part of either mod (this one whatever its folder is called) with role "tabs".
const OURS = new Set([...Object.values(MODS), ID]);
const isHeader = (c) => Boolean(c && typeof c === "object" && OURS.has(c.mod) && c.props?.role === "tabs");

/** Whether stack `stack` of layout `tree` has our tab header: the stack's own "header", or a block of
 *  ours with role "tabs" naming that stack (its props.stack, default "panel-body"). */
export function hasOurHeader(tree, stack) {
  if (!stack) return false;
  if (isHeader(findNode(tree, stack)?.header?.content)) return true;
  let hit = false;
  const visit = (n) => {
    if (hit || !n || typeof n !== "object") return;
    if (isHeader(n.content) && (n.content.props.stack ?? "panel-body") === stack) { hit = true; return; }
    for (const c of n.children ?? []) visit(c);
  };
  visit(tree);
  return hit;
}

/** Where layout `tree` shows Git Enhanced's (`mod`'s) page `page` ("changes" or "history"):
 *  placeIn's place of its block. History without a block of its own: the Changes block, when no tab
 *  header of ours is over it (it shows History under its own Changes | History switch), with
 *  `switch: true`. Null when the layout shows neither. */
export function pagePlace(tree, mod, page) {
  const own = placeIn(tree, isPage(mod, page));
  if (own || page !== "history") return own;
  const changes = placeIn(tree, isPage(mod, "changes"));
  return changes && !hasOurHeader(tree, changes.stack) ? { ...changes, switch: true } : null;
}

/** Shows a place (placeIn's): its stack's child selected, the node holding it shown. */
export function bringForward(place) {
  if (!place) return;
  if (place.stack && place.child) run("layout.select", { stack: place.stack, child: place.child });
  if (place.panel) run("layout.show", { id: place.panel });
}

// The pages the two keys name, as layout block contents of mod `mod`: a Changes or History page (not
// a tab's copy, a Review tab or a part with a role), the Files tree.
export const isPage = (mod, page) => (c) => c.mod === mod && !c.props?.role && !c.props?.review && !c.props?.root && (c.props?.view === "history" ? "history" : "changes") === page;
export const isTree = (mod) => (c) => c.mod === mod && !c.props?.role;

/** Asks Git Enhanced to show `path` of repository `root` (on machine `on`) on `page`, and brings
 *  that page forward when the layout has it (History: its block, else the Changes block that shows
 *  it). From a click (it sets a shared key). */
export function askChanges({ root, on = null, path = "", page = "changes" }) {
  setShared(REVEAL.changes, { at: Date.now(), root, on: on ?? null, path, page });
  bringForward(pagePlace(layout(), MODS.changes, page));
}

/** Asks Files Enhanced to show `full` (on machine `on`), and brings its page forward. From a click. */
export function askFiles({ full, on = null }) {
  setShared(REVEAL.files, { at: Date.now(), full, on: on ?? null });
  bringForward(placeIn(layout(), isTree(MODS.files)));
}

/** The copies of this mod that take requests (copies of one mod share this module): each adds
 *  itself when it starts and goes when Herdr closes it. Ordered as they started. Held weakly
 *  (weakcopies.js): a reload replaces a copy without closing it, and this module stays. */
export const takers = weakCopies();
