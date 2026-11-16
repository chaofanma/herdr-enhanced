// Long lines: wrapped (the default) with each row as tall as its lines, or scrolled sideways with the
// line numbers and the @@ rows' buttons staying put (the wheel, the bar's thumb and its track).
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, byId, lists, renderRows, handler, press, texts, walk, settle, makeCx, load } from "./render/load.mjs";

const { KEY } = await load("id.js");
const { codeWidth, colsFor } = await load("wrap.js");
const LONG = `export const LONG = "a very long line ${"that keeps going and going ".repeat(10)}";`;
const base = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
const ROWS = 229;
const calls = (n, name) => (n?.$ ?? n)?.calls.filter(([p]) => p === name).map(([, a]) => a) ?? [];
const all = (tree, pred) => { const out = []; walk(tree, (n) => { if (pred(n)) out.push(n); }); return out; };
const diffList = (tree) => lists(tree).find((l) => l.listId === "changes-diff");

async function setup() {
  const r = repo(({ write, git }) => { write("app.js", base.join("\n") + "\n"); write("other.js", "x\n"); git("add", "-A"); git("commit", "-qm", "one"); });
  const edited = [...base];
  edited[1] = "line 2 changed"; edited[20] = LONG; edited[21] = "\tconst 한글 = '전각글자가이어지는줄' + 'more text here to make it long enough';"; edited[38] = "line 39 changed";
  r.write("app.js", edited.join("\n") + "\n"); r.write("other.js", "y\n");
  state.shared.delete(KEY.lines);
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  if (page.open?.path !== "app.js") { page.pick("app.js", "unstaged", makeCx()); await settle(); }
  let tree = await draw(view);
  handler(byId(tree, "changes-diff-rows"), "on_size_change")({ width: ROWS, height: 500 }, makeCx());
  tree = await draw(view);
  return { r, view, page, tree };
}

test("Wrap (the default): nothing scrolls sideways; a long row is as tall as its lines; the @@ buttons at the right edge", async () => {
  const { r, view, page, tree } = await setup(), d = page.diff;
  assert.equal(d.wrapping(), true);
  assert.equal(byId(tree, "changes-diff-hbar"), null);
  const cols = colsFor(codeWidth(ROWS, d.gutter, false), d.fontSize * 0.62);
  const longRow = d.rows.findIndex((x) => x.text === LONG), longItem = d.items.findIndex((it) => it.kind === "row" && it.i === longRow);
  assert.ok(d.items[longItem].height >= Math.ceil(LONG.length / cols) * d.row);
  assert.deepEqual(d.sizes, d.items.map((it) => it.height));
  const rows = renderRows(diffList(tree));
  assert.deepEqual(state.violations, []);
  const lineEls = all(rows[longItem], (n) => n.calls.some(([p]) => p === "overflow_hidden") && n.calls.some(([p]) => p === "whitespace_nowrap"));
  assert.equal(lineEls.length, d.items[longItem].height / d.row);
  assert.equal(lineEls.map((n) => texts({ $: n }).join("")).join(""), LONG, "the text whole, in its lines");
  assert.equal(texts(rows[longItem]).filter((x) => x === String(d.rows[longRow].number)).length, 1, "the number once");
  // The CJK line takes two columns a character.
  const cjk = d.rows.findIndex((x) => x.text.includes("한글"));
  assert.ok(d.items.find((it) => it.kind === "row" && it.i === cjk).height > d.row);
  // The @@ row: one line, its buttons at the visible edge; a press on Stage stages the first hunk.
  const hunkItem = d.items.findIndex((it) => it.kind === "row" && d.rows[it.i].kind === "@");
  assert.equal(d.items[hunkItem].height, d.row);
  const g = d.buttons();
  const buttons = all(rows[hunkItem], (n) => n.calls.some(([p]) => p === "absolute"));
  assert.deepEqual(buttons.map((n) => calls({ $: n }, "right")[0][0]), [g.pad + g.width + g.gap, g.pad]);
  assert.deepEqual(buttons.map((n) => texts({ $: n })[0]), ["Stage", "Revert…"]);
  handler(byId(tree, "changes-diff-rows"), "on_mouse_down")({ local_position: { x: ROWS - (g.pad + g.width + g.gap) - g.width / 2, y: 4 } }, makeCx());
  handler(diffList(tree), "on_item_click")(d.items[hunkItem].key, makeCx());
  assert.equal(page.busy, "stageHunk");
  await settle();
  assert.match(r.git("diff", "--cached"), /\+line 2 changed/);
  // Wider: fewer lines; a bigger font: more.
  const heightOf = () => d.items.find((it) => it.kind === "row" && d.rows[it.i].text === LONG).height;
  const before = heightOf();
  handler(byId(await draw(view), "changes-diff-rows"), "on_size_change")({ width: 400, height: 500 }, makeCx());
  const wider = heightOf();
  assert.ok(wider < before);
  state.props = { palette: "theme", font_size: 16 };
  await draw(view);
  assert.ok(heightOf() / d.row > wider / Math.round(13 * 1.8));
  state.props = { palette: "theme" };
});

