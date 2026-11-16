// History's rows: the graph's box is as wide on every row as the widest row's lanes, so the hash, the
// subject and everything after them line up from row to row. Each row's box was as wide as that row's
// own lanes: next to a branch the hash column moved right by a lane (11 px) and back, a zigzag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, lists, renderRows, settle, walk } from "./render/load.mjs";

const { LANE } = await (await import("./mod.mjs")).mod("graph.js");

// A history with a branch beside main for a few commits: rows with one lane and rows with two.
function branched() {
  return repo(({ write, git }) => {
    write("a.txt", "1\n"); git("add", "-A"); git("commit", "-qm", "First");
    git("switch", "-q", "-c", "side");
    write("s.txt", "s\n"); git("add", "-A"); git("commit", "-qm", "Side one");
    write("s.txt", "s2\n"); git("add", "-A"); git("commit", "-qm", "Side two");
    git("switch", "-q", "main");
    write("a.txt", "2\n"); git("add", "-A"); git("commit", "-qm", "Main two");
    git("merge", "-q", "--no-ff", "side", "-m", "Merge side");
    write("a.txt", "3\n"); git("add", "-A"); git("commit", "-qm", "Main three");
  });
}
// A row's first child (the graph's box) and its width.
const graphBox = (row) => row.$.children.find((c) => c?.$)?.$;
const widthOf = (n) => n?.calls.findLast(([m]) => m === "w")?.[1][0];

test("history rows: every row's graph box is as wide as the widest lanes, wherever its own end", async () => {
  const r = branched();
  const view = await mount(r.dir, { palette: "theme", view: "history" });
  await settle();
  const list = lists(await draw(view)).find((l) => l.listId === "history-commits");
  assert.ok(list, "the commit list");
  const rows = renderRows(list), h = view.part.history;
  const commits = rows.filter((row) => { let has = false; walk(row, (n) => { if (n.kind === "path") has = true; }); return has; });
  assert.ok(commits.length >= 5, `${commits.length} commit rows with lanes`);
  const widths = commits.map((row) => widthOf(graphBox(row)));
  // The rows' own lanes differ (one lane on main alone, two beside the branch), the boxes don't.
  const own = h.graph.map((g) => Math.max(g.input.length, g.output.length, 1) + 1);
  assert.ok(new Set(own).size > 1, `rows with different lanes: ${own.join(",")}`);
  assert.deepEqual([...new Set(widths)], [h.lanesWidth()], `one width for every row: ${widths.join(",")}`);
  assert.equal(h.lanesWidth(), LANE * Math.max(...own), "the widest row's lanes");
  assert.deepEqual(state.violations, []);
});

test("history rows: the uncommitted changes' row lines up with the commits: its dot on the first lane, its words after a box as wide", async () => {
  const r = branched();
  r.write("a.txt", "4\n");
  const view = await mount(r.dir, { palette: "theme", view: "history" });
  await settle();
  const list = lists(await draw(view)).find((l) => l.listId === "history-commits");
  const rows = renderRows(list), h = view.part.history;
  const text = (row) => { const out = []; walk(row, (n) => { for (const c of n.children ?? []) if (typeof c === "string") out.push(c); }); return out.join(" "); };
  const dirty = rows.find((row) => /uncommitted file/.test(text(row)));
  assert.ok(dirty, "the uncommitted changes' row");
  const box = graphBox(dirty);
  assert.equal(widthOf(box), h.lanesWidth(), "as wide as the commits' graph boxes");
  // Its ring (9 px) is centered on the first lane, where the commits' first dots are (graph.js xOf(0)).
  const ring = box.children.find((c) => c?.$)?.$;
  const left = ring.calls.findLast(([m]) => m === "left")?.[1][0];
  assert.equal(left + 4.5, LANE, `the ring's center on the first lane: left ${left}`);
  assert.deepEqual(state.violations, []);
});
