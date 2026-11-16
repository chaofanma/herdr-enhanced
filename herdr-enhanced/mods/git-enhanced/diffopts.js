// The diff's options (the settings' whitespace and context, which the control above the diff
// changes) and the "⋯ N lines" rows between hunks, which show more context when clicked.
// No Herdr imports: tested with node (test/git-enhanced/diffopts.test.mjs).

/** -U for "the whole file": more lines than any file the panel shows (it shows 1,500 rows). */
export const WHOLE = 1000000;

/** Lines of context one click on a "⋯ N lines" row adds (on each side of every gap of the file). */
export const MORE = 20;

/** The context choices, in the control's order. */
export const CONTEXTS = [{ value: 3, label: "3 lines" }, { value: 10, label: "10 lines" }, { value: "file", label: "Whole file" }];

/** git diff's arguments for the settings `{ whitespace, context }` and `extra` lines a file's gaps
 *  were opened by: -w ignores whitespace; -U sets the context (left to git, 3 unless its config
 *  says otherwise, for the default). */
export function diffArgs({ whitespace = false, context = 3 } = {}, extra = 0) {
  const out = whitespace ? ["-w"] : [];
  if (context === "file") out.push(`-U${WHOLE}`);
  else if (context !== 3 || extra > 0) out.push(`-U${context + extra}`);
  return out;
}

/** The lines of context in a few words, for ±'s tooltip. */
export const contextWords = ({ context = 3 } = {}) => (context === "file" ? "the whole file" : String(context));

/** Whether the lines of context differ from git's 3 (± shows them). */
export const nonDefault = ({ context = 3 } = {}) => context !== 3;

/** What a gap row starts with; a diff line never does (they start with " ", "+", "-", "@" or "\"). */
export const GAP = "\u22ef ";
export const isGap = (text) => typeof text === "string" && text.startsWith(GAP);

// A hunk header's new side: its first line and how many lines it has.
function newSide(line) {
  const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))?/.exec(line);
  return m ? { start: Number(m[1]), count: m[2] === undefined ? 1 : Number(m[2]) } : null;
}

/** A file's diff lines (from its first @@) with a gap row before each hunk whose new lines don't
 *  follow on from the hunk before (or from line 1): `{ lines, gaps }`, `gaps` mapping a gap row's
 *  index in `lines` to `{ from, to, top }`, the new file's lines it hides (`top`: before the first
 *  hunk). The lines after the last hunk aren't counted (the diff doesn't say how many there are). */
export function withGaps(lines) {
  const out = [], gaps = new Map();
  let next = 1;
  for (const line of lines) {
    const side = line.startsWith("@@") ? newSide(line) : null;
    if (side) {
      const start = side.count === 0 ? side.start + 1 : side.start;
      if (start > next) {
        const n = start - next;
        gaps.set(out.length, { from: next, to: start - 1, top: next === 1 });
        out.push(`${GAP}${n} line${n === 1 ? "" : "s"}`);
      }
      next = start + side.count;
    }
    out.push(line);
  }
  return { lines: out, gaps };
}

/** Row `i` of `lines` (withGaps') as an index into the lines without gap rows: what a hunk's
 *  patch is cut from. */
export function withoutGaps(lines, i) {
  let before = 0;
  for (let j = 0; j < i && j < lines.length; j++) if (isGap(lines[j])) before++;
  return i - before;
}

/** The new line to bring on screen once gap `gap` was opened: the first one it hid, or for the
 *  gap above the first hunk, the last. */
export const revealed = (gap) => (gap.top ? gap.to : gap.from);

/** The new file's line a diff row opens at (rows as the panel builds them: kind "@", "+", "-", " "
 *  or ""): its own for an added or unchanged line, the hunk's first for a @@ row, and for a removed
 *  line the nearest new one: the next in its hunk, else the one before it, else the hunk's first.
 *  Null for other rows. */
export function lineFor(rows, i) {
  const r = rows[i];
  if (!r) return null;
  if (r.kind === "+" || r.kind === " ") return r.number ?? null;
  if (r.kind === "@") return newSide(r.text)?.start || 1;
  if (r.kind !== "-") return null;
  for (let j = i + 1; j < rows.length && rows[j].kind !== "@" && !isGap(rows[j].text); j++) if (rows[j].kind === "+" || rows[j].kind === " ") return rows[j].number;
  for (let j = i - 1; j >= 0; j--) {
    if (rows[j].kind === "+" || rows[j].kind === " ") return rows[j].number;
    if (rows[j].kind === "@") return newSide(rows[j].text)?.start || 1;
  }
  return 1;
}
