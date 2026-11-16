// The History page's arrangement and sizes (history.js): the commit beside the commits or under
// them, where the commits end and the selected commit starts, where the commit's information ends
// and its diff starts (two lines to drag), and how many lines a commit's row takes.
// No Herdr imports: tested with node (test/git-enhanced/historylayout.test.mjs).
import { ago, when } from "./gitlog.js";

/** From this width (px) "auto" puts the commit beside the commits. */
export const WIDE = 760;
/** A line to drag: a 1 px rule in a strip this wide that takes the press. */
export const LINE = 7;
/** The smallest sizes (px): the commits' width beside the commit and height over it, the commit's
 *  width beside the commits, its information's height (the message's 44 px, the count row and a
 *  file) and its diff's height. */
/** The commit's files, under its information in a part of their own: a row "N files +A −D" (the
 *  layout button at its end), then a row per file; fixed heights, so the part can be as tall as its
 *  rows (a scroll area needs a height of its own). */
export const FILES = { head: 30, row: 24, gap: 2, pad: 8 };
export const filesHeight = (n) => FILES.head + n * (FILES.row + FILES.gap) + FILES.pad;
/** What the message part keeps at least: the subject and the hash. */
export const MESSAGE_MIN = 44;
/** The information area, `infoH` px, shared between the message (above; it scrolls) and `files`
 *  files (below): the files as tall as their rows, half the area at most (two rows at least), the
 *  message the rest, MESSAGE_MIN at least. So the count row is always seen. */
export function infoParts(infoH, files) {
  const want = filesHeight(files), least = filesHeight(Math.min(files, 2));
  const part = Math.max(0, Math.min(want, Math.max(least, Math.round(infoH / 2)), infoH - MESSAGE_MIN));
  return { message: infoH - part, files: part };
}

export const MIN = { listW: 260, listH: 100, commitW: 320, info: MESSAGE_MIN + filesHeight(1), diff: 120 };

/** Side by side or stacked, one setting for every copy (panel and tab; history.js keeps it in the
 *  shared key it is given, git-enhanced.historyLayout): "auto" (the default: side by side from
 *  WIDE px), "side" or "stacked". Anything else is "auto". */
export const LAYOUTS = ["auto", "side", "stacked"];
export const layoutOf = (value) => (LAYOUTS.includes(value) ? value : "auto");
/** Whether the commit sits beside the commits on a page `width` px wide. */
export const sideBySide = (value, width) => { const l = layoutOf(value); return l === "side" || (l === "auto" && width >= WIDE); };
/** The menu's words for each, and the button's tooltip (`side`: the arrangement in use). */
export const LAYOUT_NAMES = { auto: "Automatic (by width)", side: "Side by side", stacked: "Stacked" };
export const layoutTip = (value, side) => (layoutOf(value) === "auto" ? `Layout: Automatic (${side ? "side by side" : "stacked"})` : `Layout: ${LAYOUT_NAMES[layoutOf(value)]}`);

/** A size kept between its limits (the upper one never below the lower one). */
export const between = (v, min, max) => Math.round(Math.max(min, Math.min(v, Math.max(min, max))));

/** A one-line row's parts (px, history.js row): its padding and left border, the hash, the author,
 *  the date, the gaps between its five parts, and the least its refs and subject need. */
export const ROW = { pad: 14, hash: 58, author: 130, date: 46, gaps: 24, subject: 160 };
/** A one-line row's author and date columns, which two lines over the list resize (history.js
 *  colLine): their least widths (px), and the date column's widths from which it shows the date and
 *  time ("2025-03-14 09:30"), then also how long ago ("· 2 d"); narrower, how long ago only. */
export const COLS = { author: 48, date: 34, full: 100, both: 140 };
// A width kept from a drag (`v`) of column `which`, or its default: a whole number, its least at least.
const keptOf = (v, which) => (Number.isFinite(v) && v > 0 ? Math.max(COLS[which], Math.round(v)) : ROW[which]);
/** Whether a commit's row is one line in a list `listWidth` px wide whose lanes are `lanes` px
 *  wide; else it is two (the hash, author and date under the subject). `kept` ({ author, date }:
 *  widths kept from a drag, or null): one narrower than its default leaves the row that much more
 *  room; a wider one never takes the rows to two lines (it gives way: columns). */
export const oneLine = (listWidth, lanes, kept = null) => listWidth >= ROW.pad + lanes + ROW.hash
  + Math.min(keptOf(kept?.author, "author"), ROW.author) + Math.min(keptOf(kept?.date, "date"), ROW.date) + ROW.gaps + ROW.subject;
/** What the author and the date can take of a one-line row in a list `listWidth` px wide whose lanes
 *  are `lanes` px wide: the row less its padding, lanes, hash, gaps and its subject's least. */
export const colsRoom = (listWidth, lanes) => Math.floor(listWidth - (ROW.pad + lanes + ROW.hash + ROW.gaps + ROW.subject));
/** The author's and the date's widths of a one-line row: `kept` ({ author, date } from a drag; null,
 *  or one missing: the default) fitted into the room the list has (colsRoom): what is over the
 *  defaults gives way, shared in proportion, until they fit (a list whose rows are one line has room
 *  for the defaults, or for narrower kept ones). */
export function columns(kept, listWidth, lanes) {
  let author = keptOf(kept?.author, "author"), date = keptOf(kept?.date, "date");
  const over = author + date - colsRoom(listWidth, lanes);
  const extraA = Math.max(0, author - ROW.author), extra = extraA + Math.max(0, date - ROW.date);
  if (over > 0 && extra > 0) {
    const cut = Math.min(over, extra), cutA = Math.ceil((cut * extraA) / extra);
    author -= cutA; date -= cut - cutA;
  }
  return { author, date };
}
/** A one-line row's date in a column `width` px wide (COLS): how long ago ("2 d"); from COLS.full the
 *  date and time ("2025-03-14 09:30"); from COLS.both both ("2025-03-14 09:30 · 2 d"). */
export const dateText = (time, width, now = Date.now() / 1000) => (width >= COLS.both ? `${when(time)} · ${ago(time, now)}`
  : width >= COLS.full ? when(time) : ago(time, now));

/** The sizes (px) of a page `width` wide whose part under its bars is `body` tall, with the commit
 *  `side` by side with the commits or under them. `list`: the commits' kept size (their width side
 *  by side, their height stacked), `info`: the information's kept height; null: none kept.
 *  - Side by side: the commits 42% of the width (at least 380), between 260 and the width less the
 *    commit's 320; the commit as tall as the body.
 *  - Stacked: the commits 38% of the body, at least 100, leaving the commit room for its
 *    information's least (MIN.info), the line under it and the diff's 120 px.
 *  - The information (`infoH`): 40% of the commit's height, at least MIN.info, leaving the line
 *    under it and the diff's 120 px; infoParts shares it between the message and the files. */
export function sizes({ width, body, side, list = null, info = null }) {
  const listMax = side ? width - MIN.commitW : body - LINE - (MIN.info + LINE + MIN.diff);
  const listW = between(side && list ? list : Math.max(380, Math.round(width * 0.42)), MIN.listW, side ? listMax : width);
  const listH = between(!side && list ? list : Math.round(body * 0.38), MIN.listH, side ? body : listMax);
  const commitH = side ? body : body - listH - LINE;
  const infoMax = commitH - LINE - MIN.diff;
  const infoH = between(info || Math.round(commitH * 0.4), MIN.info, infoMax);
  return { listW, listH, listMax, commitH, infoH, infoMax };
}