test("Scroll: one line a row; the wheel, the bar's thumb and track; the numbers and @@ buttons stay; another file starts at the left", async () => {
  const { r, view, page } = await setup(), d = page.diff;
  let tree = await draw(view);
  const btn = byId(tree, "lines-mode-wrap");
  assert.match(btn.handlers.tooltip[0][0], /wrap/i);
  press(btn);
  assert.equal(state.shared.get(KEY.lines), "scroll");
  tree = await draw(view);
  assert.equal(d.wrapping(), false);
  assert.ok(d.items.every((it) => it.height === d.row));
  assert.equal(byId(tree, "lines-mode-wrap"), null, "a new element after the click: its tooltip is new");
  assert.match(byId(tree, "lines-mode-scroll").handlers.tooltip[0][0], /scroll sideways · click to wrap/);
  const max = d.maxX();
  assert.ok(max > 1000); assert.ok(byId(tree, "changes-diff-hbar"));
  const wheel = handler(byId(tree, "changes-diff-area"), "on_scroll_wheel");
  wheel({ delta: { x: -120, y: 4 }, modifiers: {} }, makeCx()); assert.equal(d.scrollX, 120);
  wheel({ delta: { x: 0, y: -50 }, modifiers: {} }, makeCx()); assert.equal(d.scrollX, 120, "vertical: the list's");
  wheel({ delta: { x: 0, y: -50 }, modifiers: { shift: true } }, makeCx()); assert.equal(d.scrollX, 170, "shift: sideways");
  wheel({ delta: { x: 99999, y: 0 }, modifiers: {} }, makeCx()); assert.equal(d.scrollX, 0);
  wheel({ delta: { x: -99999, y: 0 }, modifiers: {} }, makeCx()); assert.equal(d.scrollX, max);
  wheel({ delta: { x: 99999, y: 0 }, modifiers: {} }, makeCx()); wheel({ delta: { x: -200, y: 0 }, modifiers: {} }, makeCx());
  tree = await draw(view);
  const rows = renderRows(diffList(tree));
  assert.deepEqual(state.violations, []);
  const longItem = d.items.findIndex((it) => it.kind === "row" && d.rows[it.i].text === LONG);
  const shifted = all(rows[longItem], (n) => n.calls.some(([p, a]) => p === "left" && a[0] === -200));
  assert.equal(shifted.length, 1); assert.equal(texts({ $: shifted[0] }).join(""), LONG);
  const hunkItem = d.items.findIndex((it) => it.kind === "row" && d.rows[it.i].kind === "@"), g = d.buttons();
  assert.deepEqual(all(rows[hunkItem], (n) => n.calls.some(([p]) => p === "absolute")).map((n) => calls({ $: n }, "right")[0][0]), [g.pad + g.width + g.gap, g.pad]);
  assert.equal(all(rows[hunkItem], (n) => n.calls.some(([p]) => p === "left")).length, 0, "the @@ row doesn't scroll");
  handler(byId(tree, "changes-diff-rows"), "on_mouse_down")({ local_position: { x: ROWS - (g.pad + g.width + g.gap) - g.width / 2, y: 4 } }, makeCx());
  handler(diffList(tree), "on_item_click")(d.items[hunkItem].key, makeCx());
  assert.equal(page.busy, "stageHunk", "Stage is hit while scrolled");
  await settle();
  r.git("reset", "-q"); page.refresh(makeCx("async")); await settle();
  tree = await draw(view);
  // The bar: a drag on the thumb follows the pointer; a press beside it pages; leaving ends a drag.
  let hg = d.bar();
  assert.equal(hg.left, 2 + d.gutter + 16);
  const start = d.scrollX;
  handler(byId(tree, "changes-diff-htrack"), "on_mouse_down")({ local_position: { x: hg.thumb.start + 2, y: 3 }, position: { x: 500, y: 800 } }, makeCx());
  assert.ok(d.drag);
  tree = await draw(view);
  handler(byId(tree, "changes"), "on_mouse_move")({ position: { x: 530, y: 800 } }, makeCx());
  assert.ok(Math.abs(d.scrollX - Math.min(max, start + (30 * hg.max) / (hg.track - hg.thumb.size))) < 1e-6);
  handler(byId(tree, "changes"), "on_mouse_up")({ position: { x: 530, y: 800 } }, makeCx());
  assert.equal(d.drag, null);
  tree = await draw(view);
  assert.equal(byId(tree, "changes").handlers.on_mouse_move, undefined, "no move handler after the drag");
  hg = d.bar(); const at = d.scrollX;
  handler(byId(tree, "changes-diff-htrack"), "on_mouse_down")({ local_position: { x: hg.track - 1, y: 3 }, position: { x: 900, y: 800 } }, makeCx());
  assert.equal(d.scrollX, Math.min(max, at + hg.visible), "paged");
  hg = d.bar(); tree = await draw(view);
  handler(byId(tree, "changes-diff-htrack"), "on_mouse_down")({ local_position: { x: hg.thumb.start + 1, y: 3 }, position: { x: 500, y: 800 } }, makeCx());
  tree = await draw(view);
  handler(byId(tree, "changes"), "on_hover")(false, makeCx());
  assert.equal(d.drag, null);
  assert.ok(d.scrollX > 0);
  page.pick("other.js", "unstaged", makeCx()); await settle();
  assert.equal(d.scrollX, 0, "another file starts at the left");
  assert.equal(byId(await draw(view), "changes-diff-hbar"), null, "no bar when everything fits");
  state.shared.delete(KEY.lines);
  assert.deepEqual(state.violations, []);
});

