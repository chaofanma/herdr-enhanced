// The History page's graph: which lane each commit sits in and the lines between them, one pass
// over the commits in log order (VS Code's Source Control Graph swimlanes: each row's input lanes
// are the previous row's output; the commit takes the first lane waiting for it, its first parent
// takes that lane over, other parents get new lanes). Changes from VS Code's: a root commit keeps
// the other lanes going (VS Code's drops them); colors are indexes, fixed ones for refs the caller
// names; rows can be taller than VS Code's 22 px, with the commit's dot at `cy`; a merge parent to
// the left of the dot bends the other way; drawing is data (path commands), not SVG.
// No Herdr imports: tested with node (test/git-enhanced/graph.test.mjs).

/** px: a lane's width, the curve radius where a lane moves over, the dot's radius. */
export const LANE = 11, CURVE = 5, DOT = 4;

// Adapted from microsoft/vscode src/vs/workbench/contrib/scm/browser/scmHistory.ts (MIT),
// toISCMHistoryItemViewModelArray.
/** Each commit's lanes: `{ input, output, circle, color, kind }` per commit, where input/output
 *  are the lanes above and below the row (`{ id: the commit each waits for, color }`), circle the
 *  lane the commit's dot is in and color its color. `fixed(commit)` may give a commit's color
 *  (the current branch's, its upstream's); others take `colors` in turn after `reserved`. */
export function lanes(commits, { colors = 6, reserved = 0, fixed = () => undefined, head = null } = {}) {
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const rows = [];
  let turn = -1;
  const next = () => { turn = (turn + 1) % Math.max(1, colors - reserved); return reserved + turn; };
  for (const c of commits) {
    const input = (rows.at(-1)?.output ?? []).map((n) => ({ ...n }));
    const output = [];
    const own = fixed(c);
    let firstParentAdded = false;
    // Lanes waiting for this commit end here; the first one goes on to its first parent.
    for (const node of input) {
      if (node.id === c.hash) {
        if (!firstParentAdded && c.parents.length) { output.push({ id: c.parents[0], color: own ?? node.color }); firstParentAdded = true; }
        continue;
      }
      output.push({ ...node });
    }
    // The other parents (all of them for a commit no lane waited for) get lanes at the end.
    for (let i = firstParentAdded ? 1 : 0; i < c.parents.length; i++) {
      let color = i === 0 ? own : fixed(byHash.get(c.parents[i]) ?? { hash: c.parents[i], parents: [], refs: [] });
      if (color === undefined) color = next();
      output.push({ id: c.parents[i], color });
    }
    const at = input.findIndex((n) => n.id === c.hash), circle = at !== -1 ? at : input.length;
    // The dot takes the color of the lane going on to its first parent (a root commit: of the one it ends).
    const color = c.parents.length && circle < output.length ? output[circle].color : circle < input.length ? input[circle].color : (own ?? 0);
    rows.push({ input, output, circle, color, kind: c.hash === head ? "head" : c.parents.length > 1 ? "merge" : "node" });
  }
  return rows;
}

/** How many lanes a row's graph is wide. */
export const width = (row) => Math.max(row.input.length, row.output.length, 1) + 1;

const xOf = (i) => LANE * (i + 1);

// Adapted from microsoft/vscode src/vs/workbench/contrib/scm/browser/scmHistory.ts (MIT),
// renderSCMHistoryItemGraph.
/** What row `row` of commit `commit` draws in a box `height` px tall with the dot at `cy`: lines
 *  `{ color, d }` (d: path commands `["M", x, y]`, `["L", x, y]`, `["A", r, r, 0, large, sweep,
 *  x, y]`, stroked) and the dot `{ color, x, y, kind }`. */
export function drawRow(commit, row, { height = 22, cy = height / 2 } = {}) {
  const { input, output, circle } = row, lines = [];
  const line = (color, ...d) => lines.push({ color, d });
  const H = height, r = Math.min(CURVE, cy, H - cy);
  let out = 0;
  for (let index = 0; index < input.length; index++) {
    const color = input[index].color, x = xOf(index);
    if (input[index].id === commit.hash) {
      // Another lane waiting for this commit (a fork point): it bends over into the dot.
      if (index !== circle) {
        const R = Math.min(LANE, cy);
        line(color, ["M", x, 0], ["L", x, cy - R], ["A", R, R, 0, 0, 1, x - R, cy], ["L", xOf(circle), cy]);
      } else if (commit.parents.length) out++;
      continue;
    }
    if (out < output.length && input[index].id === output[out].id) {
      if (index === out) line(color, ["M", x, 0], ["L", x, H]);
      else {
        // A lane moving left (one before it ended): down, over, down again.
        const to = xOf(out);
        line(color, ["M", x, 0], ["L", x, cy - r], ["A", r, r, 0, 0, 1, x - r, cy], ["L", to + r, cy], ["A", r, r, 0, 0, 0, to, cy + r], ["L", to, H]);
      }
      out++;
    }
  }
  const cx = xOf(circle);
  // A merge's other parents: from the dot over to their lanes, then down.
  for (let i = 1; i < commit.parents.length; i++) {
    let p = -1;
    for (let k = output.length - 1; k >= 0; k--) if (output[k].id === commit.parents[i]) { p = k; break; }
    if (p === -1) continue;
    const x = xOf(p), R = Math.min(LANE, H - cy), color = output[p].color;
    if (x >= cx) line(color, ["M", cx, cy], ["L", x - R, cy], ["A", R, R, 0, 0, 1, x, cy + R], ["L", x, H]);
    else line(color, ["M", cx, cy], ["L", x + R, cy], ["A", R, R, 0, 0, 0, x, cy + R], ["L", x, H]);
  }
  // Into the dot from above, and on from it to the first parent.
  const at = input.findIndex((n) => n.id === commit.hash);
  if (at !== -1) line(input[at].color, ["M", cx, 0], ["L", cx, cy]);
  if (commit.parents.length > 0) line(row.color, ["M", cx, cy], ["L", cx, H]);
  return { lines, dot: { color: row.color, x: cx, y: cy, kind: row.kind }, width: LANE * width(row) };
}
