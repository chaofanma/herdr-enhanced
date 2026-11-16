// Where a copy looks: the focused pane's folder, on the machine of its space (Herdr's Changes mod's
// location(), Apache-2.0); a tab opened for one repository (the Review tab, a History tab) looks at
// that one. The context key adds the repository picked for that folder (repos.js), so a pick starts
// the page over.
// Based on Herdr's shipped changes mod (Apache-2.0); changed: location() and the context key.
import { spaces, panes, focused, props } from "herdr";
import { rememberedRepo } from "./repos.js";

export function location() {
  const p = props();
  if ((p?.review || p?.view === "history") && p.root) return { cwd: p.root, on: p.on ?? null };
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((x) => x.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

export const contextKey = () => { const l = location(); return JSON.stringify({ ...l, repo: rememberedRepo(l.on, l.cwd) }); };