test("a tab inside a diff line: spaces to the next multiple of four columns (tab-aligned columns stay aligned); the row keeps git's text", async () => {
  const { rowsOf } = await load("diffpane.js");
  const rows = rowsOf(["@@ -1,2 +1,2 @@", " #define A\t1", "-#define BB\t2", "+#define BBB\t2", "+\tindented"], "c");
  const shown = rows.slice(1).map((r) => r.spans.map((sp) => sp.text).join(""));
  assert.deepEqual(shown, ["#define A   1", "#define BB  2", "#define BBB 2", "    indented"]);
  assert.deepEqual(rows.slice(1).map((r) => r.cols), [13, 13, 13, 12]);
  assert.equal(rows[2].text, "#define BB\t2", "the row's own text is git's (staging and comments use it)");
});

test("a hunk's header: a tab in the function git names after @@ is drawn as spaces too", async () => {
  // Git names the nearest line above the hunk that starts with a letter: here "int\tmain(void)".
  const r = repo(({ write, git }) => { write("m.c", "int\tmain(void)\n{\n  a;\n  b;\n  c;\n  d;\n}\n"); git("add", "-A"); git("commit", "-qm", "one"); });
  r.write("m.c", "int\tmain(void)\n{\n  a;\n  b;\n  c;\n  e;\n}\n");
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  if (page.open?.path !== "m.c") { page.pick("m.c", "unstaged", makeCx()); await settle(); }
  let tree = await draw(view);
  handler(byId(tree, "changes-diff-rows"), "on_size_change")({ width: 600, height: 500 }, makeCx());
  tree = await draw(view);
  const d = page.diff, hunk = d.rows.findIndex((x) => x.kind === "@");
  assert.equal(d.rows[hunk].text, "@@ -3,5 +3,5 @@ int\tmain(void)", "the row keeps git's header (staging reads it)");
  const rows = renderRows(diffList(tree)), item = d.items.findIndex((it) => it.kind === "row" && it.i === hunk);
  const drawn = texts(rows[item]);
  assert.ok(drawn.includes("@@ -3,5 +3,5 @@ int main(void)"), JSON.stringify(drawn));
  assert.ok(!drawn.some((x) => x.includes("\t")), "no tab drawn");
  assert.deepEqual(state.violations, []);
  await view.close(makeCx("async"));
});
