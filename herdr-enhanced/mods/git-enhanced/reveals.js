// Which of this mod's copies takes a reveal request (shared/reveal.js, own("reveal")): a pure choice,
// so every copy makes the same one and only the chosen act. No Herdr imports: tested with node
// (test/git-enhanced/reveals.test.mjs).

/** `req`: { root, on, page: "changes" | "history" }. `copies`: the copies ready for it (each has read
 *  its repository once), each { copy, kind: "changes" | "history", tab (opened for one repository: a
 *  Review or History tab), root, on, roots (the repositories it lists for its folder) }; a copy may
 *  be there twice (a Changes block whose switch shows History: once of each kind). `inLayout`:
 *  whether the layout has a block for that page (for History, such a Changes block too). [{ copy, how }]:
 *  - "show": the copies of the page's kind showing that repository (the panel's first, else tabs');
 *  - "pick": else the panel copies of that kind listing it among their repositories (they switch to
 *    it, then show it);
 *  - "tab": else the first panel copy of that kind opens the page as a tab for it; with no copy of
 *    that kind, the first panel copy of any kind does, unless the layout has a block for the page
 *    (its copy starts when it shows, and takes the request then): [] for now. */
export function takersFor(req, copies, inLayout) {
  const on = req.on ?? null, same = (x) => x.root === req.root && (x.on ?? null) === on;
  const ofKind = copies.filter((x) => x.kind === req.page), panel = ofKind.filter((x) => !x.tab);
  for (const group of [panel.filter(same), ofKind.filter((x) => x.tab && same(x))]) if (group.length) return group.map((x) => ({ copy: x.copy, how: "show" }));
  const picks = panel.filter((x) => (x.on ?? null) === on && (x.roots ?? []).includes(req.root));
  if (picks.length) return picks.map((x) => ({ copy: x.copy, how: "pick" }));
  if (panel.length) return [{ copy: panel[0].copy, how: "tab" }];
  if (inLayout) return [];
  const opener = copies.find((x) => !x.tab) ?? copies[0];
  return opener ? [{ copy: opener.copy, how: "tab" }] : [];
}

/** The section of the Changes page a file's diff opens in: its unstaged changes, else its staged
 *  ones, else the first section that lists it (a scope's committed files); null when none does.
 *  `sections`: [{ key, rows: [{ f: { path } }] }]. */
export function sectionFor(sections, path) {
  const has = (g) => g.rows.some((r) => r.f.path === path);
  return (sections.find((g) => g.key === "unstaged" && has(g)) ?? sections.find((g) => g.key === "staged" && has(g)) ?? sections.find(has))?.key ?? null;
}
