// Long diff lines broken into visual lines by columns (main.js, "Wrap" mode). The code font is
// monospace: a character takes one column, an East Asian wide or fullwidth one (and an emoji)
// two, a combining mark none. Tabs are spaces by then, up to the next multiple of four columns
// (expandTabs), as drawn.
// No Herdr imports: tested with node (test/git-enhanced/wrap.test.mjs).

/** A diff row's pixels beside its code: the left border (the target and comment mark) and the
 *  +/- sign column (the gutter's width varies). MARGIN is kept free at the right of a wrapped
 *  line, so a glyph a little wider than estimated clips nothing. */
export const BORDER = 2, SIGN = 16, MARGIN = 6;

// Two columns: East Asian Wide and Fullwidth, and emoji shown as pictures. Sorted [from, to] pairs.
const WIDE = [
  0x1100, 0x115f, 0x231a, 0x231b, 0x2329, 0x232a, 0x23e9, 0x23ec, 0x23f0, 0x23f0, 0x23f3, 0x23f3, 0x25fd, 0x25fe,
  0x2614, 0x2615, 0x2648, 0x2653, 0x267f, 0x267f, 0x2693, 0x2693, 0x26a1, 0x26a1, 0x26aa, 0x26ab, 0x26bd, 0x26be,
  0x26c4, 0x26c5, 0x26ce, 0x26ce, 0x26d4, 0x26d4, 0x26ea, 0x26ea, 0x26f2, 0x26f3, 0x26f5, 0x26f5, 0x26fa, 0x26fa,
  0x26fd, 0x26fd, 0x2705, 0x2705, 0x270a, 0x270b, 0x2728, 0x2728, 0x274c, 0x274c, 0x274e, 0x274e, 0x2753, 0x2755,
  0x2757, 0x2757, 0x2795, 0x2797, 0x27b0, 0x27b0, 0x27bf, 0x27bf, 0x2b1b, 0x2b1c, 0x2b50, 0x2b50, 0x2b55, 0x2b55,
  0x2e80, 0x303e, 0x3041, 0x33ff, 0x3400, 0x4dbf, 0x4e00, 0x9fff, 0xa000, 0xa4cf, 0xa960, 0xa97f, 0xac00, 0xd7a3,
  0xf900, 0xfaff, 0xfe10, 0xfe19, 0xfe30, 0xfe6f, 0xff00, 0xff60, 0xffe0, 0xffe6, 0x16fe0, 0x16fe4, 0x17000, 0x18aff,
  0x1b000, 0x1b2ff, 0x1f004, 0x1f004, 0x1f0cf, 0x1f0cf, 0x1f18e, 0x1f18e, 0x1f191, 0x1f19a, 0x1f200, 0x1f251,
  0x1f300, 0x1f64f, 0x1f680, 0x1f6ff, 0x1f7e0, 0x1f7eb, 0x1f90c, 0x1f9ff, 0x1fa70, 0x1faff, 0x20000, 0x2fffd,
  0x30000, 0x3fffd,
];
// No column: combining marks, zero-width spaces and joiners, variation selectors.
const ZERO = [0x0300, 0x036f, 0x1ab0, 0x1aff, 0x1dc0, 0x1dff, 0x200b, 0x200f, 0x20d0, 0x20ff, 0xfe00, 0xfe0f, 0xfe20, 0xfe2f, 0xe0100, 0xe01ef];

function within(ranges, cp) {
  let lo = 0, hi = ranges.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ranges[2 * mid]) hi = mid - 1;
    else if (cp > ranges[2 * mid + 1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** The columns one code point takes. */
export function charCols(cp) {
  if (cp < 0x300) return 1;
  return within(ZERO, cp) ? 0 : within(WIDE, cp) ? 2 : 1;
}

/** `text` with each tab replaced by the spaces up to the next multiple of `stop` columns, as a
 *  terminal, git diff in a pager and an editor show it: at a line's start a tab takes four, after
 *  "ab" two, so columns lined up with tabs stay lined up. Columns as charCols counts them. */
export function expandTabs(text, stop = 4) {
  if (!text.includes("\t")) return text;
  let out = "", col = 0;
  for (const c of text) {
    if (c === "\t") { const n = stop - (col % stop); out += " ".repeat(n); col += n; }
    else { out += c; col += charCols(c.codePointAt(0)); }
  }
  return out;
}

/** The columns a string takes. */
export function textCols(text) {
  let n = 0;
  for (const c of text) n += charCols(c.codePointAt(0));
  return n;
}

/** The code's width in a diff row `view` px wide: unified, or one half of a side-by-side row
 *  (the halves share `view` less a 1 px rule). */
export function codeWidth(view, gutter, split) {
  const row = split ? (view - 1) / 2 : view;
  return Math.max(0, row - BORDER - gutter - SIGN);
}

/** How many columns of `ch` px fit in `width` px, MARGIN kept free: at least one. */
export const colsFor = (width, ch) => Math.max(1, Math.floor((width - MARGIN) / ch));

/** Where `text` breaks into lines of at most `cols` columns: the index (UTF-16) each line after
 *  the first starts at. A line breaks after its last space when that space is in its second
 *  half, else at the limit (one long token is cut); a space that doesn't fit ends its line
 *  (drawn past the edge, it's clipped); a character wider than a line still gets one. */
export function breaks(text, cols) {
  const out = [], max = Math.max(1, cols);
  let col = 0, space = -1, spaceCol = 0;
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i), w = charCols(cp), next = i + (cp > 0xffff ? 2 : 1);
    if (col + w > max && col > 0) {
      if (cp === 32) { out.push(next); col = 0; space = -1; i = next; continue; }
      if (space > 0 && spaceCol * 2 >= max) { out.push(space); col -= spaceCol; }
      else { out.push(i); col = 0; }
      space = -1;
    }
    col += w;
    if (cp === 32) { space = next; spaceCol = col; }
    i = next;
  }
  if (out.at(-1) === text.length) out.pop();
  return out;
}

/** `spans` ({ text, ...style }) cut into visual lines of at most `cols` columns: one list of
 *  spans per line, each piece keeping its span's style. A line that fits is one line of the
 *  same spans; an empty one too. */
export function wrapSpans(spans, cols) {
  const text = spans.map((s) => s.text).join(""), cuts = breaks(text, cols);
  if (!cuts.length) return [spans];
  const ends = [...cuts, text.length], lines = ends.map(() => []);
  let at = 0;
  for (const s of spans) {
    const from = at, to = at + s.text.length;
    at = to;
    let start = 0;
    for (let k = 0; k < ends.length; k++) {
      const a = Math.max(from, start), b = Math.min(to, ends[k]);
      if (b > a) lines[k].push({ ...s, text: text.slice(a, b) });
      start = ends[k];
    }
  }
  return lines;
}
