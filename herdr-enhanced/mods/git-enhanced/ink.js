// Colors that read on what they are drawn on, in any theme. A theme's ANSI and status colors are
// made for its terminals' background, and some don't read on its surface, its cards or a tinted row
// (win98's green on silver: 1.7 to 1; atom-one-dark's red on a popover: 4.0). `readable` keeps a
// color while its contrast (WCAG's ratio) on each of the backgrounds given is enough, else the
// theme's foreground: only the theme's own colors, and a mark still says what it says by its letter
// or word. No imports: tested with node (test/shared/ink.test.mjs).

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// [r, g, b, a], each 0..1; null for anything that isn't a hex color.
function rgba(color) {
  const m = HEX.exec(String(color ?? ""));
  if (!m) return null;
  const h = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
}
const lin = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
// `top` drawn over an opaque `under`.
const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);

/** WCAG's contrast ratio of `color` drawn on `on` (a color, or a list of layers bottom first, each
 *  over the one under it, the first over `base`); null when one of them isn't a hex color. */
export function contrast(color, on, base = "#000000") {
  const layers = (Array.isArray(on) ? on : [on]).map(rgba), b = rgba(base), c = rgba(color);
  if (!b || !c || layers.some((l) => !l)) return null;
  const under = layers.reduce((u, l) => over(l, u), over(b, [0, 0, 0, 1])), top = over(c, under);
  const [x, y] = [luminance(top), luminance(under)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** `color` where it reads (contrast `min`: 4.5, normal text's) on each background in `on` (a color,
 *  or a list of them; a background may be a list of layers, see contrast), all over the theme's
 *  surface; else `t.foreground`. `color` may be a list: the first that reads, else the last. A color
 *  that can't be measured is kept. */
export function readable(t, color, on = t.surface, min = 4.5) {
  // A page asks the same few questions for every row of a list (each a few contrast ratios): the
  // answers are kept by what they depend on (the theme's surface and foreground among them).
  const key = JSON.stringify([t.surface, t.foreground, color, on, min]);
  const known = answers.get(key);
  if (known !== undefined) return known;
  const colors = Array.isArray(color) ? color : [color, t.foreground];
  const reads = (c) => (Array.isArray(on) ? on : [on]).every((bg) => { const r = contrast(c, bg, t.surface); return r === null || r >= min; });
  const answer = colors.find(reads) ?? colors.at(-1);
  if (answers.size >= ANSWERS) answers.clear();
  answers.set(key, answer);
  return answer;
}
// readable's answers, by its arguments; at most ANSWERS (then they start over).
const answers = new Map(), ANSWERS = 5000;
