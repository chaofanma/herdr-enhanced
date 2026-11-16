// History's columns: in one-line rows the author and the date have widths of their own, and two lines
// over the list resize them: between the subject and the author, and between the author and the date.
// The list's rows can't have handlers, so the lines are 7 px strips laid over the list, measured from
// its right edge; each shows (a 1 px rule) only while the pointer is over it or it is dragged. The
// widths are kept per place (the panel's, the tab's) in the page's split key; a double-click on a line
// gives the defaults back. A wider date column shows the date and time, then also how long ago.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { state, mount, draw, byId, lists, renderRows, handler, walk, settle, makeCx, load, stubs } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const { KEY } = await load("id.js");
const { ROW, COLS, columns, colsRoom, oneLine, dateText } = await load("historylayout.js");
const { when } = await load("gitlog.js");
const SPLIT = KEY.historySplit;

const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
function setup() {
  const base = tempDir("git-enhanced-hcols-"), A = join(base, "a");
  sh(base, "init", "-q", "-b", "main", "a");
  sh(A, "config", "user.name", "Tess Ogilvie-Marchetti"); sh(A, "config", "user.email", "tess@x"); sh(A, "config", "core.hooksPath", "/dev/null");
  writeFileSync(join(A, "f.txt"), "1\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "First");
  writeFileSync(join(A, "f.txt"), "2\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "Second");
  return { base, A };
}
const arg = (n, m) => n?.calls.find(([k]) => k === m)?.[1][0];
// What a `hover` style declares: its calls, as "bg(#…)".
function hoverOf(n) {
  const fn = n?.calls.find(([k]) => k === "hover")?.[1][0], calls = [];
  if (!fn) return null;
  const p = new Proxy({}, { get: (_t, m) => (...a) => { calls.push(`${String(m)}(${a.join(",")})`); return p; } });
  fn(p);
  return calls;
}
// The first commit row's author and date cells (the cells whose text is the author, or the date).
function cells(tree, h) {
  const list = lists(tree).find((l) => l.listId === "history-commits"), row = renderRows(list, { start: 0, end: 1 })[0];
  const c = h.commits[0];
  let author = null, date = null;
  walk(row, (n) => { const kids = n.children ?? []; if (kids.includes(c.author)) author ??= n; else if (kids.some((k) => typeof k === "string" && (k === dateText(c.time, ROW.date) || k.startsWith(when(c.time))))) date ??= n; });
  return { author: arg(author, "w"), date: arg(date, "w"), dateText: date?.children?.find((k) => typeof k === "string") };
}
// A drag of element `id` from x `from` to x `to` (the page takes the move and the release).
async function drag(view, id, from, to, { end = "up", event = {} } = {}) {
  let tree = await draw(view);
  handler(byId(tree, id), "on_mouse_down")({ position: { x: from, y: 100 }, button: "left", click_count: 1, ...event }, makeCx());
  tree = await draw(view);
  const page = byId(tree, "history"), move = handler(page, "on_mouse_move");
  if (move) move({ position: { x: to, y: 100 } }, makeCx());
  tree = await draw(view);
  if (end === "up") handler(byId(tree, "history"), "on_mouse_up")?.({ position: { x: to, y: 100 }, button: "left" }, makeCx());
  else handler(byId(tree, "history"), "on_hover")?.(false, makeCx());
  return draw(view);
}

test("historylayout: the columns fit the list, a narrower one keeps the rows one line, and the date says more when wider", () => {
  const lanes = 11;
  assert.deepEqual(columns(null, 800, lanes), { author: ROW.author, date: ROW.date }, "nothing kept: the defaults");
  assert.deepEqual(columns({ author: "x", date: -5 }, 800, lanes), { author: ROW.author, date: ROW.date }, "nonsense: the defaults");
  assert.deepEqual(columns({ author: 10, date: 3 }, 800, lanes), { author: COLS.author, date: COLS.date }, "never under their least");
  assert.deepEqual(columns({ author: 300, date: 120 }, 1400, lanes), { author: 300, date: 120 }, "room enough: as kept");
  // Too wide for the list: what is over the defaults gives way, in proportion, to the room there is.
  const fit = columns({ author: 300, date: 120 }, 600, lanes);
  assert.equal(fit.author + fit.date, colsRoom(600, lanes));
  assert.deepEqual(fit, { author: 239, date: 94 });
  // One line from 443 px with the defaults (lanes 11); a narrower author, from 373; a wider one: 443.
  assert.equal(oneLine(442, lanes), false);
  assert.equal(oneLine(443, lanes), true);
  assert.equal(oneLine(373, lanes, { author: 60 }), true);
  assert.equal(oneLine(372, lanes, { author: 60 }), false);
  assert.equal(oneLine(443, lanes, { author: 400, date: 200 }), true, "wider never takes it to two lines");
  const now = 1_800_000_000, t = now - 2 * 86400;
  assert.equal(dateText(t, ROW.date, now), "2 d");
  assert.equal(dateText(t, COLS.full - 1, now), "2 d");
  assert.equal(dateText(t, COLS.full, now), when(t));
  assert.equal(dateText(t, COLS.both, now), `${when(t)} · 2 d`);
});

test("History: two lines over the list resize the author and the date, kept for the panel; a double-click gives the defaults back", async () => {
  const { A } = setup();
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  h.size = { width: 600, height: 900 };
  let tree = await draw(view);
  const lanes = h.lanesWidth(), room = colsRoom(598, lanes);
  let a = byId(tree, "history-col-author"), d = byId(tree, "history-col-date");
  assert.ok(a && d, "both lines are there");
  assert.deepEqual([arg(a, "right"), arg(d, "right")], [13 + ROW.date + ROW.author, 7 + ROW.date], "in the middle of their gaps");
  assert.ok(a.calls.some(([k]) => k === "cursor_col_resize"));
  // As the page's other lines: under the pointer the whole strip in `hover` (and its rule, below).
  const t = stubs.theme();
  assert.deepEqual([hoverOf(a), hoverOf(d)], [[`bg(${t.hover})`], [`bg(${t.hover})`]]);
  assert.equal(arg(a, "bg"), undefined, "no background of its own until then");
  assert.deepEqual(cells(tree, h), { author: ROW.author, date: ROW.date, dateText: dateText(h.commits[0].time, ROW.date) });
  // Unseen until the pointer is over one.
  assert.equal((a.children ?? []).length, 0);
  handler(a, "on_hover")(true, makeCx());
  tree = await draw(view);
  assert.equal(byId(tree, "history-col-author").children.length, 1, "its rule shows");
  assert.equal((byId(tree, "history-col-date").children ?? []).length, 0, "the other stays unseen");
  handler(byId(tree, "history-col-author"), "on_hover")(false, makeCx());
  tree = await draw(view);
  assert.equal((byId(tree, "history-col-author").children ?? []).length, 0);
  // While it is dragged the strip stays in `hover` and its rule is `accent`.
  handler(byId(await draw(view), "history-col-author"), "on_mouse_down")({ position: { x: 400, y: 100 }, button: "left", click_count: 1 }, makeCx());
  tree = await draw(view);
  a = byId(tree, "history-col-author");
  assert.equal(arg(a, "bg"), t.hover);
  assert.equal(arg(a.children[0].$ ?? a.children[0], "bg"), t.accent);
  handler(byId(tree, "history"), "on_mouse_up")({ position: { x: 400, y: 100 }, button: "left" }, makeCx());
  tree = await draw(view);
  assert.equal(arg(byId(tree, "history-col-author"), "bg"), undefined, "released: no background");
  // The subject's line 50 px left: the author 50 px wider, the date as it was; kept on release.
  tree = await drag(view, "history-col-author", 400, 350);
  assert.deepEqual(cells(tree, h).author, ROW.author + 50);
  assert.deepEqual(state.shared.get(SPLIT), { "panel-author": ROW.author + 50, "panel-date": ROW.date });
  assert.equal(arg(byId(tree, "history-col-author"), "right"), 13 + ROW.date + ROW.author + 50, "the line moved with it");
  // The date's line 60 px left: the date 60 px wider, the author 60 px narrower (the other line stays);
  // over 100 px the date shows the date and time.
  tree = await drag(view, "history-col-date", 500, 440);
  let c = cells(tree, h);
  assert.deepEqual([c.author, c.date], [ROW.author + 50 - 60, ROW.date + 60]);
  assert.equal(c.dateText, when(h.commits[0].time));
  assert.equal(arg(byId(tree, "history-col-author"), "right"), 13 + ROW.date + ROW.author + 50, "the subject's line stayed");
  // As far left as it goes: the subject keeps its least.
  tree = await drag(view, "history-col-author", 400, -2000);
  c = cells(tree, h);
  assert.equal(c.author, room - c.date);
  // The date's line can't take the author under its least.
  tree = await drag(view, "history-col-date", 500, -2000);
  c = cells(tree, h);
  assert.equal(c.author, COLS.author);
  // Leaving the page ends a drag too, and keeps it.
  tree = await drag(view, "history-col-date", 500, 2000, { end: "leave" });
  c = cells(tree, h);
  assert.equal(c.date, COLS.date);
  assert.equal(state.shared.get(SPLIT)["panel-date"], COLS.date);
  assert.equal(handler(byId(tree, "history"), "on_mouse_move"), undefined, "no drag left");
  // A double-click: the defaults.
  handler(byId(tree, "history-col-date"), "on_mouse_down")({ position: { x: 300, y: 100 }, button: "left", click_count: 2 }, makeCx());
  tree = await draw(view);
  assert.deepEqual(state.shared.get(SPLIT), {});
  assert.deepEqual([cells(tree, h).author, cells(tree, h).date], [ROW.author, ROW.date]);
  assert.deepEqual(state.violations, []);
});

test("History: the tab keeps widths of its own; two-line rows have no lines; a narrower author keeps a narrower list's rows one line", async () => {
  const { base, A } = setup();
  state.shared.set(SPLIT, { "panel-author": 70, "panel-date": 120 });
  // The tab: its own widths (none kept: the defaults).
  const tab = await mount(base, { palette: "theme", view: "history", root: A, on: null }), th = tab.part.history;
  th.size = { width: 1400, height: 900 };
  let tree = await draw(tab);
  assert.equal(arg(byId(tree, "history-col-date"), "right"), 7 + ROW.date);
  tree = await drag(tab, "history-col-author", 600, 560);
  assert.equal(state.shared.get(SPLIT)["tab-author"], ROW.author + 40);
  assert.equal(state.shared.get(SPLIT)["panel-author"], 70, "the panel's stays");
  // The panel at 420 px: two lines with the defaults, one line with its 70 px author.
  const panel = await mount(A, { palette: "theme", view: "history" }), ph = panel.part.history;
  ph.size = { width: 420, height: 900 };
  tree = await draw(panel);
  assert.ok(byId(tree, "history-col-author"), "one line: the lines are there");
  const fit = columns({ author: 70, date: 120 }, 418, ph.lanesWidth());
  assert.deepEqual([cells(tree, ph).author, cells(tree, ph).date], [fit.author, fit.date], "the date gives way to the room there is");
  state.shared.set(SPLIT, {});
  tree = await draw(panel);
  assert.equal(byId(tree, "history-col-author"), null, "two lines: no lines over the list");
  assert.equal(byId(tree, "history-col-date"), null);
  assert.deepEqual(state.violations, []);
});
