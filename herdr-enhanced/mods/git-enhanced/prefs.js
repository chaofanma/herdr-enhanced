// How this mod uses the panel's settings (panelsettings.js holds the groups; the settings window
// writes them): automatic fetches and the commit message template (the agent the send dialog
// starts: fields.js startCommand). No Herdr imports: tested with node (test/git-enhanced/prefs.test.mjs).

/** How often the panel looks whether an automatic fetch is due, in ms. */
export const FETCH_TICK = 30000;

/** Whether a repo is due an automatic fetch: autoFetch `minutes` > 0, and that long since the
 *  last fetch at `last` (ms; undefined: none yet, so at once). */
export function fetchDue(minutes, last, now) {
  if (!(minutes > 0)) return false;
  return last === undefined || now - last >= minutes * 60000;
}

/** Whether a copy of the mod fetches by itself: the panel, not a review tab (props.review), a
 *  history page (props.view) or an overlay. */
export const fetchesItself = (p) => !p?.review && !p?.view && !p?.overlay;

/** A message that is empty, or only the template: nothing to commit with. */
export function bareMessage(message, template = "") {
  const m = String(message ?? "").trim(), t = String(template ?? "").trim();
  return !m || (t !== "" && m === t);
}
