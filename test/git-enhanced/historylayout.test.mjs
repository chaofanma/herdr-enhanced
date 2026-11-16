import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { WIDE, LINE, MIN, ROW, between, sizes, oneLine, LAYOUTS, LAYOUT_NAMES, layoutOf, sideBySide, layoutTip, FILES, filesHeight, MESSAGE_MIN, infoParts } = await mod("historylayout.js");
const { KEY } = await mod("id.js");

test("between keeps a size within its limits, the lower one first", () => {
  assert.equal(between(50, 60, 100), 60);
  assert.equal(between(150, 60, 100), 100);
  assert.equal(between(70.4, 60, 100), 70);
  assert.equal(between(80, 60, 30), 60, "an upper limit under the lower one: the lower one");
  assert.equal(WIDE, 760); assert.equal(LINE, 7);
});

test("stacked: the commits 38% of the body, the commit's information 40% of what's left", () => {
  // The panel, 480 x 900: 820 px under the bars.
  const s = sizes({ width: 480, body: 820, side: false });
  assert.equal(s.listH, 312);
  assert.equal(s.commitH, 820 - 312 - LINE);
  assert.equal(s.infoH, Math.round(s.commitH * 0.4));
  assert.equal(s.infoMax, s.commitH - LINE - MIN.diff);
  // A small panel: the commits give the commit the room it needs, keeping 100.
  assert.equal(sizes({ width: 368, body: 360, side: false }).listH, 360 - LINE - (MIN.info + LINE + MIN.diff));
  assert.equal(sizes({ width: 368, body: 300, side: false }).listH, MIN.listH);
});

test("stacked, the commits dragged far down: the commit keeps its information's least (the message's 44 px, the count row and a file), the line and the diff's 120", () => {
  const s = sizes({ width: 480, body: 820, side: false, list: 5000 });
  assert.equal(s.listH, s.listMax);
  assert.equal(s.listMax, 820 - LINE - (MIN.info + LINE + MIN.diff));
  assert.equal(s.commitH, MIN.info + LINE + MIN.diff);
  assert.equal(s.infoH, MIN.info);
  assert.equal(s.commitH - s.infoH - LINE, MIN.diff);
  // Dragged up: at least 100.
  assert.equal(sizes({ width: 480, body: 820, side: false, list: 10 }).listH, MIN.listH);
});

test("side by side: the commits 42% of the width, the commit as tall as the body", () => {
  const s = sizes({ width: 1400, body: 820, side: true });
  assert.equal(s.listW, 588);
  assert.equal(s.commitH, 820);
  assert.equal(s.infoH, 328);
  assert.equal(s.infoMax, 820 - LINE - MIN.diff);
  assert.equal(sizes({ width: 900, body: 820, side: true }).listW, 380, "at least 380 by default");
  assert.equal(sizes({ width: 1400, body: 820, side: true, list: 405 }).listW, 405, "a kept width");
  assert.equal(sizes({ width: 1400, body: 820, side: true, list: 5000 }).listW, 1400 - MIN.commitW, "the commit keeps 320");
  assert.equal(sizes({ width: 1400, body: 820, side: true, list: 10 }).listW, MIN.listW);
  // A short page: the information keeps its least, the diff gets the rest.
  assert.equal(sizes({ width: 1400, body: 150, side: true }).infoH, MIN.info);
});

test("the information's kept height: used, kept between its least and what leaves the diff 120", () => {
  const page = { width: 480, body: 820, side: false };
  assert.equal(sizes({ ...page, info: 150 }).infoH, 150);
  assert.equal(sizes({ ...page, info: 10 }).infoH, MIN.info);
  const far = sizes({ ...page, info: 5000 });
  assert.equal(far.infoH, far.infoMax);
  assert.equal(far.commitH - far.infoH - LINE, MIN.diff);
  assert.equal(sizes({ ...page, info: null }).infoH, sizes(page).infoH, "none kept: 40%");
  // The commits dragged down later: a kept height that no longer fits gives way, the diff keeps 120.
  const squeezed = sizes({ ...page, list: 600, info: 300 });
  assert.equal(squeezed.infoH, squeezed.commitH - LINE - MIN.diff);
  // Side by side the commit is as tall as the body.
  assert.equal(sizes({ width: 1400, body: 820, side: true, info: 500 }).infoH, 500);
  assert.equal(sizes({ width: 1400, body: 820, side: true, info: 900 }).infoH, 820 - LINE - MIN.diff);
});

