// The History page's commit side (history.js, historylayout.js): its information in two parts of
// their own heights, the message (its body folded under "Show full message") over the files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { state, mount, overlay, drawWith, draw, byId, lists, renderRows, handler, walk, texts, settle, makeCx, load, at } from "./render/load.mjs";
import { NAME } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";

const { KEY } = await load("id.js");
const { MIN, MESSAGE_MIN, infoParts, filesHeight } = await load("historylayout.js");

const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
// A repository with a small commit, then a big one: a long body and 40 files.
function setup() {
  const base = tempDir("git-enhanced-hlayout-"), A = join(base, "a");
  sh(base, "init", "-q", "-b", "main", "a");
  sh(A, "config", "user.name", "Tess"); sh(A, "config", "user.email", "tess@x"); sh(A, "config", "core.hooksPath", "/dev/null");
  writeFileSync(join(A, "f.txt"), "1\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "Small");
  mkdirSync(join(A, "src"));
  for (let i = 0; i < 40; i++) writeFileSync(join(A, "src", `file${String(i).padStart(2, "0")}.js`), `export const n = ${i};\n`);
  sh(A, "add", "-A"); sh(A, "commit", "-qm", "Big change", "-m", BODY.join("\n"));
  return { base, A };
}
const BODY = Array.from({ length: 30 }, (_, i) => `Body line ${i + 1}: why this changed.`);
const has = (n, m) => n.calls.some(([k]) => k === m);
const arg = (n, m) => n.calls.find(([k]) => k === m)?.[1][0];
// Every element under `node` (not itself) that scrolls.
const scrollers = (node) => { const out = []; for (const c of node.children ?? []) walk(c, (n) => { if (n.calls.some(([k]) => /^overflow_.*scroll/.test(k))) out.push(n.id ?? n.kind); }); return out; };
async function pick(view, subject) {
  const h = view.part.history, tree = await draw(view);
  handler(lists(tree).find((l) => l.listId === "history-commits"), "on_item_click")(h.commits.find((c) => c.subject === subject).hash, makeCx());
  await settle();
  return draw(view);
}

test("History: the commit's information in two parts of their own heights: the message, folded, scrolls; under it the files, their count row first, as tall as their rows, half the area at most", async () => {
  const { base, A } = setup();
  // The panel (stacked): the information gets 40% of the commit's height.
  const view = await mount(A, { palette: "theme", view: "history" });
  view.part.history.size = { width: 480, height: 900 };
  let tree = await pick(view, "Big change");
  const listH = arg(byId(tree, "history-list-area"), "h"), commitH = 900 - 80 - listH - 7, infoH = Math.round(commitH * 0.4);
  assert.equal(arg(byId(tree, "history-info"), "h"), infoH, "a height of its own");
  let text = byId(tree, "history-info-text"), files = byId(tree, "history-files");
  const parts = infoParts(infoH, 40);
  assert.deepEqual([arg(text, "h"), arg(files, "h")], [parts.message, parts.files]);
  assert.equal(parts.files, Math.round(infoH / 2), "forty files: half the area");
  // The message's part scrolls; the files' part holds the count row and the files' own list, which
  // scrolls (a virtual list: only the rows on screen are built).
  assert.ok(has(text, "flex_none") && has(text, "overflow_y_scrollbar"), "history-info-text: it scrolls");
  assert.deepEqual(scrollers(text), [], "history-info-text: nothing in it scrolls by itself");
  assert.ok(has(files, "flex_none") && !has(files, "overflow_y_scrollbar"), "history-files: its list scrolls, not the part");
  for (const part of [text, files]) assert.ok(!has(part, "max_h"), `${part.id}: not sized by max_h`);
  // The message, folded: the subject, the toggle, the people; the files are in their own part.
  let words = texts(text);
  assert.ok(words.includes("Big change") && words.includes("Show full message"), words.join(" | "));
  assert.ok(!words.some((w) => w.startsWith("Body line")), "the body is folded");
  assert.ok(!words.includes("40 files"), "no files in the message");
  const fw = texts(files);
  assert.equal(fw[0], "40 files", "the count row first");
  const fl = lists(tree).find((l) => l.listId === "history-files-list");
  assert.equal(fl?.count, 40, "all 40 files, in a list of their own");
  const rw = renderRows(fl).flatMap((row) => texts(row));
  assert.ok(rw.indexOf("file00.js") >= 0 && rw.indexOf("file39.js") > rw.indexOf("file00.js"), rw.slice(0, 6).join(" | "));
  // Show full message: the body in the message's part, then Hide; the files keep theirs.
  handler(byId(tree, "history-body-toggle"), "on_click")({}, makeCx());
  tree = await draw(view);
  text = byId(tree, "history-info-text");
  words = texts(text);
  assert.ok(words.includes("Hide full message"));
  assert.deepEqual(BODY.filter((l) => words.includes(l)), BODY, "the whole body");
  assert.deepEqual(scrollers(text), [], "the body doesn't scroll by itself");
  assert.ok(!has(byId(tree, "history-body"), "max_h"));
  assert.equal(arg(byId(tree, "history-files"), "h"), parts.files);
  handler(byId(tree, "history-body-toggle"), "on_click")({}, makeCx());
  tree = await draw(view);
  assert.ok(texts(byId(tree, "history-info-text")).includes("Show full message"));
  // A commit of one file: its files' part as tall as its rows, the message the rest; no toggle
  // without a body; the next commit starts folded.
  handler(byId(tree, "history-body-toggle"), "on_click")({}, makeCx());
  tree = await pick(view, "Small");
  assert.equal(byId(tree, "history-body-toggle"), null);
  assert.deepEqual([arg(byId(tree, "history-info-text"), "h"), arg(byId(tree, "history-files"), "h")], [infoH - filesHeight(1), filesHeight(1)]);
  tree = await pick(view, "Big change");
  assert.ok(texts(byId(tree, "history-info-text")).includes("Show full message"), "folded again");
  // The tab (side by side): 40% of the body's height; a short page: the information keeps its least,
  // the message's 44 px over the count row and a file.
  const wide = await mount(base, { palette: "theme", view: "history", root: A, on: null });
  wide.part.history.size = { width: 1400, height: 900 };
  tree = await pick(wide, "Big change");
  assert.equal(arg(byId(tree, "history-info"), "h"), Math.round((900 - 80) * 0.4));
  wide.part.history.size = { width: 1400, height: 230 };
  tree = await draw(wide);
  assert.equal(arg(byId(tree, "history-info"), "h"), MIN.info);
  assert.deepEqual([arg(byId(tree, "history-info-text"), "h"), arg(byId(tree, "history-files"), "h")], [MESSAGE_MIN, filesHeight(1)]);
  assert.deepEqual(state.violations, []);
});

test("History: the line between the commit's information and its diff drags, in both arrangements, kept apart", async () => {
  const { base, A } = setup();
  const SPLIT = KEY.historySplit;
  state.shared.delete(SPLIT);
  const drag = async (v, id, from, to, end = "up") => {
    let tr = await draw(v);
    handler(byId(tr, id), "on_mouse_down")({ position: from, button: "left" }, makeCx());
    tr = await draw(v);
    handler(byId(tr, "history"), "on_mouse_move")({ position: to }, makeCx());
    tr = await draw(v);
    if (end === "up") handler(byId(tr, "history"), "on_mouse_up")({ position: to, button: "left" }, makeCx());
    else handler(byId(tr, "history"), "on_hover")(false, makeCx());
    return draw(v);
  };
  const panel = await mount(A, { palette: "theme", view: "history" });
  panel.part.history.size = { width: 480, height: 900 };
  let tree = await pick(panel, "Big change");
  const line = byId(tree, "history-info-line");
  assert.ok(line && has(line, "cursor_row_resize") && arg(line, "h") === 7, "a 7 px strip, up and down");
  const info0 = arg(byId(tree, "history-info"), "h"), list0 = arg(byId(tree, "history-list-area"), "h"), commit0 = 900 - 80 - list0 - 7;
  // Press, move 50 px down, let go: the information grows by 50, kept as panel-v-info.
  handler(line, "on_mouse_down")({ position: { x: 100, y: 500 }, button: "left" }, makeCx());
  tree = await draw(panel);
  handler(byId(tree, "history"), "on_mouse_move")({ position: { x: 100, y: 550 } }, makeCx());
  tree = await draw(panel);
  assert.equal(arg(byId(tree, "history-info"), "h"), info0 + 50, "follows the pointer");
  assert.equal(arg(byId(tree, "history-list-area"), "h"), list0, "the commits stay");
  assert.equal(state.shared.get(SPLIT), undefined, "kept only when the press ends");
  handler(byId(tree, "history"), "on_mouse_up")({ position: { x: 100, y: 550 }, button: "left" }, makeCx());
  assert.deepEqual(state.shared.get(SPLIT), { "panel-v-info": info0 + 50 });
  tree = await draw(panel);
  assert.equal(arg(byId(tree, "history-info"), "h"), info0 + 50, "the kept size is used");
  assert.equal(handler(byId(tree, "history"), "on_mouse_move"), undefined, "no move handler once the press ended");
  tree = await pick(panel, "Small");
  assert.equal(arg(byId(tree, "history-info"), "h"), info0 + 50, "another commit: the same");
  // The limits: up far, its least; down far, the diff keeps 120 (here leaving the page ends the drag).
  tree = await drag(panel, "history-info-line", { x: 100, y: 500 }, { x: 100, y: -5000 });
  assert.equal(arg(byId(tree, "history-info"), "h"), MIN.info);
  tree = await drag(panel, "history-info-line", { x: 100, y: 500 }, { x: 100, y: 5000 }, "leave");
  assert.equal(arg(byId(tree, "history-info"), "h"), commit0 - 7 - 120, "the diff keeps 120 px");
  assert.equal(state.shared.get(SPLIT)["panel-v-info"], commit0 - 7 - 120, "leaving the page ends the drag");
  assert.equal(handler(byId(tree, "history"), "on_mouse_move"), undefined);
  // The commits' line still works, under its own key.
  tree = await drag(panel, "history-split-line", { x: 100, y: 300 }, { x: 100, y: 260 });
  assert.equal(arg(byId(tree, "history-list-area"), "h"), list0 - 40);
  assert.deepEqual(state.shared.get(SPLIT), { "panel-v-info": commit0 - 7 - 120, "panel-v": list0 - 40 });
  assert.equal(arg(byId(tree, "history-info"), "h"), commit0 - 7 - 120, "the information keeps its height");
  // The tab (side by side): up and down too, kept as tab-h-info, apart from the panel's.
  const tabView = await mount(base, { palette: "theme", view: "history", root: A, on: null });
  tabView.part.history.size = { width: 1400, height: 900 };
  tree = await pick(tabView, "Big change");
  const t0 = arg(byId(tree, "history-info"), "h");
  assert.equal(t0, Math.round(820 * 0.4));
  assert.ok(has(byId(tree, "history-info-line"), "cursor_row_resize"));
  tree = await drag(tabView, "history-info-line", { x: 900, y: 400 }, { x: 900, y: 300 });
  assert.equal(arg(byId(tree, "history-info"), "h"), t0 - 100);
  assert.equal(state.shared.get(SPLIT)["tab-h-info"], t0 - 100);
  assert.equal(state.shared.get(SPLIT)["panel-v-info"], commit0 - 7 - 120, "the panel's stays");
  // The keys from before keep working: tab-h, panel-h, panel-v.
  state.shared.set(SPLIT, { "tab-h": 405, "panel-h": 500, "panel-v": 300 });
  tree = await draw(tabView);
  assert.equal(arg(byId(tree, "history-list-area"), "w"), 405);
  tree = await draw(panel);
  assert.equal(arg(byId(tree, "history-list-area"), "h"), 300);
  panel.part.history.size = { width: 900, height: 900 };
  tree = await draw(panel);
  assert.equal(arg(byId(tree, "history-list-area"), "w"), 500, "a wide panel, side by side");
  state.shared.delete(SPLIT);
  assert.deepEqual(state.violations, []);
});

test("History: side by side or stacked, by the width or by hand, for every copy; the menu marks the one in use", async () => {
  const { base, A } = setup();
  const SPLIT = KEY.historySplit, LAYOUT = KEY.historyLayout;
  state.shared.delete(SPLIT); state.shared.delete(LAYOUT);
  const header = (tr) => byId(tr, "history").children.find((c) => c?.$?.children?.some((x) => texts(x).includes("History")))?.$;
  // The top row's ids in order, its icon buttons' row (no id of its own: the one with the gear) read through.
  const gearRow = (c) => c?.$?.children?.some((x) => /^history-settings-/.test(String(x?.$?.id)));
  const ids = (tr) => header(tr).children.flatMap((c) => (c?.$?.id ? [c.$.id] : gearRow(c) ? c.$.children.map((x) => x?.$?.id) : [])).filter(Boolean);
  const icon = (n) => { let p = null; walk({ $: n }, (x) => { if (x.kind === "svg") p ??= x.path; }); return p; };
  const tip = (n) => n.handlers.tooltip?.at(-1)?.[0];
  const arranged = (tr) => (has(byId(tr, "history-split-line"), "cursor_col_resize") ? "side" : "stacked");
  const panelProps = { palette: "theme", view: "history" }, tabProps = { palette: "theme", view: "history", root: A, on: null };
  const usePanel = () => { state.props = panelProps; at(A); };
  const small = await mount(A, panelProps);
  small.part.history.size = { width: 480, height: 900 };
  let tree = await pick(small, "Big change");
  let b = byId(tree, "history-layout-auto-stacked");
  assert.ok(b, ids(tree).join(" "));
  assert.equal(tip(b), "Layout: Automatic (stacked)");
  assert.equal(icon(b), `mods/${NAME}/layout-stacked.svg`);
  assert.ok(!ids(tree).some((i) => i.startsWith("history-layout-")), `with the commit, not in the top row: ${ids(tree).join(" ")}`);
  assert.equal(arranged(tree), "stacked");
  const big = await mount(base, tabProps);
  big.part.history.size = { width: 1400, height: 900 };
  tree = await pick(big, "Big change");
  b = byId(tree, "history-layout-auto-side");
  assert.equal(tip(b), "Layout: Automatic (side by side)");
  assert.equal(icon(b), `mods/${NAME}/layout-side.svg`);
  assert.ok(!ids(tree).some((i) => /^history-layout-(auto|side|stacked)/.test(i)), `with the commit, not in the top row: ${ids(tree).join(" ")}`);
  assert.equal(arranged(tree), "side");
  // A click: a menu at the pointer (a popup without `at`), the setting in use checked.
  const choose = async (tr, item) => {
    const before = state.overlays.length;
    handler(byId(tr, /^history-layout-(auto|side|stacked)/), "on_click")({}, makeCx());
    await settle();
    assert.equal(state.overlays.length, before + 1, "a menu opened");
    const o = state.overlays.at(-1), q = o.props.question;
    assert.equal(o.kind, "popup"); assert.equal(o.at, undefined); assert.ok(q.menu);
    const m = overlay(o), mt = drawWith(m.view, m.props);
    assert.ok(!mt.$.calls.some(([k]) => /^overflow_.*scroll/.test(k)), "the menu's root doesn't scroll");
    const checks = q.items.map((i) => { let hit = false; walk({ $: byId(mt, `menu-${i.id}`) }, (x) => { if (x.kind === "svg" && /check\.svg$/.test(x.path)) hit = true; }); return hit; });
    const keep = state.props;
    state.props = m.props;
    if (item) handler(byId(mt, `menu-${item}`), "on_click")({}, makeCx()); else m.view.part.cancel();
    state.props = keep;
    await settle();
    return { o, q, checks };
  };
  let m = await choose(tree, "stacked");
  assert.deepEqual(m.q.items.map((i) => [i.id, i.label, i.checked]), [["auto", "Automatic (by width)", true], ["side", "Side by side", false], ["stacked", "Stacked", false]]);
  assert.deepEqual(m.checks, [true, false, false], "a check on the one in use");
  assert.equal(m.o.height, 10 + 30 + 3 * 30, "as tall as its rows");
  assert.equal(state.shared.get(LAYOUT), "stacked");
  tree = await draw(big);
  assert.equal(arranged(tree), "stacked", "the tab: stacked though wide");
  b = byId(tree, "history-layout-stacked");
  assert.equal(tip(b), "Layout: Stacked"); assert.equal(icon(b), `mods/${NAME}/layout-stacked.svg`);
  // The menu again: Stacked checked; a cancel changes nothing.
  m = await choose(tree, null);
  assert.deepEqual(m.checks, [false, false, true]);
  assert.equal(state.shared.get(LAYOUT), "stacked");
  // Side by side: every copy, the narrow panel too (one key for all).
  m = await choose(tree, "side");
  assert.equal(state.shared.get(LAYOUT), "side");
  usePanel();
  tree = await draw(small);
  assert.equal(arranged(tree), "side", "the panel: side by side though narrow");
  assert.equal(tip(byId(tree, "history-layout-side")), "Layout: Side by side");
  assert.equal(arg(byId(tree, "history-list-area"), "w"), 260, "the commits' least width (the commit can't keep 320 here)");
  // Sizes stay per copy and direction.
  state.shared.set(SPLIT, { "panel-h": 300, "tab-h": 600, "tab-v": 250 });
  tree = await draw(small);
  assert.equal(arg(byId(tree, "history-list-area"), "w"), 260, "panel-h, kept within the limits");
  state.props = tabProps;
  tree = await draw(big);
  assert.equal(arg(byId(tree, "history-list-area"), "w"), 600, "tab-h");
  state.shared.set(LAYOUT, "stacked");
  tree = await draw(big);
  assert.equal(arg(byId(tree, "history-list-area"), "h"), 250, "tab-v");
  // Automatic again: by the width.
  m = await choose(tree, "auto");
  assert.equal(state.shared.get(LAYOUT), "auto");
  tree = await draw(big);
  assert.equal(arranged(tree), "side");
  assert.ok(byId(tree, "history-layout-auto-side"));
  state.shared.delete(SPLIT); state.shared.delete(LAYOUT);
  assert.deepEqual(state.violations, []);
});

test("History rows: one line or two by the list's own width; the refs' chips never draw over the author", async () => {
  const { base, A } = setup();
  // Refs on it: the current branch, another branch and a tag (their chips share the row with the subject).
  sh(A, "branch", "feature/sidebar"); sh(A, "tag", "release-2025-01-31");
  const SPLIT = KEY.historySplit, LAYOUT = KEY.historyLayout;
  state.shared.delete(SPLIT); state.shared.delete(LAYOUT);
  const parentOf = (node, pred) => { let hit = null; walk(node, (n) => { if (!hit && (n.children ?? []).some((c) => c?.$ && pred(c.$))) hit = n; }); return hit; };
  const nodeWith = (node, text) => { let hit = null; walk(node, (n) => { if (!hit && n.children?.includes(text)) hit = n; }); return hit; };
  const rowsOf = async (v) => {
    const tr = await draw(v);
    const list = lists(tr).find((l) => l.listId === "history-commits");
    const rows = renderRows(list);
    return { tr, H: list.sizes, row: rows[v.part.history.commits.findIndex((c) => c.subject === "Big change")] };
  };
  const check = ({ H, row }, lines, at) => {
    assert.equal(H, lines === 1 ? 26 : 40, `${at}: ${lines} line(s)`);
    const top = parentOf(row, (n) => n.children.includes("Big change"));
    assert.ok(has(top, "min_w") && has(top, "overflow_hidden"), `${at}: the refs' part clips`);
    for (const ref of ["main", "feature/sidebar", "◇ release-2025-01-31"]) {
      const c = nodeWith(row, ref);
      assert.ok(c && has(c, "flex_none"), `${at}: the ${ref} chip doesn't shrink`);
      assert.ok(top.children.some((x) => x?.$ === c), `${at}: the ${ref} chip is in the clipped part`);
    }
    const author = nodeWith(row, "Tess");
    if (lines === 1) {
      assert.ok(has(top, "flex_1"), `${at}: the refs' part takes what the columns leave`);
      assert.equal(arg(author, "w"), 130); assert.ok(has(author, "flex_none"));
      assert.ok(row.$.children.some((x) => x?.$ === author), `${at}: the author is a column of its own`);
    } else assert.ok(!row.$.children.some((x) => x?.$ === author), `${at}: the author on the second line`);
  };
  const rowsTab = await mount(base, { palette: "theme", view: "history", root: A, on: null });
  rowsTab.part.history.size = { width: 1400, height: 900 };
  let tree = await pick(rowsTab, "Big change");
  for (const [w, lines] of [[300, 2], [405, 2], [700, 1]]) {
    state.shared.set(SPLIT, { "tab-h": w });
    const r = await rowsOf(rowsTab);
    assert.equal(arg(byId(r.tr, "history-list-area"), "w"), w);
    check(r, lines, `side by side, the list ${w} px`);
  }
  // No commit picked: the same rows (the list's width beside a commit), so a pick doesn't change them.
  state.shared.set(SPLIT, { "tab-h": 405 });
  tree = await pick(rowsTab, "Big change");
  assert.equal(rowsTab.part.history.selected, null);
  check(await rowsOf(rowsTab), 2, "side by side, nothing picked");
  state.shared.set(SPLIT, { "tab-h": 700 });
  check(await rowsOf(rowsTab), 1, "side by side, nothing picked, 700 px");
  // Stacked: the page's width (less its 2 px border).
  state.shared.set(LAYOUT, "stacked");
  for (const [w, lines] of [[300, 2], [405, 2], [700, 1]]) {
    rowsTab.part.history.size = { width: w + 2, height: 900 };
    check(await rowsOf(rowsTab), lines, `stacked, the page ${w} px`);
  }
  state.shared.delete(SPLIT); state.shared.delete(LAYOUT);
  assert.deepEqual(state.violations, []);
});
