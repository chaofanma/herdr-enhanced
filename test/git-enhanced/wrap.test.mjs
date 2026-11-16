import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { BORDER, SIGN, MARGIN, charCols, textCols, codeWidth, colsFor, breaks, wrapSpans, expandTabs } = await mod("wrap.js");

const texts = (lines) => lines.map((l) => l.map((s) => s.text).join(""));

test("columns: wide and fullwidth take two, combining marks none", () => {
  assert.equal(textCols(""), 0);
  assert.equal(textCols("abc"), 3);
  assert.equal(textCols("한글"), 4);
  assert.equal(textCols("ｱＡ"), 3, "halfwidth katakana 1, fullwidth A 2");
  assert.equal(textCols("한글"), 4);
  assert.equal(textCols("e\u0301"), 1, "e + combining acute");
  assert.equal(textCols("😀"), 2, "an astral emoji, one code point");
  assert.equal(textCols("a\u200bb"), 2, "zero-width space");
  assert.equal(charCols(0x20000), 2);
  assert.equal(charCols(0x2500), 1, "box drawing is narrow");
});

test("codeWidth and colsFor: the row less its border, gutter and sign; at least one column", () => {
  assert.equal(codeWidth(229, 30, false), 229 - BORDER - 30 - SIGN);
  assert.equal(codeWidth(1201, 30, true), 600 - BORDER - 30 - SIGN);
  assert.equal(codeWidth(20, 30, false), 0);
  // A narrow panel: 231 pt wide, font 12 (13 - 1): 0.62 em columns.
  const ch = 12 * 0.62;
  assert.equal(colsFor(codeWidth(229, 30, false), ch), Math.floor((181 - MARGIN) / ch));
  assert.equal(colsFor(0, ch), 1);
  assert.equal(colsFor(-50, ch), 1);
  // A bigger font: fewer columns in the same width.
  assert.ok(colsFor(400, 16 * 0.62) < colsFor(400, 12 * 0.62));
});

test("breaks: at the limit, after a space in the second half, a long token cut", () => {
  assert.deepEqual(breaks("", 10), []);
  assert.deepEqual(breaks("abcdefghij", 10), [], "exactly cols fits");
  assert.deepEqual(breaks("abcdefghijk", 10), [10]);
  assert.deepEqual(breaks("a".repeat(25), 10), [10, 20], "one long token");
  assert.deepEqual(breaks("hello world again", 10), [6, 12], "after the spaces");
  assert.deepEqual(breaks("ab cdefghijklmno", 10), [10], "a space in the first half: cut at the limit");
  assert.deepEqual(breaks("abcdefghij klm", 10), [11], "a space that doesn't fit ends the line");
  assert.deepEqual(breaks("abcdefghij ", 10), [], "a last space hangs, no empty line");
  assert.deepEqual(breaks("abc", 0), [1, 2], "cols < 1 is one");
});

test("breaks: a wide character never straddles a break", () => {
  assert.deepEqual(breaks("abcdefghi한", 10), [9], "9 + 2 > 10: it starts the next line");
  assert.deepEqual(breaks("한글한글한", 10), [], "5 wide = 10 columns");
  assert.deepEqual(breaks("한글한글한글", 10), [5]);
  assert.deepEqual(breaks("한한", 1), [1], "wider than the line: one per line");
  assert.deepEqual(breaks("😀😀a", 4), [4], "UTF-16 index after the surrogate pairs");
  assert.deepEqual(breaks("abcdefghij\u0301k", 10), [11], "a combining mark stays with its letter");
});

test("wrapSpans: styles kept across the cuts, marked words too", () => {
  const spans = [{ text: "const ", cls: "kw" }, { text: "veryLongName", cls: "" }, { text: " = ", cls: "op" }, { text: "1;", cls: "num", mark: true }];
  const lines = wrapSpans(spans, 10);
  assert.deepEqual(texts(lines), ["const ", "veryLongNa", "me = 1;"]);
  assert.deepEqual(lines[1], [{ text: "veryLongNa", cls: "" }]);
  assert.deepEqual(lines[2], [{ text: "me", cls: "" }, { text: " = ", cls: "op" }, { text: "1;", cls: "num", mark: true }]);
  // Nothing to break: the same spans.
  assert.equal(wrapSpans(spans, 80)[0], spans);
  // An empty line is one line.
  assert.deepEqual(texts(wrapSpans([{ text: "", cls: "" }], 10)), [""]);
  assert.deepEqual(wrapSpans([], 10), [[]]);
  // Every character lands once, in order.
  const long = [{ text: "x".repeat(37), cls: "a" }, { text: " y".repeat(20), cls: "b" }];
  for (const cols of [1, 3, 7, 10, 23]) {
    const out = wrapSpans(long, cols);
    assert.equal(texts(out).join(""), long.map((s) => s.text).join(""), `cols ${cols}`);
    for (const l of texts(out)) assert.ok(textCols(l.replace(/ $/, "")) <= cols, `cols ${cols}: "${l}"`);
  }
});

test("a 300-character line at a narrow panel's width", () => {
  const line = `export const LONG = "a very long line ${"that keeps going ".repeat(16)}";`;
  const cols = colsFor(codeWidth(229, 30, false), 12 * 0.62), lines = wrapSpans([{ text: line, cls: "" }], cols);
  assert.ok(lines.length >= Math.ceil(line.length / cols));
  assert.equal(texts(lines).join(""), line);
  // A smaller font: fewer lines; a split half: more.
  assert.ok(wrapSpans([{ text: line }], colsFor(codeWidth(229, 30, false), 10 * 0.62)).length < lines.length);
  assert.ok(wrapSpans([{ text: line }], colsFor(codeWidth(229, 30, true), 12 * 0.62)).length > lines.length);
});

test("tabs: spaces up to the next multiple of four columns, as a terminal and git diff in a pager show them", () => {
  assert.equal(expandTabs("\tx"), "    x", "at the line's start, four");
  assert.equal(expandTabs("ab\tc"), "ab  c", "after two columns, two");
  assert.equal(expandTabs("abc\tc"), "abc c");
  assert.equal(expandTabs("abcd\te"), "abcd    e", "on a stop, a whole four");
  assert.equal(expandTabs("a\t\tb"), "a       b", "two in a row: to 4, then to 8");
  assert.equal(expandTabs("#define X\t1\n".trim()), "#define X   1", "an aligned value");
  assert.equal(expandTabs("한\tx"), "한  x", "a wide character takes two of the four");
  assert.equal(expandTabs("e\u0301\tx"), "e\u0301   x", "a combining mark takes none");
  assert.equal(expandTabs("ab\tc", 8), "ab      c", "another stop");
  const plain = "no tabs here";
  assert.equal(expandTabs(plain), plain);
});