test("the arrangement: automatic by the page's width, or side by side, or stacked, for every copy", () => {
  assert.equal(KEY.historyLayout, "git-enhanced.historyLayout");
  assert.deepEqual(LAYOUTS, ["auto", "side", "stacked"]);
  for (const v of LAYOUTS) assert.equal(layoutOf(v), v);
  for (const v of [undefined, null, "", "Side", 3, {}]) assert.equal(layoutOf(v), "auto");
  assert.equal(sideBySide("auto", WIDE - 1), false);
  assert.equal(sideBySide("auto", WIDE), true);
  assert.equal(sideBySide(undefined, 1400), true, "nothing set: automatic");
  assert.equal(sideBySide("side", 300), true);
  assert.equal(sideBySide("stacked", 1400), false);
  assert.deepEqual(LAYOUTS.map((v) => LAYOUT_NAMES[v]), ["Automatic (by width)", "Side by side", "Stacked"]);
  assert.equal(layoutTip("auto", true), "Layout: Automatic (side by side)");
  assert.equal(layoutTip("auto", false), "Layout: Automatic (stacked)");
  assert.equal(layoutTip("side", true), "Layout: Side by side");
  assert.equal(layoutTip("stacked", false), "Layout: Stacked");
  assert.equal(layoutTip("junk", false), "Layout: Automatic (stacked)");
});

test("rows: one line when the list has room for the lanes, hash, author, date, gaps and 160 px of subject", () => {
  const lanes = 22; // a straight history: two lanes' width (graph.js)
  const need = ROW.pad + lanes + ROW.hash + ROW.author + ROW.date + ROW.gaps + ROW.subject;
  assert.equal(need, 454);
  assert.equal(oneLine(300, lanes), false);
  assert.equal(oneLine(405, lanes), false, "a list dragged to 405 px: two lines");
  assert.equal(oneLine(700, lanes), true);
  assert.equal(oneLine(need, lanes), true);
  assert.equal(oneLine(need - 1, lanes), false);
  // Wider lanes need more room.
  assert.equal(oneLine(600, 220), false);
  assert.equal(oneLine(700, 220), true);
});

test("the information area's two parts: the files as tall as their rows, half the area at most (two rows at least), the message the rest, 44 px at least", () => {
  assert.deepEqual(FILES, { head: 30, row: 24, gap: 2, pad: 8 });
  assert.equal(filesHeight(0), 38);
  assert.equal(filesHeight(1), 30 + 26 + 8);
  assert.equal(MESSAGE_MIN, 44);
  // One file in the panel's 191 px: the files as tall as their rows, the message the rest.
  assert.deepEqual(infoParts(191, 1), { message: 191 - 64, files: 64 });
  // Forty: half the area; the message keeps the other half.
  assert.deepEqual(infoParts(191, 40), { message: 95, files: 96 });
  assert.deepEqual(infoParts(400, 40), { message: 200, files: 200 });
  // A small area: two rows at least, as long as the message keeps its 44 px.
  assert.deepEqual(infoParts(150, 40), { message: 60, files: filesHeight(2) });
  assert.deepEqual(infoParts(MIN.info, 40), { message: MESSAGE_MIN, files: MIN.info - MESSAGE_MIN });
  // The least the area can be: the message's 44 px, the files' row and one file.
  assert.equal(MIN.info, MESSAGE_MIN + filesHeight(1));
  assert.ok(infoParts(MIN.info, 5).files >= filesHeight(1), "the count row and a file are seen");
});
